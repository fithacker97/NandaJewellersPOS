import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db.js';
import { AppError, ensure } from '../errors.js';
import { storage } from './storage.js';
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export async function decodePhoto(buffer: Buffer) {
  ensure(buffer.length <= MAX_PHOTO_BYTES, 413, 'PHOTO_TOO_LARGE', 'Photo must be 8 MB or smaller.');
  try {
    const image = sharp(buffer, { limitInputPixels: 36000000, failOn: 'warning' });
    const meta = await image.metadata();
    ensure(['jpeg','png','webp'].includes(meta.format ?? '') && (meta.pages ?? 1) === 1, 400, 'INVALID_PHOTO', 'Use a single JPG, PNG or WebP image.');
    ensure(meta.width && meta.height && meta.width <= 8000 && meta.height <= 8000, 400, 'PHOTO_DIMENSIONS', 'Photo dimensions must not exceed 8000 pixels or 36 megapixels.');
    const full = await sharp(buffer, { limitInputPixels: 36000000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data).resize(300, 300, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, 'INVALID_PHOTO', 'The file is not a supported, decodable image.'); }
}
export async function uploadPhoto(buffer: Buffer, ownerId: string) {
  const decoded = await decodePhoto(buffer); const id = randomUUID();
  const key = id + '.webp'; const thumbnailKey = id + '-thumb.webp';
  try {
    await storage.write(key, decoded.full); await storage.write(thumbnailKey, decoded.thumb);
    return await db.productPhoto.create({ data: { id, ownerId, key, thumbnailKey, width: decoded.width, height: decoded.height, bytes: decoded.full.length } });
  } catch (error) { await storage.remove(key); await storage.remove(thumbnailKey); throw error; }
}
export async function attachPhoto(tx: Tx, productId: string, photoId: string | null | undefined, actorId: string) {
  if (photoId === undefined) return;
  if (photoId) {
    const photo = await tx.productPhoto.findUnique({ where: { id: photoId } });
    ensure(photo && (photo.productId === productId || (!photo.productId && photo.ownerId === actorId)), 400, 'INVALID_PHOTO', 'Upload a new photo or choose this product’s saved photo.');
  }
  await tx.productPhoto.updateMany({ where: { productId }, data: { productId: null } });
  if (photoId) await tx.productPhoto.update({ where: { id: photoId }, data: { productId } });
}
export async function cleanupPhotos() {
  const pending = await db.productPhoto.findMany({ where: { productId: null, createdAt: { lt: new Date(Date.now() - 86400000) } } });
  let removedCount = 0;
  for (const photo of pending) {
    const removed = await db.productPhoto.deleteMany({ where: { id: photo.id, productId: null } });
    if (removed.count) { removedCount++; await storage.remove(photo.key); await storage.remove(photo.thumbnailKey); }
  }
  // Clean crash-orphaned files only after a grace period; never remove recently uploaded files.
  const { readdir, stat } = await import('node:fs/promises'); const { config } = await import('../config.js'); const path = await import('node:path');
  const files = await readdir(config.uploadDir).catch(() => [] as string[]);
  for (const key of files) {
    if (!/^[a-f0-9-]+(-thumb)?\.webp$/.test(key)) continue;
    const info = await stat(path.join(config.uploadDir, key));
    if (info.mtimeMs > Date.now() - 86400000) continue;
    if (!await db.productPhoto.findFirst({ where: { OR: [{ key }, { thumbnailKey: key }] } })) await storage.remove(key);
  }
  return removedCount;
}
