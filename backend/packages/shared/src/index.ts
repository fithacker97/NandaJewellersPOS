import { z } from 'zod';
export { z };
export { calculatePrice, inr } from './money.js';
export const metalSchema = z.enum(['GOLD', 'SILVER']);
export const uuidSchema = z.string().uuid();
export const amountSchema = z.string().regex(/^\d{1,9}(\.\d{1,4})?$/, 'Use a nonnegative amount with up to 4 decimals');
export const weightSchema = amountSchema.refine(v => /[1-9]/.test(v), 'Weight must be positive');
export const quantitySchema = z.number().int().min(1).max(100000);
export const productSchema = z.object({
  name: z.string().trim().min(2).max(120), metal: metalSchema, weight: weightSchema,
  surplus: amountSchema, openingQuantity: z.number().int().min(0).max(100000).default(0),
  photoId: uuidSchema.nullable().optional(),
}).strict();
export const productEditSchema = productSchema.omit({ openingQuantity: true }).partial();
export const employeeSchema = z.object({
  name: z.string().trim().min(2).max(100), email: z.string().email().max(160).transform(v => v.toLowerCase()),
  password: z.string().min(12).max(128), gold: amountSchema, silver: amountSchema,
}).strict();
export const customerSchema = z.object({
  customerName: z.string().trim().max(120), customerPhone: z.string().trim().max(30),
  note: z.string().trim().max(1000),
}).strict();
export function normalizeBarcode(raw: string) {
  return raw.trim().replace(/^\*(.*)\*$/, '$1').trim();
}
export function showroomDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
export type Role = 'ADMIN' | 'EMPLOYEE';
export type Metal = 'GOLD' | 'SILVER';
