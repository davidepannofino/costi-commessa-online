/**
 * LA DECISIONE «SI PUÒ CONFERMARE?» del campo che si filtra scrivendo.
 *
 * Sta in un file suo, senza un pezzo di interfaccia dentro, per la stessa
 * ragione di statoGruppoDDT.js e abbinamentoDDT.js: è una decisione che va
 * messa alla prova, e una funzione pura si prova senza browser.
 *
 * LA REGOLA CHE COMANDA SU TUTTO IL RESTO: quando il testo scritto non
 * individua UNA voce sola, questo modulo NON sceglie. Non la prima, non la più
 * corta, non quella "più probabile". Si ferma e dice quante sono.
 *
 * Perché è una regola di sicurezza e non una raffinatezza. Il campo serve a
 * scegliere il dipendente e la commessa di una registrazione di ore. Un
 * dipendente scelto per conto suo è un costo attribuito alla persona
 * sbagliata: non lo segnala nessuno, non lo vede nessuno, e a fine mese i
 * conti tornano lo stesso — sbagliati. È il tipo di errore peggiore che questo
 * prodotto possa fare, perché è silenzioso e sembra giusto.
 *
 * Percio' si conferma SOLO in tre casi, tutti e tre non ambigui:
 *   1. l'utente ha scelto con le frecce  — comanda lui, sempre
 *   2. il testo corrisponde a UNA voce sola
 *   3. il testo è identico a quello che era già scelto — non è una ricerca,
 *      è "non ho toccato niente"
 * In ogni altro caso l'esito è "ambiguo" o "nessuna", e chi chiama deve
 * fermare il Tab e l'Invio invece di lasciarli passare.
 */

/**
 * Testo confrontabile: minuscolo, accenti tolti, punteggiatura e spazi
 * normalizzati. Serve perché nessuno scrive "Donà" con l'accento giusto
 * mentre batte trecento righe, e "PN02 — TARCENTO" ha dentro un trattino
 * lungo che sulla tastiera non c'è.
 */
export function normalizzaPerCerca(grezzo) {
  return String(grezzo ?? "")
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Le voci che corrispondono a quello che è stato scritto.
 *
 * Si cerca per SOTTOSTRINGA e non per inizio: è tutto il punto del campo.
 * Il `<select>` nativo trovava "PN02 — TARCENTO" solo battendo "PN02", perché
 * confronta dall'inizio dell'etichetta; qui scrivere "tarcento" lo trova, che
 * è il nome con cui il cantiere lo si chiama davvero.
 *
 * Le parole valgono tutte e in qualunque ordine: "tarcento pn02" e
 * "pn02 tarcento" trovano la stessa cosa. Testo vuoto = tutte le voci.
 */
export function filtra(voci, testo) {
  const parole = normalizzaPerCerca(testo).split(" ").filter(Boolean);
  const elenco = Array.isArray(voci) ? voci : [];
  if (parole.length === 0) return [...elenco];
  return elenco.filter((v) => {
    const dove = normalizzaPerCerca(v?.cerca ?? v?.etichetta);
    return parole.every((p) => dove.includes(p));
  });
}

export const CONFERMA = "conferma";
export const AMBIGUO = "ambiguo";
export const NESSUNA = "nessuna";
export const VUOTO = "vuoto";

/**
 * Si può confermare, e con che voce?
 *
 * @param testo            quello che c'è scritto nel campo.
 * @param voci             le voci GIÀ filtrate da filtra().
 * @param evidenziato      l'indice scelto con le frecce dentro `voci`, oppure
 *                         null/undefined se l'utente non ha scelto niente.
 * @param sceltaCorrente   la voce già confermata prima, se c'è.
 *
 * @returns { esito: 'conferma', voce, perche }  si può, ed ecco quale
 *          { esito: 'ambiguo', quante }         NON si può: sono tante
 *          { esito: 'nessuna' }                 NON si può: non c'è niente
 *          { esito: 'vuoto' }                   niente scritto, niente scelto
 */
export function decidiConferma({ testo, voci, evidenziato, sceltaCorrente } = {}) {
  const elenco = Array.isArray(voci) ? voci : [];
  const scritto = String(testo ?? "").trim();

  /* Campo vuoto. NON è un'ambiguità: è un'assenza, e un'assenza non fa danno
     perché il modulo si rifiuta di registrare senza dipendente e senza
     commessa, dicendo quale manca. Bloccare qui il Tab impedirebbe soltanto
     di tornare indietro a sistemare un altro campo. */
  if (!scritto) return { esito: VUOTO };

  /* L'utente ha evidenziato una voce con le frecce: ha scelto lui, e la sua
     scelta vale anche quando il testo da solo sarebbe ambiguo — anzi, e'
     proprio per quel caso che le frecce esistono. */
  if (Number.isInteger(evidenziato) && evidenziato >= 0) {
    const voce = elenco[evidenziato];
    return voce
      ? { esito: CONFERMA, voce, perche: "scelta con le frecce" }
      : { esito: NESSUNA };
  }

  /* Il testo è esattamente l'etichetta di quello che era già scelto: non è una
     ricerca nuova, è "sono passato di qui senza toccare niente". Si tiene
     quella scelta senza rimetterla in discussione — e senza il rischio che una
     voce che per caso CONTIENE questa etichetta la faccia sembrare ambigua. */
  if (sceltaCorrente && normalizzaPerCerca(scritto) === normalizzaPerCerca(sceltaCorrente.etichetta)) {
    return { esito: CONFERMA, voce: sceltaCorrente, perche: "invariato" };
  }

  if (elenco.length === 1) return { esito: CONFERMA, voce: elenco[0], perche: "una sola corrispondenza" };
  if (elenco.length === 0) return { esito: NESSUNA };

  /* Tante. Qui si esce senza voce, di proposito: chi chiama deve fermare il
     Tab e mostrare quante sono. Restituire "la prima" sarebbe esattamente
     l'errore silenzioso che questo file esiste per rendere impossibile. */
  return { esito: AMBIGUO, quante: elenco.length };
}

/**
 * Dove va l'evidenziazione quando si preme una freccia.
 *
 * Parte dalla PRIMA voce quando ancora non c'è niente di evidenziato: la
 * freccia giù dice "fammi vedere", e la prima è quella sotto gli occhi.
 * Non gira in tondo: arrivati in fondo si resta in fondo, così tenendo premuto
 * non si ricomincia da capo senza accorgersene.
 */
export function muoviEvidenziato(evidenziato, verso, quante) {
  if (quante <= 0) return null;
  if (!Number.isInteger(evidenziato)) return verso > 0 ? 0 : quante - 1;
  return Math.max(0, Math.min(quante - 1, evidenziato + verso));
}
