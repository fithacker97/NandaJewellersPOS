import { calculatePrice } from '@nanda/shared';
import type { Actor } from './auth.js';
import type { Tx } from '../db.js';
import type { Product, EmployeePricing, MetalRate } from '@prisma/client';
export function priceFor(product: Product, rates: MetalRate[], pricing: EmployeePricing | null, actor: Actor, quantity = 1) {
  const base = rates.find(rate => rate.metal === product.metal)?.rate.toString() ?? '0';
  const extra = actor.role === 'EMPLOYEE' ? pricing?.[product.metal === 'GOLD' ? 'gold' : 'silver']?.toString() ?? '0' : '0';
  return { ...calculatePrice(base, product.surplus.toString(), extra, product.weight.toString(), quantity), configured: Number(base) > 0,
    ...(actor.role === 'ADMIN' ? { baseRate: base, productSurplus: product.surplus.toString(), employeeSurplus: extra } : {}) };
}
export async function pricingContext(tx: Tx, actor: Actor) {
  const [rates, pricing] = await Promise.all([tx.metalRate.findMany(), tx.employeePricing.findUnique({ where: { userId: actor.id } })]);
  return { rates, pricing };
}
