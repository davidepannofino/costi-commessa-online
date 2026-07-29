/**
 * LETTURA DELLE FATTURE IN PDF — il "piano B" quando l'XML non c'è.
 *
 * QUESTO È L'UNICO FILE CHE SA COM'È FATTA UNA FATTURA STAMPATA.
 * È il gemello di fatturaPA.js: quello conosce i nomi dei campi XML, questo
 * conosce le forme del testo. Quando vedremo PDF di fornitori diversi si
 * adatta il blocco REGOLE qui sotto, senza toccare il resto.
 *
 * DIFFERENZA IMPORTANTE RISPETTO ALL'XML. L'XML è un dato: quello che c'è
 * scritto è esatto. Un PDF è una stampa: qui si RICONOSCE, e riconoscere può
 * sbagliare. Perciò la regola di questo modulo è una sola:
 *
 *     quando non si è sicuri, si lascia vuoto e si segnala.
 *     Mai un numero dedotto e presentato come se fosse letto.
 *
 * Il controllo che dà fiducia è aritmetico: se su una riga si trovano tre
 * numeri per cui quantità × prezzo ≈ totale, allora si è capito quali sono.
 * Se il conto non torna, si prende solo ciò che è certo.
 *
 * Le scansioni (PDF senza testo) NON vengono interpretate: si dichiara che
 * non sono leggibili e si lascia decidere all'utente.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * REGOLE — il punto da adattare quando arriva un PDF costruito diversamente.
 * Ogni voce elenca più alternative: si prende la prima che trova riscontro.
 */
const REGOLE = {
  partitaIVA: [
    /partita\s*i\.?v\.?a\.?[:\s]*([A-Za-z]{0,2}\s?\d{11})/i,
    /p\.?\s?i\.?v\.?a\.?[:\s]*([A-Za-z]{0,2}\s?\d{11})/i,
    /\b(IT\s?\d{11})\b/i,
  ],
  numeroFattura: [
    /(?:fattura|ft|documento)\s*(?:n\.?|nr\.?|numero)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/\-_.]{2,24})/i,
    /numero\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/\-_.]{2,24})/i,
  ],
  dataFattura: [
    /data\s*(?:fattura|documento)?\s*[:.]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i,
    /del\s+(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i,
  ],
  /** Riferimento a un documento di trasporto: numero e, se c'è, data. */
  riferimentoDDT: [
    /d\.?\s?d\.?\s?t\.?\s*(?:n\.?|nr\.?|numero)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{0,14})(?:\s*del\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}))?/i,
    /bolla\s*(?:n\.?|nr\.?)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/\-]{0,14})(?:\s*del\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}))?/i,
  ],
  totaleDocumento: [/totale\s+(?:documento|fattura)\s*[:.]?\s*([\d.,]+)/i],
  imponibile: [/(?:totale\s+)?imponibile\s*[:.]?\s*([\d.,]+)/i],
  /** Parole con cui comincia l'intestazione della tabella delle righe. */
  intestazioneTabella: /descrizione|articolo|denominazione/i,
  /** Titoli delle colonne numeriche, per capire dove cominciano i numeri. */
  colonneNumeriche: /^(q\.?t\.?a\.?|quantit|prezzo|importo|totale|imponibile|iva|u\.?m\.?|unit)/i,
  /** Righe che non sono materiali: intestazioni, totali, dati fiscali. */
  daIgnorare: [
    /^(descrizione|codice|articolo|denominazione)\b/i,
    /totale/i, /imponibile/i, /^iva\b/i, /aliquota/i,
    /^spett/i, /partita\s*iva/i, /codice\s*fiscale/i,
    /^fattura\b/i, /^numero\s*[:.]/i, /^data\s*[:.]/i,
    /pagamento/i, /scadenza/i, /^iban/i, /banca/i,
    /^pag(ina)?\s*\d/i, /^\d+\s*\/\s*\d+$/,
  ],
  unitaMisura: /\b(NR|PZ|PC|MC|MQ|ML|KG|LT|CAD|MT|M2|M3|H|ORE|SC|CF)\b/i,
};

/** Quanto testo serve, per pagina, perché il PDF non sia una scansione. */
const CARATTERI_MINIMI_PER_PAGINA = 60;

/* --------------------------------------------------------------------------
   ESTRAZIONE DEL TESTO
   pdfjs restituisce ogni frammento con le sue coordinate: senza quelle, in una
   tabella non si distingue la quantità dal totale.
-------------------------------------------------------------------------- */

let pdfjs = null;
async function caricaPdfjs() {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

/**
 * Cartella dei font standard di pdfjs: se non la si indica, avvisa a ogni
 * lettura. Va passata come URL con la barra finale — un percorso di Windows
 * con le barre rovesce viene rifiutato.
 */
function cartellaFontStandard() {
  try {
    const cartella = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
    return pathToFileURL(cartella).href + "/";
  } catch {
    return undefined;
  }
}

/**
 * Ricostruisce le righe visive del PDF: i frammenti che stanno alla stessa
 * altezza appartengono alla stessa riga, ordinati da sinistra a destra.
 */
export async function estraiRighePDF(buffer) {
  const { getDocument } = await caricaPdfjs();
  const lettura = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: cartellaFontStandard(),
    verbosity: 0,
  });
  const doc = await lettura.promise;
  const pagine = doc.numPages;

  const righe = [];
  let caratteri = 0;
  for (let n = 1; n <= pagine; n++) {
    const pagina = await doc.getPage(n);
    const contenuto = await pagina.getTextContent();
    const perAltezza = new Map();

    for (const frammento of contenuto.items) {
      const testo = String(frammento.str ?? "");
      if (!testo.trim()) continue;
      caratteri += testo.replace(/\s/g, "").length;
      const x = frammento.transform[4];
      const y = Math.round(frammento.transform[5]); // stessa altezza = stessa riga
      const chiave = `${n}|${y}`;
      if (!perAltezza.has(chiave)) perAltezza.set(chiave, { pagina: n, y, frammenti: [] });
      perAltezza.get(chiave).frammenti.push({ x, testo });
    }

    const dellaPagina = [...perAltezza.values()].sort((a, b) => b.y - a.y); // dall'alto in basso
    for (const riga of dellaPagina) {
      riga.frammenti.sort((a, b) => a.x - b.x);
      riga.testo = riga.frammenti.map((f) => f.testo).join(" ").replace(/\s+/g, " ").trim();
      righe.push(riga);
    }
    await pagina.cleanup();
  }
  // Si chiude il lettore, non il documento: libera il processo di lavoro di pdfjs.
  await lettura.destroy();

  return { righe, caratteri, pagine };
}

/* --------------------------------------------------------------------------
   RICONOSCIMENTO
-------------------------------------------------------------------------- */

/** Numero scritto all'italiana (1.234,56) → numero vero. null se non è un numero. */
function numeroItaliano(testo) {
  const s = String(testo).trim();
  if (!/^-?[\d.]+(,\d+)?$/.test(s) && !/^-?\d+$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Data all'italiana (31/07/2026) → ISO. Stringa vuota se non riconoscibile. */
function dataISO(testo) {
  const m = String(testo || "").match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return "";
  const [, g, mese, anno] = m;
  const a = anno.length === 2 ? "20" + anno : anno;
  return `${a}-${mese.padStart(2, "0")}-${g.padStart(2, "0")}`;
}

/** Prima corrispondenza fra le alternative elencate in REGOLE. */
function cerca(testo, alternative) {
  for (const re of alternative) {
    const m = testo.match(re);
    if (m) return m;
  }
  return null;
}

/**
 * Trova, dall'intestazione della tabella, la coordinata da cui cominciano le
 * colonne numeriche. È il modo più affidabile per non scambiare i numeri
 * contenuti nella descrizione ("CEMENTO 32,5 R", "SACCO 25 KG") con quantità
 * e prezzi. Se l'intestazione non si trova, si torna a una stima sulla
 * larghezza della pagina.
 */
function confineColonneNumeriche(righe) {
  for (const riga of righe) {
    if (!REGOLE.intestazioneTabella.test(riga.testo)) continue;
    const numeriche = riga.frammenti.filter((f) => REGOLE.colonneNumeriche.test(f.testo.trim()));
    if (numeriche.length >= 2) {
      return { x: Math.min(...numeriche.map((f) => f.x)) - 5, daIntestazione: true };
    }
  }
  const xMax = Math.max(0, ...righe.flatMap((r) => r.frammenti.map((f) => f.x)));
  return { x: xMax * 0.55, daIntestazione: false };
}

/**
 * Da una riga visiva ricava i valori del materiale.
 * Restituisce null se la riga non sembra una riga di materiale.
 */
function leggiRigaMateriale(riga, confineX) {
  const aDestra = riga.frammenti.filter((f) => f.x >= confineX);
  const aSinistra = riga.frammenti.filter((f) => f.x < confineX);

  const numeri = aDestra.map((f) => ({ x: f.x, valore: numeroItaliano(f.testo) })).filter((n) => n.valore !== null);
  if (numeri.length === 0) return null;

  const descrizione = aSinistra.map((f) => f.testo).join(" ").replace(/\s+/g, " ").trim();
  if (!descrizione && numeri.length < 3) return null;

  const daControllare = [];
  let quantita = null, prezzoUnitario = null, prezzoTotale = null;

  // Si cerca la terna (quantità, prezzo, totale) che TORNA con i conti.
  // È questa verifica a dare fiducia: senza, non si indovina.
  let trovata = null;
  for (let a = 0; a < numeri.length && !trovata; a++) {
    for (let b = a + 1; b < numeri.length && !trovata; b++) {
      for (let c = numeri.length - 1; c > b; c--) {
        const [q, p, t] = [numeri[a].valore, numeri[b].valore, numeri[c].valore];
        if (q <= 0 || p < 0 || t <= 0) continue;
        const tolleranza = Math.max(0.02, Math.abs(t) * 0.005);
        if (Math.abs(q * p - t) <= tolleranza) { trovata = { q, p, t }; break; }
      }
    }
  }

  if (trovata) {
    quantita = trovata.q; prezzoUnitario = trovata.p; prezzoTotale = trovata.t;
  } else {
    // Non torna: si tiene solo l'importo (il numero più a destra, che nelle
    // fatture è quasi sempre il totale della riga) e si segnala il resto.
    prezzoTotale = numeri[numeri.length - 1].valore;
    daControllare.push("quantita", "prezzoUnitario");
  }

  if (!descrizione) daControllare.push("descrizione");
  // L'unità di misura si cerca SOLO nella zona delle colonne: cercandola in
  // tutta la riga si pescherebbe quella scritta nella descrizione
  // ("SACCO 25 KG" farebbe risultare KG al posto di NR).
  const um = aDestra.map((f) => f.testo).join(" ").match(REGOLE.unitaMisura);

  return {
    descrizione,
    quantita,
    prezzoUnitario,
    prezzoTotale,
    unitaMisura: um ? um[1].toUpperCase() : "",
    daControllare: [...new Set(daControllare)],
  };
}

/**
 * Legge una fattura in PDF e restituisce gli stessi dati che restituisce il
 * lettore XML, così il resto dell'applicazione non deve distinguere i due casi:
 *   { fornitore, documenti, righe, avvisi, scansione }
 * Con "scansione: true" le righe sono vuote per scelta, non per errore.
 */
export async function leggiFatturaPDF(buffer) {
  const { righe: righeVisive, caratteri, pagine } = await estraiRighePDF(buffer);
  const avvisi = [];

  /* --- scansione: ci si ferma qui, senza inventare nulla --- */
  if (caratteri < CARATTERI_MINIMI_PER_PAGINA * Math.max(1, pagine)) {
    return {
      fornitore: { denominazione: "", partitaIVA: "", codiceFiscale: "" },
      documenti: [], righe: [], gruppi: [],
      scansione: true,
      avvisi: ["Questo PDF sembra una scansione: non contiene testo leggibile, quindi non posso ricavarne le righe. Puoi inserire i materiali a mano dalla commessa, oppure caricare la versione XML della fattura se il fornitore te l'ha mandata. Il file resta comunque archiviato."],
    };
  }

  const testoIntero = righeVisive.map((r) => r.testo).join("\n");

  /* --- intestazione --- */
  const piva = cerca(testoIntero, REGOLE.partitaIVA);
  const numero = cerca(testoIntero, REGOLE.numeroFattura);
  const data = cerca(testoIntero, REGOLE.dataFattura);
  const totale = cerca(testoIntero, REGOLE.totaleDocumento);

  // Il nome del fornitore non ha una forma riconoscibile: si prende la prima
  // riga in alto e si DICHIARA che è una deduzione, da controllare.
  const primaRiga = righeVisive.find((r) => /[A-Za-zÀ-ÿ]{4,}/.test(r.testo) && !REGOLE.intestazioneTabella.test(r.testo));
  const denominazione = primaRiga ? primaRiga.frammenti[0].testo.trim() : "";

  if (denominazione) avvisi.push(`Il fornitore "${denominazione}" è stato dedotto dall'intestazione del PDF: controllalo.`);
  else avvisi.push("Non sono riuscito a capire il nome del fornitore dal PDF.");
  if (!piva) avvisi.push("Non ho trovato la partita IVA del fornitore.");
  if (!numero) avvisi.push("Non ho trovato il numero della fattura.");
  if (!data) avvisi.push("Non ho trovato la data della fattura: controlla la data delle righe prima di importare.");

  const dataDocumento = data ? dataISO(data[1]) : "";
  const documenti = [{
    numero: numero ? numero[1].trim() : "",
    data: dataDocumento,
    totale: totale ? numeroItaliano(totale[1]) : null,
    tipo: "", divisa: "",
  }];

  /* --- righe --- */
  const confine = confineColonneNumeriche(righeVisive);
  if (!confine.daIntestazione) {
    avvisi.push("Non ho riconosciuto l'intestazione della tabella: le colonne sono state stimate, controlla quantità e prezzi con più attenzione.");
  }

  const righe = [];
  let ddtCorrente = null;

  for (const riga of righeVisive) {
    const testo = riga.testo;
    if (!testo) continue;

    // 1. riferimento a un DDT: da qui in poi le righe appartengono a quel DDT
    const rifDDT = cerca(testo, REGOLE.riferimentoDDT);
    if (rifDDT) {
      ddtCorrente = { numero: String(rifDDT[1]).trim(), data: rifDDT[2] ? dataISO(rifDDT[2]) : "" };
      continue;
    }

    // 2. righe che non sono materiali (intestazioni, totali, dati fiscali)
    if (REGOLE.daIgnorare.some((re) => re.test(testo))) continue;

    // 3. riga di materiale
    const letta = leggiRigaMateriale(riga, confine.x);
    if (letta) {
      righe.push({
        id: `pdf-${righe.length + 1}`,
        numeroLinea: String(righe.length + 1),
        descrizione: letta.descrizione,
        quantita: letta.quantita,
        unitaMisura: letta.unitaMisura,
        prezzoUnitario: letta.prezzoUnitario,
        prezzoTotale: letta.prezzoTotale,
        aliquotaIVA: null,
        ddtNumero: ddtCorrente?.numero || "",
        ddtData: ddtCorrente?.data || "",
        data: ddtCorrente?.data || dataDocumento || "",
        documentoNumero: documenti[0].numero,
        daControllare: letta.daControllare,
      });
      continue;
    }

    // 4. riga di solo testo (un titolo tipo "Altre voci"): chiude il gruppo DDT.
    //    Meglio una riga che finisce fra quelle "senza DDT" — visibile, e da
    //    assegnare a mano — che una attribuita in silenzio al DDT sbagliato.
    if (testo.length < 60) ddtCorrente = null;
  }

  if (righe.length === 0) {
    avvisi.push("Nel PDF non ho riconosciuto nessuna riga di materiale: controlla il documento e, se serve, inserisci le voci a mano.");
  } else {
    const incerte = righe.filter((r) => r.daControllare.length > 0).length;
    avvisi.unshift(
      incerte > 0
        ? `Letto da PDF: ${righe.length} righe riconosciute, di cui ${incerte} con valori da controllare. Verifica sempre i numeri prima di importare.`
        : `Letto da PDF: ${righe.length} righe riconosciute. Verifica sempre i numeri prima di importare: un PDF si interpreta, non si legge come un XML.`
    );
    const somma = righe.reduce((s, r) => s + (r.prezzoTotale ?? 0), 0);
    const imponibile = cerca(testoIntero, REGOLE.imponibile);
    const atteso = imponibile ? numeroItaliano(imponibile[1]) : null;
    if (atteso !== null && Math.abs(somma - atteso) > 0.02) {
      avvisi.push(`La somma delle righe riconosciute (${somma.toFixed(2)}) non corrisponde all'imponibile scritto sul documento (${atteso.toFixed(2)}): qualche riga potrebbe essere stata letta male o non riconosciuta.`);
    }
  }

  return {
    fornitore: {
      denominazione,
      partitaIVA: piva ? piva[1].replace(/\s/g, "").toUpperCase() : "",
      codiceFiscale: "",
    },
    documenti,
    righe,
    scansione: false,
    avvisi,
  };
}

/**
 * Trova tutti i riferimenti a DDT dentro un testo, con la posizione in cui
 * compaiono. Serve anche al lettore Document AI: le forme con cui un DDT viene
 * citato sono le stesse, e vanno tenute in un posto solo.
 */
export function trovaRiferimentiDDT(testo) {
  const trovati = [];
  for (const re of REGOLE.riferimentoDDT) {
    const globale = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = globale.exec(testo)) !== null) {
      trovati.push({ numero: String(m[1]).trim(), data: m[2] ? dataISO(m[2]) : "", indice: m.index });
    }
  }
  return trovati.sort((a, b) => a.indice - b.indice);
}

/** Riconosce un PDF dai primi byte (%PDF). */
export function eUnPDF(buffer) {
  return !!buffer && buffer.length > 4 &&
    buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}
