/**
 * Collaudo della logica di abbinamento. Si esegue con:
 *
 *     node src/abbinamentoDDT.test.js
 *
 * Non serve né database né rete: abbinamentoDDT.js è tutto funzioni pure, ed è
 * proprio per poterlo mettere alla prova così che è scritto in quel modo.
 *
 * I casi che contano davvero sono quelli che NON devono abbinare: il valore di
 * questo file è tenerli inchiodati. Il giorno che qualcuno allarga le maglie
 * del match per far tornare un caso comodo, qui suona la sveglia.
 */
import { abbinaDDT, abbinaUnDDT, confrontaFornitori, normalizzaNumero, giorniFra, GIORNI_VICINI } from "./abbinamentoDDT.js";

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

/* Un archivio di prova: due fornitori diversi con LO STESSO numero di DDT.
   È la situazione che rende pericoloso il match sul solo numero. */
const EPIU = "EPIÙ MATERIALI EDILI S.R.L.";
const FERRAMENTA = "FERRAMENTA BIANCHI SNC";

const ddt = (p) => ({
  id: p.id, commessaId: p.commessa, commessaCodice: p.commessa, commessaDescrizione: "",
  nomeFile: p.nomeFile || "ddt.pdf", ddtNumero: p.numero, ddtData: p.data, fornitore: p.fornitore,
});

const ARCHIVIO = [
  ddt({ id: "a1", numero: "4711", data: "2026-07-06", fornitore: EPIU, commessa: "24-018" }),
  ddt({ id: "a2", numero: "4711", data: "2026-05-02", fornitore: FERRAMENTA, commessa: "24-002" }),
  ddt({ id: "a3", numero: "4738", data: "2026-07-14", fornitore: EPIU, commessa: "24-021" }),
  ddt({ id: "a4", numero: "9001", data: null, fornitore: "", commessa: "24-030" }),      // vecchio: campi vuoti
  ddt({ id: "a5", numero: "", data: null, fornitore: "", commessa: "24-031" }),          // archiviato senza numero
];

console.log("\nNORMALIZZAZIONI");
prova("il numero si confronta senza punteggiatura", () => {
  uguale(normalizzaNumero("n. 4711/A"), "4711A");
  uguale(normalizzaNumero(" 4711 "), "4711");
  uguale(normalizzaNumero(null), "");
});
prova("il fornitore si confronta senza forma societaria né accenti", () => {
  uguale(confrontaFornitori(EPIU, "Epiu Materiali Edili"), "uguale");
  uguale(confrontaFornitori(EPIU, "epiù materiali edili spa"), "uguale");
  uguale(confrontaFornitori(EPIU, FERRAMENTA), "diverso");
  uguale(confrontaFornitori(EPIU, ""), "ignoto");
  uguale(confrontaFornitori("", ""), "ignoto");
});
prova("le date si contano in giorni, mancanti comprese", () => {
  uguale(giorniFra("2026-07-06", "2026-07-06"), 0);
  uguale(giorniFra("2026-07-06", "2026-07-08"), 2);
  uguale(giorniFra("2026-07-06", "2026-08-06"), 31);
  uguale(giorniFra("2026-07-06", null), null);
  uguale(giorniFra("", "2026-07-06"), null);
});

console.log("\nMATCH FORTE (l'unico che pre-seleziona)");
prova("numero + fornitore + stessa data → forte, sulla commessa giusta", () => {
  const e = abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-07-06", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "forte", "forza:");
  uguale(e.commessaId, "24-018", "commessa:");
});
prova(`data lontana ${GIORNI_VICINI} giorni → ancora forte`, () => {
  const e = abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-07-11", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "forte");
  uguale(e.commessaId, "24-018");
});
prova("numero scritto in modo diverso ma fornitore e data giusti → forte", () => {
  const e = abbinaUnDDT({ ddtNumero: "n. 4711", ddtData: "2026-07-06", fornitore: "Epiu Materiali Edili" }, ARCHIVIO);
  uguale(e.forza, "forte");
  uguale(e.commessaId, "24-018");
});

console.log("\nMATCH DEBOLE (propone, non assegna)");
prova("STESSO NUMERO MA FORNITORE DIVERSO → mai forte", () => {
  // Il caso da cui tutto questo modulo si difende: se abbinasse, i materiali
  // del ferramenta finirebbero sulla commessa del cementificio.
  const e = abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-05-02", fornitore: "TIZIO CEMENTI SRL" }, ARCHIVIO);
  uguale(e.forza, "debole", "forza:");
  if (!/fornitore non combacia/.test(e.motivo)) throw new Error("il motivo deve dire che il fornitore non combacia: " + e.motivo);
});
prova("date distanti oltre la soglia → debole", () => {
  const e = abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-07-20", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "debole");
  if (!/distanti/.test(e.motivo)) throw new Error("motivo inatteso: " + e.motivo);
});
prova("il DDT in archivio non ha fornitore né data (vecchio) → debole", () => {
  const e = abbinaUnDDT({ ddtNumero: "9001", ddtData: "2026-07-06", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "debole");
  uguale(e.commessaId, "24-030");
});
prova("la fattura non dice la data del DDT → debole anche col fornitore giusto", () => {
  const e = abbinaUnDDT({ ddtNumero: "4738", ddtData: "", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "debole");
  uguale(e.commessaId, "24-021");
});
prova("due DDT forti su commesse diverse → declassato a debole", () => {
  const doppio = [
    ddt({ id: "b1", numero: "555", data: "2026-07-06", fornitore: EPIU, commessa: "24-100" }),
    ddt({ id: "b2", numero: "555", data: "2026-07-06", fornitore: EPIU, commessa: "24-200" }),
  ];
  const e = abbinaUnDDT({ ddtNumero: "555", ddtData: "2026-07-06", fornitore: EPIU }, doppio);
  uguale(e.forza, "debole", "forza:");
  if (!/commesse diverse/.test(e.motivo)) throw new Error("motivo inatteso: " + e.motivo);
});
prova("lo stesso DDT archiviato due volte sulla STESSA commessa → resta forte", () => {
  const doppio = [
    ddt({ id: "c1", numero: "777", data: "2026-07-06", fornitore: EPIU, commessa: "24-100" }),
    ddt({ id: "c2", numero: "777", data: "2026-07-06", fornitore: EPIU, commessa: "24-100" }),
  ];
  const e = abbinaUnDDT({ ddtNumero: "777", ddtData: "2026-07-06", fornitore: EPIU }, doppio);
  uguale(e.forza, "forte");
  uguale(e.commessaId, "24-100");
});
prova("fra più candidati deboli vince quello col fornitore giusto", () => {
  const e = abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-07-30", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "debole");
  uguale(e.commessaId, "24-018", "deve proporre il DDT dello stesso fornitore:");
});

console.log("\nPARI MERITO — quando nessuno è più probabile, non si fa il nome");

/* Come esce dall'archivio un DDT archiviato dalla schermata delle scansioni:
   c'è il numero, c'è la commessa, e basta. Data e fornitore quella schermata
   non li chiede, quindi su questi documenti i pari merito sono la norma e non
   l'eccezione — ed è per loro che la regola esiste. */
const daScansione = (id, numero, commessa) => ddt({ id, numero, data: null, fornitore: "", commessa });

prova("due DDT col solo numero su commesse diverse → non si nomina nessuna commessa", () => {
  const e = abbinaUnDDT({ ddtNumero: "3001", ddtData: "2026-07-14", fornitore: EPIU }, [
    daScansione("s1", "3001", "24-100"),
    daScansione("s2", "3001", "24-200"),
  ]);
  uguale(e.forza, "debole", "forza:");
  uguale(e.commessaId, null, "commessa:");
  uguale(e.commessaCodice, "", "codice:");
  uguale(e.allegato, null, "allegato:");
  if (!/2 DDT/.test(e.motivo)) throw new Error("il motivo deve dire quanti sono: " + e.motivo);
});
prova("due DDT col solo numero sulla STESSA commessa → si propone: non c'è niente da scegliere", () => {
  const e = abbinaUnDDT({ ddtNumero: "3002", ddtData: "2026-07-14", fornitore: EPIU }, [
    daScansione("s1", "3002", "24-100"),
    daScansione("s2", "3002", "24-100"),
  ]);
  uguale(e.forza, "debole", "forza:");
  uguale(e.commessaId, "24-100", "commessa:");
});
prova("un candidato STRETTAMENTE migliore si propone ancora", () => {
  // 4711 sta su due commesse, ma uno dei due è del fornitore della fattura.
  // Non sono pari: il fornitore che torna è un criterio, non un sorteggio, e
  // rinunciare qui vorrebbe dire buttare via l'unico dato che li distingue.
  const e = abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-07-30", fornitore: EPIU }, ARCHIVIO);
  uguale(e.forza, "debole");
  uguale(e.commessaId, "24-018");
});

console.log("\nSTESSO ARCHIVIO, STESSO ESITO — l'ordine delle righe non conta");

/* La prova che prima falliva. Finché i pari merito non venivano riconosciuti,
   a parità di candidati vinceva quello che il database restituiva per primo:
   la stessa fattura, sullo stesso archivio, poteva proporre due commesse
   diverse a due caricamenti di distanza. Un software che cambia idea da solo
   non lo si può controllare, e a quel punto non lo si crede più su niente. */
const nonDipendeDallOrdine = (nome, riferimento, archiviati) => prova(nome, () => {
  const dritto = abbinaUnDDT(riferimento, archiviati);
  const rovescio = abbinaUnDDT(riferimento, [...archiviati].reverse());
  uguale(rovescio, dritto, "invertendo l'ordine delle righe dell'archivio:");
});

nonDipendeDallOrdine("due deboli pari merito su commesse diverse",
  { ddtNumero: "3001", ddtData: "2026-07-14", fornitore: EPIU },
  [daScansione("s1", "3001", "24-100"), daScansione("s2", "3001", "24-200")]);

nonDipendeDallOrdine("due forti su commesse diverse",
  { ddtNumero: "555", ddtData: "2026-07-06", fornitore: EPIU },
  [ddt({ id: "b1", numero: "555", data: "2026-07-06", fornitore: EPIU, commessa: "24-100" }),
   ddt({ id: "b2", numero: "555", data: "2026-07-06", fornitore: EPIU, commessa: "24-200" })]);

nonDipendeDallOrdine("tre col solo numero, due dei quali sulla stessa commessa",
  { ddtNumero: "3003", ddtData: "2026-07-14", fornitore: EPIU },
  [daScansione("s1", "3003", "24-100"), daScansione("s2", "3003", "24-100"), daScansione("s3", "3003", "24-300")]);

nonDipendeDallOrdine("un candidato migliore degli altri resta lui in ogni ordine",
  { ddtNumero: "4711", ddtData: "2026-07-30", fornitore: EPIU }, ARCHIVIO);

console.log("\nNESSUN ABBINAMENTO (si assegna a mano, come prima)");
prova("DDT mai archiviato → null", () => {
  uguale(abbinaUnDDT({ ddtNumero: "8888", ddtData: "2026-07-06", fornitore: EPIU }, ARCHIVIO), null);
});
prova("la fattura non cita nessun DDT → null", () => {
  uguale(abbinaUnDDT({ ddtNumero: "", ddtData: "2026-07-06", fornitore: EPIU }, ARCHIVIO), null);
});
prova("un DDT archiviato SENZA numero non viene mai abbinato", () => {
  // a5 ha numero vuoto: non deve agganciare una fattura senza riferimenti.
  uguale(abbinaUnDDT({ ddtNumero: "", ddtData: "", fornitore: "" }, ARCHIVIO), null);
  // e nemmeno comparire fra i candidati di un numero qualsiasi
  const e = abbinaUnDDT({ ddtNumero: "0", ddtData: "", fornitore: "" }, ARCHIVIO);
  uguale(e, null);
});
prova("archivio vuoto → null, nessun errore", () => {
  uguale(abbinaUnDDT({ ddtNumero: "4711", ddtData: "2026-07-06", fornitore: EPIU }, []), null);
});

console.log("\nFATTURA INTERA (come la usa il server)");
prova("la fattura di esempio: 4711 e 4738 forti, 4802 mai archiviato", () => {
  const esiti = abbinaDDT({
    fornitore: EPIU,
    riferimenti: [
      { ddtNumero: "4711", ddtData: "2026-07-06" },
      { ddtNumero: "4738", ddtData: "2026-07-14" },
      { ddtNumero: "4802", ddtData: "2026-07-23" },
      { ddtNumero: "", ddtData: "" },              // il gruppo "senza DDT"
    ],
    archiviati: ARCHIVIO,
  });
  uguale(esiti.length, 2, "numero di proposte:");
  uguale(esiti.map((e) => [e.ddtNumero, e.forza, e.commessaId]), [["4711", "forte", "24-018"], ["4738", "forte", "24-021"]]);
});
prova("nessun DDT archiviato → nessuna proposta, tutto a mano", () => {
  const esiti = abbinaDDT({ fornitore: EPIU, riferimenti: [{ ddtNumero: "4711", ddtData: "2026-07-06" }], archiviati: [] });
  uguale(esiti, []);
});
prova("liste mancanti o nulle non fanno esplodere niente", () => {
  uguale(abbinaDDT({}), []);
  uguale(abbinaDDT({ riferimenti: null, archiviati: null, fornitore: null }), []);
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
