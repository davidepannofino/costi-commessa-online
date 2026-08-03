/**
 * Lettura della casella di testo che identifica un DDT dentro una scansione.
 *
 * IL PROBLEMA. Un blocco di DDT viene scansionato tutto insieme: un PDF solo,
 * molte pagine, e ogni pagina è un documento di una commessa diversa. Il resto
 * della pagina è un'immagine e non si legge; l'unica parte leggibile a macchina
 * è una casella di testo digitale aggiunta a mano, che contiene il codice della
 * commessa e il numero del DDT:
 *
 *     PC24 B05/4959
 *
 * IL FORMATO, deciso qui e volutamente tollerante: il PRIMO pezzo separato da
 * spazio è il codice della commessa, TUTTO il resto è il numero del DDT. Prima
 * di confrontare qualunque cosa si normalizza — via tutti gli spazi, tutto
 * maiuscolo — sia il testo letto sia i codici dell'anagrafica. Così
 * "B05 / 4959" e "B05/4959" sono lo stesso numero, e "pc24" trova "PC24".
 *
 * LA REGOLA CHE VIENE PRIMA DI TUTTE: se non si capisce, non si inventa. Una
 * casella vuota, un pezzo solo, un codice che in anagrafica non esiste — la
 * riga resta "da controllare" e la compila una persona. Le altre pagine si
 * archiviano lo stesso: una pagina illeggibile non blocca il blocco.
 *
 * L'UNICA ECCEZIONE, ed è un suggerimento, non una correzione: la O e lo zero.
 * "PDO2" scritto al posto di "PD02" è già successo, e succederà ancora. Se il
 * codice letto non esiste ma ne esiste UNO SOLO che coincide scambiando O con
 * 0, lo si propone — e la riga resta comunque da controllare. Se i candidati
 * sono due, non si propone niente: fra due indovinelli, nessuno.
 *
 * Tutte funzioni pure: nessun database, nessuna rete. È così che si possono
 * mettere alla prova in un file solo (ddtDaScansione.test.js).
 */

/** Via tutti gli spazi, tutto maiuscolo. Il metro unico di ogni confronto. */
export function normalizza(testo) {
  return String(testo ?? "").replace(/\s+/g, "").toUpperCase();
}

/** La forma in cui O e 0 sono la stessa cosa. Serve solo a cercare i sosia. */
function formaSosia(codice) {
  return normalizza(codice).replace(/O/g, "0");
}

/**
 * Spacca la casella in codice commessa e numero DDT.
 * Restituisce sempre due stringhe normalizzate, eventualmente vuote.
 */
export function dividiCasella(testo) {
  const grezzo = String(testo ?? "").trim();
  if (!grezzo) return { codice: "", numero: "" };

  const taglio = grezzo.search(/\s/);
  if (taglio === -1) return { codice: normalizza(grezzo), numero: "" };

  return {
    codice: normalizza(grezzo.slice(0, taglio)),
    numero: normalizza(grezzo.slice(taglio + 1)),
  };
}

/**
 * Legge una casella e la confronta con l'anagrafica.
 *
 * `commesse` è l'elenco dell'azienda: [{ id, codice, descrizione }].
 * Restituisce sempre la stessa forma, così la schermata non deve indovinare:
 *
 *   {
 *     codiceLetto, numero,          quello che c'era scritto, normalizzato
 *     commessaId,                   risolta solo se il codice esiste davvero
 *     stato: "ok" | "daControllare",
 *     motivo,                       perché serve un occhio, in italiano
 *     suggerimento                  { id, codice } | null — mai applicato da solo
 *   }
 */
export function leggiCasella(testo, commesse = []) {
  const elenco = Array.isArray(commesse) ? commesse : [];
  const { codice, numero } = dividiCasella(testo);

  const vuoto = {
    codiceLetto: codice, numero, commessaId: null,
    stato: "daControllare", motivo: "", suggerimento: null,
  };

  if (!codice) {
    return { ...vuoto, motivo: "la casella è vuota o illeggibile: scrivi commessa e numero" };
  }

  const esatta = elenco.find((c) => normalizza(c.codice) === codice) || null;

  if (!esatta) {
    /* I sosia per la confusione O/zero. Uno solo → si propone; due → niente,
       perché un suggerimento ambiguo è peggio di nessun suggerimento. */
    const sosia = elenco.filter((c) => formaSosia(c.codice) === formaSosia(codice));
    if (sosia.length === 1) {
      return {
        ...vuoto,
        motivo: `la commessa ${codice} non esiste: forse è ${normalizza(sosia[0].codice)}, la O e lo zero si somigliano`,
        suggerimento: { id: sosia[0].id, codice: normalizza(sosia[0].codice) },
      };
    }
    return { ...vuoto, motivo: `la commessa ${codice} non esiste in anagrafica` };
  }

  if (!numero) {
    return { ...vuoto, commessaId: esatta.id, motivo: "manca il numero del DDT" };
  }

  return {
    codiceLetto: codice, numero, commessaId: esatta.id,
    stato: "ok", motivo: "", suggerimento: null,
  };
}

/**
 * Le pagine di una scansione, lette tutte insieme.
 *
 * `pagine` è [{ numeroPagina, testo }] così come esce dal PDF; `giaInArchivio`
 * sono i numeri di DDT già presenti per questa azienda. Un numero già visto
 * NON viene sovrascritto e nemmeno rifiutato: si segnala, e decide la persona.
 * Il doppione si cerca anche DENTRO la stessa scansione, perché due pagine
 * della stessa pila possono portare lo stesso numero per errore di chi scrive.
 */
export function leggiScansione({ pagine = [], commesse = [], giaInArchivio = [] } = {}) {
  const archiviati = new Set((giaInArchivio || []).map(normalizza).filter(Boolean));
  const vistiQui = new Map(); // numero normalizzato -> prima pagina che lo porta

  return (pagine || []).map((p) => {
    const letta = leggiCasella(p?.testo, commesse);
    const numero = letta.numero;

    let duplicato = null;
    if (numero) {
      if (archiviati.has(numero)) duplicato = { dove: "archivio" };
      else if (vistiQui.has(numero)) duplicato = { dove: "scansione", pagina: vistiQui.get(numero) };
      else vistiQui.set(numero, p?.numeroPagina ?? null);
    }

    if (!duplicato) return { numeroPagina: p?.numeroPagina ?? null, ...letta, duplicato: null };

    /* Un doppione ferma la riga anche quando tutto il resto è a posto: è
       esattamente il caso in cui archiviare in silenzio farebbe il danno. */
    const motivo = duplicato.dove === "archivio"
      ? `il DDT ${numero} è già in archivio: controlla prima di archiviarlo di nuovo`
      : `il numero ${numero} compare anche a pagina ${duplicato.pagina}`;

    return {
      numeroPagina: p?.numeroPagina ?? null, ...letta,
      stato: "daControllare",
      motivo: letta.motivo ? `${letta.motivo}; ${motivo}` : motivo,
      duplicato,
    };
  });
}
