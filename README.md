# Zivara Accounts

Dedicated accounts, GST, TDS, payment tracking, reimbursement, bank and CA reporting app for Zivara LLP entities.

This app was extracted from the office app so accounting/compliance workflows can evolve separately from Neo revenue and Neo invoice workflows.

## Scope

- LLP vendor payables and payment tracker
- Vendor master
- TDS calculation and payment status
- GST/TDS reports for CA review
- Expenses and reimbursements
- Receipts and cash book
- Bank accounts
- LLP and partner setup

## Out Of Scope

- Neo revenue uploads
- Neo statements
- Neo invoice creation
- Revenue share rules
- Partner revenue settlement

Those remain in the Neo revenue app.

## Structure

```text
zivara-accounts/
  frontend/       React/Vite app
  gas-backend/    Google Apps Script backend
  docs/           Sheet headers and deployment notes
```

## Local Frontend

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env`:

```text
VITE_GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_ACCOUNTS_WEB_APP_ID/exec
```

## Backend

Copy the files in `gas-backend/` into a new Apps Script project or push with clasp. Set `SPREADSHEET_ID` in `Utils.gs`.

Run setup helpers as needed:

```js
setupLLPPayablesSheet()
setupVendorsSheet()
setupBankAccountsSheet()
setupLLPsSheet()
setupPartnersSheet()
setupLLPPartnersSheet()
```
