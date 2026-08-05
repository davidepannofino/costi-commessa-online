import { Router } from "express";
import { pool } from "./db.js";
import { calcolaStatoAccesso } from "./abbonamento.js";

// Email con accesso al pannello di amministrazione (può vedere il riepilogo di
// TUTTE le aziende). Concetto diverso da EMAIL_ESENTI in abbonamento.js: lì
// un'email non paga l'abbonamento, qui un'email vede il pannello admin. Le due
// liste possono avere email in comune (come oggi) o no: sono verificate separatamente.
const EMAIL_ADMIN = new Set([
  "pannofino.work@gmail.com",
]);

async function emailDiAzienda(aziendaId) {
  const ris = await pool.query("SELECT email FROM utenti WHERE azienda_id = $1", [aziendaId]);
  return ris.rows[0]?.email || null;
}

/** Da applicare dopo richiedeAuth: blocca con 403 chi non è nell'elenco admin.
 *  Il controllo legge sempre l'email dal database in base all'aziendaId del
 *  token verificato — mai da un valore mandato dal client. */
export async function richiedeAdmin(req, res, next) {
  try {
    const email = await emailDiAzienda(req.aziendaId);
    if (!email || !EMAIL_ADMIN.has(email.trim().toLowerCase())) {
      return res.status(403).json({ errore: "Accesso non autorizzato." });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile verificare i permessi." });
  }
}

/**
 * Lo stesso giudizio di richiedeAdmin, ma come risposta invece che come blocco.
 *
 * Serve a una cosa sola: permettere al frontend di sapere se mostrare la voce
 * "Amministrazione" senza doverlo INDOVINARE bussando a una rotta protetta e
 * leggendo il 403. Prima faceva così, e ogni utente normale produceva un 403 a
 * ogni caricamento — rumore che nasconde gli errori veri e, il giorno che
 * arriva un monitoraggio, falsi allarmi ricorrenti.
 *
 * Resta una risposta, non un permesso: richiedeAdmin continua a guardare ogni
 * rotta /api/admin/*. Chi falsificasse questo campo nel browser otterrebbe solo
 * una voce di menù le cui schermate rispondono 403. Il campo decide cosa si
 * VEDE, il middleware cosa si può FARE — e l'email si legge sempre dal
 * database partendo dall'aziendaId del token verificato, mai dal client.
 */
export async function eAdmin(aziendaId) {
  const email = await emailDiAzienda(aziendaId);
  return !!email && EMAIL_ADMIN.has(email.trim().toLowerCase());
}

export const adminRouter = Router();

/**
 * Elenco di riepilogo di TUTTE le aziende registrate: nome, email, data di
 * registrazione, stato abbonamento e giorni di prova rimanenti se in prova.
 * Nessuna password (nemmeno cifrata) e nessun dato operativo (dipendenti,
 * commesse, registrazioni) di altre aziende viene mai letto o restituito qui.
 */
adminRouter.get("/aziende", async (req, res) => {
  try {
    const ris = await pool.query(
      `SELECT a.id, a.nome, u.email, u.creato_il, a.stato_abbonamento, a.prova_fino_al
       FROM aziende a JOIN utenti u ON u.azienda_id = a.id
       ORDER BY u.creato_il DESC`
    );
    const aziende = ris.rows.map((r) => {
      const info = calcolaStatoAccesso({
        email: r.email,
        stato_abbonamento: r.stato_abbonamento,
        creato_il: r.creato_il,
        prova_fino_al: r.prova_fino_al,
      });
      return {
        id: r.id,
        nome: r.nome,
        email: r.email,
        registratoIl: r.creato_il,
        stato: info.stato,
        giorniProvaRestanti: info.giorniProvaRestanti,
      };
    });
    res.json({ aziende });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere l'elenco delle aziende." });
  }
});

/** Numeri di riepilogo per le schede in cima al pannello admin. "Esente" viene
 *  contato insieme ad "attivo": in entrambi i casi l'azienda ha accesso pieno
 *  senza restrizioni, così i quattro numeri sommano sempre al totale. */
adminRouter.get("/statistiche", async (req, res) => {
  try {
    const ris = await pool.query(
      `SELECT u.email, u.creato_il, a.stato_abbonamento, a.prova_fino_al
       FROM aziende a JOIN utenti u ON u.azienda_id = a.id`
    );
    const settimanaFa = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let totale = 0, inProva = 0, attive = 0, scadute = 0, nuoveUltimi7Giorni = 0;
    for (const r of ris.rows) {
      totale++;
      const info = calcolaStatoAccesso(r);
      if (info.stato === "prova") inProva++;
      else if (info.stato === "attivo" || info.stato === "esente") attive++;
      else if (info.stato === "scaduto") scadute++;
      if (new Date(r.creato_il).getTime() >= settimanaFa) nuoveUltimi7Giorni++;
    }
    res.json({ totale, inProva, attive, scadute, nuoveUltimi7Giorni });
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile leggere le statistiche." });
  }
});
