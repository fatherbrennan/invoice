import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chooseOption } from './combobox-acceptance.mjs';
import { verifyInvoicePreference } from './editor-acceptance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'invoice-check-'));
const directory = join(scratch, 'workspace');
await mkdir(directory);
const savedPdf = join(directory, 'original.pdf');
const laterPdf = join(directory, 'later.pdf');
const restoredPdf = join(directory, 'restored.pdf');
const exportFile = join(directory, 'transfer.zip');
const invalidFile = join(directory, 'invalid.json');
await writeFile(invalidFile, '{"version":999}');
const fixture = JSON.parse(
  await readFile(join(root, 'tests/fixtures/invoices.json'), 'utf8'),
);
let child;
let browser;
let page;
const errors = [];
const checks = [];

function readZip(path) {
  const files = JSON.parse(
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($env:INVOICE_TEST_ARCHIVE)
    try {
      $files = @{}
      foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        $buffer = New-Object System.IO.MemoryStream
        try {
          $stream.CopyTo($buffer)
          $files[$entry.FullName] = [Convert]::ToBase64String($buffer.ToArray())
        } finally { $stream.Dispose(); $buffer.Dispose() }
      }
      ConvertTo-Json -InputObject $files -Compress
    } finally { $archive.Dispose() }
  `,
      ],
      {
        env: { ...process.env, INVOICE_TEST_ARCHIVE: path },
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  );
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [
      name,
      Buffer.from(bytes, 'base64'),
    ]),
  );
}

async function start(dataDirectory = join(directory, 'source'), dialogs = []) {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  child = spawn(join(root, 'src-tauri/target/debug/invoice.exe'), [], {
    env: {
      ...process.env,
      INVOICE_DATA_DIR: dataDirectory,
      INVOICE_TEST_DIALOGS: JSON.stringify(dialogs),
      WEBVIEW2_USER_DATA_FOLDER: join(dataDirectory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    windowsHide: true,
  });
  child.on('error', (error) => errors.push(String(error)));
  let startupError = '';
  child.stderr.on('data', (chunk) => {
    startupError = `${startupError}${chunk}`.slice(-4000);
  });
  let endpoint;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.equal(
      child.exitCode,
      null,
      `Native app exited during startup: ${startupError}`,
    );
    try {
      endpoint = (
        await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      ).webSocketDebuggerUrl;
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  assert(endpoint, 'Native WebView2 did not start');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent('page'));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
}

async function stop() {
  await browser?.close();
  browser = undefined;
  if (child?.exitCode === null) {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill();
    await exited;
  }
}
async function ipc(command, args = {}) {
  return page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
}
async function toast(message, role = 'status') {
  const host = page.getByRole('region', { name: 'Notifications', exact: true });
  const notification = host.getByRole(role).filter({ hasText: message });
  await notification.waitFor();
  assert.equal(
    await host.evaluate((node) => getComputedStyle(node).position),
    'fixed',
    'Operation messages must float as toasts',
  );
  await notification
    .getByRole('button', { name: 'Dismiss notification' })
    .click();
}

async function dismissNotifications() {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' });
  while (await dismiss.count()) await dismiss.first().click();
}

async function saveCatalogueDraft(draft) {
  for (const [index, line] of draft.lines.entries()) {
    const service = {
      id: `${draft.id}-service-${index}`,
      name: `Fixture service ${index + 1}`,
      description: line.description,
      unitPrice: line.unitPrice,
      tax: line.tax,
    };
    await ipc('save_service', { service });
    line.service = { id: service.id, name: service.name };
  }
  await ipc('save_draft', { draft });
}

async function verifyAdminControls() {
  const failures = await page.evaluate(() =>
    [...document.querySelectorAll('body *')].flatMap((element) => {
      if (!(element instanceof HTMLElement) || !element.getClientRects().length)
        return [];
      const css = getComputedStyle(element);
      if (
        [
          css.borderTopLeftRadius,
          css.borderTopRightRadius,
          css.borderBottomLeftRadius,
          css.borderBottomRightRadius,
        ].some((radius) => parseFloat(radius) !== 0)
      )
        return [`Rounded ${element.tagName}.${element.className}`];
      if (
        element.matches('input,select,textarea') &&
        !element.closest('.admin-field')
      )
        return [`Unshared field ${element.id}`];
      return [];
    }),
  );
  assert.deepEqual(failures, []);
}
async function route(name) {
  if (name === 'Data' || name === 'Preferences') {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name, exact: true })
      .click();
    await page.waitForURL(`**/settings/${name.toLowerCase()}`);
    await page
      .getByRole('heading', {
        name: name === 'Data' ? 'Export data' : 'Appearance',
        exact: true,
      })
      .waitFor();
    if (name === 'Preferences') {
      const advanced = page.locator('details.shortcuts');
      if (!((await advanced.getAttribute('open')) !== null))
        await advanced.locator('summary').first().click();
    }
    return;
  }
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: true })
    .click();
}

try {
  await start();
  await route('Business profile');
  await page
    .getByLabel('Business name', { exact: true })
    .fill(fixture.profile.name);
  await page.getByLabel('ABN (11 digits)', { exact: true }).fill('11111111111');
  await page
    .getByLabel('Business address', { exact: true })
    .fill(fixture.profile.address);
  await page
    .getByLabel('Other payment instructions', { exact: true })
    .fill(fixture.profile.paymentDetails);
  await page
    .getByRole('button', { name: 'Add payment method', exact: true })
    .click();
  await chooseOption(
    page.getByLabel('Payment method 1', { exact: true }),
    'PayID',
  );
  await page
    .getByLabel('PayID email address', { exact: true })
    .fill('billing@example.test');
  await page.getByLabel('Registered for GST', { exact: true }).check();
  await page.getByLabel('Show GST for each item', { exact: true }).check();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page
    .locator('#business-abn-message')
    .filter({ hasText: 'checksum' })
    .waitFor();
  assert.equal(
    await page.locator('#business-abn').getAttribute('aria-invalid'),
    'true',
  );
  assert.equal(
    await page.locator('#business-abn').getAttribute('aria-describedby'),
    'business-abn-message',
  );
  assert.equal(
    (await ipc('load')).profile,
    null,
    'Invalid profile must not be saved',
  );
  assert.equal(
    await page.getByLabel('Business name', { exact: true }).inputValue(),
    fixture.profile.name,
  );
  await page
    .getByLabel('ABN (11 digits)', { exact: true })
    .fill(fixture.profile.abn);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await toast('Business profile saved.');
  checks.push(
    'Profile persisted; associated Valibot ABN error visible and invalid inputs never saved',
  );
  await route('Customers');
  for (const code of ['ABC', 'XYZ']) {
    await page
      .getByRole('button', { name: 'New customer', exact: true })
      .click();
    await page.getByLabel('Customer code', { exact: true }).fill(code);
    await page
      .getByLabel('Attention', { exact: true })
      .fill('Accounts payable');
    await page
      .getByLabel('Customer name', { exact: true })
      .fill(`Example ${code}`);
    await page
      .getByRole('button', { name: 'Save customer', exact: true })
      .click();
    await page
      .getByRole('button', { name: `Edit ${code}`, exact: true })
      .waitFor();
  }
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  await page.getByLabel('Customer code', { exact: true }).fill('abc');
  await page
    .getByLabel('Customer name', { exact: true })
    .fill('Duplicate buyer');
  await page
    .getByRole('button', { name: 'Save customer', exact: true })
    .click();
  await page
    .locator('#customer-code-message')
    .filter({ hasText: 'already in use' })
    .waitFor();
  assert.equal(
    await page.getByLabel('Customer code', { exact: true }).inputValue(),
    'ABC',
  );
  assert.equal((await ipc('load')).customers.length, 2);
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit XYZ', exact: true }).click();
  await page
    .getByLabel('Customer address', { exact: true })
    .fill('Updated address');
  await page
    .getByRole('button', { name: 'Save customer', exact: true })
    .click();
  await toast('Customer saved.');
  assert.equal((await ipc('load')).customers.length, 2);
  checks.push(
    'Duplicate customer code rejected inline without saving; own identifier remains editable',
  );
  checks.push('Independent ABC and XYZ customers created');
  await route('Services');
  assert.equal(
    await page.getByLabel('Service code', { exact: true }).count(),
    0,
  );
  await page.getByLabel('Service name', { exact: true }).fill('Consulting');
  await page
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('invalid');
  await page
    .getByLabel('Invoice description', { exact: true })
    .fill('Technical consulting');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await page.locator('#service-price[aria-invalid="true"]').waitFor();
  assert.equal((await ipc('search_services', { query: {} })).total, 0);
  await page
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('100.00');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await toast('Service saved.');
  await page
    .getByLabel('Invoice description', { exact: true })
    .fill('Synthetic consulting');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await toast('Service saved.');
  await verifyAdminControls();
  await page
    .getByRole('button', { name: 'Edit Consulting', exact: true })
    .waitFor();
  for (let n = 0; n < 51; n++)
    await ipc('save_service', {
      service: {
        id: `catalogue-${n}`,
        name: `Catalogue ${n}`,
        description: 'Pagination fixture',
        unitPrice: '1.00',
        tax: 'taxable',
      },
    });
  await page.getByLabel('Search services', { exact: true }).fill('Catalogue');
  const serviceList = page.getByRole('region', {
    name: 'Saved services',
    exact: true,
  });
  await serviceList
    .getByRole('status')
    .filter({ hasText: '1–25 of 51' })
    .waitFor();
  assert.equal(await serviceList.locator('tbody tr').count(), 25);
  await serviceList
    .getByRole('button', { name: 'Next page', exact: true })
    .click();
  await serviceList
    .getByRole('status')
    .filter({ hasText: '26–50 of 51' })
    .waitFor();
  assert.equal(await serviceList.locator('tbody tr').count(), 25);
  await page
    .getByLabel('Search services', { exact: true })
    .fill('Catalogue 50');
  await serviceList
    .getByRole('status')
    .filter({ hasText: '1–1 of 1' })
    .waitFor();
  assert.equal(await serviceList.locator('tbody tr').count(), 1);
  for (let n = 0; n < 51; n++)
    await ipc('delete_service', { id: `catalogue-${n}` });
  await page.getByLabel('Search services', { exact: true }).fill('');
  await serviceList
    .getByRole('status')
    .filter({ hasText: '1–1 of 1' })
    .waitFor();
  await serviceList
    .getByRole('button', { name: 'Edit Consulting', exact: true })
    .waitFor();
  checks.push(
    'Native catalogue pagination returns 25 rows, advances correctly and resets to page one on a new search',
  );
  await page.screenshot({
    path: join(scratch, 'services.png'),
    fullPage: true,
  });
  await route('Invoices');
  await page.getByRole('link', { name: 'New draft', exact: true }).click();
  const customerCombo = page.getByRole('combobox', {
    name: 'Customer',
    exact: true,
  });
  await customerCombo.fill('ABC');
  await page
    .getByRole('option', { name: 'Example ABC ABC', exact: true })
    .waitFor();
  await customerCombo.press('ArrowDown');
  await customerCombo.press('Enter');
  assert.equal(await customerCombo.inputValue(), 'Example ABC (ABC)');
  assert.equal(await customerCombo.getAttribute('aria-expanded'), 'false');
  await customerCombo.fill('No matching customer');
  await page
    .getByRole('status')
    .filter({ hasText: 'No customers found' })
    .waitFor();
  await customerCombo.press('Enter');
  await customerCombo.press('Escape');
  assert.equal(
    await customerCombo.inputValue(),
    'Example ABC (ABC)',
    'Unmatched text must not replace the selected customer',
  );
  const systemFonts = await page.evaluate(() => ({
    family: getComputedStyle(document.body).fontFamily,
    faces: document.fonts.size,
  }));
  assert.match(systemFonts.family, /^system-ui/);
  assert.equal(systemFonts.faces, 0, 'App must not load bundled UI fonts');
  const fontSession = await page.context().newCDPSession(page);
  await fontSession.send('DOM.enable');
  await fontSession.send('CSS.enable');
  const { root: fontRoot } = await fontSession.send('DOM.getDocument');
  const { nodeId: headingNode } = await fontSession.send('DOM.querySelector', {
    nodeId: fontRoot.nodeId,
    selector: 'h1',
  });
  const { fonts: platformFonts } = await fontSession.send(
    'CSS.getPlatformFontsForNode',
    { nodeId: headingNode },
  );
  assert(
    platformFonts.length && platformFonts.every((font) => !font.isCustomFont),
    'Heading must render with installed system fonts',
  );
  checks.push(
    `Native system font: ${platformFonts.map((font) => font.familyName).join(', ')}`,
  );
  await fontSession.detach();

  checks.push(
    'Customer combobox selects with keyboard, rejects unmatched text and restores selection on Escape; app uses system fonts without webfont faces',
  );
  const serviceOne = page.getByRole('combobox', {
    name: 'Service 1',
    exact: true,
  });
  await serviceOne.fill('consult');
  await page.getByRole('option').filter({ hasText: 'Consulting' }).waitFor();
  await serviceOne.press('ArrowDown');
  await serviceOne.press('Enter');
  assert.equal(await serviceOne.inputValue(), 'Consulting');
  assert.equal(
    await page
      .getByRole('textbox', { name: 'Description 1', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByLabel('Unit price 1 (AUD)', { exact: true }).textContent(),
    '$100.00',
  );
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  const serviceTwo = page.getByRole('combobox', {
    name: 'Service 2',
    exact: true,
  });
  await serviceTwo.fill('Unlisted');
  await page
    .getByRole('status')
    .filter({ hasText: 'No services found' })
    .waitFor();
  await serviceTwo.press('Enter');
  assert.equal(await page.getByTestId('draft-total').textContent(), '—');
  await page
    .getByRole('button', { name: 'Create service…', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Create service', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  assert.equal(await serviceOne.inputValue(), 'Consulting');
  await serviceTwo.fill('GST-free supply');
  await page
    .getByRole('status')
    .filter({ hasText: 'No services found' })
    .waitFor();
  await page
    .getByRole('button', { name: 'Create service…', exact: true })
    .click();
  const createDialog = page.getByRole('dialog', {
    name: 'Create service',
    exact: true,
  });
  await createDialog
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('20.00');
  await chooseOption(
    createDialog.getByLabel('GST classification', { exact: true }),
    'GST-free',
  );
  await createDialog
    .getByRole('button', { name: 'Create and select', exact: true })
    .click();
  await createDialog.waitFor({ state: 'hidden' });
  assert.equal(await serviceTwo.inputValue(), 'GST-free supply');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'quantity-1',
  );
  assert.equal(
    await page.getByLabel('Due date', { exact: true }).inputValue(),
    'Relative to invoice date',
  );
  assert.equal(
    await page.getByLabel('Due after', { exact: true }).inputValue(),
    '1',
  );
  assert.equal(
    await page.getByLabel('Due date unit', { exact: true }).inputValue(),
    'Calendar months',
  );
  await page.getByLabel('Invoice date', { exact: true }).fill('2028-01-31');
  await page.getByText('Payment due 29/02/2028', { exact: true }).waitFor();
  await chooseOption(page.getByLabel('Due date unit', { exact: true }), 'Days');
  await page.getByLabel('Due after', { exact: true }).fill('30');
  await page.getByText('Payment due 01/03/2028', { exact: true }).waitFor();
  await chooseOption(
    page.getByLabel('Due date', { exact: true }),
    'Exact date',
  );
  await page.getByLabel('Exact due date', { exact: true }).fill('2028-03-15');
  await page.getByText('Payment due 15/03/2028', { exact: true }).waitFor();
  await chooseOption(
    page.getByLabel('Due date', { exact: true }),
    'No due date',
  );
  await page.waitForFunction(
    () => !document.body.textContent.includes('Payment due '),
  );
  await page.getByLabel('Invoice date', { exact: true }).fill('2026-11-16');
  await chooseOption(
    page.getByLabel('Due date', { exact: true }),
    'Relative to invoice date',
  );
  await page.getByLabel('Reference/P.O.', { exact: true }).fill('PO-2026-42');
  await page.getByText('Payment due 16/12/2026', { exact: true }).waitFor();
  checks.push(
    'Due date defaults to one calendar month; exact, days, leap month-end and none update the live invoice',
  );
  checks.push(
    'Service combobox supports keyboard selection; unknown text cannot create a line; inline creation/cancel preserves draft and selects the saved service',
  );
  await page
    .getByTestId('draft-total')
    .filter({ hasText: '$130.00' })
    .waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  assert.equal(
    (await ipc('load')).drafts.length,
    0,
    'Live preview must not save the draft',
  );
  await page.getByLabel('Quantity 1', { exact: true }).fill('3');
  await page
    .getByTestId('draft-total')
    .filter({ hasText: '$350.00' })
    .waitFor();
  await page.getByLabel('Quantity 1', { exact: true }).fill('1');
  await page
    .getByTestId('draft-total')
    .filter({ hasText: '$130.00' })
    .waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await page.getByLabel('Quantity 1', { exact: true }).fill('invalid');
  await page
    .getByRole('button', { name: 'Issue invoice', exact: true })
    .click();
  await page
    .getByText('Use a decimal with at most 3 decimal places.', { exact: false })
    .first()
    .waitFor();
  assert.equal(
    await page.locator('canvas[data-rendered="true"]').count(),
    1,
    'Invalid input retains the last valid PDF with a stale notice',
  );
  await page.getByLabel('Quantity 1', { exact: true }).fill('1');
  await page
    .getByTestId('draft-total')
    .filter({ hasText: '$130.00' })
    .waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await customerCombo.fill('XYZ');
  await page
    .getByRole('option', { name: 'Example XYZ XYZ', exact: true })
    .click();
  assert.equal(await customerCombo.inputValue(), 'Example XYZ (XYZ)');
  assert.equal(await serviceOne.inputValue(), 'Consulting');
  await customerCombo.fill('ABC');
  await page
    .getByRole('option', { name: 'Example ABC ABC', exact: true })
    .click();
  await page
    .getByTestId('draft-total')
    .filter({ hasText: '$130.00' })
    .waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await verifyAdminControls();
  const saveBox = await page
    .getByRole('button', { name: 'Save draft', exact: true })
    .boundingBox();
  assert(
    saveBox &&
      saveBox.y + saveBox.height <
        (await page.evaluate(() => innerHeight)) - 32,
    'Two-item editor actions should fit above the shortcut footer',
  );
  await page.screenshot({ path: join(scratch, 'editor.png'), fullPage: true });
  await page
    .getByRole('button', { name: 'Expand PDF preview', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Expanded PDF preview', exact: true })
    .waitFor();
  await page.keyboard.press('Escape');
  for (const width of [760, 1000, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Horizontal overflow at ${width}px`,
    );
    const serviceBox = await serviceOne.boundingBox();
    const quantityBox = await page
      .getByLabel('Quantity 1', { exact: true })
      .boundingBox();
    const priceBox = await page
      .getByLabel('Unit price 1 (AUD)', { exact: true })
      .boundingBox();
    assert(serviceBox && quantityBox && priceBox);
    assert(
      Math.abs(serviceBox.y - quantityBox.y) <= 1 &&
        Math.abs(serviceBox.y - priceBox.y) <= 1,
      `Line controls must align at ${width}px`,
    );
    if (width >= 1000) {
      const previewBox = await page.locator('.invoice-preview').boundingBox();
      assert(
        previewBox && previewBox.x > priceBox.x,
        'Preview stays beside the editor',
      );
    }
    await page.screenshot({
      path: join(scratch, `editor-${width}.png`),
      fullPage: true,
    });
  }
  checks.push(
    'Expanded PDF closes with Escape; compact editor fits 760px, 1000px and 1280px widths',
  );
  await route('Customers');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep editing', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Unit price 1 (AUD)', { exact: true }).textContent(),
    '$100.00',
  );
  checks.push(
    'Actual PDF updates from unsaved input; invalid input retains and labels the last valid output; leaving unsaved edits is guarded',
  );
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await toast('Draft saved.');
  const before = await ipc('load');
  const draftId = before.drafts[0].id;
  const forged = structuredClone(before.drafts[0]);
  forged.lines[0].unitPrice = '0.01';
  await assert.rejects(() => ipc('save_draft', { draft: forged }), /changed/);
  await assert.rejects(
    () => ipc('preview_draft', { draft: forged }),
    /changed/,
  );
  delete forged.lines[0].service;
  forged.id = 'partial-service';
  await ipc('save_draft', { draft: forged });
  await assert.rejects(
    () => ipc('preview_draft', { draft: forged }),
    /Choose a service/,
  );
  await ipc('delete_draft', { id: 'partial-service' });
  assert.deepEqual((await ipc('load')).drafts, before.drafts);

  await stop();
  await start(join(directory, 'source'), [
    savedPdf,
    laterPdf,
    exportFile,
    exportFile,
    invalidFile,
    null,
  ]);
  await route('Invoices');
  await page
    .getByRole('link', { name: 'Edit draft for Example ABC', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Unit price 1 (AUD)', { exact: true }).textContent(),
    '$100.00',
  );
  await page
    .getByTestId('draft-total')
    .filter({ hasText: '$130.00' })
    .waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  assert.equal((await ipc('preview', { id: draftId })).totals.total, 13000);
  checks.push('Draft survives native restart; mixed preview totals AUD130.00');
  await page
    .getByRole('button', { name: 'Issue invoice', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Confirm issue', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Preview IABC1', exact: true })
    .waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  const issued = (await ipc('load')).issued[0];
  assert.equal(issued.snapshot.dueDate, '2026-12-16');
  assert.equal(issued.snapshot.draft.reference, 'PO-2026-42');
  assert.equal(issued.snapshot.customer.attention, 'Accounts payable');
  assert.deepEqual(issued.snapshot.profile.paymentMethods, [
    {
      type: 'payId',
      payIdType: 'email',
      value: 'billing@example.test',
      recipientName: '',
    },
  ]);
  checks.push(
    'Reference, resolved due date, attention and named payment details survive save, restart and issue',
  );
  await page
    .getByRole('button', { name: 'Invoice details', exact: true })
    .click();
  await page
    .locator('.snapshot-data')
    .getByText('Synthetic consulting', { exact: true })
    .waitFor();
  for (const value of [
    'PO-2026-42',
    '2026-12-16',
    'Accounts payable',
    'PayID',
    'billing@example.test',
  ]) {
    assert(
      (await page.locator('.snapshot-data').textContent()).includes(value),
      `Saved details must show ${value}`,
    );
  }
  assert.equal(
    await page
      .locator(
        '.snapshot-data input,.snapshot-data textarea,.snapshot-data select',
      )
      .count(),
    0,
  );
  await page.getByRole('button', { name: 'PDF', exact: true }).click();

  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await page
    .getByRole('button', { name: 'Save PDF IABC1', exact: true })
    .click();
  await toast('PDF saved to');
  const originalPdf = await readFile(savedPdf);
  assert(originalPdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.deepEqual(
    Buffer.from(await ipc('read_pdf', { id: issued.id }), 'base64'),
    originalPdf,
  );
  await page
    .getByRole('button', { name: 'Mark IABC1 paid', exact: true })
    .click();
  await toast('IABC1 marked paid.');
  assert.equal((await ipc('load')).issued[0].paid, true);
  await ipc('issue', { id: draftId });
  assert.equal((await ipc('load')).issued.length, 1);
  checks.push(
    'Keyboard issuance IABC1; duplicate retry stays one invoice; paid status saved',
  );
  await route('Customers');
  await page.getByRole('button', { name: 'Edit ABC', exact: true }).click();
  assert(await page.getByLabel('Customer code', { exact: true }).isDisabled());
  await page.getByLabel('Search customers', { exact: true }).fill('XYZ');
  await page
    .getByRole('button', { name: 'Edit ABC', exact: true })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Edit XYZ', exact: true }).waitFor();
  await page.getByLabel('Search customers', { exact: true }).fill('');
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Customer screen must fit the window',
  );
  await verifyAdminControls();
  await page.screenshot({
    path: join(scratch, 'customers.png'),
    fullPage: true,
  });
  await route('Services');
  await page
    .getByRole('button', { name: 'Edit Consulting', exact: true })
    .click();
  await page
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('500.00');
  await page.getByRole('button', { name: 'Save service', exact: true }).click();
  await toast('Service saved.');
  await page
    .getByRole('button', { name: 'Remove service', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm removal', exact: true })
    .click();
  await toast('Service removed.');
  assert.equal((await ipc('search_services', { query: {} })).total, 1);
  assert.deepEqual(
    (await ipc('get_issued', { id: issued.id })).snapshot,
    issued.snapshot,
  );
  checks.push(
    'Service CRUD and validation; searchable picker copies values; issued snapshot remains fixed after catalogue changes/removal',
  );
  await route('Business profile');
  await page.getByLabel('Business name', { exact: true }).fill('Changed later');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await toast('Business profile saved.');
  assert.deepEqual((await ipc('load')).issued[0].snapshot, issued.snapshot);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Profile screen must fit the window',
  );
  await verifyAdminControls();
  await page.screenshot({
    path: join(scratch, 'profile.png'),
    fullPage: true,
  });
  checks.push(
    'Issued customer code locked; later profile edits preserve snapshot',
  );
  await route('Invoices');
  await page
    .getByRole('button', { name: 'Preview IABC1', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save PDF IABC1', exact: true })
    .click();
  await toast(laterPdf);
  assert.deepEqual(await readFile(laterPdf), originalPdf);
  checks.push(
    'Saved original PDF reopens byte-identically after paid/profile changes',
  );
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await page
    .getByLabel('Search invoices', { exact: true })
    .fill('missing-customer');
  await page
    .getByRole('heading', { name: 'No matching invoices', exact: true })
    .waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  await page.getByLabel('Search invoices', { exact: true }).fill('IABC1');
  await page
    .getByRole('button', { name: 'Preview IABC1', exact: true })
    .click();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await chooseOption(
    page.getByLabel('Invoice status', { exact: true }),
    'Unpaid',
  );
  await page
    .getByRole('heading', { name: 'No matching invoices', exact: true })
    .waitFor();
  await chooseOption(
    page.getByLabel('Invoice status', { exact: true }),
    'All statuses',
  );
  await page.getByLabel('Search invoices', { exact: true }).fill('');
  await page
    .getByRole('button', { name: 'Preview IABC1', exact: true })
    .click();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  checks.push(
    'Customer search, invoice search and paid filters update the selection and original-PDF pane',
  );
  await verifyAdminControls();
  await page.screenshot({
    path: join(scratch, 'invoices.png'),
    fullPage: true,
  });
  await route('Data');
  await dismissNotifications();
  await verifyAdminControls();
  await page.screenshot({ path: join(scratch, 'data.png'), fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'Data screen must fit the window',
  );
  await page
    .getByRole('button', { name: 'Export all data', exact: true })
    .focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator(':focus').getAttribute('href'),
    '/settings/preferences',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator(':focus').textContent(),
    'Choose export to restore',
  );
  const outline = await page
    .locator(':focus')
    .evaluate((element) => getComputedStyle(element).outlineWidth);
  assert.notEqual(outline, '0px');
  checks.push('Keyboard navigation and visible focus verified');
  await page
    .getByRole('button', { name: 'Export all data', exact: true })
    .click();
  await toast('All data exported to');
  const backup = await ipc('backup_status');
  assert.equal(backup.path, exportFile);
  assert.equal(backup.available, true);
  assert(Date.now() - backup.exportedAt < 10000);
  await page
    .getByText('The export file is available.', { exact: false })
    .waitFor();
  const exportedFiles = readZip(exportFile);
  const exported = JSON.parse(exportedFiles['data.json'].toString('utf8'));
  assert.equal(exported.version, 3);
  assert.deepEqual(exportedFiles[exported.issued[0].pdf], originalPdf);
  assert.equal(exported.issued[0].paid, true);
  const sourceState = await ipc('load');
  await page
    .getByRole('button', { name: 'Choose export to restore', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Cancel import', exact: true })
    .click();
  await toast('Import cancelled.');
  assert.deepEqual(await ipc('load'), sourceState);
  await page
    .getByRole('button', { name: 'Choose export to restore', exact: true })
    .click();
  await toast('Invalid ZIP export', 'alert');
  assert.deepEqual(await ipc('load'), sourceState);
  await page
    .getByRole('button', { name: 'Choose export to restore', exact: true })
    .click();
  await toast('Import cancelled.');
  checks.push(
    'Native export includes PDF and paid status; cancelled and malformed imports preserve data',
  );
  await stop();
  await start(join(directory, 'target'), [exportFile, restoredPdf]);
  await route('Data');
  await dismissNotifications();
  await page
    .getByRole('button', { name: 'Choose export to restore', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Replace all data', exact: true })
    .click();
  await toast('All data restored.');
  assert.deepEqual(await ipc('load'), sourceState);
  const recoveryDirectory = join(directory, 'target/recovery');
  const recoveryFiles = await readdir(recoveryDirectory);
  assert.equal(recoveryFiles.length, 1);
  assert(recoveryFiles[0].endsWith('.zip'));
  const recovery = JSON.parse(
    readZip(join(recoveryDirectory, recoveryFiles[0]))['data.json'].toString(
      'utf8',
    ),
  );
  assert.deepEqual(recovery, {
    version: 3,
    profile: null,
    customers: [],
    drafts: [],
    issued: [],
  });
  await route('Invoices');
  await page
    .getByRole('button', { name: 'Preview IABC1', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save PDF IABC1', exact: true })
    .click();
  await toast(restoredPdf);
  assert.deepEqual(await readFile(restoredPdf), originalPdf);
  for (const [code, number] of [
    ['ABC', 'IABC2'],
    ['XYZ', 'IXYZ1'],
  ]) {
    const customer = sourceState.customers.find((item) => item.code === code);
    await saveCatalogueDraft({
      ...fixture.draft,
      id: `restored-${code}`,
      customerId: customer.id,
    });
    await ipc('issue', { id: `restored-${code}` });
    assert(
      (await ipc('load')).issued.some(
        (item) => item.snapshot.number === number,
      ),
    );
  }
  checks.push(
    'Restore into empty native app retains PDF, writes recovery, then issues IABC2 and IXYZ1',
  );
  const customer = sourceState.customers.find((item) => item.code === 'ABC');
  await saveCatalogueDraft({
    ...fixture.draft,
    id: 'multipage',
    customerId: customer.id,
    lines: Array.from({ length: 8 }, (_, n) => ({
      description: `Line ${n + 1}: ${'Detailed synthetic service description with deliverables and supporting notes. '.repeat(12)}`,
      quantity: '1',
      unitPrice: '100.00',
      tax: 'taxable',
    })),
  });
  await ipc('issue', { id: 'multipage' });
  await route('Customers');
  await route('Invoices');
  await page
    .getByRole('button', { name: 'Preview IABC3', exact: true })
    .click();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await page
    .getByRole('button', { name: 'Next preview page', exact: true })
    .click();
  await page
    .locator('canvas[data-rendered="true"][aria-label*="page 2"]')
    .waitFor();
  await page
    .getByRole('button', { name: 'Previous preview page', exact: true })
    .click();
  await page
    .locator('canvas[data-rendered="true"][aria-label*="page 1"]')
    .waitFor();
  checks.push(
    'Multi-page original PDFs render and page forward/back inside the native app',
  );
  await verifyInvoicePreference({
    page,
    route,
    first: 'IABC2',
    second: 'IXYZ1',
    checks,
  });
  await stop();
  await start(join(directory, 'target'), []);
  await route('Invoices');
  await page
    .getByRole('button', { name: 'Preview IXYZ1', exact: true })
    .click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Invoice details', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('.snapshot-data').waitFor();
  checks.push('Invoice view preference survives a native application restart');
  assert.deepEqual(errors, []);
  console.log(checks.join('\n'));
} catch (error) {
  console.error(error);
  await page
    ?.screenshot({ path: join(scratch, 'failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await stop();
  const resolved = resolve(scratch);
  assert(resolved.startsWith(`${resolve(tmpdir())}${sep}invoice-check-`));
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
