# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Due persone dentro la stessa impresa edile, con due scene d'uso distinte:

- **Il titolare.** Consulta i totali: quanto è costata questa commessa, quanto sta
  costando adesso, dove sta andando il mese. Guarda anche da telefono, in mezzo ad
  altro. Non è la persona che riempie i campi.
- **L'impiegata in amministrazione** (o il geometra che ne fa le funzioni). È chi
  inserisce: ore per dipendente e giorno, voci di materiale, documenti di cantiere,
  fatture. Lavora in orario d'ufficio, al computer, su molte righe di seguito.

Lo stesso account serve entrambi: chi inserisce e chi legge non sono utenti
separati nel sistema. Ne segue che ogni schermata deve funzionare a due velocità —
leggibile a colpo d'occhio per chi passa, efficiente sotto le dita per chi ci sta
un'ora.

## Product Purpose

Sapere quanto costa davvero una commessa, sommando le tre spese che nelle piccole
imprese edili vivono in posti diversi e non si parlano: **il lavoro** (ore per
dipendente e per giorno, valorizzate con il costo orario vero), **i materiali** e
**i documenti di spesa** (DDT e fatture fornitore).

Il successo è che a fine mese il numero sia lì senza che nessuno abbia dovuto
ricostruirlo: aprire la commessa e vedere il costo, invece di riaprire il file
Excel delle ore, la cartella dei DDT e la posta del commercialista.

Commexa è un prodotto in abbonamento: 14 giorni di prova liberi, poi 29 €
al mese, disdetta libera. Il pagamento passa da Stripe Checkout; alcune email
possono essere esentate a mano.

## Positioning

**Dalla fattura elettronica al costo di commessa, passando per il DDT.** È il
pezzo che i gestionali non hanno.

La fattura del fornitore edile arriva come XML FatturaPA (o come PDF), contiene
molte righe, e quelle righe appartengono a DDT diversi consegnati su cantieri
diversi. Commexa legge la fattura, raggruppa le righe per DDT, e cerca fra
i documenti già archiviati sulle commesse quello che combacia per numero, data e
fornitore. Se combacia, la commessa arriva già selezionata; se il fornitore è
diverso o le date sono troppo distanti, lo dice e chiede conferma.

Il corollario, che è parte del posizionamento e non un dettaglio tecnico: **nessun
numero entra nei costi senza una conferma umana**, e su un documento di spesa
l'app preferisce ammettere di non saper leggere piuttosto che indovinare.

Sotto questo, due cose che il prodotto fa e che vanno preservate perché sono la
ragione per cui i numeri sono credibili:

- **Il costo orario è calcolato, non digitato.** Lordo mensile del dipendente
  diviso per le ore effettivamente registrate in quel mese. Quando non è
  calcolabile (nessuna ora, nessun lordo per quel mese) l'app lo dichiara invece
  di produrre una tariffa plausibile.
- **XML e PDF non hanno lo stesso statuto.** L'XML è un dato: i valori sono
  esatti. Il PDF è una stampa che va interpretata, quindi le righe risultano da
  controllare. La differenza è visibile all'utente, con etichette diverse.

## Operating Context

- **Il vocabolario è quello del cantiere**, non un'astrazione gestionale:
  commessa, DDT, fornitore, imponibile, lordo mensile, ore. I costi importati
  sono sempre **al netto dell'IVA**, perché è l'imponibile che fa il costo di
  commessa.
- **I documenti reali circolano.** Il DDT si archivia sulla commessa quando arriva
  il materiale (numero, data, fornitore); la fattura arriva dopo, a fine mese, e
  deve ritrovare quei DDT. Questo scarto temporale è la forma del lavoro, non un
  caso limite.
- **Excel e la carta restano vie d'uscita di prima classe.** Il commercialista
  vuole un file, il cantiere a volte vuole un foglio. Esportazione CSV, XLSX
  (anche completa: dipendenti, commesse, registrazioni, materiali) e stampa sono
  parte del prodotto, e la stampa esce su carta bianca qualunque sia il tema a
  schermo.
- **Il periodo è la lente di tutto.** Quasi ogni schermata risponde alla domanda
  «in questo intervallo di date»; il mese è l'unità naturale perché è l'unità
  della busta paga.
- **Formati italiani sempre.** Virgola decimale, date gg/mm/aaaa, euro dopo il
  numero, e **punto delle migliaia sempre presente** — anche sotto le cinque
  cifre, dove `Intl` in italiano lo ometterebbe: `8.574,00 €`, non `8574,00 €`.
  Vale sia a schermo sia nei messaggi del server. L'interfaccia è in italiano e
  non è prevista alcuna traduzione.

## Capabilities and Constraints

Funzionalità confermate dall'implementazione:

- Registrazione ore per dipendente / commessa / giorno; costo del lavoro su un
  intervallo di date qualsiasi; andamento mensile (fino a 12 mesi).
- Voci di materiale per commessa (data, fornitore, descrizione, quantità, prezzo).
- Archivio documenti per commessa con dati DDT (numero, data, fornitore).
- Importazione fatture: XML FatturaPA, XML firmato `.p7m`, PDF con testo
  selezionabile; abbinamento automatico ai DDT archiviati; assegnazione per
  gruppo DDT o per singola riga; righe escludibili dall'importazione.
- Autenticazione email/password con recupero password via email; abbonamento
  Stripe con prova di 14 giorni; pannello di amministrazione per il gestore
  della piattaforma.
- Esportazione CSV / XLSX e stampa.

Vincoli tecnici e di prodotto:

- **Un account per azienda.** Lo schema lo impone (`utenti.azienda_id` univoco):
  nessun multiutente, nessun ruolo oltre all'amministratore di piattaforma.
  Qualunque lavoro futuro che presupponga più utenti per azienda è un cambio di
  modello dati, non una schermata in più.
- **Isolamento per azienda su ogni tabella** (`azienda_id`): ogni lettura e
  scrittura è filtrata, e deve restarlo.
- **Le scansioni non si interpretano.** Un PDF senza testo viene archiviato e
  dichiarato illeggibile, mai indovinato.
- **Limiti in vigore:** 5 MB per documento di cantiere, 10 MB per fattura, quota
  di spazio per azienda, tetto globale di archivio. L'OCR Google Document AI è a
  pagamento a pagina e ha tre freni: massimo pagine per documento (15), tetto
  mensile di pagine (500), soglia di confidenza (0,7); i consumi sono contati per
  mese.
- **Servizi esterni:** Postgres (Neon), Cloudflare R2 per i file quando
  configurato — altrimenti i file restano dentro Postgres —, Stripe, Resend per
  le email, Google Document AI per l'OCR.
- **La mappa dei percorsi XML è il punto di adattamento.** Sta in cima a
  `backend/src/fatturaPA.js` (`PERCORSI`): un fornitore che nomina i campi
  diversamente si accomoda lì, senza toccare il resto.
- **Nessun dato reale in prova.** I file in `esempi/` non sono fatture vere, e le
  prove end-to-end vanno su uno schema Neon separato.
- **L'azienda con id `azienda-prova` è reale.** In produzione quell'identificatore
  appartiene a **PIEMME IMPIANTI SRL**, con le sue commesse, i suoi dipendenti e
  le sue centinaia di registrazioni. È l'eredità del primo giorno, quando uno
  script seminava un'azienda di prova per far partire l'applicazione: la
  registrazione vera è arrivata dopo, e quella riga era già diventata l'azienda
  del cliente. Il nome dell'id inganna, il nome dell'azienda no. **Non
  cancellarla**, e non cancellare le righe che la referenziano.
  Rinominare l'id non è una via d'uscita facile: sette tabelle ci puntano con
  `ON UPDATE NO ACTION`, quindi il cambio non si propaga e andrebbe fatto a mano
  su centinaia di righe, in transazione. Per un identificatore che l'utente non
  vede mai, l'avvertenza costa meno del rischio.

Non deciso (da non inventare): piani diversi dal singolo abbonamento mensile,
gestione multiutente, integrazioni con gestionali o con lo SdI.

## Brand Commitments

- **Il prodotto si chiama Commexa.** Marchio, logo tipografico e ogni testo
  rivolto all'utente dicono Commexa: titolo della pagina, schermata di accesso,
  benvenuto, email, descrizione dell'abbonamento su Stripe. «Costi Commessa» è
  soltanto il nome tecnico della cartella e del repository e non deve comparire
  in nessun punto che l'utente possa leggere. Il codice è allineato: titolo
  della pagina, componente `Marchio`, benvenuto, pagina abbonamento, email di
  reset e voce Stripe dicono Commexa. Restano al nome tecnico soltanto i
  commenti di intestazione (`App.jsx`, `schema.sql`) e i nomi delle cartelle.
- Prezzo dichiarato: 29 € / mese, «disdici quando vuoi, senza vincoli».
- **La voce parla come parla un artigiano competente:** frasi corte, prima
  persona plurale mai, nessun gergo da software. Gli avvisi dicono cosa fare
  («Elimina qualche documento prima di caricarne altri»), non cosa è andato
  storto in astratto. Le incertezze si ammettono per nome: «letto da PDF ·
  controlla i valori».
- Anche i commenti nel codice e i messaggi di commit sono in italiano e nello
  stesso registro. È una scelta, non un caso.
- Nessun logo o asset grafico fornito: il marchio oggi è tipografico
  (componente `Marchio`).

## Evidence on Hand

- `esempi/` — sei file di fattura costruiti sul tracciato FatturaPA per il
  collaudo, con `LEGGIMI.md` che dichiara i numeri attesi. **Non sono fatture
  vere** e non vanno mai presentati come tali.
- Prove automatiche senza rete né database: `backend/src/abbinamentoDDT.test.js`
  e `frontend/src/statoGruppoDDT.test.js` (`npm run prova` nelle due cartelle).
- **Assenti, da non fabbricare:** clienti, testimonianze, numeri di adozione,
  casi studio, benchmark, loghi di aziende, screenshot di installazioni reali.
  Il prodotto non ha ancora una vetrina pubblica e non ne ha i materiali.

## Product Principles

1. **Un numero senza provenienza non vale niente.** Ogni cifra deve poter essere
   aperta e spiegata: da quali ore, da quale riga di fattura, con quale tariffa.
2. **Ammettere di non sapere batte indovinare.** Su una spesa, un dato incerto va
   marcato incerto e fermato prima dei totali, sempre con la conferma umana come
   ultimo passaggio.
3. **Due velocità in ogni schermata.** Il titolare deve capire in tre secondi;
   l'impiegata deve inserire cento righe senza combattere.
4. **Il documento di carta è il modello, non un ostacolo.** Il prodotto segue il
   percorso reale DDT → fattura → costo, invece di chiedere all'utente di
   pensare come un database.
5. **Il dato appartiene all'azienda.** Uscire (Excel, CSV, stampa) resta facile
   come entrare.

## Accessibility & Inclusion

Nessun requisito normativo stabilito. Necessità reali osservabili nel contesto:
utenti non tecnici e non giovani, uso da telefono in condizioni di luce e
attenzione difficili, e tabelle numeriche dense. Ne segue che dimensioni del
testo, contrasto e ampiezza delle aree toccabili non sono materia di gusto.
