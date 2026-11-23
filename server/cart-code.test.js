import test from 'node:test';
import assert from 'node:assert/strict';
import { readCartCode } from '../client/src/cart-code.js';

test('cart codes accept manual input and same-store QR links', () => {
  const origin = 'https://nexkart.example';
  assert.equal(readCartCode(' sc-01 ', origin), 'SC-01');
  assert.equal(readCartCode(origin + '/?cart=SC-01', origin), 'SC-01');
  for (const value of ['', 'https://other.example/?cart=SC-01', origin, '<script>', 'a'.repeat(41)]) {
    assert.throws(() => readCartCode(value, origin));
  }
});
