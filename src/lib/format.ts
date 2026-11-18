export type FieldFormat =
  | 'abn'
  | 'bsb'
  | 'mobile'
  | 'digits'
  | 'money'
  | 'quantity';

// Keep invalid input intact so validation can explain it instead of changing its meaning.
export function rawValue(value: string, format?: FieldFormat): string {
  if (!format) return value;
  const trimmed = value.trim();
  if (['abn', 'digits'].includes(format))
    return /^[\d ]*$/.test(trimmed) ? trimmed.replaceAll(' ', '') : value;
  if (format === 'bsb')
    return /^(?:\d{3}[ -]?\d{3}|\d*)$/.test(trimmed)
      ? trimmed.replace(/[ -]/g, '')
      : value;
  if (format === 'mobile')
    return /^\+?[\d ]*$/.test(trimmed) ? trimmed.replaceAll(' ', '') : value;
  const decimal = format === 'money' ? trimmed.replace(/^\$\s*/, '') : trimmed;
  if (
    !/^(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d*)?$/.test(decimal) ||
    !/\d/.test(decimal)
  )
    return value;
  const [whole = '', fraction = ''] = decimal.replaceAll(',', '').split('.');
  if (fraction.length > (format === 'money' ? 2 : 3)) return value;
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  const significant = fraction.replace(/0+$/, '');
  return format === 'money'
    ? `${integer}.${fraction.padEnd(2, '0')}`
    : `${integer}${significant ? `.${significant}` : ''}`;
}

export function displayValue(value: string, format?: FieldFormat): string {
  if (!format) return value;
  const raw = rawValue(value, format);
  if (format === 'abn')
    return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
  if (format === 'bsb') return raw.replace(/^(\d{3})(\d{3})$/, '$1-$2');
  if (format === 'mobile')
    return raw
      .replace(/^(04\d{2})(\d{3})(\d{3})$/, '$1 $2 $3')
      .replace(/^(\+61)(4\d{2})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
  return raw;
}
