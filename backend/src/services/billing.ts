import { createHmac } from 'node:crypto';
import { Decimal } from 'decimal.js';
Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
import { db, transaction, type Tx } from '../db.js';
import { config } from '../config.js';
import { AppError, ensure } from '../errors.js';
import type { Actor } from './auth.js';
import { pricingContext, priceFor } from './pricing.js';
import { movement } from './stock.js';
import { audit } from './audit.js';
import { normalizeBarcode } from '@nanda/shared';
async function current(tx: Tx, actor: Actor) {
  return tx.invoiceDraft.upsert({ where: { currentKey: actor.id }, update: {}, create: { userId: actor.id, currentKey: actor.id } });
}
export async function quoteDraft(tx: Tx, actor: Actor, draftId: string) {
  const draft = await tx.invoiceDraft.findFirst({ where: { id: draftId, userId: actor.id }, include: { lines: { include: { product: true }, orderBy: { productId: 'asc' } } } });
  ensure(draft, 404, 'DRAFT_NOT_FOUND', 'Draft unavailable.');
  const context = await pricingContext(tx, actor);
  const lines = draft.lines.map(line => {
    const pricing = priceFor(line.product, context.rates, context.pricing, actor, line.quantity);
    // Explicit projection: employee quotes never contain component prices.
    return { id: line.id, productId: line.productId, productName: line.product.name, barcode: line.product.barcode, metal: line.product.metal,
      weight: line.product.weight.toString(), quantity: line.quantity, available: line.product.quantity, active: line.product.active,
      sellingRate: pricing.sellingRate, piecePrice: pricing.piecePrice, lineTotal: pricing.lineTotal, totalWeight: pricing.totalWeight,
      configured: pricing.configured };
  });
  const freshness = { draftId, revision: draft.revision, lines: draft.lines.map(line => ({ id: line.id, quantity: line.quantity, version: line.product.version, active: line.product.active })),
    rates: context.rates.filter(r => draft.lines.some(line => line.product.metal === r.metal)).map(r => ({ metal: r.metal, rate: r.rate.toString(), updatedAt: r.updatedAt })).sort((a,b) => a.metal.localeCompare(b.metal)),
    pricing: actor.role === 'EMPLOYEE' ? context.pricing : null };
  const quoteToken = createHmac('sha256', config.csrfSecret).update(JSON.stringify(freshness)).digest('hex');
  return { id: draft.id, revision: draft.revision, customerName: draft.customerName, customerPhone: draft.customerPhone, note: draft.note, lines,
    total: lines.reduce((sum, line) => sum.plus(line.lineTotal), new Decimal(0)).toFixed(2),
    totalWeight: lines.reduce((sum, line) => sum.plus(line.totalWeight), new Decimal(0)).toFixed(4),
    totalPieces: lines.reduce((sum, line) => sum + line.quantity, 0), quoteToken };
}
export async function getCurrentDraft(actor: Actor) {
  return transaction(async tx => { const draft = await current(tx, actor); return quoteDraft(tx, actor, draft.id); });
}
export async function scanIntoDraft(tx: Tx, actor: Actor, barcode: string, expectedDraftId?: string) {
    const draft = await current(tx, actor);
    ensure(!expectedDraftId || draft.id === expectedDraftId, 409, 'DRAFT_CLOSED', 'Pair with the current invoice draft again.');
    const product = await tx.product.findUnique({ where: { barcode: normalizeBarcode(barcode) } });
    ensure(product?.active, 404, 'PRODUCT_NOT_FOUND', 'Unknown or archived barcode. Check the tag and try again.');
    const existing = await tx.invoiceDraftLine.findUnique({ where: { draftId_productId: { draftId: draft.id, productId: product.id } } });
    const quantity = (existing?.quantity ?? 0) + 1;
    ensure(quantity <= 100000, 400, 'QUANTITY_LIMIT', 'Use at most 100000 pieces per line.');
    if (!existing) ensure(await tx.invoiceDraftLine.count({ where: { draftId: draft.id } }) < 500, 400, 'LINE_LIMIT', 'Use at most 500 different products per invoice.');
    ensure(product.quantity >= quantity, 409, 'INSUFFICIENT_STOCK', product.quantity ? 'Only ' + product.quantity + ' pieces are available.' : 'This product is out of stock.');
    if (existing) await tx.invoiceDraftLine.update({ where: { id: existing.id }, data: { quantity } });
    else await tx.invoiceDraftLine.create({ data: { draftId: draft.id, productId: product.id, quantity } });
    await tx.invoiceDraft.update({ where: { id: draft.id }, data: { revision: { increment: 1 } } });
    return quoteDraft(tx, actor, draft.id);
}
export async function scanDraft(actor: Actor, barcode: string) {
  return transaction(tx => scanIntoDraft(tx, actor, barcode));
}
export async function updateLine(actor: Actor, id: string, quantity: number | null) {
  return transaction(async tx => {
    const draft = await current(tx, actor);
    const line = await tx.invoiceDraftLine.findFirst({ where: { id, draftId: draft.id } });
    ensure(line, 404, 'LINE_NOT_FOUND', 'Draft line unavailable.');
    if (quantity === null) await tx.invoiceDraftLine.delete({ where: { id } });
    else await tx.invoiceDraftLine.update({ where: { id }, data: { quantity } });
    await tx.invoiceDraft.update({ where: { id: draft.id }, data: { revision: { increment: 1 } } });
    return quoteDraft(tx, actor, draft.id);
  });
}
export async function updateCustomer(actor: Actor, values: { customerName: string; customerPhone: string; note: string }) {
  return transaction(async tx => {
    const draft = await current(tx, actor);
    await tx.invoiceDraft.update({ where: { id: draft.id }, data: { ...values, revision: { increment: 1 } } });
    return quoteDraft(tx, actor, draft.id);
  });
}
export async function discardDraft(actor: Actor) {
  return transaction(async tx => {
    const draft = await current(tx, actor);
    await tx.invoiceDraftLine.deleteMany({ where: { draftId: draft.id } });
    await tx.invoiceDraft.update({ where: { id: draft.id }, data: { customerName: '', customerPhone: '', note: '', revision: { increment: 1 } } });
    return quoteDraft(tx, actor, draft.id);
  });
}
export async function issueInvoice(actor: Actor, input: { draftId: string; issuanceKey: string; quoteToken: string }) {
  return transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    ensure(user?.active && user.role === actor.role, 401, 'SESSION_EXPIRED', 'Your account is unavailable. Sign in again.');
    const prior = await tx.invoice.findFirst({ where: { OR: [{ issuanceKey: input.issuanceKey }, { draftId: input.draftId }] } });
    if (prior) {
      ensure(prior.sellerId === actor.id && prior.draftId === input.draftId, 409, 'ISSUANCE_CONFLICT', 'This issuance key has already been used.');
      return tx.invoice.findUniqueOrThrow({ where: { id: prior.id }, include: { lines: true } });
    }
    const draft = await tx.invoiceDraft.findFirst({ where: { id: input.draftId, userId: actor.id, issuedAt: null, currentKey: actor.id } });
    ensure(draft, 409, 'DRAFT_UNAVAILABLE', 'This draft has already been issued or is unavailable.');
    const quote = await quoteDraft(tx, user, draft.id);
    ensure(quote.lines.length > 0, 400, 'EMPTY_DRAFT', 'Scan at least one product first.');
    ensure(quote.lines.every(line => line.active), 409, 'ARCHIVED_PRODUCT', 'An item was archived. Remove it before issuing the invoice.');
    if (quote.quoteToken !== input.quoteToken) throw new AppError(409, 'PRICE_CHANGED', 'The quote changed. Review the highlighted prices and confirm again.', { quote });
    ensure(quote.lines.every(line => line.configured), 409, 'RATE_NOT_CONFIGURED', 'A metal rate is not configured. Ask an administrator to set it.');
    ensure(quote.lines.every(line => line.available >= line.quantity), 409, 'INSUFFICIENT_STOCK', 'Stock has changed. Review available quantities before issuing.');
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()));
    const seq = await tx.invoiceSequence.upsert({ where: { year }, create: { year, value: 1 }, update: { value: { increment: 1 } } });
    const business = await tx.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
    const invoice = await tx.invoice.create({ data: { number: 'NJ-' + year + '-' + String(seq.value).padStart(6, '0'), issuanceKey: input.issuanceKey,
      draftId: draft.id, sellerId: actor.id, sellerName: user.name, customerName: draft.customerName || 'Walk-in customer',
      customerPhone: draft.customerPhone, note: draft.note, businessName: business.name, businessAddress: business.address, businessPhone: business.phone,
      total: quote.total, totalWeight: quote.totalWeight, totalPieces: quote.totalPieces,
      lines: { create: quote.lines.map(line => ({ productId: line.productId, productName: line.productName, barcode: line.barcode, metal: line.metal,
        weight: line.weight, quantity: line.quantity, sellingRate: line.sellingRate, lineTotal: line.lineTotal })) } }, include: { lines: true } });
    for (const line of quote.lines) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
      const updated = await tx.product.updateMany({ where: { id: line.productId, active: true, quantity: { gte: line.quantity } }, data: { quantity: { decrement: line.quantity }, updatedBy: actor.id } });
      ensure(updated.count === 1, 409, 'INSUFFICIENT_STOCK', 'Another sale changed stock. Please review the draft.');
      await movement(tx, product, actor.id, 'SALE', -line.quantity, invoice.number, invoice.id);
    }
    await tx.invoiceDraft.update({ where: { id: draft.id }, data: { issuedAt: new Date(), currentKey: null } });
    await audit(tx, actor.id, 'INVOICE_ISSUED', invoice.id, { number: invoice.number, total: invoice.total });
    return invoice;
  });
}
export async function findInvoice(actor: Actor, id: string) {
  const invoice = await db.invoice.findFirst({ where: { id, ...(actor.role === 'EMPLOYEE' ? { sellerId: actor.id } : {}) }, include: { lines: true } });
  ensure(invoice, 404, 'INVOICE_NOT_FOUND', 'Invoice unavailable.');
  return invoice;
}
