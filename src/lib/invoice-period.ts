export const reportingTimeZone = 'Australia/Adelaide';
export const periodOptions = [
  { value: 'all', label: 'All time' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'thisYear', label: 'This financial year' },
  { value: 'lastYear', label: 'Last financial year' },
  { value: 'custom', label: 'Custom' },
];
export interface PeriodSelection {
  preset: string;
  from: string;
  to: string;
}

export function reportingToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: reportingTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function calendarDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function resolvePeriod(preset: string, today: string): PeriodSelection {
  const [year, month, day] = today.split('-').map(Number);
  const fiscalYear = year - (month < 7 ? 1 : 0);
  let from = '',
    to = today;
  switch (preset) {
    case 'last7':
      from = calendarDate(year, month - 1, day - 6);
      break;
    case 'last30':
      from = calendarDate(year, month - 1, day - 29);
      break;
    case 'lastWeek': {
      const weekday =
        (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
      from = calendarDate(year, month - 1, day - weekday - 7);
      to = calendarDate(year, month - 1, day - weekday - 1);
      break;
    }
    case 'lastMonth':
      from = calendarDate(year, month - 2, 1);
      to = calendarDate(year, month - 1, 0);
      break;
    case 'thisMonth':
      from = calendarDate(year, month - 1, 1);
      break;
    case 'thisYear':
      from = calendarDate(fiscalYear, 6, 1);
      break;
    case 'lastYear':
      from = calendarDate(fiscalYear - 1, 6, 1);
      to = calendarDate(fiscalYear, 5, 30);
      break;
    default:
      return { preset: 'all', from: '', to: '' };
  }
  return { preset, from, to };
}

export function periodErrors(
  selection: PeriodSelection,
): Record<string, string> {
  if (selection.preset === 'all' && !selection.from && !selection.to) return {};
  const errors: Record<string, string> = {};
  for (const key of ['from', 'to'] as const) {
    const value = selection[key];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '1900-01-01' ||
      value > '9999-12-31' ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    ) {
      errors[key] = 'Enter a real date between 1900 and 9999.';
    }
  }
  if (!errors.from && !errors.to && selection.from > selection.to)
    errors.to = 'To date must be on or after From date.';
  return errors;
}

export function readPeriod(
  params: Pick<URLSearchParams, 'get'>,
  today: string,
): PeriodSelection {
  const preset = params.get('period') ?? 'all';
  if (preset === 'custom')
    return {
      preset,
      from: params.get('from') ?? '',
      to: params.get('to') ?? '',
    };
  return resolvePeriod(preset, today);
}

export function periodHref(
  path: string,
  selection: PeriodSelection,
  status?: string,
): string {
  const params = new URLSearchParams({ period: selection.preset });
  if (selection.from) params.set('from', selection.from);
  if (selection.to) params.set('to', selection.to);
  if (status) params.set('status', status);
  return `${path}?${params}`;
}
