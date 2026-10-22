import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function ensureEnvironment(){
  const envPath=path.join(root,'.env');
  let current=await fs.readFile(envPath,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  const existing=parseEnv(current);
  const password=existing.DATABASE_PASSWORD&&!existing.DATABASE_PASSWORD.startsWith('CHANGE_')?existing.DATABASE_PASSWORD:randomBytes(24).toString('hex');
  const defaults={
    DATABASE_MODE:existing.DATABASE_URL&&!existing.DATABASE_URL.includes('CHANGE_THIS_LOCAL_PASSWORD')?'external':'embedded',DATABASE_PORT:'54329',
    DATABASE_URL:'postgresql://nanda:'+encodeURIComponent(password)+'@127.0.0.1:54329/nanda?schema=public',
    DATABASE_PASSWORD:password,
    APP_ORIGIN:'http://localhost:5173',PORT:'4000',NODE_ENV:'development',
    CSRF_SECRET:randomBytes(32).toString('hex'),UPLOAD_DIR:'./uploads',SESSION_HOURS:'12',
    INITIAL_GOLD_RATE:'0',INITIAL_SILVER_RATE:'0',CREATE_LOCAL_ADMIN:'true',
  };
  for(const [name,value]of Object.entries(defaults)){
    const old=existing[name];
    if(old && !old.startsWith('REPLACE_') && !old.startsWith('CHANGE_') && !old.includes('CHANGE_THIS_LOCAL_PASSWORD'))continue;
    const line=name+'='+value;
    const regex=new RegExp('^'+name+'=.*$','m');
    current=regex.test(current)?current.replace(regex,line):current+(current.endsWith('\n')||!current?'':'\n')+line+'\n';
  }
  await fs.writeFile(envPath,current,{mode:0o600});
  const parsed=parseEnv(current);
  for(const [name,value]of Object.entries(parsed))if(process.env[name]===undefined)process.env[name]=value;
  console.log('Local .env configured. Existing settings are preserved; secrets are never printed.');
  return parsed;
}
export function runNode(args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,...options});
    child.on('error',reject);
    child.on('exit',(code,signal)=>code===0?resolve():reject(new Error('Setup step failed ('+(signal??code)+'): '+args[0])));
  });
}
export function npmCli(){
  return process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
}
export const runNpm=args=>runNode([npmCli(),...args]);
export async function dependenciesInstalled(){
  for(const name of ['typescript','prisma','tsx','vite','express','sharp','argon2','embedded-postgres','pg','react-hook-form']){
    try{await fs.access(path.join(root,'node_modules',name,'package.json'));}catch{return false;}
  }
  return true;
}
