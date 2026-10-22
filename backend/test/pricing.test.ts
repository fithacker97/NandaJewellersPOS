import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, normalizeBarcode, productSchema, productEditSchema, inr } from '@nanda/shared';
test('same metal base supports independent product surpluses',()=>{
  assert.equal(calculatePrice('200','120','0','10',1).piecePrice,'3200.00');
  assert.equal(calculatePrice('200','40','0','10',1).piecePrice,'2400.00');
});
test('employee surplus adds a fixed INR amount per gram',()=>{
  assert.equal(calculatePrice('200','120','30','10',1).sellingRate,'350.0000');
  assert.equal(calculatePrice('200','40','30','10',1).piecePrice,'2700.00');
});
test('Aman two rings and one coin example totals 9700',()=>{
  const rings=calculatePrice('200','120','30','10',2),coin=calculatePrice('200','40','30','10',1);
  assert.equal(rings.lineTotal,'7000.00');assert.equal(coin.lineTotal,'2700.00');
  assert.equal(Number(rings.lineTotal)+Number(coin.lineTotal),9700);
});
test('rounds the full line rather than multiplying a rounded piece price',()=>{
  const quote=calculatePrice('0.3333','0','0','1',3);
  assert.equal(quote.piecePrice,'0.33');assert.equal(quote.lineTotal,'1.00');
  assert.equal(calculatePrice('1.005','0','0','1',1).lineTotal,'1.01');
});
test('weight and all component arithmetic are decimal safe',()=>{
  assert.equal(calculatePrice('0.1','0.2','0.3','0.001',10000).lineTotal,'6.00');
  assert.equal(calculatePrice('200','40','30','10.001',3).totalWeight,'30.0030');
});
test('normalizes surrounding whitespace and optional paired Code 39 asterisks',()=>{
  assert.equal(normalizeBarcode('  *000123*  '),'000123');
  assert.equal(normalizeBarcode('  000123  '),'000123');
});
test('product quantity can only be changed through stock operations',()=>{
  assert.equal(productEditSchema.safeParse({quantity:50}).success,false);
  assert.equal(productSchema.safeParse({name:'Ring',metal:'SILVER',weight:'0',surplus:'10',openingQuantity:1}).success,false);
  assert.equal(productSchema.safeParse({name:'Ring',metal:'SILVER',weight:'0.001',surplus:'10',openingQuantity:1.5}).success,false);
});

test('INR formatting preserves paise beyond floating-point safe integers',()=>{assert.equal(inr('9007199254740993.01'),'₹9,00,71,99,25,47,40,993.01');assert.equal(inr('1234567.895'),'₹12,34,567.90');});
