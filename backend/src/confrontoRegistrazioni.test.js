/**
 * Collaudo del confronto fra le registrazioni. Si esegue con:
 *
 *     node src/confrontoRegistrazioni.test.js
 *
 * QUATTRO FAMIGLIE, e ognuna difende una promessa diversa.
 *
 * 1. LA SOGLIA NON CAMBIA. Il cancello contava quante righe sarebbero sparite
 *    quando il salvataggio cancellava tutto e riscriveva. Adesso si cancella
 *    per differenza. Qui si dimostra che l'insieme che sparisce è LO STESSO nei
 *    due modi, quindi il numero che il cancello conta è lo stesso numero, e il
 *    verdetto pure.
 *
 * 2. NEL DUBBIO SI SCRIVE. Ogni tipo che il confronto non riconosce deve
 *    contare come cambiato. Sono le prove che difendono dall'unico guasto che
 *    fa male: una modifica che non arriva al database e sparisce in silenzio.
 *
 * 3. IL CASO VERO. I dati di PIEMME come arrivano davvero da Postgres e dal
 *    browser: una cifra cambiata deve produrre UNA riga da scrivere, e dati
 *    identici devono produrne ZERO. Se questa fallisse, tutto il lavoro non
 *    servirebbe a niente pur essendo corretto.
 *
 * 4. GLI ID NON SI MUOVONO. Dopo il confronto l'insieme degli id dev'essere
 *    esattamente quello mandato dal browser, e le righe non cambiate non
 *    devono essere state toccate nemmeno una volta.
 */
import { confrontaRegistrazioni, rigaDaScrivere } from "./confrontoRegistrazioni.js";
import { troppeCancellazioni } from "./sogliaCancellazioni.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
function uguale(a, b, m) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m}\n         atteso ${y}\n         ottenuto ${x}`);
}

/** Una riga come torna da Postgres: colonne snake_case, ore come stringa. */
const nelDb = (id, dip, com, data, ore) =>
  ({ id, dipendente_id: dip, commessa_id: com, data, ore: String(ore) });
/** La stessa riga come la manda il browser: camelCase, ore come numero. */
const dalBrowser = (id, dip, com, data, ore) =>
  ({ id, dipendenteId: dip, commessaId: com, data, ore });

/* ================================================================== */

console.log("\n1. LA SOGLIA NON CAMBIA");

/* Le due strategie, scritte per esteso e separate apposta: se coincidessero
   per costruzione del codice di prova non ci sarebbe niente da dimostrare.
   Qui una descrive il vecchio comportamento, l'altra traduce il predicato SQL
   `NOT (id = ANY($2::text[]))` che usano SIA il cancello SIA la nuova DELETE. */
const spariteCancellandoTutto = (db, arrivo) => {
  const restano = new Set(arrivo.map((r) => String(r.id)));   // dopo la riscrittura ci sono queste
  return db.map((r) => String(r.id)).filter((id) => !restano.has(id)).sort();
};
const spariteColPredicato = (db, arrivo) => {
  const elenco = arrivo.map((r) => String(r.id));             // $2::text[]
  return db.map((r) => String(r.id)).filter((id) => !elenco.includes(id)).sort();
};

/** Generatore ripetibile: la prova che fallisce dev'essere la stessa domani. */
function caso(seme) {
  let s = seme;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const quante = Math.floor(rnd() * 40);
  const db = Array.from({ length: quante }, (_, i) => nelDb(`r${i}`, "d1", "c1", "2026-08-07", 8));
  const arrivo = [];
  for (const r of db) if (rnd() > 0.35) arrivo.push(dalBrowser(r.id, "d1", "c1", "2026-08-07", 8));
  const nuove = Math.floor(rnd() * 5);
  for (let i = 0; i < nuove; i++) arrivo.push(dalBrowser(`nuova${i}`, "d1", "c1", "2026-08-07", 8));
  return { db, arrivo };
}

prova("le due strategie fanno sparire ESATTAMENTE le stesse righe (400 casi)", () => {
  for (let seme = 1; seme <= 400; seme++) {
    const { db, arrivo } = caso(seme);
    uguale(spariteColPredicato(db, arrivo), spariteCancellandoTutto(db, arrivo),
      `caso ${seme}: le due strategie divergono`);
  }
});

prova("e il confronto calcola lo stesso insieme delle due (400 casi)", () => {
  for (let seme = 1; seme <= 400; seme++) {
    const { db, arrivo } = caso(seme);
    const { daCancellare } = confrontaRegistrazioni({ nelDatabase: db, inArrivo: arrivo });
    uguale([...daCancellare].sort(), spariteCancellandoTutto(db, arrivo),
      `caso ${seme}: il confronto non concorda col vecchio comportamento`);
  }
});

prova("quindi il VERDETTO della soglia è identico prima e dopo (400 casi)", () => {
  for (let seme = 1; seme <= 400; seme++) {
    const { db, arrivo } = caso(seme);
    const prima = troppeCancellazioni({
      esistenti: db.length, cancellate: spariteCancellandoTutto(db, arrivo).length,
    });
    const dopo = troppeCancellazioni({
      esistenti: db.length, cancellate: spariteColPredicato(db, arrivo).length,
    });
    uguale(dopo, prima, `caso ${seme}: verdetto diverso`);
  }
});

prova("IL CASO VERO: 319 righe che spariscono si contano uguale nei due modi", () => {
  /* La giornata del 5 agosto 2026. Una scheda vecchia manda 305 righe su 624. */
  const db = Array.from({ length: 624 }, (_, i) => nelDb(`r${i}`, "d1", "c1", "2026-08-07", 8));
  const arrivo = db.slice(0, 305).map((r) => dalBrowser(r.id, "d1", "c1", "2026-08-07", 8));
  uguale(spariteColPredicato(db, arrivo).length, 319, "col predicato");
  uguale(spariteCancellandoTutto(db, arrivo).length, 319, "cancellando tutto");
  const { daCancellare } = confrontaRegistrazioni({ nelDatabase: db, inArrivo: arrivo });
  uguale(daCancellare.length, 319, "col confronto");
  vero(troppeCancellazioni({ esistenti: 624, cancellate: 319 }).rifiuta, "e viene rifiutato");
});

prova("uno stato vuoto fa sparire tutto, in tutti e tre i modi", () => {
  const db = Array.from({ length: 624 }, (_, i) => nelDb(`r${i}`, "d1", "c1", "2026-08-07", 8));
  uguale(spariteColPredicato(db, []).length, 624, "col predicato");
  uguale(spariteCancellandoTutto(db, []).length, 624, "cancellando tutto");
  uguale(confrontaRegistrazioni({ nelDatabase: db, inArrivo: [] }).daCancellare.length, 624, "col confronto");
});

/* ================================================================== */

console.log("\n2. NEL DUBBIO SI SCRIVE");

const BASE = nelDb("r1", "d1", "c1", "2026-08-07", 8);

prova("un tipo che il confronto non riconosce conta come CAMBIATO", () => {
  /* Il cuore della regola. Ognuno di questi valori è al posto delle ore, e
     nessuno di essi è riconoscibile con certezza: la riga si riscrive. */
  for (const ore of [null, undefined, true, false, NaN, Infinity, "otto", "8,00", "1e1", {}, [], "", " "]) {
    vero(rigaDaScrivere(BASE, dalBrowser("r1", "d1", "c1", "2026-08-07", ore)),
      `ore = ${JSON.stringify(ore)} doveva contare come cambiata`);
  }
});

prova("una data in forma inattesa conta come CAMBIATA, non si indovina", () => {
  for (const data of ["2026-8-7", "07/08/2026", "2026-08-07T00:00:00Z", new Date("2026-08-07"), null, 20260807]) {
    vero(rigaDaScrivere(BASE, dalBrowser("r1", "d1", "c1", data, 8)),
      `data = ${JSON.stringify(data)} doveva contare come cambiata`);
  }
});

prova("un id di dipendente o commessa non testuale conta come CAMBIATO", () => {
  for (const v of [1, null, undefined, {}, true]) {
    vero(rigaDaScrivere(BASE, dalBrowser("r1", v, "c1", "2026-08-07", 8)), `dipendente ${JSON.stringify(v)}`);
    vero(rigaDaScrivere(BASE, dalBrowser("r1", "d1", v, "2026-08-07", 8)), `commessa ${JSON.stringify(v)}`);
  }
});

prova("una riga che non è nemmeno un oggetto conta come CAMBIATA", () => {
  for (const r of [null, undefined, "riga", 42, true]) {
    vero(rigaDaScrivere(BASE, r), `${JSON.stringify(r)} doveva contare come cambiata`);
  }
});

prova("una riga che nel database non c'è è sempre da scrivere", () => {
  vero(rigaDaScrivere(undefined, dalBrowser("nuova", "d1", "c1", "2026-08-07", 8)), "è nuova");
});

prova("il caso che fa male: MAI dire «uguale» a due valori diversi", () => {
  /* Il verso pericoloso. Se una sola di queste passasse, la modifica di
     quella riga non arriverebbe al database e nessuno se ne accorgerebbe. */
  const diverse = [
    dalBrowser("r1", "d2", "c1", "2026-08-07", 8),      // altro dipendente
    dalBrowser("r1", "d1", "c2", "2026-08-07", 8),      // altra commessa
    dalBrowser("r1", "d1", "c1", "2026-08-08", 8),      // altro giorno
    dalBrowser("r1", "d1", "c1", "2026-08-07", 8.5),    // mezz'ora in più
    dalBrowser("r1", "d1", "c1", "2026-08-07", 0),      // azzerata
    dalBrowser("r1", "d1", "c1", "2026-08-07", 80),     // uno zero di troppo
  ];
  for (const r of diverse) vero(rigaDaScrivere(BASE, r), `doveva vedere la differenza: ${JSON.stringify(r)}`);
});

prova("una riga senza id passa avanti: la rifiuta il database, non il confronto", () => {
  /* Inventarle un id vorrebbe dire scrivere una riga che nessuno ha chiesto.
     Va al database così com'è, che ha una chiave primaria e la respinge,
     annullando la transazione — esattamente come faceva prima. */
  const { daScrivere } = confrontaRegistrazioni({
    nelDatabase: [], inArrivo: [dalBrowser(null, "d1", "c1", "2026-08-07", 8)],
  });
  uguale(daScrivere.length, 1, "deve arrivare al database");
  uguale(daScrivere[0].id, null, "con il suo id mancante, non uno inventato");
});

/* ================================================================== */

console.log("\n3. IL CASO VERO");

/** 624 righe come stanno nel database di PIEMME. */
const PIEMME = Array.from({ length: 624 }, (_, i) =>
  nelDb(`reg-${i}`, `dip-${i % 15}`, `com-${i % 22}`, "2026-08-07", (i % 4) + 6));
/** Le stesse, come le rimanda il browser dopo averle lette dalla GET. */
const RIMANDATE = PIEMME.map((r) =>
  dalBrowser(r.id, r.dipendente_id, r.commessa_id, r.data, Number(r.ore)));

prova("IL NUMERO CHE CONTA: dati identici → ZERO righe da scrivere", () => {
  /* Se questa fallisse, il salvataggio riscriverebbe tutte e 624 le righe a
     ogni battuta pur essendo corretto: il lavoro non servirebbe a niente.
     È anche la prova che ore "8.00" e ore 8 si riconoscono uguali. */
  const { daScrivere, daCancellare } = confrontaRegistrazioni({ nelDatabase: PIEMME, inArrivo: RIMANDATE });
  uguale(daScrivere.length, 0, "non c'era niente da scrivere");
  uguale(daCancellare.length, 0, "e niente da cancellare");
});

prova("una cifra cambiata su 624 righe → UNA riga da scrivere", () => {
  const arrivo = RIMANDATE.map((r) => (r.id === "reg-300" ? { ...r, ore: 7 } : r));
  const { daScrivere, daCancellare } = confrontaRegistrazioni({ nelDatabase: PIEMME, inArrivo: arrivo });
  uguale(daScrivere.length, 1, "una sola");
  uguale(daScrivere[0].id, "reg-300", "e proprio quella");
  uguale(daCancellare.length, 0, "senza cancellare niente");
});

prova("una riga aggiunta → UNA riga da scrivere, le altre 624 non si toccano", () => {
  const arrivo = [...RIMANDATE, dalBrowser("reg-nuova", "dip-3", "com-5", "2026-08-08", 8)];
  const { daScrivere, daCancellare } = confrontaRegistrazioni({ nelDatabase: PIEMME, inArrivo: arrivo });
  uguale(daScrivere.length, 1, "solo la nuova");
  uguale(daScrivere[0].id, "reg-nuova", "e proprio lei");
  uguale(daCancellare.length, 0, "niente cancellato");
});

prova("una riga tolta a mano → UNA cancellazione, ZERO scritture", () => {
  const arrivo = RIMANDATE.filter((r) => r.id !== "reg-100");
  const { daScrivere, daCancellare } = confrontaRegistrazioni({ nelDatabase: PIEMME, inArrivo: arrivo });
  uguale(daScrivere.length, 0, "non si riscrive niente per cancellare");
  uguale(daCancellare, ["reg-100"], "solo quella");
  vero(!troppeCancellazioni({ esistenti: 624, cancellate: 1 }).rifiuta, "e una riga passa la soglia");
});

prova("le ore arrivate come stringa dal browser si riconoscono lo stesso", () => {
  /* Non è il caso di oggi, ma un JSON che porta "8.00" invece di 8 non deve
     far riscrivere 624 righe per un dettaglio di formato. */
  const arrivo = RIMANDATE.map((r) => ({ ...r, ore: `${r.ore}.00` }));
  uguale(confrontaRegistrazioni({ nelDatabase: PIEMME, inArrivo: arrivo }).daScrivere.length, 0,
    "«8.00» e 8 sono lo stesso numero di ore");
});

/* ================================================================== */

console.log("\n4. GLI ID NON SI MUOVONO");

/** Applica il confronto come lo applicherà il database, e restituisce il dopo. */
function applica(db, { daScrivere, daCancellare }) {
  const dopo = new Map(db.map((r) => [String(r.id), r]));
  for (const id of daCancellare) dopo.delete(id);
  for (const r of daScrivere) {
    dopo.set(String(r.id), nelDb(r.id, r.dipendenteId, r.commessaId, r.data, r.ore));
  }
  return dopo;
}

prova("dopo il salvataggio gli id sono ESATTAMENTE quelli mandati dal browser", () => {
  for (let seme = 1; seme <= 200; seme++) {
    const { db, arrivo } = caso(seme);
    const dopo = applica(db, confrontaRegistrazioni({ nelDatabase: db, inArrivo: arrivo }));
    uguale([...dopo.keys()].sort(), [...new Set(arrivo.map((r) => String(r.id)))].sort(),
      `caso ${seme}: l'insieme degli id non corrisponde`);
  }
});

prova("una riga non cambiata non viene toccata NEMMENO UNA VOLTA", () => {
  /* Non basta che il risultato sia uguale: la riga non deve proprio essere
     passata dalla lista delle scritture. È la differenza fra «riscritta
     identica» e «lasciata stare», ed è tutto il lavoro. */
  const arrivo = RIMANDATE.map((r) => (r.id === "reg-300" ? { ...r, ore: 7 } : r));
  const { daScrivere } = confrontaRegistrazioni({ nelDatabase: PIEMME, inArrivo: arrivo });
  const toccate = new Set(daScrivere.map((r) => String(r.id)));
  for (const r of PIEMME) {
    if (r.id === "reg-300") continue;
    vero(!toccate.has(r.id), `${r.id} non doveva essere toccata`);
  }
});

prova("un id sopravvive a mille salvataggi di fila senza cambiare", () => {
  let db = PIEMME;
  for (let i = 0; i < 1000; i++) {
    const dopo = applica(db, confrontaRegistrazioni({ nelDatabase: db, inArrivo: RIMANDATE }));
    db = [...dopo.values()];
  }
  uguale(db.length, 624, "le righe sono ancora tutte");
  uguale(db.map((r) => r.id).sort(), PIEMME.map((r) => r.id).sort(), "e con gli stessi id");
});

/* ================================================================== */

console.log("\nQUELLO CHE NON DEVE SUCCEDERE MAI");

prova("elenchi vuoti o assenti non fanno esplodere niente", () => {
  for (const a of [{}, { nelDatabase: null, inArrivo: null }, { nelDatabase: [], inArrivo: [] }]) {
    const r = confrontaRegistrazioni(a);
    uguale(r.daScrivere, [], "niente da scrivere");
    uguale(r.daCancellare, [], "niente da cancellare");
  }
});

prova("righe malformate dentro l'elenco del database non fermano il confronto", () => {
  const db = [null, undefined, { id: null }, nelDb("r1", "d1", "c1", "2026-08-07", 8)];
  const r = confrontaRegistrazioni({ nelDatabase: db, inArrivo: [dalBrowser("r1", "d1", "c1", "2026-08-07", 8)] });
  uguale(r.daScrivere.length, 0, "la riga buona si riconosce uguale");
  uguale(r.daCancellare, [], "e le altre non erano righe");
});

/* ================================================================== */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
