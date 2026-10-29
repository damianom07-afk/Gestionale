// Strumenti per costruire l'interfaccia senza framework.

/**
 * Crea un elemento HTML.
 * h('button', { class: 'btn', onclick: fn }, 'Salva')
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** SVG inline da stringa. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

// ---------- Formattazione ----------

const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const numFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 6 });

/** Centesimi -> "1.234,56 €" */
export const eur = (cents) => eurFmt.format((cents || 0) / 100);
/** Euro decimali -> "1.234,56 €" */
export const eurD = (euros) => eurFmt.format(euros || 0);
export const num = (n) => numFmt.format(n || 0);
export const pct = (x) => (x === null || x === undefined ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1).replace('.', ',') + '%');

/** Importo grande con i centesimi più piccoli: "1.234" ",56 €" */
export function bigMoney(cents, { sign = false } = {}) {
  const s = eurFmt.format(Math.abs(cents) / 100);
  const m = s.match(/^(.*?)(,\d{2})(\s?€)$/);
  const prefix = cents < 0 ? '−' : sign && cents > 0 ? '+' : '';
  if (!m) return h('span', { class: 'money' }, prefix + s);
  return h('span', { class: 'money' }, prefix + m[1], h('small', {}, m[2] + m[3]));
}

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Oggi';
  if (same(d, y)) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export const shortDate = (iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

/** "12,50" / "1.234,5" / "12.5" -> centesimi (intero) oppure NaN */
export function parseEuro(input) {
  let s = String(input || '').trim().replace(/[€\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) : NaN;
}

/** "0,0035" -> 0.0035 */
export function parseDecimal(input) {
  let s = String(input ?? '').trim().replace(/[€\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

export const centsToInput = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
export const decToInput = (n) => (n || n === 0 ? String(n).replace('.', ',') : '');

// ---------- Componenti ----------

export function segmented(options, value, onChange, cls = '') {
  const wrap = h('div', { class: 'segmented ' + cls });
  for (const [val, label] of options) {
    wrap.append(h('button', {
      type: 'button',
      class: val === value ? 'active' : '',
      onclick: () => onChange(val)
    }, label));
  }
  return wrap;
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function sectionTitle(text, action) {
  return h('div', { class: 'section-title' }, h('h2', {}, text), action || null);
}

export function empty(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action || null);
}

// ---------- Pannello che sale dal basso ----------

const root = () => document.getElementById('overlay-root');

export function openSheet(build, { title } = {}) {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => { backdrop.remove(); panel.remove(); }, 250);
    document.body.classList.remove('locked');
  };
  backdrop.addEventListener('click', close);
  const header = h('div', { class: 'sheet-head' },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-title-row' },
      h('h3', {}, title || ''),
      h('button', { class: 'icon-btn', 'aria-label': 'Chiudi', onclick: close }, '✕')
    )
  );
  const body = h('div', { class: 'sheet-body' });
  panel.append(header, body);
  const render = () => {
    body.replaceChildren(build({ close, render, setTitle: (t) => (header.querySelector('h3').textContent = t) }));
  };
  render();
  root().append(backdrop, panel);
  document.body.classList.add('locked');
  requestAnimationFrame(() => { backdrop.classList.add('open'); panel.classList.add('open'); });
  return { close, render };
}

export function toast(text, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, text);
  root().append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

export function confirmDialog(message, { ok = 'Conferma', danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'backdrop open dialog-backdrop' });
    const done = (v) => { backdrop.remove(); resolve(v); };
    backdrop.append(h('div', { class: 'dialog' },
      h('p', {}, message),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Annulla'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, ok)
      )
    ));
    root().append(backdrop);
  });
}

/** Chiede un file all'utente (foto, Excel…). */
export function pickFile(accept, { capture } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (capture) input.setAttribute('capture', capture);
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
