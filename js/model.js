// Il "cervello" dell'app: dati di partenza, salvataggi, calcoli.
// Convenzione: gli importi sono in CENTESIMI (numeri interi) per evitare
// errori di arrotondamento (0.1 + 0.2 != 0.3).
//
// Tre tipi di movimento:
//   'entrata'      soldi che arrivano
//   'spesa'        soldi spesi
//   'investimento' soldi che destini agli investimenti (escono dalla liquidità, ma non sono spese)
//
// Saldo del mese = entrate − spese − investito.
// Con la liquidità all'obiettivo, l'ideale è un saldo del mese = 0.

import * as db from './db.js';

export const KINDS = ['spesa', 'entrata', 'investimento'];
export const KIND_LABEL = { spesa: 'Spesa', entrata: 'Entrata', investimento: 'Investimento' };
export const KIND_LABEL_PLURAL = { spesa: 'Spese', entrata: 'Entrate', investimento: 'Investimenti' };

// ---------- Utilità ----------

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function todayISO() {
  return toISO(new Date());
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
  return toISO(new Date(y, m - 1 + delta, 1)).slice(0, 7);
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
  ['entrata', '💶', 'Altre entrate', ''],
  // Investimenti
  ['investimento', '📈', 'Investimenti', 'investimento, pac, etf, broker, directa, fineco, scalable, trade republic, degiro, moneyfarm']
];

function makeCategory([kind, emoji, name, kw], i) {
  return {
    id: uid(),
    kind,
    emoji,
    name,
    color: kind === 'investimento' ? '#A66BFF' : CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    keywords: kw ? kw.split(',').map((k) => k.trim()).filter(Boolean) : [],
    order: i
  };
}

// ---------- Stato in memoria ----------
// Carichiamo tutto all'avvio: per un uso personale (migliaia di righe) è istantaneo.

export const state = {
  accounts: [],
  categories: [],
  transactions: [],
  rules: [],
  meta: {}
};

export async function load() {
  const [accounts, categories, transactions, rules, meta] = await Promise.all([
    db.getAll('accounts'), db.getAll('categories'), db.getAll('transactions'),
    db.getAll('rules'), db.getAll('meta')
  ]);
  if (categories.length === 0) {
    const cats = DEFAULT_CATEGORIES.map(makeCategory);
    await db.bulkPut('categories', cats);
    categories.push(...cats);
  }
  // Chi aveva già l'app prima degli investimenti semplificati: aggiungi la categoria mancante
  if (!categories.some((c) => c.kind === 'investimento')) {
    const c = makeCategory(DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1], categories.length);
    await db.put('categories', c);
    categories.push(c);
  }
  if (accounts.length === 0) {
    const accs = [
      { id: uid(), name: 'Conto corrente', initial: 0, order: 0 },
      { id: uid(), name: 'Contanti', initial: 0, order: 1 }
    ];
    await db.bulkPut('accounts', accs);
    accounts.push(...accs);
  }
  Object.assign(state, {
    accounts: accounts.sort(byOrder),
    categories: categories.sort(byOrder),
    transactions,
    rules,
    meta: Object.fromEntries(meta.map((m) => [m.key, m.value]))
  });
}

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

// ---------- Salvataggi ----------

async function save(storeName, obj) {
  await db.put(storeName, obj);
  const list = state[storeName];
  const key = storeName === 'rules' ? 'key' : 'id';
  const i = list.findIndex((x) => x[key] === obj[key]);
  if (i >= 0) list[i] = obj; else list.push(obj);
  return obj;
}

async function remove(storeName, id) {
  await db.del(storeName, id);
  const key = storeName === 'rules' ? 'key' : 'id';
  state[storeName] = state[storeName].filter((x) => x[key] !== id);
}

export const saveTransaction = (t) => save('transactions', { createdAt: Date.now(), ...t, id: t.id || uid() });
export const deleteTransaction = (id) => remove('transactions', id);

export const saveAccount = (a) => save('accounts', { order: state.accounts.length, ...a, id: a.id || uid() });
export async function deleteAccount(id) {
  if (state.transactions.some((t) => t.accountId === id)) {
    throw new Error('Il conto ha dei movimenti collegati: spostali o eliminali prima.');
  }
  await remove('accounts', id);
}

export const saveCategory = (c) => save('categories', { order: state.categories.length, ...c, id: c.id || uid() });
export async function deleteCategory(id) {
  const cat = categoryById(id);
  if (!cat) return;
  const others = state.categories.filter((c) => c.kind === cat.kind && c.id !== id);
  if (others.length === 0) throw new Error('Serve almeno una categoria di questo tipo.');
  const fallback = others.find((c) => /altr/i.test(c.name)) || others[others.length - 1];
  for (const t of state.transactions.filter((t) => t.categoryId === id)) {
    await saveTransaction({ ...t, categoryId: fallback.id });
  }
  for (const r of state.rules.filter((r) => r.categoryId === id)) await remove('rules', r.key);
  await remove('categories', id);
  return fallback;
}

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
 * Indovina la categoria.
 * 1) regole imparate dalle tue scelte passate (più affidabili)
 * 2) parole chiave delle categorie
 * Ritorna { categoryId, source } oppure null.
 */
export function guessCategory({ merchant = '', text = '' }, kind = 'spesa') {
  const key = merchantKey(merchant);
  if (key.length >= 3) {
    const exact = state.rules.find((r) => r.key === key);
    if (exact && categoryById(exact.categoryId)?.kind === kind) return { categoryId: exact.categoryId, accountId: exact.accountId || null, source: 'imparata' };
    const partial = state.rules.find((r) => r.key.length >= 4 && (key.includes(r.key) || r.key.includes(key)));
    if (partial && categoryById(partial.categoryId)?.kind === kind) return { categoryId: partial.categoryId, accountId: partial.accountId || null, source: 'imparata' };
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
export async function learnRule(merchant, categoryId, accountId = null) {
  const key = merchantKey(merchant);
  if (key.length < 3) return;
  await save('rules', { key, categoryId, accountId, updatedAt: Date.now() });
}

export async function clearRules() {
  for (const r of [...state.rules]) await remove('rules', r.key);
}

// ---------- Calcoli ----------

const sum = (list) => list.reduce((s, t) => s + t.amount, 0);
const ofKind = (list, kind) => list.filter((t) => t.kind === kind);

export function txInMonth(key) {
  return state.transactions.filter((t) => monthKey(t.date) === key);
}

/** Effetto di un movimento sulla liquidità (centesimi, con segno). */
export const signed = (t) => (t.kind === 'entrata' ? t.amount : -t.amount);

export function monthSummary(key) {
  const list = txInMonth(key);
  const income = sum(ofKind(list, 'entrata'));
  const expense = sum(ofKind(list, 'spesa'));
  const invested = sum(ofKind(list, 'investimento'));
  return { income, expense, invested, net: income - expense - invested, count: list.length };
}

export function investedInYear(year) {
  return sum(state.transactions.filter((t) => t.kind === 'investimento' && t.date.startsWith(String(year))));
}

export function expensesByCategory(key) {
  const map = new Map();
  for (const t of ofKind(txInMonth(key), 'spesa')) {
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
    out.push({ key: k, income: s.income, expense: s.expense, invested: s.invested });
  }
  return out;
}

export function accountBalance(accountId, upToDate = null) {
  const acc = accountById(accountId);
  let b = acc ? acc.initial || 0 : 0;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    if (upToDate && t.date > upToDate) continue;
    b += signed(t);
  }
  return b;
}

/** Liquidità totale (somma dei conti). Con upToDate = 'YYYY-MM-DD' calcola quella a quella data. */
export const isLiquid = (a) => a.liquid !== false;

export function totalLiquidity(upToDate = null) {
  return state.accounts.filter(isLiquid).reduce((s, a) => s + accountBalance(a.id, upToDate), 0);
}

/** Liquidità a fine mese (o oggi, se è il mese in corso). */
export function liquidityAtMonthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return totalLiquidity(toISO(new Date(y, m, 0)));
}

export const liquidityTarget = () => state.meta.liquidityTarget ?? null;
export const setLiquidityTarget = (cents) => setMeta('liquidityTarget', cents);

/**
 * Confronto con l'obiettivo.
 * gap > 0: sei sopra l'obiettivo (quella cifra puoi investirla)
 * gap < 0: sei sotto (quella cifra va recuperata)
 */
export function targetStatus(liquidity) {
  const target = liquidityTarget();
  if (target === null) return null;
  return { target, gap: liquidity - target, ratio: target > 0 ? liquidity / target : 1 };
}

// ---------- Dati di esempio (archivio separato) ----------

const MODE_KEY = 'gestionale-mode';

export function isDemo() {
  try { return localStorage.getItem(MODE_KEY) === 'demo'; } catch { return false; }
}

/** Da chiamare all'avvio, prima di load(). */
export async function openCurrentDatabase() {
  await db.useDatabase(isDemo() ? db.DEMO_DB : db.REAL_DB);
}

export async function enterDemo() {
  try { localStorage.setItem(MODE_KEY, 'demo'); } catch { /* ignore */ }
  await db.useDatabase(db.REAL_DB);
  await db.useDatabase(db.DEMO_DB);
  await db.replaceAll({});
  await load();
  await loadDemoData();
}

export async function exitDemo() {
  try { localStorage.setItem(MODE_KEY, 'real'); } catch { /* ignore */ }
  await db.useDatabase(db.REAL_DB);
  await load();
  await db.deleteDatabase(db.DEMO_DB);
}

const DEMO_NOTES = new Set(['Stipendio', 'PAC mensile', 'Affitto', 'A2A luce e gas', 'ATM abbonamento', 'Netflix', 'Spotify',
  'Esselunga', 'Conad', 'Pizzeria', 'Bar', 'Amazon', 'Cinema e cena', 'Rimborso spese']);

/** Movimenti di esempio finiti per errore fra i tuoi (caricati tutti insieme nello stesso istante). */
export function strayDemoTransactions() {
  const flagged = state.transactions.filter((t) => t.demo);
  const candidates = state.transactions.filter((t) => !t.demo && DEMO_NOTES.has(t.note)).sort((a, b) => a.createdAt - b.createdAt);
  let best = [];
  for (let i = 0; i < candidates.length; i++) {
    const group = candidates.filter((t) => t.createdAt >= candidates[i].createdAt && t.createdAt - candidates[i].createdAt < 3000);
    if (group.length > best.length) best = group;
  }
  return flagged.concat(best.length >= 20 ? best : []);
}

export async function removeStrayDemo() {
  const list = strayDemoTransactions();
  for (const t of list) await remove('transactions', t.id);
  return list.length;
}


export async function loadDemoData() {
  const cat = (name) => state.categories.find((c) => c.name === name)?.id;
  const acc = state.accounts[0].id;
  const cash = state.accounts[1]?.id || acc;
  const now = new Date();
  const tx = [];
  const add = (kind, euros, d, catName, note, accountId = acc) =>
    tx.push({ id: uid(), kind, amount: Math.round(euros * 100), date: toISO(d), categoryId: cat(catName), accountId, note, createdAt: Date.now(), demo: true });
  const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;

  for (let m = 5; m >= 0; m--) {
    const y = now.getFullYear(), mo = now.getMonth() - m;
    const day = (d) => new Date(y, mo, Math.min(d, 28));
    const limit = m === 0 ? now.getDate() : 31;
    const ok = (d) => d <= limit;
    if (ok(27)) add('entrata', 1850, day(27), 'Stipendio', 'Stipendio');
    if (ok(28)) add('investimento', m % 2 ? 300 : 450, day(28), 'Investimenti', 'PAC mensile');
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
  await db.put('accounts', { ...state.accounts[0], initial: 250000 });
  await db.put('accounts', { ...state.accounts[1], initial: 15000 });
  await db.put('meta', { key: 'liquidityTarget', value: 300000 });
  await load();
}

// ---------- Riepilogo per periodo ----------

export const PERIODS = { mese: 1, '3m': 3, '6m': 6, anno: 12, tutto: null };

/** Primo mese con dei movimenti (o il mese corrente se non ce ne sono). */
export function firstMonth() {
  let min = monthKey(todayISO());
  for (const t of state.transactions) if (t.date.slice(0, 7) < min) min = t.date.slice(0, 7);
  return min;
}

/** Elenco dei mesi 'YYYY-MM' da start a end compresi. */
export function monthsBetween(start, end) {
  const out = [];
  for (let k = start; k <= end; k = shiftMonth(k, 1)) out.push(k);
  return out;
}

/**
 * Intervallo di mesi per un tipo di periodo.
 * - mese / 3m / 6m: finestra che finisce nel mese "anchor"
 * - anno: anno solare del mese "anchor" (fino al mese corrente, se è l'anno in corso)
 * - tutto: dal primo movimento a oggi
 */
export function periodRange(type, anchor) {
  const now = monthKey(todayISO());
  if (type === 'tutto') return { start: firstMonth(), end: now };
  if (type === 'anno') {
    const y = anchor.slice(0, 4);
    const end = `${y}-12` > now ? now : `${y}-12`;
    return { start: `${y}-01`, end };
  }
  const n = PERIODS[type];
  return { start: shiftMonth(anchor, -(n - 1)), end: anchor };
}

/** Periodo precedente della stessa durata (per i confronti). */
export function previousRange(type, range) {
  if (type === 'tutto') return null;
  if (type === 'anno') {
    const y = Number(range.start.slice(0, 4)) - 1;
    const len = monthsBetween(range.start, range.end).length;
    return { start: `${y}-01`, end: shiftMonth(`${y}-01`, len - 1) };
  }
  const n = PERIODS[type];
  return { start: shiftMonth(range.start, -n), end: shiftMonth(range.start, -1) };
}

export function txInRange({ start, end }) {
  return state.transactions.filter((t) => { const k = t.date.slice(0, 7); return k >= start && k <= end; });
}

export function rangeSummary(range) {
  const list = txInRange(range);
  const income = sum(ofKind(list, 'entrata'));
  const expense = sum(ofKind(list, 'spesa'));
  const invested = sum(ofKind(list, 'investimento'));
  // per le medie conto solo i mesi da quando hai iniziato a usare l'app
  const from = range.start < firstMonth() ? firstMonth() : range.start;
  const months = Math.max(1, from <= range.end ? monthsBetween(from, range.end).length : 1);
  return {
    income, expense, invested,
    net: income - expense - invested,
    months,
    count: list.length,
    savingRate: income > 0 ? (income - expense) / income : null,   // quota di entrate non spesa
    investRate: income > 0 ? invested / income : null,             // quota di entrate investita
    avgIncome: Math.round(income / months),
    avgExpense: Math.round(expense / months),
    avgInvested: Math.round(invested / months)
  };
}

/** Totali per categoria di un tipo in un intervallo. */
export function byCategoryInRange(kind, range) {
  const map = new Map();
  for (const t of ofKind(txInRange(range), kind)) map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  return [...map.entries()]
    .map(([id, amount]) => ({ id, category: categoryById(id) || { name: '?', emoji: '•', color: '#666' }, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Riga per ogni mese dell'intervallo, con la liquidità a fine mese. */
export function monthlyRows(range) {
  return monthsBetween(range.start, range.end).map((k) => ({ key: k, ...monthSummary(k), liquidity: liquidityAtMonthEnd(k) }));
}

/** Liquidità all'inizio di un intervallo (= fine del mese prima). */
export function liquidityBefore(range) {
  return liquidityAtMonthEnd(shiftMonth(range.start, -1));
}
