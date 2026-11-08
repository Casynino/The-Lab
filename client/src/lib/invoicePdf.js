import { jsPDF } from 'jspdf';
import { INVOICE_COMPANY, INVOICE_PAYMENT, INVOICE_TERMS, INVOICE_FOOTER } from './invoiceConfig';

// A clean, print-friendly A4 invoice rendered with jsPDF — reliable output that
// can be downloaded as a file and shared (WhatsApp / native share sheet).
const BRAND = [238, 49, 36]; // Hao Labs red — see lib/brand.js
const DARKGREEN = [60, 90, 16];
const INK = [24, 24, 27];
const MUTED = [110, 110, 120];
const LINE = [208, 212, 220];

const money = (n) => Number(n || 0).toLocaleString('en-US');

export function buildInvoicePdf(inv) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 14;
  const right = W - M;
  let y = 18;

  // ── Company header ──
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...DARKGREEN);
  doc.text(INVOICE_COMPANY.name, W / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTED);
  doc.text(`TIN: ${INVOICE_COMPANY.tin}`, W / 2, y, { align: 'center' });
  y += 4.5;
  doc.text(INVOICE_COMPANY.location, W / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(...BRAND).setLineWidth(0.8);
  doc.line(M, y, right, y);
  doc.setLineWidth(0.2);
  y += 9;

  // ── Bill To + invoice meta ──
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK);
  doc.text('BILL TO', M, y);
  doc.text(inv.number, right, y, { align: 'right' });
  y += 6;
  doc.setFontSize(9.5).setTextColor(...MUTED).setFont('helvetica', 'normal');
  doc.text(`Date: ${inv.date}`, right, y, { align: 'right' });

  const cust = [inv.customer.name];
  if (inv.customer.business) cust.push(inv.customer.business);
  if (inv.customer.phone) cust.push(`Tel: ${inv.customer.phone}`);
  if (inv.customer.tin) cust.push(`TIN: ${inv.customer.tin}`);
  if (inv.customer.location) cust.push(inv.customer.location);
  let cy = y;
  doc.setFontSize(10);
  cust.forEach((linev, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal').setTextColor(...INK);
    doc.text(String(linev), M, cy);
    cy += 5;
  });
  y = Math.max(cy, y + 6) + 4;

  // ── Items table ──
  const cols = { item: M, qty: 120, unit: 158, total: right };
  const headH = 8;
  doc.setFillColor(...BRAND);
  doc.rect(M, y, right - M, headH, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK);
  doc.text('Item', cols.item + 2, y + 5.4);
  doc.text('Qty', cols.qty, y + 5.4, { align: 'right' });
  doc.text('Unit Price (TZS)', cols.unit, y + 5.4, { align: 'right' });
  doc.text('Total (TZS)', cols.total, y + 5.4, { align: 'right' });
  y += headH;

  doc.setFont('helvetica', 'normal').setTextColor(...INK).setFontSize(9.5);
  inv.items.forEach((it) => {
    if (y > 250) { doc.addPage(); y = 20; }
    const rowH = 8;
    let name = String(it.name || '');
    while (doc.getTextWidth(name) > cols.qty - cols.item - 12 && name.length > 4) name = name.slice(0, -2);
    if (name !== it.name) name = `${name.slice(0, -1)}…`;
    doc.text(name, cols.item + 2, y + 5.4);
    doc.text(String(it.qty), cols.qty, y + 5.4, { align: 'right' });
    doc.text(money(it.unitPrice), cols.unit, y + 5.4, { align: 'right' });
    doc.text(money(it.qty * it.unitPrice), cols.total, y + 5.4, { align: 'right' });
    doc.setDrawColor(...LINE);
    doc.line(M, y + rowH, right, y + rowH);
    y += rowH;
  });

  // ── Grand total ──
  y += 2;
  doc.setFillColor(244, 250, 232);
  doc.rect(M, y, right - M, 11, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...DARKGREEN);
  doc.text('GRAND TOTAL', cols.item + 2, y + 7.3);
  doc.text(`${money(inv.total)} TZS`, cols.total, y + 7.3, { align: 'right' });
  y += 11 + 9;

  // ── Payment details ──
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK);
  doc.text(INVOICE_PAYMENT.title, M, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  INVOICE_PAYMENT.lines.forEach(([k, v]) => {
    doc.setTextColor(...MUTED);
    doc.text(`${k}:`, M, y);
    doc.setTextColor(...INK);
    doc.text(v, M + 44, y);
    y += 4.8;
  });
  doc.setTextColor(...MUTED);
  doc.text('Name:', M, y);
  doc.setFont('helvetica', 'bold').setTextColor(...INK);
  doc.text(INVOICE_PAYMENT.accountName, M + 44, y);
  y += 9;

  // ── Terms ──
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK);
  doc.text('TERMS & CONDITIONS', M, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
  INVOICE_TERMS.forEach((t) => {
    const lines = doc.splitTextToSize(`•  ${t}`, right - M);
    doc.text(lines, M, y);
    y += lines.length * 4.4;
  });
  y += 6;

  // ── Footer ──
  doc.setDrawColor(...LINE);
  doc.line(M, y, right, y);
  y += 6;
  doc.setFont('helvetica', 'italic').setFontSize(9.5).setTextColor(...DARKGREEN);
  doc.text(INVOICE_FOOTER, W / 2, y, { align: 'center' });

  return doc;
}

export function invoiceFilename(inv) {
  return `${inv.number}-${(inv.customer.name || 'invoice').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
}

export function invoiceBlob(inv) {
  return buildInvoicePdf(inv).output('blob');
}
