/**
 * Collaudo delle tariffe fuori scala. Si esegue con:
 *
 *     node src/tariffaDaControllare.test.js
 *
 * LA PROVA CHE CONTA è la prima: un lordo intero addossato a un giorno solo di
 * lavoro. Il costo che ne esce è sbagliato di venti volte, «Quadra» dice di sì,
 * e l'unico posto dove la cosa si vede è la tariffa oraria.
 *
 * Le prove sul NON segnalare contano quanto le altre: un'azienda con i conti in
 * ordine non deve vedere ambra nemmeno una volta, altrimenti l'ambra smette di
 * voler dire qualcosa.
 */
import {
  tariffeDaControllare, cSonoTariffeDaControllare,
  FATTORE_SCOSTAMENTO, SOGLIA_ORARIA_SENZA_STORICO,
} from "./tariffaDaControllare.js";

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

const anna = (lordi) => ({ id: "d1", nome: "Anna", cognome: "Bianchi", lordoMensile: lordi });
const ore = (coppie) => new Map(coppie);

/* ------------------------------------------------------------------ */

console.log("\nIL CASO CHE NESSUNO VEDE OGGI");

prova("un lordo intero su un giorno solo: 300 €/h, segnalata", () => {
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400 })],
    oreMensili: ore([["d1|2026-07", 8]]),
    mesi: ["2026-07"],
  });
  uguale(r.length, 1, "quante segnalazioni");
  uguale(Math.round(r[0].tariffa), 300, "la tariffa");
  uguale(r[0].confronto, null, "senza storico non c'è niente con cui confrontarsi");
  uguale(r[0].ore, 8, "le ore osservate");
  uguale(r[0].lordo, 2400, "il lordo osservato");
});

prova("un mese intero non si segnala: 14,29 €/h", () => {
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400 })],
    oreMensili: ore([["d1|2026-07", 168]]),
    mesi: ["2026-07"],
  });
  uguale(r.length, 0, "nessuna segnalazione");
});

prova("il confine senza storico è la soglia assoluta", () => {
  const conOre = (n) => tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 1000 })],
    oreMensili: ore([["d1|2026-07", n]]),
    mesi: ["2026-07"],
  }).length;
  uguale(conOre(1000 / SOGLIA_ORARIA_SENZA_STORICO), 0, "esattamente 50 €/h passa");
  uguale(conOre(1000 / (SOGLIA_ORARIA_SENZA_STORICO + 1)), 1, "sopra i 50 si segnala");
});

/* ------------------------------------------------------------------ */

console.log("\nIL METRO MIGLIORE È LA PERSONA STESSA");

prova("OGNI MESE IN CORSO: agosto a metà accanto a luglio finito", () => {
  /* Non è solo il primo giorno. Finché agosto non è finito, i costi di
     agosto sono più alti del vero — per chiunque, sempre. */
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400, "2026-08": 2400 })],
    oreMensili: ore([["d1|2026-07", 168], ["d1|2026-08", 16]]),
    mesi: ["2026-08"],
  });
  uguale(r.length, 1, "agosto va segnalato");
  uguale(Math.round(r[0].tariffa), 150, "150 €/h");
  uguale(Math.round(r[0].confronto * 100) / 100, 14.29, "confrontato con i 14,29 di luglio");
});

prova("con lo storico si segnala anche SOTTO i 50 €/h", () => {
  /* Il caso che la sola soglia assoluta si perderebbe: 80 ore su 168 fanno
     30 €/h, che in assoluto sembra una paga plausibile, ma per Anna è più del
     doppio del solito. */
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400, "2026-08": 2400 })],
    oreMensili: ore([["d1|2026-07", 168], ["d1|2026-08", 80]]),
    mesi: ["2026-08"],
  });
  uguale(r.length, 1, "meno di metà mese si segnala");
  vero(r[0].tariffa < SOGLIA_ORARIA_SENZA_STORICO,
    `e lo fa sotto la soglia assoluta (${r[0].tariffa.toFixed(2)} €/h)`);
});

prova("IL CONFINE È METÀ MESE, esattamente", () => {
  /* Con FATTORE_SCOSTAMENTO = 2 il confine cade in un punto che si può dire a
     parole: metà delle ore fa esattamente il doppio della tariffa. Quindi
     mezzo mese passa e un'ora in meno di mezzo mese si segnala. Vale la pena
     saperlo, perché è il confine che l'utente incontrerà davvero — ogni mese,
     a metà del mese. */
  const conOre = (n) => tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400, "2026-08": 2400 })],
    oreMensili: ore([["d1|2026-07", 168], ["d1|2026-08", n]]),
    mesi: ["2026-08"],
  }).length;
  uguale(conOre(84), 0, `metà esatta di 168 passa (fattore ${FATTORE_SCOSTAMENTO})`);
  uguale(conOre(83), 1, "un'ora in meno si segnala");
});

prova("qualche giorno di ferie NON fa scattare niente", () => {
  /* 168 ore contro 140: è un mese con una settimana di ferie, e la tariffa
     sale del 20%. Il fattore 2 è largo apposta per non segnalarlo. */
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400, "2026-08": 2400 })],
    oreMensili: ore([["d1|2026-07", 168], ["d1|2026-08", 140]]),
    mesi: ["2026-08"],
  });
  uguale(r.length, 0, "nessuna segnalazione");
});

prova("due mesi guardati insieme non si fanno da metro a vicenda", () => {
  /* Se il periodo copre luglio e agosto e sono ENTRAMBI a metà, confrontarli
     fra loro direbbe che va tutto bene: si escludono e si ricade sulla
     soglia assoluta, che li prende tutti e due. */
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400, "2026-08": 2400 })],
    oreMensili: ore([["d1|2026-07", 8], ["d1|2026-08", 8]]),
    mesi: ["2026-07", "2026-08"],
  });
  uguale(r.length, 2, "tutti e due segnalati");
  uguale(r.every((x) => x.confronto === null), true, "nessuno dei due fa da metro all'altro");
});

/* ------------------------------------------------------------------ */

console.log("\nCHI HA I CONTI IN ORDINE NON VEDE MAI L'AMBRA");

prova("dodici mesi pieni, nessuna segnalazione", () => {
  const lordi = {}, coppie = [];
  for (let m = 1; m <= 12; m++) {
    const mese = `2026-${String(m).padStart(2, "0")}`;
    lordi[mese] = 2400; coppie.push([`d1|${mese}`, 160 + (m % 3) * 8]);
  }
  const r = tariffeDaControllare({
    dipendenti: [anna(lordi)], oreMensili: ore(coppie), mesi: Object.keys(lordi),
  });
  uguale(r.length, 0, "nessuna segnalazione su un anno regolare");
});

prova("un mese senza lordo non si segnala: è un altro avviso, non questo", () => {
  /* «Manca il lordo» lo dice già tariffaOraria, e quelle ore valgono 0 €.
     Segnalarlo anche qui vorrebbe dire due avvisi per la stessa cosa. */
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400 })],
    oreMensili: ore([["d1|2026-07", 168], ["d1|2026-08", 8]]),
    mesi: ["2026-07", "2026-08"],
  });
  uguale(r.length, 0, "agosto non ha lordo: non è affare di questo modulo");
});

prova("un mese con lordo e zero ore non si segnala", () => {
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400 })],
    oreMensili: ore([["d1|2026-07", 0]]),
    mesi: ["2026-07"],
  });
  uguale(r.length, 0, "zero ore non fa una tariffa");
});

prova("si guardano solo i mesi del periodo scelto", () => {
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400, "2026-08": 2400 })],
    oreMensili: ore([["d1|2026-07", 168], ["d1|2026-08", 8]]),
    mesi: ["2026-07"],
  });
  uguale(r.length, 0, "agosto è fuori dal periodo: non se ne parla");
});

/* ------------------------------------------------------------------ */

console.log("\nQUELLO CHE NON DEVE SUCCEDERE MAI");

prova("liste vuote o assenti non fanno esplodere niente", () => {
  for (const args of [
    {}, { dipendenti: [], oreMensili: new Map(), mesi: [] },
    { dipendenti: null, oreMensili: null, mesi: null },
  ]) uguale(tariffeDaControllare(args).length, 0, JSON.stringify(args));
});

prova("più persone: si segnala solo chi è fuori scala", () => {
  const bruno = { id: "d2", nome: "Bruno", cognome: "Conti", lordoMensile: { "2026-07": 2100 } };
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400 }), bruno],
    oreMensili: ore([["d1|2026-07", 8], ["d2|2026-07", 168]]),
    mesi: ["2026-07"],
  });
  uguale(r.length, 1, "solo Anna");
  uguale(r[0].dip.nome, "Anna");
});

prova("le segnalazioni escono dalla più fuori scala", () => {
  const bruno = { id: "d2", nome: "Bruno", cognome: "Conti", lordoMensile: { "2026-07": 2100 } };
  const r = tariffeDaControllare({
    dipendenti: [anna({ "2026-07": 2400 }), bruno],
    oreMensili: ore([["d1|2026-07", 24], ["d2|2026-07", 8]]),
    mesi: ["2026-07"],
  });
  uguale(r.map((x) => x.dip.nome), ["Bruno", "Anna"], "Bruno è a 262 €/h, Anna a 100");
});

prova("la scorciatoia booleana dice la stessa cosa dell'elenco", () => {
  const args = {
    dipendenti: [anna({ "2026-07": 2400 })],
    oreMensili: ore([["d1|2026-07", 8]]), mesi: ["2026-07"],
  };
  uguale(cSonoTariffeDaControllare(args), tariffeDaControllare(args).length > 0);
});

/* ------------------------------------------------------------------ */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
