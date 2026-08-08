/**
 * QUANTO STORICO C'È DAVVERO, mese per mese e azienda per azienda.
 *
 *     node src/mesi-di-storico.js
 *
 * SOLA LETTURA come src/verifica-schema.js: fa domande e stampa, non scrive
 * niente e non tocca nessuna riga.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A COSA SERVE, E PERCHÉ È UN COMANDO INVECE DI UNA QUERY DI PASSAGGIO.
 *
 * Le osservazioni che il prodotto vuole dare al titolare — «questa commessa a
 * luglio ha assorbito il doppio delle ore di giugno» — sono tutte CONFRONTI, e
 * un confronto ha bisogno di storico: sotto i tre mesi solari completi non c'è
 * una mediana, c'è una coppia di numeri.
 *
 * Ne segue una domanda che va fatta PRIMA di costruirle: quanti mesi completi
 * ci sono davvero? Se sono due, quella funzione nasce spenta e resta spenta
 * fino all'autunno — e per ogni cliente nuovo resta spenta all'inizio, cioè
 * esattamente quando uno decide se il prodotto vale.
 *
 * Sta qui e non in uno script buttato via dopo averlo letto perché la risposta
 * cambia ogni mese: fra sei settimane la domanda si rifà, e rifarla deve
 * costare un comando invece di riscrivere le query.
 *
 * COSA VUOL DIRE «COMPLETO». Un mese solare finito, cioè qualunque mese prima
 * di quello in corso. Il mese in corso è escluso sempre e da tutto: finché non
 * è finito i costi sono più alti del vero, perché la tariffa è lordo diviso le
 * ore inserite finora (PRODUCT.md, «I costi sono veri solo a MESE COMPLETO»).
 *
 * QUELLO CHE QUESTO COMANDO NON SA. Che un mese solare sia finito non vuol dire
 * che le sue ore siano state tutte inserite: l'inserimento può arrivare in
 * ritardo, e qui non si vede. Il conteggio è quindi un TETTO — «al massimo
 * tanti mesi confrontabili» — non una garanzia.
 * ────────────────────────────────────────────────────────────────────────────
 */
import "dotenv/config";
import { pool } from "./db.js";

/** Storico minimo che le osservazioni per confronto pretendono. */
const MESI_MINIMI = 3;

const meseDi = (data) => String(data instanceof Date ? data.toISOString().slice(0, 10) : data).slice(0, 7);

const meseCorrente = () => {
  const o = new Date();
  return `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(2, "0")}`;
};

/** Somma dentro una mappa annidata: mappa[chiave] += valore. */
const somma = (mappa, chiave, valore) => mappa.set(chiave, (mappa.get(chiave) || 0) + valore);
const insieme = (mappa, chiave, valore) => {
  if (!mappa.has(chiave)) mappa.set(chiave, new Set());
  mappa.get(chiave).add(valore);
};

async function main() {
  const dove = await pool.query("SELECT current_database() AS db, current_schema() AS schema");
  const ORA = meseCorrente();
  console.log(`\ndatabase: ${dove.rows[0].db} · schema: ${dove.rows[0].schema}`);
  console.log(`mese in corso: ${ORA} (escluso da ogni conteggio)`);
  console.log(`storico minimo richiesto dai confronti: ${MESI_MINIMI} mesi completi\n`);

  const aziende = (await pool.query("SELECT id, nome FROM aziende ORDER BY nome")).rows;
  const registrazioni = (await pool.query("SELECT azienda_id, commessa_id, dipendente_id, data, ore FROM registrazioni")).rows;
  const dipendenti = (await pool.query("SELECT azienda_id, id, nome, cognome, lordo_mensile, archiviato FROM dipendenti")).rows;
  const materiali = (await pool.query("SELECT azienda_id, commessa_id, data, costo FROM materiali")).rows;
  const commesse = (await pool.query("SELECT azienda_id, id, codice FROM commesse")).rows;

  for (const a of aziende) {
    const regA = registrazioni.filter((r) => r.azienda_id === a.id);
    const dipA = dipendenti.filter((d) => d.azienda_id === a.id);
    const matA = materiali.filter((m) => m.azienda_id === a.id);
    const comA = commesse.filter((c) => c.azienda_id === a.id);
    const codiceDi = new Map(comA.map((c) => [c.id, c.codice]));

    console.log("═".repeat(78));
    console.log(`${a.nome}   (id ${a.id})`);
    console.log("═".repeat(78));

    if (regA.length === 0) {
      console.log("  nessuna registrazione: niente storico.\n");
      continue;
    }

    /* ---- il quadro mese per mese ---- */
    const oreDelMese = new Map();          // mese -> ore
    const dipConOre = new Map();           // mese -> Set(dipId)
    const comConOre = new Map();           // mese -> Set(comId)
    for (const r of regA) {
      const m = meseDi(r.data);
      somma(oreDelMese, m, Number(r.ore));
      insieme(dipConOre, m, r.dipendente_id);
      insieme(comConOre, m, r.commessa_id);
    }
    const materialiDelMese = new Map();
    for (const m of matA) somma(materialiDelMese, meseDi(m.data), Number(m.costo));

    /* I mesi per cui esiste ALMENO un lordo scritto: senza lordo la tariffa non
       è calcolabile, quindi quel mese non serve a nessun confronto su A1. */
    const mesiConLordo = new Set();
    for (const d of dipA) for (const m of Object.keys(d.lordo_mensile || {})) mesiConLordo.add(m);

    const mesi = [...new Set([...oreDelMese.keys(), ...materialiDelMese.keys(), ...mesiConLordo])].sort();
    const completi = mesi.filter((m) => m < ORA);

    console.table(mesi.map((m) => ({
      mese: m,
      stato: m < ORA ? "completo" : "IN CORSO",
      ore: (oreDelMese.get(m) || 0).toFixed(2),
      "dip. con ore": dipConOre.get(m)?.size ?? 0,
      "commesse con ore": comConOre.get(m)?.size ?? 0,
      "qualche lordo": mesiConLordo.has(m) ? "si" : "no",
      "materiali €": (materialiDelMese.get(m) || 0).toFixed(2),
    })));

    console.log(`  mesi con dati: ${mesi.length}   ·   di cui COMPLETI: ${completi.length}\n`);

    /* ---- quante entità superano davvero l'asticella ---- */

    // A1: un dipendente serve se ha ore E lordo nello stesso mese completo.
    const mesiUtiliPerDip = new Map();
    for (const d of dipA) {
      const lordi = d.lordo_mensile || {};
      const suoi = new Set();
      for (const r of regA) if (r.dipendente_id === d.id) suoi.add(meseDi(r.data));
      const utili = [...suoi].filter((m) => m < ORA && lordi[m] != null);
      mesiUtiliPerDip.set(d.id, utili);
    }
    const dipPronti = dipA.filter((d) => mesiUtiliPerDip.get(d.id).length >= MESI_MINIMI);

    // A2: una commessa serve se ha ore in un mese completo.
    const mesiPerCommessa = new Map();
    for (const c of comA) {
      const suoi = new Set();
      for (const r of regA) if (r.commessa_id === c.id) suoi.add(meseDi(r.data));
      mesiPerCommessa.set(c.id, [...suoi].filter((m) => m < ORA));
    }
    const comPronte = comA.filter((c) => mesiPerCommessa.get(c.id).length >= MESI_MINIMI);

    // A3: idem, sui materiali.
    const mesiMatPerCommessa = new Map();
    for (const c of comA) {
      const suoi = new Set();
      for (const m of matA) if (m.commessa_id === c.id) suoi.add(meseDi(m.data));
      mesiMatPerCommessa.set(c.id, [...suoi].filter((m) => m < ORA));
    }
    const comMatPronte = comA.filter((c) => mesiMatPerCommessa.get(c.id).length >= MESI_MINIMI);

    // A4: i buchi. Non chiede storico: si contano su TUTTI i mesi, in corso compreso.
    const buchi = [];
    for (const d of dipA) {
      const lordi = d.lordo_mensile || {};
      const suoiMesi = new Set();
      for (const r of regA) if (r.dipendente_id === d.id) suoiMesi.add(meseDi(r.data));
      for (const m of suoiMesi) {
        if (lordi[m] == null) buchi.push({ mese: m, chi: `${d.nome} ${d.cognome}`.trim(), cosa: "ore senza lordo" });
      }
      for (const m of Object.keys(lordi)) {
        if (!suoiMesi.has(m) && Number(lordi[m]) > 0) {
          buchi.push({ mese: m, chi: `${d.nome} ${d.cognome}`.trim(), cosa: "lordo senza ore" });
        }
      }
    }

    console.log(`  A1 tariffa      · dipendenti con >=${MESI_MINIMI} mesi completi (ore E lordo): ${dipPronti.length} su ${dipA.length}`);
    console.log(`  A2 ore commessa · commesse con >=${MESI_MINIMI} mesi completi di ore:          ${comPronte.length} su ${comA.length}`);
    console.log(`  A3 materiali    · commesse con >=${MESI_MINIMI} mesi completi di materiali:    ${comMatPronte.length} su ${comA.length}`);
    console.log(`  A4 buchi        · casi trovati (nessuno storico richiesto):                  ${buchi.length}`);

    if (buchi.length > 0) {
      console.table(buchi.sort((x, y) => x.mese.localeCompare(y.mese) || x.chi.localeCompare(y.chi)));
    }

    /* Le commesse più lunghe, per far vedere quanto manca all'asticella. */
    const classifica = comA
      .map((c) => ({ commessa: codiceDi.get(c.id), "mesi completi con ore": mesiPerCommessa.get(c.id).length }))
      .filter((r) => r["mesi completi con ore"] > 0)
      .sort((x, y) => y["mesi completi con ore"] - x["mesi completi con ore"])
      .slice(0, 8);
    if (classifica.length > 0) {
      console.log("\n  le commesse con più storico:");
      console.table(classifica);
    }
    console.log("");
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error("\nErrore durante il conteggio:", e.message, "\n");
  await pool.end();
  process.exit(1);
});
