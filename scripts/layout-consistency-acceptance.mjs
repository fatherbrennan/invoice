import assert from 'node:assert/strict';

// Shared geometry is a product requirement: changing sections must not move the page chrome.
export async function verifyLayoutConsistency({
  page,
  route,
  viewport,
  checks,
  shot,
}) {
  const close = (actual, expected, label) =>
    assert(
      Math.abs(actual - expected) < 0.5,
      `${label}: ${actual} != ${expected}`,
    );
  for (const [width, height] of [
    [1280, 850],
    [760, 600],
    [390, 600],
  ]) {
    await viewport({ width, height });
    let headingY, tabY, tabFont;
    for (const name of [
      'Invoices',
      'Summary',
      'Customers',
      'Services',
      'Business profile',
      'Preferences',
      'Data',
      'Draft',
    ]) {
      if (name === 'Summary') {
        await page
          .getByRole('navigation', { name: 'Invoice sections' })
          .getByRole('link', { name: 'Summary', exact: true })
          .click();
        await page
          .getByRole('region', { name: 'Payment status totals' })
          .waitFor();
      } else if (name === 'Draft') {
        await route('Invoices');
        await page
          .getByRole('link', { name: 'New draft', exact: true })
          .click();
        await page.locator('.invoice-editor').waitFor();
      } else await route(name);
      // Opening shortcuts may scroll the taller Preferences page; measure its initial layout.
      if (name === 'Preferences')
        await page
          .getByRole('region', { name: 'Settings content', exact: true })
          .evaluate((node) => {
            node.scrollTop = 0;
          });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const geometry = await page.evaluate(() => {
        const box = (node) => {
          const r = node.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            bottom: r.bottom,
          };
        };
        const main = document.querySelector('main'),
          heading = main.querySelector('.page-heading');
        const tabs = main.querySelector('nav[aria-label$="sections"]');
        const panel = main.querySelector('.panel');
        return {
          main: box(main),
          padding: parseFloat(getComputedStyle(main).paddingLeft),
          heading: box(heading),
          title: main.querySelector('h1').textContent,
          tabs: tabs ? box(tabs) : null,
          tabLinks: tabs
            ? [...tabs.querySelectorAll('a')].map((node) => ({
                height: box(node).height,
                padding: getComputedStyle(node).padding,
                font: getComputedStyle(node).font,
              }))
            : [],
          active: tabs?.querySelectorAll('[aria-current="page"]').length,
          panel: box(panel),
          firstField: main.querySelector('.field-control')
            ? box(main.querySelector('.field-control'))
            : null,
          fields: [
            ...main.querySelectorAll('.period-controls .field-control'),
          ].map(box),
          hiddenBars: [
            ...document.querySelectorAll('[role="scrollbar"]'),
          ].filter((bar) =>
            document
              .getElementById(bar.getAttribute('aria-controls'))
              ?.closest('details:not([open])'),
          ).length,
          overflow:
            document.documentElement.scrollWidth > innerWidth ||
            document.documentElement.scrollHeight > innerHeight,
        };
      });
      headingY ??= geometry.heading.y;
      close(geometry.heading.y, headingY, `${name} heading top at ${width}`);
      close(geometry.heading.height, 32, `${name} heading height at ${width}`);
      close(
        geometry.panel.x,
        geometry.main.x + geometry.padding + 2,
        `${name} content gutter at ${width}`,
      );
      assert(
        geometry.panel.y >= (geometry.tabs?.bottom ?? geometry.heading.bottom),
        `${name}: content follows heading`,
      );
      if (geometry.firstField)
        assert(
          geometry.firstField.x >= geometry.main.x + geometry.padding,
          `${name}: controls stay inside content`,
        );
      assert.equal(
        geometry.overflow,
        false,
        `${name}: window overflow at ${width}`,
      );
      assert.equal(
        geometry.hiddenBars,
        0,
        `${name}: collapsed content exposes scrollbars`,
      );
      if (geometry.tabs) {
        tabY ??= geometry.tabs.y;
        close(geometry.tabs.y, tabY, `${name} tabs top at ${width}`);
        close(geometry.tabs.height, 33, `${name} tabs height at ${width}`);
        assert.equal(geometry.active, 1);
        for (const tab of geometry.tabLinks) {
          tabFont ??= tab.font;
          close(tab.height, 32, `${name} tab link height`);
          assert.equal(tab.padding, '5px 12px');
          assert.equal(tab.font, tabFont, `${name}: tab typography`);
        }
      }
      if (name === 'Summary') {
        assert.equal(geometry.title, 'Invoices');
        if (width === 1280 || width === 760)
          await shot(`consistent-summary-${width}`);
        if (width === 760) {
          const scroll = page.getByRole('scrollbar', {
            name: 'Invoice summary: vertical scroll',
            exact: true,
          });
          await scroll.focus();
          await scroll.press('End');
          assert(
            await page
              .getByRole('region', { name: 'Invoice summary', exact: true })
              .evaluate((node) => node.scrollTop > 0),
          );
          await scroll.press('Home');
        }
      }
      if (name === 'Data') await shot(`consistent-data-${width}`);
    }
  }
  await viewport({ width: 1280, height: 850 });
  await route('Preferences');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await shot('consistent-settings-dark');
  await route('Invoices');
  await page
    .getByRole('navigation', { name: 'Invoice sections' })
    .getByRole('link', { name: 'Summary', exact: true })
    .click();
  await page.getByRole('region', { name: 'Payment status totals' }).waitFor();
  await shot('consistent-summary-dark');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await route('Invoices');
  checks.push(
    'All page headings, section tabs and content gutters align at 390/760/1280px; closed sections expose no scrollbars; light/dark layouts inspected',
  );
}
