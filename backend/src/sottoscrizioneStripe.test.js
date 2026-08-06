/**
 * Collaudo di come si legge una sottoscrizione Stripe. Si esegue con:
 *
 *     node src/sottoscrizioneStripe.test.js
 *
 * Nessuna chiamata a Stripe e nessun database: `letturaSottoscrizione` è una
 * funzione pura, e gli eventi qui sotto hanno la forma di quelli veri.
 *
 * LA PROPRIETÀ CHE TIENE IN PIEDI TUTTO: il piano comprato si ricava dal
 * PREZZO, non dai metadati. I metadati possono mancare — un abbonamento creato
 * a mano dal dashboard, uno migrato, uno più vecchio di questo codice — mentre
 * una sottoscrizione senza prezzo non esiste. Se qualcuno inverte l'ordine
 * delle due fonti, o mette un ripiego dove adesso c'è `null`, qui suona la
 * sveglia: un piano indovinato significa registrare che un'azienda ha comprato
 * una cosa che non ha comprato.
 */
import { letturaSottoscrizione, letturaFattura, chiaveListinoDellaSottoscrizione } from "./sottoscrizioneStripe.js";

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

/** Un evento con la forma di quelli veri di Stripe. */
const evento = ({ tipo = "customer.subscription.created", stato = "active",
                  lookupKey = "impresa_mensile", metadati = {}, id = "sub_123", cliente = "cus_123" } = {}) => ({
  type: tipo,
  data: {
    object: {
      id, customer: cliente, status: stato, metadata: metadati,
      items: { data: [{ price: lookupKey === null ? {} : { id: "price_x", lookup_key: lookupKey } }] },
    },
  },
});

/* ------------------------------------------------------------------ */

console.log("\nIL PIANO SI RICAVA DAL PREZZO");

prova("una sottoscrizione attiva dice piano, periodicità e stato", () => {
  const l = letturaSottoscrizione(evento({ lookupKey: "impresa_annuale" }));
  uguale(l.stato, "attivo");
  uguale(l.acquisto, { piano: "impresa", fatturazione: "annuale" });
  uguale(l.sottoscrizioneId, "sub_123");
  uguale(l.clienteId, "cus_123");
});

prova("tutte e sei le chiavi si leggono", () => {
  for (const piano of ["cantiere", "impresa", "struttura"]) {
    for (const fatturazione of ["mensile", "annuale"]) {
      const l = letturaSottoscrizione(evento({ lookupKey: `${piano}_${fatturazione}` }));
      uguale(l.acquisto, { piano, fatturazione }, `su ${piano}_${fatturazione}`);
    }
  }
});

prova("IL PREZZO VINCE SUI METADATI, anche quando dicono cose diverse", () => {
  /* Se i due disaccordano, comanda il prezzo: è quello che il cliente sta
     davvero pagando. I metadati potrebbero essere rimasti indietro. */
  const l = letturaSottoscrizione(evento({
    lookupKey: "struttura_mensile",
    metadati: { piano: "cantiere", fatturazione: "annuale" },
  }));
  uguale(l.acquisto, { piano: "struttura", fatturazione: "mensile" });
});

/* ------------------------------------------------------------------ */

console.log("\nI METADATI SONO LA RETE, NON LA FONTE");

prova("senza lookup_key si ripiega sui metadati", () => {
  const l = letturaSottoscrizione(evento({ lookupKey: null, metadati: { piano: "cantiere", fatturazione: "annuale" } }));
  uguale(l.acquisto, { piano: "cantiere", fatturazione: "annuale" });
});

prova("senza lookup_key E senza metadati NON si inventa un piano", () => {
  /* È il caso per cui la funzione restituisce null invece di un valore
     predefinito: chi chiama scrive lo stato e lascia stare il piano. */
  const l = letturaSottoscrizione(evento({ lookupKey: null, metadati: {} }));
  uguale(l.acquisto, null);
  uguale(l.stato, "attivo", "lo stato si sa lo stesso");
});

prova("metadati storti non producono un piano a caso", () => {
  for (const m of [{ piano: "vip", fatturazione: "mensile" },
                   { piano: "cantiere", fatturazione: "trimestrale" },
                   { piano: "cantiere" },
                   { fatturazione: "mensile" }]) {
    const l = letturaSottoscrizione(evento({ lookupKey: null, metadati: m }));
    uguale(l.acquisto, null, `con metadati ${JSON.stringify(m)}`);
  }
});

prova("una lookup_key inventata non diventa un piano", () => {
  const l = letturaSottoscrizione(evento({ lookupKey: "premium_mensile", metadati: {} }));
  uguale(l.acquisto, null);
});

/* ------------------------------------------------------------------ */

console.log("\nLO STATO");

prova("ogni stato Stripe ha la SUA traduzione", () => {
  uguale(letturaSottoscrizione(evento({ stato: "active" })).stato, "attivo");
  uguale(letturaSottoscrizione(evento({ stato: "trialing" })).stato, "attivo");
  /* past_due sta da solo: vuol dire che Stripe STA ANCORA RIPROVANDO. Prima
     finiva insieme a canceled in "scaduto", ed è per quello che un'impresa con
     la carta scaduta si trovava chiusa fuori mentre stava lavorando. */
  uguale(letturaSottoscrizione(evento({ stato: "past_due" })).stato, "in_ritardo");
  for (const s of ["unpaid", "incomplete", "incomplete_expired", "paused", "canceled"]) {
    uguale(letturaSottoscrizione(evento({ stato: s })).stato, "scaduto", `con status "${s}"`);
  }
});

prova("uno stato che non conosciamo NON viene tradotto", () => {
  /* null vuol dire "non so": chi chiama deve lasciare stare la riga e far
     rumore. Un ramo finale "altrimenti scaduto" declasserebbe un'azienda per
     una parola che Stripe ha aggiunto e noi non abbiamo ancora imparato. */
  for (const s of ["qualcosa_di_nuovo", "PAST_DUE", "", 42]) {
    uguale(letturaSottoscrizione(evento({ stato: s })).stato, null, `con status ${JSON.stringify(s)}`);
  }
});

prova("la cancellazione porta a scaduto anche se lo status dice ancora active", () => {
  /* Nell'evento .deleted lo status dell'oggetto può ancora essere "active":
     conta il tipo di evento, non il campo. */
  const l = letturaSottoscrizione(evento({ tipo: "customer.subscription.deleted", stato: "active" }));
  uguale(l.stato, "scaduto");
});

prova("un abbonamento non pagato NON risulta attivo", () => {
  /* La regola resta quella: mai un abbonamento che sembra attivo e non lo è.
     Si afferma la PROPRIETÀ — "non è attivo" — e non un valore preciso, così
     la prova continua a proteggere la regola anche quando gli stati cambiano
     nome o se ne aggiunge un altro. */
  for (const s of ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused", "canceled"]) {
    const l = letturaSottoscrizione(evento({ stato: s }));
    vero(l.stato !== "attivo", `"${s}" non deve risultare attivo, risulta "${l.stato}"`);
  }
});

prova("in_ritardo da solo NON dà accesso: lo dà la data scritta", () => {
  /* Questo file traduce e basta. Che l'accesso resti aperto lo decide
     calcolaStatoAccesso guardando tolleranza_fino_al, e quella data la
     concede tolleranza.js solo a chi ha già pagato. Se un giorno bastasse
     "in_ritardo" per entrare, chi si iscrive con una carta rotta avrebbe
     accesso libero. */
  const l = letturaSottoscrizione(evento({ stato: "past_due" }));
  uguale(l.stato, "in_ritardo");
  vero(!("haAccesso" in l), "questa funzione non deve decidere l'accesso");
});

/* ------------------------------------------------------------------ */

console.log("\nEVENTI MALFORMATI NON FANNO ESPLODERE NIENTE");

prova("un evento vuoto non lancia e non inventa", () => {
  for (const e of [undefined, null, {}, { type: "x" }, { data: {} }, { data: { object: {} } }]) {
    const l = letturaSottoscrizione(e);
    uguale(l.acquisto, null, `con ${JSON.stringify(e)}`);
    /* Prima qui l'atteso era "scaduto". Adesso è null, ed è meglio: senza
       informazioni non si conclude NIENTE, invece di concludere la cosa
       peggiore. Chi chiama non scrive e fa rumore — un evento malformato non
       deve poter togliere l'accesso a un cliente che ha pagato. */
    uguale(l.stato, null, "senza informazioni non si conclude niente");
  }
});

/* ------------------------------------------------------------------ */

console.log("\nLE FATTURE: fino a quando Stripe riproverà");

const fattura = ({ tipo = "invoice.payment_failed", ...campi } = {}) =>
  ({ type: tipo, data: { object: { customer: "cus_1", subscription: "sub_1", ...campi } } });

prova("next_payment_attempt diventa una data", () => {
  const quando = Math.floor(Date.parse("2026-08-10T09:00:00Z") / 1000);
  const f = letturaFattura(fattura({ next_payment_attempt: quando }));
  uguale(f.prossimoTentativo.toISOString(), "2026-08-10T09:00:00.000Z");
});

prova("SENZA next_payment_attempt vuol dire che Stripe ha smesso", () => {
  for (const v of [null, undefined, 0]) {
    uguale(letturaFattura(fattura({ next_payment_attempt: v })).prossimoTentativo, null,
      `next_payment_attempt ${JSON.stringify(v)}`);
  }
});

prova("billing_reason distingue il rinnovo dalla prima fattura", () => {
  vero(letturaFattura(fattura({ billing_reason: "subscription_cycle" })).eRinnovo, "subscription_cycle è un rinnovo");
  vero(!letturaFattura(fattura({ billing_reason: "subscription_create" })).eRinnovo, "subscription_create NON lo è");
  vero(!letturaFattura(fattura({ billing_reason: "subscription_update" })).eRinnovo, "subscription_update nemmeno");
  vero(!letturaFattura(fattura({})).eRinnovo, "senza billing_reason non è un rinnovo");
});

prova("riconosce il pagamento riuscito", () => {
  vero(letturaFattura(fattura({ tipo: "invoice.payment_succeeded" })).riuscita, "riuscita");
  vero(!letturaFattura(fattura({ tipo: "invoice.payment_failed" })).riuscita, "fallita");
});

prova("una fattura vuota non fa esplodere niente", () => {
  for (const e of [undefined, null, {}, { data: {} }, { data: { object: {} } }]) {
    const f = letturaFattura(e);
    uguale(f.prossimoTentativo, null, `con ${JSON.stringify(e)}`);
    uguale(f.eRinnovo, false, "senza dati non è un rinnovo");
  }
});

prova("chiaveListinoDellaSottoscrizione regge oggetti incompleti", () => {
  uguale(chiaveListinoDellaSottoscrizione(undefined), null);
  uguale(chiaveListinoDellaSottoscrizione({}), null);
  uguale(chiaveListinoDellaSottoscrizione({ items: { data: [] } }), null);
  uguale(chiaveListinoDellaSottoscrizione({ items: { data: [{ price: {} }] } }), null);
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exitCode = falliti === 0 ? 0 : 1;
