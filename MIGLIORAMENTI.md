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

## 1. Con abbonamento attivo il piano non si può cambiare

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
