/**
 * Crea e cancella uno SCHEMA USA-E-GETTA su cui provare senza toccare i dati veri.
 *
 *     node src/schema-di-prova.js crea prova_ddt
 *     node src/schema-di-prova.js elimina prova_ddt
 *
 * A cosa serve. Non esiste un Postgres locale: c'è una Neon sola, e dentro ci
 * sono i dati veri dell'azienda. Provare una rotta end-to-end significherebbe
 * scrivere lì. Uno schema separato sullo stesso database risolve: stesse
 * tabelle, stesso codice, dati che non esistono per nessun altro.
 *
 * Come ci si punta il backend. Si mette in coda alla DATABASE_URL il parametro
 *
 *     &options=-c%20search_path%3Dprova_ddt
 *
 * in un file a parte (per esempio .env.prova, che .gitignore già esclude), e si
 * avvia con DOTENV_CONFIG_PATH che punta a quel file. Così il .env vero non
 * viene proprio aperto: le chiavi R2 e Document AI non entrano nell'ambiente, i
 * documenti di prova restano nel database di prova invece di finire nel bucket
 * vero, e non si consuma Document AI, che si paga a pagina.
 *
 * LA SICURA. Il nome dello schema è obbligatorio e deve cominciare per
 * "prova_". Questo comando sa cancellare uno schema con dentro tutto, quindi
 * "public" scritto per sbaglio al posto di "prova_ddt" sarebbe l'ultimo errore
 * della giornata. Il controllo avviene PRIMA di aprire qualunque connessione:
 * un nome sbagliato non arriva nemmeno a leggere la configurazione.
 *
 * Per vedere dove si è finiti c'è `node src/verifica-schema.js`, che è in sola
 * lettura e stampa database e schema correnti.
 */
const azione = process.argv[2];
const schema = process.argv[3];

const NOME_AMMESSO = /^prova_[a-z0-9_]+$/;

if (!["crea", "elimina"].includes(azione)) {
  console.error("Uso: node src/schema-di-prova.js <crea|elimina> <nome_schema>");
  process.exit(1);
}
if (!schema || !NOME_AMMESSO.test(schema)) {
  console.error(`\nRIFIUTATO: "${schema ?? "(nessun nome)"}" non è un nome di schema di prova.`);
  console.error("Deve corrispondere a prova_[a-z0-9_]+ — per esempio prova_ddt.");
  console.error("Nessuna connessione aperta, nessuna modifica fatta.\n");
  process.exit(1);
}

/* Gli import stanno QUI e non in cima di proposito: se il nome non passa la
   sicura il programma è già uscito senza nemmeno leggere la configurazione. */
const { pool } = await (async () => {
  await import("dotenv/config");
  return import("./db.js");
})();

try {
  const dove = await pool.query("SELECT current_database() AS db, current_user AS utente");
  console.log(`\ndatabase: ${dove.rows[0].db} · utente: ${dove.rows[0].utente}`);

  if (azione === "crea") {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    console.log(`schema "${schema}" creato (o già esistente).`);

    /* Adesso che esiste, current_schema() dice se la DATABASE_URL sta davvero
       portando lì dentro: è la conferma che serve PRIMA di scrivere qualcosa,
       non dopo. Finché lo schema non esisteva, search_path lo saltava e questa
       domanda non avrebbe avuto risposta. */
    const ora = await pool.query("SELECT current_schema() AS schema");
    const corrente = ora.rows[0].schema;
    console.log(
      corrente === schema
        ? `il backend scriverà in "${corrente}": la DATABASE_URL punta allo schema giusto.`
        : `ATTENZIONE: lo schema corrente è "${corrente ?? "(nessuno)"}", non "${schema}".\n` +
          "  Manca &options=-c%20search_path%3D" + schema + " in fondo alla DATABASE_URL,\n" +
          "  oppure DOTENV_CONFIG_PATH non sta puntando al file giusto. Non proseguire."
    );
    console.log("Poi: npm run migrate, e node src/verifica-schema.js per ricontrollare.\n");
  } else {
    const prima = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1",
      [schema]
    );
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    console.log(`schema "${schema}" cancellato (conteneva ${prima.rows[0].n} tabelle).`);

    const resta = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = $1",
      [schema]
    );
    console.log(resta.rows[0].n === 0 ? "verificato: non esiste più.\n" : "ATTENZIONE: risulta ancora presente.\n");
  }
} catch (e) {
  console.error("\nErrore:", e.message, "\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
