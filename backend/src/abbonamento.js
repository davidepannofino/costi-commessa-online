import { pool } from "./db.js";
import { pianoDi, fatturazioneDi, pianoPerDipendenti, bastaIlPiano, prezzoDi } from "./piani.js";
import { tolleranzaInCorso } from "./tolleranza.js";

// Email con accesso completo e illimitato, senza prova né abbonamento.
// Per aggiungerne altre in futuro basta inserire la stringa qui: nessun'altra
// modifica alla logica è necessaria.
//
// ESPORTATO PERCHÉ UNA PROVA CI GIRI SOPRA. Chi sta qui dentro non deve mai
// ricevere un avviso di scadenza della prova: sarebbe falso e allarmerebbe per
// niente. La prova in avvisiProva.test.js scorre QUESTO insieme, non una copia
// scritta a mano — una copia direbbe che funziona anche il giorno che qui
// dentro cambia qualcosa.
export const EMAIL_ESENTI = new Set([
  "pannofino.work@gmail.com",
]);

/**
 * Da quanti giorni parte la prova di chi si registra ADESSO.
 *
 * È solo il valore di partenza. La scadenza vera viene SCRITTA sulla riga
 * dell'azienda (`aziende.prova_fino_al`) nel momento della registrazione, e da
 * lì in poi è un fatto, non un conto: cambiare questo numero non tocca più
 * nessuno che è già dentro.
 *
 * Prima non era così, e vale la pena ricordare perché è cambiato. La scadenza
 * si ricavava a ogni richiesta da `utenti.creato_il + GIORNI_PROVA`, quindi la
 * costante rimisurava anche il passato: portandola da 14 a 30 il 6 agosto 2026
 * un'azienda registrata da 16 giorni è passata da "scaduto, niente accesso" a
 * "prova, 14 giorni rimasti", senza che nessuno l'avesse chiesto. Nella
 * direzione opposta sarebbe stato peggio: abbassarla avrebbe chiuso fuori, di
 * colpo, chi in quel momento stava lavorando.
 */
export const GIORNI_PROVA = 30;
const MS_GIORNO = 24 * 60 * 60 * 1000;

/**
 * Quando finisce la prova di questa azienda, in millisecondi.
 *
 * La data scritta comanda. Il conto su `creato_il` resta solo come RETE, per
 * le righe che per qualche motivo non hanno la data: è il caso di un database
 * su cui la migrazione non è ancora passata. In quel caso si ripiega sul
 * comportamento di prima invece di trattare la riga come scaduta — chiudere
 * fuori qualcuno per una colonna vuota sarebbe il modo peggiore di sbagliare.
 */
export function fineProvaDi({ prova_fino_al, creato_il }) {
  const scritta = prova_fino_al ? new Date(prova_fino_al).getTime() : NaN;
  if (!isNaN(scritta)) return scritta;
  return new Date(creato_il).getTime() + GIORNI_PROVA * MS_GIORNO;
}

/** Funzione pura: dati email, stato_abbonamento e la scadenza della prova,
 *  decide se l'azienda ha accesso ai dati in questo momento. Usata sia dal
 *  middleware sia dalla rotta che riporta lo stato al frontend. */
export function calcolaStatoAccesso({ email, stato_abbonamento, creato_il, prova_fino_al, tolleranza_fino_al }) {
  if (EMAIL_ESENTI.has(String(email).trim().toLowerCase())) {
    return { haAccesso: true, stato: "esente", giorniProvaRestanti: null };
  }
  if (stato_abbonamento === "attivo") {
    return { haAccesso: true, stato: "attivo", giorniProvaRestanti: null };
  }
  /* RINNOVO FALLITO, MA STRIPE STA ANCORA RIPROVANDO. L'accesso resta finché
     dura la data scritta sulla riga — e finisce da solo quando quella data
     passa, senza che serva nessun webhook. Chi arriva qui ha già pagato
     almeno una volta: chi non ha mai pagato non riceve mai questo stato,
     perché la tolleranza non gli viene proprio concessa (tolleranza.js).
     La data si guarda SEMPRE, anche se lo stato dicesse altro: è la data che
     comanda, non l'etichetta. */
  if (tolleranzaInCorso(tolleranza_fino_al)) {
    return {
      haAccesso: true,
      stato: "in_ritardo",
      giorniProvaRestanti: null,
      tolleranzaFinoAl: new Date(tolleranza_fino_al).toISOString(),
    };
  }
  const msRestanti = fineProvaDi({ prova_fino_al, creato_il }) - Date.now();
  if (msRestanti > 0) {
    return { haAccesso: true, stato: "prova", giorniProvaRestanti: Math.ceil(msRestanti / MS_GIORNO) };
  }
  return { haAccesso: false, stato: "scaduto", giorniProvaRestanti: 0 };
}

async function leggiRigaAccesso(aziendaId) {
  const ris = await pool.query(
    `SELECT a.stato_abbonamento, a.prova_fino_al, a.tolleranza_fino_al, u.email, u.creato_il
       FROM aziende a JOIN utenti u ON u.azienda_id = a.id WHERE a.id = $1`,
    [aziendaId]
  );
  return ris.rows[0] || null;
}

/** Da applicare dopo richiedeAuth: blocca l'accesso ai dati (non il login)
 *  se la prova è scaduta e non c'è un abbonamento attivo o un'email esente. */
export async function richiedeAbbonamentoAttivo(req, res, next) {
  try {
    const riga = await leggiRigaAccesso(req.aziendaId);
    if (!riga) return res.status(404).json({ errore: "Azienda non trovata." });
    const info = calcolaStatoAccesso(riga);
    if (!info.haAccesso) {
      return res.status(402).json({ errore: "Abbonamento richiesto.", ...info });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile verificare l'abbonamento." });
  }
}

/**
 * Gli stati a cui si concede di RILEGGERE i propri dati per portarseli via.
 *
 * Scritti a uno a uno, e non come "tutti tranne quelli bloccati", per la regola
 * dei corollari in PRODUCT.md: un ramo che cattura tutto quello che non ha
 * trovato posto prima diventa falso il giorno che si aggiunge un caso nuovo.
 * Se domani nascesse uno stato "sospeso" — un account fermato per abuso o per
 * un pagamento contestato — con un "tranne" gli si aprirebbe l'esportazione da
 * solo, senza che nessuno l'abbia deciso. Così invece non passa, e chi lo
 * aggiunge deve venire qui e scegliere.
 */
const STATI_CHE_POSSONO_ESPORTARE = new Set(["esente", "attivo", "prova", "scaduto", "in_ritardo"]);

/**
 * Da applicare dopo richiedeAuth, SOLO alle rotte che leggono e non scrivono.
 *
 * A cosa serve. PRODUCT.md promette che uscire (Excel, CSV, stampa) resta
 * facile come entrare. Con il solo `richiedeAbbonamentoAttivo` quella promessa
 * cadeva esattamente quando serve: un'impresa che decide di non abbonarsi si
 * ritrovava i propri costi del personale chiusi dentro. Quei dati sono suoi.
 *
 * PERCHÉ NON È IL BLOCCO CHE SI ALLENTA. `richiedeAbbonamentoAttivo` non è
 * stato toccato e resta su tutte le rotte che aveva: questa è una guardia
 * SEPARATA, e le rotte che la usano si contano su una mano. Il nome è lungo
 * apposta — deve essere impossibile scriverlo credendo di scrivere l'altro.
 *
 * NON BASTA QUESTA FUNZIONE a rendere una rotta sicura: la sola lettura la
 * garantisce il DATABASE, con una transazione dichiarata READ ONLY nel
 * gestore. Qui si decide CHI può bussare, là si decide COSA può succedere.
 */
export async function richiedeAccessoAiPropriDati(req, res, next) {
  try {
    const riga = await leggiRigaAccesso(req.aziendaId);
    if (!riga) return res.status(404).json({ errore: "Azienda non trovata." });
    const info = calcolaStatoAccesso(riga);
    if (!STATI_CHE_POSSONO_ESPORTARE.has(info.stato)) {
      return res.status(402).json({ errore: "Abbonamento richiesto.", ...info });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ errore: "Impossibile verificare l'abbonamento." });
  }
}

/**
 * Tutte le aziende, nella forma che serve per decidere gli avvisi di scadenza.
 *
 * Le stesse colonne che legge leggiRigaAccesso, più le tre date degli avvisi.
 * Sta QUI e non in server.js perché l'elenco delle colonne deve stare accanto
 * a `calcolaStatoAccesso`, che è l'unica cosa autorizzata a interpretarle: una
 * colonna aggiunta là e dimenticata qui darebbe uno stato calcolato su dati
 * parziali, e lo darebbe in silenzio.
 *
 * Si leggono tutte le righe senza filtrare per stato, di proposito: chi ha
 * diritto a un avviso lo decide `avvisiProva.js` a partire dallo stato
 * calcolato, non una WHERE che duplicherebbe quella regola in SQL.
 */
export async function aziendePerAvvisiProva() {
  const ris = await pool.query(
    `SELECT a.id, a.stato_abbonamento, a.prova_fino_al, a.tolleranza_fino_al,
            a.avviso_prova_7g_il, a.avviso_prova_1g_il, a.avviso_prova_scaduta_il,
            u.email, u.creato_il
       FROM aziende a JOIN utenti u ON u.azienda_id = a.id`
  );
  return ris.rows;
}

export async function statoAbbonamentoDi(aziendaId) {
  const riga = await leggiRigaAccesso(aziendaId);
  if (!riga) return null;
  return calcolaStatoAccesso(riga);
}

/**
 * Quanti mesi indietro si guarda per misurare la capienza: il mese in corso
 * più gli undici precedenti.
 */
const MESI_FINESTRA = 12;

/**
 * IL MESE DI PUNTA: in quale mese solare degli ultimi dodici hanno lavorato
 * più persone, e quante erano.
 *
 * PERCHÉ IL PICCO E NON IL TOTALE. In edilizia il ricambio è alto: otto operai
 * fissi più quattro sostituzioni nell'arco dell'anno fanno dodici teste
 * diverse, ma in cantiere non ci sono mai state più di otto persone insieme.
 * Contando le teste si farebbe pagare un piano più grande a chi non è mai
 * cresciuto — e sarebbe anche un numero indifendibile davanti al cliente. Il
 * picco misura la capienza vera.
 *
 * PERCHÉ NON SI CONTA LA TABELLA `dipendenti`, nemmeno adesso che si può.
 * Da agosto 2026 quella tabella ha `archiviato`, quindi chi se n'è andato si
 * riconosce: la vecchia obiezione ("non c'è nessun flag") è caduta. La
 * ragione vera però non era quella ed è ancora intera — è il RICAMBIO scritto
 * qui sopra. Contare le teste attive oggi direbbe quante persone ci sono in
 * anagrafica in questo istante, non quante ne ha tenute insieme in cantiere:
 * sono due numeri diversi, e quello che misura la capienza è il secondo.
 *
 * C'è anche un motivo pratico per non spostarsi: il conteggio sulle ore non
 * dipende da un'abitudine. Chi archivia con cura e chi non archivia mai
 * ottengono lo stesso picco, perché il picco lo fanno i giorni lavorati.
 * Legarlo a un flag vorrebbe dire far pagare di più chi tiene l'elenco in
 * disordine.
 *
 * Un archiviato che ha lavorato negli ultimi dodici mesi CONTA nel suo mese,
 * ed è giusto: quel mese era in cantiere. Esce da solo quando il suo mese
 * esce dalla finestra.
 *
 * SI GUARDA LA DATA DEL LAVORO, non quando le ore sono state battute. Qui le
 * ore di luglio si inseriscono ad agosto, e un conteggio sul momento
 * dell'inserimento direbbe che a luglio non ha lavorato nessuno.
 *
 * A parità di persone vince il mese più recente: serve un ordine totale,
 * altrimenti la stessa azienda vedrebbe scritto un mese diverso a ogni
 * ricaricamento.
 */
export async function mesePuntaDi(aziendaId) {
  const ris = await pool.query(
    `SELECT to_char(data, 'YYYY-MM') AS mese, count(DISTINCT dipendente_id)::int AS persone
       FROM registrazioni
      WHERE azienda_id = $1
        AND data >= (date_trunc('month', CURRENT_DATE) - make_interval(months => $2::int))
      GROUP BY 1
      ORDER BY persone DESC, mese DESC
      LIMIT 1`,
    [aziendaId, MESI_FINESTRA - 1]
  );
  const r = ris.rows[0];
  return r ? { mese: r.mese, persone: r.persone } : { mese: null, persone: 0 };
}

/**
 * Il quadro della capienza: che piano ha, quanto costa, qual è stato il mese
 * di punta e quale piano ne risulterebbe.
 *
 * NON DECIDE NIENTE. Restituisce numeri da mostrare nella schermata
 * dell'abbonamento. Nessun middleware la chiama, nessuna rotta la guarda per
 * rifiutare qualcosa: se un giorno qualcuno la mettesse dentro
 * richiedeAbbonamentoAttivo, avrebbe trasformato un'informazione in un
 * blocco — e sarebbe anche una query in più su ogni singola richiesta.
 */
export async function capienzaDi(aziendaId) {
  const ris = await pool.query("SELECT piano, fatturazione FROM aziende WHERE id = $1", [aziendaId]);
  if (!ris.rows[0]) return null;

  const piano = pianoDi(ris.rows[0].piano);
  const fatturazione = fatturazioneDi(ris.rows[0].fatturazione);
  const punta = await mesePuntaDi(aziendaId);
  const consigliato = pianoPerDipendenti(punta.persone);

  return {
    piano: piano.id,
    pianoNome: piano.nome,
    tetto: piano.tetto,
    fatturazione,
    prezzo: prezzoDi(piano.id, fatturazione),
    /* Tutti e due i prezzi, così la schermata può far scegliere la periodicità
       senza ricopiarsi nessun importo: gli euro stanno solo in piani.js. */
    prezzoMensile: prezzoDi(piano.id, "mensile"),
    prezzoAnnuale: prezzoDi(piano.id, "annuale"),
    mesePunta: punta.mese,
    personeMesePunta: punta.persone,
    pianoConsigliato: consigliato.id,
    pianoConsigliatoNome: consigliato.nome,
    bastaIlPiano: bastaIlPiano(piano.id, punta.persone),
  };
}
