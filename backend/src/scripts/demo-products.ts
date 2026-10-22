import '../config.js';
import { db } from '../db.js';
import { projectRoot } from '../config.js';
import { publicUser } from '../services/auth.js';
import { uploadPhoto } from '../services/photos.js';
import { createProduct } from '../services/catalog.js';
import { updateRates } from '../services/settings.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const products = [
 {image:'gold-ring',name:'Demo · Gold Solitaire Ring',metal:'GOLD' as const,weight:'4.250',surplus:'850',openingQuantity:8},
 {image:'gold-chain',name:'Demo · Gold Rope Chain',metal:'GOLD' as const,weight:'12.500',surplus:'650',openingQuantity:5},
 {image:'gold-earrings',name:'Demo · Gold Jhumka Earrings',metal:'GOLD' as const,weight:'8.750',surplus:'950',openingQuantity:6},
 {image:'silver-ring',name:'Demo · Silver Filigree Ring',metal:'SILVER' as const,weight:'10.000',surplus:'120',openingQuantity:12},
 {image:'silver-coin',name:'Demo · Silver Lakshmi Coin',metal:'SILVER' as const,weight:'10.000',surplus:'40',openingQuantity:20},
];
try {
  const admin = await db.user.findFirstOrThrow({where:{role:'ADMIN',active:true},orderBy:{createdAt:'asc'}});
  const actor=publicUser(admin);
  const rates=await db.metalRate.findMany();
  const gold=rates.find(r=>r.metal==='GOLD')!.rate;
  const silver=rates.find(r=>r.metal==='SILVER')!.rate;
  if(gold.isZero()||silver.isZero()){
    await updateRates(actor,{gold:gold.isZero()?'7000':gold.toString(),silver:silver.isZero()?'200':silver.toString()});
    console.log('Previously unconfigured rates initialized to manually entered demo examples (gold 7000/g, silver 200/g where unset). These are not live market prices.');
  }
  const added=[];
  for(const {image,...input} of products){
    const existing=await db.product.findFirst({where:{name:input.name}});
    if(existing){added.push({id:existing.id,name:existing.name,barcode:existing.barcode});continue;}
    const bytes=await readFile(path.join(projectRoot,'demo-assets',image+'.png'));
    const photo=await uploadPhoto(bytes,actor.id);
    const result=await createProduct(actor,{...input,photoId:photo.id});
    added.push({...result,name:input.name});
    console.log('Added '+input.name+' · '+result.barcode);
  }
  await writeFile(path.join(projectRoot,'demo-assets','demo-products.json'),JSON.stringify(added,null,2)+'\n');
  console.log('Five demo products are available with photos, permanent barcodes and audited opening stock.');
} finally {await db.$disconnect();}
