import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  customerSchema,
  draftSchema,
  fieldErrors,
  profileSchema,
  savedDraftSchema,
  searchSchema,
  serviceSchema,
} from '../src/lib/validation.ts';

const customer = {
  id: 'buyer-1',
  code: 'ABC',
  name: 'Example Buyer',
  abn: '',
  address: '',
  nextNumber: 1,
};
const profile = {
  name: 'Example Supplier',
  abn: '51824753556',
  address: '1 Example Street',
  paymentDetails: '',
  gstRegistered: true,
  showItemGst: true,
};
test('profile validation associates required, ABN and length errors with their fields', () => {
  assert.deepEqual(fieldErrors(profileSchema, profile), {});
  const errors = fieldErrors(profileSchema, {
    ...profile,
    name: ' ',
    abn: '12345678901',
    address: '',
    paymentDetails: 'x'.repeat(4001),
  });
  for (const key of ['name', 'abn', 'address', 'paymentDetails'])
    assert.ok(errors[key], key);
  assert.ok(fieldErrors(profileSchema, { ...profile, abn: '' }).abn);
  assert.deepEqual(
    fieldErrors(profileSchema, { ...profile, abn: '', gstRegistered: false }),
    {},
  );
});
test('customer code and internal ID uniqueness exclude only the record being edited', () => {
  assert.deepEqual(
    fieldErrors(customerSchema([customer], customer.id), customer),
    {},
  );
  assert.match(
    fieldErrors(customerSchema([customer], null), {
      ...customer,
      id: 'buyer-2',
    }).code,
    /already in use/,
  );
  assert.match(
    fieldErrors(customerSchema([customer], null), { ...customer, code: 'XYZ' })
      .id,
    /already in use/,
  );
  assert.ok(
    fieldErrors(customerSchema([], null), { ...customer, code: 'abc' }).code,
  );
  assert.ok(
    fieldErrors(customerSchema([], null), { ...customer, name: '' }).name,
  );
  assert.deepEqual(
    fieldErrors(customerSchema([], null), {
      ...customer,
      name: '',
      abn: '53004085616',
    }),
    {},
  );
});
test('invoice errors identify the exact row and reject invalid dates, decimals and tax choices', () => {
  const draft = {
    id: 'draft-1',
    customerId: customer.id,
    date: '2026-11-15',
    notes: '',
    lines: [
      {
        service: { id: 'service-1', name: 'Consulting' },
        description: 'Service',
        quantity: '1',
        unitPrice: '100.00',
        tax: 'taxable',
      },
    ],
  };
  assert.deepEqual(fieldErrors(draftSchema([customer], true), draft), {});
  const errors = fieldErrors(draftSchema([customer], false), {
    ...draft,
    date: '2026-02-30',
    lines: [
      { description: ' ', quantity: '0', unitPrice: '1.234', tax: 'taxable' },
    ],
  });
  for (const key of [
    'date',
    'lines.0.service',
    'lines.0.description',
    'lines.0.quantity',
    'lines.0.unitPrice',
    'lines.0.tax',
  ])
    assert.ok(errors[key], key);
  assert.ok(fieldErrors(draftSchema([], true), draft).customerId);
  assert.ok(
    fieldErrors(draftSchema([customer], true), {
      ...draft,
      notes: 'x'.repeat(4001),
    }).notes,
  );
});
test('UI uses the shared control library and never declares rounded corners', async () => {
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(path);
        continue;
      }
      if (!/\.(svelte|css)$/.test(path)) continue;
      const source = await readFile(path, 'utf8');
      if (
        path.endsWith('.svelte') &&
        !path.includes(`${join('components', 'ui')}`)
      )
        assert.doesNotMatch(
          source,
          /<(?:input|textarea|select|button)\b/,
          path,
        );
      for (const match of source.matchAll(/border-radius:\s*([^;}]+)/g))
        assert.equal(match[1].trim(), '0', path);
    }
  }
  await scan('src');
});

test('services need no code and still require a description and valid price', () => {
  const service = {
    id: 'service-1',
    name: 'Consulting',
    description: 'Technical advice',
    unitPrice: '100.00',
    tax: 'taxable',
  };
  assert.deepEqual(fieldErrors(serviceSchema, service), {});
  for (const [key, value] of Object.entries({
    name: ' ',
    description: '',
    unitPrice: '1.001',
    tax: 'unknown',
  }))
    assert.ok(fieldErrors(serviceSchema, { ...service, [key]: value })[key]);
});

test('search input has the same length and word limits as native FTS queries', () => {
  assert.deepEqual(fieldErrors(searchSchema, { query: 'ABC consulting' }), {});
  assert.ok(fieldErrors(searchSchema, { query: 'x'.repeat(201) }).query);
  assert.ok(fieldErrors(searchSchema, { query: 'word '.repeat(13) }).query);
});
test('invoice fields validate dates, relative offsets, attention and payment methods', () => {
  const draft = {
    id: 'draft-1',
    customerId: customer.id,
    date: '2026-01-31',
    reference: 'PO-123',
    due: { mode: 'relative', amount: 1, unit: 'months' },
    notes: '',
    lines: [
      {
        service: { id: 'svc', name: 'Advice' },
        description: 'Advice',
        quantity: '1',
        unitPrice: '10.00',
        tax: 'taxable',
      },
    ],
  };
  const schema = draftSchema([customer], true);
  assert.deepEqual(fieldErrors(schema, draft), {});
  for (const due of [
    { mode: 'none' },
    { mode: 'exact', date: '2028-02-29' },
    { mode: 'relative', amount: 30, unit: 'days' },
  ])
    assert.deepEqual(fieldErrors(schema, { ...draft, due }), {});
  for (const due of [
    { mode: 'exact', date: '2026-02-29' },
    { mode: 'relative', amount: -1, unit: 'days' },
    { mode: 'relative', amount: 1.5, unit: 'months' },
    { mode: 'relative', amount: 10000, unit: 'days' },
    { mode: 'relative', amount: 1, unit: 'years' },
  ])
    assert.ok(Object.keys(fieldErrors(schema, { ...draft, due })).length);
  assert.ok(
    fieldErrors(schema, { ...draft, reference: 'x'.repeat(201) }).reference,
  );
  assert.ok(
    fieldErrors(customerSchema([], null), {
      ...customer,
      attention: 'Accounts\nTeam',
    }).attention,
  );
  assert.deepEqual(
    fieldErrors(profileSchema, {
      ...profile,
      paymentMethods: [
        { type: 'custom', label: 'PayID', value: 'billing@example.test' },
      ],
    }),
    {},
  );
  assert.ok(
    fieldErrors(profileSchema, {
      ...profile,
      paymentMethods: [{ type: 'custom', label: 'PayID', value: '' }],
    })['paymentMethods.0.value'],
  );
});

test('saved drafts allow missing work but retain numeric and length boundaries', () => {
  const partial = {
    id: 'partial',
    customerId: '',
    date: '',
    reference: '',
    notes: '',
    lines: [],
  };
  assert.deepEqual(fieldErrors(savedDraftSchema, partial), {});
  assert.ok(fieldErrors(draftSchema([], false), partial).customerId);
  const line = { description: '', quantity: '', unitPrice: '', tax: 'noGst' };
  assert.deepEqual(
    fieldErrors(savedDraftSchema, { ...partial, lines: [line] }),
    {},
  );
  assert.ok(
    fieldErrors(savedDraftSchema, {
      ...partial,
      lines: [{ ...line, quantity: '-1' }],
    })['lines.0.quantity'],
  );
  assert.ok(
    fieldErrors(savedDraftSchema, { ...partial, notes: 'x'.repeat(4001) })
      .notes,
  );
});
