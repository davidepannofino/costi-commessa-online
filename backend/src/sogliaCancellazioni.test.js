/**
 * Collaudo della soglia sulle cancellazioni. Si esegue con:
 *
 *     node src/sogliaCancellazioni.test.js
 *
 * DUE FAMIGLIE DI PROVE, e servono tutte e due.
 *
 * Le prime dicono che il lavoro non si perde: 319 righe che spariscono senza
 * che nessuno l'abbia chiesto vengono fermate.
 *
 * Le seconde dicono che il rifiuto NON arriva quando non serve. Sono importanti
 * quanto le altre: un avviso che compare a sproposito insegna a ignorarlo, e da
 * quel momento non protegge più niente. Cancellare una riga alla volta, che è
 * come si lavora davvero, non deve mai incontrare questa soglia.
 */
import {
  troppeCancellazioni, SOGLIA_ASSOLUTA, PAVIMENTO_QUOTA, DIVISORE_QUOTA,
} from "./sogliaCancellazioni.js";

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
const rifiuta = (esistenti, cancellate, dichiarate = 0) =>
  troppeCancellazioni({ esistenti, cancellate, dichiarate }).rifiuta;

/* ------------------------------------------------------------------ */

console.log("\nIL LAVORO NON SI PERDE");

prova("IL CASO VERO: 319 righe su 624 senza conferma → rifiutato", () => {
  /* La giornata del 5 agosto 2026, tre ore di battitura. Una scheda aperta
     prima di quel giorno e salvata dopo cancellerebbe esattamente queste. */
  const r = troppeCancellazioni({ esistenti: 624, cancellate: 319 });
  vero(r.rifiuta, "doveva rifiutare");
  vero(/319/.test(r.motivo), `il motivo deve dire quante sono: ${r.motivo}`);
});

prova("uno stato completamente vuoto → rifiutato", () => {
  vero(rifiuta(624, 624), "un browser che ha perso tutto");
});

prova("una scheda vecchia di una sessione (35 righe) → rifiutato", () => {
  vero(rifiuta(624, 35), "35 righe sono comunque più di 10");
});

prova("il motivo dice sempre i numeri veri, non una frase generica", () => {
  const r = troppeCancellazioni({ esistenti: 100, cancellate: 40 });
  vero(/40/.test(r.motivo), `mancano le cancellate: ${r.motivo}`);
});

/* ------------------------------------------------------------------ */

console.log("\nIL RIFIUTO NON ARRIVA QUANDO NON SERVE");

prova("cancellare UNA riga, come si fa a mano, passa sempre", () => {
  for (const tot of [1, 5, 8, 20, 40, 100, 624]) {
    vero(!rifiuta(tot, 1), `1 riga su ${tot} deve passare`);
  }
});

prova("fino a 10 righe passa, all'undicesima si ferma", () => {
  vero(!rifiuta(624, SOGLIA_ASSOLUTA), "esattamente 10 passa");
  vero(rifiuta(624, SOGLIA_ASSOLUTA + 1), "11 si ferma");
});

prova("IL CASO DEL PAVIMENTO: 3 righe su 8 passano", () => {
  /* Un quarto di 8 fa 2, quindi senza pavimento questo sarebbe rifiutato —
     e sarebbe un rifiuto a sproposito su normale amministrazione. */
  vero(!rifiuta(8, 3), "3 su 8 è normale amministrazione");
  vero(!rifiuta(8, 4), "e anche 4 su 8");
  vero(!rifiuta(19, 9), "sotto il pavimento comanda solo la soglia assoluta");
});

prova("sotto il pavimento la regola del quarto non esiste proprio", () => {
  for (let tot = 1; tot < PAVIMENTO_QUOTA; tot++) {
    for (let n = 1; n <= Math.min(tot, SOGLIA_ASSOLUTA); n++) {
      vero(!rifiuta(tot, n), `${n} su ${tot} non deve essere rifiutato`);
    }
  }
});

prova("dal pavimento in su il quarto comincia a mordere", () => {
  vero(!rifiuta(PAVIMENTO_QUOTA, 5), "5 su 20 è esattamente un quarto: passa");
  vero(rifiuta(PAVIMENTO_QUOTA, 6), "6 su 20 supera il quarto: si ferma");
});

prova("sopra le 40 righe il quarto non morde più: comanda l'assoluta", () => {
  /* Un quarto di 40 fa 10, cioè la soglia assoluta. Sopra, il quarto è più
     largo e quindi non è mai lui a fermare: è giusto saperlo, perché rende
     questa regola una regola di banda stretta. */
  const soglia = SOGLIA_ASSOLUTA * DIVISORE_QUOTA;
  vero(!rifiuta(soglia, 10), "10 su 40 passa");
  vero(rifiuta(soglia, 11), "11 su 40 si ferma per la soglia assoluta");
  vero(rifiuta(1000, 11), "11 su 1000 si ferma lo stesso, pur essendo l'1%");
});

/* ------------------------------------------------------------------ */

console.log("\nLA DICHIARAZIONE ESPLICITA APRE, MA SOLO PER QUANTO HA DETTO");

prova("«Svuota tutto»: dichiara 624, cancella 624 → passa", () => {
  vero(!rifiuta(624, 624, 624), "svuotare deve continuare a funzionare");
});

prova("eliminare la commessa più grossa: dichiara 86 → passa", () => {
  vero(!rifiuta(624, 86, 86), "PC24 «Commesse Varie» ha 86 righe");
});

prova("ma UNA riga in più di quelle dichiarate viene fermata", () => {
  /* È il motivo per cui la dichiarazione è un numero e non un "sì": un "sì"
     messo per sbaglio su un percorso qualsiasi aprirebbe tutto. */
  vero(rifiuta(624, 87, 86), "87 cancellate con 86 dichiarate");
  vero(rifiuta(624, 624, 86), "e a maggior ragione 624 con 86 dichiarate");
});

prova("dichiarare zero è come non dichiarare niente", () => {
  vero(rifiuta(624, 319, 0), "zero non apre");
  vero(rifiuta(624, 319), "e nemmeno l'assenza del campo");
});

prova("una dichiarazione non fa passare quello che non cancella", () => {
  const r = troppeCancellazioni({ esistenti: 624, cancellate: 0, dichiarate: 624 });
  vero(!r.rifiuta, "zero cancellazioni non è mai un problema");
});

/* ------------------------------------------------------------------ */

console.log("\nNUMERI STRANI NON APRONO LA PORTA");

prova("valori assurdi non diventano un permesso", () => {
  for (const d of [undefined, null, "", "tutte", NaN, -5, {}, []]) {
    vero(troppeCancellazioni({ esistenti: 624, cancellate: 319, dichiarate: d }).rifiuta,
      `dichiarate ${JSON.stringify(d)} non deve aprire`);
  }
});

prova("una tabella vuota non si fa fermare da niente", () => {
  vero(!rifiuta(0, 0), "niente da cancellare");
});

/* ------------------------------------------------------------------ */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
