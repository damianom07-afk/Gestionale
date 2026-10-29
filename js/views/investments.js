import { state, portfolio, assetPosition, saveAsset, deleteAsset, accountById, todayISO, ASSET_TYPES, CATEGORY_COLORS } from '../model.js';
import { h, eurD, num, pct, bigMoney, shortDate, openSheet, field, toast, confirmDialog, parseDecimal, decToInput, sectionTitle, empty } from '../ui.js';
import { stackBar } from '../charts.js';
import { openEditor } from './editor.js';

const TYPE_COLORS = Object.fromEntries(ASSET_TYPES.map((t, i) => [t, ['#A66BFF', '#FFF21A', '#F4F4F2', '#C9B2FF', '#7A3FE0', '#FFF89A', '#9A9A9A'][i] || CATEGORY_COLORS[i]]));

export function renderInvestments(ctx) {
  const pf = portfolio();
  const root = h('div', { class: 'page' });
  root.append(h('header', { class: 'top' },
    h('h1', { class: 'display sm' }, 'Investimenti'),
    h('button', { class: 'btn lav small', onclick: () => ctx.add('investimento') }, '+ Operazione')
  ));

  if (state.assets.length === 0) {
    root.append(empty('Nessun investimento. Registra un acquisto (ETF, azioni, crypto, conto deposito…) e qui vedrai valore e rendimento.',
      h('button', { class: 'btn lav', onclick: () => ctx.add('investimento') }, 'Aggiungi investimento')));
    return root;
  }

  root.append(h('section', { class: 'lav-card static' },
    h('div', {},
      h('p', { class: 'eyebrow dark' }, 'Valore attuale'),
      h('div', { class: 'lav-amount' }, bigMoney(Math.round(pf.value * 100)))
    ),
    h('div', { class: 'lav-grid' },
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Investito'), h('strong', {}, eurD(pf.cost))),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Guadagno'), h('strong', {}, (pf.unrealized >= 0 ? '+' : '') + eurD(pf.unrealized))),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Rendimento'), h('strong', {}, pct(pf.pct))),
      h('div', {}, h('span', { class: 'eyebrow dark' }, 'Cedole/dividendi'), h('strong', {}, eurD(pf.dividends)))
    ),
    pf.realized ? h('p', { class: 'small dark' }, `Plus/minusvalenze realizzate con le vendite: ${(pf.realized >= 0 ? '+' : '') + eurD(pf.realized)}`) : null
  ));

  // Ripartizione per tipo
  const byType = {};
  for (const r of pf.rows) byType[r.asset.type] = (byType[r.asset.type] || 0) + r.value;
  const types = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (types.length) {
    root.append(sectionTitle('Ripartizione'));
    root.append(h('section', { class: 'card' },
      stackBar(types.map(([t, v]) => ({ value: v, color: TYPE_COLORS[t] || '#888' }))),
      h('ul', { class: 'legend compact' }, types.map(([t, v]) => h('li', {},
        h('i', { style: { background: TYPE_COLORS[t] || '#888' } }), h('span', {}, t), h('b', {}, eurD(v)),
        h('em', {}, Math.round((v / pf.value) * 100) + '%'))))
    ));
  }

  root.append(sectionTitle('Strumenti'));
  root.append(h('section', { class: 'card list' }, pf.rows.map((r) =>
    h('button', { class: 'tx-row', onclick: () => openAsset(ctx, r.asset) },
      h('span', { class: 'tx-icon', style: { '--c': TYPE_COLORS[r.asset.type] || '#888' } }, r.asset.name.slice(0, 2).toUpperCase()),
      h('span', { class: 'tx-text' }, h('strong', {}, r.asset.name),
        h('small', {}, `${r.asset.type} · ${num(r.qty)} quote`)),
      h('span', { class: 'tx-amount stack' }, eurD(r.value),
        h('small', { class: r.unrealized >= 0 ? 'up' : 'down' }, pct(r.pct)))
    ))));
  root.append(h('p', { class: 'muted pad small' }, 'I prezzi si aggiornano a mano: tocca uno strumento e inserisci il prezzo attuale.'));
  return root;
}

function openAsset(ctx, asset) {
  openSheet(({ close, render }) => {
    const a = state.assets.find((x) => x.id === asset.id);
    if (!a) { close(); return h('div'); }
    const p = assetPosition(a);
    let price = decToInput(a.price);
    let name = a.name, type = a.type;

    const opRow = (o) => {
      const acc = accountById(o.accountId);
      const label = o.kind === 'dividendo' ? `Dividendo ${eurD(o.amount)}` : `${o.kind === 'acquisto' ? 'Acquisto' : 'Vendita'} ${num(o.qty)} × ${eurD(o.price)}`;
      return h('button', { class: 'tx-row', onclick: () => { close(); openEditor(ctx, { op: o }); } },
        h('span', { class: 'tx-icon', style: { '--c': o.kind === 'vendita' ? '#F4F4F2' : o.kind === 'dividendo' ? '#FFF21A' : '#A66BFF' } },
          o.kind === 'acquisto' ? '↓' : o.kind === 'vendita' ? '↑' : '€'),
        h('span', { class: 'tx-text' }, h('strong', {}, label), h('small', {}, [shortDate(o.date), acc?.name, o.note].filter(Boolean).join(' · '))));
    };

    return h('div', { class: 'editor' },
      h('div', { class: 'stats-grid' },
        h('div', {}, h('span', { class: 'eyebrow' }, 'Quote'), h('strong', {}, num(p.qty))),
        h('div', {}, h('span', { class: 'eyebrow' }, 'Prezzo medio'), h('strong', {}, eurD(p.avgPrice))),
        h('div', {}, h('span', { class: 'eyebrow' }, 'Valore'), h('strong', {}, eurD(p.value))),
        h('div', {}, h('span', { class: 'eyebrow' }, 'Rendimento'), h('strong', { class: p.unrealized >= 0 ? 'up' : 'down' }, pct(p.pct)))
      ),
      h('form', {
        class: 'form subcard',
        onsubmit: async (e) => {
          e.preventDefault();
          const v = parseDecimal(price);
          if (!(v >= 0)) return toast('Prezzo non valido', 'error');
          await saveAsset({ ...a, name: name.trim() || a.name, type, price: v, priceDate: todayISO() });
          toast('Strumento aggiornato'); ctx.refresh(); render();
        }
      },
        h('div', { class: 'row gap' },
          field('Prezzo attuale (€)', h('input', { class: 'input', inputmode: 'decimal', value: price, oninput: (e) => (price = e.target.value) }),
            a.priceDate ? `Aggiornato il ${shortDate(a.priceDate)}` : null),
          h('button', { class: 'btn primary', type: 'submit' }, 'Aggiorna')
        ),
        h('details', {}, h('summary', {}, 'Rinomina o cambia tipo'),
          field('Nome', h('input', { class: 'input', value: name, oninput: (e) => (name = e.target.value) })),
          field('Tipo', h('select', { class: 'input select', onchange: (e) => (type = e.target.value) },
            ASSET_TYPES.map((t) => h('option', { value: t, selected: t === type }, t)))))
      ),
      sectionTitle('Operazioni', h('button', { class: 'link', onclick: () => { close(); openEditor(ctx, { kind: 'investimento', assetId: a.id }); } }, '+ Aggiungi')),
      h('div', { class: 'card list' }, [...p.ops].reverse().map(opRow)),
      h('button', {
        class: 'btn danger ghost full',
        onclick: async () => {
          if (!(await confirmDialog(`Eliminare "${a.name}" e tutte le sue operazioni?`, { ok: 'Elimina', danger: true }))) return;
          await deleteAsset(a.id); toast('Strumento eliminato'); close(); ctx.refresh();
        }
      }, 'Elimina strumento')
    );
  }, { title: asset.name });
}
