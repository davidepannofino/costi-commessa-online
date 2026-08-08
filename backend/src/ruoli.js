/**
 * CHI PUO' FARE COSA DENTRO UN'AZIENDA.
 *
 * Due ruoli, e due bastano per il caso vero:
 *
 *   titolare — quello di sempre. Vede i lordi, i costi, l'abbonamento, e scrive
 *              tutto. Finche' non esiste un secondo utente, ogni azienda ha solo
 *              questo, ed e' il motivo per cui il prodotto ha funzionato fin qui
 *              senza sapere chi fosse collegato.
 *   ore      — chi il foglietto lo scrive in cantiere. Registra le ore, le
 *              proprie le corregge, e dei soldi non vede NIENTE.
 *
 * PERCHE' NON TRE. Un terzo ruolo per l'amministrazione — chi carica fatture e
 * DDT — servira' il giorno che quella persona esiste davvero, e quel giorno si
 * sapra' cosa deve vedere. Oggi quella persona e' il titolare, stesso account:
 * inventarle un ruolo adesso vorrebbe dire disegnare permessi su un'ipotesi.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL SEGRETO SONO I LORDI, NON LE ORE.
 *
 * Dentro i dati di un'azienda c'e' quanto guadagna ogni persona. Chi inserisce
 * le ore non deve poterlo vedere, ne' risalirci dai costi di commessa — che
 * sono lordo diviso ore, quindi un costo e un monte ore sono un lordo scritto
 * in un altro modo.
 *
 * Le ore degli altri invece le vede, ed e' voluto: chi arriva dal cantiere
 * scrive per la squadra, non solo per se'. Nascondergliele renderebbe il lavoro
 * impossibile senza proteggere niente.
 *
 * E LA SEPARAZIONE STA NELLA QUERY, NON NELLA SCHERMATA. L'applicazione manda
 * al browser tutto il dataset e fa i conti li': nascondere una colonna
 * nell'interfaccia non nasconde niente, perche' il numero e' gia' arrivato e
 * basta aprire la scheda rete per leggerlo. Per questo `stampoStato` qui sotto
 * costruisce DUE risposte diverse, e le rotte fanno due SELECT diverse.
 *
 * GLI INSIEMI SONO SCRITTI IN POSITIVO, mai come «tutti tranne». E' la stessa
 * forma di STATI_CHE_POSSONO_ESPORTARE e degli stati che ricevono gli avvisi,
 * per la stessa ragione scritta in PRODUCT.md fra i corollari: un «tranne»
 * diventa falso il giorno che nasce un ruolo nuovo, e lo fa in silenzio.
 * Un ruolo che non e' in questi insiemi non puo' fare niente — che e' la
 * direzione sicura in cui sbagliare.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const TITOLARE = "titolare";
export const ORE = "ore";

/** I ruoli che si possono assegnare. Un valore fuori da qui non si scrive. */
export const RUOLI = new Set([TITOLARE, ORE]);
export const ruoloValido = (r) => RUOLI.has(r);

/* Chi vede i soldi: lordi, tariffe, costi, materiali, documenti di spesa,
   stato dell'abbonamento. E' l'insieme che conta piu' di tutti. */
const VEDE_I_SOLDI = new Set([TITOLARE]);

/* Chi puo' mandare l'intero dataset con PUT /api/stato — cioe' riscrivere
   anagrafica, lordi e commesse. */
const SCRIVE_TUTTO = new Set([TITOLARE]);

/* Chi puo' usare la rotta stretta delle ore. Il titolare c'e' dentro perche'
   non gli si toglie niente: continua ad avere anche l'altra strada. */
const SCRIVE_LE_ORE = new Set([TITOLARE, ORE]);

/* Chi crea e toglie gli utenti dell'azienda. */
const GESTISCE_GLI_UTENTI = new Set([TITOLARE]);

/* Chi puo' correggere e cancellare QUALUNQUE riga di ore, non solo le proprie. */
const TOCCA_LE_RIGHE_ALTRUI = new Set([TITOLARE]);

export const vedeISoldi = (ruolo) => VEDE_I_SOLDI.has(ruolo);
export const scriveTutto = (ruolo) => SCRIVE_TUTTO.has(ruolo);
export const scriveLeOre = (ruolo) => SCRIVE_LE_ORE.has(ruolo);
export const gestisceGliUtenti = (ruolo) => GESTISCE_GLI_UTENTI.has(ruolo);
export const toccaLeRigheAltrui = (ruolo) => TOCCA_LE_RIGHE_ALTRUI.has(ruolo);

/**
 * I campi che una riga di ore puo' portare, e nessun altro.
 *
 * Serve alla rotta stretta: quello che arriva viene copiato campo per campo da
 * questo elenco, invece di essere passato cosi' com'e'. Un corpo che contenesse
 * `lordo` o `azienda_id` non viene ripulito — semplicemente quelle chiavi non
 * si leggono mai, che e' la stessa idea del registro delle richieste: il modo
 * di non far passare una cosa non e' filtrarla, e' non leggerla.
 */
export const CAMPI_DI_UNA_RIGA_ORE = ["id", "dipendenteId", "commessaId", "data", "ore"];

/**
 * «Questo dato manca, o me l'hanno tolto?»
 *
 * La domanda che ogni modulo che legge i dati dovrebbe farsi prima di trarre
 * una conclusione da un campo che non c'e'. Se la risposta e' «trattenuto», la
 * cosa giusta da fare e' TACERE: non e' un buco nei dati dell'azienda, e' un
 * permesso. Vedi il commento dentro `stampoStato`.
 */
export const trattenuto = (dati, nome) =>
  Array.isArray(dati?.trattenuti) && dati.trattenuti.includes(nome);

/**
 * LA RISPOSTA DI /api/stato, costruita per ruolo.
 *
 * E' la seconda difesa, non la prima: la prima e' che per il ruolo `ore` la
 * SELECT non chiede nemmeno la colonna dei lordi. Questa funzione esiste perche'
 * quella difesa sta in un file da settemila righe e un domani qualcuno potrebbe
 * unificare le due query «per semplificare». Se succede, qui i lordi non passano
 * lo stesso — e c'e' una prova che lo pretende.
 *
 * @param ruolo        da richiedeAuth, mai dal client
 * @param utenteId     per dire quali righe sono di chi legge
 * @param dati         { azienda, dipendenti, commesse, registrazioni, materiali,
 *                       allegati, spazio, versione }
 */
export function stampoStato(ruolo, utenteId, dati = {}) {
  const {
    azienda = "", dipendenti = [], commesse = [], registrazioni = [],
    materiali = [], allegati = [], spazio = null, versione = 0,
  } = dati;

  /* LE ORE, PER CHIUNQUE. `mia` e non l'id di chi ha scritto: al ruolo `ore`
     serve sapere quali righe puo' correggere, non chi sono gli altri. I nomi
     degli altri utenti non hanno ragione di uscire da qui. */
  const righeOre = registrazioni.map((r) => ({
    id: r.id,
    dipendenteId: r.dipendenteId ?? r.dipendente_id,
    commessaId: r.commessaId ?? r.commessa_id,
    data: r.data,
    ore: r.ore,
    mia: r.inserita_da != null && String(r.inserita_da) === String(utenteId),
  }));

  const comuni = {
    azienda,
    versione,
    ruolo,
    commesse: commesse.map((c) => ({ id: c.id, codice: c.codice, descrizione: c.descrizione })),
    registrazioni: righeOre,
  };

  /* ─────────────────────────────────────────────────────────────────────────
     QUELLO CHE ABBIAMO TRATTENUTO SI DICE, non si lascia mancare.

     E' la regola che questa riga esiste per stabilire, ed e' la stessa famiglia
     di «nessun ripiego che afferma» in PRODUCT.md, spostata da chi SCRIVE una
     conclusione a chi la RICAVA.

     Il difetto di fondo: il browser non puo' distinguere «questo dato non c'e'»
     da «questo dato non me l'hanno mandato». Arrivano identici — un campo
     assente — e sono cose diversissime. Il 9 agosto 2026 questo ha prodotto,
     sullo schermo di un capocantiere, la frase «a luglio mancano i lordi di 14
     persone: le loro 2.679,5 ore valgono 0 €». Falsa: i lordi non mancavano,
     glieli avevamo tolti noi. E accanto un «costo del periodo 0,00 €», grande,
     calcolato su quel vuoto.

     Il rimedio non e' aggiustare il modulo che ha sbagliato: e' togliere
     l'ambiguita' alla radice. La risposta DICHIARA cosa e' stato trattenuto, e
     qualunque modulo — anche uno scritto fra un anno da chi non sa niente di
     ruoli — puo' chiedere «assente o trattenuto?» e TACERE invece di
     concludere.

     Segnale POSITIVO, non un'assenza da interpretare: c'e' un elenco e dice dei
     nomi. E' la stessa scelta fatta per riconoscere un backend vecchio, dove si
     guarda se la risposta PORTA `versione` invece di annusare un 404.
     ───────────────────────────────────────────────────────────────────────── */
  if (!vedeISoldi(ruolo)) {
    comuni.trattenuti = ["lordi", "materiali", "allegati", "costi"];
  } else {
    comuni.trattenuti = [];
  }

  if (!vedeISoldi(ruolo)) {
    /* Niente lordo_mensile, niente materiali, niente allegati, niente spazio.
       I dipendenti restano — servono i nomi per attribuire le ore — ma solo
       nome, cognome e se sono ancora in servizio. */
    return {
      ...comuni,
      dipendenti: dipendenti.map((d) => ({
        id: d.id, nome: d.nome, cognome: d.cognome, archiviato: d.archiviato,
      })),
    };
  }

  return {
    ...comuni,
    dipendenti: dipendenti.map((d) => ({
      id: d.id, nome: d.nome, cognome: d.cognome,
      archiviato: d.archiviato,
      lordoMensile: d.lordoMensile ?? d.lordo_mensile ?? {},
    })),
    materiali,
    allegati,
    spazio,
  };
}
