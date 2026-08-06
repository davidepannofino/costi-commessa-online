/**
 * Collaudo del catalogo dei piani. Si esegue con:
 *
 *     node src/piani.test.js
 *
 * I casi che contano sono i CONFINI. "Fino a 10 dipendenti" è una frase che si
 * scrive in un listino e si sbaglia in un `if`: dieci ci sta o non ci sta? Qui
 * la risposta è inchiodata, così il giorno che qualcuno tocca la condizione
 * se ne accorge subito invece che dal cliente sbagliato che paga di più.
 */
import {
  PIANI, ORDINE, PIANO_PREDEFINITO, MESI_PAGATI_ANNUALE,
  pianoDi, pianoPerDipendenti, bastaIlPiano, prezzoDi, fatturazioneDi, elencoPiani,
  chiaveListino, daChiaveListino, tutteLeCombinazioni,
} from "./piani.js";

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

/* ------------------------------------------------------------------ */

console.log("\nI CONFINI, UNO PER UNO");

prova("zero persone: il piano più piccolo, nessun consiglio a salire", () => {
  uguale(pianoPerDipendenti(0).id, "cantiere");
});

prova("dieci ci sta ancora in Cantiere, undici no", () => {
  uguale(pianoPerDipendenti(10).id, "cantiere", "con 10");
  uguale(pianoPerDipendenti(11).id, "impresa", "con 11");
});

prova("trenta ci sta ancora in Impresa, trentuno no", () => {
  uguale(pianoPerDipendenti(30).id, "impresa", "con 30");
  uguale(pianoPerDipendenti(31).id, "struttura", "con 31");
});

prova("oltre i trenta si resta su Struttura, non c'è un quarto piano", () => {
  uguale(pianoPerDipendenti(100).id, "struttura");
  uguale(pianoPerDipendenti(10000).id, "struttura");
});

prova("bastaIlPiano risponde sugli stessi confini", () => {
  vero(bastaIlPiano("cantiere", 10), "10 su Cantiere deve bastare");
  vero(!bastaIlPiano("cantiere", 11), "11 su Cantiere NON deve bastare");
  vero(bastaIlPiano("impresa", 30), "30 su Impresa deve bastare");
  vero(!bastaIlPiano("impresa", 31), "31 su Impresa NON deve bastare");
  vero(bastaIlPiano("struttura", 5000), "Struttura non ha tetto");
});

/* ------------------------------------------------------------------ */

console.log("\nI PREZZI (al netto dell'IVA)");

prova("i tre prezzi mensili sono 49, 99 e 179", () => {
  uguale([prezzoDi("cantiere"), prezzoDi("impresa"), prezzoDi("struttura")], [49, 99, 179]);
});

prova("l'annuale è dieci mensilità, non dodici", () => {
  uguale(MESI_PAGATI_ANNUALE, 10);
  uguale(prezzoDi("cantiere", "annuale"), 490);
  uguale(prezzoDi("impresa", "annuale"), 990);
  uguale(prezzoDi("struttura", "annuale"), 1790);
});

prova("l'annuale fa risparmiare esattamente due mesi", () => {
  for (const id of ORDINE) {
    const risparmio = prezzoDi(id, "mensile") * 12 - prezzoDi(id, "annuale");
    uguale(risparmio, PIANI[id].prezzoMensile * 2, `su ${id}`);
  }
});

/* ------------------------------------------------------------------ */

console.log("\nTUTTE LE FUNZIONI SU TUTTI E TRE");

prova("nessun piano porta con sé un elenco di funzioni", () => {
  /* Se un giorno comparisse una chiave tipo `funzioni` o `include`, questa
     prova cade: e' il momento in cui qualcuno sta differenziando i piani, che
     oggi e' esplicitamente fuori dal prodotto. */
  const ammesse = ["id", "nome", "tetto", "prezzoMensile"];
  for (const id of ORDINE) {
    const chiavi = Object.keys(PIANI[id]).sort();
    uguale(chiavi, [...ammesse].sort(), `le chiavi del piano ${id}`);
  }
});

/* ------------------------------------------------------------------ */

console.log("\nLA RETE SUI VALORI STORTI");

prova("una colonna vuota vale come piano più piccolo", () => {
  uguale(pianoDi(null).id, PIANO_PREDEFINITO);
  uguale(pianoDi(undefined).id, PIANO_PREDEFINITO);
  uguale(pianoDi("").id, PIANO_PREDEFINITO);
});

prova("un piano che non esiste non fa esplodere niente", () => {
  uguale(pianoDi("piano-inventato").id, PIANO_PREDEFINITO);
  uguale(pianoDi(42).id, PIANO_PREDEFINITO);
});

prova("maiuscole e spazi non contano", () => {
  uguale(pianoDi("  IMPRESA  ").id, "impresa");
  uguale(fatturazioneDi(" Annuale "), "annuale");
});

prova("una fatturazione sconosciuta vale mensile", () => {
  uguale(fatturazioneDi("trimestrale"), "mensile");
  uguale(fatturazioneDi(null), "mensile");
});

prova("un numero di persone assurdo non manda in Struttura per sbaglio", () => {
  uguale(pianoPerDipendenti(NaN).id, "cantiere");
  uguale(pianoPerDipendenti(null).id, "cantiere");
  uguale(pianoPerDipendenti(-5).id, "cantiere");
});

/* ------------------------------------------------------------------ */

console.log("\nIL CATALOGO DA MOSTRARE");

prova("elencoPiani è ordinato dal più piccolo e porta anche il prezzo annuale", () => {
  const e = elencoPiani();
  uguale(e.map((p) => p.id), ORDINE);
  uguale(e.map((p) => p.prezzoAnnuale), [490, 990, 1790]);
  uguale(e.map((p) => p.tetto), [10, 30, null]);
});

/* ------------------------------------------------------------------ */

console.log("\nLA CHIAVE DI LISTINO (il lookup_key su Stripe)");

prova("si scrive piano_periodicità", () => {
  uguale(chiaveListino("cantiere", "mensile"), "cantiere_mensile");
  uguale(chiaveListino("impresa", "annuale"), "impresa_annuale");
  uguale(chiaveListino("struttura", "mensile"), "struttura_mensile");
});

prova("le sei chiavi sono sei, tutte diverse", () => {
  const c = tutteLeCombinazioni();
  uguale(c.length, 6);
  uguale(new Set(c.map((x) => x.chiave)).size, 6, "chiavi distinte");
});

prova("andata e ritorno: ogni chiave si rilegge esattamente com'è stata scritta", () => {
  /* È la proprietà che tiene in piedi tutto: il webhook capisce quale piano è
     stato comprato SOLO se questa funzione sa rileggere quello che l'altra ha
     scritto. Se qualcuno cambia il formato da una parte sola, qui cade. */
  for (const { piano, fatturazione, chiave } of tutteLeCombinazioni()) {
    uguale(daChiaveListino(chiave), { piano, fatturazione }, `andata e ritorno su ${chiave}`);
  }
});

prova("la chiave porta con sé il prezzo giusto e l'intervallo giusto", () => {
  const c = tutteLeCombinazioni();
  const impresaAnno = c.find((x) => x.chiave === "impresa_annuale");
  uguale(impresaAnno.euro, 990);
  uguale(impresaAnno.intervallo, "year");
  const cantiereMese = c.find((x) => x.chiave === "cantiere_mensile");
  uguale(cantiereMese.euro, 49);
  uguale(cantiereMese.intervallo, "month");
});

prova("una chiave che non si riconosce NON diventa un piano", () => {
  /* Nessun ripiego che afferma (PRODUCT.md). Qui un'ipotesi vorrebbe dire
     scrivere nel database che un'azienda ha comprato una cosa che non ha
     comprato. */
  for (const storta of ["", "cantiere", "cantiere_", "_mensile", "vip_mensile",
                        "cantiere_trimestrale", "cantiere_mensile_extra", null, undefined, 42]) {
    uguale(daChiaveListino(storta), null, `con ${JSON.stringify(storta)}`);
  }
});

prova("maiuscole e spazi non impediscono di riconoscere una chiave", () => {
  uguale(daChiaveListino("  IMPRESA_ANNUALE  "), { piano: "impresa", fatturazione: "annuale" });
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exitCode = falliti === 0 ? 0 : 1;
