# Neo Revenue period controls

One shared period bar sits beneath the page heading. Financial year remains
**All years** by default so historical statements do not disappear. Selecting a
financial year limits revenue months to April through the following March. Labels
include the calendar year (`Apr 2026`) while API and saved form values stay
`Apr-2026`. Month options, data rows and month reports are chronological.

Data uses Financial year + Revenue month. Reports add a simple mode choice:
- Month (default), including all months within the selected financial year.
- Month range, with start/end months and Apply period.
- Transaction dates, with start/end dates and Apply period.

Changing report mode clears incompatible old month/date criteria. Changing FY
clears incompatible month selections and transaction-date ranges. Reversed month
ranges cannot be selected; reversed date ranges are blocked before requesting a
report. Month and date drill-down selects the relevant mode. Clear resets report
filters/mode while retaining the visible FY, as before. The FY filters the revenue
statement period even when transaction dates predate that period; the toolbar
explains this distinction. Client/fund/partner filters, report views, access scope,
and report calculations are unchanged.

Validation:
- `node --test frontend/tests/revenuePeriod.test.js`
- `npm run build --prefix frontend`
- Mounted synthetic interaction test: install optional `jsdom` without saving or
  changing the lockfile, then `node frontend/tests/revenuePeriod.interaction.mjs`.
  Alternatively set `JSDOM_PATH` to an existing jsdom module entry. This test mocks
  all API calls, exercises FY changes, range requests, mode switching, date and
  month drill-down, and Clear. No live service or data is used.
