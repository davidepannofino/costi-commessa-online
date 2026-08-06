/**
 * Collaudo di "chi si vede dove". Si esegue con:
 *
 *     node src/dipendentiVisibili.test.js
 *
 * LA PROVA CHE CONTA è quella sull'editor di una registrazione. Un <select> il
 * cui valore non è fra le opzioni non protesta: mostra la prima della lista, e
 * al salvataggio le ore cambiano proprietario in silenzio. È l'unico errore di
 * questo lavoro che nessuno vedrebbe mai — i conti tornerebbero lo stesso.
 */
import {
  eArchiviato, soloAttivi, perModificaDi, perElenco,
  oreRegistrateDi, azionePerTogliere,
} from "./dipendentiVisibili.js";

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

const ANNA  = { id: "e1", nome: "Anna",  cognome: "Bianchi", lordoMensile: {} };
const BRUNO = { id: "e2", nome: "Bruno", cognome: "Conti",   lordoMensile: {}, archiviato: true };
const CARLA = { id: "e3", nome: "Carla", cognome: "Dossi",   lordoMensile: {}, archiviato: false };
const TUTTI = [ANNA, BRUNO, CARLA];

const ORE = [
  { id: "r1", dipendenteId: "e2", commessaId: "c1", data: "2026-06-03", ore: 8 },
  { id: "r2", dipendenteId: "e2", commessaId: "c1", data: "2026-06-04", ore: 8 },
  { id: "r3", dipendenteId: "e1", commessaId: "c1", data: "2026-07-01", ore: 6 },
];

/* ------------------------------------------------------------------ */

console.log("\nCHI È ARCHIVIATO");

prova("solo un true esplicito archivia", () => {
  vero(eArchiviato(BRUNO), "Bruno ha archiviato: true");
  vero(!eArchiviato(CARLA), "Carla ha archiviato: false");
  vero(!eArchiviato(ANNA), "Anna non ha proprio il campo");
});

prova("un dipendente da un backup vecchio (senza il campo) è ATTIVO", () => {
  /* Se il campo mancante valesse "archiviato", ripristinare un backup fatto
     prima di oggi farebbe sparire tutta l'azienda dagli elenchi in un colpo. */
  const daBackupVecchio = { id: "x", nome: "Dario", cognome: "Este", lordoMensile: {} };
  uguale(soloAttivi([daBackupVecchio]).length, 1, "dipendenti attivi");
});

prova("valori strani non archiviano per sbaglio", () => {
  for (const v of ["true", 1, "si", {}, []]) {
    vero(!eArchiviato({ id: "z", archiviato: v }), `archiviato: ${JSON.stringify(v)} non deve archiviare`);
  }
});

/* ------------------------------------------------------------------ */

console.log("\nGLI ELENCHI DOVE SI INSERISCONO LE ORE");

prova("gli attivi escludono l'archiviato", () => {
  uguale(soloAttivi(TUTTI).map((d) => d.id), ["e1", "e3"], "attivi");
});

prova("una lista vuota o assente non fa esplodere niente", () => {
  uguale(soloAttivi([]), []);
  uguale(soloAttivi(undefined), []);
  uguale(soloAttivi(null), []);
});

prova("l'elenco Dipendenti mostra gli archiviati solo se richiesto", () => {
  uguale(perElenco(TUTTI, false).map((d) => d.id), ["e1", "e3"], "senza archiviati");
  uguale(perElenco(TUTTI, true).map((d) => d.id), ["e1", "e2", "e3"], "con archiviati");
});

/* ------------------------------------------------------------------ */

console.log("\nL'EDITOR DI UNA REGISTRAZIONE — la trappola silenziosa");

prova("APRENDO LE ORE DI UN ARCHIVIATO, l'archiviato è fra le opzioni", () => {
  const opzioni = perModificaDi(TUTTI, "e2");
  vero(opzioni.some((d) => d.id === "e2"),
    "Bruno è archiviato ma quelle ore sono sue: senza di lui il campo mostrerebbe Anna");
});

prova("...e il valore selezionato corrisponde davvero a un'opzione", () => {
  /* È la condizione esatta che rende sicuro un <select>. Se cade, il browser
     ripiega sulla prima opzione e nessuno se ne accorge. */
  for (const dip of TUTTI) {
    const opzioni = perModificaDi(TUTTI, dip.id);
    vero(opzioni.some((d) => d.id === dip.id), `il valore ${dip.id} non è fra le opzioni`);
  }
});

prova("l'archiviato entra solo per la riga che è sua, non per le altre", () => {
  uguale(perModificaDi(TUTTI, "e1").map((d) => d.id), ["e1", "e3"],
    "aprendo una riga di Anna, Bruno non deve comparire");
});

prova("l'archiviato tenuto dentro va IN CODA, non mischiato agli attivi", () => {
  uguale(perModificaDi(TUTTI, "e2").map((d) => d.id), ["e1", "e3", "e2"], "ordine delle opzioni");
});

prova("un id che non esiste più non inventa nessuna opzione", () => {
  uguale(perModificaDi(TUTTI, "sparito").map((d) => d.id), ["e1", "e3"], "opzioni");
});

prova("senza nessuna persona scelta è la lista degli attivi", () => {
  uguale(perModificaDi(TUTTI, null).map((d) => d.id), ["e1", "e3"], "opzioni");
  uguale(perModificaDi(TUTTI, "").map((d) => d.id), ["e1", "e3"], "opzioni");
});

/* ------------------------------------------------------------------ */

console.log("\nARCHIVIARE O CANCELLARE");

prova("chi ha ore si archivia, chi non ne ha si cancella", () => {
  uguale(azionePerTogliere(ORE, "e2"), "archivia", "Bruno ha 2 registrazioni");
  uguale(azionePerTogliere(ORE, "e1"), "archivia", "Anna ha 1 registrazione");
  uguale(azionePerTogliere(ORE, "e3"), "elimina", "Carla non ne ha nessuna");
});

prova("le ore si contano su quelle che il browser sta per risalvare", () => {
  uguale(oreRegistrateDi(ORE, "e2"), 2);
  uguale(oreRegistrateDi(ORE, "e3"), 0);
  uguale(oreRegistrateDi([], "e2"), 0);
});

prova("un archiviato che ha ancora ore NON diventa cancellabile", () => {
  /* Archiviare non toglie ore: se domani qualcuno leggesse "archiviato"
     come "si può buttare", tornerebbe il problema di partenza. */
  uguale(azionePerTogliere(ORE, BRUNO.id), "archivia", "Bruno è archiviato ma ha 2 registrazioni");
});

/* ------------------------------------------------------------------ */

console.log("\nQUELLO CHE NON DEVE SUCCEDERE MAI");

prova("nessuna funzione qui dentro tocca le registrazioni", () => {
  const copia = JSON.parse(JSON.stringify(ORE));
  soloAttivi(TUTTI); perModificaDi(TUTTI, "e2"); perElenco(TUTTI, true);
  azionePerTogliere(ORE, "e2"); oreRegistrateDi(ORE, "e2");
  uguale(ORE, copia, "le registrazioni");
});

prova("nessuna funzione qui dentro modifica la lista che riceve", () => {
  const copia = JSON.parse(JSON.stringify(TUTTI));
  soloAttivi(TUTTI); perModificaDi(TUTTI, "e2"); perElenco(TUTTI, false);
  uguale(TUTTI, copia, "i dipendenti");
});

/* ------------------------------------------------------------------ */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
