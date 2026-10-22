import { Decimal } from 'decimal.js';
Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
import { db } from '../db.js';
import type { Actor } from './auth.js';
import { pricingContext, priceFor } from './pricing.js';
import { listProducts } from './catalog.js';
export async function dashboard(actor: Actor) {
  const products = await db.product.findMany({ where: { active: true } });
  const context = await pricingContext(db, actor);
  let pieces = 0; let goldWeight = new Decimal(0); let silverWeight = new Decimal(0); let sellingValue = new Decimal(0);
  for (const product of products) {
    pieces += product.quantity;
    const weight = product.weight.times(product.quantity);
    if (product.metal === 'GOLD') goldWeight = goldWeight.plus(weight); else silverWeight = silverWeight.plus(weight);
    sellingValue = sellingValue.plus(priceFor(product, context.rates, context.pricing, actor, product.quantity).lineTotal);
  }
  const recentProducts = await listProducts(actor, { page: 1, pageSize: 5, sort: 'newest' });
  const recentActivity = await db.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { actor: { select: { name: true } } } });
  const pricesConfigured=products.every(product=>context.rates.some(rate=>rate.metal===product.metal&&rate.rate.gt(0)));
  return { pieces, pricesConfigured, goldWeight: goldWeight.toFixed(4), silverWeight: silverWeight.toFixed(4), sellingValue: sellingValue.toFixed(2), recentProducts,
    recentActivity, ...(actor.role === 'ADMIN' ? { rates: context.rates } : {}) };
}
export function csv(headers: string[], rows: (string | number)[][]) {
  const cell = (value: string | number) => { const text = String(value); return '"' + (/^[\s]*[=+@\-]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"'; };
  return '\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}
export async function inventoryCsv(actor: Actor) {
  const products = await db.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  const context = await pricingContext(db, actor);
  return csv(['Product','Barcode','Metal','Weight per piece','Quantity', ...(actor.role === 'ADMIN' ? ['Product surplus INR/g'] : []), 'Selling rate INR/g','Price per piece INR'],
    products.map(p => { const price = priceFor(p, context.rates, context.pricing, actor); return [p.name,p.barcode,p.metal,p.weight.toString(),p.quantity, ...(actor.role === 'ADMIN' ? [p.surplus.toString()] : []),price.sellingRate,price.piecePrice]; }));
}
export async function movementsCsv() {
  const movements = await db.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true } } } });
  return csv(['Date','Product','Barcode','Metal','Type','Delta','Before','After','Actor','Reference'], movements.map(m => [m.createdAt.toISOString(),m.productName,m.barcode,m.metal,m.type,m.delta,m.before,m.after,m.actor.name,m.reason]));
}
