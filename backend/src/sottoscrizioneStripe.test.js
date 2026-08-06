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
import { letturaSottoscrizione, chiaveListinoDellaSottoscrizione } from "./sottoscrizioneStripe.js";

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

prova("active e trialing danno accesso, il resto no", () => {
  uguale(letturaSottoscrizione(evento({ stato: "active" })).stato, "attivo");
  uguale(letturaSottoscrizione(evento({ stato: "trialing" })).stato, "attivo");
  for (const s of ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused", "canceled"]) {
    uguale(letturaSottoscrizione(evento({ stato: s })).stato, "scaduto", `con status "${s}"`);
  }
});

prova("la cancellazione porta a scaduto anche se lo status dice ancora active", () => {
  /* Nell'evento .deleted lo status dell'oggetto può ancora essere "active":
     conta il tipo di evento, non il campo. */
  const l = letturaSottoscrizione(evento({ tipo: "customer.subscription.deleted", stato: "active" }));
  uguale(l.stato, "scaduto");
});

prova("un abbonamento non pagato NON risulta attivo", () => {
  /* La regola: mai un abbonamento che sembra attivo e non lo è. */
  uguale(letturaSottoscrizione(evento({ stato: "past_due" })).stato, "scaduto");
  uguale(letturaSottoscrizione(evento({ stato: "unpaid" })).stato, "scaduto");
});

/* ------------------------------------------------------------------ */

console.log("\nEVENTI MALFORMATI NON FANNO ESPLODERE NIENTE");

prova("un evento vuoto non lancia e non inventa", () => {
  for (const e of [undefined, null, {}, { type: "x" }, { data: {} }, { data: { object: {} } }]) {
    const l = letturaSottoscrizione(e);
    uguale(l.acquisto, null, `con ${JSON.stringify(e)}`);
    uguale(l.stato, "scaduto", "senza informazioni non si concede accesso");
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
