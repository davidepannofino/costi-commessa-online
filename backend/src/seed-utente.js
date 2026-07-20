import { pool } from "./db.js";
import { cifraPassword } from "./auth.js";

const [, , aziendaId, email, password] = process.argv;

if (!aziendaId || !email || !password) {
  console.error("Uso: node src/seed-utente.js <aziendaId> <email> <password>");
  process.exit(1);
}

async function main() {
  const hash = await cifraPassword(password);
  await pool.query(
    `INSERT INTO utenti (azienda_id, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (azienda_id) DO UPDATE SET email = $2, password_hash = $3`,
    [aziendaId, email.trim().toLowerCase(), hash]
  );
  console.log(`Utente creato/aggiornato per l'azienda "${aziendaId}" con email ${email}.`);
  await pool.end();
}

main().catch((e) => {
  console.error("Errore creando l'utente:", e);
  process.exit(1);
});
