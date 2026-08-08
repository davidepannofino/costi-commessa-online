/**
 * Collaudo dei ruoli. Si esegue con:
 *
 *     node src/ruoli.test.js
 *
 * LA PROVA CHE CONTA e' la prima della famiglia 2: che nella risposta per il
 * ruolo `ore` un lordo non compaia MAI. Non si verifica leggendo il campo che
 * ci si aspetta manchi — quello troverebbe solo l'errore che si e' gia'
 * immaginato — ma cercando la CIFRA dentro tutta la risposta serializzata. Se
 * un domani un lordo rientrasse da un'altra strada (dentro un dipendente, in
 * un materiale, in un costo precalcolato), qui suona la sveglia.
 *
 * Il numero usato e' 8574, cioe' quello che tutto il progetto riverifica: se
 * esce, si riconosce a colpo d'occhio.
 */
import {
  TITOLARE, ORE, RUOLI, ruoloValido,
  vedeISoldi, scriveTutto, scriveLeOre, gestisceGliUtenti, toccaLeRigheAltrui,
  CAMPI_DI_UNA_RIGA_ORE, stampoStato, trattenuto,
} from "./ruoli.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
function uguale(a, b, m = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m}\n         atteso ${y}\n         avuto  ${x}`);
}

const LORDO_SPIA = 8574;

const datiCompleti = {
  azienda: "PIEMME IMPIANTI SRL",
  versione: 42,
  dipendenti: [
    { id: "e1", nome: "Mario", cognome: "Rossi", archiviato: false, lordoMensile: { "2026-07": LORDO_SPIA } },
    { id: "e2", nome: "Anna", cognome: "Ferri", archiviato: true, lordoMensile: { "2026-07": 2000 } },
  ],
  commesse: [{ id: "c1", codice: "PC24", descrizione: "Galleria FLERES" }],
  registrazioni: [
    { id: "r1", dipendenteId: "e1", commessaId: "c1", data: "2026-07-03", ore: 8, inserita_da: 7 },
    { id: "r2", dipendenteId: "e2", commessaId: "c1", data: "2026-07-04", ore: 6, inserita_da: 9 },
    { id: "r3", dipendenteId: "e1", commessaId: "c1", data: "2026-07-05", ore: 5, inserita_da: null },
  ],
  materiali: [{ id: "m1", commessaId: "c1", costo: 1200, fornitore: "Ferramenta" }],
  allegati: [{ id: "a1", nomeFile: "ddt.pdf" }],
  spazio: { usati: 100, quota: 1000 },
};

/* ================================================================== */

console.log("\n1. I RUOLI SONO DUE, E UNO SCONOSCIUTO NON PUO' NIENTE");

prova("i ruoli assegnabili sono esattamente due", () => {
  uguale([...RUOLI].sort(), [ORE, TITOLARE].sort(), "l'insieme dei ruoli");
  vero(ruoloValido(TITOLARE) && ruoloValido(ORE), "tutti e due validi");
});

prova("un ruolo che non esiste non e' valido e non puo' fare niente", () => {
  for (const r of ["capo", "admin", "", null, undefined, "TITOLARE"]) {
    vero(!ruoloValido(r), `"${r}" non deve essere un ruolo`);
    vero(!vedeISoldi(r), `"${r}" non deve vedere i soldi`);
    vero(!scriveTutto(r), `"${r}" non deve scrivere tutto`);
    vero(!scriveLeOre(r), `"${r}" non deve scrivere ore`);
    vero(!gestisceGliUtenti(r), `"${r}" non deve gestire utenti`);
    vero(!toccaLeRigheAltrui(r), `"${r}" non deve toccare righe altrui`);
  }
});

prova("i permessi del titolare sono quelli di sempre", () => {
  vero(vedeISoldi(TITOLARE), "vede i soldi");
  vero(scriveTutto(TITOLARE), "scrive tutto");
  vero(scriveLeOre(TITOLARE), "e anche le ore, dalla rotta stretta");
  vero(gestisceGliUtenti(TITOLARE), "gestisce gli utenti");
  vero(toccaLeRigheAltrui(TITOLARE), "tocca le righe di chiunque");
});

prova("il ruolo ore scrive le ore e nient'altro", () => {
  vero(scriveLeOre(ORE), "scrive le ore");
  vero(!vedeISoldi(ORE), "NON vede i soldi");
  vero(!scriveTutto(ORE), "NON manda il dataset intero");
  vero(!gestisceGliUtenti(ORE), "NON crea utenti");
  vero(!toccaLeRigheAltrui(ORE), "NON tocca le righe di altri");
});

/* ================================================================== */

console.log("\n2. UN LORDO NON ESCE MAI, PER IL RUOLO ORE");

prova("LA PROVA CHE CONTA: la cifra del lordo non compare da nessuna parte", () => {
  const risposta = stampoStato(ORE, 7, datiCompleti);
  const tutto = JSON.stringify(risposta);
  vero(!tutto.includes(String(LORDO_SPIA)),
    `il lordo ${LORDO_SPIA} e' uscito nella risposta:\n         ${tutto.slice(0, 300)}`);
  vero(!tutto.includes("2000"), "e nemmeno il lordo dell'altra persona");
  vero(!/lordo/i.test(tutto), "ne' una chiave che si chiami lordo");
});

prova("niente materiali, niente allegati, niente spazio", () => {
  const r = stampoStato(ORE, 7, datiCompleti);
  vero(r.materiali === undefined, "i materiali portano importi: non escono");
  vero(r.allegati === undefined, "gli allegati sono documenti di spesa: non escono");
  vero(r.spazio === undefined, "lo spazio e' un dato di abbonamento");
  vero(!JSON.stringify(r).includes("1200"), "nessun importo di materiale");
  vero(!JSON.stringify(r).includes("Ferramenta"), "nessun fornitore");
});

prova("i dipendenti restano, ma solo con il nome", () => {
  const r = stampoStato(ORE, 7, datiCompleti);
  uguale(r.dipendenti.map((d) => d.id), ["e1", "e2"], "ci sono tutti, archiviati compresi");
  for (const d of r.dipendenti) {
    uguale(Object.keys(d).sort(), ["archiviato", "cognome", "id", "nome"], "i campi di un dipendente");
  }
});

prova("al titolare invece esce tutto, lordi compresi", () => {
  const r = stampoStato(TITOLARE, 1, datiCompleti);
  uguale(r.dipendenti[0].lordoMensile, { "2026-07": LORDO_SPIA }, "il lordo c'e'");
  vero(Array.isArray(r.materiali) && r.materiali.length === 1, "i materiali ci sono");
  vero(Array.isArray(r.allegati) && r.allegati.length === 1, "gli allegati ci sono");
  vero(r.spazio != null, "lo spazio c'e'");
});

prova("un ruolo sconosciuto viene trattato come il piu' ristretto", () => {
  /* Nessun ripiego che afferma: se non si riconosce il ruolo non si apre
     niente. Chi arriva qui con «capo» vede quello che vede chi inserisce ore,
     non quello che vede il titolare. */
  const r = stampoStato("capo", 7, datiCompleti);
  vero(!JSON.stringify(r).includes(String(LORDO_SPIA)), "nessun lordo");
  vero(r.materiali === undefined, "nessun materiale");
});

/* ================================================================== */

console.log("\n2-bis. «TRATTENUTO» E «MANCANTE» DEVONO RESTARE DUE COSE DIVERSE");

prova("al ruolo ore la risposta DICHIARA cosa e' stato tolto", () => {
  /* Senza questa dichiarazione, un campo assente e un campo trattenuto
     arrivano identici. Il 9 agosto 2026 buchiNeiDati ha letto il secondo come
     il primo e ha scritto sullo schermo di un capocantiere «mancano i lordi di
     14 persone: le loro 2.679,5 ore valgono 0 €». Falso. */
  const r = stampoStato(ORE, 7, datiCompleti);
  vero(Array.isArray(r.trattenuti), "l'elenco deve esserci, non essere sottinteso");
  vero(r.trattenuti.includes("lordi"), `atteso «lordi» dentro ${JSON.stringify(r.trattenuti)}`);
  uguale(trattenuto(r, "lordi"), true, "e la domanda deve avere risposta si'");
});

prova("L'ALTRO VERSO: al titolare NON e' stato trattenuto niente", () => {
  /* E' la meta' della verita' che si perde se si guarda solo il caso rotto.
     Il rimedio spegne la segnalazione quando i lordi sono trattenuti: se
     spegnesse anche quando mancano DAVVERO, avremmo tolto una funzione buona
     — la voce 8 della lista, pubblicata il 6 agosto — per aggiustarne una
     rotta. Qui si pretende che il titolare resti nel caso in cui la
     segnalazione DEVE ancora uscire. */
  const r = stampoStato(TITOLARE, 1, datiCompleti);
  uguale(r.trattenuti, [], "al titolare non si toglie niente");
  uguale(trattenuto(r, "lordi"), false, "quindi un lordo assente e' un lordo che MANCA");
  vero(r.dipendenti[0].lordoMensile != null, "e i lordi arrivano davvero");
});

prova("un modulo che non sa niente di ruoli puo' distinguere i due casi", () => {
  /* La prova che il segnale serve a qualcosa: la stessa domanda, sulle due
     risposte, da' due risposte diverse — e chi la fa non ha bisogno di sapere
     che esistono i ruoli. */
  const perOre = stampoStato(ORE, 7, datiCompleti);
  const perTitolare = stampoStato(TITOLARE, 1, datiCompleti);
  vero(trattenuto(perOre, "lordi") !== trattenuto(perTitolare, "lordi"),
    "i due casi devono essere distinguibili senza conoscere il ruolo");
  for (const nome of ["materiali", "allegati", "costi"]) {
    uguale(trattenuto(perOre, nome), true, `${nome} trattenuto al ruolo ore`);
    uguale(trattenuto(perTitolare, nome), false, `${nome} non trattenuto al titolare`);
  }
});

/* ================================================================== */

console.log("\n3. LE ORE SI VEDONO TUTTE, MA SI SA QUALI SONO LE PROPRIE");

prova("le ore degli altri ci sono: chi scrive dal cantiere scrive per la squadra", () => {
  const r = stampoStato(ORE, 7, datiCompleti);
  uguale(r.registrazioni.map((x) => x.id), ["r1", "r2", "r3"], "tutte e tre");
});

prova("«mia» e' vero solo per le righe di chi legge", () => {
  const r = stampoStato(ORE, 7, datiCompleti);
  uguale(r.registrazioni.map((x) => x.mia), [true, false, false], "solo r1 e' di 7");
  const altro = stampoStato(ORE, 9, datiCompleti);
  uguale(altro.registrazioni.map((x) => x.mia), [false, true, false], "per 9 e' solo r2");
});

prova("le righe senza autore non sono di nessuno", () => {
  /* Le righe scritte prima che esistesse la colonna hanno inserita_da NULL:
     nessun utente `ore` puo' toccarle, senza bisogno di riempirle. */
  const r = stampoStato(ORE, 7, datiCompleti);
  uguale(r.registrazioni.find((x) => x.id === "r3").mia, false, "r3 non e' di nessuno");
  const nullo = stampoStato(ORE, null, datiCompleti);
  uguale(nullo.registrazioni.map((x) => x.mia), [false, false, false], "e senza utente, niente e' proprio");
});

prova("NON esce l'id di chi ha scritto le righe altrui", () => {
  /* «mia» e non «inserita_da»: a chi inserisce serve sapere cosa puo'
     correggere, non chi sono gli altri utenti dell'azienda. */
  const r = stampoStato(ORE, 7, datiCompleti);
  for (const x of r.registrazioni) {
    uguale(Object.keys(x).sort(), ["commessaId", "data", "dipendenteId", "id", "mia", "ore"], "i campi di una riga");
  }
  vero(!JSON.stringify(r).includes('"inserita_da"'), "la colonna non trapela");
});

/* ================================================================== */

console.log("\n4. LA ROTTA STRETTA LEGGE SOLO QUATTRO CAMPI PIU' L'ID");

prova("i campi ammessi sono quelli e nessun altro", () => {
  uguale([...CAMPI_DI_UNA_RIGA_ORE].sort(),
    ["commessaId", "data", "dipendenteId", "id", "ore"].sort(), "l'elenco");
});

prova("niente che permetta di scavalcare i permessi", () => {
  /* Se un domani qualcuno aggiungesse qui `aziendaId` o `inseritaDa`, un utente
     potrebbe scrivere su un'altra azienda o firmare una riga a nome di un
     altro. Sono i due campi che il server deve mettere di suo, sempre. */
  for (const vietato of ["aziendaId", "azienda_id", "inseritaDa", "inserita_da", "lordo", "lordoMensile", "ruolo"]) {
    vero(!CAMPI_DI_UNA_RIGA_ORE.includes(vietato), `"${vietato}" non deve essere leggibile dal corpo`);
  }
});

/* ================================================================== */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
