# Miglioramenti

## Regola di lavoro: compilare non è eseguire

**Ogni schermata toccata va aperta davvero prima di dirla finita.** La build
passa anche quando manca una costante: il bundler non sa se un identificatore
esisterà a runtime, quindi `npm run build` che finisce con «✓ built» non dice
niente sul fatto che la pagina si apra.

Non è un principio astratto. Il 6 agosto 2026, rifacendo la schermata
Abbonamento, un innesto ha portato via la costante `ICONE_STATO` insieme al
commento che la precedeva. Le prove passavano, la build passava, e la pagina
era **bianca** — l'errore esisteva solo nella console del browser. Se quel
lavoro fosse stato chiuso sulla parola della build, sarebbe andato in
produzione così.

Quindi: aprire la pagina, guardarla, e **leggere la console** — ricaricando con
la console già in ascolto, perché gli errori che contano capitano al
caricamento. Vale anche per una modifica «di solo testo»: il costo di guardare
è trenta secondi, quello di non guardare è una schermata bianca a un cliente.

---

Cose sapute e non ancora fatte. Ogni voce dice **cosa manca**, **chi ne
soffre** e **perché non è stato fatto** — senza quest'ultimo pezzo una lista di
miglioramenti diventa una lista dei desideri.

---

## 1. Fra due schede aperte vince l'ultima che scrive

**Cosa manca.** Il salvataggio non porta nessuna versione: se la stessa azienda
ha due schede aperte, ognuna riscrive sopra l'altra e nessuna se ne accorge.
Non c'è un `updated_at` confrontato, non c'è un `If-Match`, non c'è niente che
possa dire «questi dati sono cambiati da quando li hai letti».

**Chi ne soffre.** Chiunque lavori da due posti — l'ufficio e casa, il
computer e il telefono — o semplicemente lasci una scheda aperta.

**Cosa c'è oggi, e cosa copre.** Da agosto 2026 il server rifiuta un
salvataggio che **cancellerebbe** più di 10 registrazioni (o più di un quarto,
sopra le 20) senza una dichiarazione esplicita, e il rifiuto dice i numeri e
invita a ricaricare. Copre il caso grave — il lavoro che sparisce — e copre
anche buona parte del conflitto fra schede, perché una scheda vecchia di
solito cancella molto.

**Cosa NON copre.** Due schede che si sovrascrivono a vicenda **senza
cancellare**: due modifiche allo stesso lordo mensile, due rinomine, righe
aggiunte da una e non viste dall'altra sotto la soglia. Lì l'ultima scrittura
vince ancora, in silenzio.

**Perché non è stato fatto.** Perché non è una toppa, è un cambio di modello:
o si passa a scritture per singola operazione (come già fanno materiali e
allegati), o si aggiunge una versione all'azienda e il salvataggio rifiuta di
sovrascrivere una versione più recente della propria. La prima strada è la
giusta e la più lunga; la seconda è più corta ma va decisa insieme al
comportamento da mostrare in caso di conflitto — e «hai perso» non è una
risposta accettabile da mostrare a qualcuno che ha appena scritto.

---

## 2. Nessun backup automatico prima delle operazioni distruttive

**Cosa manca.** Svuota tutto, ripristino di un backup e import con
«sostituisci» cambiano molti dati in un colpo, e non ne resta nessuna copia. Se
qualcuno conferma per sbaglio, l'unico rimedio è un backup JSON che si è
ricordato di scaricare prima.

**Cosa c'era prima, e che non c'era.** La funzione che gestisce quei tre
percorsi si chiamava `salvaSubitoConBackup` e passava `{forzaBackup: true}` a
una funzione con due parametri: il terzo veniva buttato via in silenzio. Era un
residuo della versione Electron, dove `store.js` faceva le istantanee su disco.
Il nome prometteva una rete che non esisteva, proprio nei tre punti che fanno
più danno. Ad agosto 2026 è stata rinominata `salvaSubitoDichiarando`, che è
quello che fa davvero: **il nome non mente più, ma il backup continua a non
esserci.**

**Perché non è stato fatto.** Perché un backup vero vuole decisioni che non si
prendono di fretta: dove si tiene (una tabella di istantanee? l'archivio
esterno?), per quanto tempo si conserva, chi lo può ripescare e da dove. Farne
uno approssimativo mentre si sistemava il nome avrebbe ricreato lo stesso
problema di prima: una seconda rete finta, stavolta con le prove a coprirla.

---

## 3. Con abbonamento attivo il piano non si può cambiare

**Cosa manca.** Chi ha già un abbonamento attivo non ha nessun modo, dentro
l'applicazione, di passare a un piano superiore. Nella schermata Abbonamento i
bottoni «Scegli» spariscono e resta solo «Gestisci», che apre il portale
Stripe — dove il cambio piano è deliberatamente non configurato.

**Chi ne soffre.** Un cliente che cresce da 10 a 35 dipendenti. Vede l'avviso
che il piano non basta più, e non ha un bottone per rimediare. **È ricavo
rifiutato**: qualcuno che vuole pagare di più e non può.

**Perché non è stato fatto.** Il checkout crea sempre una sottoscrizione
NUOVA. Un abbonato a Cantiere che premesse «Scegli» su Struttura si
ritroverebbe due sottoscrizioni attive e due addebiti, il che è molto peggio
del problema che risolve. Farlo per bene vuol dire aggiornare la
sottoscrizione esistente (`stripe.subscriptions.update` con il nuovo prezzo e
il calcolo del rateo), decidere se il conguaglio è immediato o al rinnovo, e
gestire il caso opposto — chi scende di piano — che tocca i rimborsi.

**Da decidere prima di scrivere codice:** se il cambio piano sta qui o nella
pagina prezzi pubblica, e come si comporta il conguaglio. Il rateo è una
faccenda di fatturazione, e la fatturazione non è ancora decisa (vedi
PRODUCT.md, «Non deciso»).

---

## 4. Chi se ne va non può portare via i file dei documenti archiviati

**Cosa manca.** L'esportazione dà tutto: ore, dipendenti, commesse, materiali, e
l'**inventario** dei documenti — nome, data, fornitore, a quale commessa sono
legati. Non dà i file: i PDF delle fatture e le foto dei DDT restano
nell'archivio esterno.

**Chi ne soffre.** Un'impresa che smette di abbonarsi e che nel frattempo ha
caricato qui l'unico esemplare di un documento. L'inventario le dice che quel
DDT esisteva e a quale cantiere apparteneva, ma il documento non ce l'ha più.

**Perché non è stato fatto.** È una scelta, non una dimenticanza: i file
stanno su R2, scaricarli in blocco vuol dire una seconda rotta, un archivio
compresso costruito al volo e un costo di banda proporzionale a quanto hanno
caricato. E sono documenti che il fornitore ha già mandato all'azienda per
altre vie. È anche la stessa scelta che il backup JSON fa da sempre, dove gli
allegati escono con la nota «solo riferimento: il file resta nell'archivio».

**Resta un buco noto.** L'inventario senza i file è un compromesso ragionevole
finché i documenti sono copie di qualcosa che l'azienda ha già. Il giorno che
questo diventasse l'archivio principale di qualcuno — ed è esattamente quello
che succede quando un prodotto funziona — smetterebbe di esserlo.

---

## 5. `riep.avvisi` è codice morto, e non si può togliere senza rifare l'impronta

**Cosa manca.** `calcolaRiepilogo` costruisce e restituisce ancora `avvisi`, ma
da agosto 2026 nessuno lo rende. Quegli avvisi dicevano «Manca il lordo di X
per Y: le sue ore valgono 0 €», che è esattamente `ORE_SENZA_LORDO` di
`buchiNeiDati.js`: quando i due blocchi di segnalazione sono diventati uno, la
sorgente è passata al modulo e il campo è rimasto lì a girare a vuoto.

**Chi ne soffre.** Nessuno oggi, ed è il motivo per cui la voce è in fondo. Ma
è il tipo di residuo che fra sei mesi qualcuno «sistema» rimettendolo a
schermo, e lo stesso fatto tornerebbe scritto in due scatole diverse — cioè
esattamente il difetto che quella fusione è servita a togliere.

**Perché non è stato fatto.** Il campo sta dentro il blocco fra `CALC-START` e
`CALC-END`, che si verifica **per impronta**: cambiarlo anche solo per
cancellare una riga romperebbe il rituale di verifica, che vale più di due
righe morte. Quando quel blocco andrà toccato per altri motivi, si toglie
allora — insieme all'accumulo `avvisi.add(...)` dentro il ciclo e al campo nel
`return`.

**Nel frattempo** la trappola è disinnescata dove verrebbe fatta: un commento
in `App.jsx`, dove si compone `daGuardare`, dice che `riep.avvisi` non si rende
più di proposito e che la sorgente di verità è `buchiNeiDati.js`. Chi passa di
là a rimetterlo a schermo lo legge prima.

---

## Fatte

- **Cancellare un dipendente distruggeva le sue ore** (6 agosto 2026). Chi ha
  ore registrate ora si archivia; si cancella davvero solo chi non ne ha
  nessuna. La chiave esterna delle registrazioni è passata da `ON DELETE
  CASCADE` a `RESTRICT`, e il salvataggio non cancella più tutti i dipendenti
  per riscriverli. Vedi PRODUCT.md, principio 6.

- **Un salvataggio poteva cancellare il lavoro di una giornata** (7 agosto
  2026). Il server adesso conta quante registrazioni sparirebbero e **rifiuta**
  se sono più di 10 (o più di un quarto, sopra le 20) senza una dichiarazione
  esplicita: risponde 409, non apre nemmeno la transazione, e la pagina dice i
  numeri veri e invita a ricaricare. Le quattro operazioni che cancellano in
  blocco dopo una conferma — svuota, ripristino, import con «sostituisci»,
  eliminazione di una commessa — dichiarano quante righe si aspettano di
  perdere; **il salvataggio automatico non lo dichiara mai**, ed è quella
  l'asimmetria che protegge. In più `pronto.current` è rientrato nel ramo che
  ha ricevuto i dati, così una lettura fallita non arma più il salvataggio.

- **Il primo giorno, e un timbro che diceva sempre di sì** (7 agosto 2026). La
  schermata iniziale ha tre gradini che si spuntano da soli sui dati veri —
  senza lordo non c'è tariffa, senza commessa non c'è dove mettere le ore,
  senza ore non c'è costo — e l'azione sta dentro il passo. «Quadra»
  verificava che la somma dei costi coincidesse con la somma dei lordi, cosa
  che torna per costruzione: un timbro che non può mai diventare rosso. Adesso
  il verde vuole anche tariffe plausibili, e se una è fuori scala passa
  all'ambra «Da controllare», con sotto i numeri osservati. Fuori scala vuol
  dire oltre il doppio della mediana degli altri mesi della stessa persona —
  il metro è la persona, non una soglia inventata — e solo senza storico si
  usa un numero, 50 €/h. L'etichetta non conclude che il mese è incompleto:
  dice che c'è da guardare. Vedi PRODUCT.md, «I costi sono veri solo a mese
  completo».

- **Verificato che il salvataggio sia una transazione sola** (7 agosto 2026).
  `BEGIN` … `COMMIT` su una connessione sola, e nessuna query che esca dal
  client: una connessione che cade a metà non lascia il database mezzo
  cancellato, Postgres annulla tutto. Non era un cambiamento, era un dubbio
  legittimo — e ora è una cosa verificata invece che sperata.

- **Da 671 istruzioni a 14, e non crescono più** (7 agosto 2026). Il
  salvataggio cancellava tutte le registrazioni e le riscriveva una per una.
  Misurato prima di toccare niente, su una copia dei dati di PIEMME: **671
  istruzioni** verso Neon per aver cambiato una cifra — 624 registrazioni, 15
  dipendenti, 22 commesse una per una, più le fisse, più il controllo
  dell'abbonamento — e **35 secondi** dal portatile. Adesso sono **14** (13 se
  non è cambiato niente) e **864 ms**, e soprattutto non dipendono più da
  quante righe ci sono: fra sei mesi saranno ancora 14.
  Ogni tabella è una istruzione sola con `UNNEST` e `ON CONFLICT DO UPDATE`, e
  delle registrazioni si scrivono solo quelle davvero cambiate — per una cifra
  cambiata, **una riga**.

  I millisecondi sono misurati dal portatile verso Francoforte, non da Render:
  il numero vero di produzione sta nei log, che registrano già la durata di
  ogni `PUT /api/stato`. Il conteggio delle istruzioni invece non dipende da
  dove gira.

  **La soglia sulle cancellazioni non è cambiata di una riga**, e adesso il
  legame è dimostrato invece che argomentato: la `DELETE` usa lo stesso
  predicato SQL, carattere per carattere, che il cancello usa per contare —
  quindi il cancello non prevede quante righe spariranno, conta esattamente
  quelle che spariranno. `confrontoRegistrazioni.test.js` genera 400 casi e
  verifica che l'insieme che sparisce sia identico nei due modi, e che il
  verdetto coincida; il collaudo end-to-end ha visto il 409 arrivare con gli
  stessi 319 di prima.

  **Il confronto è costruito al contrario di come verrebbe da scriverlo:** non
  chiede «sono diversi?» ma «sono uguali con certezza?». Ogni tipo va
  riconosciuto per nome, e quello che non si riconosce conta come cambiato.
  Riscrivere una riga di troppo non costa niente; non riscriverne una che era
  cambiata fa sparire il lavoro di chi l'ha appena battuta, in silenzio. Il
  guasto peggiore che quel modulo può produrre è di essere inutile.

  In più, le registrazioni hanno preso la guardia `azienda_id` sull'upsert che
  dipendenti e commesse avevano già: senza, un id appartenente a un'altra
  azienda verrebbe sovrascritto invece di far fallire il salvataggio, perché
  `ON CONFLICT (id)` trova la riga per chiave primaria e la chiave primaria non
  sa niente di aziende. È isolamento fra clienti, non un dettaglio dell'upsert.
