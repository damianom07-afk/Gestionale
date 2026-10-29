import {
  state, monthSummary, expensesByCategory, lastMonths, liquidityAtMonthEnd, targetStatus,
  investedInYear, shiftMonth, monthKey, todayISO, loadDemoData
} from '../model.js';
import { h, eur, bigMoney, monthLabel, sectionTitle } from '../ui.js';
import { donut, monthBars } from '../charts.js';
import { txRow } from './movements.js';
import { liquidityCard } from './accounts.js';

export function renderDashboard(ctx) {
  const s = monthSummary(ctx.month);
  const isCurrent = ctx.month === monthKey(todayISO());
  const root = h('div', { class: 'page dashboard' });

  // --- Intestazione con selettore del mese
  root.append(h('header', { class: 'top' },
    h('div', {},
      h('div', { class: 'brand-row' }, h('p', { class: 'eyebrow' }, 'Gestionale'), ctx.settingsButton()),
      h('h1', { class: 'display' }, 'Ciao.')
    ),
    h('div', { class: 'month-switch' },
      h('button', { class: 'icon-btn', 'aria-label': 'Mese precedente', onclick: () => { ctx.month = shiftMonth(ctx.month, -1); ctx.refresh(); } }, '‹'),
      h('span', {}, monthLabel(ctx.month)),
      h('button', { class: 'icon-btn', 'aria-label': 'Mese successivo', disabled: isCurrent, onclick: () => { ctx.month = shiftMonth(ctx.month, 1); ctx.refresh(); } }, '›')
    )
  ));

  // --- Promemoria backup
  const last = state.meta.lastExport;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
  if (state.transactions.length > 0 && (days === null || days > 30)) {
    root.append(h('button', { class: 'banner', onclick: () => ctx.go('impostazioni') },
      h('span', {}, days === null ? 'Non hai ancora fatto un backup Excel.' : `Ultimo backup ${days} giorni fa.`),
      h('strong', {}, 'Esporta →')));
  }

  // --- Card principale (gialla): entrate − spese − investito
  const goTo = (kind) => () => { ctx.filters = { ...ctx.filters, kind, category: '', query: '', allMonths: false }; ctx.go('movimenti'); };
  root.append(h('section', { class: 'hero-card' },
    h('p', { class: 'eyebrow dark' }, 'Saldo del mese'),
    h('div', { class: 'hero-amount' }, bigMoney(s.net, { sign: true })),
    h('div', { class: 'hero-split' },
      h('button', { onclick: goTo('entrata') }, h('span', { class: 'eyebrow dark' }, 'Entrate'), h('strong', {}, eur(s.income))),
      h('button', { onclick: goTo('spesa') }, h('span', { class: 'eyebrow dark' }, 'Spese'), h('strong', {}, eur(s.expense))),
      h('button', { onclick: goTo('investimento') }, h('span', { class: 'eyebrow dark' }, 'Investito'), h('strong', {}, eur(s.invested)))
    )
  ));

  // --- Primo avvio: niente dati
  if (state.transactions.length === 0) {
    root.append(h('section', { class: 'card onboarding' },
      h('h2', {}, 'Inizia da qui'),
      h('p', { class: 'muted' }, 'Imposta i conti, poi aggiungi i movimenti con il +.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', onclick: () => ctx.go('conti') }, 'Imposta i conti'),
        h('button', { class: 'btn ghost', onclick: async () => { await loadDemoData(); ctx.refresh(); } }, 'Dati di esempio')
      )
    ));
    return root;
  }

  // --- Liquidità rispetto all'obiettivo
  const liquidity = liquidityAtMonthEnd(ctx.month);
  root.append(liquidityCard(ctx, {
    liquidity,
    status: targetStatus(liquidity),
    label: isCurrent ? 'Liquidità oggi' : `Liquidità a fine ${monthLabel(ctx.month).split(' ')[0]}`,
    onclick: () => ctx.go('conti')
  }));

  // --- Spese per categoria
  const byCat = expensesByCategory(ctx.month);
  root.append(sectionTitle('Spese per categoria'));
  if (byCat.length === 0) {
    root.append(h('p', { class: 'muted pad' }, 'Nessuna spesa in questo mese.'));
  } else {
    const top = byCat.slice(0, 6);
    const rest = byCat.slice(6).reduce((sum, x) => sum + x.amount, 0);
    const items = top.map((x) => ({ value: x.amount, color: x.category.color }));
    if (rest) items.push({ value: rest, color: '#444' });
    const legend = h('ul', { class: 'legend' },
      top.map((x) => h('li', {
        onclick: () => { ctx.filters = { ...ctx.filters, kind: 'spesa', category: x.category.id, query: '', allMonths: false }; ctx.go('movimenti'); }
      },
        h('i', { style: { background: x.category.color } }),
        h('span', {}, `${x.category.emoji} ${x.category.name}`),
        h('b', {}, eur(x.amount)),
        h('em', {}, Math.round((x.amount / s.expense) * 100) + '%')
      )),
      rest ? h('li', {}, h('i', { style: { background: '#444' } }), h('span', {}, 'Altre categorie'), h('b', {}, eur(rest)), h('em', {}, Math.round((rest / s.expense) * 100) + '%')) : null
    );
    root.append(h('section', { class: 'card chart-card' },
      donut(items, { center: eur(s.expense).replace(/,\d{2}/, ''), sub: 'speso' }),
      legend
    ));
  }

  // --- Andamento ultimi 6 mesi
  root.append(sectionTitle('Ultimi 6 mesi', h('div', { class: 'key' },
    h('span', {}, h('i', { class: 'lemon' }), 'Entrate'),
    h('span', {}, h('i', { class: 'white' }), 'Spese'),
    h('span', {}, h('i', { class: 'lav' }), 'Investito'))));
  root.append(h('section', { class: 'card' }, monthBars(lastMonths(ctx.month, 6))));

  // --- Investimenti (card viola): solo quanto hai destinato
  const year = ctx.month.slice(0, 4);
  root.append(h('button', { class: 'lav-card', onclick: goTo('investimento') },
    h('div', {},
      h('p', { class: 'eyebrow dark' }, 'Investito nel mese'),
      h('div', { class: 'lav-amount' }, bigMoney(s.invested))
    ),
    h('div', { class: 'lav-side' },
      h('span', { class: 'eyebrow dark' }, `Da inizio ${year}`),
      h('strong', {}, eur(investedInYear(year)))
    )
  ));

  // --- Ultimi movimenti
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);
  root.append(sectionTitle('Ultimi movimenti', h('button', { class: 'link', onclick: () => ctx.go('movimenti') }, 'Vedi tutti')));
  root.append(h('section', { class: 'card list' }, recent.map((t) => txRow(ctx, t, { showDate: true }))));

  return root;
}
