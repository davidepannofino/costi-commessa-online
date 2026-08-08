---
name: Commexa
description: Il registro di cantiere, in un tema scuro denso dove il numero è il contenuto.
colors:
  bronzo-spento: "#8A6D4B"
  bronzo-chiaro: "#A88B66"
  bronzo-inchiostro: "#FFFBF5"
  bronzo-velo: "#211B12"
  bronzo-bordo: "#3A2E1E"
  verde-importo: "#4ADE80"
  verde-velo: "#0D2318"
  verde-bordo: "#16432A"
  ambra-controllare: "#D9A441"
  ambra-velo: "#241B0C"
  ambra-bordo: "#4A3818"
  rosso-guasto: "#F09595"
  rosso-velo: "#2A1315"
  rosso-bordo: "#4A2226"
  fondo-app: "#08080A"
  fondo-barra: "#0A0A0D"
  fondo-card: "#0D0D10"
  fondo-rialzato: "#131317"
  fondo-passaggio: "#16161A"
  fondo-pillola: "#18181C"
  bordo: "#1A1A1F"
  bordo-tenue: "#131316"
  bordo-campo: "#1F1F24"
  testo-primo: "#FAFAFA"
  testo-chiaro: "#F4F4F5"
  testo-medio: "#E4E4E7"
  testo-attenuato: "#A1A1AA"
  testo-etichetta: "#8A8A93"
  testo-tenue: "#7E7E88"
  testo-decorativo: "#52525B"
typography:
  display:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.008em"
  subtitle:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  body:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.06em"
  numeric:
    fontFamily: "Fira Sans, -apple-system, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
rounded:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "16px"
spacing:
  riga: "13px"
  cella: "16px"
  card: "24px"
  banda: "40px"
components:
  button-primary:
    backgroundColor: "{colors.bronzo-spento}"
    textColor: "{colors.bronzo-inchiostro}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "#7A6042"
    textColor: "{colors.bronzo-inchiostro}"
  button-ghost:
    backgroundColor: "{colors.fondo-rialzato}"
    textColor: "{colors.testo-chiaro}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.rosso-guasto}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-row-delete:
    backgroundColor: "{colors.fondo-rialzato}"
    textColor: "{colors.testo-tenue}"
    rounded: "{rounded.sm}"
    size: "32px"
  button-row-delete-hover:
    backgroundColor: "{colors.rosso-velo}"
    textColor: "{colors.rosso-guasto}"
  card:
    backgroundColor: "{colors.fondo-card}"
    rounded: "{rounded.md}"
    padding: "24px"
  input:
    backgroundColor: "{colors.fondo-rialzato}"
    textColor: "{colors.testo-chiaro}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  badge-code:
    backgroundColor: "{colors.fondo-pillola}"
    textColor: "{colors.testo-attenuato}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  badge-code-first:
    backgroundColor: "{colors.bronzo-spento}"
    textColor: "{colors.bronzo-inchiostro}"
    rounded: "{rounded.xs}"
    padding: "3px 8px"
  nav-item-active:
    backgroundColor: "{colors.fondo-passaggio}"
    textColor: "{colors.testo-chiaro}"
    rounded: "{rounded.sm}"
    padding: "8px 12px 8px 14px"
---

# Design System: Commexa

## Overview

**Creative North Star: "Il registro di cantiere"**

Il libro dei conti tenuto bene. Righe, colonne, numeri incolonnati, nessun ornamento — e un solo inchiostro colorato, il bronzo, per segnare la voce che conta più delle altre. Ogni decisione di questo sistema si spiega guardando un registro: perché le tabelle sono il cuore e non un ripiego, perché il colore è quasi assente, perché una cifra si allinea alla virgola con quella di sopra, perché la pagina è densa senza essere stretta.

Il sistema serve due persone dentro la stessa impresa: chi guarda un totale in tre secondi e chi inserisce cento righe in un'ora. Non sono due modi diversi, sono due velocità della stessa pagina — e ogni schermata deve reggerle entrambe. Da qui la densità: 13px di corpo, righe di tabella da 13px di respiro verticale, e in cambio il numero che conta portato a una scala che nel resto dell'interfaccia non esiste.

Il tema è scuro perché la scena d'uso lo chiede — un ufficio la sera, un telefono in cantiere — ma è un buio da strumento, non da vetrina: sei fondi grigio-neri appena distinguibili fra loro, bordi di mezzo pixel, e nessuna ombra a fingere una profondità che su un fondo quasi nero non si vedrebbe comunque.

**Key Characteristics:**
- Densità da tabella: corpo a 13px, cifre sempre tabellari, virgole in colonna
- Sei livelli di fondo (#08080A → #18181C) al posto delle ombre
- Bordi di mezzo pixel come unica linea strutturale
- Un accento bronzo, usato al massimo su un elemento in evidenza per schermata
- Tre colori che significano qualcosa e non decorano mai
- Numeri-eroe fuori dai contenitori, mai dentro una card

## Colors

Una tavolozza quasi interamente neutra, con tre soli colori ammessi — e ognuno dei tre ha una regola che dice quando si usa e, soprattutto, quando no.

### Primary
- **Bronzo spento** (`#8A6D4B`): l'unico accento del sistema. Marchio, voce attiva della navigazione, link, badge, bottone primario. Su una schermata segna **un solo** elemento in evidenza — sulla Dashboard è il badge della commessa più costosa. Il testo che ci va sopra è **Bronzo inchiostro** (`#FFFBF5`), non bianco puro: porta il contrasto a 4,66:1, che il bianco sporco precedente non raggiungeva. Al passaggio del mouse il bronzo **si scurisce** (`#7A6042`, 5,69:1) invece di schiarirsi, perché con un inchiostro quasi bianco schiarire il campo si mangia il contrasto.

### Secondary
- **Verde importo** (`#4ADE80`): gli importi in euro. Nient'altro. Non «va bene», non «riuscito», non «confermato» — solo denaro.
- **Ambra da controllare** (`#D9A441`): la richiesta di attenzione. Righe interpretate da un PDF, abbinamenti proposti dal software, avvisi di lettura, campi pre-riempiti da rileggere. Esiste perché prima questo lavoro se lo prendeva il bronzo, e un accento che indica dappertutto non indica più niente.

### Tertiary
- **Rosso guasto** (`#F09595`): errori e azioni distruttive. Desaturato di proposito: su fondo scuro un rosso pieno urla. Nelle righe di elenco il rosso **non è mai a riposo** — arriva al passaggio del mouse o al fuoco.

### Neutral
- **Fondo app** (`#08080A`): l'area dei contenuti, e il fondo su cui vive il numero-eroe.
- **Fondo barra** (`#0A0A0D`): la barra laterale. È l'unica superficie che non contiene dati, e resta distinta per far capire dove finisce lo strumento e comincia il lavoro.
- **Fondo card** (`#0D0D10`) e **Fondo rialzato** (`#131317`): contenitori e, dentro di essi, campi e box.
- **Fondo passaggio** (`#16161A`) e **Fondo pillola** (`#18181C`): stato attivo, hover, badge grigi.
- **Bordo** (`#1A1A1F`), **Bordo tenue** (`#131316`), **Bordo campo** (`#1F1F24`): tre fili, dal divisorio di card a quello interno alle liste.
- La scala del testo va da **Testo primo** (`#FAFAFA`, numeri e titoli) fino a **Testo decorativo** (`#52525B`), passando per **Testo etichetta** (`#8A8A93`, maiuscoletto e intestazioni) e **Testo tenue** (`#7E7E88`, didascalie e segnaposto).

### Named Rules

**La Regola del Verde Denaro.** Il verde vale solo per un importo in euro positivo. Nel momento in cui significa anche «l'ha fatto il software» o «è andata bene», le cifre in euro smettono di leggersi come denaro. Se serve dire «confermato», si usa un'icona di spunta e il testo chiaro.

**La Regola dell'Unico in Evidenza.** Su una schermata il bronzo pieno marca un solo elemento. Marchio, voce attiva e link non contano nel conto: sono struttura, non evidenza.

**La Regola del Pavimento.** Ogni testo che qualcuno deve leggere sta ad almeno 4,5:1 sul proprio fondo. I tre gradini bassi sono calcolati, non scelti a occhio: etichetta 5,85:1, tenue 4,98:1, decorativo 2,59:1 — e il decorativo non è testo, mai.

## Typography

**Display Font:** Fira Sans (con `-apple-system, system-ui, sans-serif`)
**Body Font:** Fira Sans — famiglia unica, tre pesi (400, 500, 600)
**Label/Mono Font:** nessuno. Le cifre si incolonnano con `font-variant-numeric: tabular-nums`, non con un carattere monospaziato.

**Character:** Fira Sans è stata commissionata da Mozilla a Erik Spiekermann per telefoni economici con schermi mediocri: aperture larghe, terminali netti, fatta per restare leggibile quando il rendering non aiuta. È l'argomento più vicino a un geometra che legge un totale dal telefono, in cantiere, con il sole. Distingue `l` da `1` da `I` per disegno, non per una variante da attivare.

### Hierarchy
- **Display** (600, 56px, 0.98, `-0.03em`, tabellare): il numero-eroe. Un solo elemento per schermata, e sta **fuori** da qualunque card. Su schermi stretti scende a 37px.
- **Headline** (600, 21px, 1.25, `-0.012em`): il titolo di una schermata.
- **Title** (600, 17px, 1.3, `-0.008em`): titolo di un blocco importante dentro una schermata.
- **Subtitle** (500, 13.5px, 1.4): intestazione di card e di sezione.
- **Body** (400, 13px, 1.6): il testo delle righe. Le prose lunghe si fermano a 58–66ch.
- **Caption** (400, 12px, 1.5): didascalie, note, righe di contesto sotto un dato.
- **Label** (500, 11px, `0.06em`, maiuscoletto): etichette sopra un valore e intestazioni di tabella. Sempre `#8A8A93`.
- **Numeric** (600, tabellare, `-0.02em`): qualunque cifra in evidenza.

### Named Rules

**La Regola della Colonna.** Ogni cifra che può finire sopra o sotto un'altra cifra è tabellare, con crenatura zero. Su una colonna di importi anche un centesimo di em toglie aria fra la virgola e i decimali.

**La Regola dei Tre Pesi.** Si caricano 400, 500 e 600: nient'altro esiste. Le intestazioni nude e gli `<strong>` valgono 600, e `font-synthesis-weight: none` impedisce al browser di fabbricare un 700 ingrassando le aste.

**La Regola del Titolo Nudo.** Nessuna etichetta in maiuscoletto sopra un titolo. Il titolo si porta da solo; un occhiello che ripete il nome della schermata non dice niente. Un'etichetta in maiuscoletto sta sopra un **numero**, che è il suo mestiere.

## Layout

La cornice è fissa: barra laterale da 230px (nascosta sotto 1024px, dove diventa una barra di navigazione in fondo), testata appiccicata in alto alta 109px con fondo velato all'82% e sfocatura da 14px, e un'area di contenuto che si ferma a **1180px** e resta centrata — su schermi larghi il contenuto non si spalma da bordo a bordo.

Il ritmo verticale nasce dalla densità: righe di tabella con 13px di respiro sopra e sotto, celle con 16px orizzontali, card con 24px interni, bande di apertura con 28–40px. Fra i blocchi di una schermata la distanza standard è 28px; fra le schermate cambia il contenuto, non il ritmo.

Le griglie sono **asimmetriche di proposito**: `1.55fr / 1fr` per la banda d'apertura, `1.75fr / 1fr` per il corpo della Dashboard. Colonne uguali significano «questi elementi contano uguale», e quasi mai è vero.

Il sistema responsive usa i punti di rottura di Tailwind (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Sotto i 640px le tabelle con più di tre colonne **smettono di essere tabelle** e diventano elenchi di schede: una tabella a cinque colonne su uno schermo da quattro pollici non si aggiusta stringendo le spaziature.

### Named Rules

**La Regola dell'Unico Contenitore.** Una schermata ha un contenitore e tante righe, non tanti contenitori uguali impilati. Se stai per ripetere la stessa card N volte, quella è una lista.

**La Regola della Tabella che si Arrende.** Sotto i 640px una tabella con azioni di riga diventa un elenco. Se un bottone finisce fuori dallo schermo, la tabella ha perso — non l'utente.

**La Regola del `title` che non è una Spiegazione.** Col dito non esiste il passaggio del mouse, quindi un attributo `title` non è una spiegazione: è una decorazione. Un comando la cui unica spiegazione è un `title`, sul telefono è **un comando senza spiegazione**. Ogni bottone a sola icona deve portarsi dietro un'etichetta che si vede, o un modo di scoprire cosa fa che non richieda un mouse — `aria-label` risolve per chi usa un lettore di schermo, non per chi guarda.

Il `title` resta ammesso come *aggiunta* per chi ha il mouse. Non come unica strada.

Trovato due volte nello stesso esame, l'8 agosto 2026, e sono due facce della stessa cosa. La pillola del timbro era `hidden md:inline-flex` **e** teneva il numero osservato dentro un `title`: sotto i 768px spariva il verdetto, e sopra i 768px il motivo si scopriva solo passandoci sopra. Alla riga «rinomina commessa» il bottone era un'icona da 10px con `p-0.5` — quattordici pixel di bersaglio — e la parola «Rinomina» esisteva unicamente nel `title`. Su un telefono quel bottone è un quadratino grigio che non si sa cosa faccia e che si fatica a colpire.

È lo stesso errore di forma di **Nessun ripiego che afferma** in `PRODUCT.md`, spostato dall'informazione al comando: qualcosa che sembra esserci perché in una condizione c'è, e che in un'altra sparisce senza lasciare un buco visibile.

## Elevation & Depth

**Piatto per principio: la luce fa la profondità.** Non ci sono ombre diffuse. Su un fondo a `#08080A` un'ombra non ha niente da scurire, e chi ne mette una sta imitando un tema chiaro. La gerarchia si legge da due cose sole: la **luminosità del fondo** — sei livelli da `#08080A` a `#18181C` — e un **filo di mezzo pixel**.

Le variabili storicamente chiamate `--ombra-*` non disegnano ombre: sono anelli di bordo senza sfocatura. L'unico posto dove un'ombra vera è ammessa è ciò che galleggia davvero sopra il resto: il modale, il pannello di dettaglio, il tooltip dei grafici.

### Shadow Vocabulary
- **Piano sollevato** (`box-shadow: 0 0 0 .5px #1F1F24, 0 24px 64px -12px rgba(0,0,0,.7)`): modale e pannello laterale. È l'unica ombra con una vera sfocatura, e ha un offset.
- **Anello di fuoco** (`box-shadow: 0 0 0 2px #08080A, 0 0 0 4px #8A6D4B`): il fuoco da tastiera, identico su bottoni e campi. Il primo anello è del colore del fondo, così il bronzo non tocca l'elemento.

### Named Rules

**La Regola del Filo.** La struttura la disegna un bordo di mezzo pixel, non un'ombra. Se una superficie ha bisogno di staccarsi, si schiarisce il suo fondo di un gradino.

## Shapes

Quattro raggi e nient'altro: **badge e pillole 6px**, **controlli e campi 8px**, **card 14px**, **modale 16px**. La scala sale con la superficie: più una cosa è grande, più l'angolo è morbido.

I bordi sono di **mezzo pixel** — non uno — perché su questi fondi un pixel intero legge come una linea disegnata invece che come un confine.

L'unica eccezione è il **filo di stato da 3px** sul fianco sinistro, e ha un mestiere solo: fare da canale di stato in un **elenco che si scorre**, dove il colore del bordo dice a colpo d'occhio quali righe chiedono qualcosa senza costringere a leggerle. Oggi lo portano i gruppi DDT di una fattura e le pagine di una scansione da rivedere — due schermate, stesso strumento, stesso lavoro. Fuori da quel mestiere il bordo resta di mezzo pixel: un filo spesso su una card qualsiasi non sta segnalando niente, sta solo decorando.

Le barre di proporzione sono alte 3–5px con raggio pieno; a totale zero **restano vuote** invece di riempirsi.

## Components

### Buttons
- **Shape:** angolo da controllo (8px), padding `9px 15px`, nessun cambio di dimensione al passaggio del mouse.
- **Primary:** bronzo pieno con inchiostro `#FFFBF5`. È l'azione della schermata, e di azioni così ce n'è **una per schermata**. Al passaggio scurisce a `#7A6042`.
- **Ghost:** fondo rialzato e bordo di mezzo pixel — un box come tutti gli altri box.
- **Danger:** contorno rosso su fondo trasparente, mai pieno: un bottone rosso pieno chiede di essere premuto.
- **Riga-elimina:** neutro a riposo, rosso al passaggio o al fuoco. 32×32px. Serve dove le righe sono trecento e trecento contorni rossi brucerebbero il segnale.
- **Hover / Focus:** una transizione sola (170ms `cubic-bezier(.2,.7,.3,1)`), anello di fuoco a due strati, `opacity .85` alla pressione.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** `#0D0D10` sul fondo app.
- **Shadow Strategy:** nessuna (vedi Elevation & Depth).
- **Border:** mezzo pixel `#1A1A1F`.
- **Internal Padding:** intestazione `24px 16px`, corpo `24px`. Le righe interne si dividono con `#131316`, non con il bordo pieno.

### Inputs / Fields
- **Style:** fondo rialzato, bordo di mezzo pixel `#1F1F24`, angolo 8px.
- **Focus:** bordo bronzo, fondo un gradino più chiaro, **e** l'anello di fuoco — un cambio di bordo da solo si perde.
- **Error:** il messaggio sta **fuori** dalla `<label>`, collegato con `aria-describedby` e `role="alert"`, e il controllo si dichiara `aria-invalid`. Dentro la label diventerebbe parte del nome del campo, riletto a ogni passaggio.
- **Placeholder:** `#7E7E88`, mai più spento.

### Navigation
- Voci raggruppate sotto etichette in maiuscoletto. La voce attiva ha un **filo bronzo da 2,5px** a sinistra, fondo `#16161A`, icona in bronzo chiaro e `aria-current="page"`.
- Contatori in pillola allineati a destra.
- In fondo, il profilo azienda: iniziali in un box, nome, piano.
- Sotto 1024px diventa una barra in fondo allo schermo con icone ed etichette.

### Badge codice
Il codice di una commessa è sempre un badge, in ogni schermata dove compare: elenco, tabella, pannello, anteprima. Grigio per tutti, **bronzo pieno per la commessa che costa più di tutte** — che è il modo di dire «questa conta più delle altre» senza scriverlo.

### Banda-eroe
Il componente che apre le schermate di riepilogo: etichetta in maiuscoletto, la cifra a 56px sul fondo nudo, una barra di ripartizione a due segmenti, le due voci che la spiegano, e a destra un libro mastro di metriche secondarie. **Non è dentro una card.** In un tema scuro una card è un rettangolo più chiaro: chiudere dentro un contenitore il numero più importante lo rende una cella fra le celle.

## Do's and Don'ts

### Do:
- **Do** mettere il numero più importante di una schermata fuori da qualunque contenitore, alla scala display (56px), con sotto la sua scomposizione.
- **Do** usare griglie asimmetriche quando gli elementi non contano uguale — `1.55fr / 1fr` è la proporzione di casa.
- **Do** far diventare elenchi le tabelle sotto i 640px, se hanno più di tre colonne o azioni di riga.
- **Do** dichiarare l'ambito di una lista quando non coincide con il periodo mostrato in testata («non filtrate dal periodo in alto»).
- **Do** dare una via d'uscita alle azioni distruttive frequenti: nove secondi di «Annulla» nella notifica, invece di una conferma che si preme dieci volte di fila.
- **Do** scrivere il rapporto di contrasto quando si introduce un colore di testo nuovo. Si calcola, non si stima.

### Don't:
- **Don't** costruire una schermata come una pila di card della stessa larghezza, né una fascia di metriche in colonne uguali con un'icona in un quadratino sopra ogni numero.
- **Don't** usare il colore come decorazione. Verde solo per gli euro, ambra solo per l'attenzione, bronzo solo per marchio, voce attiva, link e badge. Un colore che compare senza significare qualcosa è un difetto, non uno stile.
- **Don't** aggiungere ombre diffuse per fingere profondità. Su questo fondo non hanno niente da scurire: si cambia il livello del fondo.
- **Don't** riempire un vuoto con un numero inventato — barre piene quando il totale è zero, tariffe plausibili al posto di un dato mancante, contatori fermi a zero. Se non c'è, si dice che non c'è.
- **Don't** mettere un'etichetta in maiuscoletto sopra un titolo di schermata.
- **Don't** affidare a un `title` l'unica spiegazione di un bottone a sola icona. Col dito il passaggio del mouse non esiste: quel bottone diventa un quadratino che non si sa cosa faccia.
- **Don't** usare glifi di testo (`▲`, `↓`) al posto di un'icona disegnata, né affidare un significato al solo colore.
- **Don't** lasciare che un componente si dichiari `aria-modal` senza trattenere il fuoco al suo interno e restituirlo alla chiusura.
