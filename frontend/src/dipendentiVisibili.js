/**
 * CHI SI VEDE DOVE.
 *
 * Un dipendente archiviato non lavora più qui: sparisce da dove si inseriscono
 * le ore. Ma le ore che ha già fatto restano, e restano un costo di commesse
 * vere — quindi non sparisce da nessun posto che CALCOLA e da nessun posto che
 * SALVA.
 *
 * La regola in una riga: **il filtro vive dove si mostra, mai dove si conta e
 * mai dove si scrive.**
 *
 * Perché è un modulo a sé e non tre `filter` sparsi in App.jsx. Il salvataggio
 * automatico riscrive l'intero stato dell'azienda a partire da quello che ha
 * il browser: se una lista filtrata finisse per sbaglio dentro il salvataggio,
 * gli archiviati verrebbero cancellati dal database per davvero, con le loro
 * ore. Un filtro sbagliato qui non è un difetto grafico, è perdita di dati.
 * Tenerlo in un posto solo, con un nome che dice a cosa serve, rende visibile
 * la differenza fra le due liste al momento di usarle.
 */

/** Vero se il dipendente è archiviato. Solo un `true` esplicito archivia:
 *  un backup fatto prima che questo campo esistesse non ce l'ha, e chi non ha
 *  il campo è attivo. */
export const eArchiviato = (dip) => dip?.archiviato === true;

/**
 * Gli attivi. È la lista da usare ovunque si scelga una persona per
 * ATTRIBUIRLE ore nuove, e per i contatori che rispondono a "quanti siamo".
 */
export function soloAttivi(dipendenti) {
  return (dipendenti ?? []).filter((d) => !eArchiviato(d));
}

/**
 * La lista per un campo che ha GIÀ una persona scelta — l'editor di una
 * registrazione esistente.
 *
 * QUESTA FUNZIONE ESISTE PER UN SOLO MOTIVO, ed è il punto più pericoloso di
 * tutta l'archiviazione. Un `<select>` il cui valore non corrisponde a nessuna
 * opzione non dà errore: il browser mostra la prima della lista. Aprendo una
 * riga di ore di un archiviato con la lista dei soli attivi, il campo direbbe
 * il nome di qualcun altro, e al salvataggio quelle ore passerebbero davvero a
 * quel qualcun altro. Nessun messaggio, nessun rosso, conti che tornano lo
 * stesso — sbagliati. È lo stesso errore silenzioso contro cui è scritto
 * sceltaFiltrata.js.
 *
 * Quindi: gli attivi, più la persona già scelta anche se archiviata. Non è
 * un'eccezione alla regola, è la regola stessa: quella riga di ore le
 * appartiene già, non gliela si sta attribuendo adesso.
 */
export function perModificaDi(dipendenti, idGiaScelto) {
  const attivi = soloAttivi(dipendenti);
  if (!idGiaScelto || attivi.some((d) => d.id === idGiaScelto)) return attivi;
  const scelto = (dipendenti ?? []).find((d) => d.id === idGiaScelto);
  if (!scelto) return attivi; // id che non esiste più: non c'è niente da tenere dentro
  /* In coda e non in mezzo agli attivi: chi guarda deve accorgersi che quella
     persona non è più in servizio, non trovarsela mischiata agli altri. */
  return [...attivi, scelto];
}

/** Quello che si vede nell'elenco Dipendenti: gli attivi, o tutti. */
export function perElenco(dipendenti, mostraArchiviati) {
  return mostraArchiviati ? (dipendenti ?? []) : soloAttivi(dipendenti);
}

/**
 * Quante ore ha registrate questa persona. Zero significa che cancellarla non
 * porta via niente, ed è l'unico caso in cui la cancellazione resta possibile.
 *
 * Si conta sulle registrazioni che il browser ha in memoria, cioè le stesse
 * che stanno per essere risalvate: è esattamente ciò che si perderebbe.
 */
export function oreRegistrateDi(registrazioni, dipendenteId) {
  return (registrazioni ?? []).filter((r) => r.dipendenteId === dipendenteId).length;
}

/**
 * Cosa può fare il pulsante su questa persona: "elimina" se non ha nessuna
 * ora, "archivia" se ne ha.
 *
 * La decisione sta qui e non nella schermata perché è una regola di prodotto,
 * non una scelta grafica: chi ha ore non si cancella. Chi la cambia deve
 * cambiarla in un posto solo.
 */
export function azionePerTogliere(registrazioni, dipendenteId) {
  return oreRegistrateDi(registrazioni, dipendenteId) === 0 ? "elimina" : "archivia";
}
