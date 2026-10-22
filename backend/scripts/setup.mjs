import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureEnvironment,dependenciesInstalled,runNpm,runNode,root } from './helpers.mjs';
import { prepareDatabase } from './database.mjs';
export async function setup(){
  await ensureEnvironment();
  if(!await dependenciesInstalled()){
    console.log('Installing application and local PostgreSQL dependencies…');
    await runNpm(['install','--cache',path.join(root,'.npm-cache')]);
  }
  await runNode([path.join(root,'node_modules/prisma/build/index.js'),'generate','--schema',path.join(root,'prisma/schema.prisma')]);
  await runNode([path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(root,'packages/shared/tsconfig.json')]);
  const database=await prepareDatabase();
  try{
    await runNode([path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',path.join(root,'prisma/schema.prisma')]);
    await runNode([path.join(root,'node_modules/tsx/dist/cli.mjs'),path.join(root,'src/scripts/init.ts')]);
    await runNode([path.join(root,'node_modules/tsx/dist/cli.mjs'),path.join(root,'src/scripts/bootstrap-local-admin.ts')]);
    return database;
  }catch(error){await database.stop();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const database=await setup();await database.stop();console.log('Setup complete. Run npm start. Initial local login details are in .local/initial-admin.txt if a new administrator was created.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
