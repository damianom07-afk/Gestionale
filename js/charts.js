// Grafici in SVG, disegnati a mano: niente librerie.
import { svg, MONTHS_SHORT, eur } from './ui.js';

/** Ciambella: items = [{ value, color }] */
export function donut(items, { size = 168, stroke = 26, center = '' , sub = ''} = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let offset = 0;
  const gap = items.length > 1 ? 3 : 0;
  const arcs = items.map((it) => {
    const len = (it.value / total) * c;
    const seg = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${it.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(len - gap, 0.5)} ${c}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    offset += len;
    return seg;
  }).join('');
  return svg(`<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
    <circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>
    ${arcs}
    <text x="50%" y="${size / 2 - 2}" text-anchor="middle" class="donut-center">${center}</text>
    <text x="50%" y="${size / 2 + 18}" text-anchor="middle" class="donut-sub">${sub}</text>
  </svg>`);
}

/** Barre affiancate entrate/spese per mese. data = [{ key:'YYYY-MM', income, expense }] (centesimi) */
export function monthBars(data, { height = 170 } = {}) {
  // tre barre per mese: entrate (giallo), spese (bianco), investito (viola)
  const w = 340, padB = 26, padT = 12;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense, d.invested || 0]));
  const slot = w / data.length;
  const bw = Math.min(12, slot / 4.2);
  const gap = 2;
  const ch = height - padB - padT;
  const bar = (x, v, fill, label, opacity = 1) => {
    const hh = (v / max) * ch;
    return `<rect x="${x}" y="${padT + ch - hh}" width="${bw}" height="${Math.max(hh, 1.5)}" rx="3" fill="${fill}" opacity="${opacity}"><title>${label} ${eur(v)}</title></rect>`;
  };
  const bars = data.map((d, i) => {
    const x = i * slot + slot / 2;
    const label = d.label ?? MONTHS_SHORT[Number(d.key.slice(5)) - 1];
    const last = i === data.length - 1;
    const every = Math.ceil(data.length / 12); // con tanti mesi mostro un'etichetta ogni N
    const showLabel = (data.length - 1 - i) % every === 0;
    const left = x - bw * 1.5 - gap;
    return bar(left, d.income, 'var(--lemon)', 'Entrate') +
      bar(left + bw + gap, d.expense, 'var(--text)', 'Spese', last ? 1 : 0.6) +
      bar(left + 2 * (bw + gap), d.invested || 0, 'var(--lav)', 'Investito') +
      (showLabel ? `<text x="${x}" y="${height - 6}" text-anchor="middle" class="axis${last ? ' current' : ''}">${label}</text>` : '');
  }).join('');
  return svg(`<svg class="bars" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img">
    <line x1="0" x2="${w}" y1="${padT + ch + 0.5}" y2="${padT + ch + 0.5}" stroke="var(--line)"/>
    ${bars}
  </svg>`);
}

/** Barra orizzontale di composizione: items = [{ value, color }] */
export function stackBar(items) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let x = 0;
  const parts = items.map((it) => {
    const w = (it.value / total) * 100;
    const r = `<rect x="${x}%" y="0" width="${Math.max(w - 0.6, 0.3)}%" height="12" rx="3" fill="${it.color}"/>`;
    x += w;
    return r;
  }).join('');
  return svg(`<svg class="stackbar" width="100%" height="12">${parts}</svg>`);
}

/**
 * Linea dell'andamento (es. liquidità a fine mese), con eventuale linea tratteggiata dell'obiettivo.
 * points = [{ label, value }] in centesimi; target in centesimi o null
 */
export function lineChart(points, { target = null, height = 170 } = {}) {
  const w = 340, padB = 26, padT = 16, padX = 8;
  const values = points.map((p) => p.value).concat(target !== null ? [target] : []);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 100; max += 100; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;
  const ch = height - padB - padT;
  const X = (i) => padX + (points.length === 1 ? (w - 2 * padX) / 2 : (i / (points.length - 1)) * (w - 2 * padX));
  const Y = (v) => padT + ch - ((v - min) / (max - min)) * ch;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${X(points.length - 1).toFixed(1)},${padT + ch} L${X(0).toFixed(1)},${padT + ch} Z`;
  const every = Math.ceil(points.length / 12);
  const labels = points.map((p, i) => ((points.length - 1 - i) % every === 0
    ? `<text x="${X(i)}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" class="axis${i === points.length - 1 ? ' current' : ''}">${p.label}</text>` : '')).join('');
  const dots = points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.value)}" r="${i === points.length - 1 ? 4.5 : 2.5}" fill="var(--lemon)"><title>${p.label}: ${eur(p.value)}</title></circle>`).join('');
  const targetLine = target !== null
    ? `<line x1="0" x2="${w}" y1="${Y(target)}" y2="${Y(target)}" stroke="var(--lav)" stroke-width="1.5" stroke-dasharray="5 5"/>
       <text x="${w - 4}" y="${Y(target) - 6}" text-anchor="end" class="axis target">obiettivo</text>` : '';
  return svg(`<svg class="bars line" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img">
    <defs><linearGradient id="liqfill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#FFF21A" stop-opacity=".28"/><stop offset="1" stop-color="#FFF21A" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#liqfill)"/>
    ${targetLine}
    <path d="${path}" fill="none" stroke="var(--lemon)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${labels}
  </svg>`);
}
