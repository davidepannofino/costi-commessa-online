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

## 1. Oltre 600 istruzioni verso il database per aver cambiato una cifra

**Cosa manca.** `PUT /api/stato` cancella tutte le registrazioni dell'azienda e
le reinserisce **una per una**: per PIEMME sono una `DELETE` più 624 `INSERT`,
ognuna con il suo viaggio fino a Neon, a ogni salvataggio. E il salvataggio
scatta a ogni modifica, 600 ms dopo l'ultimo tasto.

Dipendenti e commesse non si fanno più così: si toccano solo le righe davvero
cambiate. Le registrazioni sono rimaste indietro perché sono le uniche senza
figli, quindi cancellarle e riscriverle non rompeva nessun vincolo — comodo,
finché le righe erano poche.

**Chi ne soffre.** Chi inserisce ore, cioè l'uso principale del prodotto. Ogni
riga battuta costa più di seicento istruzioni, e il costo cresce con lo storico:
più anni di lavoro ci sono dentro, più lento diventa aggiungere una riga. È un
prodotto che rallenta man mano che lo si usa bene.

**Perché non è stato fatto.** Perché la protezione contro la perdita di dati
(la soglia sulle cancellazioni) andava fatta prima, ed è stata fatta senza
toccare questo: la soglia conta le righe che sparirebbero e funziona identica
con o senza il confronto.

**E va detto chiaro che il confronto riga per riga NON è una protezione.** Le
righe presenti nel database e assenti nell'elenco in arrivo verrebbero
cancellate lo stesso: è la stessa decisione, con lo stesso esito. Una scheda
vecchia distrugge le stesse righe in tutti e due i modi. Questo è un lavoro
sulle prestazioni, e chiamarlo sicurezza sarebbe la peggiore delle illusioni —
sentirsi protetti da un cambiamento che non protegge.

**Da fare:** confrontare per id come già si fa per dipendenti e commesse,
scrivendo solo le righe nuove, quelle cambiate e quelle sparite. Con
`INSERT … ON CONFLICT DO UPDATE` in blocco invece di un giro per riga.

---

## 2. Fra due schede aperte vince l'ultima che scrive

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

## 3. Nessun backup automatico prima delle operazioni distruttive

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

## 4. Con abbonamento attivo il piano non si può cambiare

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

## 5. Chi se ne va non può portare via i file dei documenti archiviati

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

- **Verificato che il salvataggio sia una transazione sola** (7 agosto 2026).
  `BEGIN` … `COMMIT` su una connessione sola, e nessuna query che esca dal
  client: una connessione che cade a metà non lascia il database mezzo
  cancellato, Postgres annulla tutto. Non era un cambiamento, era un dubbio
  legittimo — e ora è una cosa verificata invece che sperata.
