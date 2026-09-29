// Экспорт: рисунки PNG, графики и отчёт PDF, данные CSV, конфигурация JSON (раздел 2.9 ТЗ)

import { LIGHT, FONT, setPaletteOverride, palette } from './chart.js';

const APP = 'PhaseShifter Lab';
const DPI = 150;

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function dateText() {
  return new Date().toLocaleString('ru-RU');
}

function blobFrom(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Отрисовка графика вне документа заданного размера, по умолчанию в светлой палитре
export function renderOffscreen(draw, w, h, scale = 1, light = true) {
  const c = document.createElement('canvas');
  c.dataset.w = String(w);
  c.dataset.h = String(h);
  c.dataset.scale = String(scale);
  if (light) setPaletteOverride(LIGHT);
  try {
    draw(c);
  } finally {
    setPaletteOverride(null);
  }
  return c;
}

export async function savePng(draw, name, light = true) {
  const c = renderOffscreen(draw, 680, 400, 2.8, light);
  download(await blobFrom(c, 'image/png'), `${name}_${stamp()}.png`);
}

function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

// PDF из растровых страниц (текст отрисован в canvas, поэтому кириллица не требует шрифтов)
export async function makePdf(pages) {
  const images = [];
  for (const c of pages) {
    const blob = await blobFrom(c, 'image/jpeg', 0.92);
    images.push({ data: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
  }
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const write = (d) => {
    const u8 = typeof d === 'string' ? latin1(d) : d;
    chunks.push(u8);
    pos += u8.length;
  };
  const obj = (num, body) => {
    offsets[num] = pos;
    write(`${num} 0 obj\n${body}\nendobj\n`);
  };

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = images.length;
  const pageIds = [];
  for (let i = 0; i < n; i++) pageIds.push(3 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`);

  for (let i = 0; i < n; i++) {
    const img = images[i];
    const pageId = 3 + i * 3;
    const W = ((img.w * 72) / DPI).toFixed(2);
    const H = ((img.h * 72) / DPI).toFixed(2);
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /XObject << /Im0 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;
    obj(pageId + 1, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
    offsets[pageId + 2] = pos;
    write(`${pageId + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`);
    write(img.data);
    write('\nendstream\nendobj\n');
  }

  const xrefPos = pos;
  const maxObj = 2 + n * 3;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxObj; i++) xref += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
  write(xref);
  write(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// Страницы A4 (альбомная) по два графика
export function plotPages(draws, caption) {
  const pageW = 1754;
  const pageH = 1240;
  const pages = [];
  for (let i = 0; i < draws.length; i += 2) {
    const page = document.createElement('canvas');
    page.width = pageW;
    page.height = pageH;
    const ctx = page.getContext('2d');
    ctx.fillStyle = LIGHT.panel;
    ctx.fillRect(0, 0, pageW, pageH);
    for (let k = 0; k < 2 && draws[i + k]; k++) {
      const c = renderOffscreen(draws[i + k], 860, 291, 1654 / 860, true);
      ctx.drawImage(c, 50, 40 + k * 590);
    }
    ctx.fillStyle = LIGHT.muted;
    ctx.font = `20px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${APP} — ${caption} — ${dateText()}`, pageW - 50, pageH - 20);
    pages.push(page);
  }
  return pages;
}

// Текстовая страница отчёта (A4, книжная)
export function reportPage(info) {
  const c = document.createElement('canvas');
  c.width = 1240;
  c.height = 1754;
  const ctx = c.getContext('2d');
  const pal = LIGHT;
  const M = 80;
  let y = M;
  ctx.fillStyle = pal.panel;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'alphabetic';

  const text = (s, x, size, color = pal.text, weight = '', align = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };
  const section = (title) => {
    y += 10;
    text(title, M, 22, pal.text, '700');
    y += 10;
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(c.width - M, y);
    ctx.stroke();
    y += 28;
  };
  const row = (k, v) => {
    text(k, M, 17, pal.muted);
    text(v, c.width - M, 17, pal.text, '', 'right');
    y += 26;
  };

  text('Протокол измерения параметров фазовращателя', M, 31, pal.text, '700');
  y += 32;
  text(`Программный комплекс «${APP}». Сформирован: ${dateText()}`, M, 17, pal.muted);
  y += 34;

  section('1. Объект измерения');
  for (const [k, v] of info.dutRows) row(k, v);
  section('2. Измерительная система');
  for (const [k, v] of info.sysRows) row(k, v);

  section('3. Результаты измерения');
  const cols = [M, M + 430, M + 590, M + 740, M + 900];
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = 'left';
  ['Параметр', 'Измерено', 'Истинное', 'Норма', 'Заключение'].forEach((s, i) => ctx.fillText(s, cols[i], y));
  y += 26;
  for (const r of info.rows) {
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = pal.text;
    ctx.fillText(r.name, cols[0], y);
    ctx.fillText(r.measText, cols[1], y);
    ctx.fillStyle = pal.muted;
    ctx.fillText(r.trueText, cols[2], y);
    ctx.fillText(r.limitText, cols[3], y);
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = r.info ? pal.muted : r.pass ? '#006300' : pal.limit;
    ctx.fillText(r.info ? 'справочно' : r.pass ? 'годен' : 'не годен', cols[4], y);
    y += 26;
  }
  y += 10;
  text(info.verdict ? 'Заключение: фазовращатель соответствует нормам' : 'Заключение: фазовращатель не соответствует нормам',
    M, 21, info.verdict ? '#006300' : pal.limit, '700');
  y += 26;
  if (info.falseDecision) {
    text(info.falseDecision, M, 16, pal.limit);
    y += 24;
  }

  section('4. Точность измерительной системы');
  for (const [k, v] of info.accRows) row(k, v);

  if (info.notes?.length) {
    section('5. Допущения модели');
    for (const n of info.notes) {
      text(n, M, 15, pal.muted);
      y += 23;
    }
  }
  return c;
}

// Таблица CSV: разделитель «;», десятичная запятая, метка BOM — открывается в Excel без настройки
export function makeCsv(meta, header, rows) {
  const num = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(10)).replace('.', ',') : '') : String(v));
  const lines = meta.map((m) => `# ${m}`);
  lines.push(header.join(';'));
  for (const r of rows) lines.push(r.map(num).join(';'));
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export function saveConfig(params) {
  const blob = new Blob([JSON.stringify({ app: APP, version: 1, params }, null, 2)], { type: 'application/json' });
  download(blob, `fv_config_${stamp()}.json`);
}

export async function loadConfig(file) {
  const data = JSON.parse(await file.text());
  if (!data || typeof data !== 'object' || !data.params) throw new Error('Файл не содержит конфигурацию программы');
  return data.params;
}

export { palette };
