// Lettura di scontrini e screenshot, gratuita e tutta sul telefono.
// 1) OCR con Tesseract.js (open source): trasforma l'immagine in testo.
//    La prima volta scarica ~10 MB (programma + lingua italiana), poi resta in cache.
// 2) Analisi del testo: cerchiamo importo, data ed esercente con delle regole.
// 3) La categoria la indovina model.guessCategory (parole chiave + cose imparate).

import { todayISO, toISO } from './model.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossibile scaricare il lettore di testo: serve internet la prima volta.'));
    document.head.append(s);
  });
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('ita', 1, {
        logger: (m) => progressHandler && progressHandler(m)
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  progressHandler = onProgress;
  return workerPromise;
}
let progressHandler = null;

/** Ridimensiona, porta in scala di grigi e aumenta il contrasto: l'OCR legge meglio. */
async function prepareImage(file) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => reject(new Error('Immagine non leggibile.'));
    i.src = url;
  });
  const max = 1800;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;
  // luminosità media, per capire se è testo chiaro su sfondo scuro (es. app in modalità scura)
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const invert = sum / (p.length / 4) < 110;
  for (let i = 0; i < p.length; i += 4) {
    let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    if (invert) g = 255 - g;
    g = Math.max(0, Math.min(255, (g - 128) * 1.5 + 128));
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Foto -> testo. onProgress riceve un numero 0..1 e una descrizione. */
export async function recognize(file, onProgress = () => {}) {
  onProgress(0.02, 'Preparo l’immagine…');
  const canvas = await prepareImage(file);
  onProgress(0.05, 'Carico il lettore di testo…');
  const worker = await getWorker((m) => {
    if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'Leggo il testo…');
    else if (m.status && m.status.includes('load')) onProgress(0.05 + (m.progress || 0) * 0.25, 'Scarico i dati della lingua (solo la prima volta)…');
  });
  const { data } = await worker.recognize(canvas);
  onProgress(1, 'Fatto');
  return data.text || '';
}

// ---------- Analisi del testo ----------

const AMOUNT_RE = /(-|−)?\s?(?:€\s?)?(\d{1,3}(?:[.\s']\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2})(?!\d)/g;

function toCents(raw) {
  let s = raw.replace(/[\s']/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) : null;
}

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const c = toCents(m[2]);
    if (c !== null && c > 0) out.push({ cents: c, negative: !!m[1], euroSign: /€|eur/i.test(line) });
  }
  return out;
}

const TOTAL_RE = /(totale\s*(complessivo|euro|eur|€|da pagare)?|importo\s*(pagato|totale)|pagamento\s*(elettronico|carta|contante)|^\s*total\b|da\s*pagare)/i;
const NOT_TOTAL_RE = /(sub\s*-?\s*totale|iva|imponibile|resto|sconto|risparmi|n\.?\s*pezzi|numero\s*pezzi|di cui)/i;

function findAmount(lines) {
  // 1) riga "TOTALE …" (o la riga subito dopo, se l'importo va a capo)
  for (let i = 0; i < lines.length; i++) {
    if (TOTAL_RE.test(lines[i]) && !NOT_TOTAL_RE.test(lines[i])) {
      const a = amountsIn(lines[i]);
      if (a.length) return a[a.length - 1].cents;
      const next = lines[i + 1] && amountsIn(lines[i + 1]);
      if (next && next.length) return next[0].cents;
    }
  }
  // 2) screenshot della banca: importo negativo o con il simbolo €
  const all = lines.flatMap(amountsIn);
  const neg = all.find((a) => a.negative);
  if (neg) return neg.cents;
  const withEuro = all.filter((a) => a.euroSign);
  if (withEuro.length) return Math.max(...withEuro.map((a) => a.cents));
  // 3) in mancanza d'altro, l'importo più grande (sugli scontrini di solito è il totale)
  if (all.length) return Math.max(...all.map((a) => a.cents));
  return null;
}

const MONTHS = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  const now = new Date();
  if (dt > new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) return null;
  if (y < now.getFullYear() - 2) return null;
  return toISO(dt);
}

function findDate(text) {
  const t = text.toLowerCase();
  let m = t.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const r = validDate(y, Number(m[2]), Number(m[1]));
    if (r) return r;
  }
  m = t.match(/\b(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?\s*(\d{4})?/);
  if (m) {
    const y = m[3] ? Number(m[3]) : new Date().getFullYear();
    const r = validDate(y, MONTHS[m[2]], Number(m[1]));
    if (r) return r;
  }
  if (/\bieri\b/.test(t)) {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return toISO(d);
  }
  return todayISO();
}

const JUNK_RE = /(documento|commerciale|scontrino|fiscale|p\.?\s?iva|partita|c\.?f\.?|codice|tel|telefono|www|http|via |viale|piazza|corso |cap |vendita|prestazione|descrizione|prezzo|euro|cassa|operatore|transazion|pagamento|carta|dettagli|movimento|stato|completat|oggi|ieri|importo|^\d)/i;

function cleanName(s) {
  const t = s.replace(/[^\p{L}\p{N}&'.\- ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t
    .split(' ')
    .map((w) => (w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ')
    .slice(0, 40);
}

function findMerchant(lines) {
  // screenshot della banca: spesso "Nome esercente   -12,50 €" sulla stessa riga
  for (const l of lines) {
    const a = amountsIn(l);
    if (a.length && a[0].negative) {
      const name = cleanName(l.replace(AMOUNT_RE, '').replace(/€|eur/gi, ''));
      if (name.replace(/[^a-z]/gi, '').length >= 3 && !JUNK_RE.test(name)) return name;
    }
  }
  // scontrino: la prima riga "con parole" in alto è quasi sempre il nome del negozio
  for (const l of lines.slice(0, 8)) {
    const letters = l.replace(/[^a-zà-ù]/gi, '');
    if (letters.length < 3) continue;
    if (JUNK_RE.test(l)) continue;
    if (amountsIn(l).length) continue;
    return cleanName(l);
  }
  return '';
}

/** Testo grezzo (da OCR o incollato) -> { amount (centesimi) | null, date, merchant } */
export function parseReceipt(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    amount: findAmount(lines),
    date: findDate(text),
    merchant: findMerchant(lines)
  };
}

/** Riduce la foto prima di salvarla insieme alla spesa (occupa poco spazio). */
export async function thumbnail(file, max = 1000, quality = 0.6) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}
