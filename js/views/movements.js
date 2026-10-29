import { state, categoryById, accountById, categoriesOf, shiftMonth, monthKey, todayISO, normalize } from '../model.js';
import { h, eur, dayLabel, shortDate, monthLabel, segmented, empty } from '../ui.js';
import { openEditor } from './editor.js';

/** Una riga movimento, usata anche nella dashboard. */
export function txRow(ctx, t, { showDate = false } = {}) {
  const c = categoryById(t.categoryId) || { emoji: '•', name: 'Senza categoria', color: '#555' };
  const a = accountById(t.accountId);
  const title = t.note || c.name;
  const sub = [t.note && t.note !== c.name ? c.name : null, a?.name, showDate ? shortDate(t.date) : null].filter(Boolean).join(' · ');
  return h('button', { class: 'tx-row', onclick: () => openEditor(ctx, { kind: t.kind, tx: t }) },
    h('span', { class: 'tx-icon', style: { '--c': c.color } }, c.emoji),
    h('span', { class: 'tx-text' }, h('strong', {}, title), h('small', {}, sub)),
    t.photo ? h('span', { class: 'tx-clip', title: 'Con foto' }, '📎') : null,
    h('span', { class: 'tx-amount ' + t.kind }, (t.kind === 'entrata' ? '+' : '−') + eur(t.amount))
  );
}

export function renderMovements(ctx) {
  const f = ctx.filters;
  const root = h('div', { class: 'page' });
  const isCurrent = ctx.month === monthKey(todayISO());
  const set = (patch) => { ctx.filters = { ...ctx.filters, ...patch }; ctx.refresh(); };

  root.append(h('header', { class: 'top' },
    h('h1', { class: 'display sm' }, 'Movimenti'),
    f.allMonths
      ? h('button', { class: 'chip active', onclick: () => set({ allMonths: false }) }, 'Tutti i mesi ✕')
      : h('div', { class: 'month-switch' },
        h('button', { class: 'icon-btn', 'aria-label': 'Mese precedente', onclick: () => { ctx.month = shiftMonth(ctx.month, -1); ctx.refresh(); } }, '‹'),
        h('span', {}, monthLabel(ctx.month)),
        h('button', { class: 'icon-btn', 'aria-label': 'Mese successivo', disabled: isCurrent, onclick: () => { ctx.month = shiftMonth(ctx.month, 1); ctx.refresh(); } }, '›')
      )
  ));

  // --- Filtri
  const search = h('input', {
    class: 'input search', type: 'search', placeholder: 'Cerca…', value: f.query,
    oninput: (e) => { ctx.filters.query = e.target.value; renderList(); }
  });
  const catOptions = f.kind === 'tutti' ? state.categories : categoriesOf(f.kind);
  const catSelect = h('select', { class: 'input select', onchange: (e) => set({ category: e.target.value }) },
    h('option', { value: '' }, 'Tutte le categorie'),
    catOptions.map((c) => h('option', { value: c.id, selected: c.id === f.category }, `${c.emoji} ${c.name}`)));

  root.append(h('div', { class: 'filters' },
    segmented([['tutti', 'Tutti'], ['spesa', 'Spese'], ['entrata', 'Entrate']], f.kind, (v) => set({ kind: v, category: '' })),
    h('div', { class: 'row gap' }, search, catSelect),
    !f.allMonths ? h('button', { class: 'link small', onclick: () => set({ allMonths: true }) }, 'Mostra tutti i mesi') : null
  ));

  const listWrap = h('div');
  root.append(listWrap);

  function renderList() {
    const q = normalize(ctx.filters.query);
    let list = state.transactions.filter((t) =>
      (f.allMonths || monthKey(t.date) === ctx.month) &&
      (f.kind === 'tutti' || t.kind === f.kind) &&
      (!f.category || t.categoryId === f.category) &&
      (!q || normalize(`${t.note} ${categoryById(t.categoryId)?.name} ${(t.amount / 100).toFixed(2)}`).includes(q))
    );
    list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

    if (list.length === 0) {
      listWrap.replaceChildren(empty('Nessun movimento con questi filtri.',
        h('button', { class: 'btn primary', onclick: () => ctx.add('spesa') }, 'Aggiungi spesa')));
      return;
    }

    const income = list.filter((t) => t.kind === 'entrata').reduce((s, t) => s + t.amount, 0);
    const expense = list.filter((t) => t.kind === 'spesa').reduce((s, t) => s + t.amount, 0);
    const totals = h('div', { class: 'totals' },
      h('span', {}, `${list.length} movimenti`),
      income ? h('span', { class: 'entrata' }, '+' + eur(income)) : null,
      expense ? h('span', {}, '−' + eur(expense)) : null);

    const groups = new Map();
    for (const t of list) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }
    const blocks = [...groups.entries()].map(([date, items]) => {
      const dayNet = items.reduce((s, t) => s + (t.kind === 'entrata' ? t.amount : -t.amount), 0);
      return h('section', { class: 'day' },
        h('div', { class: 'day-head' }, h('span', {}, dayLabel(date)), h('span', {}, (dayNet > 0 ? '+' : dayNet < 0 ? '−' : '') + eur(Math.abs(dayNet)))),
        h('div', { class: 'card list' }, items.map((t) => txRow(ctx, t)))
      );
    });
    listWrap.replaceChildren(totals, ...blocks);
  }
  renderList();
  return root;
}
