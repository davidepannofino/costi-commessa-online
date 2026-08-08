/**
 * Collaudo dei buchi nei dati. Si esegue con:
 *
 *     node src/buchiNeiDati.test.js
 *
 * LA PROVA CHE CONTA è «lordo senza ore»: è il caso che nessun altro pezzo del
 * prodotto vede. L'invariante somma i lordi dei soli dipendenti CON ore, quindi
 * uno stipendio senza ore esce da tutt'e due i lati e il timbro resta verde
 * mentre il costo del mese è più basso del vero di quella cifra esatta. Se
 * qualcuno togliesse questo modulo, quel buco tornerebbe invisibile.
 */
import {
  buchiNeiDati, cSonoBuchiNeiDati, euro, meseEsteso, mesiDaGuardare,
  ORE_SENZA_LORDO, LORDO_SENZA_ORE,
} from "./buchiNeiDati.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che}\n         atteso ${b}\n         avuto  ${a}`);
}

/** Costruttori brevi, per non ripetere la forma dei dati a ogni prova. */
const dip = (id, nome, lordoMensile = {}, archiviato = false) =>
  ({ id, nome, cognome: "Rossi", lordoMensile, archiviato });
const ore = (coppie) => new Map(Object.entries(coppie));
const tipiDi = (r) => r.map((o) => o.tipo);

/* ================================================================== */

console.log("\n1. QUANDO NON C'È NIENTE, NON SI DICE NIENTE");

prova("dati completi: nessuna osservazione", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 2400 })],
    oreMensili: ore({ "e1|2026-07": 160 }),
    mesi: ["2026-07"],
  });
  uguale(r, [], "un mese a posto non deve produrre niente");
  uguale(cSonoBuchiNeiDati({ dipendenti: [dip("e1", "Mario", { "2026-07": 2400 })], oreMensili: ore({ "e1|2026-07": 160 }), mesi: ["2026-07"] }), false, "né la scorciatoia");
});

prova("nessun dipendente, nessuna ora, nessun mese: niente, senza esplodere", () => {
  uguale(buchiNeiDati({}), [], "chiamata a vuoto");
  uguale(buchiNeiDati({ dipendenti: [], oreMensili: new Map(), mesi: [] }), [], "tutto vuoto");
  uguale(buchiNeiDati({ dipendenti: [dip("e1", "Mario")], oreMensili: null, mesi: ["2026-07"] }), [], "senza mappa delle ore");
});

/* ================================================================== */

console.log("\n2. LORDO SENZA ORE — il buco che l'invariante non vede");

prova("un lordo senza ore viene trovato, con la cifra esatta", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 2400 })],
    oreMensili: ore({}),
    mesi: ["2026-07"],
  });
  uguale(tipiDi(r), [LORDO_SENZA_ORE], "il tipo");
  uguale(r[0].importo, 2400, "l'importo che manca ai totali");
  vero(/non è su nessuna commessa/.test(r[0].testo), `testo inatteso: ${r[0].testo}`);
  vero(r[0].testo.includes("Mario"), "il nome serve a sapere quale riga aprire");
});

prova("più lordi senza ore si accorpano in una sola osservazione", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 2400 }), dip("e2", "Anna", { "2026-07": 2000 })],
    oreMensili: ore({}),
    mesi: ["2026-07"],
  });
  uguale(r.length, 1, "una sola osservazione, non una per persona");
  uguale(r[0].importo, 4400, "la somma");
  uguale(r[0].persone.length, 2, "e dentro ci sono tutte, per la provenienza");
  vero(/2 lordi/.test(r[0].testo), `testo inatteso: ${r[0].testo}`);
});

prova("un lordo a ZERO senza ore non è un buco", () => {
  /* Zero non toglie niente a nessun totale: non c'è niente da dire, e dirlo
     sarebbe il ripiego che afferma. */
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 0 })],
    oreMensili: ore({}),
    mesi: ["2026-07"],
  });
  uguale(r, [], "zero non si segnala");
});

/* ================================================================== */

console.log("\n3. ORE SENZA LORDO");

prova("ore senza lordo: le ore valgono 0 € e lo si dice", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Adriano", {})],
    oreMensili: ore({ "e1|2026-05": 12 }),
    mesi: ["2026-05"],
  });
  uguale(tipiDi(r), [ORE_SENZA_LORDO], "il tipo");
  uguale(r[0].ore, 12, "le ore in gioco");
  vero(/valgono 0 €/.test(r[0].testo), `testo inatteso: ${r[0].testo}`);
});

prova("più persone senza lordo si accorpano, con le ore sommate", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Adriano", {}), dip("e2", "Andrea", {})],
    oreMensili: ore({ "e1|2026-05": 12, "e2|2026-05": 9 }),
    mesi: ["2026-05"],
  });
  uguale(r.length, 1, "una sola osservazione");
  uguale(r[0].ore, 21, "la somma delle ore");
  vero(/2 persone/.test(r[0].testo), `testo inatteso: ${r[0].testo}`);
});

prova("un lordo scritto a ZERO con delle ore NON è «ore senza lordo»", () => {
  /* Coerenza esatta con tariffaOraria in App.jsx, che guarda `lordo == null`:
     uno zero è un valore deciso da qualcuno, non un dato che manca. Se questo
     modulo la pensasse diversamente, due punti del prodotto direbbero due cose
     su una riga sola. */
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 0 })],
    oreMensili: ore({ "e1|2026-07": 160 }),
    mesi: ["2026-07"],
  });
  uguale(r, [], "uno zero deciso non è un buco");
});

/* ================================================================== */

console.log("\n4. IL PERIMETRO");

prova("solo i mesi che si stanno guardando", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-06": 2400 })],
    oreMensili: ore({ "e1|2026-05": 10 }),
    mesi: ["2026-07"],
  });
  uguale(r, [], "un buco fuori periodo non si segnala");
});

prova("gli archiviati contano come tutti gli altri", () => {
  /* Un ex dipendente con un buco a marzo falsa marzo esattamente come chiunque
     altro: i costi delle commesse passate non cambiano perché una persona se
     n'è andata. */
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Ex", { "2026-03": 1800 }, true)],
    oreMensili: ore({}),
    mesi: ["2026-03"],
  });
  uguale(tipiDi(r), [LORDO_SENZA_ORE], "l'archiviato non è invisibile");
});

prova("la stessa persona può avere i due buchi in due mesi diversi", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-06": 2400 })],
    oreMensili: ore({ "e1|2026-07": 150 }),
    mesi: ["2026-06", "2026-07"],
  });
  uguale(r.length, 2, "due osservazioni, una per mese");
  uguale(tipiDi(r), [ORE_SENZA_LORDO, LORDO_SENZA_ORE], "luglio (ore senza lordo) prima di giugno");
});

/* ================================================================== */

console.log("\n5. L'ORDINE");

prova("i mesi recenti vengono prima", () => {
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-05": 1000, "2026-07": 2000 })],
    oreMensili: ore({}),
    mesi: ["2026-05", "2026-07"],
  });
  uguale(r.map((o) => o.mese), ["2026-07", "2026-05"], "dal più recente");
});

prova("dentro lo stesso mese, «lordo senza ore» viene prima", () => {
  /* È l'unico dei due di cui si sappia QUANTO manca al totale: l'altro toglie
     una cifra che, mancando il lordo, nessuno può quantificare. */
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 2400 }), dip("e2", "Adriano", {})],
    oreMensili: ore({ "e2|2026-07": 12 }),
    mesi: ["2026-07"],
  });
  uguale(tipiDi(r), [LORDO_SENZA_ORE, ORE_SENZA_LORDO], "prima quello quantificabile");
});

/* ================================================================== */

console.log("\n6. LE REGOLE DI PRODUCT.md");

prova("8.574,00 € — il punto delle migliaia anche sotto le cinque cifre", () => {
  /* PRODUCT.md:135. Questo modulo ha un suo Intl invece di importarlo da
     App.jsx, perché deve girare senza browser: questa prova è ciò che rende la
     ripetizione sicura invece che rischiosa. */
  uguale(euro(8574), "8.574,00 €", "la cifra della regola");
  uguale(euro(999.5), "999,50 €", "sotto il migliaio");
  uguale(euro(12574), "12.574,00 €", "sopra");
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 8574 })],
    oreMensili: ore({}),
    mesi: ["2026-07"],
  });
  vero(r[0].testo.includes("8.574,00 €"), `la frase deve portare il formato giusto: ${r[0].testo}`);
});

prova("ogni frase porta una cifra: si parla di numeri, non di persone", () => {
  /* Principio 7. Non è una prova sulla delicatezza: è la forma della frase. Il
     soggetto deve essere sempre un numero — un lordo che manca, ore che valgono
     zero — e mai come qualcuno lavora. Una frase senza nessuna cifra dentro
     starebbe descrivendo qualcos'altro. */
  const r = buchiNeiDati({
    dipendenti: [dip("e1", "Mario", { "2026-07": 2400 }), dip("e2", "Adriano", {})],
    oreMensili: ore({ "e2|2026-07": 12 }),
    mesi: ["2026-07"],
  });
  vero(r.length > 0, "servono osservazioni da guardare");
  for (const o of r) {
    vero(/\d/.test(o.testo), `frase senza cifre: ${o.testo}`);
    vero(o.persone.length > 0, "la provenienza dev'esserci sempre");
  }
});

prova("i mesi si scrivono per esteso, non 2026-07", () => {
  uguale(meseEsteso("2026-07"), "luglio 2026", "luglio");
  uguale(meseEsteso("2026-01"), "gennaio 2026", "gennaio");
  uguale(meseEsteso("2026-12"), "dicembre 2026", "dicembre");
});

/* ================================================================== */

console.log("\n7. I MESI DA GUARDARE: UN BUCO, NON UN BORDO");

prova("senza mesi con ore non c'è nessun «in mezzo»", () => {
  uguale(mesiDaGuardare([]), [], "elenco vuoto");
  uguale(mesiDaGuardare(null), [], "null");
  uguale(mesiDaGuardare(undefined), [], "undefined");
});

prova("un mese solo resta un mese solo", () => {
  uguale(mesiDaGuardare(["2026-07"]), ["2026-07"], "niente da riempire");
});

prova("due mesi adiacenti non inventano niente in mezzo", () => {
  uguale(mesiDaGuardare(["2026-06", "2026-07"]), ["2026-06", "2026-07"], "adiacenti");
});

prova("un mese vuoto in mezzo viene riempito", () => {
  uguale(mesiDaGuardare(["2026-06", "2026-08"]), ["2026-06", "2026-07", "2026-08"], "luglio entra");
});

prova("più mesi vuoti di fila, e l'ingresso disordinato non conta", () => {
  uguale(mesiDaGuardare(["2026-09", "2026-05"]),
    ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"], "quattro buchi");
});

prova("la campata attraversa il cambio d'anno", () => {
  uguale(mesiDaGuardare(["2025-11", "2026-02"]),
    ["2025-11", "2025-12", "2026-01", "2026-02"], "novembre-febbraio");
});

prova("I BORDI NON SI ESTENDONO MAI", () => {
  /* È la metà della regola che evita il rumore: fuori dalla campata non si
     guarda, comunque siano scritti i lordi. */
  const c = mesiDaGuardare(["2026-06", "2026-07"]);
  vero(!c.includes("2026-05"), "niente prima del primo mese con ore");
  vero(!c.includes("2026-08"), "niente dopo l'ultimo");
});

prova("i valori malformati non entrano e non fanno esplodere niente", () => {
  uguale(mesiDaGuardare(["2026-13", "pippo", "", null, "2026-07"]), ["2026-07"], "solo quello valido");
  uguale(mesiDaGuardare(["2026-00", "2026-1"]), [], "mese fuori scala o senza zero");
});

prova("IL RITAGLIO: la campata si misura su tutto, si riporta solo il periodo", () => {
  /* È il caso della vista mensile, che è quella che si usa. Guardando luglio
     da solo, sono giugno e agosto — fuori dal periodo ma dentro i dati — a
     dire che luglio sta in mezzo. Senza questo, la regola non scatterebbe mai
     dove serve. */
  const conOre = ["2026-06", "2026-08"];
  uguale(mesiDaGuardare(conOre, { da: "2026-07", a: "2026-07" }), ["2026-07"],
    "luglio è in mezzo, e si riporta solo luglio");
  uguale(mesiDaGuardare(conOre, { da: "2026-06", a: "2026-08" }), ["2026-06", "2026-07", "2026-08"],
    "guardando tutto il periodo, tutta la campata");
});

prova("il ritaglio non estende: un mese fuori campata resta fuori anche se guardato", () => {
  uguale(mesiDaGuardare(["2026-06", "2026-07"], { da: "2026-05", a: "2026-05" }), [],
    "maggio è un bordo: guardarlo non lo rende un buco");
  uguale(mesiDaGuardare(["2026-06", "2026-07"], { da: "2026-01", a: "2026-12" }), ["2026-06", "2026-07"],
    "un periodo largo non inventa mesi");
});

prova("estremi assenti o malformati: si guarda tutta la campata", () => {
  const c = ["2026-06", "2026-07"];
  uguale(mesiDaGuardare(c), c, "senza estremi");
  uguale(mesiDaGuardare(c, {}), c, "oggetto vuoto");
  uguale(mesiDaGuardare(c, { da: "pippo", a: null }), c, "estremi da buttare");
});

prova("IL CASO CHE CONTA: un mese interamente vuoto in mezzo viene trovato", () => {
  /* Nessuno ha registrato niente a luglio, ma i lordi ci sono: stipendi che
     non finiscono su nessuna commessa. Senza mesiDaGuardare luglio non
     entrerebbe nemmeno fra i mesi guardati, e questo modulo sarebbe cieco
     proprio dove il guasto è totale. */
  const dipendenti = [dip("e1", "Mario", { "2026-06": 2400, "2026-07": 2400, "2026-08": 2400 })];
  const oreMensili = ore({ "e1|2026-06": 160, "e1|2026-08": 150 });
  const mesi = mesiDaGuardare(["2026-06", "2026-08"]);
  uguale(mesi, ["2026-06", "2026-07", "2026-08"], "luglio deve entrare");
  const r = buchiNeiDati({ dipendenti, oreMensili, mesi });
  uguale(tipiDi(r), [LORDO_SENZA_ORE], "e deve produrre il buco");
  uguale(r[0].mese, "2026-07", "proprio luglio");
  uguale(r[0].importo, 2400, "lo stipendio che manca ai totali");
});

prova("E IL SUO OPPOSTO: lo stesso mese vuoto, ma di bordo, tace", () => {
  /* Maggio è prima che l'azienda cominciasse a usare il programma: un lordo
     scritto lì non è un dato che manca. */
  const dipendenti = [dip("e1", "Mario", { "2026-05": 2400, "2026-06": 2400 })];
  const oreMensili = ore({ "e1|2026-06": 160 });
  const mesi = mesiDaGuardare(["2026-06"]);
  uguale(mesi, ["2026-06"], "maggio resta fuori dalla campata");
  uguale(buchiNeiDati({ dipendenti, oreMensili, mesi }), [], "e non si segnala niente");
});

/* ================================================================== */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
