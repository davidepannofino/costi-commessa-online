/**
 * QUANDO LA TARIFFA ORARIA NON STA IN PIEDI.
 *
 * La tariffa di una persona in un mese è `lordo del mese / ore di quel mese`, e
 * il costo di una commessa è `tariffa × ore`. Ne segue una cosa che non si
 * vede: **il costo totale è sempre il lordo intero**, comunque poche siano le
 * ore inserite. Tutto lo stipendio del mese finisce addosso alle ore che ci
 * sono.
 *
 * Con un lordo di 2.400 € e un solo giorno da 8 ore registrato, il cantiere
 * risulta costato 2.400 € e la tariffa 300 €/h. Non è un numero impreciso: è
 * sbagliato di venti volte, e sembra giusto. È il primo giorno di chi si
 * iscrive, ma è anche OGNI MESE IN CORSO di chiunque: finché agosto non è
 * finito, i costi di agosto sono più alti del vero.
 *
 * E l'invariante non se ne accorge. «Quadra» verifica che la somma dei costi
 * coincida con la somma dei lordi: torna sempre, per costruzione. Un timbro che
 * non può mai diventare rosso non è informazione — verde vuol dire «il conto è
 * coerente con sé stesso», ma chi lo legge ci sente «i numeri sono giusti», ed
 * è falso proprio nel caso peggiore. Per questo qui si guarda la TARIFFA, che è
 * l'unico posto dove la cosa si vede.
 *
 * COSA SI OSSERVA E COSA NO. Questo modulo non conclude che un mese è
 * incompleto: non lo sa. Sa che una tariffa è fuori scala, e riporta i numeri
 * che l'hanno fatta scattare. La conclusione — «non ho ancora finito di
 * inserire agosto», oppure «ho sbagliato il lordo» — la trae chi guarda, che è
 * l'unico ad avere l'informazione che serve.
 */

/**
 * Il metro migliore è la persona stessa: se ad Anna luglio costa 14 €/h e
 * agosto 300 €/h, l'anomalia si misura senza inventare nessuna soglia. Si
 * segnala oltre il doppio della sua mediana, che è larga abbastanza da
 * assorbire un mese con qualche giorno di ferie.
 */
export const FATTORE_SCOSTAMENTO = 2;

/**
 * Quando quella persona non ha nessun altro mese con cui confrontarsi — ed è
 * il caso del primo giorno — serve un numero. Cinquanta euro l'ora è ben oltre
 * qualunque costo orario reale di manodopera edile, comprensivo di contributi:
 * non è una soglia di qualità, è un pavimento sotto cui non si sbaglia. Serve
 * a riconoscere qualcosa di strutturalmente storto, non a giudicare una paga.
 */
export const SOGLIA_ORARIA_SENZA_STORICO = 50;

const mediana = (v) => {
  if (v.length === 0) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/** Tutte le coppie (dipendente, mese) che hanno sia ore sia lordo. */
function tariffeDi(dipendenti, oreMensili) {
  const fuori = [];
  for (const dip of dipendenti ?? []) {
    for (const [chiave, ore] of oreMensili ?? []) {
      const [id, mese] = String(chiave).split("|");
      if (id !== dip.id || !(ore > 0)) continue;
      const lordo = dip.lordoMensile?.[mese];
      if (lordo == null || !(lordo > 0)) continue;
      fuori.push({ dip, mese, ore, lordo, tariffa: lordo / ore });
    }
  }
  return fuori;
}

/**
 * Le tariffe da guardare, fra quelle dei mesi indicati.
 *
 * @param dipendenti   l'anagrafica intera, archiviati compresi
 * @param oreMensili   la mappa "dipId|AAAA-MM" → ore (da calcolaRiepilogo)
 * @param mesi         i mesi toccati dal periodo che si sta guardando
 * @returns [{ dip, mese, ore, lordo, tariffa, confronto }] — vuoto se va tutto
 *          bene. `confronto` è la mediana degli altri mesi, o null se non ce
 *          n'erano: serve a chi scrive il messaggio, per dire con cosa si sta
 *          confrontando invece di affermare e basta.
 */
export function tariffeDaControllare({ dipendenti, oreMensili, mesi }) {
  const tutte = tariffeDi(dipendenti, oreMensili);
  const daGuardare = new Set(mesi ?? []);
  const sospette = [];

  for (const t of tutte) {
    if (!daGuardare.has(t.mese)) continue;
    /* Gli ALTRI mesi della stessa persona, esclusi quelli che stiamo
       guardando adesso: se il periodo copre due mesi entrambi a metà, non
       devono farsi da metro l'uno con l'altro. */
    const altre = tutte
      .filter((x) => x.dip.id === t.dip.id && !daGuardare.has(x.mese))
      .map((x) => x.tariffa);
    const rif = mediana(altre);

    const sospetta = rif == null
      ? t.tariffa > SOGLIA_ORARIA_SENZA_STORICO
      : t.tariffa > rif * FATTORE_SCOSTAMENTO;

    if (sospetta) sospette.push({ ...t, confronto: rif });
  }
  /* Dalla più fuori scala: se ce ne sono tante, la prima è quella che spiega
     meglio perché il totale non torna. */
  return sospette.sort((a, b) => b.tariffa - a.tariffa);
}

/** Vero se il periodo che si sta guardando ha almeno una tariffa fuori scala. */
export const cSonoTariffeDaControllare = (args) => tariffeDaControllare(args).length > 0;
