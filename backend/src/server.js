import express from "express";
import cors from "cors";
import "dotenv/config";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { pool } from "./db.js";
import { cifraPassword, verificaPassword, generaToken, richiedeAuth } from "./auth.js";
import { inviaEmailResetPassword } from "./email.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://costi-commessa-frontend.onrender.com";
const SCADENZA_RESET_MS = 60 * 60 * 1000; // 1 ora

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
 * Restituisce l'intero stato dell'azienda autenticata (dipendenti, commesse,
 * registrazioni, nome azienda). Rispecchia la forma che il frontend già usa
 * internamente, così il resto dell'app non deve cambiare. L'azienda è sempre
 * quella del token verificato da richiedeAuth, mai un valore mandato dal client.
 */
app.get("/api/stato", richiedeAuth, async (req, res) => {
  const aziendaId = req.aziendaId;
  try {
    const [azRes, dipRes, comRes, regRes] = await Promise.all([
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
app.put("/api/stato", richiedeAuth, async (req, res) => {
  const aziendaId = req.aziendaId;
  const { dipendenti = [], commesse = [], registrazioni = [], azienda = "" } = req.body || {};
  if (!Array.isArray(dipendenti) || !Array.isArray(commesse) || !Array.isArray(registrazioni)) {
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
    await client.query("DELETE FROM commesse WHERE azienda_id = $1", [aziendaId]);
    await client.query("DELETE FROM dipendenti WHERE azienda_id = $1", [aziendaId]);

    for (const d of dipendenti) {
      await client.query(
        "INSERT INTO dipendenti (id, azienda_id, nome, cognome, lordo_mensile) VALUES ($1, $2, $3, $4, $5)",
        [d.id, aziendaId, d.nome, d.cognome || "", JSON.stringify(d.lordoMensile || {})]
      );
    }
    for (const c of commesse) {
      await client.query(
        "INSERT INTO commesse (id, azienda_id, codice, descrizione) VALUES ($1, $2, $3, $4)",
        [c.id, aziendaId, c.codice, c.descrizione || ""]
      );
    }
    for (const r of registrazioni) {
      await client.query(
        "INSERT INTO registrazioni (id, azienda_id, dipendente_id, commessa_id, data, ore) VALUES ($1, $2, $3, $4, $5, $6)",
        [r.id, aziendaId, r.dipendenteId, r.commessaId, r.data, r.ore]
      );
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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Backend in ascolto sulla porta ${port}`));
