/**
 * LA SCHEDA CHE SALVA HA LETTO I DATI PRIMA CHE QUALCUN ALTRO SCRIVESSE?
 *
 * Il caso: il capocantiere inserisce otto righe alle 17. Il titolare ha una
 * scheda aperta da stamattina che quelle righe non le ha mai viste; alle 18
 * cambia una cifra e il salvataggio automatico manda un mondo che non le
 * contiene. La soglia delle cancellazioni guarda quante righe sparirebbero e
 * otto sta sotto dieci, quindi passa. Il lavoro dell'altro sparisce in silenzio.
 *
 * Ogni scrittura fa salire `aziende.versione_dati`. Chi salva rimanda in
 * `If-Match` la versione che aveva letto: se non e' piu' quella, il salvataggio
 * si rifiuta con 412 e non tocca niente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE L'INTESTAZIONE NON ARRIVA, NON SI BLOCCA NIENTE. È la regola che conta.
 *
 *     If-Match assente  → nessuna condizione, il salvataggio passa come prima
 *     If-Match presente e diverso → 412
 *
 * È la semantica giusta dell'intestazione — una precondizione che non viene
 * posta non e' una precondizione fallita — ma soprattutto e' **la regola in
 * cima a schema.sql spostata dall'SQL all'API**: il codice nuovo deve restare
 * sicuro per la versione PRECEDENTE del client.
 *
 * Perche' non e' teoria. Backend e frontend sono due servizi separati su
 * Render: non vanno in linea nello stesso istante, e nella finestra fra i due
 * il backend nuovo serve un browser che ha ancora il pacchetto di ieri. Peggio,
 * un browser puo' tenersi quel pacchetto in cache per ore dopo la
 * pubblicazione. Se l'assenza di `If-Match` fosse un errore, per tutto quel
 * tempo NESSUNO potrebbe salvare — e il guasto somiglierebbe a un guasto del
 * database, non a un problema di versioni.
 *
 * Il prezzo di questa tolleranza e' che un client vecchio resta esposto al
 * problema che il 412 risolve. È il prezzo giusto: prima non era protetto
 * comunque, quindi non si perde niente, e si guadagna che l'aggiornamento non
 * ha bisogno di essere simultaneo.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * @param attesa  il valore grezzo di If-Match, o null/undefined se non c'e'
 * @param adesso  la versione che il database ha in questo momento
 * @returns true solo se il client ha DICHIARATO una versione e non e' piu' quella
 */
export function schedaVecchia(attesa, adesso) {
  const dichiarata = normalizza(attesa);
  /* Nessuna dichiarazione, nessuna condizione. Vale anche per una stringa
     vuota o fatta di soli spazi: un'intestazione vuota e' un'intestazione che
     non dice niente, non una che dice "versione zero". */
  if (dichiarata === null) return false;
  /* `*` vuol dire "purche' esista", ed esiste sempre: e' la semantica standard
     di If-Match e qui non blocca mai. */
  if (dichiarata === "*") return false;
  return dichiarata !== String(adesso).trim();
}

/**
 * Toglie le virgolette e il marcatore di validatore debole, cosi' `"7"`, `W/"7"`
 * e `7` sono la stessa versione. Un client che rimanda l'ETag cosi' com'e' l'ha
 * ricevuto non deve trovarsi rifiutato per una virgoletta.
 */
function normalizza(valore) {
  if (valore == null) return null;
  const testo = String(valore).trim().replace(/^W\//i, "").replace(/^"|"$/g, "").trim();
  return testo === "" ? null : testo;
}
