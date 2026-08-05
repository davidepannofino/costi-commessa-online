-- Schema del database — Costi Commessa
-- Pensato per più aziende fin da subito: ogni tabella ha una colonna azienda_id.
-- Tappa 2 (login): azienda_id viene ora popolato con l'azienda dell'utente
-- autenticato (tabella utenti), non più con un valore fisso.

CREATE TABLE IF NOT EXISTS aziende (
  id   TEXT PRIMARY KEY,
  nome TEXT NOT NULL
);
-- Tappa 3 (abbonamento): stato dell'abbonamento Stripe di ogni azienda.
-- "prova" finché non passano i giorni di prova da utenti.creato_il o non si
-- abbona. Quanti giorni siano NON è scritto qui: sta in GIORNI_PROVA dentro
-- src/abbonamento.js, e siccome la scadenza si ricalcola a ogni richiesta,
-- cambiarlo rimisura anche le prove già in corso. Il numero non si duplica qui
-- apposta: due copie dello stesso valore vanno fuori sincrono al primo cambio.
-- "attivo" mentre l'abbonamento Stripe è in regola; "scaduto" se il
-- pagamento fallisce o l'azienda disdice.
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS stato_abbonamento TEXT NOT NULL DEFAULT 'prova';
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS utenti (
  id             SERIAL PRIMARY KEY,
  azienda_id     TEXT UNIQUE NOT NULL REFERENCES aziende(id),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  creato_il      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Token per "password dimenticata": si salva solo l'hash del token (mai il
-- valore mandato via email), scade dopo 1 ora, "usato" blocca il riutilizzo.
CREATE TABLE IF NOT EXISTS reset_password (
  id          SERIAL PRIMARY KEY,
  utente_id   INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  scade_il    TIMESTAMPTZ NOT NULL,
  usato       BOOLEAN NOT NULL DEFAULT false,
  creato_il   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reset_password_token ON reset_password(token_hash);

CREATE TABLE IF NOT EXISTS dipendenti (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  nome           TEXT NOT NULL,
  cognome        TEXT NOT NULL DEFAULT '',
  lordo_mensile  JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_dipendenti_azienda ON dipendenti(azienda_id);

CREATE TABLE IF NOT EXISTS commesse (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id),
  codice      TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_commesse_azienda ON commesse(azienda_id);

CREATE TABLE IF NOT EXISTS registrazioni (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  dipendente_id  TEXT NOT NULL REFERENCES dipendenti(id) ON DELETE CASCADE,
  commessa_id    TEXT NOT NULL REFERENCES commesse(id) ON DELETE CASCADE,
  data           DATE NOT NULL,
  ore            NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registrazioni_azienda ON registrazioni(azienda_id);
CREATE INDEX IF NOT EXISTS idx_registrazioni_dipendente ON registrazioni(dipendente_id);
CREATE INDEX IF NOT EXISTS idx_registrazioni_commessa ON registrazioni(commessa_id);

-- Tappa materiali: costo dei materiali per commessa, inseriti a mano.
-- È una voce di costo AGGIUNTIVA e separata dalla manodopera: non entra mai nel
-- calcolo della tariffa oraria dei dipendenti (che resta lordo mensile / ore del
-- mese) e non altera l'invariante della manodopera. Si somma solo alla fine,
-- per ottenere il costo totale della commessa.
--
-- Il collegamento alla commessa è per ID (come le registrazioni), mai per
-- codice testuale: rinominare una commessa non tocca i suoi materiali.
-- "costo" è una colonna generata dal database: quantità × prezzo non può
-- andare fuori sincrono nemmeno scrivendo sulla tabella da fuori dell'app.
CREATE TABLE IF NOT EXISTS materiali (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id),
  commessa_id     TEXT NOT NULL REFERENCES commesse(id) ON DELETE CASCADE,
  data            DATE NOT NULL,
  fornitore       TEXT NOT NULL DEFAULT '',
  descrizione     TEXT NOT NULL DEFAULT '',
  quantita        NUMERIC NOT NULL,
  prezzo_unitario NUMERIC NOT NULL,
  costo           NUMERIC GENERATED ALWAYS AS (quantita * prezzo_unitario) STORED
);
CREATE INDEX IF NOT EXISTS idx_materiali_azienda ON materiali(azienda_id);
CREATE INDEX IF NOT EXISTS idx_materiali_commessa ON materiali(commessa_id);

-- Tappa DDT (2a): archivio dei documenti allegati a una commessa (PDF o foto).
-- In questo passo il documento viene solo conservato e collegato: nessuna
-- lettura automatica del contenuto.
--
-- DOVE STANNO I FILE. Il contenuto è dentro Postgres (colonna "contenuto"),
-- non su disco: il disco dei servizi Render free è effimero e i file
-- sparirebbero a ogni riavvio. Per non riempire il piano gratuito di Neon
-- (0,5 GB in tutto) le difese sono nel backend: immagini compresse dal
-- browser prima dell'invio, limite per singolo file, quota per azienda e un
-- freno complessivo su tutte le aziende.
--
-- "posizione" e "chiave_esterna" servono al futuro: se un domani i file
-- dovranno stare su uno storage esterno, si potrà spostarli scrivendo
-- posizione='r2' e la chiave del file, senza cambiare la struttura né il
-- resto dell'applicazione.
CREATE TABLE IF NOT EXISTS allegati (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  commessa_id    TEXT NOT NULL REFERENCES commesse(id) ON DELETE CASCADE,
  nome_file      TEXT NOT NULL,
  tipo           TEXT NOT NULL,
  dimensione     INTEGER NOT NULL,
  posizione      TEXT NOT NULL DEFAULT 'database',
  contenuto      BYTEA,
  chiave_esterna TEXT,
  caricato_il    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_allegati_azienda ON allegati(azienda_id);
CREATE INDEX IF NOT EXISTS idx_allegati_commessa ON allegati(commessa_id);

-- Tappa DDT (2c): i dati del documento, per poterlo riconoscere da solo quando
-- arriva la fattura che lo cita. Sono TUTTI E TRE FACOLTATIVI: un DDT si
-- archivia come prima anche lasciandoli vuoti, e i documenti già in archivio
-- restano validi con i campi a vuoto (nessuna migrazione, nessuna riga
-- riscritta: il DEFAULT vale per chi non li compila).
--
-- Il numero vuoto ('') vuol dire "non lo so", e un DDT senza numero non
-- partecipa mai all'abbinamento automatico: meglio nessuna proposta che una
-- proposta costruita sul nulla.
--
-- Perché il fornitore anche qui, se la commessa c'è già: i numeri di DDT NON
-- sono unici fra fornitori diversi. Senza il fornitore, "DDT 4711" da solo non
-- distingue il ferramenta dal cementificio, e abbinare sul solo numero
-- metterebbe i costi sulla commessa sbagliata in silenzio.
ALTER TABLE allegati ADD COLUMN IF NOT EXISTS ddt_numero TEXT NOT NULL DEFAULT '';
ALTER TABLE allegati ADD COLUMN IF NOT EXISTS ddt_data   DATE;
ALTER TABLE allegati ADD COLUMN IF NOT EXISTS fornitore  TEXT NOT NULL DEFAULT '';

-- L'abbinamento parte sempre dal numero, dentro una sola azienda. I DDT senza
-- numero non servono a quella ricerca e stanno fuori dall'indice.
CREATE INDEX IF NOT EXISTS idx_allegati_ddt ON allegati(azienda_id, ddt_numero)
  WHERE ddt_numero <> '';

-- Tappa DDT (2c): da dove viene questa pagina.
--
-- Un blocco di DDT si scansiona tutto insieme: un PDF solo, molte pagine, ogni
-- pagina un documento di una commessa diversa. Il PDF viene diviso e ogni
-- pagina diventa un allegato a sé, con la SUA commessa — la riga resta quella
-- di sempre, e per questo l'abbinamento con le fatture continua a funzionare
-- senza saperne niente.
--
-- Queste due colonne servono a ritrovare la carta. Senza, dodici righe si
-- chiamerebbero tutte "scansione-3-agosto.pdf" e nessuno saprebbe più quale
-- pagina era quale: il giorno che un numero non torna, si va a cercare
-- l'originale, e bisogna sapere a che pagina guardare.
-- Restano vuote per i documenti caricati uno alla volta, che non vengono da
-- nessuna scansione.
ALTER TABLE allegati ADD COLUMN IF NOT EXISTS origine_nome_file TEXT NOT NULL DEFAULT '';
ALTER TABLE allegati ADD COLUMN IF NOT EXISTS origine_pagina    INTEGER;

-- La SOSTA di una scansione, fra la lettura e la conferma.
--
-- Il flusso ha due tempi: prima si legge il blocco e si mostra cosa si e'
-- capito, poi la persona conferma e ogni pagina diventa un DDT archiviato. Fra
-- i due momenti il PDF deve stare da qualche parte, e questa e' quella parte.
--
-- NON e' l'archivio, ed e' il motivo per cui ha una tabella sua invece di una
-- riga in allegati: finche' non si conferma, in archivio non compare niente —
-- che e' la promessa fatta all'utente. Qui c'e' solo il file di partenza, che
-- al momento della conferma viene diviso, e poi cancellato.
--
-- Si svuota da sola: alla conferma, e comunque dopo 24 ore. Una scansione
-- abbandonata a meta' (chiusa la scheda, finita la batteria) non deve restare
-- a occupare spazio per sempre.
CREATE TABLE IF NOT EXISTS scansioni (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  nome_file      TEXT NOT NULL,
  dimensione     INTEGER NOT NULL,
  posizione      TEXT NOT NULL DEFAULT 'database',
  contenuto      BYTEA,
  chiave_esterna TEXT,
  pagine         INTEGER NOT NULL,
  caricata_il    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scansioni_azienda ON scansioni(azienda_id, caricata_il);

-- Tappa DDT (2b): fatture elettroniche XML (FatturaPA) da cui leggere le righe
-- dei materiali. La fattura NON appartiene a una commessa (può riguardarne
-- diverse), quindi ha una tabella sua e non sta fra gli allegati.
-- Il file XML originale si conserva come i DDT: su R2 se configurato, con la
-- stessa colonna "posizione" a dire dove sta.
-- "importata_il" serve a non importare due volte gli stessi costi per errore.
CREATE TABLE IF NOT EXISTS fatture (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id),
  nome_file       TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  dimensione      INTEGER NOT NULL,
  posizione       TEXT NOT NULL DEFAULT 'database',
  contenuto       BYTEA,
  chiave_esterna  TEXT,
  fornitore       TEXT NOT NULL DEFAULT '',
  partita_iva     TEXT NOT NULL DEFAULT '',
  numero          TEXT NOT NULL DEFAULT '',
  data            DATE,
  caricata_il     TIMESTAMPTZ NOT NULL DEFAULT now(),
  importata_il    TIMESTAMPTZ,
  righe_importate INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fatture_azienda ON fatture(azienda_id);

-- Da quale fattura arriva una voce di materiale (vuoto se inserita a mano).
-- ON DELETE SET NULL: cancellando la fattura il costo resta, perde solo il
-- riferimento al documento di provenienza.
ALTER TABLE materiali ADD COLUMN IF NOT EXISTS fattura_id TEXT REFERENCES fatture(id) ON DELETE SET NULL;

-- Consumo di Google Document AI, mese per mese. Document AI è l'unico pezzo a
-- pagamento di tutta l'applicazione e si paga a pagina: questo contatore serve
-- a vedere quanto si sta spendendo e a fermarsi da soli al tetto stabilito,
-- invece di scoprirlo dalla fattura di Google.
CREATE TABLE IF NOT EXISTS consumi_documentai (
  mese     TEXT PRIMARY KEY,          -- 'AAAA-MM'
  pagine   INTEGER NOT NULL DEFAULT 0,
  chiamate INTEGER NOT NULL DEFAULT 0
);

-- ===========================================================================
-- ATTENZIONE — L'AZIENDA CON id 'azienda-prova' CONTIENE DATI REALI
--
-- In produzione quell'id appartiene a PIEMME IMPIANTI SRL: e' l'azienda vera,
-- con le sue commesse, i suoi dipendenti e le sue centinaia di registrazioni.
-- Il nome dell'ID inganna, il nome dell'AZIENDA no: guarda la colonna `nome`.
-- NON cancellare quella riga e non cancellare le righe che la referenziano.
--
-- Perche' si chiama cosi': qui sotto c'era un INSERT che seminava un'azienda
-- 'azienda-prova' per far partire l'applicazione il primo giorno. La
-- registrazione vera e' arrivata dopo, e quella riga era gia' diventata
-- l'azienda del cliente. L'INSERT e' stato tolto — nessun codice lo usava,
-- nessuna prova ne aveva bisogno, e la registrazione crea da se' la propria
-- azienda con un UUID (verificato su un database vuoto: si registra e
-- funziona). Restava solo a fabbricare l'equivoco su ogni database nuovo.
--
-- Sette tabelle puntano ad aziende.id — utenti, commesse, dipendenti,
-- registrazioni, materiali, allegati, fatture — tutte con ON UPDATE NO ACTION:
-- cambiare quell'id NON si propaga da solo e va fatto a mano, in transazione,
-- su centinaia di righe. Non ne vale la pena per un identificatore che
-- l'utente non vede mai. Meglio questo avviso.
-- ===========================================================================
