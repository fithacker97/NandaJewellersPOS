import { PrismaClient, Prisma } from '@prisma/client';
export const db = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1))); continue;
      }
      throw error;
    }
  }
}
