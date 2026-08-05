/**
 * Assegna un piano alle aziende che non ce l'hanno ancora.
 *
 *     node src/assegna-piani.js            mostra cosa farebbe, NON scrive
 *     node src/assegna-piani.js --scrivi   scrive
 *
 * SENZA --scrivi NON TOCCA NIENTE. È il modo giusto per un comando che scrive
 * sui dati di un'azienda vera: prima si guarda l'elenco di quello che sta per
 * succedere, poi lo si autorizza. Un comando che scrive appena lo lanci non
 * lascia il tempo di accorgersi che stava per fare la cosa sbagliata.
 *
 * COME SCEGLIE. Guarda il MESE DI PUNTA degli ultimi dodici — in quale mese
 * solare hanno lavorato più persone — e prende il piano che ci sta dentro. Il
 * perché del picco invece delle teste totali sta in abbonamento.js, sopra
 * mesePuntaDi: in edilizia il ricambio è alto, e contare le teste farebbe
 * pagare di più a chi non è mai cresciuto.
 *
 * Le soglie non sono scritte qui: vengono da piani.js, tramite
 * pianoPerDipendenti. Se un giorno cambiano i tetti, questo comando cambia da
 * solo e non c'è una seconda copia da ricordarsi.
 *
 * Tocca SOLO le righe con il piano ancora vuoto: chi un piano ce l'ha già non
 * viene ricalcolato. Rieseguirlo non sposta niente.
 */
import "dotenv/config";
import { pool } from "./db.js";
import { mesePuntaDi } from "./abbonamento.js";
import { pianoPerDipendenti, prezzoDi, FATTURAZIONE_PREDEFINITA } from "./piani.js";

const scrivi = process.argv.includes("--scrivi");

const mese = (m) => {
  if (!m) return "nessun mese con ore";
  const NOMI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
  const [a, n] = m.split("-");
  return `${NOMI[Number(n) - 1]} ${a}`;
};

async function main() {
  const dove = await pool.query("SELECT current_database() AS db, current_schema() AS schema");
  console.log(`\ndatabase: ${dove.rows[0].db} · schema: ${dove.rows[0].schema}`);
  console.log(scrivi ? "modalità: SCRITTURA\n" : "modalità: solo lettura (aggiungi --scrivi per scrivere davvero)\n");

  const az = await pool.query(
    "SELECT id, nome, piano, fatturazione FROM aziende ORDER BY nome"
  );

  const daFare = [];
  for (const a of az.rows) {
    const punta = await mesePuntaDi(a.id);
    const piano = pianoPerDipendenti(punta.persone);
    const gia = a.piano ? String(a.piano) : null;

    console.log(`  ${a.nome}`);
    console.log(`    mese di punta:  ${mese(punta.mese)}${punta.mese ? ` — ${punta.persone} ${punta.persone === 1 ? "persona" : "persone"}` : ""}`);
    if (gia) {
      console.log(`    piano: "${gia}" — GIÀ ASSEGNATO, non lo tocco\n`);
      continue;
    }
    console.log(`    piano che ne risulta: "${piano.id}" (${piano.nome}) · ${prezzoDi(piano.id, FATTURAZIONE_PREDEFINITA)} €/mese + IVA`);
    console.log(`    fatturazione: "${FATTURAZIONE_PREDEFINITA}"\n`);
    daFare.push({ id: a.id, nome: a.nome, piano: piano.id });
  }

  if (daFare.length === 0) {
    console.log("Niente da assegnare: tutte le aziende hanno già un piano.\n");
    return;
  }

  if (!scrivi) {
    console.log(`${daFare.length} ${daFare.length === 1 ? "azienda" : "aziende"} da assegnare. Non ho scritto niente.`);
    console.log("Per scrivere: node src/assegna-piani.js --scrivi\n");
    return;
  }

  for (const x of daFare) {
    /* "AND piano IS NULL" anche qui, non solo nel controllo di sopra: fra la
       lettura e la scrittura può essersi registrato qualcuno, e questa riga
       deve restare vera anche in quel caso. */
    const r = await pool.query(
      "UPDATE aziende SET piano = $2, fatturazione = COALESCE(fatturazione, $3) WHERE id = $1 AND piano IS NULL",
      [x.id, x.piano, FATTURAZIONE_PREDEFINITA]
    );
    console.log(`  scritto: ${x.nome} -> "${x.piano}"${r.rowCount === 0 ? "  (nessuna riga toccata: aveva già un piano)" : ""}`);
  }
  console.log("\nFatto.\n");
}

main()
  .catch((e) => { console.error("\nErrore:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => pool.end());
