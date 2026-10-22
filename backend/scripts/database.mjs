import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { ensureEnvironment,root } from './helpers.mjs';
function occupied(port,host){
  return new Promise(resolve=>{const socket=net.connect({port,host});socket.setTimeout(1200);socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});});
}
export async function prepareDatabase(){
  const {Client}=await import('pg');
  const url=new URL(process.env.DATABASE_URL);
  const port=Number(url.port||5432),host=url.hostname;
  const mode=process.env.DATABASE_MODE??'external';
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';adminUrl.search='';
  let owned=null;
  if(!['embedded','docker','external'].includes(mode))throw new Error('DATABASE_MODE must be embedded, docker or external.');
  if(mode==='external'){
    const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
    try{await client.connect();await client.query('SELECT 1');console.log('External PostgreSQL connection verified.');return {stop:async()=>{}};}finally{await client.end().catch(()=>{});}
  }
  if(mode==='docker'){
    const {spawnSync}=await import('node:child_process');
    const result=spawnSync('docker',['compose','up','-d'],{cwd:root,stdio:'inherit',windowsHide:true});
    if(result.error||result.status!==0)throw new Error('Docker could not start PostgreSQL. Start Docker Desktop, or use DATABASE_MODE=embedded with port 54329.');
  }else if(mode==='embedded'&&!await occupied(port,host)){
    if(!['localhost','127.0.0.1'].includes(host))throw new Error('Embedded PostgreSQL must use a loopback host.');
    const {default:EmbeddedPostgres}=await import('embedded-postgres');
    const dir=path.join(root,'.local','postgres');
    const pg=new EmbeddedPostgres({databaseDir:dir,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:message=>{if(String(message).includes('ready to accept connections'))console.log('Local PostgreSQL is ready.');},onError:message=>console.error(String(message))});
    if(!await fs.access(path.join(dir,'PG_VERSION')).then(()=>true,()=>false))await pg.initialise();
    await pg.start();owned=pg;
  }
  try{
    let client;
    for(let attempt=0;attempt<30;attempt++){
      client=new Client({connectionString:adminUrl.toString(),connectionTimeoutMillis:1500});
      try{await client.connect();break;}catch(error){await client.end().catch(()=>{});client=undefined;if(attempt===29)throw new Error('Cannot connect to PostgreSQL. Check DATABASE_URL and DATABASE_MODE in .env.');await new Promise(resolve=>setTimeout(resolve,500));}
    }
    const name=decodeURIComponent(url.pathname.slice(1));
    if(!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(name))throw new Error('Use a simple database name of letters, digits and underscores.');
    const exists=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name]);
    if(!exists.rowCount)await client.query('CREATE DATABASE "'+name+'"');
    await client.end();
    console.log('PostgreSQL connection verified; business data is preserved.');
    return {stop:async()=>{if(owned){await owned.stop();owned=null;}}};
  }catch(error){if(owned)await owned.stop().catch(()=>{});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  await ensureEnvironment();
  const database=await prepareDatabase();
  console.log('Database running. Press Ctrl+C to stop this owned local instance.');
  const keepalive=setInterval(()=>{},60000);
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;clearInterval(keepalive);await database.stop();process.exit(0);}
  process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
}
