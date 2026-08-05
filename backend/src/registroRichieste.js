/**
 * REGISTRO DELLE RICHIESTE — una riga di log per ogni richiesta servita.
 *
 * PERCHÉ ESISTE. Finora il backend scriveva nei log SOLO gli errori. Un log
 * vuoto non voleva quindi dire "la richiesta non è arrivata": voleva dire "non
 * è esplosa", che è un'altra cosa. Il 4 agosto 2026 quella confusione è costata
 * tre giri di diagnosi sbagliata su un «impossibile contattare il server»
 * durante il caricamento di una scansione — si sono cercati timeout, dimensione
 * del file e proxy, mentre il server era semplicemente spento nel momento in cui
 * l'utente premeva il bottone. Con una riga per ogni richiesta servita, "non è
 * arrivata" si distingue da "è arrivata ed è andata bene", e la prima domanda
 * ha una risposta invece di un'ipotesi.
 *
 * COSA NON FINISCE MAI NEL LOG. Questi log li legge chi fa assistenza, e su un
 * server che tratta ore, buste paga e fatture di un'azienda vera un log è un
 * posto da cui i dati non si tolgono più. Quindi non si scrive:
 *
 *   - l'INDIRIZZO VERO, mai: solo il modello della rotta.
 *       /api/commesse/3f2a…/allegati?ddtNumero=4711  →  /api/commesse/:id/allegati
 *     Così spariscono insieme gli id e la query string, che è il posto dove
 *     finiscono numeri di DDT, date e nomi di fornitore.
 *   - nessuna INTESTAZIONE: lì dentro ci sono Authorization col token di
 *     accesso e X-Nome-File col nome del documento caricato.
 *   - nessun CORPO: lì dentro ci sono le password e gli indirizzi email.
 *
 * E IL MODO DI OTTENERLO NON È FILTRARE, È NON LEGGERE. Tutto questo file tocca
 * quattro cose e nient'altro: `req.method`, `req.route`, `res.statusCode` e un
 * orologio. `req.originalUrl`, `req.url`, `req.query`, `req.headers` e
 * `req.body` non compaiono da nessuna parte, ed è deliberato: un filtro che
 * dimentica un caso è peggio di un dato che non si è mai letto. Se un giorno
 * qualcuno vorrà aggiungere un campo, dovrà scriverne l'accesso a mano — e
 * quello è il momento in cui si rilegge questo commento.
 */

/**
 * Cosa si scrive quando non si sa a quale rotta apparteneva la richiesta: un
 * 404, o una risposta data prima che l'instradamento avvenisse (per esempio un
 * 401 su /api/admin/*, dove il controllo dell'accesso sta sul montaggio del
 * router e non dentro la singola rotta).
 *
 * NON si ripiega sull'indirizzo vero. Sarebbe proprio il caso in cui serve di
 * più — "cos'è questo 404?" — ed è esattamente il caso in cui l'indirizzo può
 * contenere qualunque cosa, perché non l'abbiamo scritto noi. Senza modello si
 * scrive che non c'è, e si accetta di saperne meno.
 */
export const SENZA_ROTTA = "(rotta non riconosciuta)";

/**
 * Il modello della rotta che ha servito la richiesta, con i segnaposto al posto
 * dei valori: "/api/commesse/:id/allegati", non "/api/commesse/3f2a…/allegati".
 *
 * `req.route.path` è già il modello scritto nel codice, non l'indirizzo
 * chiamato: è Express a tenerli separati, e questo è l'unico motivo per cui
 * questa funzione può essere così corta. `req.baseUrl` serve per le rotte
 * dentro un router montato (l'unico è adminRouter su "/api/admin"): è un
 * percorso letterale, quindi non ci finiscono valori dentro.
 */
export function modelloRotta(req) {
  const modello = req?.route?.path;
  if (!modello) return SENZA_ROTTA;

  const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
  const path = String(modello);
  // Dentro un router, la rotta radice ha path "/": attaccarlo a baseUrl darebbe
  // "/api/admin/" con una barra di troppo.
  return (path === "/" ? base : base + path) || "/";
}

/** La riga così com'è: metodo, modello della rotta, stato, durata. Quattro
 *  campi, tutti e quattro innocui, nessuno preso dall'esterno. */
export function rigaDiRegistro({ metodo, rotta, stato, ms }) {
  return `${metodo} ${rotta} ${stato} ${ms}ms`;
}

/**
 * Il middleware. Va montato PRIMA di tutte le rotte, così vede anche quelle che
 * rispondono senza arrivare in fondo alla catena.
 *
 * Si misura sull'evento "finish" della risposta, cioè quando l'ultimo byte è
 * stato consegnato: è il momento in cui la durata è quella vera, comprensiva
 * della scrittura. Una richiesta interrotta a metà dal client non emette
 * "finish" e quindi non compare: qui si registra quello che è stato SERVITO.
 *
 * @param scrivi  dove va la riga. Sta come parametro per poterlo collaudare
 *                senza guardare la console del processo.
 */
export function registroRichieste(scrivi = console.log) {
  return function registra(req, res, next) {
    const inizio = process.hrtime.bigint();

    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - inizio) / 1e6;
      scrivi(rigaDiRegistro({
        metodo: req.method,
        rotta: modelloRotta(req),
        stato: res.statusCode,
        ms: ms.toFixed(1),
      }));
    });

    next();
  };
}
