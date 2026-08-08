/**
 * Sostituisce il bridge Electron (window.datiAPI, vedi electron/store.js della
 * versione desktop) con chiamate al backend web su /api/stato. Stessa forma
 * dell'oggetto restituito, così App.jsx non deve cambiare la logica che lo usa.
 *
 * In locale il proxy di Vite instrada /api verso il backend, quindi basta un
 * percorso relativo. In produzione frontend e backend sono due servizi Render
 * separati con URL diversi: VITE_API_URL (impostata a build-time) punta al
 * backend pubblicato.
 */
import { leggiToken } from "./auth.js";

export const API_BASE = import.meta.env.VITE_API_URL || "";

/** Impostata da App.jsx: chiamata quando il server rifiuta il token (scaduto
 *  o non valido), per riportare l'utente alla schermata di accesso. */
let gestoreSessioneScaduta = null;
export function suSessioneScaduta(fn) {
  gestoreSessioneScaduta = fn;
}

/** Impostata da App.jsx: chiamata quando il server rifiuta l'accesso ai dati
 *  perché la prova è scaduta e non c'è un abbonamento attivo (402). A
 *  differenza della sessione scaduta, il token resta valido: si mostra solo
 *  la schermata di abbonamento richiesto, senza fare logout. */
let gestoreAbbonamentoRichiesto = null;
export function suAbbonamentoRichiesto(fn) {
  gestoreAbbonamentoRichiesto = fn;
}

const headerAuth = () => ({ Authorization: `Bearer ${leggiToken() || ""}` });

/* ───────────────────────────────────────────────────────────────────────────
   LA VERSIONE CHE QUESTA SCHEDA HA LETTO, E IL RUOLO DI CHI LA GUARDA.

   Ogni scrittura fa salire `versione_dati` sul server. Chi salva rimanda in
   `If-Match` quella che aveva letto: se nel frattempo un'altra persona ha
   scritto, il server risponde 412 e non tocca niente. Senza, una scheda aperta
   da stamattina cancella in silenzio le righe inserite nel frattempo da chi sta
   in cantiere — otto righe stanno sotto la soglia delle cancellazioni, quindi
   passerebbero.

   `versione` SERVE ANCHE COME SEGNALE DI CAPACITA'. Se la risposta non la porta,
   il backend e' quello di ieri: su Render i due servizi non vanno in linea
   insieme, e il frontend puo' arrivare per primo. E' un segnale POSITIVO —
   c'e' o non c'e' — invece di dedurlo annusando un 404, che vorrebbe dire
   confondere «questa rotta non esiste» con «questa riga non e' tua».
   ─────────────────────────────────────────────────────────────────────────── */
let versioneNota = null;
let ruoloNoto = null;

export const versioneLetta = () => versioneNota;
export const ruoloCorrente = () => ruoloNoto;
/** Vero se il backend che risponde conosce le rotte nuove. */
export const backendConosceIRuoli = () => versioneNota !== null;

const headerVersione = () => (versioneNota != null ? { "If-Match": String(versioneNota) } : {});

/**
 * Chiamata alle rotte dei materiali. Gestisce allo stesso modo di tutto il
 * resto la sessione scaduta (401) e l'abbonamento richiesto (402), e propaga
 * il messaggio d'errore del server così com'è, perché è già scritto per essere
 * mostrato all'utente.
 */
async function chiamaMateriali(metodo, percorso, corpo, messaggioDiRipiego, estrai) {
  let res;
  try {
    res = await fetch(`${API_BASE}${percorso}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...headerAuth() },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (e) {
    throw new Error("Impossibile contattare il server: riprova.");
  }
  if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
  if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); throw new Error("Abbonamento richiesto."); }
  if (!res.ok) {
    const dati = await res.json().catch(() => null);
    throw new Error(dati?.errore || messaggioDiRipiego);
  }
  return estrai(await res.json());
}

/* --- compressione delle immagini prima del caricamento ----------------------
   I DDT sono quasi sempre foto scattate col telefono: 3-5 MB l'una, una
   risoluzione enorme rispetto a quello che serve per rileggerli. Ridurle qui,
   nel browser, prima di mandarle, è ciò che tiene i documenti dentro il piano
   gratuito: una foto da 4 MB scende tipicamente a qualche centinaio di kB
   restando perfettamente leggibile. I PDF passano invece intatti.        */
const LATO_MAX = 2000;      // px sul lato lungo
const QUALITA_JPEG = 0.82;

async function comprimiSeImmagine(file) {
  const comprimibile = file.type === "image/jpeg" || file.type === "image/png";
  if (!comprimibile || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scala = Math.min(1, LATO_MAX / Math.max(bitmap.width, bitmap.height));
    const largo = Math.round(bitmap.width * scala);
    const alto = Math.round(bitmap.height * scala);

    const tela = document.createElement("canvas");
    tela.width = largo; tela.height = alto;
    const ctx = tela.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, largo, alto);
    bitmap.close?.();

    const blob = await new Promise((r) => tela.toBlob(r, "image/jpeg", QUALITA_JPEG));
    // Se la compressione non guadagna nulla (foto già piccola), si tiene
    // l'originale: meglio non ricomprimere un'immagine per niente.
    if (!blob || blob.size >= file.size) return file;

    const nome = file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg" });
  } catch (e) {
    // Se qualcosa va storto si carica il file originale: meglio un file
    // pesante che un caricamento fallito.
    return file;
  }
}

export const datiAPI = {
  /**
   * Rilegge TUTTO per portarselo via. Funziona anche con la prova scaduta:
   * è l'unica rotta che lo fa, ed è di sola lettura garantita dal database.
   *
   * NON chiama gestoreAbbonamentoRichiesto su un 402. Sembra un dettaglio ed è
   * il punto: questa funzione la si usa DALLA schermata di blocco, e rimandare
   * lì chi ci è già dentro vorrebbe dire far sparire il messaggio d'errore
   * ridisegnando la stessa schermata. Chi la chiama vede l'errore e lo mostra.
   */
  async esporta() {
    try {
      const res = await fetch(`${API_BASE}/api/esportazione`, { headers: headerAuth() });
      if (res.status === 401) {
        gestoreSessioneScaduta?.();
        return { ok: false, motivo: "La sessione è scaduta: accedi di nuovo." };
      }
      if (!res.ok) return { ok: false, motivo: `Il server ha risposto con l'errore ${res.status}.` };
      return { ok: true, dati: await res.json() };
    } catch (e) {
      return { ok: false, motivo: "Impossibile contattare il server. Riprova fra un minuto." };
    }
  },

  async carica() {
    try {
      const res = await fetch(`${API_BASE}/api/stato`, { headers: headerAuth() });
      if (res.status === 401) {
        gestoreSessioneScaduta?.();
        return { dati: null, primoAvvio: true, avviso: null };
      }
      if (res.status === 402) {
        gestoreAbbonamentoRichiesto?.();
        return { dati: null, primoAvvio: true, avviso: null };
      }
      if (!res.ok) throw new Error(`Il server ha risposto con l'errore ${res.status}.`);
      const dati = await res.json();
      /* Da qui in poi la scheda sa quale versione ha letto e con che permessi.
         Un backend vecchio non manda nessuna delle due: restano a null, ed e'
         quello che `backendConosceIRuoli` legge. */
      versioneNota = dati.versione ?? null;
      ruoloNoto = dati.ruolo ?? null;
      const vuoto =
        (dati.dipendenti?.length ?? 0) === 0 &&
        (dati.commesse?.length ?? 0) === 0 &&
        (dati.registrazioni?.length ?? 0) === 0;
      return { dati, primoAvvio: vuoto, avviso: null };
    } catch (e) {
      return {
        dati: null,
        primoAvvio: true,
        avviso: "Impossibile contattare il server: modifiche non salvate finché la connessione non torna.",
      };
    }
  },

  /**
   * Salva l'intero stato e DICE COM'È ANDATA.
   *
   * Prima questa funzione inghiottiva gli errori con un console.error: chi la
   * chiamava mostrava comunque "salvato", e l'utente continuava a lavorare
   * credendo che i dati fossero al sicuro mentre non lo erano. Un salvataggio
   * fallito in silenzio è peggio di un errore: se ne accorge solo al
   * ricaricamento della pagina, quando il lavoro è già perso.
   *
   * Ritorna { ok } oppure { ok: false, motivo, gestito }. "gestito" indica i
   * casi che hanno già una loro schermata (sessione scaduta, abbonamento):
   * lì un avviso in più sarebbe solo rumore.
   */
  async salva(_aziendaId, dati) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/stato`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headerAuth(), ...headerVersione() },
        body: JSON.stringify(dati),
      });
    } catch (e) {
      console.error("Salvataggio non riuscito (server irraggiungibile):", e);
      return { ok: false, motivo: "server irraggiungibile" };
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); return { ok: false, motivo: "sessione scaduta", gestito: true }; }
    if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); return { ok: false, motivo: "abbonamento richiesto", gestito: true }; }
    /* IL SERVER HA RIFIUTATO PERCHÉ CANCELLEREBBE TROPPO. È un caso a sé e non
       un errore qualunque, perché la cura è opposta a quella di tutti gli
       altri: negli altri casi ricaricare la pagina PERDE il lavoro non
       salvato, qui ricaricare è esattamente ciò che va fatto — sul server i
       dati sono intatti, ed è la copia nel browser a essere sbagliata.
       Si porta su i numeri veri, così il messaggio può dirli invece di
       spaventare con un errore generico. */
    if (res.status === 409) {
      const d = await res.json().catch(() => null);
      return {
        ok: false,
        rifiutatoPerCancellazioni: true,
        cancellerebbe: d?.cancellerebbe ?? null,
        esistenti: d?.esistenti ?? null,
        motivo: "il server ha rifiutato: cancellerebbe troppe registrazioni",
      };
    }
    /* LA SCHEDA HA LETTO I DATI PRIMA CHE UN ALTRO SCRIVESSE.
       Come il 409 qui sopra, la cura è ricaricare — sul server i dati sono
       tutti, ed è la copia nel browser a essere indietro. La differenza è che
       qui non manca niente al server: c'è di più, ed è roba di qualcun altro. */
    if (res.status === 412) {
      const d = await res.json().catch(() => null);
      return {
        ok: false,
        schedaVecchia: true,
        versioneAttuale: d?.versioneAttuale ?? null,
        motivo: "un'altra persona ha salvato mentre questa pagina era aperta",
      };
    }
    if (!res.ok) {
      const dettaglio = await res.json().catch(() => null);
      console.error("Salvataggio non riuscito:", res.status, dettaglio);
      return { ok: false, motivo: dettaglio?.errore || `errore ${res.status} del server` };
    }
    const esito = await res.json().catch(() => null);
    if (esito?.versione != null) versioneNota = esito.versione;
    return { ok: true };
  },

  /* --- LE ORE, DALLA ROTTA STRETTA ---------------------------------------
     Scrive quattro campi e nient'altro. Chi ha il ruolo `ore` passa solo di
     qui: il salvataggio completo manda l'anagrafica intera, lordi compresi.

     ────────────────────────────────────────────────────────────────────────
     IL RIPIEGO E' ASIMMETRICO, ED E' VOLUTO. NON SISTEMARLO.

     Se il backend non conosce queste rotte — è quello di ieri, o è stato
     riportato indietro dopo che gli utenti erano già stati creati — allora:

       titolare  → si ripiega sul salvataggio completo. Va bene: quell'utente
                   può scrivere tutto comunque, quindi il ripiego non gli
                   concede niente che non avesse già.
       ruolo ore → NIENTE RIPIEGO. Si dice che il salvataggio non è
                   disponibile e si chiede di riprovare fra un minuto.

     Sembrerà un'incoerenza da uniformare, e non lo è. Il salvataggio completo
     accetta l'anagrafica intera: usarlo come ripiego per chi ha il ruolo `ore`
     aprirebbe, per tutta la finestra in cui il server è vecchio, esattamente il
     confine che queste rotte esistono per chiudere — quella persona potrebbe
     riscrivere i lordi di tutti.

     Una difesa che si spegne da sola quando il server è indietro non è una
     difesa: è una porta di servizio con l'orario di apertura. Meglio un minuto
     di attesa che un minuto di permessi in più.
     ──────────────────────────────────────────────────────────────────────── */

  /** Vero se le ore si possono scrivere adesso, con il ruolo che si ha. */
  oreScrivibili() {
    return backendConosceIRuoli() || ruoloNoto !== "ore";
  },

  async _chiamaOre(metodo, percorso, corpo) {
    if (!this.oreScrivibili()) {
      const e = new Error(
        "Il salvataggio non è disponibile in questo momento: riprova fra un minuto."
      );
      e.serverIndietro = true;
      throw e;
    }
    let res;
    try {
      res = await fetch(`${API_BASE}${percorso}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...headerAuth() },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch (e) {
      throw new Error("Impossibile contattare il server: riprova.");
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
    if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); throw new Error("Abbonamento richiesto."); }
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(d?.errore || "Impossibile salvare le ore.");
    }
    const d = await res.json();
    /* Anche una riga di ore fa salire la versione: senza aggiornarla qui, il
       salvataggio successivo di questa stessa scheda si prenderebbe un 412
       causato da sé. */
    if (d?.versione != null) versioneNota = d.versione;
    return d;
  },

  aggiungiOre(riga) { return this._chiamaOre("POST", "/api/ore", riga); },
  modificaOre(id, riga) { return this._chiamaOre("PATCH", `/api/ore/${encodeURIComponent(id)}`, riga); },
  eliminaOre(id) { return this._chiamaOre("DELETE", `/api/ore/${encodeURIComponent(id)}`, null); },

  /* --- GLI UTENTI DELL'AZIENDA (solo titolare) ---------------------------- */

  async elencoUtenti() {
    return chiamaMateriali("GET", "/api/utenti", null, "Impossibile leggere gli utenti.", (d) => d.utenti);
  },
  async creaUtente(dati) {
    return chiamaMateriali("POST", "/api/utenti", dati, "Impossibile creare l'utente.", (d) => d.utente);
  },
  async eliminaUtente(id) {
    return chiamaMateriali("DELETE", `/api/utenti/${encodeURIComponent(id)}`, null, "Impossibile togliere l'utente.", () => true);
  },

  /**
   * Rinomina una commessa (codice e/o descrizione). Il server è l'autorità:
   * verifica che la commessa sia dell'azienda del token e che il codice non
   * sia già usato da un'altra commessa della stessa azienda.
   * Ritorna la commessa aggiornata, oppure lancia un errore con il messaggio
   * del server (da mostrare così com'è all'utente).
   */
  async rinominaCommessa(id, { codice, descrizione }) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/commesse/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headerAuth() },
        body: JSON.stringify({ codice, descrizione }),
      });
    } catch (e) {
      throw new Error("Impossibile contattare il server: riprova.");
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
    if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); throw new Error("Abbonamento richiesto."); }
    if (!res.ok) {
      const dati = await res.json().catch(() => null);
      throw new Error(dati?.errore || "Impossibile rinominare la commessa.");
    }
    const dati = await res.json();
    return dati.commessa;
  },

  /* --- MATERIALI ---------------------------------------------------------
     Voci di costo materiale di una commessa. Hanno rotte proprie (non passano
     dal salvataggio automatico di /api/stato): ogni operazione è immediata e
     viene sempre verificata dal server contro l'azienda del token. */

  /** Aggiunge una voce di materiale. Ritorna la voce creata (con il costo calcolato dal database). */
  async aggiungiMateriale(dati) {
    return chiamaMateriali("POST", "/api/materiali", dati, "Impossibile salvare il materiale.", (d) => d.materiale);
  },

  /** Modifica una voce di materiale esistente. */
  async aggiornaMateriale(id, dati) {
    return chiamaMateriali("PATCH", `/api/materiali/${encodeURIComponent(id)}`, dati, "Impossibile aggiornare il materiale.", (d) => d.materiale);
  },

  /** Elimina una voce di materiale. */
  async eliminaMateriale(id) {
    return chiamaMateriali("DELETE", `/api/materiali/${encodeURIComponent(id)}`, null, "Impossibile eliminare il materiale.", () => true);
  },

  /* --- ALLEGATI (DDT) -----------------------------------------------------
     Documenti archiviati e collegati a una commessa. In questo passo non si
     legge nulla dal contenuto: solo caricamento, elenco, apertura e
     cancellazione. Ogni richiesta porta il token, quindi i documenti non sono
     mai raggiungibili da un indirizzo pubblico. */

  /**
   * Carica un file (PDF/JPG/PNG) e lo allega a una commessa. Le immagini
   * vengono rimpicciolite prima dell'invio: vedi comprimiSeImmagine.
   *
   * "ddt" porta i tre dati FACOLTATIVI del documento (numero, data,
   * fornitore). Vanno nella query string perché il corpo della richiesta è il
   * file. Se non ci sono, non si manda niente e il documento si archivia come
   * si è sempre fatto.
   */
  async caricaAllegato(commessaId, file, ddt = {}) {
    const pronto = await comprimiSeImmagine(file);
    const q = new URLSearchParams();
    for (const chiave of ["ddtNumero", "ddtData", "fornitore"]) {
      const valore = String(ddt?.[chiave] ?? "").trim();
      if (valore) q.set(chiave, valore);
    }
    const coda = q.toString() ? `?${q}` : "";
    let res;
    try {
      res = await fetch(`${API_BASE}/api/commesse/${encodeURIComponent(commessaId)}/allegati${coda}`, {
        method: "POST",
        headers: {
          "Content-Type": pronto.type || "application/octet-stream",
          "X-Nome-File": encodeURIComponent(pronto.name),
          ...headerAuth(),
        },
        body: pronto,
      });
    } catch (e) {
      throw new Error("Impossibile contattare il server: riprova.");
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
    if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); throw new Error("Abbonamento richiesto."); }
    if (!res.ok) {
      const dati = await res.json().catch(() => null);
      throw new Error(dati?.errore || "Impossibile caricare il documento.");
    }
    return await res.json(); // { allegato, spazio }
  },

  /** Scarica il contenuto di un allegato e ne restituisce una URL locale al
   *  browser (blob:), da usare per aprirlo o salvarlo. Chi la usa deve poi
   *  chiamare URL.revokeObjectURL per liberare la memoria. */
  async apriAllegato(id) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/allegati/${encodeURIComponent(id)}`, { headers: headerAuth() });
    } catch (e) {
      throw new Error("Impossibile contattare il server: riprova.");
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
    if (!res.ok) {
      const dati = await res.json().catch(() => null);
      throw new Error(dati?.errore || "Impossibile aprire il documento.");
    }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), blob };
  },

  /** Elimina un allegato. Ritorna lo spazio aggiornato. */
  async eliminaAllegato(id) {
    return chiamaMateriali("DELETE", `/api/allegati/${encodeURIComponent(id)}`, null, "Impossibile eliminare il documento.", (d) => d);
  },

  /** Aggiorna i tre dati facoltativi del DDT su un documento già archiviato
   *  (il file non si tocca). Serve a completare i documenti vecchi. */
  async aggiornaDatiAllegato(id, ddt) {
    return chiamaMateriali("PATCH", `/api/allegati/${encodeURIComponent(id)}`, ddt,
      "Impossibile aggiornare i dati del documento.", (d) => d.allegato);
  },

  /** I fornitori già visti da questa azienda, per la tendina del campo
   *  "Fornitore". Se la chiamata non riesce si torna un elenco vuoto: la
   *  tendina è una comodità, non una condizione per lavorare. */
  async elencoFornitori() {
    try {
      const res = await fetch(`${API_BASE}/api/fornitori`, { headers: headerAuth() });
      if (!res.ok) return [];
      const dati = await res.json();
      return Array.isArray(dati.fornitori) ? dati.fornitori : [];
    } catch (e) {
      return [];
    }
  },

  /* --- FATTURE ELETTRONICHE (FatturaPA) ------------------------------------
     Il caricamento LEGGE soltanto: restituisce le righe trovate senza toccare
     i costi. I materiali entrano nei conti solo con importaFattura, dopo che
     l'utente ha assegnato le commesse e confermato. */

  /** Carica il file XML (o .p7m) e restituisce { fattura, lettura, abbinamenti }.
   *  "abbinamenti" sono le PROPOSTE di commessa ricavate dai DDT archiviati:
   *  non assegnano niente da sole, decide la schermata di importazione. */
  async caricaFattura(file) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/fatture`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/xml",
          "X-Nome-File": encodeURIComponent(file.name),
          ...headerAuth(),
        },
        body: file,
      });
    } catch (e) {
      throw new Error("Impossibile contattare il server: riprova.");
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
    if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); throw new Error("Abbonamento richiesto."); }
    if (!res.ok) {
      const dati = await res.json().catch(() => null);
      throw new Error(dati?.errore || "Impossibile leggere la fattura.");
    }
    return await res.json();
  },

  /** Conferma l'importazione: le righe assegnate diventano voci di materiale. */
  async importaFattura(fatturaId, righe) {
    return chiamaMateriali("POST", `/api/fatture/${encodeURIComponent(fatturaId)}/importa`, { righe },
      "Impossibile importare le righe della fattura.", (d) => d);
  },

  /**
   * Carica il PDF di un blocco di DDT scansionati e si fa dire cosa ci ha
   * capito. NON archivia niente: torna un piano, una riga per pagina.
   */
  async leggiScansioneDDT(file) {
    let res;
    try {
      res = await fetch(`${API_BASE}/api/ddt/scansione`, {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-Nome-File": encodeURIComponent(file.name),
          ...headerAuth(),
        },
        body: file,
      });
    } catch (e) {
      throw new Error("Impossibile contattare il server: riprova.");
    }
    if (res.status === 401) { gestoreSessioneScaduta?.(); throw new Error("Sessione scaduta: accedi di nuovo."); }
    if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); throw new Error("Abbonamento richiesto."); }
    if (!res.ok) {
      const dati = await res.json().catch(() => null);
      throw new Error(dati?.errore || "Impossibile leggere la scansione.");
    }
    return await res.json();
  },

  /** Archivia le pagine confermate. Torna { archiviate, saltate, spazio }. */
  async confermaScansioneDDT(scansioneId, righe) {
    return chiamaMateriali("POST", `/api/ddt/scansione/${encodeURIComponent(scansioneId)}/conferma`, { righe },
      "Impossibile archiviare le pagine della scansione.", (d) => d);
  },

  /** Elenco delle fatture già caricate. */
  async elencoFatture() {
    return chiamaMateriali("GET", "/api/fatture", null, "Impossibile leggere le fatture.", (d) => d.fatture);
  },

  /** Stato dell'abbonamento dell'azienda loggata (giorni di prova, se attivo, ecc.). */
  async statoAbbonamento() {
    try {
      const res = await fetch(`${API_BASE}/api/abbonamento/stato`, { headers: headerAuth() });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  },

  /** Avvia il pagamento: ritorna l'URL di Stripe Checkout a cui reindirizzare.
   *  Il piano è facoltativo — senza, il server usa quello scritto sull'azienda —
   *  e comunque il server lo verifica contro i tre esistenti: un identificativo
   *  che non riconosce viene rifiutato, non interpretato. */
  async avviaCheckout(fatturazione, piano) {
    const res = await fetch(`${API_BASE}/api/abbonamento/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headerAuth() },
      body: JSON.stringify({ fatturazione, ...(piano ? { piano } : {}) }),
    });
    if (!res.ok) throw new Error("Impossibile avviare il pagamento.");
    const dati = await res.json();
    return dati.url;
  },

  /** Chiede al server di ricontrollare su Stripe se il pagamento è andato a
   *  buon fine. Serve quando il webhook tarda o si perde: senza questa, chi ha
   *  pagato resterebbe a leggere "prova terminata". */
  async riconciliaAbbonamento() {
    try {
      const res = await fetch(`${API_BASE}/api/abbonamento/riconcilia`, {
        method: "POST",
        headers: headerAuth(),
      });
      if (!res.ok) return { trovata: false };
      return await res.json();
    } catch (e) {
      return { trovata: false };
    }
  },

  /** Apre il portale Stripe per gestire un abbonamento già attivo (metodo di
   *  pagamento, fatture, disdetta). Ritorna l'URL a cui reindirizzare. */
  async avviaPortale() {
    const res = await fetch(`${API_BASE}/api/abbonamento/portale`, {
      method: "POST",
      headers: headerAuth(),
    });
    if (!res.ok) throw new Error("Impossibile aprire la gestione dell'abbonamento.");
    const dati = await res.json();
    return dati.url;
  },

  /** Statistiche di riepilogo per il pannello admin (403 se l'utente non è admin). */
  async adminStatistiche() {
    const res = await fetch(`${API_BASE}/api/admin/statistiche`, { headers: headerAuth() });
    if (!res.ok) return null;
    return await res.json();
  },

  /** Elenco di riepilogo di tutte le aziende, per il pannello admin (403 se non admin). */
  async adminAziende() {
    const res = await fetch(`${API_BASE}/api/admin/aziende`, { headers: headerAuth() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const dati = await res.json();
    return dati.aziende;
  },

  /** Scarica un backup JSON tramite il browser (al posto del salvataggio su file nativo). */
  async backupEsporta(_aziendaId, dati) {
    try {
      const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const nomeFile = `backup-costi-commessa-${timestamp}.json`;
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeFile;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { ok: true, percorso: nomeFile };
    } catch (e) {
      return { ok: false, annullato: false };
    }
  },

  /** Apre il selettore file del browser al posto della dialog nativa. */
  async backupImporta() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ ok: false, annullato: true }); return; }
        try {
          const dati = JSON.parse(await file.text());
          resolve({ ok: true, dati });
        } catch (e) {
          resolve({ ok: false, annullato: false, errore: e.message });
        }
      };
      input.click();
    });
  },
};
