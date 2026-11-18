import assert from 'node:assert/strict';
import test from 'node:test';
import { money } from '../src/lib/money.ts';

test('AUD formatting preserves carries, signs and every cent at both exact limits', () => {
  for (const [cents, expected] of [
    [4, '$0.04'],
    [5, '$0.05'],
    [99, '$0.99'],
    [100, '$1.00'],
    [101, '$1.01'],
    [99999, '$999.99'],
    [100000, '$1,000.00'],
    [10000000000, '$100,000,000.00'],
    [-99, '-$0.99'],
    [-100, '-$1.00'],
    [-101, '-$1.01'],
    [9007199254740990, '$90,071,992,547,409.90'],
    [9007199254740991, '$90,071,992,547,409.91'],
    [-9007199254740990, '-$90,071,992,547,409.90'],
    [-9007199254740991, '-$90,071,992,547,409.91'],
  ]) {
    assert.equal(money(cents), expected, String(cents));
  }
});

test('AUD formatting rejects fractional, non-finite and unsafe cents instead of rounding', () => {
  for (const cents of [
    0.1,
    -0.1,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
  ]) {
    assert.throws(
      () => money(cents),
      { message: 'Amount exceeds the supported exact amount limit' },
      String(cents),
    );
  }
});
