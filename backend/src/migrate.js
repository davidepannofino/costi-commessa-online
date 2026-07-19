import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");

async function main() {
  await pool.query(sql);
  console.log("Schema applicato con successo.");
  await pool.end();
}

main().catch((e) => {
  console.error("Errore applicando lo schema:", e);
  process.exit(1);
});
