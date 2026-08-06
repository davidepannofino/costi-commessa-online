/**
 * Collaudo della tolleranza sul rinnovo fallito. Si esegue con:
 *
 *     node src/tolleranza.test.js
 *
 * LE PROVE CHE CONTANO sono quelle che NEGANO la tolleranza. Concederla a chi
 * sta pagando è il beneficio; concederla a chi non ha mai pagato è tre
 * settimane di applicazione gratis a chiunque si iscriva con una carta che non
 * funziona. Un errore si vede subito, l'altro no.
 */
import { decidiTolleranza, tolleranzaInCorso, MARGINE_ORE, TETTO_GIORNI } from "./tolleranza.js";

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

const ORA = 60 * 60 * 1000, GIORNO = 24 * ORA;
const ADESSO = new Date("2026-08-07T10:00:00Z");
const fra = (ms) => new Date(ADESSO.getTime() + ms);

/** Il caso normale: cliente pagante, rinnovo fallito, Stripe riprova fra 3 giorni. */
const normale = (extra = {}) => decidiTolleranza({
  eraAttivo: true, eRinnovo: true,
  prossimoTentativo: fra(3 * GIORNO), primoFallimento: null, adesso: ADESSO, ...extra,
});

/* ------------------------------------------------------------------ */

console.log("\nCHI STA PAGANDO NON SI CHIUDE FUORI");

prova("rinnovo fallito di un cliente attivo: tolleranza concessa", () => {
  const r = normale();
  vero(r.concessa, "doveva essere concessa");
  uguale(r.fino.toISOString(), fra(3 * GIORNO + MARGINE_ORE * ORA).toISOString(), "la scadenza");
});

prova("si aspetta OLTRE il tentativo, non fino al tentativo", () => {
  /* Se scadesse all'istante del tentativo, chiuderemmo mentre l'addebito che
     risolve tutto è in volo fra la banca e il webhook. */
  const r = normale();
  vero(r.fino > fra(3 * GIORNO), "la tolleranza deve superare il momento del tentativo");
});

prova("un tentativo lontano viene tagliato dal tetto", () => {
  const r = normale({ prossimoTentativo: fra(60 * GIORNO) });
  vero(r.concessa, "concessa");
  uguale(r.fino.toISOString(), fra(TETTO_GIORNI * GIORNO).toISOString(), "la scadenza col tetto");
  vero(/tetto/.test(r.motivo), `il motivo deve nominare il tetto, dice: ${r.motivo}`);
});

prova("il tetto si misura dal PRIMO fallimento, non da questo", () => {
  /* Altrimenti ogni tentativo fallito allungherebbe la corda e la serie non
     finirebbe mai: sarebbe accesso perpetuo a chi non paga mai. */
  const r = decidiTolleranza({
    eraAttivo: true, eRinnovo: true,
    prossimoTentativo: fra(5 * GIORNO),
    primoFallimento: new Date(ADESSO.getTime() - 19 * GIORNO),
    adesso: ADESSO,
  });
  uguale(r.fino.toISOString(), fra(2 * GIORNO).toISOString(), "restano 2 giorni dei 21");
});

/* ------------------------------------------------------------------ */

console.log("\nCHI NON HA MAI PAGATO NON HA NESSUNA TOLLERANZA");

prova("azienda che NON risultava attiva: niente tolleranza", () => {
  /* Il caso da evitare: mi iscrivo, metto una carta che non funziona, e ho
     tre settimane gratis. */
  const r = normale({ eraAttivo: false });
  vero(!r.concessa, "non doveva essere concessa");
  uguale(r.fino, null, "la scadenza");
});

prova("prima fattura di un abbonamento nuovo: niente tolleranza", () => {
  const r = normale({ eRinnovo: false });
  vero(!r.concessa, "non doveva essere concessa");
});

prova("i due controlli sono INDIPENDENTI: basta che uno dei due neghi", () => {
  vero(!normale({ eraAttivo: false, eRinnovo: true }).concessa, "non attivo ma rinnovo");
  vero(!normale({ eraAttivo: true, eRinnovo: false }).concessa, "attivo ma non rinnovo");
  vero(!normale({ eraAttivo: false, eRinnovo: false }).concessa, "nessuno dei due");
  vero(normale({ eraAttivo: true, eRinnovo: true }).concessa, "tutti e due");
});

prova("il motivo del rifiuto dice QUALE cancello ha chiuso", () => {
  vero(/mai completato un pagamento/.test(normale({ eraAttivo: false }).motivo));
  vero(/prima fattura/.test(normale({ eRinnovo: false }).motivo));
});

/* ------------------------------------------------------------------ */

console.log("\nQUANDO STRIPE SMETTE, SMETTIAMO ANCHE NOI");

prova("nessun prossimo tentativo (null): la tolleranza finisce adesso", () => {
  const r = normale({ prossimoTentativo: null });
  vero(!r.concessa, "non doveva essere concessa");
  vero(/altri tentativi/.test(r.motivo), `motivo: ${r.motivo}`);
});

prova("una data non valida vale come 'ha smesso', non come 'per sempre'", () => {
  for (const v of [undefined, 0, "", "domani", NaN, new Date("boh")]) {
    vero(!decidiTolleranza({ eraAttivo: true, eRinnovo: true, prossimoTentativo: v, adesso: ADESSO }).concessa,
      `prossimoTentativo ${JSON.stringify(v)} non deve concedere niente`);
  }
});

prova("un tentativo già passato non concede niente", () => {
  const r = normale({ prossimoTentativo: fra(-10 * GIORNO) });
  vero(!r.concessa, "non doveva essere concessa");
});

prova("una serie che ha gia' sfondato il tetto non concede niente", () => {
  const r = decidiTolleranza({
    eraAttivo: true, eRinnovo: true,
    prossimoTentativo: fra(2 * GIORNO),
    primoFallimento: new Date(ADESSO.getTime() - 30 * GIORNO),
    adesso: ADESSO,
  });
  vero(!r.concessa, "oltre i 21 giorni non si tollera più");
});

/* ------------------------------------------------------------------ */

console.log("\nLA DATA SCRITTA CHIUDE DA SOLA");

prova("una tolleranza nel futuro è in corso, una nel passato no", () => {
  vero(tolleranzaInCorso(fra(GIORNO), ADESSO), "domani");
  vero(!tolleranzaInCorso(fra(-GIORNO), ADESSO), "ieri");
});

prova("SENZA DATA non c'è tolleranza: il silenzio chiude, non apre", () => {
  /* È la proprietà che rende il meccanismo non aggirabile. Se un webhook si
     perde, o il server è giù, o Stripe non ci parla più, l'accesso si chiude
     da solo. Se il vuoto valesse "tolleranza", basterebbe far cadere un
     webhook per non pagare mai più. */
  for (const v of [null, undefined, "", 0, "non una data"]) {
    vero(!tolleranzaInCorso(v, ADESSO), `${JSON.stringify(v)} non deve tenere aperto`);
  }
});

prova("accetta anche una stringa, com'è quando arriva dal database", () => {
  vero(tolleranzaInCorso(fra(GIORNO).toISOString(), ADESSO), "stringa ISO futura");
  vero(!tolleranzaInCorso(fra(-GIORNO).toISOString(), ADESSO), "stringa ISO passata");
});

/* ------------------------------------------------------------------ */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
