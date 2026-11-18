import { invoke } from '@tauri-apps/api/core';
import type {
  Customer,
  Draft,
  InvoiceReport,
  InvoiceSummary,
  Issued,
  Page,
  Profile,
  Service,
  Snapshot,
  Workspace,
} from './domain/types';

export const desktop = {
  workspace: () => invoke<Workspace>('workspace'),
  invoiceSummary: (range: { from: string; to: string }, today: string) =>
    invoke<InvoiceReport>('invoice_summary', { range, today }),
  searchInvoices: (
    query = '',
    page = 0,
    status = 'all',
    range = { from: '', to: '' },
    today = '',
  ) =>
    invoke<Page<InvoiceSummary>>('search_invoices', {
      query: { query, page, status, range, today },
    }),
  searchCustomers: (query = '', page = 0) =>
    invoke<Page<Customer>>('search_customers', { query: { query, page } }),
  searchServices: (query = '', page = 0) =>
    invoke<Page<Service>>('search_services', { query: { query, page } }),
  customer: (id: string) =>
    invoke<{ customer: Customer; codeLocked: boolean }>('get_customer', { id }),
  customerCodeAvailable: (code: string, id: string) =>
    invoke<boolean>('customer_code_available', { code, id }),
  draft: (id: string) => invoke<Draft>('get_draft', { id }),
  issued: (id: string) => invoke<Issued>('get_issued', { id }),
  saveService: (service: Service) => invoke<void>('save_service', { service }),
  deleteService: (id: string) => invoke<void>('delete_service', { id }),
  saveProfile: (profile: Profile) => invoke<void>('save_profile', { profile }),
  saveCustomer: (customer: Customer) =>
    invoke<void>('save_customer', { customer }),
  saveDraft: (draft: Draft) => invoke<void>('save_draft', { draft }),
  deleteDraft: (id: string) => invoke<void>('delete_draft', { id }),
  previewDraft: (draft: Draft) =>
    invoke<{ snapshot: Snapshot; pdf: string }>('preview_draft', { draft }),
  readPdf: (id: string) => invoke<string>('read_pdf', { id }),
  issue: (id: string) => invoke<void>('issue', { id }),
  correctInvoice: (id: string, newId: string, reason: string) =>
    invoke<void>('correct_invoice', { id, newId, reason }),
  backupStatus: () =>
    invoke<{ exportedAt: number; path: string; available: boolean } | null>(
      'backup_status',
    ),
  setPaid: (id: string, paid: boolean) =>
    invoke<void>('set_paid', { id, paid }),
  savePdf: (id: string, draft = false) =>
    invoke<string | null>('save_pdf', { id, draft }),
  openPdf: (id: string, draft = false) =>
    invoke<void>('open_pdf', { id, draft }),
  exportData: () => invoke<string | null>('export_data'),
  exportPreferences: (contents: string) =>
    invoke<string | null>('export_preferences', { contents }),
  importPreferences: () => invoke<string | null>('import_preferences'),
  prepareImport: () =>
    invoke<{
      customers: number;
      drafts: number;
      issued: number;
      services: number;
    } | null>('prepare_import'),
  cancelImport: () => invoke<void>('cancel_import'),
  confirmImport: () => invoke<string>('confirm_import'),
  dataLocation: () => invoke<string>('data_location'),
  showLocation: (path: string, directory = false) =>
    invoke<void>('show_location', { path, directory }),
};

export { money } from './money';
