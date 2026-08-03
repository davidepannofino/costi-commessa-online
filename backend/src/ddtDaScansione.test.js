/**
 * Collaudo della lettura delle caselle di una scansione. Si esegue con:
 *
 *     node src/ddtDaScansione.test.js
 *
 * Niente database, niente rete: ddtDaScansione.js è tutto funzioni pure, ed è
 * scritto così apposta per poterlo inchiodare qui.
 *
 * I casi che valgono di più sono quelli che NON devono passare: il codice che
 * non esiste, la casella vuota, il doppione. Il giorno che qualcuno allarga le
 * maglie per far tornare un caso comodo, qui suona la sveglia — e la regola che
 * si sta allargando è "se non capisce, non inventa".
 */
import { normalizza, dividiCasella, leggiCasella, leggiScansione } from "./ddtDaScansione.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try {
    fn();
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

/* L'anagrafica di prova: i tre codici visti in una scansione vera, più uno che
   serve a mettere alla prova il caso ambiguo della O e dello zero. */
const COMMESSE = [
  { id: "c1", codice: "PD02", descrizione: "Villa Rossi" },
  { id: "c2", codice: "PC24", descrizione: "Capannone" },
  { id: "c3", codice: "PC18", descrizione: "Bagno Ferretti" },
];

console.log("\nNORMALIZZAZIONE — un metro solo per tutti i confronti");

prova("via gli spazi, tutto maiuscolo", () => {
  uguale(normalizza("  pc24 "), "PC24");
  uguale(normalizza("B05 / 4959"), "B05/4959");
  uguale(normalizza(null), "");
});

prova("la casella si spacca al PRIMO spazio, il resto è tutto numero", () => {
  uguale(dividiCasella("PC24 B05/4959"), { codice: "PC24", numero: "B05/4959" });
  uguale(dividiCasella("PC24 B05 / 4959"), { codice: "PC24", numero: "B05/4959" });
  uguale(dividiCasella("  pc24  b05/4959 "), { codice: "PC24", numero: "B05/4959" });
});

console.log("\nI SETTE CASI CONCORDATI");

prova('"PC24 B05/4959" → PC24 + B05/4959, riga a posto', () => {
  const r = leggiCasella("PC24 B05/4959", COMMESSE);
  uguale([r.stato, r.codiceLetto, r.numero, r.commessaId], ["ok", "PC24", "B05/4959", "c2"]);
  uguale(r.suggerimento, null);
});

prova('"PC24 B05 / 4959" → gli spazi dentro il numero non contano', () => {
  const r = leggiCasella("PC24 B05 / 4959", COMMESSE);
  uguale([r.stato, r.numero], ["ok", "B05/4959"]);
});

prova('"  pc24  b05/4959 " → minuscole e spazi di troppo non contano', () => {
  const r = leggiCasella("  pc24  b05/4959 ", COMMESSE);
  uguale([r.stato, r.codiceLetto, r.numero, r.commessaId], ["ok", "PC24", "B05/4959", "c2"]);
});

prova('"PD02" → un pezzo solo: commessa sì, numero mancante, da controllare', () => {
  const r = leggiCasella("PD02", COMMESSE);
  uguale([r.stato, r.codiceLetto, r.numero, r.commessaId], ["daControllare", "PD02", "", "c1"]);
  uguale(r.motivo, "manca il numero del DDT");
});

prova('"PDO2 B05/4711" → da controllare, ma suggerisce PD02 (O contro zero)', () => {
  const r = leggiCasella("PDO2 B05/4711", COMMESSE);
  uguale(r.stato, "daControllare");
  uguale(r.commessaId, null, "la commessa NON deve essere risolta da sola:");
  uguale(r.suggerimento, { id: "c1", codice: "PD02" });
  uguale(r.numero, "B05/4711", "il numero si legge lo stesso:");
});

prova('"XX99 B05/1" → da controllare, commessa inesistente, nessun suggerimento', () => {
  const r = leggiCasella("XX99 B05/1", COMMESSE);
  uguale([r.stato, r.commessaId, r.suggerimento], ["daControllare", null, null]);
  uguale(r.motivo, "la commessa XX99 non esiste in anagrafica");
});

prova('"" → da controllare, campi vuoti', () => {
  const r = leggiCasella("", COMMESSE);
  uguale([r.stato, r.codiceLetto, r.numero, r.commessaId], ["daControllare", "", "", null]);
});

console.log("\nIL SUGGERIMENTO NON DIVENTA MAI UNA CORREZIONE");

prova("un sosia solo si propone, ma la riga resta da controllare", () => {
  const r = leggiCasella("PDO2 B05/1", COMMESSE);
  uguale(r.stato, "daControllare");
  uguale(r.commessaId, null);
});

prova("due sosia possibili → nessun suggerimento, meglio niente che a caso", () => {
  const ambigue = [
    { id: "a", codice: "PO1", descrizione: "" },
    { id: "b", codice: "P01", descrizione: "" },
  ];
  const r = leggiCasella("PO1 B05/1", ambigue);
  /* "PO1" esiste esattamente: quello vince, nessuna ambiguità. */
  uguale([r.stato, r.commessaId], ["ok", "a"]);

  const s = leggiCasella("P0I B05/1", ambigue);
  uguale([s.stato, s.commessaId, s.suggerimento], ["daControllare", null, null]);
});

prova("il codice esatto batte sempre il sosia", () => {
  const con = [...COMMESSE, { id: "c9", codice: "PDO2", descrizione: "commessa con la lettera O" }];
  const r = leggiCasella("PDO2 B05/1", con);
  uguale([r.stato, r.commessaId], ["ok", "c9"]);
});

console.log("\nLA SCANSIONE INTERA — una pagina illeggibile non blocca le altre");

prova("tre pagine, una da controllare: le altre restano a posto", () => {
  const esiti = leggiScansione({
    pagine: [
      { numeroPagina: 1, testo: "PD02 B05/4711" },
      { numeroPagina: 2, testo: "PC24" },
      { numeroPagina: 3, testo: "PC18 B05/4802" },
    ],
    commesse: COMMESSE,
  });
  uguale(esiti.map((e) => e.stato), ["ok", "daControllare", "ok"]);
  uguale(esiti.map((e) => e.numeroPagina), [1, 2, 3]);
});

prova("un numero già in archivio si segnala, non si sovrascrive", () => {
  const esiti = leggiScansione({
    pagine: [{ numeroPagina: 1, testo: "PC24 B05/4959" }],
    commesse: COMMESSE,
    giaInArchivio: ["B05/4959"],
  });
  uguale(esiti[0].stato, "daControllare");
  uguale(esiti[0].duplicato, { dove: "archivio" });
  uguale(esiti[0].commessaId, "c2", "la commessa resta risolta, è solo il numero a essere sospetto:");
});

prova("il confronto col già archiviato passa dalla normalizzazione", () => {
  const esiti = leggiScansione({
    pagine: [{ numeroPagina: 1, testo: "PC24 b05 / 4959" }],
    commesse: COMMESSE,
    giaInArchivio: ["B05/4959"],
  });
  uguale(esiti[0].duplicato, { dove: "archivio" });
});

prova("due pagine con lo stesso numero: la seconda si segnala", () => {
  const esiti = leggiScansione({
    pagine: [
      { numeroPagina: 1, testo: "PC24 B05/4959" },
      { numeroPagina: 2, testo: "PC18 B05/4959" },
    ],
    commesse: COMMESSE,
  });
  uguale(esiti[0].stato, "ok");
  uguale(esiti[1].stato, "daControllare");
  uguale(esiti[1].duplicato, { dove: "scansione", pagina: 1 });
});

prova("una pagina senza numero non fa mai doppione con un'altra senza numero", () => {
  const esiti = leggiScansione({
    pagine: [
      { numeroPagina: 1, testo: "PD02" },
      { numeroPagina: 2, testo: "PC24" },
    ],
    commesse: COMMESSE,
  });
  uguale(esiti.map((e) => e.duplicato), [null, null]);
});

prova("elenchi mancanti o nulli non fanno esplodere niente", () => {
  uguale(leggiScansione(), []);
  uguale(leggiScansione({ pagine: null, commesse: null, giaInArchivio: null }), []);
  const r = leggiCasella("PC24 B05/1", null);
  uguale([r.stato, r.commessaId], ["daControllare", null]);
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
