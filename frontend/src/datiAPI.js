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

  async salva(_aziendaId, dati) {
    try {
      const res = await fetch(`${API_BASE}/api/stato`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headerAuth() },
        body: JSON.stringify(dati),
      });
      if (res.status === 401) { gestoreSessioneScaduta?.(); return; }
      if (res.status === 402) { gestoreAbbonamentoRichiesto?.(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("Salvataggio non riuscito:", e);
    }
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

  /** Carica un file (PDF/JPG/PNG) e lo allega a una commessa. Le immagini
   *  vengono rimpicciolite prima dell'invio: vedi comprimiSeImmagine. */
  async caricaAllegato(commessaId, file) {
    const pronto = await comprimiSeImmagine(file);
    let res;
    try {
      res = await fetch(`${API_BASE}/api/commesse/${encodeURIComponent(commessaId)}/allegati`, {
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

  /** Avvia il pagamento: ritorna l'URL di Stripe Checkout a cui reindirizzare. */
  async avviaCheckout() {
    const res = await fetch(`${API_BASE}/api/abbonamento/checkout`, {
      method: "POST",
      headers: headerAuth(),
    });
    if (!res.ok) throw new Error("Impossibile avviare il pagamento.");
    const dati = await res.json();
    return dati.url;
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
