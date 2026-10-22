import '../config.js';
import { db } from '../db.js';
import { amountSchema } from '@nanda/shared';
try {
  const gold=amountSchema.parse(process.env.INITIAL_GOLD_RATE??'0'); const silver=amountSchema.parse(process.env.INITIAL_SILVER_RATE??'0');
  await db.$transaction([
    db.businessSettings.upsert({where:{id:1},create:{id:1},update:{}}),
    db.metalRate.upsert({where:{metal:'GOLD'},create:{metal:'GOLD',rate:gold},update:{}}),
    db.metalRate.upsert({where:{metal:'SILVER'},create:{metal:'SILVER',rate:silver},update:{}}),
  ]);
  console.log('Business configuration initialized. No inventory, customers or invoices were inserted. Rates are manually configured, not live prices.');
} finally { await db.$disconnect(); }
