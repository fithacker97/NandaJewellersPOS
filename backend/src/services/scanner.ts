import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import bwipjs from 'bwip-js';
import { config } from '../config.js';
import { db, transaction, type Tx } from '../db.js';
import { ensure } from '../errors.js';
import { normalizeBarcode } from '@nanda/shared';
import { hashToken, publicUser, type Actor } from './auth.js';
import { getCurrentDraft, scanIntoDraft } from './billing.js';
import { audit } from './audit.js';

export function scannerAddresses() {
  const addresses = new Set<string>();
  if (config.production) addresses.add(config.origin);
  else for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
    if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) addresses.add('http://' + entry.address + ':' + config.port);
  }
  return [...addresses];
}
export async function createScannerLink(actor: Actor) {
  const draft = await getCurrentDraft(actor);
  return transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    ensure(user?.active, 401, 'SESSION_EXPIRED', 'Sign in again.');
    await tx.scannerLink.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const code = String(randomInt(0, 100000000)).padStart(8, '0');
    const pairingExpiresAt = new Date(Date.now() + 5 * 60000);
    const link = await tx.scannerLink.create({ data: { userId: actor.id, draftId: draft.id, codeHash: hashToken(code), pairingExpiresAt } });
    await audit(tx, actor.id, 'SCANNER_PAIRING_CREATED', link.id, { draftId: draft.id });
    const addresses = scannerAddresses();
    const qrCodes = addresses.map(address => ({ address, svg: bwipjs.toSVG({
      bcid: 'qrcode', text: JSON.stringify({ type: 'nanda-scanner-pairing', version: 1, serverUrl: address, code }),
      scale: 4, paddingwidth: 4, paddingheight: 4, backgroundcolor: 'FFFFFF',
    }) }));
    return { id: link.id, code, pairingExpiresAt, addresses, qrCodes, cashierName: user.name };
  });
}
export async function pairScanner(code: string) {
  return transaction(async tx => {
    const link = await tx.scannerLink.findUnique({ where: { codeHash: hashToken(code) }, include: { user: true, draft: true } });
    ensure(link && !link.revokedAt && !link.pairedAt && link.pairingExpiresAt > new Date() && link.user.active, 401, 'INVALID_PAIRING', 'This pairing QR is expired, used or invalid. Show a new QR in Make a bill.');
    const token = randomBytes(32).toString('hex');
    await tx.scannerLink.update({ where: { id: link.id }, data: { tokenHash: hashToken(token), pairedAt: new Date() } });
    await audit(tx, link.userId, 'SCANNER_PAIRED', link.id);
    return { token, connectionId: link.id, cashierName: link.user.name };
  });
}
async function authenticatedLink(tx: Tx, token: string) {
  ensure(/^[a-f0-9]{64}$/.test(token), 401, 'SCANNER_DISCONNECTED', 'Connect the scanner again in Billing.');
  const link = await tx.scannerLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  ensure(link && link.pairedAt && !link.revokedAt && link.user.active, 401, 'SCANNER_DISCONNECTED', 'The scanner was disconnected. Pair again.');
  return link;
}
export async function sendScannerScan(token: string, barcode: string, eventKey: string) {
  return transaction(async tx => {
    const link = await authenticatedLink(tx, token);
    const normalized = normalizeBarcode(barcode);
    const existing = await tx.scannerEvent.findUnique({ where: { linkId_eventKey: { linkId: link.id, eventKey } } });
    if (existing) {
      ensure(existing.barcode === normalized, 409, 'SCAN_KEY_REUSED', 'This scan identifier was already used for another barcode.');
      return existing.result;
    }
    const quote = await scanIntoDraft(tx, publicUser(link.user), normalized);
    const line = quote.lines.find(item => item.barcode === normalized)!;
    const result = { draftId: quote.id, productName: line.productName, quantity: line.quantity, totalPieces: quote.totalPieces, added: true };
    await tx.scannerEvent.create({ data: { linkId: link.id, eventKey, barcode: normalized, result } });
    return result;
  });
}
export async function scannerPhoneStatus(token: string) {
  return transaction(async tx => {
    const link = await authenticatedLink(tx, token);
    const draft = await tx.invoiceDraft.upsert({ where: { currentKey: link.userId }, update: {}, create: { userId: link.userId, currentKey: link.userId } });
    return { connectionId: link.id, cashierName: link.user.name, draftId: draft.id };
  });
}
export async function scannerLinks(actor: Actor) {
  const links = await db.scannerLink.findMany({ where: { userId: actor.id, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, pairedAt: true, pairingExpiresAt: true, _count: { select: { events: true } }, events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, barcode: true, createdAt: true } } } });
  return { items: links };
}
export async function revokeScanner(actor: Actor, id: string) {
  return transaction(async tx => {
    const link = await tx.scannerLink.findFirst({ where: { id, userId: actor.id } });
    ensure(link, 404, 'SCANNER_NOT_FOUND', 'Scanner connection unavailable.');
    await tx.scannerLink.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, actor.id, 'SCANNER_DISCONNECTED', id);
    return { disconnected: true };
  });
}

export async function disconnectScannerToken(token:string){return transaction(async tx=>{const link=await authenticatedLink(tx,token);await tx.scannerLink.update({where:{id:link.id},data:{revokedAt:new Date()}});await audit(tx,link.userId,'SCANNER_DISCONNECTED',link.id);return {disconnected:true};});}
