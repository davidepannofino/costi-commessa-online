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
const API_BASE = import.meta.env.VITE_API_URL || "";

export const datiAPI = {
  async carica() {
    try {
      const res = await fetch(`${API_BASE}/api/stato`);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dati),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("Salvataggio non riuscito:", e);
    }
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
