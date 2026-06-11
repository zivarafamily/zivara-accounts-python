// LLPPayables.gs - Vendor/agency/consultant bills payable by LLP with TDS
//
// Sheet: LLPPayables
// Columns:
//   PayableID | LLPID | LLPName | VendorName | VendorCategory | VendorGSTIN | VendorPAN
//   BillNo | BillDate | DueDate | ExpenseType | Description
//   TaxableAmount | GSTAmount | GrossAmount
//   TDSSection | TDSRate | TDSAmount | NetPayable
//   PaidAmount | PaymentDate | PaymentMode | BankAccount | ReferenceNo
//   ChallanNo | ChallanDate | InterestAmount | Status | Notes | CreatedAt | UpdatedAt

var LLP_PAYABLES_SHEET = 'LLPPayables';
var LLP_PAYABLES_SCHEMA = [
  'PayableID','LLPID','LLPName','VendorName','VendorCategory','VendorGSTIN','VendorPAN',
  'BillNo','BillDate','DueDate','ExpenseType','Description',
  'TaxableAmount','GSTAmount','GrossAmount',
  'TDSSection','TDSRate','TDSAmount','NetPayable',
  'PaidAmount','PaymentDate','PaymentMode','BankAccount','ReferenceNo',
  'ChallanNo','ChallanDate','InterestAmount',
  'Status','Notes','CreatedAt','UpdatedAt'
];

function getLLPPayables(payload) {
  payload = payload || {};
  ensureLLPPayablesSheet_();
  var rows = getDataRows(LLP_PAYABLES_SHEET);
  var llp = getAccountsLLP_(payload.llpId || payload.LLPID);
  if (llp) {
    var id = String(llp.LLPID || '').trim();
    var name = String(llp.LLPName || '').trim().toLowerCase();
    rows = rows.filter(function(r) {
      return String(r.LLPID || '').trim() === id ||
        String(r.LLPName || '').trim().toLowerCase() === name;
    });
  }

  rows = rows.map(normalizeLLPPayableRow_);
  return { ok: true, data: rows, summary: summarizeLLPPayables_(rows) };
}

function saveLLPPayable(payload) {
  payload = payload || {};
  ensureLLPPayablesSheet_();
  if (!payload.VendorName) throw new Error('VendorName is required');
  if (!payload.BillDate) throw new Error('BillDate is required');

  var llp = getAccountsLLP_(payload.LLPID || payload.llpId);
  var duplicate = findDuplicateLLPPayable_(payload, null, llp);
  if (duplicate) throw new Error('Duplicate payable bill already exists for this vendor and bill number');
  var amounts = computeLLPPayableAmounts_(payload);
  var row = {
    PayableID:      payload.PayableID || makeId('PAY'),
    LLPID:          llp ? (llp.LLPID || '') : (payload.LLPID || payload.llpId || ''),
    LLPName:        llp ? (llp.LLPName || '') : (payload.LLPName || ''),
    VendorName:     payload.VendorName || '',
    VendorCategory: payload.VendorCategory || '',
    VendorGSTIN:    payload.VendorGSTIN || '',
    VendorPAN:      payload.VendorPAN || '',
    BillNo:         payload.BillNo || '',
    BillDate:       payload.BillDate || '',
    DueDate:        payload.DueDate || '',
    ExpenseType:    payload.ExpenseType || 'Vendor Bill',
    Description:    payload.Description || '',
    TaxableAmount:  amounts.taxableAmount,
    GSTAmount:      amounts.gstAmount,
    GrossAmount:    amounts.grossAmount,
    TDSSection:     payload.TDSSection || '',
    TDSRate:        amounts.tdsRate,
    TDSAmount:      amounts.tdsAmount,
    NetPayable:     amounts.netPayable,
    PaidAmount:     toNumber(payload.PaidAmount),
    PaymentDate:    payload.PaymentDate || '',
    PaymentMode:    payload.PaymentMode || 'Bank',
    BankAccount:    payload.BankAccount || '',
    ReferenceNo:    payload.ReferenceNo || '',
    ChallanNo:      payload.ChallanNo || '',
    ChallanDate:    payload.ChallanDate || '',
    InterestAmount: toNumber(payload.InterestAmount),
    Status:         payload.Status || getLLPPayableStatus_(amounts.netPayable, toNumber(payload.PaidAmount)),
    Notes:          payload.Notes || '',
    CreatedAt:      nowISO(),
    UpdatedAt:      nowISO()
  };
  row.Status = getLLPPayableStatus_(row.NetPayable, row.PaidAmount, row.Status);

  appendRow(LLP_PAYABLES_SHEET, row);
  return { ok: true, message: 'Payable saved', data: row };
}

function updateLLPPayable(payload) {
  payload = payload || {};
  ensureLLPPayablesSheet_();
  if (!payload.PayableID) throw new Error('PayableID is required');

  var existing = getLLPPayableById_(payload.PayableID);
  if (!existing) throw new Error('Payable not found');
  var merged = {};
  Object.keys(existing).forEach(function(k) { merged[k] = existing[k]; });
  Object.keys(payload).forEach(function(k) { merged[k] = payload[k]; });

  var llp = getAccountsLLP_(payload.LLPID || payload.llpId);
  var duplicate = findDuplicateLLPPayable_(merged, payload.PayableID, llp);
  if (duplicate) throw new Error('Duplicate payable bill already exists for this vendor and bill number');
  var amounts = computeLLPPayableAmounts_(merged);
  var updateData = {
    LLPID:          llp ? (llp.LLPID || '') : merged.LLPID,
    LLPName:        llp ? (llp.LLPName || '') : merged.LLPName,
    VendorName:     merged.VendorName,
    VendorCategory: merged.VendorCategory,
    VendorGSTIN:    merged.VendorGSTIN,
    VendorPAN:      merged.VendorPAN,
    BillNo:         merged.BillNo,
    BillDate:       merged.BillDate,
    DueDate:        merged.DueDate,
    ExpenseType:    merged.ExpenseType,
    Description:    merged.Description,
    TaxableAmount:  amounts.taxableAmount,
    GSTAmount:      amounts.gstAmount,
    GrossAmount:    amounts.grossAmount,
    TDSSection:     merged.TDSSection,
    TDSRate:        amounts.tdsRate,
    TDSAmount:      amounts.tdsAmount,
    NetPayable:     amounts.netPayable,
    PaidAmount:     toNumber(merged.PaidAmount),
    PaymentDate:    merged.PaymentDate,
    PaymentMode:    merged.PaymentMode,
    BankAccount:    merged.BankAccount,
    ReferenceNo:    merged.ReferenceNo,
    ChallanNo:      merged.ChallanNo,
    ChallanDate:    merged.ChallanDate,
    InterestAmount: toNumber(merged.InterestAmount),
    Status:         getLLPPayableStatus_(amounts.netPayable, toNumber(merged.PaidAmount), merged.Status),
    Notes:          merged.Notes,
    UpdatedAt:      nowISO()
  };

  updateRowById(LLP_PAYABLES_SHEET, 'PayableID', payload.PayableID, updateData);
  return { ok: true, message: 'Payable updated' };
}

function markLLPPayablePaid(payload) {
  payload = payload || {};
  if (!payload.PayableID) throw new Error('PayableID is required');
  var existing = getLLPPayableById_(payload.PayableID);
  if (!existing) throw new Error('Payable not found');
  var paidAmount = payload.PaidAmount !== undefined ? toNumber(payload.PaidAmount) : toNumber(existing.NetPayable);
  return updateLLPPayable({
    PayableID: payload.PayableID,
    PaidAmount: paidAmount,
    PaymentDate: payload.PaymentDate || nowISO().slice(0, 10),
    PaymentMode: payload.PaymentMode || existing.PaymentMode || 'Bank',
    BankAccount: payload.BankAccount || existing.BankAccount || '',
    ReferenceNo: payload.ReferenceNo || existing.ReferenceNo || '',
    Status: getLLPPayableStatus_(toNumber(existing.NetPayable), paidAmount)
  });
}

function getLLPPayableById_(payableId) {
  ensureLLPPayablesSheet_();
  var rows = getDataRows(LLP_PAYABLES_SHEET);
  return rows.filter(function(r) {
    return String(r.PayableID || '') === String(payableId || '');
  })[0] || null;
}

function computeLLPPayableAmounts_(payload) {
  var taxableAmount = toNumber(payload.TaxableAmount);
  var gstAmount = toNumber(payload.GSTAmount);
  var grossAmount = toNumber(payload.GrossAmount || payload.Amount);
  if (!grossAmount) grossAmount = taxableAmount + gstAmount;
  if (!taxableAmount && grossAmount) taxableAmount = Math.max(grossAmount - gstAmount, 0);
  var tdsRate = toNumber(payload.TDSRate);
  var explicitTDS = payload.TDSAmount !== undefined && payload.TDSAmount !== '';
  var tdsAmount = explicitTDS ? toNumber(payload.TDSAmount) : Math.round(taxableAmount * tdsRate) / 100;
  var netPayable = Math.max(grossAmount - tdsAmount, 0);
  return {
    taxableAmount: taxableAmount,
    gstAmount: gstAmount,
    grossAmount: grossAmount,
    tdsRate: tdsRate,
    tdsAmount: tdsAmount,
    netPayable: netPayable
  };
}

function getLLPPayableStatus_(netPayable, paidAmount, currentStatus) {
  if (String(currentStatus || '') === 'Cancelled') return 'Cancelled';
  netPayable = toNumber(netPayable);
  paidAmount = toNumber(paidAmount);
  if (paidAmount <= 0) return 'Pending';
  if (paidAmount >= netPayable - 1) return 'Paid';
  return 'Part Paid';
}

function normalizeLLPPayableRow_(row) {
  var amounts = computeLLPPayableAmounts_(row);
  row.TaxableAmount = amounts.taxableAmount;
  row.GSTAmount = amounts.gstAmount;
  row.GrossAmount = amounts.grossAmount;
  row.TDSRate = amounts.tdsRate;
  row.TDSAmount = amounts.tdsAmount;
  row.NetPayable = amounts.netPayable;
  row.PaidAmount = toNumber(row.PaidAmount);
  row.BalanceAmount = Math.max(row.NetPayable - row.PaidAmount, 0);
  row.Status = getLLPPayableStatus_(row.NetPayable, row.PaidAmount, row.Status);
  return row;
}

function summarizeLLPPayables_(rows) {
  return rows.reduce(function(acc, row) {
    acc.billCount += 1;
    acc.grossAmount += toNumber(row.GrossAmount);
    acc.tdsAmount += toNumber(row.TDSAmount);
    acc.netPayable += toNumber(row.NetPayable);
    acc.paidAmount += toNumber(row.PaidAmount);
    acc.balanceAmount += toNumber(row.BalanceAmount);
    if (row.Status === 'Paid') acc.paidCount += 1;
    if (row.Status === 'Part Paid') acc.partPaidCount += 1;
    if (row.Status === 'Pending') acc.pendingCount += 1;
    return acc;
  }, {
    billCount: 0,
    grossAmount: 0,
    tdsAmount: 0,
    netPayable: 0,
    paidAmount: 0,
    balanceAmount: 0,
    paidCount: 0,
    partPaidCount: 0,
    pendingCount: 0
  });
}

function ensureLLPPayablesSheet_() {
  var ss = getSS();
  var sh = ss.getSheetByName(LLP_PAYABLES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LLP_PAYABLES_SHEET);
    sh.appendRow(LLP_PAYABLES_SCHEMA);
    sh.setFrozenRows(1);
    return;
  }
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(h) {
    return String(h || '').trim();
  });
  LLP_PAYABLES_SCHEMA.forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col);
      headers.push(col);
    }
  });
}

function setupLLPPayablesSheet() {
  ensureLLPPayablesSheet_();
  Logger.log(LLP_PAYABLES_SHEET + ' sheet is ready.');
}

function normalizeLLPPayableKey_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDuplicateLLPPayable_(payload, ignorePayableId, llp) {
  var billNo = normalizeLLPPayableKey_(payload.BillNo);
  var vendorName = normalizeLLPPayableKey_(payload.VendorName);
  if (!billNo || !vendorName) return null;
  var llpId = normalizeLLPPayableKey_(llp ? llp.LLPID : (payload.LLPID || payload.llpId));
  var llpName = normalizeLLPPayableKey_(llp ? llp.LLPName : payload.LLPName);
  var rows = getDataRows(LLP_PAYABLES_SHEET);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (ignorePayableId && String(row.PayableID || '') === String(ignorePayableId)) continue;
    var rowVendor = normalizeLLPPayableKey_(row.VendorName);
    var rowBill = normalizeLLPPayableKey_(row.BillNo);
    var rowLLPId = normalizeLLPPayableKey_(row.LLPID);
    var rowLLPName = normalizeLLPPayableKey_(row.LLPName);
    var sameLLP = !llpId && !llpName ? true :
      (!!llpId && rowLLPId === llpId) ||
      (!!llpName && rowLLPName === llpName);
    if (sameLLP && rowVendor === vendorName && rowBill === billNo) return row;
  }
  return null;
}
