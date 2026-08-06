/**
 * Collaudo del primo giorno. Si esegue con:
 *
 *     node src/primoGiorno.test.js
 */
import { statoPrimoGiorno, passoCorrente } from "./primoGiorno.js";

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

const conLordo = { id: "d1", nome: "Anna", cognome: "B", lordoMensile: { "2026-07": 2400 } };
const senzaLordo = { id: "d2", nome: "Bruno", cognome: "C", lordoMensile: {} };
const commessa = { id: "c1", codice: "P1", descrizione: "Cantiere" };
const riga = { id: "r1", dipendenteId: "d1", commessaId: "c1", data: "2026-07-01", ore: 8 };

console.log("\nLA STRADA, GRADINO PER GRADINO");

prova("azienda appena iscritta: zero su tre", () => {
  const s = statoPrimoGiorno({});
  uguale(s.fatti, 0); uguale(s.totale, 3); uguale(s.finito, false);
  uguale(passoCorrente(s).id, "chi", "si comincia da chi lavora");
});

prova("una persona col lordo: uno su tre", () => {
  const s = statoPrimoGiorno({ dipendentiAttivi: [conLordo] });
  uguale(s.fatti, 1);
  uguale(passoCorrente(s).id, "dove");
});

prova("più la commessa: due su tre", () => {
  const s = statoPrimoGiorno({ dipendentiAttivi: [conLordo], commesse: [commessa] });
  uguale(s.fatti, 2);
  uguale(passoCorrente(s).id, "quando");
});

prova("più la prima riga di ore: finito", () => {
  const s = statoPrimoGiorno({ dipendentiAttivi: [conLordo], commesse: [commessa], registrazioni: [riga] });
  uguale(s.fatti, 3); uguale(s.finito, true);
  uguale(passoCorrente(s), null, "non c'è più un passo corrente");
});

console.log("\nUNA PERSONA SENZA LORDO NON È UN PASSO FATTO");

prova("un dipendente senza lordo non conta: la tariffa non esisterebbe", () => {
  const s = statoPrimoGiorno({ dipendentiAttivi: [senzaLordo] });
  uguale(s.fatti, 0, "zero passi fatti");
  vero(s.passi[0].nota, "ma va detto che qualcosa c'è");
  vero(/senza lordo/.test(s.passi[0].nota), `la nota deve spiegare: ${s.passi[0].nota}`);
});

prova("la nota sparisce appena il lordo c'è", () => {
  const s = statoPrimoGiorno({ dipendentiAttivi: [conLordo, senzaLordo] });
  uguale(s.passi[0].fatto, true, "basta che UNA persona abbia il lordo");
  uguale(s.passi[0].nota, null, "niente nota quando il passo è fatto");
});

prova("un lordo a zero non è un lordo", () => {
  const s = statoPrimoGiorno({ dipendentiAttivi: [{ id: "x", lordoMensile: { "2026-07": 0 } }] });
  uguale(s.passi[0].fatto, false);
});

console.log("\nQUELLO CHE NON DEVE SUCCEDERE");

prova("liste assenti non fanno esplodere niente", () => {
  for (const a of [{}, { dipendentiAttivi: null, commesse: null, registrazioni: null }]) {
    uguale(statoPrimoGiorno(a).fatti, 0, JSON.stringify(a));
  }
});

prova("i passi sono tre e in quest'ordine", () => {
  /* L'ordine non è estetico: senza lordo non c'è tariffa, senza commessa non
     c'è dove mettere le ore. Invertirli manderebbe l'utente in un vicolo. */
  uguale(statoPrimoGiorno({}).passi.map((p) => p.id), ["chi", "dove", "quando"]);
});

prova("ogni passo dice cosa fare, non solo come si chiama", () => {
  for (const p of statoPrimoGiorno({}).passi) {
    vero(p.titolo && p.titolo.length > 0, `titolo mancante su ${p.id}`);
    vero(p.testo && p.testo.length > 20, `testo troppo corto su ${p.id}: ${p.testo}`);
  }
});

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
