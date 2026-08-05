/**
 * Collaudo della decisione «questa azienda ha accesso?». Si esegue con:
 *
 *     node src/abbonamento.test.js
 *
 * Niente database e niente rete: calcolaStatoAccesso è una funzione pura.
 *
 * QUELLO CHE QUESTO FILE ESISTE PER TENERE FERMO è che la scadenza scritta
 * sulla riga COMANDA. Finché la fine della prova si ricavava da
 * `creato_il + GIORNI_PROVA`, quella costante era una leva che muoveva anche
 * il passato: alzarla regalava giorni a chi era già scaduto, abbassarla
 * chiudeva fuori di colpo chi stava lavorando. Adesso non deve più succedere,
 * e "non deve più succedere" senza una prova è solo una promessa.
 */
import { calcolaStatoAccesso, GIORNI_PROVA } from "./abbonamento.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che} atteso ${b}, avuto ${a}`);
}
function vero(c, m) { if (!c) throw new Error(m); }

const GIORNO = 24 * 60 * 60 * 1000;
const fra = (giorni) => new Date(Date.now() + giorni * GIORNO);
const ESENTE = "pannofino.work@gmail.com";   // sta in EMAIL_ESENTI, dentro abbonamento.js

/* ------------------------------------------------------------------ */

console.log("\nCHI NON PASSA NEMMENO DAL CONTO DEI GIORNI");

prova("un'email esente ha sempre accesso, scadenza o non scadenza", () => {
  const i = calcolaStatoAccesso({ email: ESENTE, stato_abbonamento: "prova", prova_fino_al: fra(-500), creato_il: fra(-900) });
  uguale(i, { haAccesso: true, stato: "esente", giorniProvaRestanti: null });
});

prova("un abbonato attivo ha accesso anche con la prova finita da un pezzo", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "attivo", prova_fino_al: fra(-400), creato_il: fra(-800) });
  uguale(i, { haAccesso: true, stato: "attivo", giorniProvaRestanti: null });
});

/* ------------------------------------------------------------------ */

console.log("\nLA DATA SCRITTA COMANDA");

prova("prova in corso: accesso sì, e i giorni sono quelli che mancano alla data", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: fra(10), creato_il: fra(-20) });
  uguale(i.stato, "prova");
  uguale(i.haAccesso, true);
  uguale(i.giorniProvaRestanti, 10);
});

prova("prova finita: niente accesso", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: fra(-1), creato_il: fra(-31) });
  uguale(i, { haAccesso: false, stato: "scaduto", giorniProvaRestanti: 0 });
});

prova("CON LA DATA SCRITTA, creato_il non viene nemmeno guardato", () => {
  /* È il cuore della faccenda. Due aziende con la STESSA scadenza scritta ma
     registrate a mille giorni di distanza devono ricevere la stessa risposta:
     se creato_il contasse ancora, qui uscirebbero due esiti diversi — ed è
     esattamente per creato_il che la vecchia costante muoveva il passato. */
  const scadenza = fra(7);
  const vecchia = calcolaStatoAccesso({ email: "a@y.invalid", stato_abbonamento: "prova", prova_fino_al: scadenza, creato_il: fra(-1000) });
  const nuova   = calcolaStatoAccesso({ email: "b@y.invalid", stato_abbonamento: "prova", prova_fino_al: scadenza, creato_il: fra(-1) });
  uguale(vecchia, nuova, "due registrazioni lontanissime con la stessa scadenza");
  uguale(vecchia.stato, "prova");
});

prova("una registrata da un anno, ma con la scadenza spostata avanti, è ancora in prova", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: fra(3), creato_il: fra(-365) });
  uguale(i.stato, "prova");
  uguale(i.haAccesso, true);
});

prova("una registrata ieri, ma con la scadenza già passata, NON è in prova", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: fra(-1), creato_il: fra(-1) });
  uguale(i.stato, "scaduto");
});

/* ------------------------------------------------------------------ */

console.log("\nLA RETE, PER LE RIGHE SENZA DATA");

prova("senza data si ripiega su creato_il + GIORNI_PROVA", () => {
  const dentro = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", creato_il: fra(-(GIORNI_PROVA - 5)) });
  uguale(dentro.stato, "prova", "registrata da poco");
  const fuori = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", creato_il: fra(-(GIORNI_PROVA + 5)) });
  uguale(fuori.stato, "scaduto", "registrata da più dei giorni di prova");
});

prova("una data illeggibile non chiude fuori nessuno: si ripiega e basta", () => {
  /* Il modo peggiore di sbagliare, qui, è negare l'accesso a chi paga o sta
     lavorando. Davanti a un valore che non si capisce si torna al conto di
     prima, non si tira giù la saracinesca. */
  for (const rotta of ["", "non-una-data", "0000-99-99"]) {
    const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: rotta, creato_il: fra(-1) });
    uguale(i.stato, "prova", `con prova_fino_al = ${JSON.stringify(rotta)}`);
  }
});

/* ------------------------------------------------------------------ */

console.log("\nCOME SI CONTANO I GIORNI RIMASTI");

prova("mezza giornata che manca si dice comunque «1 giorno», non «0»", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: new Date(Date.now() + GIORNO / 2) });
  uguale(i.giorniProvaRestanti, 1);
  vero(i.haAccesso, "con mezza giornata davanti l'accesso c'è ancora");
});

prova("chi si registra adesso vede esattamente GIORNI_PROVA giorni", () => {
  const i = calcolaStatoAccesso({ email: "x@y.invalid", stato_abbonamento: "prova", prova_fino_al: fra(GIORNI_PROVA) });
  uguale(i.giorniProvaRestanti, GIORNI_PROVA);
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exitCode = falliti === 0 ? 0 : 1;
