import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { setup } from './setup.mjs';
import { ensureEnvironment, root } from './helpers.mjs';
import { freePort } from './ports.mjs';
let database;const children=[];let stopping=false;
async function stop(code=0){
  if(stopping)return;stopping=true;
  for(const child of children){
    if(child.exitCode!==null)continue;
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else child.kill('SIGTERM');
  }
  await database?.stop().catch(error=>console.error('Database shutdown:',error.message));
  process.exit(code);
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try{
  await ensureEnvironment();
  await freePort(Number(process.env.PORT??4000));await freePort(5173,'localhost');
  database=await setup();
  const env={...process.env,NODE_ENV:'development'};
  for(const [args,cwd]of[
    [[path.join(root,'node_modules/tsx/dist/cli.mjs'),'watch',path.join(root,'src/server.ts')],root],
    [[path.join(root,'node_modules/vite/bin/vite.js'),'--host','localhost','--port','5173','--strictPort'],path.resolve(root,'../frontend')],
  ]){
    const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});children.push(child);
    child.on('error',error=>{console.error(error.message);void stop(1);});
    child.on('exit',code=>{if(!stopping)void stop(code??1);});
  }
  console.log('\nNanda Jewellers frontend: http://localhost:5173\nBackend: http://localhost:'+env.PORT+'\nPress Ctrl+C to stop the frontend, backend and owned local database.\n');
}catch(error){console.error(error.message);await stop(1);}
