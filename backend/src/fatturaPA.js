/**
 * LETTURA DELLE FATTURE ELETTRONICHE (standard italiano FatturaPA).
 *
 * QUESTO È L'UNICO FILE CHE CONOSCE I NOMI DEI CAMPI DELLA FATTURA.
 * Tutto il resto dell'applicazione riceve già i dati puliti. Quando arriverà
 * una fattura vera con nomi o posizioni leggermente diversi, si adatta la
 * mappa PERCORSI qui sotto e non si tocca nient'altro.
 *
 * Tre regole che questo lettore rispetta sempre:
 *  1. I prefissi di namespace si ignorano (p:FatturaElettronica, ns2:, o
 *     nessun prefisso sono tutti validi e cambiano da fornitore a fornitore).
 *  2. Un campo che manca diventa un valore vuoto PIÙ un avviso: mai un errore,
 *     mai un numero inventato. Chi legge decide cosa farne.
 *  3. I numeri si leggono con il punto decimale (formato XML), non con la
 *     virgola: la conversione al formato italiano avviene solo a video.
 */
import { XMLParser } from "fast-xml-parser";

/**
 * MAPPA DEI PERCORSI — il punto da adattare quando si incontra una fattura
 * costruita diversamente. I percorsi sono relativi a ciò che indica il
 * commento, e ogni voce può elencare più alternative: si prende la prima che
 * esiste. È così che si assorbono le differenze fra fornitori senza toccare
 * il codice.
 */
const PERCORSI = {
  // dentro FatturaElettronicaHeader
  fornitoreDenominazione: [
    "CedentePrestatore.DatiAnagrafici.Anagrafica.Denominazione",
    "CedentePrestatore.DatiAnagrafici.Anagrafica.Nome", // persone fisiche: Nome + Cognome
  ],
  fornitoreCognome: ["CedentePrestatore.DatiAnagrafici.Anagrafica.Cognome"],
  fornitorePartitaIVA: ["CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdCodice"],
  fornitorePaese: ["CedentePrestatore.DatiAnagrafici.IdFiscaleIVA.IdPaese"],
  fornitoreCodiceFiscale: ["CedentePrestatore.DatiAnagrafici.CodiceFiscale"],

  // dentro FatturaElettronicaBody
  numero: ["DatiGenerali.DatiGeneraliDocumento.Numero"],
  data: ["DatiGenerali.DatiGeneraliDocumento.Data"],
  totaleDocumento: ["DatiGenerali.DatiGeneraliDocumento.ImportoTotaleDocumento"],
  divisa: ["DatiGenerali.DatiGeneraliDocumento.Divisa"],
  tipoDocumento: ["DatiGenerali.DatiGeneraliDocumento.TipoDocumento"],
  righe: ["DatiBeniServizi.DettaglioLinee"],
  ddt: ["DatiGenerali.DatiDDT"],

  // dentro una singola riga (DettaglioLinee)
  rigaNumero: ["NumeroLinea"],
  rigaDescrizione: ["Descrizione"],
  rigaQuantita: ["Quantita"],
  rigaUnitaMisura: ["UnitaMisura"],
  rigaPrezzoUnitario: ["PrezzoUnitario"],
  rigaPrezzoTotale: ["PrezzoTotale"],
  rigaAliquotaIVA: ["AliquotaIVA"],

  // dentro un blocco DatiDDT
  ddtNumero: ["NumeroDDT"],
  ddtData: ["DataDDT"],
  ddtRigheCollegate: ["RiferimentoNumeroLinea"],
};

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,      // p:FatturaElettronica → FatturaElettronica
  parseTagValue: false,      // i numeri restano stringhe: li converto io, controllandoli
  trimValues: true,
});

/** Legge un percorso "a.b.c" dentro un oggetto, senza esplodere se manca un pezzo. */
const dentro = (oggetto, percorso) =>
  percorso.split(".").reduce((o, chiave) => (o == null ? undefined : o[chiave]), oggetto);

/** Prima alternativa presente fra quelle elencate nella mappa PERCORSI. */
function campo(oggetto, chiaveMappa) {
  for (const percorso of PERCORSI[chiaveMappa] || []) {
    const v = dentro(oggetto, percorso);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Testo ripulito, oppure stringa vuota. Non restituisce mai undefined. */
const testo = (v) => (v === undefined || v === null ? "" : String(v).trim());

/**
 * Numero secondo il formato XML (punto decimale). Restituisce null se manca o
 * non è leggibile: null significa "non lo so", ed è diverso da zero.
 */
function numero(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Un elemento che nell'XML può comparire una o più volte arriva come oggetto
 *  singolo oppure come array: qui diventa sempre un array. */
const comeElenco = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Data in formato ISO (AAAA-MM-GG), oppure stringa vuota se non riconoscibile. */
function dataISO(v) {
  const s = testo(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/); // 31/07/2026, formato non standard ma capita
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

/**
 * Estrae l'XML da un file .p7m (fattura firmata digitalmente).
 *
 * ATTENZIONE, ed è bene che sia scritto: NON verifichiamo la firma. Qui si
 * recupera soltanto il documento contenuto. Per il nostro scopo (leggere le
 * righe e proporle all'utente, che poi conferma) è sufficiente; se un domani
 * servisse la validità legale della firma, sarebbe un lavoro a parte.
 *
 * Ritorna il buffer dell'XML, oppure null se non si trova nulla di simile.
 */
export function estraiXMLdaP7M(buffer) {
  // Alcuni p7m arrivano codificati in base64: se il file è fatto solo di
  // caratteri base64, lo si decodifica prima di cercare dentro.
  let dati = buffer;
  const inizio = buffer.subarray(0, 200).toString("latin1").replace(/\s/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(inizio) && inizio.length > 40) {
    try {
      const decodificato = Buffer.from(buffer.toString("latin1").replace(/\s/g, ""), "base64");
      if (decodificato.length > 100) dati = decodificato;
    } catch { /* non era base64: si prosegue con i byte originali */ }
  }

  const testoGrezzo = dati.toString("latin1");
  const partenza = testoGrezzo.search(/<\?xml|<[A-Za-z0-9]*:?FatturaElettronica[\s>]/);
  if (partenza < 0) return null;

  const chiusura = testoGrezzo.lastIndexOf("FatturaElettronica>");
  if (chiusura < 0) return null;
  const fine = testoGrezzo.indexOf(">", chiusura) + 1;
  return Buffer.from(dati.subarray(partenza, fine));
}

/**
 * Riconosce cosa abbiamo in mano: "xml", "p7m" o null.
 *
 * L'ORDINE DEI CONTROLLI CONTA. In un file firmato il contenuto (l'XML) sta
 * PRIMA dei certificati, quindi comincia dopo pochi byte: cercare "<?xml" da
 * qualche parte all'inizio farebbe scambiare un p7m per un XML normale, e si
 * finirebbe per dare in pasto al lettore anche l'involucro binario.
 * Quindi: è un XML solo se comincia con l'XML fin dal primo carattere utile.
 */
export function riconosciFormatoFattura(buffer) {
  if (!buffer || buffer.length < 8) return null;

  // Si salta l'eventuale BOM e gli spazi iniziali, poi si guarda il PRIMO carattere utile.
  let i = 0;
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) i = 3;
  while (i < buffer.length && (buffer[i] === 0x20 || buffer[i] === 0x09 || buffer[i] === 0x0a || buffer[i] === 0x0d)) i++;
  const daQui = buffer.subarray(i, i + 200).toString("latin1");
  if (/^<\?xml|^<[A-Za-z0-9]*:?FatturaElettronica[\s>]/.test(daQui)) return "xml";

  // CMS/PKCS#7 in formato DER: comincia con una SEQUENCE in forma lunga (0x30 + lunghezza).
  if (buffer[i] === 0x30 && (buffer[i + 1] & 0x80) !== 0) return "p7m";

  // Lo stesso involucro, ma codificato in base64.
  const ripulito = buffer.subarray(i, i + 200).toString("latin1").replace(/\s/g, "");
  if (/^[A-Za-z0-9+/=]{40,}$/.test(ripulito.slice(0, 100))) return "p7m";

  // Non è nessuno dei due, ma da qualche parte c'è un XML di fattura: è
  // comunque un involucro, si tratta come un firmato e si estrae il contenuto.
  if (/<[A-Za-z0-9]*:?FatturaElettronica[\s>]/.test(buffer.subarray(0, 4096).toString("latin1"))) return "p7m";

  return null;
}

/**
 * Legge una fattura elettronica e restituisce i dati già puliti:
 *
 *   {
 *     fornitore: { denominazione, partitaIVA, codiceFiscale },
 *     documenti: [{ numero, data, totale }],
 *     righe: [{ id, numeroLinea, descrizione, quantita, unitaMisura,
 *               prezzoUnitario, prezzoTotale, aliquotaIVA, data,
 *               ddtNumero, ddtData, documentoNumero, daControllare: [] }],
 *     avvisi: [testo]
 *   }
 *
 * Non lancia eccezioni per i campi mancanti: li lascia vuoti e li elenca in
 * "daControllare" (per riga) o in "avvisi" (per l'intero documento).
 */
export function leggiFatturaXML(bufferXML) {
  const avvisi = [];
  let radice;
  try {
    radice = parser.parse(bufferXML.toString("utf8"));
  } catch (e) {
    throw new Error("Il file non è un XML leggibile: " + e.message);
  }

  // La radice può chiamarsi FatturaElettronica con qualunque prefisso (già
  // tolto dal parser) oppure, in rari casi, essere annidata più in basso.
  const fattura = radice?.FatturaElettronica
    || Object.values(radice || {}).find((v) => v && typeof v === "object" && v.FatturaElettronicaBody)
    || null;
  if (!fattura) {
    throw new Error("Questo file non sembra una fattura elettronica FatturaPA: manca il blocco FatturaElettronica.");
  }

  const intestazione = fattura.FatturaElettronicaHeader || {};
  const corpi = comeElenco(fattura.FatturaElettronicaBody);
  if (corpi.length === 0) throw new Error("La fattura non contiene nessun documento (FatturaElettronicaBody).");
  if (corpi.length > 1) {
    avvisi.push(`Il file contiene ${corpi.length} documenti: le righe di tutti sono elencate insieme, con il numero di documento su ogni riga.`);
  }

  /* --- fornitore --- */
  const denominazione = testo(campo(intestazione, "fornitoreDenominazione"));
  const cognome = testo(campo(intestazione, "fornitoreCognome"));
  const fornitore = {
    denominazione: [denominazione, cognome].filter(Boolean).join(" ").trim(),
    partitaIVA: [testo(campo(intestazione, "fornitorePaese")), testo(campo(intestazione, "fornitorePartitaIVA"))].filter(Boolean).join(""),
    codiceFiscale: testo(campo(intestazione, "fornitoreCodiceFiscale")),
  };
  if (!fornitore.denominazione) avvisi.push("Non ho trovato il nome del fornitore: controllalo prima di importare.");
  if (!fornitore.partitaIVA) avvisi.push("Non ho trovato la partita IVA del fornitore.");

  const documenti = [];
  const righe = [];

  for (const corpo of corpi) {
    const numeroDoc = testo(campo(corpo, "numero"));
    const dataDoc = dataISO(campo(corpo, "data"));
    documenti.push({
      numero: numeroDoc,
      data: dataDoc,
      totale: numero(campo(corpo, "totaleDocumento")),
      tipo: testo(campo(corpo, "tipoDocumento")),
      divisa: testo(campo(corpo, "divisa")),
    });
    if (!numeroDoc) avvisi.push("Non ho trovato il numero della fattura.");
    if (!dataDoc) avvisi.push("Non ho trovato la data della fattura: le righe senza DDT non avranno una data.");

    /* --- DDT: si costruisce la corrispondenza numero di riga → DDT --- */
    const ddtPerLinea = new Map(); // numeroLinea (stringa) -> { numero, data }
    let ddtDelDocumento = null;    // DatiDDT senza righe collegate: vale per tutto il documento
    for (const blocco of comeElenco(campo(corpo, "ddt"))) {
      const info = { numero: testo(campo(blocco, "ddtNumero")), data: dataISO(campo(blocco, "ddtData")) };
      const collegate = comeElenco(campo(blocco, "ddtRigheCollegate"));
      if (collegate.length === 0) ddtDelDocumento = ddtDelDocumento || info;
      else for (const linea of collegate) ddtPerLinea.set(testo(linea), info);
    }

    /* --- righe di dettaglio --- */
    const elencoRighe = comeElenco(campo(corpo, "righe"));
    if (elencoRighe.length === 0) {
      avvisi.push(`Il documento ${numeroDoc || "(senza numero)"} non contiene righe di dettaglio.`);
    }

    for (const riga of elencoRighe) {
      const daControllare = [];
      const numeroLinea = testo(campo(riga, "rigaNumero"));
      const descrizione = testo(campo(riga, "rigaDescrizione"));
      let quantita = numero(campo(riga, "rigaQuantita"));
      let prezzoUnitario = numero(campo(riga, "rigaPrezzoUnitario"));
      const prezzoTotale = numero(campo(riga, "rigaPrezzoTotale"));

      if (!descrizione) daControllare.push("descrizione");
      if (quantita === null) daControllare.push("quantita");
      if (prezzoUnitario === null) daControllare.push("prezzoUnitario");

      // Alcune fatture non indicano la quantità (servizi a corpo): in quel caso
      // si assume 1 e si segnala, così il totale della riga resta corretto.
      if (quantita === null && prezzoTotale !== null) {
        quantita = 1;
        prezzoUnitario = prezzoTotale;
      }

      // Sconti riga: quando quantità × prezzo non torna con il totale
      // dichiarato, vince il TOTALE (è quello che si paga) e si ricava il
      // prezzo unitario effettivo. La riga viene segnalata.
      if (quantita !== null && quantita !== 0 && prezzoTotale !== null && prezzoUnitario !== null) {
        const atteso = quantita * prezzoUnitario;
        if (Math.abs(atteso - prezzoTotale) > 0.01) {
          prezzoUnitario = prezzoTotale / quantita;
          daControllare.push("prezzoUnitario");
        }
      }

      const ddt = ddtPerLinea.get(numeroLinea) || ddtDelDocumento || null;
      righe.push({
        id: `${numeroDoc || "doc"}-${numeroLinea || righe.length + 1}`,
        numeroLinea,
        descrizione,
        quantita,
        unitaMisura: testo(campo(riga, "rigaUnitaMisura")),
        prezzoUnitario,
        prezzoTotale,
        aliquotaIVA: numero(campo(riga, "rigaAliquotaIVA")),
        ddtNumero: ddt?.numero || "",
        ddtData: ddt?.data || "",
        // La data che finirà sul materiale: quella del DDT se c'è (è il giorno
        // in cui la merce è arrivata in cantiere), altrimenti quella della fattura.
        data: ddt?.data || dataDoc || "",
        documentoNumero: numeroDoc,
        daControllare: [...new Set(daControllare)],
      });
    }
  }

  const senzaPrezzo = righe.filter((r) => r.prezzoUnitario === null).length;
  if (senzaPrezzo > 0) avvisi.push(`${senzaPrezzo} righe sono senza prezzo leggibile: controllale prima di importare.`);

  return { fornitore, documenti, righe, avvisi };
}

/**
 * Raggruppa le righe per DDT, nell'ordine in cui compaiono. Le righe senza
 * riferimento a un DDT finiscono in un gruppo a parte, in fondo.
 */
export function raggruppaPerDDT(righe) {
  const gruppi = new Map();
  for (const r of righe) {
    const chiave = r.ddtNumero ? `ddt:${r.ddtNumero}` : "senza-ddt";
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, {
        chiave,
        ddtNumero: r.ddtNumero || "",
        ddtData: r.ddtData || "",
        data: r.data || "",
        righe: [],
      });
    }
    gruppi.get(chiave).righe.push(r);
  }
  // il gruppo "senza DDT" va in fondo: i gruppi con un documento vero contano di più
  return [...gruppi.values()].sort((a, b) => (a.chiave === "senza-ddt" ? 1 : b.chiave === "senza-ddt" ? -1 : 0));
}
