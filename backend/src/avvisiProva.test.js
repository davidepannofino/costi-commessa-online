/**
 * Collaudo degli avvisi sulla scadenza della prova. Si esegue con:
 *
 *     node src/avvisiProva.test.js
 *
 * CINQUE FAMIGLIE.
 *
 * 1. CHI NON RICEVE NIENTE, MAI. La prima e la più importante. Un avviso di
 *    scadenza a chi non ha nessuna prova da far scadere è una bugia mandata a
 *    casa di qualcuno. Le prove qui girano sull'insieme VERO delle email
 *    esenti e sulla funzione VERA che decide lo stato: un filtro dato per
 *    scontato non è una difesa.
 *
 * 2. LA REGOLA DELLA DATA. Nessuno dei tre testi può contenere una parola che
 *    diventa falsa stando ferma nella posta. La prova legge i testi veri e
 *    cerca quelle parole a una a una.
 *
 * 3. I CONFINI. Quando parte ciascuno dei tre, e quando non parte.
 *
 * 4. NON SI MANDA DUE VOLTE, E NON SE NE MANDANO DUE INSIEME.
 *
 * 5. DOPO IL TERZO NON PARTE PIÙ NIENTE. È una promessa scritta dentro il
 *    terzo messaggio, quindi va difesa da una prova e non dalle buone
 *    intenzioni.
 */
import {
  avvisoDaMandare, componiAvviso, dataPerEsteso,
  SETTE, ULTIMO, SCADUTA,
  GIORNI_PRIMO_AVVISO, GIORNI_ULTIMO_AVVISO, GIORNI_FINESTRA_SCADENZA,
} from "./avvisiProva.js";
import { calcolaStatoAccesso, EMAIL_ESENTI } from "./abbonamento.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
function uguale(a, b, m) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m}\n         atteso ${JSON.stringify(b)}\n         ottenuto ${JSON.stringify(a)}`);
  }
}

const GIORNO = 24 * 60 * 60 * 1000;
const ADESSO = Date.parse("2026-08-12T09:00:00+02:00");
const fra = (giorni) => ADESSO + giorni * GIORNO;

/** Una riga come la costruirà la rotta: stato vero + scadenza + avvisi già chiusi. */
const riga = (stato, giorniProvaRestanti, fineProva, avvisi = {}) =>
  ({ stato, giorniProvaRestanti, fineProva, avvisi });

const tipoDi = (r) => { const a = avvisoDaMandare(r, ADESSO); return a ? a.tipo : null; };

/* ================================================================== */

console.log("\n1. CHI NON RICEVE NIENTE, MAI");

prova("l'insieme delle email esenti non è vuoto", () => {
  /* Se un giorno si svuotasse, tutte le prove qui sotto passerebbero senza
     verificare niente. Meglio che si fermino. */
  vero(EMAIL_ESENTI.size > 0, "EMAIL_ESENTI è vuoto: le prove sull'esenzione non proverebbero niente");
});

prova("l'email di chi gestisce il prodotto è fra le esenti", () => {
  vero(EMAIL_ESENTI.has("pannofino.work@gmail.com"),
    "pannofino.work@gmail.com non è più fra le esenti: o è un errore, o queste prove vanno riscritte");
});

prova("NESSUNA email esente riceve avvisi, in nessuno dei tre momenti", () => {
  for (const email of EMAIL_ESENTI) {
    for (const scadenza of [fra(3), fra(1), fra(-2)]) {
      const stato = calcolaStatoAccesso({
        email, stato_abbonamento: "prova",
        creato_il: new Date(fra(-40)).toISOString(),
        prova_fino_al: new Date(scadenza).toISOString(),
        tolleranza_fino_al: null,
      });
      uguale(stato.stato, "esente", `${email} doveva risultare esente`);
      uguale(tipoDi(riga(stato.stato, stato.giorniProvaRestanti, scadenza)), null,
        `${email} non deve ricevere niente`);
    }
  }
});

prova("LA TRAPPOLA: esente CON una data di prova che scade fra un giorno", () => {
  /* È il caso che si romperebbe per primo se qualcuno invertisse i due
     controlli in calcolaStatoAccesso, mettendo la data prima dell'esenzione.
     Da fuori non si vedrebbe niente — se non un'email di scadenza a chi non
     scade mai. */
  const scadenza = fra(1);
  const stato = calcolaStatoAccesso({
    email: "pannofino.work@gmail.com",
    stato_abbonamento: "prova",
    creato_il: new Date(fra(-29)).toISOString(),
    prova_fino_al: new Date(scadenza).toISOString(),
    tolleranza_fino_al: null,
  });
  uguale(stato.stato, "esente", "l'esenzione deve vincere sulla data");
  uguale(tipoDi(riga(stato.stato, stato.giorniProvaRestanti, scadenza)), null, "e non deve partire niente");
});

prova("chi ha l'abbonamento attivo non riceve niente, anche con una vecchia data di prova", () => {
  const scadenza = fra(-3);
  const stato = calcolaStatoAccesso({
    email: "cliente@esempio.invalid", stato_abbonamento: "attivo",
    creato_il: new Date(fra(-90)).toISOString(),
    prova_fino_al: new Date(scadenza).toISOString(),
    tolleranza_fino_al: null,
  });
  uguale(stato.stato, "attivo", "doveva risultare attivo");
  uguale(tipoDi(riga(stato.stato, stato.giorniProvaRestanti, scadenza)), null, "niente avvisi a chi paga");
});

prova("chi è in tolleranza non riceve niente: ha già pagato", () => {
  const scadenza = fra(-10);
  const stato = calcolaStatoAccesso({
    email: "cliente@esempio.invalid", stato_abbonamento: "scaduto",
    creato_il: new Date(fra(-90)).toISOString(),
    prova_fino_al: new Date(scadenza).toISOString(),
    tolleranza_fino_al: new Date(fra(4)).toISOString(),
  });
  uguale(stato.stato, "in_ritardo", "doveva risultare in ritardo");
  uguale(tipoDi(riga(stato.stato, stato.giorniProvaRestanti, scadenza)), null,
    "parlare di prova a chi ha pagato sarebbe falso");
});

prova("uno stato sconosciuto non riceve niente per difetto", () => {
  /* Il giorno che nascesse "sospeso", non deve cominciare a ricevere avvisi
     da solo: gli stati che ricevono sono scritti a uno a uno. */
  uguale(tipoDi(riga("sospeso", 3, fra(3))), null, "uno stato nuovo non entra da solo");
  uguale(tipoDi(riga(undefined, 3, fra(3))), null, "nemmeno l'assenza di stato");
});

/* ================================================================== */

console.log("\n2. LA REGOLA DELLA DATA");

const LINK = "https://app.esempio.invalid/";
const TUTTI = [SETTE, ULTIMO, SCADUTA].map((t) => [t, componiAvviso(t, fra(7), LINK)]);

/* Parole che diventano false stando ferme nella posta di chi non l'ha ancora
   aperta. "Ultimo" NON è in elenco: qualifica la data che ha accanto invece di
   affermare qualcosa sul presente, e resta vero comunque venga letto. */
const PAROLE_CHE_SCADONO = [
  "oggi", "ieri", "domani", "dopodomani", "stamattina", "stasera", "stanotte",
  "adesso", "presto", "subito", "imminente", "poco", "breve", "attualmente",
];
const FRASI_CHE_SCADONO = [
  /\bmanca(no)?\b/i,
  /\b(fra|tra|entro)\s+\d+\s+giorni?\b/i,
  /\bprossim\w*/i,
  /\bquesta settimana\b/i,
];

prova("nessuno dei tre testi contiene una parola che scade", () => {
  for (const [tipo, m] of TUTTI) {
    const tutto = `${m.oggetto}\n${m.testo}`;
    for (const p of PAROLE_CHE_SCADONO) {
      vero(!new RegExp(`\\b${p}\\b`, "i").test(tutto), `l'avviso "${tipo}" contiene «${p}»`);
    }
    for (const r of FRASI_CHE_SCADONO) {
      vero(!r.test(tutto), `l'avviso "${tipo}" contiene qualcosa che scade: ${r}`);
    }
  }
});

prova("tutti e tre scrivono la data per esteso, nell'oggetto E nel testo", () => {
  const data = dataPerEsteso(fra(7));
  for (const [tipo, m] of TUTTI) {
    vero(m.oggetto.includes(data), `l'oggetto di "${tipo}" non porta la data: ${m.oggetto}`);
    vero(m.testo.includes(data), `il testo di "${tipo}" non porta la data`);
    vero(m.html.includes(data), `l'HTML di "${tipo}" non porta la data`);
  }
});

prova("la data è quella italiana, non quella del server", () => {
  /* Mezzanotte e mezza del 20 agosto in Italia è ancora il 19 in UTC. Il
     server gira su UTC: senza il fuso dichiarato, l'email annuncerebbe una
     data sbagliata di un giorno. */
  uguale(dataPerEsteso(Date.parse("2026-08-20T00:30:00+02:00")), "20 agosto 2026", "la mezzanotte italiana");
  uguale(dataPerEsteso(Date.parse("2026-08-19T23:59:00+02:00")), "19 agosto 2026", "l'ultimo minuto del 19");
});

prova("l'oggetto del secondo si stacca dagli altri due", () => {
  /* Il primo e il terzo raccontano una storia sola e possono accorparsi nella
     posta; il secondo è l'unico che deve farsi notare, e dentro una
     conversazione già letta rischierebbe di non essere aperto. */
  const [[, primo], [, secondo], [, terzo]] = TUTTI;
  vero(secondo.oggetto !== primo.oggetto, "il secondo non può avere l'oggetto del primo");
  vero(secondo.oggetto !== terzo.oggetto, "né quello del terzo");
  vero(secondo.oggetto.startsWith("Ultimo giorno di prova"), `oggetto inatteso: ${secondo.oggetto}`);
});

prova("NELLA POSTA: il primo e il terzo insieme, il secondo da solo", () => {
  /* La stessa decisione dell'oggetto, scritta la seconda volta dove i client la
     leggono davvero. Servono tutte e due: Gmail guarda anche l'oggetto e
     applica regole sue, quindi nessuna delle due strade da sola è una
     garanzia — e questa prova cade se se ne toglie una. */
  const [[, primo], [, secondo], [, terzo]] = TUTTI;
  vero(primo.conversazione, "il primo deve stare in una conversazione");
  uguale(terzo.conversazione, primo.conversazione, "il terzo va nella stessa del primo");
  uguale(secondo.conversazione, null, "il secondo non deve stare in nessuna conversazione");
});

prova("la conversazione identifica LA PROVA, non l'azienda", () => {
  /* Chi ne cominciasse una seconda fra un anno deve aprire una conversazione
     nuova, invece di vedersi appendere il messaggio sotto quello vecchio. */
  const questa = componiAvviso(SETTE, fra(7), LINK).conversazione;
  const stessaScadenza = componiAvviso(SCADUTA, fra(7), LINK).conversazione;
  const unaltraProva = componiAvviso(SETTE, fra(400), LINK).conversazione;
  uguale(stessaScadenza, questa, "stessa scadenza, stessa conversazione");
  vero(unaltraProva !== questa, "una prova diversa apre una conversazione diversa");
});

prova("i tre testi parlano dei dati PRIMA dell'abbonamento", () => {
  /* Lo stesso ordine della schermata di blocco, dove l'esportazione sta sopra
     il listino. Invertirlo direbbe il contrario di quello che si vede
     entrando. */
  for (const [tipo, m] of TUTTI) {
    const dati = m.testo.indexOf("dati");
    const abbonamento = m.testo.indexOf("abbonamento");
    vero(dati >= 0, `"${tipo}" non nomina i dati`);
    vero(abbonamento < 0 || dati < abbonamento, `"${tipo}" parla di abbonamento prima che di dati`);
  }
});

prova("solo il terzo promette che non ne arriveranno altri", () => {
  const [[, primo], [, secondo], [, terzo]] = TUTTI;
  vero(/ultimo dei tre avvisi/i.test(terzo.testo), "il terzo deve dirlo");
  vero(!/ultimo dei tre avvisi/i.test(primo.testo), "il primo no");
  vero(!/ultimo dei tre avvisi/i.test(secondo.testo), "il secondo nemmeno");
});

prova("nessun prezzo compare in nessuno dei tre", () => {
  /* Gli euro stanno solo in piani.js. Una cifra scritta qui sarebbe una
     seconda copia, fuori sincrono al primo cambio di listino. */
  for (const [tipo, m] of TUTTI) {
    vero(!/\d+\s*(€|euro)/i.test(`${m.oggetto} ${m.testo}`), `"${tipo}" nomina un prezzo`);
  }
});

/* ================================================================== */

console.log("\n3. I CONFINI");

prova("a otto giorni non parte ancora niente", () => {
  uguale(tipoDi(riga("prova", GIORNI_PRIMO_AVVISO + 1, fra(8))), null, "otto giorni è presto");
});

prova("a sette giorni esatti parte il primo", () => {
  uguale(tipoDi(riga("prova", GIORNI_PRIMO_AVVISO, fra(7))), SETTE, "sette giorni");
});

prova("fra sette e due giorni parte il primo, se non è già partito", () => {
  for (const g of [7, 6, 5, 4, 3, 2]) {
    uguale(tipoDi(riga("prova", g, fra(g))), SETTE, `a ${g} giorni`);
  }
});

prova("a un giorno parte il secondo", () => {
  uguale(tipoDi(riga("prova", GIORNI_ULTIMO_AVVISO, fra(1))), ULTIMO, "un giorno");
});

prova("l'ultimo giorno, con poche ore davanti, è ancora il secondo", () => {
  uguale(tipoDi(riga("prova", 1, ADESSO + 3 * 60 * 60 * 1000)), ULTIMO, "tre ore alla scadenza");
});

prova("appena scaduta parte il terzo", () => {
  uguale(tipoDi(riga("scaduto", 0, fra(-0.5))), SCADUTA, "scaduta da mezza giornata");
  uguale(tipoDi(riga("scaduto", 0, fra(-3))), SCADUTA, "scaduta da tre giorni");
});

prova("LA DIFESA DEL PRIMO GIORNO: una scadenza vecchia non riceve niente", () => {
  /* Il giorno che la migrazione aggiunge le colonne, tutte le righe hanno
     NULL. Senza questa finestra il primo giro scriverebbe a chiunque abbia mai
     abbandonato una prova, anche a chi è scaduto mesi fa. */
  uguale(tipoDi(riga("scaduto", 0, fra(-GIORNI_FINESTRA_SCADENZA - 1))), null, "otto giorni fa");
  uguale(tipoDi(riga("scaduto", 0, fra(-60))), null, "due mesi fa");
  uguale(tipoDi(riga("scaduto", 0, fra(-400))), null, "l'anno scorso");
});

prova("il bordo della finestra: dentro sì, appena fuori no", () => {
  uguale(tipoDi(riga("scaduto", 0, fra(-GIORNI_FINESTRA_SCADENZA + 0.1))), SCADUTA, "dentro");
  uguale(tipoDi(riga("scaduto", 0, fra(-GIORNI_FINESTRA_SCADENZA - 0.1))), null, "fuori");
});

prova("una scadenza nel futuro con stato scaduto non manda niente", () => {
  /* Non dovrebbe capitare, ma se capitasse sarebbe una riga incoerente: nel
     dubbio si tace, invece di annunciare una scadenza che non c'è stata. */
  uguale(tipoDi(riga("scaduto", 0, fra(2))), null, "scadenza nel futuro");
});

prova("date assurde non fanno partire niente", () => {
  for (const f of [NaN, undefined, null, "domani", {}]) {
    uguale(tipoDi(riga("scaduto", 0, f)), null, `fineProva = ${JSON.stringify(f)}`);
  }
  for (const g of [NaN, undefined, null, "tre", {}]) {
    uguale(tipoDi(riga("prova", g, fra(3))), null, `giorniProvaRestanti = ${JSON.stringify(g)}`);
  }
});

/* ================================================================== */

console.log("\n4. NON SI MANDA DUE VOLTE");

prova("un avviso già chiuso non riparte", () => {
  const chiuso = new Date(fra(-1)).toISOString();
  uguale(tipoDi(riga("prova", 5, fra(5), { sette: chiuso })), null, "il primo");
  uguale(tipoDi(riga("prova", 1, fra(1), { ultimo: chiuso })), null, "il secondo");
  uguale(tipoDi(riga("scaduto", 0, fra(-2), { scaduta: chiuso })), null, "il terzo");
});

prova("MAI DUE INSIEME: chi arriva all'ultimo giorno senza il primo riceve solo l'ultimo", () => {
  /* È il caso di chi si registra con pochi giorni davanti, o della settimana
     in cui questa funzione entra in servizio. Mandare i due messaggi nello
     stesso momento sarebbe la cosa che questo modulo esiste per non fare. */
  const a = avvisoDaMandare(riga("prova", 1, fra(1), {}), ADESSO);
  uguale(a.tipo, ULTIMO, "deve essere l'ultimo");
  vero(a.chiude.includes(SETTE), "e deve chiudere anche il primo, che non partirà più");
});

prova("chi riceve il terzo si chiude dietro anche i primi due", () => {
  const a = avvisoDaMandare(riga("scaduto", 0, fra(-1), {}), ADESSO);
  uguale(a.tipo, SCADUTA, "deve essere il terzo");
  uguale([...a.chiude].sort(), [SCADUTA, SETTE, ULTIMO].sort(), "e chiuderli tutti");
});

prova("chi ha già ricevuto il secondo non riceve il primo dopo", () => {
  const chiuso = new Date(fra(-1)).toISOString();
  uguale(tipoDi(riga("prova", 1, fra(1), { ultimo: chiuso, sette: chiuso })), null, "niente");
});

/* ================================================================== */

console.log("\n5. DOPO IL TERZO NON PARTE PIÙ NIENTE");

prova("la promessa scritta nel terzo messaggio è vera", () => {
  /* Il terzo dice «non ne riceverai altri». Qui si verifica che sia un fatto
     e non una cortesia: dopo, comunque passi il tempo, non esce niente. */
  const chiuso = new Date(ADESSO).toISOString();
  const dopo = { sette: chiuso, ultimo: chiuso, scaduta: chiuso };
  for (const giorni of [0.5, 1, 3, 7, 30, 200, 1000]) {
    const piuTardi = ADESSO + giorni * GIORNO;
    for (const stato of ["scaduto", "prova"]) {
      const a = avvisoDaMandare(riga(stato, 0, fra(-1), dopo), piuTardi);
      uguale(a, null, `dopo ${giorni} giorni, stato "${stato}"`);
    }
  }
});

prova("nemmeno un cambio di stato riapre la porta", () => {
  const chiuso = new Date(ADESSO).toISOString();
  const dopo = { sette: chiuso, ultimo: chiuso, scaduta: chiuso };
  for (const stato of ["prova", "scaduto", "attivo", "esente", "in_ritardo", "sospeso"]) {
    uguale(tipoDi(riga(stato, 3, fra(3), dopo)), null, `stato "${stato}"`);
  }
});

/* ================================================================== */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
