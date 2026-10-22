import '../config.js';
import { db } from '../db.js';
import { config, projectRoot } from '../config.js';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
try {
  if (config.production || process.env.CREATE_LOCAL_ADMIN === 'false') {
    console.log('Automatic local administrator setup is disabled.'); 
  } else if (await db.user.count({ where: { role: 'ADMIN' } })) {
    console.log('Existing administrator preserved.');
  } else {
    const password = randomBytes(18).toString('base64url');
    const email = 'admin@nandajewellers.local';
    const dir = path.join(projectRoot, '.local');
    await mkdir(dir, { recursive: true });
    const pending = path.join(dir, 'initial-admin.pending');
    const target = path.join(dir, 'initial-admin.txt');
    await writeFile(pending, 'Nanda Jewellers — initial local administrator\n\nEmail: ' + email + '\nPassword: ' + password + '\n\nURL: http://localhost:5173\nKeep this file private. Do not commit or share it.\n', { mode: 0o600, flag: 'wx' });
    try {
      await db.$transaction(async tx => {
        if (await tx.user.count({ where: { role: 'ADMIN' } })) throw new Error('Administrator was already created by another setup process.');
        await tx.user.create({ data: { name: 'Nanda Administrator', email, role: 'ADMIN',
          passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }) } });
      }, { isolationLevel: 'Serializable' });
      await rename(pending, target);
      console.log('Initial local administrator created. Credentials saved privately in .local/initial-admin.txt.');
    } catch(error) { await unlink(pending).catch(()=>{}); throw error; }
  }
} finally { await db.$disconnect(); }
