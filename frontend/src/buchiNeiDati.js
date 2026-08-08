/**
 * I BUCHI CHE RENDONO FALSI I NUMERI CHE SI STANNO GUARDANDO.
 *
 * Due casi soltanto, e sono l'uno il rovescio dell'altro:
 *
 *   ORE SENZA LORDO   — qualcuno ha ore registrate in un mese per cui non c'è
 *                       il lordo. La sua tariffa non è calcolabile, quindi
 *                       quelle ore valgono 0 € e finiscono gratis sulla
 *                       commessa.
 *   LORDO SENZA ORE   — qualcuno ha un lordo scritto per un mese in cui non ha
 *                       nessuna ora. Quello stipendio non finisce su NESSUNA
 *                       commessa: il costo del mese è più basso del vero,
 *                       esattamente di quella cifra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ ESISTE, VISTO CHE C'È GIÀ L'INVARIANTE.
 *
 * L'invariante di calcolaRiepilogo confronta la somma dei costi con «la somma
 * dei lordi DEI DIPENDENTI CON ORE» (App.jsx, riga 253). Quel «con ore» è la
 * ragione di questo file: chi ha lordo e zero ore esce da tutt'e due i lati
 * della sottrazione, quindi il conto torna e il timbro resta verde mentre uno
 * stipendio intero manca dai totali. Non è un difetto dell'invariante — un
 * invariante che si scrive da sé i termini non potrebbe fare altro — è che
 * quella domanda non gliela si può fare.
 *
 * E non lo copre nemmeno tariffaDaControllare.js, che è il posto dove si
 * guardano le tariffe fuori scala: `tariffeDi` salta apposta le coppie senza
 * lordo o senza ore, perché una tariffa che non si può calcolare non si può
 * nemmeno confrontare. I due moduli sono complementari: là si guarda un numero
 * che c'è ed è strano, qui un numero che non c'è affatto.
 *
 * NON CHIEDE STORICO, ed è la cosa che lo distingue da ogni confronto. Una
 * mediana vuole tre mesi completi; questo si accende sul PRIMO mese, che è poi
 * il momento in cui i buchi sono più probabili e in cui chi guarda sta ancora
 * decidendo se ai numeri può credere.
 *
 * SI FERMA AL FATTO. Non dice «non hai ancora inserito le buste paga» né «il
 * mese è incompleto»: non lo sa, e potrebbe essere un lordo dimenticato, una
 * persona in aspettativa, o un mese davvero fatto così. Dice quante ore, quale
 * cifra, e per chi — e si ferma lì. La conclusione la trae chi guarda, che è
 * l'unico ad avere l'informazione che serve (PRODUCT.md, Principio 2).
 *
 * I NOMI CI SONO, E NON VIOLANO IL PRINCIPIO 7. Il soggetto di queste frasi è
 * sempre una cifra — un lordo che manca, ore che valgono zero — e il nome serve
 * a sapere quale riga andare ad aprire per rimettere a posto il numero. Non si
 * dice mai come qualcuno lavora, né quanto, né dove: si dice che un dato
 * anagrafico non c'è.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const ORE_SENZA_LORDO = "ore-senza-lordo";
export const LORDO_SENZA_ORE = "lordo-senza-ore";

/**
 * I formati italiani, ripetuti qui invece che importati da App.jsx perché
 * questo modulo deve restare provabile senza React e senza browser.
 *
 * `useGrouping: "always"` non è un dettaglio ed è la ragione per cui la
 * ripetizione è coperta da una prova: in italiano Intl da solo non separa le
 * migliaia sotto le cinque cifre — «8574,00» ma «12.574,00» — e PRODUCT.md
 * pretende il punto sempre. Se questa riga divergesse da quella di App.jsx, i
 * due posti scriverebbero la stessa cifra in due modi; la prova su 8.574,00 €
 * in buchiNeiDati.test.js è lì per accorgersene.
 */
const fmtEuro = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always",
});
const fmtOre = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: "always",
});
export const euro = (v) => `${fmtEuro.format(v)} €`;

/** «2026-07» → «luglio 2026». Il fuso non serve: qui non ci sono istanti, solo mesi. */
const NOMI_MESE = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];
export function meseEsteso(mese) {
  const [anno, m] = String(mese).split("-");
  const nome = NOMI_MESE[Number(m) - 1];
  return nome ? `${nome} ${anno}` : String(mese);
}

const nomeDi = (d) => `${d.nome ?? ""} ${d.cognome ?? ""}`.trim() || "(senza nome)";

/**
 * I MESI DA GUARDARE: quelli con ore, PIÙ i vuoti che stanno in mezzo.
 *
 * Serve perché il guasto più grosso che questo modulo deve trovare è anche
 * l'unico che non lascia tracce: un mese in cui NESSUNO ha registrato ore non
 * compare fra i mesi toccati, quindi senza questa funzione non verrebbe
 * guardato — e sono proprio i mesi in cui tutti gli stipendi restano fuori dai
 * costi. Il rilevatore sarebbe cieco esattamente dove il guasto è totale.
 *
 * UN BUCO, NON UN BORDO, e la distinzione è tutta qui. Guardare tutti i mesi
 * dell'intervallo sarebbe rumore: chi è stato assunto a luglio ha un lordo da
 * luglio, ma chiunque abbia un lordo scritto più indietro verrebbe segnalato
 * per ogni mese in cui non ha lavorato, e sei righe false seppelliscono quella
 * vera. Un mese vuoto PRIMA che l'azienda cominciasse a usare il programma non
 * è un dato che manca: è il programma che non c'era. Un mese vuoto FRA giugno e
 * agosto lo è eccome.
 *
 * Da cui la regola, che si riduce a una cosa sola: la campata continua dal
 * primo all'ultimo mese con ore. Tutto quello che ci sta dentro senza ore è per
 * definizione in mezzo a due mesi che ne hanno; tutto quello che ci sta fuori è
 * un bordo.
 *
 * L'ASIMMETRIA CON tariffaDaControllare È VOLUTA, e non è un'incoerenza: sono
 * due domande diverse. «Questa tariffa è plausibile?» ha senso solo dove ci
 * sono ore da valorizzare, e là guardare un mese vuoto non vorrebbe dire
 * niente. «Manca qualcosa?» deve poter guardare anche dove non c'è niente.
 *
 * LA CAMPATA SI MISURA SU TUTTO LO STORICO, IL RISULTATO SI RITAGLIA SUL
 * PERIODO. Sono due cose diverse e vanno tenute separate, altrimenti la regola
 * non scatta mai: l'applicazione è mensile per default, e chi guarda luglio da
 * solo passerebbe un elenco di mesi con ore vuoto — nessun «in mezzo»,
 * nessuna segnalazione, proprio nel caso peggiore. Se luglio è in mezzo lo
 * dicono giugno e agosto, che stanno fuori dal periodo guardato ma dentro i
 * dati. Quello che si RIPORTA resta però solo ciò che si sta guardando: un
 * avviso su un mese che non è a schermo non si saprebbe dove andare a leggere.
 *
 * @param mesiConOre  i mesi 'AAAA-MM' con almeno un'ora, su TUTTO lo storico
 * @param da, a       estremi 'AAAA-MM' del periodo guardato, facoltativi
 * @returns i mesi della campata dentro il periodo, in ordine. Vuoto se non ci
 *          sono ore: senza nemmeno un mese con ore non esiste nessun «in
 *          mezzo».
 */
export function mesiDaGuardare(mesiConOre, { da, a } = {}) {
  const valido = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m));
  const mesi = [...new Set(mesiConOre ?? [])].filter(valido).sort();
  if (mesi.length === 0) return [];

  const ultimo = mesi[mesi.length - 1];
  const campata = [];
  let [anno, mese] = mesi[0].split("-").map(Number);
  for (;;) {
    const corrente = `${anno}-${String(mese).padStart(2, "0")}`;
    campata.push(corrente);
    if (corrente >= ultimo) break;
    mese++;
    if (mese > 12) { mese = 1; anno++; }
  }

  /* Un estremo malformato viene ignorato invece di svuotare il risultato:
     nel dubbio si guarda di più, perché qui il costo di guardare un mese in
     più è una riga in fondo a una scatola, e quello di guardarne uno in meno
     è uno stipendio che non risulta a nessuno. */
  return campata.filter((m) => (valido(da) ? m >= da : true) && (valido(a) ? m <= a : true));
}

/**
 * I buchi nei mesi che si stanno guardando.
 *
 * Prende le stesse cose di tariffeDaControllare, di proposito: così le due
 * famiglie si agganciano nello stesso punto di App.jsx, con gli stessi dati, e
 * non c'è modo che una guardi un periodo e l'altra un altro.
 *
 * @param dipendenti  l'anagrafica intera, archiviati compresi — un ex
 *                    dipendente con un buco a marzo falsa marzo esattamente
 *                    come chiunque altro
 * @param oreMensili  la mappa "dipId|AAAA-MM" → ore, da calcolaRiepilogo
 * @param mesi        i mesi solari toccati dal periodo che si sta guardando
 * @returns [{ tipo, mese, persone, ore?, importo?, testo }] — vuoto se non c'è
 *          nessun buco, che è un esito legittimo e va detto come tale.
 */
export function buchiNeiDati({ dipendenti, oreMensili, mesi } = {}) {
  const daGuardare = new Set(mesi ?? []);
  const anagrafica = dipendenti ?? [];
  const ore = oreMensili ?? new Map();

  const oreDi = (id, mese) => Number(ore.get(`${id}|${mese}`) || 0);

  /* Raccolta, mese per mese. Le due liste restano separate perché sono due
     guasti diversi con due rimedi diversi, e accorparli in «dati incompleti»
     costringerebbe chi legge a riaprire tutto per capire cosa fare. */
  const perMese = new Map();
  const registra = (mese, tipo, voce) => {
    if (!perMese.has(mese)) perMese.set(mese, { [ORE_SENZA_LORDO]: [], [LORDO_SENZA_ORE]: [] });
    perMese.get(mese)[tipo].push(voce);
  };

  for (const d of anagrafica) {
    const lordi = d.lordoMensile ?? {};

    /* ORE SENZA LORDO. Si guarda `== null` e non `!(> 0)`, per stare esatti
       con tariffaOraria in App.jsx: un lordo scritto a zero è un valore che
       qualcuno ha deciso, non un dato che manca, e inventarci sopra una
       segnalazione sarebbe il ripiego che afferma. */
    for (const mese of daGuardare) {
      const o = oreDi(d.id, mese);
      if (o > 0 && lordi[mese] == null) {
        registra(mese, ORE_SENZA_LORDO, { id: d.id, nome: nomeDi(d), ore: o });
      }
    }

    /* LORDO SENZA ORE. Solo se il lordo è davvero una cifra: uno zero senza
       ore non toglie niente a nessun totale, quindi non c'è niente da dire. */
    for (const [mese, lordo] of Object.entries(lordi)) {
      if (!daGuardare.has(mese)) continue;
      if (Number(lordo) > 0 && oreDi(d.id, mese) === 0) {
        registra(mese, LORDO_SENZA_ORE, { id: d.id, nome: nomeDi(d), lordo: Number(lordo) });
      }
    }
  }

  /* ------------------------------------------------------------------ */

  const fuori = [];
  for (const [mese, gruppi] of perMese) {
    const senzaOre = gruppi[LORDO_SENZA_ORE];
    const senzaLordo = gruppi[ORE_SENZA_LORDO];

    if (senzaOre.length > 0) {
      const importo = senzaOre.reduce((s, p) => s + p.lordo, 0);
      const testo = senzaOre.length === 1
        ? `A ${meseEsteso(mese)} il lordo di ${senzaOre[0].nome} è ${euro(senzaOre[0].lordo)} e non ci sono ore registrate: quel costo non è su nessuna commessa.`
        : `A ${meseEsteso(mese)} ci sono ${senzaOre.length} lordi senza ore registrate, ${euro(importo)} in tutto: quei costi non sono su nessuna commessa.`;
      fuori.push({ tipo: LORDO_SENZA_ORE, mese, persone: senzaOre, importo, testo });
    }

    if (senzaLordo.length > 0) {
      const totOre = senzaLordo.reduce((s, p) => s + p.ore, 0);
      const testo = senzaLordo.length === 1
        ? `A ${meseEsteso(mese)} manca il lordo di ${senzaLordo[0].nome}: le sue ${fmtOre.format(senzaLordo[0].ore)} ore valgono 0 €.`
        : `A ${meseEsteso(mese)} mancano i lordi di ${senzaLordo.length} persone: le loro ${fmtOre.format(totOre)} ore valgono 0 €.`;
      fuori.push({ tipo: ORE_SENZA_LORDO, mese, persone: senzaLordo, ore: totOre, testo });
    }
  }

  /* L'ORDINE. Prima i mesi recenti, perché è lì che si può ancora rimediare.
     Dentro lo stesso mese, prima «lordo senza ore»: è l'unico dei due di cui si
     sappia QUANTO manca al totale — l'altro toglie una cifra che, mancando il
     lordo, nessuno può quantificare. Non si ordina per importo fra mesi
     diversi: un mese vecchio con un buco grosso resta un mese vecchio. */
  const peso = { [LORDO_SENZA_ORE]: 0, [ORE_SENZA_LORDO]: 1 };
  return fuori.sort((a, b) => b.mese.localeCompare(a.mese) || peso[a.tipo] - peso[b.tipo]);
}

/** Vero se nel periodo che si sta guardando c'è almeno un buco. */
export const cSonoBuchiNeiDati = (args) => buchiNeiDati(args).length > 0;
