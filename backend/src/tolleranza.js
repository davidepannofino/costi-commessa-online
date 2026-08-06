/**
 * QUANTO SI ASPETTA CHI HA UN RINNOVO FALLITO.
 *
 * Un pagamento in sospeso non è una disdetta. Carta scaduta, plafond finito,
 * una banca lenta: Stripe riprova da sola, e nella maggioranza dei casi un
 * tentativo successivo va a buon fine. Chiudere fuori un cliente che sta
 * pagando è il modo peggiore di sbagliare.
 *
 * LA DATA NON LA INVENTIAMO NOI. Il prossimo tentativo lo dichiara Stripe su
 * ogni fattura (`next_payment_attempt`), e vale **null quando non ne farà
 * più**. La tolleranza finisce quando finisce Stripe, non un giorno a caso: se
 * il tuo account usa il programma fisso finirà dopo una settimana, se usa
 * Smart Retries dopo tre, e questo file non deve saperlo.
 *
 * PERCHÉ NON DIVENTA UN MODO PER NON PAGARE. Tre cancelli, tutti chiusi di
 * partenza e tutti da aprire esplicitamente:
 *
 *   1. si concede solo a chi RISULTAVA GIÀ ATTIVO nel nostro database prima
 *      dell'evento — cioè a chi ha pagato almeno una volta;
 *   2. si concede solo se la fattura è un RINNOVO (`subscription_cycle`), mai
 *      sulla prima fattura di un abbonamento nuovo (`subscription_create`);
 *   3. c'è comunque un tetto massimo, che nessuna data mandata da fuori può
 *      superare.
 *
 * I primi due sono lo stesso controllo visto da due lati, ed è voluto: senza
 * il primo basterebbe iscriversi con una carta che non funziona per avere tre
 * settimane gratis; senza il secondo lo stesso, per la strada della prova che
 * finisce e del primo addebito che non passa.
 *
 * E la scadenza risultante va SCRITTA sulla riga dell'azienda. Quando la data
 * passa, l'accesso si chiude senza bisogno che arrivi nessun webhook: il
 * silenzio chiude, non apre. Una tolleranza che avesse bisogno di un messaggio
 * per terminare sarebbe accesso gratuito per chiunque sappia far cadere un
 * webhook.
 */

/**
 * Quanto si aspetta OLTRE il momento in cui Stripe riproverà.
 *
 * Il tentativo non è istantaneo: l'addebito parte, la banca risponde, il
 * webhook arriva. Senza questo margine la tolleranza scadrebbe mentre il
 * pagamento che la risolverebbe è in volo, e chiuderemmo fuori qualcuno
 * nell'unico momento in cui era davvero sbagliato farlo.
 */
export const MARGINE_ORE = 48;

/**
 * Il tetto, in giorni dal PRIMO fallimento della serie.
 *
 * Non è un numero scelto da noi: è la finestra massima che Stripe stessa usa
 * per le sue ripetizioni (Smart Retries arriva fino a tre settimane). Serve
 * come rete per il caso in cui una data arrivi sbagliata o assurda — la
 * tolleranza normale finisce prima, quando Stripe smette.
 */
export const TETTO_GIORNI = 21;

const ORA = 60 * 60 * 1000;
const GIORNO = 24 * ORA;

/**
 * Fino a quando tenere aperto, e perché.
 *
 * @param eraAttivo         l'azienda risultava "attivo" PRIMA di questo evento
 * @param eRinnovo          la fattura è un rinnovo (billing_reason)
 * @param prossimoTentativo Date del prossimo tentativo Stripe, o null
 * @param primoFallimento   Date del primo fallimento della serie, o null se è
 *                          questo (serve per il tetto, che si misura da lì e
 *                          non da ogni tentativo: altrimenti ogni fallimento
 *                          allungherebbe la corda e non finirebbe mai)
 * @param adesso            Date, iniettata per poter provare i confini
 * @returns { concessa, fino, motivo }
 */
export function decidiTolleranza({ eraAttivo, eRinnovo, prossimoTentativo, primoFallimento, adesso = new Date() }) {
  const no = (motivo) => ({ concessa: false, fino: null, motivo });

  if (!eraAttivo) return no("l'azienda non risultava attiva: non ha mai completato un pagamento");
  if (!eRinnovo) return no("non è un rinnovo: su una prima fattura non c'è niente da tollerare");
  if (!(prossimoTentativo instanceof Date) || isNaN(prossimoTentativo)) {
    return no("Stripe non farà altri tentativi");
  }

  const inizio = primoFallimento instanceof Date && !isNaN(primoFallimento) ? primoFallimento : adesso;
  const dalTentativo = new Date(prossimoTentativo.getTime() + MARGINE_ORE * ORA);
  const dalTetto = new Date(inizio.getTime() + TETTO_GIORNI * GIORNO);
  const fino = dalTentativo < dalTetto ? dalTentativo : dalTetto;

  /* Una data già passata non è tolleranza: capita con un evento vecchio
     riconsegnato, o con una serie di fallimenti che ha sfondato il tetto. */
  if (fino <= adesso) return no("il tempo di tolleranza è già finito");

  return {
    concessa: true,
    fino,
    motivo: dalTentativo < dalTetto
      ? "Stripe riproverà, si aspetta il suo tentativo"
      : `raggiunto il tetto di ${TETTO_GIORNI} giorni dal primo fallimento`,
  };
}

/** Vero se la tolleranza scritta sulla riga copre ancora questo momento. */
export function tolleranzaInCorso(tolleranzaFinoAl, adesso = new Date()) {
  if (!tolleranzaFinoAl) return false;
  const d = tolleranzaFinoAl instanceof Date ? tolleranzaFinoAl : new Date(tolleranzaFinoAl);
  return !isNaN(d) && d > adesso;
}
