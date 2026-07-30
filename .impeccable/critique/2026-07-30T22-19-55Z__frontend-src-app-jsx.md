---
target: tutta l'app (secondo giro)
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-07-30T22-19-55Z
slug: frontend-src-app-jsx
---
Method: dual-agent (A: design review a freddo · B: detector + evidenze)

Secondo giro di fila senza evidenze dal render: l'estensione Chrome non è connessa, quindi zero screenshot, zero console, zero misure a schermo. A ha letto tutte le 5.025 righe del sorgente, B ha girato il detector e raccolto evidenze statiche. Il server è vivo (200 su :5173): il blocco è l'estensione, non l'applicazione.

## Design Health Score

| # | Euristica | Punteggio | Δ | Questione principale |
|---|---|---|---|---|
| 1 | Visibilità dello stato | 3 | = | Il numero-eroe è statico mentre il numero secondario della testata è animato; il caricamento iniziale è un "Caricamento dati…" nudo |
| 2 | Corrispondenza col mondo reale | 4 | = | Vocabolario di cantiere, "letto da PDF · controlla i valori", punto delle migliaia forzato |
| 3 | Controllo e libertà | 3 | **+2** | L'annulla sulle ore è raro e giusto — ma eliminare un materiale è istantaneo, non confermato e non annullabile |
| 4 | Coerenza e standard | 2 | = | Due pattern per lo stesso gesto (bottone vs `<tr tabIndex>`); il commento di `Sezione` dichiara px-6/py-4 e due card usano px-7/py-5 |
| 5 | Prevenzione degli errori | 3 | **+1** | Flusso conflitti import, avviso materiale fuori periodo. Ma "Ricarica esempio" e "Svuota tutto" restano adiacenti |
| 6 | Riconoscere vs ricordare | 3 | = | Briciola, contatori, "non filtrate dal periodo in alto". Ma la select di riga mostra solo il codice dove quella di gruppo mostra codice + descrizione |
| 7 | Flessibilità ed efficienza | 2 | = | `vista` è `useState`: nessun instradamento, niente è indirizzabile. Tabella registrazioni non ordinabile, tetto duro a 300 |
| 8 | Estetica e minimalismo | 3 | = | Sistema disciplinato, ma la porta d'ingresso della funzione di punta sono ~80 parole di grigio a 12px |
| 9 | Recupero degli errori | 3 | **+1** | La fascia di salvataggio fallito e `Campo` sono lavoro esemplare; ~10 punti riversano `e.message` grezzo in una notifica da 4,6s |
| 10 | Aiuto e documentazione | 2 | = | Nessun appiglio d'aiuto. "Non quadra" si spiega solo via `title=`, e la pastiglia è `hidden md:` |
| **Totale** | | **28/40** | **+4** | **Buono — fondamenta solide, aree deboli da chiudere** |

## Verdetto di specificità

**Soggettivo (A, a freddo).** Il guscio è generico: barra laterale con gruppi e contatori, testata appiccicata e sfocata, card da 14px su #08080A. Togli le stringhe italiane e questo è un qualunque cruscotto B2B che imita Linear. Ciò che generico non è vive uno strato più sotto, nelle tabelle: la scomposizione manodopera/materiali portata con la stessa grammatica dall'eroe alla tabella al pannello al CSV alla stampa; la card di gruppo DDT col filo di stato; e la tabella mese → lordo → ore → tariffa, che esiste perché questo prodotto **calcola** una tariffa invece di conservarla. La specificità sta nelle colonne, non nella disposizione — e la disposizione è dove avviene l'occhiata di tre secondi del titolare.

**Deterministico (B).** `App.jsx`: uscita 2, **2 rilievi**. `index.html`: uscita 0, pulito.

| regola | posizione | esito |
|---|---|---|
| `side-tab` | `App.jsx:3900` | falso positivo come "tell", ma fattualmente presente: è il filo di stato della card DDT, colorato dallo stato, unico bordo spesso dell'app |
| `layout-transition` | `App.jsx:5002` | parziale: `transition:width` su `.anim-barra`, dove la larghezza *è* il dato; disattivato sotto `prefers-reduced-motion` |

**Il dato nuovo: `overused-font` è sparito.** Ieri erano cinque rilievi su Inter, oggi zero. Il passaggio a Fira Sans si vede anche nella scansione meccanica, non solo negli occhi.

## Impressione generale

Il punteggio sale di quattro punti e sale dove doveva: **controllo e libertà da 1 a 3** è il guadagno più grande, ed è l'annulla sull'eliminazione. Ma il secondo giro rivela una classe di difetti che il primo non poteva vedere: **le regole scritte nei blocchi precedenti non sono state applicate fino in fondo dai loro stessi autori.** Il pavimento di contrasto esiste come token e commento, e poi dieci punti di testo vero usano il colore che quel commento dichiara "non è testo". Il bottone che ho portato a 4,66:1 torna a 3,11:1 al passaggio del mouse. Il commento che dice quale carattere si carica nomina quello sbagliato.

L'opportunità più grande resta strutturale e non è mai stata toccata: **l'applicazione non ha stato nell'URL.**

## Cosa funziona

- **L'annulla sull'eliminazione delle ore.** Nessuna conferma sull'azione fatta cento volte all'ora, ma nove secondi per tornare indietro, e la notifica che raddoppia di vita quando porta un'azione. È progettato sul ritmo reale dell'impiegata, non copiato da una libreria.
- **`Campo` e `ThOrdinabile`.** L'errore spostato fuori dalla `<label>` in un fratello con `aria-describedby` e `role="alert"`; l'ordinamento che è un vero bottone con `aria-sort` e una freccia invisibile ma presente perché le intestazioni non saltino. Due componenti base sistemati a un livello che molti prodotti spediti non raggiungono.
- **Il rifiuto di inventare.** "Manca il lordo… le sue ore valgono 0 €" invece di una tariffa plausibile; la barra vuota a totale zero; XML e PDF etichettati diversi. Il Principio 2 è visibile nell'interfaccia, non solo nel README.

## Questioni prioritarie

### [P0] L'applicazione non ha stato nell'URL

`vista` e `dettaglio` sono `useState`. Il tasto Indietro del browser **esce da Commexa**. Una commessa aperta non si può mettere fra i preferiti, mandare a qualcuno, o ritrovare dopo un ricaricamento; il periodo torna al luglio 2026 cablato a ogni apertura.

*Per il titolare:* apre il telefono, tocca una commessa, gli arriva una chiamata, torna — ed è sulla Dashboard nel mese sbagliato. *Per l'impiegata:* non può tenere una commessa aperta in una seconda scheda mentre ne inserisce le ore.

**Correzione:** `vista`, l'id della commessa aperta, `dal` e `al` nella query string, letti al montaggio, `pushState` al cambio. — `/impeccable harden`

### [P1] Il pavimento di contrasto è rotto dai consumatori dei suoi stessi token

Il commento dichiara `--txt-fioco` a 2,27:1 e lo destina alla "numerazione di riga, non è testo". Poi lo usa per testo vero in **dieci punti**, fra cui l'intervallo di date che dice a quale periodo si riferisce il numero-eroe, e la tariffa media nel pannello di dettaglio — che è il numero di provenienza per cui esiste il Principio 1. `--txt-debole` (2,59:1, "mai testo da leggere") rende **importi in euro**.

E il bottone pieno: `.btn-pieno:hover` passa a `--accento-chiaro` tenendo lo stesso testo. Calcolato: **3,11:1**, contro i 4,66:1 che il commento due blocchi sopra è stato scritto per garantire. La correzione si disfa al passaggio del mouse, sul bottone "Registra" per cui era stata scritta.

Questi sono difetti introdotti dai blocchi correttivi precedenti: la regola è stata scritta e non applicata.

**Correzione:** promuovere tutti quei punti a `--txt-tenue` (4,98:1); lasciare `--txt-fioco` alle due sole numerazioni di riga; per l'hover, scurire il fondo invece di schiarirlo, o portare il testo a bianco pieno. — `/impeccable audit`

### [P1] Il verde significa due cose, adiacenti nella stessa riga

Il verde non è più solo degli euro: lo usano lo stato "abbinato in automatico", la pastiglia dell'abbonamento, lo stato admin, l'avviso "ok", la notifica di successo, la pastiglia "Quadra". In `VistaFatture` il **Totale** di una riga è verde perché è denaro, mentre l'intestazione del suo gruppo è verde perché il software ha trovato l'abbinamento: stessa schermata, stesso verde, due significati.

*Per l'impiegata che verifica un'importazione,* il verde smette di dire qualcosa.

**Correzione:** un trattamento neutro per "confermato" (icona di spunta più `--txt-chiaro`, o il bordo verde forte solo come bordo) e il verde pieno riservato agli importi. — `/impeccable colorize`

### [P2] Il bronzo è diventato il colore d'avviso, perché un ambra non esiste

Nella sola `VistaFatture`: pastiglia d'origine, filo del gruppo, box dello stato abbinamento, blocco avvisi, fondo della riga "da controllare", riga d'avviso, "Righe escluse". Altrove: il box icona di ogni documento, la riga dei dati DDT, la rotella e la barra di caricamento, la riga materiale in modifica, la notifica d'avviso, la fascia dell'avviso tariffa.

Siccome nel sistema non c'è un ambra, l'accento ha assorbito "attenzione" — e così l'unica cosa che il bronzo dovrebbe marcare, la commessa più costosa, compete con una dozzina di vicini. Il blocco 3 ha tolto il bronzo dai grafici; questa è la stessa malattia in un altro organo.

**Correzione:** un token ambra distinto per gli avvisi, e il bronzo ristretto a marchio, voce attiva, link, badge del primo, bottone primario. — `/impeccable colorize`

### [P2] Tipografia dopo il cambio di carattere: grassetto fantasma, classi morte, scala piatta

`index.html` carica i pesi **400, 500, 600**. Otto `<strong>` chiedono **700**, più tre nel rapporto di stampa: il browser li sintetizza, cioè ingrassa artificialmente le aste — su Fira Sans si vede.

`.t-eroe` (45px), `.t-leggibile` e `.card-viva` sono definite e non usate da nessuno: esattamente il peccato che il file stesso denuncia quando ha cancellato `Valore`.

E la scala è piatta dove conta: `.t-sotto` è 13,5px contro un corpo di 13px. Ogni titolo di card supera il proprio contenuto di mezzo pixel e un gradino di peso.

**Correzione:** aggiungere 700 all'URL del carattere oppure sostituire `<strong>` con peso 600; cancellare le tre classi morte; portare `.t-sotto` a ~15px/600. — `/impeccable typeset`

## Bandiere rosse per persona

**Alex (esperto impaziente).** Nessun instradamento: Indietro esce, niente è collegabile, il periodo si azzera a ogni caricamento. Quattro bottoni d'esportazione in fila, di cui due producono entrambi .xlsx senza che sia detto in cosa differiscono. La tabella in cui vive non è ordinabile mentre le altre due dell'app lo sono, e si ferma a 300 righe con la ricerca come unica uscita. Modifica solo via modale. Zero scorciatoie da tastiera in tutto il file.

**Sam (tastiera e lettore di schermo).** `tabIndex={-1}` sul bottone che rivela la password: irraggiungibile da tastiera, ed è l'unico modo per controllare cosa hai scritto. In `VistaCommesse` la riga è un `<tr tabIndex={0}>` — annunciata come riga di tabella, non come comando, senza nome accessibile, e lo Spazio non fa nulla; la stessa azione sulla Dashboard è un vero `<button>`. `useTrappolaFuoco` porta il fuoco sul primo campo: nel pannello di dettaglio è il campo **Data** dei materiali, quindi aprire una commessa scaraventa il fuoco a metà pannello, oltre il codice e oltre il costo — il commento è giusto per un modulo e sbagliato per un pannello che si legge. L'unico `<h1>` della Dashboard è un'etichetta da 11px e il numero-eroe è un `<p>`: la navigazione per intestazioni dà "COSTO DEL PERIODO" e nessun numero. Le notifiche stanno in una regione `aria-live` ma spariscono a tempo: l'"Annulla" viene annunciato e poi tolto dal DOM a metà interazione.

Dalle evidenze di B: **19 dei 35 `<button>` non portano la classe `btn`**, quindi non hanno l'anello di fuoco del sistema e ricadono sul contorno predefinito del browser — che su `#08080A` potrebbe non vedersi. Non misurabile senza browser.

## Osservazioni minori

- **Un commento mente di nuovo, ed è mio:** `App.jsx:4747` dice "Inter si carica da index.html" quando index.html carica Fira Sans. Scritto nel blocco in cui il font è stato spostato, invalidato dal blocco in cui è stato cambiato.
- Il rapporto di stampa manda al commercialista un riquadro tratteggiato "spazio logo": stampare niente è meglio di stampare una scatola vuota.
- Il ritmo verticale fra le viste è 12/9/8/8/8/6: sei valori per una sola relazione.
- `VistaAdmin` reimplementa in 120 righe tre primitivi che esistono già (`Avviso`, `Pillola`, `Sezione`). È lì che si vede la trascuratezza delle schermate non toccate.
- 29 € è presentato a 44px in una schermata e a 34px in un'altra: stesso fatto, due scale, a minuti di distanza.
- `.btn-riga-elimina:focus-visible` non ha un anello proprio: lo eredita solo perché quegli elementi portano anche `btn`. Fragile.
- La schermata principale dell'impiegata si chiama **"Dati"** — l'unica parola generica in un vocabolario altrimenti tutto di cantiere.
- `Bottone` documenta "quattro varianti" ma `primario` e `accento` puntano alla stessa classe.

## Domande

1. Il numero-eroe è un `<p>` e l'unico `<h1>` della Dashboard è un'etichetta da 11px. Se uno sconosciuto leggesse solo la struttura dei titoli, imparerebbe che questo prodotto calcola il costo di una commessa — o non imparerebbe niente?
2. Hai speso pensiero vero su nove secondi di annulla per una riga di ore, e nessuno sull'eliminazione di una riga di materiale che l'impiegata ha copiato a mano dalla fattura di un fornitore. Quale delle due è più difficile da ricostruire alle sei di sera dell'ultimo giorno del mese?
3. Il verde oggi vuol dire sia "questo è denaro" sia "l'ha fatto il software per te", fianco a fianco nella stessa riga. Se dovessi tenerne uno solo, quale dei due si merita l'unico colore saturo di un prodotto che si vende sulla credibilità dei numeri?
