function getCashBook(payload) {
  payload = payload || {};
  return { ok: true, data: filterRowsByLLP_(getDataRows('CashBook'), payload) };
}

function getLatestCashClosingBalance(payload) {
  const rows = filterRowsByLLP_(getDataRows('CashBook'), payload || {});
  if (!rows.length) return 0;

  const lastRow = rows[rows.length - 1];
  return toNumber(lastRow.ClosingBalance);
}

function saveCashEntry(payload) {
  if (!payload.Date) throw new Error('Date is required');
  if (!payload.Type) throw new Error('Type is required');

  const openingBalance = payload.OpeningBalance !== undefined && payload.OpeningBalance !== ''
    ? toNumber(payload.OpeningBalance)
    : getLatestCashClosingBalance();

  const amountIn = toNumber(payload.AmountIn);
  const amountOut = toNumber(payload.AmountOut);
  const closingBalance = openingBalance + amountIn - amountOut;

  const entry = {
    EntryID: payload.EntryID || makeId('CASH'),
    LLPID: payload.LLPID || '',
    LLPName: payload.LLPName || '',
    Date: payload.Date || '',
    Type: payload.Type || 'Payment',
    OpeningBalance: openingBalance,
    AmountIn: amountIn,
    AmountOut: amountOut,
    ClosingBalance: closingBalance,
    ReferenceType: payload.ReferenceType || 'Manual',
    ReferenceID: payload.ReferenceID || '',
    Description: payload.Description || '',
    PaidBy: payload.PaidBy || '',
    CreatedAt: nowISO()
  };
  fillLLPFields_(entry, payload);

  appendRow('CashBook', entry);
  return { ok: true, message: 'Cash entry saved', data: entry };
}

function updateCashEntry(payload) {
  if (!payload.EntryID) throw new Error('EntryID is required');

  const rows = getDataRows('CashBook');
  const current = rows.find(r => String(r.EntryID) === String(payload.EntryID));
  if (!current) throw new Error('Cash entry not found');

  const openingBalance = payload.OpeningBalance !== undefined
    ? toNumber(payload.OpeningBalance)
    : toNumber(current.OpeningBalance);

  const amountIn = payload.AmountIn !== undefined
    ? toNumber(payload.AmountIn)
    : toNumber(current.AmountIn);

  const amountOut = payload.AmountOut !== undefined
    ? toNumber(payload.AmountOut)
    : toNumber(current.AmountOut);

  const closingBalance = openingBalance + amountIn - amountOut;

  const updateData = {
    Date: payload.Date,
    LLPID: payload.LLPID,
    LLPName: payload.LLPName,
    Type: payload.Type,
    OpeningBalance: openingBalance,
    AmountIn: amountIn,
    AmountOut: amountOut,
    ClosingBalance: closingBalance,
    ReferenceType: payload.ReferenceType,
    ReferenceID: payload.ReferenceID,
    Description: payload.Description,
    PaidBy: payload.PaidBy
  };

  updateRowById('CashBook', 'EntryID', payload.EntryID, updateData);
  return { ok: true, message: 'Cash entry updated', closingBalance };
}

function deleteCashEntry(payload) {
  if (!payload.EntryID) throw new Error('EntryID is required');
  deleteRowById('CashBook', 'EntryID', payload.EntryID);
  return { ok: true, message: 'Cash entry deleted' };
}
