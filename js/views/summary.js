// Riepilogo: tutto lo storico, per periodo (mese, 3 mesi, 6 mesi, anno, tutto).
import {
  state, PERIODS, periodRange, previousRange, rangeSummary, byCategoryInRange, monthlyRows,
  liquidityBefore, liquidityAtMonthEnd, liquidityTarget, txInRange, shiftMonth, monthKey, todayISO, categoriesOf
} from '../model.js';
import { h, eur, bigMoney, pct, monthLabel, MONTHS_SHORT, sectionTitle, segmented, empty } from '../ui.js';
import { monthBars, lineChart } from '../charts.js';
import { txRow } from './movements.js';

const PERIOD_OPTIONS = [['mese', 'Mese'], ['3m', '3 mesi'], ['6m', '6 mesi'], ['anno', 'Anno'], ['tutto', 'Tutto']];

const shortMonth = (k) => `${MONTHS_SHORT[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;

function rangeLabel(type, r) {
  if (type === 'mese') return monthLabel(r.start);
  if (type === 'anno') return r.start.slice(0, 4);
  if (r.start === r.end) return monthLabel(r.start);
  const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
  return `${sameYear ? MONTHS_SHORT[Number(r.start.slice(5)) - 1] : shortMonth(r.start)} – ${shortMonth(r.end)}`;
}

/** Variazione percentuale rispetto al periodo precedente. good = 'up' se salire è positivo. */
function delta(cur, prev, good = 'up') {
  if (!prev) return null;
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return h('span', { class: 'delta' }, '= prec.');
  const up = d > 0;
  const cls = (up && good === 'up') || (!up && good === 'down') ? 'good' : 'bad';
  return h('span', { class: 'delta ' + (good === 'neutral' ? 'neutral' : cls) }, (up ? '▲ ' : '▼ ') + pct(Math.abs(d)).replace('+', ''));
}

export function renderSummary(ctx) {
  const now = monthKey(todayISO());
  ctx.summary ||= { type: '6m', anchor: now };
  const S = ctx.summary;
  const range = periodRange(S.type, S.anchor);
  const prevRange = previousRange(S.type, range);
  const cur = rangeSummary(range);
  const prev = prevRange ? rangeSummary(prevRange) : null;
  const hasPrev = prev && prev.count > 0;
  const step = S.type === 'tutto' ? 0 : PERIODS[S.type];
  const set = (patch) => { ctx.summary = { ...S, ...patch }; ctx.refresh(); };

  const root = h('div', { class: 'page summary' });
  root.append(h('header', { class: 'top' }, h('h1', { class: 'display sm' }, 'Riepilogo')));

  // --- Scelta del periodo
  root.append(segmented(PERIOD_OPTIONS, S.type, (v) => set({ type: v, anchor: now }), 'period'));
  root.append(h('div', { class: 'period-nav' },
    step ? h('button', { class: 'icon-btn', 'aria-label': 'Periodo precedente', onclick: () => set({ anchor: shiftMonth(S.anchor, -step) }) }, '‹') : h('span'),
    h('div', { class: 'period-label' },
      h('strong', {}, S.type === 'tutto' ? 'Dall’inizio' : rangeLabel(S.type, range)),
      h('small', {}, `${cur.months} ${cur.months === 1 ? 'mese' : 'mesi'} · ${cur.count} movimenti`)),
    step ? h('button', { class: 'icon-btn', 'aria-label': 'Periodo successivo', disabled: range.end >= now, onclick: () => set({ anchor: shiftMonth(S.anchor, step) }) }, '›') : h('span')
  ));

  if (state.transactions.length === 0) {
    root.append(empty('Ancora nessun movimento: il riepilogo si riempie man mano che registri entrate, spese e investimenti.'));
    return root;
  }

  // --- Totali del periodo
  root.append(h('section', { class: 'hero-card' },
    h('p', { class: 'eyebrow dark' }, 'Saldo del periodo'),
    h('div', { class: 'hero-amount' }, bigMoney(cur.net, { sign: true })),
    h('p', { class: 'hero-formula' }, 'entrate − spese − investito'),
    h('div', { class: 'hero-split' },
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Entrate'), h('strong', {}, eur(cur.income)), hasPrev ? delta(cur.income, prev.income, 'up') : null),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Spese'), h('strong', {}, eur(cur.expense)), hasPrev ? delta(cur.expense, prev.expense, 'down') : null),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Investito'), h('strong', {}, eur(cur.invested)), hasPrev ? delta(cur.invested, prev.invested, 'neutral') : null)
    ),
    hasPrev ? h('p', { class: 'hero-note' }, `Confronto con ${rangeLabel(S.type, prevRange)}`) : null
  ));

  // --- Indicatori
  root.append(h('section', { class: 'kpis' },
    kpi('Spesa media / mese', eur(cur.avgExpense)),
    kpi('Entrata media / mese', eur(cur.avgIncome)),
    kpi('Investito medio / mese', eur(cur.avgInvested), 'lav'),
    kpi('Entrate non spese', cur.savingRate === null ? '—' : pct(cur.savingRate).replace('+', ''), null, 'di cui investite ' + (cur.investRate === null ? '—' : pct(cur.investRate).replace('+', '')))
  ));

  // --- Liquidità nel periodo
  const startLiq = liquidityBefore(range);
  const endLiq = liquidityAtMonthEnd(range.end);
  const rows = monthlyRows(range);
  const target = liquidityTarget();
  root.append(sectionTitle('Liquidità'));
  root.append(h('section', { class: 'card liq-range' },
    h('div', { class: 'liq-flow' },
      h('div', {}, h('span', { class: 'eyebrow' }, 'Inizio'), h('strong', {}, eur(startLiq))),
      h('span', { class: 'arrow' }, '→'),
      h('div', {}, h('span', { class: 'eyebrow' }, range.end === now ? 'Oggi' : 'Fine'), h('strong', {}, eur(endLiq))),
      h('div', { class: 'right' }, h('span', { class: 'eyebrow' }, 'Variazione'),
        h('strong', { class: endLiq - startLiq >= 0 ? 'up' : 'down' }, (endLiq - startLiq >= 0 ? '+' : '−') + eur(Math.abs(endLiq - startLiq))))
    ),
    rows.length > 1 ? lineChart(rows.map((r) => ({ label: MONTHS_SHORT[Number(r.key.slice(5)) - 1], value: r.liquidity })), { target }) : null,
    target !== null ? h('p', { class: 'hint' }, `La linea tratteggiata è l’obiettivo (${eur(target)}).`) : null
  ));

  // --- Andamento entrate / spese / investito
  if (rows.length > 1) {
    const yearly = rows.length > 24;
    const data = yearly ? groupByYear(rows) : rows.map((r) => ({ key: r.key, income: r.income, expense: r.expense, invested: r.invested }));
    root.append(sectionTitle(yearly ? 'Andamento per anno' : 'Andamento mensile', h('div', { class: 'key' },
      h('span', {}, h('i', { class: 'lemon' }), 'Entrate'),
      h('span', {}, h('i', { class: 'white' }), 'Spese'),
      h('span', {}, h('i', { class: 'lav' }), 'Inv.'))));
    root.append(h('section', { class: 'card' }, monthBars(data)));
  }

  // --- Spese per categoria, con confronto
  const prevCats = hasPrev ? new Map(byCategoryInRange('spesa', prevRange).map((x) => [x.id, x.amount])) : null;
  const cats = byCategoryInRange('spesa', range);
  root.append(sectionTitle('Spese per categoria'));
  if (cats.length === 0) root.append(h('p', { class: 'muted pad' }, 'Nessuna spesa nel periodo.'));
  else root.append(h('section', { class: 'card cat-bars' }, cats.map((x) =>
    h('button', {
      class: 'cat-bar',
      onclick: () => { ctx.filters = { kind: 'spesa', category: x.id, query: '', allMonths: true }; ctx.go('movimenti'); }
    },
      h('div', { class: 'cat-bar-top' },
        h('span', {}, `${x.category.emoji} ${x.category.name}`),
        h('b', {}, eur(x.amount))),
      h('div', { class: 'cat-bar-track' }, h('i', { style: { width: (x.amount / cats[0].amount * 100).toFixed(1) + '%', background: x.category.color } })),
      h('div', { class: 'cat-bar-sub' },
        h('span', {}, `${Math.round((x.amount / cur.expense) * 100)}% delle spese · ${eur(Math.round(x.amount / cur.months))}/mese`),
        prevCats ? delta(x.amount, prevCats.get(x.id) || 0, 'down') : null)
    ))));

  // --- Entrate per categoria
  const inc = byCategoryInRange('entrata', range);
  if (inc.length) {
    root.append(sectionTitle('Entrate per categoria'));
    root.append(h('section', { class: 'card list' }, inc.map((x) => simpleRow(x, cur.income, 'entrata'))));
  }

  // --- Investimenti per categoria (solo se ne hai più di una)
  const inv = byCategoryInRange('investimento', range);
  if (inv.length && categoriesOf('investimento').length > 1) {
    root.append(sectionTitle('Investimenti per categoria'));
    root.append(h('section', { class: 'card list' }, inv.map((x) => simpleRow(x, cur.invested, 'investimento'))));
  }

  // --- Spese più grandi
  const biggest = txInRange(range).filter((t) => t.kind === 'spesa').sort((a, b) => b.amount - a.amount).slice(0, 5);
  if (biggest.length) {
    root.append(sectionTitle('Spese più grandi'));
    root.append(h('section', { class: 'card list' }, biggest.map((t) => txRow(ctx, t, { showDate: true }))));
  }

  // --- Storico mese per mese
  if (rows.length > 1) {
    root.append(sectionTitle('Mese per mese'));
    root.append(h('section', { class: 'card list' }, [...rows].reverse().map((r) =>
      h('button', { class: 'month-row', onclick: () => { ctx.month = r.key; ctx.go('home'); } },
        h('div', { class: 'month-row-head' },
          h('strong', {}, monthLabel(r.key)),
          h('span', { class: 'net ' + (r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : '') }, (r.net > 0 ? '+' : r.net < 0 ? '−' : '') + eur(Math.abs(r.net)))),
        h('div', { class: 'month-row-sub' },
          h('span', { class: 'entrata' }, '+' + eur(r.income)),
          h('span', {}, '−' + eur(r.expense)),
          h('span', { class: 'investimento' }, '−' + eur(r.invested)),
          h('span', { class: 'liq' }, 'Liq. ' + eur(r.liquidity)))
      ))));
    root.append(h('p', { class: 'muted pad small' }, 'Tocca un mese per aprirlo nella Home.'));
  }
  return root;
}

function kpi(label, value, cls = null, sub = null) {
  return h('div', { class: 'tile' }, h('span', { class: 'eyebrow' }, label), h('strong', { class: cls || '' }, value), sub ? h('small', { class: 'muted' }, sub) : null);
}

function simpleRow(x, total, kind) {
  return h('div', { class: 'tx-row static' },
    h('span', { class: 'tx-icon', style: { '--c': x.category.color } }, x.category.emoji),
    h('span', { class: 'tx-text' }, h('strong', {}, x.category.name), h('small', {}, `${Math.round((x.amount / total) * 100)}% del totale`)),
    h('span', { class: 'tx-amount ' + kind }, eur(x.amount)));
}

function groupByYear(rows) {
  const map = new Map();
  for (const r of rows) {
    const y = r.key.slice(0, 4);
    const g = map.get(y) || { key: y + '-01', label: y, income: 0, expense: 0, invested: 0 };
    g.income += r.income; g.expense += r.expense; g.invested += r.invested;
    map.set(y, g);
  }
  return [...map.values()];
}
