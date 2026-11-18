import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revenueMonthSortValue, fyFromRevenueMonth, monthLabel, keepMonthInFY, periodParams } from '../src/utils/revenuePeriod.js';
test('FY is April–March, including January in the following calendar year', () => {
  assert.equal(fyFromRevenueMonth('Apr-2025'), '2025-26');
  assert.equal(fyFromRevenueMonth('Jan-2026'), '2025-26');
  assert.equal(fyFromRevenueMonth('Mar-2026'), '2025-26');
  assert.equal(fyFromRevenueMonth('Apr-2026'), '2026-27');
});
test('chronological order does not mix identically named months across years', () => {
  const values = ['Apr-2026', 'Jan-2026', 'Apr-2025', 'Mar-2026'];
  assert.deepEqual(values.sort((a,b) => revenueMonthSortValue(a)-revenueMonthSortValue(b)), ['Apr-2025','Jan-2026','Mar-2026','Apr-2026']);
  assert.equal(monthLabel('Apr-2026'), 'Apr 2026');
});
test('FY changes clear incompatible month selections, all years keeps them', () => {
  assert.equal(keepMonthInFY('Jan-2026','2026-27'), '');
  assert.equal(keepMonthInFY('Jan-2026','2025-26'), 'Jan-2026');
  assert.equal(keepMonthInFY('Jan-2026',''), 'Jan-2026');
});
test('active report mode excludes hidden stale criteria and retains API formats', () => {
  const all = { month:'Aug-2026', fromMonth:'Apr-2026',toMonth:'Sep-2026',fromDate:'2025-01-01',toDate:'2025-01-31' };
  assert.deepEqual(periodParams('month',all), {month:'Aug-2026'});
  assert.deepEqual(periodParams('range',all), {fromMonth:'Apr-2026',toMonth:'Sep-2026'});
  assert.deepEqual(periodParams('dates',all), {fromDate:'2025-01-01',toDate:'2025-01-31'});
  assert.deepEqual(periodParams('month',{}), {});
});
