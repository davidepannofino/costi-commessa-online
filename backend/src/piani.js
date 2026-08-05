/**
 * I TRE PIANI: quanto costano e quanta gente ci sta dentro.
 *
 * Funzioni pure, nessun database e nessuno Stripe, per la stessa ragione di
 * abbinamentoDDT.js e sceltaFiltrata.js: è una tabella di regole, e una
 * tabella di regole si mette alla prova senza accendere niente.
 *
 * LE FUNZIONI SONO LE STESSE SU TUTTI E TRE. Non c'è niente, da nessuna parte,
 * che si accenda o si spenga in base al piano: cambia solo la capienza. Se un
 * giorno qualcuno vorrà legare una funzione a un piano, dovrà aggiungere qui
 * il concetto stesso di "funzione inclusa", che oggi non esiste — ed è il
 * momento giusto per chiedersi se sia davvero quello che si vuole vendere.
 *
 * IL TETTO NON BLOCCA NIENTE. Questo file dice quale piano SERVIREBBE per
 * quante persone; non dice, e non deve mai dire, chi può lavorare. Superare la
 * capienza produce una frase nella schermata dell'abbonamento e nient'altro:
 * l'undicesimo dipendente si aggiunge, le sue ore si registrano, i conti si
 * fanno. Un software che ti impedisce di lavorare perché hai assunto una
 * persona non lo vuole nessuno.
 *
 * I PREZZI SONO AL NETTO DELL'IVA.
 */

/** L'ordine conta: pianoPerDipendenti scorre da qui e prende il primo che
 *  basta. Dal più piccolo al più grande, sempre. */
export const ORDINE = ["cantiere", "impresa", "struttura"];

export const PIANI = {
  cantiere:  { id: "cantiere",  nome: "Cantiere",  tetto: 10,   prezzoMensile: 49 },
  impresa:   { id: "impresa",   nome: "Impresa",   tetto: 30,   prezzoMensile: 99 },
  /* tetto null = nessun tetto. Non Infinity: questo valore esce da un'API in
     JSON, e JSON.stringify(Infinity) è "null" — meglio scriverlo null noi e
     sapere cosa vuol dire, che scoprirlo per caso dall'altra parte. */
  struttura: { id: "struttura", nome: "Struttura", tetto: null, prezzoMensile: 179 },
};

/** Chi non ha ancora un piano scritto sta sul più piccolo. Vale per le righe
 *  vecchie e per chi si registra: si sale quando serve, non prima. */
export const PIANO_PREDEFINITO = "cantiere";

/** Sull'annuale si pagano dieci mesi invece di dodici: due mesi in regalo. */
export const MESI_PAGATI_ANNUALE = 10;

export const FATTURAZIONI = ["mensile", "annuale"];
export const FATTURAZIONE_PREDEFINITA = "mensile";

/**
 * Il piano a partire dal suo identificativo, con la rete per i casi storti:
 * colonna vuota, valore sconosciuto, maiuscole. Non lancia mai — davanti a un
 * valore che non capisce restituisce il piano più piccolo, che è la scelta che
 * non fa danni né all'utente né al conto.
 */
export function pianoDi(id) {
  const chiave = String(id ?? "").trim().toLowerCase();
  return PIANI[chiave] || PIANI[PIANO_PREDEFINITO];
}

export function fatturazioneDi(valore) {
  const v = String(valore ?? "").trim().toLowerCase();
  return FATTURAZIONI.includes(v) ? v : FATTURAZIONE_PREDEFINITA;
}

/**
 * Quale piano serve per questo numero di persone.
 *
 * "Fino a 10" vuol dire che 10 ci stanno: il confine è dentro, non fuori.
 * Zero persone stanno nel piano più piccolo — un'azienda appena registrata non
 * deve trovarsi consigliato niente.
 */
export function pianoPerDipendenti(persone) {
  const n = Number(persone);
  if (!Number.isFinite(n) || n <= 0) return PIANI[PIANO_PREDEFINITO];
  for (const id of ORDINE) {
    const p = PIANI[id];
    if (p.tetto === null || n <= p.tetto) return p;
  }
  return PIANI[ORDINE[ORDINE.length - 1]];
}

/** Il piano scelto basta per quante persone ci sono? Un piano senza tetto
 *  basta sempre. */
export function bastaIlPiano(idPiano, persone) {
  const p = pianoDi(idPiano);
  if (p.tetto === null) return true;
  const n = Number(persone);
  return !Number.isFinite(n) || n <= p.tetto;
}

/** Quanto si paga, in euro e al netto dell'IVA. Sull'annuale è il totale
 *  dell'anno, non la rata: dieci mensilità in una volta. */
export function prezzoDi(idPiano, fatturazione) {
  const p = pianoDi(idPiano);
  return fatturazioneDi(fatturazione) === "annuale"
    ? p.prezzoMensile * MESI_PAGATI_ANNUALE
    : p.prezzoMensile;
}

/** Il catalogo in forma di elenco ordinato, per chi deve mostrarlo. */
export function elencoPiani() {
  return ORDINE.map((id) => ({
    ...PIANI[id],
    prezzoAnnuale: PIANI[id].prezzoMensile * MESI_PAGATI_ANNUALE,
  }));
}
