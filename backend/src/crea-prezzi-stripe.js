/**
 * Crea su Stripe i sei prezzi dei piani, leggendoli da piani.js.
 *
 *     node src/crea-prezzi-stripe.js            mostra cosa farebbe, NON scrive
 *     node src/crea-prezzi-stripe.js --scrivi   crea quelli che mancano
 *
 * SENZA --scrivi NON TOCCA NIENTE. Stesso patto degli altri comandi che
 * scrivono: prima si guarda l'elenco, poi lo si autorizza.
 *
 * FUNZIONA IN TEST E IN PRODUZIONE, e non sa quale delle due sia: dipende
 * dalla STRIPE_SECRET_KEY che trova nell'ambiente. Per questo la modalità la
 * stampa a caratteri grossi prima di qualunque cosa — una chiave sbagliata nel
 * file sbagliato non è un'ipotesi teorica.
 *
 * PERCHÉ ESISTE. Gli importi stanno in piani.js e da nessun'altra parte. Se i
 * sei Price si creassero a mano dal dashboard, i prezzi vivrebbero in due
 * posti e prima o poi direbbero cose diverse. Così invece la fonte è una sola,
 * e nel codice non compare nessun identificatore Stripe: il collegamento è il
 * `lookup_key` ("cantiere_mensile", "impresa_annuale"), che piani.js sa
 * costruire e rileggere.
 *
 * È IDEMPOTENTE: crea solo quello che manca. Rieseguirlo non duplica niente.
 *
 * SE UN PREZZO ESISTE CON UN IMPORTO DIVERSO, si ferma e lo dice, senza
 * toccarlo. I Price su Stripe sono immutabili per costruzione: cambiare un
 * prezzo significa crearne uno nuovo e spostargli la chiave, e a quel punto
 * cambia quello che pagheranno i prossimi clienti. Non è una cosa che uno
 * script deve decidere da solo mentre passa.
 */
import "dotenv/config";
import { stripe, MODALITA_STRIPE } from "./stripe.js";
import { tutteLeCombinazioni } from "./piani.js";

const scrivi = process.argv.includes("--scrivi");
const inCentesimi = (euro) => Math.round(euro * 100);

/**
 * IL PRODOTTO DI UN PIANO, con un id deciso da noi.
 *
 * Un Product per PIANO, non per combinazione: mensile e annuale sono due
 * prezzi della stessa cosa, ed è così che su Stripe i ricavi si leggono.
 *
 * L'id è deterministico ("commexa_cantiere") e si va a prenderlo per id, non
 * per nome. Al primo giro l'avevo cercato per nome con products.search, e sono
 * usciti SEI prodotti invece di tre: la ricerca di Stripe ha un indice
 * differito, quindi il prodotto appena creato non si ritrovava un istante
 * dopo e ne nasceva un altro. Un id che decidiamo noi non dipende da nessun
 * indice e rende l'operazione idempotente per davvero.
 */
async function prodottoDelPiano(c) {
  const id = `commexa_${c.piano}`;
  try {
    return await stripe.products.retrieve(id);
  } catch (e) {
    if (e?.statusCode !== 404) throw e;
    return stripe.products.create({
      id,
      name: `Commexa ${c.nome}`,
      description: `Piano ${c.nome} di Commexa. Prezzi al netto dell'IVA.`,
      metadata: { piano: c.piano },
    });
  }
}

async function main() {
  console.log("");
  console.log("  ┌──────────────────────────────────────────────┐");
  console.log(`  │  STRIPE — MODALITÀ ${MODALITA_STRIPE.toUpperCase().padEnd(26)}│`);
  console.log("  └──────────────────────────────────────────────┘");
  console.log(scrivi ? "\nmodalità: SCRITTURA\n" : "\nmodalità: solo lettura (aggiungi --scrivi per creare davvero)\n");

  const daCreare = [];
  const discordanti = [];

  for (const c of tutteLeCombinazioni()) {
    const attesi = inCentesimi(c.euro);
    const trovati = await stripe.prices.list({ lookup_keys: [c.chiave], active: true, limit: 1 });
    const gia = trovati.data[0];

    if (!gia) {
      console.log(`  ${c.chiave.padEnd(20)} DA CREARE   ${c.euro} € / ${c.intervallo === "year" ? "anno" : "mese"} (${attesi} centesimi)`);
      daCreare.push(c);
      continue;
    }
    if (gia.unit_amount !== attesi || gia.currency !== "eur" || gia.recurring?.interval !== c.intervallo) {
      console.log(`  ${c.chiave.padEnd(20)} DISCORDA    su Stripe ${gia.unit_amount} ${gia.currency}/${gia.recurring?.interval}, ` +
        `in piani.js ${attesi} eur/${c.intervallo}`);
      discordanti.push({ c, gia });
      continue;
    }
    console.log(`  ${c.chiave.padEnd(20)} c'è già     ${c.euro} € / ${c.intervallo === "year" ? "anno" : "mese"}  (${gia.id})`);
  }

  if (discordanti.length > 0) {
    console.log("\n  ATTENZIONE: " + discordanti.length + " prezzo/i esistono con un importo diverso da piani.js.");
    console.log("  Non li tocco. Su Stripe un Price non si modifica: per cambiare un importo si crea");
    console.log("  un Price nuovo e gli si sposta la chiave (transfer_lookup_key). È una decisione");
    console.log("  che cambia quello che pagheranno i prossimi clienti, quindi la prende una persona.");
  }

  if (daCreare.length === 0) {
    console.log(`\nNiente da creare${discordanti.length ? " (a parte le discordanze qui sopra)" : ": ci sono già tutti e sei"}.\n`);
    process.exitCode = discordanti.length ? 1 : 0;
    return;
  }

  if (!scrivi) {
    console.log(`\n${daCreare.length} prezzo/i da creare. Non ho scritto niente.`);
    console.log("Per crearli: node src/crea-prezzi-stripe.js --scrivi\n");
    return;
  }

  console.log("");
  for (const c of daCreare) {
    const prodotto = await prodottoDelPiano(c);
    const creato = await stripe.prices.create({
      product: prodotto.id,
      currency: "eur",
      unit_amount: inCentesimi(c.euro),
      recurring: { interval: c.intervallo },
      lookup_key: c.chiave,
      /* Se la chiave fosse ancora attaccata a un prezzo vecchio (per esempio
         dopo un giro andato storto), gliela si porta via invece di fallire. */
      transfer_lookup_key: true,
      metadata: { piano: c.piano, fatturazione: c.fatturazione },
    });
    console.log(`  creato: ${c.chiave.padEnd(20)} ${c.euro} €  ->  ${creato.id}  (prodotto ${prodotto.id})`);
  }
  console.log("\nFatto.\n");
}

main()
  .catch((e) => { console.error("\nErrore:", e.message, "\n"); process.exitCode = 1; });
