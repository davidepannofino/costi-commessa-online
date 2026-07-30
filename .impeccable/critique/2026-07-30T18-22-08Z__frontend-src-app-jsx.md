---
target: la Dashboard e la schermata Dati
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-30T18-22-08Z
slug: frontend-src-app-jsx
---
Method: dual-agent (A: design review · B: detector + evidenze)

Nessuna evidenza dal render: l'estensione Chrome non era connessa, quindi zero screenshot, zero console, zero misure a schermo, nessun overlay visibile. Tutto ciò che segue è sorgente + contrasti calcolati dai token e riverificati a mano.

## Design Health Score

| # | Euristica | Punteggio | Questione principale |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | Su Dati la testata dichiara un totale di periodo che la tabella sotto ignora (`4155-4165` filtra solo per testo, mostra tutto lo storico). |
| 2 | Corrispondenza col mondo reale | 4 | Genuinamente eccellente: «Manca il lordo di … : le sue ore valgono 0 €», «e altre 12 commesse nel periodo →», «Azioni che cancellano». |
| 3 | Controllo e libertà | 1 | L'eliminazione di una riga è immediata e irreversibile senza annulla (`4269`); nessun focus trap né ripristino del focus in `Modale` (`798`) e nel pannello (`2932`). |
| 4 | Coerenza e standard | 2 | `badge-codice-primo` significa «più costosa» a `2709` ma «quella che hai aperto» a `2949`; la tabella di Dati non è ordinabile mentre Commesse sì; `Valore` (`672`) è codice morto. |
| 5 | Prevenzione degli errori | 2 | «Ricarica esempio» e «Svuota tutto» sono bottoni fratelli adiacenti (`4331`); il modale di conferma generico ha sempre un primario rosso «Elimina» (`2394`). |
| 6 | Riconoscere invece di ricordare | 3 | Il selettore commessa è un `<select>` nativo (`4208`): con 60 commesse si deve ricordare il codice. |
| 7 | Flessibilità ed efficienza | 2 | Invio-per-inserire e ritorno del focus su Ore sono veri guadagni, annullati dalla banda non fissa, dalla tabella non ordinabile, da nessuna duplicazione di riga. |
| 8 | Estetica e minimalismo | 3 | Disciplinato, ma il bronzo compare in almeno sei punti nell'area contenuti, e `#A6753A` (`2490`) è un esadecimale fuori dal sistema di token. |
| 9 | Diagnosi e recupero degli errori | 2 | Zero `aria-invalid` e zero `aria-describedby` in tutto il file; la pila di avvisi ambra (`2315`) non si può chiudere e cresce di una riga per dipendente per mese. |
| 10 | Aiuto e documentazione | 2 | Niente distingue «Excel» da «Esporta tutto» (entrambi .xlsx); «Quadra» è spiegato solo in un attributo `title`, invisibile a dito e tastiera. |
| **Totale** | | **24/40** | **Accettabile — servono miglioramenti sostanziali** |

## Verdetto di specificità

**Valutazione soggettiva (A).** Togliere la fascia dei quattro KPI ha funzionato, e la banda-eroe fuori dalla card è la scelta giusta per un tema scuro. La classifica cliccabile al posto del grafico a barre è l'unica composizione davvero specifica di questo prodotto: ogni riga è *una cosa che si apre*, che è esattamente ciò che una commessa è, e un grafico non potrà mai esserlo. Il resto è un cruscotto amministrativo competente vestito Linear: ciò che lo fa leggere come software da cantiere è il vocabolario (commessa, DDT, lordo, «8 o 0,5») e il pannello di dettaglio, non la disposizione. La verità di prodotto più profonda — *un numero senza provenienza non vale niente* — sulla Dashboard è quasi muta: il numero-eroe da 56px è l'unico numero della schermata che non si può aprire, e «Quadra», l'unica affermazione che un foglio Excel non può strutturalmente fare, è una pastiglia da 20px nascosta sotto i 768px e soppressa proprio sulla Dashboard.

**Scansione deterministica (B).** `detect.mjs` su `frontend/src/App.jsx`: uscita 2, **4 rilievi**, tutti warning.

| regola | posizione | esito |
|---|---|---|
| `side-tab` | `4:3734` | **falso positivo** — è l'unico bordo spesso dell'app, di stato non decorativo, dichiarato nel commento accanto |
| `overused-font` | `4:4544` e `4:4618` | **falso positivo per questo progetto** — Inter è fissato dal brief validato; il brief vince su un avviso di saturazione |
| `layout-transition` | `4:4745` | **falso positivo** — `transition: width` su `.anim-barra`; la larghezza *è* il valore codificato, `scaleX` deformerebbe |

Quattro rilievi, zero difetti reali: il detector qui non ha trovato nulla che l'occhio non avesse già assolto. Il valore vero di B è arrivato dalla lettura statica delle regole di focus, non dalle sue regole.

**Overlay visivi.** Nessuno. L'estensione non era connessa, quindi non esiste alcun overlay nel browser e nessuna misura di overflow, sovrapposizione o anello di focus a schermo.

## Impressione generale

Le tre mosse strutturali hanno tenuto: la banda-eroe, la classifica, l'elenco unico. Il problema non è più la disposizione — è che **il livello di rifinitura non regge il confronto con la disposizione**. Sotto una composizione ormai buona ci sono un pavimento di contrasto sotto la soglia su quasi tutte le etichette, un pulsante di eliminazione irreversibile nella tabella che si usa cento volte all'ora, e un'accessibilità da tastiera che si ferma al bordo dei modali. La singola opportunità più grande: **il numero-eroe è inerte**. È il pezzo di schermo più grande del prodotto e non risponde alla domanda che il prodotto stesso dichiara di voler risolvere — da dove viene questo numero.

## Cosa funziona

- **`BandaEroe` che rifiuta la card** (`2576-2601`). Ragionamento e resa coincidono: su `#08080A` a 56px il totale non ha vicini della sua taglia, e la barra a due segmenti con i due importi etichettati risponde alla domanda successiva («manodopera o materiali?») dentro lo stesso movimento dell'occhio. Nessuna legenda, nessuna seconda occhiata.
- **«Dove va la spesa» come elenco e non come grafico** (`2693-2727`). Ordinato, denso, raggiungibile da tastiera, ogni riga un vero `<button>`. La barra da 92px porta la proporzione senza bisogno di un asse. È la composizione che non si potrebbe trapiantare in un altro SaaS senza modifiche.
- **La stessa grammatica a tre scale** (`2576` → `2946-2975`). La testata del pannello ripete esattamente la banda-eroe: badge, cifra verde grande, barra a tre pixel, due importi etichettati. È il motivo per cui il pannello non richiede apprendimento — è la banda rimpicciolita, non un'altra schermata.

## Questioni prioritarie

### [P0] Il pavimento di contrasto è sotto la soglia su quasi ogni etichetta

`--txt-fioco #4A4A50` su `#08080A` è **2,27:1**; su card `#0D0D10` è 2,21:1. È il colore predefinito di `.t-micro` (`4640`) e di **ogni** `.tabella th` (`4703`). Quindi ci cadono dentro: l'`<h1>` della Dashboard «COSTO DEL PERIODO» (`2579`), le quattro etichette del libro mastro (`2609`), «AZIONI CHE CANCELLANO» (`4329`), le intestazioni di gruppo della barra laterale (`2120`), e le colonne DATA / DIPENDENTE / COMMESSA / ORE della tabella dell'impiegata (`4252`). Anche la variante «buona», `--tenue #71717A` usata dal componente `Micro`, è **4,14:1**: sotto 4,5. E il bottone primario, `#F0E7DA` su `#8A6D4B`, è **3,92:1** a 13px — è il bottone «Registra».

**Perché conta:** PRODUCT.md dice esplicitamente che per questi utenti contrasto e dimensione del testo «non sono materia di gusto» — persone non giovani, non tecniche, su un telefono in cattiva luce. Oggi l'impiegata non legge in che colonna si trova e il titolare non legge come si chiama il numero grande.

**Correzione:** `--txt-fioco` → circa `#8A8A93` (≈5,3:1) per tutto il maiuscoletto e le intestazioni di tabella; tenere `#4A4A50` solo per la numerazione non semantica delle righe. Per il bottone pieno, schiarire `--accento-testo` a `#FFFBF5` o scurire il fondo bronzo, fino a superare 4,5:1.

**Comando:** `/impeccable audit`

### [P1] L'eliminazione di una riga è immediata, irreversibile e senza rete, proprio nella tabella che si usa cento volte all'ora

`4269-4270`: clic → sparita → «Registrazione eliminata.» Nessuna conferma, nessun annulla nella notifica (che rende solo testo), e il bersaglio è circa 24×24px. Nel frattempo eliminare una *commessa* apre un modale intero.

**Perché conta:** è esattamente il modo in cui l'impiegata sbaglia — un'ora di lavoro veloce e a bassa attenzione accanto a un controllo irreversibile da 24px. E il recupero non esiste: l'unico rollback è il backup JSON due sezioni più giù nella stessa pagina.

**Correzione:** tenere l'eliminazione immediata (la velocità serve) ma dare alla notifica un'azione «Annulla» per circa 8 secondi, con la riga in stato di cancellazione sospesa. Bersaglio a 32×32 minimo. E togliere il contorno rosso permanente da ogni riga: trecento contorni rossi distruggono il valore di segnale del rosso.

**Comando:** `/impeccable harden`

### [P1] Su Dati la testata dichiara un periodo che la tabella ignora

La testata rende «Costo del periodo · 8.574,00 €» in verde da 27px su ogni vista non-Dashboard (`2268-2275`), mentre `elenco` (`4155-4165`) filtra le registrazioni **solo per testo** e mostra tutto lo storico dalla più recente. Niente sullo schermo lo dice. In più il contatore in intestazione mostra `registrazioni.length` anche mentre una ricerca è attiva.

**Perché conta:** il titolare che guarda Dati legge la tabella come il contenuto di quel totale. Non lo è. Questo è un prodotto la cui credibilità è tutta nei numeri: due ambiti diversi sulla stessa schermata senza un'etichetta è il modo di sbagliare che il Principio 1 esiste per impedire.

**Correzione:** o si filtra la tabella su `dal`/`al` con una via d'uscita «mostra tutte», o si etichetta l'intestazione «Tutte le registrazioni · non filtrate dal periodo» e si mostra lì `elenco.length di registrazioni.length`.

**Comando:** `/impeccable clarify`

### [P1] L'accessibilità da tastiera si ferma al bordo dei modali

Sistemico, verificato per grep su tutto il file: **zero `aria-invalid`, zero `aria-describedby`**. Il componente `Campo` (`658-664`) mette l'errore *dentro* la `<label>`, quindi «Le ore devono essere maggiori di zero» diventa parte del **nome accessibile** del campo — riletto a ogni fuoco per sempre, e mai annunciato nel momento in cui compare. Nessun focus trap in `Modale` (`798`) né nel pannello (`2932`), benché entrambi dichiarino `aria-modal="true"`: il Tab esce dietro. Nessun focus iniziale e nessun ripristino: chiudere il pannello con Escape lascia il focus su `<body>`. Né la barra laterale né la navigazione mobile impostano `aria-current="page"`: lo stato attivo è un colore e un filo bronzo, entrambi invisibili a chi non vede. E B ha aggiunto il tassello mancante dal lato CSS: `.campo:focus` e `.campo-nudo:focus` fanno `outline:none` e segnalano il fuoco solo con bordo e fondo — su un campo di testo, per chi naviga da tastiera.

**Perché conta:** l'impiegata passa l'ora dentro campi e tabelle. Questa è la persona per cui la tastiera *è* l'interfaccia, vedente o no.

**Comando:** `/impeccable audit`

### [P2] Il bronzo non è più un accento, e un bronzo non è nemmeno un token

Il commento a `4573` scrive la regola («Se comincia a comparire su ogni riga non è più un accento») e la Dashboard la viola: badge del primo (`2709`), barra del primo (`2713`), link «Tutte le commesse» (`2698`), tutto il tratto e il gradiente dell'area «Giorno per giorno» (`2765-2773`), l'ultima barra di «Costo per mese» (`2510`), più logo e voce attiva. Sei eventi bronzo, non uno. E la variazione mese su mese usa `#A6753A` quando i costi salgono (`2490`) — un settimo bronzo che non esiste in nessun token — e usa il **verde** quando scendono, rompendo la regola fissata che il verde significa solo importi in euro.

**Perché conta:** il bronzo è diventato il colore generico del «questo è notevole», quindi non marca più niente. E una percentuale verde insegna all'occhio che il verde a volte vuol dire «bene», così le cifre in euro smettono di leggersi come denaro.

**Correzione:** bronzo solo per il badge del primo e la voce attiva. Area e ultima barra in `--txt-attenuato`. Variazione in `--txt-medio` con un'icona disegnata, non un colore e non un glifo `▲`.

**Comando:** `/impeccable quieter`

## Bandiere rosse per persona

**Alex (utente esperto e impaziente).** La banda d'inserimento non è fissa: risale la pagina dopo ogni quindicina di righe, per sempre. La tabella di Dati ha `<th>` semplici mentre Commesse è interamente ordinabile — impara che l'app ordina, poi scopre che l'unica tabella in cui vive non lo fa. L'`onKeyDown` sta sul `<div>` della griglia e non su un `<form>`: Invio spara `registra()` mentre il focus è ancora nel `<select>` Dipendente, e siccome la validazione gira solo alla conferma si becca tre errori rossi invece di passare al campo dopo. Il selettore commessa è un `<select>` nativo: con 60 commesse è il controllo più lento della sua schermata più veloce. Il tetto di 300 righe gli dice «usa la ricerca», ma la ricerca non dà un conteggio dei risultati.

**Sam (tastiera e lettore di schermo).** Tutto il blocco P1 qui sopra. In più: «Quadra / Non quadra» è un pallino colorato più un `title`, e nessun testo accessibile spiega cosa sia la quadratura o perché sia fallita. La variazione mensile è `▲`/`▼` più colore: sente «triangolo nero rivolto in alto» e il significato della direzione è portato solo dalla tinta. Entrambi i blocchi Recharts non hanno alternativa testuale né tabella di ripiego: «Andamento mensile» per lui semplicemente non esiste.

## Osservazioni minori

- **Un bug vero, non un dettaglio:** `Dashboard` chiama `useMemo` (`2630`) *dopo* un `return null` anticipato (`2626`). È una violazione delle regole degli hook che oggi sopravvive solo perché `riep` è stabile; se `riep` passasse da null a valorizzato mentre la Dashboard è montata, React lancerebbe. Da correggere comunque.
- `Valore` (`672-678`) è codice morto, zero chiamate: l'ha reso tale la sostituzione della fascia KPI, e `BandaEroe` reimplementa la stessa idea in linea.
- `--accent` e `--accento` sono entrambi vivi: il «ponte» verso i vecchi nomi doveva essere temporaneo ed è diventato permanente.
- Due commenti ora mentono: sopra la testata c'è scritto che «Ora è chiara» e si parla del «verde degli euro su avorio», sopra codice che rende `rgba(8,8,10,.82)`. PRODUCT.md fa dei commenti parte della voce del prodotto: questi due la tradiscono.
- `BandaEroe` mette `quotaMano = 1` quando il totale è 0, quindi un periodo vuoto rende una barra grigia piena che rappresenta il nulla.
- «Chi ha lavorato» non ha tetto mentre la classifica si ferma a 8: un'azienda con 30 dipendenti ottiene una colonna da circa 2000px accanto a un grafico da 186px.
- La navigazione mobile usa `repeat(NAV.length, 1fr)` con 6 voci (7 per l'admin): circa 62px per cella a 375px, e le etichette da 10,5px non hanno `truncate`. «Abbonamento» e «Amministrazione» andranno a capo o usciranno.
- Le spaziature delle card divergono: `Sezione` usa `px-7 py-5`, le card della Dashboard `px-6 py-4`. Due ritmi nella stessa famiglia di pagine.
- Il font è caricato con `@import` dentro un `<style>` a runtime: scoperto tardi e bloccante: il numero-eroe da 56px farà un salto visibile al primo disegno.
- Lo stile di stampa onora l'impegno di PRODUCT.md fino in fondo, azzerando anche `html` e `color-scheme`. È un dettaglio facile da mancare e non è stato mancato.

## Domande

1. Il Principio 1 dice che un numero senza provenienza non vale niente. Perché allora il totale da 56px è l'unico numero della Dashboard che non si può aprire? Ogni riga della classifica apre un pannello; la cifra che conta di più non apre niente.
2. «Quadra» è l'unica affermazione che questo prodotto fa e che un foglio di calcolo non può strutturalmente fare. Perché è una pastiglia da 20px, nascosta sotto i 768px, e soppressa proprio sulla Dashboard — sul dispositivo che PRODUCT.md dice essere quello del titolare?
3. Se l'ora dell'impiegata è il vero vincolo di progetto, perché la sua schermata condivide una card con «Svuota tutto», mostra un totale di un periodo che la sua tabella ignora, ed è l'unica tabella dell'app che non si può ordinare?
