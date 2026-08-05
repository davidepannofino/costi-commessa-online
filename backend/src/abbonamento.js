import { pool } from "./db.js";

// Email con accesso completo e illimitato, senza prova né abbonamento.
// Per aggiungerne altre in futuro basta inserire la stringa qui: nessun'altra
// modifica alla logica è necessaria.
const EMAIL_ESENTI = new Set([
  "pannofino.work@gmail.com",
]);

/**
 * Da quanti giorni parte la prova di chi si registra ADESSO.
 *
 * È solo il valore di partenza. La scadenza vera viene SCRITTA sulla riga
 * dell'azienda (`aziende.prova_fino_al`) nel momento della registrazione, e da
 * lì in poi è un fatto, non un conto: cambiare questo numero non tocca più
 * nessuno che è già dentro.
 *
 * Prima non era così, e vale la pena ricordare perché è cambiato. La scadenza
 * si ricavava a ogni richiesta da `utenti.creato_il + GIORNI_PROVA`, quindi la
 * costante rimisurava anche il passato: portandola da 14 a 30 il 6 agosto 2026
 * un'azienda registrata da 16 giorni è passata da "scaduto, niente accesso" a
 * "prova, 14 giorni rimasti", senza che nessuno l'avesse chiesto. Nella
 * direzione opposta sarebbe stato peggio: abbassarla avrebbe chiuso fuori, di
 * colpo, chi in quel momento stava lavorando.
 */
export const GIORNI_PROVA = 30;
const MS_GIORNO = 24 * 60 * 60 * 1000;

/**
 * Quando finisce la prova di questa azienda, in millisecondi.
 *
 * La data scritta comanda. Il conto su `creato_il` resta solo come RETE, per
 * le righe che per qualche motivo non hanno la data: è il caso di un database
 * su cui la migrazione non è ancora passata. In quel caso si ripiega sul
 * comportamento di prima invece di trattare la riga come scaduta — chiudere
 * fuori qualcuno per una colonna vuota sarebbe il modo peggiore di sbagliare.
 */
function fineProvaDi({ prova_fino_al, creato_il }) {
  const scritta = prova_fino_al ? new Date(prova_fino_al).getTime() : NaN;
  if (!isNaN(scritta)) return scritta;
  return new Date(creato_il).getTime() + GIORNI_PROVA * MS_GIORNO;
}

/** Funzione pura: dati email, stato_abbonamento e la scadenza della prova,
 *  decide se l'azienda ha accesso ai dati in questo momento. Usata sia dal
 *  middleware sia dalla rotta che riporta lo stato al frontend. */
export function calcolaStatoAccesso({ email, stato_abbonamento, creato_il, prova_fino_al }) {
  if (EMAIL_ESENTI.has(String(email).trim().toLowerCase())) {
    return { haAccesso: true, stato: "esente", giorniProvaRestanti: null };
  }
  if (stato_abbonamento === "attivo") {
    return { haAccesso: true, stato: "attivo", giorniProvaRestanti: null };
  }
  const msRestanti = fineProvaDi({ prova_fino_al, creato_il }) - Date.now();
  if (msRestanti > 0) {
    return { haAccesso: true, stato: "prova", giorniProvaRestanti: Math.ceil(msRestanti / MS_GIORNO) };
  }
  return { haAccesso: false, stato: "scaduto", giorniProvaRestanti: 0 };
}

async function leggiRigaAccesso(aziendaId) {
  const ris = await pool.query(
    `SELECT a.stato_abbonamento, a.prova_fino_al, u.email, u.creato_il
       FROM aziende a JOIN utenti u ON u.azienda_id = a.id WHERE a.id = $1`,
    [aziendaId]
  );
  return ris.rows[0] || null;
}

/** Da applicare dopo richiedeAuth: blocca l'accesso ai dati (non il login)
 *  se la prova è scaduta e non c'è un abbonamento attivo o un'email esente. */
export async function richiedeAbbonamentoAttivo(req, res, next) {
  try {
    const riga = await leggiRigaAccesso(req.aziendaId);
    if (!riga) return res.status(404).json({ errore: "Azienda non trovata." });
    const info = calcolaStatoAccesso(riga);
    if (!info.haAccesso) {
      return res.status(402).json({ errore: "Abbonamento richiesto.", ...info });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile verificare l'abbonamento." });
  }
}

export async function statoAbbonamentoDi(aziendaId) {
  const riga = await leggiRigaAccesso(aziendaId);
  if (!riga) return null;
  return calcolaStatoAccesso(riga);
}
