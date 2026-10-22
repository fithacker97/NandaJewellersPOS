import dotenv from 'dotenv';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({path:path.join(root,'.env'),quiet:true});
if(process.platform==='win32') process.env.PRISMA_SCHEMA_ENGINE_BINARY=path.join(root,'node_modules/@prisma/engines/schema-engine-windows.exe');
const name = 'nanda_pairing_test_' + randomBytes(8).toString('hex');
const adminUrl = new URL(process.env.DATABASE_URL);
adminUrl.pathname = '/postgres'; adminUrl.search = '';
const client = new Client({connectionString:adminUrl.toString(),connectionTimeoutMillis:5000});
let created = false;
try {
  await client.connect();
  await client.query('CREATE DATABASE "'+name+'"'); created = true;
  const url = new URL(adminUrl); url.pathname = '/'+name;
  const code = await new Promise((resolve,reject)=>{
    const child = spawn(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'--test','--test-concurrency=1','test/integration/showroom.test.ts'],{
      cwd:root,env:{...process.env,TEST_DATABASE_URL:url.toString()},stdio:'inherit',windowsHide:true,
    });
    child.once('error',reject); child.once('exit',resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  if(created && /^nanda_pairing_test_[a-f0-9]{16}$/.test(name)) await client.query('DROP DATABASE "'+name+'" WITH (FORCE)');
  await client.end();
}
