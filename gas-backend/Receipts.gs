// Receipts.gs - generic receipts/inward money records for accounts

function getReceipts(payload) {
  payload = payload || {};
  return { ok: true, data: filterRowsByLLP_(getDataRows('Receipts'), payload) };
}

function saveReceipt(payload) {
  if (!payload.Date) throw new Error('Receipt date is required');
  if (!payload.AmountReceived) throw new Error('Amount received is required');

  var receipt = {
    ReceiptID: payload.ReceiptID || makeId('RCT'),
    LLPID: payload.LLPID || '',
    LLPName: payload.LLPName || '',
    Date: payload.Date || '',
    ReferenceType: payload.ReferenceType || 'Receipt',
    Month: payload.Month || '',
    AmountReceived: toNumber(payload.AmountReceived),
    ReceiptMode: payload.ReceiptMode || 'Bank',
    BankAccount: payload.BankAccount || '',
    ReferenceNo: payload.ReferenceNo || '',
    Notes: payload.Notes || '',
    CreatedAt: nowISO()
  };
  fillLLPFields_(receipt, payload);

  appendRow('Receipts', receipt);
  return { ok: true, message: 'Receipt saved', data: receipt };
}

function updateReceipt(payload) {
  if (!payload.ReceiptID) throw new Error('ReceiptID is required');

  var updateData = {
    Date: payload.Date,
    LLPID: payload.LLPID,
    LLPName: payload.LLPName,
    ReferenceType: payload.ReferenceType,
    Month: payload.Month,
    AmountReceived: payload.AmountReceived !== undefined ? toNumber(payload.AmountReceived) : undefined,
    ReceiptMode: payload.ReceiptMode,
    BankAccount: payload.BankAccount,
    ReferenceNo: payload.ReferenceNo,
    Notes: payload.Notes
  };

  updateRowById('Receipts', 'ReceiptID', payload.ReceiptID, updateData);
  return { ok: true, message: 'Receipt updated' };
}

function deleteReceipt(payload) {
  if (!payload.ReceiptID) throw new Error('ReceiptID is required');
  deleteRowById('Receipts', 'ReceiptID', payload.ReceiptID);
  return { ok: true, message: 'Receipt deleted' };
}
