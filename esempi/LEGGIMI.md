# File di esempio per provare l'importazione delle fatture

Questi file **NON sono fatture vere**: li ho costruiti seguendo il tracciato
ufficiale FatturaPA per poter collaudare la lettura prima di avere una fattura
reale. Servono solo per le prove.

| File | Cosa contiene | A cosa serve provarlo |
|---|---|---|
| `fattura-esempio.xml` | Fattura completa: fornitore "EPIÙ MATERIALI EDILI S.R.L.", 8 righe, 3 DDT (4711, 4738, 4802) più una riga senza DDT, e una riga con sconto del 10% | Il caso normale: raggruppamento per DDT, assegnazione a gruppi e per riga, importazione |
| `fattura-esempio-incompleta.xml` | Fattura piena di buchi: fornitore senza nome, nessun numero, una riga senza descrizione, una senza quantità, una senza prezzo | Verificare che l'app non si rompa e segnali i campi da controllare invece di inventarli |
| `fattura-esempio-firmata.xml.p7m` | La stessa fattura completa, dentro un involucro come quello dei file firmati digitalmente | Verificare che l'XML venga estratto e letto lo stesso |

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

## Quando arriverà una fattura vera

La lettura dei campi sta tutta in `backend/src/fatturaPA.js`, nella mappa
`PERCORSI` in cima al file. Se un fornitore usa nomi o posizioni diverse, si
adatta quella mappa senza toccare il resto dell'applicazione.
