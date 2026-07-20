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

export function generaToken(aziendaId) {
  return jwt.sign({ aziendaId }, JWT_SECRET, { expiresIn: SCADENZA_TOKEN });
}

/** Richiede un token Bearer valido e imposta req.aziendaId dal suo contenuto
 *  (mai da un id passato dal client), così ogni rotta protetta lavora solo
 *  sui dati dell'azienda autenticata. */
export function richiedeAuth(req, res, next) {
  const [schema, token] = (req.headers.authorization || "").split(" ");
  if (schema !== "Bearer" || !token) {
    return res.status(401).json({ errore: "Accesso richiesto." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.aziendaId = decoded.aziendaId;
    next();
  } catch (e) {
    res.status(401).json({ errore: "Sessione scaduta o non valida." });
  }
}
