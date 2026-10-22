import '../config.js';
import { db } from '../db.js';
import argon2 from 'argon2';
import { z } from '@nanda/shared';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
const flags=process.argv.slice(2);const option=(name:string)=>{const index=flags.indexOf(name);if(index<0||!flags[index+1]||flags[index+1].startsWith('--'))throw new Error('Usage: npm run admin:create -- --name NAME --email EMAIL');return flags[index+1];};
const name=z.string().min(2).max(100).parse(option('--name'));
const email=z.string().email().max(160).parse(option('--email')).toLowerCase();
async function hiddenPassword(){
  process.stdout.write('Initial administrator password (at least 12 characters): ');
  let muted=true;const output=new Writable({write(chunk,_encoding,done){if(!muted)process.stdout.write(chunk);done();}});
  const rl=createInterface({input:process.stdin,output,terminal:true});
  const password=await rl.question('');muted=false;rl.close();process.stdout.write('\n');return password;
}
try {
  if(await db.user.count({where:{role:'ADMIN'}}))throw new Error('An administrator already exists. This command creates the initial administrator only.');
  const password=z.string().min(12).max(128).parse(process.env.ADMIN_PASSWORD??await hiddenPassword());
  await db.user.create({data:{name,email,passwordHash:await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }),role:'ADMIN'}});
  console.log('Initial administrator created. No password was printed.');
} finally { await db.$disconnect(); }
