import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  LayoutDashboard, FolderKanban, Users, Database, Plus, Trash2, Pencil, Upload, Download,
  FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, X, ChevronRight, ChevronLeft,
  Search, RotateCcw, Save, Eraser, Info, FileDown, LogOut, Mail, Lock, Building2, ArrowRight, Loader2,
  Clock, Sparkles, Eye, EyeOff, CreditCard, Gift, PartyPopper, ShieldCheck, FileImage,
} from "lucide-react";
import { datiAPI, suSessioneScaduta, suAbbonamentoRichiesto, API_BASE } from "./datiAPI.js";
import { leggiToken, salvaToken, cancellaToken } from "./auth.js";

/* ============================================================================
   CONTROLLO COSTI COMMESSA — v3
   Registra le ore per dipendente/commessa/giorno e calcola il costo del lavoro
   per commessa su un intervallo di date qualsiasi.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   UTILITÀ — formati italiani, date, id
--------------------------------------------------------------------------- */
const fmtNum = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum4 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtOre = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPerc = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const euro = (v) => fmtNum.format(v) + " €";
/** Dimensione di un file in unità leggibili (kB sotto il megabyte).
 *  Una cifra decimale al massimo: "1,7 MB" e "100 MB", non "100,00 MB". */
const fmtMB = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const fmtDimensione = (byte) => (byte >= 1024 * 1024
  ? fmtMB.format(byte / (1024 * 1024)) + " MB"
  : Math.max(1, Math.round(byte / 1024)) + " kB");
const fmtData = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const fmtMese = (ym) => { const [y, m] = ym.split("-"); return `${MESI[+m - 1]} ${y}`; };
let _seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(_seq++).toString(36)}`;
const oggiISO = () => new Date().toISOString().slice(0, 10);
const meseDi = (iso) => iso.slice(0, 7);
const ultimoGiornoMese = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const spostaMese = (ym, delta) => {
  let [y, m] = ym.split("-").map(Number);
  m += delta; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
};
/** Interpreta un numero scritto all'italiana ("0,5" · "2.500,00") o all'inglese ("0.5"). */
const parseNumIt = (s) => {
  if (typeof s === "number") return s;
  if (s == null) return NaN;
  const t = String(s).trim().replace(/\./g, "").replace(",", ".");
  if (!String(s).includes(",")) return parseFloat(String(s).trim());
  return parseFloat(t);
};
const dataValida = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(new Date(iso + "T00:00:00").getTime());

// === CALC-START (sezione pura, testabile) ===

/** Ore totali per (dipendenteId, mese 'AAAA-MM') su TUTTE le registrazioni. */
function calcolaOreMensili(registrazioni) {
  const map = new Map();
  for (const r of registrazioni) {
    const k = r.dipendenteId + "|" + r.data.slice(0, 7);
    map.set(k, (map.get(k) || 0) + r.ore);
  }
  return map;
}

/**
 * Tariffa oraria di un dipendente in un mese.
 * Restituisce { valore, avviso } — avviso ≠ null se la tariffa non è calcolabile.
 */
function tariffaOraria(dip, mese, oreMensili) {
  const ore = oreMensili.get(dip.id + "|" + mese) || 0;
  const lordo = dip.lordoMensile?.[mese];
  if (lordo == null) {
    return { valore: 0, avviso: `Manca il lordo di ${dip.nome} ${dip.cognome} per ${fmtMese(mese)}: le sue ore valgono 0 €.` };
  }
  if (ore <= 0) {
    return { valore: 0, avviso: `${dip.nome} ${dip.cognome} ha un lordo ma zero ore in ${fmtMese(mese)}: tariffa non calcolabile.` };
  }
  return { valore: lordo / ore, avviso: null };
}

/**
 * Riepilogo completo per l'intervallo [dal, al] (estremi inclusi, ISO 'AAAA-MM-GG').
 * Calcola tutto in piena precisione; nessun arrotondamento qui.
 */
function calcolaRiepilogo({ registrazioni, dipendenti, commesse, dal, al }) {
  const oreMensili = calcolaOreMensili(registrazioni);
  const dipById = new Map(dipendenti.map((d) => [d.id, d]));
  const comById = new Map(commesse.map((c) => [c.id, c]));
  const tariffe = new Map(); // cache (dipId|mese) -> {valore, avviso}
  const avvisi = new Set();
  const getTariffa = (dipId, mese) => {
    const k = dipId + "|" + mese;
    if (!tariffe.has(k)) {
      const dip = dipById.get(dipId);
      const t = dip ? tariffaOraria(dip, mese, oreMensili) : { valore: 0, avviso: null };
      tariffe.set(k, t);
    }
    return tariffe.get(k);
  };

  const perCommessa = new Map(); // comId -> {ore, costo, perDip: Map(dipId->{ore,costo})}
  const perGiorno = new Map();   // data -> costo
  let totOre = 0, totCosto = 0;
  const mesiToccati = new Set();

  for (const r of registrazioni) {
    if (r.data < dal || r.data > al) continue;
    const mese = r.data.slice(0, 7);
    mesiToccati.add(mese);
    const t = getTariffa(r.dipendenteId, mese);
    if (t.avviso) avvisi.add(t.avviso);
    const costo = r.ore * t.valore;
    totOre += r.ore; totCosto += costo;
    if (!perCommessa.has(r.commessaId)) perCommessa.set(r.commessaId, { ore: 0, costo: 0, perDip: new Map() });
    const pc = perCommessa.get(r.commessaId);
    pc.ore += r.ore; pc.costo += costo;
    if (!pc.perDip.has(r.dipendenteId)) pc.perDip.set(r.dipendenteId, { ore: 0, costo: 0 });
    const pd = pc.perDip.get(r.dipendenteId);
    pd.ore += r.ore; pd.costo += costo;
    perGiorno.set(r.data, (perGiorno.get(r.data) || 0) + costo);
  }

  const righe = [...perCommessa.entries()]
    .map(([comId, v]) => ({
      commessa: comById.get(comId) || { id: comId, codice: "?", descrizione: "Commessa eliminata" },
      ore: v.ore, costo: v.costo,
      dipendenti: [...v.perDip.entries()].map(([dipId, w]) => {
        const dip = dipById.get(dipId) || { nome: "?", cognome: "" };
        return { dip, ore: w.ore, costo: w.costo, tariffaMedia: w.ore > 0 ? w.costo / w.ore : 0 };
      }).sort((a, b) => b.costo - a.costo),
    }))
    .sort((a, b) => b.costo - a.costo);

  // Invariante (§2.4): se l'intervallo copre solo mesi solari INTERI, la somma
  // dei costi deve coincidere con la somma dei lordi dei dipendenti con ore.
  let invariante = null;
  const dalOk = dal.slice(8) === "01";
  const alOk = al.slice(8) === String(ultimoGiornoMese(al.slice(0, 7))).padStart(2, "0");
  if (dalOk && alOk && totOre > 0) {
    // elenco dei mesi solari coperti dall'intervallo
    const mesi = [];
    let [y, m] = dal.slice(0, 7).split("-").map(Number);
    const fine = al.slice(0, 7);
    while (`${y}-${String(m).padStart(2, "0")}` <= fine) {
      mesi.push(`${y}-${String(m).padStart(2, "0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    let sommaLordi = 0; let completo = true;
    for (const mese of mesi) {
      for (const d of dipendenti) {
        const ore = oreMensili.get(d.id + "|" + mese) || 0;
        if (ore > 0) {
          const lordo = d.lordoMensile?.[mese];
          if (lordo == null) completo = false; else sommaLordi += lordo;
        }
      }
    }
    invariante = { attesa: sommaLordi, calcolata: totCosto, ok: completo && Math.abs(sommaLordi - totCosto) < 0.01, completo };
  }

  return { righe, totOre, totCosto, avvisi: [...avvisi], perGiorno, oreMensili, getTariffa, invariante, mesiToccati };
}
// === CALC-END ===

/* ---------------------------------------------------------------------------
   ANDAMENTO NEL TEMPO — aggregazione su più mesi
   Non duplica né reimplementa la logica di calcolo: chiama calcolaRiepilogo
   UNA VOLTA per ciascun mese solare intero e ne aggrega i risultati.
   Il mese solare è l'unità naturale perché le tariffe sono per definizione
   mensili (lordo del mese / ore del mese, calcolate su TUTTE le registrazioni):
   di conseguenza la somma dei mesi coincide sempre con il totale del periodo
   corrispondente, senza scarti di arrotondamento introdotti qui.
--------------------------------------------------------------------------- */
const MAX_MESI_ANDAMENTO = 12;
const fmtMeseBreve = (ym) => { const [y, m] = ym.split("-"); return `${MESI[+m - 1].slice(0, 3)} ${y.slice(2)}`; };

/**
 * Serie storiche per i grafici di andamento, calcolate in un solo passaggio:
 *  - mesi:        [{ mese, costo, ore }] per gli ultimi MAX_MESI_ANDAMENTO mesi con dati
 *  - perCommessa: Map(commessaId -> [{ mese, costo, ore }]) per il dettaglio commessa
 * Chi la usa deve memoizzarla (useMemo) sui dati sottostanti: è l'unico punto
 * in cui si paga il costo di più riepiloghi.
 */
function calcolaSerieMensile({ registrazioni, dipendenti, commesse }) {
  const mesiConDati = [...new Set(registrazioni.map((r) => r.data.slice(0, 7)))].sort();
  const mesi = mesiConDati.slice(-MAX_MESI_ANDAMENTO);

  const serie = [];
  const perCommessa = new Map();

  for (const mese of mesi) {
    const dal = mese + "-01";
    const al = mese + "-" + String(ultimoGiornoMese(mese)).padStart(2, "0");
    const r = calcolaRiepilogo({ registrazioni, dipendenti, commesse, dal, al });
    serie.push({ mese, costo: r.totCosto, ore: r.totOre });
    for (const riga of r.righe) {
      const id = riga.commessa.id;
      if (!perCommessa.has(id)) perCommessa.set(id, []);
      perCommessa.get(id).push({ mese, costo: riga.costo, ore: riga.ore });
    }
  }
  return { mesi: serie, perCommessa };
}

/* ---------------------------------------------------------------------------
   MATERIALI — voce di costo AGGIUNTIVA, tenuta apposta fuori dal blocco CALC.
   La manodopera si calcola come sempre (lordo mensile / ore del mese); i
   materiali non entrano mai in quel calcolo né nell'invariante: si sommano
   solo alla fine, per ottenere il costo totale della commessa.
--------------------------------------------------------------------------- */

/** Costo di una riga di materiale. Il server lo calcola già (colonna generata
 *  del database): qui si ricalcola solo se manca, per non dipenderne. */
const costoVoceMateriale = (m) => (Number.isFinite(m.costo) ? m.costo : (m.quantita || 0) * (m.prezzoUnitario || 0));

/** Materiali dell'intervallo [dal, al], raggruppati per commessa (per ID). */
function calcolaMateriali({ materiali, dal, al }) {
  const perCommessa = new Map(); // commessaId -> { totale, voci: [] }
  let totale = 0;
  for (const m of materiali) {
    if (!m.data || m.data < dal || m.data > al) continue;
    const costo = costoVoceMateriale(m);
    if (!perCommessa.has(m.commessaId)) perCommessa.set(m.commessaId, { totale: 0, voci: [] });
    const c = perCommessa.get(m.commessaId);
    c.totale += costo;
    c.voci.push({ ...m, costo });
    totale += costo;
  }
  for (const c of perCommessa.values()) c.voci.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return { perCommessa, totale };
}

/**
 * Unisce manodopera e materiali in un'unica lista di righe per commessa.
 * È un'UNIONE, non una somma riga per riga: una commessa può avere solo
 * materiali e zero ore nell'intervallo, e deve comparire lo stesso.
 * Ogni riga conserva `costo` con il significato di sempre (manodopera), così
 * i grafici e i calcoli già esistenti continuano a leggere lo stesso numero.
 */
function unisciCosti({ riep, materiali, commesse, dal, al }) {
  const mat = calcolaMateriali({ materiali, dal, al });
  const comById = new Map(commesse.map((c) => [c.id, c]));
  const perId = new Map();

  if (riep) {
    for (const r of riep.righe) {
      perId.set(r.commessa.id, { ...r, costoManodopera: r.costo, costoMateriali: 0, voci: [] });
    }
  }
  for (const [comId, v] of mat.perCommessa) {
    if (!perId.has(comId)) {
      perId.set(comId, {
        commessa: comById.get(comId) || { id: comId, codice: "?", descrizione: "Commessa eliminata" },
        ore: 0, costo: 0, dipendenti: [], costoManodopera: 0, costoMateriali: 0, voci: [],
      });
    }
    const riga = perId.get(comId);
    riga.costoMateriali = v.totale;
    riga.voci = v.voci;
  }

  const righe = [...perId.values()]
    .map((r) => ({ ...r, costoTotale: r.costoManodopera + r.costoMateriali }))
    .sort((a, b) => b.costoTotale - a.costoTotale);

  const totManodopera = riep ? riep.totCosto : 0;
  return {
    righe,
    perCommessa: mat.perCommessa,
    totManodopera,
    totMateriali: mat.totale,
    totTotale: totManodopera + mat.totale,
  };
}

/* ---------------------------------------------------------------------------
   DATI D'ESEMPIO — luglio 2026, estratti dal file Excel reale.
   Sono SOLO dimostrativi: l'utente può cancellarli con "Svuota tutto".
--------------------------------------------------------------------------- */
const ESEMPIO_ORE = {"e1":{"P1":[[1,8],[14,5]],"P2":[[8,4]],"P3":[[2,8],[6,3],[19,8]],"P4":[[12,4]],"P5":[[4,3],[7,6],[15,5],[30,8]],"P6":[[20,8]],"P7":[[9,2]],"P8":[[5,5],[21,8],[24,6]],"P9":[[3,8],[16,8]],"P11":[[14,6],[22,8]],"P13":[[6,1],[9,4],[25,5],[31,5]],"P14":[[4,5]],"P16":[[5,8],[8,3],[23,8]],"P17":[[27,7]],"P18":[[11,2]],"P19":[[4,2],[18,8],[26,8]],"P20":[[7,1]],"P21":[[15,1]],"P22":[[12,4],[29,2]],"P23":[[11,5]],"P24":[[10,2],[28,4]]},"e2":{"P1":[[1,8]],"P2":[[2,8]],"P3":[[3,8]],"P4":[[4,8]],"P5":[[5,8]],"P6":[[6,8]],"P7":[[7,8],[13,6],[26,8]],"P8":[[8,8]],"P9":[[9,8]],"P10":[[10,8]],"P11":[[11,8],[22,5]],"P12":[[12,5],[27,8],[31,4]],"P13":[[12,3]],"P14":[[13,4]],"P16":[[14,3],[28,5]],"P17":[[15,6],[23,5],[25,5]],"P18":[[15,2],[24,5],[29,2],[31,4]],"P19":[[14,5]],"P20":[[16,8],[21,5],[30,3]],"P21":[[17,8]],"P22":[[18,8],[29,5]],"P23":[[19,8]],"P24":[[20,8]]}};

function creaDatiEsempio() {
  const dipendenti = [
    { id: "e1", nome: "A", cognome: "A", lordoMensile: { "2026-07": 4587 } },
    { id: "e2", nome: "A", cognome: "B", lordoMensile: { "2026-07": 3987 } },
  ];
  const codici = new Set();
  Object.values(ESEMPIO_ORE).forEach((m) => Object.keys(m).forEach((c) => codici.add(c)));
  const ordina = (a, b) => (parseInt(a.slice(1)) || 0) - (parseInt(b.slice(1)) || 0);
  const commesse = [...codici].sort(ordina).map((c, i) => ({ id: "c" + (i + 1), codice: c, descrizione: "Commessa " + c }));
  const comId = new Map(commesse.map((c) => [c.codice, c.id]));
  const registrazioni = [];
  for (const [dipId, mappa] of Object.entries(ESEMPIO_ORE)) {
    for (const [codice, giorni] of Object.entries(mappa)) {
      for (const [g, ore] of giorni) {
        registrazioni.push({
          id: uid("r"), dipendenteId: dipId, commessaId: comId.get(codice),
          data: `2026-07-${String(g).padStart(2, "0")}`, ore,
        });
      }
    }
  }
  return { dipendenti, commesse, registrazioni };
}

/* ---------------------------------------------------------------------------
   IMPORT EXCEL in due fasi (per gestire i re-import senza doppioni):
   1) analizzaExcel  → legge il file e produce un "piano" per ogni foglio
      (dipendente, mese, lordo, righe di ore), senza toccare i dati.
   2) applicaImport  → applica i piani secondo le decisioni dell'utente
      (sostituisci / salta) sui conflitti dipendente+mese già presenti.
--------------------------------------------------------------------------- */
const serialToISO = (n) => {
  // Excel: epoca 30/12/1899. Uso UTC per evitare slittamenti di fuso.
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

function analizzaExcel(buffer) {
  const wb = XLSX.read(buffer, { cellDates: false });
  const piani = [];
  const avvisi = [];
  for (const nomeFoglio of wb.SheetNames) {
    if (/RIEPILOGO/i.test(nomeFoglio)) continue; // foglio derivato: si ignora
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[nomeFoglio], { header: 1, raw: true, defval: null });
    try {
      // Riga 3 (indice 2): date nelle colonne da D (indice 3) in poi
      const header = grid[2] || [];
      const colonneData = [];
      for (let c = 3; c < header.length; c++) {
        const v = header[c];
        if (typeof v === "number" && v > 20000) colonneData.push([c, serialToISO(v)]);
        else if (v instanceof Date) colonneData.push([c, v.toISOString().slice(0, 10)]);
      }
      if (colonneData.length === 0) throw new Error("nessuna data nell'intestazione (riga 3)");
      const mese = colonneData[0][1].slice(0, 7);

      // Nome, cognome e lordo: cercati per etichetta, non per posizione fissa
      let nome = null, cognome = null, lordo = null;
      for (let r = 0; r < grid.length; r++) {
        const a = grid[r]?.[0];
        if (typeof a === "string") {
          const s = a.trim().toLowerCase();
          if (s.startsWith("dipendente")) { nome = grid[r + 1]?.[1]; cognome = grid[r + 1]?.[2]; }
          if (s.includes("costo lordo mensile")) { const v = grid[r]?.[1]; if (typeof v === "number") lordo = v; }
        }
      }
      if (nome == null || lordo == null) throw new Error("mancano nome o lordo mensile");
      nome = String(nome).trim(); cognome = String(cognome ?? "").trim();

      // Righe commessa: dalla riga 4 (indice 3) finché la colonna A ha un codice
      const righe = [];
      for (let r = 3; r < grid.length; r++) {
        const codice = grid[r]?.[0];
        if (codice == null || /^TOTALE/i.test(String(codice).trim())) break;
        const cod = String(codice).trim();
        for (const [c, iso] of colonneData) {
          const ore = grid[r]?.[c];
          if (typeof ore === "number" && ore > 0) righe.push({ codice: cod, data: iso, ore });
        }
      }
      piani.push({ foglio: nomeFoglio, nome, cognome, mese, lordo, righe });
    } catch (e) {
      avvisi.push(`Foglio "${nomeFoglio}" saltato: ${e.message}.`);
    }
  }
  return { piani, avvisi };
}

/**
 * Applica i piani d'import allo stato. `decisioni[i]` vale 'sostituisci' o
 * 'salta' per i piani in conflitto (dipendente+mese con ore già presenti);
 * i piani senza conflitto si applicano sempre.
 * Restituisce il nuovo stato e i contatori per il riepilogo finale.
 */
function applicaImport(stato, piani, decisioni) {
  const dipendenti = stato.dipendenti.map((d) => ({ ...d, lordoMensile: { ...d.lordoMensile } }));
  const commesse = [...stato.commesse];
  let registrazioni = [...stato.registrazioni];
  const dipByNome = new Map(dipendenti.map((d) => [(d.nome + "|" + d.cognome).toLowerCase(), d]));
  const comByCodice = new Map(commesse.map((c) => [c.codice.toUpperCase(), c]));
  let aggiunte = 0, sostituiti = 0, saltati = 0;

  piani.forEach((p, i) => {
    if (decisioni[i] === "salta") { saltati++; return; }
    const k = (p.nome + "|" + p.cognome).toLowerCase();
    let dip = dipByNome.get(k);
    if (!dip) { dip = { id: uid("e"), nome: p.nome, cognome: p.cognome, lordoMensile: {} }; dipendenti.push(dip); dipByNome.set(k, dip); }
    if (decisioni[i] === "sostituisci") {
      registrazioni = registrazioni.filter((r) => !(r.dipendenteId === dip.id && r.data.slice(0, 7) === p.mese));
      sostituiti++;
    }
    dip.lordoMensile[p.mese] = p.lordo;
    for (const riga of p.righe) {
      let com = comByCodice.get(riga.codice.toUpperCase());
      if (!com) { com = { id: uid("c"), codice: riga.codice, descrizione: "Commessa " + riga.codice }; commesse.push(com); comByCodice.set(riga.codice.toUpperCase(), com); }
      registrazioni.push({ id: uid("r"), dipendenteId: dip.id, commessaId: com.id, data: riga.data, ore: riga.ore });
      aggiunte++;
    }
  });
  return { dipendenti, commesse, registrazioni, aggiunte, sostituiti, saltati };
}

/** Vero se per (nome, cognome, mese) esistono già registrazioni nello stato. */
function trovaConflitto(stato, piano) {
  const dip = stato.dipendenti.find((d) => (d.nome + "|" + d.cognome).toLowerCase() === (piano.nome + "|" + piano.cognome).toLowerCase());
  if (!dip) return false;
  return stato.registrazioni.some((r) => r.dipendenteId === dip.id && r.data.slice(0, 7) === piano.mese);
}

/* ---------------------------------------------------------------------------
   ESPORTAZIONI
--------------------------------------------------------------------------- */
function scaricaBlob(contenuto, nomeFile, tipo) {
  const blob = contenuto instanceof Blob ? contenuto : new Blob([contenuto], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nomeFile; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const numCsv = (v) => fmtNum.format(v).replace(/\./g, "");

/** Riepilogo rapido in CSV. Le colonne rispecchiano la tabella a video:
 *  manodopera e materiali restano separati, il totale è la loro somma. */
function esportaCSV(righe, costi, dal, al) {
  const testa = "Codice;Descrizione;Ore;Manodopera (€);Materiali (€);Totale (€)";
  const corpo = righe.map((r) => [
    r.commessa.codice, r.commessa.descrizione.replace(/;/g, ","),
    fmtOre.format(r.ore).replace(/\./g, ""),
    numCsv(r.costoManodopera), numCsv(r.costoMateriali), numCsv(r.costoTotale),
  ].join(";"));
  const totOre = righe.reduce((s, r) => s + r.ore, 0);
  const totale = ["TOTALE", "", fmtOre.format(totOre).replace(/\./g, ""),
    numCsv(costi.totManodopera), numCsv(costi.totMateriali), numCsv(costi.totTotale)].join(";");
  scaricaBlob("\uFEFF" + [testa, ...corpo, totale].join("\r\n"), `costi_${dal}_${al}.csv`, "text/csv;charset=utf-8");
}

/**
 * Export Excel COMPLETO, con la struttura del file originale dell'azienda:
 * un foglio per dipendente (per ogni mese del periodo: righe = commesse,
 * colonne = giorni, con TOTALE ORE e COSTO, lordo mensile e costo medio
 * orario) più un foglio "RIEPILOGO COSTI" che somma tutti i dipendenti.
 * Restituisce il workbook (così è anche verificabile nei test).
 */
function costruisciWorkbookCompleto({ dipendenti, commesse, registrazioni, dal, al }) {
  const oreMensili = calcolaOreMensili(registrazioni);
  const comById = new Map(commesse.map((c) => [c.id, c]));
  const wb = XLSX.utils.book_new();

  // dati del periodo raggruppati: dipendente → mese → commessa → { giorno → ore }
  const perDip = new Map();
  for (const r of registrazioni) {
    if (r.data < dal || r.data > al) continue;
    const mese = r.data.slice(0, 7);
    if (!perDip.has(r.dipendenteId)) perDip.set(r.dipendenteId, new Map());
    const m1 = perDip.get(r.dipendenteId);
    if (!m1.has(mese)) m1.set(mese, new Map());
    const m2 = m1.get(mese);
    if (!m2.has(r.commessaId)) m2.set(r.commessaId, new Map());
    const m3 = m2.get(r.commessaId);
    m3.set(r.data, (m3.get(r.data) || 0) + r.ore);
  }

  const mesiTotali = new Set();
  perDip.forEach((m1) => m1.forEach((_, mese) => mesiTotali.add(mese)));
  const multiMese = mesiTotali.size > 1;
  const nomiUsati = new Set();
  const nomeFoglio = (base) => {
    let s = base.replace(/[\\\/\?\*\[\]:]/g, " ").trim().slice(0, 31) || "Foglio";
    let n = s, i = 2;
    while (nomiUsati.has(n.toUpperCase())) n = (s.slice(0, 28) + " " + i++);
    nomiUsati.add(n.toUpperCase());
    return n;
  };
  const dataUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const arr2 = (v) => Math.round(v * 100) / 100;

  for (const dip of dipendenti) {
    const m1 = perDip.get(dip.id);
    if (!m1) continue;
    for (const mese of [...m1.keys()].sort()) {
      const m2 = m1.get(mese);
      const t = tariffaOraria(dip, mese, oreMensili);
      // giorni del mese ricadenti nel periodo
      const giorni = [];
      for (let g = 1; g <= ultimoGiornoMese(mese); g++) {
        const iso = mese + "-" + String(g).padStart(2, "0");
        if (iso >= dal && iso <= al) giorni.push(iso);
      }
      const righeCom = [...m2.entries()]
        .map(([comId, gg]) => ({ com: comById.get(comId) || { codice: "?", descrizione: "" }, gg }))
        .sort((a, b) => a.com.codice.localeCompare(b.com.codice, "it", { numeric: true }));

      const aoa = [];
      aoa.push([`Costo del lavoro — ${dip.nome} ${dip.cognome}`.trim()]);
      aoa.push([`${fmtMese(mese)} · periodo ${fmtData(giorni[0])} — ${fmtData(giorni[giorni.length - 1])}`]);
      aoa.push(["COMMESSA", "DESCRIZIONE", ...giorni.map(dataUTC), "TOTALE ORE", "COSTO (€)"]);
      const totGiorno = giorni.map(() => 0);
      let totOre = 0, totCosto = 0;
      for (const { com, gg } of righeCom) {
        let ore = 0;
        const celle = giorni.map((iso, i) => {
          const v = gg.get(iso);
          if (v) { ore += v; totGiorno[i] += v; return v; }
          return null;
        });
        const costo = ore * t.valore;
        totOre += ore; totCosto += costo;
        aoa.push([com.codice, com.descrizione, ...celle, ore, arr2(costo)]);
      }
      aoa.push(["TOTALE", "", ...totGiorno.map((v) => (v ? v : null)), totOre, arr2(totCosto)]);
      aoa.push([]);
      aoa.push(["Dipendente", dip.nome, dip.cognome]);
      aoa.push(["COSTO LORDO MENSILE", dip.lordoMensile?.[mese] ?? "mancante"]);
      aoa.push(["ORE TOTALI DEL MESE", oreMensili.get(dip.id + "|" + mese) || 0]);
      aoa.push(["COSTO MEDIO ORARIO", t.avviso ? "non calcolabile" : arr2(t.valore * 100) / 100 === t.valore ? t.valore : Math.round(t.valore * 10000) / 10000]);

      const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
      ws["!cols"] = [{ wch: 12 }, { wch: 26 }, ...giorni.map(() => ({ wch: 6 })), { wch: 11 }, { wch: 12 }];
      const base = `${dip.nome} ${dip.cognome}`.trim();
      XLSX.utils.book_append_sheet(wb, ws, nomeFoglio(multiMese ? `${base} ${mese}` : base));
    }
  }

  // foglio di riepilogo (stessi numeri dell'app)
  const riep = calcolaRiepilogo({ registrazioni, dipendenti, commesse, dal, al });
  const aoaR = [["RIEPILOGO COSTI PER COMMESSA"], [`Periodo ${fmtData(dal)} — ${fmtData(al)}`],
    ["CODICE", "DESCRIZIONE", "ORE", "COSTO (€)"],
    ...riep.righe.map((r) => [r.commessa.codice, r.commessa.descrizione, r.ore, arr2(r.costo)]),
    ["TOTALE", "", riep.totOre, arr2(riep.totCosto)]];
  const wsR = XLSX.utils.aoa_to_sheet(aoaR);
  wsR["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(wb, wsR, "RIEPILOGO COSTI");
  return wb;
}

/**
 * Aggiunge i materiali all'export completo SENZA toccare come viene costruita
 * la parte manodopera: costruisciWorkbookCompleto resta identica e viene solo
 * chiamata: qui si aggiungono in coda due fogli, "MATERIALI" (una riga per
 * voce) e "TOTALI COMMESSA" (manodopera, materiali e totale affiancati).
 * Se non ci sono materiali il file risultante è identico a prima.
 */
function costruisciWorkbookConMateriali({ dipendenti, commesse, registrazioni, materiali, dal, al }) {
  const wb = costruisciWorkbookCompleto({ dipendenti, commesse, registrazioni, dal, al });
  const riep = calcolaRiepilogo({ registrazioni, dipendenti, commesse, dal, al });
  const costi = unisciCosti({ riep, materiali, commesse, dal, al });
  const arr2 = (v) => Math.round(v * 100) / 100;
  const comById = new Map(commesse.map((c) => [c.id, c]));

  const voci = materiali
    .filter((m) => m.data >= dal && m.data <= al)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  if (voci.length > 0) {
    const aoaM = [["MATERIALI"], [`Periodo ${fmtData(dal)} — ${fmtData(al)}`],
      ["DATA", "COMMESSA", "DESCRIZIONE COMMESSA", "FORNITORE", "DESCRIZIONE", "QUANTITÀ", "PREZZO UNITARIO (€)", "COSTO (€)"],
      ...voci.map((m) => {
        const c = comById.get(m.commessaId) || { codice: "?", descrizione: "Commessa eliminata" };
        return [m.data, c.codice, c.descrizione, m.fornitore, m.descrizione, m.quantita, arr2(m.prezzoUnitario), arr2(costoVoceMateriale(m))];
      }),
      ["TOTALE", "", "", "", "", "", "", arr2(costi.totMateriali)]];
    const wsM = XLSX.utils.aoa_to_sheet(aoaM);
    wsM["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 18 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsM, "MATERIALI");
  }

  const aoaT = [["TOTALI PER COMMESSA — MANODOPERA E MATERIALI"], [`Periodo ${fmtData(dal)} — ${fmtData(al)}`],
    ["CODICE", "DESCRIZIONE", "ORE", "MANODOPERA (€)", "MATERIALI (€)", "TOTALE (€)"],
    ...costi.righe.map((r) => [r.commessa.codice, r.commessa.descrizione, r.ore, arr2(r.costoManodopera), arr2(r.costoMateriali), arr2(r.costoTotale)]),
    ["TOTALE", "", riep.totOre, arr2(costi.totManodopera), arr2(costi.totMateriali), arr2(costi.totTotale)]];
  const wsT = XLSX.utils.aoa_to_sheet(aoaT);
  wsT["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(wb, wsT, "TOTALI COMMESSA");

  return wb;
}

function esportaCompletoXLSX(stato, dal, al) {
  const wb = costruisciWorkbookConMateriali({ ...stato, materiali: stato.materiali || [], dal, al });
  XLSX.writeFile(wb, `costi_completo_${dal}_${al}.xlsx`, { cellDates: true });
}

/** Riepilogo rapido in Excel, con le stesse colonne della tabella a video. */
function esportaXLSX(righe, costi, dal, al) {
  const arr2 = (v) => Math.round(v * 100) / 100;
  const totOre = righe.reduce((s, r) => s + r.ore, 0);
  const aoa = [["Codice", "Descrizione", "Ore", "Manodopera (€)", "Materiali (€)", "Totale (€)"],
    ...righe.map((r) => [r.commessa.codice, r.commessa.descrizione, r.ore, arr2(r.costoManodopera), arr2(r.costoMateriali), arr2(r.costoTotale)]),
    ["TOTALE", "", totOre, arr2(costi.totManodopera), arr2(costi.totMateriali), arr2(costi.totTotale)]];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 10 }, { wch: 34 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 13 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Riepilogo");
  XLSX.writeFile(wb, `costi_${dal}_${al}.xlsx`);
}

/* ---------------------------------------------------------------------------
   PICCOLI HOOK E COMPONENTI DI BASE
--------------------------------------------------------------------------- */
function useContatore(valore, durata = 700) {
  const [v, setV] = useState(valore);
  const prev = useRef(valore);
  useEffect(() => {
    const ridotto = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ridotto || Math.abs(valore - prev.current) < 1e-9) { setV(valore); prev.current = valore; return; }
    const da = prev.current, t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / durata), e = 1 - Math.pow(1 - p, 4);
      setV(da + (valore - da) * e);
      if (p < 1) raf = requestAnimationFrame(step); else prev.current = valore;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [valore, durata]);
  return v;
}

/** Micro-etichetta: l'unico posto dove è ammesso il maiuscolo. */
const Micro = ({ children, tono }) => (
  <p className="text-[11px] font-semibold uppercase" style={{ letterSpacing: ".12em", color: tono || "var(--muted)" }}>{children}</p>
);

const Campo = ({ etichetta, children, errore }) => (
  <label className="block">
    <span className="block text-[11px] font-semibold uppercase mb-1.5" style={{ letterSpacing: ".1em", color: "var(--muted)" }}>{etichetta}</span>
    {children}
    {errore && <span className="block text-xs mt-1.5" style={{ color: "#A63A32" }}>{errore}</span>}
  </label>
);
const inputCls = "w-full rounded-lg px-3 py-2 text-sm outline-none transition-shadow campo";

/** Campo password con lucchetto a sinistra e occhio/occhio-barrato a destra
 *  per alternare testo in chiaro e puntini, come su qualunque sito moderno. */
function CampoPassword({ value, onChange, placeholder, minLength, required, autoFocus, autoComplete }) {
  const [mostra, setMostra] = useState(false);
  return (
    <div className="relative">
      <Lock size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
      <input
        type={mostra ? "text" : "password"}
        className={inputCls + " pl-9 pr-9"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        minLength={minLength}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setMostra((m) => !m)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md btn"
        style={{ color: "var(--muted)" }}
        aria-label={mostra ? "Nascondi password" : "Mostra password"}
        tabIndex={-1}
      >
        {mostra ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

function Bottone({ variante = "primario", className = "", ...p }) {
  const stile = {
    primario: { background: "var(--ink)", color: "#F6F4EE" },
    accento: { background: "var(--accent)", color: "#FFFDF8" },
    fantasma: { background: "var(--card)", color: "var(--txt)", border: "1px solid var(--hairline)", boxShadow: "var(--ombra-xs)" },
    pericolo: { background: "transparent", color: "#A63A32", border: "1px solid rgba(166,58,50,.25)" },
  }[variante];
  return <button className={"inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all btn " + className} style={stile} {...p} />;
}

function Modale({ titolo, children, onChiudi, largo, bloccante }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && !bloccante && onChiudi();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onChiudi, bloccante]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 noprint" role="dialog" aria-modal="true" aria-label={titolo}>
      <div className="absolute inset-0 anim-velo" style={{ background: "rgba(18,21,26,.45)", backdropFilter: "blur(2px)" }} onClick={() => !bloccante && onChiudi()} />
      <div className={`relative rounded-2xl w-full ${largo ? "max-w-2xl" : "max-w-md"} anim-pop`} style={{ background: "var(--card)", boxShadow: "var(--ombra-lg)" }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h3 className="f-display text-lg" style={{ color: "var(--txt)" }}>{titolo}</h3>
          {!bloccante && <button onClick={onChiudi} aria-label="Chiudi" className="p-1.5 rounded-lg btn" style={{ color: "var(--muted)" }}><X size={17} strokeWidth={1.75} /></button>}
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

function StatoVuoto({ icona: Icona, titolo, testo, azione }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 rounded-2xl" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: "var(--velo-accento)" }}>
        <Icona size={20} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
      </div>
      <p className="f-display text-lg mb-1.5" style={{ color: "var(--txt)" }}>{titolo}</p>
      <p className="text-sm mb-6 max-w-sm leading-relaxed" style={{ color: "var(--muted)" }}>{testo}</p>
      {azione}
    </div>
  );
}

/** Barra di quota sottile. */
const BarraQuota = ({ quota, colore }) => (
  <div className="h-1 rounded-full w-full" style={{ background: "var(--velo)" }}>
    <div className="h-1 rounded-full anim-barra" style={{ width: `${Math.max(1.5, quota * 100)}%`, background: colore || "var(--accent)" }} />
  </div>
);

/** Riquadro con intestazione (titolo + azione opzionale) usato in VistaDati. */
const Sezione = ({ titolo, extra, children }) => (
  <section className="rounded-2xl" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
    <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
      <h2 className="f-display text-base">{titolo}</h2>
      {extra}
    </div>
    <div className="p-6">{children}</div>
  </section>
);

/** Schermata iniziale (nessun token valido): accesso o registrazione di una
 *  nuova azienda. Il backend distingue i dati solo in base al token qui ottenuto. */
function SchermataAccesso({ alSuccesso, messaggio }) {
  const [modo, setModo] = useState("accedi"); // "accedi" | "registrati"
  const [nomeAzienda, setNomeAzienda] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [caricando, setCaricando] = useState(false);
  // { testo, tipo: "avviso" | "errore" } — "avviso" per la sessione scaduta (tono ambra,
  // stessi colori usati altrove per gli avvisi), "errore" per credenziali/validazione (tono rosso).
  const [messaggioForm, setMessaggioForm] = useState(messaggio ? { testo: messaggio, tipo: "avviso" } : null);

  // Sotto-flusso "Password dimenticata?", raggiungibile solo da modo === "accedi".
  const [vistaRecupero, setVistaRecupero] = useState(false);
  const [emailRecupero, setEmailRecupero] = useState("");
  const [caricandoRecupero, setCaricandoRecupero] = useState(false);
  const [messaggioRecupero, setMessaggioRecupero] = useState(null);
  const [inviatoRecupero, setInviatoRecupero] = useState(false);

  const cambiaModo = (m) => { setModo(m); setMessaggioForm(null); setVistaRecupero(false); };

  const apriRecupero = () => {
    setVistaRecupero(true);
    setEmailRecupero(email);
    setMessaggioRecupero(null);
    setInviatoRecupero(false);
  };
  const chiudiRecupero = () => { setVistaRecupero(false); setMessaggioRecupero(null); };

  const invia = async (e) => {
    e.preventDefault();
    setMessaggioForm(null);
    setCaricando(true);
    try {
      const percorso = modo === "accedi" ? "/api/login" : "/api/registrazione";
      const corpo = modo === "accedi" ? { email, password } : { nomeAzienda, email, password };
      const res = await fetch(`${API_BASE}${percorso}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const dati = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessaggioForm({ testo: dati.errore || "Non è stato possibile completare l'operazione.", tipo: "errore" });
        return;
      }
      salvaToken(dati.token);
      alSuccesso(modo === "registrati");
    } catch (e) {
      setMessaggioForm({ testo: "Impossibile contattare il server. Riprova più tardi.", tipo: "errore" });
    } finally {
      setCaricando(false);
    }
  };

  /** Richiesta di reset: la risposta del server è sempre generica (nessuna
   *  distinzione visibile tra email esistente o meno), quindi qui mostriamo
   *  sempre la stessa conferma, indipendentemente dall'esito. */
  const inviaRecupero = async (e) => {
    e.preventDefault();
    setMessaggioRecupero(null);
    setCaricandoRecupero(true);
    try {
      await fetch(`${API_BASE}/api/password-dimenticata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailRecupero }),
      });
      setInviatoRecupero(true);
    } catch (e) {
      setMessaggioRecupero({ testo: "Impossibile contattare il server. Riprova più tardi.", tipo: "errore" });
    } finally {
      setCaricandoRecupero(false);
    }
  };

  const barreDecorative = [38, 62, 46, 82, 54, 70, 34];

  return (
    <div className="min-h-screen flex" style={{ background: "var(--tela)", color: "var(--txt)" }}>
      <StileGlobale />

      {/* ================= PANNELLO DESCRITTIVO (solo desktop) ================= */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] relative flex-col justify-between overflow-hidden noprint superficie-scura px-12 py-14 xl:px-16">
        {/* forme geometriche di sfondo, puramente decorative */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="absolute rounded-full" style={{ width: 340, height: 340, top: -130, right: -110, border: "1px solid rgba(255,255,255,.06)" }} />
          <div className="absolute rounded-full" style={{ width: 220, height: 220, top: -40, right: -60, border: "1px solid rgba(196,162,101,.14)" }} />
          <div className="absolute" style={{ width: 200, height: 200, bottom: 40, left: -70, border: "1px solid rgba(255,255,255,.05)", borderRadius: 44, transform: "rotate(18deg)" }} />
          <div className="absolute" style={{ width: 120, height: 120, top: "38%", left: -50, border: "1px solid rgba(255,255,255,.045)", borderRadius: 30, transform: "rotate(-12deg)" }} />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center f-display text-base shrink-0" style={{ background: "linear-gradient(160deg,#2A313C,#1A1F27)", color: "var(--accent-chiaro)", border: "1px solid rgba(255,255,255,.08)" }}>C</div>
          <div className="f-display text-[15px]" style={{ color: "#EDEAE2" }}>Costi Commessa</div>
        </div>

        <div className="relative">
          <p className="text-[11px] font-semibold uppercase mb-4" style={{ letterSpacing: ".14em", color: "var(--accent-chiaro)" }}>
            Costo del lavoro, sotto controllo
          </p>
          <p className="f-display text-[30px] xl:text-[36px] leading-[1.16] mb-5" style={{ color: "#F0EDE5" }}>
            Il costo del lavoro,<br />commessa per commessa.
          </p>
          <p className="text-sm leading-relaxed max-w-sm" style={{ color: "#9BA1AB" }}>
            Registra le ore, calcola il costo esatto per ogni commessa e ogni dipendente, esporta il report. Ogni azienda con i propri dati, separati e al sicuro.
          </p>

          {/* grafico decorativo astratto (nessun dato reale) */}
          <div className="mt-11 flex items-end gap-2.5 h-24" aria-hidden="true">
            {barreDecorative.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md anim-barra" style={{ height: `${h}%`, background: i === 3 ? "var(--accent-chiaro)" : "rgba(255,255,255,.10)" }} />
            ))}
          </div>
        </div>

        <p className="relative text-xs" style={{ color: "#5A616C" }}>Calcoli in piena precisione. Ogni azienda, dati isolati.</p>
      </div>

      {/* ================= FORM ================= */}
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center f-display text-sm shrink-0" style={{ background: "linear-gradient(160deg,#2A313C,#1A1F27)", color: "#EDEAE2" }}>C</div>
            <div className="f-display text-[15px]">Costi Commessa</div>
          </div>

          <div className="rounded-2xl p-6 sm:p-7" style={{ background: "var(--card)", boxShadow: "var(--ombra-lg)" }}>
            {vistaRecupero ? (
              <div key="recupero" className="anim-vista">
                <p className="f-display text-xl mb-1">Recupera la password</p>
                <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                  Inserisci l'email del tuo account: se esiste, ti mandiamo un link per reimpostare la password.
                </p>

                {inviatoRecupero ? (
                  <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm anim-pop" style={{ background: "var(--velo-accento)", border: "1px solid rgba(154,120,58,.18)", color: "#7C6027" }}>
                    <CheckCircle2 size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    Controlla la tua email: se l'indirizzo esiste, riceverai a breve un link per reimpostare la password.
                  </div>
                ) : (
                  <form onSubmit={inviaRecupero} className="space-y-4">
                    <Campo etichetta="Email">
                      <div className="relative">
                        <Mail size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
                        <input type="email" className={inputCls + " pl-9"} value={emailRecupero} onChange={(e) => setEmailRecupero(e.target.value)} placeholder="nome@azienda.it" required autoFocus />
                      </div>
                    </Campo>

                    {messaggioRecupero && (
                      <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm anim-pop" style={{ background: "rgba(166,58,50,.07)", border: "1px solid rgba(166,58,50,.2)", color: "#A63A32" }}>
                        <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {messaggioRecupero.testo}
                      </div>
                    )}

                    <Bottone type="submit" variante="accento" className="w-full" disabled={caricandoRecupero}>
                      {caricandoRecupero ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
                      {caricandoRecupero ? "Invio…" : "Invia link di reset"}
                    </Bottone>
                  </form>
                )}

                <button type="button" onClick={chiudiRecupero} className="text-xs mt-5 block mx-auto btn" style={{ color: "var(--muted)" }}>
                  ← Torna al login
                </button>
              </div>
            ) : (
              <div key={modo} className="anim-vista">
                <p className="f-display text-xl mb-1">{modo === "accedi" ? "Bentornato" : "Crea il tuo account"}</p>
                <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                  {modo === "accedi" ? "Accedi per continuare a gestire i costi delle tue commesse." : "Un account per azienda: dati separati e al sicuro."}
                </p>

                <div className="relative flex mb-5 rounded-lg p-1" style={{ background: "var(--velo)" }}>
                  <div className="absolute top-1 bottom-1 rounded-md transition-transform duration-300 ease-out"
                    style={{ width: "calc(50% - 4px)", left: 4, background: "var(--card)", boxShadow: "var(--ombra-xs)", transform: modo === "registrati" ? "translateX(100%)" : "translateX(0)" }} />
                  <button type="button" onClick={() => cambiaModo("accedi")}
                    className="relative z-10 flex-1 text-sm font-medium rounded-md py-1.5 transition-colors"
                    style={{ color: modo === "accedi" ? "var(--txt)" : "var(--muted)" }}>
                    Accedi
                  </button>
                  <button type="button" onClick={() => cambiaModo("registrati")}
                    className="relative z-10 flex-1 text-sm font-medium rounded-md py-1.5 transition-colors"
                    style={{ color: modo === "registrati" ? "var(--txt)" : "var(--muted)" }}>
                    Registrati
                  </button>
                </div>

                {modo === "registrati" && (
                  <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-xs leading-relaxed mb-5" style={{ background: "var(--velo-accento)", border: "1px solid rgba(154,120,58,.18)", color: "#7C6027" }}>
                    <Gift size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    <span><strong>14 giorni di prova gratuita</strong>, poi 29 €/mese. Nessuna carta richiesta per iniziare — disdici quando vuoi.</span>
                  </div>
                )}

                <form onSubmit={invia} className="space-y-4">
                  {modo === "registrati" && (
                    <Campo etichetta="Nome azienda">
                      <div className="relative">
                        <Building2 size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
                        <input className={inputCls + " pl-9"} value={nomeAzienda} onChange={(e) => setNomeAzienda(e.target.value)} placeholder="es. Rossi Costruzioni S.r.l." required autoFocus />
                      </div>
                    </Campo>
                  )}
                  <Campo etichetta="Email">
                    <div className="relative">
                      <Mail size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted)" }} />
                      <input type="email" className={inputCls + " pl-9"} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@azienda.it" required />
                    </div>
                  </Campo>
                  <Campo etichetta="Password">
                    <CampoPassword
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={modo === "registrati" ? "Almeno 8 caratteri" : "••••••••"}
                      minLength={modo === "registrati" ? 8 : undefined}
                      required
                      autoComplete={modo === "registrati" ? "new-password" : "current-password"}
                    />
                  </Campo>

                  {modo === "accedi" && (
                    <button type="button" onClick={apriRecupero} className="text-xs -mt-2 btn" style={{ color: "var(--muted)" }}>
                      Password dimenticata?
                    </button>
                  )}

                  {messaggioForm && (
                    messaggioForm.tipo === "avviso" ? (
                      <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm anim-pop" style={{ background: "var(--velo-accento)", border: "1px solid rgba(154,120,58,.18)", color: "#7C6027" }}>
                        <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {messaggioForm.testo}
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm anim-pop" style={{ background: "rgba(166,58,50,.07)", border: "1px solid rgba(166,58,50,.2)", color: "#A63A32" }}>
                        <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {messaggioForm.testo}
                      </div>
                    )
                  )}

                  <Bottone type="submit" variante="accento" className="w-full" disabled={caricando}>
                    {caricando ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
                    {caricando ? "Attendere…" : modo === "accedi" ? "Accedi" : "Crea account"}
                  </Bottone>
                </form>
              </div>
            )}
          </div>

          <p className="text-center text-xs mt-5" style={{ color: "var(--muted)" }}>
            Costo del lavoro per commessa. Calcoli in piena precisione.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Pagina raggiunta dal link nell'email di reset (?token=... sulla root):
 *  imposta una nuova password, poi torna alla schermata di accesso. */
function PaginaResetPassword({ token, alSuccesso }) {
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [caricando, setCaricando] = useState(false);
  const [messaggioForm, setMessaggioForm] = useState(null); // { testo, tipo: "errore" }

  const invia = async (e) => {
    e.preventDefault();
    setMessaggioForm(null);
    if (password.length < 8) {
      setMessaggioForm({ testo: "La password deve avere almeno 8 caratteri.", tipo: "errore" });
      return;
    }
    if (password !== conferma) {
      setMessaggioForm({ testo: "Le due password non coincidono.", tipo: "errore" });
      return;
    }
    setCaricando(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const dati = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessaggioForm({ testo: dati.errore || "Non è stato possibile reimpostare la password.", tipo: "errore" });
        return;
      }
      alSuccesso("Password aggiornata: accedi con la nuova password.");
    } catch (e) {
      setMessaggioForm({ testo: "Impossibile contattare il server. Riprova più tardi.", tipo: "errore" });
    } finally {
      setCaricando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--tela)", color: "var(--txt)" }}>
      <StileGlobale />
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center f-display text-sm shrink-0" style={{ background: "linear-gradient(160deg,#2A313C,#1A1F27)", color: "#EDEAE2" }}>C</div>
          <div className="f-display text-[15px]">Costi Commessa</div>
        </div>

        <div className="rounded-2xl p-7" style={{ background: "var(--card)", boxShadow: "var(--ombra-lg)" }}>
          <p className="f-display text-xl mb-1">Imposta una nuova password</p>
          <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>Scegli una nuova password per il tuo account.</p>

          <form onSubmit={invia} className="space-y-4">
            <Campo etichetta="Nuova password">
              <CampoPassword value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" minLength={8} required autoFocus autoComplete="new-password" />
            </Campo>
            <Campo etichetta="Conferma nuova password">
              <CampoPassword value={conferma} onChange={(e) => setConferma(e.target.value)} placeholder="Ripeti la password" minLength={8} required autoComplete="new-password" />
            </Campo>

            {messaggioForm && (
              <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm anim-pop" style={{ background: "rgba(166,58,50,.07)", border: "1px solid rgba(166,58,50,.2)", color: "#A63A32" }}>
                <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {messaggioForm.testo}
              </div>
            )}

            <Bottone type="submit" variante="accento" className="w-full" disabled={caricando}>
              {caricando ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
              {caricando ? "Attendere…" : "Imposta la nuova password"}
            </Bottone>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Schermata mostrata quando la prova di 14 giorni è scaduta e non c'è un
 *  abbonamento attivo: spiega il prezzo e porta a Stripe Checkout. Il login
 *  resta valido — solo l'accesso ai dati è bloccato (deciso lato server). */
function PaginaAbbonamento({ onUscire }) {
  const [caricando, setCaricando] = useState(false);
  const [errore, setErrore] = useState(null);

  const abbonati = async () => {
    setErrore(null);
    setCaricando(true);
    try {
      const url = await datiAPI.avviaCheckout();
      window.location.href = url;
    } catch (e) {
      setErrore("Non è stato possibile avviare il pagamento. Riprova tra poco.");
      setCaricando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--tela)", color: "var(--txt)" }}>
      <StileGlobale />
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center f-display text-sm shrink-0" style={{ background: "linear-gradient(160deg,#2A313C,#1A1F27)", color: "#EDEAE2" }}>C</div>
          <div className="f-display text-[15px]">Costi Commessa</div>
        </div>

        <div className="rounded-2xl p-8 text-center" style={{ background: "var(--card)", boxShadow: "var(--ombra-lg)" }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: "var(--velo-accento)" }}>
            <Sparkles size={20} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
          </div>
          <p className="f-display text-xl mb-2">Il periodo di prova è terminato</p>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "var(--muted)" }}>
            Hai usato liberamente Costi Commessa per 14 giorni. Per continuare ad accedere ai tuoi dati, attiva l'abbonamento mensile.
          </p>

          <div className="rounded-xl px-5 py-4 mb-6" style={{ background: "var(--velo)" }}>
            <p className="f-mono text-[28px] font-medium" style={{ color: "var(--txt)" }}>29 €<span className="text-sm font-normal" style={{ color: "var(--muted)" }}> / mese</span></p>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Disdici quando vuoi, senza vincoli.</p>
          </div>

          {errore && (
            <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm anim-pop mb-4 text-left" style={{ background: "rgba(166,58,50,.07)", border: "1px solid rgba(166,58,50,.2)", color: "#A63A32" }}>
              <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {errore}
            </div>
          )}

          <Bottone variante="accento" className="w-full" onClick={abbonati} disabled={caricando}>
            {caricando ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
            {caricando ? "Un attimo…" : "Abbonati ora"}
          </Bottone>
          <button type="button" onClick={onUscire} className="text-xs mt-5 btn" style={{ color: "var(--muted)" }}>
            Esci e torna più tardi
          </button>
        </div>
      </div>
    </div>
  );
}

/** Schermata di attesa dopo il ritorno da Stripe Checkout: il webhook può
 *  arrivare con qualche secondo di ritardo rispetto al redirect del browser. */
function VerificaPagamento() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ background: "var(--tela)", color: "var(--txt)" }}>
      <StileGlobale />
      <Loader2 size={22} strokeWidth={1.75} className="animate-spin" style={{ color: "var(--accent)" }} />
      <p className="text-sm" style={{ color: "var(--muted)" }}>Stiamo confermando il pagamento…</p>
    </div>
  );
}

/** Sezione "Abbonamento", raggiungibile in ogni momento dalla sidebar: stato
 *  attuale, giorni di prova rimanenti, prezzo, e un pulsante che porta al
 *  checkout (se non attivo) o al portale Stripe per gestire il pagamento
 *  (se già attivo). */
function VistaAbbonamento({ info }) {
  const [caricando, setCaricando] = useState(false);
  const [errore, setErrore] = useState(null);

  const vai = async (azione) => {
    setErrore(null);
    setCaricando(true);
    try {
      const url = azione === "portale" ? await datiAPI.avviaPortale() : await datiAPI.avviaCheckout();
      window.location.href = url;
    } catch (e) {
      setErrore("Non è stato possibile completare l'operazione. Riprova tra poco.");
      setCaricando(false);
    }
  };

  const STATI = {
    esente: { etichetta: "Accesso illimitato", colore: "#1E7350", icona: Sparkles },
    attivo: { etichetta: "Abbonamento attivo", colore: "#1E7350", icona: CheckCircle2 },
    prova: { etichetta: "Prova gratuita", colore: "var(--accent)", icona: Clock },
    scaduto: { etichetta: "Prova terminata", colore: "#A63A32", icona: AlertTriangle },
  };
  const s = STATI[info?.stato] || STATI.prova;
  const Icona = s.icona;

  return (
    <div className="max-w-lg">
      <Sezione titolo="Abbonamento">
        {!info ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Caricamento…</p>
        ) : (
          <>
            <div className="flex items-center gap-3.5 mb-6">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--velo-accento)" }}>
                <Icona size={20} strokeWidth={1.75} style={{ color: s.colore }} />
              </div>
              <div>
                <p className="f-display text-base" style={{ color: "var(--txt)" }}>{s.etichetta}</p>
                {info.stato === "prova" && (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {info.giorniProvaRestanti === 1 ? "Ultimo giorno" : `${info.giorniProvaRestanti} giorni rimanenti`}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl px-5 py-4 mb-5" style={{ background: "var(--velo)" }}>
              <p className="f-mono text-2xl font-medium" style={{ color: "var(--txt)" }}>
                29 €<span className="text-sm font-normal" style={{ color: "var(--muted)" }}> / mese</span>
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Fatturazione mensile ricorrente. Disdici quando vuoi.</p>
            </div>

            {errore && (
              <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm mb-5" style={{ background: "rgba(166,58,50,.07)", border: "1px solid rgba(166,58,50,.2)", color: "#A63A32" }}>
                <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {errore}
              </div>
            )}

            {info.stato === "esente" ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Il tuo account ha accesso completo e illimitato, senza bisogno di abbonamento.</p>
            ) : info.stato === "attivo" ? (
              <Bottone variante="fantasma" onClick={() => vai("portale")} disabled={caricando}>
                {caricando ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <CreditCard size={14} strokeWidth={1.75} />}
                {caricando ? "Un attimo…" : "Gestisci abbonamento"}
              </Bottone>
            ) : (
              <Bottone variante="accento" onClick={() => vai("checkout")} disabled={caricando}>
                {caricando ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={14} strokeWidth={1.75} />}
                {caricando ? "Un attimo…" : "Abbonati ora"}
              </Bottone>
            )}
          </>
        )}
      </Sezione>
    </div>
  );
}

const ETICHETTE_STATO_ADMIN = { prova: "Prova", attivo: "Attivo", scaduto: "Scaduto", esente: "Esente" };
const COLORI_STATO_ADMIN = { prova: "var(--accent)", attivo: "#1E7350", scaduto: "#A63A32", esente: "#1E7350" };

/** Pannello di amministrazione, visibile solo a chi il server riconosce come
 *  admin (voce di navigazione già filtrata, controllo reale sulle rotte
 *  /api/admin/*). Sola lettura: nessuna azione qui modifica dati di altre
 *  aziende. */
function VistaAdmin() {
  const [caricando, setCaricando] = useState(true);
  const [errore, setErrore] = useState(null);
  const [statistiche, setStatistiche] = useState(null);
  const [aziende, setAziende] = useState([]);
  const [ordina, setOrdina] = useState({ campo: "registratoIl", disc: true });

  useEffect(() => {
    let annullato = false;
    (async () => {
      setCaricando(true);
      setErrore(null);
      try {
        const [stats, elenco] = await Promise.all([datiAPI.adminStatistiche(), datiAPI.adminAziende()]);
        if (annullato) return;
        setStatistiche(stats);
        setAziende(elenco);
      } catch (e) {
        if (!annullato) setErrore("Impossibile caricare i dati di amministrazione. Riprova tra poco.");
      } finally {
        if (!annullato) setCaricando(false);
      }
    })();
    return () => { annullato = true; };
  }, []);

  const clic = (campo) => setOrdina((o) => ({ campo, disc: o.campo === campo ? !o.disc : true }));
  const freccia = (campo) => (ordina.campo === campo ? (ordina.disc ? " ↓" : " ↑") : "");

  const righe = useMemo(() => {
    const valore = (a) => (ordina.campo === "nome" ? a.nome.toLowerCase()
      : ordina.campo === "email" ? a.email.toLowerCase()
      : ordina.campo === "stato" ? a.stato
      : a.registratoIl);
    return [...aziende].sort((a, b) => {
      const va = valore(a), vb = valore(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return ordina.disc ? -c : c;
    });
  }, [aziende, ordina]);

  const schede = statistiche ? [
    ["Totale aziende", statistiche.totale],
    ["In prova", statistiche.inProva],
    ["Attive", statistiche.attive],
    ["Scadute", statistiche.scadute],
    ["Nuove ultimi 7 giorni", statistiche.nuoveUltimi7Giorni],
  ] : [];

  return (
    <div className="space-y-8">
      <div>
        <Micro>Amministrazione</Micro>
        <h1 className="f-display text-[26px] mt-1" style={{ letterSpacing: "-0.01em" }}>Aziende registrate</h1>
      </div>

      {errore && (
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(166,58,50,.07)", border: "1px solid rgba(166,58,50,.2)", color: "#A63A32" }}>
          <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {errore}
        </div>
      )}

      {caricando ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Caricamento…</p>
      ) : (
        <>
          {schede.length > 0 && (
            <div className="rounded-2xl grid grid-cols-2 xl:grid-cols-5 overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
              {schede.map(([e, v], i) => (
                <div key={e} className="px-6 py-5" style={{ borderLeft: i > 0 ? "1px solid var(--hairline)" : "none" }}>
                  <Micro>{e}</Micro>
                  <p className="f-mono text-[22px] mt-2 leading-none" style={{ color: "var(--txt)" }}>{v}</p>
                </div>
              ))}
            </div>
          )}

          {aziende.length === 0 ? (
            <StatoVuoto icona={Building2} titolo="Nessuna azienda registrata" testo="Non appena qualcuno si registrerà, comparirà qui." />
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
              <div className="px-6 py-4 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
                <p className="text-[13px] f-mono" style={{ color: "var(--muted)" }}>{righe.length} aziende</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      {[["nome", "Azienda", ""], ["email", "Email", "hidden sm:table-cell"], ["registratoIl", "Registrata il", "text-right"], ["stato", "Stato", "text-right"], [null, "Prova", "text-right hidden md:table-cell"]].map(([campo, nome, cls]) => (
                        <th key={nome} className={`px-6 py-3.5 text-[11px] font-semibold uppercase ${cls} ${campo ? "cursor-pointer select-none" : ""}`}
                          style={{ letterSpacing: ".1em", color: "var(--muted)" }} onClick={campo ? () => clic(campo) : undefined}>
                          {nome}{campo ? freccia(campo) : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {righe.map((a) => (
                      <tr key={a.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                        <td className="px-6 py-4 font-medium">{a.nome}</td>
                        <td className="px-6 py-4 hidden sm:table-cell" style={{ color: "var(--muted)" }}>{a.email}</td>
                        <td className="px-6 py-4 f-mono text-right">{fmtData(String(a.registratoIl).slice(0, 10))}</td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-xs font-medium px-2 py-1 rounded-md" style={{ color: COLORI_STATO_ADMIN[a.stato] || "var(--txt)", background: "var(--velo)" }}>
                            {ETICHETTE_STATO_ADMIN[a.stato] || a.stato}
                          </span>
                        </td>
                        <td className="px-6 py-4 f-mono text-right hidden md:table-cell" style={{ color: "var(--muted)" }}>
                          {a.stato === "prova" ? `${a.giorniProvaRestanti} g` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   APPLICAZIONE
--------------------------------------------------------------------------- */
export default function App() {
  const [token, setToken] = useState(() => leggiToken());
  const [messaggioAccesso, setMessaggioAccesso] = useState(null);
  // Link dell'email di reset password: "/?token=...". Letto una sola volta all'avvio.
  const [tokenReset, setTokenReset] = useState(() => new URLSearchParams(window.location.search).get("token"));
  // Ritorno da Stripe Checkout: "/?abbonamento=successo|annullato". Il webhook
  // può arrivare con qualche secondo di ritardo rispetto al redirect del browser.
  const [verificandoPagamento, setVerificandoPagamento] = useState(
    () => new URLSearchParams(window.location.search).get("abbonamento") === "successo"
  );
  const [abbonamentoInfo, setAbbonamentoInfo] = useState(null); // { stato, giorniProvaRestanti, haAccesso }
  const [bloccatoAbbonamento, setBloccatoAbbonamento] = useState(false);
  const [versioneAccesso, setVersioneAccesso] = useState(0); // incrementato per forzare un ricaricamento dati
  const [mostraBenvenuto, setMostraBenvenuto] = useState(false); // solo subito dopo una registrazione riuscita
  const [isAdmin, setIsAdmin] = useState(false); // deciso SEMPRE dal server (403 su /api/admin/* se non lo sei)
  const [caricamento, setCaricamento] = useState(true);
  const [dipendenti, setDipendenti] = useState([]);
  const [commesse, setCommesse] = useState([]);
  const [registrazioni, setRegistrazioni] = useState([]);
  const [materiali, setMateriali] = useState([]); // voci di costo materiale (rotte /api/materiali)
  const [allegati, setAllegati] = useState([]); // documenti DDT: solo metadati, i file si scaricano a richiesta
  const [spazioAllegati, setSpazioAllegati] = useState(null); // { usatoAzienda, quotaAzienda, maxFile }
  const [vista, setVista] = useState("dashboard");
  const [dal, setDal] = useState("2026-07-01");
  const [al, setAl] = useState("2026-07-31");
  const [azienda, setAzienda] = useState("");
  const [dettaglio, setDettaglio] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [conferma, setConferma] = useState(null);
  const [flussoImport, setFlussoImport] = useState(null); // {piani, avvisi, conflitti[], idx, decisioni{}}

  const notifica = useCallback((testo, tipo = "ok") => {
    const id = uid("t");
    setToasts((t) => [...t, { id, testo, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
  }, []);

  /* ---------------------------------------------------------------------
     PERSISTENZA VIA BACKEND (src/datiAPI.js → GET/PUT /api/stato)
     - all'avvio: carica i dati salvati, oppure semina i dati d'esempio se è
       la primissima apertura (nessun dato trovato per questa azienda).
     - a ogni modifica: salvataggio automatico in background (con un piccolo
       ritardo per non scrivere a ogni singolo carattere digitato).
     - `pronto` evita di salvare uno stato "vuoto" nella finestra di tempo
       fra il primo render e l'arrivo dei dati caricati dal server.
  --------------------------------------------------------------------- */
  const pronto = useRef(false);

  /** Token non più valido (scaduto o rifiutato dal server): torna alla
   *  schermata di accesso con un messaggio chiaro, senza dettagli tecnici. */
  useEffect(() => {
    suSessioneScaduta(() => {
      cancellaToken();
      pronto.current = false;
      setCaricamento(true);
      setMessaggioAccesso("La sessione è scaduta: accedi di nuovo.");
      setToken(null);
    });
  }, []);

  /** Prova scaduta e nessun abbonamento attivo: il token resta valido (non è
   *  un logout), si mostra solo la schermata di abbonamento richiesto. */
  useEffect(() => {
    suAbbonamentoRichiesto(() => {
      pronto.current = true;
      setCaricamento(false);
      setBloccatoAbbonamento(true);
    });
  }, []);

  const uscire = useCallback(() => {
    cancellaToken();
    pronto.current = false;
    setCaricamento(true);
    setDipendenti([]); setCommesse([]); setRegistrazioni([]); setMateriali([]); setAllegati([]); setAzienda("");
    setMessaggioAccesso(null);
    setBloccatoAbbonamento(false);
    setIsAdmin(false);
    setToken(null);
  }, []);

  /** Mostra la voce "Amministrazione" solo se il server conferma che l'utente
   *  è admin (chiamando /api/admin/statistiche, che risponde 403 altrimenti).
   *  Indipendente dallo stato dell'abbonamento: non è la sezione operativa. */
  useEffect(() => {
    if (!token) { setIsAdmin(false); return; }
    let annullato = false;
    (async () => {
      const stats = await datiAPI.adminStatistiche();
      if (!annullato) setIsAdmin(!!stats);
    })();
    return () => { annullato = true; };
  }, [token]);

  /** Se qualcosa porta la vista su "admin" senza che l'utente lo sia (es. uno
   *  stato rimasto da una sessione precedente), si torna alla dashboard con un
   *  messaggio chiaro invece di un errore tecnico: il controllo che conta resta
   *  comunque quello lato server sulle rotte /api/admin/*. */
  useEffect(() => {
    if (vista === "admin" && !isAdmin) {
      setVista("dashboard");
      notifica("Non hai accesso a questa sezione.", "avviso");
    }
  }, [vista, isAdmin, notifica]);

  // Pulisce subito il parametro "?abbonamento=" dall'URL (non serve più dopo averlo letto).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("abbonamento")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  /** Dopo il ritorno da Stripe, il webhook può metterci qualche secondo:
   *  ricontrolla lo stato ogni 1,5s per un massimo di ~10s prima di arrendersi. */
  useEffect(() => {
    if (!token || !verificandoPagamento) return;
    let annullato = false;
    let tentativi = 0;
    const controlla = async () => {
      const info = await datiAPI.statoAbbonamento();
      if (annullato) return;
      tentativi += 1;
      if (info?.haAccesso) {
        setAbbonamentoInfo(info);
        setBloccatoAbbonamento(false);
        setVerificandoPagamento(false);
        setVersioneAccesso((v) => v + 1);
        return;
      }
      if (tentativi >= 7) { setVerificandoPagamento(false); return; }
      setTimeout(controlla, 1500);
    };
    controlla();
    return () => { annullato = true; };
  }, [token, verificandoPagamento]);

  useEffect(() => {
    if (!token || verificandoPagamento) return;
    let annullato = false;
    (async () => {
      const [{ dati, avviso }, infoAbbonamento] = await Promise.all([datiAPI.carica(), datiAPI.statoAbbonamento()]);
      if (annullato) return;
      if (infoAbbonamento) setAbbonamentoInfo(infoAbbonamento);
      if (avviso) notifica(avviso, "avviso");
      // Un'azienda appena registrata parte sempre vuota: i dati d'esempio restano
      // disponibili solo su richiesta esplicita (pulsante "Ricarica dati d'esempio").
      if (dati) {
        setDipendenti(Array.isArray(dati.dipendenti) ? dati.dipendenti : []);
        setCommesse(Array.isArray(dati.commesse) ? dati.commesse : []);
        setRegistrazioni(Array.isArray(dati.registrazioni) ? dati.registrazioni : []);
        setMateriali(Array.isArray(dati.materiali) ? dati.materiali : []);
        setAllegati(Array.isArray(dati.allegati) ? dati.allegati : []);
        if (dati.spazioAllegati) setSpazioAllegati(dati.spazioAllegati);
        if (typeof dati.azienda === "string") setAzienda(dati.azienda);
      }
      pronto.current = true;
      setCaricamento(false);
    })();
    return () => { annullato = true; };
  }, [token, notifica, verificandoPagamento, versioneAccesso]);

  useEffect(() => {
    if (!pronto.current) return;
    const t = setTimeout(() => {
      datiAPI.salva(null, { dipendenti, commesse, registrazioni, azienda });
    }, 600);
    return () => clearTimeout(t);
  }, [dipendenti, commesse, registrazioni, azienda]);

  /** Salvataggio immediato + snapshot di sicurezza forzato, per le operazioni
   *  che cambiano molti dati in un colpo (import, svuota, ripristino).
   *  I materiali si mandano SOLO se presenti nella patch: ometterli significa
   *  "lasciali come stanno" (li gestiscono le rotte /api/materiali). */
  const salvaSubitoConBackup = useCallback((patch) => {
    datiAPI.salva(null, {
      dipendenti: patch.dipendenti ?? dipendenti,
      commesse: patch.commesse ?? commesse,
      registrazioni: patch.registrazioni ?? registrazioni,
      azienda: patch.azienda ?? azienda,
      ...(Array.isArray(patch.materiali) ? { materiali: patch.materiali } : {}),
    }, { forzaBackup: true });
  }, [dipendenti, commesse, registrazioni, azienda]);

  const erroreIntervallo = dal && al && al < dal;
  const riep = useMemo(() => {
    if (!dal || !al || erroreIntervallo) return null;
    return calcolaRiepilogo({ registrazioni, dipendenti, commesse, dal, al });
  }, [registrazioni, dipendenti, commesse, dal, al, erroreIntervallo]);

  /**
   * Manodopera e materiali uniti, commessa per commessa. `riep` resta quello
   * di sempre (sola manodopera): qui si affianca il costo dei materiali senza
   * mai mescolarlo, e si aggiungono le commesse che nell'intervallo hanno
   * materiali ma nessuna ora.
   */
  const costi = useMemo(() => {
    if (!dal || !al || erroreIntervallo) {
      return { righe: [], perCommessa: new Map(), totManodopera: 0, totMateriali: 0, totTotale: 0 };
    }
    return unisciCosti({ riep, materiali, commesse, dal, al });
  }, [riep, materiali, commesse, dal, al, erroreIntervallo]);

  /** Serie storiche per i grafici di andamento. Calcolata una sola volta e
   *  condivisa fra Dashboard e pannello di dettaglio: dipende solo dai dati,
   *  non dall'intervallo selezionato, quindi non si ricalcola quando si
   *  cambiano le date o si naviga fra le viste. */
  const serieMensile = useMemo(
    () => calcolaSerieMensile({ registrazioni, dipendenti, commesse }),
    [registrazioni, dipendenti, commesse]
  );

  const meseIntero = dal && al && meseDi(dal) === meseDi(al) && dal.slice(8) === "01" && al.slice(8) === String(ultimoGiornoMese(meseDi(al))).padStart(2, "0");
  const vaiMese = (ym) => { setDal(ym + "-01"); setAl(ym + "-" + String(ultimoGiornoMese(ym)).padStart(2, "0")); };
  const scorriMese = (delta) => vaiMese(spostaMese(meseIntero ? meseDi(dal) : meseDi(dal || oggiISO()), delta));

  const estremiDati = useMemo(() => {
    if (registrazioni.length === 0) return null;
    let min = registrazioni[0].data, max = registrazioni[0].data;
    for (const r of registrazioni) { if (r.data < min) min = r.data; if (r.data > max) max = r.data; }
    return { min, max };
  }, [registrazioni]);

  /* --- azioni sui dati --- */
  const aggiungiRegistrazione = (reg) => setRegistrazioni((r) => [...r, reg]);
  const eliminaRegistrazione = (id) => setRegistrazioni((r) => r.filter((x) => x.id !== id));
  const aggiornaRegistrazione = (id, patch) => setRegistrazioni((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const eliminaDipendente = (dip) => setConferma({
    titolo: "Eliminare il dipendente?",
    testo: `Verranno eliminate anche tutte le ore registrate da ${dip.nome} ${dip.cognome}. L'operazione non si può annullare.`,
    onOk: () => {
      setDipendenti((d) => d.filter((x) => x.id !== dip.id));
      setRegistrazioni((r) => r.filter((x) => x.dipendenteId !== dip.id));
      notifica(`Dipendente ${dip.nome} ${dip.cognome} eliminato.`);
    },
  });
  const eliminaCommessa = (com) => setConferma({
    titolo: "Eliminare la commessa?",
    testo: `Verranno eliminate anche tutte le ore registrate, i materiali e i documenti della commessa ${com.codice}. L'operazione non si può annullare.`,
    onOk: () => {
      setCommesse((c) => c.filter((x) => x.id !== com.id));
      setRegistrazioni((r) => r.filter((x) => x.commessaId !== com.id));
      // Materiali e documenti della commessa spariscono anche sul server
      // (cascata sulla chiave esterna): qui si allinea subito la copia locale.
      setMateriali((m) => m.filter((x) => x.commessaId !== com.id));
      setAllegati((a) => a.filter((x) => x.commessaId !== com.id));
      setDettaglio(null);
      notifica(`Commessa ${com.codice} eliminata.`);
    },
  });

  /**
   * Rinomina una commessa: cambia SOLO l'etichetta (codice/descrizione).
   * Le ore sono legate alla commessa tramite commessaId, quindi registrazioni,
   * costi, riepiloghi ed export restano identici: qui non si tocca nient'altro.
   * Il controllo di proprietà e quello sui codici doppi sono del server; se
   * rifiuta, lo stato locale non viene modificato.
   */
  const rinominaCommessa = async (id, { codice, descrizione }) => {
    try {
      const aggiornata = await datiAPI.rinominaCommessa(id, { codice, descrizione });
      setCommesse((c) => c.map((x) => (x.id === aggiornata.id ? { ...x, codice: aggiornata.codice, descrizione: aggiornata.descrizione } : x)));
      setDettaglio((d) => (d && d.commessa.id === aggiornata.id
        ? { ...d, commessa: { ...d.commessa, codice: aggiornata.codice, descrizione: aggiornata.descrizione } }
        : d));
      notifica(`Commessa rinominata in ${aggiornata.codice}.`);
      return { ok: true };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };

  /* --- materiali: passano dalle loro rotte, non dal salvataggio automatico ---
     Il server è l'autorità: verifica che la commessa sia dell'azienda del
     token e calcola lui il costo della riga (quantità × prezzo). Se rifiuta,
     lo stato locale non viene toccato. */
  const aggiungiMateriale = async (dati) => {
    try {
      const creato = await datiAPI.aggiungiMateriale(dati);
      setMateriali((m) => [creato, ...m]);
      notifica(`Materiale aggiunto: ${creato.descrizione} · ${euro(creato.costo)}.`);
      // Una voce datata fuori dall'intervallo scelto sparirebbe dall'elenco
      // senza spiegazione: meglio dirlo subito invece di farla sembrare persa.
      if (creato.data < dal || creato.data > al) {
        notifica(`La voce è datata ${fmtData(creato.data)}, fuori dall'intervallo mostrato: cambia le date per vederla.`, "avviso");
      }
      return { ok: true, materiale: creato };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };
  const aggiornaMateriale = async (id, dati) => {
    try {
      const agg = await datiAPI.aggiornaMateriale(id, dati);
      setMateriali((m) => m.map((x) => (x.id === agg.id ? agg : x)));
      notifica("Materiale aggiornato.");
      return { ok: true, materiale: agg };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };
  const eliminaMateriale = async (voce) => {
    try {
      await datiAPI.eliminaMateriale(voce.id);
      setMateriali((m) => m.filter((x) => x.id !== voce.id));
      notifica("Voce di materiale eliminata.");
      return { ok: true };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };

  /* --- documenti (DDT): archivio, nessuna lettura del contenuto ---
     Come i materiali, passano dalle loro rotte e non dal salvataggio
     automatico. Il file viaggia una volta sola: qui si tengono solo i
     metadati, il contenuto si riscarica quando si apre il documento. */
  const caricaAllegato = async (commessaId, file) => {
    try {
      const { allegato, spazio } = await datiAPI.caricaAllegato(commessaId, file);
      setAllegati((a) => [allegato, ...a]);
      if (spazio) setSpazioAllegati(spazio);
      notifica(`Documento allegato: ${allegato.nomeFile} (${fmtDimensione(allegato.dimensione)}).`);
      return { ok: true, allegato };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };
  const apriAllegato = async (allegato) => {
    try {
      const { url } = await datiAPI.apriAllegato(allegato.id);
      // Si apre da una URL locale al browser: il documento non passa mai da un
      // indirizzo pubblico. La finestra si prende il blob, poi lo si libera.
      const finestra = window.open(url, "_blank", "noopener");
      if (!finestra) {
        // Il browser ha bloccato la finestra: si ripiega sul salvataggio.
        const a = document.createElement("a");
        a.href = url; a.download = allegato.nomeFile;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { ok: true };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };
  const eliminaAllegato = (allegato) => setConferma({
    titolo: "Eliminare il documento?",
    testo: `"${allegato.nomeFile}" verrà eliminato dall'archivio. L'operazione non si può annullare.`,
    onOk: async () => {
      try {
        const ris = await datiAPI.eliminaAllegato(allegato.id);
        setAllegati((a) => a.filter((x) => x.id !== allegato.id));
        if (ris?.spazio) setSpazioAllegati(ris.spazio);
        notifica("Documento eliminato.");
      } catch (e) {
        notifica(e.message, "errore");
      }
    },
  });

  const svuotaTutto = () => setConferma({
    titolo: "Svuotare tutti i dati?",
    testo: "Dipendenti, commesse, registrazioni, materiali e documenti allegati verranno cancellati. Prima di procedere puoi scaricare un backup dalla sezione Dati.",
    onOk: () => {
      setDipendenti([]); setCommesse([]); setRegistrazioni([]); setMateriali([]); setAllegati([]); setDettaglio(null);
      salvaSubitoConBackup({ dipendenti: [], commesse: [], registrazioni: [], materiali: [] });
      notifica("Tutti i dati sono stati cancellati.");
    },
  });
  const ricaricaEsempio = () => {
    const d = creaDatiEsempio();
    setDipendenti(d.dipendenti); setCommesse(d.commesse); setRegistrazioni(d.registrazioni);
    setDal("2026-07-01"); setAl("2026-07-31");
    salvaSubitoConBackup({ dipendenti: d.dipendenti, commesse: d.commesse, registrazioni: d.registrazioni });
    notifica("Dati d'esempio (luglio 2026) ricaricati.");
  };

  /** "Backup (JSON)": salva su un file scelto dall'utente sul PC (non più un download del browser).
   *  Include anche i materiali, altrimenti un backup/ripristino li perderebbe.
   *  Dei documenti allegati salva solo l'ELENCO (nome, tipo, dimensione, data):
   *  i file veri restano nell'archivio, metterli qui dentro renderebbe il
   *  backup enorme e impossibile da scaricare. Serve come inventario. */
  const backupJSON = async () => {
    const ris = await datiAPI.backupEsporta(null, {
      azienda, dipendenti, commesse, registrazioni, materiali,
      allegati: allegati.map((a) => ({ ...a, nota: "solo riferimento: il file resta nell'archivio dell'app" })),
    });
    if (ris.ok) notifica("Backup salvato: " + ris.percorso);
    else if (!ris.annullato) notifica("Non è stato possibile salvare il backup.", "errore");
  };
  /** "Ripristina backup": apre un file JSON scelto dall'utente sul PC. */
  const ripristinaJSON = async () => {
    const ris = await datiAPI.backupImporta();
    if (!ris.ok) { if (!ris.annullato) notifica("File di backup non valido: " + ris.errore, "errore"); return; }
    const d = ris.dati;
    if (!Array.isArray(d.dipendenti) || !Array.isArray(d.commesse) || !Array.isArray(d.registrazioni)) {
      notifica("File di backup non valido: struttura non valida.", "errore");
      return;
    }
    // I backup fatti prima dei materiali non hanno la chiave "materiali":
    // in quel caso si lasciano quelli già presenti, senza cancellare nulla.
    const materialiBackup = Array.isArray(d.materiali) ? d.materiali : null;
    setDipendenti(d.dipendenti); setCommesse(d.commesse); setRegistrazioni(d.registrazioni);
    if (materialiBackup) setMateriali(materialiBackup);
    if (typeof d.azienda === "string") setAzienda(d.azienda);
    salvaSubitoConBackup({
      dipendenti: d.dipendenti, commesse: d.commesse, registrazioni: d.registrazioni,
      azienda: d.azienda, ...(materialiBackup ? { materiali: materialiBackup } : {}),
    });
    notifica("Backup ripristinato: i dati sono tornati com'erano.");
  };

  /* --- import Excel con gestione dei conflitti dipendente+mese --- */
  const caricaExcel = (file) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const { piani, avvisi } = analizzaExcel(fr.result);
        if (piani.length === 0) {
          avvisi.forEach((a) => notifica(a, "avviso"));
          notifica("Nessun foglio leggibile nel file.", "errore");
          return;
        }
        const stato = { dipendenti, commesse, registrazioni };
        const conflitti = piani.map((p, i) => (trovaConflitto(stato, p) ? i : -1)).filter((i) => i >= 0);
        if (conflitti.length === 0) {
          concludiImport(piani, {}, avvisi);
        } else {
          setFlussoImport({ piani, avvisi, conflitti, idx: 0, decisioni: {} });
        }
      } catch (e) { notifica("Impossibile leggere il file Excel: " + e.message, "errore"); }
    };
    fr.readAsArrayBuffer(file);
  };

  const concludiImport = (piani, decisioni, avvisi) => {
    const ris = applicaImport({ dipendenti, commesse, registrazioni }, piani, decisioni);
    setDipendenti(ris.dipendenti); setCommesse(ris.commesse); setRegistrazioni(ris.registrazioni);
    salvaSubitoConBackup({ dipendenti: ris.dipendenti, commesse: ris.commesse, registrazioni: ris.registrazioni });
    avvisi.forEach((a) => notifica(a, "avviso"));
    notifica(`Import completato: ${piani.length} fogli letti · ${ris.aggiunte} registrazioni aggiunte · ${ris.sostituiti} mesi sostituiti · ${ris.saltati} saltati.`);
    const applicati = piani.filter((_, i) => decisioni[i] !== "salta");
    if (applicati.length) vaiMese(applicati[0].mese);
    setFlussoImport(null);
  };

  const decidiConflitto = (scelta) => {
    if (!flussoImport) return;
    if (scelta === "annulla") { setFlussoImport(null); notifica("Import annullato: nessun dato è stato modificato.", "avviso"); return; }
    const { piani, avvisi, conflitti, idx, decisioni } = flussoImport;
    const nuove = { ...decisioni, [conflitti[idx]]: scelta };
    if (idx + 1 < conflitti.length) setFlussoImport({ ...flussoImport, idx: idx + 1, decisioni: nuove });
    else concludiImport(piani, nuove, avvisi);
  };

  const stampaPDF = () => window.print();

  const NAV = [
    { id: "dashboard", nome: "Dashboard", icona: LayoutDashboard },
    { id: "commesse", nome: "Commesse", icona: FolderKanban },
    { id: "dipendenti", nome: "Dipendenti", icona: Users },
    { id: "dati", nome: "Dati", icona: Database },
    { id: "abbonamento", nome: "Abbonamento", icona: CreditCard },
    ...(isAdmin ? [{ id: "admin", nome: "Amministrazione", icona: ShieldCheck }] : []),
  ];

  const costoLive = useContatore(riep ? riep.totCosto : 0);
  const pianoConflitto = flussoImport ? flussoImport.piani[flussoImport.conflitti[flussoImport.idx]] : null;

  if (tokenReset) {
    return (
      <PaginaResetPassword
        token={tokenReset}
        alSuccesso={(msg) => {
          window.history.replaceState({}, "", window.location.pathname);
          setTokenReset(null);
          setMessaggioAccesso(msg);
        }}
      />
    );
  }

  if (!token) {
    return (
      <SchermataAccesso
        messaggio={messaggioAccesso}
        alSuccesso={(appenaRegistrato) => {
          setMessaggioAccesso(null);
          if (appenaRegistrato) setMostraBenvenuto(true);
          setToken(leggiToken());
        }}
      />
    );
  }

  if (verificandoPagamento) {
    return <VerificaPagamento />;
  }

  if (bloccatoAbbonamento) {
    return <PaginaAbbonamento onUscire={uscire} />;
  }

  if (caricamento) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--tela)", color: "var(--txt)" }}>
        <StileGlobale />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Caricamento dati…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: "var(--tela)", color: "var(--txt)" }}>
      <StileGlobale />

      {/* ================= BARRA LATERALE ================= */}
      <aside className="w-60 shrink-0 flex-col hidden lg:flex noprint superficie-scura">
        <div className="px-6 pt-7 pb-8 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center f-display text-sm shrink-0" style={{ background: "linear-gradient(160deg,#2A313C,#1A1F27)", color: "var(--accent-chiaro)", border: "1px solid rgba(255,255,255,.07)" }}>C</div>
          <div className="f-display text-[15px] leading-tight" style={{ color: "#EDEAE2" }}>Costi Commessa</div>
        </div>
        <nav className="px-3 space-y-0.5" aria-label="Navigazione principale">
          {NAV.map(({ id, nome, icona: Icona }) => (
            <button key={id} onClick={() => setVista(id)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm transition-colors btn"
              style={vista === id
                ? { background: "rgba(255,255,255,.06)", color: "#F0EDE5", fontWeight: 600 }
                : { color: "#8B929C", fontWeight: 500 }}>
              <Icona size={17} strokeWidth={1.75} style={vista === id ? { color: "var(--accent-chiaro)" } : undefined} /> {nome}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-3 pb-3">
          {abbonamentoInfo?.stato === "prova" && (() => {
            const urgente = abbonamentoInfo.giorniProvaRestanti <= 3;
            return (
              <button
                onClick={() => setVista("abbonamento")}
                className="w-full mb-2 px-3.5 py-2.5 rounded-lg text-left btn"
                style={urgente
                  ? { background: "var(--velo-accento)", border: "1px solid rgba(196,162,101,.3)" }
                  : { background: "rgba(255,255,255,.05)" }}
              >
                <div className="flex items-center gap-2 text-xs font-medium" style={{ color: urgente ? "var(--accent-chiaro)" : "#B8A47C" }}>
                  <Clock size={14} strokeWidth={1.75} className="shrink-0" />
                  {abbonamentoInfo.giorniProvaRestanti === 1
                    ? "Ultimo giorno di prova"
                    : `${abbonamentoInfo.giorniProvaRestanti} giorni di prova rimanenti`}
                </div>
                {urgente && (
                  <div className="text-[11px] mt-0.5 ml-5" style={{ color: "#9BA1AB" }}>Abbonati ora →</div>
                )}
              </button>
            );
          })()}
          <button onClick={uscire} className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm transition-colors btn" style={{ color: "#8B929C", fontWeight: 500 }}>
            <LogOut size={17} strokeWidth={1.75} /> Esci
          </button>
        </div>
        <div className="px-6 pb-5 text-xs leading-relaxed" style={{ color: "#5A616C" }}>
          Costo del lavoro per commessa.<br />Calcoli in piena precisione.
        </div>
      </aside>

      {/* ================= COLONNA PRINCIPALE ================= */}
      <div className="flex-1 min-w-0 flex flex-col pb-16 lg:pb-0">

        {/* ---- testata: periodo + momento eroe ---- */}
        <header className="sticky top-0 z-30 noprint superficie-scura" style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
          <div className="px-5 md:px-10 py-4 flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-1.5">
              <button onClick={() => scorriMese(-1)} aria-label="Mese precedente" className="p-2 rounded-lg btn tasto-scuro"><ChevronLeft size={15} strokeWidth={1.75} /></button>
              <input type="date" value={dal} onChange={(e) => setDal(e.target.value)} aria-label="Inizio intervallo" className="f-mono text-[13px] rounded-lg px-2.5 py-1.5 outline-none campo-scuro" />
              <span style={{ color: "#4E555F" }}>–</span>
              <input type="date" value={al} onChange={(e) => setAl(e.target.value)} aria-label="Fine intervallo" className="f-mono text-[13px] rounded-lg px-2.5 py-1.5 outline-none campo-scuro" style={erroreIntervallo ? { boxShadow: "0 0 0 1px #C4655D" } : undefined} />
              <button onClick={() => scorriMese(1)} aria-label="Mese successivo" className="p-2 rounded-lg btn tasto-scuro"><ChevronRight size={15} strokeWidth={1.75} /></button>
              {estremiDati && !erroreIntervallo && (
                <button onClick={() => { setDal(estremiDati.min); setAl(estremiDati.max); }} className="ml-1 hidden sm:inline-block text-xs px-2.5 py-1.5 rounded-lg btn tasto-scuro">Tutto</button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-7">
              {riep && riep.invariante && (
                <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium"
                  style={{ color: riep.invariante.ok ? "#79C89C" : "#D9B36A" }}
                  title={riep.invariante.ok ? "Il costo del periodo coincide con la somma dei lordi mensili" : "Quadratura non verificata: controlla lordi e dati"}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
                  {riep.invariante.ok ? "Quadra" : "Non quadra"}
                </span>
              )}
              <div className="text-right">
                <Micro tono="#828A95">Costo del periodo</Micro>
                <p className="f-mono text-[26px] md:text-[30px] font-medium leading-none mt-1" style={{ color: "#8CD6AC", letterSpacing: "-0.01em" }}>
                  {riep ? euro(costoLive) : "—"}
                </p>
              </div>
              <div className="text-right hidden sm:block pl-7" style={{ borderLeft: "1px solid rgba(255,255,255,.08)" }}>
                <Micro tono="#828A95">Ore</Micro>
                <p className="f-mono text-[26px] md:text-[30px] font-normal leading-none mt-1" style={{ color: "#D9D6CD" }}>{riep ? fmtOre.format(riep.totOre) : "—"}</p>
              </div>
              <button onClick={uscire} aria-label="Esci" title="Esci" className="lg:hidden p-2 rounded-lg btn tasto-scuro" style={{ color: "#8B929C" }}>
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          {erroreIntervallo && (
            <p className="px-5 md:px-10 pb-3 text-sm flex items-center gap-1.5" style={{ color: "#E2A29B" }}>
              <AlertTriangle size={14} strokeWidth={1.75} /> La data "Al" precede la data "Dal": correggi l'intervallo.
            </p>
          )}
        </header>

        <main key={vista} className="flex-1 px-5 md:px-10 py-8 max-w-6xl w-full noprint anim-vista">
          {riep && riep.avvisi.length > 0 && (
            <div className="mb-8 rounded-xl px-4 py-3 space-y-1" style={{ background: "var(--velo-accento)", border: "1px solid rgba(154,120,58,.18)" }} role="alert">
              {riep.avvisi.map((a, i) => (
                <p key={i} className="text-sm flex items-start gap-2" style={{ color: "#7C6027" }}><AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {a}</p>
              ))}
            </div>
          )}

          {vista === "dashboard" && <Dashboard riep={riep} costi={costi} dal={dal} al={al} dipendenti={dipendenti} serieMensile={serieMensile} vaiCommesse={() => setVista("commesse")} vaiDati={() => setVista("dati")} haDati={registrazioni.length > 0} apri={setDettaglio} />}
          {vista === "commesse" && <VistaCommesse riep={riep} costi={costi} dal={dal} al={al} apri={setDettaglio} esportaCsv={() => riep && esportaCSV(costi.righe, costi, dal, al)} esportaXlsx={() => riep && esportaXLSX(costi.righe, costi, dal, al)} esportaTutto={() => esportaCompletoXLSX({ dipendenti, commesse, registrazioni, materiali }, dal, al)} stampa={stampaPDF} vaiDati={() => setVista("dati")} />}
          {vista === "dipendenti" && <VistaDipendenti dipendenti={dipendenti} setDipendenti={setDipendenti} riep={riep} elimina={eliminaDipendente} notifica={notifica} />}
          {vista === "dati" && (
            <VistaDati
              dipendenti={dipendenti} commesse={commesse} registrazioni={registrazioni}
              setDipendenti={setDipendenti} setCommesse={setCommesse}
              aggiungi={aggiungiRegistrazione} eliminaReg={eliminaRegistrazione} aggiornaReg={aggiornaRegistrazione}
              eliminaCommessa={eliminaCommessa} rinominaCommessa={rinominaCommessa} caricaExcel={caricaExcel} backup={backupJSON} ripristina={ripristinaJSON}
              svuota={svuotaTutto} esempio={ricaricaEsempio} azienda={azienda} setAzienda={setAzienda} notifica={notifica}
              esportaTutto={() => esportaCompletoXLSX({ dipendenti, commesse, registrazioni }, dal, al)}
            />
          )}
          {vista === "abbonamento" && <VistaAbbonamento info={abbonamentoInfo} />}
          {vista === "admin" && isAdmin && <VistaAdmin />}
        </main>
      </div>

      {/* ---- navigazione mobile ---- */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 grid noprint superficie-scura" style={{ borderTop: "1px solid rgba(255,255,255,.07)", gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }} aria-label="Navigazione">
        {NAV.map(({ id, nome, icona: Icona }) => (
          <button key={id} onClick={() => setVista(id)} className="flex flex-col items-center gap-1 py-2.5 btn"
            style={{ color: vista === id ? "var(--accent-chiaro)" : "#8B929C" }}>
            <Icona size={18} strokeWidth={1.75} />
            <span className="text-[11px] font-medium">{nome}</span>
          </button>
        ))}
      </nav>

      {/* La riga mostrata si rilegge sempre da `costi`, non dalla copia salvata
          all'apertura: così aggiungendo o togliendo un materiale i numeri del
          pannello si aggiornano subito. */}
      {dettaglio && (
        <PannelloDettaglio
          riga={costi.righe.find((r) => r.commessa.id === dettaglio.commessa.id) || { ...dettaglio, costoManodopera: dettaglio.costo ?? 0, costoMateriali: 0, costoTotale: dettaglio.costo ?? 0, voci: [] }}
          riep={riep} costi={costi} dal={dal} al={al} serieMensile={serieMensile}
          allegati={allegati} spazioAllegati={spazioAllegati}
          onAggiungiMateriale={aggiungiMateriale} onAggiornaMateriale={aggiornaMateriale} onEliminaMateriale={eliminaMateriale}
          onCaricaAllegato={caricaAllegato} onApriAllegato={apriAllegato} onEliminaAllegato={eliminaAllegato}
          onChiudi={() => setDettaglio(null)} />
      )}

      {/* conflitto d'import: sostituisci / salta / annulla tutto */}
      {pianoConflitto && (
        <Modale titolo="Ore già presenti" onChiudi={() => decidiConflitto("annulla")} bloccante>
          <p className="text-sm leading-relaxed mb-2" style={{ color: "var(--muted)" }}>
            Per <strong style={{ color: "var(--txt)" }}>{pianoConflitto.nome} {pianoConflitto.cognome}</strong> nel mese di <strong style={{ color: "var(--txt)" }}>{fmtMese(pianoConflitto.mese)}</strong> ci sono già delle ore registrate.
          </p>
          <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--muted)" }}>
            Sostituirle con quelle del file ({pianoConflitto.righe.length} registrazioni) o lasciarle come sono?
            {flussoImport.conflitti.length > 1 && <span className="block mt-1 text-xs">Conflitto {flussoImport.idx + 1} di {flussoImport.conflitti.length}.</span>}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Bottone variante="pericolo" onClick={() => decidiConflitto("annulla")}>Annulla tutto</Bottone>
            <Bottone variante="fantasma" onClick={() => decidiConflitto("salta")}>Salta questo mese</Bottone>
            <Bottone onClick={() => decidiConflitto("sostituisci")}>Sostituisci</Bottone>
          </div>
        </Modale>
      )}

      {conferma && (
        <Modale titolo={conferma.titolo} onChiudi={() => setConferma(null)}>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "var(--muted)" }}>{conferma.testo}</p>
          <div className="flex justify-end gap-2">
            <Bottone variante="fantasma" onClick={() => setConferma(null)}>Annulla</Bottone>
            <Bottone variante="pericolo" onClick={() => { conferma.onOk(); setConferma(null); }}><Trash2 size={14} strokeWidth={1.75} /> Elimina</Bottone>
          </div>
        </Modale>
      )}

      {mostraBenvenuto && (
        <Modale titolo="Benvenuto in Costi Commessa" onChiudi={() => setMostraBenvenuto(false)}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: "var(--velo-accento)" }}>
            <PartyPopper size={18} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
          </div>
          <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--txt)" }}>
            Il tuo account è pronto: hai <strong>14 giorni di prova gratuita</strong>, senza nessuna carta da inserire.
          </p>
          <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
            In questo periodo puoi registrare ore per dipendente e commessa, vedere il costo del lavoro in tempo reale ed esportare i report in Excel.
          </p>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--muted)" }}>
            Alla scadenza della prova, potrai abbonarti per 29 €/mese per continuare — disdici quando vuoi, dalla sezione "Abbonamento" nella barra laterale.
          </p>
          <Bottone variante="accento" className="w-full" onClick={() => setMostraBenvenuto(false)}>
            Ho capito, iniziamo
          </Bottone>
        </Modale>
      )}

      <div className="fixed bottom-16 lg:bottom-5 right-5 z-50 space-y-2 noprint" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm max-w-sm anim-pop"
            style={{ background: "var(--ink)", color: "#EDEAE2", boxShadow: "var(--ombra-lg)" }}>
            {t.tipo === "errore" ? <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "#E2A29B" }} />
              : t.tipo === "avviso" ? <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "#D9B36A" }} />
              : <CheckCircle2 size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "#8CD6AC" }} />}
            {t.testo}
          </div>
        ))}
      </div>

      <ReportStampa riep={riep} costi={costi} dal={dal} al={al} azienda={azienda} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DASHBOARD
--------------------------------------------------------------------------- */
/**
 * Storico mensile: costo e ore per mese, indipendente dall'intervallo
 * selezionato. È un componente a sé proprio perché deve restare visibile
 * anche quando l'intervallo scelto non ha ore — in quel caso è l'unica cosa
 * che dice all'utente dove sono davvero i suoi dati.
 * Non usa hook: la serie arriva già memoizzata da App, qui si fanno solo map.
 */
function AndamentoMensile({ serieMensile }) {
  const mesiSerie = serieMensile?.mesi ?? [];
  const datiMesi = mesiSerie.map((m) => ({
    mese: fmtMeseBreve(m.mese),
    costo: Math.round(m.costo * 100) / 100,
    ore: Math.round(m.ore * 100) / 100,
  }));
  const ultimoMese = mesiSerie[mesiSerie.length - 1];
  const penultimoMese = mesiSerie[mesiSerie.length - 2];
  const variazione = penultimoMese && penultimoMese.costo > 0
    ? (ultimoMese.costo - penultimoMese.costo) / penultimoMese.costo
    : null;

  return (
    <section className="rounded-2xl p-6" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-5">
        <h2 className="f-display text-lg">Andamento mensile</h2>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {datiMesi.length >= 2
            ? `Ultimi ${datiMesi.length} mesi con ore registrate · indipendente dall'intervallo scelto`
            : "Storico completo, indipendente dall'intervallo scelto"}
        </p>
      </div>

      {datiMesi.length < 2 ? (
        <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl" style={{ background: "var(--tela)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3.5" style={{ background: "var(--velo-accento)" }}>
            <Clock size={18} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
          </div>
          <p className="f-display text-base mb-1.5" style={{ color: "var(--txt)" }}>Servono almeno due mesi di dati per vedere l'andamento</p>
          <p className="text-sm max-w-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            {datiMesi.length === 1
              ? `Al momento c'è un solo mese con ore registrate (${fmtMese(mesiSerie[0].mese)}). Appena ne arriverà un altro, qui comparirà il confronto nel tempo.`
              : "Registra o importa le ore di almeno due mesi diversi per confrontare come cambia il costo del lavoro."}
          </p>
        </div>
      ) : (
        <>
          {variazione !== null && (
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
              {fmtMese(ultimoMese.mese)}: <span className="f-mono" style={{ color: "var(--euro)" }}>{euro(ultimoMese.costo)}</span>
              {" · "}
              <span className="f-mono" style={{ color: variazione > 0 ? "#A6753A" : variazione < 0 ? "#1E7350" : "var(--muted)" }}>
                {variazione > 0 ? "▲" : variazione < 0 ? "▼" : "="} {fmtPerc.format(Math.abs(variazione) * 100)}%
              </span>
              {" rispetto a "}{fmtMese(penultimoMese.mese)}
            </p>
          )}

          <div className="grid lg:grid-cols-2 gap-x-8 gap-y-7">
            <div>
              <Micro>Costo per mese</Micro>
              <div className="mt-3" style={{ height: 190 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={datiMesi} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--hairline)" vertical={false} />
                    <XAxis dataKey="mese" tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} minTickGap={4} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} tickFormatter={(v) => fmtOre.format(v)} width={54} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [euro(v), "Costo del mese"]}
                      contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "var(--ombra-md)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 12px" }}
                      cursor={{ fill: "rgba(23,27,34,.04)" }} />
                    <Bar dataKey="costo" radius={[2, 2, 0, 0]} maxBarSize={38}>
                      {datiMesi.map((_, i) => <Cell key={i} fill={i === datiMesi.length - 1 ? "var(--accent)" : "#454C57"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <Micro>Ore per mese</Micro>
              <div className="mt-3" style={{ height: 190 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={datiMesi} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--hairline)" vertical={false} />
                    <XAxis dataKey="mese" tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} minTickGap={4} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} tickFormatter={(v) => fmtOre.format(v)} width={46} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [fmtOre.format(v) + " h", "Ore del mese"]}
                      contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "var(--ombra-md)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 12px" }}
                      cursor={{ fill: "rgba(23,27,34,.04)" }} />
                    <Bar dataKey="ore" radius={[2, 2, 0, 0]} maxBarSize={38} fill="#8A9099" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * I tre numeri del costo, sempre affiancati e sempre distinti: manodopera,
 * materiali, totale. Non vanno mai mescolati fra loro perché rispondono a
 * domande diverse ("quanto mi è costato il lavoro" / "quanto ho speso in
 * materiale"); il totale è solo la loro somma.
 */
function FasciaCosti({ costi, titolo = "Costo del periodo" }) {
  const voci = [
    { e: "Manodopera", v: euro(costi.totManodopera), c: "var(--euro)" },
    { e: "Materiali", v: euro(costi.totMateriali), c: "var(--euro)" },
    { e: "Costo totale", v: euro(costi.totTotale), c: "var(--accent)", forte: true },
  ];
  return (
    <section className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
      <div className="px-6 pt-5">
        <Micro>{titolo}</Micro>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 mt-1">
        {voci.map((k, i) => (
          <div key={k.e} className="px-6 py-4"
            style={{ borderLeft: i > 0 ? "1px solid var(--hairline)" : "none", background: k.forte ? "var(--tela)" : "transparent" }}>
            <Micro>{k.e}</Micro>
            <p className={"f-mono mt-2 leading-none " + (k.forte ? "text-[24px]" : "text-[20px]")} style={{ color: k.c }}>{k.v}</p>
            {k.forte && <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>manodopera + materiali</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Dashboard({ riep, costi, dal, al, dipendenti, serieMensile, vaiCommesse, vaiDati, haDati, apri }) {
  if (!riep) return null;
  const { righe, totCosto, totOre } = riep;
  const top = righe[0];

  const perDip = useMemo(() => {
    const m = new Map();
    for (const r of righe) for (const d of r.dipendenti) {
      if (!m.has(d.dip.id)) m.set(d.dip.id, { dip: d.dip, ore: 0, costo: 0 });
      const x = m.get(d.dip.id); x.ore += d.ore; x.costo += d.costo;
    }
    return [...m.values()].sort((a, b) => b.costo - a.costo);
  }, [righe]);

  if (righe.length === 0) {
    // L'intervallo scelto non ha ore, ma lo storico può comunque esistere (in
    // altri mesi): l'andamento mensile resta visibile e indica all'utente dove
    // sono davvero i suoi dati, invece di lasciare la Dashboard tutta vuota.
    return (
      <div className="space-y-10">
        {/* Zero ore non vuol dire zero costi: se ci sono materiali nel periodo,
            i tre numeri restano visibili invece di sparire con le ore. */}
        {costi.totMateriali > 0 && <FasciaCosti costi={costi} />}
        <StatoVuoto icona={LayoutDashboard} titolo="Nessuna ora nell'intervallo"
          testo={costi.totMateriali > 0
            ? "In queste date ci sono materiali ma nessuna ora registrata: il riepilogo Commesse mostra le commesse interessate."
            : haDati ? "Cambia l'intervallo di date con le frecce in alto oppure registra nuove ore." : "Non ci sono ancora dati. Registra le prime ore, importa il file Excel o ricarica i dati d'esempio dalla sezione Dati."}
          azione={costi.totMateriali > 0
            ? <Bottone onClick={vaiCommesse}><ChevronRight size={14} strokeWidth={1.75} /> Vai al riepilogo</Bottone>
            : <Bottone onClick={vaiDati}><Plus size={14} strokeWidth={1.75} /> Vai a Dati</Bottone>} />
        {haDati && <AndamentoMensile serieMensile={serieMensile} />}
      </div>
    );
  }

  // Le barre mostrano il costo TOTALE della commessa (manodopera + materiali):
  // è il numero che risponde a "quanto mi è costata davvero". La ripartizione
  // fra le due voci si legge nel riepilogo e nel dettaglio.
  const datiBarre = costi.righe.map((r) => ({
    nome: r.commessa.codice,
    costo: Math.round(r.costoTotale * 100) / 100,
    riga: r,
  }));
  const datiGiorni = [...riep.perGiorno.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, c]) => ({ giorno: d.slice(8) + "/" + d.slice(5, 7), costo: Math.round(c * 100) / 100 }));
  const costoMedioOra = totOre > 0 ? totCosto / totOre : 0;

  // "Più costosa" e "attive" guardano il costo TOTALE (manodopera + materiali):
  // una commessa può essere in testa per la spesa di materiale. Il costo medio
  // orario invece resta di sola manodopera, perché è una tariffa del lavoro.
  const piuCostosa = costi.righe[0] || top;
  const kpi = [
    { e: "Commesse attive", v: String(Math.max(righe.length, costi.righe.length)) },
    { e: "Costo medio orario", v: fmtNum.format(costoMedioOra), u: "€/h", sub: "solo manodopera", subMuto: true },
    { e: "Commessa più costosa", v: piuCostosa.commessa.codice, sub: euro(piuCostosa.costoTotale ?? piuCostosa.costo) },
    { e: "Dipendenti attivi", v: String(perDip.length), sub: `su ${dipendenti.length} totali`, muto: true },
  ];

  return (
    <div className="space-y-10">
      <div>
        <Micro>Cruscotto</Micro>
        <h1 className="f-display text-[26px] mt-1" style={{ letterSpacing: "-0.01em" }}>{fmtData(dal)} – {fmtData(al)}</h1>
      </div>

      <FasciaCosti costi={costi} />

      {/* KPI: una fascia unica, separatori a filo */}
      <div className="rounded-2xl grid grid-cols-2 xl:grid-cols-4 overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
        {kpi.map((k, i) => (
          <div key={k.e} className="px-6 py-5" style={{ borderLeft: i > 0 ? "1px solid var(--hairline)" : "none" }}>
            <Micro>{k.e}</Micro>
            <p className="f-mono text-[22px] mt-2 leading-none" style={{ color: k.muto ? "var(--muted)" : "var(--txt)" }}>
              {k.v}{k.u && <span className="text-sm ml-1" style={{ color: "var(--muted)" }}>{k.u}</span>}
            </p>
            {k.sub && <p className="f-mono text-xs mt-1.5" style={{ color: k.muto || k.subMuto ? "var(--muted)" : "var(--euro)" }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-5 gap-6 items-start">
        {/* costo per commessa */}
        <section className="xl:col-span-3 rounded-2xl p-6" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="f-display text-lg">Costo per commessa</h2>
            <button onClick={vaiCommesse} className="text-[13px] font-medium flex items-center gap-1 btn" style={{ color: "var(--accent)" }}>Riepilogo <ChevronRight size={13} strokeWidth={1.75} /></button>
          </div>
          <div style={{ height: Math.max(200, datiBarre.length * 25 + 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datiBarre} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} onClick={(e) => e && e.activePayload && apri(e.activePayload[0].payload.riga)}>
                <CartesianGrid stroke="var(--hairline)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} tickFormatter={(v) => fmtOre.format(v)} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" width={46} tick={{ fontSize: 11.5, fontFamily: "'IBM Plex Mono', monospace", fill: "var(--txt)" }} interval={0} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [euro(v), "Costo totale"]} labelFormatter={(l) => "Commessa " + l}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "var(--ombra-md)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 12px" }}
                  cursor={{ fill: "rgba(23,27,34,.04)" }} />
                <Bar dataKey="costo" radius={[0, 2, 2, 0]} maxBarSize={9} className="cursor-pointer">
                  {datiBarre.map((_, i) => <Cell key={i} fill={i === 0 ? "var(--accent)" : "#454C57"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>Seleziona una barra per aprire il dettaglio della commessa.</p>
        </section>

        <div className="xl:col-span-2 space-y-6">
          {/* per dipendente */}
          <section className="rounded-2xl p-6" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
            <h2 className="f-display text-lg mb-5">Costo per dipendente</h2>
            <div className="space-y-5">
              {perDip.map((d) => (
                <div key={d.dip.id}>
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <p className="text-sm font-medium truncate">{d.dip.nome} {d.dip.cognome}</p>
                    <p className="f-mono text-sm shrink-0" style={{ color: "var(--euro)" }}>{euro(d.costo)}</p>
                  </div>
                  <BarraQuota quota={totCosto > 0 ? d.costo / totCosto : 0} />
                  <p className="f-mono text-xs mt-1.5" style={{ color: "var(--muted)" }}>{fmtOre.format(d.ore)} h · {fmtPerc.format(totCosto > 0 ? (d.costo / totCosto) * 100 : 0)}%</p>
                </div>
              ))}
            </div>
          </section>

          {/* andamento */}
          {datiGiorni.length > 1 && (
            <section className="rounded-2xl p-6" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
              <h2 className="f-display text-lg mb-4">Andamento giornaliero</h2>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={datiGiorni} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradCosto" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--hairline)" vertical={false} />
                    <XAxis dataKey="giorno" tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} minTickGap={28} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} tickFormatter={(v) => fmtOre.format(v)} width={46} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [euro(v), "Costo del giorno"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "var(--ombra-md)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 12px" }} />
                    <Area type="monotone" dataKey="costo" stroke="var(--accent)" strokeWidth={1.75} fill="url(#gradCosto)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>
      </div>

      <AndamentoMensile serieMensile={serieMensile} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   RIEPILOGO COMMESSE
--------------------------------------------------------------------------- */
function VistaCommesse({ riep, costi, dal, al, apri, esportaCsv, esportaXlsx, esportaTutto, stampa, vaiDati }) {
  const [ordina, setOrdina] = useState({ campo: "totale", disc: true });
  const [cerca, setCerca] = useState("");
  if (!riep) return null;

  const valore = (r, campo) => (
    campo === "ore" ? r.ore
      : campo === "codice" ? r.commessa.codice
      : campo === "manodopera" ? r.costoManodopera
      : campo === "materiali" ? r.costoMateriali
      : r.costoTotale
  );
  const filtro = cerca.trim().toLowerCase();
  const righe = costi.righe
    .filter((r) => !filtro || (r.commessa.codice + " " + r.commessa.descrizione).toLowerCase().includes(filtro))
    .sort((a, b) => {
      const va = valore(a, ordina.campo), vb = valore(b, ordina.campo);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return ordina.disc ? -c : c;
    });
  const clic = (campo) => setOrdina((o) => ({ campo, disc: o.campo === campo ? !o.disc : true }));
  const freccia = (campo) => (ordina.campo === campo ? (ordina.disc ? " ↓" : " ↑") : "");
  const maxCosto = costi.righe.length ? Math.max(...costi.righe.map((r) => r.costoTotale)) : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Micro>Riepilogo</Micro>
          <h1 className="f-display text-[26px] mt-1" style={{ letterSpacing: "-0.01em" }}>Commesse</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Bottone variante="fantasma" onClick={esportaCsv}><FileText size={14} strokeWidth={1.75} /> CSV</Bottone>
          <Bottone variante="fantasma" onClick={esportaXlsx}><FileSpreadsheet size={14} strokeWidth={1.75} /> Excel</Bottone>
          <Bottone variante="fantasma" onClick={esportaTutto}><FileDown size={14} strokeWidth={1.75} /> Esporta tutto in Excel</Bottone>
          <Bottone onClick={stampa}><Download size={14} strokeWidth={1.75} /> PDF</Bottone>
        </div>
      </div>

      {costi.righe.length === 0 ? (
        <StatoVuoto icona={FolderKanban} titolo="Nessuna commessa nell'intervallo"
          testo="Nessuna ora né materiale registrati in queste date. Allarga l'intervallo o registra nuove ore."
          azione={<Bottone onClick={vaiDati}><Plus size={14} strokeWidth={1.75} /> Registra ore</Bottone>} />
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
          <div className="px-6 py-4 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
            <p className="text-[13px] f-mono" style={{ color: "var(--muted)" }}>{fmtData(dal)} – {fmtData(al)} · {righe.length} commesse</p>
            <div className="relative">
              <Search size={13} strokeWidth={1.75} className="absolute left-3 top-2.5" style={{ color: "var(--muted)" }} />
              <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca…"
                className={inputCls + " pl-8 py-1.5"} style={{ width: 180, background: "var(--tela)" }} aria-label="Cerca commessa" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {[["codice", "Codice", ""], [null, "Descrizione", "hidden lg:table-cell"], ["ore", "Ore", "text-right"],
                    [null, "Quota", "w-32 hidden xl:table-cell"],
                    ["manodopera", "Manodopera", "text-right"], ["materiali", "Materiali", "text-right"], ["totale", "Totale", "text-right"]].map(([campo, nome, cls]) => (
                    <th key={nome} className={`px-6 py-3.5 text-[11px] font-semibold uppercase ${cls} ${campo ? "cursor-pointer select-none" : ""}`}
                      style={{ letterSpacing: ".1em", color: "var(--muted)" }} onClick={campo ? () => clic(campo) : undefined}>
                      {nome}{campo ? freccia(campo) : ""}
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.commessa.id} onClick={() => apri(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && apri(r)}
                    className="cursor-pointer transition-colors riga" style={{ borderTop: "1px solid var(--hairline)" }}>
                    <td className="px-6 py-4 f-mono font-medium">{r.commessa.codice}</td>
                    <td className="px-6 py-4 hidden lg:table-cell" style={{ color: "var(--muted)" }}>{r.commessa.descrizione}</td>
                    <td className="px-6 py-4 f-mono text-right">{fmtOre.format(r.ore)}</td>
                    <td className="px-6 py-4 hidden xl:table-cell">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1"><BarraQuota quota={maxCosto > 0 ? r.costoTotale / maxCosto : 0} colore="#454C57" /></div>
                        <span className="f-mono text-xs w-11 text-right" style={{ color: "var(--muted)" }}>{fmtPerc.format(costi.totTotale > 0 ? (r.costoTotale / costi.totTotale) * 100 : 0)}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 f-mono text-right" style={{ color: "var(--euro)" }}>{euro(r.costoManodopera)}</td>
                    <td className="px-6 py-4 f-mono text-right" style={{ color: r.costoMateriali > 0 ? "var(--euro)" : "var(--muted)" }}>{euro(r.costoMateriali)}</td>
                    <td className="px-6 py-4 f-mono text-right font-medium" style={{ color: "var(--accent)" }}>{euro(r.costoTotale)}</td>
                    <td className="pr-4 text-right"><ChevronRight size={14} strokeWidth={1.75} style={{ color: "var(--muted)" }} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid var(--txt)", background: "var(--tela)" }}>
                  <td className="px-6 py-4 f-display">Totale</td>
                  <td className="hidden lg:table-cell" />
                  <td className="px-6 py-4 f-mono text-right font-medium">{fmtOre.format(riep.totOre)}</td>
                  <td className="hidden xl:table-cell" />
                  <td className="px-6 py-4 f-mono text-right font-medium" style={{ color: "var(--euro)" }}>{euro(costi.totManodopera)}</td>
                  <td className="px-6 py-4 f-mono text-right font-medium" style={{ color: "var(--euro)" }}>{euro(costi.totMateriali)}</td>
                  <td className="px-6 py-4 f-mono text-right font-medium" style={{ color: "var(--accent)" }}>{euro(costi.totTotale)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PannelloDettaglio({ riga, riep, costi, dal, al, serieMensile, allegati, spazioAllegati,
  onAggiungiMateriale, onAggiornaMateriale, onEliminaMateriale,
  onCaricaAllegato, onApriAllegato, onEliminaAllegato, onChiudi }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onChiudi();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onChiudi]);
  const quota = costi && costi.totTotale > 0 ? riga.costoTotale / costi.totTotale : 0;
  const maxDip = riga.dipendenti.length ? Math.max(...riga.dipendenti.map((d) => d.costo)) : 0;

  // Storico di QUESTA commessa, estratto dalla serie già calcolata in App:
  // nessun ricalcolo qui, solo una lettura dalla mappa per id.
  const serieCommessa = serieMensile?.perCommessa.get(riga.commessa.id) ?? [];
  const datiCommessa = serieCommessa.map((m) => ({
    mese: fmtMeseBreve(m.mese),
    costo: Math.round(m.costo * 100) / 100,
    ore: Math.round(m.ore * 100) / 100,
  }));
  return (
    <div className="fixed inset-0 z-40 noprint" role="dialog" aria-modal="true" aria-label={"Dettaglio commessa " + riga.commessa.codice}>
      <div className="absolute inset-0 anim-velo" style={{ background: "rgba(18,21,26,.4)", backdropFilter: "blur(2px)" }} onClick={onChiudi} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md flex flex-col anim-slide" style={{ background: "var(--card)", boxShadow: "var(--ombra-lg)" }}>
        <div className="px-7 py-6 superficie-scura flex items-start justify-between">
          <div>
            <Micro tono="#828A95">Dettaglio commessa</Micro>
            <h3 className="f-display text-[28px] leading-none mt-1.5" style={{ color: "#F0EDE5" }}>{riga.commessa.codice}</h3>
            <p className="text-sm mt-2" style={{ color: "#8B929C" }}>{riga.commessa.descrizione}</p>
          </div>
          <button onClick={onChiudi} aria-label="Chiudi dettaglio" className="p-1.5 rounded-lg btn" style={{ color: "#8B929C" }}><X size={17} strokeWidth={1.75} /></button>
        </div>
        <div className="p-7 space-y-7 overflow-y-auto">
          {/* I tre numeri, sempre distinti: ore e manodopera, materiali, e la
              loro somma. Non si mescolano mai in un unico "costo". */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--hairline)" }}>
            <div className="grid grid-cols-3">
              {[["Ore", fmtOre.format(riga.ore), null], ["Manodopera", euro(riga.costoManodopera), "var(--euro)"], ["Materiali", euro(riga.costoMateriali), riga.costoMateriali > 0 ? "var(--euro)" : "var(--muted)"]].map(([e, v, col], i) => (
                <div key={e} className="px-4 py-3.5" style={{ borderLeft: i > 0 ? "1px solid var(--hairline)" : "none" }}>
                  <Micro>{e}</Micro>
                  <p className="f-mono text-[15px] mt-1.5" style={{ color: col || "var(--txt)" }}>{v}</p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3.5 flex items-end justify-between gap-3" style={{ borderTop: "1px solid var(--hairline)", background: "var(--tela)" }}>
              <div>
                <Micro>Costo totale</Micro>
                <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>manodopera + materiali · {fmtPerc.format(quota * 100)}% del periodo</p>
              </div>
              <p className="f-mono text-[20px] leading-none" style={{ color: "var(--accent)" }}>{euro(riga.costoTotale)}</p>
            </div>
          </div>
          <p className="text-xs f-mono" style={{ color: "var(--muted)" }}>Intervallo {fmtData(dal)} – {fmtData(al)}</p>
          <div>
            <h4 className="f-display text-base mb-4">Dipendenti sulla commessa</h4>
            <div className="space-y-5">
              {riga.dipendenti.map((d, i) => (
                <div key={i}>
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <p className="text-sm font-medium">{d.dip.nome} {d.dip.cognome}</p>
                    <p className="f-mono text-sm" style={{ color: "var(--euro)" }}>{euro(d.costo)}</p>
                  </div>
                  <BarraQuota quota={maxDip > 0 ? d.costo / maxDip : 0} />
                  <p className="text-xs f-mono mt-1.5" style={{ color: "var(--muted)" }}>{fmtOre.format(d.ore)} h · tariffa media {fmtNum4.format(d.tariffaMedia)} €/h</p>
                </div>
              ))}
            </div>
          </div>

          <SezioneMateriali
            commessa={riga.commessa} voci={riga.voci} totale={riga.costoMateriali} dal={dal} al={al}
            onAggiungi={onAggiungiMateriale} onAggiorna={onAggiornaMateriale} onElimina={onEliminaMateriale} />

          <SezioneDocumenti
            commessa={riga.commessa}
            allegati={allegati.filter((a) => a.commessaId === riga.commessa.id)}
            spazio={spazioAllegati}
            onCarica={onCaricaAllegato} onApri={onApriAllegato} onElimina={onEliminaAllegato} />

          {/* storico della commessa: tutti i mesi in cui ha avuto ore, non solo l'intervallo */}
          <div>
            <h4 className="f-display text-base mb-1">Andamento di questa commessa</h4>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
              Costo mese per mese da quando ha ore registrate, indipendente dall'intervallo scelto.
            </p>
            {datiCommessa.length < 2 ? (
              <p className="text-sm leading-relaxed rounded-xl px-4 py-3.5" style={{ background: "var(--tela)", color: "var(--muted)" }}>
                {datiCommessa.length === 1
                  ? `Questa commessa ha ore in un solo mese (${fmtMese(serieCommessa[0].mese)}): non c'è ancora un andamento da confrontare.`
                  : "Nessuna ora registrata su questa commessa nello storico disponibile."}
              </p>
            ) : (
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={datiCommessa} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradCostoCommessa" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--hairline)" vertical={false} />
                    <XAxis dataKey="mese" tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} minTickGap={4} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", fill: "#9AA0A8" }} tickFormatter={(v) => fmtOre.format(v)} width={54} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [euro(v), "Costo del mese"]}
                      contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", boxShadow: "var(--ombra-md)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "8px 12px" }} />
                    <Area type="monotone" dataKey="costo" stroke="var(--accent)" strokeWidth={1.75} fill="url(#gradCostoCommessa)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Materiali di una commessa: inserimento, elenco e totale.
 * Vive dentro il pannello di dettaglio, così la voce si inserisce dov'è già
 * chiaro di quale commessa si sta parlando. Il collegamento è per id, quindi
 * rinominare la commessa non tocca nulla di qui.
 * L'elenco mostra le voci dell'intervallo scelto, come tutti gli altri numeri
 * del pannello.
 */
function SezioneMateriali({ commessa, voci, totale, dal, al, onAggiungi, onAggiorna, onElimina }) {
  // La data proposta cade sempre dentro l'intervallo mostrato: così la voce
  // appena inserita è visibile subito invece di finire fuori dalla vista.
  const dataIniziale = () => { const o = oggiISO(); return o >= dal && o <= al ? o : dal; };
  const vuoto = { data: dataIniziale(), fornitore: "", descrizione: "", quantita: "", prezzoUnitario: "" };
  const [f, setF] = useState(vuoto);
  const [inModifica, setInModifica] = useState(null); // id della voce in modifica
  const [err, setErr] = useState({});
  const [inCorso, setInCorso] = useState(false);

  const q = parseNumIt(f.quantita), p = parseNumIt(f.prezzoUnitario);
  const costoRiga = !isNaN(q) && !isNaN(p) ? q * p : null;

  const annulla = () => { setInModifica(null); setF(vuoto); setErr({}); };

  const invia = async () => {
    if (inCorso) return;
    const e = {};
    if (!dataValida(f.data)) e.data = "Data non valida.";
    if (!f.descrizione.trim()) e.descrizione = "Scrivi che materiale è.";
    if (isNaN(q) || q <= 0) e.quantita = "Maggiore di zero.";
    if (isNaN(p) || p < 0) e.prezzoUnitario = "Non può essere negativo.";
    setErr(e);
    if (Object.keys(e).length) return;

    const dati = {
      commessaId: commessa.id, data: f.data, fornitore: f.fornitore.trim(),
      descrizione: f.descrizione.trim(), quantita: q, prezzoUnitario: p,
    };
    setInCorso(true);
    const ris = inModifica ? await onAggiorna(inModifica, dati) : await onAggiungi(dati);
    setInCorso(false);
    if (!ris?.ok) return;
    // Dopo un inserimento si tengono data e fornitore: di solito si caricano
    // più voci dello stesso documento una dopo l'altra.
    setInModifica(null);
    setF((x) => ({ ...vuoto, data: x.data, fornitore: inModifica ? "" : x.fornitore }));
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h4 className="f-display text-base">Materiali</h4>
        <p className="f-mono text-sm" style={{ color: totale > 0 ? "var(--euro)" : "var(--muted)" }}>{euro(totale)}</p>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        Voci di spesa inserite a mano, nell'intervallo scelto. Il costo della riga è quantità × prezzo unitario e si somma alla manodopera solo nel costo totale.
      </p>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--tela)", border: "1px solid var(--hairline)" }}
        onKeyDown={(e) => e.key === "Enter" && invia()}>
        <div className="grid grid-cols-2 gap-3">
          <Campo etichetta="Data" errore={err.data}>
            <input type="date" value={f.data} onChange={(e) => setF((x) => ({ ...x, data: e.target.value }))} className={inputCls + " f-mono"} style={{ background: "var(--card)" }} />
          </Campo>
          <Campo etichetta="Fornitore">
            <input value={f.fornitore} onChange={(e) => setF((x) => ({ ...x, fornitore: e.target.value }))} placeholder="es. Ferramenta Bianchi" className={inputCls} style={{ background: "var(--card)" }} />
          </Campo>
        </div>
        <Campo etichetta="Descrizione" errore={err.descrizione}>
          <input value={f.descrizione} onChange={(e) => setF((x) => ({ ...x, descrizione: e.target.value }))} placeholder="es. Cemento 32,5 R — sacchi 25 kg" className={inputCls} style={{ background: "var(--card)" }} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etichetta="Quantità" errore={err.quantita}>
            <input value={f.quantita} onChange={(e) => setF((x) => ({ ...x, quantita: e.target.value }))} placeholder="es. 10" className={inputCls + " f-mono text-right"} style={{ background: "var(--card)" }} />
          </Campo>
          <Campo etichetta="Prezzo unitario (€)" errore={err.prezzoUnitario}>
            <input value={f.prezzoUnitario} onChange={(e) => setF((x) => ({ ...x, prezzoUnitario: e.target.value }))} placeholder="es. 5,00" className={inputCls + " f-mono text-right"} style={{ background: "var(--card)" }} />
          </Campo>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <Micro>Costo riga</Micro>
            <p className="f-mono text-[15px] mt-1" style={{ color: costoRiga ? "var(--euro)" : "var(--muted)" }}>
              {costoRiga != null ? euro(costoRiga) : "—"}
            </p>
          </div>
          <div className="flex gap-2">
            {inModifica && <Bottone variante="fantasma" onClick={annulla} disabled={inCorso}>Annulla</Bottone>}
            <Bottone onClick={invia} disabled={inCorso}>
              {inModifica ? <Save size={14} strokeWidth={1.75} /> : <Plus size={14} strokeWidth={1.75} />}
              {inCorso ? "Salvataggio…" : inModifica ? "Salva" : "Aggiungi"}
            </Bottone>
          </div>
        </div>
      </div>

      {voci.length === 0 ? (
        <p className="text-sm mt-4" style={{ color: "var(--muted)" }}>Nessun materiale registrato su questa commessa nell'intervallo scelto.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {voci.map((m) => (
            <li key={m.id} className="rounded-xl px-3.5 py-3 flex items-start justify-between gap-3"
              style={{ border: "1px solid var(--hairline)", background: inModifica === m.id ? "var(--velo-accento)" : "transparent" }}>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{m.descrizione}</p>
                <p className="f-mono text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {fmtData(m.data)}{m.fornitore ? " · " + m.fornitore : ""}
                </p>
                <p className="f-mono text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  {fmtOre.format(m.quantita)} × {fmtNum.format(m.prezzoUnitario)} €
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <p className="f-mono text-sm" style={{ color: "var(--euro)" }}>{euro(m.costo)}</p>
                <button onClick={() => { setInModifica(m.id); setErr({}); setF({ data: m.data, fornitore: m.fornitore, descrizione: m.descrizione, quantita: String(m.quantita).replace(".", ","), prezzoUnitario: String(m.prezzoUnitario).replace(".", ",") }); }}
                  aria-label={"Modifica materiale " + m.descrizione} className="p-1.5 rounded-lg btn" style={{ border: "1px solid var(--hairline)" }}>
                  <Pencil size={12} strokeWidth={1.75} />
                </button>
                <button onClick={async () => { if (inModifica === m.id) annulla(); await onElimina(m); }}
                  aria-label={"Elimina materiale " + m.descrizione} className="p-1.5 rounded-lg btn" style={{ border: "1px solid rgba(166,58,50,.22)", color: "#A63A32" }}>
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Documenti (DDT) di una commessa: caricamento, elenco, apertura, eliminazione.
 * In questo passo il documento viene solo archiviato e collegato: nessuna
 * lettura del contenuto. Il collegamento è per id della commessa, quindi
 * rinominarla non stacca nulla.
 * A differenza dei materiali l'elenco NON è filtrato per intervallo di date:
 * un archivio di documenti serve tutto, sempre.
 */
function SezioneDocumenti({ commessa, allegati, spazio, onCarica, onApri, onElimina }) {
  const refFile = useRef();
  const [inCaricamento, setInCaricamento] = useState(null); // nome del file in corso
  const [inApertura, setInApertura] = useState(null);

  const scegli = async (file) => {
    if (!file) return;
    setInCaricamento(file.name);
    await onCarica(commessa.id, file);
    setInCaricamento(null);
  };

  const apri = async (a) => { setInApertura(a.id); await onApri(a); setInApertura(null); };

  const usato = spazio?.usatoAzienda ?? 0;
  const quota = spazio?.quotaAzienda ?? 0;
  const quotaPiena = quota > 0 ? Math.min(1, usato / quota) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h4 className="f-display text-base">Documenti · DDT</h4>
        <p className="f-mono text-xs" style={{ color: "var(--muted)" }}>{allegati.length} {allegati.length === 1 ? "documento" : "documenti"}</p>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        Archivio dei documenti di trasporto della commessa: PDF o foto, fino a {spazio ? fmtDimensione(spazio.maxFile) : "5 MB"} l'uno. Le foto vengono rimpicciolite prima di essere caricate. Per ora i documenti si conservano soltanto: la lettura automatica arriverà più avanti.
      </p>

      <input ref={refFile} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; scegli(f); }} />

      {inCaricamento ? (
        <div className="rounded-xl px-4 py-3.5" style={{ background: "var(--tela)", border: "1px solid var(--hairline)" }}>
          <div className="flex items-center gap-2.5">
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" style={{ color: "var(--accent)" }} />
            <p className="text-sm truncate">Caricamento di {inCaricamento}…</p>
          </div>
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: "var(--hairline)" }}>
            <div className="h-full anim-scorre" style={{ background: "var(--accent)", width: "40%" }} />
          </div>
        </div>
      ) : (
        <Bottone variante="fantasma" onClick={() => refFile.current.click()}>
          <Upload size={14} strokeWidth={1.75} /> Allega un documento
        </Bottone>
      )}

      {allegati.length === 0 ? (
        <p className="text-sm mt-4" style={{ color: "var(--muted)" }}>Nessun documento allegato a questa commessa.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {allegati.map((a) => (
            <li key={a.id} className="rounded-xl px-3.5 py-3 flex items-center justify-between gap-3" style={{ border: "1px solid var(--hairline)" }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--velo-accento)" }}>
                  {a.tipo === "application/pdf"
                    ? <FileText size={16} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
                    : <FileImage size={16} strokeWidth={1.75} style={{ color: "var(--accent)" }} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.nomeFile}</p>
                  <p className="f-mono text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    {fmtData(a.caricatoIl.slice(0, 10))} · {fmtDimensione(a.dimensione)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => apri(a)} disabled={inApertura === a.id}
                  aria-label={"Apri documento " + a.nomeFile} className="p-1.5 rounded-lg btn" style={{ border: "1px solid var(--hairline)" }}>
                  {inApertura === a.id
                    ? <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                    : <Download size={12} strokeWidth={1.75} />}
                </button>
                <button onClick={() => onElimina(a)} aria-label={"Elimina documento " + a.nomeFile}
                  className="p-1.5 rounded-lg btn" style={{ border: "1px solid rgba(166,58,50,.22)", color: "#A63A32" }}>
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {spazio && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <Micro>Spazio archivio</Micro>
            <p className="f-mono text-xs" style={{ color: quotaPiena > 0.9 ? "#A63A32" : "var(--muted)" }}>
              {fmtDimensione(usato)} di {fmtDimensione(quota)}
            </p>
          </div>
          <div className="mt-2"><BarraQuota quota={quotaPiena} colore={quotaPiena > 0.9 ? "#A63A32" : "#454C57"} /></div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DIPENDENTI
--------------------------------------------------------------------------- */
function VistaDipendenti({ dipendenti, setDipendenti, riep, elimina, notifica }) {
  const [editor, setEditor] = useState(null);

  const salva = (dip) => {
    setDipendenti((ds) => {
      const c = ds.some((d) => d.id === dip.id);
      return c ? ds.map((d) => (d.id === dip.id ? dip : d)) : [...ds, dip];
    });
    setEditor(null);
    notifica("Dipendente salvato.");
  };

  const oreIntervallo = useMemo(() => {
    const m = new Map();
    if (riep) for (const r of riep.righe) for (const d of r.dipendenti) m.set(d.dip.id, (m.get(d.dip.id) || 0) + d.ore);
    return m;
  }, [riep]);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Micro>Squadra</Micro>
          <h1 className="f-display text-[26px] mt-1" style={{ letterSpacing: "-0.01em" }}>Dipendenti</h1>
        </div>
        <Bottone onClick={() => setEditor({ nuovo: true })}><Plus size={14} strokeWidth={1.75} /> Nuovo dipendente</Bottone>
      </div>

      {dipendenti.length === 0 ? (
        <StatoVuoto icona={Users} titolo="Nessun dipendente" testo="Aggiungi il primo dipendente con il suo lordo mensile per iniziare a registrare le ore."
          azione={<Bottone onClick={() => setEditor({ nuovo: true })}><Plus size={14} strokeWidth={1.75} /> Nuovo dipendente</Bottone>} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {dipendenti.map((dip) => {
            const mesi = new Set(Object.keys(dip.lordoMensile || {}));
            if (riep) for (const k of riep.oreMensili.keys()) { const [id, m] = k.split("|"); if (id === dip.id) mesi.add(m); }
            const elenco = [...mesi].sort().reverse();
            const iniziali = ((dip.nome[0] || "") + (dip.cognome[0] || "")).toUpperCase();
            return (
              <div key={dip.id} className="rounded-2xl p-6" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
                <div className="flex items-center gap-3.5 mb-5">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center f-mono text-[13px] shrink-0" style={{ background: "var(--velo)", color: "var(--txt)" }}>{iniziali}</div>
                  <div className="min-w-0">
                    <p className="f-display text-[17px] leading-none truncate">{dip.nome} {dip.cognome}</p>
                    <p className="text-xs f-mono mt-1.5" style={{ color: "var(--muted)" }}>Ore nell'intervallo: {fmtOre.format(oreIntervallo.get(dip.id) || 0)} h</p>
                  </div>
                  <div className="ml-auto flex gap-1 shrink-0">
                    <button onClick={() => setEditor({ dip })} aria-label="Modifica dipendente" className="p-2 rounded-lg btn" style={{ border: "1px solid var(--hairline)" }}><Pencil size={13} strokeWidth={1.75} /></button>
                    <button onClick={() => elimina(dip)} aria-label="Elimina dipendente" className="p-2 rounded-lg btn" style={{ border: "1px solid rgba(166,58,50,.22)", color: "#A63A32" }}><Trash2 size={13} strokeWidth={1.75} /></button>
                  </div>
                </div>
                {elenco.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Nessun mese impostato: modifica il dipendente per aggiungere il lordo mensile.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        {["Mese", "Lordo", "Ore mese", "Tariffa"].map((h, i) => (
                          <th key={h} className={`py-2 text-[11px] font-semibold uppercase ${i > 0 ? "text-right" : ""}`} style={{ letterSpacing: ".1em", color: "var(--muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="f-mono">
                      {elenco.map((m) => {
                        const ore = riep ? (riep.oreMensili.get(dip.id + "|" + m) || 0) : 0;
                        const lordo = dip.lordoMensile?.[m];
                        const tar = lordo != null && ore > 0 ? lordo / ore : null;
                        return (
                          <tr key={m} style={{ borderTop: "1px solid var(--hairline)" }}>
                            <td className="py-3">{fmtMese(m)}</td>
                            <td className="py-3 text-right">{lordo != null ? euro(lordo) : <span className="font-sans" style={{ color: "#A63A32" }}>manca</span>}</td>
                            <td className="py-3 text-right">{fmtOre.format(ore)}</td>
                            <td className="py-3 text-right">{tar != null ? fmtNum4.format(tar) + " €/h" : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editor && <EditorDipendente iniziale={editor.dip} onSalva={salva} onChiudi={() => setEditor(null)} />}
    </div>
  );
}

function EditorDipendente({ iniziale, onSalva, onChiudi }) {
  const [nome, setNome] = useState(iniziale?.nome || "");
  const [cognome, setCognome] = useState(iniziale?.cognome || "");
  const [lordi, setLordi] = useState(() =>
    Object.entries(iniziale?.lordoMensile || {}).sort().map(([mese, importo]) => ({ mese, importo: fmtNum.format(importo).replace(/\./g, "") }))
  );
  const [errori, setErrori] = useState({});

  const invia = () => {
    const e = {};
    if (!nome.trim()) e.nome = "Il nome è obbligatorio.";
    const lordoMensile = {};
    for (const { mese, importo } of lordi) {
      if (!/^\d{4}-\d{2}$/.test(mese)) { e.lordi = "Ogni riga deve avere un mese valido."; continue; }
      const v = parseNumIt(importo);
      if (isNaN(v) || v < 0) { e.lordi = "Importo non valido: usa numeri come 2.500,00."; continue; }
      lordoMensile[mese] = v;
    }
    setErrori(e);
    if (Object.keys(e).length) return;
    onSalva({ id: iniziale?.id || uid("e"), nome: nome.trim(), cognome: cognome.trim(), lordoMensile });
  };

  return (
    <Modale titolo={iniziale ? "Modifica dipendente" : "Nuovo dipendente"} onChiudi={onChiudi} largo>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Campo etichetta="Nome" errore={errori.nome}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
        </Campo>
        <Campo etichetta="Cognome">
          <input value={cognome} onChange={(e) => setCognome(e.target.value)} className={inputCls} />
        </Campo>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase" style={{ letterSpacing: ".1em", color: "var(--muted)" }}>Lordo mensile (per mese)</span>
        <Bottone variante="fantasma" onClick={() => setLordi((l) => [...l, { mese: oggiISO().slice(0, 7), importo: "" }])} className="py-1 px-2.5 text-xs"><Plus size={12} strokeWidth={1.75} /> Aggiungi mese</Bottone>
      </div>
      {errori.lordi && <p className="text-xs mb-2" style={{ color: "#A63A32" }}>{errori.lordi}</p>}
      <div className="space-y-2 mb-7">
        {lordi.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>Nessun mese: aggiungine uno per poter calcolare le tariffe.</p>}
        {lordi.map((riga, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input type="month" value={riga.mese} onChange={(e) => setLordi((l) => l.map((x, j) => (j === i ? { ...x, mese: e.target.value } : x)))} className={inputCls + " f-mono"} style={{ width: 170 }} aria-label="Mese" />
            <input value={riga.importo} onChange={(e) => setLordi((l) => l.map((x, j) => (j === i ? { ...x, importo: e.target.value } : x)))} placeholder="es. 2.500,00" className={inputCls + " f-mono text-right"} aria-label="Lordo del mese in euro" />
            <button onClick={() => setLordi((l) => l.filter((_, j) => j !== i))} aria-label="Rimuovi mese" className="p-2 rounded-lg shrink-0 btn" style={{ border: "1px solid var(--hairline)" }}><X size={13} strokeWidth={1.75} /></button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Bottone variante="fantasma" onClick={onChiudi}>Annulla</Bottone>
        <Bottone onClick={invia}><Save size={14} strokeWidth={1.75} /> Salva</Bottone>
      </div>
    </Modale>
  );
}

/* ---------------------------------------------------------------------------
   DATI — inserimento, registrazioni, import/export, impostazioni
--------------------------------------------------------------------------- */
function VistaDati({ dipendenti, commesse, registrazioni, setCommesse, aggiungi, eliminaReg, aggiornaReg, eliminaCommessa, rinominaCommessa, caricaExcel, backup, ripristina, svuota, esempio, azienda, setAzienda, notifica, esportaTutto }) {
  const [form, setForm] = useState({ dipendenteId: "", commessaId: "", data: oggiISO(), ore: "" });
  const [erroriForm, setErroriForm] = useState({});
  const [nuovaCom, setNuovaCom] = useState({ codice: "", descrizione: "" });
  const [filtro, setFiltro] = useState("");
  const [modifica, setModifica] = useState(null);
  const [rinomina, setRinomina] = useState(null); // commessa in corso di rinomina
  const refExcel = useRef(); const refOre = useRef();

  const dipById = useMemo(() => new Map(dipendenti.map((d) => [d.id, d])), [dipendenti]);
  const comById = useMemo(() => new Map(commesse.map((c) => [c.id, c])), [commesse]);

  const registra = () => {
    const e = {};
    if (!form.dipendenteId) e.dip = "Scegli il dipendente.";
    if (!form.commessaId) e.com = "Scegli la commessa.";
    if (!dataValida(form.data)) e.data = "Data non valida.";
    const ore = parseNumIt(form.ore);
    if (isNaN(ore) || ore <= 0) e.ore = "Le ore devono essere maggiori di zero (es. 8 o 0,5).";
    setErroriForm(e);
    if (Object.keys(e).length) return;
    const doppione = registrazioni.some((r) => r.dipendenteId === form.dipendenteId && r.commessaId === form.commessaId && r.data === form.data);
    aggiungi({ id: uid("r"), dipendenteId: form.dipendenteId, commessaId: form.commessaId, data: form.data, ore });
    setForm((f) => ({ ...f, ore: "" }));
    refOre.current && refOre.current.focus();
    notifica(doppione ? "Ore registrate. Nota: c'era già una registrazione per quel giorno, le ore si sommano." : "Ore registrate.", doppione ? "avviso" : "ok");
  };

  const creaCommessa = () => {
    const codice = nuovaCom.codice.trim();
    if (!codice) { notifica("Il codice della commessa è obbligatorio.", "errore"); return; }
    if (commesse.some((c) => c.codice.toLowerCase() === codice.toLowerCase())) { notifica("Esiste già una commessa con questo codice.", "errore"); return; }
    setCommesse((c) => [...c, { id: uid("c"), codice, descrizione: nuovaCom.descrizione.trim() || "Commessa " + codice }]);
    setNuovaCom({ codice: "", descrizione: "" });
    notifica("Commessa creata.");
  };

  const elenco = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return [...registrazioni]
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
      .filter((r) => {
        if (!f) return true;
        const d = dipById.get(r.dipendenteId), c = comById.get(r.commessaId);
        return [d?.nome, d?.cognome, c?.codice, c?.descrizione, r.data].join(" ").toLowerCase().includes(f);
      })
      .slice(0, 300);
  }, [registrazioni, filtro, dipById, comById]);

  return (
    <div className="space-y-6">
      <div>
        <Micro>Gestione</Micro>
        <h1 className="f-display text-[26px] mt-1" style={{ letterSpacing: "-0.01em" }}>Dati</h1>
      </div>

      <Sezione titolo="Registra ore">
        {dipendenti.length === 0 || commesse.length === 0 ? (
          <p className="text-sm flex items-center gap-2" style={{ color: "var(--muted)" }}><Info size={14} strokeWidth={1.75} /> Per registrare ore servono almeno un dipendente e una commessa: creali qui sotto.</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end" onKeyDown={(e) => e.key === "Enter" && registra()}>
              <Campo etichetta="Dipendente" errore={erroriForm.dip}>
                <select value={form.dipendenteId} onChange={(e) => setForm((f) => ({ ...f, dipendenteId: e.target.value }))} className={inputCls}>
                  <option value="">—</option>
                  {dipendenti.map((d) => <option key={d.id} value={d.id}>{d.nome} {d.cognome}</option>)}
                </select>
              </Campo>
              <Campo etichetta="Commessa" errore={erroriForm.com}>
                <select value={form.commessaId} onChange={(e) => setForm((f) => ({ ...f, commessaId: e.target.value }))} className={inputCls}>
                  <option value="">—</option>
                  {commesse.map((c) => <option key={c.id} value={c.id}>{c.codice} — {c.descrizione}</option>)}
                </select>
              </Campo>
              <Campo etichetta="Data" errore={erroriForm.data}>
                <input type="date" value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))} className={inputCls + " f-mono"} />
              </Campo>
              <Campo etichetta="Ore" errore={erroriForm.ore}>
                <input ref={refOre} value={form.ore} onChange={(e) => setForm((f) => ({ ...f, ore: e.target.value }))} placeholder="es. 8 o 0,5" className={inputCls + " f-mono text-right"} />
              </Campo>
              <Bottone onClick={registra}><Plus size={14} strokeWidth={1.75} /> Registra</Bottone>
            </div>
            <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>Dopo ogni registrazione il modulo resta impostato: cambia solo le ore e premi Invio per inserire una giornata dopo l'altra.</p>
          </>
        )}
      </Sezione>

      <Sezione titolo="Commesse">
        <div className="grid sm:grid-cols-3 gap-4 items-end mb-5" onKeyDown={(e) => e.key === "Enter" && creaCommessa()}>
          <Campo etichetta="Codice"><input value={nuovaCom.codice} onChange={(e) => setNuovaCom((c) => ({ ...c, codice: e.target.value }))} placeholder="es. P25 o VILLA-ROSSI" className={inputCls + " f-mono"} /></Campo>
          <Campo etichetta="Descrizione"><input value={nuovaCom.descrizione} onChange={(e) => setNuovaCom((c) => ({ ...c, descrizione: e.target.value }))} placeholder="es. Ristrutturazione Villa Rossi" className={inputCls} /></Campo>
          <Bottone onClick={creaCommessa}><Plus size={14} strokeWidth={1.75} /> Nuova commessa</Bottone>
        </div>
        {commesse.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {commesse.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 text-xs rounded-lg pl-2.5 pr-1 py-1" style={{ border: "1px solid var(--hairline)", background: "var(--tela)" }} title={c.descrizione}>
                <span className="f-mono font-medium">{c.codice}</span>
                <button onClick={() => setRinomina(c)} aria-label={"Rinomina commessa " + c.codice} title="Rinomina" className="p-0.5 rounded btn" style={{ color: "var(--muted)" }}><Pencil size={10} strokeWidth={1.75} /></button>
                <button onClick={() => eliminaCommessa(c)} aria-label={"Elimina commessa " + c.codice} className="p-0.5 rounded btn" style={{ color: "var(--muted)" }}><X size={11} strokeWidth={1.75} /></button>
              </span>
            ))}
          </div>
        )}
      </Sezione>

      <Sezione titolo={<>Registrazioni <span className="f-mono text-[13px]" style={{ color: "var(--muted)" }}>({registrazioni.length})</span></>}
        extra={
          <div className="relative">
            <Search size={13} strokeWidth={1.75} className="absolute left-3 top-2.5" style={{ color: "var(--muted)" }} />
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Cerca…" className={inputCls + " pl-8 py-1.5"} style={{ width: 200, background: "var(--tela)" }} aria-label="Filtra registrazioni" />
          </div>
        }>
        {registrazioni.length === 0 ? (
          <p className="text-sm py-2" style={{ color: "var(--muted)" }}>Le ore che registri compariranno qui, ordinate dalla più recente.</p>
        ) : (
          <div className="overflow-x-auto -mx-6 -mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {["Data", "Dipendente", "Commessa", "Ore", ""].map((h, i) => (
                    <th key={i} className={`px-6 py-2.5 text-[11px] font-semibold uppercase ${h === "Ore" ? "text-right" : ""}`} style={{ letterSpacing: ".1em", color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {elenco.map((r) => {
                  const d = dipById.get(r.dipendenteId), c = comById.get(r.commessaId);
                  return (
                    <tr key={r.id} className="riga" style={{ borderTop: "1px solid var(--hairline)" }}>
                      <td className="px-6 py-3 f-mono">{fmtData(r.data)}</td>
                      <td className="px-6 py-3">{d ? d.nome + " " + d.cognome : "—"}</td>
                      <td className="px-6 py-3 f-mono">{c ? c.codice : "—"}</td>
                      <td className="px-6 py-3 f-mono text-right">{fmtOre.format(r.ore)}</td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setModifica(r)} aria-label="Modifica registrazione" className="p-1.5 rounded-lg mr-1 btn" style={{ border: "1px solid var(--hairline)" }}><Pencil size={12} strokeWidth={1.75} /></button>
                        <button onClick={() => { eliminaReg(r.id); notifica("Registrazione eliminata."); }} aria-label="Elimina registrazione" className="p-1.5 rounded-lg btn" style={{ border: "1px solid rgba(166,58,50,.22)", color: "#A63A32" }}><Trash2 size={12} strokeWidth={1.75} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {registrazioni.length > 300 && elenco.length === 300 && <p className="text-xs px-6 py-3" style={{ color: "var(--muted)" }}>Mostrate le prime 300 righe: usa la ricerca per trovarne altre.</p>}
          </div>
        )}
      </Sezione>

      <Sezione titolo="Importa, esporta, azzera">
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <Campo etichetta="Nome azienda (per l'intestazione del PDF)">
            <input value={azienda} onChange={(e) => setAzienda(e.target.value)} placeholder="es. Rossi Costruzioni S.r.l." className={inputCls} />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={refExcel} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files[0]; if (f) caricaExcel(f); e.target.value = ""; }} />
          <Bottone onClick={() => refExcel.current.click()}><Upload size={14} strokeWidth={1.75} /> Importa da Excel</Bottone>
          <Bottone variante="fantasma" onClick={esportaTutto}><FileDown size={14} strokeWidth={1.75} /> Esporta tutto in Excel</Bottone>
          <Bottone variante="fantasma" onClick={backup}><Download size={14} strokeWidth={1.75} /> Backup (JSON)</Bottone>
          <Bottone variante="fantasma" onClick={ripristina}><Upload size={14} strokeWidth={1.75} /> Ripristina backup</Bottone>
          <Bottone variante="fantasma" onClick={esempio}><RotateCcw size={14} strokeWidth={1.75} /> Ricarica esempio</Bottone>
          <Bottone variante="pericolo" onClick={svuota}><Eraser size={14} strokeWidth={1.75} /> Svuota tutto</Bottone>
        </div>
        <p className="text-xs mt-5 flex items-start gap-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>
          <Info size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" /> I dati vengono salvati automaticamente su questo PC a ogni modifica, con backup di sicurezza a data e ora conservati in caso di problemi. "Backup (JSON)" resta utile per portare una copia dei dati altrove o archiviarla a parte. Se reimporti un file con dipendenti e mesi già presenti, l'app ti chiederà se sostituire o saltare, senza mai creare doppioni.
        </p>
      </Sezione>

      {modifica && (
        <Modale titolo="Modifica registrazione" onChiudi={() => setModifica(null)}>
          <EditorRegistrazione reg={modifica} dipendenti={dipendenti} commesse={commesse}
            onSalva={(patch) => { aggiornaReg(modifica.id, patch); setModifica(null); notifica("Registrazione aggiornata."); }}
            onAnnulla={() => setModifica(null)} />
        </Modale>
      )}

      {rinomina && (
        <Modale titolo="Rinomina commessa" onChiudi={() => setRinomina(null)}>
          <EditorRinominaCommessa
            commessa={rinomina}
            commesse={commesse}
            oreCollegate={registrazioni.filter((r) => r.commessaId === rinomina.id).length}
            onSalva={(patch) => rinominaCommessa(rinomina.id, patch)}
            onFatto={() => setRinomina(null)}
            onAnnulla={() => setRinomina(null)} />
        </Modale>
      )}
    </div>
  );
}

function EditorRegistrazione({ reg, dipendenti, commesse, onSalva, onAnnulla }) {
  const [f, setF] = useState({ dipendenteId: reg.dipendenteId, commessaId: reg.commessaId, data: reg.data, ore: String(reg.ore).replace(".", ",") });
  const [err, setErr] = useState({});
  const invia = () => {
    const e = {};
    if (!dataValida(f.data)) e.data = "Data non valida.";
    const ore = parseNumIt(f.ore);
    if (isNaN(ore) || ore <= 0) e.ore = "Ore maggiori di zero.";
    setErr(e);
    if (Object.keys(e).length) return;
    onSalva({ dipendenteId: f.dipendenteId, commessaId: f.commessaId, data: f.data, ore });
  };
  return (
    <div className="space-y-4">
      <Campo etichetta="Dipendente">
        <select value={f.dipendenteId} onChange={(e) => setF((x) => ({ ...x, dipendenteId: e.target.value }))} className={inputCls}>
          {dipendenti.map((d) => <option key={d.id} value={d.id}>{d.nome} {d.cognome}</option>)}
        </select>
      </Campo>
      <Campo etichetta="Commessa">
        <select value={f.commessaId} onChange={(e) => setF((x) => ({ ...x, commessaId: e.target.value }))} className={inputCls}>
          {commesse.map((c) => <option key={c.id} value={c.id}>{c.codice} — {c.descrizione}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-4">
        <Campo etichetta="Data" errore={err.data}><input type="date" value={f.data} onChange={(e) => setF((x) => ({ ...x, data: e.target.value }))} className={inputCls + " f-mono"} /></Campo>
        <Campo etichetta="Ore" errore={err.ore}><input value={f.ore} onChange={(e) => setF((x) => ({ ...x, ore: e.target.value }))} className={inputCls + " f-mono text-right"} /></Campo>
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <Bottone variante="fantasma" onClick={onAnnulla}>Annulla</Bottone>
        <Bottone onClick={invia}><Save size={14} strokeWidth={1.75} /> Salva</Bottone>
      </div>
    </div>
  );
}

/**
 * Rinomina codice e/o descrizione di una commessa esistente.
 * Cambia solo l'etichetta: le ore restano collegate alla commessa tramite il
 * suo id, quindi costi, riepiloghi ed export non si spostano di un centesimo.
 * I controlli qui sono solo per dare una risposta immediata: la decisione
 * definitiva (proprietà della commessa e codice doppio) è sempre del server.
 */
function EditorRinominaCommessa({ commessa, commesse, oreCollegate, onSalva, onFatto, onAnnulla }) {
  const [f, setF] = useState({ codice: commessa.codice, descrizione: commessa.descrizione });
  const [err, setErr] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  const invia = async () => {
    if (inCorso) return;
    const codice = f.codice.trim();
    const descrizione = f.descrizione.trim();
    if (!codice) { setErr("Il codice della commessa è obbligatorio."); return; }
    if (commesse.some((c) => c.id !== commessa.id && c.codice.toLowerCase() === codice.toLowerCase())) {
      setErr(`Esiste già un'altra commessa con il codice ${codice}.`);
      return;
    }
    if (codice === commessa.codice && descrizione === commessa.descrizione) { onFatto(); return; }
    setErr(null);
    setInCorso(true);
    const ris = await onSalva({ codice, descrizione });
    setInCorso(false);
    if (ris?.ok) onFatto();
    else setErr(ris?.errore || "Impossibile rinominare la commessa.");
  };

  return (
    <div className="space-y-4" onKeyDown={(e) => e.key === "Enter" && invia()}>
      <Campo etichetta="Codice" errore={err}>
        <input autoFocus value={f.codice} onChange={(e) => { setF((x) => ({ ...x, codice: e.target.value })); setErr(null); }}
          placeholder="es. P25 o VILLA-ROSSI" className={inputCls + " f-mono"} />
      </Campo>
      <Campo etichetta="Descrizione">
        <input value={f.descrizione} onChange={(e) => setF((x) => ({ ...x, descrizione: e.target.value }))}
          placeholder="es. Ristrutturazione Villa Rossi" className={inputCls} />
      </Campo>
      <p className="text-xs flex items-start gap-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>
        <Info size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        {oreCollegate > 0
          ? `Cambia solo il nome: le ${oreCollegate} registrazioni collegate, i costi e i report restano identici.`
          : "Cambia solo il nome: nessun altro dato viene toccato."}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Bottone variante="fantasma" onClick={onAnnulla} disabled={inCorso}>Annulla</Bottone>
        <Bottone onClick={invia} disabled={inCorso}><Save size={14} strokeWidth={1.75} /> {inCorso ? "Salvataggio…" : "Salva"}</Bottone>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   REPORT DI STAMPA (PDF via stampa del browser, stile dedicato)
--------------------------------------------------------------------------- */
function ReportStampa({ riep, costi, dal, al, azienda }) {
  if (!riep) return null;
  // Stesse colonne della tabella a video: manodopera e materiali restano
  // distinti anche sulla carta, il totale è la loro somma.
  const righeStampa = costi?.righe ?? [];
  return (
    <div className="soloprint" aria-hidden="true">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #171B22", paddingBottom: 10, marginBottom: 16 }}>
        <div>
          <div style={{ width: 120, height: 34, border: "1px dashed #999", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#999", marginBottom: 6 }}>spazio logo</div>
          <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>{azienda || "________________________"}</p>
        </div>
        <div style={{ textAlign: "right", fontSize: 11 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>Costi per commessa</p>
          <p style={{ margin: 0 }}>Periodo: {fmtData(dal)} — {fmtData(al)}</p>
          <p style={{ margin: 0 }}>Stampato il {fmtData(oggiISO())}</p>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #171B22", textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Codice</th>
            <th style={{ padding: "6px 8px" }}>Descrizione</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Ore</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Manodopera (€)</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Materiali (€)</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Totale (€)</th>
          </tr>
        </thead>
        <tbody>
          {righeStampa.map((r) => (
            <tr key={r.commessa.id} style={{ borderBottom: "1px solid #DDD" }}>
              <td style={{ padding: "5px 8px", fontFamily: "'IBM Plex Mono', monospace" }}>{r.commessa.codice}</td>
              <td style={{ padding: "5px 8px" }}>{r.commessa.descrizione}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtOre.format(r.ore)}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNum.format(r.costoManodopera)}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNum.format(r.costoMateriali)}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNum.format(r.costoTotale)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1.5px solid #171B22", fontWeight: 700 }}>
            <td style={{ padding: "7px 8px" }} colSpan={2}>TOTALE</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtOre.format(riep.totOre)}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNum.format(costi?.totManodopera ?? riep.totCosto)}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNum.format(costi?.totMateriali ?? 0)}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNum.format(costi?.totTotale ?? riep.totCosto)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   STILE GLOBALE — sistema: tela avorio, inchiostro profondo, un accento
   bronzo spento; verde solo per gli importi; ombre morbide a più livelli.
--------------------------------------------------------------------------- */
function StileGlobale() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
      :root{
        --ink:#181C23;
        --tela:#F5F3EE; --card:#FEFDFB;
        --hairline:rgba(24,28,35,.08);
        --velo:rgba(24,28,35,.05);
        --accent:#9A783A; --accent-chiaro:#C4A265;
        --velo-accento:rgba(154,120,58,.08);
        --euro:#1E7350;
        --txt:#22262E; --muted:#7A7F87;
        --ombra-xs:0 1px 2px rgba(24,28,35,.04);
        --ombra-sm:0 1px 2px rgba(24,28,35,.04), 0 4px 16px rgba(24,28,35,.05);
        --ombra-md:0 2px 6px rgba(24,28,35,.06), 0 10px 28px rgba(24,28,35,.08);
        --ombra-lg:0 4px 12px rgba(24,28,35,.10), 0 24px 60px rgba(24,28,35,.18);
      }
      body{ font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
      .f-display{ font-family:'Instrument Sans','Inter',sans-serif; font-weight:600; letter-spacing:-0.015em; }
      .f-mono{ font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; }
      .superficie-scura{ background:linear-gradient(175deg,#1C212A 0%,#161A21 100%); }
      .campo{ background:var(--card); border:1px solid var(--hairline); box-shadow:var(--ombra-xs); }
      .campo:focus{ box-shadow:0 0 0 3px rgba(154,120,58,.18); border-color:rgba(154,120,58,.5); }
      .campo-scuro{ background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.09); color:#DDD9CF; color-scheme:dark; }
      .campo-scuro:focus{ box-shadow:0 0 0 2px rgba(196,162,101,.35); }
      .tasto-scuro{ background:rgba(255,255,255,.05); color:#AEB4BD; }
      .tasto-scuro:hover{ background:rgba(255,255,255,.09); }
      .btn{ transition:all .16s ease; }
      .btn:focus-visible{ box-shadow:0 0 0 3px rgba(154,120,58,.3); outline:none; }
      .btn:hover{ filter:brightness(1.03); }
      .btn:active{ transform:translateY(1px); }
      .riga{ transition:background .14s ease; }
      .riga:hover{ background:rgba(24,28,35,.025); }
      tr.riga:focus-visible{ outline:2px solid rgba(154,120,58,.5); outline-offset:-2px; }
      @keyframes pop{ from{opacity:0; transform:translateY(8px) scale(.985);} to{opacity:1; transform:none;} }
      .anim-pop{ animation:pop .22s cubic-bezier(.2,.9,.3,1.02); }
      @keyframes velo{ from{opacity:0;} }
      .anim-velo{ animation:velo .2s ease; }
      @keyframes slide{ from{transform:translateX(40px); opacity:0;} to{transform:none; opacity:1;} }
      .anim-slide{ animation:slide .32s cubic-bezier(.19,1,.22,1); }
      @keyframes vista{ from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:none;} }
      .anim-vista{ animation:vista .24s ease; }
      @keyframes cresci{ from{width:0;} }
      .anim-barra{ animation:cresci .6s cubic-bezier(.19,1,.22,1); transition:width .4s ease; }
      /* Barra indeterminata: il caricamento di un file non espone una
         percentuale affidabile, quindi si mostra un movimento continuo. */
      @keyframes scorre{ from{transform:translateX(-100%);} to{transform:translateX(320%);} }
      .anim-scorre{ animation:scorre 1.1s cubic-bezier(.4,0,.2,1) infinite; }
      @media (prefers-reduced-motion: reduce){
        .anim-pop,.anim-slide,.anim-vista,.anim-velo,.anim-barra,.anim-scorre{ animation:none; transition:none; }
        *{ transition:none!important; }
      }
      .soloprint{ display:none; }
      @media print{
        .noprint{ display:none!important; }
        .soloprint{ display:block; padding:8mm; color:#111; }
        body{ background:#fff; }
        @page{ margin:14mm; }
      }
    `}</style>
  );
}
