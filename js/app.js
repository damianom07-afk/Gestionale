// Punto di partenza: carica i dati, disegna la barra in basso e la schermata attiva.
import { load, todayISO, monthKey } from './model.js';
import { requestPersistence } from './db.js';
import { h, svg } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderMovements } from './views/movements.js';
import { renderAccounts } from './views/accounts.js';
import { renderSummary } from './views/summary.js';
import { renderSettings } from './views/settings.js';
import { openEditor } from './views/editor.js';

const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1.3"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};

const TABS = {
  home: { label: 'Home', icon: 'home', render: renderDashboard },
  movimenti: { label: 'Movimenti', icon: 'list', render: renderMovements },
  riepilogo: { label: 'Riepilogo', icon: 'chart', render: renderSummary },
  conti: { label: 'Conti', icon: 'wallet', render: renderAccounts },
  impostazioni: { label: 'Impostazioni', icon: 'settings', render: renderSettings }
};

// Contesto condiviso fra le schermate
const ctx = {
  tab: 'home',
  month: monthKey(todayISO()),
  filters: { kind: 'tutti', category: '', query: '', allMonths: false },
  go(tab) {
    if (!TABS[tab]) tab = 'home';
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    ctx.tab = tab;
    ctx.refresh(true);
  },
  refresh(scrollTop = false) {
    const view = document.getElementById('view');
    const y = window.scrollY;
    view.replaceChildren(TABS[ctx.tab].render(ctx));
    renderNav();
    window.scrollTo(0, scrollTop ? 0 : y);
  },
  /** Pulsante ingranaggio per aprire le Impostazioni (sta nell'intestazione). */
  settingsButton() {
    return h('button', { class: 'icon-btn gear', 'aria-label': 'Impostazioni', onclick: () => ctx.go('impostazioni') }, svg(ICONS.settings));
  },
  add(kind = 'spesa', extra = {}) {
    openEditor(ctx, { kind, ...extra });
  }
};

function renderNav() {
  const nav = document.getElementById('nav');
  const item = (key) => {
    const t = TABS[key];
    return h('button', { class: 'nav-item' + (ctx.tab === key ? ' active' : ''), onclick: () => ctx.go(key), 'aria-label': t.label },
      svg(ICONS[t.icon]), h('span', {}, t.label));
  };
  nav.replaceChildren(
    item('home'),
    item('movimenti'),
    h('button', { class: 'nav-add', 'aria-label': 'Aggiungi', onclick: () => ctx.add('spesa') }, svg(ICONS.plus)),
    item('riepilogo'),
    item('conti')
  );
}

async function start() {
  try {
    await load();
  } catch (e) {
    document.getElementById('view').replaceChildren(
      h('div', { class: 'empty' }, h('p', {}, 'Impossibile aprire il database del telefono.'), h('p', { class: 'muted' }, String(e)))
    );
    return;
  }
  requestPersistence();
  const fromHash = location.hash.replace('#', '');
  ctx.tab = TABS[fromHash] ? fromHash : 'home';
  ctx.refresh(true);
  window.addEventListener('hashchange', () => ctx.go(location.hash.replace('#', '')));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
