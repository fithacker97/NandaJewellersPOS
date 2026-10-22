import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
const secret = process.env.CSRF_SECRET ?? '';
if (secret.length < 32 || secret.startsWith('REPLACE_')) throw new Error('Set CSRF_SECRET to at least 32 random characters in .env');
export const config = {
  origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', port: Number(process.env.PORT ?? 4000),
  production: process.env.NODE_ENV === 'production', csrfSecret: secret,
  uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR ?? 'uploads'),
  sessionHours: Math.min(168, Math.max(1, Number(process.env.SESSION_HOURS ?? 12))),
};
