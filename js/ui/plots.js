// Типы графиков: линии, столбцы, полярная диаграмма, тепловая карта, гистограмма (раздел 2.8 ТЗ)
//
// Каждая функция рисует график и возвращает обработчик наведения (px, py) → содержимое
// подсказки { title, rows: [{ color, label, value }], cross } или null.

import {
  FONT, prepare, makeAxes, extent, shadeBand, refLine, polyline, dot, fmt, fmtTrim, divColor, niceTicks, tickDigits,
} from './chart.js';

function nearest(xs, v) {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - v) < Math.abs(xs[best] - v)) best = i;
  return best;
}

// Линейный график: серии, «веер» однотипных кривых, полоса, опорные линии, логарифмическая ось
export function lineChart(canvas, cfg) {
  const { ctx, w, h, pal } = prepare(canvas);
  const log = !!cfg.yLog;
  const tr = (v) => (log ? Math.log10(Math.max(v, 1e-12)) : v);

  const series = (cfg.series || []).map((s) => ({ ...s, color: s.color || pal.s1, ty: Array.from(s.y, tr) }));
  const fan = cfg.fan ? { ...cfg.fan, tys: cfg.fan.ys.map((y) => Array.from(y, tr)) } : null;

  const xs = [];
  const ys = [];
  for (const s of series) {
    xs.push(s.x);
    ys.push(s.ty);
  }
  if (fan) {
    xs.push(fan.x);
    for (const y of fan.tys) ys.push(y);
  }
  for (const l of cfg.hLines || []) if (l.scale !== false) ys.push([tr(l.y)]);

  const [xMin, xMax] = cfg.xMin !== undefined ? [cfg.xMin, cfg.xMax] : extent(xs, 0);
  let [yMin, yMax] = extent(ys, 0.08, !!cfg.includeZero);
  if (cfg.yMin !== undefined) yMin = tr(cfg.yMin);
  if (cfg.yMax !== undefined) yMax = tr(cfg.yMax);
  if (log) {
    yMin = Math.floor(yMin);
    yMax = Math.ceil(yMax);
  }

  const legend = [];
  for (const s of series) if (s.label && s.legend !== false) legend.push({ label: s.label, color: s.color, kind: s.dash ? 'dash' : s.markers === 'only' ? 'dot' : 'line' });
  for (const l of cfg.hLines || []) if (l.legend) legend.push({ label: l.legend, color: l.color || pal.limit, kind: 'dash' });
  if (cfg.extraLegend) legend.push(...cfg.extraLegend);

  let yTicks = cfg.yTicks;
  let yFormat = cfg.yFormat;
  if (log) {
    yTicks = [];
    for (let d = yMin; d <= yMax; d++) yTicks.push(d);
    yFormat = (v) => fmt(10 ** v, Math.max(0, -Math.round(v)));
  }

  const ax = makeAxes(ctx, w, h, pal, {
    title: cfg.title, legend, xLabel: cfg.xLabel, yLabel: cfg.yLabel,
    xMin, xMax, yMin, yMax, xFormat: cfg.xFormat, yFormat, yTicks, xTicks: cfg.xTicks,
  });

  ax.clip();
  if (cfg.band) shadeBand(ctx, ax, cfg.band[0], cfg.band[1], pal);
  if (fan) {
    for (let i = 0; i < fan.tys.length; i++) {
      polyline(ctx, fan.x, fan.tys[i], ax.X, ax.Y, fan.colorAt(i, pal), fan.width || 1.2, fan.alpha ?? 0.9);
    }
  }
  for (const l of cfg.hLines || []) refLine(ctx, ax, pal, { ...l, y: tr(l.y) });
  for (const l of cfg.vLines || []) refLine(ctx, ax, pal, l);
  for (const s of series) {
    if (s.markers !== 'only') polyline(ctx, s.x, s.ty, ax.X, ax.Y, s.color, s.width || 2, s.alpha ?? 1, s.dash || null);
    if (s.markers) {
      const r = s.markerSize || 3;
      for (let i = 0; i < s.x.length; i++) {
        if (Number.isFinite(s.ty[i])) dot(ctx, ax.X(s.x[i]), ax.Y(s.ty[i]), r, s.color, s.ring ? pal.panel : null);
      }
    }
  }
  ax.unclip();

  const fx = cfg.hoverX || ((v) => fmt(v, 3));
  const fy = cfg.hoverY || ((v) => fmt(v, 3));
  return (px, py) => {
    if (!ax.inside(px, py)) return null;
    const xv = ax.invX(px);
    const rows = [];
    let cross = null;
    for (const s of series) {
      if (s.hover === false) continue;
      const i = nearest(s.x, xv);
      if (cross === null) cross = ax.X(s.x[i]);
      rows.push({ color: s.color, label: s.label || '', value: fy(s.y[i]) });
    }
    if (fan) {
      const i = nearest(fan.x, xv);
      if (cross === null) cross = ax.X(fan.x[i]);
      const yv = ax.invY(py);
      let best = 0;
      for (let k = 1; k < fan.tys.length; k++) {
        if (Math.abs(fan.tys[k][i] - yv) < Math.abs(fan.tys[best][i] - yv)) best = k;
      }
      rows.unshift({ color: fan.colorAt(best, pal), label: fan.labelOf(best), value: fy(fan.ys[best][i]) });
    }
    const i0 = series.length ? nearest(series[0].x, xv) : nearest(fan.x, xv);
    const xval = series.length ? series[0].x[i0] : fan.x[i0];
    return { title: fx(xval), rows, cross };
  };
}

// Столбчатая диаграмма: группы столбцов, маркеры, опорные линии
export function barChart(canvas, cfg) {
  const { ctx, w, h, pal } = prepare(canvas);
  const n = cfg.count;
  const groups = cfg.groups || [];
  const markers = cfg.markers || [];
  const all = [...groups.map((g) => g.values), ...markers.map((m) => m.values)];
  for (const l of cfg.hLines || []) if (l.scale !== false) all.push([l.y]);
  let [yMin, yMax] = extent(all, 0.1, true);
  if (cfg.yMin !== undefined) yMin = cfg.yMin;
  if (cfg.yMax !== undefined) yMax = cfg.yMax;

  const legend = [
    ...groups.filter((g) => g.label).map((g) => ({ label: g.label, color: g.color, kind: 'rect' })),
    ...markers.filter((m) => m.label).map((m) => ({ label: m.label, color: m.color, kind: m.shape || 'ring' })),
    ...(cfg.hLines || []).filter((l) => l.legend).map((l) => ({ label: l.legend, color: l.color || pal.limit, kind: 'dash' })),
  ];

  const ax = makeAxes(ctx, w, h, pal, {
    title: cfg.title, legend, xLabel: cfg.xLabel, yLabel: cfg.yLabel,
    xMin: -0.5, xMax: n - 0.5, yMin, yMax,
    xTicks: cfg.xTicks || niceTicks(0, n - 1, Math.min(n, 10)).filter((t) => Number.isInteger(t)),
    xFormat: cfg.xFormat || ((v) => String(v)),
    yFormat: cfg.yFormat,
  });

  const slot = (ax.box.x1 - ax.box.x0) / n;
  const gw = Math.max(1, Math.min(24, (slot * 0.8) / Math.max(groups.length, 1) - 2));
  const base = ax.Y(Math.max(yMin, Math.min(0, yMax)));

  ax.clip();
  for (const l of cfg.hLines || []) if (l.behind) refLine(ctx, ax, pal, l);
  groups.forEach((g, gi) => {
    ctx.fillStyle = g.color;
    for (let i = 0; i < n; i++) {
      const v = g.values[i];
      if (!Number.isFinite(v)) continue;
      const cx = ax.X(i) + (gi - (groups.length - 1) / 2) * (gw + 2);
      const y = ax.Y(v);
      const top = Math.min(y, base);
      const hh = Math.max(Math.abs(y - base), 0.5);
      const r = Math.min(4, hh / 2, gw / 2);
      ctx.beginPath();
      ctx.roundRect(cx - gw / 2, top, gw, hh, v >= 0 ? [r, r, 0, 0] : [0, 0, r, r]);
      ctx.fill();
    }
  });
  ctx.strokeStyle = pal.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax.box.x0, Math.round(base) + 0.5);
  ctx.lineTo(ax.box.x1, Math.round(base) + 0.5);
  ctx.stroke();
  for (const l of cfg.hLines || []) if (!l.behind) refLine(ctx, ax, pal, l);
  for (const m of markers) {
    const r = Math.max(2.5, Math.min(4, slot / 3));
    for (let i = 0; i < n; i++) {
      const v = m.values[i];
      if (!Number.isFinite(v)) continue;
      const x = ax.X(i);
      const y = ax.Y(v);
      if (m.shape === 'dot') {
        dot(ctx, x, y, r, m.color, pal.panel);
      } else {
        ctx.strokeStyle = pal.panel;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }
  ax.unclip();

  const fy = cfg.hoverY || ((v) => fmt(v, 3));
  return (px, py) => {
    if (!ax.inside(px, py)) return null;
    const i = Math.max(0, Math.min(n - 1, Math.round(ax.invX(px))));
    const rows = [
      ...groups.map((g) => ({ color: g.color, label: g.label || '', value: fy(g.values[i]) })),
      ...markers.map((m) => ({ color: m.color, label: m.label || '', value: fy(m.values[i]) })),
    ];
    return { title: cfg.labelOf ? cfg.labelOf(i) : String(i), rows, cross: ax.X(i) };
  };
}

// Полярная диаграмма фазовых состояний; отклонения от идеала увеличиваются в gain раз
export function polarChart(canvas, cfg) {
  const { ctx, w, h, pal } = prepare(canvas);
  const g = cfg.gain;
  const legend = [
    { label: 'идеальные состояния', color: pal.muted, kind: 'ring' },
    { label: 'измерено', color: pal.s1, kind: 'dot' },
    { label: 'истинное значение', color: pal.s2, kind: 'ring' },
  ];
  const rMax = 1 + Math.max(0.12, cfg.maxDev * g * 1.1);
  const labR = rMax + 0.16;
  const lim = labR + 0.1;
  const ax = makeAxes(ctx, w, h, pal, {
    title: cfg.title, legend, xMin: -lim, xMax: lim, yMin: -lim, yMax: lim, square: true,
    xTicks: [], yTicks: [], pad: { l: 20, r: 20, b: 22 }, frame: false,
  });

  const cx = ax.X(0);
  const cy = ax.Y(0);
  const R = ax.X(1) - cx;
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  for (const rr of [0.5, 1, rMax]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * rr, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = pal.muted;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let a = 0; a < 360; a += 45) {
    const t = (a * Math.PI) / 180;
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * rMax * Math.cos(t), cy - R * rMax * Math.sin(t));
    ctx.stroke();
    ctx.fillText(`${a}°`, cx + R * labR * Math.cos(t), cy - R * labR * Math.sin(t));
  }

  const pos = (ideal, err, amp) => {
    const r = 1 + (amp - 1) * g;
    const t = ((ideal + err * g) * Math.PI) / 180;
    return [cx + R * r * Math.cos(t), cy - R * r * Math.sin(t)];
  };
  const pts = cfg.states.map((s) => ({
    ...s,
    pi: pos(s.ideal, 0, 1),
    pm: pos(s.ideal, s.errM, s.ampM),
    pt: pos(s.ideal, s.errT, s.ampT),
  }));

  const small = pts.length > 32;
  for (const p of pts) {
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.pi[0], p.pi[1]);
    ctx.lineTo(p.pm[0], p.pm[1]);
    ctx.stroke();
  }
  for (const p of pts) {
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.pi[0], p.pi[1], small ? 2 : 3, 0, 2 * Math.PI);
    ctx.stroke();
  }
  for (const p of pts) {
    ctx.strokeStyle = pal.s2;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.pt[0], p.pt[1], small ? 3.5 : 4.5, 0, 2 * Math.PI);
    ctx.stroke();
  }
  for (const p of pts) dot(ctx, p.pm[0], p.pm[1], small ? 2.5 : 3.5, pal.s1, pal.panel);

  if (g !== 1) {
    ctx.fillStyle = pal.muted;
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const word = [2, 3, 4].includes(g % 10) && ![12, 13, 14].includes(g % 100) ? "раза" : "раз";
    ctx.fillText(`отклонения увеличены в ${g} ${word}`, w - 12, h - 6);
  }

  return (px, py) => {
    let best = -1;
    let bd = 24 * 24;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i].pm[0] - px) ** 2 + (pts[i].pm[1] - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const s = pts[best];
    return {
      title: `Состояние ${s.code} (${fmtTrim(s.ideal)}°)`,
      rows: [
        { color: pal.s1, label: 'измерено', value: `${fmt(s.ideal + s.errM, 2)}°, ${fmt(20 * Math.log10(s.ampM), 3)} дБ` },
        { color: pal.s2, label: 'истинное', value: `${fmt(s.ideal + s.errT, 2)}°, ${fmt(20 * Math.log10(s.ampT), 3)} дБ` },
      ],
    };
  };
}

// Тепловая карта ошибки фазы: по горизонтали частота, по вертикали номер состояния
export function heatmap(canvas, cfg) {
  const { ctx, w, h, pal } = prepare(canvas);
  const { x, rows: nRows, z } = cfg;
  const nf = x.length;
  let zmax = 0;
  for (let i = 0; i < z.length; i++) zmax = Math.max(zmax, Math.abs(z[i]));
  zmax = zmax > 0 ? zmax : 1;
  const zt = niceTicks(0, zmax, 3);
  const zLim = zt[zt.length - 1] >= zmax ? zt[zt.length - 1] : zmax;

  const df = nf > 1 ? (x[nf - 1] - x[0]) / (nf - 1) : 1;
  const ax = makeAxes(ctx, w, h, pal, {
    title: cfg.title, xLabel: cfg.xLabel, yLabel: cfg.yLabel,
    xMin: x[0] - df / 2, xMax: x[nf - 1] + df / 2, yMin: -0.5, yMax: nRows - 0.5,
    xFormat: cfg.xFormat, pad: { r: 78 },
    yTicks: niceTicks(0, nRows - 1, 6).filter((t) => Number.isInteger(t)),
    yFormat: (v) => String(v),
  });

  const cw = Math.abs(ax.X(x[0] + df) - ax.X(x[0]));
  const ch = Math.abs(ax.Y(1) - ax.Y(0));
  for (let k = 0; k < nRows; k++) {
    for (let fi = 0; fi < nf; fi++) {
      ctx.fillStyle = divColor(pal, z[k * nf + fi] / zLim);
      ctx.fillRect(ax.X(x[fi]) - cw / 2, ax.Y(k) - ch / 2, cw + 0.6, ch + 0.6);
    }
  }
  if (cfg.band) {
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const b of cfg.band) {
      const px = Math.round(ax.X(b)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, ax.box.y0);
      ctx.lineTo(px, ax.box.y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = pal.axis;
  ctx.strokeRect(Math.round(ax.box.x0) + 0.5, Math.round(ax.box.y0) + 0.5,
    Math.round(ax.box.x1 - ax.box.x0), Math.round(ax.box.y1 - ax.box.y0));

  const bx = ax.box.x1 + 18;
  const by0 = ax.box.y0;
  const by1 = ax.box.y1;
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    const t = 1 - (2 * i) / (steps - 1);
    ctx.fillStyle = divColor(pal, t);
    ctx.fillRect(bx, by0 + ((by1 - by0) * i) / steps, 12, (by1 - by0) / steps + 1);
  }
  ctx.fillStyle = pal.muted;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const d = tickDigits(zt);
  for (const v of [-zLim, 0, zLim]) {
    ctx.fillText(`${fmt(v, d)}${cfg.unit || ''}`, bx + 16, by0 + ((by1 - by0) * (1 - (v / zLim + 1) / 2)));
  }

  return (px, py) => {
    if (!ax.inside(px, py)) return null;
    const fi = nearest(x, ax.invX(px));
    const k = Math.max(0, Math.min(nRows - 1, Math.round(ax.invY(py))));
    return {
      title: cfg.cellTitle ? cfg.cellTitle(k, fi) : `${k}, ${fi}`,
      rows: [{ color: divColor(pal, z[k * nf + fi] / zLim), label: cfg.valueLabel || '', value: `${fmt(z[k * nf + fi], 2)}${cfg.unit || ''}` }],
    };
  };
}

// Гистограмма результатов Монте-Карло с отметками истинного значения и интервала
export function histogram(canvas, cfg) {
  const { ctx, w, h, pal } = prepare(canvas);
  const v = Array.from(cfg.values);
  let lo = Math.min(...v, cfg.trueValue);
  let hi = Math.max(...v, cfg.trueValue);
  if (hi - lo < 1e-9) {
    lo -= 0.01;
    hi += 0.01;
  }
  const nb = Math.max(8, Math.min(30, Math.round(Math.sqrt(v.length) * 1.6)));
  const bw = (hi - lo) / nb;
  const counts = new Array(nb).fill(0);
  for (const x of v) counts[Math.min(nb - 1, Math.floor((x - lo) / bw))]++;
  const legend = [
    { label: 'измерения в прогонах', color: pal.s1, kind: 'rect' },
    { label: 'истинное значение', color: pal.s2, kind: 'line' },
    { label: 'интервал 95 %', color: pal.muted, kind: 'dash' },
  ];
  const ax = makeAxes(ctx, w, h, pal, {
    title: cfg.title, legend, xLabel: cfg.xLabel, yLabel: 'число прогонов',
    xMin: lo - bw, xMax: hi + bw, yMin: 0, yMax: Math.max(...counts) * 1.15,
  });
  ax.clip();
  ctx.fillStyle = pal.s1;
  for (let i = 0; i < nb; i++) {
    if (!counts[i]) continue;
    const x0 = ax.X(lo + i * bw) + 1;
    const x1 = ax.X(lo + (i + 1) * bw) - 1;
    const y = ax.Y(counts[i]);
    const r = Math.min(4, (x1 - x0) / 2);
    ctx.beginPath();
    ctx.roundRect(x0, y, Math.max(1, x1 - x0), ax.box.y1 - y, [r, r, 0, 0]);
    ctx.fill();
  }
  refLine(ctx, ax, pal, { x: cfg.lo, color: pal.muted });
  refLine(ctx, ax, pal, { x: cfg.hi, color: pal.muted });
  refLine(ctx, ax, pal, { x: cfg.trueValue, color: pal.s2, dash: [], width: 2 });
  ax.unclip();

  return (px, py) => {
    if (!ax.inside(px, py)) return null;
    const i = Math.floor((ax.invX(px) - lo) / bw);
    if (i < 0 || i >= nb) return null;
    return {
      title: `${fmt(lo + i * bw, 3)} … ${fmt(lo + (i + 1) * bw, 3)}${cfg.unit || ''}`,
      rows: [{ color: pal.s1, label: 'прогонов', value: String(counts[i]) }],
    };
  };
}

// Горизонтальные столбцы: вклад источников погрешности
export function hbarChart(canvas, cfg) {
  const { ctx, w, h, pal } = prepare(canvas);
  const items = cfg.items;
  const vmax = Math.max(...items.map((i) => i.value), 1e-9) * 1.18;
  ctx.font = `12px ${FONT}`;
  const labelW = Math.min(w * 0.45, Math.max(...items.map((i) => ctx.measureText(i.label).width)) + 18);
  const ax = makeAxes(ctx, w, h, pal, {
    title: cfg.title, xLabel: cfg.xLabel, xMin: 0, xMax: vmax, yMin: -0.5, yMax: items.length - 0.5,
    yTicks: [], pad: { l: labelW + 10 },
  });
  const slot = (ax.box.y1 - ax.box.y0) / items.length;
  const bh = Math.min(22, slot * 0.62);
  items.forEach((it, i) => {
    const y = ax.box.y0 + slot * (i + 0.5);
    ctx.fillStyle = pal.text;
    ctx.font = `${it.strong ? '600 ' : ''}12px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, ax.box.x0 - 10, y);
    const x1 = ax.X(it.value);
    if (it.value > 0) {
      ctx.fillStyle = it.color;
      const r = Math.min(4, (x1 - ax.box.x0) / 2);
      ctx.beginPath();
      ctx.roundRect(ax.box.x0, y - bh / 2, Math.max(1, x1 - ax.box.x0), bh, [0, r, r, 0]);
      ctx.fill();
    }
    ctx.fillStyle = pal.muted;
    ctx.font = `11.5px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(it.text, Math.max(x1, ax.box.x0) + 6, y);
  });

  return (px, py) => {
    if (!ax.inside(px, py)) return null;
    const i = Math.floor((py - ax.box.y0) / slot);
    if (i < 0 || i >= items.length) return null;
    return { title: items[i].label, rows: [{ color: items[i].color, label: cfg.valueLabel || '', value: items[i].text }] };
  };
}
