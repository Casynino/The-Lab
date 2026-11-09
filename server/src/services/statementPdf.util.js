'use strict';

// Shared kit for ZELab's bank-statement-style PDFs (weekly + monthly).
// Handles the header band, section styling, key/value rows, tables and —
// crucially — pagination: every block checks remaining space and opens a new
// page instead of colliding with the footer.

const PDFDocument = require('pdfkit');

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const ACCENT = '#65a30d';
const BAND = '#0f172a';

const fmt = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

// Creates a statement document. Returns drawing helpers plus done() which
// finalizes the doc and resolves to the PDF Buffer.
function createStatement({ title, periodLabel, generatedAt }) {
  const doc = new PDFDocument({ size: 'A4', margin: 46 });
  const chunks = [];
  const buffer = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottomLimit = () => doc.page.height - 90; // keep clear of the footer zone

  // ── Header band (first page) ──
  doc.rect(0, 0, doc.page.width, 92).fill(BAND);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(20).text('ZELAB', left, 26);
  doc.font('Helvetica').fontSize(10).fillColor('#a3e635').text(title, left, 52);
  doc.fillColor('#cbd5e1').fontSize(9).text(`Period: ${periodLabel}`, left, 66);
  doc.text(`Generated: ${generatedAt}`, right - 220, 26, { width: 220, align: 'right' });
  doc.text(require('../config/env').appUrl.replace(/^https?:\/\//, ''), right - 220, 40, { width: 220, align: 'right' });
  doc.y = 112;

  // Start a new page when fewer than `needed` points remain.
  const ensure = (needed) => {
    if (doc.y + needed > bottomLimit()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  const sectionTitle = (t) => {
    ensure(46);
    const y = doc.y + 6;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(t.toUpperCase(), left, y);
    doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.y += 10;
  };

  // Two-column key/value rows, statement style.
  const kvRows = (rows, { bold = [] } = {}) => {
    rows.forEach(([k, v]) => {
      ensure(20);
      const isBold = bold.includes(k);
      const y = doc.y;
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(isBold ? INK : MUTED)
        .text(k, left, y, { width: width * 0.6 });
      doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK)
        .text(v, left + width * 0.6, y, { width: width * 0.4, align: 'right' });
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.y += 6;
    });
  };

  // Simple table with weighted columns; first column left-aligned.
  const table = (headers, rows, weights) => {
    const totalW = weights.reduce((a, b) => a + b, 0);
    const xs = [];
    let x = left;
    weights.forEach((w) => { xs.push(x); x += (w / totalW) * width; });

    const drawHeader = () => {
      const y0 = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
      headers.forEach((h, i) => doc.text(h, xs[i], y0, { width: (weights[i] / totalW) * width - 6, align: i === 0 ? 'left' : 'right' }));
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.y += 6;
    };

    ensure(40);
    drawHeader();
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    rows.forEach((r) => {
      if (doc.y + 18 > bottomLimit()) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        drawHeader();
        doc.font('Helvetica').fontSize(9.5).fillColor(INK);
      }
      const y = doc.y;
      r.forEach((cell, i) => doc.text(String(cell), xs[i], y, { width: (weights[i] / totalW) * width - 6, align: i === 0 ? 'left' : 'right' }));
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.y += 6;
    });
  };

  const bullets = (items, { color = INK } = {}) => {
    items.forEach((t) => {
      ensure(18);
      doc.font('Helvetica').fontSize(9.5).fillColor(color).text(`•  ${t}`, left, doc.y, { width });
      doc.y += 2;
    });
  };

  const paragraph = (text) => {
    ensure(30);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(text, left, doc.y, { width });
    doc.y += 6;
  };

  const done = (footerText) => {
    doc.fontSize(8).fillColor(MUTED)
      .text(footerText, left, doc.page.height - 60, { width, align: 'center' });
    doc.end();
    return buffer;
  };

  return { doc, left, right, width, ensure, sectionTitle, kvRows, table, bullets, paragraph, done, fmt };
}

module.exports = { createStatement, fmt, COLORS: { INK, MUTED, LINE, ACCENT, BAND } };
