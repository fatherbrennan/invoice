export type PayIdType = 'email' | 'mobile' | 'abn' | 'organisationId';
export type PaymentMethod =
  | {
      type: 'bankTransfer';
      accountName: string;
      bsb: string;
      accountNumber: string;
    }
  | {
      type: 'payId';
      payIdType: PayIdType;
      value: string;
      recipientName: string;
    }
  | { type: 'bpay'; billerCode: string }
  | { type: 'custom'; label: string; value: string };
export interface Profile {
  name: string;
  abn: string;
  address: string;
  paymentDetails: string;
  paymentMethods?: PaymentMethod[];
  gstRegistered: boolean;
  showItemGst: boolean;
}
export interface Customer {
  attention?: string;
  id: string;
  code: string;
  name: string;
  abn: string;
  address: string;
  nextNumber: number;
}
export type Tax = 'taxable' | 'gstFree' | 'inputTaxed' | 'noGst';
export interface Service {
  id: string;
  name: string;
  description: string;
  unitPrice: string;
  tax: Tax;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Workspace {
  profile: Profile | null;
  customerCount: number;
  serviceCount: number;
}
export interface InvoiceSummary {
  id: string;
  kind: 'draft' | 'issued';
  customerId: string;
  number: string;
  customerName: string;
  date: string;
  total: number | null;
  paid: boolean;
  voidReason: string;
  description: string;
  dueDate?: string;
}
export interface Line {
  service?: Pick<Service, 'id' | 'name'>;
  description: string;
  quantity: string;
  unitPrice: string;
  tax: Tax;
}
export type DueDate =
  | { mode: 'none' }
  | { mode: 'exact'; date: string }
  | { mode: 'relative'; amount: number; unit: 'days' | 'months' };
export interface Draft {
  bpayReference?: string;
  reference?: string;
  due?: DueDate;
  id: string;
  customerId: string;
  date: string;
  notes: string;
  lines: Line[];
}
export interface LineTotal {
  net: number;
  gst: number;
  total: number;
}
export interface InvoiceGroup extends LineTotal {
  count: number;
}
export interface InvoiceReport {
  all: InvoiceGroup;
  paid: InvoiceGroup;
  unpaid: InvoiceGroup;
  overdue: InvoiceGroup;
  noDueDate: InvoiceGroup;
  taxable: LineTotal;
  gstFree: LineTotal;
  inputTaxed: LineTotal;
  noGst: LineTotal;
}
export interface Totals extends LineTotal {
  lines: LineTotal[];
}
export interface Snapshot {
  dueDate?: string;
  templateVersion: 2;
  number: string;
  profile: Profile;
  customer: Customer;
  draft: Draft;
  heading: string;
  totals: Totals;
}
export interface Issued {
  id: string;
  snapshot: Snapshot;
  paid: boolean;
  voidReason: string;
}
