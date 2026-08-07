/**
 * QUALI RIGHE SCRIVERE DAVVERO, E QUALI LASCIARE STARE.
 *
 * `PUT /api/stato` riceve l'elenco intero delle registrazioni a ogni
 * salvataggio, anche quando è cambiata una cifra sola. Prima le cancellava
 * tutte e le riscriveva una per una: per PIEMME, 624 istruzioni verso Neon per
 * aver cambiato un numero, più le altre — 670 in tutto. E il costo cresceva con
 * lo storico, quindi il prodotto rallentava man mano che lo si usava bene.
 *
 * Questo modulo risponde a una domanda sola: date le righe che stanno nel
 * database e quelle che arrivano dal browser, **quali sono cambiate davvero**.
 * Non parla con il database e non sa niente di SQL: prende due elenchi e ne
 * restituisce due. Così si può provare tutto senza rete.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGOLA DA CUI DISCENDE TUTTO IL RESTO: NEL DUBBIO SI SCRIVE.
 *
 * Sbagliare il confronto ha due esiti, e non si equivalgono:
 *
 *   - credere che una riga sia cambiata quando non lo è
 *     → si riscrive una riga inutilmente. Costo: niente.
 *
 *   - credere che una riga NON sia cambiata quando lo è
 *     → la modifica appena fatta non arriva al database, e nessuno se ne
 *       accorge: a schermo è giusta, al prossimo caricamento è sparita.
 *       **È l'unico caso da cui bisogna difendersi.**
 *
 * Quindi il confronto non è costruito come «sono diversi?» ma come **«sono
 * uguali con certezza?»**, e la certezza va guadagnata: ogni tipo che può
 * comparire dev'essere riconosciuto per nome. Un valore che il confronto non
 * riconosce non è «uguale», non è «diverso»: è «non lo so» — e qui non lo so
 * conta come cambiato.
 *
 * Non è una cautela generica, è una scelta di forma. Se un giorno una colonna
 * cambiasse tipo, o il browser cominciasse a mandare una data come oggetto
 * invece che come stringa, il confronto smetterebbe di riconoscerla e
 * ricomincerebbe a riscrivere tutto: lento come prima, corretto come prima. Il
 * guasto peggiore che questo modulo può produrre è di essere inutile, mai di
 * far sparire una riga.
 * ────────────────────────────────────────────────────────────────────────────
 */

/* I TIPI RICONOSCIUTI, UNO PER UNO.
   Ognuna di queste funzioni risponde «sì, questi due valori sono uguali e ne
   sono sicura». Qualunque altra cosa — un tipo inatteso, una forma inattesa,
   un valore mancante — esce false, cioè «riscrivi». */

/** Numeri come li scrive Postgres per NUMERIC: "8", "8.00", "-1.5". */
const FORMA_NUMERO = /^-?\d+(?:\.\d+)?$/;
/** Date come le legge la GET: to_char(data, 'YYYY-MM-DD'). */
const FORMA_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * TESTO (gli id di dipendente e commessa). Riconosce due stringhe e basta.
 * Un numero, un null, un oggetto: non riconosciuti, quindi si riscrive.
 */
function testiUguali(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a === b;
}

/**
 * DATA. La colonna è DATE e viene letta come 'AAAA-MM-GG'; dal browser arriva
 * nella stessa forma. Si confrontano solo due stringhe di quella forma esatta:
 * un oggetto Date, o un '2026-8-7' senza zeri, non sono riconosciuti — e a
 * quel punto la riga si riscrive invece di indovinare se è la stessa data.
 */
function dateUguali(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!FORMA_DATA.test(a) || !FORMA_DATA.test(b)) return false;
  return a === b;
}

/**
 * NUMERO (le ore). Qui i due lati hanno tipi DIVERSI per costruzione: la
 * colonna è NUMERIC e il driver la restituisce come stringa ("8.00"), mentre
 * dal browser arriva un numero JSON (8). È il confronto più delicato del
 * modulo, ed è il motivo per cui esiste: un `===` diretto fra "8.00" e 8
 * direbbe «diversi» sempre, e riscriverebbe tutto per sempre.
 *
 * Si riconoscono solo il numero finito e la stringa di cifre. Un booleano, un
 * NaN, un "8,00" con la virgola, un "1e3": non riconosciuti, si riscrive.
 */
function numeroCerto(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!FORMA_NUMERO.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numeriUguali(a, b) {
  const a1 = numeroCerto(a), b1 = numeroCerto(b);
  if (a1 === null || b1 === null) return false;
  return a1 === b1;
}

/**
 * IL CONFINE FRA I DUE MONDI, scritto una volta sola.
 *
 * A sinistra i nomi delle colonne come tornano da Postgres (snake_case), a
 * destra i nomi come li manda il browser (camelCase). Tenerli in tabella
 * invece che sparsi nel codice serve a una cosa precisa: **una colonna
 * aggiunta alle registrazioni e dimenticata qui renderebbe invisibile al
 * confronto ogni sua modifica.** Chi aggiunge una colonna deve aggiungere una
 * riga qui, e il posto dove farlo è uno solo.
 *
 * L'id non è in tabella perché non si confronta: è l'identità della riga.
 */
const CAMPI = [
  { colonna: "dipendente_id", campo: "dipendenteId", uguali: testiUguali },
  { colonna: "commessa_id",   campo: "commessaId",   uguali: testiUguali },
  { colonna: "data",          campo: "data",         uguali: dateUguali },
  { colonna: "ore",           campo: "ore",          uguali: numeriUguali },
];

/**
 * Va scritta questa riga?
 *
 * @param vecchia  la riga come sta nel database, o undefined se non c'è
 * @param nuova    la riga come arriva dal browser
 */
export function rigaDaScrivere(vecchia, nuova) {
  if (!vecchia) return true;                                  // non c'era: è nuova
  if (!nuova || typeof nuova !== "object") return true;       // non la capisco: scrivo
  for (const c of CAMPI) {
    if (!c.uguali(vecchia[c.colonna], nuova[c.campo])) return true;
  }
  return false;
}

/**
 * Il confronto vero e proprio.
 *
 * @param nelDatabase  le righe lette adesso: { id, dipendente_id, commessa_id, data, ore }
 * @param inArrivo     le righe mandate dal browser: { id, dipendenteId, commessaId, data, ore }
 * @returns { daScrivere, daCancellare }
 *
 * `daScrivere` sono le righe nuove più quelle cambiate, nella forma in cui
 * sono arrivate (si scrivono così com'è).
 *
 * `daCancellare` sono gli id presenti nel database e assenti dall'elenco in
 * arrivo. **Serve a sapere quante sono, non a costruire la DELETE**: la DELETE
 * usa in SQL lo stesso identico predicato che usa il cancello della soglia, e
 * il motivo sta in sogliaCancellazioni.js. Qui si calcola lo stesso insieme in
 * JavaScript, e c'è una prova che verifica che i due modi coincidano sempre.
 */
export function confrontaRegistrazioni({ nelDatabase, inArrivo }) {
  const vecchie = new Map();
  for (const r of nelDatabase ?? []) {
    if (r && r.id != null) vecchie.set(String(r.id), r);
  }

  const daScrivere = [];
  const idVisti = new Set();
  for (const r of inArrivo ?? []) {
    /* Una riga senza id non si prova a sistemare: passa avanti così com'è e
       sarà il database a rifiutarla (la chiave primaria non ammette null),
       annullando la transazione. Inventarle un id qui vorrebbe dire scrivere
       una riga che nessuno ha chiesto. */
    if (!r || r.id == null) { daScrivere.push(r); continue; }
    idVisti.add(String(r.id));
    if (rigaDaScrivere(vecchie.get(String(r.id)), r)) daScrivere.push(r);
  }

  const daCancellare = [];
  for (const id of vecchie.keys()) if (!idVisti.has(id)) daCancellare.push(id);

  return { daScrivere, daCancellare };
}
