/**
 * Collaudo del ripiego asimmetrico. Si esegue con:
 *
 *     node src/ripiegoOre.test.js
 *
 * UNA PROVA SOLA CONTA DAVVERO, ed e' quella della famiglia 2: un client con
 * ruolo `ore`, quando il backend non conosce le rotte strette, non deve
 * chiamare MAI il salvataggio completo.
 *
 * Non e' una prova su un messaggio d'errore: e' una prova su cosa esce dalla
 * rete. Si intercetta `fetch` e si guarda l'elenco delle chiamate fatte. Se un
 * domani qualcuno «uniforma» l'asimmetria — sembrera' una svista da sistemare —
 * questa cade, e il commento accanto al codice dice perche' non va sistemata:
 * il salvataggio completo accetta l'anagrafica intera, quindi usarlo come
 * ripiego per chi ha il ruolo `ore` gli aprirebbe i lordi di tutti per tutta la
 * finestra in cui il server e' vecchio.
 */

/* Il modulo tocca localStorage e fetch: si preparano PRIMA di importarlo, e
   l'import e' dinamico apposta — quello statico verrebbe eseguito per primo. */
let chiamate = [];
function preparaAmbiente(token) {
  chiamate = [];
  globalThis.localStorage = {
    getItem: () => token,
    setItem() {}, removeItem() {},
  };
  globalThis.fetch = async (url, opzioni = {}) => {
    chiamate.push({ url: String(url), metodo: (opzioni.method || "GET").toUpperCase() });
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true }),
    };
  };
}

/** Un token con un payload leggibile: tre parti, quella di mezzo in base64url. */
function tokenCon(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `intestazione.${b64}.firma`;
}

preparaAmbiente(tokenCon({ aziendaId: "az1", utenteId: 9, ruolo: "ore" }));
const { datiAPI, ruoloCorrente, backendConosceIRuoli } = await import("./datiAPI.js");

let passati = 0, falliti = 0;
function prova(nome, fn) {
  try { fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
async function provaAsync(nome, fn) {
  try { await fn(); passati++; console.log(`  ok   ${nome}`); }
  catch (e) { falliti++; console.log(`  NO   ${nome}\n         ${e.message}`); }
}
function vero(c, m) { if (!c) throw new Error(m); }
const chiamateA = (frammento) => chiamate.filter((c) => c.url.includes(frammento));

/* ================================================================== */

console.log("\n1. IL RUOLO SI LEGGE DAL TOKEN, NON SOLO DAL SERVER");

prova("con un token di ruolo ore, il ruolo si sa anche senza aver caricato niente", () => {
  vero(ruoloCorrente() === "ore", `atteso "ore", avuto ${JSON.stringify(ruoloCorrente())}`);
});

prova("e il backend risulta vecchio finche' non ha mandato una versione", () => {
  /* E' il segnale positivo: c'e' la versione, il backend conosce le rotte
     nuove; non c'e', e' quello di ieri. Non si annusa un 404, che vorrebbe dire
     confondere «rotta assente» con «riga non tua». */
  vero(backendConosceIRuoli() === false, "senza versione letta, il backend e' quello vecchio");
});

/* ================================================================== */

console.log("\n2. RUOLO ORE + BACKEND VECCHIO: NESSUNA CHIAMATA, DI NESSUN TIPO");

await provaAsync("LA PROVA CHE CONTA: non si chiama il salvataggio completo", async () => {
  chiamate.length = 0;
  let sollevato = null;
  try {
    await datiAPI.aggiungiOre({ dipendenteId: "e1", commessaId: "c1", data: "2026-08-09", ore: 8 });
  } catch (e) { sollevato = e; }

  vero(sollevato, "doveva rifiutare invece di provarci");
  vero(sollevato.serverIndietro === true, "e dirlo per quello che e'");
  /* Il cuore: NIENTE deve essere partito. Non solo «niente PUT su /api/stato»,
     proprio nessuna richiesta — se un ripiego venisse aggiunto piu' avanti
     nella catena, questa riga lo prende lo stesso. */
  vero(chiamate.length === 0, `non doveva partire nessuna richiesta, invece: ${JSON.stringify(chiamate)}`);
  vero(chiamateA("/api/stato").length === 0, "in particolare nessuna su /api/stato");
});

await provaAsync("nemmeno correggendo o cancellando una riga", async () => {
  for (const azione of [
    () => datiAPI.modificaOre("r1", { dipendenteId: "e1", commessaId: "c1", data: "2026-08-09", ore: 6 }),
    () => datiAPI.eliminaOre("r1"),
  ]) {
    chiamate.length = 0;
    let sollevato = null;
    try { await azione(); } catch (e) { sollevato = e; }
    vero(sollevato?.serverIndietro === true, "doveva rifiutare");
    vero(chiamate.length === 0, `nessuna richiesta, invece: ${JSON.stringify(chiamate)}`);
  }
});

await provaAsync("il messaggio dice cosa fare, non cosa e' rotto", async () => {
  let sollevato = null;
  try { await datiAPI.eliminaOre("r1"); } catch (e) { sollevato = e; }
  vero(/riprova/i.test(sollevato.message), `messaggio inatteso: ${sollevato.message}`);
  vero(!/errore|guasto|500/i.test(sollevato.message), "non deve suonare come un guasto");
});

/* ================================================================== */

console.log("\n3. IL TITOLARE INVECE PASSA, E DEVE");

await provaAsync("con ruolo titolare le rotte strette si chiamano lo stesso", async () => {
  /* Il ripiego per il titolare va bene: quell'utente puo' scrivere tutto
     comunque, quindi non gli concede niente che non avesse gia'. Qui si
     verifica solo che non venga BLOCCATO come l'altro. */
  preparaAmbiente(tokenCon({ aziendaId: "az1", utenteId: 1, ruolo: "titolare" }));
  const modulo = await import(`./datiAPI.js?titolare=${Date.now()}`);
  vero(modulo.ruoloCorrente() === "titolare", "il ruolo viene dal token");
  vero(modulo.datiAPI.oreScrivibili() === true, "il titolare non viene fermato");
  await modulo.datiAPI.aggiungiOre({ dipendenteId: "e1", commessaId: "c1", data: "2026-08-09", ore: 8 });
  vero(chiamateA("/api/ore").length === 1, `doveva chiamare /api/ore, invece: ${JSON.stringify(chiamate)}`);
});

await provaAsync("un token senza ruolo vale titolare, come lato server", async () => {
  /* I token emessi prima che il campo esistesse durano trenta giorni. Se qui
     valessero «ruolo sconosciuto» e venissero trattati come `ore`, per un mese
     nessuno di loro potrebbe salvare. */
  preparaAmbiente(tokenCon({ aziendaId: "az1" }));
  const modulo = await import(`./datiAPI.js?vecchio=${Date.now()}`);
  vero(modulo.ruoloCorrente() === null, "il token non porta ruolo");
  vero(modulo.datiAPI.oreScrivibili() === true, "e non viene bloccato");
});

await provaAsync("un token illeggibile non apre niente e non esplode", async () => {
  preparaAmbiente("non-e-un-token");
  const modulo = await import(`./datiAPI.js?rotto=${Date.now()}`);
  vero(modulo.ruoloCorrente() === null, "ruolo sconosciuto");
  vero(modulo.datiAPI.oreScrivibili() === true, "e si comporta come un titolare, che e' il caso di prima");
});

/* ================================================================== */

console.log(`\n${passati} passati, ${falliti} falliti\n`);
process.exitCode = falliti === 0 ? 0 : 1;
