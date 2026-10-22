import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db, transaction } from '../db.js';
import { ensure } from '../errors.js';
import { normalizeBarcode, type z, productSchema, productEditSchema } from '@nanda/shared';
import type { Actor } from './auth.js';
import { pricingContext, priceFor } from './pricing.js';
import { attachPhoto } from './photos.js';
import { movement } from './stock.js';
import { audit } from './audit.js';
export type ProductInput = z.infer<typeof productSchema>;
export type ProductEdit = z.infer<typeof productEditSchema>;
export async function createProduct(actor: Actor, input: ProductInput) {
  return transaction(async tx => {
    const product = await tx.product.create({ data: { name: input.name, metal: input.metal, weight: input.weight, surplus: input.surplus,
      quantity: input.openingQuantity, barcode: 'NJ' + randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase(), createdBy: actor.id, updatedBy: actor.id } });
    if (input.openingQuantity > 0) await movement(tx, { ...product, quantity: 0 }, actor.id, 'OPENING', input.openingQuantity, 'Opening stock');
    await attachPhoto(tx, product.id, input.photoId, actor.id);
    await audit(tx, actor.id, 'PRODUCT_CREATE', product.id, input);
    return { id: product.id, barcode: product.barcode };
  });
}
export async function editProduct(actor: Actor, id: string, input: ProductEdit) {
  return transaction(async tx => {
    const product = await tx.product.findUnique({ where: { id } });
    ensure(product?.active, 404, 'PRODUCT_UNAVAILABLE', 'Product is archived or unavailable.');
    const { photoId, ...changes } = input;
    await tx.product.update({ where: { id }, data: { ...changes, version: { increment: 1 }, updatedBy: actor.id } });
    await attachPhoto(tx, id, photoId, actor.id);
    await audit(tx, actor.id, 'PRODUCT_EDIT', id, { before: { name: product.name, metal: product.metal, weight: product.weight, surplus: product.surplus }, changes: input });
    return { id };
  });
}
export async function archiveProduct(actor: Actor, id: string, reason: string, expectedQuantity: number) {
  return transaction(async tx => {
    const product = await tx.product.findUnique({ where: { id } });
    ensure(product?.active, 404, 'PRODUCT_UNAVAILABLE', 'Product is already archived or unavailable.');
    ensure(product.quantity === expectedQuantity, 409, 'STOCK_CHANGED', 'Stock changed. Review the pieces to be removed and confirm again.');
    await tx.product.update({ where: { id }, data: { active: false, quantity: 0, version: { increment: 1 }, updatedBy: actor.id } });
    if (product.quantity) await movement(tx, product, actor.id, 'ARCHIVE_REMOVAL', -product.quantity, reason);
    await audit(tx, actor.id, 'PRODUCT_ARCHIVE', id, { removedPieces: product.quantity, reason });
    return { id };
  });
}
export async function listProducts(actor: Actor, input: { q?: string; metal?: 'GOLD' | 'SILVER'; stock?: string; sort: string; page: number; pageSize: number; previewUserId?: string }, id?: string, barcode?: string) {
  const settings = await db.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
  let target = actor;
  if (input.previewUserId) {
    ensure(actor.role === 'ADMIN', 403, 'FORBIDDEN', 'Administrator access required.');
    const employee = await db.user.findUnique({ where: { id: input.previewUserId } });
    ensure(employee && employee.role === 'EMPLOYEE' && employee.active, 404, 'EMPLOYEE_UNAVAILABLE', 'Employee unavailable.');
    target = employee;
  }
  const where: Prisma.ProductWhereInput = {
    active: true, ...(id ? { id } : {}), ...(barcode ? { barcode: normalizeBarcode(barcode) } : {}),
    ...(input.q ? { OR: [{ name: { contains: input.q, mode: 'insensitive' } }, { barcode: { contains: input.q, mode: 'insensitive' } }] } : {}),
    ...(input.metal ? { metal: input.metal } : {}),
    ...(input.stock === 'out' ? { quantity: 0 } : input.stock === 'low' ? { quantity: { gt: 0, lte: settings.lowStockThreshold } } : input.stock === 'in' ? { quantity: { gt: 0 } } : {}),
  };
  const [rows, count, context] = await Promise.all([
    db.product.findMany({ where, include: { photo: true }, orderBy: input.sort === 'name' ? { name: 'asc' } : input.sort === 'quantity' ? { quantity: 'asc' } : input.sort === 'weight' ? { weight: 'asc' } : { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    db.product.count({ where }), pricingContext(db, target),
  ]);
  const items = rows.map(p => ({
    id: p.id, name: p.name, barcode: p.barcode, metal: p.metal, weight: p.weight.toString(), quantity: p.quantity, active: p.active,
    lowStock: p.quantity > 0 && p.quantity <= settings.lowStockThreshold,
    photo: p.photo ? { id: p.photo.id, url: '/api/photos/' + p.photo.id, thumbnailUrl: '/api/photos/' + p.photo.id + '?thumbnail=1' } : null,
    createdAt: p.createdAt, updatedAt: p.updatedAt, ...priceFor(p, context.rates, context.pricing, target),
    ...(actor.role === 'ADMIN' ? { surplus: p.surplus.toString(), createdBy: p.createdBy, updatedBy: p.updatedBy } : {}),
  }));
  if (id || barcode) { ensure(items[0], 404, 'PRODUCT_NOT_FOUND', 'Unknown or archived barcode. Check the tag and try again.'); return items[0]; }
  return { items, count, page: input.page, pageSize: input.pageSize, ...(input.previewUserId ? { preview: { employeeId: target.id, employeeName: target.name, label: 'Admin preview — employee prices' } } : {}) };
}
