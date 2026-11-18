import type { PaymentMethod } from './domain/types';
import { displayValue } from './format.ts';

export const paymentTypes = [
  { value: 'bankTransfer', label: 'Bank transfer' },
  { value: 'payId', label: 'PayID' },
  { value: 'bpay', label: 'BPAY' },
  { value: 'custom', label: 'Custom' },
];
export const payIdTypes = [
  { value: 'email', label: 'Email address' },
  { value: 'mobile', label: 'Australian mobile' },
  { value: 'abn', label: 'ABN' },
  { value: 'organisationId', label: 'Organisation ID' },
];
export function newPaymentMethod(type: PaymentMethod['type']): PaymentMethod {
  switch (type) {
    case 'bankTransfer':
      return { type, accountName: '', bsb: '', accountNumber: '' };
    case 'payId':
      return { type, payIdType: 'email', value: '', recipientName: '' };
    case 'bpay':
      return { type, billerCode: '' };
    case 'custom':
      return { type, label: '', value: '' };
  }
}
export function paymentText(method: PaymentMethod, bpayReference = '') {
  switch (method.type) {
    case 'bankTransfer': {
      const bsb = displayValue(method.bsb, 'bsb');
      return {
        label: 'Bank transfer',
        value: `Account name: ${method.accountName}\nBSB: ${bsb}\nAccount number: ${method.accountNumber}`,
      };
    }
    case 'payId':
      return {
        label: 'PayID',
        value: [
          displayValue(
            method.value,
            method.payIdType === 'abn'
              ? 'abn'
              : method.payIdType === 'mobile'
                ? 'mobile'
                : undefined,
          ),
          method.recipientName && `Name: ${method.recipientName}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    case 'bpay':
      return {
        label: 'BPAY',
        value: `Biller code: ${method.billerCode}\nRef: ${bpayReference}`,
      };
    case 'custom':
      return { label: method.label, value: method.value };
  }
}
