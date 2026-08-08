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

/**
 * L'EMAIL DI CHI STA BUSSANDO — non dell'azienda.
 *
 * Prima era `SELECT email FROM utenti WHERE azienda_id = $1` con `rows[0]`, e
 * con un utente per azienda voleva dire «l'unico». Con più utenti sarebbe
 * diventato «quello che il database restituisce per primo»: i permessi di
 * amministratore decisi da un `ORDER BY` che non c'è. Fra tutti i punti che la
 * multiutenza rompeva, questo era l'unico che rompeva un controllo di sicurezza.
 *
 * Adesso il token dice chi sei, quindi si guarda l'email TUA. È anche più
 * corretto nel merito: essere amministratore di piattaforma è una proprietà
 * della persona, non dell'impresa a cui appartiene.
 *
 * Il ripiego sul titolare serve ai token emessi prima che esistesse `utenteId`,
 * che valgono ancora per trenta giorni: quelle aziende hanno un utente solo,
 * quindi il titolare È chi sta bussando. Scade da sé insieme ai token.
 */
async function emailDiChiChiede(aziendaId, utenteId) {
  if (utenteId != null) {
    const r = await pool.query("SELECT email FROM utenti WHERE id = $1 AND azienda_id = $2", [utenteId, aziendaId]);
    return r.rows[0]?.email || null;
  }
  const r = await pool.query(
    "SELECT email FROM utenti WHERE azienda_id = $1 AND ruolo = 'titolare' ORDER BY id LIMIT 1",
    [aziendaId]
  );
  return r.rows[0]?.email || null;
}

/** Da applicare dopo richiedeAuth: blocca con 403 chi non è nell'elenco admin.
 *  Il controllo legge sempre l'email dal database in base al token verificato —
 *  mai da un valore mandato dal client. */
export async function richiedeAdmin(req, res, next) {
  try {
    const email = await emailDiChiChiede(req.aziendaId, req.utenteId);
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
export async function eAdmin(aziendaId, utenteId = null) {
  const email = await emailDiChiChiede(aziendaId, utenteId);
  return !!email && EMAIL_ADMIN.has(email.trim().toLowerCase());
}

/**
 * Il titolare di riferimento, per le due letture di riepilogo qui sotto.
 *
 * Senza, `JOIN utenti` restituisce una riga PER UTENTE: nell'elenco ogni azienda
 * comparirebbe due volte, e nelle statistiche i quattro numeri conterebbero due
 * volte la stessa impresa smettendo di sommare al totale. Non e' un difetto
 * visibile — sono numeri plausibili e sbagliati, che e' il modo peggiore.
 */
const TITOLARE_DI_RIFERIMENTO = `
  JOIN LATERAL (
    SELECT email, creato_il FROM utenti
     WHERE azienda_id = a.id AND ruolo = 'titolare'
     ORDER BY id
     LIMIT 1
  ) u ON true`;

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
      `SELECT a.id, a.nome, u.email, u.creato_il, a.stato_abbonamento, a.prova_fino_al,
              (SELECT count(*)::int FROM utenti x WHERE x.azienda_id = a.id) AS utenti
       FROM aziende a ${TITOLARE_DI_RIFERIMENTO}
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
        /* Quanti utenti ha l'azienda. L'email resta quella del titolare di
           riferimento — è quella che conta per esenzione e fatturazione — e
           questo numero dice se dietro ce n'è più di uno. */
        utenti: r.utenti,
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
       FROM aziende a ${TITOLARE_DI_RIFERIMENTO}`
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
