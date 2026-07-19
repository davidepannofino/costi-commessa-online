import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

/**
 * DATABASE_SSL=false va usato solo in locale contro un Postgres senza TLS
 * (es. il container Docker di sviluppo). Neon richiede sempre SSL: su Render,
 * lasciare DATABASE_SSL non impostata (o "true").
 */
const sslAttivo = process.env.DATABASE_SSL !== "false";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslAttivo ? { rejectUnauthorized: false } : false,
});
