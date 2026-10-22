import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import type { Invoice, InvoiceLine } from '@prisma/client';
import { showroomDate, inr } from '@nanda/shared';
export const barcodeSvg = (barcode: string) => bwipjs.toSVG({ bcid: 'code39', text: barcode, height: 10, scale: 2, includetext: false, paddingwidth: 12, paddingheight: 3, backgroundcolor: 'FFFFFF' });
export function invoicePdf(invoice: Invoice & { lines: InvoiceLine[] }, res: Response) {
  // Built-in PDF fonts do not contain the rupee glyph; use the unambiguous INR code.
  const money = (value: { toString(): string }) => inr(value.toString()).replace('₹', 'INR ');
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  res.type('application/pdf').attachment(invoice.number + '.pdf'); doc.pipe(res);
  const title = () => { doc.font('Helvetica-Bold').fontSize(20).fillColor('#343027').text(invoice.businessName); doc.font('Helvetica').fontSize(9).text(invoice.businessAddress).text(invoice.businessPhone); doc.moveDown(); doc.fontSize(13).text('Invoice ' + invoice.number); doc.fontSize(9).text(showroomDate(invoice.issuedAt.toISOString())).text('Customer: ' + invoice.customerName + (invoice.customerPhone ? ' | ' + invoice.customerPhone : '')).text('Served by: ' + invoice.sellerName); doc.moveDown(); };
  const heading = () => { const y = doc.y; doc.font('Helvetica-Bold').fontSize(9); doc.text('Product / barcode',40,y,{width:200});doc.text('Weight',246,y,{width:55});doc.text('Qty',304,y,{width:30});doc.text('Rate / g',342,y,{width:85,align:'right'});doc.text('Amount',435,y,{width:120,align:'right'});doc.y=y+23;doc.font('Helvetica'); };
  title(); heading();
  for (const line of invoice.lines) {
    const rowHeight = Math.max(48, doc.heightOfString(line.productName, { width: 195 }) + 30);
    if (doc.y + rowHeight > 735) { doc.addPage(); doc.fontSize(10).text(invoice.businessName + ' · ' + invoice.number);doc.moveDown();heading(); }
    const y = doc.y;
    doc.fontSize(10).text(line.productName,40,y,{width:195});doc.fontSize(8).text(line.barcode + ' | ' + line.metal,40,doc.y+3,{width:200});
    doc.fontSize(9).text(line.weight.toString()+' g',246,y,{width:55});doc.text(String(line.quantity),304,y,{width:30});doc.text(money(line.sellingRate),342,y,{width:85,align:'right'});doc.text(money(line.lineTotal),435,y,{width:120,align:'right'});
    doc.y=y+rowHeight;doc.moveTo(40,doc.y-8).lineTo(555,doc.y-8).strokeColor('#E8E1D5').stroke();
  }
  if (doc.y > 610) doc.addPage();
  doc.moveDown().font('Helvetica-Bold').fontSize(15).text('Total: ' + money(invoice.total),{align:'right'});
  doc.font('Helvetica').fontSize(10).text('Total pieces: '+invoice.totalPieces+'  |  Net weight: '+invoice.totalWeight.toString()+' g',{align:'right'});
  if(invoice.note)doc.moveDown().text('Note: '+invoice.note);
  doc.moveDown().fontSize(9).text('Taxes and making charges are not calculated.').text('Thank you for choosing Nanda Jewellers.');
  const range=doc.bufferedPageRange();
  for(let page=0;page<range.count;page++){doc.switchToPage(page);doc.fontSize(8).text('Page '+(page+1)+' of '+range.count,40,790,{lineBreak:false,align:'center',width:515});}
  doc.end();
}
