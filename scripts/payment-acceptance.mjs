import assert from 'node:assert/strict';
import { chooseOption } from './combobox-acceptance.mjs';

export async function verifyPaymentMethods({
  page,
  route,
  ipc,
  fixture,
  checks,
  shot,
  viewport,
}) {
  const original = (await ipc('workspace')).profile;
  await ipc('save_profile', {
    profile: { ...fixture.profile, paymentMethods: [] },
  });
  await route('Business profile');
  const field = (name) => page.getByLabel(name, { exact: true });
  const button = (name) => page.getByRole('button', { name, exact: true });
  await button('Add payment method').click();
  await field('Account name').fill('Example Supplier');
  await field('BSB').fill('012-345');
  await field('Account number').fill('001234567');
  await chooseOption(field('Payment method 1'), 'Bank transfer');
  assert.equal(await field('Account number').inputValue(), '001234567');
  await button('Add payment method').click();
  await chooseOption(field('Payment method 2'), 'PayID');
  await field('PayID email address').fill('billing@example.test');
  await field('Recipient name (optional)').fill('Example Supplier');
  await button('Add payment method').click();
  await chooseOption(field('Payment method 3'), 'BPAY');
  await field('BPAY biller code').fill('012345');
  await button('Add payment method').click();
  await field('Payment method 4').click();
  assert.equal(
    await page.getByRole('option', { name: 'BPAY', exact: true }).isDisabled(),
    true,
  );
  await page.keyboard.press('Escape');
  await chooseOption(field('Payment method 4'), 'Custom');
  await field('Payment name 4').fill('Other arrangements');
  await field('Payment details 4').fill(
    'Contact accounts.\nQuote the invoice number.',
  );
  await field('BSB').fill('123');
  await field('Account number').focus();
  assert.equal(await button('Save profile').isEnabled(), true);
  await button('Save profile').click();
  assert.deepEqual((await ipc('workspace')).profile.paymentMethods ?? [], []);
  await page
    .getByText('Enter a six-digit BSB, with or without a hyphen.')
    .waitFor();
  await field('BSB').fill('012-345');
  await button('Move payment method 4 up').click();
  assert.equal(
    await field('Payment name 3').inputValue(),
    'Other arrangements',
  );
  await button('Move payment method 3 down').click();
  await button('Save profile').click();
  await page.getByText('Business profile saved.', { exact: true }).waitFor();
  const methods = (await ipc('workspace')).profile.paymentMethods;
  assert.deepEqual(
    methods.map((m) => m.type),
    ['bankTransfer', 'payId', 'bpay', 'custom'],
  );
  assert.equal(methods[0].accountNumber, '001234567');
  assert.equal(methods[0].bsb, '012345');
  assert.equal(await field('BSB').inputValue(), '012-345');
  if (shot) await shot('payment-methods');
  if (viewport) {
    await viewport({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (shot) await shot('payment-methods-compact');
    await viewport({ width: 1280, height: 850 });
  }
  await route('Invoices');
  await route('Business profile');
  assert.equal(
    await field('PayID email address').inputValue(),
    'billing@example.test',
  );
  for (const [type, label, value, formatted] of [
    [
      'Australian mobile',
      'PayID australian mobile',
      '+61412345678',
      '+61 412 345 678',
    ],
    ['ABN', 'PayID ABN', '51824753556', '51 824 753 556'],
    ['Organisation ID', 'PayID organisation ID', 'supplier-123'],
    ['Email address', 'PayID email address', 'billing@example.test'],
  ]) {
    await chooseOption(field('PayID type'), type);
    assert.equal(await field(label).inputValue(), '');
    await field(label).fill(formatted ?? value);
    await button('Save profile').click();
    await page.waitForFunction(
      () => document.querySelector('button[data-command="save"]')?.disabled,
    );
    assert.equal(await field(label).inputValue(), formatted ?? value);
    assert.equal(
      (await ipc('workspace')).profile.paymentMethods[1].value,
      value,
    );
  }
  const customer = {
    ...fixture.customer,
    id: 'payment-customer',
    code: 'PAYMENT',
  };
  const other = {
    ...customer,
    id: 'payment-other',
    code: 'PAYOTHER',
    name: 'Other payment customer',
  };
  await ipc('save_customer', { customer });
  await ipc('save_customer', { customer: other });
  const service = {
    id: 'payment-service',
    name: 'Payment test service',
    description: 'Payment test service',
    unitPrice: '10.00',
    tax: 'taxable',
  };
  await ipc('save_service', { service });
  const draft = {
    ...fixture.draft,
    id: 'payment-draft',
    customerId: customer.id,
    bpayReference: '',
    lines: [
      {
        service: { id: service.id, name: service.name },
        description: service.description,
        quantity: '1',
        unitPrice: '10.00',
        tax: 'taxable',
      },
    ],
  };
  await ipc('save_draft', { draft });
  await page.goto(`${new URL(page.url()).origin}/invoices/edit?id=${draft.id}`);
  await field('BPAY reference (CRN)').waitFor();
  await button('Issue invoice').click();
  assert.equal(
    await field('BPAY reference (CRN)').getAttribute('aria-invalid'),
    'true',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Confirm issue', exact: true })
      .count(),
    0,
  );
  await field('BPAY reference (CRN)').fill('00012345678901234567');
  await page.waitForFunction(
    () => !document.querySelector('button[data-command="save"]')?.disabled,
  );
  await button('Save draft').click();
  await page.waitForFunction(
    () => document.querySelector('button[data-command="save"]')?.disabled,
  );
  assert.equal(
    (await ipc('get_draft', { id: draft.id })).bpayReference,
    '00012345678901234567',
  );
  const preview = await ipc('preview_draft', {
    draft: { ...draft, bpayReference: '00012345678901234567' },
  });
  assert.equal(preview.snapshot.profile.paymentMethods.length, 4);
  assert(preview.pdf.length > 1000);
  await field('Customer').fill(other.name);
  await page
    .getByRole('option', { name: `${other.name} ${other.code}`, exact: true })
    .click();
  assert.equal(await field('BPAY reference (CRN)').inputValue(), '');
  await field('BPAY reference (CRN)').fill('01');
  await button('Save draft').click();
  await page.waitForFunction(
    () => document.querySelector('button[data-command="save"]')?.disabled,
  );
  await ipc('issue', { id: draft.id });
  const issued = await ipc('get_issued', { id: draft.id });
  assert.equal(issued.snapshot.draft.bpayReference, '01');
  assert.equal(issued.snapshot.customer.id, other.id);
  await route('Business profile');
  await button('Remove payment method 3').click();
  await button('Save profile').click();
  await page.waitForFunction(
    () => document.querySelector('button[data-command="save"]')?.disabled,
  );
  assert.equal(
    (await ipc('workspace')).profile.paymentMethods.some(
      (m) => m.type === 'bpay',
    ),
    false,
  );
  assert.deepEqual(
    (await ipc('get_issued', { id: draft.id })).snapshot,
    issued.snapshot,
  );
  if (original) await ipc('save_profile', { profile: original });
  checks.push(
    'Structured methods: all fields, PayID types, ordering, removal, validation, save/reload, invoice CRN clearing, preview and immutable issued snapshot',
  );
}
