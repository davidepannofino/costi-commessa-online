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
  ReceiptText, Link2, CheckCircle, Check, HelpCircle, CircleDot, CalendarDays,
} from "lucide-react";
import { datiAPI, suSessioneScaduta, suAbbonamentoRichiesto, API_BASE } from "./datiAPI.js";
import { statoGruppo, assegnazioneIniziale, NON_IMPORTARE } from "./statoGruppoDDT.js";
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

/**
 * Gli id qui devono essere UNICI a ogni generazione, non fissi.
 * Nel database la chiave di dipendenti e commesse è l'id da solo, valido per
 * tutte le aziende: con id fissi la seconda azienda che carica i dati
 * d'esempio andrebbe in collisione con la prima e non riuscirebbe a salvare
 * nulla. Si usa lo stesso uid() già usato per le registrazioni qui sotto e
 * dall'import Excel.
 */
function creaDatiEsempio() {
  const dipendenti = [
    { id: uid("e"), nome: "A", cognome: "A", lordoMensile: { "2026-07": 4587 } },
    { id: uid("e"), nome: "A", cognome: "B", lordoMensile: { "2026-07": 3987 } },
  ];
  const codici = new Set();
  Object.values(ESEMPIO_ORE).forEach((m) => Object.keys(m).forEach((c) => codici.add(c)));
  const ordina = (a, b) => (parseInt(a.slice(1)) || 0) - (parseInt(b.slice(1)) || 0);
  const commesse = [...codici].sort(ordina).map((c) => ({ id: uid("c"), codice: c, descrizione: "Commessa " + c }));
  const comId = new Map(commesse.map((c) => [c.codice, c.id]));
  // Le chiavi di ESEMPIO_ORE ("e1", "e2") sono etichette del foglio di
  // partenza, non id: vanno tradotte negli id appena generati, nell'ordine.
  const dipId = new Map(Object.keys(ESEMPIO_ORE).map((etichetta, i) => [etichetta, dipendenti[i].id]));
  const registrazioni = [];
  for (const [etichettaDip, mappa] of Object.entries(ESEMPIO_ORE)) {
    for (const [codice, giorni] of Object.entries(mappa)) {
      for (const [g, ore] of giorni) {
        registrazioni.push({
          id: uid("r"), dipendenteId: dipId.get(etichettaDip), commessaId: comId.get(codice),
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
/* ---------------------------------------------------------------------------
   COMPONENTI BASE — definiti una volta, riusati in ogni schermata.
   Se un bottone o un campo va cambiato, si cambia QUI: è ciò che tiene
   l'applicazione coerente da una schermata all'altra.
--------------------------------------------------------------------------- */

/** Sovratitolo: la parolina in maiuscoletto sopra un titolo o un valore. */
const Micro = ({ children, tono }) => (
  <p className="t-micro" style={{ color: tono || "var(--tenue)" }}>{children}</p>
);

const Campo = ({ etichetta, children, errore }) => (
  <label className="block">
    <span className="block t-micro mb-2" style={{ color: "var(--tenue)" }}>{etichetta}</span>
    {children}
    {errore && <span className="block t-piccolo mt-2" style={{ color: "var(--errore)" }}>{errore}</span>}
  </label>
);
const inputCls = "w-full px-3.5 py-2.5 text-sm outline-none campo";

/**
 * Il valore in evidenza: sovratitolo, cifra grande, eventuale nota sotto.
 * I numeri sono il contenuto di questa applicazione, e questo è il componente
 * che li mette al centro invece di annegarli fra le etichette.
 */
const Valore = ({ etichetta, valore, nota, tono, grande }) => (
  <div>
    <Micro>{etichetta}</Micro>
    <p className="cifra-grande mt-2" style={{ fontSize: grande ? 30 : 23, lineHeight: 1.1, color: tono || "var(--txt)" }}>{valore}</p>
    {nota && <p className="t-piccolo mt-1.5" style={{ color: "var(--tenue)" }}>{nota}</p>}
  </div>
);

/** Il marchio: monogramma e nome. Compariva scritto a mano in quattro pagine,
 *  con tre gradienti diversi. Ora è uno — e il quadratino è l'UNICO posto in
 *  cui il bronzo compare pieno senza essere uno stato: è il marchio. */
const Marchio = ({ centrato }) => (
  <div className={"flex items-center gap-2.5" + (centrato ? " justify-center" : "")}>
    <div className="flex items-center justify-center shrink-0 f-display"
      style={{
        width: 28, height: 28, borderRadius: "var(--r-sm)", fontSize: 13,
        background: "var(--accento)", color: "var(--accento-testo)",
      }}>C</div>
    <div className="t-piccolo" style={{ fontWeight: 500, color: "var(--txt-chiaro)" }}>Costi Commessa</div>
  </div>
);

/**
 * Messaggio in linea: avviso, errore, conferma. Prima questi riquadri erano
 * riscritti a mano ogni volta che servivano, con colori e bordi leggermente
 * diversi in ogni schermata. Qui c'è una forma sola, e cambiarla li cambia tutti.
 */
function Avviso({ tono = "accento", icona: Icona, children, className = "" }) {
  const toni = {
    accento: { background: "var(--velo-accento)", colore: "var(--accento-chiaro)", linea: "var(--accento-bordo)", predefinita: AlertTriangle },
    errore: { background: "var(--velo-errore)", colore: "var(--errore)", linea: "var(--rosso-bordo)", predefinita: AlertTriangle },
    ok: { background: "var(--velo-euro)", colore: "var(--euro)", linea: "var(--verde-bordo)", predefinita: CheckCircle2 },
    neutro: { background: "var(--velo)", colore: "var(--muted)", linea: "var(--hairline)", predefinita: Info },
  }[tono];
  const Segno = Icona || toni.predefinita;
  return (
    <div className={"flex items-start gap-2.5 px-4 py-3 t-piccolo anim-pop " + className}
      style={{ background: toni.background, boxShadow: `0 0 0 .5px ${toni.linea}`, borderRadius: "var(--r-sm)", color: toni.colore }}
      role="alert">
      <Segno size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/* --- GRAFICI: stessi assi, stesso riquadro informativo, in tutti i grafici.
       Erano scritti a mano in ogni grafico, con misure e colori leggermente
       diversi — e puntavano a un carattere monospaziato che non carichiamo
       più. Qui c'è una definizione sola. --------------------------------- */
const STILE_ASSE = { fontSize: 11, fontFamily: "Inter, system-ui, sans-serif", fill: "#71717A", fontVariantNumeric: "tabular-nums" };
const STILE_ASSE_FORTE = { ...STILE_ASSE, fontSize: 11.5, fill: "#E4E4E7" };
const STILE_TOOLTIP = {
  borderRadius: 10, background: "var(--bg-elevato)",
  border: ".5px solid var(--bordo-input)", color: "var(--txt-chiaro)",
  // Qui l'ombra serve davvero: il riquadro galleggia sopra il grafico.
  boxShadow: "0 16px 40px -12px rgba(0,0,0,.8)",
  fontFamily: "Inter, system-ui, sans-serif", fontSize: 12.5, padding: "9px 13px",
};
/** Le due tinte delle barre: bronzo per la prima, grafite per le altre. */
const BARRA_PRIMA = "#8A6D4B";
const BARRA_ALTRE = "#2E2E36";

/** Pillola: stato, conteggio, etichetta breve. Tre toni, non uno di più. */
const Pillola = ({ tono = "neutro", children }) => {
  const toni = {
    neutro: { background: "var(--velo)", color: "var(--muted)" },
    euro: { background: "var(--velo-euro)", color: "var(--euro)" },
    accento: { background: "var(--velo-accento)", color: "var(--accento-chiaro)" },
    errore: { background: "var(--velo-errore)", color: "var(--errore)" },
  }[tono];
  return <span className="pill" style={toni}>{children}</span>;
};

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
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-[var(--r-xs)] btn"
        style={{ color: "var(--muted)" }}
        aria-label={mostra ? "Nascondi password" : "Mostra password"}
        tabIndex={-1}
      >
        {mostra ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

/**
 * Quattro varianti, e non di più: pieno (l'azione della schermata), accento
 * (la conferma che chiude un percorso), fantasma (tutto il resto), pericolo.
 * Al passaggio del mouse cambia il colore, non la dimensione: gli elementi che
 * si gonfiano sotto il puntatore fanno sembrare l'interfaccia un giocattolo.
 */
function Bottone({ variante = "primario", className = "", ...p }) {
  const stile = {
    primario: { background: "var(--accento)", color: "var(--accento-testo)" },
    accento: { background: "var(--accento)", color: "var(--accento-testo)" },
    fantasma: { background: "var(--card)", color: "var(--txt)", boxShadow: "var(--ombra-md)" },
    pericolo: { background: "transparent", color: "var(--errore)", boxShadow: "0 0 0 .5px var(--rosso-bordo)" },
  }[variante];
  return (
    <button
      className={"inline-flex items-center justify-center gap-2 text-sm font-medium btn " + className}
      style={{ padding: "9px 15px", borderRadius: "var(--r-sm)", letterSpacing: "-.005em", ...stile }}
      {...p}
    />
  );
}

function Modale({ titolo, children, onChiudi, largo, bloccante }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && !bloccante && onChiudi();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onChiudi, bloccante]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 noprint" role="dialog" aria-modal="true" aria-label={titolo}>
      <div className="absolute inset-0 anim-velo" style={{ background: "rgba(0,0,0,.66)", backdropFilter: "blur(4px)" }} onClick={() => !bloccante && onChiudi()} />
      {/* È il caso in cui un'ombra vera serve: il modale sta davvero sopra il
          resto, e deve leggersi come un piano staccato. */}
      <div className={`relative w-full ${largo ? "max-w-2xl" : "max-w-md"} anim-pop`}
        style={{ background: "var(--card)", borderRadius: "var(--r-lg)", boxShadow: "var(--ombra-lg)" }}>
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5">
          <h3 className="t-sotto" style={{ color: "var(--txt)" }}>{titolo}</h3>
          {!bloccante && (
            <button onClick={onChiudi} aria-label="Chiudi" className="p-1.5 btn -mt-0.5 -mr-1.5"
              style={{ color: "var(--tenue)", borderRadius: "var(--r-xs)" }}>
              <X size={17} strokeWidth={1.75} />
            </button>
          )}
        </div>
        <div className="px-7 pb-7">{children}</div>
      </div>
    </div>
  );
}

/**
 * Stato vuoto: un'icona sobria, una riga di titolo, una di spiegazione, e
 * l'azione che porta fuori dal vuoto. Niente illustrazioni, niente allegria
 * forzata: è un momento di lavoro, non una festa.
 */
function StatoVuoto({ icona: Icona, titolo, testo, azione }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6"
      style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)", paddingTop: 88, paddingBottom: 88 }}>
      <div className="flex items-center justify-center mb-5"
        style={{ width: 44, height: 44, borderRadius: "var(--r-md)", background: "var(--velo)" }}>
        <Icona size={19} strokeWidth={1.5} style={{ color: "var(--muted)" }} />
      </div>
      <p className="t-sotto mb-2" style={{ color: "var(--txt)" }}>{titolo}</p>
      <p className="t-piccolo mb-7" style={{ color: "var(--muted)", maxWidth: "46ch" }}>{testo}</p>
      {azione}
    </div>
  );
}

/** Barra di quota sottile. */
const BarraQuota = ({ quota, colore }) => (
  <div className="w-full" style={{ height: 4, borderRadius: 99, background: "var(--velo)" }}>
    <div className="anim-barra" style={{ height: 4, borderRadius: 99, width: `${Math.max(1.5, quota * 100)}%`, background: colore || "var(--accent)" }} />
  </div>
);

/** Riquadro con intestazione (titolo + azione opzionale). */
const Sezione = ({ titolo, extra, children }) => (
  <section style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
    <div className="px-7 py-5 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: ".5px solid var(--hairline)" }}>
      <h2 className="t-sotto">{titolo}</h2>
      {extra}
    </div>
    <div className="p-7">{children}</div>
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

  return (
    <div className="min-h-screen flex" style={{ background: "var(--tela)", color: "var(--txt)" }}>
      <StileGlobale />

      {/* ================= PANNELLO DESCRITTIVO (solo desktop) =================
          Prima qui c'erano quattro forme geometriche di sfondo e un grafico a
          barre finto. Il grafico era la cosa peggiore: sembrava un dato e non
          lo era. Restano il nome, una frase, e molto spazio — che è ciò che fa
          sembrare curata una schermata, non il numero di elementi che contiene. */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[42%] relative flex-col justify-between overflow-hidden noprint superficie-scura px-14 py-16 xl:px-20">
        <div className="relative"><Marchio /></div>

        <div className="relative">
          <h1 className="f-display mb-6" style={{ fontSize: 40, lineHeight: 1.14, letterSpacing: "-.028em", color: "var(--txt)" }}>
            Il costo del lavoro,<br />commessa per commessa.
          </h1>
          <p className="t-corpo" style={{ color: "var(--scuro-muted)", maxWidth: "42ch" }}>
            Registra le ore, calcola il costo esatto per ogni commessa e ogni dipendente,
            esporta il report. Ogni azienda con i propri dati, separati e al sicuro.
          </p>
        </div>

        <p className="relative t-piccolo" style={{ color: "var(--txt-fioco)" }}>
          Calcoli in piena precisione. Ogni azienda, dati isolati.
        </p>
      </div>

      {/* ================= FORM ================= */}
      <div className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full" style={{ maxWidth: 384 }}>
          <div className="mb-9 lg:hidden"><Marchio /></div>

          {/* Il modulo non è una card che galleggia: è il contenuto della
              pagina. Nessuna ombra, nessun riquadro — solo spazio intorno. */}
          <div>
            {vistaRecupero ? (
              <div key="recupero" className="anim-vista">
                <h2 className="t-sezione mb-2">Recupera la password</h2>
                <p className="t-piccolo mb-7" style={{ color: "var(--muted)" }}>
                  Inserisci l'email del tuo account: se esiste, ti mandiamo un link per reimpostare la password.
                </p>

                {inviatoRecupero ? (
                  <Avviso tono="ok">
                    Controlla la tua email: se l'indirizzo esiste, riceverai a breve un link per reimpostare la password.
                  </Avviso>
                ) : (
                  <form onSubmit={inviaRecupero} className="space-y-5">
                    <Campo etichetta="Email">
                      <div className="relative">
                        <Mail size={15} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--tenue)" }} />
                        <input type="email" className={inputCls + " pl-10"} value={emailRecupero} onChange={(e) => setEmailRecupero(e.target.value)} placeholder="nome@azienda.it" required autoFocus />
                      </div>
                    </Campo>

                    {messaggioRecupero && <Avviso tono="errore">{messaggioRecupero.testo}</Avviso>}

                    <Bottone type="submit" variante="primario" className="w-full" disabled={caricandoRecupero}>
                      {caricandoRecupero ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
                      {caricandoRecupero ? "Invio…" : "Invia link di reset"}
                    </Bottone>
                  </form>
                )}

                <button type="button" onClick={chiudiRecupero} className="t-piccolo mt-6 block mx-auto btn" style={{ color: "var(--muted)" }}>
                  ← Torna al login
                </button>
              </div>
            ) : (
              <div key={modo} className="anim-vista">
                <h2 className="t-titolo mb-2.5">{modo === "accedi" ? "Bentornato" : "Crea il tuo account"}</h2>
                <p className="t-corpo mb-8" style={{ color: "var(--muted)" }}>
                  {modo === "accedi" ? "Accedi per continuare a gestire i costi delle tue commesse." : "Un account per azienda: dati separati e al sicuro."}
                </p>

                <div className="relative flex mb-7 p-1" style={{ background: "var(--velo)", borderRadius: "var(--r-sm)" }}>
                  <div className="absolute top-1 bottom-1" style={{ width: "calc(50% - 4px)", left: 4, background: "var(--card)",
                    borderRadius: "var(--r-xs)", boxShadow: "var(--ombra-md)",
                    transform: modo === "registrati" ? "translateX(100%)" : "translateX(0)",
                    transition: "transform var(--moto)" }} />
                  {[["accedi", "Accedi"], ["registrati", "Registrati"]].map(([id, testo]) => (
                    <button key={id} type="button" onClick={() => cambiaModo(id)}
                      className="relative z-10 flex-1 text-sm font-medium py-2"
                      style={{ borderRadius: "var(--r-xs)", color: modo === id ? "var(--txt)" : "var(--muted)", transition: "color var(--moto)" }}>
                      {testo}
                    </button>
                  ))}
                </div>

                {modo === "registrati" && (
                  <Avviso tono="accento" icona={Gift} className="mb-6">
                    <strong style={{ fontWeight: 600 }}>14 giorni di prova gratuita</strong>, poi 29 €/mese.
                    Nessuna carta richiesta per iniziare — disdici quando vuoi.
                  </Avviso>
                )}

                <form onSubmit={invia} className="space-y-5">
                  {modo === "registrati" && (
                    <Campo etichetta="Nome azienda">
                      <div className="relative">
                        <Building2 size={15} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--tenue)" }} />
                        <input className={inputCls + " pl-10"} value={nomeAzienda} onChange={(e) => setNomeAzienda(e.target.value)} placeholder="es. Rossi Costruzioni S.r.l." required autoFocus />
                      </div>
                    </Campo>
                  )}
                  <Campo etichetta="Email">
                    <div className="relative">
                      <Mail size={15} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--tenue)" }} />
                      <input type="email" className={inputCls + " pl-10"} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@azienda.it" required />
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
                    <button type="button" onClick={apriRecupero} className="t-piccolo -mt-2 btn" style={{ color: "var(--muted)" }}>
                      Password dimenticata?
                    </button>
                  )}

                  {messaggioForm && (
                    <Avviso tono={messaggioForm.tipo === "avviso" ? "accento" : "errore"}>{messaggioForm.testo}</Avviso>
                  )}

                  <Bottone type="submit" variante="primario" className="w-full" disabled={caricando}>
                    {caricando ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
                    {caricando ? "Attendere…" : modo === "accedi" ? "Accedi" : "Crea account"}
                  </Bottone>
                </form>
              </div>
            )}
          </div>

          <p className="text-center t-piccolo mt-8" style={{ color: "var(--tenue)" }}>
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
      <div className="w-full" style={{ maxWidth: 384 }}>
        <div className="mb-10"><Marchio centrato /></div>

        <div>
          <h2 className="t-sezione mb-2">Imposta una nuova password</h2>
          <p className="t-piccolo mb-7" style={{ color: "var(--muted)" }}>Scegli una nuova password per il tuo account.</p>

          <form onSubmit={invia} className="space-y-5">
            <Campo etichetta="Nuova password">
              <CampoPassword value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" minLength={8} required autoFocus autoComplete="new-password" />
            </Campo>
            <Campo etichetta="Conferma nuova password">
              <CampoPassword value={conferma} onChange={(e) => setConferma(e.target.value)} placeholder="Ripeti la password" minLength={8} required autoComplete="new-password" />
            </Campo>

            {messaggioForm && <Avviso tono="errore">{messaggioForm.testo}</Avviso>}

            <Bottone type="submit" variante="primario" className="w-full" disabled={caricando}>
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
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div className="mb-10"><Marchio centrato /></div>

        {/* Il prezzo è il protagonista della schermata: grande, calmo, con
            accanto la cosa che rassicura di più (si disdice quando si vuole). */}
        <div className="text-center">
          <h2 className="t-sezione mb-3">Il periodo di prova è terminato</h2>
          <p className="t-corpo mb-9 mx-auto" style={{ color: "var(--muted)", maxWidth: "44ch" }}>
            Hai usato liberamente Costi Commessa per 14 giorni. Per continuare ad accedere ai tuoi dati, attiva l'abbonamento mensile.
          </p>

          <div className="px-6 py-7 mb-8" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
            <p className="cifra-grande" style={{ fontSize: 44, lineHeight: 1, letterSpacing: "-.035em" }}>
              29 €<span className="t-corpo" style={{ fontWeight: 400, color: "var(--tenue)", letterSpacing: 0 }}> / mese</span>
            </p>
            <p className="t-piccolo mt-3" style={{ color: "var(--muted)" }}>Disdici quando vuoi, senza vincoli.</p>
          </div>

          {errore && <div className="mb-5 text-left"><Avviso tono="errore">{errore}</Avviso></div>}

          <Bottone variante="primario" className="w-full" onClick={abbonati} disabled={caricando}>
            {caricando ? <Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={1.75} />}
            {caricando ? "Un attimo…" : "Abbonati ora"}
          </Bottone>
          <button type="button" onClick={onUscire} className="t-piccolo mt-6 btn" style={{ color: "var(--muted)" }}>
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
      <Loader2 size={20} strokeWidth={1.75} className="animate-spin" style={{ color: "var(--muted)" }} />
      <p className="t-piccolo" style={{ color: "var(--muted)" }}>Stiamo confermando il pagamento…</p>
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
    esente: { etichetta: "Accesso illimitato", tono: "euro", icona: Sparkles },
    attivo: { etichetta: "Abbonamento attivo", tono: "euro", icona: CheckCircle2 },
    prova: { etichetta: "Prova gratuita", tono: "accento", icona: Clock },
    scaduto: { etichetta: "Prova terminata", tono: "errore", icona: AlertTriangle },
  };
  const s = STATI[info?.stato] || STATI.prova;
  const Icona = s.icona;

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="mb-8">
        <Micro>Account</Micro>
        <h1 className="t-titolo mt-2">Abbonamento</h1>
      </div>
      <Sezione titolo="Stato">
        {!info ? (
          <p className="t-piccolo" style={{ color: "var(--muted)" }}>Caricamento…</p>
        ) : (
          <>
            {/* Lo stato si legge da una pillola, non da un'icona colorata in un
                quadrato: è la stessa forma usata per gli stati altrove. */}
            <div className="flex items-center gap-3 mb-7">
              <Pillola tono={s.tono}><Icona size={13} strokeWidth={1.75} /> {s.etichetta}</Pillola>
              {info.stato === "prova" && (
                <span className="t-piccolo" style={{ color: "var(--muted)" }}>
                  {info.giorniProvaRestanti === 1 ? "ultimo giorno" : `${info.giorniProvaRestanti} giorni rimanenti`}
                </span>
              )}
            </div>

            <div className="px-6 py-6 mb-6" style={{ background: "var(--tela-alt)", borderRadius: "var(--r-sm)" }}>
              <p className="cifra-grande" style={{ fontSize: 34, lineHeight: 1 }}>
                29 €<span className="t-corpo" style={{ fontWeight: 400, color: "var(--tenue)", letterSpacing: 0 }}> / mese</span>
              </p>
              <p className="t-piccolo mt-3" style={{ color: "var(--muted)" }}>Fatturazione mensile ricorrente. Disdici quando vuoi.</p>
            </div>

            {errore && <div className="mb-6"><Avviso tono="errore">{errore}</Avviso></div>}

            {info.stato === "esente" ? (
              <p className="t-piccolo" style={{ color: "var(--muted)" }}>Il tuo account ha accesso completo e illimitato, senza bisogno di abbonamento.</p>
            ) : info.stato === "attivo" ? (
              <Bottone variante="fantasma" onClick={() => vai("portale")} disabled={caricando}>
                {caricando ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <CreditCard size={14} strokeWidth={1.75} />}
                {caricando ? "Un attimo…" : "Gestisci abbonamento"}
              </Bottone>
            ) : (
              <Bottone variante="primario" onClick={() => vai("checkout")} disabled={caricando}>
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
const COLORI_STATO_ADMIN = { prova: "var(--accent)", attivo: "var(--euro)", scaduto: "var(--errore)", esente: "var(--euro)" };

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
        <h1 className="t-titolo mt-2">Aziende registrate</h1>
      </div>

      {errore && (
        <div className="flex items-start gap-2.5 rounded-[var(--r-sm)] px-4 py-3 text-sm" style={{ background: "var(--velo-errore)", border: ".5px solid var(--rosso-bordo)", color: "var(--errore)" }}>
          <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {errore}
        </div>
      )}

      {caricando ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Caricamento…</p>
      ) : (
        <>
          {schede.length > 0 && (
            <div className="rounded-[var(--r-md)] grid grid-cols-2 xl:grid-cols-5 overflow-hidden" style={{ background: "var(--card)", boxShadow: "var(--ombra-sm)" }}>
              {schede.map(([e, v], i) => (
                <div key={e} className="px-6 py-5" style={{ borderLeft: i > 0 ? ".5px solid var(--hairline)" : "none" }}>
                  <Micro>{e}</Micro>
                  <p className="f-mono text-[22px] mt-2 leading-none" style={{ color: "var(--txt)" }}>{v}</p>
                </div>
              ))}
            </div>
          )}

          {aziende.length === 0 ? (
            <StatoVuoto icona={Building2} titolo="Nessuna azienda registrata" testo="Non appena qualcuno si registrerà, comparirà qui." />
          ) : (
            <div className="overflow-hidden" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
              <div className="px-6 py-4 flex items-center justify-between gap-3" style={{ borderBottom: ".5px solid var(--hairline)" }}>
                <p className="t-piccolo f-mono" style={{ color: "var(--muted)" }}>{righe.length} aziende</p>
              </div>
              <div className="overflow-x-auto">
                <table className="tabella text-sm">
                  <thead>
                    <tr className="text-left">
                      {[["nome", "Azienda", ""], ["email", "Email", "hidden sm:table-cell"], ["registratoIl", "Registrata il", "text-right"], ["stato", "Stato", "text-right"], [null, "Prova", "text-right hidden md:table-cell"]].map(([campo, nome, cls]) => (
                        <th key={nome} className={`px-6 py-3.5 t-micro ${cls} ${campo ? "cursor-pointer select-none" : ""}`}
                          style={{ letterSpacing: ".1em", color: "var(--muted)" }} onClick={campo ? () => clic(campo) : undefined}>
                          {nome}{campo ? freccia(campo) : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {righe.map((a) => (
                      <tr key={a.id} style={{ borderTop: ".5px solid var(--hairline)" }}>
                        <td className="px-6 py-4 font-medium">{a.nome}</td>
                        <td className="px-6 py-4 hidden sm:table-cell" style={{ color: "var(--muted)" }}>{a.email}</td>
                        <td className="px-6 py-4 f-mono text-right">{fmtData(String(a.registratoIl).slice(0, 10))}</td>
                        <td className="px-6 py-4 text-right">
                          <span className="t-piccolo font-medium px-2 py-1 rounded-[var(--r-xs)]" style={{ color: COLORI_STATO_ADMIN[a.stato] || "var(--txt)", background: "var(--velo)" }}>
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
  const [fornitoriNoti, setFornitoriNoti] = useState([]); // per la tendina del campo Fornitore, non è un vincolo
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
    setFornitoriNoti([]);
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
      // I fornitori già visti servono solo a riempire una tendina: si chiedono
      // dopo, e se non arrivano non cambia niente di quello che si può fare.
      datiAPI.elencoFornitori().then((f) => { if (!annullato) setFornitoriNoti(f); });
    })();
    return () => { annullato = true; };
  }, [token, notifica, verificandoPagamento, versioneAccesso]);

  /**
   * Esito dell'ultimo salvataggio. Serve a non mentire: se il salvataggio non
   * riesce, l'utente deve saperlo subito, non scoprirlo ricaricando la pagina.
   *
   * L'avviso si mostra UNA VOLTA quando il salvataggio comincia a fallire, e
   * una volta quando torna a funzionare: il salvataggio automatico scatta a
   * ogni modifica, e un messaggio per ognuna sarebbe un tormento. Finché dura
   * il guasto resta però una fascia fissa in alto, che non si può ignorare.
   */
  const salvataggioKO = useRef(false);
  const [salvataggioNonRiuscito, setSalvataggioNonRiuscito] = useState(null);

  const registraEsitoSalvataggio = useCallback((ris) => {
    if (!ris || ris.gestito) return ris; // sessione scaduta o abbonamento: hanno già la loro schermata
    if (ris.ok) {
      if (salvataggioKO.current) {
        salvataggioKO.current = false;
        setSalvataggioNonRiuscito(null);
        notifica("Collegamento ristabilito: le modifiche sono state salvate.");
      }
      return ris;
    }
    if (!salvataggioKO.current) {
      salvataggioKO.current = true;
      setSalvataggioNonRiuscito(ris.motivo || "motivo sconosciuto");
      notifica("Non sono riuscito a salvare: le modifiche restano solo su questo schermo.", "errore");
    }
    return ris;
  }, [notifica]);

  useEffect(() => {
    if (!pronto.current) return;
    const t = setTimeout(() => {
      datiAPI.salva(null, { dipendenti, commesse, registrazioni, azienda }).then(registraEsitoSalvataggio);
    }, 600);
    return () => clearTimeout(t);
  }, [dipendenti, commesse, registrazioni, azienda, registraEsitoSalvataggio]);

  /** Salvataggio immediato + snapshot di sicurezza forzato, per le operazioni
   *  che cambiano molti dati in un colpo (import, svuota, ripristino).
   *  I materiali si mandano SOLO se presenti nella patch: ometterli significa
   *  "lasciali come stanno" (li gestiscono le rotte /api/materiali). */
  const salvaSubitoConBackup = useCallback(async (patch) => {
    const ris = await datiAPI.salva(null, {
      dipendenti: patch.dipendenti ?? dipendenti,
      commesse: patch.commesse ?? commesse,
      registrazioni: patch.registrazioni ?? registrazioni,
      azienda: patch.azienda ?? azienda,
      ...(Array.isArray(patch.materiali) ? { materiali: patch.materiali } : {}),
    }, { forzaBackup: true });
    return registraEsitoSalvataggio(ris);
  }, [dipendenti, commesse, registrazioni, azienda, registraEsitoSalvataggio]);

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
  /* I tre dati del DDT (numero, data, fornitore) sono FACOLTATIVI: se "ddt"
     arriva vuoto il documento si archivia come si è sempre fatto. Quando ci
     sono, servono a far riconoscere il documento da solo quando arriverà la
     fattura che lo cita. */
  const caricaAllegato = async (commessaId, file, ddt = {}) => {
    try {
      const { allegato, spazio } = await datiAPI.caricaAllegato(commessaId, file, ddt);
      setAllegati((a) => [allegato, ...a]);
      if (spazio) setSpazioAllegati(spazio);
      if (allegato.fornitore) ricordaFornitore(allegato.fornitore);
      notifica(allegato.ddtNumero
        ? `Documento allegato: DDT ${allegato.ddtNumero} (${fmtDimensione(allegato.dimensione)}).`
        : `Documento allegato: ${allegato.nomeFile} (${fmtDimensione(allegato.dimensione)}).`);
      return { ok: true, allegato };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };

  /** Completa o corregge i dati del DDT su un documento già archiviato. Il
   *  file non si tocca: serve soprattutto ai documenti caricati prima che
   *  questi campi esistessero, che partono vuoti. */
  const aggiornaDatiAllegato = async (id, ddt) => {
    try {
      const allegato = await datiAPI.aggiornaDatiAllegato(id, ddt);
      setAllegati((a) => a.map((x) => (x.id === allegato.id ? allegato : x)));
      if (allegato.fornitore) ricordaFornitore(allegato.fornitore);
      notifica("Dati del documento aggiornati.");
      return { ok: true, allegato };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };

  /** Un fornitore appena scritto a mano entra subito nella tendina, senza
   *  aspettare di ricaricare la pagina. */
  const ricordaFornitore = (nome) =>
    setFornitoriNoti((f) => (f.includes(nome) ? f : [...f, nome].sort((a, b) => a.localeCompare(b, "it"))));
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

  /* --- fatture elettroniche ---
     Il caricamento legge soltanto: nessun numero entra nei conti. È
     l'importazione, dopo la conferma dell'utente, a creare le voci di
     materiale — che da lì in poi sono materiali come tutti gli altri. */
  const caricaFattura = async (file) => {
    try {
      const dati = await datiAPI.caricaFattura(file);
      const n = dati.lettura.righe.length;
      notifica(`Fattura letta: ${n} ${n === 1 ? "riga trovata" : "righe trovate"}. Assegna le commesse e conferma.`);
      return { ok: true, dati };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };
  const importaFattura = async (fatturaId, righe) => {
    try {
      const ris = await datiAPI.importaFattura(fatturaId, righe);
      setMateriali((m) => [...ris.materiali, ...m]);
      const totale = ris.materiali.reduce((s, x) => s + x.costo, 0);
      notifica(`Importate ${ris.importate} righe dalla fattura, per ${euro(totale)} di materiali.`);
      return { ok: true, materiali: ris.materiali };
    } catch (e) {
      notifica(e.message, "errore");
      return { ok: false, errore: e.message };
    }
  };

  const svuotaTutto = () => setConferma({
    titolo: "Svuotare tutti i dati?",
    testo: "Dipendenti, commesse, registrazioni, materiali e documenti allegati verranno cancellati. Prima di procedere puoi scaricare un backup dalla sezione Dati.",
    onOk: () => {
      setDipendenti([]); setCommesse([]); setRegistrazioni([]); setMateriali([]); setAllegati([]); setDettaglio(null);
      salvaSubitoConBackup({ dipendenti: [], commesse: [], registrazioni: [], materiali: [] })
        .then((r) => r?.ok && notifica("Tutti i dati sono stati cancellati."));
    },
  });
  // Si conferma solo DOPO aver saputo che il salvataggio è andato a buon fine:
  // dire "ricaricati" e non aver salvato niente è il modo peggiore di sbagliare.
  const ricaricaEsempio = async () => {
    const d = creaDatiEsempio();
    setDipendenti(d.dipendenti); setCommesse(d.commesse); setRegistrazioni(d.registrazioni);
    setDal("2026-07-01"); setAl("2026-07-31");
    const ris = await salvaSubitoConBackup({ dipendenti: d.dipendenti, commesse: d.commesse, registrazioni: d.registrazioni });
    if (ris?.ok) notifica("Dati d'esempio (luglio 2026) ricaricati.");
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
    const esito = await salvaSubitoConBackup({
      dipendenti: d.dipendenti, commesse: d.commesse, registrazioni: d.registrazioni,
      azienda: d.azienda, ...(materialiBackup ? { materiali: materialiBackup } : {}),
    });
    if (esito?.ok) notifica("Backup ripristinato: i dati sono tornati com'erano.");
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

  const concludiImport = async (piani, decisioni, avvisi) => {
    const ris = applicaImport({ dipendenti, commesse, registrazioni }, piani, decisioni);
    setDipendenti(ris.dipendenti); setCommesse(ris.commesse); setRegistrazioni(ris.registrazioni);
    const esito = await salvaSubitoConBackup({ dipendenti: ris.dipendenti, commesse: ris.commesse, registrazioni: ris.registrazioni });
    avvisi.forEach((a) => notifica(a, "avviso"));
    if (esito?.ok) notifica(`Import completato: ${piani.length} fogli letti · ${ris.aggiunte} registrazioni aggiunte · ${ris.sostituiti} mesi sostituiti · ${ris.saltati} saltati.`);
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

  /* Le stesse voci di prima, nello stesso ordine, con gli stessi id: cambia
     solo che ora sono raggruppate sotto un'etichetta. Il contatore a destra
     non è un dato nuovo — è il numero di righe che la voce apre. Dove un
     numero solo non direbbe la verità (Fatture, Dati) non c'è contatore. */
  const NAV = [
    { id: "dashboard", nome: "Dashboard", icona: LayoutDashboard },
    { id: "commesse", nome: "Commesse", icona: FolderKanban },
    { id: "dipendenti", nome: "Dipendenti", icona: Users },
    { id: "fatture", nome: "Fatture", icona: ReceiptText },
    { id: "dati", nome: "Dati", icona: Database },
    { id: "abbonamento", nome: "Abbonamento", icona: CreditCard },
    ...(isAdmin ? [{ id: "admin", nome: "Amministrazione", icona: ShieldCheck }] : []),
  ];
  const CONTEGGI = { commesse: commesse.length, dipendenti: dipendenti.length };
  /* Iniziali e piano per il piede della barra laterale: due parole al massimo,
     ricavate da quello che già c'è. Nessuna chiamata nuova. */
  const inizialiAzienda = (azienda || "")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "—";
  const etichettaPiano = abbonamentoInfo?.stato === "attivo" ? "Abbonamento attivo"
    : abbonamentoInfo?.stato === "prova" ? "Periodo di prova"
    : abbonamentoInfo?.stato ? "Abbonamento scaduto" : "";
  const GRUPPI_NAV = [
    { etichetta: "Generale", voci: ["dashboard", "commesse", "dipendenti"] },
    { etichetta: "Documenti", voci: ["fatture", "dati"] },
    { etichetta: "Account", voci: ["abbonamento", "admin"] },
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

      {/* ================= BARRA LATERALE =================
          La cornice scura resta scura: è l'unica superficie che non contiene
          dati, e tenerla distinta aiuta a capire dove finisce lo strumento e
          dove comincia il lavoro. La voce attiva si riconosce dal filo bronzo
          a sinistra, non da un riquadro pieno. */}
      <aside className="w-[230px] shrink-0 flex-col hidden lg:flex noprint superficie-scura"
        style={{ borderRight: ".5px solid var(--bordo-tenue)" }}>
        <div className="px-5 pt-6 pb-7"><Marchio /></div>
        <nav className="px-2.5 space-y-5" aria-label="Navigazione principale">
          {GRUPPI_NAV.map((gruppo) => {
            // Un gruppo può restare senza voci (Amministrazione c'è solo per
            // l'admin): in quel caso non si stampa nemmeno l'etichetta.
            const voci = gruppo.voci
              .map((id) => NAV.find((v) => v.id === id))
              .filter(Boolean);
            if (voci.length === 0) return null;
            return (
              <div key={gruppo.etichetta}>
                <p className="t-micro px-3.5 mb-1.5">{gruppo.etichetta}</p>
                <div className="space-y-0.5">
                  {voci.map(({ id, nome, icona: Icona }) => {
                    const attiva = vista === id;
                    const conteggio = CONTEGGI[id];
                    return (
                      <button key={id} onClick={() => setVista(id)}
                        className="relative w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 t-corpo btn voce-nav"
                        style={{
                          borderRadius: "var(--r-sm)",
                          background: attiva ? "var(--bg-hover)" : "transparent",
                          color: attiva ? "var(--txt-chiaro)" : "var(--txt-attenuato)",
                          fontWeight: 500,
                        }}>
                        {attiva && (
                          <span aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2"
                            style={{ width: 2.5, height: 15, borderRadius: 99, background: "var(--accento)" }} />
                        )}
                        <Icona size={15} strokeWidth={1.75} className="shrink-0"
                          style={{ color: attiva ? "var(--accento-chiaro)" : "inherit" }} />
                        <span className="truncate">{nome}</span>
                        {conteggio > 0 && (
                          <span className="ml-auto f-mono t-piccolo shrink-0"
                            style={{ background: "var(--bg-pill)", color: "var(--txt-tenue)", borderRadius: "var(--r-xs)", padding: "1px 6px" }}>
                            {conteggio}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="mt-auto px-3 pb-3">
          {abbonamentoInfo?.stato === "prova" && (() => {
            const urgente = abbonamentoInfo.giorniProvaRestanti <= 3;
            return (
              <button
                onClick={() => setVista("abbonamento")}
                className="w-full mb-1.5 px-4 py-3 text-left btn"
                style={{
                  borderRadius: "var(--r-sm)",
                  background: urgente ? "rgba(196,162,101,.1)" : "var(--scuro-velo)",
                  boxShadow: urgente ? "inset 0 0 0 .5px var(--accento-bordo)" : "none",
                }}
              >
                <div className="flex items-center gap-2 t-piccolo" style={{ fontWeight: 500, color: urgente ? "var(--accent-chiaro)" : "var(--scuro-muted)" }}>
                  <Clock size={14} strokeWidth={1.75} className="shrink-0" />
                  {abbonamentoInfo.giorniProvaRestanti === 1
                    ? "Ultimo giorno di prova"
                    : `${abbonamentoInfo.giorniProvaRestanti} giorni di prova`}
                </div>
                {urgente && <div className="t-piccolo mt-1 ml-6" style={{ color: "var(--scuro-muted)" }}>Abbonati ora →</div>}
              </button>
            );
          })()}
          <button onClick={uscire} className="w-full flex items-center gap-2.5 pl-3.5 pr-3 py-2 t-corpo btn voce-nav"
            style={{ borderRadius: "var(--r-sm)", color: "var(--txt-attenuato)", fontWeight: 500 }}>
            <LogOut size={15} strokeWidth={1.75} /> Esci
          </button>
        </div>
        {/* Il piede della barra: chi sei e con che piano. Prende il posto
            della frase di presentazione, che diceva all'utente una cosa che
            sapeva già. */}
        <div className="px-4 py-3.5 flex items-center gap-2.5"
          style={{ borderTop: ".5px solid var(--bordo-tenue)" }}>
          <div className="flex items-center justify-center shrink-0 t-piccolo box"
            style={{ width: 28, height: 28, fontWeight: 500, color: "var(--txt-attenuato)" }}>
            {inizialiAzienda}
          </div>
          <div className="min-w-0">
            <p className="t-piccolo truncate" style={{ fontWeight: 500, color: "var(--txt-chiaro)" }}>
              {azienda || "La tua azienda"}
            </p>
            <p className="t-micro" style={{ letterSpacing: ".04em" }}>{etichettaPiano}</p>
          </div>
        </div>
      </aside>

      {/* ================= COLONNA PRINCIPALE ================= */}
      <div className="flex-1 min-w-0 flex flex-col pb-16 lg:pb-0">

        {/* ---- testata: periodo + i due numeri che contano ----
             Era scura come la barra laterale. Ora è chiara, perché contiene
             DATI, e i dati appartengono all'area di lavoro: il verde degli euro
             su avorio si legge per quello che è, mentre sul fondo scuro doveva
             schiarirsi fino a diventare un altro colore. Comandi e numeri sono
             rimasti dove erano. */}
        <header className="sticky top-0 z-30 noprint"
          style={{ background: "rgba(8,8,10,.82)", backdropFilter: "blur(14px)", borderBottom: ".5px solid var(--bordo)" }}>
          {/* La briciola dice dove sei: azienda, poi sezione. È l'unica cosa
              che prima mancava per capire a colpo d'occhio in che schermata
              ci si trova quando la barra laterale è nascosta. */}
          <div className="px-5 md:px-10 pt-3.5 flex items-center gap-2 t-piccolo">
            <span className="truncate" style={{ color: "var(--txt-tenue)", maxWidth: "18ch" }}>
              {azienda || "La tua azienda"}
            </span>
            <ChevronRight size={12} strokeWidth={1.75} style={{ color: "var(--txt-fioco)" }} className="shrink-0" />
            <span style={{ color: "var(--txt-chiaro)", fontWeight: 500 }}>
              {NAV.find((v) => v.id === vista)?.nome ?? "Dashboard"}
            </span>
          </div>
          <div className="px-5 md:px-10 pt-2.5 pb-4 flex flex-wrap items-center gap-x-8 gap-y-4">
            {/* Il periodo era una fila di controlli sciolti sul fondo. Ora è un
                oggetto solo, con l'icona del calendario a dire cos'è: i
                controlli dentro sono gli stessi, uno per uno. */}
            <div className="flex items-center gap-1 pl-2.5 pr-1 py-1 box">
              <CalendarDays size={14} strokeWidth={1.75} className="shrink-0 mr-1" style={{ color: "var(--txt-tenue)" }} />
              <button onClick={() => scorriMese(-1)} aria-label="Mese precedente" className="p-1.5 btn"
                style={{ borderRadius: "var(--r-xs)", color: "var(--txt-attenuato)" }}>
                <ChevronLeft size={14} strokeWidth={1.75} />
              </button>
              <input type="date" value={dal} onChange={(e) => setDal(e.target.value)} aria-label="Inizio intervallo"
                className="f-mono t-piccolo px-1.5 py-1 outline-none campo-nudo" />
              <span style={{ color: "var(--txt-fioco)" }}>–</span>
              <input type="date" value={al} onChange={(e) => setAl(e.target.value)} aria-label="Fine intervallo"
                className="f-mono t-piccolo px-1.5 py-1 outline-none campo-nudo"
                style={erroreIntervallo ? { color: "var(--errore)" } : undefined} />
              <button onClick={() => scorriMese(1)} aria-label="Mese successivo" className="p-1.5 btn"
                style={{ borderRadius: "var(--r-xs)", color: "var(--txt-attenuato)" }}>
                <ChevronRight size={14} strokeWidth={1.75} />
              </button>
              {estremiDati && !erroreIntervallo && (
                <button onClick={() => { setDal(estremiDati.min); setAl(estremiDati.max); }}
                  className="ml-0.5 hidden sm:inline-block t-piccolo px-2.5 py-1 btn"
                  style={{ borderRadius: "var(--r-xs)", color: "var(--txt-tenue)" }}>
                  Tutto
                </button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-6 md:gap-8">
              {riep && riep.invariante && (
                <span className="hidden md:inline-flex" title={riep.invariante.ok
                  ? "Il costo del periodo coincide con la somma dei lordi mensili"
                  : "Quadratura non verificata: controlla lordi e dati"}>
                  <Pillola tono={riep.invariante.ok ? "euro" : "accento"}>
                    <span className="rounded-full" style={{ width: 5, height: 5, background: "currentColor" }} />
                    {riep.invariante.ok ? "Quadra" : "Non quadra"}
                  </Pillola>
                </span>
              )}
              <div className="text-right">
                <Micro>Costo del periodo</Micro>
                <p className="cifra-grande mt-1.5" style={{ fontSize: 27, lineHeight: 1, color: "var(--euro)" }}>
                  {riep ? euro(costoLive) : "—"}
                </p>
              </div>
              <div className="text-right hidden sm:block pl-7" style={{ borderLeft: ".5px solid var(--hairline)" }}>
                <Micro>Ore</Micro>
                <p className="cifra-grande mt-1.5" style={{ fontSize: 27, lineHeight: 1, fontWeight: 500, color: "var(--txt)" }}>
                  {riep ? fmtOre.format(riep.totOre) : "—"}
                </p>
              </div>
              <button onClick={uscire} aria-label="Esci" title="Esci" className="lg:hidden p-2 btn"
                style={{ borderRadius: "var(--r-sm)", color: "var(--muted)", boxShadow: "var(--ombra-md)", background: "var(--card)" }}>
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          {erroreIntervallo && (
            <p className="px-5 md:px-10 pb-3 t-piccolo flex items-center gap-1.5" style={{ color: "var(--errore)" }}>
              <AlertTriangle size={14} strokeWidth={1.75} /> La data "Al" precede la data "Dal": correggi l'intervallo.
            </p>
          )}
        </header>

        {/* Su schermi larghi il contenuto non si spalma da bordo a bordo: resta
            entro una misura leggibile e centrato, col respiro ai lati. */}
        <main key={vista} className="flex-1 px-5 md:px-10 py-10 max-w-[1180px] w-full mx-auto noprint anim-vista">
          {/* Finché il salvataggio non riesce, questa fascia resta lì: è
              l'unico modo perché nessuno continui a lavorare credendo che i
              dati vengano registrati mentre non lo sono. */}
          {salvataggioNonRiuscito && (
            <div className="mb-9">
              <Avviso tono="errore">
                <span style={{ fontWeight: 600 }}>Le modifiche non vengono salvate ({salvataggioNonRiuscito}).</span>
                <span className="block mt-1.5" style={{ opacity: .9 }}>
                  Quello che vedi è solo su questo schermo: se ricarichi la pagina lo perdi. Prima di continuare,
                  scarica un backup dalla sezione Dati; l'avviso sparirà da solo appena il salvataggio tornerà a funzionare.
                </span>
              </Avviso>
            </div>
          )}

          {riep && riep.avvisi.length > 0 && (
            <div className="mb-9 px-4 py-3 space-y-1.5" style={{ background: "var(--velo-accento)", boxShadow: "0 0 0 .5px var(--accento-bordo)", borderRadius: "var(--r-sm)" }} role="alert">
              {riep.avvisi.map((a, i) => (
                <p key={i} className="t-piccolo flex items-start gap-2.5" style={{ color: "var(--accento-chiaro)" }}><AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {a}</p>
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
          {vista === "fatture" && (
            <VistaFatture commesse={commesse} onCarica={caricaFattura} onImporta={importaFattura}
              notifica={notifica} vaiCommesse={() => setVista("commesse")} />
          )}
          {vista === "abbonamento" && <VistaAbbonamento info={abbonamentoInfo} />}
          {vista === "admin" && isAdmin && <VistaAdmin />}
        </main>
      </div>

      {/* ---- navigazione mobile ---- */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 grid noprint superficie-scura"
        style={{ borderTop: ".5px solid var(--scuro-linea)", gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }} aria-label="Navigazione">
        {NAV.map(({ id, nome, icona: Icona }) => (
          <button key={id} onClick={() => setVista(id)} className="flex flex-col items-center gap-1.5 py-3 btn"
            style={{ color: vista === id ? "var(--accent-chiaro)" : "var(--scuro-muted)" }}>
            <Icona size={18} strokeWidth={1.75} />
            <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: ".02em" }}>{nome}</span>
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
          allegati={allegati} spazioAllegati={spazioAllegati} fornitoriNoti={fornitoriNoti}
          onAggiungiMateriale={aggiungiMateriale} onAggiornaMateriale={aggiornaMateriale} onEliminaMateriale={eliminaMateriale}
          onCaricaAllegato={caricaAllegato} onApriAllegato={apriAllegato} onEliminaAllegato={eliminaAllegato}
          onAggiornaDatiAllegato={aggiornaDatiAllegato}
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
            {flussoImport.conflitti.length > 1 && <span className="block mt-1 t-piccolo">Conflitto {flussoImport.idx + 1} di {flussoImport.conflitti.length}.</span>}
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
          <div className="w-10 h-10 rounded-[var(--r-sm)] flex items-center justify-center mb-4" style={{ background: "var(--velo-accento)" }}>
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

      {/* Notifiche: inchiostro pieno, un'ombra vera (stanno sopra tutto) e
          l'icona come unico tocco di colore. */}
      <div className="fixed bottom-20 lg:bottom-6 right-6 z-50 space-y-2.5 noprint" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-3 px-4 py-3.5 t-piccolo anim-pop"
            style={{ maxWidth: 380, background: "var(--ink)", color: "var(--txt-chiaro)", borderRadius: "var(--r-sm)", boxShadow: "var(--ombra-lg)" }}>
            {t.tipo === "errore" ? <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "var(--rosso)" }} />
              : t.tipo === "avviso" ? <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "var(--accent-chiaro)" }} />
              : <CheckCircle2 size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "var(--verde)" }} />}
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
    <section className="p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-5">
        <h2 className="t-sotto">Andamento mensile</h2>
        <p className="t-piccolo" style={{ color: "var(--muted)" }}>
          {datiMesi.length >= 2
            ? `Ultimi ${datiMesi.length} mesi con ore registrate · indipendente dall'intervallo scelto`
            : "Storico completo, indipendente dall'intervallo scelto"}
        </p>
      </div>

      {datiMesi.length < 2 ? (
        <div className="flex flex-col items-center justify-center text-center py-14 px-6" style={{ background: "var(--tela-alt)", borderRadius: "var(--r-sm)" }}>
          <div className="flex items-center justify-center mb-4" style={{ width: 40, height: 40, borderRadius: "var(--r-md)", background: "var(--velo)" }}>
            <Clock size={18} strokeWidth={1.5} style={{ color: "var(--muted)" }} />
          </div>
          <p className="t-sotto mb-2" style={{ color: "var(--txt)" }}>Servono almeno due mesi di dati per vedere l'andamento</p>
          <p className="t-piccolo" style={{ color: "var(--muted)", maxWidth: "48ch" }}>
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
              <span className="f-mono" style={{ color: variazione > 0 ? "#A6753A" : variazione < 0 ? "var(--euro)" : "var(--muted)" }}>
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
                    <CartesianGrid stroke="var(--bordo)" vertical={false} />
                    <XAxis dataKey="mese" tick={STILE_ASSE} minTickGap={4} axisLine={false} tickLine={false} />
                    <YAxis tick={STILE_ASSE} tickFormatter={(v) => fmtOre.format(v)} width={54} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [euro(v), "Costo del mese"]}
                      contentStyle={STILE_TOOLTIP}
                      cursor={{ fill: "rgba(255,255,255,.03)" }} />
                    <Bar dataKey="costo" radius={[2, 2, 0, 0]} maxBarSize={38}>
                      {datiMesi.map((_, i) => <Cell key={i} fill={i === datiMesi.length - 1 ? "var(--accent)" : BARRA_ALTRE} />)}
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
                    <CartesianGrid stroke="var(--bordo)" vertical={false} />
                    <XAxis dataKey="mese" tick={STILE_ASSE} minTickGap={4} axisLine={false} tickLine={false} />
                    <YAxis tick={STILE_ASSE} tickFormatter={(v) => fmtOre.format(v)} width={46} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [fmtOre.format(v) + " h", "Ore del mese"]}
                      contentStyle={STILE_TOOLTIP}
                      cursor={{ fill: "rgba(255,255,255,.03)" }} />
                    <Bar dataKey="ore" radius={[2, 2, 0, 0]} maxBarSize={38} fill="#26262C" />
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
    <section className="overflow-hidden" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
      <div className="px-7 pt-6"><Micro>{titolo}</Micro></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 mt-2">
        {voci.map((k, i) => (
          <div key={k.e} className="px-7 py-6"
            style={{ borderLeft: i > 0 ? ".5px solid var(--hairline)" : "none", background: k.forte ? "var(--tela-alt)" : "transparent" }}>
            <Micro>{k.e}</Micro>
            <p className="cifra-grande mt-2.5" style={{ fontSize: k.forte ? 29 : 24, lineHeight: 1, color: k.c }}>{k.v}</p>
            {k.forte && <p className="t-piccolo mt-2.5" style={{ color: "var(--tenue)" }}>manodopera + materiali</p>}
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
        <h1 className="t-titolo mt-2">{fmtData(dal)} – {fmtData(al)}</h1>
      </div>

      <FasciaCosti costi={costi} />

      {/* KPI: una fascia unica, separatori a filo */}
      <div className="grid grid-cols-2 xl:grid-cols-4 overflow-hidden" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
        {kpi.map((k, i) => (
          <div key={k.e} className="px-7 py-6" style={{ borderLeft: i > 0 ? ".5px solid var(--hairline)" : "none" }}>
            <Micro>{k.e}</Micro>
            <p className="cifra-grande mt-2.5" style={{ fontSize: 23, lineHeight: 1, color: k.muto ? "var(--muted)" : "var(--txt)" }}>
              {k.v}{k.u && <span className="t-piccolo ml-1" style={{ fontWeight: 400, color: "var(--tenue)" }}>{k.u}</span>}
            </p>
            {k.sub && <p className="f-mono t-piccolo mt-2" style={{ color: k.muto || k.subMuto ? "var(--tenue)" : "var(--euro)" }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-5 gap-7 items-start">
        {/* costo per commessa */}
        <section className="xl:col-span-3 p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
          <div className="flex items-baseline justify-between gap-4 mb-6">
            <h2 className="t-sotto">Costo per commessa</h2>
            <button onClick={vaiCommesse} className="t-piccolo font-medium flex items-center gap-1 btn shrink-0" style={{ color: "var(--accent)" }}>
              Riepilogo <ChevronRight size={13} strokeWidth={1.75} />
            </button>
          </div>
          <div style={{ height: Math.max(200, datiBarre.length * 26 + 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datiBarre} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} onClick={(e) => e && e.activePayload && apri(e.activePayload[0].payload.riga)}>
                <CartesianGrid stroke="var(--bordo)" horizontal={false} />
                <XAxis type="number" tick={STILE_ASSE} tickFormatter={(v) => fmtOre.format(v)} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" width={46} tick={STILE_ASSE_FORTE} interval={0} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [euro(v), "Costo totale"]} labelFormatter={(l) => "Commessa " + l}
                  contentStyle={STILE_TOOLTIP}
                  cursor={{ fill: "rgba(255,255,255,.03)" }} />
                <Bar dataKey="costo" radius={[0, 3, 3, 0]} maxBarSize={10} className="cursor-pointer">
                  {datiBarre.map((_, i) => <Cell key={i} fill={i === 0 ? BARRA_PRIMA : BARRA_ALTRE} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="t-piccolo mt-4" style={{ color: "var(--tenue)" }}>Seleziona una barra per aprire il dettaglio della commessa.</p>
        </section>

        <div className="xl:col-span-2 space-y-7">
          {/* per dipendente */}
          <section className="p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
            <h2 className="t-sotto mb-6">Costo per dipendente</h2>
            <div className="space-y-6">
              {perDip.map((d) => (
                <div key={d.dip.id}>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="text-sm font-medium truncate">{d.dip.nome} {d.dip.cognome}</p>
                    <p className="f-mono text-sm shrink-0" style={{ color: "var(--euro)", fontWeight: 500 }}>{euro(d.costo)}</p>
                  </div>
                  <BarraQuota quota={totCosto > 0 ? d.costo / totCosto : 0} colore="#2E2E36" />
                  <p className="f-mono t-piccolo mt-2" style={{ color: "var(--tenue)" }}>{fmtOre.format(d.ore)} h · {fmtPerc.format(totCosto > 0 ? (d.costo / totCosto) * 100 : 0)}%</p>
                </div>
              ))}
            </div>
          </section>

          {/* andamento */}
          {datiGiorni.length > 1 && (
            <section className="p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
              <h2 className="t-sotto mb-5">Andamento giornaliero</h2>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={datiGiorni} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradCosto" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--bordo)" vertical={false} />
                    <XAxis dataKey="giorno" tick={STILE_ASSE} minTickGap={28} axisLine={false} tickLine={false} />
                    <YAxis tick={STILE_ASSE} tickFormatter={(v) => fmtOre.format(v)} width={46} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [euro(v), "Costo del giorno"]} contentStyle={STILE_TOOLTIP} />
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
    <div className="space-y-9">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <Micro>Riepilogo</Micro>
          <h1 className="t-titolo mt-2">Commesse</h1>
        </div>
        {/* Una sola azione piena — il PDF, che è quella che si usa davvero — e
            le altre in tono minore: così si capisce cosa premere. */}
        <div className="flex gap-2 flex-wrap">
          <Bottone variante="fantasma" onClick={esportaCsv}><FileText size={14} strokeWidth={1.75} /> CSV</Bottone>
          <Bottone variante="fantasma" onClick={esportaXlsx}><FileSpreadsheet size={14} strokeWidth={1.75} /> Excel</Bottone>
          <Bottone variante="fantasma" onClick={esportaTutto}><FileDown size={14} strokeWidth={1.75} /> Esporta tutto</Bottone>
          <Bottone onClick={stampa}><Download size={14} strokeWidth={1.75} /> PDF</Bottone>
        </div>
      </div>

      {costi.righe.length === 0 ? (
        <StatoVuoto icona={FolderKanban} titolo="Nessuna commessa nell'intervallo"
          testo="Nessuna ora né materiale registrati in queste date. Allarga l'intervallo o registra nuove ore."
          azione={<Bottone onClick={vaiDati}><Plus size={14} strokeWidth={1.75} /> Registra ore</Bottone>} />
      ) : (
        <div className="overflow-hidden" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
          <div className="px-7 py-5 flex items-center justify-between gap-4" style={{ borderBottom: ".5px solid var(--hairline)" }}>
            <p className="t-piccolo f-mono" style={{ color: "var(--muted)" }}>{fmtData(dal)} – {fmtData(al)} · {righe.length} commesse</p>
            <div className="relative">
              <Search size={14} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--tenue)" }} />
              <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca…"
                className="pl-9 pr-3 py-2 text-sm outline-none campo" style={{ width: 190, background: "var(--tela-alt)" }} aria-label="Cerca commessa" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tabella text-sm">
              <thead>
                <tr>
                  {[["codice", "Codice", ""], [null, "Descrizione", "hidden lg:table-cell"], ["ore", "Ore", "text-right"],
                    [null, "Quota", "w-36 hidden xl:table-cell"],
                    ["manodopera", "Manodopera", "text-right"], ["materiali", "Materiali", "text-right"], ["totale", "Totale", "text-right"]].map(([campo, nome, cls]) => (
                    <th key={nome} className={`${cls} ${campo ? "cursor-pointer select-none" : ""}`}
                      onClick={campo ? () => clic(campo) : undefined}>
                      {nome}{campo ? freccia(campo) : ""}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.commessa.id} onClick={() => apri(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && apri(r)}
                    className="cursor-pointer riga">
                    <td className="f-mono font-medium">{r.commessa.codice}</td>
                    <td className="hidden lg:table-cell" style={{ color: "var(--muted)" }}>{r.commessa.descrizione}</td>
                    <td className="f-mono text-right">{fmtOre.format(r.ore)}</td>
                    <td className="hidden xl:table-cell">
                      <div className="flex items-center gap-3">
                        <div className="flex-1"><BarraQuota quota={maxCosto > 0 ? r.costoTotale / maxCosto : 0} colore="#2E2E36" /></div>
                        <span className="f-mono t-piccolo w-11 text-right" style={{ color: "var(--tenue)" }}>{fmtPerc.format(costi.totTotale > 0 ? (r.costoTotale / costi.totTotale) * 100 : 0)}%</span>
                      </div>
                    </td>
                    <td className="f-mono text-right" style={{ color: "var(--euro)" }}>{euro(r.costoManodopera)}</td>
                    <td className="f-mono text-right" style={{ color: r.costoMateriali > 0 ? "var(--euro)" : "var(--tenue)" }}>{euro(r.costoMateriali)}</td>
                    <td className="f-mono text-right font-medium">{euro(r.costoTotale)}</td>
                    <td className="text-right pr-5"><ChevronRight size={14} strokeWidth={1.75} style={{ color: "var(--tenue)" }} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: ".5px solid var(--hairline-forte)", background: "var(--tela-alt)" }}>
                  <td className="font-medium">Totale</td>
                  <td className="hidden lg:table-cell" />
                  <td className="f-mono text-right font-medium">{fmtOre.format(riep.totOre)}</td>
                  <td className="hidden xl:table-cell" />
                  <td className="f-mono text-right font-medium" style={{ color: "var(--euro)" }}>{euro(costi.totManodopera)}</td>
                  <td className="f-mono text-right font-medium" style={{ color: "var(--euro)" }}>{euro(costi.totMateriali)}</td>
                  <td className="f-mono text-right font-medium" style={{ fontSize: 15 }}>{euro(costi.totTotale)}</td>
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

function PannelloDettaglio({ riga, riep, costi, dal, al, serieMensile, allegati, spazioAllegati, fornitoriNoti,
  onAggiungiMateriale, onAggiornaMateriale, onEliminaMateriale,
  onCaricaAllegato, onApriAllegato, onEliminaAllegato, onAggiornaDatiAllegato, onChiudi }) {
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
      <div className="absolute inset-0 anim-velo" style={{ background: "rgba(0,0,0,.66)", backdropFilter: "blur(4px)" }} onClick={onChiudi} />
      <div className="absolute right-0 top-0 bottom-0 w-full flex flex-col anim-slide"
        style={{ maxWidth: 460, background: "var(--card)", boxShadow: "var(--ombra-lg)" }}>
        {/* La testata del pannello era scura come la barra laterale. Qui però
            siamo dentro il lavoro, non nella cornice: fondo avorio, il codice
            della commessa alla scala grande, un filo sotto. */}
        <div className="px-7 py-6 flex items-start justify-between gap-4"
          style={{ background: "var(--tela-alt)", borderBottom: ".5px solid var(--hairline)" }}>
          <div className="min-w-0">
            <Micro>Dettaglio commessa</Micro>
            <h3 className="cifra-grande mt-2" style={{ fontSize: 30, lineHeight: 1 }}>{riga.commessa.codice}</h3>
            <p className="t-piccolo mt-2.5" style={{ color: "var(--muted)" }}>{riga.commessa.descrizione}</p>
          </div>
          <button onClick={onChiudi} aria-label="Chiudi dettaglio" className="p-1.5 btn shrink-0 -mr-1.5"
            style={{ borderRadius: "var(--r-xs)", color: "var(--tenue)" }}><X size={17} strokeWidth={1.75} /></button>
        </div>
        <div className="p-7 space-y-8 overflow-y-auto">
          {/* I tre numeri, sempre distinti: ore e manodopera, materiali, e la
              loro somma. Non si mescolano mai in un unico "costo". */}
          <div className="overflow-hidden" style={{ borderRadius: "var(--r-sm)", boxShadow: "var(--ombra-sm)" }}>
            <div className="grid grid-cols-3">
              {[["Ore", fmtOre.format(riga.ore), null], ["Manodopera", euro(riga.costoManodopera), "var(--euro)"], ["Materiali", euro(riga.costoMateriali), riga.costoMateriali > 0 ? "var(--euro)" : "var(--tenue)"]].map(([e, v, col], i) => (
                <div key={e} className="px-4 py-4" style={{ borderLeft: i > 0 ? ".5px solid var(--hairline)" : "none" }}>
                  <Micro>{e}</Micro>
                  <p className="f-mono mt-2" style={{ fontSize: 15, fontWeight: 500, color: col || "var(--txt)" }}>{v}</p>
                </div>
              ))}
            </div>
            <div className="px-4 py-4 flex items-end justify-between gap-3" style={{ borderTop: ".5px solid var(--hairline)", background: "var(--tela-alt)" }}>
              <div>
                <Micro>Costo totale</Micro>
                <p className="t-piccolo mt-1.5" style={{ color: "var(--tenue)" }}>manodopera + materiali · {fmtPerc.format(quota * 100)}% del periodo</p>
              </div>
              <p className="cifra-grande shrink-0" style={{ fontSize: 22, lineHeight: 1 }}>{euro(riga.costoTotale)}</p>
            </div>
          </div>
          <p className="t-piccolo f-mono" style={{ color: "var(--tenue)" }}>Intervallo {fmtData(dal)} – {fmtData(al)}</p>
          <div>
            <h4 className="t-sotto mb-5">Dipendenti sulla commessa</h4>
            <div className="space-y-6">
              {riga.dipendenti.map((d, i) => (
                <div key={i}>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="text-sm font-medium">{d.dip.nome} {d.dip.cognome}</p>
                    <p className="f-mono text-sm" style={{ color: "var(--euro)", fontWeight: 500 }}>{euro(d.costo)}</p>
                  </div>
                  <BarraQuota quota={maxDip > 0 ? d.costo / maxDip : 0} colore="#2E2E36" />
                  <p className="t-piccolo f-mono mt-2" style={{ color: "var(--tenue)" }}>{fmtOre.format(d.ore)} h · tariffa media {fmtNum4.format(d.tariffaMedia)} €/h</p>
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
            spazio={spazioAllegati} fornitoriNoti={fornitoriNoti}
            onCarica={onCaricaAllegato} onApri={onApriAllegato} onElimina={onEliminaAllegato}
            onAggiornaDati={onAggiornaDatiAllegato} />

          {/* storico della commessa: tutti i mesi in cui ha avuto ore, non solo l'intervallo */}
          <div>
            <h4 className="t-sotto mb-2">Andamento di questa commessa</h4>
            <p className="t-piccolo mb-4" style={{ color: "var(--muted)" }}>
              Costo mese per mese da quando ha ore registrate, indipendente dall'intervallo scelto.
            </p>
            {datiCommessa.length < 2 ? (
              <p className="text-sm leading-relaxed rounded-[var(--r-sm)] px-4 py-3.5" style={{ background: "var(--tela-alt)", color: "var(--muted)" }}>
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
                    <CartesianGrid stroke="var(--bordo)" vertical={false} />
                    <XAxis dataKey="mese" tick={STILE_ASSE} minTickGap={4} axisLine={false} tickLine={false} />
                    <YAxis tick={STILE_ASSE} tickFormatter={(v) => fmtOre.format(v)} width={54} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [euro(v), "Costo del mese"]}
                      contentStyle={STILE_TOOLTIP} />
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
        <h4 className="t-sotto">Materiali</h4>
        <p className="f-mono text-sm" style={{ color: totale > 0 ? "var(--euro)" : "var(--muted)" }}>{euro(totale)}</p>
      </div>
      <p className="t-piccolo mb-4" style={{ color: "var(--muted)" }}>
        Voci di spesa inserite a mano, nell'intervallo scelto. Il costo della riga è quantità × prezzo unitario e si somma alla manodopera solo nel costo totale.
      </p>

      <div className="rounded-[var(--r-sm)] p-4 space-y-3" style={{ background: "var(--tela-alt)", borderRadius: "var(--r-sm)", boxShadow: "var(--ombra-xs)" }}
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
            <li key={m.id} className="rounded-[var(--r-sm)] px-3.5 py-3 flex items-start justify-between gap-3"
              style={{ border: ".5px solid var(--hairline)", background: inModifica === m.id ? "var(--velo-accento)" : "transparent" }}>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{m.descrizione}</p>
                <p className="f-mono t-piccolo mt-1" style={{ color: "var(--muted)" }}>
                  {fmtData(m.data)}{m.fornitore ? " · " + m.fornitore : ""}
                </p>
                <p className="f-mono t-piccolo mt-0.5" style={{ color: "var(--muted)" }}>
                  {fmtOre.format(m.quantita)} × {fmtNum.format(m.prezzoUnitario)} €
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <p className="f-mono text-sm" style={{ color: "var(--euro)" }}>{euro(m.costo)}</p>
                <button onClick={() => { setInModifica(m.id); setErr({}); setF({ data: m.data, fornitore: m.fornitore, descrizione: m.descrizione, quantita: String(m.quantita).replace(".", ","), prezzoUnitario: String(m.prezzoUnitario).replace(".", ",") }); }}
                  aria-label={"Modifica materiale " + m.descrizione} className="p-1.5 rounded-[var(--r-sm)] btn" style={{ boxShadow: "var(--ombra-sm)" }}>
                  <Pencil size={12} strokeWidth={1.75} />
                </button>
                <button onClick={async () => { if (inModifica === m.id) annulla(); await onElimina(m); }}
                  aria-label={"Elimina materiale " + m.descrizione} className="p-1.5 rounded-[var(--r-sm)] btn" style={{ border: ".5px solid var(--rosso-bordo)", color: "var(--errore)" }}>
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
 * I tre dati del DDT, in una riga di campi. Sono FACOLTATIVI: la stessa forma
 * serve sia quando si archivia un documento nuovo sia quando si completano i
 * dati di uno vecchio, e in entrambi i casi si può lasciare tutto vuoto.
 *
 * Il fornitore è un campo di testo con una tendina attaccata (datalist): si
 * sceglie fra quelli già visti — che è più veloce e li scrive sempre allo
 * stesso modo, cosa che poi fa combaciare l'abbinamento — oppure si scrive a
 * mano quello che si vuole. La tendina suggerisce, non obbliga.
 */
function CampiDDT({ valori, onCambia, fornitoriNoti, idElenco }) {
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <Campo etichetta="Numero DDT (facoltativo)">
        <input value={valori.ddtNumero} onChange={(e) => onCambia({ ddtNumero: e.target.value })}
          placeholder="es. 4711" className={inputCls + " f-mono"} style={{ background: "var(--card)" }} />
      </Campo>
      <Campo etichetta="Data DDT (facoltativo)">
        <input type="date" value={valori.ddtData} onChange={(e) => onCambia({ ddtData: e.target.value })}
          className={inputCls + " f-mono"} style={{ background: "var(--card)" }} />
      </Campo>
      <Campo etichetta="Fornitore (facoltativo)">
        <input value={valori.fornitore} onChange={(e) => onCambia({ fornitore: e.target.value })}
          list={idElenco} placeholder="scegli o scrivi" className={inputCls} style={{ background: "var(--card)" }} />
        <datalist id={idElenco}>
          {fornitoriNoti.map((f) => <option key={f} value={f} />)}
        </datalist>
      </Campo>
    </div>
  );
}

const DDT_VUOTO = { ddtNumero: "", ddtData: "", fornitore: "" };

/**
 * Documenti (DDT) di una commessa: caricamento, elenco, apertura, eliminazione.
 * Il documento viene archiviato e collegato: del contenuto non si legge nulla.
 * Il collegamento è per id della commessa, quindi rinominarla non stacca nulla.
 * A differenza dei materiali l'elenco NON è filtrato per intervallo di date:
 * un archivio di documenti serve tutto, sempre.
 *
 * Da questo passo si possono scrivere anche numero, data e fornitore del DDT.
 * Sono tre campi FACOLTATIVI: chi li lascia vuoti archivia esattamente come
 * prima e non perde niente di quello che aveva. Chi li compila ottiene una
 * cosa in cambio: quando arriverà la fattura che cita quel numero, la commessa
 * verrà proposta da sola.
 */
function SezioneDocumenti({ commessa, allegati, spazio, fornitoriNoti = [], onCarica, onApri, onElimina, onAggiornaDati }) {
  const refFile = useRef();
  const [inCaricamento, setInCaricamento] = useState(null); // nome del file in corso
  const [inApertura, setInApertura] = useState(null);
  const [form, setForm] = useState(null);      // null = chiuso; altrimenti i tre campi del nuovo documento
  const [inModifica, setInModifica] = useState(null); // { id, ddtNumero, ddtData, fornitore } di un documento esistente
  const [salvandoModifica, setSalvandoModifica] = useState(false);

  const scegli = async (file) => {
    if (!file) return;
    setInCaricamento(file.name);
    const ris = await onCarica(commessa.id, file, form || DDT_VUOTO);
    setInCaricamento(null);
    // Il form si chiude solo se il caricamento è andato: altrimenti l'utente
    // riavrebbe i campi vuoti e dovrebbe riscrivere tutto.
    if (ris?.ok) setForm(null);
  };

  const salvaModifica = async () => {
    if (salvandoModifica) return;
    setSalvandoModifica(true);
    const { id, ...ddt } = inModifica;
    const ris = await onAggiornaDati(id, ddt);
    setSalvandoModifica(false);
    if (ris?.ok) setInModifica(null);
  };

  const apri = async (a) => { setInApertura(a.id); await onApri(a); setInApertura(null); };

  /** La riga di dati sotto al nome del file: c'è solo se c'è qualcosa da dire. */
  const rigaDDT = (a) => [
    a.ddtNumero && `DDT ${a.ddtNumero}`,
    a.ddtData && fmtData(a.ddtData),
    a.fornitore,
  ].filter(Boolean).join(" · ");

  const usato = spazio?.usatoAzienda ?? 0;
  const quota = spazio?.quotaAzienda ?? 0;
  const quotaPiena = quota > 0 ? Math.min(1, usato / quota) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h4 className="t-sotto">Documenti · DDT</h4>
        <p className="f-mono t-piccolo" style={{ color: "var(--muted)" }}>{allegati.length} {allegati.length === 1 ? "documento" : "documenti"}</p>
      </div>
      <p className="t-piccolo mb-4" style={{ color: "var(--muted)" }}>
        Archivio dei documenti di trasporto della commessa: PDF o foto, fino a {spazio ? fmtDimensione(spazio.maxFile) : "5 MB"} l'uno. Le foto vengono rimpicciolite prima di essere caricate. Del contenuto non si legge nulla: il documento si conserva e resta collegato a questa commessa.
      </p>

      <input ref={refFile} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; scegli(f); }} />

      {inCaricamento ? (
        <div className="rounded-[var(--r-sm)] px-4 py-3.5" style={{ background: "var(--tela-alt)", borderRadius: "var(--r-sm)", boxShadow: "var(--ombra-xs)" }}>
          <div className="flex items-center gap-2.5">
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" style={{ color: "var(--accent)" }} />
            <p className="text-sm truncate">Caricamento di {inCaricamento}…</p>
          </div>
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: "var(--hairline)" }}>
            <div className="h-full anim-scorre" style={{ background: "var(--accent)", width: "40%" }} />
          </div>
        </div>
      ) : form ? (
        /* I tre campi del DDT, prima di scegliere il file. Si può premere
           "Scegli il file" con tutti i campi vuoti: sono facoltativi davvero. */
        <div className="rounded-[var(--r-sm)] px-4 py-4" style={{ background: "var(--tela-alt)", borderRadius: "var(--r-sm)", boxShadow: "var(--ombra-xs)" }}>
          <p className="t-piccolo mb-3" style={{ color: "var(--muted)" }}>
            Se scrivi <strong style={{ color: "var(--txt)" }}>numero, data e fornitore</strong> del DDT, quando arriverà la fattura che lo cita
            questa commessa verrà proposta da sola. Non è obbligatorio: puoi lasciarli vuoti e archiviare il documento come sempre.
          </p>
          <CampiDDT valori={form} onCambia={(patch) => setForm((f) => ({ ...f, ...patch }))}
            fornitoriNoti={fornitoriNoti} idElenco={`fornitori-nuovo-${commessa.id}`} />
          <div className="flex flex-wrap gap-2 mt-4">
            <Bottone onClick={() => refFile.current.click()}>
              <Upload size={14} strokeWidth={1.75} /> Scegli il file e archivia
            </Bottone>
            <Bottone variante="fantasma" onClick={() => setForm(null)}>
              <X size={14} strokeWidth={1.75} /> Annulla
            </Bottone>
          </div>
        </div>
      ) : (
        <Bottone variante="fantasma" onClick={() => setForm({ ...DDT_VUOTO })}>
          <Upload size={14} strokeWidth={1.75} /> Allega un documento
        </Bottone>
      )}

      {allegati.length === 0 ? (
        <p className="text-sm mt-4" style={{ color: "var(--muted)" }}>Nessun documento allegato a questa commessa.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {allegati.map((a) => (
            <li key={a.id} className="rounded-[var(--r-sm)] px-3.5 py-3" style={{ boxShadow: "var(--ombra-sm)" }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-[var(--r-sm)] flex items-center justify-center shrink-0" style={{ background: "var(--velo-accento)" }}>
                    {a.tipo === "application/pdf"
                      ? <FileText size={16} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
                      : <FileImage size={16} strokeWidth={1.75} style={{ color: "var(--accent)" }} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.nomeFile}</p>
                    {/* I dati del DDT compaiono solo se ci sono: un documento
                        archiviato senza compilarli si legge come prima. */}
                    {rigaDDT(a) && (
                      <p className="f-mono t-piccolo mt-0.5 truncate" style={{ color: "var(--accent)" }}>{rigaDDT(a)}</p>
                    )}
                    <p className="f-mono t-piccolo mt-0.5" style={{ color: "var(--muted)" }}>
                      {fmtData(a.caricatoIl.slice(0, 10))} · {fmtDimensione(a.dimensione)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setInModifica(inModifica?.id === a.id ? null : { id: a.id, ddtNumero: a.ddtNumero || "", ddtData: a.ddtData || "", fornitore: a.fornitore || "" })}
                    aria-label={"Dati del DDT per " + a.nomeFile} title="Dati del DDT (numero, data, fornitore)"
                    className="p-1.5 rounded-[var(--r-sm)] btn" style={{ boxShadow: "var(--ombra-sm)" }}>
                    <Pencil size={12} strokeWidth={1.75} />
                  </button>
                  <button onClick={() => apri(a)} disabled={inApertura === a.id}
                    aria-label={"Apri documento " + a.nomeFile} className="p-1.5 rounded-[var(--r-sm)] btn" style={{ boxShadow: "var(--ombra-sm)" }}>
                    {inApertura === a.id
                      ? <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                      : <Download size={12} strokeWidth={1.75} />}
                  </button>
                  <button onClick={() => onElimina(a)} aria-label={"Elimina documento " + a.nomeFile}
                    className="p-1.5 rounded-[var(--r-sm)] btn" style={{ border: ".5px solid var(--rosso-bordo)", color: "var(--errore)" }}>
                    <Trash2 size={12} strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              {/* Completare i dati di un documento già archiviato: il file non
                  si tocca. È la strada per rendere riconoscibili i DDT caricati
                  prima che questi campi esistessero. */}
              {inModifica?.id === a.id && (
                <div className="mt-3 pt-3" style={{ borderTop: ".5px solid var(--hairline)" }}>
                  <CampiDDT valori={inModifica} onCambia={(patch) => setInModifica((m) => ({ ...m, ...patch }))}
                    fornitoriNoti={fornitoriNoti} idElenco={`fornitori-${a.id}`} />
                  <div className="flex flex-wrap justify-end gap-2 mt-3">
                    <Bottone variante="fantasma" onClick={() => setInModifica(null)}>Annulla</Bottone>
                    <Bottone onClick={salvaModifica} disabled={salvandoModifica}>
                      {salvandoModifica
                        ? <><Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> Salvataggio…</>
                        : <><Check size={14} strokeWidth={1.75} /> Salva i dati</>}
                    </Bottone>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {spazio && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <Micro>Spazio archivio</Micro>
            <p className="f-mono t-piccolo" style={{ color: quotaPiena > 0.9 ? "var(--errore)" : "var(--muted)" }}>
              {fmtDimensione(usato)} di {fmtDimensione(quota)}
            </p>
          </div>
          <div className="mt-2"><BarraQuota quota={quotaPiena} colore={quotaPiena > 0.9 ? "var(--errore)" : BARRA_ALTRE} /></div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   IMPORTAZIONE DELLE FATTURE ELETTRONICHE (FatturaPA)

   Il percorso è in tre momenti, e nessun numero entra nei conti prima
   dell'ultimo:
     1. si carica l'XML e il software legge le righe;
     2. si assegnano le commesse (a gruppi di DDT o riga per riga) e si
        correggono i valori che servono;
     3. si conferma, e solo allora le righe diventano costi materiale.

   ABBINAMENTO AUTOMATICO. Se un DDT citato dalla fattura è già archiviato su
   una commessa, il momento 2 arriva in parte già fatto: la commessa è
   pre-selezionata e lo dice a chiare lettere. Questo NON tocca il momento 3.
   La pre-selezione vive soltanto qui, nello stato di questa schermata: l'unica
   strada per cui un costo entra nei conti resta il bottone di conferma in
   fondo. La macchina propone, l'utente conferma — e siccome è una proposta,
   ogni pre-assegnazione si cambia con lo stesso menù di sempre.
--------------------------------------------------------------------------- */

/** La chiave del gruppo a cui appartiene una riga (stessa regola del backend,
 *  in raggruppaPerDDT): il numero di DDT, o "senza-ddt" se non c'è. */
const chiaveGruppoDi = (riga) => (riga.ddtNumero ? `ddt:${riga.ddtNumero}` : "senza-ddt");

/**
 * Come si presenta ogni stato di abbinamento. Il colore non è decorazione: il
 * verde vuol dire "il software ha messo qui una commessa da solo, guardala", il
 * giallo "c'è un candidato ma non ci metto la mano io", il grigio "tocca a te".
 * A colpo d'occhio si deve capire dove serve attenzione senza leggere niente.
 */
const STILI_STATO = {
  auto:      { icona: CheckCircle2,  colore: "var(--euro)",  velo: "var(--velo-euro)",     bordo: "var(--verde-bordo)" },
  possibile: { icona: HelpCircle,    colore: "var(--accento-chiaro)",      velo: "var(--velo-accento)",  bordo: "var(--accento-bordo)" },
  manuale:   { icona: Check,         colore: "var(--euro)",  velo: "var(--verde-bg)",  bordo: "var(--verde-bordo)" },
  misto:     { icona: CircleDot,     colore: "var(--accento-chiaro)",      velo: "var(--velo-accento)",  bordo: "var(--accento-bordo)" },
  vuoto:     { icona: CircleDot,     colore: "var(--tenue)", velo: "var(--velo)",          bordo: "var(--hairline)" },
};

/**
 * La pillola in testa a un gruppo-DDT: dice a che punto è l'assegnazione.
 *
 * Sull'abbinamento automatico dice anche, senza girarci intorno, che si può
 * cambiare col menù qui accanto: è la parte che rende la proposta una proposta.
 */
function StatoAbbinamento({ stato, commessa }) {
  const { tipo, abbinamento } = stato;
  const s = STILI_STATO[tipo];
  const Icona = s.icona;
  const codice = commessa ? `${commessa.codice}${commessa.descrizione ? ` — ${commessa.descrizione}` : ""}` : "?";
  const proposta = abbinamento?.commessaCodice || "?";

  const testo = {
    auto: <>Abbinato in automatico a <strong>{codice}</strong> · <span style={{ fontWeight: 400 }}>controlla e, se serve, cambialo col menù qui accanto</span></>,
    possibile: <>Possibile abbinamento a <strong>{proposta}</strong> — da confermare</>,
    manuale: <>Assegnato da te a <strong>{codice}</strong></>,
    misto: <>Righe assegnate a commesse diverse</>,
    vuoto: <>Da assegnare</>,
  }[tipo];

  return (
    <div className="rounded-[var(--r-sm)] px-3 py-2 mt-2 inline-flex flex-col gap-1"
      style={{ background: s.velo, border: `.5px solid ${s.bordo}` }}>
      <p className="t-piccolo flex items-start gap-1.5" style={{ color: s.colore }}>
        <Icona size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" /> <span>{testo}</span>
      </p>
      {/* Il perché: sul giallo è l'informazione che permette di decidere in due
          secondi invece di andare a riaprire l'archivio. */}
      {abbinamento?.motivo && tipo !== "manuale" && tipo !== "vuoto" && (
        <p className="t-piccolo pl-[19px]" style={{ color: "var(--muted)" }}>{abbinamento.motivo}</p>
      )}
    </div>
  );
}

/**
 * Da dove arrivano i numeri di questa fattura. Non è un dettaglio tecnico:
 * dice a chi controlla quanta attenzione serve. Un XML è un dato scritto dal
 * fornitore; un PDF è una stampa che qualcuno ha dovuto interpretare.
 */
const etichettaOrigine = {
  xml: "letto da XML · valori esatti",
  documentai: "letto con Document AI · controlla i valori",
  pdf: "letto da PDF · controlla i valori",
};

function VistaFatture({ commesse, onCarica, onImporta, notifica, vaiCommesse }) {
  const refFile = useRef();
  const [inLettura, setInLettura] = useState(false);
  const [inImportazione, setInImportazione] = useState(false);
  const [lettura, setLettura] = useState(null);  // { fattura, gruppi, avvisi, abbinamenti }
  const [righe, setRighe] = useState([]);        // righe modificabili, con la commessa assegnata

  const comById = useMemo(() => new Map(commesse.map((c) => [c.id, c])), [commesse]);

  const scegliFile = async (file) => {
    if (!file) return;
    setInLettura(true);
    const ris = await onCarica(file);
    setInLettura(false);
    if (!ris.ok) return;

    const { fattura, lettura: dati } = ris.dati;
    const abbinamenti = Array.isArray(ris.dati.abbinamenti) ? ris.dati.abbinamenti : [];
    const perDDT = new Map(abbinamenti.map((a) => [a.ddtNumero, a]));

    /* La commessa di partenza di ogni riga la decide assegnazioneIniziale (in
       statoGruppoDDT.js): solo un abbinamento FORTE pre-seleziona qualcosa.
       "assegnazione" tiene traccia di CHI ha scelto, così l'interfaccia non
       dice "abbinato in automatico" dopo che l'utente ha cambiato. */
    setRighe(dati.righe.map((r) => ({
      ...r,
      quantita: r.quantita ?? "",
      prezzoUnitario: r.prezzoUnitario ?? "",
      ...assegnazioneIniziale(perDDT.get(r.ddtNumero) || null),
    })));
    setLettura({
      fattura, gruppi: dati.gruppi, avvisi: dati.avvisi, documenti: dati.documenti,
      fornitore: dati.fornitore, abbinamenti,
      origine: dati.origine || "xml",
      scansione: dati.scansione === true,
    });

    const forti = abbinamenti.filter((a) => a.forza === "forte").length;
    const deboli = abbinamenti.length - forti;
    if (forti > 0 || deboli > 0) {
      notifica(
        [forti > 0 && `${forti} ${forti === 1 ? "gruppo abbinato" : "gruppi abbinati"} in automatico`,
         deboli > 0 && `${deboli} da confermare`].filter(Boolean).join(", ") + ": controlla prima di importare.",
        forti > 0 ? "ok" : "avviso"
      );
    }
  };

  /* Ogni modifica a mano marca la riga come "manuale": da quel momento
     l'interfaccia non dice più che l'ha scelta il software. */
  const modificaRiga = (id, patch) => setRighe((rr) => rr.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const assegnaGruppo = (chiaveGruppo, commessaId) =>
    setRighe((rr) => rr.map((r) => (chiaveGruppo === chiaveGruppoDi(r) ? { ...r, commessaId, assegnazione: "manuale" } : r)));
  const cambiaDataGruppo = (chiaveGruppo, data) =>
    setRighe((rr) => rr.map((r) => (chiaveGruppo === chiaveGruppoDi(r) ? { ...r, data } : r)));

  const numero = (v) => (typeof v === "number" ? v : parseNumIt(String(v ?? "")));
  const totaleRiga = (r) => {
    const q = numero(r.quantita), p = numero(r.prezzoUnitario);
    return isNaN(q) || isNaN(p) ? null : q * p;
  };

  /**
   * Lo stato di ogni gruppo-DDT: cosa dice la pillola in testa al gruppo, e
   * cosa si conta nel riepilogo. Si ricalcola a ogni modifica, perché deve
   * dire la verità ADESSO: appena l'utente cambia un menù, il gruppo smette di
   * essere "abbinato in automatico" e diventa "assegnato da te".
   */
  const statiGruppo = useMemo(() => {
    const perNumero = new Map((lettura?.abbinamenti || []).map((a) => [a.ddtNumero, a]));
    const stati = new Map();
    for (const g of lettura?.gruppi || []) {
      const righeGruppo = righe.filter((r) => chiaveGruppoDi(r) === g.chiave);
      if (righeGruppo.length === 0) continue;

      const abbinamento = perNumero.get(g.ddtNumero) || null;
      const { tipo, commessaGruppo } = statoGruppo(righeGruppo, abbinamento);
      stati.set(g.chiave, { tipo, abbinamento, commessaGruppo, righeGruppo });
    }
    return stati;
  }, [lettura, righe]);

  /** Quanti gruppi in ciascuno stato: è il numero che si legge nel riepilogo. */
  const conteggioGruppi = useMemo(() => {
    const c = { auto: 0, possibile: 0, manuale: 0, vuoto: 0, misto: 0 };
    for (const s of statiGruppo.values()) c[s.tipo] += 1;
    return c;
  }, [statiGruppo]);

  /** I gruppi ancora pre-assegnati dal software: si elencano per nome prima
   *  della conferma, perché è su quelli che serve un occhio in più. */
  const gruppiAutomatici = useMemo(() => {
    const elenco = [];
    for (const [chiave, s] of statiGruppo) {
      if (s.tipo === "auto") {
        elenco.push({
          chiave,
          ddtNumero: s.abbinamento?.ddtNumero || "",
          commessa: comById.get(s.commessaGruppo),
          righe: s.righeGruppo.length,
        });
      }
    }
    return elenco;
  }, [statiGruppo, comById]);

  const daImportare = righe.filter((r) => r.commessaId !== NON_IMPORTARE);
  const totaleDaImportare = daImportare.reduce((s, r) => s + (totaleRiga(r) ?? 0), 0);
  const perCommessa = useMemo(() => {
    const m = new Map();
    for (const r of daImportare) {
      if (!m.has(r.commessaId)) m.set(r.commessaId, { righe: 0, totale: 0 });
      const v = m.get(r.commessaId);
      v.righe += 1; v.totale += totaleRiga(r) ?? 0;
    }
    return [...m.entries()].map(([id, v]) => ({ commessa: comById.get(id), ...v })).sort((a, b) => b.totale - a.totale);
  }, [daImportare, comById]);

  const confermaImporta = async () => {
    if (inImportazione) return;
    if (daImportare.length === 0) { notifica("Nessuna riga assegnata a una commessa: non c'è niente da importare.", "avviso"); return; }

    const problemi = daImportare.filter((r) => {
      const q = numero(r.quantita), p = numero(r.prezzoUnitario);
      return !String(r.descrizione).trim() || isNaN(q) || q <= 0 || isNaN(p) || p < 0 || !dataValida(r.data);
    });
    if (problemi.length > 0) {
      notifica(`${problemi.length} righe da importare hanno valori non validi: controlla quantità, prezzo, descrizione e data.`, "errore");
      return;
    }

    setInImportazione(true);
    const ris = await onImporta(lettura.fattura.id, daImportare.map((r) => ({
      commessaId: r.commessaId,
      data: r.data,
      fornitore: lettura.fornitore.denominazione,
      descrizione: String(r.descrizione).trim(),
      quantita: numero(r.quantita),
      prezzoUnitario: numero(r.prezzoUnitario),
    })));
    setInImportazione(false);
    if (ris.ok) { setLettura(null); setRighe([]); }
  };

  /* --- schermata iniziale: nessuna fattura caricata --- */
  if (!lettura) {
    return (
      <div className="space-y-8">
        <div>
          <Micro>Documenti</Micro>
          <h1 className="t-titolo mt-2">Fatture</h1>
        </div>
        <input ref={refFile} type="file" accept=".xml,.p7m,.pdf,application/xml,text/xml,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; scegliFile(f); }} />
        <StatoVuoto icona={ReceiptText} titolo={inLettura ? "Lettura della fattura in corso…" : "Importa una fattura"}
          testo="Carica il file XML della fattura (anche firmato .p7m) e il software ne legge le righe con i prezzi esatti, raggruppate per DDT. Se un DDT è già archiviato su una commessa con numero, data e fornitore, la commessa viene proposta da sola. Se l'XML non ce l'hai va bene anche un PDF: da quello i dati vengono interpretati, quindi vanno controllati con più attenzione. In ogni caso niente entra nei costi finché non confermi tu."
          azione={inLettura
            ? <Bottone disabled><Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> Lettura…</Bottone>
            : <Bottone onClick={() => refFile.current.click()}><Upload size={14} strokeWidth={1.75} /> Carica fattura (XML o PDF)</Bottone>} />
      </div>
    );
  }

  /* --- PDF che è una scansione: non si interpreta niente --- */
  if (lettura.scansione) {
    return (
      <div className="space-y-6">
        <div>
          <Micro>Importazione fattura</Micro>
          <h1 className="t-titolo mt-2">{lettura.fattura.nomeFile}</h1>
        </div>
        <section className="p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
          <div className="w-10 h-10 rounded-[var(--r-sm)] flex items-center justify-center mb-4" style={{ background: "var(--velo-accento)" }}>
            <AlertTriangle size={18} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
          </div>
          <h2 className="t-sezione mb-3">Questo PDF è una scansione</h2>
          <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--muted)" }}>{lettura.avvisi[0]}</p>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--muted)" }}>
            Non provo a indovinare cosa c'è scritto: su un documento di spesa un numero sbagliato è peggio di un numero mancante.
            Il file però è stato <strong style={{ color: "var(--txt)" }}>archiviato</strong>, quindi resta a disposizione.
          </p>
          <div className="flex flex-wrap gap-2">
            <Bottone onClick={vaiCommesse}><Plus size={14} strokeWidth={1.75} /> Inserisci i materiali a mano</Bottone>
            <Bottone variante="fantasma" onClick={() => { setLettura(null); setRighe([]); }}>
              <Upload size={14} strokeWidth={1.75} /> Carica un altro file
            </Bottone>
          </div>
        </section>
      </div>
    );
  }

  /* --- fattura letta: assegnazione e conferma --- */
  const doc = lettura.documenti[0] || {};
  const daPDF = lettura.origine !== "xml"; // PDF o Document AI: in entrambi i casi si interpreta una stampa
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Micro>Importazione fattura</Micro>
            {/* Da dove arrivano i numeri: un XML è un dato esatto, un PDF è
                una stampa interpretata. Chi controlla deve saperlo. */}
            <Pillola tono={daPDF ? "accento" : "euro"}>
              {etichettaOrigine[lettura.origine] || etichettaOrigine.pdf}
            </Pillola>
          </div>
          <h1 className="t-titolo mt-2">{lettura.fornitore.denominazione || "Fornitore non letto"}</h1>
          <p className="f-mono t-piccolo mt-1.5" style={{ color: "var(--muted)" }}>
            {lettura.fornitore.partitaIVA && `P.IVA ${lettura.fornitore.partitaIVA} · `}
            Fattura {doc.numero || "—"} del {doc.data ? fmtData(doc.data) : "—"}
            {doc.totale != null && ` · totale documento ${euro(doc.totale)}`}
          </p>
        </div>
        <Bottone variante="fantasma" onClick={() => { setLettura(null); setRighe([]); }}>
          <X size={14} strokeWidth={1.75} /> Annulla
        </Bottone>
      </div>

      {lettura.avvisi.length > 0 && (
        <div className="rounded-[var(--r-sm)] px-4 py-3 space-y-1" style={{ background: "var(--velo-accento)", border: ".5px solid var(--accento-bordo)" }} role="alert">
          {lettura.avvisi.map((a, i) => (
            <p key={i} className="text-sm flex items-start gap-2" style={{ color: "var(--accento-chiaro)" }}>
              <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" /> {a}
            </p>
          ))}
        </div>
      )}

      {commesse.length === 0 && (
        <div className="rounded-[var(--r-sm)] px-4 py-3 text-sm flex items-start gap-2" style={{ background: "var(--velo-errore)", border: ".5px solid var(--rosso-bordo)", color: "var(--errore)" }}>
          <Info size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          Non ci sono commesse a cui assegnare le righe: creane una nella sezione Dati, poi torna qui.
        </div>
      )}

      {lettura.gruppi.map((g) => {
        const stato = statiGruppo.get(g.chiave);
        if (!stato) return null;
        const { righeGruppo, commessaGruppo, abbinamento } = stato;
        const totaleGruppo = righeGruppo.reduce((s, r) => s + (totaleRiga(r) ?? 0), 0);
        const stile = STILI_STATO[stato.tipo];

        return (
          <section key={g.chiave} className="overflow-hidden" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)",
            /* Il filetto sul bordo: rende leggibile a colpo d'occhio, scorrendo
               la pagina, quali gruppi sono a posto e quali chiedono qualcosa. */
            borderLeft: `3px solid ${stato.tipo === "vuoto" ? "var(--hairline)" : stile.colore}` }}>
            <div className="px-7 py-5 flex flex-wrap items-end justify-between gap-5" style={{ borderBottom: ".5px solid var(--hairline)", background: "var(--tela-alt)" }}>
              <div>
                <Micro>{g.ddtNumero ? "Documento di trasporto" : "Righe senza DDT"}</Micro>
                <p className="t-sotto mt-1.5">
                  {g.ddtNumero ? `DDT ${g.ddtNumero}` : "Nessun riferimento a un DDT"}
                  {g.ddtData && <span className="text-sm font-normal" style={{ color: "var(--muted)" }}> del {fmtData(g.ddtData)}</span>}
                </p>
                <p className="f-mono t-piccolo mt-1" style={{ color: "var(--muted)" }}>
                  {righeGruppo.length} {righeGruppo.length === 1 ? "riga" : "righe"} · {euro(totaleGruppo)}
                </p>

                <StatoAbbinamento stato={stato} commessa={comById.get(commessaGruppo)} />

                {/* Quale documento in archivio ha fatto scattare la proposta:
                    serve a poter andare a controllare la carta, se si vuole. */}
                {abbinamento?.allegato?.nomeFile && (
                  <p className="t-piccolo mt-1.5 flex items-start gap-1.5" style={{ color: "var(--muted)" }}>
                    <Link2 size={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    dal documento archiviato "{abbinamento.allegato.nomeFile}"
                    {abbinamento.allegato.fornitore && ` · ${abbinamento.allegato.fornitore}`}
                    {abbinamento.allegato.ddtData && ` · ${fmtData(abbinamento.allegato.ddtData)}`}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Campo etichetta="Data dei materiali">
                  <input type="date" value={righeGruppo[0]?.data || ""} onChange={(e) => cambiaDataGruppo(g.chiave, e.target.value)}
                    className={inputCls + " f-mono"} style={{ width: 150, background: "var(--card)" }} />
                </Campo>
                <Campo etichetta={stato.tipo === "auto" ? "Commessa proposta (modificabile)" : "Assegna tutto il gruppo a"}>
                  {/* È il menù di sempre, nella stessa posizione di sempre.
                      Sull'abbinamento automatico arriva già valorizzato: da qui
                      si cambia, ed è questo che tiene la proposta una proposta. */}
                  <select value={commessaGruppo} onChange={(e) => assegnaGruppo(g.chiave, e.target.value)}
                    className={inputCls} style={{ width: 230, background: "var(--card)",
                      ...(stato.tipo === "auto" ? { borderColor: "var(--verde-bordo-forte)" } : {}) }}>
                    <option value={NON_IMPORTARE}>— non importare —</option>
                    {commesse.map((c) => <option key={c.id} value={c.id}>{c.codice} — {c.descrizione}</option>)}
                  </select>
                </Campo>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="tabella text-sm">
                <thead>
                  <tr className="text-left">
                    {["Descrizione", "Quantità", "Prezzo unitario", "Totale", "Commessa"].map((h) => (
                      <th key={h} className={h === "Descrizione" || h === "Commessa" ? "" : "text-right"}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {righeGruppo.map((r) => {
                    const tot = totaleRiga(r);
                    const daControllare = r.daControllare.length > 0;
                    return (
                      <tr key={r.id} style={{ borderTop: ".5px solid var(--hairline)", background: daControllare ? "var(--velo-accento)" : "transparent" }}>
                        <td  style={{ minWidth: 280 }}>
                          <input value={r.descrizione} onChange={(e) => modificaRiga(r.id, { descrizione: e.target.value })}
                            className={inputCls + " py-1.5"} style={{ background: "var(--tela-alt)" }} aria-label="Descrizione della riga" />
                          {daControllare && (
                            <p className="t-piccolo mt-1 flex items-center gap-1" style={{ color: "var(--accento-chiaro)" }}>
                              <AlertTriangle size={11} strokeWidth={1.75} /> da controllare: {r.daControllare.join(", ")}
                            </p>
                          )}
                          {r.unitaMisura && <span className="t-piccolo f-mono" style={{ color: "var(--muted)" }}>unità: {r.unitaMisura}</span>}
                        </td>
                        <td className="text-right">
                          <input value={r.quantita} onChange={(e) => modificaRiga(r.id, { quantita: e.target.value })}
                            className={inputCls + " f-mono text-right py-1.5"} style={{ width: 90, background: "var(--tela-alt)" }} aria-label="Quantità" />
                        </td>
                        <td className="text-right">
                          <input value={r.prezzoUnitario} onChange={(e) => modificaRiga(r.id, { prezzoUnitario: e.target.value })}
                            className={inputCls + " f-mono text-right py-1.5"} style={{ width: 110, background: "var(--tela-alt)" }} aria-label="Prezzo unitario" />
                        </td>
                        <td className="f-mono text-right whitespace-nowrap" style={{ color: tot == null ? "var(--errore)" : "var(--euro)" }}>
                          {tot == null ? "da controllare" : euro(tot)}
                        </td>
                        <td >
                          {/* Anche la singola riga si cambia: e da quel momento
                              l'assegnazione è dell'utente, non del software. */}
                          <select value={r.commessaId} onChange={(e) => modificaRiga(r.id, { commessaId: e.target.value, assegnazione: "manuale" })}
                            className={inputCls + " py-1.5"} style={{ width: 200, background: "var(--tela-alt)" }} aria-label={"Commessa per " + r.descrizione}>
                            <option value={NON_IMPORTARE}>— non importare —</option>
                            {commesse.map((c) => <option key={c.id} value={c.id}>{c.codice}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {/* riepilogo e conferma */}
      <section className="p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
        <h2 className="t-sotto mb-5">Riepilogo prima di importare</h2>
        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          {[
            { e: "Righe da importare", v: `${daImportare.length} di ${righe.length}` },
            { e: "Totale materiali", v: euro(totaleDaImportare), c: "var(--euro)" },
            { e: "Righe escluse", v: String(righe.length - daImportare.length), c: righe.length - daImportare.length > 0 ? "var(--accento-chiaro)" : "var(--muted)" },
          ].map((k) => (
            <div key={k.e} className="rounded-[var(--r-sm)] px-4 py-3" style={{ boxShadow: "var(--ombra-sm)" }}>
              <Micro>{k.e}</Micro>
              <p className="f-mono text-[17px] mt-1.5" style={{ color: k.c || "var(--txt)" }}>{k.v}</p>
            </div>
          ))}
        </div>

        {/* Come stanno i GRUPPI. È il conto che dice quanto lavoro resta e —
            soprattutto — quanto di questa importazione l'ha proposto il
            software e va guardato. */}
        {statiGruppo.size > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {[
              { tipo: "auto", n: conteggioGruppi.auto, testo: conteggioGruppi.auto === 1 ? "gruppo abbinato in automatico" : "gruppi abbinati in automatico" },
              { tipo: "possibile", n: conteggioGruppi.possibile, testo: "da confermare" },
              { tipo: "manuale", n: conteggioGruppi.manuale, testo: conteggioGruppi.manuale === 1 ? "assegnato da te" : "assegnati da te" },
              { tipo: "vuoto", n: conteggioGruppi.vuoto + conteggioGruppi.misto, testo: "ancora da assegnare" },
            ].filter((v) => v.n > 0).map((v) => {
              const s = STILI_STATO[v.tipo];
              const Icona = s.icona;
              return (
                <div key={v.tipo} className="rounded-[var(--r-sm)] px-3 py-2 flex items-center gap-2 t-piccolo"
                  style={{ background: s.velo, border: `.5px solid ${s.bordo}`, color: s.colore }}>
                  <Icona size={13} strokeWidth={1.75} />
                  <span className="f-mono font-medium">{v.n}</span> {v.testo}
                </div>
              );
            })}
          </div>
        )}

        {/* Gli abbinamenti che il software ha fatto da solo, uno per uno. Se
            qualcosa è finito sulla commessa sbagliata, si vede qui prima di
            premere Conferma — che è l'unico momento in cui i costi entrano. */}
        {gruppiAutomatici.length > 0 && (
          <div className="rounded-[var(--r-sm)] px-4 py-3.5 mb-5" style={{ background: "var(--verde-bg)", border: ".5px solid var(--verde-bordo)" }}>
            <p className="t-piccolo font-semibold mb-2" style={{ color: "var(--euro)" }}>
              Abbinati in automatico, da controllare:
            </p>
            <div className="space-y-1">
              {gruppiAutomatici.map((v) => (
                <p key={v.chiave} className="text-sm flex items-start gap-2">
                  <Check size={13} strokeWidth={1.75} className="mt-1 shrink-0" style={{ color: "var(--euro)" }} />
                  <span>
                    <span className="f-mono">DDT {v.ddtNumero}</span> ({v.righe} {v.righe === 1 ? "riga" : "righe"}) →{" "}
                    <span className="f-mono font-medium">{v.commessa?.codice ?? "?"}</span>{" "}
                    <span style={{ color: "var(--muted)" }}>{v.commessa?.descrizione}</span>
                  </span>
                </p>
              ))}
            </div>
            <p className="t-piccolo mt-2.5" style={{ color: "var(--muted)" }}>
              Sono proposte: finché non premi "Conferma e importa" nessun costo è entrato in nessuna commessa. Per cambiarne una, usa il menù nella testata del suo gruppo.
            </p>
          </div>
        )}

        {perCommessa.length > 0 ? (
          <div className="space-y-2 mb-5">
            {perCommessa.map((p) => (
              <div key={p.commessa?.id} className="flex items-baseline justify-between gap-3 text-sm">
                <p><span className="f-mono font-medium">{p.commessa?.codice ?? "?"}</span> <span style={{ color: "var(--muted)" }}>{p.commessa?.descrizione}</span></p>
                <p className="f-mono shrink-0" style={{ color: "var(--euro)" }}>{p.righe} {p.righe === 1 ? "riga" : "righe"} · {euro(p.totale)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>Nessuna riga assegnata: usa i menù "Assegna tutto il gruppo a" oppure quelli sulle singole righe.</p>
        )}

        {righe.length - daImportare.length > 0 && (
          <p className="t-piccolo mb-5 flex items-start gap-1.5" style={{ color: "var(--muted)" }}>
            <Info size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            Le righe lasciate su "non importare" restano fuori dai costi. Il file della fattura resta comunque archiviato e puoi importarle più avanti.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Bottone variante="fantasma" onClick={vaiCommesse}>Vai alle commesse</Bottone>
          <Bottone variante="accento" onClick={confermaImporta} disabled={inImportazione || daImportare.length === 0}>
            {inImportazione ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <CheckCircle size={14} strokeWidth={1.75} />}
            {inImportazione ? "Importazione…" : `Conferma e importa ${daImportare.length ? `(${daImportare.length})` : ""}`}
          </Bottone>
        </div>
      </section>
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
          <h1 className="t-titolo mt-2">Dipendenti</h1>
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
              <div key={dip.id} className="p-7" style={{ background: "var(--card)", borderRadius: "var(--r-md)", boxShadow: "var(--ombra-sm)" }}>
                <div className="flex items-center gap-3.5 mb-5">
                  <div className="w-10 h-10 rounded-[var(--r-sm)] flex items-center justify-center f-mono t-piccolo shrink-0" style={{ background: "var(--velo)", color: "var(--txt)" }}>{iniziali}</div>
                  <div className="min-w-0">
                    <p className="t-sotto truncate">{dip.nome} {dip.cognome}</p>
                    <p className="t-piccolo f-mono mt-1.5" style={{ color: "var(--muted)" }}>Ore nell'intervallo: {fmtOre.format(oreIntervallo.get(dip.id) || 0)} h</p>
                  </div>
                  <div className="ml-auto flex gap-1 shrink-0">
                    <button onClick={() => setEditor({ dip })} aria-label="Modifica dipendente" className="p-2 rounded-[var(--r-sm)] btn" style={{ boxShadow: "var(--ombra-sm)" }}><Pencil size={13} strokeWidth={1.75} /></button>
                    <button onClick={() => elimina(dip)} aria-label="Elimina dipendente" className="p-2 rounded-[var(--r-sm)] btn" style={{ border: ".5px solid var(--rosso-bordo)", color: "var(--errore)" }}><Trash2 size={13} strokeWidth={1.75} /></button>
                  </div>
                </div>
                {elenco.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>Nessun mese impostato: modifica il dipendente per aggiungere il lordo mensile.</p>
                ) : (
                  <table className="tabella text-sm">
                    <thead>
                      <tr className="text-left">
                        {["Mese", "Lordo", "Ore mese", "Tariffa"].map((h, i) => (
                          <th key={h} className={`py-2 t-micro ${i > 0 ? "text-right" : ""}`} style={{ letterSpacing: ".1em", color: "var(--muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="f-mono">
                      {elenco.map((m) => {
                        const ore = riep ? (riep.oreMensili.get(dip.id + "|" + m) || 0) : 0;
                        const lordo = dip.lordoMensile?.[m];
                        const tar = lordo != null && ore > 0 ? lordo / ore : null;
                        return (
                          <tr key={m} style={{ borderTop: ".5px solid var(--hairline)" }}>
                            <td className="py-3">{fmtMese(m)}</td>
                            <td className="py-3 text-right">{lordo != null ? euro(lordo) : <span className="font-sans" style={{ color: "var(--errore)" }}>manca</span>}</td>
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
        <span className="t-micro" style={{ letterSpacing: ".1em", color: "var(--muted)" }}>Lordo mensile (per mese)</span>
        <Bottone variante="fantasma" onClick={() => setLordi((l) => [...l, { mese: oggiISO().slice(0, 7), importo: "" }])} className="py-1 px-2.5 t-piccolo"><Plus size={12} strokeWidth={1.75} /> Aggiungi mese</Bottone>
      </div>
      {errori.lordi && <p className="t-piccolo mb-2" style={{ color: "var(--errore)" }}>{errori.lordi}</p>}
      <div className="space-y-2 mb-7">
        {lordi.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>Nessun mese: aggiungine uno per poter calcolare le tariffe.</p>}
        {lordi.map((riga, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input type="month" value={riga.mese} onChange={(e) => setLordi((l) => l.map((x, j) => (j === i ? { ...x, mese: e.target.value } : x)))} className={inputCls + " f-mono"} style={{ width: 170 }} aria-label="Mese" />
            <input value={riga.importo} onChange={(e) => setLordi((l) => l.map((x, j) => (j === i ? { ...x, importo: e.target.value } : x)))} placeholder="es. 2.500,00" className={inputCls + " f-mono text-right"} aria-label="Lordo del mese in euro" />
            <button onClick={() => setLordi((l) => l.filter((_, j) => j !== i))} aria-label="Rimuovi mese" className="p-2 rounded-[var(--r-sm)] shrink-0 btn" style={{ boxShadow: "var(--ombra-sm)" }}><X size={13} strokeWidth={1.75} /></button>
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
        <h1 className="t-titolo mt-2">Dati</h1>
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
            <p className="t-piccolo mt-4" style={{ color: "var(--muted)" }}>Dopo ogni registrazione il modulo resta impostato: cambia solo le ore e premi Invio per inserire una giornata dopo l'altra.</p>
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
              <span key={c.id} className="inline-flex items-center gap-1.5 t-piccolo rounded-[var(--r-sm)] pl-2.5 pr-1 py-1" style={{ border: ".5px solid var(--hairline)", background: "var(--tela-alt)" }} title={c.descrizione}>
                <span className="f-mono font-medium">{c.codice}</span>
                <button onClick={() => setRinomina(c)} aria-label={"Rinomina commessa " + c.codice} title="Rinomina" className="p-0.5 rounded btn" style={{ color: "var(--muted)" }}><Pencil size={10} strokeWidth={1.75} /></button>
                <button onClick={() => eliminaCommessa(c)} aria-label={"Elimina commessa " + c.codice} className="p-0.5 rounded btn" style={{ color: "var(--muted)" }}><X size={11} strokeWidth={1.75} /></button>
              </span>
            ))}
          </div>
        )}
      </Sezione>

      <Sezione titolo={<>Registrazioni <span className="f-mono t-piccolo" style={{ color: "var(--muted)" }}>({registrazioni.length})</span></>}
        extra={
          <div className="relative">
            <Search size={13} strokeWidth={1.75} className="absolute left-3 top-2.5" style={{ color: "var(--muted)" }} />
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Cerca…" className={inputCls + " pl-8 py-1.5"} style={{ width: 200, background: "var(--tela-alt)" }} aria-label="Filtra registrazioni" />
          </div>
        }>
        {registrazioni.length === 0 ? (
          <p className="text-sm py-2" style={{ color: "var(--muted)" }}>Le ore che registri compariranno qui, ordinate dalla più recente.</p>
        ) : (
          <div className="overflow-x-auto -mx-6 -mb-6">
            <table className="tabella text-sm">
              <thead>
                <tr className="text-left">
                  {["Data", "Dipendente", "Commessa", "Ore", ""].map((h, i) => (
                    <th key={i} className={`px-6 py-2.5 t-micro ${h === "Ore" ? "text-right" : ""}`} style={{ letterSpacing: ".1em", color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {elenco.map((r) => {
                  const d = dipById.get(r.dipendenteId), c = comById.get(r.commessaId);
                  return (
                    <tr key={r.id} className="riga" style={{ borderTop: ".5px solid var(--hairline)" }}>
                      <td className="px-6 py-3 f-mono">{fmtData(r.data)}</td>
                      <td className="px-6 py-3">{d ? d.nome + " " + d.cognome : "—"}</td>
                      <td className="px-6 py-3 f-mono">{c ? c.codice : "—"}</td>
                      <td className="px-6 py-3 f-mono text-right">{fmtOre.format(r.ore)}</td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setModifica(r)} aria-label="Modifica registrazione" className="p-1.5 rounded-[var(--r-sm)] mr-1 btn" style={{ boxShadow: "var(--ombra-sm)" }}><Pencil size={12} strokeWidth={1.75} /></button>
                        <button onClick={() => { eliminaReg(r.id); notifica("Registrazione eliminata."); }} aria-label="Elimina registrazione" className="p-1.5 rounded-[var(--r-sm)] btn" style={{ border: ".5px solid var(--rosso-bordo)", color: "var(--errore)" }}><Trash2 size={12} strokeWidth={1.75} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {registrazioni.length > 300 && elenco.length === 300 && <p className="t-piccolo px-6 py-3" style={{ color: "var(--muted)" }}>Mostrate le prime 300 righe: usa la ricerca per trovarne altre.</p>}
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
        <p className="t-piccolo mt-5 flex items-start gap-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>
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
      <p className="t-piccolo flex items-start gap-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>
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
              <td style={{ padding: "5px 8px", fontVariantNumeric: "tabular-nums" }}>{r.commessa.codice}</td>
              <td style={{ padding: "5px 8px" }}>{r.commessa.descrizione}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtOre.format(r.ore)}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum.format(r.costoManodopera)}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum.format(r.costoMateriali)}</td>
              <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum.format(r.costoTotale)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1.5px solid #171B22", fontWeight: 700 }}>
            <td style={{ padding: "7px 8px" }} colSpan={2}>TOTALE</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtOre.format(riep.totOre)}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum.format(costi?.totManodopera ?? riep.totCosto)}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum.format(costi?.totMateriali ?? 0)}</td>
            <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtNum.format(costi?.totTotale ?? riep.totCosto)}</td>
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
/* ---------------------------------------------------------------------------
   DESIGN SYSTEM — definito qui, in un punto solo, e usato da tutto il resto.

   Le tre regole che tengono insieme l'insieme:

   1. UNA FAMIGLIA DI CARATTERI. Inter, nella versione variabile: un file solo
      per tutti i pesi da 400 a 600. Prima erano tre famiglie (Instrument Sans,
      IBM Plex Mono, Inter) per sette file: più roba da scaricare e tre voci
      diverse nella stessa frase. I numeri non hanno bisogno di un carattere
      monospaziato per incolonnarsi: basta font-variant-numeric:tabular-nums,
      che Inter fa benissimo. Una voce sola, e i numeri restano allineati.

   2. LINEE, NON OMBRE. Le variabili --ombra-* non disegnano più ombre diffuse
      ma ANELLI di un pixel (box-shadow senza sfocatura). Le card quindi non
      galleggiano più: sono appoggiate, delimitate da un filo grigio chiarissimo.
      L'ombra vera resta solo dove serve davvero un'elevazione — modali e
      pannelli che si aprono sopra il resto — e sull'hover, appena percettibile.
      Passando dalle variabili, tutte le superfici dell'applicazione cambiano
      insieme senza toccarne una per una.

   3. IL NUMERO È IL PROTAGONISTA. Il colore forte è riservato agli importi
      (verde) e agli errori (rosso). Il bronzo è l'accento e si usa con
      parsimonia: azione primaria, voce attiva, poco altro. Tutto il resto è
      inchiostro, grigio caldo e spazio bianco.
--------------------------------------------------------------------------- */
function StileGlobale() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400..600&display=swap');
      :root{
        /* ============ TEMA SCURO — la tavolozza approvata ============
           Sei livelli di fondo, dal più profondo al più rialzato. In un tema
           scuro la profondità non si fa con le ombre (che su nero non si
           vedono) ma con la LUMINOSITÀ del fondo e un filo di bordo. */
        --bg-app:#08080A;         /* l'area dei contenuti */
        --bg-sidebar:#0A0A0D;     /* la barra laterale */
        --bg-card:#0D0D10;        /* card, riquadri, tabelle */
        --bg-elevato:#131317;     /* box icone, campi, elementi rialzati */
        --bg-hover:#16161A;       /* voce attiva, passaggio del mouse */
        --bg-pill:#18181C;        /* badge grigi, contatori */

        /* --- bordi: sottilissimi. Sono loro a disegnare la struttura --- */
        --bordo:#1A1A1F;          /* bordo card e divisori principali */
        --bordo-tenue:#131316;    /* divisori dentro le liste */
        --bordo-input:#1F1F24;    /* bordo campi e box */

        /* --- testo: sette gradini, dal numero-eroe alla nota appena
               accennata. Sono molti, ma in un tema scuro servono: la
               gerarchia si legge quasi solo dal grigio. --- */
        --txt:#FAFAFA;            /* numeri e titoli principali */
        --txt-chiaro:#F4F4F5;     /* testo forte */
        --txt-medio:#E4E4E7;      /* testo normale nelle righe */
        --txt-attenuato:#A1A1AA;  /* testo secondario */
        --txt-tenue:#71717A;      /* etichette, didascalie */
        --txt-debole:#52525B;     /* segnaposto, decimali, note */
        --txt-fioco:#4A4A50;      /* numerazione, elementi minimi */

        /* --- accento bronzo spento: logo, voce attiva, link, badge. E basta.
               Se comincia a comparire su ogni riga non è più un accento. --- */
        --accento:#8A6D4B; --accento-chiaro:#A88B66;
        --accento-testo:#F0E7DA; --accento-bg:#211B12; --accento-bordo:#3A2E1E;

        /* --- significato, mai decorazione --- */
        --verde:#4ADE80; --verde-bg:#0D2318; --verde-bordo:#16432A;
        /* Un verde di bordo più marcato: serve solo dove il verde è un
           SEGNALE da notare (la commessa proposta in automatico), non una
           cornice qualsiasi. */
        --verde-bordo-forte:#215C3B;
        --rosso:#F09595; --rosso-bg:#2A1315; --rosso-bordo:#4A2226;

        /* --- raggi: card 14, box e campi 8, pillole 6 --- */
        --r-xs:6px; --r-sm:8px; --r-md:14px; --r-lg:16px;

        /* --- moto: un tempo solo per tutta l'applicazione --- */
        --moto:170ms cubic-bezier(.2,.7,.3,1);

        /* ============ PONTE COL NOME PRECEDENTE ============
           Il resto dell'applicazione parla ancora con i nomi del tema chiaro
           (--card, --txt, --muted, --hairline, --ombra-*…). Invece di
           riscrivere settecento punti a mano — e sbagliarne qualcuno — quei
           nomi vengono ridefiniti QUI sopra la tavolozza nuova. È il motivo
           per cui esistevano: cambiare tema in un punto solo.

           Le --ombra-* diventano anelli di bordo. In un tema scuro l'ombra
           non ha nulla da scurire: la struttura la disegna il filo. */
        --tela:var(--bg-app); --card:var(--bg-card); --tela-alt:var(--bg-elevato);
        --ink:var(--bg-pill);
        --muted:var(--txt-attenuato); --tenue:var(--txt-tenue);
        --hairline:var(--bordo); --hairline-forte:var(--bordo-input);
        --velo:rgba(255,255,255,.028);
        --accent:var(--accento); --accent-chiaro:var(--accento-chiaro);
        --velo-accento:var(--accento-bg);
        --euro:var(--verde); --velo-euro:var(--verde-bg);
        --errore:var(--rosso); --velo-errore:var(--rosso-bg);
        --scuro:var(--bg-sidebar); --scuro-txt:var(--txt-chiaro);
        --scuro-muted:var(--txt-attenuato);
        --scuro-velo:var(--bg-hover); --scuro-linea:var(--bordo);
        --ombra-xs:0 0 0 .5px var(--bordo-tenue);
        --ombra-sm:0 0 0 .5px var(--bordo);
        --ombra-md:0 0 0 .5px var(--bordo-input);
        --ombra-lg:0 0 0 .5px var(--bordo-input), 0 24px 64px -12px rgba(0,0,0,.7);
        --ombra-hover:0 0 0 .5px #26262C;
      }
      html{ background:var(--bg-app); }
      body{
        font-family:'Inter',-apple-system,system-ui,sans-serif;
        font-size:13px; line-height:1.55; color:var(--txt-medio);
        background:var(--bg-app);
        -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
        font-feature-settings:'cv05' 1,'cv11' 1;   /* l/1 più distinguibili */
      }
      /* Su fondo scuro i selettori nativi di data e i menù a tendina vanno
         detti al browser, altrimenti disegna i suoi in tema chiaro. */
      :root{ color-scheme:dark; }
      ::selection{ background:rgba(138,109,75,.32); color:var(--txt); }

      /* --- SCALA TIPOGRAFICA: densa, come si aspetta un tema scuro -------- */
      .t-eroe{ font-size:45px; line-height:1.02; font-weight:600; letter-spacing:-.045em; color:var(--txt); }
      .t-titolo{ font-size:21px; line-height:1.25; font-weight:600; letter-spacing:-.02em; color:var(--txt); }
      .t-sezione{ font-size:17px; line-height:1.3; font-weight:600; letter-spacing:-.015em; color:var(--txt-chiaro); }
      .t-sotto{ font-size:13.5px; line-height:1.4; font-weight:500; letter-spacing:-.005em; color:var(--txt-chiaro); }
      .t-corpo{ font-size:13px; line-height:1.6; }
      .t-piccolo{ font-size:12px; line-height:1.5; }
      .t-micro{ font-size:11px; font-weight:500; letter-spacing:.06em; text-transform:uppercase; color:var(--txt-fioco); }
      .t-leggibile{ max-width:66ch; }
      @media (max-width:640px){ .t-eroe{ font-size:34px; } .t-titolo{ font-size:19px; } }

      .f-display{ font-weight:600; letter-spacing:-.018em; }
      /* Cifre a larghezza fissa: si incolonnano come in una tabella. */
      .f-mono{ font-variant-numeric:tabular-nums; font-feature-settings:'tnum' 1; letter-spacing:-.004em; }
      .cifra-grande{ font-variant-numeric:tabular-nums; font-weight:600; letter-spacing:-.032em; color:var(--txt); }

      .superficie-scura{ background:var(--bg-sidebar); }

      /* --- CAMPI: fondo rialzato, bordo appena visibile --- */
      .campo{
        background:var(--bg-elevato); border:.5px solid var(--bordo-input);
        border-radius:var(--r-sm); color:var(--txt-chiaro);
        transition:border-color var(--moto), background var(--moto);
      }
      /* Un campo che vive DENTRO un box già bordato (il selettore di periodo):
         un bordo dentro un bordo fa rumore, quindi qui non ce n'è. */
      .campo-nudo{
        background:transparent; border:none; border-radius:var(--r-xs);
        color:var(--txt-chiaro); transition:background var(--moto);
      }
      .campo-nudo:hover{ background:var(--bg-hover); }
      .campo-nudo:focus{ background:var(--bg-hover); outline:none; }
      .campo:hover{ border-color:#26262C; }
      .campo:focus{ border-color:var(--accento); background:var(--bg-hover); outline:none; }
      .campo::placeholder{ color:var(--txt-debole); }

      /* --- BOTTONI: nessun cambio di dimensione al passaggio del mouse ----- */
      .btn{ transition:background var(--moto), color var(--moto), border-color var(--moto), opacity var(--moto); }
      .btn:focus-visible{ box-shadow:0 0 0 2px var(--bg-app), 0 0 0 4px var(--accento); outline:none; }
      .btn:active{ opacity:.85; }
      .btn:disabled{ opacity:.4; cursor:not-allowed; }

      /* --- CARD: in un tema scuro la profondità è il fondo più chiaro
             più un filo di bordo. Le ombre non hanno niente da scurire. --- */
      .card{ background:var(--bg-card); border:.5px solid var(--bordo); border-radius:var(--r-md); }
      .card-viva{ transition:border-color var(--moto); }
      .card-viva:hover{ border-color:var(--bordo-input); }

      /* --- BOX: il contenitore rialzato di icone, campi, contatori --- */
      .box{ background:var(--bg-elevato); border:.5px solid var(--bordo-input); border-radius:var(--r-sm); }

      /* --- VOCI DELLA BARRA LATERALE: la voce attiva ha già il suo fondo,
             quindi l'effetto del mouse serve solo alle inattive. --- */
      .voce-nav:hover{ background:var(--bg-hover); color:var(--txt-chiaro); }

      /* --- TABELLE: dense, divisori tenui, nessuna zebra --- */
      .tabella{ width:100%; border-collapse:collapse; }
      .tabella th{
        font-size:11px; font-weight:500; letter-spacing:.06em; text-transform:uppercase;
        color:var(--txt-fioco); text-align:left; padding:10px 16px; white-space:nowrap;
        border-bottom:.5px solid var(--bordo);
      }
      .tabella td{ padding:13px 16px; border-top:.5px solid var(--bordo-tenue); color:var(--txt-medio); }
      .tabella tbody tr:first-child td{ border-top:none; }
      .riga{ transition:background var(--moto); }
      .riga:hover{ background:var(--bg-hover); }
      tr.riga:focus-visible{ outline:1px solid var(--accento); outline-offset:-1px; }

      /* --- PILLOLE E BADGE --- */
      .pill{
        display:inline-flex; align-items:center; gap:6px;
        font-size:11px; font-weight:500; letter-spacing:.05em; text-transform:uppercase;
        padding:4px 8px; border-radius:var(--r-xs); white-space:nowrap;
      }
      /* Il codice di una commessa: bronzo pieno per il primo, grigio per gli
         altri. È il modo di dire "questo conta più degli altri" senza scriverlo. */
      .badge-codice{
        display:inline-flex; align-items:center; justify-content:center;
        font-size:11.5px; font-weight:500; font-variant-numeric:tabular-nums;
        padding:3px 8px; border-radius:var(--r-xs); white-space:nowrap;
        background:var(--bg-pill); color:var(--txt-attenuato);
      }
      .badge-codice-primo{ background:var(--accento); color:var(--accento-testo); }

      /* --- BARRE DI SCORRIMENTO: presenti ma discrete --- */
      *{ scrollbar-width:thin; scrollbar-color:#26262C transparent; }
      *::-webkit-scrollbar{ width:10px; height:10px; }
      *::-webkit-scrollbar-track{ background:transparent; }
      *::-webkit-scrollbar-thumb{ background:#26262C; border:3px solid transparent; background-clip:content-box; border-radius:99px; }
      *::-webkit-scrollbar-thumb:hover{ background:#34343C; background-clip:content-box; }
      /* --- MOTO: sobrio. Nessun rimbalzo, nessun lampeggio: solo un accenno
             di movimento che accompagna, e sempre in uscita (ease-out). --- */
      @keyframes pop{ from{opacity:0; transform:translateY(6px) scale(.99);} to{opacity:1; transform:none;} }
      .anim-pop{ animation:pop .2s cubic-bezier(.2,.7,.3,1); }
      @keyframes velo{ from{opacity:0;} }
      .anim-velo{ animation:velo .18s ease-out; }
      @keyframes slide{ from{transform:translateX(28px); opacity:0;} to{transform:none; opacity:1;} }
      .anim-slide{ animation:slide .26s cubic-bezier(.2,.7,.3,1); }
      @keyframes vista{ from{opacity:0; transform:translateY(3px);} to{opacity:1; transform:none;} }
      .anim-vista{ animation:vista .22s cubic-bezier(.2,.7,.3,1); }
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
