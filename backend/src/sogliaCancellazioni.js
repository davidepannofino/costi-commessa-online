/**
 * QUANTE RIGHE PUÒ CANCELLARE UN SALVATAGGIO SENZA CHE QUALCUNO L'ABBIA CHIESTO.
 *
 * `PUT /api/stato` riscrive l'elenco delle registrazioni con quello che manda il
 * browser: le righe che il browser non ha più spariscono. Va bene finché il
 * browser sa quello che dice. Ma una lettura andata a metà, una scheda rimasta
 * aperta da ieri, un errore di rete al caricamento — e il salvataggio
 * successivo cancella il lavoro vero. Il 5 agosto 2026 sono state battute a
 * mano 319 righe in una giornata: una scheda aperta prima di quel giorno, e
 * salvata dopo, le porterebbe via tutte.
 *
 * LA DIFESA STA QUI E NON NEL BROWSER, perché è il browser la cosa di cui non
 * ci fidiamo. Il server è quello che possiede i dati, ed è l'ultimo cancello
 * prima che spariscano.
 *
 * COSA NON SOSTITUISCE. Il salvataggio gira già dentro una transazione sola
 * (BEGIN … COMMIT su una connessione sola, verificato: nessuna query esce dal
 * client): una connessione che cade a metà non lascia il database mezzo
 * cancellato, Postgres annulla tutto. Quella garanzia riguarda l'INTEGRITÀ di
 * un salvataggio; questa riguarda la sua PLAUSIBILITÀ. Una scheda vecchia
 * produce una transazione perfettamente riuscita che distrugge il lavoro.
 *
 * COME SI DISTINGUE UN INCIDENTE DA UNA VOLONTÀ. Non si indovina: chi cancella
 * apposta lo DICHIARA, mandando quante righe si aspetta di perdere. Il
 * salvataggio automatico non manda mai quel numero, in nessun caso — ed è
 * quella la proprietà che conta: qualunque cosa abbia in pancia il browser,
 * l'autosalvataggio non può superare la soglia.
 */

/**
 * Dieci righe.
 *
 * Con l'inserimento a mano si cancella una riga alla volta: dieci in un solo
 * salvataggio non è un modo umano di lavorare, è il segno che lo stato del
 * browser non corrisponde più alla realtà. Le quattro operazioni che cancellano
 * davvero in blocco — svuota tutto, ripristino di un backup, import con
 * «sostituisci», eliminazione di una commessa — sono tutte confermate
 * dall'utente e passano dal canale esplicito.
 */
export const SOGLIA_ASSOLUTA = 10;

/**
 * Un quarto delle righe esistenti, ma solo da 20 righe in su.
 *
 * Serve alle aziende piccole, dove dieci righe sono già metà del lavoro. Il
 * pavimento c'è perché sotto le 20 righe un quarto fa meno di 5, e cancellarne
 * 3 su 8 è normale amministrazione: un rifiuto che arriva quando non serve
 * insegna a ignorare i rifiuti, e allora non protegge più niente.
 *
 * È una regola di banda stretta, ed è giusto saperlo: sopra le 40 righe un
 * quarto supera le 10 e quindi non morde mai, perché la soglia assoluta è già
 * più stretta. Vale fra 20 e 40 righe. Il cuore del meccanismo restano le 10.
 */
export const PAVIMENTO_QUOTA = 20;
export const DIVISORE_QUOTA = 4;

/**
 * @param esistenti   righe che l'azienda ha adesso nel database
 * @param cancellate  righe che sparirebbero salvando
 * @param dichiarate  quante l'utente ha detto di volerne perdere (0 se non
 *                    l'ha detto: è il caso del salvataggio automatico)
 * @returns { rifiuta, motivo, soglia }
 */
export function troppeCancellazioni({ esistenti, cancellate, dichiarate = 0 }) {
  const n = Number(cancellate) || 0;
  const tot = Number(esistenti) || 0;
  const chieste = Number(dichiarate) || 0;

  if (n === 0) return { rifiuta: false, motivo: "non cancella niente", soglia: null };

  /* Dichiarazione esplicita: si esegue fino a quanto è stato chiesto, e non
     una riga di più. È un numero e non un "sì" apposta — chi cancella apposta
     sa quante righe sta togliendo, uno stato vuoto per sbaglio non lo sa. */
  if (n <= chieste) {
    return { rifiuta: false, motivo: `dichiarate ${chieste} cancellazioni`, soglia: null };
  }

  if (n > SOGLIA_ASSOLUTA) {
    return {
      rifiuta: true,
      soglia: SOGLIA_ASSOLUTA,
      motivo: `cancellerebbe ${n} registrazioni: più delle ${SOGLIA_ASSOLUTA} ammesse senza una conferma`,
    };
  }

  if (tot >= PAVIMENTO_QUOTA && n > tot / DIVISORE_QUOTA) {
    return {
      rifiuta: true,
      soglia: Math.floor(tot / DIVISORE_QUOTA),
      motivo: `cancellerebbe ${n} registrazioni su ${tot}: più di un quarto, senza una conferma`,
    };
  }

  return { rifiuta: false, motivo: `${n} cancellazioni, sotto la soglia`, soglia: null };
}
