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
