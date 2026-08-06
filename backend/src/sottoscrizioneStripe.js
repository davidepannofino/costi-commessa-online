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
export function letturaSottoscrizione(evento) {
  const s = evento?.data?.object;
  const statoStripe = evento?.type === "customer.subscription.deleted" ? "canceled" : s?.status;
  return {
    stato: ["active", "trialing"].includes(statoStripe) ? "attivo" : "scaduto",
    sottoscrizioneId: s?.id ?? null,
    clienteId: s?.customer ?? null,
    acquisto:
      daChiaveListino(chiaveListinoDellaSottoscrizione(s)) ||
      daChiaveListino(`${s?.metadata?.piano}_${s?.metadata?.fatturazione}`),
  };
}
