// The share card: a 1200x630 picture of someone's receipt and grade, drawn in
// the visitor's browser when they press Share. Nothing is rendered on a
// server, so it costs nothing however many people share.
import { gradeInfo } from './grades.js';

const W = 1200;
const H = 630;
const DISPLAY = '"Archivo Variable", "Arial Narrow", Arial, sans-serif';
const MONO = '"IBM Plex Mono", Menlo, monospace';
const BODY = '"Public Sans Variable", system-ui, sans-serif';

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`900 100px ${DISPLAY}`),
      document.fonts.load(`800 20px ${DISPLAY}`),
      document.fonts.load(`600 20px ${MONO}`),
      document.fonts.load(`400 20px ${MONO}`),
      document.fonts.load(`400 24px ${BODY}`),
    ]);
  } catch {
    // Fallback fonts still make a readable card
  }
}

function stretch(x, value) {
  if ('fontStretch' in x) {
    x.fontStretch = value;
  }
}

// Greedy word wrap; returns the lines
function wrap(x, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (x.measureText(next).width > width && line) {
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

function fitText(x, text, { width, maxLines, start, min, font }) {
  for (let size = start; size >= min; size -= 4) {
    x.font = font(size);
    const lines = wrap(x, text, width);
    if (lines.length <= maxLines && lines.every(l => x.measureText(l).width <= width)) {
      return { size, lines };
    }
  }
  // Never drop words: at the smallest size, take as many lines as it needs
  x.font = font(min);
  return { size: min, lines: wrap(x, text, width) };
}

function dotted(x, x0, x1, y) {
  x.save();
  x.strokeStyle = '#A9A5B0';
  x.setLineDash([1.5, 3]);
  x.beginPath();
  x.moveTo(x0, y);
  x.lineTo(x1, y);
  x.stroke();
  x.restore();
}

function dashed(x, x0, x1, y) {
  x.save();
  x.strokeStyle = '#CFCBC1';
  x.lineWidth = 2;
  x.setLineDash([6, 5]);
  x.beginPath();
  x.moveTo(x0, y);
  x.lineTo(x1, y);
  x.stroke();
  x.restore();
}

function drawReceipt(x, card) {
  const w = 330;
  const lines = card.lines.slice(0, 4);
  const h = 214 + lines.length * 34;
  x.save();
  x.translate(64 + w / 2, 60 + h / 2);
  x.rotate((-3 * Math.PI) / 180);
  x.translate(-w / 2, -h / 2);
  x.shadowColor = 'rgba(0,0,0,0.45)';
  x.shadowBlur = 50;
  x.shadowOffsetY = 26;
  x.fillStyle = '#FFFEFA';
  x.beginPath();
  x.roundRect(0, 0, w, h, 4);
  x.fill();
  x.shadowColor = 'transparent';

  x.fillStyle = '#15131C';
  x.textAlign = 'center';
  x.font = `600 14px ${MONO}`;
  x.fillText('TASK FORCE PURPLE', w / 2, 38);
  x.fillStyle = '#55525E';
  x.font = `400 11px ${MONO}`;
  x.fillText(`RECEIPT · ${card.cycleLabel}`, w / 2, 56);
  dashed(x, 24, w - 24, 74);

  x.textAlign = 'left';
  let y = 104;
  for (const l of lines) {
    x.fillStyle = l.canvas;
    x.fillRect(24, y - 10, 9, 9);
    x.fillStyle = '#15131C';
    x.font = `400 14px ${MONO}`;
    x.fillText(l.short, 42, y);
    const labelEnd = 42 + x.measureText(l.short).width + 8;
    x.font = `600 14px ${MONO}`;
    const value = `${l.pct}%`;
    const vw = x.measureText(value).width;
    x.fillText(value, w - 24 - vw, y);
    dotted(x, labelEnd, w - 24 - vw - 8, y);
    y += 34;
  }
  dashed(x, 24, w - 24, y - 14);
  x.font = `600 17px ${MONO}`;
  x.fillText('TOTAL', 24, y + 14);
  const total = card.total;
  x.fillText(total, w - 24 - x.measureText(total).width, y + 14);

  // the power bar
  let bx = 24;
  const bw = w - 48;
  for (const l of card.lines) {
    x.fillStyle = l.canvas;
    x.fillRect(bx, y + 32, (bw * l.pct) / 100, 14);
    bx += (bw * l.pct) / 100;
  }
  // a barcode from the person's ID, for the look of the thing
  let cx = 24;
  x.fillStyle = '#15131C';
  for (const ch of card.id.repeat(3)) {
    const bar = 1 + (ch.charCodeAt(0) % 4);
    if (cx + bar > w - 24) {
      break;
    }
    x.fillRect(cx, y + 64, bar, 28);
    cx += bar + 3;
  }
  x.restore();
  return 60 + h;
}

function drawStamp(x, g, cx, cy) {
  x.save();
  x.translate(cx, cy);
  x.rotate((-12 * Math.PI) / 180);
  x.beginPath();
  x.arc(0, 0, 84, 0, Math.PI * 2);
  x.fillStyle = 'rgba(255,254,250,0.92)';
  x.fill();
  x.lineWidth = 8;
  x.strokeStyle = g.color;
  x.stroke();
  x.fillStyle = g.color;
  x.textAlign = 'center';
  stretch(x, 'normal');
  x.font = `900 96px ${DISPLAY}`;
  x.fillText(g.mark, 0, 30);
  x.font = `600 13px ${MONO}`;
  x.fillText(g.name.toUpperCase(), 0, 54);
  x.restore();
}

/**
 * card: { id, name, title, tier, lines: [{short, pct, canvas}], total,
 *         headline, sub, host, cycleLabel }
 */
export async function drawShareCard(card) {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  const g = gradeInfo(card.tier);

  // Red into blue, as on the site
  const bg = x.createLinearGradient(0, 0, W, H * 0.4);
  bg.addColorStop(0, '#B4233C');
  bg.addColorStop(0.52, '#5B21B6');
  bg.addColorStop(1, '#1E4FD0');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  const receiptBottom = drawReceipt(x, card);
  // Over the receipt's barcode corner: it must never cover a figure
  drawStamp(x, g, 350, receiptBottom - 12);

  const left = 470;
  const width = W - left - 64;
  x.textAlign = 'left';
  x.fillStyle = '#DDD3FE';
  const eyebrow = `${card.title} ${card.name} · grade ${g.mark}`.toUpperCase();
  const eb = fitText(x, eyebrow, {
    width,
    maxLines: 1,
    start: 18,
    min: 12,
    font: s => `500 ${s}px ${MONO}`,
  });
  x.fillText(eb.lines[0], left, 92);

  x.fillStyle = '#FFFFFF';
  stretch(x, 'extra-condensed');
  const head = fitText(x, card.headline.toUpperCase(), {
    width,
    maxLines: 4,
    start: 104,
    min: 44,
    font: s => `900 ${s}px ${DISPLAY}`,
  });
  let y = 108 + head.size * 0.9;
  for (const line of head.lines) {
    x.fillText(line, left, y);
    y += head.size * 0.88;
  }
  stretch(x, 'normal');

  x.fillStyle = '#EDE9F6';
  x.font = `400 24px ${BODY}`;
  const sub = wrap(x, card.sub, width).slice(0, 2);
  y += 14;
  for (const line of sub) {
    x.fillText(line, left, y);
    y += 32;
  }

  // brand and address
  x.fillStyle = '#FFFFFF';
  x.beginPath();
  x.arc(left + 18, H - 61, 18, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#5B21B6';
  x.textAlign = 'center';
  stretch(x, 'condensed');
  x.font = `900 13px ${DISPLAY}`;
  x.fillText('TFP', left + 18, H - 56);
  stretch(x, 'normal');
  x.textAlign = 'left';
  x.fillStyle = '#FFFFFF';
  stretch(x, 'semi-expanded');
  x.font = `800 20px ${DISPLAY}`;
  x.fillText('TASK FORCE PURPLE', left + 48, H - 54);
  stretch(x, 'normal');
  x.font = `600 22px ${MONO}`;
  x.textAlign = 'right';
  x.fillText(card.host, W - 64, H - 54);
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No image'))), 'image/png')
  );
}
