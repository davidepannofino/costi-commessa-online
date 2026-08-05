import { pool } from "./db.js";

// Email con accesso completo e illimitato, senza prova né abbonamento.
// Per aggiungerne altre in futuro basta inserire la stringa qui: nessun'altra
// modifica alla logica è necessaria.
const EMAIL_ESENTI = new Set([
  "pannofino.work@gmail.com",
]);

/**
 * Quanto dura la prova libera, in giorni.
 *
 * ATTENZIONE, QUESTO NUMERO È RETROATTIVO. La fine della prova non è scritta
 * da nessuna parte nel database: si ricalcola a ogni richiesta come
 * `utenti.creato_il + GIORNI_PROVA`. Cambiarlo quindi non vale solo per chi si
 * registra da domani — rimisura la prova di TUTTE le aziende che esistono già
 * e che non sono "attivo" né esenti, comprese quelle a cui era già scaduta.
 *
 * Portandolo da 14 a 30 il 6 agosto 2026, un'azienda registrata da 16 giorni è
 * passata da "scaduto, niente accesso" a "prova, 14 giorni rimasti". Nella
 * direzione opposta il conto è più brutto: abbassare questo numero toglierebbe
 * l'accesso, di colpo, a chi in quel momento sta lavorando.
 *
 * Se un giorno servirà che valga solo per le registrazioni nuove, la fine
 * della prova va SCRITTA sulla riga al momento della registrazione (una
 * colonna `prova_fino_al`), e questo numero resta solo il valore di partenza
 * per le prossime. Finché sta qui, è una leva che muove anche il passato.
 */
const GIORNI_PROVA = 30;
const MS_GIORNO = 24 * 60 * 60 * 1000;

/** Funzione pura: dati email/stato_abbonamento/creato_il, decide se l'azienda
 *  ha accesso ai dati in questo momento. Usata sia dal middleware sia dalla
 *  rotta che riporta lo stato al frontend. */
export function calcolaStatoAccesso({ email, stato_abbonamento, creato_il }) {
  if (EMAIL_ESENTI.has(String(email).trim().toLowerCase())) {
    return { haAccesso: true, stato: "esente", giorniProvaRestanti: null };
  }
  if (stato_abbonamento === "attivo") {
    return { haAccesso: true, stato: "attivo", giorniProvaRestanti: null };
  }
  const fineProva = new Date(creato_il).getTime() + GIORNI_PROVA * MS_GIORNO;
  const msRestanti = fineProva - Date.now();
  if (msRestanti > 0) {
    return { haAccesso: true, stato: "prova", giorniProvaRestanti: Math.ceil(msRestanti / MS_GIORNO) };
  }
  return { haAccesso: false, stato: "scaduto", giorniProvaRestanti: 0 };
}

async function leggiRigaAccesso(aziendaId) {
  const ris = await pool.query(
    "SELECT a.stato_abbonamento, u.email, u.creato_il FROM aziende a JOIN utenti u ON u.azienda_id = a.id WHERE a.id = $1",
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
