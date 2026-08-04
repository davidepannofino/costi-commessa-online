/**
 * ABBINAMENTO AUTOMATICO FRA LE RIGHE DI UNA FATTURA E I DDT ARCHIVIATI.
 *
 * A cosa serve. Una fattura cita i numeri dei DDT con cui la merce è arrivata.
 * Se quel DDT è già stato archiviato su una commessa, la commessa la sappiamo
 * già: chiederla di nuovo a mano è far ribattere all'utente un dato che il
 * software ha sotto gli occhi.
 *
 * LA REGOLA CHE COMANDA SU TUTTO IL RESTO: qui si PROPONE, non si decide.
 * Questo modulo non scrive niente e non importa niente. Restituisce un
 * giudizio — "forte", "debole" o nessun abbinamento — e sta all'utente
 * confermare. Non esiste percorso per cui un costo entri nei conti passando da
 * qui: ci si arriva solo dal bottone di conferma dell'importazione.
 *
 * IL RISCHIO DA CUI DIFENDERSI. I numeri di DDT NON sono unici: due fornitori
 * diversi hanno entrambi un DDT numero 4711, e sono documenti che non c'entrano
 * niente l'uno con l'altro. Abbinare sul solo numero significa, prima o poi,
 * mettere i materiali del ferramenta sulla commessa a cui era destinato il
 * cemento — e farlo in silenzio, che è la parte peggiore. Perciò:
 *
 *   FORTE  = numero uguale + fornitore compatibile + data vicina.
 *            Solo questo pre-seleziona la commessa.
 *   DEBOLE = il numero torna, ma qualcosa non conferma (fornitore diverso o
 *            mancante, data lontana o mancante, più DDT con lo stesso numero).
 *            Si mostra il candidato, non si assegna niente.
 *   niente = si assegna a mano, esattamente come si faceva prima.
 *
 * E QUANDO NESSUN CANDIDATO È MIGLIORE DEGLI ALTRI non si nomina nessuna
 * commessa. Un debole che dice "forse P13" quando P13 e P27 se lo contendono
 * alla pari non è una proposta: è un sorteggio scritto in giallo. Peggio, il
 * sorteggio lo vinceva chi usciva per primo dal database, quindi la stessa
 * fattura poteva proporre due commesse diverse a due caricamenti di distanza.
 * In quel caso l'esito dice QUANTI sono e lascia la scelta, senza fare nomi.
 * Se invece i candidati appaiati indicano tutti la stessa commessa la si
 * propone: non c'è niente fra cui scegliere.
 *
 * Tutto quello che c'è in questo file è una funzione pura: entrano dati, esce
 * un giudizio. Nessuna query, nessuna data di oggi, nessun caso al di fuori di
 * quelli scritti — così si può collaudare per intero senza database.
 */

/**
 * Quanti giorni di distanza fra la data del DDT sulla fattura e quella
 * scritta in archivio si accettano ancora come "lo stesso documento".
 *
 * Sono lo stesso foglio di carta, quindi in teoria la data è identica. Cinque
 * giorni assorbono l'errore di trascrizione e il caso di chi registra il giorno
 * in cui la merce è arrivata invece di quello stampato sul DDT, restando dentro
 * la settimana: non arrivano mai a pescare il DDT omonimo del mese dopo.
 */
export const GIORNI_VICINI = 5;

/** Quanto deve essere lungo un nome di fornitore perché il confronto
 *  "uno contiene l'altro" sia una somiglianza e non una coincidenza. */
const MIN_FORNITORE = 4;

/**
 * La distanza che vale per "data non confrontabile", quando manca da una delle
 * due parti. Serve un numero FINITO e non un Infinity: le distanze si
 * confrontano sottraendole, e `Infinity - Infinity` non è un numero — due
 * candidati entrambi senza data risulterebbero incomparabili invece che pari,
 * ed è proprio il pareggio che qui va riconosciuto.
 */
const LONTANISSIMO = Number.MAX_SAFE_INTEGER;

/**
 * Le paroline che si scrivono DAVANTI a un numero di documento e che non fanno
 * parte del numero. Sulla fattura c'è "4711", sul foglio archiviato a mano c'è
 * "DDT n. 4711": è lo stesso documento, e non deve sfuggire per questo.
 * Si scartano solo quando sono una parola intera: "A4711" resta "A4711".
 */
const PAROLE_DI_TROPPO = new Set(["DDT", "BOLLA", "N", "NR", "NUM", "NUMERO", "DOC", "DOCUMENTO"]);

/**
 * Numero di DDT confrontabile: maiuscolo, via la punteggiatura, via le parole
 * di troppo. "n. 4711/A", "DDT 4711-A" e "4711 a" diventano tutti "4711A".
 * Serve perché lo stesso numero viene scritto in dieci modi diversi fra il
 * tracciato XML del fornitore e la mano di chi archivia.
 */
export function normalizzaNumero(grezzo) {
  return String(grezzo ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((pezzo) => pezzo && !PAROLE_DI_TROPPO.has(pezzo))
    .join("");
}

/** Le parole che in un nome di azienda non distinguono nulla: sono la forma
 *  giuridica, non il fornitore. Vanno tolte prima di confrontare. */
const FORME_SOCIETARIE = /\b(s\s*r\s*l|srls|s\s*p\s*a|s\s*n\s*c|s\s*a\s*s|sc|scarl|soc|societa|ss|e|c|impresa|ditta|f\s*lli|fratelli)\b/g;

/**
 * Nome di fornitore confrontabile: minuscolo, accenti tolti, forme societarie
 * via, punteggiatura via, spazi normalizzati.
 * "EPIÙ MATERIALI EDILI S.R.L." e "Epiu materiali edili" arrivano entrambi a
 * "epiu materiali edili".
 */
export function normalizzaFornitore(grezzo) {
  return String(grezzo ?? "")
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")  // accenti: EPIU ed EPIÙ devono combaciare
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")                        // punteggiatura e simboli
    .replace(FORME_SOCIETARIE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Due nomi di fornitore indicano la stessa azienda?
 *
 * Restituisce "uguale", "diverso" oppure "ignoto" quando uno dei due manca:
 * la distinzione conta, perché un fornitore che manca è un dato non
 * verificato, mentre un fornitore diverso è un indizio ATTIVO che il DDT non
 * è quello (stesso numero, altra azienda: è proprio il caso da cui guardarsi).
 */
export function confrontaFornitori(unoGrezzo, altroGrezzo) {
  const uno = normalizzaFornitore(unoGrezzo);
  const altro = normalizzaFornitore(altroGrezzo);
  if (!uno || !altro) return "ignoto";
  if (uno === altro) return "uguale";
  // A mano si scrive la versione corta ("Epiù Materiali"), sulla fattura c'è
  // la ragione sociale intera: uno dentro l'altro è la stessa azienda.
  const lungo = uno.length >= altro.length ? uno : altro;
  const corto = uno.length >= altro.length ? altro : uno;
  if (corto.length >= MIN_FORNITORE && lungo.includes(corto)) return "uguale";
  return "diverso";
}

/** Giorni fra due date ISO 'AAAA-MM-GG', in valore assoluto. null se una
 *  delle due manca o non è una data leggibile. */
export function giorniFra(unaISO, altraISO) {
  const a = String(unaISO ?? "").slice(0, 10);
  const b = String(altraISO ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.abs(Math.round((ta - tb) / 86400000));
}

/**
 * Giudica un singolo DDT archiviato contro il DDT citato dalla fattura, dato
 * che il numero già combacia. Restituisce { forza, motivo }.
 *
 * "motivo" è la frase che l'utente leggerà: deve dirgli COSA non torna, perché
 * è quello che gli permette di decidere in due secondi invece di aprire
 * l'archivio.
 */
function giudica({ fornitoreFattura, dataFattura, archiviato }) {
  const fornitori = confrontaFornitori(fornitoreFattura, archiviato.fornitore);
  const giorni = giorniFra(dataFattura, archiviato.ddtData);

  // Fornitore diverso: stesso numero, altra azienda. È il caso più pericoloso
  // di tutti e non deve mai diventare forte, nemmeno con la data perfetta.
  if (fornitori === "diverso") {
    return {
      forza: "debole",
      motivo: `il fornitore non combacia: in archivio questo DDT è di ${archiviato.fornitore}`,
    };
  }
  if (fornitori === "ignoto") {
    return {
      forza: "debole",
      motivo: archiviato.fornitore
        ? "la fattura non dice il fornitore, quindi non posso verificarlo"
        : "il DDT in archivio non ha il fornitore, quindi non posso verificarlo",
    };
  }

  // Fornitore uguale: decide la data.
  if (giorni === null) {
    return {
      forza: "debole",
      motivo: archiviato.ddtData
        ? "la fattura non dice la data del DDT, quindi non posso verificarla"
        : "il DDT in archivio non ha la data, quindi non posso verificarla",
    };
  }
  if (giorni > GIORNI_VICINI) {
    return {
      forza: "debole",
      motivo: `le date sono distanti ${giorni} giorni: potrebbe essere un altro DDT con lo stesso numero`,
    };
  }

  return {
    forza: "forte",
    motivo: giorni === 0
      ? "numero, fornitore e data combaciano"
      : `numero e fornitore combaciano, date a ${giorni} ${giorni === 1 ? "giorno" : "giorni"} di distanza`,
  };
}

/**
 * Il cuore: per UN numero di DDT citato dalla fattura, sceglie l'abbinamento.
 *
 * @param riferimento  { ddtNumero, ddtData, fornitore } come li dice la fattura.
 * @param archiviati   i DDT dell'azienda (SOLO della sua: il filtro per azienda
 *                     sta nella query, e qui non arriva altro), ciascuno
 *                     { id, commessaId, commessaCodice, commessaDescrizione,
 *                       nomeFile, ddtNumero, ddtData, fornitore }.
 * @returns null se non c'è niente da proporre, altrimenti
 *          { forza: 'forte'|'debole', commessaId, commessaCodice,
 *            commessaDescrizione, motivo, allegato }.
 */
export function abbinaUnDDT(riferimento, archiviati) {
  const numero = normalizzaNumero(riferimento?.ddtNumero);
  if (!numero) return null;   // la fattura non cita nessun DDT: niente da cercare

  // Candidati: stesso numero. Un DDT archiviato SENZA numero non è candidato a
  // niente — il campo è facoltativo, e vuoto significa "non lo so", non "sì".
  const candidati = archiviati.filter((a) => normalizzaNumero(a.ddtNumero) === numero);
  if (candidati.length === 0) return null;

  const giudicati = candidati.map((a) => ({ archiviato: a, ...giudica({
    fornitoreFattura: riferimento.fornitore,
    dataFattura: riferimento.ddtData,
    archiviato: a,
  }) }));

  const forti = giudicati.filter((g) => g.forza === "forte");
  const commesseForti = new Set(forti.map((g) => g.archiviato.commessaId));

  // Un solo esito forte, o più esiti forti che indicano tutti la STESSA
  // commessa (lo stesso DDT archiviato due volte, o due pagine dello stesso
  // documento): si può pre-selezionare.
  if (forti.length > 0 && commesseForti.size === 1) {
    return risultato(forti[0], "forte");
  }

  // Più esiti forti su commesse DIVERSE: sono forti allo stesso modo, quindi
  // non c'è nemmeno un criterio per metterli in fila. Si dice quanti sono.
  if (forti.length > 0) {
    return ambiguo(forti.length);
  }

  // Nessun esito forte: si guarda il candidato debole più promettente. Prima
  // quelli con il fornitore che torna, poi i più vicini di data: è l'ordine in
  // cui un occhio umano li guarderebbe.
  const conChiave = giudicati.map((g) => ({ ...g, chiave: chiaveOrdine(riferimento, g.archiviato) }));
  const ordinati = [...conChiave].sort((x, y) => (x.chiave[0] - y.chiave[0]) || (x.chiave[1] - y.chiave[1]));

  /* I candidati che ARRIVANO PARI col primo: né il fornitore né la data li
     separano. Se puntano a commesse diverse, qualunque nome si faccia è quello
     che è uscito per primo dal database, non quello più probabile. */
  const [pesoMigliore, giorniMigliori] = ordinati[0].chiave;
  const aPari = ordinati.filter((g) => g.chiave[0] === pesoMigliore && g.chiave[1] === giorniMigliori);
  if (new Set(aPari.map((g) => g.archiviato.commessaId)).size > 1) {
    return ambiguo(giudicati.length);
  }

  const scelto = ordinati[0];
  const extra = giudicati.length > 1 ? ` · in archivio ci sono ${giudicati.length} DDT con questo numero` : "";
  return risultato(scelto, "debole", scelto.motivo + extra);
}

/**
 * Con che criterio si mettono in fila i candidati deboli: prima il fornitore
 * che torna, poi la data più vicina. Torna una coppia [peso, giorni] fatta
 * apposta per essere confrontata E per riconoscere i pari merito — che è la
 * parte che conta, perché su un pareggio non si sceglie.
 */
function chiaveOrdine(riferimento, archiviato) {
  const peso = confrontaFornitori(riferimento.fornitore, archiviato.fornitore) === "uguale" ? 0 : 1;
  return [peso, giorniFra(riferimento.ddtData, archiviato.ddtData) ?? LONTANISSIMO];
}

/**
 * L'esito quando più DDT si contendono lo stesso numero e niente li separa.
 *
 * Non nomina nessuna commessa e non allega nessun documento, di proposito: la
 * schermata deve poter dire "sono in due, decidi tu" senza avere sottomano un
 * nome da mettere in grassetto. Resta "debole" perché resta un abbinamento da
 * confermare a mano — quello che cambia è che non finge di sapere quale.
 */
function ambiguo(quanti) {
  return {
    forza: "debole",
    commessaId: null,
    commessaCodice: "",
    commessaDescrizione: "",
    motivo: `ci sono ${quanti} DDT archiviati con questo numero, su commesse diverse: scegli tu`,
    allegato: null,
  };
}

/** Confeziona la risposta nella forma che il frontend si aspetta. */
function risultato(giudicato, forza, motivo) {
  const a = giudicato.archiviato;
  return {
    forza,
    commessaId: a.commessaId,
    commessaCodice: a.commessaCodice,
    commessaDescrizione: a.commessaDescrizione,
    motivo: motivo ?? giudicato.motivo,
    allegato: { id: a.id, nomeFile: a.nomeFile, ddtNumero: a.ddtNumero, ddtData: a.ddtData, fornitore: a.fornitore },
  };
}

/**
 * Abbina tutti i DDT citati da una fattura in un colpo solo.
 *
 * @param riferimenti  [{ ddtNumero, ddtData }] presi dai gruppi della fattura.
 * @param fornitore    il fornitore della fattura: è lo stesso per tutte le sue
 *                     righe, quindi si passa una volta.
 * @param archiviati   i DDT dell'azienda, già filtrati dalla query.
 * @returns [{ ddtNumero, forza, commessaId, ... }] — solo i numeri per cui
 *          c'è qualcosa da proporre. Gli altri non compaiono: il frontend li
 *          tratta come "da assegnare", che è il comportamento di sempre.
 */
export function abbinaDDT({ riferimenti, fornitore, archiviati }) {
  const visti = new Set();
  const esiti = [];
  for (const rif of riferimenti || []) {
    const numero = normalizzaNumero(rif?.ddtNumero);
    if (!numero || visti.has(numero)) continue;
    visti.add(numero);

    const esito = abbinaUnDDT({ ddtNumero: rif.ddtNumero, ddtData: rif.ddtData, fornitore }, archiviati || []);
    if (esito) esiti.push({ ddtNumero: rif.ddtNumero, ...esito });
  }
  return esiti;
}
