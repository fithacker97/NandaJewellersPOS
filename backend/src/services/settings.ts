import argon2 from 'argon2';
import { db, transaction } from '../db.js';
import { ensure } from '../errors.js';
import { audit } from './audit.js';
import type { Actor } from './auth.js';
import type { Metal } from '@prisma/client';
export async function updateRates(actor: Actor, values: { gold: string; silver: string }) {
  return transaction(async tx => {
    for (const metal of ['GOLD', 'SILVER'] as Metal[]) {
      const old = await tx.metalRate.findUniqueOrThrow({ where: { metal } });
      const rate = values[metal === 'GOLD' ? 'gold' : 'silver'];
      await tx.metalRate.update({ where: { metal }, data: { rate, updatedBy: actor.id } });
      await tx.metalRateHistory.create({ data: { metal, previous: old.rate, rate, actorId: actor.id } });
      await audit(tx, actor.id, 'BASE_RATE_CHANGE', metal, { before: old.rate, rate });
    }
    return { saved: true };
  });
}
export async function createEmployee(actor: Actor, values: { name: string; email: string; password: string; gold: string; silver: string }) {
  const passwordHash = await argon2.hash(values.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  return transaction(async tx => {
    const employee = await tx.user.create({ data: { name: values.name, email: values.email, passwordHash, role: 'EMPLOYEE',
      pricing: { create: { gold: values.gold, silver: values.silver, updatedBy: actor.id } } } });
    await audit(tx, actor.id, 'EMPLOYEE_CREATE', employee.id, { name: values.name, email: values.email, gold: values.gold, silver: values.silver });
    return { id: employee.id };
  });
}
export async function editEmployee(actor: Actor, id: string, values: { name?: string; active?: boolean }) {
  return transaction(async tx => {
    const employee = await tx.user.findUnique({ where: { id } });
    ensure(employee?.role === 'EMPLOYEE', 404, 'EMPLOYEE_UNAVAILABLE', 'Employee not found.');
    await tx.user.update({ where: { id }, data: values });
    if (values.active === false) { await tx.session.deleteMany({ where: { userId: id } }); await tx.scannerLink.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }); }
    await audit(tx, actor.id, 'EMPLOYEE_EDIT', id, values);
    return { id };
  });
}
export async function employeePricing(actor: Actor, id: string, values: { gold: string; silver: string }) {
  return transaction(async tx => {
    const employee = await tx.user.findUnique({ where: { id } });
    ensure(employee?.role === 'EMPLOYEE', 404, 'EMPLOYEE_UNAVAILABLE', 'Employee not found.');
    const before = await tx.employeePricing.findUnique({ where: { userId: id } });
    await tx.employeePricing.upsert({ where: { userId: id }, create: { userId: id, ...values, updatedBy: actor.id }, update: { ...values, updatedBy: actor.id } });
    await audit(tx, actor.id, 'EMPLOYEE_PRICING', id, { before: before ? { gold: before.gold, silver: before.silver } : null, after: values });
    return { id };
  });
}
export async function resetEmployeePassword(actor: Actor, id: string, adminPassword: string, newPassword: string) {
  const admin = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  ensure(await argon2.verify(admin.passwordHash, adminPassword), 403, 'REAUTH_REQUIRED', 'Administrator password did not match.');
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  return transaction(async tx => {
    const employee = await tx.user.findUnique({ where: { id } });
    ensure(employee?.role === 'EMPLOYEE', 404, 'EMPLOYEE_UNAVAILABLE', 'Employee not found.');
    await tx.user.update({ where: { id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.scannerLink.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, actor.id, 'EMPLOYEE_PASSWORD_RESET', id);
    return { id };
  });
}
export async function updateBusiness(actor: Actor, values: { name: string; address: string; phone: string; lowStockThreshold: number }) {
  return transaction(async tx => {
    await tx.businessSettings.update({ where: { id: 1 }, data: { ...values, updatedBy: actor.id } });
    await audit(tx, actor.id, 'BUSINESS_SETTINGS', '1', values);
    return { saved: true };
  });
}
