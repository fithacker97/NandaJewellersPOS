import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../db.js';
import { config } from '../config.js';
import { ensure } from '../errors.js';
import type { User } from '@prisma/client';
export type Actor = Pick<User, 'id' | 'name' | 'email' | 'role' | 'active'>;
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const csrfToken = (token: string) => createHmac('sha256', config.csrfSecret).update(token).digest('hex');
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export const publicUser = (user: Actor): Actor => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });
export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  // Perform a real hash on unknown users to reduce account enumeration timing.
  const valid = user ? await argon2.verify(user.passwordHash, password) : (await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }), false);
  ensure(user && user.active && valid, 401, 'INVALID_LOGIN', 'Incorrect login details or account unavailable.');
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.sessionHours * 3600000);
  await db.session.create({ data: { id: hashToken(token), userId: user.id, expiresAt } });
  return { token, expiresAt, user: publicUser(user), csrfToken: csrfToken(token) };
}
export async function authenticate(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  return publicUser(session.user);
}
