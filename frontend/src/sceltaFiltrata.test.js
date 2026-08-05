/**
 * Collaudo della decisione «si può confermare?». Si esegue con:
 *
 *     node src/sceltaFiltrata.test.js
 *
 * Niente browser e niente rete: sceltaFiltrata.js è tutto funzioni pure.
 *
 * IL CASO CHE CONTA È QUELLO CHE NON DEVE SCEGLIERE. Il valore di questo file
 * sta nelle prove che scrivono un testo ambiguo e pretendono che NON esca
 * nessuna voce. Il giorno che qualcuno "aggiusta" il campo facendogli prendere
 * la prima corrispondenza per comodità, qui suona la sveglia — perché quel
 * giorno le ore cominciano ad andare sulla persona sbagliata senza che nessuno
 * se ne accorga.
 *
 * I nomi qui sono INVENTATI. Riproducono la forma del problema vero (tanti
 * nomi che cominciano per la stessa lettera, due che condividono il nome di
 * battesimo) senza mettere i dipendenti di un'azienda reale in un repository.
 */
import {
  filtra, decidiConferma, normalizzaPerCerca, muoviEvidenziato,
  CONFERMA, AMBIGUO, NESSUNA, VUOTO,
} from "./sceltaFiltrata.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che} atteso ${b}, avuto ${a}`);
}
function vero(condizione, messaggio) { if (!condizione) throw new Error(messaggio); }

const voce = (id, etichetta) => ({ id, etichetta, cerca: etichetta });

const PERSONE = [
  voce("p1", "Anna Rossi"),
  voce("p2", "Andrea Bianchi"),
  voce("p3", "Andrea Verdi"),
  voce("p4", "Alessandro Neri"),
  voce("p5", "Antonio Gallo"),
  voce("p6", "Bruno Costa"),
  voce("p7", "Carla Esposito"),
  voce("p8", "Nicolò Donà"),
];

const COMMESSE = [
  voce("c1", "PN02 — TARCENTO"),
  voce("c2", "PN03 — SANTA MARIA LONGA"),
  voce("c3", "PC17 — FS CENTRALINE PD INTERPORTO"),
  voce("c4", "PC22 — PD INTERPORTO"),
  voce("c5", "PG01 — POSTE MEOLO"),
  voce("c6", "PG02 — Poste Torrebelvicino"),
];

/* ------------------------------------------------------------------ */

console.log("\nCOME SI CERCA");

prova("si cerca in mezzo alla parola, non solo dall'inizio", () => {
  // È il buco del <select> nativo: confronta dall'inizio dell'etichetta,
  // quindi "TARCENTO" non trovava "PN02 — TARCENTO".
  uguale(filtra(COMMESSE, "tarcento").map((v) => v.id), ["c1"]);
  uguale(filtra(COMMESSE, "torrebelvicino").map((v) => v.id), ["c6"]);
});

prova("il codice funziona ancora, per chi lo sa a memoria", () => {
  uguale(filtra(COMMESSE, "pn02").map((v) => v.id), ["c1"]);
});

prova("maiuscole e accenti non contano", () => {
  uguale(filtra(PERSONE, "NICOLO DONA").map((v) => v.id), ["p8"]);
  uguale(filtra(PERSONE, "nicolò donà").map((v) => v.id), ["p8"]);
  uguale(normalizzaPerCerca("PN02 — TARCENTO"), "pn02 tarcento");
});

prova("le parole valgono in qualunque ordine", () => {
  uguale(filtra(COMMESSE, "tarcento pn02").map((v) => v.id), ["c1"]);
  uguale(filtra(PERSONE, "rossi anna").map((v) => v.id), ["p1"]);
});

prova("testo vuoto vuol dire tutte", () => uguale(filtra(PERSONE, "").length, PERSONE.length));

/* ------------------------------------------------------------------ */

console.log("\nQUANDO NON DEVE SCEGLIERE (è il motivo per cui questo file esiste)");

prova('una sola lettera corrisponde a mezza rubrica: NON sceglie nessuno', () => {
  const voci = filtra(PERSONE, "a");
  vero(voci.length > 1, `«a» doveva restare ambiguo, invece le corrispondenze sono ${voci.length}`);
  const d = decidiConferma({ testo: "a", voci, evidenziato: null });
  uguale(d.esito, AMBIGUO, "esito");
  uguale(d.quante, voci.length, "il numero detto all'utente dev'essere quello vero");
  vero(d.voce === undefined, "ha restituito una voce quando non doveva sceglierne nessuna");
});

prova('«andrea» sono in due: NON sceglie il primo', () => {
  const voci = filtra(PERSONE, "andrea");
  uguale(voci.length, 2, "corrispondenze");
  const d = decidiConferma({ testo: "andrea", voci, evidenziato: null });
  uguale(d.esito, AMBIGUO);
  vero(d.voce === undefined, "ha scelto un Andrea a caso");
});

prova("due persone con lo STESSO nome restano ambigue", () => {
  const gemelle = [voce("g1", "Mario Rossi"), voce("g2", "Mario Rossi")];
  const voci = filtra(gemelle, "mario rossi");
  uguale(decidiConferma({ testo: "mario rossi", voci, evidenziato: null }).esito, AMBIGUO);
});

prova("«PD INTERPORTO» è dentro due commesse: ambiguo", () => {
  const voci = filtra(COMMESSE, "pd interporto");
  uguale(voci.length, 2, "corrispondenze");
  uguale(decidiConferma({ testo: "pd interporto", voci, evidenziato: null }).esito, AMBIGUO);
});

prova("un testo che non corrisponde a niente non inventa una voce", () => {
  const voci = filtra(PERSONE, "zzz");
  uguale(voci.length, 0);
  const d = decidiConferma({ testo: "zzz", voci, evidenziato: null });
  uguale(d.esito, NESSUNA);
  vero(d.voce === undefined, "ha restituito una voce dal nulla");
});

/* ------------------------------------------------------------------ */

console.log("\nQUANDO INVECE PUÒ");

prova("una sola corrispondenza si conferma da sé", () => {
  const voci = filtra(PERSONE, "bianchi");
  const d = decidiConferma({ testo: "bianchi", voci, evidenziato: null });
  uguale(d.esito, CONFERMA);
  uguale(d.voce.id, "p2");
});

prova("le frecce comandano, anche quando il testo è ambiguo", () => {
  const voci = filtra(PERSONE, "andrea");
  const d = decidiConferma({ testo: "andrea", voci, evidenziato: 1 });
  uguale(d.esito, CONFERMA);
  uguale(d.voce.id, "p3", "doveva confermare il secondo Andrea, quello evidenziato");
});

prova("le frecce su un indice che non esiste non confermano niente", () => {
  const voci = filtra(PERSONE, "andrea");
  uguale(decidiConferma({ testo: "andrea", voci, evidenziato: 9 }).esito, NESSUNA);
});

prova("campo vuoto: si passa oltre, non si blocca", () => {
  uguale(decidiConferma({ testo: "", voci: PERSONE, evidenziato: null }).esito, VUOTO);
  uguale(decidiConferma({ testo: "   ", voci: PERSONE, evidenziato: null }).esito, VUOTO);
});

prova("testo identico a quello già scelto: resta scelto quello", () => {
  const gia = COMMESSE[3]; // PC22 — PD INTERPORTO
  const voci = filtra(COMMESSE, gia.etichetta);
  const d = decidiConferma({ testo: gia.etichetta, voci, evidenziato: null, sceltaCorrente: gia });
  uguale(d.esito, CONFERMA);
  uguale(d.voce.id, "c4", "passare senza toccare niente deve tenere la scelta di prima");
});

/* ------------------------------------------------------------------ */

console.log("\nL'INVARIANTE, SU TUTTI GLI INIZI POSSIBILI");

prova("non conferma MAI una voce quando le corrispondenze non sono una sola", () => {
  /* Non si elencano i casi a mano: si provano TUTTI gli inizi di TUTTE le
     etichette, su entrambi gli elenchi. È la prova che la regola vale sempre e
     non solo nei casi a cui ho pensato io. */
  let provati = 0;
  for (const elenco of [PERSONE, COMMESSE]) {
    for (const v of elenco) {
      for (let n = 1; n <= v.etichetta.length; n++) {
        const testo = v.etichetta.slice(0, n);
        const voci = filtra(elenco, testo);
        const d = decidiConferma({ testo, voci, evidenziato: null });
        provati++;
        if (d.esito === CONFERMA) {
          vero(voci.length === 1,
            `con «${testo}» ha confermato "${d.voce.etichetta}" mentre le corrispondenze erano ${voci.length}`);
        } else {
          vero(d.voce === undefined, `con «${testo}» non ha confermato ma ha restituito una voce`);
        }
      }
    }
  }
  vero(provati > 200, `provati solo ${provati} inizi, troppo pochi perché valga come invariante`);
});

/* ------------------------------------------------------------------ */

console.log("\nLE FRECCE");

prova("la prima freccia in giù evidenzia la prima voce", () => uguale(muoviEvidenziato(null, +1, 5), 0));
prova("la prima freccia in su evidenzia l'ultima", () => uguale(muoviEvidenziato(null, -1, 5), 4));
prova("si scorre in giù e in su", () => {
  uguale(muoviEvidenziato(0, +1, 5), 1);
  uguale(muoviEvidenziato(3, -1, 5), 2);
});
prova("in fondo si resta in fondo, non si ricomincia da capo", () => {
  uguale(muoviEvidenziato(4, +1, 5), 4);
  uguale(muoviEvidenziato(0, -1, 5), 0);
});
prova("con l'elenco vuoto non si evidenzia niente", () => uguale(muoviEvidenziato(null, +1, 0), null));

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exitCode = falliti === 0 ? 0 : 1;
