import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chooseOption } from './combobox-acceptance.mjs';
import { verifyCompactUi } from './compact-acceptance.mjs';
import { verifySaveStates } from './editor-acceptance.mjs';
import { verifyFileLocations } from './file-location-acceptance.mjs';
import { verifyFormatting } from './formatting-acceptance.mjs';
import { verifyLayoutConsistency } from './layout-consistency-acceptance.mjs';
import { verifyLedgerFilters } from './ledger-filters-acceptance.mjs';
import { verifyNestedTabs } from './nested-tabs-acceptance.mjs';
import { verifyPaymentMethods } from './payment-acceptance.mjs';
import { verifyPreferences, verifyZoom } from './preferences-acceptance.mjs';
import { verifyRowNavigation } from './row-navigation-acceptance.mjs';
import { verifySlashSearch } from './slash-search-acceptance.mjs';
import { verifyInvoiceSummary } from './summary-acceptance.mjs';
import { verifyToasts } from './toasts-acceptance.mjs';
import { verifyShortcutTooltips } from './tooltip-acceptance.mjs';
import { verifyWindowClose, verifyWindowFrame } from './window-acceptance.mjs';
import { verifyInvoiceWorkflow } from './workflow-acceptance.mjs';

// Real native fixtures, UI outcomes and scoped IPC failures.
// This suite adds focus/recovery/reflow checks; acceptance.mjs owns persistence coverage.
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'invoice-check-'));
const directory = join(scratch, 'workspace');
await mkdir(directory);
const exportFile = join(
  directory,
  process.argv.includes('--files')
    ? 'Invoice #1 & caf\u00e9.zip'
    : 'transfer.zip',
);
const savedPdf = join(directory, 'saved.pdf');
const preferencesFile = join(directory, 'preferences.json');
const invalidPreferences = join(directory, 'invalid-preferences.json');
await writeFile(
  invalidPreferences,
  JSON.stringify({
    format: 'invoice-preferences',
    version: 1,
    theme: 'invalid',
    invoiceView: 'pdf',
    shortcuts: { windows: {}, mac: {} },
  }),
);
const fixture = JSON.parse(
  await readFile(join(root, 'tests/fixtures/invoices.json'), 'utf8'),
);
const checks = [],
  errors = [];
let child, browser, page, capture;
let nativeScale = 1;

async function start() {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  child = spawn(join(root, 'src-tauri/target/debug/invoice.exe'), [], {
    env: {
      ...process.env,
      INVOICE_DATA_DIR: join(directory, 'source'),
      INVOICE_TEST_DIALOGS: JSON.stringify(
        process.argv.includes('--zoom')
          ? [preferencesFile, preferencesFile]
          : process.argv.includes('--files')
            ? [exportFile, preferencesFile, exportFile, savedPdf, null]
            : [
                exportFile,
                exportFile,
                exportFile,
                exportFile,
                preferencesFile,
                preferencesFile,
                preferencesFile,
                invalidPreferences,
                null,
                null,
              ],
      ),
      WEBVIEW2_USER_DATA_FOLDER: join(directory, 'webview'),
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
      `Native startup failed: ${startupError}`,
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
  capture = await context.newCDPSession(page);
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
  nativeScale = await page.evaluate(() => devicePixelRatio);
}
async function ipc(command, args = {}) {
  return page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
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
const button = (name) => page.getByRole('button', { name, exact: true });
async function focused(id) {
  await page.waitForFunction(
    (value) => document.activeElement?.id === value,
    id,
  );
}
async function modalReview(title) {
  const dialog = page.getByRole('dialog', { name: title });
  assert.equal(await dialog.count(), 1, `${title}: review must be a dialog`);
  assert(await dialog.evaluate((element) => element.matches(':modal')));
  await page
    .getByRole('navigation', { name: 'Main navigation', includeHidden: true })
    .getByRole('link', { name: 'Invoices', exact: true, includeHidden: true })
    .evaluate((element) => element.focus());
  assert(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
    'Background navigation cannot take focus',
  );
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    assert(
      await dialog.evaluate(
        (element) =>
          document.activeElement === document.body ||
          element.contains(document.activeElement),
      ),
      'Tab cannot reach background page controls',
    );
  }
}
async function busyConfirmation(command, confirmLabel, cancelLabel) {
  await page.evaluate((command) => {
    window.confirmationFetch = window.fetch;
    window.confirmationCalls = 0;
    window.fetch = (input, ...args) => {
      if (
        String(input) !==
        window.__TAURI_INTERNALS__.convertFileSrc(command, 'ipc')
      )
        return window.confirmationFetch(input, ...args);
      window.confirmationCalls++;
      return new Promise((resolve) => {
        window.releaseConfirmation = () =>
          resolve(
            new Response(JSON.stringify('Confirmation test failure'), {
              status: 400,
              headers: {
                'content-type': 'application/json',
                'Tauri-Response': 'error',
              },
            }),
          );
      });
    };
  }, command);
  try {
    await button(confirmLabel).click();
    await page.waitForFunction(() => !!window.releaseConfirmation);
    assert(await button(confirmLabel).isDisabled());
    assert(await button(cancelLabel).isDisabled());
    await button(confirmLabel).evaluate((element) => element.click());
    await page.keyboard.press('Escape');
    assert.equal(
      await page.getByRole('dialog').count(),
      1,
      'Committing confirmation cannot be dismissed',
    );
    assert.equal(
      await page.evaluate(() => window.confirmationCalls),
      1,
      'Commit cannot be submitted twice',
    );
    await page.evaluate(() => window.releaseConfirmation());
    const error = page
      .getByRole('alert')
      .filter({ hasText: 'Confirmation test failure' });
    await error.waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await error.getByRole('button', { name: 'Dismiss notification' }).click();
  } finally {
    await page.evaluate(() => {
      window.releaseConfirmation?.();
      window.fetch = window.confirmationFetch;
      delete window.confirmationFetch;
      delete window.confirmationCalls;
      delete window.releaseConfirmation;
    });
  }
}
async function viewport(size) {
  await page.setViewportSize(size);
  await capture.send('Emulation.setDeviceMetricsOverride', {
    ...size,
    deviceScaleFactor: nativeScale,
    mobile: false,
  });
}
async function shot(name) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    height: Math.max(innerHeight, document.documentElement.scrollHeight),
  }));
  // WebView2's fullPage helper crops a scrollbar width; explicit CDP clip preserves the CSS viewport.
  const result = await capture.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    // Viewport emulation changes devicePixelRatio, but native Windows capture DPI stays fixed.
    clip: {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      scale: 1 / nativeScale,
    },
  });
  const png = Buffer.from(result.data, 'base64');
  assert.equal(
    png.readUInt32BE(16),
    size.width,
    'Screenshot must include the complete viewport',
  );
  await writeFile(join(scratch, `${name}.png`), png);
}
async function fits(name) {
  assert(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    `${name}: document overflows`,
  );
  await verifyNavigationAlignment();
}
async function verifyResponsivePreview(name) {
  const widths = [];
  for (const [width, height] of [
    [1280, 850],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
    [1920, 600],
    [1100, 600],
    [1000, 700],
    [999, 700],
    [760, 600],
    [390, 844],
    [1280, 850],
  ]) {
    await viewport({ width, height });
    if (
      name === 'draft' &&
      (await page.locator('.editor-view-tabs').isVisible())
    )
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await fits(`${name} preview ${width}x${height}`);
    const size = await page
      .locator('canvas[data-rendered="true"]')
      .evaluate((canvas) => {
        const bounds = canvas.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          ratio: canvas.width / canvas.height,
        };
      });
    widths.push(size.width);
    assert(
      size.width > 0 && size.height > 0,
      `${name}: preview remains visible`,
    );
    assert(
      Math.abs(size.width / size.height - size.ratio) < 0.001,
      `${name}: page proportions survive resizing`,
    );
    if (width >= 1100) {
      const controls = await button('Expand PDF preview').boundingBox();
      assert(
        controls && controls.y >= 0 && controls.y + controls.height <= height,
        `${name}: controls fit ${width}x${height}`,
      );
    }
    if (width === 1920 && height === 1080) await shot(`${name}-large-preview`);
    if (
      name === 'draft' &&
      (await page.locator('.editor-view-tabs').isVisible())
    )
      await page
        .getByRole('button', { name: 'Edit invoice', exact: true })
        .click();
  }
  assert(widths[1] > widths[0], `${name}: preview grows at 1440px`);
  assert(
    widths[2] >= widths[0] + 100,
    `${name}: full HD preview is materially larger`,
  );
  assert(
    widths[3] >= widths[2] && widths[3] >= 650,
    `${name}: preview remains at a readable full-page width at 2560px`,
  );
  assert(
    Math.abs(widths.at(-1) - widths[0]) < 1,
    `${name}: shrinking restores the original layout`,
  );
  await button('Expand PDF preview').click();
  await page.getByRole('dialog', { name: 'Expanded PDF preview' }).waitFor();
  assert(
    (
      await page
        .getByRole('dialog', { name: 'Expanded PDF preview' })
        .boundingBox()
    ).width > 800,
    'Expanded preview must override the generic dialog width',
  );
  await button('Close preview').click();
  checks.push(
    `${name}: responsive PDF preview, proportions, controls and Expand verified from 390px to 2560px (desktop page widths ${widths.slice(0, 4).map(Math.round).join(', ')}px)`,
  );
}
async function verifyNavigationAlignment() {
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="Main navigation"] a')].map(
      (tab) => {
        const bounds = tab.getBoundingClientRect();
        const icon = tab.querySelector('svg').getBoundingClientRect();
        const label = [...tab.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
        );
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const center = bounds.y + bounds.height / 2;
        return {
          label: tab.textContent,
          iconOffset: icon.y + icon.height / 2 - center,
          textOffset: text.y + text.height / 2 - center,
        };
      },
    ),
  );
  for (const tab of tabs) {
    assert(
      Math.abs(tab.iconOffset) < 0.5,
      `${tab.label}: icon must be centered in tab (${tab.iconOffset}px)`,
    );
    assert(
      Math.abs(tab.textOffset) <= 1,
      `${tab.label}: text must be centered in tab (${tab.textOffset}px)`,
    );
  }
}
async function verifyFieldHeights() {
  const fields = await page
    .locator('.field-control:visible')
    .evaluateAll((controls) =>
      controls
        .filter((control) => !control.querySelector('textarea'))
        .map((control) => ({
          label: control
            .querySelector('input,select')
            ?.getAttribute('aria-label'),
          height: control.getBoundingClientRect().height,
          compact: !!control.closest('.invoice-line'),
        })),
    );
  for (const field of fields)
    assert.equal(
      field.height,
      field.compact ? 32 : 44,
      `${field.label}: line items must be 32px and other single-line fields 44px high`,
    );
}
async function verifyStableNavigation() {
  await route('Invoices');
  const measure = () =>
    page.locator('nav[aria-label="Main navigation"] a').evaluateAll((links) =>
      links.map((link) => {
        const rect = link.getBoundingClientRect();
        const style = getComputedStyle(link);
        return {
          label: link.textContent.trim(),
          x: rect.x,
          width: rect.width,
          height: rect.height,
          weight: style.fontWeight,
          color: style.color,
        };
      }),
    );
  const baseline = await measure();
  for (const label of [
    'Customers',
    'Services',
    'Business profile',
    'Settings',
    'Invoices',
  ]) {
    await route(label);
    await page
      .getByRole('heading', { level: 1, name: label, exact: true })
      .waitFor();
    await verifyFieldHeights();
    const current = await measure();
    for (const [index, tab] of current.entries()) {
      assert.equal(
        tab.weight,
        baseline[index].weight,
        `${tab.label}: active navigation must not change text weight`,
      );
      for (const metric of ['x', 'width', 'height'])
        assert(
          Math.abs(tab[metric] - baseline[index][metric]) < 0.1,
          `${tab.label}: active navigation changed ${metric}`,
        );
    }
    const active = current.find((tab) => tab.label === label);
    assert.notEqual(
      active.color,
      current.find((tab) => tab.label !== label).color,
      'Active navigation needs a distinct text colour',
    );
    const breadcrumb = page.getByRole('navigation', {
      name: 'Breadcrumb',
      exact: true,
    });
    assert.equal(
      await breadcrumb.locator('[aria-current="page"]').textContent(),
      label,
    );
    const heading = await breadcrumb
      .getByRole('heading', { level: 1 })
      .evaluate((el) => ({
        size: parseFloat(getComputedStyle(el).fontSize),
        color: getComputedStyle(el).color,
        weight: getComputedStyle(el).fontWeight,
      }));
    assert.equal(heading.weight, '600', 'Current breadcrumb must be bold');
    assert(
      heading.size <= 14,
      'Breadcrumb must replace the oversized page title',
    );
    assert.notEqual(
      heading.color,
      await breadcrumb
        .getByRole('link', { name: 'Invoice', exact: true })
        .evaluate((el) => getComputedStyle(el).color),
    );
  }
  checks.push(
    'All navigation destinations keep identical text weight and tab geometry; compact breadcrumbs identify the current page',
  );
}
async function verifyPalette() {
  const colors = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      [
        'ink',
        'surface',
        'line',
        'primary',
        'muted',
        'accent',
        'line-strong',
        'soft',
      ].map((name) => [name, css.getPropertyValue(`--${name}`).trim()]),
    );
  });
  for (const [name, value] of Object.entries({
    ink: '#20352a',
    surface: '#f5f7f4',
    line: '#d3ddd4',
    primary: '#b7dcc2',
  }))
    assert.equal(colors[name], value, `Requested ${name} colour`);
  const luminance = (hex) => {
    const channels = hex
      .slice(1)
      .match(/../g)
      .map((part) => {
        const channel = Number.parseInt(part, 16) / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const background of ['#ffffff', colors.surface, colors.soft]) {
    for (const foreground of [colors.ink, colors.muted, colors.accent])
      assert(
        contrast(foreground, background) >= 4.5,
        `${foreground} text on ${background}`,
      );
    assert(
      contrast(colors['line-strong'], background) >= 3,
      'Control boundaries remain visible',
    );
    assert(
      contrast(colors.accent, background) >= 3,
      'Keyboard focus remains visible',
    );
  }
  assert(contrast(colors.ink, colors.primary) >= 4.5, 'Primary button text');
  checks.push(
    'Requested palette with 4.5:1 text and 3:1 control/focus contrast on used surfaces',
  );
}
async function fail(command, task) {
  await page.evaluate((command) => {
    window.uiOriginalFetch = window.fetch;
    window.fetch = (input, ...args) =>
      String(input) ===
      window.__TAURI_INTERNALS__.convertFileSrc(command, 'ipc')
        ? Promise.resolve(
            new Response(JSON.stringify(`Injected ${command} failure`), {
              status: 400,
              headers: {
                'content-type': 'application/json',
                'Tauri-Response': 'error',
              },
            }),
          )
        : window.uiOriginalFetch(input, ...args);
  }, command);
  try {
    await task();
  } finally {
    await page.evaluate(() => {
      window.fetch = window.uiOriginalFetch;
      delete window.uiOriginalFetch;
    });
    const error = page
      .getByRole('alert')
      .filter({ hasText: `Injected ${command} failure` });
    if (await error.count())
      await error.getByRole('button', { name: 'Dismiss notification' }).click();
  }
}

async function verifyExistingUi() {
  await page
    .getByRole('heading', { name: 'Set up your first invoice', exact: true })
    .waitFor();
  await verifyWindowFrame({ page, button, ipc, checks });
  await verifyStableNavigation();
  await verifyPalette();
  await verifyNavigationAlignment();
  await ipc('save_profile', { profile: fixture.profile });
  await ipc('save_customer', { customer: fixture.customer });
  const draft = structuredClone(fixture.draft);
  for (const [index, line] of draft.lines.entries()) {
    const service = {
      id: `ui-${index}`,
      name: line.description,
      description: line.description,
      unitPrice: line.unitPrice,
      tax: line.tax,
    };
    await ipc('save_service', { service });
    line.service = { id: service.id, name: service.name };
  }
  await ipc('save_draft', { draft });
  await ipc('save_draft', { draft: { ...draft, id: 'issued-review' } });
  await ipc('issue', { id: 'issued-review' });
  await verifyLayoutConsistency({ page, route, viewport, checks, shot });
  await page.reload();
  await verifySaveStates({ page, route, button, checks });
  await verifyToasts({ page, route, button, fail, viewport, shot, checks });
  for (let index = 0; index < 24; index++) {
    await ipc('save_draft', {
      draft: { ...draft, id: `height-${index}`, date: '2026-11-14' },
    });
  }
  await page.reload();
  await route('Invoices');
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[aria-label="Invoices table"] tbody tr')
        .length === 25,
  );
  for (const selected of [false, true]) {
    if (selected) {
      await button('Preview IABC1').click();
      await page
        .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
        .waitFor();
      await button('Expand PDF preview').focus();
      await page.keyboard.press('Alt+PageDown');
      assert.match(
        await page.locator('main .pagination').textContent(),
        /1–25 of 26/,
      );
    }
    for (const [width, height] of [
      [1280, 850],
      [1280, 800],
      [1100, 600],
    ]) {
      await viewport({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      assert(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
        `Full invoice ledger ${width}x${height}, selected=${selected}: vertical overflow`,
      );
      if (selected) {
        const proportions = await page.locator('canvas').evaluate((canvas) => {
          const bounds = canvas.getBoundingClientRect();
          return {
            displayed: bounds.width / bounds.height,
            original: canvas.width / canvas.height,
          };
        });
        assert(
          Math.abs(proportions.displayed - proportions.original) < 0.001,
          'Preview keeps its page proportions',
        );
        const expand = await button('Expand PDF preview').boundingBox();
        assert(
          expand && expand.y >= 0 && expand.y + expand.height <= height,
          'Preview controls fit without scrolling',
        );
      }
    }
  }
  await button('Expand PDF preview').click();
  await page.getByRole('dialog', { name: 'Expanded PDF preview' }).waitFor();
  await button('Close preview').click();
  await verifyResponsivePreview('issued');
  await viewport({ width: 1280, height: 850 });
  checks.push(
    'Full invoice ledger and proportional PDF preview fit default and short desktop windows; Expand remains available',
  );
  for (let index = 0; index < 24; index++) {
    await ipc('delete_draft', { id: `height-${index}` });
  }
  await page.reload();
  await route('Invoices');
  await page
    .getByRole('link', { name: 'Edit draft for Example ABC', exact: true })
    .click();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await verifyResponsivePreview('draft');
  const draftBreadcrumb = page.getByRole('navigation', {
    name: 'Breadcrumb',
    exact: true,
  });
  await verifyFieldHeights();
  const dropdowns = await page
    .locator('.field-dropdown-action svg:visible')
    .evaluateAll((icons) =>
      icons.map((icon) => ({
        path: icon.querySelector('path').getAttribute('d'),
        width: icon.getBoundingClientRect().width,
        height: icon.getBoundingClientRect().height,
      })),
    );
  assert(
    dropdowns.length >= 4,
    'Customer, services and due-date select must all show dropdown icons',
  );
  for (const icon of dropdowns) {
    assert.equal(icon.width, 16);
    assert.equal(icon.height, 16);
    assert.equal(
      icon.path,
      dropdowns[0].path,
      'Select and combobox chevrons must match',
    );
  }
  await button('Show customer').click();
  await page.getByRole('listbox', { name: 'Known customers' }).waitFor();
  await button('Show customer').click();
  assert.equal(
    await page
      .getByLabel('Customer', { exact: true })
      .getAttribute('aria-expanded'),
    'false',
  );
  checks.push(
    'Standard fields are 44px and compact line fields are 32px; selects and working combobox buttons use identical 16px chevrons',
  );
  assert.equal(
    await draftBreadcrumb.locator('[aria-current="page"]').textContent(),
    'Draft',
  );
  assert.deepEqual(await draftBreadcrumb.getByRole('link').allTextContents(), [
    'Invoice',
    'Invoices',
  ]);
  assert.equal(
    await draftBreadcrumb
      .getByRole('link', { name: 'Invoice', exact: true })
      .getAttribute('href'),
    await page.locator('.brand').getAttribute('href'),
  );
  const draftSave = button('Save draft');
  assert(
    await draftSave.isDisabled(),
    'An unchanged draft cannot be saved again',
  );
  const notes = page.getByLabel('Notes', { exact: true });
  const originalNotes = await notes.inputValue();
  await notes.fill(`${originalNotes} updated`);
  assert(await draftSave.isEnabled());
  await notes.fill(originalNotes);
  assert(await draftSave.isDisabled(), 'Reverting draft edits disables Save');
  const dueMode = page.getByLabel('Due date', { exact: true });
  await chooseOption(dueMode, 'Relative to invoice date');
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  for (const note of [
    page.getByText(/^Payment due /),
    page.getByText(
      'After the invoice date; month-end dates use the last valid day.',
      { exact: true },
    ),
  ]) {
    const bounds = await note.boundingBox();
    const total = await page.getByTestId('draft-total').boundingBox();
    assert(
      bounds.y >= total.y + total.height,
      'Due-date notes must follow the total',
    );
  }
  await shot('draft-relative-terms');
  await chooseOption(dueMode, 'No due date');
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  assert.equal(await page.getByText(/^Payment due /).count(), 0);
  await draftBreadcrumb
    .getByRole('link', { name: 'Invoices', exact: true })
    .click();
  await page
    .getByRole('heading', { level: 1, name: 'Invoices', exact: true })
    .waitFor();
  await page
    .getByRole('link', { name: 'Edit draft for Example ABC', exact: true })
    .click();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  checks.push(
    'Draft breadcrumb retains a page heading and its Invoices parent navigates back to the ledger',
  );

  // Automatic focus must be asserted before any test-driven .focus() call.
  await button('Issue invoice').click();
  await focused('issue-confirmation');
  await modalReview(/^Issue \$/);
  assert.match(
    await page.locator('#issue-confirmation').locator('..').textContent(),
    /Example ABC/,
  );
  await shot('draft-confirmation');
  await button('Cancel issue').click();
  assert(
    await button('Issue invoice').evaluate(
      (element) => document.activeElement === element,
    ),
  );
  assert.equal(
    (await ipc('load')).issued.length,
    1,
    'Cancellation must not issue the draft',
  );
  await button('Issue invoice').click();
  await focused('issue-confirmation');
  await page.keyboard.press('Escape');
  await focused('issue-invoice');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(
    (await ipc('load')).issued.length,
    1,
    'Escape must not issue the draft',
  );
  checks.push(
    'Issue review automatically focuses its heading and cancellation restores Issue without persistence',
  );

  await button('Issue invoice').click();
  await busyConfirmation('issue', 'Confirm issue', 'Cancel issue');
  await focused('issue-invoice');
  assert.equal((await ipc('load')).issued.length, 1);
  const save = button('Save draft');
  assert(
    !(await save.evaluate((element) => element.classList.contains('primary'))),
  );
  assert(
    await button('Issue invoice').evaluate((element) =>
      element.classList.contains('primary'),
    ),
  );
  for (const [width, height] of [
    [380, 300],
    [760, 600],
    [1000, 850],
    [1280, 850],
  ]) {
    await viewport({ width, height });
    await fits(`Draft ${width}`);
    await verifyFieldHeights();
    await shot(`draft-${width}`);
    const remove = await button('Remove line 1').boundingBox();
    assert(Math.abs(remove.width - 32) < 0.01);
    assert(
      Math.abs(remove.height - remove.width) < 0.01,
      'Remove buttons must be square',
    );
    for (const control of [
      button('Issue invoice'),
      page.getByLabel('Quantity 1', { exact: true }),
      page.getByLabel('Invoice date', { exact: true }),
    ]) {
      const bounds = await control.boundingBox();
      const clientWidth = await page.evaluate(
        () => document.documentElement.clientWidth,
      );
      assert(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= clientWidth,
        `Draft ${width}: control extends beyond visible viewport: ${JSON.stringify(bounds)} / ${clientWidth}`,
      );
    }
    if (width <= 620) {
      await writeFile(
        join(scratch, 'narrow-layout.json'),
        JSON.stringify(
          {
            viewport: page.viewportSize(),
            ...(await page.evaluate(() => ({
              innerWidth,
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              body: document.body.getBoundingClientRect().toJSON(),
              main: document
                .querySelector('main')
                .getBoundingClientRect()
                .toJSON(),
              quantity: document
                .getElementById('quantity-0')
                .getBoundingClientRect()
                .toJSON(),
            }))),
          },
          null,
          2,
        ),
      );
      const quantity = await page
        .getByLabel('Quantity 1', { exact: true })
        .boundingBox();
      const price = await page
        .getByLabel('Unit price 1 (AUD)', { exact: true })
        .boundingBox();
      assert(
        quantity && price && quantity.x < price.x,
        'Narrow quantity precedes unit price',
      );
    }
    const accessible = await page
      .locator('.invoice-line')
      .first()
      .ariaSnapshot();
    assert.match(accessible, /GST(?: classification)? 1/);
    assert.match(accessible, /Total 1/);
    assert.match(accessible, /110\.00/);
    const picker = page.getByRole('combobox', {
      name: 'Service 1',
      exact: true,
    });
    await picker.click();
    await page
      .getByRole('listbox', { name: 'Known services' })
      .getByRole('option')
      .first()
      .waitFor();
    await fits(`Open service picker ${width}`);
    await shot(`picker-${width}`);
    await picker.press('Escape');
    await picker.click();
    await button('Create service…').click();
    const dialog = page.getByRole('dialog', {
      name: 'Create service',
      exact: true,
    });
    await dialog.waitFor();
    await fits(`Create service modal ${width}`);
    const serviceName = dialog.getByLabel('Service name', { exact: true });
    await serviceName.scrollIntoViewIfNeeded();
    const headingBox = await dialog
      .getByRole('heading', { name: 'Create service', exact: true })
      .boundingBox();
    assert(
      headingBox &&
        headingBox.y >= 0 &&
        headingBox.y + headingBox.height <= height,
      'Create service title remains reachable',
    );
    await shot(`service-modal-top-${width}`);
    await dialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .scrollIntoViewIfNeeded();
    await shot(`service-modal-${width}`);
    if (width === 760) {
      const before = (
        await ipc('search_services', { query: { query: '', page: 0 } })
      ).total;
      await dialog
        .getByRole('button', { name: 'Create and select', exact: true })
        .click();
      await dialog
        .getByText('Service name is required.', { exact: true })
        .waitFor();
      await focused('new-service-name');
      assert.equal(
        (await ipc('search_services', { query: { query: '', page: 0 } })).total,
        before,
      );
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  checks.push(
    'Draft hierarchy and labelled amounts survive 380x300/760/1000/1280 viewports; untouched invalid fields cannot swallow Cancel; submit still validates without saving',
  );

  await viewport({ width: 760, height: 600 });
  await route('Invoices');
  const invoice = button('Preview IABC1');
  await fail('read_pdf', async () => {
    await invoice.press('Enter');
    await focused('invoice-details-heading');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Injected read_pdf failure' })
      .waitFor();
    await button('Invoice details').click();
    await page
      .getByText('Synthetic payment reference only', { exact: true })
      .waitFor();
    await shot('invoice-pdf-error-details-available');
  });
  await button('PDF').click();
  await button('Retry preview').click();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await button('Close invoice details').click();
  assert(
    await invoice.evaluate((element) => document.activeElement === element),
  );
  await fail('get_issued', async () => {
    await invoice.click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Injected get_issued failure' })
      .waitFor();
    await page
      .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
      .waitFor();
    await shot('invoice-details-error-pdf-available');
  });
  await button('Retry details').click();
  await button('Open PDF IABC1').waitFor();
  for (const [width, height] of [
    [380, 300],
    [760, 600],
    [1000, 850],
    [1280, 850],
  ]) {
    await viewport({ width, height });
    await fits(`Selected invoice ${width}`);
    if (width < 1100) {
      const heading = await page
        .locator('#invoice-details-heading')
        .boundingBox();
      const search = await page
        .getByLabel('Search invoices', { exact: true })
        .boundingBox();
      assert(
        heading && search && heading.y < search.y,
        'Narrow selected details precede ledger',
      );
    }
    await shot(`invoice-selected-${width}`);
  }
  await viewport({ width: 760, height: 600 });
  await page.getByLabel('Search invoices', { exact: true }).fill('IABC');
  await page.waitForFunction(
    () => !document.getElementById('invoice-details-heading'),
  );
  assert(
    await page
      .getByLabel('Search invoices', { exact: true })
      .evaluate((element) => document.activeElement === element),
  );
  checks.push(
    'Independent PDF/metadata errors retain the successful half; retries recover; selection close restores origin and search retains focus',
  );

  for (const [name, command, code, field, retry] of [
    [
      'Customers',
      'search_customers',
      'ABC',
      'Customer address',
      'Retry loading customers',
    ],
    [
      'Services',
      'search_services',
      'Consulting',
      'Invoice description',
      'Retry loading services',
    ],
  ]) {
    await route(name);
    await button(`Edit ${code}`).press('Enter');
    await focused(name === 'Customers' ? 'customer-name' : 'service-name');
    const input = page.getByLabel(field, { exact: true });
    await input.fill('Unsaved review text remains after read retry.');
    await fail(command, async () => {
      await page
        .getByLabel(`Search ${name.toLowerCase()}`, { exact: true })
        .fill(code);
      await page
        .getByRole('alert')
        .filter({ hasText: `Injected ${command} failure` })
        .waitFor();
      assert.equal(
        await input.inputValue(),
        'Unsaved review text remains after read retry.',
      );
      assert(
        await page
          .getByLabel(`Search ${name.toLowerCase()}`, { exact: true })
          .evaluate((element) => document.activeElement === element),
      );
      await shot(`${name.toLowerCase()}-read-error-dirty`);
    });
    await button(retry).click();
    await button(`Edit ${code}`).waitFor();
    assert.equal(
      await input.inputValue(),
      'Unsaved review text remains after read retry.',
    );
    await button(
      `New ${name === 'Customers' ? 'customer' : 'service'}`,
    ).click();
    const guard = page.getByRole('dialog');
    await guard
      .getByRole('button', { name: 'Keep editing', exact: true })
      .click();
    assert.equal(
      await input.inputValue(),
      'Unsaved review text remains after read retry.',
    );
    await button(
      `New ${name === 'Customers' ? 'customer' : 'service'}`,
    ).click();
    await guard
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click();
    await focused(name === 'Customers' ? 'customer-name' : 'service-name');
  }
  checks.push(
    'Catalogue selection/New focus, read retry preserves dirty text, and guarded switching remains intact',
  );

  await button('Edit Consulting').press('Enter');
  await focused('service-name');
  await button('Remove service').click();
  const removal = page.getByRole('dialog', {
    name: 'Remove Consulting?',
    exact: true,
  });
  await fail('delete_service', async () => {
    await removal
      .getByRole('button', { name: 'Confirm removal', exact: true })
      .click();
    await removal
      .getByRole('alert')
      .filter({ hasText: 'Injected delete_service failure' })
      .waitFor();
    assert(
      !(await removal
        .getByRole('button', { name: 'Cancel', exact: true })
        .isDisabled()),
    );
    assert.equal(
      (
        await ipc('search_services', {
          query: { query: 'Consulting', page: 0 },
        })
      ).total,
      1,
    );
    await shot('service-removal-error');
  });
  await removal
    .getByRole('button', { name: 'Confirm removal', exact: true })
    .click();
  await focused('service-name');
  assert.equal(
    await page.getByLabel('Service name', { exact: true }).inputValue(),
    '',
  );
  checks.push(
    'Modal removal errors stay accessible without deleting; successful retry focuses the new editor',
  );

  await ipc('export_data');
  await route('Data');
  for (const dismiss of await page
    .getByRole('button', { name: 'Dismiss notification' })
    .all())
    await dismiss.click();
  const choose = button('Choose export to restore');
  await choose.click();
  await focused('replace-title');
  await modalReview('Replace all current data?');
  assert(await choose.isDisabled(), 'Pending restore must prevent reselection');
  assert(await button('Export all data').isDisabled());
  const actions = await page
    .locator('#replace-title')
    .locator('..')
    .locator('.actions')
    .getByRole('button')
    .allTextContents();
  assert.deepEqual(actions, ['Cancel import', 'Replace all data']);
  const beforeCancel = await ipc('load');
  await shot('restore-review');
  await viewport({ width: 380, height: 300 });
  await fits('Restore review 380');
  await button('Cancel import').scrollIntoViewIfNeeded();
  await shot('restore-review-380');
  await fail('cancel_import', async () => {
    await button('Cancel import').click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Injected cancel_import failure' })
      .waitFor();
    assert(
      await page
        .getByRole('dialog', { name: 'Replace all current data?' })
        .isVisible(),
      'Failed cancellation keeps the pending review accessible',
    );
  });
  await button('Cancel import').click();
  await page.waitForFunction(() => !document.getElementById('replace-title'));
  await focused('choose-restore');
  assert(!(await choose.isDisabled()));
  assert.deepEqual(await ipc('load'), beforeCancel);
  await assert.rejects(
    ipc('confirm_import'),
    /Choose and review an export first/,
  );
  await viewport({ width: 1280, height: 850 });
  await choose.click();
  await focused('replace-title');
  await page.keyboard.press('Escape');
  await focused('choose-restore');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await assert.rejects(
    ipc('confirm_import'),
    /Choose and review an export first/,
  );
  assert.deepEqual(await ipc('load'), beforeCancel);
  checks.push(
    'Restore review focuses heading, gates repeated selection, orders safe action first and cancels without mutation',
  );

  await choose.click();
  await focused('replace-title');
  await busyConfirmation('confirm_import', 'Replace all data', 'Cancel import');
  await focused('choose-restore');
  assert.deepEqual(await ipc('load'), beforeCancel);
  await ipc('cancel_import');

  await fail('workspace', async () => {
    await route('Business profile');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Injected workspace failure' })
      .waitFor();
    assert(
      await page.getByLabel('Business name', { exact: true }).isDisabled(),
    );
    assert(await button('Save profile').isDisabled());
    await shot('profile-load-error');
  });
  await button('Retry loading profile').click();
  await page.waitForFunction(
    () => !document.getElementById('business-name').matches(':disabled'),
  );
  assert.equal(
    await page.getByLabel('Business name', { exact: true }).inputValue(),
    fixture.profile.name,
  );
  checks.push(
    'Profile load failure keeps form disabled; retry restores persisted profile',
  );

  await ipc('save_customer', {
    customer: {
      ...fixture.customer,
      name: 'Long customer name '.repeat(8).trim(),
      address: 'LongAddressWithoutSpaces'.repeat(12),
    },
  });
  const longService = (
    await ipc('search_services', {
      query: { query: fixture.draft.lines[1].description, page: 0 },
    })
  ).items[0];
  assert(longService, 'The remaining fixture service must exist');
  const longServiceName = 'Long service name '.repeat(8).trim();
  await ipc('save_service', {
    service: {
      ...longService,
      name: longServiceName,
      description: 'LongDescriptionWithoutSpaces'.repeat(12),
    },
  });

  for (const name of [
    'Invoices',
    'Customers',
    'Services',
    'Business profile',
    'Data',
  ]) {
    await route(name);
    if (name === 'Customers') {
      await button('Edit ABC').press('Enter');
      await focused('customer-name');
    }
    if (name === 'Services') {
      await button(`Edit ${longServiceName}`).press('Enter');
      await focused('service-name');
    }
    if (name === 'Invoices') await button('Preview IABC1').waitFor();
    if (name === 'Business profile')
      await page.waitForFunction(
        () =>
          document.getElementById('business-name') &&
          !document.getElementById('business-name').matches(':disabled'),
      );
    for (const [width, height] of [
      [380, 300],
      [760, 600],
      [1000, 850],
      [1280, 850],
    ]) {
      await viewport({ width, height });
      await fits(`${name} ${width}`);
      await verifyFieldHeights();
      await shot(`${name.toLowerCase().replaceAll(/[^a-z]+/g, '-')}-${width}`);
      const splitHeaders = await page.evaluate(() =>
        [...document.querySelectorAll('th[scope="col"]')].flatMap((header) => {
          const split = [],
            walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const word of node.textContent.matchAll(/[A-Za-z]+/g)) {
              const range = document.createRange();
              range.setStart(node, word.index);
              range.setEnd(node, word.index + word[0].length);
              if (range.getClientRects().length > 1) split.push(word[0]);
            }
          }
          return split;
        }),
      );
      assert.deepEqual(
        splitHeaders,
        [],
        `${name} ${width}: table heading words must remain intact`,
      );
      if (
        width === 380 &&
        ['Invoices', 'Customers', 'Services'].includes(name)
      ) {
        const table = page.getByRole('region', {
          name: `${name} table`,
          exact: true,
        });
        await table.focus();
        await table.press('ArrowRight');
        await page.waitForFunction(
          (label) =>
            [...document.querySelectorAll('section')].some(
              (element) =>
                element.getAttribute('aria-label') === label &&
                element.scrollLeft > 0,
            ),
          `${name} table`,
        );
        await shot(`${name.toLowerCase()}-table-scrolled-380`);
      }
    }
  }
  checks.push(
    'All main routes fit reduced CSS viewports, including 380x300 zoom equivalent',
  );
  for (let index = 1; index <= 55; index++) {
    await ipc('save_service', {
      service: {
        id: `scale-${index}`,
        name: `Scale service ${String(index).padStart(2, '0')}`,
        description: 'Synthetic catalogue scale check',
        unitPrice: '1.00',
        tax: 'noGst',
      },
    });
  }
  await route('Services');
  await viewport({ width: 1280, height: 850 });
  const search = page.getByLabel('Search services', { exact: true });
  await search.fill('Scale');
  await page.getByRole('status').filter({ hasText: '1–25 of 55' }).waitFor();
  const table = page.getByRole('region', {
    name: 'Services table',
    exact: true,
  });
  assert.equal(await table.locator('tbody tr').count(), 25);
  await table.focus();
  await table.press('End');
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Services table"]').scrollTop > 0,
  );
  const regionBounds = await table.boundingBox();
  const headerBounds = await table
    .getByRole('columnheader')
    .first()
    .boundingBox();
  assert(
    Math.abs(regionBounds.y - headerBounds.y) < 3,
    'Table header stays visible while browsing rows',
  );
  await shot('services-growing-catalogue');
  await button('Next page').click();
  await page.getByRole('status').filter({ hasText: '26–50 of 55' }).waitFor();
  await search.fill('Scale service 55');
  await page.getByRole('status').filter({ hasText: '1–1 of 1' }).waitFor();
  assert.equal(await table.locator('tbody tr').count(), 1);
  await button('Edit Scale service 55').click();
  assert.equal(
    await page.getByLabel('Service name', { exact: true }).inputValue(),
    'Scale service 55',
  );
  checks.push(
    '55-record catalogue stays paged; keyboard scrolling retains headings; search resets page and opens the matching record',
  );
  await route('Invoices');
  await page
    .getByLabel('Search invoices', { exact: true })
    .fill('no-such-invoice-review');
  await page
    .getByRole('heading', { name: 'No matching invoices', exact: true })
    .waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByText(/Loading invoices/).count(), 0);
  await shot('invoices-no-results');
  checks.push('No-results state is distinct from loading and failure');
  await verifyCompactUi({ page, route, viewport, checks, shot });
  await verifySlashSearch({ page, route, checks });
  await verifyNestedTabs({ page, route, checks });
  await verifyShortcutTooltips({ page, route, ipc, fixture, checks });
  await verifyInvoiceSummary({
    page,
    route,
    ipc,
    fixture,
    checks,
    shot,
    viewport,
  });
  await verifyPaymentMethods({
    page,
    route,
    ipc,
    fixture,
    checks,
    shot,
    viewport,
  });
  await verifyInvoiceWorkflow({
    page,
    route,
    ipc,
    fixture,
    viewport,
    shot,
    checks,
  });
  await verifyFormatting({ page, route, ipc, fixture, checks, shot, viewport });
  await verifyPreferences({
    page,
    route,
    button,
    ipc,
    checks,
    shot,
    viewport,
    preferencesFile,
  });
  await verifyWindowClose({ page, button, checks, child });
}

try {
  await start();
  if (process.argv.includes('--zoom')) {
    await verifyZoom({
      page,
      route,
      button,
      checks,
      viewport,
      shot,
      preferencesFile,
      ipc,
      fixture,
    });
    await verifyLayoutConsistency({ page, route, viewport, checks, shot });
  } else if (process.argv.includes('--files')) {
    await verifyFileLocations({
      page,
      route,
      ipc,
      fixture,
      exportFile,
      preferencesFile,
      savedPdf,
      checks,
    });
  } else if (process.argv.includes('--rows')) {
    await verifyRowNavigation({
      page,
      route,
      ipc,
      fixture,
      checks,
      viewport,
      shot,
      fail,
    });
  } else if (process.argv.includes('--ledger')) {
    const context = { page, route, ipc, fixture, checks, viewport, shot };
    await verifyLedgerFilters(context);
    await verifyInvoiceSummary(context);
    await verifyInvoiceWorkflow(context);
  } else {
    await verifyExistingUi();
  }
  assert.deepEqual(errors, []);
  console.log(checks.join('\n'));
} catch (error) {
  await page
    ?.screenshot({ path: join(scratch, 'failure.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (child?.exitCode === null) {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill();
    await exited;
  }
  const resolved = resolve(scratch);
  assert(resolved.startsWith(`${resolve(tmpdir())}${sep}invoice-check-`));
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
