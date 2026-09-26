# Naturegen Distribution ERP — Sales/Ledger/Expense Implementation Report
Date: 26 September 2026

## Files / modules changed
- `app.js` — Sales & Invoicing, Customer Management, Customer Ledger, Recovery, Expense Management, Reports, Users/Roles, Audit Trail, Settings.
- `firestore.rules` — backend role enforcement, immutable audit/ledger controls, invoice/customer/expense permissions.
- `index.html` — Customer Ledger and Audit Trail pages plus cache-busting for the current release.
- `styles.css` — status badges, ledger/audit/expense workflow styling.

## Database / document changes
Existing collections are preserved. The implementation uses/extends:
- `sales`: status, creator/submit/approval/cancellation metadata, dispatch eligibility, stockApplied, paid/free/delivered unit totals, complimentary exception flags.
- `customers`: customerCode, creditLimit, creditDays, openingBalance/currentBalance, complimentarySchemeEligible, deactivation metadata.
- `customerIndex`: duplicate-control keys for customer name, business/pharmacy name and phone.
- `ledgerEntries`: opening balances, credit/cash sales, discounts, payments, sales returns, debit/credit notes, adjustments, reversals and linked document IDs.
- `payments`: payment/reversal metadata and recovery linkage.
- `expenses`: voucherNo, status, payment/account/vendor/department/attachment, approval/rejection/cancellation metadata.
- `cashBankAccounts`: account name/type/balance for approved expense posting.
- `auditTrail`: append-only audit entries.
- `counters`: invoice/customer/expense counters; initialization no longer resets existing counters.
- `stockMovements`: approved sale deductions and cancellation reversals with paid/free quantities.

## Completed workflows
1. Salesman invoice creation submits as Pending Approval; Salesman cannot approve.
2. Marketing Director approves/rejects pending invoices.
3. Only Marketing Director / ERP Manager can cancel invoices; reason is mandatory.
4. Approved invoice cancellation reverses stock, customer balance, payments and ledger impact.
5. Complimentary quantity defaults to zero; customer scheme eligibility is controlled by Marketing Director.
6. Exceptional complimentary quantity is flagged and recorded in audit data.
7. Paid, complimentary and total delivered units are shown in invoice/report/ledger data.
8. Customer codes are auto-generated; duplicate checks use name, phone and business details.
9. Salesman cannot deactivate customers; Marketing Director / ERP Manager can deactivate with a reason.
10. Customer ledgers auto-update from approved invoices and payments and support filters, print and CSV statement download.
11. Expense vouchers support Draft / Pending Approval / Approved / Rejected / Cancelled, attachments, filters and cash/bank posting.
12. Audit Trail is non-editable/non-deletable through Firestore rules.
13. Recovery customer-balance changes are linked to the actual payment document.
14. Existing ERP records/modules are retained; no working module was renamed or removed.

## Role enforcement
- Salesman: assigned customers/invoices, customer creation, invoice submission, proposed free quantity; no approval/cancellation/deactivation.
- Marketing Director: invoice approval/rejection, complimentary scheme authorization, invoice cancellation, customer deactivation, sales/ledger/recovery views.
- ERP Manager: system roles/records, invoice cancellation, customer deactivation, audit access and authorized corrections.
- Admin remains for system administration but is not treated as Marketing Director for invoice approval/cancellation.

## Tests performed
- JavaScript syntax check: passed.
- Static workflow/permission checks for Salesman, Marketing Director and ERP Manager: passed.
- Required status/field/action markers checked in `app.js`: passed.
- Firestore rule structural brace check: passed.
- Backend rules verified to deny permanent deletes for sales/customers/expenses/audit records.
- GitHub Pages build/deployment: successful.

## Remaining live verification step
The latest `firestore.rules` file must be published in Firebase Firestore Rules before the new backend permissions are active in the live ERP. Full end-to-end login testing with real Salesman, Marketing Director and ERP Manager accounts requires those Firebase user accounts/credentials after the rules are published.
