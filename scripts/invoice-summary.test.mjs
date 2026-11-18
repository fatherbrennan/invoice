import assert from 'node:assert/strict';
import test from 'node:test';
import {
  periodErrors,
  periodHref,
  readPeriod,
  reportingToday,
  resolvePeriod,
} from '../src/lib/invoice-period.ts';
import { money } from '../src/lib/money.ts';

test('presets use inclusive calendar dates, complete Monday-Sunday weeks and July-June years', () => {
  for (const [today, preset, from, to] of [
    ['2026-11-16', 'last30', '2026-10-18', '2026-11-16'],
    ['2026-11-16', 'last7', '2026-11-10', '2026-11-16'],
    ['2026-11-16', 'lastWeek', '2026-11-09', '2026-11-15'],
    ['2026-11-22', 'lastWeek', '2026-11-09', '2026-11-15'],
    ['2026-11-16', 'lastMonth', '2026-10-01', '2026-10-31'],
    ['2026-11-16', 'thisMonth', '2026-11-01', '2026-11-16'],
    ['2026-11-16', 'lastYear', '2025-07-01', '2026-06-30'],
    ['2026-11-16', 'thisYear', '2026-07-01', '2026-11-16'],
    ['2026-06-30', 'lastYear', '2024-07-01', '2025-06-30'],
    ['2026-07-01', 'lastYear', '2025-07-01', '2026-06-30'],
    ['2026-07-01', 'thisYear', '2026-07-01', '2026-07-01'],
    ['2028-03-01', 'lastMonth', '2028-02-01', '2028-02-29'],
    ['2100-03-01', 'lastMonth', '2100-02-01', '2100-02-28'],
    ['2027-01-01', 'lastMonth', '2026-12-01', '2026-12-31'],
    ['2026-10-05', 'last7', '2026-09-29', '2026-10-05'],
    ['2026-04-06', 'last7', '2026-03-31', '2026-04-06'],
  ])
    assert.deepEqual(resolvePeriod(preset, today), { preset, from, to });
  assert.deepEqual(resolvePeriod('all', '2026-11-16'), {
    preset: 'all',
    from: '',
    to: '',
  });
});

test('reporting today follows Adelaide midnight across daylight saving and device timezones', () => {
  for (const [instant, expected] of [
    ['2026-11-15T13:29:59Z', '2026-11-15'],
    ['2026-11-15T13:30:00Z', '2026-11-16'],
    ['2026-04-05T14:29:59Z', '2026-04-05'],
    ['2026-04-05T14:30:00Z', '2026-04-06'],
    ['2026-10-04T13:29:59Z', '2026-10-04'],
    ['2026-10-04T13:30:00Z', '2026-10-05'],
  ])
    assert.equal(reportingToday(new Date(instant)), expected);
});

test('custom ranges reject missing, impossible, out-of-bounds and reversed dates', () => {
  for (const from of [
    '',
    '2026-02-29',
    '2100-02-29',
    '2026-2-01',
    '1899-12-31',
    '10000-01-01',
  ]) {
    assert.ok(
      periodErrors({ preset: 'custom', from, to: '2026-12-31' }).from,
      from,
    );
  }
  assert.ok(
    periodErrors({ preset: 'custom', from: '2026-11-16', to: '2026-11-15' }).to,
  );
  assert.ok(periodErrors({ preset: 'custom', from: '2026-11-16', to: '' }).to);
  assert.deepEqual(
    periodErrors({ preset: 'custom', from: '2028-02-29', to: '2028-02-29' }),
    {},
  );
  assert.deepEqual(periodErrors({ preset: 'all', from: '', to: '' }), {});
});

test('drill-through preserves custom dates and status; relative periods resolve against the current day', () => {
  const custom = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' };
  const url = new URL(
    periodHref('/invoices', custom, 'overdue'),
    'https://invoice.test',
  );
  assert.equal(url.searchParams.get('status'), 'overdue');
  assert.deepEqual(readPeriod(url.searchParams, '2027-01-01'), custom);
  const relative = new URL(
    periodHref('/invoices', resolvePeriod('last7', '2026-11-16')),
    'https://invoice.test',
  );
  assert.deepEqual(readPeriod(relative.searchParams, '2026-11-17'), {
    preset: 'last7',
    from: '2026-11-11',
    to: '2026-11-17',
  });
});

test('money formatting retains every cent even at the exact aggregate limit', () => {
  for (const [cents, expected] of [
    [0, '$0.00'],
    [1, '$0.01'],
    [11000, '$110.00'],
    [-1, '-$0.01'],
    [-101, '-$1.01'],
    [9007199254740991, '$90,071,992,547,409.91'],
  ]) {
    assert.equal(money(cents), expected);
  }
  for (const value of [NaN, Infinity, 0.5, 9007199254740992])
    assert.throws(() => money(value));
});
