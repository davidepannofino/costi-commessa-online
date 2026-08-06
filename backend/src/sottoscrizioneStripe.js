/**
 * COME SI LEGGE UNA SOTTOSCRIZIONE STRIPE: cosa dice al nostro database.
 *
 * Funzioni pure, in un file loro. Stanno separate da stripe.js perché quello
 * costruisce il client e pretende una STRIPE_SECRET_KEY nell'ambiente: una
 * decisione che si può prendere leggendo un oggetto JSON non deve avere
 * bisogno di una chiave segreta per essere messa alla prova.
 *
 * LA REGOLA: il piano comprato si ricava dal PREZZO della sottoscrizione, non
 * dai metadati. Il prezzo c'è sempre — una sottoscrizione senza prezzo non
 * esiste — mentre i metadati possono mancare: un abbonamento creato a mano dal
 * dashboard, uno migrato, uno più vecchio di questo codice. I metadati si
 * scrivono lo stesso, ma restano la cintura di sicurezza, non la fonte.
 */
import { daChiaveListino } from "./piani.js";

/** Il `lookup_key` del prezzo di questa sottoscrizione, o null. */
export function chiaveListinoDellaSottoscrizione(subscription) {
  const prezzo = subscription?.items?.data?.[0]?.price;
  return prezzo?.lookup_key || null;
}

/**
 * Che cosa dice al database questo evento.
 *
 * @returns { stato, sottoscrizioneId, clienteId, acquisto }
 *   `acquisto` è { piano, fatturazione } se si è capito COSA è stato comprato,
 *   altrimenti **null** — e chi chiama, in quel caso, deve scrivere lo stato e
 *   lasciare stare il piano. Indovinarlo vorrebbe dire registrare che
 *   un'azienda ha comprato una cosa che non ha comprato: nessun ripiego che
 *   afferma, come dice PRODUCT.md.
 *
 * Senza informazioni lo stato è "scaduto" e non "attivo": davanti a un evento
 * che non si capisce, non si concede accesso.
 */
/**
 * Gli stati di Stripe, tradotti uno per uno.
 *
 * Prima qui c'era `["active","trialing"].includes(s) ? "attivo" : "scaduto"`, e
 * quella riga sola è tutto il problema del rinnovo fallito: schiacciava
 * `past_due` — che vuol dire «Stripe sta ancora riprovando a incassare» —
 * sullo stesso esito di `canceled`, che vuol dire «è finita». Chi aveva la
 * carta scaduta e chi aveva disdetto ricevevano lo stesso trattamento, e il
 * primo si trovava chiuso fuori mentre stava lavorando.
 *
 * Adesso ogni stato è scritto. Uno stato che NON è in questa mappa non viene
 * tradotto: chi chiama riceve `null` e non tocca niente. Un ramo finale
 * "altrimenti scaduto" declasserebbe un'azienda per una parola che Stripe ha
 * aggiunto e noi non conosciamo ancora.
 */
const STATI_STRIPE = {
  active: "attivo",
  trialing: "attivo",
  /* Una fattura non è stata pagata e Stripe sta ripetendo i tentativi. Non è
     ancora un addio: nella maggior parte dei casi un tentativo successivo va a
     buon fine. Quanto duri lo dice Stripe, fattura per fattura. */
  past_due: "in_ritardo",
  /* Tentativi esauriti. Quale dei due arrivi dipende dall'azione conclusiva
     configurata nel pannello Stripe: "disdici" manda canceled (come
     customer.subscription.deleted), "marca non pagato" manda unpaid. */
  canceled: "scaduto",
  unpaid: "scaduto",
  /* Il primo pagamento non è mai riuscito: l'abbonamento non è mai partito. */
  incomplete: "scaduto",
  incomplete_expired: "scaduto",
  paused: "scaduto",
};

export function letturaSottoscrizione(evento) {
  const s = evento?.data?.object;
  const statoStripe = evento?.type === "customer.subscription.deleted" ? "canceled" : s?.status;
  return {
    /* null = "non so cosa sia questo stato". Chi chiama deve lasciare stare la
       riga e far rumore, non scegliere per conto proprio. */
    stato: STATI_STRIPE[statoStripe] ?? null,
    statoStripe: statoStripe ?? null,
    sottoscrizioneId: s?.id ?? null,
    clienteId: s?.customer ?? null,
    acquisto:
      daChiaveListino(chiaveListinoDellaSottoscrizione(s)) ||
      daChiaveListino(`${s?.metadata?.piano}_${s?.metadata?.fatturazione}`),
  };
}

/**
 * Che cosa dice una fattura fallita o riuscita.
 *
 * `prossimoTentativo` è il campo che regge tutta la tolleranza:
 * `invoice.next_payment_attempt` è il momento del prossimo tentativo
 * automatico, e vale **null quando Stripe non ne farà più**. Non è una
 * scadenza che deduciamo noi: è Stripe che dichiara se ha ancora intenzione
 * di incassare.
 *
 * `eRinnovo` viene da `billing_reason`, e serve a non concedere tolleranza
 * sulla PRIMA fattura di un abbonamento: là un pagamento fallito vuol dire
 * che non si è mai pagato niente.
 */
export function letturaFattura(evento) {
  const f = evento?.data?.object;
  const t = f?.next_payment_attempt;
  return {
    riuscita: evento?.type === "invoice.payment_succeeded",
    clienteId: f?.customer ?? null,
    sottoscrizioneId: f?.subscription ?? null,
    motivoFatturazione: f?.billing_reason ?? null,
    eRinnovo: f?.billing_reason === "subscription_cycle",
    /* Stripe manda i tempi in secondi. Qui diventano una data, o null. */
    prossimoTentativo: typeof t === "number" && t > 0 ? new Date(t * 1000) : null,
  };
}
