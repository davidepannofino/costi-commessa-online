/**
 * Collaudo della freschezza di una scheda. Si esegue con:
 *
 *     node src/freschezza.test.js
 *
 * LA PROVA CHE CONTA e' la prima: senza If-Match non si blocca niente.
 *
 * Non e' una cortesia verso i client distratti, e' la regola in cima a
 * schema.sql spostata dall'SQL all'API — il codice nuovo deve restare sicuro
 * per la versione precedente del client. Backend e frontend sono due servizi
 * separati su Render e non vanno in linea insieme; se l'assenza
 * dell'intestazione fosse un errore, per tutta la finestra fra le due
 * pubblicazioni — e per tutto il tempo in cui un browser si tiene in cache il
 * pacchetto vecchio — NESSUNO potrebbe salvare.
 */
import { schedaVecchia } from "./freschezza.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
function falso(c, m) { if (c) throw new Error(m); }

/* ================================================================== */

console.log("\n1. SENZA If-Match NON SI BLOCCA NIENTE");

prova("LA PROVA CHE CONTA: il client vecchio salva come prima", () => {
  /* Il frontend di ieri non manda l'intestazione. Se questa prova cade, nella
     finestra fra le due pubblicazioni nessuno puo' piu' salvare. */
  for (const assente of [undefined, null, "", "   ", "\t"]) {
    falso(schedaVecchia(assente, 7), `«${JSON.stringify(assente)}» non deve bloccare`);
  }
});

prova("nemmeno quando la versione nel database e' andata avanti", () => {
  falso(schedaVecchia(undefined, 999), "senza dichiarazione non c'e' condizione");
  falso(schedaVecchia(null, 0), "nemmeno a versione zero");
});

prova("l'asterisco vuol dire «purche' esista», e esiste sempre", () => {
  falso(schedaVecchia("*", 7), "* non blocca");
  falso(schedaVecchia('"*"', 7), "nemmeno fra virgolette");
});

/* ================================================================== */

console.log("\n2. CON If-Match VECCHIO SI BLOCCA");

prova("una versione superata e' una scheda vecchia", () => {
  vero(schedaVecchia("3", 7), "3 contro 7");
  vero(schedaVecchia("0", 1), "la prima scrittura basta");
  vero(schedaVecchia("8", 7), "anche una piu' alta: quello che conta e' che sia diversa");
});

prova("la versione giusta passa", () => {
  falso(schedaVecchia("7", 7), "7 contro 7");
  falso(schedaVecchia("0", 0), "zero contro zero");
});

/* ================================================================== */

console.log("\n3. L'ETag SI RIMANDA COM'E' ARRIVATO");

prova("virgolette e validatore debole non cambiano il giudizio", () => {
  /* La GET manda ETag: "7". Un client che lo rimanda tale e quale non deve
     trovarsi rifiutato per una virgoletta. */
  falso(schedaVecchia('"7"', 7), "fra virgolette");
  falso(schedaVecchia('W/"7"', 7), "validatore debole");
  falso(schedaVecchia(' "7" ', 7), "con spazi attorno");
  vero(schedaVecchia('"3"', 7), "e una vecchia resta vecchia");
});

prova("il confronto e' fra testi, non fra numeri", () => {
  /* La versione e' un BIGINT: oltre i 2^53 un confronto numerico in JavaScript
     comincerebbe a dire che due versioni diverse sono uguali. */
  vero(schedaVecchia("9007199254740993", "9007199254740992"), "due bigint vicini restano diversi");
  falso(schedaVecchia("9007199254740993", "9007199254740993"), "e uguali se lo sono");
});

/* ================================================================== */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
