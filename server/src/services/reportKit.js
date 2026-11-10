'use strict';

// ===========================================================================
// REPORT KIT — how every ZELab report PDF (daily, weekly, monthly) is drawn.
//
// Nino, 10 Nov 2026: the PDFs were "not nice and not well designed"; Vegas'
// reports are the standard — a letterhead, headline figures with the change
// against the period before, numbered parts (bars, charts, a profit statement,
// striped tables with totals), and a quiet footer on every page. This is that,
// drawn with PDFKit (no browser, so it runs inside a serverless function).
//
// A report is DATA first — figures and blocks — and this file only draws it:
//
//   const r = createReport({ kind: 'Weekly report', title: 'Weekly business report',
//                            period: '3 – 9 Nov 2026', number: 'ZL-W45-2026', generatedAt });
//   r.figures([{ label, value, sub, delta, invert, tone }, ...]);
//   r.section('Money', 'where it came from and where it went');
//   r.pair(r.statement({ rows }), r.bars({ items }));      // two half-width blocks
//   r.table({ columns, rows, foot });                      // breaks across pages, repeats its head
//   const pdf = await r.done();                            // Buffer
//
// Nothing here calculates money. Every number arrives already worked out by the
// finance / reports services — the same ones the dashboard reads — so a PDF can
// never disagree with the screen. Amounts are TSh, whole shillings.
//
// Fonts: PDFKit's built-in Helvetica (always present, nothing to bundle). It has
// no arrows or emoji, so the little ▲ ▼ are drawn as shapes.
// ===========================================================================

const PDFDocument = require('pdfkit');

// ── the palette: the app's near-black and the logo's red, on paper ───────────
const C = {
  band: '#0e0f11',        // the letterhead
  red: '#ee3124',         // ZELab red
  ink: '#14120e',
  soft: '#6b6355',
  faint: '#9a9183',
  line: '#e6e0d3',
  lineStrong: '#cfc6b3',
  tile: '#f7f4ee',
  zebra: '#faf8f4',
  track: '#efebe3',
  good: '#047857',
  bad: '#be123c',
  amber: '#b45309',
  amberBg: '#fff8eb',
  amberLine: '#f59e0b',
};
// bar colours, in the order a list is drawn: red leads, the rest stay apart from it
const SERIES = ['#ee3124', '#14120e', '#b08a3a', '#4b6584', '#2f8f6b', '#7a5aa6', '#9a9183'];

const PAGE = { w: 595.28, h: 841.89, left: 40, right: 40, top: 46, bottom: 62 };
const W = PAGE.w - PAGE.left - PAGE.right; // 515.28

// ── number words ─────────────────────────────────────────────────────────────
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
const tsh = (v) => `TSh ${n0(v)}`;
// negative money reads (1,234) in a column and -TSh 1,234 on its own
const cell = (v) => (Number(v) < 0 ? `(${n0(-v)})` : n0(v));
function compact(v) {
  const a = Math.abs(Number(v) || 0);
  const s = Number(v) < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)}K`;
  return `${s}${Math.round(a)}`;
}
/** % change against the period before. Null when there is nothing fair to compare with. */
function pct(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!(p > 0)) return null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function createReport({ kind, title, period, number, generatedAt, blurb, logo, author = 'ZELab' }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
    bufferPages: true,
    info: { Title: `${title} — ${period}`, Author: author, Subject: kind, Creator: 'ZELab' },
  });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // PDFKit would add a page by itself whenever text lands inside the bottom
  // margin; pages are added here, by `ensure`, so the margin is taken off.
  doc.page.margins.bottom = 0;
  doc.on('pageAdded', () => { doc.page.margins.bottom = 0; });

  let y = PAGE.top;
  let sectionNo = 0;
  const bottomLimit = () => PAGE.h - PAGE.bottom;

  // ── primitives ─────────────────────────────────────────────────────────────
  // Helvetica (built in) covers Latin text only; a rep named with an emoji or a
  // stray symbol would otherwise print as garbage, so anything outside it goes.
  const safe = (v) => String(v == null ? '' : v).replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, '');
  const setFont = (bold, size) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const widthOf = (str, size, bold) => setFont(bold, size).widthOfString(safe(str));
  const heightOf = (str, w, size, bold, lineGap = 1.5) => setFont(bold, size).heightOfString(safe(str), { width: w, lineGap });
  /** one line, cut with an ellipsis when it would run past w */
  const clip = (str, w, size, bold, spacing = 0) => {
    let t = safe(str);
    if (!w || widthOf(t, size, bold) + spacing * t.length <= w) return t;
    while (t.length > 1 && widthOf(`${t}…`, size, bold) + spacing * (t.length + 1) > w) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  const put = (str, x, yy, { w, size = 9, bold = false, color = C.ink, align = 'left', spacing = 0, lineGap = 1.5, wrap = false } = {}) => {
    setFont(bold, size).fillColor(color);
    if (wrap) doc.text(safe(str), x, yy, { width: w, align, characterSpacing: spacing, lineGap });
    else doc.text(clip(str, w, size, bold, spacing), x, yy, { width: w, align, characterSpacing: spacing, lineBreak: false });
  };
  /** the largest font (down to `min`) at which `str` fits on one line of width w */
  const fitSize = (str, w, start, min, bold) => {
    let s = start;
    while (s > min && widthOf(str, s, bold) > w) s -= 0.5;
    return s;
  };
  const hline = (x1, x2, yy, color = C.line, width = 0.6) => doc.save().lineWidth(width).strokeColor(color).moveTo(x1, yy).lineTo(x2, yy).stroke().restore();
  const triangle = (cx, cy, up, color, size = 3.6) => {
    doc.save().fillColor(color);
    if (up) doc.polygon([cx - size, cy + size * 0.7], [cx + size, cy + size * 0.7], [cx, cy - size * 0.9]);
    else doc.polygon([cx - size, cy - size * 0.7], [cx + size, cy - size * 0.7], [cx, cy + size * 0.9]);
    doc.fill().restore();
  };

  const newPage = () => {
    doc.addPage();
    y = PAGE.top;
  };
  /** make room for `h` points; open a new page if they will not fit */
  const ensure = (h) => {
    if (y + h > bottomLimit()) newPage();
  };

  // ── the letterhead (first page only) ───────────────────────────────────────
  function letterhead() {
    const bandH = 118;
    doc.rect(0, 0, PAGE.w, bandH).fill(C.band);
    doc.rect(0, bandH, PAGE.w, 3.5).fill(C.red);
    if (logo) doc.image(logo, PAGE.left, 26, { height: 40 });
    else put('ZELab', PAGE.left, 30, { size: 24, bold: true, color: '#ffffff' });
    put('We keep Tanzania stocked.', PAGE.left, 74, { size: 8, color: '#8b8678', spacing: 0.4 });
    put('www.zelab.site', PAGE.left, 86, { size: 8, color: '#8b8678' });

    const rx = PAGE.w - PAGE.right - 300;
    put(kind.toUpperCase(), rx, 24, { w: 300, size: 7.5, bold: true, color: C.red, align: 'right', spacing: 2.2 });
    put(title, rx, 38, { w: 300, size: 18, bold: true, color: '#ffffff', align: 'right' });
    put(period, rx, 62, { w: 300, size: 11, color: '#e8e4da', align: 'right' });
    put(`${number}  ·  prepared ${generatedAt}`, rx, 82, { w: 300, size: 7.5, color: '#8b8678', align: 'right' });
    y = bandH + 3.5 + 16;
    if (blurb) {
      put(blurb, PAGE.left, y, { w: W, size: 8, color: C.soft, wrap: true });
      y += heightOf(blurb, W, 8) + 10;
    } else y += 4;
  }

  // ── headline figures ───────────────────────────────────────────────────────
  // figures: [{ label, value, sub, delta (percent|null), invert (up is bad), tone }]
  function figures(list, { perRow = 4 } = {}) {
    const cols = Math.min(perRow, list.length) || 1;
    const rows = Math.ceil(list.length / cols);
    const tileH = 62;
    ensure(rows * tileH + 8);
    const tileW = W / cols;
    const top = y;
    doc.save().roundedRect(PAGE.left, top, W, rows * tileH, 5).fill(C.tile).restore();
    list.forEach((f, i) => {
      const cx = PAGE.left + (i % cols) * tileW;
      const cy = top + Math.floor(i / cols) * tileH;
      const pad = 11;
      put(String(f.label).toUpperCase(), cx + pad, cy + 10, { w: tileW - pad * 2, size: 6.6, bold: true, color: C.faint, spacing: 0.7 });
      const toneColor = f.tone === 'good' ? C.good : f.tone === 'bad' ? C.bad : f.tone === 'red' ? C.red : C.ink;
      const size = fitSize(f.value, tileW - pad * 2, 15, 9, true);
      put(f.value, cx + pad, cy + 22, { w: tileW - pad * 2, size, bold: true, color: toneColor });
      // the change against the period before, then a quiet line under it
      let lx = cx + pad;
      const ly = cy + 43;
      if (f.delta != null) {
        const good = f.invert ? f.delta <= 0 : f.delta >= 0;
        const col = good ? C.good : C.bad;
        triangle(lx + 3.6, ly + 4.2, f.delta >= 0, col, 3.2);
        const label = `${Math.abs(Math.round(f.delta))}%`;
        put(label, lx + 10, ly, { size: 7.6, bold: true, color: col });
        lx += 10 + widthOf(label, 7.6, true) + 6;
      }
      if (f.sub) put(f.sub, lx, ly, { w: cx + tileW - pad - lx, size: 7.2, color: C.soft });
      // hairlines between tiles
      if (i % cols !== cols - 1 && i < list.length) {
        doc.save().lineWidth(0.5).strokeColor('#e7e1d4').moveTo(cx + tileW, cy + 8).lineTo(cx + tileW, cy + tileH - 8).stroke().restore();
      }
      if (Math.floor(i / cols) < rows - 1) hline(cx + 8, cx + tileW - 8, cy + tileH, '#e7e1d4', 0.5);
    });
    y = top + rows * tileH + 14;
  }

  // ── a numbered part ────────────────────────────────────────────────────────
  function section(titleText, subtitle) {
    sectionNo += 1;
    ensure(46);
    put(String(sectionNo).padStart(2, '0'), PAGE.left, y + 2, { size: 8.5, bold: true, color: C.red, spacing: 0.5 });
    put(titleText, PAGE.left + 22, y, { w: W - 22, size: 12.5, bold: true });
    let h = 17;
    if (subtitle) {
      put(subtitle, PAGE.left + 22, y + 16, { w: W - 22, size: 7.8, color: C.faint });
      h = 28;
    }
    hline(PAGE.left, PAGE.left + W, y + h, C.line, 0.7);
    y += h + 10;
  }

  // ── block factories: each returns { h, paint(x, y) } for a given width ─────
  const empty = (text, w) => ({
    h: 38,
    paint: (x, yy) => {
      doc.save().roundedRect(x, yy, w, 34, 5).dash(2, { space: 2 }).lineWidth(0.6).strokeColor(C.lineStrong).stroke().undash().restore();
      put(text || 'Nothing in this period.', x, yy + 12, { w, size: 8.5, color: C.faint, align: 'center' });
    },
  });

  // horizontal bars: [{ label, value, sub, color }]
  function bars({ title: t, items, money = true, w = W, total = true, empty: emptyText, max: forcedMax }) {
    const shown = items.filter((i) => Number(i.value) !== 0);
    const head = t ? 18 : 0;
    if (!shown.length) {
      const e = empty(emptyText, w);
      return { h: head + e.h, paint: (x, yy) => { if (t) put(t, x, yy, { size: 9, bold: true }); e.paint(x, yy + head); } };
    }
    const rowH = 25;
    const sum = shown.reduce((s, i) => s + (Number(i.value) || 0), 0);
    const h = head + shown.length * rowH + (total && shown.length > 1 ? 20 : 0);
    const max = forcedMax || Math.max(1, ...shown.map((i) => Math.abs(i.value)));
    return {
      h,
      paint: (x, yy) => {
        let cy = yy;
        if (t) { put(t, x, cy, { size: 9, bold: true }); cy += head; }
        shown.forEach((it, i) => {
          const col = it.color || SERIES[i % SERIES.length];
          const val = money ? cell(it.value) : n0(it.value);
          const vw = widthOf(val, 9, true);
          doc.save().circle(x + 3, cy + 5, 2.4).fill(col).restore();
          put(it.label, x + 11, cy, { w: w - 18 - vw, size: 8.8, color: C.ink });
          put(val, x + w - vw, cy, { w: vw + 2, size: 9, bold: true, align: 'right' });
          doc.save().roundedRect(x, cy + 14, w, 4.5, 2.2).fill(C.track).restore();
          const fill = Math.max(0, Math.abs(it.value) / max) * w;
          if (fill > 0) doc.save().roundedRect(x, cy + 14, Math.max(4.5, fill), 4.5, 2.2).fill(col).restore();
          cy += rowH;
        });
        if (total && shown.length > 1) {
          hline(x, x + w, cy - 2, C.line);
          put('Total', x, cy + 3, { size: 8.8, bold: true });
          const tv = money ? cell(sum) : n0(sum);
          put(tv, x + w - 120, cy + 3, { w: 120, size: 9, bold: true, align: 'right' });
        }
      },
    };
  }

  // vertical columns over time: [{ label, value, highlight }]
  function columns({ title: t, points, money = true, w = W, height = 112, empty: emptyText, valueLabels }) {
    const head = t ? 18 : 0;
    const all = points.map((p) => Number(p.value) || 0);
    if (!points.length || all.every((v) => v === 0)) {
      const e = empty(emptyText, w);
      return { h: head + e.h, paint: (x, yy) => { if (t) put(t, x, yy, { size: 9, bold: true }); e.paint(x, yy + head); } };
    }
    const labelsOn = valueLabels != null ? valueLabels : points.length <= 12;
    const chartH = height;
    const h = head + chartH + 26;
    const max = Math.max(1, ...all);
    return {
      h,
      paint: (x, yy) => {
        let cy = yy;
        if (t) { put(t, x, cy, { size: 9, bold: true }); cy += head; }
        const base = cy + chartH + (labelsOn ? 0 : 0);
        const top = cy + (labelsOn ? 12 : 4);
        const usable = base - top;
        // the scale: a dashed line at the top, the biggest value written on it
        doc.save().lineWidth(0.5).dash(2, { space: 2.5 }).strokeColor(C.lineStrong).moveTo(x, top).lineTo(x + w, top).stroke().undash().restore();
        if (!labelsOn) put(money ? compact(max) : n0(max), x + w - 60, top - 9.5, { w: 60, size: 6.8, color: C.faint, align: 'right' });
        const gap = Math.min(8, w / points.length / 4);
        const bw = (w - gap * (points.length - 1)) / points.length;
        const hiIdx = points.findIndex((p) => p.highlight);
        const top1 = hiIdx >= 0 ? hiIdx : all.indexOf(max);
        points.forEach((p, i) => {
          const v = all[i];
          const bh = v > 0 ? Math.max(1.5, (v / max) * usable) : 0;
          const bx = x + i * (bw + gap);
          if (bh > 0) {
            doc.save().roundedRect(bx, base - bh, bw, bh, Math.min(2.5, bw / 3)).fill(i === top1 ? C.red : '#2b2824').restore();
            if (labelsOn && bw > 16) put(money ? compact(v) : n0(v), bx - 4, base - bh - 9.5, { w: bw + 8, size: 6.8, color: C.soft, align: 'center' });
          } else {
            doc.save().rect(bx, base - 1, bw, 1).fill(C.line).restore();
          }
          const every = points.length > 16 ? Math.ceil(points.length / 14) : 1;
          if (i % every === 0) put(p.label, bx - 6, base + 5, { w: bw + 12, size: 6.8, color: C.faint, align: 'center' });
        });
        hline(x, x + w, base, C.lineStrong, 0.6);
      },
    };
  }

  // a statement: { rows: [{ label, value, style: sub|total|grand|less|note, text }] }
  function statement({ title: t, rows, w = W }) {
    const head = t ? 18 : 0;
    const rowH = (r) => (r.style === 'grand' ? 25 : r.style === 'total' ? 20 : 17);
    const h = head + rows.reduce((s, r) => s + rowH(r), 0) + 2;
    return {
      h,
      paint: (x, yy) => {
        let cy = yy;
        if (t) { put(t, x, cy, { size: 9, bold: true }); cy += head; }
        rows.forEach((r) => {
          const grand = r.style === 'grand';
          const total = r.style === 'total' || r.style === 'sub';
          const less = r.style === 'less';
          const indent = less || r.style === 'indent';
          if (grand) {
            hline(x, x + w, cy + 1, C.lineStrong, 0.7);
            hline(x, x + w, cy + 3.4, C.lineStrong, 0.7);
          } else if (total) hline(x, x + w, cy, C.lineStrong, 0.6);
          const ty = cy + (grand ? 9 : total ? 5 : 3);
          const color = grand ? (Number(r.value) > 0 ? C.good : Number(r.value) < 0 ? C.bad : C.ink) : less ? C.soft : C.ink;
          put(r.label, x + (indent ? 8 : 0), ty, { w: w - 110, size: grand ? 10.5 : 8.8, bold: grand || r.style === 'total', color: less ? C.soft : C.ink });
          const v = r.text != null ? r.text : cell(r.value);
          put(v, x + w - 120, ty, { w: 120, size: grand ? 11 : 8.8, bold: grand || total, color, align: 'right' });
          cy += rowH(r);
        });
      },
    };
  }

  // little tiles: [{ label, value, sub }]
  function highlights({ items, perRow = 3, w = W }) {
    const cols = Math.min(perRow, items.length) || 1;
    const gap = 8;
    const tw = (w - gap * (cols - 1)) / cols;
    const rows = Math.ceil(items.length / cols);
    const th = 54;
    return {
      h: rows * th + (rows - 1) * gap,
      paint: (x, yy) => {
        items.forEach((it, i) => {
          const tx = x + (i % cols) * (tw + gap);
          const ty = yy + Math.floor(i / cols) * (th + gap);
          doc.save().roundedRect(tx, ty, tw, th, 5).fill(C.tile).restore();
          put(String(it.label).toUpperCase(), tx + 10, ty + 9, { w: tw - 20, size: 6.4, bold: true, color: C.faint, spacing: 0.6 });
          const size = fitSize(it.value, tw - 20, 11.5, 8, true);
          put(it.value, tx + 10, ty + 21, { w: tw - 20, size, bold: true, color: it.tone === 'red' ? C.red : C.ink });
          if (it.sub) put(it.sub, tx + 10, ty + 38, { w: tw - 20, size: 7, color: C.soft });
        });
      },
    };
  }

  // short lines — what needs attention (amber) or plain facts (neutral)
  function callout({ title: t, items, tone = 'insight', w = W }) {
    const pad = 12;
    const lineH = (s) => heightOf(s, w - pad * 2 - 12, 8.6, false, 1.2);
    const bodyH = items.reduce((s, i) => s + lineH(i) + 4, 0);
    const h = 16 + bodyH + 12;
    const attention = tone === 'attention';
    return {
      h,
      paint: (x, yy) => {
        doc.save().roundedRect(x, yy, w, h, 5).fill(attention ? C.amberBg : C.tile).restore();
        if (attention) doc.save().roundedRect(x, yy, w, h, 5).lineWidth(0.7).strokeColor(C.amberLine).stroke().restore();
        put(t.toUpperCase(), x + pad, yy + 10, { size: 6.8, bold: true, color: attention ? C.amber : C.soft, spacing: 1.1 });
        let cy = yy + 24;
        items.forEach((s) => {
          doc.save().circle(x + pad + 2, cy + 4.6, 1.8).fill(attention ? C.amberLine : C.red).restore();
          put(s, x + pad + 12, cy, { w: w - pad * 2 - 12, size: 8.6, wrap: true, lineGap: 1.2 });
          cy += lineH(s) + 4;
        });
      },
    };
  }

  const note = (text, w = W) => ({
    h: heightOf(text, w - 20, 7.8) + 16,
    paint: (x, yy) => {
      doc.save().roundedRect(x, yy, w, heightOf(text, w - 20, 7.8) + 12, 5).fill('#f3efe6').restore();
      put(text, x + 10, yy + 6, { w: w - 20, size: 7.8, color: C.soft, wrap: true });
    },
  });

  // ── placing blocks ─────────────────────────────────────────────────────────
  const add = (block) => {
    ensure(block.h + 8);
    block.paint(PAGE.left, y);
    y += block.h + 14;
  };
  // two blocks side by side (each built with the half width r.half)
  const half = (W - 22) / 2;
  const pair = (a, b) => {
    const h = Math.max(a.h, b.h);
    ensure(h + 8);
    a.paint(PAGE.left, y);
    b.paint(PAGE.left + half + 22, y);
    y += h + 14;
  };

  // ── a table that may run over many pages ───────────────────────────────────
  // columns: [{ label, w (weight), align: 'left'|'right', money, muted }]; rows: arrays; foot: array
  function table({ title: t, columns: cols, rows, foot, empty: emptyText, more }) {
    if (t) { ensure(30); put(t, PAGE.left, y, { size: 9, bold: true }); y += 16; }
    if (!rows.length) { add(empty(emptyText, W)); return; }
    const total = cols.reduce((s, c) => s + (c.w || 1), 0);
    const xs = [];
    const ws = [];
    let acc = PAGE.left;
    cols.forEach((c) => { const cw = ((c.w || 1) / total) * W; xs.push(acc); ws.push(cw); acc += cw; });
    const padX = 5;
    const fmtCell = (v, c) => (v == null || v === '' ? (v === '' ? '' : '—') : typeof v === 'number' ? (c.money ? cell(v) : n0(v)) : String(v));
    const headRow = () => {
      doc.save().rect(PAGE.left, y, W, 17).fill('#f1ede3').restore();
      cols.forEach((c, i) => put(String(c.label).toUpperCase(), xs[i] + padX, y + 5.5, { w: ws[i] - padX * 2, size: 6.4, bold: true, color: C.soft, align: c.align === 'right' ? 'right' : 'left', spacing: 0.5 }));
      y += 17;
    };
    ensure(17 + 24);
    headRow();
    rows.forEach((r, ri) => {
      // the row is as tall as its tallest wrapped cell
      let rh = 0;
      r.forEach((v, i) => { rh = Math.max(rh, heightOf(fmtCell(v, cols[i]), ws[i] - padX * 2, 8.2, i === 0 && cols[i].bold, 1)); });
      rh = Math.max(rh, 11) + 9;
      if (y + rh > bottomLimit() - (foot ? 22 : 0)) { newPage(); headRow(); }
      if (ri % 2 === 1) doc.save().rect(PAGE.left, y, W, rh).fill(C.zebra).restore();
      r.forEach((v, i) => {
        const c = cols[i];
        put(fmtCell(v, c), xs[i] + padX, y + 4.5, { w: ws[i] - padX * 2, size: 8.2, align: c.align === 'right' ? 'right' : 'left', color: c.muted ? C.faint : C.ink, bold: c.bold, wrap: true, lineGap: 1 });
      });
      hline(PAGE.left, PAGE.left + W, y + rh, '#eeeae2', 0.5);
      y += rh;
    });
    if (foot) {
      ensure(24);
      hline(PAGE.left, PAGE.left + W, y, C.lineStrong, 1);
      foot.forEach((v, i) => put(fmtCell(v, cols[i]), xs[i] + padX, y + 6, { w: ws[i] - padX * 2, size: 8.4, bold: true, align: cols[i].align === 'right' ? 'right' : 'left' }));
      y += 22;
    }
    if (more) { put(`…and ${n0(more)} more.`, PAGE.left, y + 4, { size: 7.6, color: C.faint }); y += 16; }
    y += 12;
  }

  // ── close: footers and the running header on every page, then end ──────────
  function done(footerNote) {
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i += 1) {
      doc.switchToPage(range.start + i);
      if (i > 0) {
        put('ZELab', PAGE.left, 22, { size: 7.4, bold: true, color: C.red, spacing: 1.2 });
        put(`${title}  ·  ${period}`, PAGE.left + 42, 22, { w: W - 42, size: 7.4, color: C.faint });
        hline(PAGE.left, PAGE.left + W, 34, C.line, 0.5);
      }
      const fy = PAGE.h - 40;
      hline(PAGE.left, PAGE.left + W, fy - 8, C.line, 0.6);
      put(footerNote || 'Generated automatically by ZELab. Figures come from recorded transactions.', PAGE.left, fy, { w: W - 90, size: 7, color: C.faint });
      put(`Page ${i + 1} of ${total}`, PAGE.left + W - 90, fy, { w: 90, size: 7.4, bold: true, color: C.soft, align: 'right' });
      put(`${number}`, PAGE.left, fy + 11, { w: W, size: 6.8, color: C.faint });
    }
    doc.end();
    return finished;
  }

  letterhead();

  return {
    doc, half, W,
    figures, section, add, pair, table, done,
    bars, columns, statement, highlights, callout, note,
    gap: (h = 8) => { y += h; },
    get y() { return y; },
  };
}

module.exports = { createReport, pct, tsh, n0, cell, compact, C, SERIES, PAGE };
