/**
 * Verifica in SOLA LETTURA che la migrazione sia arrivata.
 *
 *     node src/verifica-schema.js
 *
 * Non scrive niente: fa solo domande al catalogo di sistema di Postgres e
 * stampa cosa ha trovato. Serve a non doversi fidare — dopo `npm run migrate`
 * si guarda una risposta, non una promessa.
 *
 * Punta al database che trova in DATABASE_URL: quella della riga di comando se
 * c'è, altrimenti quella del file .env.
 */
import "dotenv/config";
import { pool } from "./db.js";

/**
 * Cosa si va a guardare.
 *
 * Questo elenco è tutta la conoscenza che il comando ha: il suo «Tutto a
 * posto» finale non vuol dire "la migrazione è completa", vuol dire "le cose
 * scritte qui sotto ci sono". Il 6 agosto 2026 la migrazione ha aggiunto
 * aziende.prova_fino_al e questo comando ha risposto «Tutto a posto» senza
 * averla nemmeno cercata — era vero e inutile insieme.
 *
 * Quindi la regola: chi aggiunge una tabella o una colonna a schema.sql
 * aggiunge una riga anche qui. È l'unico modo perché la risposta di questo
 * comando resti una verifica e non diventi una formalità.
 */
const ATTESE = [
  { tipo: "tabella", nome: "scansioni" },
  { tipo: "colonna", tabella: "allegati", nome: "origine_nome_file" },
  { tipo: "colonna", tabella: "allegati", nome: "origine_pagina" },
  { tipo: "colonna", tabella: "aziende", nome: "prova_fino_al" },
  { tipo: "colonna", tabella: "aziende", nome: "piano" },
  { tipo: "colonna", tabella: "aziende", nome: "fatturazione" },
  { tipo: "colonna", tabella: "dipendenti", nome: "archiviato" },
  { tipo: "colonna", tabella: "aziende", nome: "tolleranza_fino_al" },
  { tipo: "colonna", tabella: "aziende", nome: "primo_fallimento_il" },
  /* Le tre date degli avvisi di scadenza della prova. Finché non ci sono, il
     giro degli avvisi fallisce la query e non manda niente — l'errore resta nei
     log e nessuna richiesta si rompe, ma nemmeno un'email parte. È la ragione
     per cui queste tre righe contano più delle altre: sono la differenza fra
     «distribuito» e «funzionante». */
  { tipo: "colonna", tabella: "aziende", nome: "avviso_prova_7g_il" },
  { tipo: "colonna", tabella: "aziende", nome: "avviso_prova_1g_il" },
  { tipo: "colonna", tabella: "aziende", nome: "avviso_prova_scaduta_il" },
  /* Piu' utenti per azienda. Il ruolo e l'autore di una riga di ore sono
     colonne come le altre; l'assenza dell'unicita' no, e per quella c'e' un
     controllo apposta qui sotto — e' l'unica cosa in questo elenco che si
     verifica per la sua MANCANZA, e senza di lei tutto il resto non serve. */
  { tipo: "colonna", tabella: "utenti", nome: "ruolo" },
  { tipo: "colonna", tabella: "registrazioni", nome: "inserita_da" },
  { tipo: "colonna", tabella: "aziende", nome: "versione_dati" },
  { tipo: "senza-vincolo-unico", tabella: "utenti", colonna: "azienda_id" },
  /* Non basta che il vincolo esista: esisteva anche prima, con CASCADE. Quello
     che si verifica è la REGOLA di cancellazione, perché è lì che sta la
     differenza fra "le ore restano" e "le ore spariscono". */
  { tipo: "vincolo", tabella: "registrazioni", nome: "registrazioni_dipendente_id_fkey", regola: "RESTRICT" },
];

/* Le lettere che Postgres usa per la regola di cancellazione di una chiave
   esterna, in pg_constraint.confdeltype. */
const REGOLA_CANCELLAZIONE = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

async function main() {
  const dove = await pool.query("SELECT current_database() AS db, current_schema() AS schema");
  console.log(`\ndatabase: ${dove.rows[0].db} · schema: ${dove.rows[0].schema}\n`);

  const esiti = [];
  for (const a of ATTESE) {
    if (a.tipo === "tabella") {
      const r = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
        [a.nome]
      );
      esiti.push({ cosa: `tabella ${a.nome}`, presente: r.rows.length > 0 ? "SI" : "NO" });
    } else if (a.tipo === "senza-vincolo-unico") {
      /* Si verifica che un vincolo NON ci sia. E' il contrario di tutto il
         resto dell'elenco, e vale la pena spiegare perche': l'unicita' su
         utenti.azienda_id era la riga che imponeva «un utente per azienda». Se
         un giorno tornasse — un database ricreato da uno schema vecchio, un
         ripristino, una migrazione rieseguita nell'ordine sbagliato — la
         creazione del secondo utente fallirebbe con un errore di chiave
         duplicata, e il messaggio parlerebbe di un vincolo invece che del
         permesso. Meglio saperlo qui. */
      const r = await pool.query(
        `SELECT c.conname FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = to_regclass($1) AND c.contype = 'u'
            AND a.attname = $2 AND array_length(c.conkey, 1) = 1`,
        [a.tabella, a.colonna]
      );
      esiti.push({
        cosa: `${a.tabella}.${a.colonna} SENZA vincolo unico`,
        presente: r.rows.length === 0 ? "SI" : "NO",
        tipo: r.rows.length === 0 ? "—" : `c'e' ancora: ${r.rows[0].conname}`,
      });
    } else if (a.tipo === "vincolo") {
      /* to_regclass invece di ::regclass: se la tabella non c'è ancora
         restituisce NULL, mentre il cast solleverebbe un errore e questo
         comando deve poter girare anche PRIMA della migrazione. */
      const r = await pool.query(
        `SELECT confdeltype FROM pg_constraint
          WHERE conrelid = to_regclass($1) AND conname = $2`,
        [a.tabella, a.nome]
      );
      const trovata = REGOLA_CANCELLAZIONE[r.rows[0]?.confdeltype] ?? "—";
      esiti.push({
        cosa: `vincolo ${a.tabella}.${a.nome}`,
        presente: trovata === a.regola ? "SI" : "NO",
        tipo: `ON DELETE ${trovata}`,
      });
    } else {
      const r = await pool.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
        [a.tabella, a.nome]
      );
      esiti.push({
        cosa: `colonna ${a.tabella}.${a.nome}`,
        presente: r.rows.length > 0 ? "SI" : "NO",
        tipo: r.rows[0]?.data_type ?? "—",
      });
    }
  }
  console.table(esiti);

  /* Il conteggio serve a vedere che la migrazione non ha toccato i dati:
     dev'essere identico a prima. Si contano solo le tabelle che esistono, così
     questo comando funziona anche PRIMA della migrazione — che è il momento in
     cui serve di più, per avere il numero di partenza con cui confrontare. */
  const righe = [];
  for (const t of ["aziende", "commesse", "dipendenti", "registrazioni", "materiali", "allegati", "fatture", "scansioni"]) {
    const c = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
      [t]
    );
    righe.push({
      tabella: t,
      righe: c.rows.length === 0 ? "(non esiste ancora)" : (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n,
    });
  }
  console.table(righe);

  const mancanti = esiti.filter((e) => e.presente === "NO");
  if (mancanti.length === 0) {
    console.log("Tutto a posto: la migrazione è arrivata.\n");
  } else {
    console.log(`MANCA ANCORA: ${mancanti.map((m) => m.cosa).join(", ")}\n`);
  }
  await pool.end();
  process.exit(mancanti.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nErrore durante la verifica:", e.message);
  console.error("Se dice che la relazione «scansioni» non esiste, la migrazione non è ancora stata eseguita.\n");
  await pool.end();
  process.exit(1);
});
