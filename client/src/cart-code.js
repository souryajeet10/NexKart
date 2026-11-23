export function readCartCode(value, origin) {
  let code = String(value || '').trim();
  if (/^https?:/i.test(code)) {
    const url = new URL(code);
    if (url.origin !== origin) throw new Error('Scan a NexKart QR code from this store.');
    code = url.searchParams.get('cart') || '';
  }
  code = code.toUpperCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code) || code.length > 40) {
    throw new Error('Enter the cart code printed beside the QR label.');
  }
  return code;
}
