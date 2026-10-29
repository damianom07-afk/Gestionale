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
  const w = 340, padB = 26, padT = 12;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const slot = w / data.length;
  const bw = Math.min(16, slot / 3.2);
  const ch = height - padB - padT;
  const bars = data.map((d, i) => {
    const x = i * slot + slot / 2;
    const hi = (d.income / max) * ch, he = (d.expense / max) * ch;
    const m = Number(d.key.slice(5)) - 1;
    const last = i === data.length - 1;
    return `
      <rect x="${x - bw - 2}" y="${padT + ch - hi}" width="${bw}" height="${Math.max(hi, 1.5)}" rx="4" fill="var(--lemon)"><title>Entrate ${eur(d.income)}</title></rect>
      <rect x="${x + 2}" y="${padT + ch - he}" width="${bw}" height="${Math.max(he, 1.5)}" rx="4" fill="var(--text)" opacity="${last ? 1 : 0.55}"><title>Spese ${eur(d.expense)}</title></rect>
      <text x="${x}" y="${height - 6}" text-anchor="middle" class="axis${last ? ' current' : ''}">${MONTHS_SHORT[m]}</text>`;
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
