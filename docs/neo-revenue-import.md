# Neo Revenue workbook import

The Imports screen downloads a real, blank `.xlsx` workbook with a `NeoRevenue`
sheet. Fill the rows below the headers, save, select the revenue month/year, and
upload. There are no example rows that could accidentally become ledger entries.
Enter commission rates with a percent sign, e.g. `1.78%`. Dates may be Excel dates
or supported date text. Do not change the selected month to match an old year
mistakenly printed in the source column: the selection determines RevenueMonth.

Accepted layouts:
- Published human-readable template headers, including Client Name, Date, Amount,
  Commission %, Gross Revenue, and Income Type, with any worksheet name.
- Neo source gross columns such as Gross Revenue Aug'26 or Gross Rev Sep'26.
- Existing app-native columns such as ClientName, RevenueAmount, RevenueMonth,
  CommissionPercent, and StatementRef. App-native numeric CommissionPercent is
  already in percentage points (0.5 means 0.5%, not 50%).

A single gross column uses the selected month/year. For multiple gross columns,
only an unambiguous matching period is used; exact month/year takes precedence,
then the month name (to accommodate incorrect source years). Ambiguous selection
is rejected before importing. A multi-tab native statement workbook is rejected
before any writes: upload one statement worksheet at a time. Source transaction
dates are not relabeled.

Negative adjustments are retained. Source Total rows are checked, not imported;
the existing five-paise total tolerance and per-row rounding are unchanged.
Database duplicate checks are unchanged: uploading the same successful file
again skips matching existing rows; identical source lines in one fresh upload
are retained, as required by the existing tests. Partial retries therefore retain
the existing duplicate-key limitations, not a new source-line identity scheme.

Commission storage still rounds to two decimal percentage points under the
existing data model. Higher-precision commission auditing requires a separate
schema/serialization change; this patch does not alter that contract.

Local checks: `python -m pytest backend/tests/test_neo_import_template.py`,
`python -m pytest backend/tests/test_app.py`, and `cd frontend && npm ci && npm run build`.
The existing frontend lockfile cannot pass `npm ci` in the tested environment
(missing @emnapi/runtime entry); a non-lockfile-changing local install with
`npm install --package-lock=false --legacy-peer-deps` successfully builds.
No deployment or database migration is included.
