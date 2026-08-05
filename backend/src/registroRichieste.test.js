/**
 * Collaudo del registro delle richieste. Si esegue con:
 *
 *     node src/registroRichieste.test.js
 *
 * Serve Express (che è già una dipendenza), ma NON il database e nessuna rete
 * verso l'esterno: si alza un server su una porta a caso, gli si mandano
 * richieste vere e si guarda cosa è finito nel log.
 *
 * IL VALORE DI QUESTO FILE STA NELLA SECONDA METÀ. Le prove sul formato della
 * riga passerebbero anche il giorno in cui qualcuno aggiunge `req.originalUrl`
 * "per comodità" — perché la riga resterebbe della forma giusta, solo con
 * dentro la query string. Perciò le prove che contano mandano DAVVERO un
 * token, una query string, una password, un'email e un nome di file, e
 * pretendono che nel log non ce ne sia traccia. Quelle sono la sveglia.
 */
import express from "express";
import { registroRichieste, modelloRotta, rigaDiRegistro, SENZA_ROTTA } from "./registroRichieste.js";

let passati = 0, falliti = 0;
async function prova(nome, fn) {
  try {
    await fn();
    passati++;
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falliti++;
    console.log(`  NO   ${nome}\n         ${e.message}`);
  }
}
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che} atteso ${b}, avuto ${a}`);
}
function contiene(testo, pezzo) {
  if (!String(testo).includes(pezzo)) throw new Error(`"${testo}" non contiene "${pezzo}"`);
}
function nonContiene(testo, pezzo, perche) {
  if (String(testo).includes(pezzo)) throw new Error(`TRAPELATO ${perche}: "${pezzo}" compare nel log →\n         ${testo}`);
}

/* ------------------------------------------------------------------ *
 * PARTE 1 — il modello della rotta, senza server                      *
 * ------------------------------------------------------------------ */

console.log("\nIL MODELLO DELLA ROTTA");

await prova("una rotta semplice dà il suo percorso", () => {
  uguale(modelloRotta({ route: { path: "/api/stato" }, baseUrl: "" }), "/api/stato");
});

await prova("una rotta con parametro dà il SEGNAPOSTO, non il valore", () => {
  uguale(modelloRotta({ route: { path: "/api/commesse/:id/allegati" }, baseUrl: "" }), "/api/commesse/:id/allegati");
});

await prova("dentro un router montato si antepone il punto di montaggio", () => {
  uguale(modelloRotta({ route: { path: "/statistiche" }, baseUrl: "/api/admin" }), "/api/admin/statistiche");
});

await prova("la rotta radice di un router non produce una barra doppia", () => {
  uguale(modelloRotta({ route: { path: "/" }, baseUrl: "/api/admin" }), "/api/admin");
});

await prova("senza rotta si dice che non si sa, NON si ripiega sull'indirizzo", () => {
  uguale(modelloRotta({ baseUrl: "", originalUrl: "/api/segreto?token=abc" }), SENZA_ROTTA);
  uguale(modelloRotta({}), SENZA_ROTTA);
  uguale(modelloRotta(undefined), SENZA_ROTTA);
});

await prova("la riga ha i quattro campi chiesti, in ordine", () => {
  uguale(rigaDiRegistro({ metodo: "GET", rotta: "/api/stato", stato: 200, ms: "12.3" }), "GET /api/stato 200 12.3ms");
});

/* ------------------------------------------------------------------ *
 * PARTE 2 — contro un server Express vero                             *
 * ------------------------------------------------------------------ */

/* Valori che NON devono mai comparire nel log. Sono scritti qui una volta e
   controllati tutti insieme alla fine, così aggiungerne uno nuovo costa una
   riga e vale automaticamente per tutte le richieste già mandate. */
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.token-di-accesso-finto.firma";
const PASSWORD = "password-segretissima-123";
const EMAIL = "mario.rossi@esempio.invalid";
const NOME_FILE = "bolla riservata del cliente.pdf";
const NUMERO_DDT = "4711";
const FORNITORE = "EPIU MATERIALI EDILI";
const ID_COMMESSA = "3f2a9c1e-0000-4444-8888-abcdefabcdef";

const log = [];
const app = express();
app.use(registroRichieste((riga) => log.push(riga)));
app.use(express.json());

// Una rotta come /api/stato: il controllo dell'accesso è nella catena DELLA
// ROTTA, quindi anche un 401 deve sapere qual era la rotta.
const finge401 = (req, res, next) => (req.headers.authorization ? res.status(401).json({ errore: "no" }) : next());
app.get("/api/stato", finge401, (req, res) => res.json({ ok: true }));

app.get("/api/salute", (req, res) => res.json({ ok: true }));
app.post("/api/commesse/:id/allegati", (req, res) => res.status(201).json({ ok: true }));
app.post("/api/login", (req, res) => res.status(401).json({ errore: "no" }));

const router = express.Router();
router.get("/statistiche", (req, res) => res.json({ ok: true }));
app.use("/api/admin", router);
// Un router il cui accesso è negato SUL MONTAGGIO, prima dell'instradamento.
app.use("/api/riservato", (req, res) => res.status(401).json({ errore: "no" }), router);

const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const PORTA = server.address().port;
const BASE = `http://127.0.0.1:${PORTA}`;

/** Il log si scrive su "finish", cioè dopo che il client ha già la risposta:
 *  si aspetta che la riga compaia invece di sperare che ci sia già. */
async function chiama(percorso, opzioni) {
  const quante = log.length;
  await fetch(BASE + percorso, opzioni);
  for (let i = 0; i < 200 && log.length === quante; i++) await new Promise((r) => setTimeout(r, 10));
  return log[log.length - 1];
}

console.log("\nCONTRO UN SERVER VERO");

await prova("una richiesta riuscita compare nel log (prima non compariva affatto)", async () => {
  const riga = await chiama("/api/salute");
  if (!/^GET \/api\/salute 200 \d+\.\d+ms$/.test(riga)) throw new Error(`riga inattesa: "${riga}"`);
});

await prova("la durata è un numero di millisecondi che cresce col tempo speso", async () => {
  const lenta = express();
  const suo = [];
  lenta.use(registroRichieste((r) => suo.push(r)));
  lenta.get("/lenta", (req, res) => setTimeout(() => res.json({ ok: true }), 120));
  const s2 = await new Promise((r) => { const s = lenta.listen(0, () => r(s)); });
  await fetch(`http://127.0.0.1:${s2.address().port}/lenta`);
  for (let i = 0; i < 200 && suo.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => s2.close(r));
  const ms = Number(/(\d+\.\d+)ms$/.exec(suo[0])[1]);
  if (!(ms >= 110)) throw new Error(`una risposta da 120ms ha registrato ${ms}ms`);
});

await prova("l'indirizzo con l'id dentro diventa il modello con :id", async () => {
  const riga = await chiama(`/api/commesse/${ID_COMMESSA}/allegati`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  contiene(riga, "POST /api/commesse/:id/allegati 201");
  nonContiene(riga, ID_COMMESSA, "l'id della commessa");
});

await prova("un 401 dato dalla catena della rotta sa ancora qual era la rotta", async () => {
  const riga = await chiama("/api/stato", { headers: { authorization: `Bearer ${TOKEN}` } });
  contiene(riga, "GET /api/stato 401");
});

await prova("una rotta dentro un router montato si registra col percorso intero", async () => {
  const riga = await chiama("/api/admin/statistiche");
  contiene(riga, "GET /api/admin/statistiche 200");
});

await prova("un accesso negato PRIMA dell'instradamento non inventa una rotta", async () => {
  const riga = await chiama("/api/riservato/statistiche");
  contiene(riga, `GET ${SENZA_ROTTA} 401`);
});

await prova("un 404 non finisce per scrivere l'indirizzo che non esiste", async () => {
  const riga = await chiama("/api/questa-non-esiste/proprio");
  contiene(riga, `GET ${SENZA_ROTTA} 404`);
  nonContiene(riga, "questa-non-esiste", "l'indirizzo inesistente");
});

/* ------------------------------------------------------------------ *
 * PARTE 3 — quello per cui questo file esiste                         *
 * ------------------------------------------------------------------ */

console.log("\nQUELLO CHE NON DEVE MAI FINIRE NEL LOG");

// Una richiesta che porta addosso tutto insieme: token, query string, corpo
// con password ed email, e il nome del file caricato.
await chiama(`/api/commesse/${ID_COMMESSA}/allegati?ddtNumero=${NUMERO_DDT}&fornitore=${encodeURIComponent(FORNITORE)}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${TOKEN}`,
    "x-nome-file": encodeURIComponent(NOME_FILE),
  },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
await chiama("/api/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

const tutto = log.join("\n");

await prova("il token di accesso non compare", () => {
  nonContiene(tutto, TOKEN, "il token");
  nonContiene(tutto, "Bearer", "lo schema di autenticazione");
  nonContiene(tutto.toLowerCase(), "authorization", "l'intestazione Authorization");
});
await prova("la password non compare", () => nonContiene(tutto, PASSWORD, "la password"));
await prova("l'email non compare", () => {
  nonContiene(tutto, EMAIL, "l'email");
  nonContiene(tutto, "mario.rossi", "la parte locale dell'email");
});
await prova("la query string non compare, in nessuna forma", () => {
  nonContiene(tutto, "?", "l'inizio della query string");
  nonContiene(tutto, "ddtNumero", "il nome del parametro");
  nonContiene(tutto, NUMERO_DDT, "il numero del DDT");
  nonContiene(tutto, FORNITORE, "il fornitore");
  nonContiene(tutto, "EPIU", "il fornitore anche a pezzi");
});
await prova("il nome del file caricato non compare", () => {
  nonContiene(tutto, NOME_FILE, "il nome del file");
  nonContiene(tutto, "riservata", "un pezzo del nome del file");
  nonContiene(tutto, ".pdf", "l'estensione del file");
});
await prova("nessun id vero compare, da nessuna parte", () => nonContiene(tutto, ID_COMMESSA, "l'id della commessa"));

await prova("ogni riga registrata ha esattamente i quattro campi previsti", () => {
  for (const riga of log) {
    if (!/^[A-Z]+ (\/[^\s?]*|\(rotta non riconosciuta\)) \d{3} \d+\.\d+ms$/.test(riga)) {
      throw new Error(`riga fuori forma: "${riga}"`);
    }
  }
});

/* Si ASPETTA che il server sia chiuso davvero, e si esce impostando il codice
   invece di chiamare process.exit(): su Windows uscire mentre una maniglia si
   sta ancora chiudendo fa abortire libuv, e un collaudo che passa ma esce con
   un errore è un collaudo che nessuno crederà. */
await new Promise((r) => server.close(r));

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exitCode = falliti === 0 ? 0 : 1;
