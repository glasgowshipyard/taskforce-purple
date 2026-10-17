// The link-preview picture for a page (1200×630): what X, Facebook, iMessage,
// Reddit and Slack show when someone shares a member's link. Drawn as SVG and
// turned into a PNG at build time (resvg, with the site's own fonts as TTF), so
// no Worker ever draws one. The member's version matches their share card:
// the grade stamp, the People/Power/Influence graph and the one sentence.

import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import { monotonePath } from '../../src/lib/curve.js';
import { CYCLE_SHORT } from '../../src/lib/election.js';
import { GRADES, GRAPH_GRADIENT, PARTS } from '../../src/lib/grades.js';

const require = createRequire(import.meta.url);
const font = path => require.resolve(`@expo-google-fonts/${path}`);
const FONT_FILES = [
  font('archivo/800ExtraBold/Archivo_800ExtraBold.ttf'),
  font('archivo/900Black/Archivo_900Black.ttf'),
  font('public-sans/400Regular/PublicSans_400Regular.ttf'),
  font('public-sans/700Bold/PublicSans_700Bold.ttf'),
  font('ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf'),
];
const FONTS = { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Public Sans' };

export const WIDTH = 1200;
export const HEIGHT = 630;

const esc = text =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Text widths measured by drawing them (cached): no guessing at letter widths
const widths = new Map();
function measure(text, { family, weight, size }) {
  const key = `${family}|${weight}|${size}|${text}`;
  if (!widths.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400"><text x="0" y="200" font-family="${family}" font-weight="${weight}" font-size="${size}">${esc(text)}</text></svg>`;
    const box = new Resvg(svg, { font: FONTS }).getBBox();
    widths.set(key, box ? box.width : text.length * size * 0.6);
  }
  return widths.get(key);
}

// Greedy word wrap to `width`
function wrap(text, style, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, style) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

/** The largest size from `sizes` at which `text` fits in `maxLines` lines */
function fit(text, style, width, maxLines, sizes) {
  for (const size of sizes) {
    const lines = wrap(text, { ...style, size }, width);
    if (lines.length <= maxLines) {
      return { size, lines };
    }
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrap(text, { ...style, size }, width).slice(0, maxLines) };
}

const textLines = (lines, { x, y, size, leading, family, weight, fill, anchor = 'start' }) =>
  lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * Math.round(size * leading)}" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(line)}</text>`
    )
    .join('');

// One flat colour: a gradient makes every picture ten times the size
const BACKGROUND = `<rect width="${WIDTH}" height="${HEIGHT}" fill="#4C1D95"/>`;

function brand(x) {
  return `<circle cx="${x + 18}" cy="${HEIGHT - 62}" r="18" fill="#FFFFFF"/>
<text x="${x + 18}" y="${HEIGHT - 57}" font-family="Archivo" font-weight="900" font-size="13" fill="#5B21B6" text-anchor="middle">TFP</text>
<text x="${x + 48}" y="${HEIGHT - 54}" font-family="Archivo" font-weight="800" font-size="22" fill="#FFFFFF" letter-spacing="1">TASK FORCE PURPLE</text>
<text x="${WIDTH - 64}" y="${HEIGHT - 54}" font-family="IBM Plex Mono" font-weight="600" font-size="22" fill="#FFFFFF" text-anchor="end">taskforcepurple.com</text>`;
}

// The receipt panel: the stamp and the graph, as on the member's page
function receipt(tier, ppi) {
  const g = GRADES[tier];
  const x0 = 56;
  const y0 = 56;
  const w = 400;
  const h = HEIGHT - 112;
  const left = x0 + 34;
  const right = x0 + w - 34;
  const top = y0 + 268;
  const base = y0 + 380;
  const col = (right - left) / PARTS.length;
  const pts = PARTS.map((p, i) => ({
    ...p,
    value: ppi[p.key] ?? 0,
    x: left + col * (i + 0.5),
    y: base - ((ppi[p.key] ?? 0) / 100) * (base - top),
  }));
  const curve = monotonePath(pts);
  const word = g.name.toUpperCase();
  const wordLines = word.length > 14 && word.includes(' ') ? word.split(' ') : [word];
  return `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="8" fill="#FFFEFA"/>
<text x="${x0 + w / 2}" y="${y0 + 40}" font-family="IBM Plex Mono" font-weight="600" font-size="16" fill="#15131C" text-anchor="middle" letter-spacing="2">TASK FORCE PURPLE</text>
<g transform="rotate(-8 ${x0 + w / 2} ${y0 + 150})">
<circle cx="${x0 + w / 2}" cy="${y0 + 150}" r="88" fill="none" stroke="${g.color}" stroke-width="9"/>
<text x="${x0 + w / 2}" y="${y0 + 175}" font-family="Archivo" font-weight="900" font-size="96" fill="${g.color}" text-anchor="middle">${esc(tier)}</text>
${wordLines
  .map(
    (l, i) =>
      `<text x="${x0 + w / 2}" y="${y0 + 200 + i * 16}" font-family="IBM Plex Mono" font-weight="600" font-size="${wordLines.length > 1 ? 12 : 14}" fill="${g.color}" text-anchor="middle" letter-spacing="1">${esc(l)}</text>`
  )
  .join('')}
</g>
<line x1="${left}" x2="${right}" y1="${base + 0.5}" y2="${base + 0.5}" stroke="#DDDAD2" stroke-width="1"/>
<defs><linearGradient id="graph" gradientUnits="userSpaceOnUse" x1="${pts[0].x}" x2="${pts[2].x}" y1="0" y2="0">${GRAPH_GRADIENT.map((c, i) => `<stop offset="${i / (GRAPH_GRADIENT.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient><clipPath id="line-ends"><rect x="${pts[0].x}" y="0" width="${pts[2].x - pts[0].x}" height="${base + 2}"/></clipPath></defs>
<path d="${curve} L${pts[2].x},${base} L${pts[0].x},${base} Z" fill="url(#graph)" fill-opacity="0.22"/>
<path d="${curve}" fill="none" stroke="url(#graph)" stroke-width="4" stroke-linejoin="round" clip-path="url(#line-ends)"/>
<circle cx="${right - 16}" cy="${top - 4}" r="16" fill="#FFFEFA" stroke="#3D3A46" stroke-width="2"/>
<text x="${right - 16}" y="${top + 1.5}" font-family="IBM Plex Mono" font-weight="600" font-size="14" fill="#15131C" text-anchor="middle">${esc(CYCLE_SHORT)}</text>
${pts
  .map(
    p => `<text x="${p.x}" y="${base + 30}" font-family="IBM Plex Mono" font-weight="600" font-size="15" fill="#3D3A46" text-anchor="middle">${p.label.toUpperCase()}</text>
<text x="${p.x}" y="${base + 58}" font-family="IBM Plex Mono" font-weight="600" font-size="22" fill="#15131C" text-anchor="middle">${p.value}%</text>`
  )
  .join('')}`;
}

/**
 * A member's card: { eyebrow, headline, sub, tier, ppi }. Without a tier and
 * graph (a withheld grade, or the site's own pages) the text fills the card.
 */
export function cardSvg({ eyebrow, headline, sub, tier = null, ppi = null }) {
  const withGraph = Boolean(tier && GRADES[tier] && ppi);
  const x = withGraph ? 512 : 64;
  const width = WIDTH - x - 64;
  const eye = fit(
    eyebrow.toUpperCase(),
    { family: 'IBM Plex Mono', weight: 600 },
    width,
    1,
    [22, 20, 18, 16, 14]
  );
  // The largest headline at which it, and the line under it, end above the
  // brand line at the foot
  const leading = 0.98;
  const subStyle = { family: 'Public Sans', weight: 400, size: 28 };
  const subLines = sub ? wrap(sub, subStyle, width).slice(0, 2) : [];
  let head;
  let headTop;
  let subTop;
  for (const size of [96, 88, 80, 72, 64, 58, 52, 46]) {
    const lines = wrap(headline.toUpperCase(), { family: 'Archivo', weight: 900, size }, width);
    headTop = 108 + eye.size + size * 0.8;
    subTop = headTop + (lines.length - 1) * Math.round(size * leading) + 54;
    head = { size, lines };
    const bottom = subLines.length ? subTop + (subLines.length - 1) * 36 : subTop - 54;
    if (lines.length <= 4 && bottom <= HEIGHT - 104) {
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
${BACKGROUND}
${withGraph ? receipt(tier, ppi) : ''}
${textLines(eye.lines, { x, y: 92, size: eye.size, leading: 1.2, family: 'IBM Plex Mono', weight: 600, fill: '#DDD3FE' })}
${textLines(head.lines, { x, y: headTop, size: head.size, leading, family: 'Archivo', weight: 900, fill: '#FFFFFF' })}
${textLines(subLines, { x, y: subTop, size: 28, leading: 1.3, family: 'Public Sans', weight: 400, fill: '#EDE9F6' })}
${brand(x)}
</svg>`;
}

/** The card as a PNG */
export function cardPng(card) {
  return new Resvg(cardSvg(card), { font: FONTS, fitTo: { mode: 'width', value: WIDTH } })
    .render()
    .asPng();
}
