import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { Express } from 'express';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let app:Express,db:PrismaClient,adminCookie:string,adminCsrf:string,employeeCookie:string,employeeCsrf:string,employeeId:string;
const testPassword='Test-only-'+randomBytes(12).toString('hex');
const schema='nanda_test_'+randomUUID().replaceAll('-','');
const origin='http://localhost:5173';
let base:PrismaClient;
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL,'Set TEST_DATABASE_URL to a disposable PostgreSQL database. Normal data is never reset.');
  base=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
  await base.$executeRawUnsafe('CREATE SCHEMA "'+schema+'"');
  const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('schema',schema);
  process.env.DATABASE_URL=url.toString();process.env.CSRF_SECRET=randomBytes(32).toString('hex');process.env.APP_ORIGIN=origin;process.env.UPLOAD_DIR='.test-uploads/'+schema;
  const env={...process.env};
  execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',path.join(root,'prisma/schema.prisma')],{cwd:root,env,stdio:'pipe'});
  execFileSync(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),path.join(root,'src/scripts/init.ts')],{cwd:root,env,stdio:'pipe'});
  execFileSync(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),path.join(root,'src/scripts/admin.ts'),'--name','Test Owner','--email','owner@test.invalid'],{cwd:root,env:{...env,ADMIN_PASSWORD:testPassword},stdio:'pipe'});
  app=(await import('../../src/app.js')).app;db=(await import('../../src/db.js')).db;
  const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'owner@test.invalid',password:testPassword}).expect(200);
  adminCookie=login.headers['set-cookie'][0].split(';')[0];adminCsrf=login.body.csrfToken;
});
after(async()=>{
  if(db)await db.$disconnect();
  if(base){await base.$executeRawUnsafe('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await base.$disconnect();}
});
function admin(method:'post'|'patch'|'delete'|'get',url:string){return request(app)[method](url).set('Cookie',adminCookie).set('Origin',origin).set('X-CSRF-Token',adminCsrf);}
function employee(method:'post'|'patch'|'delete'|'get',url:string){return request(app)[method](url).set('Cookie',employeeCookie).set('Origin',origin).set('X-CSRF-Token',employeeCsrf);}
async function product(quantity=10,surplus='120',photoId?:string){
  const created=await admin('post','/api/products').send({name:'Test silver ring',metal:'SILVER',weight:'10',surplus,openingQuantity:quantity,...(photoId?{photoId}:{})}).expect(201);
  return db.product.findUniqueOrThrow({where:{id:created.body.id}});
}
async function draftWith(p:{barcode:string}){await employee('delete','/api/invoice-drafts/current').expect(200);return (await employee('post','/api/invoice-drafts/current/scan').send({barcode:p.barcode}).expect(200)).body;}
function issue(draft:{id:string;quoteToken:string},key=randomUUID()){return employee('post','/api/invoice-drafts/current/issue').send({draftId:draft.id,quoteToken:draft.quoteToken,issuanceKey:key});}
test('fresh installation has zero inventory and no fake invoices',async()=>{
  assert.equal(await db.user.count({where:{role:'EMPLOYEE'}}),0);assert.equal(await db.product.count(),0);assert.equal(await db.invoice.count(),0);assert.equal(await db.stockMovement.count(),0);
  await admin('patch','/api/rates').send({gold:'7000',silver:'200'}).expect(200);
});
test('opening stock creates a complete movement snapshot',async()=>{
  const p=await product(5);const movement=await db.stockMovement.findFirstOrThrow({where:{productId:p.id,type:'OPENING'}});
  assert.equal(movement.delta,5);assert.equal(movement.before,0);assert.equal(movement.after,5);
});
test('receipt increases stock and records actor',async()=>{
  const p=await product(1);await admin('post','/api/stock/receipts').send({productId:p.id,quantity:3,reference:'Delivery'}).expect(200);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,4);
  await admin('patch','/api/products/'+p.id).send({quantity:100}).expect(400);
});
test('create employee and authenticate using HttpOnly session cookies',async()=>{
  const created=await admin('post','/api/employees').send({name:'Aman',email:'aman@test.invalid',password:testPassword,gold:'0',silver:'30'}).expect(201);employeeId=created.body.id;
  const result=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'aman@test.invalid',password:testPassword}).expect(200);
  assert.match(result.headers['set-cookie'][0],/HttpOnly/i);employeeCookie=result.headers['set-cookie'][0].split(';')[0];employeeCsrf=result.body.csrfToken;
});
test('scan adds a line, repeats increase quantity, drafts do not deduct stock',async()=>{
  const p=await product(5);let draft=await draftWith(p);assert.equal(draft.lines[0].quantity,1);
  draft=(await employee('post','/api/invoice-drafts/current/scan').send({barcode:' *'+p.barcode+'* '}).expect(200)).body;
  assert.equal(draft.lines[0].quantity,2);assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,5);
  const resumed=(await employee('get','/api/invoice-drafts/current').expect(200)).body;assert.equal(resumed.id,draft.id);assert.equal(resumed.lines[0].quantity,2);
});
test('employee receipts increase stock and preserve attribution',async()=>{
  const p=await product(1);await employee('post','/api/stock/receipts').send({productId:p.id,quantity:2,reference:'Employee delivery'}).expect(200);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,3);
  assert.equal((await db.stockMovement.findFirstOrThrow({where:{productId:p.id,type:'RECEIPT'}})).actorId,employeeId);
});
test('example invoice totals 9700 and issuance deducts stock exactly once',async()=>{
  const ring=await product(5,'120'),coin=await product(5,'40');
  await draftWith(ring);await employee('post','/api/invoice-drafts/current/scan').send({barcode:ring.barcode}).expect(200);
  const draft=(await employee('post','/api/invoice-drafts/current/scan').send({barcode:coin.barcode}).expect(200)).body;
  assert.equal(draft.total,'9700.00');const key=randomUUID();const issued=await issue(draft,key).expect(200);const repeated=await issue(draft,key).expect(200);
  assert.equal(issued.body.id,repeated.body.id);assert.equal((await db.product.findUniqueOrThrow({where:{id:ring.id}})).quantity,3);
  assert.equal(await db.stockMovement.count({where:{invoiceId:issued.body.id,type:'SALE'}}),2);
});
test('changed base rate, product surplus and employee surplus require review',async()=>{
  const p=await product(5);let draft=await draftWith(p);
  await admin('patch','/api/rates').send({gold:'7000',silver:'201'}).expect(200);
  let changed=await issue(draft).expect(409);assert.equal(changed.body.error.code,'PRICE_CHANGED');draft=changed.body.error.details.quote;
  await admin('patch','/api/products/'+p.id).send({surplus:'121'}).expect(200);
  changed=await issue(draft).expect(409);assert.equal(changed.body.error.code,'PRICE_CHANGED');draft=changed.body.error.details.quote;
  await admin('patch','/api/employees/'+employeeId+'/pricing').send({gold:'0',silver:'31'}).expect(200);
  changed=await issue(draft).expect(409);assert.equal(changed.body.error.code,'PRICE_CHANGED');
  await issue(changed.body.error.details.quote).expect(200);
  await admin('patch','/api/rates').send({gold:'7000',silver:'200'}).expect(200);
  await admin('patch','/api/employees/'+employeeId+'/pricing').send({gold:'0',silver:'30'}).expect(200);
});
test('concurrent requests cannot both sell the final piece',async()=>{
  const p=await product(1);const first=await draftWith(p);
  const other=await db.user.create({data:{name:'Other test employee',email:'other@test.invalid',role:'EMPLOYEE',passwordHash:(await db.user.findUniqueOrThrow({where:{id:employeeId}})).passwordHash,pricing:{create:{gold:0,silver:30,updatedBy:employeeId}}}});
  const services=await import('../../src/services/billing.js');
  const second=await services.scanDraft(other,p.barcode);const actor=await db.user.findUniqueOrThrow({where:{id:employeeId}});
  const results=await Promise.allSettled([services.issueInvoice(actor,{draftId:first.id,quoteToken:first.quoteToken,issuanceKey:randomUUID()}),services.issueInvoice(other,{draftId:second.id,quoteToken:second.quoteToken,issuanceKey:randomUUID()})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,0);
});
test('archived products cannot be sold or receive stock and archive removal is audited',async()=>{
  const p=await product(2);const draft=await draftWith(p);
  await admin('delete','/api/products/'+p.id).send({reason:'Discontinued',expectedQuantity:2}).expect(200);
  assert.equal((await issue(draft).expect(409)).body.error.code,'ARCHIVED_PRODUCT');
  await employee('post','/api/stock/receipts').send({productId:p.id,quantity:1}).expect(404);
  assert.equal((await db.stockMovement.findFirstOrThrow({where:{productId:p.id,type:'ARCHIVE_REMOVAL'}})).delta,-2);
});
test('historical invoices retain original values after edits and archive',async()=>{
  const p=await product(3);const draft=await draftWith(p);const invoice=(await issue(draft).expect(200)).body;
  await admin('patch','/api/products/'+p.id).send({name:'Changed product',weight:'11',surplus:'999'}).expect(200);
  await admin('delete','/api/products/'+p.id).send({reason:'Test archive',expectedQuantity:2}).expect(200);
  const saved=(await employee('get','/api/invoices/'+invoice.id).expect(200)).body;
  assert.equal(saved.lines[0].productName,'Test silver ring');assert.equal(saved.lines[0].weight,'10');assert.equal(saved.total,'3500');
  await assert.rejects(()=>db.invoice.update({where:{id:invoice.id},data:{customerName:'Tampered'}}));
});
test('employee APIs hide component prices and reject administrator operations',async()=>{
  const p=await product(3);
  for(const path of ['/api/products','/api/products/'+p.id,'/api/products/lookup/'+p.barcode,'/api/dashboard','/api/invoice-drafts/current']){
    const response=await employee('get',path).expect(200);const json=JSON.stringify(response.body);
    assert.doesNotMatch(json,/"(baseRate|surplus|productSurplus|employeeSurplus|rates|passwordHash)"\s*:/);
  }
  const exported=await employee('get','/api/exports/inventory.csv').expect(200);assert.doesNotMatch(exported.text,/Product surplus|base rate/i);
  await employee('get','/api/rates').expect(403);await employee('get','/api/employees').expect(403);
  await employee('post','/api/products').send({}).expect(403);
  const adminActor=await db.user.findFirstOrThrow({where:{role:'ADMIN'}});const services=await import('../../src/services/billing.js');
  await services.discardDraft(adminActor);const adminDraft=await services.scanDraft(adminActor,p.barcode);const inv=await services.issueInvoice(adminActor,{draftId:adminDraft.id,quoteToken:adminDraft.quoteToken,issuanceKey:randomUUID()});
  await employee('get','/api/invoices/'+inv.id).expect(404);await employee('get','/api/invoices/'+inv.id+'/pdf').expect(404);
  const list=(await employee('get','/api/invoices').expect(200)).body;assert.equal(list.items.some((item:{id:string})=>item.id===inv.id),false);
});
test('invalid and oversized decoded images are rejected',async()=>{
  await admin('post','/api/uploads/photos').attach('photo',Buffer.from('not an image'),'fake.jpg').expect(400);
  await admin('post','/api/uploads/photos').attach('photo',Buffer.alloc(8*1024*1024+1),'large.png').expect(413);
  const oversized=await sharp({create:{width:8001,height:1,channels:3,background:'#fff'}}).png().toBuffer();
  await admin('post','/api/uploads/photos').attach('photo',oversized,'wide.png').expect(400);
});
test('photo upload, replacement, removal and cancellation preserve saved content',async()=>{
  const bytes=await sharp({create:{width:100,height:120,channels:3,background:'#B68D48'}}).jpeg().toBuffer();
  const photo=(await admin('post','/api/uploads/photos').attach('photo',bytes,'photo.jpg').expect(201)).body;
  const p=await product(2,'120',photo.id);
  const old=(await db.productPhoto.findUniqueOrThrow({where:{id:photo.id}}));
  await admin('post','/api/products/'+p.id+'/photo').attach('photo',Buffer.from('invalid replacement'),'bad.jpg').expect(400);
  assert.equal((await db.productPhoto.findFirstOrThrow({where:{productId:p.id}})).id,old.id);
  await employee('get','/api/photos/'+photo.id).expect(200);
  // A staged upload that is cancelled never alters the saved photo.
  await admin('post','/api/uploads/photos').attach('photo',bytes,'cancelled.png').expect(201);
  assert.equal((await db.productPhoto.findFirstOrThrow({where:{productId:p.id}})).id,old.id);
  const replacement=(await admin('post','/api/products/'+p.id+'/photo').attach('photo',bytes,'new.jpg').expect(200)).body;
  assert.notEqual(replacement.id,old.id);assert.equal((await db.productPhoto.findUniqueOrThrow({where:{id:old.id}})).productId,null);
  await admin('delete','/api/products/'+p.id+'/photo').expect(200);assert.equal(await db.productPhoto.count({where:{productId:p.id}}),0);
});
test('barcode preview SVG and invoice reprint/PDF never change inventory',async()=>{
  const p=await product(2);const svg=await employee('get','/api/products/'+p.id+'/barcode').expect(200);assert.match(String(svg.text??svg.body),/<svg/);
  const draft=await draftWith(p);const invoice=(await issue(draft).expect(200)).body;
  const before=(await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity;
  await employee('get','/api/invoices/'+invoice.id).expect(200);
  const pdf=await employee('get','/api/invoices/'+invoice.id+'/pdf').expect(200);assert.match(pdf.headers['content-type'],/application\/pdf/);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,before);
});
test('cookie write requests require CSRF and permitted origin',async()=>{
  await request(app).post('/api/stock/receipts').set('Cookie',employeeCookie).set('Origin',origin).send({productId:randomUUID(),quantity:1}).expect(403);
  await request(app).post('/api/auth/logout').set('Cookie',employeeCookie).set('Origin','https://untrusted.invalid').set('X-CSRF-Token',employeeCsrf).expect(403);
});

test('paired phone scans update only the cashier draft and retries are idempotent',async()=>{
  const p=await product(5);await employee('delete','/api/invoice-drafts/current').expect(200);
  const adminBefore=(await admin('get','/api/invoice-drafts/current').expect(200)).body;
  const pairing=(await employee('post','/api/scanner/connections').send({}).expect(201)).body;
  assert.match(pairing.code,/^\d{8}$/);
  assert.equal(pairing.qrCodes.length,pairing.addresses.length);
  for(const qr of pairing.qrCodes){
    assert.ok(pairing.addresses.includes(qr.address));
    assert.match(qr.svg,/<svg[\s>]/);
  }
  const paired=(await request(app).post('/api/scanner/pair').send({code:pairing.code}).expect(200)).body;
  const key=randomUUID();
  const send=(eventKey:string)=>request(app).post('/api/scanner/scan').set('Authorization','Bearer '+paired.token).send({barcode:p.barcode,eventKey});
  const [a,b]=await Promise.all([send(key).expect(200),send(key).expect(200)]);
  assert.equal(a.body.quantity,1);assert.equal(b.body.quantity,1);
  await send(randomUUID()).expect(200);
  const connections=(await employee('get','/api/scanner/connections').expect(200)).body.items;
  const ownLink=connections.find((link:{id:string})=>link.id===pairing.id);
  assert.equal(ownLink.events.length,1);
  assert.equal(ownLink.events[0].barcode,p.barcode);
  assert.equal(ownLink._count.events,2);
  assert.ok(ownLink.events[0].id);
  const otherConnections=(await admin('get','/api/scanner/connections').expect(200)).body.items;
  assert.ok(!otherConnections.some((link:{id:string})=>link.id===pairing.id));
  const draft=(await employee('get','/api/invoice-drafts/current').expect(200)).body;
  assert.equal(draft.lines[0].quantity,2);assert.equal(draft.lines[0].sellingRate,'350.0000');
  assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,5);
  assert.equal((await admin('get','/api/invoice-drafts/current').expect(200)).body.revision,adminBefore.revision);
  await request(app).post('/api/scanner/pair').send({code:pairing.code}).expect(401);
  await request(app).get('/api/rates').set('Authorization','Bearer '+paired.token).expect(401);
  await request(app).post('/api/scanner/scan').set('Authorization','Bearer '+paired.token).send({barcode:p.barcode,eventKey:randomUUID(),employeeId:employeeId}).expect(400);
});
test('pairing expires and only the owning cashier can revoke a phone',async()=>{
  const pair=(await employee('post','/api/scanner/connections').send({}).expect(201)).body;
  await db.scannerLink.update({where:{id:pair.id},data:{pairingExpiresAt:new Date(Date.now()-1000)}});
  await request(app).post('/api/scanner/pair').send({code:pair.code}).expect(401);
  const fresh=(await employee('post','/api/scanner/connections').send({}).expect(201)).body;
  const paired=(await request(app).post('/api/scanner/pair').send({code:fresh.code}).expect(200)).body;
  await admin('delete','/api/scanner/connections/'+fresh.id).expect(404);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(200);
  await employee('delete','/api/scanner/connections/'+fresh.id).expect(200);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(401);
});
test('unknown phone scans leave the draft unchanged and explicit disconnect revokes the token',async()=>{
  await employee('delete','/api/invoice-drafts/current').expect(200);
  const pair=(await employee('post','/api/scanner/connections').send({}).expect(201)).body;
  const paired=(await request(app).post('/api/scanner/pair').send({code:pair.code}).expect(200)).body;
  await request(app).post('/api/scanner/scan').set('Authorization','Bearer '+paired.token).send({barcode:'000000UNKNOWN',eventKey:randomUUID()}).expect(404);
  assert.equal((await employee('get','/api/invoice-drafts/current').expect(200)).body.lines.length,0);
  await request(app).post('/api/scanner/disconnect').set('Authorization','Bearer '+paired.token).send({}).expect(200);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(401);
});
test('paired phone stays connected across issued and discarded bills',async()=>{
  const p=await product(4);await employee('delete','/api/invoice-drafts/current').expect(200);
  const pair=(await employee('post','/api/scanner/connections').send({}).expect(201)).body;
  const paired=(await request(app).post('/api/scanner/pair').send({code:pair.code}).expect(200)).body;
  await request(app).post('/api/scanner/scan').set('Authorization','Bearer '+paired.token).send({barcode:p.barcode,eventKey:randomUUID()}).expect(200);
  const draft=(await employee('get','/api/invoice-drafts/current').expect(200)).body;
  await issue(draft).expect(200);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(200);
  const next=(await request(app).post('/api/scanner/scan').set('Authorization','Bearer '+paired.token).send({barcode:p.barcode,eventKey:randomUUID()}).expect(200)).body;
  assert.notEqual(next.draftId,draft.id);
  assert.equal(next.quantity,1);
  await employee('delete','/api/invoice-drafts/current').expect(200);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(200);
  const afterClear=(await request(app).post('/api/scanner/scan').set('Authorization','Bearer '+paired.token).send({barcode:p.barcode,eventKey:randomUUID()}).expect(200)).body;
  assert.equal(afterClear.draftId,next.draftId);
  assert.equal(afterClear.quantity,1);
  await request(app).post('/api/scanner/disconnect').set('Authorization','Bearer '+paired.token).send({}).expect(200);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(401);
});
test('signing out revokes the user’s paired scanner without exposing a general API session',async()=>{
  const p=await product(2);
  await employee('delete','/api/invoice-drafts/current').expect(200);
  await employee('post','/api/invoice-drafts/current/scan').send({barcode:p.barcode}).expect(200);
  const pair=(await employee('post','/api/scanner/connections').send({}).expect(201)).body;
  const paired=(await request(app).post('/api/scanner/pair').send({code:pair.code}).expect(200)).body;
  const login=(await request(app).post('/api/auth/login').set('Origin',origin).send({email:'aman@test.invalid',password:testPassword}).expect(200));
  const cookie=login.headers['set-cookie'][0].split(';')[0];
  await request(app).post('/api/auth/logout').set('Cookie',cookie).set('Origin',origin).set('X-CSRF-Token',login.body.csrfToken).expect(200);
  await request(app).get('/api/scanner/status').set('Authorization','Bearer '+paired.token).expect(401);
  assert.equal((await employee('get','/api/invoice-drafts/current').expect(200)).body.totalPieces,0);
  assert.equal((await db.product.findUniqueOrThrow({where:{id:p.id}})).quantity,2);
});

test('employee deactivation revokes existing sessions',async()=>{
  await admin('patch','/api/employees/'+employeeId).send({active:false}).expect(200);
  await employee('get','/api/products').expect(401);
});
