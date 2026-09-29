// Базовые средства построения графиков на canvas: палитра, оси, легенда, подсказки (раздел 2.8 ТЗ)

// Светлая палитра: для экспорта рисунков в пояснительную записку независимо от темы интерфейса
export const LIGHT = {
  panel: '#fcfcfb', grid: '#e1e0d9', axis: '#c3c2b7', text: '#0b0b0b', muted: '#52514e',
  s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', s4: '#eda100', s5: '#e87ba4', s6: '#008300',
  seqLo: '#86b6ef', seqHi: '#0d366b', divNeg: '#2a78d6', divMid: '#f0efec', divPos: '#e34948',
  limit: '#d03b3b', good: '#0ca30c', band: 'rgba(11,11,11,0.05)', ring: '#fcfcfb',
};

const VARS = {
  panel: '--plot-panel', grid: '--plot-grid', axis: '--plot-axis', text: '--plot-text', muted: '--plot-muted',
  s1: '--s1', s2: '--s2', s3: '--s3', s4: '--s4', s5: '--s5', s6: '--s6',
  seqLo: '--seq-lo', seqHi: '--seq-hi', divNeg: '--div-neg', divMid: '--div-mid', divPos: '--div-pos',
  limit: '--plot-limit', good: '--status-good', band: '--plot-band', ring: '--plot-panel',
};

let override = null;

export function setPaletteOverride(p) {
  override = p;
}

export function palette() {
  if (override) return override;
  const s = getComputedStyle(document.documentElement);
  const out = {};
  for (const [k, v] of Object.entries(VARS)) out[k] = (s.getPropertyValue(v) || LIGHT[k]).trim() || LIGHT[k];
  return out;
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Canvas в документе рисуется по его размеру, вне документа — по dataset.w/h/scale (экспорт)
export function prepare(canvas) {
  const inDoc = canvas.isConnected;
  const scale = inDoc ? Math.min(window.devicePixelRatio || 1, 2) : +(canvas.dataset.scale || 1);
  const rect = inDoc
    ? canvas.getBoundingClientRect()
    : { width: +canvas.dataset.w || 1000, height: +canvas.dataset.h || 420 };
  const w = Math.max(Math.round(rect.width), 240);
  const h = Math.max(Math.round(rect.height), 180);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, pal: palette() };
}

// Число с десятичной запятой и типографским минусом
export function fmt(v, d = 2) {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(d);
  return (s.startsWith('-') && Number(s) !== 0 ? '−' + s.slice(1) : s.replace('-', '')).replace('.', ',');
}

export function niceTicks(min, max, target = 5) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + step * 1e-9; t += step) {
    out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return out;
}

export function tickDigits(ticks) {
  if (ticks.length < 2) return 1;
  const step = Math.abs(ticks[1] - ticks[0]);
  return Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
}

export function extent(arrays, pad = 0.06, includeZero = false) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-12) {
    const d = Math.abs(hi) * 0.1 || 1;
    return [lo - d, hi + d];
  }
  const d = (hi - lo) * pad;
  return [includeZero && lo === 0 ? 0 : lo - d, includeZero && hi === 0 ? 0 : hi + d];
}

// Шапка графика: заголовок и строка легенды над областью построения
function header(ctx, pal, cfg, w) {
  ctx.fillStyle = pal.text;
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(cfg.title || '', 14, 9);
  if (cfg.legend && cfg.legend.length) drawLegend(ctx, pal, cfg.legend, 14, 31, w - 14);
}

export function drawLegend(ctx, pal, items, x0, y, maxX) {
  ctx.font = `11.5px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = x0;
  let row = y;
  for (const it of items) {
    const tw = ctx.measureText(it.label).width;
    const need = 26 + tw + 14;
    if (x + need > maxX && x > x0) {
      x = x0;
      row += 17;
    }
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    if (it.kind === 'rect') {
      ctx.beginPath();
      ctx.roundRect(x, row - 5, 14, 10, 2);
      ctx.fill();
    } else if (it.kind === 'dot') {
      ctx.beginPath();
      ctx.arc(x + 7, row, 4, 0, 2 * Math.PI);
      ctx.fill();
    } else if (it.kind === 'ring') {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 7, row, 4, 0, 2 * Math.PI);
      ctx.stroke();
    } else {
      ctx.lineWidth = 2;
      ctx.setLineDash(it.kind === 'dash' ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x, row);
      ctx.lineTo(x + 16, row);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = pal.muted;
    ctx.fillText(it.label, x + 22, row);
    x += need;
  }
  return row;
}

export function legendRows(ctx, items, w) {
  if (!items || !items.length) return 0;
  ctx.font = `11.5px ${FONT}`;
  let x = 14;
  let rows = 1;
  for (const it of items) {
    const need = 26 + ctx.measureText(it.label).width + 14;
    if (x + need > w - 14 && x > 14) {
      x = 14;
      rows++;
    }
    x += need;
  }
  return rows;
}

export function makeAxes(ctx, w, h, pal, cfg) {
  const lrows = legendRows(ctx, cfg.legend, w);
  const top = 30 + (lrows ? lrows * 17 + 6 : 0);
  const pad = Object.assign({ l: 62, r: 16, t: top, b: 42 }, cfg.pad);
  let box = { x0: pad.l, y0: pad.t, x1: w - pad.r, y1: h - pad.b };
  if (cfg.square) {
    const side = Math.min(box.x1 - box.x0, box.y1 - box.y0);
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    box = { x0: cx - side / 2, x1: cx + side / 2, y0: cy - side / 2, y1: cy + side / 2 };
  }
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;

  ctx.fillStyle = pal.panel;
  ctx.fillRect(0, 0, w, h);
  header(ctx, pal, cfg, w);

  const X = (v) => box.x0 + ((v - cfg.xMin) / (cfg.xMax - cfg.xMin)) * bw;
  const Y = (v) => box.y1 - ((v - cfg.yMin) / (cfg.yMax - cfg.yMin)) * bh;
  const invX = (px) => cfg.xMin + ((px - box.x0) / bw) * (cfg.xMax - cfg.xMin);
  const invY = (py) => cfg.yMin + ((box.y1 - py) / bh) * (cfg.yMax - cfg.yMin);

  const xt = cfg.xTicks || niceTicks(cfg.xMin, cfg.xMax, cfg.xTickCount || Math.max(3, Math.round(bw / 90)));
  const yt = cfg.yTicks || niceTicks(cfg.yMin, cfg.yMax, cfg.yTickCount || Math.max(3, Math.round(bh / 55)));
  const xd = tickDigits(xt);
  const yd = tickDigits(yt);

  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.grid;
  ctx.beginPath();
  for (const t of xt) {
    const x = Math.round(X(t)) + 0.5;
    ctx.moveTo(x, box.y0);
    ctx.lineTo(x, box.y1);
  }
  for (const t of yt) {
    const y = Math.round(Y(t)) + 0.5;
    ctx.moveTo(box.x0, y);
    ctx.lineTo(box.x1, y);
  }
  ctx.stroke();

  if (cfg.frame !== false) {
    ctx.strokeStyle = pal.axis;
    ctx.strokeRect(Math.round(box.x0) + 0.5, Math.round(box.y0) + 0.5, Math.round(bw), Math.round(bh));
  }

  ctx.fillStyle = pal.muted;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const fx = cfg.xFormat || ((v) => fmt(v, xd));
  const fy = cfg.yFormat || ((v) => fmt(v, yd));
  for (const t of xt) ctx.fillText(fx(t), X(t), box.y1 + 7);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yt) ctx.fillText(fy(t), box.x0 - 8, Y(t));

  if (cfg.xLabel) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(cfg.xLabel, box.x1, h - 4);
  }
  if (cfg.yLabel) {
    ctx.save();
    ctx.translate(13, (box.y0 + box.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(cfg.yLabel, 0, 0);
    ctx.restore();
  }

  return {
    box, X, Y, invX, invY,
    clip() {
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x0, box.y0, bw, bh);
      ctx.clip();
    },
    unclip() {
      ctx.restore();
    },
    inside(px, py) {
      return px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1;
    },
  };
}

export function shadeBand(ctx, ax, lo, hi, pal) {
  const x0 = Math.max(ax.box.x0, ax.X(lo));
  const x1 = Math.min(ax.box.x1, ax.X(hi));
  if (x1 <= x0) return;
  ctx.fillStyle = pal.band;
  ctx.fillRect(x0, ax.box.y0, x1 - x0, ax.box.y1 - ax.box.y0);
}

export function refLine(ctx, ax, pal, { x, y, color, dash = [6, 4], label, width = 1.5 }) {
  ctx.strokeStyle = color || pal.limit;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  if (y !== undefined) {
    const py = Math.round(ax.Y(y)) + 0.5;
    ctx.moveTo(ax.box.x0, py);
    ctx.lineTo(ax.box.x1, py);
  } else {
    const px = Math.round(ax.X(x)) + 0.5;
    ctx.moveTo(px, ax.box.y0);
    ctx.lineTo(px, ax.box.y1);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = pal.muted;
    ctx.font = `11px ${FONT}`;
    if (y !== undefined) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, ax.box.x1 - 4, ax.Y(y) - 3);
    } else {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, ax.X(x) + 4, ax.box.y0 + 4);
    }
  }
}

export function polyline(ctx, xs, ys, X, Y, color, width = 2, alpha = 1, dash = null) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(ys[i])) {
      started = false;
      continue;
    }
    const px = X(xs[i]);
    const py = Y(ys[i]);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

export function dot(ctx, x, y, r, color, ring) {
  if (ring) {
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Порядковая шкала одного тона: номер состояния → оттенок синего
export function seqColor(pal, t) {
  return mixColor(pal.seqLo, pal.seqHi, Math.max(0, Math.min(1, t)));
}

// Расходящаяся шкала: синий — нейтральный серый — красный, t от −1 до 1
export function divColor(pal, t) {
  const v = Math.max(-1, Math.min(1, t));
  return v < 0 ? mixColor(pal.divMid, pal.divNeg, -v) : mixColor(pal.divMid, pal.divPos, v);
}

// Число без лишних нулей в дробной части: 180 → «180», 5.625 → «5,625»
export function fmtTrim(v, d = 3) {
  const s = String(+v.toFixed(d));
  return (s.startsWith('-') ? '−' + s.slice(1) : s).replace('.', ',');
}
