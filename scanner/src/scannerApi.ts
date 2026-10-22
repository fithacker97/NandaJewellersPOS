export type PairingCode = { serverUrl: string; code: string };
export type Connection = { token: string; connectionId: string; cashierName: string };
export type ScanResult = { draftId: string; productName: string; quantity: number; totalPieces: number; added: boolean };

export class ScannerError extends Error {
  constructor(message: string, readonly status = 0, readonly code = '') { super(message); }
}

export function parsePairingQr(value: string): PairingCode {
  let data: unknown;
  try { data = JSON.parse(value); } catch { throw new ScannerError('This is not a Nanda pairing QR.'); }
  if (!data || typeof data !== 'object') throw new ScannerError('This is not a Nanda pairing QR.');
  const pair = data as Record<string, unknown>;
  if (pair.type !== 'nanda-scanner-pairing' || pair.version !== 1 || typeof pair.code !== 'string' || !/^\d{8}$/.test(pair.code) || typeof pair.serverUrl !== 'string') {
    throw new ScannerError('This is not a valid Nanda pairing QR.');
  }
  let url: URL;
  try { url = new URL(pair.serverUrl); } catch { throw new ScannerError('The computer address in this QR is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ScannerError('The computer address in this QR is invalid.');
  }
  return { serverUrl: url.origin, code: pair.code };
}

async function request<T>(serverUrl: string, path: string, method: 'GET' | 'POST', token?: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(serverUrl + '/api/scanner/' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).error : null;
      const detail = error && typeof error === 'object' ? error as Record<string, unknown> : {};
      throw new ScannerError(typeof detail.message === 'string' ? detail.message : 'The computer could not complete this request.', response.status, typeof detail.code === 'string' ? detail.code : '');
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ScannerError) throw error;
    throw new ScannerError('Cannot reach the computer. Check that both devices are on the same Wi-Fi, then retry.');
  } finally { clearTimeout(timeout); }
}

export const pairScanner = ({ serverUrl, code }: PairingCode) => request<Connection>(serverUrl, 'pair', 'POST', undefined, { code });
export const scannerStatus = (serverUrl: string, token: string) => request<Omit<Connection, 'token'>>(serverUrl, 'status', 'GET', token);
export const sendScan = (serverUrl: string, token: string, barcode: string, eventKey: string) => request<ScanResult>(serverUrl, 'scan', 'POST', token, { barcode, eventKey });
export const disconnectScanner = (serverUrl: string, token: string) => request<{ disconnected: boolean }>(serverUrl, 'disconnect', 'POST', token, {});

export function isClosedConnection(error: unknown) {
  return error instanceof ScannerError && error.status === 401;
}
