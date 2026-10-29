import { state, monthSummary, expensesByCategory, lastMonths, totalLiquidity, portfolio, shiftMonth, monthKey, todayISO, loadDemoData } from '../model.js';
import { h, eur, eurD, bigMoney, pct, monthLabel, sectionTitle } from '../ui.js';
import { donut, monthBars } from '../charts.js';
import { txRow } from './movements.js';

export function renderDashboard(ctx) {
  const s = monthSummary(ctx.month);
  const isCurrent = ctx.month === monthKey(todayISO());
  const root = h('div', { class: 'page dashboard' });

  // --- Intestazione con selettore del mese
  root.append(h('header', { class: 'top' },
    h('div', {},
      h('p', { class: 'eyebrow' }, 'Gestionale'),
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

  // --- Card principale (gialla)
  root.append(h('section', { class: 'hero-card' },
    h('p', { class: 'eyebrow dark' }, 'Saldo del mese'),
    h('div', { class: 'hero-amount' }, bigMoney(s.net, { sign: true })),
    h('div', { class: 'hero-split' },
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Entrate'), h('strong', {}, eur(s.income))),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Spese'), h('strong', {}, eur(s.expense))),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Risparmio'), h('strong', {}, s.savingRate === null ? '—' : pct(s.savingRate).replace('+', '')))
    )
  ));

  // --- Primo avvio: niente dati
  if (state.transactions.length === 0 && state.assets.length === 0) {
    root.append(h('section', { class: 'card onboarding' },
      h('h2', {}, 'Inizia da qui'),
      h('p', { class: 'muted' }, 'Aggiungi la tua prima spesa con il tasto giallo +, oppure carica dei dati di esempio per vedere come funziona. Potrai cancellarli da Impostazioni.'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onclick: () => ctx.add('spesa') }, 'Aggiungi spesa'),
        h('button', { class: 'btn ghost', onclick: async () => { await loadDemoData(); ctx.refresh(); } }, 'Dati di esempio')
      )
    ));
    return root;
  }

  // --- Patrimonio
  const pf = portfolio();
  const liquidity = totalLiquidity();
  root.append(h('section', { class: 'tiles' },
    h('div', { class: 'tile' }, h('span', { class: 'eyebrow' }, 'Liquidità'), h('strong', {}, eur(liquidity))),
    h('div', { class: 'tile' }, h('span', { class: 'eyebrow' }, 'Patrimonio'), h('strong', {}, eur(liquidity + Math.round(pf.value * 100))))
  ));

  // --- Spese per categoria
  const byCat = expensesByCategory(ctx.month);
  root.append(sectionTitle('Spese per categoria'));
  if (byCat.length === 0) {
    root.append(h('p', { class: 'muted pad' }, 'Nessuna spesa in questo mese.'));
  } else {
    const top = byCat.slice(0, 6);
    const rest = byCat.slice(6).reduce((s, x) => s + x.amount, 0);
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
    h('span', {}, h('i', { class: 'white' }), 'Spese'))));
  root.append(h('section', { class: 'card' }, monthBars(lastMonths(ctx.month, 6))));

  // --- Investimenti (card viola)
  if (state.assets.length) {
    root.append(h('button', { class: 'lav-card', onclick: () => ctx.go('investimenti') },
      h('div', {},
        h('p', { class: 'eyebrow dark' }, 'Investimenti'),
        h('div', { class: 'lav-amount' }, bigMoney(Math.round(pf.value * 100)))
      ),
      h('div', { class: 'lav-side' },
        h('span', { class: 'eyebrow dark' }, 'Rendimento'),
        h('strong', {}, pct(pf.pct)),
        h('span', { class: 'small' }, (pf.unrealized >= 0 ? '+' : '') + eurD(pf.unrealized))
      )
    ));
  } else {
    root.append(h('button', { class: 'lav-card slim', onclick: () => ctx.add('investimento') },
      h('p', { class: 'eyebrow dark' }, 'Investimenti'),
      h('strong', {}, 'Aggiungi il primo investimento →')));
  }

  // --- Ultimi movimenti
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);
  root.append(sectionTitle('Ultimi movimenti', h('button', { class: 'link', onclick: () => ctx.go('movimenti') }, 'Vedi tutti')));
  root.append(h('section', { class: 'card list' }, recent.map((t) => txRow(ctx, t, { showDate: true }))));

  return root;
}
