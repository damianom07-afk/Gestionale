// Export e import Excel (.xlsx) senza librerie esterne.
// Un file .xlsx è un archivio ZIP che contiene file XML: qui li scriviamo e leggiamo a mano.

import { state, uid, replaceEverything, setMeta, todayISO, categoryById, accountById, CATEGORY_COLORS } from './model.js';

// ================= ZIP =================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Crea uno ZIP non compresso ("stored"): semplice e letto da qualunque programma. */
function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomi in UTF-8
    local.setUint16(8, 0, true);      // nessuna compressione
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

/** Legge uno ZIP (anche compresso, come quelli salvati da Excel). */
async function unzip(buffer) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Il file non sembra un Excel valido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = new Uint8Array(buffer, start, compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('Formato di compressione non supportato.');
    out[name] = dec.decode(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ================= XLSX: scrittura =================

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = colName(c) + (r + 1);
      if (v === null || v === undefined || v === '') return '';
      const style = r === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const widths = rows[0].map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${c === 0 ? 14 : 18}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${body}</sheetData></worksheet>`;
}

function buildXlsx(sheets) {
  const names = Object.keys(sheets);
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF21A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`
    },
    ...names.map((n, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheets[n]) }))
  ];
  return zip(files);
}

// ================= XLSX: lettura =================

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(buffer) {
  const files = await unzip(buffer);
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    for (const si of parse(files['xl/sharedStrings.xml']).getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }
  const wb = parse(files['xl/workbook.xml']);
  const rels = parse(files['xl/_rels/workbook.xml.rels']);
  const target = {};
  for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
  const result = {};
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = target[rid] || '';
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path;
    const xml = files[path];
    if (!xml) continue;
    const rows = [];
    for (const row of parse(xml).getElementsByTagName('row')) {
      const r = [];
      for (const c of row.getElementsByTagName('c')) {
        const idx = colIndex(c.getAttribute('r'));
        const type = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent;
        let val;
        if (type === 's') val = shared[Number(v)];
        else if (type === 'inlineStr') val = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
        else if (type === 'str') val = v;
        else if (type === 'b') val = v === '1';
        else val = v === undefined ? '' : Number(v);
        r[idx] = val;
      }
      rows.push(r);
    }
    result[s.getAttribute('name')] = rows;
  }
  return result;
}

/** Trasforma le righe in oggetti usando la prima riga come intestazione. */
function toObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const head = rows[0].map((h) => String(h ?? '').trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v !== undefined && v !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ================= Mappatura dati <-> fogli =================

const euros = (cents) => Math.round(cents) / 100;

export function exportWorkbook() {
  const catName = (id) => categoryById(id)?.name || '';
  const accName = (id) => accountById(id)?.name || '';
  const sheets = {
    Movimenti: [
      ['ID', 'Data', 'Tipo', 'Importo', 'Categoria', 'Conto', 'Descrizione'],
      ...[...state.transactions].sort((a, b) => b.date.localeCompare(a.date))
        .map((t) => [t.id, t.date, t.kind, euros(t.amount), catName(t.categoryId), accName(t.accountId), t.note || ''])
    ],
    Conti: [
      ['ID', 'Nome', 'Saldo iniziale', 'Liquidità'],
      ...state.accounts.map((a) => [a.id, a.name, euros(a.initial || 0), a.liquid === false ? 'No' : 'Sì'])
    ],
    Categorie: [
      ['ID', 'Nome', 'Tipo', 'Emoji', 'Colore', 'Parole chiave'],
      ...state.categories.map((c) => [c.id, c.name, c.kind, c.emoji, c.color, (c.keywords || []).join(', ')])
    ],
    Regole: [
      ['Esercente', 'Categoria'],
      ...state.rules.map((r) => [r.key, catName(r.categoryId)])
    ],
    Impostazioni: [
      ['Chiave', 'Valore'],
      ['Liquidità obiettivo', state.meta.liquidityTarget != null ? euros(state.meta.liquidityTarget) : '']
    ]
  };
  return buildXlsx(sheets);
}

function toDate(v) {
  if (typeof v === 'number') {
    // numero seriale di Excel (giorni dal 30/12/1899)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return todayISO();
}

function toNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').trim().replace(/[€\s]/g, '');
  if (!s) return 0;
  // "1.234,56" -> 1234.56 ; "12.5" -> 12.5
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return isFinite(n) ? n : 0;
}

/**
 * Legge un file Excel esportato dall'app (anche modificato a mano in Excel)
 * e restituisce i dati pronti da salvare. Le righe senza ID ricevono un ID nuovo.
 */
export async function parseWorkbook(file) {
  const sheets = await readXlsx(await file.arrayBuffer());
  if (!sheets.Movimenti && !sheets.Categorie) throw new Error('Questo file non è un backup del Gestionale.');

  const accounts = toObjects(sheets.Conti).map((r, i) => ({
    id: String(r.ID || uid()), name: String(r.Nome || `Conto ${i + 1}`), initial: Math.round(toNum(r['Saldo iniziale']) * 100), order: i,
    liquid: !/^n/i.test(String(r['Liquidità'] ?? '').trim())
  }));
  const categories = toObjects(sheets.Categorie).map((r, i) => ({
    id: String(r.ID || uid()),
    name: String(r.Nome || 'Senza nome'),
    kind: toKind(r.Tipo),
    emoji: String(r.Emoji || '•'),
    color: String(r.Colore || CATEGORY_COLORS[i % CATEGORY_COLORS.length]),
    keywords: String(r['Parole chiave'] || '').split(',').map((s) => s.trim()).filter(Boolean),
    order: i
  }));
  // Ricerca per nome; se manca, crea al volo (utile se aggiungi righe direttamente in Excel)
  const findOrCreate = (list, name, make) => {
    const n = String(name || '').trim();
    if (!n) return null;
    let found = list.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!found) { found = make(n); list.push(found); }
    return found.id;
  };
  const accountId = (name) => findOrCreate(accounts, name, (n) => ({ id: uid(), name: n, initial: 0, order: accounts.length }));
  const categoryId = (name, kind) => {
    const n = String(name || '').trim().toLowerCase();
    const found = categories.find((c) => c.kind === kind && c.name.toLowerCase() === n);
    if (found) return found.id;
    const c = { id: uid(), name: String(name).trim(), kind, emoji: '•', color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length], keywords: [], order: categories.length };
    categories.push(c);
    return c.id;
  };

  if (accounts.length === 0) accounts.push({ id: uid(), name: 'Conto corrente', initial: 0, order: 0 });

  const transactions = toObjects(sheets.Movimenti).map((r) => {
    const kind = toKind(r.Tipo);
    return {
      id: String(r.ID || uid()),
      kind,
      amount: Math.round(Math.abs(toNum(r.Importo)) * 100),
      date: toDate(r.Data),
      categoryId: categoryId(r.Categoria || DEFAULT_CAT[kind], kind),
      accountId: accountId(r.Conto) || accounts[0].id,
      note: String(r.Descrizione || ''),
      createdAt: Date.now()
    };
  });

  const rules = toObjects(sheets.Regole).map((r) => {
    const cat = categories.find((c) => c.name.toLowerCase() === String(r.Categoria).toLowerCase());
    return cat && r.Esercente ? { key: String(r.Esercente), categoryId: cat.id, updatedAt: Date.now() } : null;
  }).filter(Boolean);

  const settings = Object.fromEntries(toObjects(sheets.Impostazioni).map((r) => [String(r.Chiave), r.Valore]));
  const target = settings['Liquidità obiettivo'];
  const liquidityTarget = target === '' || target === undefined ? null : Math.round(toNum(target) * 100);

  return { accounts, categories, transactions, rules, liquidityTarget };
}

const DEFAULT_CAT = { spesa: 'Altro', entrata: 'Altre entrate', investimento: 'Investimenti' };

function toKind(v) {
  const t = String(v || '').toLowerCase().trim();
  if (t.startsWith('e')) return 'entrata';
  if (t.startsWith('i')) return 'investimento';
  return 'spesa';
}

export async function importWorkbook(file) {
  const data = await parseWorkbook(file);
  const lastExport = state.meta.lastExport;
  data.meta = lastExport ? [{ key: 'lastExport', value: lastExport }] : [];
  if (data.liquidityTarget !== null) data.meta.push({ key: 'liquidityTarget', value: data.liquidityTarget });
  await replaceEverything(data);
  return data;
}

/** Salva il file: sul telefono apre il menu Condividi (→ "Salva su File"), su PC lo scarica. */
export async function downloadBackup() {
  const blob = exportWorkbook();
  const name = `gestionale-${todayISO()}.xlsx`;
  const file = new File([blob], name, { type: blob.type });
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  let done = false;
  if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      done = true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
  }
  if (!done) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  await setMeta('lastExport', todayISO());
  return true;
}
