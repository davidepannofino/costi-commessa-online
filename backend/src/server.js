import express from "express";
import cors from "cors";
import "dotenv/config";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { pool } from "./db.js";
import { cifraPassword, verificaPassword, generaToken, richiedeAuth } from "./auth.js";
import { inviaEmailResetPassword } from "./email.js";
import { stripe, PREZZO_MENSILE_CENTESIMI } from "./stripe.js";
import { richiedeAbbonamentoAttivo, statoAbbonamentoDi } from "./abbonamento.js";
import { adminRouter, richiedeAdmin, eAdmin } from "./admin.js";
import {
  salvaFile, leggiFile, eliminaFile, eliminaFileInBlocco,
  archivioEsterno, descrizioneArchivio, QUOTA_AZIENDA_BYTE, TETTO_GLOBALE_BYTE,
} from "./archivio.js";
import { leggiFatturaXML, raggruppaPerDDT, riconosciFormatoFattura, estraiXMLdaP7M } from "./fatturaPA.js";
import { abbinaDDT, normalizzaNumero } from "./abbinamentoDDT.js";
import { leggiFatturaPDF, eUnPDF, estraiRighePDF } from "./fatturaPDF.js";
import { leggiScansione } from "./ddtDaScansione.js";
import { leggiTestoPagine, estraiPagina, contaPagine, MAX_PAGINE_SCANSIONE } from "./pdfScansione.js";
import {
  leggiFatturaConDocumentAI, documentAIConfigurato, descrizioneDocumentAI, consumiDelMese,
} from "./fatturaDocumentAI.js";

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

/**
 * Stato dell'abbonamento dell'azienda del token (esente / attivo / prova /
 * scaduto), più se quell'utente è amministratore.
 *
 * L'admin viaggia QUI e non su /api/stato per un motivo preciso: questa rotta è
 * protetta da richiedeAuth e basta, mentre /api/stato ha anche
 * richiedeAbbonamentoAttivo. Un admin con la prova scaduta da /api/stato non
 * riceverebbe nessuna risposta, quindi il flag non arriverebbe mai.
 *
 * Cosa succede DAVVERO oggi, per non lasciare qui una promessa che
 * l'interfaccia non mantiene: il flag arriva anche a prova scaduta, ma il
 * frontend, quando l'abbonamento è scaduto, rende soltanto PaginaAbbonamento —
 * niente barra laterale, niente voci di menù. Quindi un admin scaduto NON
 * vedrebbe il pannello, per quanto `admin` valga true. Il caso oggi non si
 * presenta perché l'unica email in EMAIL_ADMIN è anche in EMAIL_ESENTI
 * (abbonamento.js), quindi non viene mai bloccata.
 *
 * Se un giorno ci sarà un amministratore NON esente, la forma sensata non è
 * farlo passare oltre il blocco — la cornice dell'app si aprirebbe mentre tutte
 * le rotte dati continuano a rispondere 402, cioè schermate rotte. È che
 * PaginaAbbonamento, quando chi guarda è admin, offra una via d'ingresso al
 * solo pannello di amministrazione.
 */
app.get("/api/abbonamento/stato", richiedeAuth, async (req, res) => {
  try {
    const info = await statoAbbonamentoDi(req.aziendaId);
    if (!info) return res.status(404).json({ errore: "Azienda non trovata." });
    res.json({ ...info, admin: await eAdmin(req.aziendaId) });
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
            product_data: { name: "Abbonamento Commexa" },
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
    const [azRes, dipRes, comRes, regRes, matRes, allRes, spazio] = await Promise.all([
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
      // Solo i metadati dei documenti: il contenuto dei file si scarica a
      // parte, una richiesta per documento, quando serve davvero.
      pool.query(`${SELECT_ALLEGATI} WHERE azienda_id = $1 ORDER BY caricato_il DESC`, [aziendaId]),
      spazioAllegati(aziendaId),
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
      allegati: allRes.rows.map(mappaAllegato),
      spazioAllegati: spazio,
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
    // I documenti delle commesse che stanno per sparire vanno tolti anche
    // dall'archivio esterno: la cascata del database arriva alle righe, non ai
    // file su R2. Si annotano qui, si cancellano dopo il COMMIT (se la
    // transazione fallisse, i file devono restare al loro posto).
    const idCommesse = commesse.map((c) => String(c.id));
    const fileDaTogliere = (await client.query(
      `SELECT posizione, chiave_esterna FROM allegati
        WHERE azienda_id = $1 AND NOT (commessa_id = ANY($2::text[])) AND posizione <> 'database'`,
      [aziendaId, idCommesse]
    )).rows;

    await client.query(
      "DELETE FROM commesse WHERE azienda_id = $1 AND NOT (id = ANY($2::text[]))",
      [aziendaId, idCommesse]
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
    // Solo ora che il database è a posto si tolgono i file rimasti orfani.
    await eliminaFileInBlocco(fileDaTogliere);
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

/* ---------------------------------------------------------------------------
   ALLEGATI (DDT) — archivio dei documenti di una commessa.
   Qui il documento viene solo conservato e collegato: nessuna lettura del
   contenuto. Il file sta dentro Postgres perché il disco dei servizi Render
   free è effimero (si perderebbe a ogni riavvio); per non riempire il piano
   gratuito di Neon ci sono tre freni: dimensione del singolo file, quota per
   azienda e tetto complessivo su tutte le aziende.
--------------------------------------------------------------------------- */

// Il singolo documento resta comunque limitato: un DDT è una pagina o due, e
// un limite basso protegge memoria e tempi di caricamento. Quota per azienda e
// tetto complessivo arrivano invece da archivio.js, perché dipendono da dove
// finiscono i file (molto più larghi con l'archivio esterno).
const MAX_FILE_BYTE = 5 * 1024 * 1024;
/* Megabyte da mostrare all'utente, con il punto delle migliaia come nel resto
   dell'applicazione: la quota su R2 è di 3000 MB, e "3000 MB" senza separatore
   stonava dentro un messaggio d'errore. Serve solo per i testi (mai per un
   numero che il frontend debba ricalcolare). */
const fmtMBServer = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: "always" });
const inMB = (b) => fmtMBServer.format(Math.round((b / (1024 * 1024)) * 10) / 10);

// Colonne dei metadati: mai "contenuto", che pesa e serve solo allo scaricamento.
const COLONNE_ALLEGATO =
  `id, commessa_id, nome_file, tipo, dimensione, posizione, ddt_numero,
   to_char(ddt_data, 'YYYY-MM-DD') AS ddt_data, fornitore,
   to_char(caricato_il, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS caricato_il`;
const SELECT_ALLEGATI = `SELECT ${COLONNE_ALLEGATO} FROM allegati`;

const mappaAllegato = (r) => ({
  id: r.id,
  commessaId: r.commessa_id,
  nomeFile: r.nome_file,
  tipo: r.tipo,
  dimensione: Number(r.dimensione),
  posizione: r.posizione,
  // I tre dati del DDT sono FACOLTATIVI: vuoti per i documenti archiviati prima
  // che esistessero, e vuoti per chi non ha voglia di compilarli. Il frontend
  // li mostra solo se ci sono.
  ddtNumero: r.ddt_numero || "",
  ddtData: r.ddt_data || "",
  fornitore: r.fornitore || "",
  caricatoIl: r.caricato_il,
});

/**
 * Legge i tre dati facoltativi del DDT (numero, data, fornitore) da dove
 * arrivano — la query string al caricamento, il corpo JSON alla modifica.
 *
 * FACOLTATIVI vuol dire facoltativi: se non ci sono, si restituiscono vuoti e
 * il documento si archivia come si è sempre fatto. L'unica cosa che viene
 * rifiutata è una data scritta male, perché una data sbagliata in silenzio
 * farebbe poi sballare l'abbinamento senza che nessuno capisca perché.
 */
function leggiDatiDDT(fonte) {
  const pulisci = (v, max) => String(v ?? "").replace(new RegExp("[\\u0000-\\u001F]", "g"), " ").replace(/\s+/g, " ").trim().slice(0, max);
  const ddtNumero = pulisci(fonte?.ddtNumero, 60);
  const fornitore = pulisci(fonte?.fornitore, 200);
  const ddtData = pulisci(fonte?.ddtData, 10);
  if (ddtData && !/^\d{4}-\d{2}-\d{2}$/.test(ddtData)) {
    return { errore: "La data del DDT non è una data valida (serve nella forma AAAA-MM-GG), oppure lasciala vuota." };
  }
  return { dati: { ddtNumero, ddtData, fornitore } };
}

/**
 * Riconosce il tipo dai PRIMI BYTE del file, non dall'intestazione mandata dal
 * client: un'estensione o un Content-Type si scrivono a piacere, la firma del
 * formato no. Restituisce null se non è un tipo ammesso.
 */
function riconosciTipo(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf"; // %PDF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  return null;
}

/** Nome file ripulito: niente percorsi, niente caratteri di controllo, lunghezza limitata. */
function nomeFilePulito(grezzo) {
  let nome = "";
  try { nome = decodeURIComponent(String(grezzo || "")); } catch { nome = String(grezzo || ""); }
  // Via i separatori di percorso e i caratteri di controllo; il resto del
  // nome (trattini, spazi, accenti) resta com'è.
  nome = nome.replace(/[\\/\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return nome || "documento";
}

/** Legge il corpo grezzo della richiesta, traducendo in JSON gli errori del parser. */
const corpoGrezzo = express.raw({ type: () => true, limit: "6mb" });
const leggiCorpoFile = (req, res, next) =>
  corpoGrezzo(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({ errore: `Il file è troppo grande: il limite è ${inMB(MAX_FILE_BYTE)} MB.` });
    }
    console.error("Errore leggendo il file caricato:", err);
    res.status(400).json({ errore: "Impossibile leggere il file caricato." });
  });

/** Spazio occupato dagli allegati: della singola azienda e di tutte insieme. */
async function spazioAllegati(aziendaId) {
  const ris = await pool.query(
    `SELECT COALESCE(SUM(dimensione) FILTER (WHERE azienda_id = $1), 0)::bigint AS azienda,
            COALESCE(SUM(dimensione), 0)::bigint AS globale
       FROM allegati`,
    [aziendaId]
  );
  return {
    usatoAzienda: Number(ris.rows[0].azienda),
    usatoGlobale: Number(ris.rows[0].globale),
    quotaAzienda: QUOTA_AZIENDA_BYTE,
    maxFile: MAX_FILE_BYTE,
  };
}

/**
 * Carica un documento e lo allega a una commessa dell'azienda del token.
 *
 * Numero, data e fornitore del DDT arrivano dalla query string (il corpo della
 * richiesta è il file, byte per byte) e sono TUTTI FACOLTATIVI: senza di loro
 * il documento si archivia esattamente come prima, si perde solo la possibilità
 * di riconoscerlo da solo quando arriverà la fattura.
 */
app.post("/api/commesse/:id/allegati", richiedeAuth, richiedeAbbonamentoAttivo, leggiCorpoFile, async (req, res) => {
  const commessaId = String(req.params.id);
  const contenuto = Buffer.isBuffer(req.body) ? req.body : null;

  const { dati: ddt, errore: erroreDDT } = leggiDatiDDT(req.query);
  if (erroreDDT) return res.status(400).json({ errore: erroreDDT });

  if (!contenuto || contenuto.length === 0) return res.status(400).json({ errore: "Nessun file ricevuto." });
  if (contenuto.length > MAX_FILE_BYTE) {
    return res.status(413).json({ errore: `Il file è troppo grande: il limite è ${inMB(MAX_FILE_BYTE)} MB.` });
  }
  const tipo = riconosciTipo(contenuto);
  if (!tipo) return res.status(415).json({ errore: "Tipo di file non ammesso: si possono allegare solo PDF, JPG e PNG." });

  try {
    const com = await pool.query("SELECT 1 FROM commesse WHERE id = $1 AND azienda_id = $2", [commessaId, req.aziendaId]);
    if (com.rows.length === 0) return res.status(404).json({ errore: "Commessa non trovata." });

    const spazio = await spazioAllegati(req.aziendaId);
    if (spazio.usatoAzienda + contenuto.length > QUOTA_AZIENDA_BYTE) {
      return res.status(507).json({
        errore: `Spazio esaurito: i documenti occupano ${inMB(spazio.usatoAzienda)} MB dei ${inMB(QUOTA_AZIENDA_BYTE)} MB disponibili. Elimina qualche documento prima di caricarne altri.`,
      });
    }
    if (spazio.usatoGlobale + contenuto.length > TETTO_GLOBALE_BYTE) {
      return res.status(507).json({ errore: "Archivio documenti pieno: contatta l'assistenza." });
    }

    // Prima il file va nell'archivio (database o R2), poi si scrive la riga:
    // se il caricamento fallisce non resta una riga che punta al nulla.
    const id = randomUUID();
    const salvato = await salvaFile({ aziendaId: req.aziendaId, id, contenuto, tipo });

    try {
      const ris = await pool.query(
        `INSERT INTO allegati (id, azienda_id, commessa_id, nome_file, tipo, dimensione, posizione, contenuto, chiave_esterna,
                               ddt_numero, ddt_data, fornitore)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, '')::date, $12)
         RETURNING ${COLONNE_ALLEGATO}`,
        [id, req.aziendaId, commessaId, nomeFilePulito(req.headers["x-nome-file"]), tipo, contenuto.length,
         salvato.posizione, salvato.contenuto, salvato.chiaveEsterna,
         ddt.ddtNumero, ddt.ddtData, ddt.fornitore]
      );
      res.status(201).json({ allegato: mappaAllegato(ris.rows[0]), spazio: await spazioAllegati(req.aziendaId) });
    } catch (e) {
      // La riga non è stata scritta: si toglie anche il file, altrimenti
      // resterebbe nell'archivio senza che nessuno sappia più che esiste.
      await eliminaFileInBlocco([{ posizione: salvato.posizione, chiave_esterna: salvato.chiaveEsterna }]);
      throw e;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile salvare il documento." });
  }
});

/** Elenco dei documenti dell'azienda del token, eventualmente di una sola commessa. */
app.get("/api/allegati", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const commessaId = req.query.commessaId ? String(req.query.commessaId) : null;
  try {
    const ris = commessaId
      ? await pool.query(`${SELECT_ALLEGATI} WHERE azienda_id = $1 AND commessa_id = $2 ORDER BY caricato_il DESC`, [req.aziendaId, commessaId])
      : await pool.query(`${SELECT_ALLEGATI} WHERE azienda_id = $1 ORDER BY caricato_il DESC`, [req.aziendaId]);
    res.json({ allegati: ris.rows.map(mappaAllegato), spazio: await spazioAllegati(req.aziendaId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere i documenti." });
  }
});

/**
 * Aggiorna SOLO i tre dati del DDT (numero, data, fornitore) di un documento
 * già archiviato. Il file non si tocca: resta dov'è, con la stessa chiave.
 *
 * Perché serve. I documenti archiviati prima di questa funzione hanno i tre
 * campi vuoti, e senza numero non partecipano all'abbinamento automatico.
 * Poterli completare dopo, senza ricaricare il file, è ciò che rende utile
 * l'archivio che c'è già invece di chiedere di ricominciare da capo.
 */
app.patch("/api/allegati/:id", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const { dati: ddt, errore } = leggiDatiDDT(req.body || {});
  if (errore) return res.status(400).json({ errore });

  try {
    const ris = await pool.query(
      `UPDATE allegati SET ddt_numero = $3, ddt_data = NULLIF($4, '')::date, fornitore = $5
        WHERE id = $1 AND azienda_id = $2
        RETURNING ${COLONNE_ALLEGATO}`,
      [String(req.params.id), req.aziendaId, ddt.ddtNumero, ddt.ddtData, ddt.fornitore]
    );
    if (ris.rows.length === 0) return res.status(404).json({ errore: "Documento non trovato." });
    res.json({ allegato: mappaAllegato(ris.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile aggiornare i dati del documento." });
  }
});

/**
 * I fornitori già visti da questa azienda: nelle fatture importate, nei
 * materiali inseriti e nei DDT archiviati.
 *
 * Serve solo a riempire la tendina del campo "Fornitore" quando si archivia un
 * DDT: scegliere da un elenco è più veloce che riscrivere "EPIÙ MATERIALI
 * EDILI S.R.L." ogni volta, e soprattutto lo scrive sempre allo stesso modo,
 * che è quello che poi fa combaciare l'abbinamento. Il campo resta comunque
 * libero: la tendina suggerisce, non obbliga.
 */
/* ===========================================================================
   DDT DA SCANSIONE — un blocco di documenti in un PDF solo
   ===========================================================================
   Un blocco di DDT si scansiona tutto insieme: un file, molte pagine, ogni
   pagina il documento di una commessa diversa. Prima si poteva archiviare solo
   un file per commessa, quindi tutte le pagine finivano sotto la stessa —
   tutte sbagliate tranne una.
   Il flusso ha due tempi. Qui c'è il primo: si legge e si RIFERISCE, senza
   archiviare niente. Il secondo (la conferma) archivia pagina per pagina.
=========================================================================== */

/** Il corpo di una scansione è molto più grande di un documento singolo: un
 *  blocco di venti pagine passa i 5 MB con facilità. */
const MAX_SCANSIONE_BYTE = 25 * 1024 * 1024;
const corpoScansione = express.raw({ type: () => true, limit: "26mb" });
const leggiCorpoScansione = (req, res, next) =>
  corpoScansione(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({ errore: `La scansione è troppo grande: il limite è ${inMB(MAX_SCANSIONE_BYTE)} MB.` });
    }
    console.error("Errore leggendo la scansione caricata:", err);
    res.status(400).json({ errore: "Impossibile leggere il file caricato." });
  });

/** Le scansioni in sosta scadono: una lasciata a metà non resta lì per sempre. */
const ORE_SOSTA_SCANSIONE = 24;
async function ripulisciScansioniVecchie(aziendaId) {
  const vecchie = await pool.query(
    `DELETE FROM scansioni
      WHERE azienda_id = $1 AND caricata_il < now() - ($2 || ' hours')::interval
      RETURNING id, posizione, chiave_esterna`,
    [aziendaId, String(ORE_SOSTA_SCANSIONE)]
  );
  if (vecchie.rows.length > 0) await eliminaFileInBlocco(vecchie.rows);
}

/**
 * Primo tempo: leggi la scansione e dimmi cosa hai capito.
 *
 * NON archivia niente. Il PDF va in sosta (tabella `scansioni`, che non è
 * l'archivio) e torna indietro un piano: una riga per pagina, con commessa e
 * numero già compilati dove si è capito, e il motivo scritto dove non si è
 * capito. Chi guarda corregge, e solo allora conferma.
 *
 * La lettura NON è un OCR: la casella che identifica il DDT è testo digitale
 * vero dentro il PDF. Nessun costo a pagina, nessun Document AI.
 */
app.post("/api/ddt/scansione", richiedeAuth, richiedeAbbonamentoAttivo, leggiCorpoScansione, async (req, res) => {
  const contenuto = Buffer.isBuffer(req.body) ? req.body : null;
  if (!contenuto || contenuto.length === 0) return res.status(400).json({ errore: "Nessun file ricevuto." });
  if (contenuto.length > MAX_SCANSIONE_BYTE) {
    return res.status(413).json({ errore: `La scansione è troppo grande: il limite è ${inMB(MAX_SCANSIONE_BYTE)} MB.` });
  }
  if (riconosciTipo(contenuto) !== "application/pdf") {
    return res.status(415).json({ errore: "Una scansione di DDT dev'essere un PDF: le foto singole si allegano dalla commessa." });
  }

  try {
    /* Si legge PRIMA di scrivere qualunque cosa: se il PDF è illeggibile o ha
       troppe pagine, non resta niente in sosta da ripulire. */
    const pagineTotali = await contaPagine(contenuto);
    if (pagineTotali > MAX_PAGINE_SCANSIONE) {
      return res.status(413).json({
        errore: `Il PDF ha ${pagineTotali} pagine: il massimo per una scansione è ${MAX_PAGINE_SCANSIONE}. Dividilo in blocchi più piccoli.`,
      });
    }

    const pagine = await leggiTestoPagine(contenuto);

    const [commesse, numeriInArchivio] = await Promise.all([
      pool.query("SELECT id, codice, descrizione FROM commesse WHERE azienda_id = $1", [req.aziendaId]),
      pool.query("SELECT DISTINCT ddt_numero FROM allegati WHERE azienda_id = $1 AND ddt_numero <> ''", [req.aziendaId]),
    ]);

    const righe = leggiScansione({
      pagine,
      commesse: commesse.rows,
      giaInArchivio: numeriInArchivio.rows.map((r) => r.ddt_numero),
    });

    /* Il codice della commessa risolta viaggia con la riga: la schermata deve
       poterlo mostrare senza rifare la ricerca, e senza fidarsi di quello letto
       dal PDF, che può essere scritto in minuscolo o con spazi. */
    const perId = new Map(commesse.rows.map((c) => [c.id, c]));
    const conCodice = righe.map((r) => ({
      ...r,
      commessaCodice: r.commessaId ? perId.get(r.commessaId)?.codice ?? null : null,
    }));

    const spazio = await spazioAllegati(req.aziendaId);
    if (spazio.usatoAzienda + contenuto.length > QUOTA_AZIENDA_BYTE) {
      return res.status(507).json({
        errore: `Spazio esaurito: i documenti occupano ${inMB(spazio.usatoAzienda)} MB dei ${inMB(QUOTA_AZIENDA_BYTE)} MB disponibili.`,
      });
    }

    await ripulisciScansioniVecchie(req.aziendaId);

    const id = randomUUID();
    const salvato = await salvaFile({ aziendaId: req.aziendaId, id, contenuto, tipo: "application/pdf" });
    try {
      await pool.query(
        `INSERT INTO scansioni (id, azienda_id, nome_file, dimensione, posizione, contenuto, chiave_esterna, pagine)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, req.aziendaId, nomeFilePulito(req.headers["x-nome-file"]), contenuto.length,
         salvato.posizione, salvato.contenuto, salvato.chiaveEsterna, pagineTotali]
      );
    } catch (e) {
      await eliminaFile({ posizione: salvato.posizione, chiave_esterna: salvato.chiaveEsterna });
      throw e;
    }

    res.status(201).json({
      scansione: { id, nomeFile: nomeFilePulito(req.headers["x-nome-file"]), pagine: pagineTotali },
      righe: conCodice,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ errore: e.message || "Impossibile leggere la scansione." });
  }
});

/**
 * Secondo tempo: archivia le pagine approvate, una per una.
 *
 * Riceve le righe che la persona ha confermato. Per ognuna estrae la sua pagina
 * dal PDF in sosta, la salva come documento a sé e scrive la riga in archivio,
 * con la commessa che le è stata assegnata.
 *
 * OGNI PAGINA VA PER CONTO SUO, e questa è la decisione che conta. Se la terza
 * fallisce — la rete cade, lo spazio finisce — le prime due RESTANO
 * archiviate, e la risposta dice esattamente quali sono passate e quali no.
 * Annullare tutto sembrerebbe più pulito, ma costringerebbe a rifare da capo un
 * blocco di venti pagine per colpa dell'ultima: su un lavoro che si fa a fine
 * mese, di fretta, è il modo migliore per farlo abbandonare a metà.
 *
 * SI PUÒ RIFARE. La scansione in sosta non viene cancellata qui: resta fino
 * alle 24 ore, così chi ha sistemato le righe rimaste indietro conferma di
 * nuovo senza ricaricare il file. Una pagina già archiviata da questa stessa
 * scansione viene saltata invece di sdoppiarsi: la coppia nome del file +
 * numero di pagina è la chiave naturale che lo impedisce.
 */
app.post("/api/ddt/scansione/:id/conferma", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const scansioneId = String(req.params.id);
  const richieste = Array.isArray(req.body?.righe) ? req.body.righe : null;
  if (!richieste || richieste.length === 0) {
    return res.status(400).json({ errore: "Nessuna pagina da archiviare." });
  }

  try {
    const sos = await pool.query(
      "SELECT id, nome_file, posizione, contenuto, chiave_esterna, pagine FROM scansioni WHERE id = $1 AND azienda_id = $2",
      [scansioneId, req.aziendaId]
    );
    if (sos.rows.length === 0) {
      return res.status(404).json({ errore: "Scansione non trovata: potrebbe essere scaduta. Ricarica il file." });
    }
    const scansione = sos.rows[0];
    const sorgente = await leggiFile(scansione);
    if (!sorgente) return res.status(410).json({ errore: "Il file della scansione non è più disponibile: ricaricalo." });

    const commesse = await pool.query("SELECT id, codice FROM commesse WHERE azienda_id = $1", [req.aziendaId]);
    const commessePerId = new Map(commesse.rows.map((c) => [c.id, c]));

    const archiviate = [];
    const saltate = [];

    for (const riga of richieste) {
      const numeroPagina = Number(riga?.numeroPagina);
      const salta = (motivo) => saltate.push({ numeroPagina: riga?.numeroPagina ?? null, motivo });

      if (!Number.isInteger(numeroPagina) || numeroPagina < 1 || numeroPagina > scansione.pagine) {
        salta("numero di pagina non valido"); continue;
      }
      if (!riga?.commessaId || !commessePerId.has(riga.commessaId)) {
        salta("la commessa non è stata scelta, o non esiste"); continue;
      }
      const { dati: ddt, errore: erroreDDT } = leggiDatiDDT(riga);
      if (erroreDDT) { salta(erroreDDT); continue; }
      if (!ddt.ddtNumero) { salta("manca il numero del DDT"); continue; }

      /* Già archiviata da questa stessa scansione: si salta invece di
         sdoppiarla. Succede quando si conferma due volte dopo aver sistemato
         solo le righe rimaste indietro. */
      const gia = await pool.query(
        "SELECT 1 FROM allegati WHERE azienda_id = $1 AND origine_nome_file = $2 AND origine_pagina = $3",
        [req.aziendaId, scansione.nome_file, numeroPagina]
      );
      if (gia.rows.length > 0) { salta("questa pagina era già stata archiviata"); continue; }

      let salvato = null;
      try {
        const pagina = await estraiPagina(sorgente, numeroPagina);

        const spazio = await spazioAllegati(req.aziendaId);
        if (spazio.usatoAzienda + pagina.length > QUOTA_AZIENDA_BYTE) {
          salta(`spazio esaurito: i documenti occupano ${inMB(spazio.usatoAzienda)} MB dei ${inMB(QUOTA_AZIENDA_BYTE)} MB`);
          continue;
        }
        if (spazio.usatoGlobale + pagina.length > TETTO_GLOBALE_BYTE) {
          salta("archivio documenti pieno: contatta l'assistenza"); continue;
        }

        const id = randomUUID();
        salvato = await salvaFile({ aziendaId: req.aziendaId, id, contenuto: pagina, tipo: "application/pdf" });

        /* Il nome del documento archiviato dice da dove viene: chi lo trova in
           una commessa fra sei mesi deve poter risalire al foglio. */
        const nome = `${scansione.nome_file.replace(/\.pdf$/i, "")} — p. ${numeroPagina}.pdf`;

        const ris = await pool.query(
          `INSERT INTO allegati (id, azienda_id, commessa_id, nome_file, tipo, dimensione, posizione, contenuto, chiave_esterna,
                                 ddt_numero, ddt_data, fornitore, origine_nome_file, origine_pagina)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, '')::date, $12, $13, $14)
           RETURNING ${COLONNE_ALLEGATO}`,
          [id, req.aziendaId, riga.commessaId, nome, "application/pdf", pagina.length,
           salvato.posizione, salvato.contenuto, salvato.chiaveEsterna,
           ddt.ddtNumero, ddt.ddtData, ddt.fornitore, scansione.nome_file, numeroPagina]
        );
        archiviate.push({ numeroPagina, allegato: mappaAllegato(ris.rows[0]) });
      } catch (e) {
        /* Il file può essere già finito nell'archivio prima che la riga
           fallisse: si toglie, altrimenti resta un file che nessuno sa di avere. */
        if (salvato) {
          try { await eliminaFile({ posizione: salvato.posizione, chiave_esterna: salvato.chiaveEsterna }); } catch { /* meglio un file orfano che una risposta persa */ }
        }
        console.error("Pagina non archiviata:", numeroPagina, e);
        salta(e.message || "errore durante l'archiviazione");
      }
    }

    res.status(archiviate.length > 0 ? 201 : 400).json({
      archiviate, saltate,
      spazio: await spazioAllegati(req.aziendaId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile archiviare le pagine della scansione." });
  }
});

app.get("/api/fornitori", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  try {
    const ris = await pool.query(
      `SELECT nome FROM (
                SELECT DISTINCT fornitore AS nome FROM fatture   WHERE azienda_id = $1 AND fornitore <> ''
         UNION  SELECT DISTINCT fornitore AS nome FROM allegati  WHERE azienda_id = $1 AND fornitore <> ''
         UNION  SELECT DISTINCT fornitore AS nome FROM materiali WHERE azienda_id = $1 AND fornitore <> ''
       ) AS tutti ORDER BY nome LIMIT 300`,
      [req.aziendaId]
    );
    res.json({ fornitori: ris.rows.map((r) => r.nome) });
  } catch (e) {
    console.error(e);
    // Una tendina vuota non è un errore da mostrare: il campo si scrive a mano.
    res.json({ fornitori: [] });
  }
});

/**
 * Scarica il file. Richiede il token come ogni altra rotta: il frontend lo
 * legge con fetch e lo apre da una URL locale al browser, così il documento
 * non è mai raggiungibile da un indirizzo pubblico.
 */
app.get("/api/allegati/:id", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  try {
    const ris = await pool.query(
      "SELECT nome_file, tipo, dimensione, posizione, contenuto, chiave_esterna FROM allegati WHERE id = $1 AND azienda_id = $2",
      [String(req.params.id), req.aziendaId]
    );
    const riga = ris.rows[0];
    if (!riga) return res.status(404).json({ errore: "Documento non trovato." });

    const contenuto = await leggiFile(riga);
    res.setHeader("Content-Type", riga.tipo);
    res.setHeader("Content-Length", contenuto.length);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(riga.nome_file)}`);
    res.send(contenuto);
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile aprire il documento." });
  }
});

/** Elimina un documento dell'azienda del token. */
app.delete("/api/allegati/:id", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  try {
    const ris = await pool.query(
      "SELECT id, posizione, chiave_esterna FROM allegati WHERE id = $1 AND azienda_id = $2",
      [String(req.params.id), req.aziendaId]
    );
    const riga = ris.rows[0];
    if (!riga) return res.status(404).json({ errore: "Documento non trovato." });

    // Prima il file, poi la riga: se il file non si riesce a togliere, la riga
    // resta e il documento è ancora scaricabile, invece di sparire dall'elenco
    // lasciando un file abbandonato che occupa spazio per sempre.
    await eliminaFile(riga);
    await pool.query("DELETE FROM allegati WHERE id = $1 AND azienda_id = $2", [riga.id, req.aziendaId]);
    res.json({ ok: true, id: riga.id, spazio: await spazioAllegati(req.aziendaId) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile eliminare il documento." });
  }
});

/* ---------------------------------------------------------------------------
   FATTURE ELETTRONICHE (FatturaPA) — lettura delle righe e importazione.
   Il caricamento NON scrive nulla nei costi: legge, conserva il file e
   restituisce le righe. I materiali entrano nei conti solo dopo che l'utente
   ha assegnato le commesse e confermato (rotta /importa).
--------------------------------------------------------------------------- */

// Gli XML sono piccoli; un PDF di fattura sta in qualche centinaio di kB, ma
// una scansione a colori può arrivare a qualche MB: 10 MB copre tutto.
const MAX_FATTURA_BYTE = 10 * 1024 * 1024;

const corpoFattura = express.raw({ type: () => true, limit: "11mb" });
const leggiCorpoFattura = (req, res, next) =>
  corpoFattura(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({ errore: `Il file è troppo grande: il limite è ${inMB(MAX_FATTURA_BYTE)} MB.` });
    }
    console.error("Errore leggendo la fattura caricata:", err);
    res.status(400).json({ errore: "Impossibile leggere il file caricato." });
  });

const mappaFattura = (r) => ({
  id: r.id,
  nomeFile: r.nome_file,
  fornitore: r.fornitore,
  partitaIVA: r.partita_iva,
  numero: r.numero,
  data: r.data,
  dimensione: Number(r.dimensione),
  caricataIl: r.caricata_il,
  importataIl: r.importata_il,
  righeImportate: Number(r.righe_importate),
});

/**
 * ABBINAMENTO DEI GRUPPI-DDT DELLA FATTURA AI DDT ARCHIVIATI.
 *
 * Qui si legge solo: la funzione non scrive niente e non importa niente.
 * Restituisce delle PROPOSTE, e l'unica strada per cui un costo entra nei conti
 * resta la conferma dell'utente su /api/fatture/:id/importa.
 *
 * ISOLAMENTO PER AZIENDA. Il filtro "a.azienda_id = $1" nella query è l'unico
 * punto in cui si scelgono i documenti da confrontare: alla logica di
 * abbinamento arrivano soltanto i DDT di questa azienda, e non ha modo di
 * vederne altri nemmeno volendo.
 *
 * Due strade, in ordine di forza:
 *   1. i dati del DDT scritti in archivio (numero, data, fornitore) — è la
 *      strada buona, l'unica che può arrivare a un abbinamento "forte";
 *   2. il numero che compare nel NOME DEL FILE — la vecchia strada, tenuta per
 *      i documenti archiviati prima che i tre campi esistessero. Vale sempre e
 *      solo come indizio "debole": un numero dentro un nome file non è una prova.
 */
async function abbinamentiDaDDT(aziendaId, { riferimenti, fornitore }) {
  const daCercare = (riferimenti || []).filter((r) => r?.ddtNumero);
  if (daCercare.length === 0) return [];

  const ris = await pool.query(
    /* L'ORDER BY non è pignoleria: senza, a parità di candidati l'abbinamento
       proponeva la commessa che il database restituiva per prima, e quella non
       è stabile. La logica adesso i pari merito li riconosce e non sceglie, ma
       un ordine fisso resta la rete sotto: stessa fattura, stesso archivio,
       stessa risposta, sempre. `id` in coda perché sia un ordine totale. */
    `SELECT a.id, a.nome_file, a.commessa_id, a.ddt_numero,
            to_char(a.ddt_data, 'YYYY-MM-DD') AS ddt_data, a.fornitore,
            c.codice, c.descrizione
       FROM allegati a JOIN commesse c ON c.id = a.commessa_id
      WHERE a.azienda_id = $1
      ORDER BY a.ddt_data NULLS LAST, a.nome_file, a.id`,
    [aziendaId]
  );

  const archiviati = ris.rows.map((r) => ({
    id: r.id,
    commessaId: r.commessa_id,
    commessaCodice: r.codice,
    commessaDescrizione: r.descrizione,
    nomeFile: r.nome_file,
    ddtNumero: r.ddt_numero || "",
    ddtData: r.ddt_data || "",
    fornitore: r.fornitore || "",
  }));

  const esiti = abbinaDDT({ riferimenti: daCercare, fornitore, archiviati });

  // Ripiego per i numeri rimasti senza niente: il vecchio confronto sul nome
  // del file. Serve ai DDT archiviati prima, che hanno i campi vuoti.
  const trovati = new Set(esiti.map((e) => normalizzaNumero(e.ddtNumero)));
  for (const rif of daCercare) {
    const numero = String(rif.ddtNumero);
    if (trovati.has(normalizzaNumero(numero))) continue;
    trovati.add(normalizzaNumero(numero));

    // Il numero deve comparire come parola a sé: "4711" non deve agganciare "147110".
    const espressione = new RegExp(`(^|[^0-9])${numero.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`);
    const trovato = archiviati.find((a) => espressione.test(a.nomeFile));
    if (trovato) {
      esiti.push({
        ddtNumero: numero,
        forza: "debole",
        commessaId: trovato.commessaId,
        commessaCodice: trovato.commessaCodice,
        commessaDescrizione: trovato.commessaDescrizione,
        motivo: `il numero compare nel nome del file "${trovato.nomeFile}", ma quel documento non ha i dati del DDT compilati`,
        allegato: { id: trovato.id, nomeFile: trovato.nomeFile, ddtNumero: trovato.ddtNumero, ddtData: trovato.ddtData, fornitore: trovato.fornitore },
      });
    }
  }
  return esiti;
}

/**
 * Legge un PDF scegliendo il lettore migliore disponibile, e ripiegando con
 * garbo se quello migliore non c'è o non risponde.
 *
 *   1. Document AI, se configurato: legge anche le scansioni e riconosce le
 *      righe molto meglio.
 *   2. Riconoscimento testuale di base: gratuito, funziona sui PDF con testo.
 *
 * Non fallisce mai per colpa di Document AI: se qualcosa va storto si torna
 * al lettore di base e si dice all'utente cos'è successo, invece di
 * lasciarlo davanti a un errore.
 */
/**
 * Riduce l'errore di Google a una frase leggibile. I casi che capitano
 * davvero hanno un messaggio proprio: gli altri vengono accorciati.
 */
function riassumiErrore(e) {
  const testo = String(e?.message || "motivo sconosciuto");
  if (/billing/i.test(testo)) return "la fatturazione non è attiva sul progetto Google";
  if (/PERMISSION_DENIED|403/i.test(testo)) return "permessi mancanti sul progetto Google";
  if (/NOT_FOUND|404/i.test(testo)) return "processore non trovato: controlla id e regione";
  if (/UNAUTHENTICATED|401/i.test(testo)) return "credenziali non valide";
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(testo)) return "quota Google esaurita";
  if (/tetto mensile/i.test(testo)) return testo;   // è già un messaggio nostro
  if (/pagine/i.test(testo) && /limite/i.test(testo)) return testo;
  if (/DEADLINE|timeout|ETIMEDOUT|ENOTFOUND|ECONNRESET/i.test(testo)) return "il servizio non ha risposto in tempo";
  return testo.length > 120 ? testo.slice(0, 117) + "…" : testo;
}

async function leggiPDF(contenuto) {
  if (!documentAIConfigurato) {
    const base = await leggiFatturaPDF(contenuto);
    if (!base.scansione) {
      base.avvisi.push("La lettura avanzata (Document AI) non è configurata: ho usato il riconoscimento di base, quindi controlla i valori con attenzione.");
    }
    return base;
  }

  let pagineStimate = null;
  try {
    pagineStimate = (await estraiRighePDF(contenuto)).pagine;
  } catch {
    // Se non si riesce nemmeno a contare le pagine si prosegue lo stesso:
    // sarà Document AI a dire se il documento è troppo lungo.
  }

  try {
    return await leggiFatturaConDocumentAI(contenuto, { pagineStimate });
  } catch (e) {
    // Il motivo tecnico completo va nei log; all'utente si dice l'essenziale,
    // altrimenti si ritrova in faccia mezza pagina di errore di Google.
    console.error("Document AI non utilizzabile:", e.message);
    const base = await leggiFatturaPDF(contenuto);
    const motivo = riassumiErrore(e);
    if (base.scansione) {
      // Senza Document AI una scansione resta illeggibile: si spiega perché.
      base.avvisi = [`Non sono riuscito a usare la lettura avanzata (${motivo}), e questo PDF è una scansione: senza quella non c'è testo da leggere. Puoi inserire i materiali a mano, oppure caricare la fattura in XML. Il file resta comunque archiviato.`];
    } else {
      base.avvisi.push(`Non sono riuscito a usare la lettura avanzata (${motivo}): ho letto il PDF con il riconoscimento di base, controlla i valori con attenzione.`);
    }
    return base;
  }
}

/** Carica una fattura XML/P7M, la conserva e restituisce le righe lette. */
app.post("/api/fatture", richiedeAuth, richiedeAbbonamentoAttivo, leggiCorpoFattura, async (req, res) => {
  const contenuto = Buffer.isBuffer(req.body) ? req.body : null;
  if (!contenuto || contenuto.length === 0) return res.status(400).json({ errore: "Nessun file ricevuto." });
  if (contenuto.length > MAX_FATTURA_BYTE) {
    return res.status(413).json({ errore: `Il file è troppo grande: il limite è ${inMB(MAX_FATTURA_BYTE)} MB.` });
  }

  // Il PDF è il piano B: si usa quando l'XML non c'è. La lettura dell'XML
  // resta esattamente quella di prima, questo è un ramo separato.
  const pdf = eUnPDF(contenuto);
  const formato = pdf ? "pdf" : riconosciFormatoFattura(contenuto);
  if (!formato) {
    return res.status(415).json({
      errore: "Questo file non è una fattura: servono un XML FatturaPA (.xml), la sua versione firmata (.xml.p7m) oppure un PDF.",
    });
  }

  let xml = contenuto;
  if (formato === "p7m") {
    xml = estraiXMLdaP7M(contenuto);
    if (!xml) {
      return res.status(415).json({ errore: "Il file è firmato (.p7m) ma non contiene una fattura XML leggibile." });
    }
  }

  let lettura;
  try {
    if (formato === "pdf") {
      lettura = await leggiPDF(contenuto);
      lettura.gruppi = raggruppaPerDDT(lettura.righe);
    } else {
      try {
        lettura = leggiFatturaXML(xml);
      } catch (primoTentativo) {
        // Il file sembrava un XML ma non si legge: può essere un involucro con
        // l'XML dentro (capita con certe firme). Si prova a estrarlo prima di
        // arrendersi; se non si trova nulla, vale l'errore originale.
        const dentro = formato === "xml" ? estraiXMLdaP7M(contenuto) : null;
        if (!dentro) throw primoTentativo;
        xml = dentro;
        lettura = leggiFatturaXML(xml);
      }
      lettura.gruppi = raggruppaPerDDT(lettura.righe);
    }
    // Da dove vengono i dati: l'XML è esatto, il PDF è interpretato. Il
    // frontend lo dice all'utente, che sui PDF deve guardare meglio.
    // Il lettore PDF può aver già dichiarato "documentai": non si sovrascrive.
    lettura.origine = lettura.origine || (formato === "pdf" ? "pdf" : "xml");
    lettura.scansione = lettura.scansione === true;
  } catch (e) {
    // Errore di lettura: si risponde con il motivo, senza conservare nulla.
    return res.status(422).json({ errore: e.message });
  }

  const id = randomUUID();
  const documento = lettura.documenti[0] || {};
  try {
    const tipoFile = formato === "pdf" ? "application/pdf"
      : formato === "p7m" ? "application/pkcs7-mime"
      : "application/xml";
    const salvato = await salvaFile({ aziendaId: req.aziendaId, id, contenuto, tipo: tipoFile });
    const ris = await pool.query(
      `INSERT INTO fatture (id, azienda_id, nome_file, tipo, dimensione, posizione, contenuto, chiave_esterna,
                            fornitore, partita_iva, numero, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12, '')::date)
       RETURNING id, nome_file, fornitore, partita_iva, numero, to_char(data, 'YYYY-MM-DD') AS data,
                 dimensione, caricata_il, importata_il, righe_importate`,
      [id, req.aziendaId, nomeFilePulito(req.headers["x-nome-file"]), tipoFile,
       contenuto.length, salvato.posizione, salvato.contenuto, salvato.chiaveEsterna,
       lettura.fornitore.denominazione, lettura.fornitore.partitaIVA, documento.numero || "", documento.data || ""]
    );

    // Una fattura con lo stesso fornitore e numero è già stata importata?
    // Non si blocca: si avvisa, perché può capitare di doverla rifare.
    const gemella = await pool.query(
      `SELECT to_char(importata_il, 'DD/MM/YYYY') AS quando, righe_importate FROM fatture
        WHERE azienda_id = $1 AND id <> $2 AND numero = $3 AND partita_iva = $4 AND importata_il IS NOT NULL
        ORDER BY importata_il DESC LIMIT 1`,
      [req.aziendaId, id, documento.numero || "", lettura.fornitore.partitaIVA]
    );
    const avvisi = [...lettura.avvisi];
    if (gemella.rows[0]) {
      avvisi.unshift(`Attenzione: la fattura ${documento.numero} di questo fornitore risulta già importata il ${gemella.rows[0].quando} (${gemella.rows[0].righe_importate} righe). Importandola di nuovo i costi verrebbero contati due volte.`);
    }

    // Gli abbinamenti si cercano sui GRUPPI (un DDT = un gruppo di righe), col
    // fornitore della fattura: è lo stesso per tutte le sue righe.
    const abbinamenti = await abbinamentiDaDDT(req.aziendaId, {
      riferimenti: lettura.gruppi.map((g) => ({ ddtNumero: g.ddtNumero, ddtData: g.ddtData })),
      fornitore: lettura.fornitore.denominazione,
    });

    res.status(201).json({
      fattura: mappaFattura(ris.rows[0]),
      lettura: { ...lettura, avvisi },
      abbinamenti,
      // Vecchio nome, vecchia forma: serve solo perché una versione del
      // frontend già pubblicata continui a funzionare mentre il nuovo va in
      // linea. Si può togliere quando il frontend nuovo è dappertutto.
      // Gli abbinamenti ambigui non ci entrano: in questa forma non esiste il
      // modo di dire "sono in due, scegli tu", e un client vecchio leggerebbe
      // una commessa nulla. Non ricevendo niente si comporta come sempre —
      // assegnazione a mano, che è la risposta giusta per quel caso.
      suggerimenti: abbinamenti.filter((a) => a.commessaId).map((a) => ({
        ddtNumero: a.ddtNumero, commessaId: a.commessaId,
        commessaCodice: a.commessaCodice, nomeFile: a.allegato?.nomeFile || "",
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile conservare la fattura." });
  }
});

/**
 * Conferma: le righe assegnate a una commessa diventano voci di materiale.
 * È il primo momento in cui i numeri entrano nei conti. Tutto in una
 * transazione: o entrano tutte le righe, o nessuna.
 */
app.post("/api/fatture/:id/importa", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  const fatturaId = String(req.params.id);
  const righe = req.body?.righe;
  if (!Array.isArray(righe) || righe.length === 0) {
    return res.status(400).json({ errore: "Nessuna riga da importare." });
  }

  const client = await pool.connect();
  try {
    const fat = await client.query("SELECT id, fornitore FROM fatture WHERE id = $1 AND azienda_id = $2", [fatturaId, req.aziendaId]);
    if (fat.rows.length === 0) return res.status(404).json({ errore: "Fattura non trovata." });
    const fornitore = fat.rows[0].fornitore;

    await client.query("BEGIN");
    const creati = [];
    for (const riga of righe) {
      const commessaId = String(riga?.commessaId ?? "");
      if (!commessaId) {
        throw Object.assign(new Error("Ogni riga da importare deve avere una commessa."), { codice: 400 });
      }
      const { voce, errore } = leggiVoceMateriale({
        data: riga?.data,
        fornitore: riga?.fornitore ?? fornitore,
        descrizione: riga?.descrizione,
        quantita: riga?.quantita,
        prezzoUnitario: riga?.prezzoUnitario,
      });
      if (errore) {
        throw Object.assign(new Error(`Riga "${String(riga?.descrizione ?? "").slice(0, 40)}": ${errore}`), { codice: 400 });
      }

      const ins = await client.query(
        `INSERT INTO materiali (id, azienda_id, commessa_id, data, fornitore, descrizione, quantita, prezzo_unitario, fattura_id)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
          WHERE EXISTS (SELECT 1 FROM commesse WHERE id = $3 AND azienda_id = $2)
         RETURNING id, commessa_id, to_char(data, 'YYYY-MM-DD') AS data, fornitore, descrizione, quantita, prezzo_unitario, costo`,
        [randomUUID(), req.aziendaId, commessaId, voce.data, voce.fornitore, voce.descrizione, voce.quantita, voce.prezzoUnitario, fatturaId]
      );
      if (ins.rows.length === 0) {
        throw Object.assign(new Error("Una delle commesse indicate non esiste o non è di questa azienda."), { codice: 404 });
      }
      creati.push(mappaMateriale(ins.rows[0]));
    }

    await client.query(
      "UPDATE fatture SET importata_il = now(), righe_importate = righe_importate + $2 WHERE id = $1",
      [fatturaId, creati.length]
    );
    await client.query("COMMIT");
    res.status(201).json({ materiali: creati, importate: creati.length });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.codice) return res.status(e.codice).json({ errore: e.message });
    console.error(e);
    res.status(500).json({ errore: "Impossibile importare le righe della fattura." });
  } finally {
    client.release();
  }
});

/** Elenco delle fatture caricate dall'azienda del token. */
app.get("/api/fatture", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  try {
    const ris = await pool.query(
      `SELECT id, nome_file, fornitore, partita_iva, numero, to_char(data, 'YYYY-MM-DD') AS data,
              dimensione, caricata_il, importata_il, righe_importate
         FROM fatture WHERE azienda_id = $1 ORDER BY caricata_il DESC`,
      [req.aziendaId]
    );
    res.json({ fatture: ris.rows.map(mappaFattura) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere le fatture." });
  }
});

/** Riscarica il file XML originale di una fattura. */
app.get("/api/fatture/:id/file", richiedeAuth, richiedeAbbonamentoAttivo, async (req, res) => {
  try {
    const ris = await pool.query(
      "SELECT nome_file, tipo, posizione, contenuto, chiave_esterna FROM fatture WHERE id = $1 AND azienda_id = $2",
      [String(req.params.id), req.aziendaId]
    );
    const riga = ris.rows[0];
    if (!riga) return res.status(404).json({ errore: "Fattura non trovata." });

    const contenuto = await leggiFile(riga);
    res.setHeader("Content-Type", riga.tipo);
    res.setHeader("Content-Length", contenuto.length);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(riga.nome_file)}`);
    res.send(contenuto);
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile scaricare la fattura." });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, async () => {
  console.log(`Backend in ascolto sulla porta ${port}`);
  console.log(`Documenti DDT: ${descrizioneArchivio} · quota per azienda ${inMB(QUOTA_AZIENDA_BYTE)} MB`);
  console.log(`Fatture PDF: ${descrizioneDocumentAI}`);
  if (documentAIConfigurato) {
    try {
      const c = await consumiDelMese();
      console.log(`  consumo di ${c.mese}: ${c.pagine} pagine su un tetto di ${c.tetto} · ${c.chiamate} letture`);
    } catch (e) {
      console.error("  (contatore dei consumi non leggibile:", e.message + ")");
    }
  }
});
