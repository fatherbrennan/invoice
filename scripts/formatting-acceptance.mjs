import assert from 'node:assert/strict';
import { chooseOption } from './combobox-acceptance.mjs';

// User contracts: stable filter alignment, meaningful initial focus and formatted inputs with raw storage.
export async function verifyFormatting({
  page,
  route,
  ipc,
  fixture,
  checks,
  shot,
  viewport,
}) {
  await ipc('save_profile', { profile: fixture.profile });
  await ipc('save_customer', { customer: fixture.customer });
  await viewport({ width: 1280, height: 900 });
  const noAutofocus = async (selector) => {
    await page.waitForFunction((value) => {
      const field = document.querySelector(value);
      return field && !field.matches(':disabled');
    }, selector);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.matches('input, select, textarea, button'),
      ),
      false,
      `${selector}: navigation must not autofocus a control`,
    );
  };
  await route('Settings');
  await noAutofocus('#theme');
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Data', exact: true })
    .click();
  await noAutofocus('[data-command="exportData"]');
  await route('Invoices');
  await page.getByRole('link', { name: 'Summary', exact: true }).click();
  await noAutofocus('#invoice-period');
  await chooseOption(
    page.getByLabel('Invoice date', { exact: true }),
    'Custom',
  );
  const geometry = () =>
    page.evaluate(() => {
      const control = document
        .querySelector('#invoice-period')
        .closest('.field-control')
        .getBoundingClientRect();
      const refresh = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === 'Refresh')
        .getBoundingClientRect();
      return {
        control: control.y + control.height / 2,
        refresh: refresh.y + refresh.height / 2,
      };
    });
  const invalid = await geometry();
  assert(
    Math.abs(invalid.control - invalid.refresh) <= 2,
    `Refresh must align with controls even with errors: ${JSON.stringify(invalid)}`,
  );
  await shot('formatting-custom-errors');
  await viewport({ width: 390, height: 844 });
  const compact = await geometry();
  assert(Math.abs(compact.control - compact.refresh) <= 2);
  await shot('formatting-custom-errors-compact');
  await viewport({ width: 1280, height: 900 });
  await page.locator('#invoice-from').fill('2026-01-01');
  await page.locator('#invoice-to').fill('2026-12-31');
  const valid = await geometry();
  assert(Math.abs(valid.control - valid.refresh) <= 2);
  assert(Math.abs(valid.refresh - invalid.refresh) <= 2);
  checks.push(
    'Refresh stays aligned with date controls with and without validation errors',
  );

  const focused = (id) =>
    page.waitForFunction((value) => document.activeElement?.id === value, id);
  await route('Invoices');
  await focused('invoice-search');
  await page.getByRole('link', { name: 'New draft', exact: true }).click();
  await focused('customer');
  await route('Invoices');
  await focused('invoice-search');
  await page.keyboard.press('Control+n');
  await focused('customer');
  await route('Customers');
  await focused('customer-search');
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  await focused('customer-name');
  await page
    .getByRole('button', { name: 'Edit ABC', exact: true })
    .press('Enter');
  await focused('customer-name');
  await page
    .getByRole('link', { name: 'New draft for ABC', exact: true })
    .click();
  await focused('invoice-date');
  await route('Services');
  await focused('service-search');
  await page.keyboard.press('Control+n');
  await focused('service-name');
  checks.push(
    'Navigation focuses list searches; mouse and Ctrl+N focus the first creation field',
  );

  await page.locator('#service-name').fill('Formatting acceptance service');
  await page
    .locator('#service-description')
    .fill('Formatting acceptance description');
  const price = page.locator('#service-price');
  await price.fill('');
  await price.pressSequentially('1.7');
  assert.equal(await price.inputValue(), '1.7');
  await page.locator('#service-name').focus();
  assert.equal(await price.inputValue(), '1.70');
  await price.fill('1.701');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('#service-price').getAttribute('aria-invalid') ===
      'true',
  );
  assert.equal(await price.inputValue(), '1.701');
  await price.fill('$1,234.7');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => {
    const save = document.querySelector('[data-command="save"]');
    return save?.disabled && !save.closest('fieldset')?.disabled;
  });
  const services = await ipc('search_services', {
    query: { query: 'Formatting acceptance service', page: 0 },
  });
  assert.equal(services.items[0].unitPrice, '1234.70');
  await route('Business profile');
  await noAutofocus('#business-name');
  checks.push(
    'Summary, Business profile, Preferences and Data do not autofocus controls',
  );
  const abn = page.locator('#business-abn');
  assert.equal(await abn.inputValue(), '51 824 753 556');
  await abn.fill('86 474 038 153');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.waitForFunction(() => {
    const save = document.querySelector('[data-command="save"]');
    return save?.disabled && !save.closest('fieldset')?.disabled;
  });
  assert.equal((await ipc('workspace')).profile.abn, '86474038153');
  assert.equal(await abn.inputValue(), '86 474 038 153');
  await shot('formatting-profile');
  await route('Customers');
  await focused('customer-search');
  await page
    .getByRole('button', { name: 'Edit ABC', exact: true })
    .press('Enter');
  await focused('customer-name');
  await page.locator('#customer-abn').fill('86 474 038 153');
  await page
    .getByRole('button', { name: 'Save customer', exact: true })
    .click();
  await page.waitForFunction(() => {
    const save = document.querySelector('[data-command="save"]');
    return save?.disabled && !save.closest('fieldset')?.disabled;
  });
  assert.equal(
    (await ipc('get_customer', { id: fixture.customer.id })).customer.abn,
    '86474038153',
  );
  assert.equal(
    await page.locator('#customer-abn').inputValue(),
    '86 474 038 153',
  );
  await page.locator('#customer-search').fill('86 474 038 153');
  await page.getByRole('button', { name: 'Edit ABC', exact: true }).waitFor();
  checks.push(
    'Price blur pads cents, excess precision remains invalid, keyboard save normalizes pasted currency, and ABNs display grouped but persist raw',
  );
}
