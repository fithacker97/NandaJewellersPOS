// Exact fixed-point decimal arithmetic. Rates and weights retain four decimals;
// paise rounding occurs only after the full multiplication, never per piece first.
const SCALE = 10000n;
function fixed(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (!match) throw new RangeError('Expected a nonnegative decimal with at most four places.');
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(4, '0'));
}
function display(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, '0');
  return digits.slice(0, -places) + '.' + digits.slice(-places);
}
function paise(product: bigint): string {
  // Both factors have scale 10^4. Converting the result to paise divides by 10^6.
  return display((product + 500000n) / 1000000n, 2);
}
export function calculatePrice(base: string, product: string, employee: string, weight: string, quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('Quantity must be a nonnegative whole number.');
  const rate = fixed(base) + fixed(product) + fixed(employee);
  const grams = fixed(weight);
  return { sellingRate: display(rate, 4), piecePrice: paise(rate * grams),
    lineTotal: paise(rate * grams * BigInt(quantity)), totalWeight: display(grams * BigInt(quantity), 4) };
}
export function inr(value: string | number): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return '—';
  const fraction = match[3] ?? '';
  const cents = BigInt(match[2]) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0')) + (Number(fraction[2] ?? 0) >= 5 ? 1n : 0n);
  const amount = display(cents, 2);
  const [integer, decimal] = amount.split('.');
  const tail = integer.slice(-3);
  const head = integer.slice(0, -3).replace(/(\d)(?=(\d{2})+$)/g, '$1,');
  return (match[1] ? '-₹' : '₹') + (head ? head + ',' : '') + tail + '.' + decimal;
}
