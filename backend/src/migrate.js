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
  /* QUESTA RIGA NON SI TOCCA.
   *
   * È l'unica cosa che impedisce a una pubblicazione di passare verde su una
   * migrazione FALLITA. Questo comando gira come passo della pubblicazione,
   * prima che il codice nuovo serva traffico: se esce con zero, Render lo
   * legge come "andata bene" e manda in linea codice che si aspetta uno
   * schema che non è arrivato. Il risultato è l'applicazione in errore per
   * chi la sta usando, e senza niente di rosso da nessuna parte.
   *
   * Uscendo con 1 la pubblicazione si ferma e resta su la versione
   * precedente, che con lo schema di prima ci va d'accordo. Un deploy
   * mancato è un fastidio; un deploy riuscito a metà è un guasto.
   *
   * Chi volesse "rendere il comando più tollerante" (ingoiare l'errore,
   * riprovare in silenzio, uscire con zero per non bloccare la pipeline)
   * starebbe togliendo l'unico controllo che c'è. Se un errore qui blocca
   * troppo spesso, la cosa da sistemare è la migrazione, non l'uscita. */
  process.exit(1);
});
