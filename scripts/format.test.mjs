import assert from 'node:assert/strict';
import test from 'node:test';
import { displayValue, rawValue } from '../src/lib/format.ts';
import { fieldErrors, serviceSchema } from '../src/lib/validation.ts';

test('formatted identifiers round-trip without losing leading zeroes or hiding invalid characters', () => {
  for (const [kind, raw, display] of [
    ['abn', '86474038153', '86 474 038 153'],
    ['bsb', '012345', '012-345'],
    ['mobile', '0412345678', '0412 345 678'],
    ['mobile', '+61412345678', '+61 412 345 678'],
    ['digits', '001234567', '001234567'],
  ]) {
    assert.equal(displayValue(raw, kind), display);
    assert.equal(rawValue(display, kind), raw);
  }
  for (const [kind, invalid] of [
    ['abn', '86a474038153'],
    ['bsb', '01-2345'],
    ['mobile', '+61x412345678'],
    ['digits', '1e6'],
  ]) {
    assert.equal(rawValue(invalid, kind), invalid);
  }
});

test('money accepts conventional pasted values and pads cents without rounding or floating-point conversion', () => {
  for (const [input, expected] of [
    ['1.7', '1.70'],
    ['1', '1.00'],
    ['.7', '0.70'],
    ['1.', '1.00'],
    ['$1,234.7', '1234.70'],
    ['000.01', '0.01'],
    ['1000000', '1000000.00'],
  ]) {
    assert.equal(rawValue(input, 'money'), expected);
    assert.equal(displayValue(input, 'money'), expected);
  }
  const service = {
    id: 'test',
    name: 'Test',
    description: 'Test',
    tax: 'taxable',
  };
  for (const input of [
    '',
    '1.701',
    '-1',
    '1e3',
    'NaN',
    'Infinity',
    '1,23.00',
    '$-10',
    '1000000.01',
  ]) {
    const unitPrice = rawValue(input, 'money');
    assert(
      fieldErrors(serviceSchema, { ...service, unitPrice }).unitPrice,
      `${input} must be rejected`,
    );
  }
  assert.equal(rawValue('1.701', 'money'), '1.701');
});

test('quantities retain up to three decimals and invalid precision remains visible', () => {
  assert.equal(displayValue('001.700', 'quantity'), '1.7');
  assert.equal(rawValue('.001', 'quantity'), '0.001');
  assert.equal(rawValue('1.0001', 'quantity'), '1.0001');
});
