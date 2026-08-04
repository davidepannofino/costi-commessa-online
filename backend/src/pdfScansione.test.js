/**
 * Collaudo della divisione e della lettura di un PDF a più pagine.
 *
 *     node src/pdfScansione.test.js
 *
 * Niente database e niente rete: il PDF di prova viene costruito qui, con le
 * caselle di testo al posto giusto, e poi riletto.
 *
 * LA COSA CHE QUESTO FILE INCHIODA. Che il testo letto resti legato alla
 * PAGINA da cui viene. È l'unico errore davvero pericoloso di tutta questa
 * funzione: se gli indici scivolassero di uno, il DDT della pagina 2 finirebbe
 * archiviato sotto la commessa della pagina 3 — e nessuno se ne accorgerebbe,
 * perché il documento c'è, il numero c'è, e sono solo sulla commessa sbagliata.
 * Per questo le tre pagine di prova hanno contenuti diversi fra loro e una
 * volutamente vuota: se l'ordine slitta, si vede subito.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { leggiTestoPagine, estraiPagina, contaPagine } from "./pdfScansione.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  return fn().then(
    () => { passati++; console.log(`  ok   ${nome}`); },
    (e) => { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
  );
}
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che} atteso ${b}, avuto ${a}`);
}

/** Un blocco finto: tre pagine, tre caselle diverse, come quelle vere. */
async function blocco(caselle) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const testo of caselle) {
    const pagina = doc.addPage([595, 842]); // A4
    if (testo) pagina.drawText(testo, { x: 40, y: 780, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

const CASELLE = ["PD02 B05/4711", "PC24 B05/4959", ""];

console.log("\nLETTURA DI UN BLOCCO SCANSIONATO");

await prova("conta le pagine", async () => {
  uguale(await contaPagine(await blocco(CASELLE)), 3);
});

await prova("legge la casella di OGNI pagina, nell'ordine giusto", async () => {
  const pagine = await leggiTestoPagine(await blocco(CASELLE));
  uguale(pagine.map((p) => p.numeroPagina), [1, 2, 3]);
  uguale(pagine[0].testo, "PD02 B05/4711");
  uguale(pagine[1].testo, "PC24 B05/4959");
});

await prova("una pagina senza casella torna con testo vuoto, non salta", async () => {
  const pagine = await leggiTestoPagine(await blocco(CASELLE));
  uguale(pagine.length, 3, "la pagina vuota NON deve sparire dall'elenco:");
  uguale(pagine[2], { numeroPagina: 3, testo: "" });
});

console.log("\nCASELLA SPEZZATA IN PIÙ FRAMMENTI");

/* pdfjs non restituisce parole ma frammenti di disegno: la stessa casella può
   arrivare intera (come nel file vero: un frammento, "PD02") oppure spezzata.
   Questi due casi sono opposti e vanno distinti dalla DISTANZA, non dal numero
   di frammenti — altrimenti si raddrizza uno e si rompe l'altro. */
async function paginaConPezzi(pezzi) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage([595, 842]);
  for (const { testo, x } of pezzi) pagina.drawText(testo, { x, y: 780, size: 12, font });
  return { pdf: Buffer.from(await doc.save()), font };
}

await prova("due pezzi ATTACCATI sono una parola sola: PC + 24 → PC24", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const largo = font.widthOfTextAtSize("PC", 12);
  const { pdf } = await paginaConPezzi([
    { testo: "PC", x: 40 },
    { testo: "24", x: 40 + largo },      // esattamente dove finisce il precedente
    { testo: "B05/4959", x: 40 + largo + font.widthOfTextAtSize("24", 12) + 12 },
  ]);
  const [p] = await leggiTestoPagine(pdf);
  uguale(p.testo, "PC24 B05/4959", "se esce 'PC 24 B05/4959' la regola leggerebbe PC come commessa:");
});

await prova("due pezzi STACCATI sono due cose: resta lo spazio in mezzo", async () => {
  const { pdf } = await paginaConPezzi([
    { testo: "PD02", x: 40 },
    { testo: "B05/4711", x: 120 },
  ]);
  const [p] = await leggiTestoPagine(pdf);
  uguale(p.testo, "PD02 B05/4711");
});

await prova("un frammento solo resta com'è — il caso del file vero", async () => {
  const { pdf } = await paginaConPezzi([{ testo: "PC18", x: 40 }]);
  const [p] = await leggiTestoPagine(pdf);
  uguale(p.testo, "PC18");
});

console.log("\nDIVISIONE — la pagina estratta è quella chiesta");

await prova("estrarre la pagina 2 dà un PDF di una pagina sola", async () => {
  const pagina = await estraiPagina(await blocco(CASELLE), 2);
  uguale(await contaPagine(pagina), 1);
});

await prova("e dentro c'è il testo della pagina 2, non di un'altra", async () => {
  const pagina = await estraiPagina(await blocco(CASELLE), 2);
  const letto = await leggiTestoPagine(pagina);
  uguale(letto.length, 1);
  uguale(letto[0].testo, "PC24 B05/4959", "se qui esce PD02 gli indici sono scivolati:");
});

await prova("la prima e l'ultima pagina non sbagliano di uno", async () => {
  const sorgente = await blocco(CASELLE);
  uguale((await leggiTestoPagine(await estraiPagina(sorgente, 1)))[0].testo, "PD02 B05/4711");
  uguale((await leggiTestoPagine(await estraiPagina(sorgente, 3)))[0].testo, "");
});

await prova("una pagina che non esiste è un errore, non un risultato a caso", async () => {
  const sorgente = await blocco(CASELLE);
  let esploso = false;
  try { await estraiPagina(sorgente, 4); } catch { esploso = true; }
  uguale(esploso, true);
  esploso = false;
  try { await estraiPagina(sorgente, 0); } catch { esploso = true; }
  uguale(esploso, true);
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
