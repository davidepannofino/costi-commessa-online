/**
 * A CHE PUNTO È IL PRIMO GIORNO.
 *
 * Un'impresa che si iscrive trova il vuoto: prima di vedere un solo numero
 * utile deve inserire una persona col suo lordo, una commessa e le ore di un
 * mese. Questo modulo dice a che punto è, guardando i dati veri — nessun
 * elenco di cose fatte tenuto da parte, nessuna spunta salvata da qualche
 * parte che possa andare fuori sincrono con la realtà.
 *
 * PERCHÉ TRE PASSI E NON OTTO. La strada più corta fra «mi sono iscritto» e
 * «vedo quanto mi costa un cantiere» ha esattamente questi tre gradini, e non
 * si possono saltare: senza il lordo non c'è tariffa, senza commessa non c'è
 * dove mettere le ore, senza ore non c'è costo. Tutto il resto — materiali,
 * DDT, fatture — viene dopo e non serve al primo numero.
 *
 * IL TERZO PASSO NON È «UNA RIGA». Il costo di una commessa è `tariffa × ore`
 * dove la tariffa è `lordo / ore del mese`: il totale è quindi SEMPRE il lordo
 * intero, comunque poche siano le ore. Con un giorno solo inserito il cantiere
 * risulta costato uno stipendio pieno. Perciò il passo si considera fatto
 * quando c'è almeno una riga — è quello che sblocca la schermata — ma il
 * numero diventa vero solo a mese completo, e a dirlo è tariffaDaControllare.js
 * con i numeri di chi guarda. Qui non si finge che una riga basti.
 */

/**
 * @param dipendentiAttivi  chi è in servizio (gli archiviati non aiutano a
 *                          cominciare)
 * @param commesse          le commesse dell'azienda
 * @param registrazioni     tutte le ore registrate
 * @returns { passi: [{id, fatto, ...}], fatti, totale, finito }
 */
export function statoPrimoGiorno({ dipendentiAttivi, commesse, registrazioni } = {}) {
  /* Il valore predefinito del parametro non copre `null`, che è quello che
     arriva davvero da uno stato non ancora caricato: si normalizza a mano. */
  const persone = Array.isArray(dipendentiAttivi) ? dipendentiAttivi : [];
  const lavori = Array.isArray(commesse) ? commesse : [];
  const ore = Array.isArray(registrazioni) ? registrazioni : [];

  /* Un dipendente senza lordo non fa tariffa: il passo non è "esiste una
     persona", è "esiste una persona di cui so quanto costa un mese". */
  const conLordo = persone.filter((d) => Object.values(d.lordoMensile || {}).some((v) => v > 0));

  const passi = [
    {
      id: "chi",
      titolo: "Chi lavora",
      testo: "Una persona e il suo lordo di un mese: da lì esce la tariffa oraria.",
      fatto: conLordo.length > 0,
      /* Il caso di mezzo va detto, se no sembra che non si sia fatto niente. */
      nota: conLordo.length === 0 && persone.length > 0
        ? `${persone.length === 1 ? "C'è una persona" : `Ci sono ${persone.length} persone`}, ma senza lordo mensile la tariffa non si può calcolare.`
        : null,
    },
    {
      id: "dove",
      titolo: "Dove lavora",
      testo: "Una commessa: il cantiere, il cliente, il lavoro su cui contare le ore.",
      fatto: lavori.length > 0,
      nota: null,
    },
    {
      id: "quando",
      titolo: "Le ore di un mese",
      testo: "Le giornate di quella persona su quella commessa.",
      fatto: ore.length > 0,
      nota: null,
    },
  ];

  const fatti = passi.filter((p) => p.fatto).length;
  return { passi, fatti, totale: passi.length, finito: fatti === passi.length };
}

/** Qual è il passo su cui si è fermi: il primo non fatto, o null se è finita. */
export function passoCorrente(stato) {
  return stato.passi.find((p) => !p.fatto) ?? null;
}
