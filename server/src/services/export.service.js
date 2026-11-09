'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const env = require('../config/env');

// Build an .xlsx buffer. `columns` = [{ header, key, width }]. `rows` = array
// of objects keyed by column keys. Optional `totals` object appended as a bold
// footer row.
async function excelBuffer({ sheetName = 'Report', title, columns, rows, totals }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ZELab';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  if (title) {
    ws.mergeCells(1, 1, 1, columns.length);
    const cell = ws.getCell(1, 1);
    cell.value = title;
    cell.font = { size: 14, bold: true };
    ws.addRow([]);
  }

  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width || 18;
  });

  rows.forEach((r) => ws.addRow(columns.map((c) => r[c.key])));

  if (totals) {
    const totalRow = ws.addRow(columns.map((c) => totals[c.key] ?? ''));
    totalRow.font = { bold: true };
  }

  return wb.xlsx.writeBuffer();
}

// Build a PDF buffer with a simple, clean tabular layout.
function pdfBuffer({ title, subtitle, columns, rows, totalsRow }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWeight = columns.reduce((s, c) => s + (c.width || 1), 0);
    const colX = [];
    let x = doc.page.margins.left;
    columns.forEach((c) => {
      colX.push(x);
      x += ((c.width || 1) / totalWeight) * pageWidth;
    });
    const colWidth = (i) =>
      ((columns[i].width || 1) / totalWeight) * pageWidth - 6;

    // Header block
    doc.fontSize(18).fillColor('#0F172A').text('ZELab', { continued: false });
    doc.fontSize(13).fillColor('#334155').text(title);
    if (subtitle) doc.fontSize(9).fillColor('#64748B').text(subtitle);
    doc.fontSize(8).fillColor('#94A3B8').text(
      `Generated ${new Date().toLocaleString(env.business.locale)} • Currency ${env.business.currency}`,
    );
    doc.moveDown(0.5);

    const drawRow = (values, opts = {}) => {
      const rowY = doc.y;
      const fontSize = opts.fontSize || 8;
      doc.fontSize(fontSize).fillColor(opts.color || '#0F172A');
      if (opts.bold) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');

      let maxHeight = fontSize + 4;
      values.forEach((v, i) => {
        const text = v === null || v === undefined ? '' : String(v);
        const h = doc.heightOfString(text, { width: colWidth(i) });
        if (h > maxHeight) maxHeight = h;
      });

      // New page if needed.
      if (rowY + maxHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
      const y = doc.y;
      if (opts.fill) {
        doc.rect(doc.page.margins.left, y - 2, pageWidth, maxHeight + 2).fill(opts.fill);
        doc.fillColor(opts.color || '#FFFFFF');
      }
      values.forEach((v, i) => {
        const text = v === null || v === undefined ? '' : String(v);
        doc.text(text, colX[i] + 2, y, { width: colWidth(i), align: columns[i].align || 'left' });
      });
      doc.y = y + maxHeight + 2;
      doc.font('Helvetica').fillColor('#0F172A');
    };

    drawRow(columns.map((c) => c.header), { bold: true, fill: '#0F172A', color: '#FFFFFF' });
    rows.forEach((r, idx) => {
      drawRow(columns.map((c) => r[c.key]), idx % 2 ? { fill: '#F1F5F9', color: '#0F172A' } : {});
    });
    if (totalsRow) {
      drawRow(columns.map((c) => totalsRow[c.key] ?? ''), { bold: true });
    }

    doc.end();
  });
}

module.exports = { excelBuffer, pdfBuffer };
