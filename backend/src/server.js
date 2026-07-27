import express from "express";
import cors from "cors";
import "dotenv/config";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { pool } from "./db.js";
import { cifraPassword, verificaPassword, generaToken, richiedeAuth } from "./auth.js";
import { inviaEmailResetPassword } from "./email.js";
import { stripe, PREZZO_MENSILE_CENTESIMI } from "./stripe.js";
import { richiedeAbbonamentoAttivo, statoAbbonamentoDi } from "./abbonamento.js";
import { adminRouter, richiedeAdmin } from "./admin.js";

const app = express();
app.use(cors());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://costi-commessa-frontend.onrender.com";
const SCADENZA_RESET_MS = 60 * 60 * 1000; // 1 ora

/**
 * Webhook Stripe: DEVE stare prima di express.json() perché la verifica della
 * firma richiede il corpo grezzo (byte per byte), non il JSON già parsato.
 * Aggiorna stato_abbonamento in base allo stato reale dell'abbonamento su
 * Stripe: Stripe stessa riflette qui i tentativi di riaddebito falliti,
 * quindi non serve ascoltare separatamente gli eventi di pagamento.
 */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Firma webhook Stripe non valida:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    const tipiSottoscrizione = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
    if (tipiSottoscrizione.includes(event.type)) {
      const subscription = event.data.object;
      const statoStripe = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
      const nuovoStato = ["active", "trialing"].includes(statoStripe) ? "attivo" : "scaduto";
      await pool.query(
        "UPDATE aziende SET stato_abbonamento = $1, stripe_subscription_id = $2 WHERE stripe_customer_id = $3",
        [nuovoStato, subscription.id, subscription.customer]
      );
    }
    res.json({ received: true });
  } catch (e) {
    console.error("Errore elaborando il webhook Stripe:", e);
    res.status(500).json({ errore: "Errore interno." });
  }
});

app.use(express.json({ limit: "10mb" }));

app.get("/api/salute", (req, res) => res.json({ ok: true }));

/** Crea una nuova azienda con il suo utente (email+password cifrata). */
app.post("/api/registrazione", async (req, res) => {
  const { nomeAzienda = "", email = "", password = "" } = req.body || {};
  const nome = String(nomeAzienda).trim();
  const mail = String(email).trim().toLowerCase();

  if (!nome) return res.status(400).json({ errore: "Il nome dell'azienda è obbligatorio." });
  if (!EMAIL_RE.test(mail)) return res.status(400).json({ errore: "Email non valida." });
  if (String(password).length < 8) {
    return res.status(400).json({ errore: "La password deve avere almeno 8 caratteri." });
  }

  const client = await pool.connect();
  try {
    const esistente = await client.query("SELECT id FROM utenti WHERE email = $1", [mail]);
    if (esistente.rows.length > 0) {
      return res.status(409).json({ errore: "Esiste già un account con questa email." });
    }

    const aziendaId = randomUUID();
    const hash = await cifraPassword(password);

    await client.query("BEGIN");
    await client.query("INSERT INTO aziende (id, nome) VALUES ($1, $2)", [aziendaId, nome]);
    await client.query(
      "INSERT INTO utenti (azienda_id, email, password_hash) VALUES ($1, $2, $3)",
      [aziendaId, mail, hash]
    );
    await client.query("COMMIT");

    res.status(201).json({ token: generaToken(aziendaId), nomeAzienda: nome });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ errore: "Impossibile completare la registrazione." });
  } finally {
    client.release();
  }
});

/** Verifica le credenziali e restituisce un token che identifica l'azienda. */
app.post("/api/login", async (req, res) => {
  const { email = "", password = "" } = req.body || {};
  const mail = String(email).trim().toLowerCase();

  try {
    const ris = await pool.query(
      "SELECT u.password_hash, u.azienda_id, a.nome FROM utenti u JOIN aziende a ON a.id = u.azienda_id WHERE u.email = $1",
      [mail]
    );
    const riga = ris.rows[0];
    const ok = riga ? await verificaPassword(password, riga.password_hash) : false;
    if (!ok) return res.status(401).json({ errore: "Email o password non corretti." });

    res.json({ token: generaToken(riga.azienda_id), nomeAzienda: riga.nome });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile effettuare l'accesso." });
  }
});

/**
 * Se l'email esiste, genera un token di reset e manda l'email con il link.
 * La risposta è sempre la stessa, esista o meno l'email: non deve mai
 * rivelare se un indirizzo è registrato nel sistema.
 */
app.post("/api/password-dimenticata", async (req, res) => {
  const { email = "" } = req.body || {};
  const mail = String(email).trim().toLowerCase();
  const rispostaGenerica = { ok: true, messaggio: "Se l'indirizzo esiste, riceverai un'email con le istruzioni." };

  if (!EMAIL_RE.test(mail)) return res.json(rispostaGenerica);

  try {
    const utente = await pool.query("SELECT id FROM utenti WHERE email = $1", [mail]);
    if (utente.rows.length > 0) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const scadeIl = new Date(Date.now() + SCADENZA_RESET_MS);
      await pool.query(
        "INSERT INTO reset_password (utente_id, token_hash, scade_il) VALUES ($1, $2, $3)",
        [utente.rows[0].id, tokenHash, scadeIl]
      );
      const link = `${FRONTEND_URL}/?token=${token}`;
      inviaEmailResetPassword(mail, link).catch((e) => console.error("Invio email di reset non riuscito:", e));
    }
  } catch (e) {
    console.error(e);
    // La risposta resta identica anche in caso di errore interno: stessa regola di non-rivelazione.
  }

  res.json(rispostaGenerica);
});

/** Verifica il token di reset e, se valido e non scaduto/usato, aggiorna la password. */
app.post("/api/reset-password", async (req, res) => {
  const { token = "", password = "" } = req.body || {};
  if (String(password).length < 8) {
    return res.status(400).json({ errore: "La password deve avere almeno 8 caratteri." });
  }
  const tokenHash = createHash("sha256").update(String(token)).digest("hex");

  const client = await pool.connect();
  try {
    const ris = await client.query(
      "SELECT id, utente_id, scade_il, usato FROM reset_password WHERE token_hash = $1",
      [tokenHash]
    );
    const riga = ris.rows[0];
    if (!riga) return res.status(400).json({ errore: "Il link non è valido." });
    if (riga.usato) return res.status(400).json({ errore: "Questo link è già stato usato. Richiedi un nuovo reset." });
    if (new Date(riga.scade_il) < new Date()) {
      return res.status(400).json({ errore: "Il link è scaduto. Richiedi un nuovo reset." });
    }

    const hash = await cifraPassword(password);
    await client.query("BEGIN");
    await client.query("UPDATE utenti SET password_hash = $1 WHERE id = $2", [hash, riga.utente_id]);
    await client.query("UPDATE reset_password SET usato = true WHERE id = $1", [riga.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ errore: "Impossibile reimpostare la password." });
  } finally {
    client.release();
  }
});

/** Stato dell'abbonamento dell'azienda del token (esente / attivo / prova / scaduto). */
app.get("/api/abbonamento/stato", richiedeAuth, async (req, res) => {
  try {
    const info = await statoAbbonamentoDi(req.aziendaId);
    if (!info) return res.status(404).json({ errore: "Azienda non trovata." });
    res.json(info);
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere lo stato dell'abbonamento." });
  }
});

/** Crea una sessione di Stripe Checkout (pagina ospitata da Stripe: il numero
 *  di carta non passa mai dal nostro backend) per l'abbonamento mensile. */
app.post("/api/abbonamento/checkout", richiedeAuth, async (req, res) => {
  try {
    const ris = await pool.query(
      "SELECT stripe_customer_id, u.email FROM aziende a JOIN utenti u ON u.azienda_id = a.id WHERE a.id = $1",
      [req.aziendaId]
    );
    const riga = ris.rows[0];
    if (!riga) return res.status(404).json({ errore: "Azienda non trovata." });

    let customerId = riga.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: riga.email, metadata: { aziendaId: req.aziendaId } });
      customerId = customer.id;
      await pool.query("UPDATE aziende SET stripe_customer_id = $1 WHERE id = $2", [customerId, req.aziendaId]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: "Abbonamento Costi Commessa" },
            unit_amount: PREZZO_MENSILE_CENTESIMI,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${FRONTEND_URL}/?abbonamento=successo`,
      cancel_url: `${FRONTEND_URL}/?abbonamento=annullato`,
      metadata: { aziendaId: req.aziendaId },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile avviare il pagamento." });
  }
});

/** Apre il portale Stripe (pagina ospitata da Stripe) dove un'azienda con
 *  abbonamento attivo può aggiornare il metodo di pagamento, vedere le
 *  fatture o disdire. */
app.post("/api/abbonamento/portale", richiedeAuth, async (req, res) => {
  try {
    const ris = await pool.query("SELECT stripe_customer_id FROM aziende WHERE id = $1", [req.aziendaId]);
    const customerId = ris.rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ errore: "Nessun abbonamento da gestire." });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${FRONTEND_URL}/`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile aprire la gestione dell'abbonamento." });
  }
});

/**
 * Pannello di amministrazione: sola lettura, solo dati di riepilogo su TUTTE
 * le aziende (mai password né dati operativi). Sezione separata da /api/stato:
 * richiedeAdmin verifica sempre lato server l'email del token contro l'elenco
 * admin, indipendentemente da qualunque flag mandato dal frontend.
 */
app.use("/api/admin", richiedeAuth, richiedeAdmin, adminRouter);

/**
 * Restituisce l'intero stato dell'azienda autenticata (dipendenti, commesse,
 * registrazioni, nome azienda). Rispecchia la forma che il frontend già usa
 * internamente, così il resto dell'app non deve cambiare. L'azienda è sempre
 * quella del token verificato da richiedeAuth, mai un valore mandato dal client.
 */
app.get("/api/stato", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const aziendaId = req.aziendaId;
  try {
    const [azRes, dipRes, comRes, regRes, matRes] = await Promise.all([
      pool.query("SELECT nome FROM aziende WHERE id = $1", [aziendaId]),
      pool.query(
        "SELECT id, nome, cognome, lordo_mensile FROM dipendenti WHERE azienda_id = $1 ORDER BY nome, cognome",
        [aziendaId]
      ),
      pool.query(
        "SELECT id, codice, descrizione FROM commesse WHERE azienda_id = $1 ORDER BY codice",
        [aziendaId]
      ),
      pool.query(
        "SELECT id, dipendente_id, commessa_id, to_char(data, 'YYYY-MM-DD') AS data, ore FROM registrazioni WHERE azienda_id = $1",
        [aziendaId]
      ),
      pool.query(`${SELECT_MATERIALI} WHERE azienda_id = $1 ORDER BY data DESC, descrizione`, [aziendaId]),
    ]);

    res.json({
      azienda: azRes.rows[0]?.nome ?? "",
      dipendenti: dipRes.rows.map((d) => ({
        id: d.id,
        nome: d.nome,
        cognome: d.cognome,
        lordoMensile: d.lordo_mensile || {},
      })),
      commesse: comRes.rows.map((c) => ({ id: c.id, codice: c.codice, descrizione: c.descrizione })),
      registrazioni: regRes.rows.map((r) => ({
        id: r.id,
        dipendenteId: r.dipendente_id,
        commessaId: r.commessa_id,
        data: r.data,
        ore: Number(r.ore),
      })),
      materiali: matRes.rows.map(mappaMateriale),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere i dati." });
  }
});

/**
 * Sostituisce l'intero dataset dell'azienda autenticata in una transazione
 * (stesso modello dell'autosave "salva tutto lo stato" che l'app usava
 * già in locale, solo che ora scrive su un database condiviso). L'azienda è
 * sempre quella del token verificato da richiedeAuth, mai un id mandato dal client.
 */
app.put("/api/stato", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const aziendaId = req.aziendaId;
  const { dipendenti = [], commesse = [], registrazioni = [], materiali = null, azienda = "" } = req.body || {};
  if (!Array.isArray(dipendenti) || !Array.isArray(commesse) || !Array.isArray(registrazioni)) {
    return res.status(400).json({ errore: "Struttura dati non valida." });
  }
  if (materiali !== null && !Array.isArray(materiali)) {
    return res.status(400).json({ errore: "Struttura dati non valida." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO aziende (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET nome = $2",
      [aziendaId, azienda]
    );

    // Ordine di cancellazione che rispetta i vincoli di chiave esterna.
    await client.query("DELETE FROM registrazioni WHERE azienda_id = $1", [aziendaId]);
    // Le commesse NON si cancellano tutte: i materiali sono loro figli in
    // cascata, e un "cancella e ricrea" a ogni salvataggio automatico
    // cancellerebbe tutti i materiali dell'azienda. Si tolgono quindi solo le
    // commesse davvero sparite dall'elenco (e con esse, giustamente, i loro
    // materiali); le altre vengono aggiornate al passo successivo.
    await client.query(
      "DELETE FROM commesse WHERE azienda_id = $1 AND NOT (id = ANY($2::text[]))",
      [aziendaId, commesse.map((c) => String(c.id))]
    );
    await client.query("DELETE FROM dipendenti WHERE azienda_id = $1", [aziendaId]);

    for (const d of dipendenti) {
      await client.query(
        "INSERT INTO dipendenti (id, azienda_id, nome, cognome, lordo_mensile) VALUES ($1, $2, $3, $4, $5)",
        [d.id, aziendaId, d.nome, d.cognome || "", JSON.stringify(d.lordoMensile || {})]
      );
    }
    for (const c of commesse) {
      // "WHERE commesse.azienda_id = $2" impedisce che un id appartenente a
      // un'altra azienda venga sovrascritto: in quel caso non si aggiorna
      // nulla e la transazione viene annullata subito sotto.
      const ris = await client.query(
        `INSERT INTO commesse (id, azienda_id, codice, descrizione) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET codice = EXCLUDED.codice, descrizione = EXCLUDED.descrizione
           WHERE commesse.azienda_id = $2
         RETURNING id`,
        [c.id, aziendaId, c.codice, c.descrizione || ""]
      );
      if (ris.rowCount === 0) throw new Error(`La commessa ${c.id} appartiene a un'altra azienda.`);
    }
    for (const r of registrazioni) {
      await client.query(
        "INSERT INTO registrazioni (id, azienda_id, dipendente_id, commessa_id, data, ore) VALUES ($1, $2, $3, $4, $5, $6)",
        [r.id, aziendaId, r.dipendenteId, r.commessaId, r.data, r.ore]
      );
    }

    // I materiali si toccano SOLO se il client li manda esplicitamente (è il
    // caso del ripristino di un backup). Il salvataggio automatico non li
    // include: li gestiscono le rotte /api/materiali, e ometterli qui
    // significa "lasciali come stanno", non "cancellali".
    if (materiali) {
      await client.query("DELETE FROM materiali WHERE azienda_id = $1", [aziendaId]);
      for (const m of materiali) {
        const { voce, errore } = leggiVoceMateriale(m);
        if (errore) throw new Error(`Materiale non valido (${m?.descrizione ?? "senza descrizione"}): ${errore}`);
        await client.query(
          `INSERT INTO materiali (id, azienda_id, commessa_id, data, fornitore, descrizione, quantita, prezzo_unitario)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8
            WHERE EXISTS (SELECT 1 FROM commesse WHERE id = $3 AND azienda_id = $2)`,
          [m.id || randomUUID(), aziendaId, m.commessaId, voce.data, voce.fornitore, voce.descrizione, voce.quantita, voce.prezzoUnitario]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ errore: "Impossibile salvare i dati." });
  } finally {
    client.release();
  }
});

/**
 * Rinomina una commessa (codice e/o descrizione) senza toccare nient'altro.
 * È un'operazione sicura per costruzione: le registrazioni sono legate alla
 * commessa tramite registrazioni.commessa_id (chiave esterna su commesse.id),
 * mai tramite il codice testuale. Cambiando solo l'etichetta, tutte le ore,
 * i costi, i riepiloghi e gli export restano identici.
 *
 * L'azienda è sempre quella del token (richiedeAuth): la clausola
 * "AND azienda_id = $4" fa sì che una commessa di un'altra azienda risulti
 * semplicemente inesistente, senza rivelarne l'esistenza.
 */
app.patch("/api/commesse/:id", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const aziendaId = req.aziendaId;
  const id = String(req.params.id);
  const codice = String(req.body?.codice ?? "").trim();
  const descrizione = String(req.body?.descrizione ?? "").trim();

  if (!codice) return res.status(400).json({ errore: "Il codice della commessa è obbligatorio." });

  try {
    // Un solo UPDATE atomico: il NOT EXISTS impedisce che, fra un controllo
    // separato e la scrittura, un'altra richiesta occupi lo stesso codice.
    // Il confronto è senza distinzione fra maiuscole e minuscole, come il
    // controllo che il frontend fa già alla creazione di una commessa.
    const agg = await pool.query(
      `UPDATE commesse SET codice = $2, descrizione = $3
         WHERE id = $1 AND azienda_id = $4
           AND NOT EXISTS (
             SELECT 1 FROM commesse altra
              WHERE altra.azienda_id = $4 AND altra.id <> $1
                AND LOWER(altra.codice) = LOWER($2)
           )
       RETURNING id, codice, descrizione`,
      [id, codice, descrizione, aziendaId]
    );

    if (agg.rows.length === 1) {
      const c = agg.rows[0];
      return res.json({ commessa: { id: c.id, codice: c.codice, descrizione: c.descrizione } });
    }

    // Nessuna riga aggiornata: o la commessa non è di questa azienda, o il
    // codice è già occupato da un'altra commessa della stessa azienda.
    const esiste = await pool.query(
      "SELECT 1 FROM commesse WHERE id = $1 AND azienda_id = $2",
      [id, aziendaId]
    );
    if (esiste.rows.length === 0) return res.status(404).json({ errore: "Commessa non trovata." });
    res.status(409).json({ errore: `Esiste già un'altra commessa con il codice ${codice}.` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile rinominare la commessa." });
  }
});

/* ---------------------------------------------------------------------------
   MATERIALI — costo dei materiali per commessa, inserito a mano.
   Voce di costo AGGIUNTIVA e separata: non entra mai nel calcolo della tariffa
   oraria né nell'invariante della manodopera, si somma solo alla fine.
   Il collegamento alla commessa è per id, mai per codice testuale.
--------------------------------------------------------------------------- */

// "costo" è calcolato dal database (colonna generata): non viene mai accettato
// dal client, così quantità × prezzo non può arrivare incoerente.
const SELECT_MATERIALI =
  "SELECT id, commessa_id, to_char(data, 'YYYY-MM-DD') AS data, fornitore, descrizione, quantita, prezzo_unitario, costo FROM materiali";

const mappaMateriale = (r) => ({
  id: r.id,
  commessaId: r.commessa_id,
  data: r.data,
  fornitore: r.fornitore,
  descrizione: r.descrizione,
  quantita: Number(r.quantita),
  prezzoUnitario: Number(r.prezzo_unitario),
  costo: Number(r.costo),
});

/** Controlli comuni a creazione e modifica. Ritorna { voce } oppure { errore }. */
function leggiVoceMateriale(body) {
  const data = String(body?.data ?? "").trim();
  const fornitore = String(body?.fornitore ?? "").trim();
  const descrizione = String(body?.descrizione ?? "").trim();
  const quantita = Number(body?.quantita);
  const prezzoUnitario = Number(body?.prezzoUnitario);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(new Date(data + "T00:00:00").getTime())) {
    return { errore: "Data non valida." };
  }
  if (!descrizione) return { errore: "La descrizione del materiale è obbligatoria." };
  if (!Number.isFinite(quantita) || quantita <= 0) return { errore: "La quantità deve essere maggiore di zero." };
  if (!Number.isFinite(prezzoUnitario) || prezzoUnitario < 0) {
    return { errore: "Il prezzo unitario non può essere negativo." };
  }
  return { voce: { data, fornitore, descrizione, quantita, prezzoUnitario } };
}

/** Elenco dei materiali dell'azienda del token, eventualmente di una sola commessa. */
app.get("/api/materiali", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const commessaId = req.query.commessaId ? String(req.query.commessaId) : null;
  try {
    const ris = commessaId
      ? await pool.query(
          `${SELECT_MATERIALI} WHERE azienda_id = $1 AND commessa_id = $2 ORDER BY data DESC, descrizione`,
          [req.aziendaId, commessaId]
        )
      : await pool.query(`${SELECT_MATERIALI} WHERE azienda_id = $1 ORDER BY data DESC, descrizione`, [req.aziendaId]);
    res.json({ materiali: ris.rows.map(mappaMateriale) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere i materiali." });
  }
});

/** Aggiunge una voce di materiale a una commessa dell'azienda del token. */
app.post("/api/materiali", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const commessaId = String(req.body?.commessaId ?? "");
  const { voce, errore } = leggiVoceMateriale(req.body);
  if (errore) return res.status(400).json({ errore });

  try {
    // L'INSERT ... SELECT scrive solo se la commessa è di questa azienda:
    // il controllo di proprietà e la scrittura sono la stessa operazione.
    const ris = await pool.query(
      `INSERT INTO materiali (id, azienda_id, commessa_id, data, fornitore, descrizione, quantita, prezzo_unitario)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (SELECT 1 FROM commesse WHERE id = $3 AND azienda_id = $2)
       RETURNING id, commessa_id, to_char(data, 'YYYY-MM-DD') AS data, fornitore, descrizione, quantita, prezzo_unitario, costo`,
      [randomUUID(), req.aziendaId, commessaId, voce.data, voce.fornitore, voce.descrizione, voce.quantita, voce.prezzoUnitario]
    );
    if (ris.rows.length === 0) return res.status(404).json({ errore: "Commessa non trovata." });
    res.status(201).json({ materiale: mappaMateriale(ris.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile salvare il materiale." });
  }
});

/** Modifica una voce di materiale dell'azienda del token. */
app.patch("/api/materiali/:id", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const { voce, errore } = leggiVoceMateriale(req.body);
  if (errore) return res.status(400).json({ errore });

  try {
    const ris = await pool.query(
      `UPDATE materiali SET data = $3, fornitore = $4, descrizione = $5, quantita = $6, prezzo_unitario = $7
         WHERE id = $1 AND azienda_id = $2
       RETURNING id, commessa_id, to_char(data, 'YYYY-MM-DD') AS data, fornitore, descrizione, quantita, prezzo_unitario, costo`,
      [String(req.params.id), req.aziendaId, voce.data, voce.fornitore, voce.descrizione, voce.quantita, voce.prezzoUnitario]
    );
    if (ris.rows.length === 0) return res.status(404).json({ errore: "Materiale non trovato." });
    res.json({ materiale: mappaMateriale(ris.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile aggiornare il materiale." });
  }
});

/** Elimina una voce di materiale dell'azienda del token. */
app.delete("/api/materiali/:id", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  try {
    const ris = await pool.query(
      "DELETE FROM materiali WHERE id = $1 AND azienda_id = $2 RETURNING id",
      [String(req.params.id), req.aziendaId]
    );
    if (ris.rows.length === 0) return res.status(404).json({ errore: "Materiale non trovato." });
    res.json({ ok: true, id: ris.rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile eliminare il materiale." });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Backend in ascolto sulla porta ${port}`));
