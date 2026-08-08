-- ===========================================================================
-- LA REGOLA DI QUESTO FILE — leggila prima di aggiungere una riga qui sotto.
--
-- Questo file viene eseguito a ogni pubblicazione, PRIMA che il codice nuovo
-- serva traffico. Quindi c'è sempre una finestra in cui il database ha già la
-- forma NUOVA e a rispondere agli utenti c'è ancora il codice VECCHIO.
--
-- Ne segue l'unica regola che conta:
--
--     ogni modifica qui dentro deve restare sicura anche per la VERSIONE
--     PRECEDENTE del codice, non solo per quella che si sta pubblicando.
--
-- SI PUÒ, perché il codice di prima non se ne accorge:
--   - aggiungere una tabella;
--   - aggiungere una colonna con un valore predefinito (o NULL-abile);
--   - allentare un vincolo, togliere un CHECK, aggiungere un indice.
--
-- NON SI PUÒ, perché il codice di prima si romperebbe nella finestra:
--   - togliere o rinominare una colonna o una tabella;
--   - mettere un NOT NULL senza valore predefinito;
--   - stringere un vincolo che il codice attuale viola.
--
-- Quelle vogliono DUE PUBBLICAZIONI SEPARATE, in quest'ordine: prima il
-- codice che tollera tutte e due le forme, poi lo schema che toglie la
-- vecchia. Non esiste un comando di pubblicazione più furbo che le renda
-- sicure in una volta sola: è una questione di ordine, non di strumenti.
--
-- Perché la regola sta QUI e non in un documento a parte: questo è il file
-- che si sta modificando nel momento in cui la si sta per violare.
--
-- (Il passo che lo esegue è il comando di pubblicazione del servizio backend
-- su Render. Se lì non ci fosse, la migrazione va data a mano nello stesso
-- punto — prima del deploy del codice nuovo — e la regola vale identica.)
-- ===========================================================================

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

-- QUANDO FINISCE LA PROVA DI QUESTA AZIENDA. Si scrive UNA VOLTA, alla
-- registrazione, e da quel momento e' un fatto sulla riga invece di un conto
-- rifatto a ogni richiesta.
--
-- Prima la scadenza si ricavava da utenti.creato_il + GIORNI_PROVA, e siccome
-- GIORNI_PROVA e' una costante del codice, cambiarla rimisurava la prova di
-- tutti quelli gia' registrati: alzandola regalava giorni a chi era gia'
-- scaduto, abbassandola toglieva l'accesso di colpo a chi stava lavorando.
-- Adesso quella costante decide solo da quanti giorni parte chi si registra
-- DOPO: chi e' gia' dentro ha la sua data scritta qui e non la sposta piu'
-- nessuno.
--
-- Resta NULL-abile di proposito: se per qualsiasi motivo una riga non ce
-- l'avesse, abbonamento.js ripiega sul vecchio conto invece di lasciare fuori
-- qualcuno. Meglio un giorno di prova in piu' che una porta chiusa in faccia.
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS prova_fino_al TIMESTAMPTZ;

-- GLI AVVISI SULLA SCADENZA DELLA PROVA, E QUANDO SONO STATI CHIUSI.
--
-- Tre avvisi in tutto: sette giorni prima, l'ultimo giorno, a scadenza
-- avvenuta. Dopo il terzo non parte piu' niente, mai: e' una promessa scritta
-- dentro il terzo messaggio, e queste tre colonne sono cio' che la mantiene.
--
-- SONO DATE E NON BOOLEANI perche' una data dice anche QUANDO, e il giorno che
-- qualcuno chiedesse "che cosa gli avete mandato e quando", la risposta e' qui
-- invece che nei log di Resend.
--
-- "CHIUSO" E NON "MANDATO", ed e' una differenza voluta. Chi arriva all'ultimo
-- giorno senza aver ricevuto il primo avviso riceve SOLO l'ultimo: il primo
-- viene chiuso senza essere mandato, perche' annunciare una scadenza fra sette
-- giorni a chi ne ha uno sarebbe falso, e mandarne due insieme sarebbe peggio.
-- La colonna significa "questo avviso non partira' piu'".
--
-- Restano NULL-abili: NULL vuol dire "non ancora deciso". Il primo giro dopo
-- questa migrazione le trova tutte NULL, e non manda niente a chi e' scaduto
-- da tempo -- la difesa non e' uno script da eseguire una volta, e' la
-- finestra di sette giorni dentro la condizione (src/avvisiProva.js).
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS avviso_prova_7g_il TIMESTAMPTZ;
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS avviso_prova_1g_il TIMESTAMPTZ;
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS avviso_prova_scaduta_il TIMESTAMPTZ;

-- IL PIANO E COME SI FATTURA. 'cantiere' | 'impresa' | 'struttura', e
-- 'mensile' | 'annuale'. I valori ammessi, i tetti e i prezzi stanno TUTTI in
-- src/piani.js e non qui: un CHECK con la lista dei piani sarebbe una seconda
-- copia delle stesse regole, e due copie vanno fuori sincrono al primo piano
-- nuovo. Qui si tiene solo il posto dove scrivere.
--
-- Restano NULL-abili e piani.js legge il vuoto come 'cantiere' e 'mensile',
-- cioe' il piano piu' piccolo: una colonna non ancora riempita non deve mai
-- far comparire un consiglio a salire di piano che nessuno ha calcolato.
--
-- Il tetto NON blocca niente: queste colonne servono a MOSTRARE quale piano
-- serve, mai a decidere chi puo' lavorare. Nessuna rotta le guarda per
-- rifiutare qualcosa, e non deve cominciare a farlo.
--
-- La riempitura per le aziende gia' esistenti NON e' qui: la fa
-- `node src/assegna-piani.js`, che calcola il mese di punta e scrive il piano
-- che ne risulta. Sta fuori perche' altrimenti le soglie 10/30 finirebbero
-- duplicate in SQL, ed e' esattamente il tipo di doppione che si scopre
-- quando i due posti non dicono piu' la stessa cosa.
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS piano TEXT;
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS fatturazione TEXT;

-- LA TOLLERANZA SUL RINNOVO FALLITO. Fino a quando si tiene aperto a chi ha
-- un pagamento non riuscito mentre Stripe riprova da sola, e quando e'
-- cominciata la serie di fallimenti.
--
-- Perche' la scadenza e' SCRITTA e non calcolata. Quando la data passa,
-- l'accesso si chiude senza bisogno che arrivi nessun webhook: il silenzio
-- chiude, non apre. Se la tolleranza avesse bisogno di un messaggio da fuori
-- per terminare, chiunque sapesse far cadere un webhook non pagherebbe mai
-- piu'. Vale lo stesso ragionamento di prova_fino_al, qui sopra.
--
-- Il valore lo decide src/tolleranza.js a partire da
-- invoice.next_payment_attempt, cioe' dal momento in cui Stripe riprovera'
-- davvero: non e' una durata scelta da noi, e non sta scritta qui ne' altrove
-- come numero di giorni.
--
-- primo_fallimento_il serve al tetto massimo, che si misura dall'inizio della
-- serie e non da ogni singolo tentativo: altrimenti ogni fallimento
-- allungherebbe la corda e chi non paga mai resterebbe dentro per sempre.
--
-- Tutte e due tornano NULL appena un pagamento riesce: un ritardo risolto non
-- deve lasciare strascichi sulla riga.
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS tolleranza_fino_al   TIMESTAMPTZ;
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS primo_fallimento_il  TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS utenti (
  id             SERIAL PRIMARY KEY,
  azienda_id     TEXT UNIQUE NOT NULL REFERENCES aziende(id),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  creato_il      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RIEMPITURA PER CHI ESISTEVA GIA'. Va qui e non sopra perche' legge da utenti,
-- che sopra non esiste ancora.
--
-- L'intervallo e' scritto a mano, 30 giorni, e NON rimanda a GIORNI_PROVA: e'
-- il valore in vigore il 6 agosto 2026, cioe' la scadenza che quelle aziende
-- avevano gia' in quel momento. Congelare esattamente quella e' il punto — la
-- migrazione non deve regalare ne' togliere un giorno a nessuno. Se qui ci
-- fosse una lettura della costante, il giorno che qualcuno la cambia questa
-- riga rifarebbe i conti in modo diverso, che e' proprio il difetto da cui si
-- sta uscendo.
--
-- Tocca solo le righe ancora vuote, quindi rieseguirla non cambia niente.
UPDATE aziende a
   SET prova_fino_al = u.creato_il + INTERVAL '30 days'
  FROM utenti u
 WHERE u.azienda_id = a.id
   AND a.prova_fino_al IS NULL;

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

-- CHI NON LAVORA PIU' QUI. Sparisce dagli elenchi dove si inseriscono le ore,
-- ma la riga resta e con lei tutte le sue registrazioni: i costi delle commesse
-- passate non cambiano di un centesimo.
--
-- Prima esisteva solo la cancellazione, e cancellare una persona portava via
-- tutte le sue ore. Chi voleva conti corretti era costretto a tenersi in
-- elenco anche chi se n'era andato tre anni fa; chi voleva l'elenco pulito
-- perdeva lo storico. Nessuna delle due e' una scelta che si puo' chiedere a
-- qualcuno di fare su dati di costo del personale.
--
-- Il valore predefinito e' 'false' e nessun riempimento serve: tutti quelli
-- gia' presenti sono, per definizione, attivi.
--
-- QUESTA COLONNA NON SI CONTA PER IL PIANO. La capienza si misura sul mese di
-- punta delle registrazioni (vedi src/abbonamento.js), che non guarda questa
-- tabella. Il motivo sta li' ed e' il ricambio, non la mancanza di un flag:
-- adesso il flag c'e', e la ragione regge lo stesso.
ALTER TABLE dipendenti ADD COLUMN IF NOT EXISTS archiviato BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS commesse (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id),
  codice      TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_commesse_azienda ON commesse(azienda_id);

-- Il legame col DIPENDENTE e' RESTRICT: il database si rifiuta di cancellare
-- una persona finche' ha ore registrate. Chi non lavora piu' si archivia
-- (dipendenti.archiviato), non si cancella.
--
-- Quello con la COMMESSA resta CASCADE, e la differenza e' voluta: una
-- commessa cancellata e' un lavoro che non c'e' mai stato, e le sue ore non
-- vogliono dire piu' niente; un dipendente cancellato e' una persona che se
-- n'e' andata, ma le ore che ha fatto restano il costo di lavori veri.
CREATE TABLE IF NOT EXISTS registrazioni (
  id             TEXT PRIMARY KEY,
  azienda_id     TEXT NOT NULL REFERENCES aziende(id),
  dipendente_id  TEXT NOT NULL REFERENCES dipendenti(id) ON DELETE RESTRICT,
  commessa_id    TEXT NOT NULL REFERENCES commesse(id) ON DELETE CASCADE,
  data           DATE NOT NULL,
  ore            NUMERIC NOT NULL
);

-- I database gia' esistenti hanno il vincolo con CASCADE: CREATE TABLE IF NOT
-- EXISTS non tocca una tabella che c'e' gia', quindi va rifatto qui.
-- Si guarda confdeltype ('c' = CASCADE, 'r' = RESTRICT) invece del solo nome,
-- cosi' rieseguire la migrazione non fa niente e non serve ricordarsi se e'
-- gia' stata data.
--
-- SI CONTA SU 'regclass' e non sul nome della tabella: cosi' la ricerca segue
-- il search_path e uno schema di prova sistema il PROPRIO vincolo, non quello
-- dello schema public.
--
-- COSA NON CAMBIA. Il salvataggio automatico cancella le registrazioni PRIMA
-- dei dipendenti, quindi quando arriva a cancellare una persona non c'e' piu'
-- niente che la citi e questo vincolo non scatta: "Svuota tutto" continua a
-- svuotare. La rete e' per la prossima rotta che cancellera' un dipendente da
-- solo, e per le DELETE scritte a mano sul database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'registrazioni'::regclass
       AND conname  = 'registrazioni_dipendente_id_fkey'
       AND confdeltype = 'c'
  ) THEN
    ALTER TABLE registrazioni DROP CONSTRAINT registrazioni_dipendente_id_fkey;
    ALTER TABLE registrazioni
      ADD CONSTRAINT registrazioni_dipendente_id_fkey
      FOREIGN KEY (dipendente_id) REFERENCES dipendenti(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_registrazioni_azienda ON registrazioni(azienda_id);
CREATE INDEX IF NOT EXISTS idx_registrazioni_dipendente ON registrazioni(dipendente_id);
CREATE INDEX IF NOT EXISTS idx_registrazioni_commessa ON registrazioni(commessa_id);

-- ===========================================================================
-- PIU' UTENTI PER AZIENDA (tappa 1).
--
-- Quattro modifiche, tutte compatibili con la versione PRECEDENTE del codice
-- come pretende la regola in cima a questo file: si allenta un vincolo e si
-- aggiungono tre colonne con un valore predefinito. Nessuna riga viene
-- riscritta, e il codice vecchio nella finestra fra migrazione e deploy non si
-- accorge di niente.
-- ===========================================================================

-- 1. VIA L'UNICITA' DI azienda_id. Era lei a dire "un utente per azienda", ed e'
--    la riga che PRODUCT.md citava come prova che il multiutente fosse un cambio
--    di modello dati. Si cerca il vincolo per FORMA e non per nome: il nome
--    predefinito di Postgres e' utenti_azienda_id_key, ma un database creato a
--    mano potrebbe averne un altro, e un DROP per nome fallirebbe in silenzio
--    lasciando il vincolo dov'e'.
DO $$
DECLARE nome_vincolo TEXT;
BEGIN
  SELECT c.conname INTO nome_vincolo
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = to_regclass('utenti')
     AND c.contype = 'u'
     AND a.attname = 'azienda_id'
     AND array_length(c.conkey, 1) = 1
   LIMIT 1;
  IF nome_vincolo IS NOT NULL THEN
    EXECUTE format('ALTER TABLE utenti DROP CONSTRAINT %I', nome_vincolo);
  END IF;
END $$;

-- L'indice che serviva a quel vincolo se ne va con lui, ma le letture per
-- azienda restano — abbonamento.js e admin.js ci passano a ogni richiesta.
CREATE INDEX IF NOT EXISTS idx_utenti_azienda ON utenti(azienda_id);

-- 2. IL RUOLO. 'titolare' | 'ore'. I valori ammessi stanno in src/ruoli.js e non
--    qui, per la stessa ragione dei piani: un CHECK con l'elenco sarebbe una
--    seconda copia delle stesse regole, e due copie divergono al primo ruolo
--    nuovo. Il valore predefinito e' 'titolare' perche' chi esiste gia' E'
--    titolare: nessun riempimento da eseguire, e chi si registra domani apre
--    la propria azienda, quindi lo e' per definizione.
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS ruolo TEXT NOT NULL DEFAULT 'titolare';

-- 3. CHI HA SCRITTO UNA RIGA DI ORE. Serve al permesso, non alla statistica: chi
--    inserisce puo' correggere e cancellare le PROPRIE righe e nessun'altra.
--
--    Resta NULL-abile, e le righe che esistono oggi restano a NULL: sono di
--    nessun utente `ore`, quindi nessuno di loro puo' toccarle. La difesa nasce
--    dalla forma del dato invece che da uno script di riempimento -- come la
--    finestra di sette giorni degli avvisi di prova.
--
--    ON DELETE SET NULL e non CASCADE: togliere un utente non deve portarsi via
--    le ore che ha inserito. E' il Principio 6 di PRODUCT.md applicato agli
--    utenti invece che ai dipendenti -- un costo gia' registrato non si cancella
--    insieme a chi l'ha prodotto.
--
--    VERIFICATO, non dedotto (9 agosto 2026, schema usa-e-getta prova_fk): tre
--    righe prima, tre dopo, zero ore perse. Le due righe dell'utente cancellato
--    passano a NULL, quella dell'altro utente non si tocca.
--
--    LA CONSEGUENZA VA SAPUTA: una riga con inserita_da a NULL non e' di nessun
--    utente `ore`, quindi da quel momento NESSUNO di loro puo' piu' correggerla
--    o cancellarla -- solo il titolare. E' il comportamento giusto (le ore di
--    chi se n'e' andato non sono di chi resta) ma non e' ovvio, e chi cancella
--    un utente sta anche congelando le righe che quello aveva scritto.
--
--    ────────────────────────────────────────────────────────────────────────
--    QUESTA COLONNA E' UN PERMESSO, NON UNA PROVA. Leggila prima di costruirci
--    sopra un registro di chi ha fatto cosa.
--
--    Serve a una domanda sola: «questa riga la puo' correggere chi sta
--    chiedendo?». Non risponde a «chi l'ha scritta davvero», e non puo': il
--    titolare imposta lui la password degli utenti che crea e puo' reimpostarla
--    quando vuole -- e' l'unico modo di far entrare chi non ha un'email vera.
--    Quindi puo' entrare come chiunque, in qualsiasi momento, e scrivere righe
--    che risultano di un altro.
--
--    Non e' un difetto da chiudere: e' la conseguenza di una scelta presa per
--    il caso vero, dove il capocantiere riceve la password a voce. Ma un
--    registro di responsabilita' costruito su questa colonna sarebbe
--    falsificabile dal titolare PER COSTRUZIONE, e sembrerebbe attendibile.
--    Se un giorno servira' davvero sapere chi ha scritto cosa, servira' prima
--    che le password non passino piu' dalle mani del titolare.
--    ────────────────────────────────────────────────────────────────────────
ALTER TABLE registrazioni ADD COLUMN IF NOT EXISTS inserita_da INTEGER REFERENCES utenti(id) ON DELETE SET NULL;

-- 4. LA VERSIONE DEI DATI. Un contatore che sale a ogni scrittura, qualunque
--    strada l'abbia fatta.
--
--    A cosa serve: con due persone che lavorano insieme, una scheda aperta da
--    stamattina afferma un mondo intero che non contiene le righe scritte nel
--    frattempo dall'altra. Il salvataggio riesce, e quelle righe spariscono. La
--    soglia delle cancellazioni non lo intercetta -- otto righe stanno sotto
--    dieci -- e comunque non vedrebbe le SOVRASCRITTURE, che non cancellano
--    niente.
--
--    Chi salva rimanda la versione che aveva letto, in un'intestazione If-Match;
--    se non coincide il server risponde 412 e non tocca niente. E' la voce 1 di
--    MIGLIORAMENTI.md, che quell'intestazione la chiede per nome.
ALTER TABLE aziende ADD COLUMN IF NOT EXISTS versione_dati BIGINT NOT NULL DEFAULT 0;

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
