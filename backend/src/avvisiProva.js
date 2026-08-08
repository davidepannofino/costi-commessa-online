/**
 * GLI AVVISI SULLA SCADENZA DELLA PROVA: chi li riceve, e cosa c'è scritto.
 *
 * Tre messaggi, in tutto e per sempre: uno quando mancano sette giorni, uno
 * l'ultimo giorno, uno a scadenza avvenuta. **Dopo il terzo non parte mai più
 * niente** — nessuna «ultima occasione», nessuno sconto, nessun promemoria.
 * Sono tre informazioni, non l'inizio di un imbuto di vendita: chi ha deciso
 * di non abbonarsi non va inseguito. Il terzo messaggio lo dice apertamente a
 * chi lo riceve, così la promessa è verificabile da fuori e non solo da qui.
 *
 * NIENTE DATABASE, NIENTE RETE. Questo modulo prende delle righe già lette e
 * dice chi riceve cosa. Le tre email si possono leggere per intero in una
 * prova, senza chiave di Resend e senza connessione.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ SI SCRIVE LA DATA E MAI QUANTI GIORNI MANCANO.
 *
 * Non è per paura che l'invio parta in ritardo: il numero di giorni si calcola
 * nel momento in cui si manda, quindi alla partenza sarebbe esatto.
 *
 * È perché **l'email viene LETTA in un momento che non conosciamo.** «Mancano
 * cinque giorni» è vero martedì quando parte, ed è falso nella posta di chi la
 * apre giovedì. Non c'è modo di sapere quando qualcuno guarda la sua casella,
 * e un messaggio che diventa falso da solo, stando fermo, è peggio di un
 * messaggio meno incalzante.
 *
 * «Il periodo di prova finisce il 19 agosto 2026» è vero il 12, il 18, il 20 e
 * fra un anno. La data è un fatto; il conto alla rovescia è una fotografia che
 * scade.
 *
 * L'unica etichetta relativa ammessa è «Ultimo giorno di prova: 19 agosto
 * 2026» nell'oggetto del secondo avviso, e regge alla stessa prova: non
 * afferma «è oggi», qualifica LA DATA che ha accanto. Resta vera comunque
 * venga letta, e si capisce dalla lista della posta senza aprire niente.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MS_GIORNO = 24 * 60 * 60 * 1000;

export const SETTE = "sette";
export const ULTIMO = "ultimo";
export const SCADUTA = "scaduta";

/** Quando parte ciascuno dei tre. */
export const GIORNI_PRIMO_AVVISO = 7;
export const GIORNI_ULTIMO_AVVISO = 1;

/**
 * Quanto indietro si guarda per l'avviso di scadenza avvenuta.
 *
 * NON è un dettaglio: è la difesa del primo giorno. Quando la migrazione
 * aggiunge le colonne, ogni riga ha NULL — e senza questa finestra il primo
 * giro manderebbe l'email di scadenza a CHIUNQUE abbia mai abbandonato una
 * prova, anche a chi è scaduto mesi fa. La difesa sta qui, dentro la
 * condizione, e non in uno script di sistemazione da eseguire una volta: le
 * scadenze vecchie non corrispondono mai, quindi non c'è niente da sistemare
 * né adesso né fra un anno.
 */
export const GIORNI_FINESTRA_SCADENZA = 7;

/**
 * GLI STATI CHE RICEVONO, SCRITTI IN POSITIVO.
 *
 * Due insiemi che elencano chi riceve, mai un «tutti tranne». È la stessa
 * forma di STATI_CHE_POSSONO_ESPORTARE in abbonamento.js e per la stessa
 * ragione, che PRODUCT.md chiama «nessun ripiego che afferma»: un «tranne»
 * diventa falso il giorno che nasce uno stato nuovo, e lo fa in silenzio.
 *
 * Chi resta fuori, e perché conta:
 *
 *   esente     — accesso illimitato, nessuna prova da far scadere. Scrivergli
 *                «la tua prova sta per scadere» sarebbe falso e allarmante.
 *   attivo     — sta pagando.
 *   in_ritardo — ha già pagato e Stripe sta riprovando l'addebito. Parlargli
 *                di prova sarebbe falso quanto parlarne a un esente.
 *
 * Nota che `esente` non entra qui NEMMENO SE la sua riga ha una data di prova
 * scritta e ormai passata: calcolaStatoAccesso guarda l'esenzione per prima e
 * la data non la guarda proprio. C'è una prova che costruisce esattamente
 * quella riga, perché è il caso che si romperebbe per primo se qualcuno
 * invertisse quei due controlli.
 */
const STATI_PRIMA_DELLA_SCADENZA = new Set(["prova"]);
const STATI_DOPO_LA_SCADENZA = new Set(["scaduto"]);

/**
 * Quale avviso mandare a questa azienda, se ce n'è uno.
 *
 * @param stato               da calcolaStatoAccesso: la SOLA definizione
 * @param giorniProvaRestanti da calcolaStatoAccesso, per lo stesso motivo
 * @param fineProva           quando finisce la prova, in millisecondi
 * @param avvisi              { sette, ultimo, scaduta } — quando sono stati
 *                            chiusi, null se non ancora
 * @returns null, oppure { tipo, fineProva, chiude: [...] }
 *
 * `chiude` sono gli avvisi che dopo questo invio non devono più partire, e
 * comprende sempre quello che si sta mandando. Chi arriva all'ultimo giorno
 * senza aver ricevuto il primo riceve SOLO l'ultimo: mandarli tutti e due
 * insieme sarebbe la cosa che questo modulo esiste per non fare.
 */
export function avvisoDaMandare({ stato, giorniProvaRestanti, fineProva, avvisi = {} } = {}, adesso = Date.now()) {
  /* UN NUMERO DEV'ESSERE GIÀ UN NUMERO: niente conversioni.
     `Number(null)` fa zero, e zero qui significa «scade entro oggi», cioè il
     messaggio più urgente dei tre. Un campo mancante diventerebbe la ragione
     per scrivere a qualcuno. Una prova l'ha trovato: valeva la pena scriverla.
     La direzione sicura qui è l'opposta di quella del confronto fra
     registrazioni — là nel dubbio si scriveva una riga in più, qui nel dubbio
     NON si manda: una riga di troppo non costa niente, un'email non si
     richiama indietro, e il giro dopo la manda comunque se serviva. */
  const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const scadenza = numero(fineProva);
  if (scadenza === null) return null;

  if (STATI_DOPO_LA_SCADENZA.has(stato)) {
    if (avvisi.scaduta) return null;
    const giorniDallaScadenza = (adesso - scadenza) / MS_GIORNO;
    if (giorniDallaScadenza < 0 || giorniDallaScadenza > GIORNI_FINESTRA_SCADENZA) return null;
    return { tipo: SCADUTA, fineProva: scadenza, chiude: [SCADUTA, ULTIMO, SETTE] };
  }

  if (!STATI_PRIMA_DELLA_SCADENZA.has(stato)) return null;

  const restanti = numero(giorniProvaRestanti);
  if (restanti === null) return null;

  /* Sotto il giorno l'unico candidato è l'ultimo avviso, anche se il primo non
     è mai partito: a quel punto «finisce il 19 agosto» come primo contatto
     sarebbe una notizia data troppo tardi e per giunta due volte. */
  if (restanti <= GIORNI_ULTIMO_AVVISO) {
    return avvisi.ultimo ? null : { tipo: ULTIMO, fineProva: scadenza, chiude: [ULTIMO, SETTE] };
  }
  if (restanti <= GIORNI_PRIMO_AVVISO) {
    return avvisi.sette ? null : { tipo: SETTE, fineProva: scadenza, chiude: [SETTE] };
  }
  return null;
}

/* ══════════════════════════ I TRE TESTI ══════════════════════════ */

/**
 * La data come si legge in una frase: «19 agosto 2026».
 *
 * Per esteso e non gg/mm/aaaa: quella regola vale per i dati incolonnati,
 * dove serve una forma compatta e confrontabile, non per la prosa.
 *
 * IL FUSO È DICHIARATO e non è pedanteria. Il server gira su UTC; una
 * scadenza a mezzanotte e mezza italiana è ancora il giorno prima in UTC, e
 * l'email annuncerebbe una data sbagliata di un giorno. Il prodotto è
 * italiano, gli utenti sono in Italia, e la data che conta è la loro.
 */
const formatoData = new Intl.DateTimeFormat("it-IT", {
  day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome",
});
export const dataPerEsteso = (ms) => formatoData.format(new Date(ms));

/* Le frasi che l'app dice già nella schermata di blocco, riusate quasi alla
   lettera: «Il periodo di prova è terminato» (il titolo), «I tuoi dati sono
   rimasti tutti dove li hai lasciati», «I tuoi dati sono tuoi», e l'elenco di
   cosa contiene l'esportazione. Se l'email suonasse diversa da quello che uno
   legge entrando, sembrerebbero due prodotti.
   Unica differenza voluta: dove la schermata dice «Puoi scaricarli ADESSO»,
   qui si dice «quando vuoi» — per la regola in cima a questo file. */
const COSA_CONTIENE =
  "L'esportazione contiene tutte le ore, i dipendenti, le commesse e i materiali, " +
  "più l'elenco dei documenti archiviati, ma non i PDF veri, che restano " +
  "nell'archivio dell'applicazione.";

const CHIUSURA_TERZA = "Questo è l'ultimo dei tre avvisi sulla scadenza: non ne riceverai altri.";

function testoSette(data) {
  return {
    oggetto: `Il tuo periodo di prova finisce il ${data}`,
    paragrafi: [
      `Il periodo di prova di Commexa finisce il ${data}.`,
      "Da quella data l'accesso ai dati si blocca. I tuoi dati restano tutti dove li hai lasciati: bloccare l'accesso non cancella niente.",
      `I tuoi dati sono tuoi. Puoi scaricarli quando vuoi, anche senza abbonarti — prima o dopo la scadenza, non cambia. ${COSA_CONTIENE}`,
      "Se vuoi continuare, l'abbonamento si attiva entrando nell'app.",
    ],
    coda: null,
  };
}

function testoUltimo(data) {
  /* Corta apposta: chi la riceve ha letto la prima sette giorni fa e non ha
     bisogno che gli si ripeta l'elenco. Aggiunge la sola cosa che la prima non
     insisteva — che scaricare si può anche DOPO — ed è il ponte verso la
     terza, per chi la terza la riceverà. */
  return {
    oggetto: `Ultimo giorno di prova: ${data}`,
    paragrafi: [
      `Il periodo di prova di Commexa finisce il ${data}.`,
      "Dopo, per rientrare nei dati serve l'abbonamento. I dati però restano dove sono, e puoi scaricarli anche senza abbonarti: prima o dopo la scadenza.",
    ],
    coda: null,
  };
}

function testoScaduta(data) {
  return {
    oggetto: `Il periodo di prova è terminato il ${data}`,
    paragrafi: [
      `Il periodo di prova di Commexa è terminato il ${data}.`,
      "L'accesso ai dati è bloccato, ma i tuoi dati sono rimasti tutti dove li hai lasciati. Bloccare l'accesso non cancella niente.",
      "I tuoi dati sono tuoi. Puoi scaricarli anche senza abbonarti: entra con le solite credenziali e nella schermata che si apre trovi «Scarica tutto in Excel» e «Backup completo (JSON)». " + COSA_CONTIENE,
      "Se invece vuoi riprendere da dove avevi lasciato, dalla stessa schermata puoi attivare l'abbonamento.",
    ],
    coda: CHIUSURA_TERZA,
  };
}

const TESTI = { [SETTE]: testoSette, [ULTIMO]: testoUltimo, [SCADUTA]: testoScaduta };

/**
 * QUALI DEI TRE SI ACCORPANO NELLA POSTA, E QUALE DEVE STARE DA SOLO.
 *
 * Il primo e il terzo raccontano la stessa storia a distanza di giorni —
 * «finisce il 19 agosto» e «è terminato il 19 agosto» — e stanno bene uno sotto
 * l'altro: chi apre il terzo si ritrova il primo lì sopra senza cercarlo.
 *
 * IL SECONDO NO. È l'unico dei tre che deve farsi notare: arriva l'ultimo
 * giorno utile, quando leggere la data serve ancora a qualcosa. Infilato in
 * coda a una conversazione già letta ne prenderebbe la riga — nella lista della
 * posta si leggerebbe l'oggetto del PRIMO con accanto un «(2)» — e verrebbe
 * aperto per ultimo, o per niente. Da solo si presenta col suo oggetto,
 * «Ultimo giorno di prova: 19 agosto 2026», che si capisce senza aprire niente.
 *
 * COME, IN CONCRETO. Non si tocca il Message-ID: lo scrive chi spedisce e i
 * servizi di invio lo riscrivono a piacere, quindi appenderci sopra una
 * decisione sarebbe costruire su terra altrui. Si usa `References`, che i
 * client leggono per decidere cosa sta con cosa: due messaggi che lo portano
 * uguale finiscono nella stessa conversazione ANCHE SE il messaggio a cui punta
 * non esiste in quella casella — ed è il caso, perché questa radice non è mai
 * stata spedita a nessuno. Non è un messaggio: è un nome, condiviso dai due che
 * devono stare insieme.
 *
 * LA RADICE PORTA LA SCADENZA, NON L'AZIENDA: identifica QUESTA prova. Chi ne
 * cominciasse una seconda fra un anno aprirebbe una conversazione nuova, invece
 * di vedersela appendere sotto quella dell'anno prima.
 *
 * Detto onestamente: l'accorpamento non è comandabile fino in fondo. Gmail
 * guarda anche l'oggetto e applica regole sue che nessuno controlla da qui. Per
 * questo la separazione del secondo è scritta DUE volte — negli header, e in un
 * oggetto che non somiglia a nessuno degli altri due — e una prova pretende
 * tutte e due. Se una delle due strade non regge, l'altra tiene.
 */
const ACCORPATI = new Set([SETTE, SCADUTA]);

export const chiaveConversazione = (tipo, fineProva) =>
  ACCORPATI.has(tipo) ? `prova-${fineProva}` : null;

/**
 * Il messaggio pronto: oggetto, testo semplice, HTML e la conversazione in cui
 * va messo (`null` per il secondo, che sta da solo — vedi qui sopra).
 *
 * L'ORDINE DEI PARAGRAFI NON È CASUALE: prima i dati, poi l'abbonamento. È la
 * stessa scelta che la schermata di blocco fa già mettendo l'esportazione
 * SOPRA il listino — «non è un ripensamento, è un diritto, e nasconderlo in
 * fondo a una pagina che vende sarebbe un modo elegante di non darlo».
 * Invertirlo qui direbbe il contrario di quello che si vede entrando.
 */
export function componiAvviso(tipo, fineProva, link) {
  const costruisci = TESTI[tipo];
  if (!costruisci) return null;
  const { oggetto, paragrafi, coda } = costruisci(dataPerEsteso(fineProva));

  const testo = [...paragrafi, link, coda].filter(Boolean).join("\n\n");
  const html = `
      <div style="font-family:Arial,sans-serif;color:#22262E;max-width:480px;margin:0 auto;">
        ${paragrafi.map((p) => `<p style="font-size:16px;">${p}</p>`).join("\n        ")}
        <p style="margin:24px 0;">
          <!-- Bronzo #8A6D4B: lo stesso del marchio e della email di reset. -->
          <a href="${link}" style="background:#8A6D4B;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
            Apri Commexa
          </a>
        </p>
        ${coda ? `<p style="font-size:13px;color:#7A7F87;">${coda}</p>` : ""}
      </div>
    `;
  return { oggetto, testo, html, conversazione: chiaveConversazione(tipo, fineProva) };
}
