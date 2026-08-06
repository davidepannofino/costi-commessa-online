/**
 * Collaudo delle etichette di stato dell'abbonamento. Si esegue con:
 *
 *     node src/statoAbbonamento.test.js
 *
 * LA PROVA CHE CONTA è quella su `esente`. Il 6 agosto 2026 la barra laterale
 * scriveva «Abbonamento scaduto» sotto il nome di un'azienda esente, mentre a
 * due centimetri di distanza il pannello diceva «Accesso illimitato». Non era
 * un refuso: era un ramo finale che catturava tutto quello che non aveva
 * trovato posto prima. Se qualcuno riscrive quella forma, qui suona la sveglia.
 */
import { descriviAbbonamento, STATI_ABBONAMENTO } from "./statoAbbonamento.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che} atteso ${b}, avuto ${a}`);
}
function vero(c, m) { if (!c) throw new Error(m); }

/* Gli stati che calcolaStatoAccesso può restituire, in
   backend/src/abbonamento.js. Scritti a mano perché il frontend non può
   importare il backend: se là ne nasce un quinto, questa lista va aggiornata
   e la prova qui sotto lo pretende. */
const STATI_DAL_SERVER = ["esente", "attivo", "prova", "scaduto", "in_ritardo"];

/* ------------------------------------------------------------------ */

console.log("\nOGNI STATO CHE IL SERVER PUÒ MANDARE HA LA SUA ETICHETTA");

prova("tutti e quattro sono nella mappa", () => {
  for (const s of STATI_DAL_SERVER) {
    vero(STATI_ABBONAMENTO[s], `manca lo stato "${s}"`);
  }
  uguale(Object.keys(STATI_ABBONAMENTO).sort(), [...STATI_DAL_SERVER].sort(),
    "la mappa e gli stati del server");
});

prova("ogni etichetta è piena e diversa dalle altre", () => {
  const etichette = STATI_DAL_SERVER.map((s) => descriviAbbonamento({ stato: s }).etichetta);
  for (const e of etichette) vero(typeof e === "string" && e.trim().length > 0, `etichetta vuota: ${JSON.stringify(e)}`);
  uguale(new Set(etichette).size, etichette.length, "due stati non possono chiamarsi uguale");
});

prova("ogni stato porta anche tono e icona", () => {
  for (const s of STATI_DAL_SERVER) {
    const d = descriviAbbonamento({ stato: s });
    vero(d.tono, `manca il tono su "${s}"`);
    vero(d.icona, `manca l'icona su "${s}"`);
    uguale(d.stato, s, "lo stato torna indietro insieme alla descrizione");
  }
});

/* ------------------------------------------------------------------ */

console.log("\nIL CASO CHE HA PRODOTTO IL BUG");

prova("un account ESENTE non contiene mai la parola «scaduto»", () => {
  const d = descriviAbbonamento({ stato: "esente" });
  uguale(d.etichetta, "Accesso illimitato");
  vero(!/scadut/i.test(d.etichetta), `l'etichetta dell'esente dice «${d.etichetta}»`);
  vero(d.tono !== "errore", "un accesso illimitato non è un errore");
});

prova("nessuno stato che ha accesso viene raccontato come scaduto", () => {
  /* "scaduto" è l'UNICO stato a cui quella parola può appartenere. Se domani
     ne comparisse un'altra qui, vorrebbe dire che un ramo di ripiego è tornato. */
  for (const s of ["esente", "attivo", "prova"]) {
    vero(!/scadut|terminat/i.test(descriviAbbonamento({ stato: s }).etichetta),
      `lo stato "${s}" viene raccontato come finito`);
  }
});

/* ------------------------------------------------------------------ */

console.log("\nNESSUN RIPIEGO CHE AFFERMA");

prova("uno stato sconosciuto non diventa nessuno stato noto", () => {
  for (const inventato of ["sospeso", "boh", "ATTIVO_", "0"]) {
    uguale(descriviAbbonamento({ stato: inventato }), null, `con stato "${inventato}"`);
  }
});

prova("info non ancora caricata: nessuna etichetta, non «prova» e non «scaduto»", () => {
  uguale(descriviAbbonamento(null), null);
  uguale(descriviAbbonamento(undefined), null);
  uguale(descriviAbbonamento({}), null);
  uguale(descriviAbbonamento({ stato: "" }), null);
});

prova("la mappa non ha una voce di ripiego nascosta", () => {
  /* Un "default", un "ignoto", un "altro" dentro la mappa sarebbe lo stesso
     ripiego di prima travestito da riga di tabella. */
  for (const chiave of Object.keys(STATI_ABBONAMENTO)) {
    vero(STATI_DAL_SERVER.includes(chiave), `la mappa contiene "${chiave}", che il server non manda mai`);
  }
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exitCode = falliti === 0 ? 0 : 1;
