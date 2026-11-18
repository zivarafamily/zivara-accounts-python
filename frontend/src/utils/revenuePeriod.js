const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function revenueMonthSortValue(value) {
  const match = String(value || '').match(/^([A-Za-z]{3})-(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const month = MONTHS.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
  return month < 0 ? Number.MAX_SAFE_INTEGER : Number(match[2]) * 12 + month;
}
export function fyFromRevenueMonth(value) {
  const n = revenueMonthSortValue(value);
  if (n === Number.MAX_SAFE_INTEGER) return '';
  const year = Math.floor(n / 12);
  const start = n % 12 >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function monthLabel(value) { return String(value || '').replace(/^([A-Za-z]{3})-(\d{4})$/, '$1 $2'); }
export function keepMonthInFY(month, fy) { return !fy || fyFromRevenueMonth(month) === fy ? month : ''; }
export function periodParams(mode, { month = '', fromMonth = '', toMonth = '', fromDate = '', toDate = '' }) {
  if (mode === 'dates') return { ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) };
  if (mode === 'range') return { ...(fromMonth ? { fromMonth } : {}), ...(toMonth ? { toMonth } : {}) };
  return month ? { month } : {};
}
