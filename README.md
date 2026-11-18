# Invoice

A local desktop invoice manager for one Australian business, built with Svelte,
Tauri and SQLite. Core use requires no account, server or internet connection.

## Application

- Business profile: supplier identity, GST settings and payment instructions.
- Customers: contact details and a unique uppercase code for invoice numbering.
- Services: descriptions, GST classifications and GST-exclusive unit prices.
- Invoices: saved drafts, live PDF previews, issue confirmation, original PDFs,
  paid/unpaid/overdue status, quick filters and invoice correction. Incomplete drafts
  can be saved and deleted; preview and issue require complete valid details.
- Summary: invoice-date totals for all issued invoices, current payment status,
  tax classifications and matching ledger drill-through. Dates use
  Australia/Adelaide; reports do not represent payment receipts or payment history.
- Settings opens Data: last backup status, full-data export/restore and licences.
  Preferences contains themes, zoom, default invoice view, collapsed advanced keyboard
  shortcuts and preferences transfer.

Invoices are numbered per customer: IABC1, IABC2, and so on. Issuing atomically
saves the snapshot and PDF, advances the counter and removes the draft. Failed
issuance consumes no number. Issued content is immutable; payment status is stored
separately. Profile, customer and service edits do not rewrite issued invoices.

Customers can be created inside a draft. Adapting a service saves a new reusable
service with its own description, price and tax classification; the original
remains available. Both can be managed or removed in Services.

Correcting an issued invoice requires a reason, voids the original and creates a
replacement draft. The original PDF remains unchanged; void invoices are excluded
from reports and unpaid/overdue totals. Issuing the replacement allocates a new
number. Payments and refunds are not transferred or recorded by this action.

Services supply each draft line's description, price and tax classification.
New drafts default to a due date one calendar month after their invoice date.
Terms can instead use an exact date, a relative number of days/months, or no due
date. Calendar months clamp to the last valid day of the target month.

Search uses SQLite FTS5 prefix matching for every entered word, with 25 records
per page. Inputs are limited to 200 characters and 12 words. Lists do not load PDF
blobs. PDF previews use the saved or generated document's embedded fonts.

## Calculation and limits

Prices are GST-exclusive with two decimal places; quantities allow three.
Extended net amounts round half up to cents, then taxable lines calculate and
round 10% GST. Totals sum the stored integer cents. For example, two separate
5-cent taxable lines total 12 cents, including 2 cents GST.

Tax classifications are taxable, GST-free, input taxed and no GST. Nonregistered
suppliers cannot charge GST. A registered supplier with a taxable line uses
TAX INVOICE; otherwise the heading is INVOICE. Hiding item GST does not change
classification or totals. ABNs are checked for format and checksum only.

ABNs display as `86 474 038 153`, BSBs as `012-345`, and Australian mobile
PayIDs use spaced groups. Editable identifiers are stored without display
separators; account numbers and payment references retain leading zeroes.
Prices accept conventional currency pastes and display two decimals on blur;
excess precision, negative values and scientific notation remain invalid.
PDFs use these display formats and a single layout.

Invoices use a prominent heading, supplier and customer details, and invoice
metadata including the due date. The compact item table has unshaded headings,
fine horizontal rules, separate tax-rate and GST-amount columns, and no item
numbering. Hiding item GST removes its amounts and column label. Descriptions
wrap in the table; rows stay together when they fit a page, while oversized rows
continue with repeated column headings. Totals and additional notes follow the
items. Payment details occupy three columns anchored to the bottom of the final
page, independently of note length. Oversized payment instructions continue in
bottom-anchored sections on additional pages.

Limits: 200 lines, 2,000 characters per description, quantity 10,000, unit price
$1,000,000 and invoice total $100,000,000. Unsupported PDF font characters cause
an error before issuance. The app does not provide adjustment notes, partial
payments, BAS, email, cloud sync or special GST schemes.

## Payment methods

The business profile supports up to ten ordered methods: Bank transfer (account
name, six-digit BSB, account number), PayID (email, Australian mobile, ABN or
Organisation ID, with an optional recipient name), BPAY (registered biller code),
and Custom (name and multiline instructions). Other payment instructions remain
available beneath these methods. Leading zeroes are retained.

One BPAY biller can be configured per profile. Every invoice using BPAY requires
its own 2-20 digit customer reference number (CRN); changing the invoice customer
clears it. Use a reference from the biller's bank-approved scheme. The application
checks syntax, not account registration, payment routing or bank-specific BPAY
check digits. It does not generate CRNs or process payments. Registered billers
must confirm their invoice layout with their financial institution. PDFs include
the BPAY logo, biller code and reference.

## Storage and transfer

The native application stores `invoice-v2.sqlite` in its platform application-data
directory. On Windows this is `%APPDATA%\au.local.invoice`. SQLite uses foreign
keys, WAL and full synchronous writes. `src-tauri/schema.sql` creates the complete
schema, search indexes and immutability triggers in one transaction. The app
starts empty and creates its database on first launch. Unsupported schemas are
rejected without changing the database.

Settings / Data exports business data, services, customers, drafts, issued
snapshots, original PDFs, payment/void status, correction reasons and numbering
counters in a ZIP containing `data.json` and the original PDF files in `pdfs/`.
The version 3 manifest references PDFs by their archive paths; PDFs are not
Base64-encoded. Recovery exports use the same ZIP format. Restore validates the
complete file, presents record counts and requires confirmation before
replacing the dataset. A recovery export is retained before replacement. Failed
or cancelled restores preserve existing data. Exports are unencrypted; transfer
replaces data rather than merging it. Use exports instead of copying a running
SQLite database. Preferences have their own export under Settings / Preferences.

Data exports are limited to 512 MiB both on disk and expanded, with PDFs up to 16 MiB, up to 10,000 customers,
drafts and issued invoices each, and 100,000 services. Export and PDF-template
versions are explicit and unsupported versions are rejected.

## Project structure

- `src/`: Svelte screens, shared controls, validation, preferences and native IPC.
- `src-tauri/src/`: storage, calculations, search, reporting, PDFs and transfer.
- `src-tauri/schema.sql`: complete SQLite schema.
- `src-tauri/tests/`, `scripts/*.test.mjs`, `tests/fixtures/`: automated checks and
  synthetic test inputs; fixtures are never seeded into the application.
- `scripts/*acceptance.mjs`: native Windows workflow and UI checks.
- `src-tauri/fonts/`, `static/licenses/`: IBM Plex Sans and software notices.
- `.github/workflows/release.yml`, `scripts/release.mjs`: manual release packaging
  and validated asset publication.

## Development

The project pins Bun 1.4.4, Node 22.22.0 and Rust 1.94.0. Windows native builds
require MSVC, a Windows SDK and WebView2. `scripts/native.mjs` uses `.tools/msvc`
when present, otherwise the installed toolchain. The local toolchain is not app
source or a bundled runtime.

From the project root:

```powershell
bun install --frozen-lockfile
bun run check
bun run lint
bun run test
bun run test:desktop
bun run build:release
```

`check` validates Svelte/TypeScript. `lint` checks source and scripts. `test` runs
Node tests and Rust tests against real SQLite and PDF output. `test:desktop`
builds a debug app and runs native workflow and UI checks using isolated synthetic
data in temporary directories that are removed after each run. It scripts
file-dialog selections; it does not verify native OS dialogs.
Debug test hooks are absent from release builds.

`build:release` builds the frontend and native release executable at
`src-tauri/target/release/invoice.exe` without an installer. Close a running copy
before rebuilding if Windows blocks replacement. `build` alone updates only the
frontend. `desktop` starts native development with Vite.

The manual release workflow packages Windows x64 and macOS ARM64/x64. Its tag
must match the version in package.json, Cargo.toml and tauri.conf.json. It refuses
existing releases and publishes only after all configured builds and uploads.
Windows packages are unsigned; macOS uses ad-hoc signing. Remote release execution
and native macOS behavior are not verified by the local Windows test suite.
