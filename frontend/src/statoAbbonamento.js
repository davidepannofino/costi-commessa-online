/**
 * COME SI CHIAMA, A SCHERMO, LO STATO DELL'ABBONAMENTO.
 *
 * Una mappa sola per tutta l'applicazione. Sta in un file suo, senza un pezzo
 * di interfaccia dentro, per la stessa ragione di statoGruppoDDT.js e
 * sceltaFiltrata.js: è una decisione che va messa alla prova, e una funzione
 * pura si prova senza browser.
 *
 * PERCHÉ ESISTE. L'etichetta veniva decisa in DUE posti indipendenti — la
 * barra laterale e la schermata dell'abbonamento — ognuno con la sua lista di
 * stati. Finché sono due, prima o poi divergono, e infatti sono divergute: il
 * 6 agosto 2026, sullo stesso schermo e nello stesso istante, la barra
 * scriveva «Abbonamento scaduto» sotto il nome di un'azienda mentre il
 * pannello diceva «Accesso illimitato». Era un account esente, e non era
 * scaduto niente.
 *
 * IL DIFETTO NON ERA UN REFUSO, ERA LA FORMA. La barra finiva con un ramo che
 * cattura tutto:
 *
 *     … === "attivo" ? … : … === "prova" ? … : stato ? "Abbonamento scaduto" : ""
 *
 * L'ultimo pezzo non chiede «sei scaduto?», chiede «sei qualcosa?». Scritto
 * quando gli stati erano tre, è diventato falso il giorno che ne è arrivato un
 * quarto. È la regola scritta in PRODUCT.md fra i corollari: NESSUN RIPIEGO
 * CHE AFFERMA. Se non si riconosce lo stato non si scrive niente — un'etichetta
 * assente è un buco visibile, un'etichetta sbagliata no.
 *
 * Perciò qui non c'è nessun valore predefinito e nessun `||` di comodo:
 * uno stato che non è in questa mappa esce come `null`, e chi chiama non
 * disegna niente.
 *
 * L'ICONA È UNA CHIAVE, NON UN COMPONENTE, così questo file non importa nulla
 * e resta collaudabile senza React: la traduzione da chiave a icona la fa chi
 * disegna.
 */

/**
 * Gli stati che il server può restituire. Sono quelli che calcolaStatoAccesso
 * produce in backend/src/abbonamento.js — se ne nasce un quinto, va aggiunto
 * QUI, e la prova in statoAbbonamento.test.js lo pretende.
 */
export const STATI_ABBONAMENTO = {
  esente:  { etichetta: "Accesso illimitato", tono: "euro",    icona: "illimitato" },
  attivo:  { etichetta: "Abbonamento attivo", tono: "euro",    icona: "attivo" },
  prova:   { etichetta: "Prova gratuita",     tono: "accento", icona: "prova" },
  scaduto: { etichetta: "Prova terminata",    tono: "errore",  icona: "scaduto" },
};

/**
 * Come si racconta questo stato, o `null` se non lo si riconosce.
 *
 * @param info  la risposta di /api/abbonamento/stato, o null se non è ancora
 *              arrivata.
 * @returns { stato, etichetta, tono, icona } oppure null.
 */
export function descriviAbbonamento(info) {
  const stato = info?.stato;
  if (!stato) return null;                       // non ancora caricato
  const descrizione = STATI_ABBONAMENTO[stato];
  if (!descrizione) return null;                 // stato sconosciuto: si tace
  return { stato, ...descrizione };
}
