/**
 * Il PDF di un blocco di DDT: si legge pagina per pagina, e si divide.
 *
 * COSA C'È DENTRO QUEL FILE. Una scansione: ogni pagina è un'immagine, e non
 * c'è niente da leggere. L'unica parte leggibile a macchina è una casella di
 * testo digitale aggiunta sopra, con dentro il codice della commessa e il
 * numero del DDT. Quindi qui NON si fa OCR — non si interpreta un'immagine, si
 * legge un testo che c'è davvero. Nessun costo a pagina, nessun Document AI.
 *
 * DUE MESTIERI, DUE LIBRERIE. pdfjs-dist sa leggere e non sa scrivere; pdf-lib
 * sa scrivere e non sa leggere il testo. Servono entrambe: la prima per sapere
 * cosa c'è scritto su ogni pagina, la seconda per estrarre ogni pagina come PDF
 * a sé, che è quello che finirà in archivio.
 *
 * L'ORDINE NON È CASUALE. Il testo si legge PRIMA di dividere, sul documento
 * intero, così ogni casella resta legata al numero di pagina da cui viene: se
 * si dividesse prima e si leggesse dopo, basterebbe un errore di indice per
 * archiviare il DDT giusto sotto la commessa sbagliata — in silenzio, che è
 * l'unico modo in cui questo software non deve mai sbagliare.
 */
import { PDFDocument } from "pdf-lib";

let pdfjs = null;
async function caricaPdfjs() {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

/** Oltre questo non si va: un blocco più grosso è quasi sempre uno sbaglio, e
 *  intanto il server macinerebbe a vuoto. */
export const MAX_PAGINE_SCANSIONE = 40;

/**
 * Il testo di ogni pagina, nell'ordine delle pagine.
 *
 * Restituisce [{ numeroPagina, testo }] dove `testo` è tutto quello che la
 * pagina contiene di leggibile, unito in una riga sola. Non si cerca di capire
 * dove sia la casella: se l'unica cosa scritta è quella, tutto il testo È la
 * casella — e se un giorno ce ne fosse dell'altro, la regola di lettura
 * (primo pezzo = commessa) continuerebbe a valere sulla prima cosa scritta.
 */
export async function leggiTestoPagine(buffer) {
  const { getDocument } = await caricaPdfjs();
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  if (doc.numPages > MAX_PAGINE_SCANSIONE) {
    throw new Error(`Il PDF ha ${doc.numPages} pagine: il massimo per una scansione è ${MAX_PAGINE_SCANSIONE}.`);
  }

  const pagine = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const contenuto = await (await doc.getPage(n)).getTextContent();
    const testo = contenuto.items
      .map((f) => String(f.str ?? ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pagine.push({ numeroPagina: n, testo });
  }
  return pagine;
}

/**
 * Estrae UNA pagina come PDF a sé stante.
 *
 * Si fa una alla volta, su richiesta, invece di spezzare tutto in anticipo:
 * finché l'utente non conferma non deve restare in giro niente, e le pagine
 * che non verranno archiviate non hanno motivo di essere costruite.
 */
export async function estraiPagina(buffer, numeroPagina) {
  const originale = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true });
  const totale = originale.getPageCount();
  if (numeroPagina < 1 || numeroPagina > totale) {
    throw new Error(`La pagina ${numeroPagina} non esiste: il PDF ne ha ${totale}.`);
  }
  const nuovo = await PDFDocument.create();
  const [pagina] = await nuovo.copyPages(originale, [numeroPagina - 1]);
  nuovo.addPage(pagina);
  return Buffer.from(await nuovo.save());
}

/** Quante pagine ha, senza leggerne il testo: serve ai controlli di soglia. */
export async function contaPagine(buffer) {
  const doc = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true });
  return doc.getPageCount();
}
