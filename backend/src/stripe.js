import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY non impostata.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Prezzo dell'abbonamento mensile, in centesimi di euro. Creato al volo in
// ogni sessione di Checkout (price_data): non serve configurare un
// Product/Price nel dashboard Stripe.
export const PREZZO_MENSILE_CENTESIMI = 2900;
