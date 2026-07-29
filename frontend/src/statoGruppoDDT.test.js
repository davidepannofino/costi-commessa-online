/**
 * Collaudo degli stati dei gruppi nella schermata di importazione. Si esegue:
 *
 *     node src/statoGruppoDDT.test.js
 *
 * Verifica soprattutto la cosa che rende onesta l'interfaccia: che un gruppo
 * smetta di dirsi "abbinato in automatico" nel momento in cui l'utente cambia
 * la commessa a mano.
 */
import { statoGruppo, assegnazioneIniziale, NON_IMPORTARE } from "./statoGruppoDDT.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function uguale(avuto, atteso, che = "") {
  const a = JSON.stringify(avuto), b = JSON.stringify(atteso);
  if (a !== b) throw new Error(`${che} atteso ${b}, avuto ${a}`);
}

const FORTE = { forza: "forte", commessaId: "c1", commessaCodice: "24-018" };
const DEBOLE = { forza: "debole", commessaId: "c9", commessaCodice: "24-099" };
const riga = (commessaId, assegnazione) => ({ commessaId, assegnazione });

console.log("\nCOMMESSA DI PARTENZA");
prova("il match forte pre-seleziona la commessa", () => {
  uguale(assegnazioneIniziale(FORTE), { commessaId: "c1", assegnazione: "auto" });
});
prova("il match debole NON pre-seleziona niente", () => {
  uguale(assegnazioneIniziale(DEBOLE), { commessaId: NON_IMPORTARE, assegnazione: "nessuna" });
});
prova("nessun abbinamento: non si assegna niente", () => {
  uguale(assegnazioneIniziale(null), { commessaId: NON_IMPORTARE, assegnazione: "nessuna" });
});

console.log("\nSTATO DEL GRUPPO");
prova("pre-assegnato dal software e non toccato → auto (verde)", () => {
  uguale(statoGruppo([riga("c1", "auto"), riga("c1", "auto")], FORTE), { tipo: "auto", commessaGruppo: "c1" });
});
prova("APPENA L'UTENTE CAMBIA, non è più 'in automatico'", () => {
  // La riga esiste per questo: l'etichetta non deve mentire.
  uguale(statoGruppo([riga("c5", "manuale"), riga("c5", "manuale")], FORTE), { tipo: "manuale", commessaGruppo: "c5" });
});
prova("anche cambiando UNA sola riga il gruppo non è più automatico", () => {
  uguale(statoGruppo([riga("c1", "auto"), riga("c1", "manuale")], FORTE), { tipo: "manuale", commessaGruppo: "c1" });
});
prova("candidato debole, niente assegnato → possibile (giallo)", () => {
  uguale(statoGruppo([riga(NON_IMPORTARE, "nessuna")], DEBOLE), { tipo: "possibile", commessaGruppo: "" });
});
prova("nessun candidato, niente assegnato → vuoto (da assegnare)", () => {
  uguale(statoGruppo([riga(NON_IMPORTARE, "nessuna")], null), { tipo: "vuoto", commessaGruppo: "" });
});
prova("assegnato a mano senza nessun abbinamento → manuale", () => {
  uguale(statoGruppo([riga("c7", "manuale")], null), { tipo: "manuale", commessaGruppo: "c7" });
});
prova("righe su commesse diverse → misto, nessuna commessa unica", () => {
  uguale(statoGruppo([riga("c1", "manuale"), riga("c2", "manuale")], FORTE), { tipo: "misto", commessaGruppo: "" });
});
prova("un gruppo pre-assegnato e poi escluso torna a 'possibile', non resta verde", () => {
  uguale(statoGruppo([riga(NON_IMPORTARE, "manuale")], FORTE), { tipo: "possibile", commessaGruppo: "" });
});
prova("un abbinamento debole non diventa mai auto, nemmeno se l'utente accetta quella commessa", () => {
  // Se l'utente sceglie a mano la commessa proposta, è una scelta SUA.
  uguale(statoGruppo([riga("c9", "manuale")], DEBOLE), { tipo: "manuale", commessaGruppo: "c9" });
});

console.log(`\n${passati} prove passate, ${falliti} fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
