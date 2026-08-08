import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET non impostato: necessario per firmare i token di accesso.");
}

// Scadenza lunga: l'utente resta collegato anche chiudendo e riaprendo il browser,
// finché non fa logout esplicito.
const SCADENZA_TOKEN = "30d";

export function cifraPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verificaPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Il token dice CHI sei, non solo di quale azienda.
 *
 * Fino ad agosto 2026 conteneva il solo `aziendaId`, ed era coerente: un utente
 * per azienda, quindi l'azienda era l'identità. Con più persone dentro la stessa
 * impresa quel modello non regge — due utenti produrrebbero due token
 * indistinguibili, e il server non saprebbe a chi attribuire una riga di ore né
 * a chi negare i lordi.
 */
export function generaToken({ aziendaId, utenteId, ruolo }) {
  return jwt.sign({ aziendaId, utenteId, ruolo }, JWT_SECRET, { expiresIn: SCADENZA_TOKEN });
}

/**
 * Il ruolo attribuito a un token che non ne porta uno.
 *
 * I token durano trenta giorni, quindi il giorno della pubblicazione ce ne sono
 * in giro emessi PRIMA che questo campo esistesse. Rifiutarli scollegherebbe
 * tutti in una volta, e per un motivo che l'utente non può capire né rimediare
 * se non rifacendo l'accesso.
 *
 * Trattarli come titolare non apre niente che non fosse già aperto: quei token
 * appartengono per costruzione ad aziende che avevano un utente solo, e quello
 * era il titolare. La concessione si chiude da sola quando l'ultimo scade —
 * nessuna data da ricordare, nessun codice da togliere dopo.
 */
const RUOLO_DEI_TOKEN_VECCHI = "titolare";

/** Richiede un token Bearer valido e imposta req.aziendaId, req.utenteId e
 *  req.ruolo dal suo contenuto (mai da valori passati dal client), così ogni
 *  rotta protetta lavora solo sui dati dell'azienda autenticata e sa con quali
 *  permessi. */
export function richiedeAuth(req, res, next) {
  const [schema, token] = (req.headers.authorization || "").split(" ");
  if (schema !== "Bearer" || !token) {
    return res.status(401).json({ errore: "Accesso richiesto." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.aziendaId = decoded.aziendaId;
    req.utenteId = decoded.utenteId ?? null;
    req.ruolo = decoded.ruolo ?? RUOLO_DEI_TOKEN_VECCHI;
    next();
  } catch (e) {
    res.status(401).json({ errore: "Sessione scaduta o non valida." });
  }
}
