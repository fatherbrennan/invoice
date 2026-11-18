import assert from 'node:assert/strict';

// Changed records can submit to reveal errors; invalid submissions never persist.
export async function verifySaveStates({ page, route, button, checks }) {
  for (const [
    destination,
    edit,
    saveName,
    fieldName,
    invalidName,
    invalidValue,
  ] of [
    [
      'Business profile',
      null,
      'Save profile',
      'Business name',
      'ABN (11 digits)',
      '123',
    ],
    [
      'Customers',
      'Edit ABC',
      'Save customer',
      'Customer name',
      'ABN (11 digits, if supplied)',
      '123',
    ],
    [
      'Services',
      'Edit Consulting',
      'Save service',
      'Service name',
      'Invoice description',
      '',
    ],
  ]) {
    await route(destination);
    if (edit) await button(edit).click();
    const field = page.getByLabel(fieldName, { exact: true });
    await page.waitForFunction((label) => {
      const input = document.querySelector(`[aria-label="${label}"]`);
      return input?.value && !input.matches(':disabled');
    }, fieldName);
    const original = await field.inputValue();
    const save = button(saveName);
    assert(
      await save.isDisabled(),
      `${saveName}: unchanged record must not be saveable`,
    );
    const cleanColor = await save.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    await field.fill(`${original} updated`);
    assert(await save.isEnabled(), `${saveName}: valid changes enable save`);
    assert.notEqual(
      await save.evaluate((node) => getComputedStyle(node).backgroundColor),
      cleanColor,
    );
    await field.fill(original);
    assert(await save.isDisabled(), `${saveName}: reverting clears changes`);
    const invalid = page.getByLabel(invalidName, { exact: true });
    const valid = await invalid.inputValue();
    await invalid.fill(invalidValue);
    assert(
      await save.isEnabled(),
      `${saveName}: invalid changes can request validation`,
    );
    await save.click();
    await page.locator('[aria-invalid="true"]').first().waitFor();
    await invalid.fill(valid);
    assert(await save.isDisabled());
  }
  await route('Invoices');
  checks.push(
    'Profile, customer and service saves disable for unchanged values, reveal errors on invalid submissions, and reset when reverted',
  );
}

export async function verifyInvoicePreference({
  page,
  route,
  first,
  second,
  checks,
}) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const selectedView = async (name) => {
    assert.equal(
      await button(name).getAttribute('aria-pressed'),
      'true',
      'Invoice view choice must persist',
    );
    await (name === 'PDF'
      ? page.locator('canvas[data-rendered="true"]')
      : page.locator('.snapshot-data')
    ).waitFor();
  };
  await route('Invoices');
  await button(`Preview ${first}`).click();
  await button('Invoice details').click();
  await button(`Preview ${second}`).click();
  await selectedView('Invoice details');
  await button('Close invoice details').click();
  await button(`Preview ${first}`).click();
  await selectedView('Invoice details');
  await route('Data');
  await route('Invoices');
  await button(`Preview ${second}`).click();
  await selectedView('Invoice details');
  await page.reload();
  await button(`Preview ${first}`).click();
  await selectedView('Invoice details');
  assert(
    await page.locator('.payment-action').evaluate((node) => {
      const style = getComputedStyle(node);
      return (
        style.borderLeftStyle === 'solid' &&
        parseFloat(style.borderLeftWidth) > 0
      );
    }),
    'Payment action must have a visible separator',
  );
  await button('PDF').click();
  await button(`Preview ${second}`).click();
  await selectedView('PDF');
  await page.reload();
  await button(`Preview ${first}`).click();
  await selectedView('PDF');
  await button('Invoice details').click();
  checks.push(
    'Both invoice views persist across invoice selection, closing, navigation and reload; payment action has a separator',
  );
}
