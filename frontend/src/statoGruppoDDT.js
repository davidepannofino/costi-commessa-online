/**
 * LO STATO DI UN GRUPPO-DDT nella schermata di importazione fattura.
 *
 * Decide cosa dice l'etichetta in testa a un gruppo di righe: se la commessa
 * l'ha proposta il software, se c'è un candidato da confermare, se tocca
 * ancora all'utente. Sta in un file suo, senza pezzi di interfaccia dentro,
 * per la stessa ragione di abbinamentoDDT.js nel backend: è una decisione che
 * va messa alla prova, e una funzione pura si prova senza browser.
 *
 * La regola che tiene onesta l'interfaccia: appena l'utente mette mano a un
 * menù, il gruppo NON è più "abbinato in automatico". Un'etichetta che dice
 * "l'ho scelto io" quando la scelta è stata cambiata a mano sarebbe una bugia,
 * e su una schermata di conferma le bugie costano care.
 *
 * Gli stati possibili:
 *   auto      il software ha pre-selezionato una commessa (match forte) e
 *             l'utente non l'ha toccata. Verde: da controllare.
 *   possibile c'è un candidato, ma non abbastanza per assegnarlo. Giallo.
 *   manuale   l'ha assegnato l'utente.
 *   misto     righe dello stesso DDT su commesse diverse (fatto a mano, riga
 *             per riga): non si riassume in una commessa sola.
 *   vuoto     niente da dire: si assegna a mano, come si è sempre fatto.
 */

/** Voce del menù commessa quando si decide di NON importare una riga. */
export const NON_IMPORTARE = "";

/**
 * @param righeGruppo  le righe di questo gruppo, ognuna con { commessaId,
 *                     assegnazione: 'auto'|'manuale'|'nessuna' }.
 * @param abbinamento  la proposta del backend per questo DDT, o null.
 * @returns { tipo, commessaGruppo } — commessaGruppo è "" quando non c'è una
 *          commessa unica per tutto il gruppo.
 */
export function statoGruppo(righeGruppo, abbinamento) {
  const commesse = new Set(righeGruppo.map((r) => r.commessaId));
  const commessaGruppo = commesse.size === 1 ? [...commesse][0] : "";

  if (commesse.size > 1) return { tipo: "misto", commessaGruppo: "" };
  if (commessaGruppo) {
    // Pre-assegnato dal software E mai toccato: solo così è "auto".
    const intatto = righeGruppo.every((r) => r.assegnazione === "auto");
    return { tipo: intatto && abbinamento?.forza === "forte" ? "auto" : "manuale", commessaGruppo };
  }
  return { tipo: abbinamento ? "possibile" : "vuoto", commessaGruppo: "" };
}

/**
 * La commessa di partenza di una riga appena letta dalla fattura.
 * Solo un abbinamento FORTE pre-seleziona qualcosa: sul debole il software non
 * sa, e mettere una commessa senza sapere — anche potendola cambiare — vuol
 * dire far passare per verificato quello che non lo è.
 */
export function assegnazioneIniziale(abbinamento) {
  return abbinamento?.forza === "forte"
    ? { commessaId: abbinamento.commessaId, assegnazione: "auto" }
    : { commessaId: NON_IMPORTARE, assegnazione: "nessuna" };
}
