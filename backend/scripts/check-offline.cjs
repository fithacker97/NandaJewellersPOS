// Optional offline verification using an already installed TypeScript and Zod.
// This loads the real source modules; it does not mock pricing or validation.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const modules=process.env.TOOL_MODULES_PATH;
if(!modules)throw new Error('Set TOOL_MODULES_PATH to an existing node_modules containing typescript and zod.');
const ts=require(path.join(modules,'typescript'));
const root=path.resolve(__dirname,'..');
const cache=new Map();
function load(relative){
  const filename=path.join(root,relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const mod={exports:{}};cache.set(filename,mod);
  const output=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename});
  const localRequire=name=>{
    if(name==='@nanda/shared')return load('packages/shared/src/index.ts');
    if(name==='./money.js')return load('packages/shared/src/money.ts');
    if(name==='zod')return require(path.join(modules,'zod'));
    return require(name);
  };
  new Function('require','module','exports','__filename','__dirname',output.outputText)(localRequire,mod,mod.exports,filename,path.dirname(filename));
  return mod.exports;
}
load('test/pricing.test.ts');
