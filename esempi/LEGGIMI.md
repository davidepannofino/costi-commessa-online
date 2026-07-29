# File di esempio per provare l'importazione delle fatture

Questi file **NON sono fatture vere**: li ho costruiti seguendo il tracciato
ufficiale FatturaPA per poter collaudare la lettura prima di avere una fattura
reale. Servono solo per le prove.

| File | Cosa contiene | A cosa serve provarlo |
|---|---|---|
| `fattura-esempio.xml` | Fattura completa: fornitore "EPIÙ MATERIALI EDILI S.R.L.", 8 righe, 3 DDT (4711, 4738, 4802) più una riga senza DDT, e una riga con sconto del 10% | Il caso normale: raggruppamento per DDT, assegnazione a gruppi e per riga, importazione |
| `fattura-esempio-incompleta.xml` | Fattura piena di buchi: fornitore senza nome, nessun numero, una riga senza descrizione, una senza quantità, una senza prezzo | Verificare che l'app non si rompa e segnali i campi da controllare invece di inventarli |
| `fattura-esempio-firmata.xml.p7m` | La stessa fattura completa, dentro un involucro come quello dei file firmati digitalmente | Verificare che l'XML venga estratto e letto lo stesso |
| `fattura-esempio-digitale.pdf` | La stessa fattura, ma **in PDF con testo selezionabile** | Il "piano B": le righe vengono riconosciute dal testo. Deve arrivare agli stessi numeri dell'XML |
| `fattura-esempio-scansione.pdf` | Un PDF **senza testo**, come una fotocopia | Verificare che l'app dica che non è leggibile e **non inventi nessun dato** |

## XML o PDF: la differenza

L'XML è un dato: quello che c'è scritto è esatto. Il PDF è una stampa, quindi
si **interpreta**, e interpretare può sbagliare. Per questo la schermata mostra
un'etichetta diversa nei due casi ("letto da XML · valori esatti" oppure
"letto da PDF · controlla i valori") e sul PDF più righe risultano da
controllare. In entrambi i casi nessun numero entra nei costi finché non
confermi tu.

Le fatture in PDF che sono **scansioni** (fotografie o fotocopie) non vengono
interpretate affatto: non c'è testo da leggere e tentare di indovinare, su un
documento di spesa, sarebbe peggio che ammettere di non saper leggere. Il file
viene comunque archiviato.

## Numeri attesi con `fattura-esempio.xml`

- **DDT 4711** — 3 righe, 652,00 €
- **DDT 4738** — 2 righe, 744,80 € (la seconda riga ha lo sconto: 60 × 5,20 con
  il 10% di sconto diventa 60 × 4,68 = 280,80 €, e l'app la segnala come "da
  controllare" proprio perché il prezzo dichiarato non torna con il totale)
- **DDT 4802** — 2 righe, 535,00 €
- **Riga senza DDT** — 1 riga, 70,00 € (trasporto)
- **Totale imponibile** — 2.001,80 €, che è esattamente l'imponibile dichiarato
  nella fattura

I costi importati sono **al netto dell'IVA**: è l'imponibile che serve per il
costo di commessa.

## Provare l'abbinamento automatico

Il fornitore della fattura di esempio è **EPIÙ MATERIALI EDILI S.R.L.** e i tre
DDT hanno queste date: **4711** del 06/07/2026, **4738** del 14/07/2026, **4802**
del 23/07/2026. Per vedere l'abbinamento all'opera basta archiviare un documento
su una commessa compilando numero, data e fornitore, e poi caricare la fattura:

| Cosa archivi | Cosa deve succedere |
|---|---|
| DDT `4711`, 06/07/2026, `EPIÙ MATERIALI EDILI S.R.L.` | **abbinato in automatico** (verde): la commessa arriva già selezionata |
| DDT `4711`, 06/07/2026, **un altro fornitore** | **da confermare** (giallo), con scritto che il fornitore non combacia — i numeri di DDT non sono unici fra fornitori diversi |
| DDT `4711` con data 30/07/2026 (oltre 5 giorni) | **da confermare** (giallo): le date sono troppo distanti |
| DDT `4711` senza data o senza fornitore | **da confermare** (giallo): manca di che verificare |
| niente | **da assegnare** a mano, come prima |

Il fornitore si può scrivere anche in forma breve (`Epiu Materiali Edili`):
accenti e forma societaria non contano nel confronto. Il numero si può scrivere
`n. 4711` o `DDT 4711`, è lo stesso.

Le prove automatiche di questa logica stanno in
`backend/src/abbinamentoDDT.test.js` (`npm run prova` nel backend) e
`frontend/src/statoGruppoDDT.test.js` (`npm run prova` nel frontend): non
servono né database né rete.

## Quando arriverà una fattura vera

La lettura dei campi sta tutta in `backend/src/fatturaPA.js`, nella mappa
`PERCORSI` in cima al file. Se un fornitore usa nomi o posizioni diverse, si
adatta quella mappa senza toccare il resto dell'applicazione.
