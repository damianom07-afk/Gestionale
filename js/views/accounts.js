// Conti e liquidità obiettivo.
// L'idea: scegli quanta liquidità vuoi tenere. Quello che sta sopra l'obiettivo
// lo puoi investire; quando sei all'obiettivo, ogni mese entrate − spese − investito = 0.
import {
  state, accountBalance, totalLiquidity, targetStatus, liquidityTarget, setLiquidityTarget,
  saveAccount, deleteAccount
} from '../model.js';
import { h, eur, bigMoney, openSheet, field, toast, confirmDialog, parseEuro, centsToInput, sectionTitle } from '../ui.js';
import { stackBar } from '../charts.js';

const ACCOUNT_COLORS = ['#FFF21A', '#A66BFF', '#F4F4F2', '#C9B2FF', '#FFF89A', '#7A3FE0'];

/** Card con la liquidità e il confronto con l'obiettivo (usata in Home e in Conti). */
export function liquidityCard(ctx, { liquidity, status, label = 'Liquidità', onclick } = {}) {
  const tag = onclick ? 'button' : 'section';
  const body = [
    h('div', { class: 'liq-head' },
      h('p', { class: 'eyebrow' }, label),
      status ? h('span', { class: 'liq-target' }, 'Obiettivo ' + eur(status.target)) : null),
    h('div', { class: 'liq-amount' }, bigMoney(liquidity))
  ];
  if (status) {
    const fill = Math.max(0, Math.min(1, status.ratio));
    body.push(h('div', { class: 'liq-bar' + (status.gap >= 0 ? ' full' : '') }, h('i', { style: { width: (fill * 100).toFixed(1) + '%' } })));
    let msg, cls;
    if (status.gap > 0) { msg = `+${eur(status.gap)} oltre l’obiettivo`; cls = 'over'; }
    else if (status.gap < 0) { msg = `−${eur(-status.gap)} all’obiettivo`; cls = 'under'; }
    else { msg = 'Obiettivo raggiunto ✓'; cls = 'ok'; }
    body.push(h('p', { class: 'liq-status ' + cls }, msg));
  } else {
    body.push(h('p', { class: 'liq-status' }, 'Imposta obiettivo →'));
  }
  return h(tag, { class: 'liq-card', onclick }, ...body);
}

export function renderAccounts(ctx) {
  const root = h('div', { class: 'page' });
  const liquidity = totalLiquidity();
  root.append(h('header', { class: 'top' }, h('h1', { class: 'display sm' }, 'Conti'), ctx.settingsButton()));

  root.append(liquidityCard(ctx, { liquidity, status: targetStatus(liquidity), label: 'Liquidità oggi', onclick: () => editTarget(ctx) }));

  root.append(h('section', { class: 'card pad-card' },
    h('div', { class: 'row gap between' },
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'Liquidità obiettivo'),
        h('strong', { class: 'big-num' }, liquidityTarget() === null ? 'Non impostata' : eur(liquidityTarget()))),
      h('button', { class: 'btn primary small', onclick: () => editTarget(ctx) }, liquidityTarget() === null ? 'Imposta' : 'Modifica'))
  ));

  // --- Elenco conti
  root.append(sectionTitle('I tuoi conti', h('button', { class: 'link', onclick: () => editAccount(ctx) }, '+ Nuovo')));
  const balances = state.accounts.map((a, i) => ({ a, b: accountBalance(a.id), color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }));
  const positive = balances.filter((x) => x.b > 0);
  if (positive.length > 1) {
    root.append(h('section', { class: 'card' }, stackBar(positive.map((x) => ({ value: x.b, color: x.color })))));
  }
  root.append(h('section', { class: 'card list' }, balances.map(({ a, b, color }) =>
    h('button', { class: 'tx-row', onclick: () => editAccount(ctx, a) },
      h('span', { class: 'tx-icon', style: { '--c': color } }, a.name.slice(0, 1).toUpperCase()),
      h('span', { class: 'tx-text' }, h('strong', {}, a.name), h('small', {}, `Saldo iniziale ${eur(a.initial || 0)}`)),
      h('span', { class: 'tx-amount' + (b < 0 ? ' neg' : '') }, eur(b)))
  )));
  return root;
}

export function editTarget(ctx) {
  openSheet(({ close }) => {
    const current = liquidityTarget();
    let value = current === null ? '' : centsToInput(current);
    const input = h('input', { class: 'input amount', inputmode: 'decimal', placeholder: '0,00', value, autocomplete: 'off', oninput: (e) => (value = e.target.value) });
    return h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        const cents = parseEuro(value);
        if (!(cents >= 0)) return toast('Inserisci un importo valido', 'error');
        await setLiquidityTarget(cents);
        toast('Obiettivo salvato'); close(); ctx.refresh();
      }
    },
      h('label', { class: 'amount-field' }, h('span', { class: 'currency' }, '€'), input),
      h('p', { class: 'hint' }, `Liquidità attuale: ${eur(totalLiquidity())}`),
      h('div', { class: 'form-actions' },
        current !== null ? h('button', {
          type: 'button', class: 'btn ghost',
          onclick: async () => { await setLiquidityTarget(null); toast('Obiettivo rimosso'); close(); ctx.refresh(); }
        }, 'Rimuovi') : null,
        h('button', { type: 'submit', class: 'btn primary grow' }, 'Salva'))
    );
  }, { title: 'Liquidità obiettivo' });
}

export function editAccount(ctx, acc) {
  openSheet(({ close }) => {
    let name = acc?.name || '';
    let initial = acc ? centsToInput(acc.initial || 0) : '';
    return h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.trim()) return toast('Inserisci un nome', 'error');
        const cents = initial.trim() ? parseEuro(initial) : 0;
        if (isNaN(cents)) return toast('Saldo non valido', 'error');
        await saveAccount({ ...(acc || {}), name: name.trim(), initial: cents });
        toast('Conto salvato'); close(); ctx.refresh();
      }
    },
      field('Nome', h('input', { class: 'input', value: name, placeholder: 'Es. Revolut, Carta, Contanti', oninput: (e) => (name = e.target.value) })),
      field('Saldo iniziale (€)', h('input', { class: 'input', inputmode: 'decimal', value: initial, placeholder: '0,00', oninput: (e) => (initial = e.target.value) })),
      h('div', { class: 'form-actions' },
        acc ? h('button', {
          type: 'button', class: 'btn danger ghost',
          onclick: async () => {
            if (state.accounts.length <= 1) return toast('Serve almeno un conto', 'error');
            if (!(await confirmDialog(`Eliminare il conto "${acc.name}"?`, { ok: 'Elimina', danger: true }))) return;
            try { await deleteAccount(acc.id); toast('Conto eliminato'); close(); ctx.refresh(); }
            catch (err) { toast(err.message, 'error'); }
          }
        }, 'Elimina') : null,
        h('button', { type: 'submit', class: 'btn primary grow' }, 'Salva'))
    );
  }, { title: acc ? 'Modifica conto' : 'Nuovo conto' });
}
