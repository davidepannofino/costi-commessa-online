/**
 * ARCHIVIO DEI DOCUMENTI (DDT) — dove finiscono davvero i byte dei file.
 *
 * Due modalità, scelte da sole in base alle variabili d'ambiente:
 *
 *  - "r2": se sono impostate R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID e
 *    R2_SECRET_ACCESS_KEY, i file vanno su Cloudflare R2 e nel database resta
 *    solo il riferimento (posizione='r2', chiave_esterna). È la modalità di
 *    produzione: 10 GB gratuiti bastano per oltre dieci anni di documenti.
 *
 *  - "database": se quelle variabili non ci sono, i byte restano dentro
 *    Postgres come prima. Serve allo sviluppo in locale e come rete di
 *    sicurezza: senza configurazione l'app funziona lo stesso, solo con molto
 *    meno spazio a disposizione.
 *
 * Il resto dell'applicazione non sa quale delle due è attiva: parla solo con
 * salvaFile / leggiFile / eliminaFile.
 */
import { AwsClient } from "aws4fetch";

const ENDPOINT = (process.env.R2_ENDPOINT || "").replace(/\/+$/, "");
const BUCKET = process.env.R2_BUCKET || "";
const CHIAVE = process.env.R2_ACCESS_KEY_ID || "";
const SEGRETO = process.env.R2_SECRET_ACCESS_KEY || "";

/** true quando i file vanno su R2, false quando restano nel database. */
export const archivioEsterno = Boolean(ENDPOINT && BUCKET && CHIAVE && SEGRETO);

/**
 * Quota per azienda. Con i file fuori dal database si può essere generosi
 * (R2 regala 10 GB); con i file dentro Postgres si resta stretti, perché lo
 * stesso spazio serve a ore, commesse e materiali. In entrambi i casi si può
 * cambiare con la variabile QUOTA_ALLEGATI_MB senza toccare il codice.
 */
export const QUOTA_AZIENDA_BYTE =
  Number(process.env.QUOTA_ALLEGATI_MB || (archivioEsterno ? 3000 : 100)) * 1024 * 1024;

/** Tetto complessivo su tutte le aziende: protegge il piano gratuito. */
export const TETTO_GLOBALE_BYTE =
  Number(process.env.TETTO_ALLEGATI_MB || (archivioEsterno ? 9000 : 350)) * 1024 * 1024;

const cliente = archivioEsterno
  ? new AwsClient({ accessKeyId: CHIAVE, secretAccessKey: SEGRETO, service: "s3", region: "auto" })
  : null;

/** La chiave dell'oggetto non contiene mai testo scelto dall'utente: solo id
 *  generati da noi, così nessun nome file può alterare il percorso. */
const chiavePer = (aziendaId, id) => `${aziendaId}/${id}`;
const urlOggetto = (chiave) => `${ENDPOINT}/${BUCKET}/${chiave}`;

/**
 * Salva il contenuto e restituisce cosa scrivere nella riga del database:
 * { posizione, chiaveEsterna, contenuto }. In modalità database il contenuto
 * torna indietro così com'è; in modalità r2 torna null, perché il file è già
 * altrove.
 */
export async function salvaFile({ aziendaId, id, contenuto, tipo }) {
  if (!archivioEsterno) return { posizione: "database", chiaveEsterna: null, contenuto };

  const chiave = chiavePer(aziendaId, id);
  const res = await cliente.fetch(urlOggetto(chiave), {
    method: "PUT",
    body: contenuto,
    headers: { "Content-Type": tipo, "Content-Length": String(contenuto.length) },
  });
  if (!res.ok) {
    throw new Error(`L'archivio esterno ha rifiutato il caricamento (codice ${res.status}).`);
  }
  return { posizione: "r2", chiaveEsterna: chiave, contenuto: null };
}

/**
 * Rilegge il contenuto di un documento a partire dalla sua riga di database.
 * Il file passa comunque dal nostro backend: così l'unico modo per scaricarlo
 * resta avere il token dell'azienda proprietaria, e i documenti non sono mai
 * raggiungibili da un indirizzo pubblico.
 */
export async function leggiFile(riga) {
  if (riga.posizione !== "r2") return riga.contenuto;

  const res = await cliente.fetch(urlOggetto(riga.chiave_esterna), { method: "GET" });
  if (!res.ok) throw new Error(`Documento non recuperabile dall'archivio esterno (codice ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Elimina il file dall'archivio esterno. Va chiamata PRIMA di cancellare la
 * riga: se fallisce, la riga resta e il documento è ancora scaricabile,
 * invece di lasciare un riferimento a un file che non c'è più.
 * In modalità database non c'è nulla da fare: il contenuto se ne va con la riga.
 */
export async function eliminaFile(riga) {
  if (!riga || riga.posizione !== "r2" || !riga.chiave_esterna) return;

  const res = await cliente.fetch(urlOggetto(riga.chiave_esterna), { method: "DELETE" });
  // 404 va bene: il file non c'è già più, l'obiettivo è raggiunto lo stesso.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Impossibile eliminare il documento dall'archivio esterno (codice ${res.status}).`);
  }
}

/**
 * Elimina in blocco i file di più righe (usata quando una commessa viene
 * cancellata e il database porta via i suoi allegati in cascata: la cascata
 * non arriva all'archivio esterno, quindi i file vanno rimossi a parte).
 * Non fa fallire l'operazione principale: un file rimasto indietro occupa
 * spazio ma non rompe nulla, mentre bloccare la cancellazione di una commessa
 * per un errore di rete sarebbe peggio. Gli errori restano nei log.
 */
export async function eliminaFileInBlocco(righe) {
  if (!archivioEsterno || !righe?.length) return;
  for (const riga of righe) {
    try {
      await eliminaFile(riga);
    } catch (e) {
      console.error("File non eliminato dall'archivio esterno:", riga.chiave_esterna, e.message);
    }
  }
}

/** Descrizione della modalità attiva, utile nei log all'avvio. */
export const descrizioneArchivio = archivioEsterno
  ? `archivio esterno R2 (bucket ${BUCKET})`
  : "archivio nel database (nessuna configurazione R2 trovata)";
