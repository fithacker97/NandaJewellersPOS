import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePairingQr, ScannerError, sendScan, isClosedConnection } from '../src/scannerApi.ts';

test('accepts only the showroom pairing QR format', () => {
  assert.deepEqual(parsePairingQr(JSON.stringify({ type: 'nanda-scanner-pairing', version: 1, serverUrl: 'http://192.168.1.4:5000', code: '00123456' })), { serverUrl: 'http://192.168.1.4:5000', code: '00123456' });
  for (const value of ['hello', '{}', JSON.stringify({ type: 'nanda-scanner-pairing', version: 1, serverUrl: 'https://example.com/path', code: '00123456' }), JSON.stringify({ type: 'nanda-scanner-pairing', version: 1, serverUrl: 'file:///tmp', code: '00123456' })]) {
    assert.throws(() => parsePairingQr(value), ScannerError);
  }
});

test('a network retry sends the same scan ID without adding an Origin header', async () => {
  const previous = globalThis.fetch;
  const attempts = [];
  globalThis.fetch = async (url, options) => {
    attempts.push({ url, options });
    if (attempts.length === 1) throw new TypeError('network lost');
    return new Response(JSON.stringify({ draftId: 'draft', productName: 'Ring', quantity: 1, totalPieces: 1, added: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await assert.rejects(sendScan('http://192.168.1.4:5000', 'a'.repeat(64), 'NJ123', 'event-123456'), /Cannot reach the computer/);
    const result = await sendScan('http://192.168.1.4:5000', 'a'.repeat(64), 'NJ123', 'event-123456');
    assert.equal(result.productName, 'Ring');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].url, 'http://192.168.1.4:5000/api/scanner/scan');
    assert.deepEqual(JSON.parse(attempts[0].options.body), JSON.parse(attempts[1].options.body));
    assert.equal(attempts[0].options.headers.Authorization, 'Bearer ' + 'a'.repeat(64));
    assert.equal(attempts[0].options.headers.Origin, undefined);
  } finally { globalThis.fetch = previous; }
});

test('revoked pairing status is recognized as a closed connection', () => {
  assert.equal(isClosedConnection(new ScannerError('Disconnected', 401, 'SCANNER_DISCONNECTED')), true);
  assert.equal(isClosedConnection(new ScannerError('Draft conflict', 409, 'DRAFT_CLOSED')), false);
  assert.equal(isClosedConnection(new ScannerError('Offline')), false);
});
