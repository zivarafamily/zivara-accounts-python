function getExpenses(payload) {
  payload = payload || {};
  return { ok: true, data: filterRowsByLLP_(getDataRows('Expenses'), payload) };
}

function saveExpense(payload) {
  if (!payload.Date) throw new Error('Expense date is required');
  if (!payload.Description) throw new Error('Description is required');
  ensureExpensePartnerStatementColumns_();

  // ── Soft duplicate warning ─────────────────────────────────────────────
  // Only on new saves. Skip when the caller explicitly sets skipDuplicateCheck.
  if (!payload.skipDuplicateCheck) {
    var dupDate   = String(payload.Date   || '').slice(0, 10);
    var dupAmount = toNumber(payload.Amount);
    var dupPaidBy = String(payload.PaidBy         || '').trim().toLowerCase();
    var dupVendor = String(payload.VendorOrPerson || '').trim().toLowerCase();

    if (dupDate && dupAmount > 0) {
      var existingExp = getDataRows('Expenses');
      var dupMatches = [];
      existingExp.forEach(function(r) {
        var rDate   = String(r.Date   || '').slice(0, 10);
        var rAmount = toNumber(r.Amount);
        var rPaidBy = String(r.PaidBy         || '').trim().toLowerCase();
        var rVendor = String(r.VendorOrPerson || '').trim().toLowerCase();
        if (rDate !== dupDate || rAmount !== dupAmount) return;
        var reason = '';
        if (dupPaidBy && rPaidBy && rPaidBy === dupPaidBy) reason = 'same date, amount and payer';
        else if (dupVendor && rVendor && rVendor === dupVendor) reason = 'same date, amount and vendor';
        if (reason) dupMatches.push({
          ExpenseID:     r.ExpenseID,
          Date:          r.Date,
          Amount:        r.Amount,
          PaidBy:        r.PaidBy         || '',
          VendorOrPerson: r.VendorOrPerson || '',
          Description:   r.Description    || '',
          reason:        reason
        });
      });

      if (dupMatches.length > 0) {
        var reasons = dupMatches.map(function(m) { return m.reason; });
        var reasonText = reasons.indexOf('same date, amount and payer') !== -1
          ? 'same date, amount and payer'
          : 'same date, amount and vendor';
        return {
          ok:               true,
          duplicateWarning: true,
          message:          'Possible duplicate: ' + reasonText + ' already exists. Please verify before saving.',
          matches:          dupMatches
        };
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  var taxableValue = toNumber(payload.TaxableValue);
  var cgstAmount   = toNumber(payload.CGSTAmount);
  var sgstAmount   = toNumber(payload.SGSTAmount);
  var igstAmount   = toNumber(payload.IGSTAmount);
  // GSTAmount = explicit value OR CGST + SGST + IGST sum
  var gstAmount    = toNumber(payload.GSTAmount) || (cgstAmount + sgstAmount + igstAmount);
  // Amount is editable in the UI. Respect the explicit invoice total when
  // present; only derive it from GST fields if the total was left blank.
  var explicitAmount = toNumber(payload.Amount);
  var amount = explicitAmount || (taxableValue + gstAmount);
  if (!amount) throw new Error('Amount is required');

  const expense = {
    ExpenseID: payload.ExpenseID || makeId('EXP'),
    LLPID: payload.LLPID || '',
    LLPName: payload.LLPName || '',
    Date: payload.Date || '',
    ExpenseType: payload.ExpenseType || 'Misc',
    Category: payload.Category || '',
    PaidBy: payload.PaidBy || '',
    ChargeTo: payload.ChargeTo || '',
    ReimburseTo: payload.ReimburseTo || '',
    PaymentMode: payload.PaymentMode || 'Cash',
    TaxableValue: taxableValue || '',
    CGSTAmount: cgstAmount || '',
    SGSTAmount: sgstAmount || '',
    IGSTAmount: igstAmount || '',
    GSTAmount: gstAmount || '',
    Amount: amount,
    VendorOrPerson: payload.VendorOrPerson || '',
    Description: payload.Description || '',
    BillAvailable: normalizeYesNo(payload.BillAvailable, 'No'),
    BillLink: payload.BillLink || '',
    EmployeeName: payload.EmployeeName || '',
    BillingMonth: payload.BillingMonth || '',
    TravelID: payload.TravelID || '',
    Notes: payload.Notes || '',
    Status: payload.Status || 'Draft',
    PartnerAllocations: payload.PartnerAllocations || '',
    CreatedAt: nowISO()
  };
  fillLLPFields_(expense, payload);

  appendRow('Expenses', expense);
  return { ok: true, message: 'Expense saved', data: expense };
}

function updateExpense(payload) {
  if (!payload.ExpenseID) throw new Error('ExpenseID is required');
  ensureExpensePartnerStatementColumns_();

  const updateData = {
    Date: payload.Date,
    LLPID: payload.LLPID,
    LLPName: payload.LLPName,
    ExpenseType: payload.ExpenseType,
    Category: payload.Category,
    PaidBy: payload.PaidBy,
    ChargeTo: payload.ChargeTo,
    ReimburseTo: payload.ReimburseTo,
    PaymentMode: payload.PaymentMode,
    TaxableValue: payload.TaxableValue !== undefined ? toNumber(payload.TaxableValue) : undefined,
    CGSTAmount: payload.CGSTAmount !== undefined ? toNumber(payload.CGSTAmount) : undefined,
    SGSTAmount: payload.SGSTAmount !== undefined ? toNumber(payload.SGSTAmount) : undefined,
    IGSTAmount: payload.IGSTAmount !== undefined ? toNumber(payload.IGSTAmount) : undefined,
    GSTAmount: payload.GSTAmount !== undefined ? toNumber(payload.GSTAmount) : undefined,
    Amount: payload.Amount !== undefined ? toNumber(payload.Amount) : undefined,
    VendorOrPerson: payload.VendorOrPerson,
    Description: payload.Description,
    BillAvailable: payload.BillAvailable !== undefined ? normalizeYesNo(payload.BillAvailable) : undefined,
    BillLink: payload.BillLink,
    EmployeeName: payload.EmployeeName,
    BillingMonth: payload.BillingMonth,
    TravelID: payload.TravelID,
    Notes: payload.Notes,
    Status: payload.Status,
    PartnerAllocations: payload.PartnerAllocations,
    ReimburseMode:    payload.ReimburseMode,
    ReimburseAccount: payload.ReimburseAccount,
    ReimburseDate:    payload.ReimburseDate
  };

  updateRowById('Expenses', 'ExpenseID', payload.ExpenseID, updateData);
  return { ok: true, message: 'Expense updated' };
}

function approveExpense(payload) {
  if (!payload.ExpenseID) throw new Error('ExpenseID is required');
  updateRowById('Expenses', 'ExpenseID', payload.ExpenseID, {
    Status:     'Approved',
    ApprovedBy: payload.ApprovedBy || '',
    ApprovedAt: nowISO()
  });
  return { ok: true, message: 'Expense approved' };
}

function reimburseExpense(payload) {
  if (!payload.ExpenseID) throw new Error('ExpenseID is required');

  // 1. Mark expense as Reimbursed
  updateRowById('Expenses', 'ExpenseID', payload.ExpenseID, {
    Status:           'Reimbursed',
    ReimburseMode:    payload.ReimburseMode    || '',
    ReimburseAccount: payload.ReimburseAccount || '',
    ReimburseDate:    payload.ReimburseDate    || '',
    ReimburseRef:     payload.ReimburseRef     || '',
    ReimburseBy:      payload.ReimburseBy      || ''
  });

  // 2. Auto-create a CashBook entry for petty-cash reimbursements
  if (payload.ReimburseAccount === 'Petty Cash') {
    saveCashEntry({
      Date:          payload.ReimburseDate || nowISO().slice(0, 10),
      Type:          'Payment',
      AmountOut:     payload.Amount || 0,
      AmountIn:      0,
      ReferenceType: 'Expense Reimbursement',
      ReferenceID:   payload.ExpenseID,
      Description:   'Reimbursement: ' + (payload.Description || payload.ExpenseID),
      PaidBy:        payload.ReimburseBy || ''
    });
  }

  return { ok: true, message: 'Expense reimbursed' };
}

function deleteExpense(payload) {
  if (!payload.ExpenseID) throw new Error('ExpenseID is required');
  deleteRowById('Expenses', 'ExpenseID', payload.ExpenseID);
  return { ok: true, message: 'Expense deleted' };
}

function getExpenseById_(expenseId) {
  var rows = getDataRows('Expenses');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].ExpenseID || '') === String(expenseId)) return rows[i];
  }
  return null;
}

// ─────────────────────────────────────────────
// MIGRATION — run once to add PartnerAllocations column
// ─────────────────────────────────────────────

// Run this once from the GAS editor: addExpensePartnerAllocationsColumn()
function addExpensePartnerAllocationsColumn() {
  var ss = getSS();
  var sh = ss.getSheetByName('Expenses');
  if (!sh) { Logger.log('Expenses sheet not found'); return; }
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('PartnerAllocations') !== -1) { Logger.log('PartnerAllocations column already exists.'); return; }
  var notesIdx = headers.indexOf('Notes');
  if (notesIdx === -1) { Logger.log('Notes column not found'); return; }
  sh.insertColumnsBefore(notesIdx + 1, 1);
  sh.getRange(1, notesIdx + 1).setValue('PartnerAllocations');
  Logger.log('PartnerAllocations column added before Notes in Expenses sheet.');
}

// Run this once from the GAS editor if the Expenses sheet already exists:
// addExpensePartnerStatementColumns()
function addExpensePartnerStatementColumns() {
  ensureExpensePartnerStatementColumns_();
}

function ensureExpensePartnerStatementColumns_() {
  var ss = getSS();
  var sh = ss.getSheetByName('Expenses');
  if (!sh) { Logger.log('Expenses sheet not found'); return; }
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  function refreshHeaders() {
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  }

  function addColumn(name) {
    if (headers.indexOf(name) !== -1) return;
    var anchorIdx = headers.indexOf('PartnerAllocations');
    if (anchorIdx === -1) anchorIdx = headers.indexOf('Notes');
    if (anchorIdx === -1) {
      sh.insertColumnsAfter(sh.getLastColumn(), 1);
      sh.getRange(1, sh.getLastColumn()).setValue(name);
    } else {
      sh.insertColumnsBefore(anchorIdx + 1, 1);
      sh.getRange(1, anchorIdx + 1).setValue(name);
    }
    refreshHeaders();
  }

  addColumn('ChargeTo');
  addColumn('ReimburseTo');
  addColumn('CGSTAmount');
  addColumn('SGSTAmount');
}
