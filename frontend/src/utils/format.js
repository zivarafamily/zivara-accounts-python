// utils/format.js – Currency, date, and number formatters

export function formatCurrency(value) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatDate(value) {
  if (!value) return '—';
  const s = String(value).slice(0, 10); // take YYYY-MM-DD part
  const parts = s.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return value;
}

export function formatNumber(value, decimals = 2) {
  return Number(value || 0).toFixed(decimals);
}

export function roundOff(value) {
  return Math.round(value * 100) / 100;
}

// Generates Mon-YYYY options (e.g. "Apr-2026"), sorted in FY order (Apr → Mar).
// backMonths months in the past, forwardMonths months in the future.
export function billingMonthOptions(backMonths = 12, forwardMonths = 3) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const FY_ORDER = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
  const now = new Date();
  const options = [];
  for (let i = forwardMonths; i >= -backMonths; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    options.push(`${MONTHS[d.getMonth()]}-${d.getFullYear()}`);
  }
  // sort by FY order: earlier FY year first, then Apr→Mar within year
  options.sort((a, b) => {
    const [am, ay] = a.split("-"); const [bm, by] = b.split("-");
    const ayr = parseInt(ay, 10); const byr = parseInt(by, 10);
    const ai = FY_ORDER.indexOf(am); const bi = FY_ORDER.indexOf(bm);
    // Apr-Dec belong to FY starting that calendar year; Jan-Mar belong to FY starting prev year
    const aFY = ['Jan','Feb','Mar'].includes(am) ? ayr - 1 : ayr;
    const bFY = ['Jan','Feb','Mar'].includes(bm) ? byr - 1 : byr;
    if (aFY !== bFY) return aFY - bFY;
    return ai - bi;
  });
  return options;
}

export function calcLineTotal(qty, rate, gstPercent, isInterState) {
  const taxable = (qty || 0) * (rate || 0);
  const gstAmt  = taxable * ((gstPercent || 0) / 100);
  const half    = gstAmt / 2;
  return {
    TaxableValue: taxable,
    CGST:  isInterState ? 0 : half,
    SGST:  isInterState ? 0 : half,
    IGST:  isInterState ? gstAmt : 0,
    LineTotal: taxable + gstAmt,
  };
}
