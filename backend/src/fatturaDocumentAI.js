/**
 * LETTURA DELLE FATTURE PDF CON GOOGLE DOCUMENT AI (Invoice Parser).
 *
 * È il terzo lettore, accanto a fatturaPA.js (XML) e fatturaPDF.js (testo).
 * Restituisce ESATTAMENTE la stessa forma di dati degli altri due, così la
 * schermata di importazione, il raggruppamento per DDT, l'assegnazione alle
 * commesse e la conferma restano quelli di sempre: cambia solo da dove
 * arrivano i numeri.
 *
 * QUANDO SI USA. Solo per i PDF, e solo se è configurato. L'XML resta la
 * strada principale: quello è un dato esatto, qui si legge una stampa.
 *
 * ATTENZIONE, È UN SERVIZIO A PAGAMENTO. Ogni fattura letta è una chiamata
 * fatturata a pagina. Per questo ci sono tre freni: un massimo di pagine per
 * documento, un tetto mensile di pagine oltre il quale ci si ferma, e un
 * contatore salvato sul database per vedere quanto si sta consumando.
 *
 * Anche con Document AI la regola non cambia: la macchina propone, l'utente
 * conferma riga per riga. Qui in più si usa la confidenza dichiarata da
 * Google: sotto la soglia, il campo viene segnato "da controllare".
 */
import { pool } from "./db.js";
import { trovaRiferimentiDDT } from "./fatturaPDF.js";

const PROGETTO = process.env.DOCUMENTAI_PROJECT || "";
const REGIONE = process.env.DOCUMENTAI_LOCATION || "eu";
const PROCESSORE = process.env.DOCUMENTAI_PROCESSOR || "";
const CREDENZIALI_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const CREDENZIALI_JSON = process.env.GOOGLE_CREDENTIALS_JSON || "";

/** Massimo di pagine per singolo documento (è anche il limite della chiamata sincrona). */
export const MAX_PAGINE_DOCUMENTO = Number(process.env.DOCUMENTAI_MAX_PAGINE || 15);
/** Tetto mensile complessivo: oltre questo non si chiama più, per non far scappare la spesa. */
export const MAX_PAGINE_MESE = Number(process.env.DOCUMENTAI_MAX_PAGINE_MESE || 500);
/** Sotto questa confidenza il valore va guardato da un umano. */
const SOGLIA_CONFIDENZA = Number(process.env.DOCUMENTAI_SOGLIA_CONFIDENZA || 0.7);

/** true se ci sono progetto, processore e un modo per autenticarsi. */
export const documentAIConfigurato = Boolean(PROGETTO && PROCESSORE && (CREDENZIALI_FILE || CREDENZIALI_JSON));

export const descrizioneDocumentAI = documentAIConfigurato
  ? `Document AI attivo (progetto ${PROGETTO}, regione ${REGIONE}, processore ${PROCESSORE.slice(0, 6)}…)`
  : "Document AI non configurato: i PDF si leggono con il riconoscimento testuale di base";

/**
 * MAPPATURA — a quali campi di Document AI corrispondono i nostri.
 * È il punto da adattare se Google cambia i nomi delle entità o se un giorno
 * si passa a un processore diverso. Ogni voce elenca più alternative: si
 * prende la prima presente.
 */
const MAPPATURA = {
  fornitore: ["supplier_name"],
  partitaIVA: ["supplier_tax_id", "supplier_registration"],
  numero: ["invoice_id"],
  data: ["invoice_date"],
  totaleDocumento: ["total_amount"],
  imponibile: ["net_amount"],
  righe: ["line_item"],
  // proprietà dentro una riga (arrivano come "line_item/descrizione")
  rigaDescrizione: ["line_item/description"],
  rigaQuantita: ["line_item/quantity"],
  rigaPrezzoUnitario: ["line_item/unit_price"],
  rigaTotale: ["line_item/amount"],
  rigaUnita: ["line_item/unit"],
};

let cliente = null;
async function ottieniCliente() {
  if (cliente) return cliente;
  const { DocumentProcessorServiceClient } = (await import("@google-cloud/documentai")).v1;
  // L'endpoint DEVE essere quello regionale: con la regione "eu" un processore
  // non si trova sull'endpoint globale, e l'errore che si riceve non lo dice.
  const opzioni = { apiEndpoint: `${REGIONE}-documentai.googleapis.com` };
  if (CREDENZIALI_JSON) {
    // Su Render si può incollare tutto il JSON in una variabile invece di
    // usare un file: comodo quando i "secret file" non sono disponibili.
    try {
      opzioni.credentials = JSON.parse(CREDENZIALI_JSON);
    } catch (e) {
      throw new Error("GOOGLE_CREDENTIALS_JSON non contiene un JSON valido.");
    }
  }
  cliente = new DocumentProcessorServiceClient(opzioni);
  return cliente;
}

/* --------------------------------------------------------------------------
   CONSUMI — quante pagine si sono mandate a Google in questo mese
-------------------------------------------------------------------------- */

const meseCorrente = () => new Date().toISOString().slice(0, 7);

export async function consumiDelMese() {
  const ris = await pool.query(
    "SELECT pagine, chiamate FROM consumi_documentai WHERE mese = $1",
    [meseCorrente()]
  );
  const riga = ris.rows[0] || { pagine: 0, chiamate: 0 };
  return {
    mese: meseCorrente(),
    pagine: Number(riga.pagine),
    chiamate: Number(riga.chiamate),
    tetto: MAX_PAGINE_MESE,
  };
}

async function registraConsumo(pagine) {
  await pool.query(
    `INSERT INTO consumi_documentai (mese, pagine, chiamate) VALUES ($1, $2, 1)
     ON CONFLICT (mese) DO UPDATE SET pagine = consumi_documentai.pagine + $2,
                                      chiamate = consumi_documentai.chiamate + 1`,
    [meseCorrente(), pagine]
  );
}

/* --------------------------------------------------------------------------
   LETTURA DEI VALORI
-------------------------------------------------------------------------- */

/**
 * Numero scritto in un formato qualsiasi. Document AI restituisce il testo
 * così com'è stampato, che può essere all'italiana (1.234,56) o all'inglese
 * (1,234.56): si guarda quale separatore viene per ultimo, quello è il
 * decimale. Restituisce null se non è un numero: null vuol dire "non lo so",
 * ed è diverso da zero.
 */
function numeroTollerante(testo) {
  if (testo === undefined || testo === null) return null;
  const s = String(testo).replace(/[^\d.,-]/g, "").trim();
  if (!s || !/\d/.test(s)) return null;

  const ultimaVirgola = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  let normalizzato;
  if (ultimaVirgola >= 0 && ultimoPunto >= 0) {
    normalizzato = ultimaVirgola > ultimoPunto
      ? s.replace(/\./g, "").replace(",", ".")   // 1.234,56
      : s.replace(/,/g, "");                      // 1,234.56
  } else if (ultimaVirgola >= 0) {
    normalizzato = s.replace(",", ".");
  } else if (ultimoPunto >= 0) {
    // Un solo punto con esattamente tre cifre dopo, e altre cifre prima:
    // quasi sempre è il separatore delle migliaia (1.234), non un decimale.
    const dopo = s.length - ultimoPunto - 1;
    normalizzato = dopo === 3 && s.replace(/[^\d]/g, "").length > 3 ? s.replace(/\./g, "") : s;
  } else {
    normalizzato = s;
  }
  const n = Number(normalizzato);
  return Number.isFinite(n) ? n : null;
}

/** Importo: si preferisce il valore già normalizzato da Google, se c'è. */
function importoDa(entita) {
  const soldi = entita?.normalizedValue?.moneyValue;
  if (soldi && (soldi.units !== undefined || soldi.nanos !== undefined)) {
    return Number(soldi.units || 0) + Number(soldi.nanos || 0) / 1e9;
  }
  return numeroTollerante(entita?.normalizedValue?.text ?? entita?.mentionText);
}

/** Data: si preferisce quella normalizzata da Google (evita il pasticcio gg/mm vs mm/gg). */
function dataDa(entita) {
  const d = entita?.normalizedValue?.dateValue;
  if (d && d.year && d.month && d.day) {
    return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  }
  const testo = entita?.normalizedValue?.text ?? entita?.mentionText ?? "";
  const m = String(testo).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const it = String(testo).match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (it) {
    const anno = it[3].length === 2 ? "20" + it[3] : it[3];
    return `${anno}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}`;
  }
  return "";
}

const testoDa = (entita) => String(entita?.mentionText ?? "").replace(/\s+/g, " ").trim();

/** Prima entità di primo livello fra i tipi elencati nella mappatura. */
const trovaEntita = (entita, chiave) =>
  entita.find((e) => (MAPPATURA[chiave] || []).includes(e.type));

/** Prima proprietà di una riga fra i tipi elencati nella mappatura. */
const trovaProprieta = (riga, chiave) =>
  (riga.properties || []).find((p) => (MAPPATURA[chiave] || []).includes(p.type));

/** Dove comincia, dentro il testo del documento, il pezzo da cui viene un'entità. */
function posizioneNelTesto(entita) {
  const segmenti = entita?.textAnchor?.textSegments || [];
  if (segmenti.length === 0) return Number.MAX_SAFE_INTEGER;
  return Math.min(...segmenti.map((s) => Number(s.startIndex || 0)));
}

/* --------------------------------------------------------------------------
   LETTURA
-------------------------------------------------------------------------- */

/**
 * Manda il PDF a Document AI e restituisce gli stessi dati degli altri lettori:
 *   { fornitore, documenti, righe, avvisi, scansione, origine }
 * Non lancia eccezioni per i campi mancanti: li lascia vuoti e li segnala.
 * Lancia invece se la chiamata non si può fare (non configurato, tetto
 * raggiunto, errore di rete): chi chiama decide se ripiegare sul lettore di base.
 */
export async function leggiFatturaConDocumentAI(buffer, { pagineStimate = null } = {}) {
  if (!documentAIConfigurato) throw new Error("Document AI non è configurato.");

  if (pagineStimate !== null && pagineStimate > MAX_PAGINE_DOCUMENTO) {
    throw new Error(`Il PDF ha ${pagineStimate} pagine: il limite per la lettura automatica è ${MAX_PAGINE_DOCUMENTO}.`);
  }

  const consumi = await consumiDelMese();
  if (consumi.pagine >= MAX_PAGINE_MESE) {
    throw new Error(`Tetto mensile raggiunto: ${consumi.pagine} pagine su ${MAX_PAGINE_MESE}. La lettura automatica riprende il mese prossimo, oppure si alza il limite.`);
  }

  const client = await ottieniCliente();
  const nome = client.processorPath(PROGETTO, REGIONE, PROCESSORE);
  const [risposta] = await client.processDocument({
    name: nome,
    rawDocument: { content: buffer.toString("base64"), mimeType: "application/pdf" },
  });

  const documento = risposta.document || {};
  const testo = documento.text || "";
  const entita = documento.entities || [];
  const pagine = (documento.pages || []).length || pagineStimate || 1;
  await registraConsumo(pagine);

  const avvisi = [];
  const sottoSoglia = (e) => e && typeof e.confidence === "number" && e.confidence < SOGLIA_CONFIDENZA;

  /* --- intestazione --- */
  const eFornitore = trovaEntita(entita, "fornitore");
  const ePiva = trovaEntita(entita, "partitaIVA");
  const eNumero = trovaEntita(entita, "numero");
  const eData = trovaEntita(entita, "data");
  const eTotale = trovaEntita(entita, "totaleDocumento");
  const eImponibile = trovaEntita(entita, "imponibile");

  const fornitore = {
    denominazione: testoDa(eFornitore),
    partitaIVA: testoDa(ePiva).replace(/\s/g, "").toUpperCase(),
    codiceFiscale: "",
  };
  if (!fornitore.denominazione) avvisi.push("Document AI non ha trovato il nome del fornitore: controllalo.");
  else if (sottoSoglia(eFornitore)) avvisi.push(`Il nome del fornitore ("${fornitore.denominazione}") è stato letto con poca sicurezza: controllalo.`);
  if (!fornitore.partitaIVA) avvisi.push("Non ho trovato la partita IVA del fornitore.");
  if (!eNumero) avvisi.push("Non ho trovato il numero della fattura.");
  if (!eData) avvisi.push("Non ho trovato la data della fattura: controlla la data delle righe prima di importare.");

  const dataDocumento = dataDa(eData);
  const documenti = [{
    numero: testoDa(eNumero),
    data: dataDocumento,
    totale: eTotale ? importoDa(eTotale) : null,
    tipo: "", divisa: "",
  }];

  /* --- riferimenti ai DDT ---
     L'Invoice Parser non conosce il DDT: è un documento italiano che non
     rientra nei suoi campi. Però restituisce il testo completo e, per ogni
     riga, la posizione da cui è stata presa: si cercano quindi i riferimenti
     nel testo e si assegna a ogni riga l'ultimo che compare PRIMA di essa.
     È la stessa logica di lettura di un umano che scorre il foglio. */
  const riferimenti = trovaRiferimentiDDT(testo);

  /* --- righe --- */
  const righeEntita = entita.filter((e) => (MAPPATURA.righe || []).includes(e.type))
    .sort((a, b) => posizioneNelTesto(a) - posizioneNelTesto(b));

  const righe = [];
  for (const rigaEntita of righeEntita) {
    const daControllare = [];
    const pDesc = trovaProprieta(rigaEntita, "rigaDescrizione");
    const pQta = trovaProprieta(rigaEntita, "rigaQuantita");
    const pPrezzo = trovaProprieta(rigaEntita, "rigaPrezzoUnitario");
    const pTotale = trovaProprieta(rigaEntita, "rigaTotale");
    const pUnita = trovaProprieta(rigaEntita, "rigaUnita");

    const descrizione = testoDa(pDesc) || testoDa(rigaEntita);
    let quantita = pQta ? numeroTollerante(pQta.normalizedValue?.text ?? pQta.mentionText) : null;
    let prezzoUnitario = pPrezzo ? importoDa(pPrezzo) : null;
    const prezzoTotale = pTotale ? importoDa(pTotale) : null;

    if (!descrizione) daControllare.push("descrizione");
    if (quantita === null) daControllare.push("quantita");
    if (prezzoUnitario === null) daControllare.push("prezzoUnitario");
    if (sottoSoglia(pQta)) daControllare.push("quantita");
    if (sottoSoglia(pPrezzo)) daControllare.push("prezzoUnitario");
    if (sottoSoglia(pDesc)) daControllare.push("descrizione");

    // Riga senza quantità ma con un totale: si assume 1 e si segnala.
    if (quantita === null && prezzoTotale !== null && prezzoUnitario === null) {
      quantita = 1;
      prezzoUnitario = prezzoTotale;
    }

    // Controllo aritmetico, lo stesso che si fa sul PDF testuale: se
    // quantità × prezzo non torna con il totale, vince il totale (è quello
    // che si paga) e la riga viene segnalata.
    if (quantita !== null && quantita !== 0 && prezzoUnitario !== null && prezzoTotale !== null) {
      const tolleranza = Math.max(0.02, Math.abs(prezzoTotale) * 0.005);
      if (Math.abs(quantita * prezzoUnitario - prezzoTotale) > tolleranza) {
        prezzoUnitario = prezzoTotale / quantita;
        daControllare.push("prezzoUnitario");
      }
    }

    const inizio = posizioneNelTesto(rigaEntita);
    const ddt = [...riferimenti].reverse().find((r) => r.indice < inizio) || null;

    righe.push({
      id: `dai-${righe.length + 1}`,
      numeroLinea: String(righe.length + 1),
      descrizione,
      quantita,
      unitaMisura: testoDa(pUnita),
      prezzoUnitario,
      prezzoTotale,
      aliquotaIVA: null,
      ddtNumero: ddt?.numero || "",
      ddtData: ddt?.data || "",
      data: ddt?.data || dataDocumento || "",
      documentoNumero: documenti[0].numero,
      daControllare: [...new Set(daControllare)],
    });
  }

  if (righe.length === 0) {
    avvisi.push("Document AI non ha riconosciuto righe di materiale in questo documento: controllalo e, se serve, inserisci le voci a mano.");
  } else {
    const incerte = righe.filter((r) => r.daControllare.length > 0).length;
    avvisi.unshift(incerte > 0
      ? `Letto con Document AI: ${righe.length} righe, di cui ${incerte} con valori da controllare. Verifica sempre i numeri prima di importare.`
      : `Letto con Document AI: ${righe.length} righe riconosciute. Verifica comunque i numeri prima di importare: è pur sempre la lettura di una stampa.`);

    const somma = righe.reduce((s, r) => s + (r.prezzoTotale ?? 0), 0);
    const atteso = eImponibile ? importoDa(eImponibile) : null;
    if (atteso !== null && Math.abs(somma - atteso) > 0.02) {
      avvisi.push(`La somma delle righe (${somma.toFixed(2)}) non corrisponde all'imponibile del documento (${atteso.toFixed(2)}): qualche riga potrebbe essere stata letta male o non riconosciuta.`);
    }
  }

  return {
    fornitore, documenti, righe, avvisi,
    scansione: false,
    origine: "documentai",
    pagineLette: pagine,
  };
}
