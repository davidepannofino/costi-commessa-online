# Miglioramenti

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
