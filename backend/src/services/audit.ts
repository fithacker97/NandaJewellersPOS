import type { Tx } from '../db.js';
import type { Prisma } from '@prisma/client';
export async function audit(tx: Tx, actorId: string, action: string, entityId: string, details: unknown = {}) {
  await tx.auditLog.create({ data: { actorId, action, entityId, details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue } });
}
