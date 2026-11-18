import assert from 'node:assert/strict';

// User requirement: notifications float as toasts without moving page content.
// Interaction contract: timed success, persistent errors, pause, dismissal, modal access.
export async function verifyToasts({
  page,
  route,
  button,
  fail,
  viewport,
  shot,
  checks,
}) {
  await route('Invoices');
  await button('Preview IABC1').click();
  await page.locator('canvas[data-rendered="true"]').waitFor();
  const host = page.getByRole('region', { name: 'Notifications', exact: true });
  const ledger = page.getByRole('region', {
    name: 'Invoice ledger',
    exact: true,
  });
  const ledgerBounds = await ledger.boundingBox();
  for (const state of ['paid', 'unpaid']) {
    await button(`Mark IABC1 ${state}`).click();
    const message = `IABC1 marked ${state}.`;
    const toast = host.getByRole('status').filter({ hasText: message });
    await toast.waitFor();
    assert.equal(
      await host.evaluate((node) => getComputedStyle(node).position),
      'fixed',
    );
    assert.equal(
      await page.getByText(message, { exact: true }).count(),
      1,
      'No duplicate payment banner',
    );
    assert.deepEqual(
      await ledger.boundingBox(),
      ledgerBounds,
      'Payment notification must not move the ledger',
    );
    await button(
      `Mark IABC1 ${state === 'paid' ? 'unpaid' : 'paid'}`,
    ).waitFor();
    await shot(`toast-marked-${state}`);
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  }
  await fail('set_paid', async () => {
    await button('Mark IABC1 paid').click();
    await host
      .getByRole('alert')
      .filter({ hasText: 'Injected set_paid failure' })
      .waitFor();
    assert.equal(
      await host
        .getByRole('status')
        .filter({ hasText: 'IABC1 marked paid.' })
        .count(),
      0,
    );
    assert(
      await button('Mark IABC1 paid').isVisible(),
      'Failed payment update must retain unpaid state',
    );
  });
  checks.push(
    'Paid and unpaid confirmations use one floating toast without shifting the ledger; failed payment updates use an error toast and retain state',
  );
  await route('Business profile');
  const save = button('Save profile');
  await save.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  const nameField = page.getByLabel('Business name', { exact: true });
  const originalName = await nameField.inputValue();
  const changeName = async () =>
    nameField.fill(
      (await nameField.inputValue()) === originalName
        ? `${originalName} updated`
        : originalName,
    );
  const form = page.locator('form');
  const before = await form.boundingBox();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await changeName();
  await save.click();
  await page.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  const success = host
    .getByRole('status')
    .filter({ hasText: 'Business profile saved.' });
  await success.waitFor();
  assert.equal(
    await host.evaluate((node) => getComputedStyle(node).position),
    'fixed',
  );
  assert.deepEqual(
    await form.boundingBox(),
    before,
    'A notification must not shift the form',
  );
  assert(
    await host.evaluate((node) => !node.contains(document.activeElement)),
    'Toast must not steal focus',
  );

  const dismiss = success.getByRole('button', { name: 'Dismiss notification' });
  await nameField.focus();
  await dismiss.focus();
  await page.clock.runFor(6500);
  assert(await success.isVisible(), 'Focused toast must not expire');
  await dismiss.press('Enter');
  await success.waitFor({ state: 'detached' });
  assert(
    await nameField.evaluate((node) => node === document.activeElement),
    'Dismiss restores prior focus',
  );

  await changeName();
  await save.click();
  await page.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  await success.waitFor();
  await success.hover();
  await page.clock.runFor(6500);
  assert(await success.isVisible(), 'Hovered toast must not expire');
  await page.mouse.move(0, 0);
  await page.clock.runFor(6500);
  await success.waitFor({ state: 'detached' });

  await changeName();
  await save.click();
  await page.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  await success.waitFor();
  await changeName();
  await save.click();
  await page.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  assert.equal(await success.count(), 1, 'Repeated success must not pile up');
  await page.clock.resume();
  await route('Services');
  await page
    .getByRole('heading', { level: 1, name: 'Services', exact: true })
    .waitFor();
  assert(await success.isVisible(), 'Success survives navigation');
  await success.getByRole('button', { name: 'Dismiss notification' }).click();
  await route('Business profile');
  await page
    .getByRole('heading', { level: 1, name: 'Business profile', exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector('fieldset').disabled,
  );
  const persistedName = await nameField.inputValue();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
  await fail('save_profile', async () => {
    await changeName();
    await save.click();
    await page.waitForFunction(
      () => !document.querySelector('fieldset').disabled,
    );
    const error = host
      .getByRole('alert')
      .filter({ hasText: 'Injected save_profile failure' });
    await error.waitFor();
    await page.clock.runFor(6500);
    assert(await error.isVisible(), 'Error remains until dismissed');
    await viewport({ width: 380, height: 300 });
    const bounds = await error.boundingBox();
    assert(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 380 &&
        bounds.y + bounds.height <= 300,
    );
    await shot('toast-error-narrow');
    await error.getByRole('button', { name: 'Dismiss notification' }).focus();
    await page.keyboard.press('Enter');
    await error.waitFor({ state: 'detached' });
  });
  await nameField.fill(persistedName);
  assert(
    await save.isDisabled(),
    'Reverting the failed save returns to the saved profile',
  );
  await page.clock.resume();
  await viewport({ width: 1280, height: 850 });
  await route('Services');
  await button('Edit Consulting').click();
  await button('Remove service').click();
  const dialog = page.getByRole('dialog', {
    name: 'Remove Consulting?',
    exact: true,
  });
  await fail('delete_service', async () => {
    await dialog
      .getByRole('button', { name: 'Confirm removal', exact: true })
      .click();
    const error = dialog
      .getByRole('alert')
      .filter({ hasText: 'Injected delete_service failure' });
    await error.waitFor();
    const close = error.getByRole('button', { name: 'Dismiss notification' });
    await close.focus();
    assert(
      await close.evaluate((node) => node === document.activeElement),
      'Modal toast must be keyboard accessible',
    );
    await shot('toast-modal-error');
    await close.press('Enter');
    await error.waitFor({ state: 'detached' });
    assert(
      await dialog.isVisible(),
      'Dismissing an error must not close its dialog',
    );
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await route('Invoices');
  checks.push(
    'Toasts float without layout shift or focus theft; expiry pauses for hover/focus, errors persist, dismissal restores focus, navigation and modal keyboard access work',
  );
}
