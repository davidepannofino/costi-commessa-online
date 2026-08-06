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

## 1. Il salvataggio riscrive tutto a partire da quello che ha il browser

**Cosa manca.** `PUT /api/stato` cancella e riscrive l'intero dataset
dell'azienda — dipendenti, commesse, registrazioni — con quello che gli manda
la scheda del browser. Il browser tiene il mondo; il database ne è la copia.
Una lettura incompleta, una scheda aperta da ieri, una rete caduta a metà: il
salvataggio successivo scrive quella versione sopra i dati veri. **È il rischio
più serio dell'applicazione.**

**Chi ne soffre.** Chiunque, senza accorgersene, e in un modo che non lascia
tracce: il salvataggio riesce, risponde `{ok:true}`, e i dati di prima non ci
sono più.

**Cosa c'è oggi.** Solo `pronto` (`App.jsx`), che impedisce di salvare nella
finestra fra il primo disegno della pagina e l'arrivo dei dati. Ha un buco:
`pronto.current = true` si esegue **anche quando la lettura è fallita**, fuori
dal `if (dati)`. Dopo un errore di rete lo stato resta agli array vuoti e il
salvataggio è armato; basta una modifica qualsiasi. Non esiste nessun controllo
sul crollo del numero di righe, né lato browser né lato server (il server
verifica solo che siano array), e non esiste nessuna versione confrontata: fra
due schede vince l'ultima che scrive.

**E `salvaSubitoConBackup` non fa nessun backup.** Passa `{forzaBackup: true}` a
una funzione che accetta due parametri: il terzo viene buttato via in silenzio.
È un residuo della versione Electron, dove `store.js` faceva le istantanee su
disco. Sul server non c'è nessuna tabella di istantanee. Il nome promette una
rete di sicurezza che non esiste, e lo fa proprio nei tre punti che fanno più
danno: svuota, import, ripristino.

**Perché non è stato fatto.** Perché non è una toppa, è un cambio di modello:
o si passa a scritture per singola operazione (come già fanno materiali e
allegati), o si aggiunge una versione all'azienda e il salvataggio rifiuta di
sovrascrivere una versione più recente della propria. La prima strada è la
giusta e la più lunga; la seconda è più corta ma va decisa insieme al
comportamento da mostrare in caso di conflitto.

**Il primo passo, piccolo e a sé:** spostare `pronto.current = true` dentro il
ramo che ha ricevuto i dati, e rinominare `salvaSubitoConBackup` in modo che
non prometta un backup che non fa.

---

## 2. Con abbonamento attivo il piano non si può cambiare

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

## Fatte

- **Cancellare un dipendente distruggeva le sue ore** (6 agosto 2026). Chi ha
  ore registrate ora si archivia; si cancella davvero solo chi non ne ha
  nessuna. La chiave esterna delle registrazioni è passata da `ON DELETE
  CASCADE` a `RESTRICT`, e il salvataggio non cancella più tutti i dipendenti
  per riscriverli. Vedi PRODUCT.md, principio 6.
