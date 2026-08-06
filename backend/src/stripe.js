import Stripe from "stripe";
import { chiaveListino } from "./piani.js";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY non impostata.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * In che modalità sta lavorando questa istanza, letto dalla chiave stessa.
 *
 * Serve soprattutto agli script: prima di creare qualcosa su Stripe si stampa
 * a caratteri grossi se si sta parlando con l'ambiente di prova o con quello
 * vero. Una chiave sbagliata nel file sbagliato non è un'ipotesi teorica.
 */
export const MODALITA_STRIPE =
  String(process.env.STRIPE_SECRET_KEY).startsWith("sk_live_") ? "produzione" : "test";

/**
 * IL PREZZO DI UN PIANO SU STRIPE, CERCATO PER NOME.
 *
 * Gli identificatori veri dei Price (`price_1Abc…`) non compaiono in nessun
 * punto del codice e in nessuna variabile d'ambiente. Si chiede a Stripe
 * «dammi il prezzo che si chiama cantiere_mensile» e si ottiene quello giusto,
 * in test come in produzione, senza sei valori da tenere allineati fra due
 * ambienti — che è il doppione che questo progetto continua a rifiutare.
 *
 * Il `lookup_key` lo costruisce piani.js, che resta l'unica fonte dei prezzi.
 * I Price su Stripe li crea `node src/crea-prezzi-stripe.js`, leggendo di là.
 *
 * Se il prezzo non c'è, NON se ne inventa uno al volo: vuol dire che lo script
 * non è mai stato eseguito in questa modalità, e un prezzo improvvisato
 * addebiterebbe una cifra che non è passata da nessun controllo.
 */
export async function prezzoStripeDi(idPiano, fatturazione) {
  const chiave = chiaveListino(idPiano, fatturazione);
  const elenco = await stripe.prices.list({ lookup_keys: [chiave], active: true, limit: 1 });
  const prezzo = elenco.data[0];
  if (!prezzo) {
    throw new Error(
      `Su Stripe (${MODALITA_STRIPE}) non esiste nessun prezzo "${chiave}". ` +
      "Esegui `node src/crea-prezzi-stripe.js --scrivi` in questa modalità."
    );
  }
  return prezzo;
}

/* Come si LEGGE una sottoscrizione (quale piano è stato comprato, che stato
   ha) sta in sottoscrizioneStripe.js: sono funzioni pure, e non devono avere
   bisogno di una chiave segreta per essere messe alla prova. */
