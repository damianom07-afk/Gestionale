// Il "cervello" dell'app: dati di partenza, salvataggi, calcoli.
// Convenzione: gli importi dei movimenti sono in CENTESIMI (numeri interi) per evitare
// errori di arrotondamento (0.1 + 0.2 != 0.3). Gli investimenti usano euro decimali
// perché quantità e prezzi unitari possono avere molte cifre (es. crypto).

import * as db from './db.js';

// ---------- Utilità ----------

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function todayISO() {
  const d = new Date();
  return toISO(d);
}

export function toISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthKey(iso) {
  return iso.slice(0, 7); // 'YYYY-MM'
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return toISO(d).slice(0, 7);
}

/** Testo senza accenti, minuscolo, solo lettere e numeri separati da spazio. */
export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------- Dati di partenza ----------

export const CATEGORY_COLORS = [
  '#FFF21A', '#A66BFF', '#F4F4F2', '#C9B2FF', '#FFF89A',
  '#7A3FE0', '#9A9A9A', '#D9CF00', '#E6DAFF', '#5E5E5E'
];

export const ASSET_TYPES = ['ETF', 'Azioni', 'Obbligazioni', 'Fondi', 'Crypto', 'Conto deposito', 'Altro'];

const DEFAULT_CATEGORIES = [
  // Spese
  ['spesa', '🛒', 'Spesa alimentare', 'esselunga, conad, coop, carrefour, lidl, eurospin, pam, iper, unes, tigros, aldi, penny, crai, despar, naturasi, il gigante, supermercato, market, alimentari, panificio, panetteria, macelleria, fruttivendolo'],
  ['spesa', '🍽️', 'Ristoranti & bar', 'ristorante, pizzeria, trattoria, osteria, bar, caffe, cafe, bistrot, sushi, mcdonald, burger king, kfc, poke, deliveroo, glovo, just eat, justeat, uber eats, starbucks, pub, gelateria, pasticceria, aperitivo, kebab'],
  ['spesa', '🚇', 'Trasporti', 'atm, trenord, trenitalia, italo, frecciarossa, uber, freenow, free now, taxi, enjoy, share now, bikemi, lime, dott, tier, flixbus, metro, biglietto'],
  ['spesa', '⛽', 'Auto & carburante', 'eni, q8, tamoil, esso, shell, agip, carburante, benzina, diesel, distributore, autofficina, gommista, bollo auto, rca, telepass, autostrade, parcheggio, easypark'],
  ['spesa', '🏠', 'Casa & bollette', 'affitto, condominio, enel, a2a, iren, edison, hera, sorgenia, plenitude, bolletta, luce, gas, acqua, tari, fastweb, tim, vodafone, windtre, iliad, ho mobile, very mobile, ikea, leroy merlin, brico'],
  ['spesa', '💊', 'Salute', 'farmacia, parafarmacia, ospedale, medico, dentista, ottico, analisi, ticket sanitario, visita'],
  ['spesa', '📺', 'Abbonamenti', 'netflix, spotify, amazon prime, prime video, disney, dazn, now tv, apple com bill, icloud, google one, youtube premium, chatgpt, abbonamento'],
  ['spesa', '🛍️', 'Shopping', 'amazon, zalando, zara, uniqlo, decathlon, mediaworld, unieuro, euronics, apple store, shein, primark, ovs, coin, rinascente, sephora, douglas, h m'],
  ['spesa', '🎉', 'Svago', 'cinema, teatro, concerto, ticketone, museo, feltrinelli, mondadori, steam, playstation, nintendo, bowling, discoteca'],
  ['spesa', '💪', 'Sport & benessere', 'palestra, virgin active, mcfit, fit active, piscina, parrucchiere, barbiere, estetista'],
  ['spesa', '✈️', 'Viaggi', 'ryanair, easyjet, ita airways, wizz, volotea, vueling, booking, airbnb, hotel, expedia, ostello'],
  ['spesa', '📚', 'Formazione', 'universita, corso, udemy, coursera, libro, libri'],
  ['spesa', '🏦', 'Tasse & commissioni', 'f24, agenzia entrate, commissione, canone, imposta di bollo, multa'],
  ['spesa', '📦', 'Altro', ''],
  // Entrate
  ['entrata', '💼', 'Stipendio', 'stipendio, salario, emolumenti, busta paga'],
  ['entrata', '↩️', 'Rimborsi', 'rimborso, reso, storno'],
  ['entrata', '🎁', 'Regali', 'regalo'],
  ['entrata', '💶', 'Altre entrate', '']
];

function defaultData() {
  const categories = DEFAULT_CATEGORIES.map(([kind, emoji, name, kw], i) => ({
    id: uid(),
    kind,
    emoji,
    name,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    keywords: kw ? kw.split(',').map((k) => k.trim()).filter(Boolean) : [],
    order: i
  }));
  const accounts = [
    { id: uid(), name: 'Conto corrente', initial: 0, order: 0 },
    { id: uid(), name: 'Contanti', initial: 0, order: 1 }
  ];
  return { categories, accounts };
}

// ---------- Stato in memoria ----------
// Carichiamo tutto all'avvio: per un uso personale (migliaia di righe) è istantaneo.

export const state = {
  accounts: [],
  categories: [],
  transactions: [],
  assets: [],
  ops: [],
  rules: [],
  meta: {}
};

export async function load() {
  const [accounts, categories, transactions, assets, ops, rules, meta] = await Promise.all([
    db.getAll('accounts'), db.getAll('categories'), db.getAll('transactions'),
    db.getAll('assets'), db.getAll('ops'), db.getAll('rules'), db.getAll('meta')
  ]);
  if (categories.length === 0 && accounts.length === 0) {
    const d = defaultData();
    await db.bulkPut('categories', d.categories);
    await db.bulkPut('accounts', d.accounts);
    categories.push(...d.categories);
    accounts.push(...d.accounts);
  }
  Object.assign(state, {
    accounts: accounts.sort(byOrder),
    categories: categories.sort(byOrder),
    transactions,
    assets,
    ops,
    rules,
    meta: Object.fromEntries(meta.map((m) => [m.key, m.value]))
  });
}

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

// ---------- Salvataggi ----------

async function save(storeName, listName, obj) {
  await db.put(storeName, obj);
  const list = state[listName];
  const key = storeName === 'rules' ? 'key' : 'id';
  const i = list.findIndex((x) => x[key] === obj[key]);
  if (i >= 0) list[i] = obj; else list.push(obj);
  return obj;
}

async function remove(storeName, listName, id) {
  await db.del(storeName, id);
  const key = storeName === 'rules' ? 'key' : 'id';
  state[listName] = state[listName].filter((x) => x[key] !== id);
}

export const saveTransaction = (t) => save('transactions', 'transactions', { createdAt: Date.now(), ...t, id: t.id || uid() });
export const deleteTransaction = (id) => remove('transactions', 'transactions', id);

export const saveAccount = (a) => save('accounts', 'accounts', { order: state.accounts.length, ...a, id: a.id || uid() });
export async function deleteAccount(id) {
  if (state.transactions.some((t) => t.accountId === id) || state.ops.some((o) => o.accountId === id)) {
    throw new Error('Il conto ha dei movimenti collegati: spostali o eliminali prima.');
  }
  await remove('accounts', 'accounts', id);
}

export const saveCategory = (c) => save('categories', 'categories', { order: state.categories.length, ...c, id: c.id || uid() });
export async function deleteCategory(id) {
  const cat = categoryById(id);
  if (!cat) return;
  const others = state.categories.filter((c) => c.kind === cat.kind && c.id !== id);
  if (others.length === 0) throw new Error('Serve almeno una categoria di questo tipo.');
  const fallback = others.find((c) => /altr/i.test(c.name)) || others[others.length - 1];
  for (const t of state.transactions.filter((t) => t.categoryId === id)) {
    await saveTransaction({ ...t, categoryId: fallback.id });
  }
  for (const r of state.rules.filter((r) => r.categoryId === id)) await remove('rules', 'rules', r.key);
  await remove('categories', 'categories', id);
  return fallback;
}

export const saveAsset = (a) => save('assets', 'assets', { ...a, id: a.id || uid() });
export async function deleteAsset(id) {
  for (const o of state.ops.filter((o) => o.assetId === id)) await remove('ops', 'ops', o.id);
  await remove('assets', 'assets', id);
}
export const saveOp = (o) => save('ops', 'ops', { ...o, id: o.id || uid() });
export const deleteOp = (id) => remove('ops', 'ops', id);

export async function setMeta(key, value) {
  await db.put('meta', { key, value });
  state.meta[key] = value;
}

export async function replaceEverything(data) {
  await db.replaceAll(data);
  await load();
}

export async function wipeEverything() {
  await db.replaceAll({});
  await load(); // ricrea categorie e conti di partenza
}

// ---------- Ricerche ----------

export const categoryById = (id) => state.categories.find((c) => c.id === id);
export const accountById = (id) => state.accounts.find((a) => a.id === id);
export const assetById = (id) => state.assets.find((a) => a.id === id);
export const categoriesOf = (kind) => state.categories.filter((c) => c.kind === kind);

// ---------- Categoria automatica ----------

function containsWord(text, word) {
  const w = normalize(word);
  if (!w) return false;
  return (' ' + text + ' ').includes(' ' + w + ' ');
}

/** Chiave stabile per un esercente: prime 3 parole significative. */
export function merchantKey(s) {
  return normalize(s)
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w))
    .slice(0, 3)
    .join(' ');
}

/**
 * Indovina la categoria di una spesa.
 * 1) regole imparate dalle tue scelte passate (più affidabili)
 * 2) parole chiave delle categorie
 * Ritorna { categoryId, source } oppure null.
 */
export function guessCategory({ merchant = '', text = '' }, kind = 'spesa') {
  const key = merchantKey(merchant);
  if (key.length >= 3) {
    const exact = state.rules.find((r) => r.key === key);
    if (exact && categoryById(exact.categoryId)?.kind === kind) return { categoryId: exact.categoryId, source: 'imparata' };
    const partial = state.rules.find((r) => r.key.length >= 4 && (key.includes(r.key) || r.key.includes(key)));
    if (partial && categoryById(partial.categoryId)?.kind === kind) return { categoryId: partial.categoryId, source: 'imparata' };
  }
  const haystack = normalize(merchant + ' ' + text);
  if (!haystack) return null;
  let best = null;
  for (const c of categoriesOf(kind)) {
    let score = 0;
    for (const kw of c.keywords || []) if (containsWord(haystack, kw)) score += containsWord(normalize(merchant), kw) ? 3 : 1;
    if (score > 0 && (!best || score > best.score)) best = { categoryId: c.id, score };
  }
  return best ? { categoryId: best.categoryId, source: 'parole chiave' } : null;
}

/** Ricorda che questo esercente va in questa categoria. */
export async function learnRule(merchant, categoryId) {
  const key = merchantKey(merchant);
  if (key.length < 3) return;
  await save('rules', 'rules', { key, categoryId, updatedAt: Date.now() });
}

export async function clearRules() {
  for (const r of [...state.rules]) await remove('rules', 'rules', r.key);
}

// ---------- Calcoli ----------

export function txInMonth(key) {
  return state.transactions.filter((t) => monthKey(t.date) === key);
}

export function monthSummary(key) {
  const list = txInMonth(key);
  const income = sum(list.filter((t) => t.kind === 'entrata'));
  const expense = sum(list.filter((t) => t.kind === 'spesa'));
  const net = income - expense;
  const savingRate = income > 0 ? net / income : null;
  return { income, expense, net, savingRate, count: list.length };
}

function sum(list) {
  return list.reduce((s, t) => s + t.amount, 0);
}

export function expensesByCategory(key) {
  const map = new Map();
  for (const t of txInMonth(key).filter((t) => t.kind === 'spesa')) {
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  }
  return [...map.entries()]
    .map(([id, amount]) => ({ category: categoryById(id) || { name: '?', emoji: '•', color: '#666' }, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function lastMonths(key, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = shiftMonth(key, -i);
    const s = monthSummary(k);
    out.push({ key: k, income: s.income, expense: s.expense });
  }
  return out;
}

/** Effetto di un'operazione d'investimento sul conto collegato, in centesimi. */
export function opCashEffect(o) {
  const fees = Number(o.fees) || 0;
  if (o.kind === 'acquisto') return -Math.round((o.qty * o.price + fees) * 100);
  if (o.kind === 'vendita') return Math.round((o.qty * o.price - fees) * 100);
  if (o.kind === 'dividendo') return Math.round(((Number(o.amount) || 0) - fees) * 100);
  return 0;
}

export function accountBalance(accountId) {
  const acc = accountById(accountId);
  let b = acc ? acc.initial || 0 : 0;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    b += t.kind === 'entrata' ? t.amount : -t.amount;
  }
  for (const o of state.ops) if (o.accountId === accountId) b += opCashEffect(o);
  return b;
}

export function totalLiquidity() {
  return state.accounts.reduce((s, a) => s + accountBalance(a.id), 0);
}

/**
 * Posizione su uno strumento con il metodo del costo medio ponderato.
 * Tutti i valori in euro (decimali).
 */
export function assetPosition(asset) {
  const ops = state.ops.filter((o) => o.assetId === asset.id).sort((a, b) => a.date.localeCompare(b.date));
  let qty = 0, cost = 0, realized = 0, dividends = 0;
  for (const o of ops) {
    const fees = Number(o.fees) || 0;
    if (o.kind === 'acquisto') {
      qty += o.qty;
      cost += o.qty * o.price + fees;
    } else if (o.kind === 'vendita') {
      const avg = qty > 0 ? cost / qty : 0;
      const q = Math.min(o.qty, qty);
      cost -= avg * q;
      qty -= q;
      realized += q * o.price - fees - avg * q;
    } else if (o.kind === 'dividendo') {
      dividends += (Number(o.amount) || 0) - fees;
    }
  }
  if (Math.abs(qty) < 1e-9) { qty = 0; cost = 0; }
  const value = qty * (asset.price || 0);
  const unrealized = value - cost;
  return {
    qty, cost, value, unrealized, realized, dividends,
    avgPrice: qty > 0 ? cost / qty : 0,
    pct: cost > 0 ? unrealized / cost : null,
    ops
  };
}

export function portfolio() {
  const rows = state.assets.map((a) => ({ asset: a, ...assetPosition(a) }));
  const value = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const realized = rows.reduce((s, r) => s + r.realized, 0);
  const dividends = rows.reduce((s, r) => s + r.dividends, 0);
  return {
    rows: rows.sort((a, b) => b.value - a.value),
    value, cost,
    unrealized: value - cost,
    pct: cost > 0 ? (value - cost) / cost : null,
    realized, dividends
  };
}

// ---------- Dati di esempio (per provare l'app) ----------

export async function loadDemoData() {
  const cat = (name) => state.categories.find((c) => c.name === name)?.id;
  const acc = state.accounts[0].id;
  const cash = state.accounts[1]?.id || acc;
  const now = new Date();
  const tx = [];
  const add = (kind, euros, d, catName, note, accountId = acc) =>
    tx.push({ id: uid(), kind, amount: Math.round(euros * 100), date: toISO(d), categoryId: cat(catName), accountId, note, createdAt: Date.now() });
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;

  for (let m = 5; m >= 0; m--) {
    const y = now.getFullYear(), mo = now.getMonth() - m;
    const day = (d) => new Date(y, mo, Math.min(d, 28));
    const limit = m === 0 ? now.getDate() : 31;
    const ok = (d) => d <= limit;
    if (ok(27)) add('entrata', 1850, day(27), 'Stipendio', 'Stipendio');
    if (ok(2)) add('spesa', 650, day(2), 'Casa & bollette', 'Affitto');
    if (ok(12)) add('spesa', rnd(45, 90), day(12), 'Casa & bollette', 'A2A luce e gas');
    if (ok(5)) add('spesa', 39, day(5), 'Trasporti', 'ATM abbonamento');
    if (ok(15)) add('spesa', 13.99, day(15), 'Abbonamenti', 'Netflix');
    if (ok(15)) add('spesa', 10.99, day(15), 'Abbonamenti', 'Spotify');
    for (const d of [3, 10, 17, 24]) if (ok(d)) add('spesa', rnd(35, 85), day(d), 'Spesa alimentare', d % 2 ? 'Esselunga' : 'Conad');
    for (const d of [6, 13, 20]) if (ok(d)) add('spesa', rnd(8, 42), day(d), 'Ristoranti & bar', d === 13 ? 'Pizzeria' : 'Bar', cash);
    if (ok(18)) add('spesa', rnd(20, 120), day(18), 'Shopping', 'Amazon');
    if (ok(22) && m % 2 === 0) add('spesa', rnd(15, 60), day(22), 'Svago', 'Cinema e cena');
    if (ok(9) && m % 3 === 0) add('entrata', rnd(40, 150), day(9), 'Rimborsi', 'Rimborso spese');
  }
  await db.bulkPut('transactions', tx);

  const etf = { id: uid(), name: 'Vanguard FTSE All-World', type: 'ETF', price: 128.4, priceDate: todayISO() };
  const btc = { id: uid(), name: 'Bitcoin', type: 'Crypto', price: 61250, priceDate: todayISO() };
  await db.bulkPut('assets', [etf, btc]);
  const ops = [];
  for (let m = 5; m >= 1; m--) {
    ops.push({ id: uid(), assetId: etf.id, kind: 'acquisto', date: toISO(new Date(now.getFullYear(), now.getMonth() - m, 28)), qty: 2, price: rnd(115, 126), fees: 1, accountId: acc, note: 'PAC mensile' });
  }
  ops.push({ id: uid(), assetId: btc.id, kind: 'acquisto', date: toISO(new Date(now.getFullYear(), now.getMonth() - 4, 10)), qty: 0.005, price: 55400, fees: 2, accountId: acc, note: '' });
  await db.bulkPut('ops', ops);
  await db.put('accounts', { ...state.accounts[0], initial: 250000 });
  await db.put('accounts', { ...state.accounts[1], initial: 15000 });
  await load();
}
