import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { paymentText } from '../src/lib/payments.ts';
import {
  draftSchema,
  fieldErrors,
  profileSchema,
} from '../src/lib/validation.ts';

const fixture = JSON.parse(
  await readFile(new URL('../tests/fixtures/invoices.json', import.meta.url)),
);
const methods = [
  {
    type: 'bankTransfer',
    accountName: 'Example Supplier',
    bsb: '012345',
    accountNumber: '001234567',
  },
  {
    type: 'payId',
    payIdType: 'email',
    value: 'billing@example.test',
    recipientName: 'Example Supplier',
  },
  {
    type: 'payId',
    payIdType: 'mobile',
    value: '+61412345678',
    recipientName: '',
  },
  { type: 'payId', payIdType: 'abn', value: '51824753556', recipientName: '' },
  {
    type: 'payId',
    payIdType: 'organisationId',
    value: 'supplier-123',
    recipientName: '',
  },
  { type: 'bpay', billerCode: '012345' },
  { type: 'custom', label: 'Other', value: 'First line\nSecond line' },
];
test('PayID identifiers are grouped for display without changing their stored values', () => {
  assert.equal(paymentText(methods[2]).value, '+61 412 345 678');
  assert.equal(paymentText(methods[3]).value, '51 824 753 556');
  assert.equal(methods[2].value, '+61412345678');
  assert.equal(methods[3].value, '51824753556');
});
fixture.draft.lines = fixture.draft.lines.map((line, index) => ({
  ...line,
  service: { id: `service-${index}`, name: `Service ${index}` },
}));
test('all payment variants validate and retain leading zeroes and multiline details', () => {
  assert.deepEqual(
    fieldErrors(profileSchema, { ...fixture.profile, paymentMethods: methods }),
    {},
  );
  assert.equal(
    paymentText(methods[0]).value,
    'Account name: Example Supplier\nBSB: 012-345\nAccount number: 001234567',
  );
  assert.equal(
    paymentText(methods[5], '00012345678901234567').value,
    'Biller code: 012345\nRef: 00012345678901234567',
  );
  assert.equal(paymentText(methods[6]).value, 'First line\nSecond line');
});
test('invalid typed fields, unknown shapes and duplicate BPAY billers are rejected', () => {
  const invalid = [
    { ...methods[0], accountName: ' ' },
    { ...methods[0], bsb: '01-2345' },
    { ...methods[0], bsb: '１２３４５６' },
    { ...methods[0], accountNumber: '12345678901' },
    { ...methods[1], value: 'bad@example' },
    { ...methods[1], value: 'a@@b.test' },
    { ...methods[2], value: '04123' },
    { ...methods[3], value: '51824753557' },
    { ...methods[4], value: ' ' },
    { ...methods[5], billerCode: '12 34' },
    { ...methods[6], label: '' },
    { ...methods[6], value: 'x'.repeat(1001) },
    { ...methods[0], value: 'unused' },
    { type: 'unknown' },
    { label: 'Old', value: 'Format' },
  ];
  for (const method of invalid)
    assert.notDeepEqual(
      fieldErrors(profileSchema, {
        ...fixture.profile,
        paymentMethods: [method],
      }),
      {},
      JSON.stringify(method),
    );
  assert.notDeepEqual(
    fieldErrors(profileSchema, {
      ...fixture.profile,
      paymentMethods: [methods[5], methods[5]],
    }),
    {},
  );
});
test('BPAY reference is required only with BPAY and is strictly 2–20 ASCII digits', () => {
  const schema = draftSchema(
    [fixture.customer],
    fixture.profile.gstRegistered,
    true,
  );
  for (const bpayReference of [
    undefined,
    '',
    '1',
    '1'.repeat(21),
    '12 34',
    '１２',
  ]) {
    assert.ok(
      fieldErrors(schema, { ...fixture.draft, bpayReference }).bpayReference,
    );
  }
  for (const bpayReference of ['01', '00012345678901234567']) {
    assert.deepEqual(
      fieldErrors(schema, { ...fixture.draft, bpayReference }),
      {},
    );
  }
  assert.ok(
    fieldErrors(draftSchema([fixture.customer], true), {
      ...fixture.draft,
      bpayReference: '12',
    }).bpayReference,
  );
});
