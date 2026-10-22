import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
export interface ImageStorage { write(key: string, bytes: Buffer): Promise<void>; read(key: string): Promise<Buffer>; remove(key: string): Promise<void>; }
class LocalImageStorage implements ImageStorage {
  private file(key: string) { if (!/^[a-f0-9-]+(-thumb)?\.webp$/.test(key)) throw new Error('Invalid storage key'); return path.join(config.uploadDir, key); }
  async write(key: string, bytes: Buffer) { await mkdir(config.uploadDir, { recursive: true }); await writeFile(this.file(key), bytes, { flag: 'wx' }); }
  async read(key: string) { return readFile(this.file(key)); }
  async remove(key: string) { await unlink(this.file(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}
export const storage: ImageStorage = new LocalImageStorage();
