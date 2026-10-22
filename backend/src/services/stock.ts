import type { Product, MovementType } from '@prisma/client';
import { transaction, type Tx } from '../db.js';
import { audit } from './audit.js';
import { ensure } from '../errors.js';
import type { Actor } from './auth.js';
export async function movement(tx: Tx, product: Product, actorId: string, type: MovementType, delta: number, reason: string, invoiceId?: string) {
  await tx.stockMovement.create({ data: { productId: product.id, productName: product.name, barcode: product.barcode,
    metal: product.metal, weight: product.weight, actorId, type, delta, before: product.quantity, after: product.quantity + delta, reason, invoiceId } });
}
export async function changeStock(actor: Actor, input: { productId: string; quantity: number; reference?: string }, adjustment = false) {
  ensure(!adjustment || actor.role === 'ADMIN', 403, 'FORBIDDEN', 'Administrator access required.');
  return transaction(async tx => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    ensure(product?.active, 404, 'PRODUCT_UNAVAILABLE', 'This product is archived or unavailable.');
    const next = product.quantity + input.quantity;
    ensure(next >= 0 && next <= 2147483647, 409, 'INVALID_STOCK', 'The adjustment would make available stock invalid.');
    const updated = await tx.product.updateMany({ where: { id: product.id, active: true, quantity: product.quantity }, data: { quantity: next, updatedBy: actor.id } });
    ensure(updated.count === 1, 409, 'STOCK_CHANGED', 'Stock changed. Refresh and try again.');
    await movement(tx, product, actor.id, adjustment ? 'ADJUSTMENT' : 'RECEIPT', input.quantity, input.reference || 'Stock receipt');
    await audit(tx, actor.id, adjustment ? 'STOCK_ADJUSTMENT' : 'STOCK_RECEIPT', product.id, { delta: input.quantity, reason: input.reference ?? '' });
    return { productId: product.id, quantity: next };
  });
}
