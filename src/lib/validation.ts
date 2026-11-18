import * as v from 'valibot';
import type { Customer } from './domain/types';

const text = (
  label: string,
  max: number,
  required = false,
  multiline = false,
) =>
  v.pipe(
    v.string(),
    v.check(
      (value) => !required || value.trim().length > 0,
      `${label} is required.`,
    ),
    v.check(
      (value) => [...value].length <= max,
      `${label} must be at most ${max} characters.`,
    ),
    v.check(
      (value) =>
        ![...value].some(
          (c) =>
            (c.charCodeAt(0) < 32 ||
              (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159)) &&
            !(multiline && '\n\r\t'.includes(c)),
        ),
      `${label} contains unsupported control characters.`,
    ),
  );
const identifier = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9-]{1,64}$/, 'Use 1–64 letters, digits or hyphens.'),
);
const abn = v.pipe(
  v.string(),
  v.check((value) => {
    if (!value) return true;
    if (!/^\d{11}$/.test(value)) return false;
    return (
      [...value].reduce(
        (sum, digit, index) =>
          sum +
          (Number(digit) - (index === 0 ? 1 : 0)) *
            ([10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19][index] ?? 0),
        0,
      ) %
        89 ===
      0
    );
  }, 'Enter a valid 11-digit ABN (checksum required).'),
);
const digits = (label: string, min: number, max: number) =>
  v.pipe(
    v.string(),
    v.regex(
      new RegExp(`^[0-9]{${min},${max}}$`),
      `${label} must contain ${min === max ? min : `${min}–${max}`} digits.`,
    ),
  );
const paymentMethodSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('bankTransfer'),
    accountName: text('Account name', 100, true),
    bsb: v.pipe(
      v.string(),
      v.regex(
        /^\d{3}-?\d{3}$/,
        'Enter a six-digit BSB, with or without a hyphen.',
      ),
    ),
    accountNumber: digits('Account number', 1, 10),
  }),
  v.strictObject({
    type: v.literal('payId'),
    recipientName: text('Recipient name', 100),
    payIdType: v.literal('email'),
    value: v.pipe(
      text('PayID email', 256, true),
      v.regex(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Enter a valid PayID email address.',
      ),
    ),
  }),
  v.strictObject({
    type: v.literal('payId'),
    recipientName: text('Recipient name', 100),
    payIdType: v.literal('mobile'),
    value: v.pipe(
      v.string(),
      v.regex(
        /^(04\d{8}|\+614\d{8})$/,
        'Use 04 followed by eight digits, or +614 followed by eight digits.',
      ),
    ),
  }),
  v.strictObject({
    type: v.literal('payId'),
    recipientName: text('Recipient name', 100),
    payIdType: v.literal('abn'),
    value: v.pipe(abn, v.nonEmpty('PayID ABN is required.')),
  }),
  v.strictObject({
    type: v.literal('payId'),
    recipientName: text('Recipient name', 100),
    payIdType: v.literal('organisationId'),
    value: text('PayID organisation ID', 256, true),
  }),
  v.strictObject({
    type: v.literal('bpay'),
    billerCode: digits('BPAY biller code', 1, 10),
  }),
  v.strictObject({
    type: v.literal('custom'),
    label: text('Payment method name', 100, true),
    value: text('Payment details', 1000, true, true),
  }),
]);
export const profileSchema = v.pipe(
  v.strictObject({
    name: text('Business name', 200, true),
    abn,
    address: text('Business address', 1000, true, true),
    paymentDetails: text('Payment details', 4000, false, true),
    paymentMethods: v.optional(
      v.pipe(
        v.array(paymentMethodSchema),
        v.maxLength(10, 'Use at most 10 payment methods.'),
        v.check(
          (methods) =>
            methods.filter((method) => method.type === 'bpay').length <= 1,
          'Use one BPAY biller per business profile.',
        ),
      ),
    ),
    gstRegistered: v.boolean(),
    showItemGst: v.boolean(),
  }),
  v.forward(
    v.check(
      (p) => !p.gstRegistered || !!p.abn,
      'A GST-registered business requires an ABN.',
    ),
    ['abn'],
  ),
);
export const customerSchema = (
  customers: Customer[],
  editingId: string | null,
) =>
  v.pipe(
    v.strictObject({
      id: identifier,
      code: v.pipe(
        v.string(),
        v.regex(/^[A-Z]{1,12}$/, 'Use 1–12 uppercase letters.'),
        v.check(
          (code) =>
            !customers.some((c) => c.id !== editingId && c.code === code),
          'This customer code is already in use.',
        ),
      ),
      name: text('Customer name', 200),
      attention: v.optional(text('Attention', 200)),
      abn,
      address: text('Customer address', 1000, false, true),
      nextNumber: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(1),
        v.maxValue(4294967295),
      ),
    }),
    v.forward(
      v.check(
        (c) => !!c.name.trim() || !!c.abn,
        'Enter a customer name or ABN.',
      ),
      ['name'],
    ),
    v.forward(
      v.check(
        (c) =>
          !customers.some(
            (other) => other.id === c.id && other.id !== editingId,
          ),
        'This customer identifier is already in use.',
      ),
      ['id'],
    ),
  );
const decimal = (
  label: string,
  places: number,
  max: number,
  positive = false,
) =>
  v.pipe(
    v.string(),
    v.regex(
      new RegExp(`^[0-9]+([.][0-9]{1,${places}})?$`),
      `Use a decimal with at most ${places} decimal places.`,
    ),
    v.check(
      (value) => Number(value) <= max && (!positive || Number(value) > 0),
      `${label} must be ${positive ? 'greater than 0 and ' : ''}at most ${max.toLocaleString('en-AU')}.`,
    ),
  );
export const serviceSchema = v.strictObject({
  id: identifier,
  name: text('Service name', 200, true),
  description: text('Description', 2000, true, true),
  unitPrice: decimal('Unit price', 2, 1000000),
  tax: v.picklist(['taxable', 'gstFree', 'inputTaxed', 'noGst']),
});
export const searchSchema = v.strictObject({
  query: v.pipe(
    text('Search', 200),
    v.check(
      (value) => value.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length <= 12,
      'Use at most 12 search words.',
    ),
  ),
});
export const draftSchema = (
  customers: Customer[],
  gstRegistered: boolean,
  bpayRequired = false,
) =>
  v.strictObject({
    id: identifier,
    customerId: v.pipe(
      v.pipe(v.string(), v.nonEmpty('Choose a customer.')),
      v.check(
        (id) => customers.some((c) => c.id === id),
        'Select an existing customer.',
      ),
    ),
    date: v.pipe(
      v.string(),
      v.check(
        (value) =>
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          value >= '1900-01-01' &&
          value <= '9999-12-31' &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value,
        'Enter a real date between 1900 and 9999.',
      ),
    ),
    reference: v.optional(text('Reference/P.O.', 200)),
    bpayReference: v.optional(
      v.pipe(
        v.string(),
        v.check(
          (value) => (bpayRequired ? /^\d{2,20}$/.test(value) : !value),
          'Enter the bank-issued BPAY reference (2–20 digits).',
        ),
      ),
      '',
    ),
    due: v.optional(
      v.variant('mode', [
        v.strictObject({ mode: v.literal('none') }),
        v.strictObject({
          mode: v.literal('exact'),
          date: v.pipe(
            v.string(),
            v.check(
              (value) =>
                /^\d{4}-\d{2}-\d{2}$/.test(value) &&
                value >= '1900-01-01' &&
                value <= '9999-12-31' &&
                !Number.isNaN(Date.parse(value)) &&
                new Date(value).toISOString().slice(0, 10) === value,
              'Enter a real due date between 1900 and 9999.',
            ),
          ),
        }),
        v.strictObject({
          mode: v.literal('relative'),
          amount: v.pipe(
            v.number(),
            v.integer('Enter a whole number.'),
            v.minValue(0),
            v.maxValue(9999),
          ),
          unit: v.picklist(['days', 'months']),
        }),
      ]),
    ),
    notes: text('Notes', 4000, false, true),
    lines: v.pipe(
      v.array(
        v.strictObject({
          service: v.object(
            {
              id: identifier,
              name: text('Service name', 200, true),
            },
            'Choose an existing service.',
          ),
          description: text('Description', 2000, true, true),
          quantity: decimal('Quantity', 3, 10000, true),
          unitPrice: decimal('Unit price', 2, 1000000),
          tax: v.pipe(
            v.picklist(['taxable', 'gstFree', 'inputTaxed', 'noGst']),
            v.check(
              (tax) => gstRegistered !== (tax === 'noGst'),
              gstRegistered
                ? 'Select taxable, GST-free or input taxed.'
                : 'Select No GST.',
            ),
          ),
        }),
      ),
      v.minLength(1, 'Add at least one item.'),
      v.maxLength(200, 'Use at most 200 items.'),
    ),
  });
const draftFields = draftSchema([], false).entries;
export const savedDraftSchema = v.strictObject({
  ...draftFields,
  customerId: v.union([v.literal(''), identifier]),
  date: v.union([v.literal(''), draftFields.date]),
  bpayReference: v.optional(text('BPAY reference', 20)),
  due: v.optional(
    v.variant('mode', [
      draftFields.due.wrapped.options[0],
      v.strictObject({
        mode: v.literal('exact'),
        date: v.union(
          [v.literal(''), draftFields.due.wrapped.options[1].entries.date],
          'Enter a real due date between 1900 and 9999.',
        ),
      }),
      draftFields.due.wrapped.options[2],
    ]),
  ),
  lines: v.pipe(
    v.array(
      v.strictObject({
        service: v.optional(
          v.object({ id: identifier, name: text('Service name', 200, true) }),
        ),
        description: text('Description', 2000, false, true),
        quantity: v.union(
          [v.literal(''), decimal('Quantity', 3, 10000, true)],
          'Enter a positive quantity, up to 10,000, with at most 3 decimal places.',
        ),
        unitPrice: v.union(
          [v.literal(''), decimal('Unit price', 2, 1000000)],
          'Enter a price from 0 to 1,000,000 with at most 2 decimal places.',
        ),
        tax: v.picklist(['taxable', 'gstFree', 'inputTaxed', 'noGst']),
      }),
    ),
    v.maxLength(200, 'Use at most 200 items.'),
  ),
});
export function fieldErrors<T>(
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
  value: unknown,
): Record<string, string> {
  const result = v.safeParse(schema, value);
  const errors: Record<string, string> = {};
  if (!result.success)
    for (const issue of result.issues) {
      const path = issue.path?.map((part) => part.key).join('.') ?? '_form';
      errors[path] ??= /^lines\.\d+\.service$/.test(path)
        ? 'Choose or create a service.'
        : issue.message;
    }
  return errors;
}
export function focusInvalid(form: HTMLFormElement | null) {
  queueMicrotask(() =>
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
}
