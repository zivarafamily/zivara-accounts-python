// Reports.gs - Accounts, GST/TDS, payment and CA reports

function getAccountsDashboard(payload) {
  payload = payload || {};
  var payables = getLLPPayables(payload).data || [];
  var expenses = getExpenses(payload).data || [];
  var bankAccounts = getBankAccounts(payload).data || [];
  var cashBalance = 0;
  try { cashBalance = getLatestCashClosingBalance(payload); } catch (e) {}

  var summary = {
    PayablesGross: 0,
    PayablesTDS: 0,
    PayablesGST: 0,
    PayablesNet: 0,
    PayablesPaid: 0,
    PayablesOutstanding: 0,
    PendingBills: 0,
    PaidBills: 0,
    ExpenseTotal: 0,
    ReimbursementPending: 0,
    ActiveBankBalance: 0,
    CashBalance: cashBalance
  };

  payables.forEach(function(p) {
    summary.PayablesGross += toNumber(p.GrossAmount);
    summary.PayablesTDS += toNumber(p.TDSAmount);
    summary.PayablesGST += toNumber(p.GSTAmount);
    summary.PayablesNet += toNumber(p.NetPayable);
    summary.PayablesPaid += toNumber(p.PaidAmount);
    summary.PayablesOutstanding += toNumber(p.BalanceAmount);
    if (String(p.Status || '') === 'Paid') summary.PaidBills += 1;
    else summary.PendingBills += 1;
  });

  expenses.forEach(function(e) {
    summary.ExpenseTotal += toNumber(e.Amount);
    if (String(e.Status || '') === 'Approved' || String(e.Status || '') === 'Submitted' || String(e.Status || '') === 'Draft') {
      summary.ReimbursementPending += toNumber(e.Amount);
    }
  });

  bankAccounts.forEach(function(a) {
    if (String(a.IsActive || 'Yes').toLowerCase() !== 'no') {
      summary.ActiveBankBalance += toNumber(a.CurrentBalance);
    }
  });

  return { ok: true, summary: summary, payables: payables.slice(0, 10), bankAccounts: bankAccounts };
}

function getGSTTDSReport(payload) {
  payload = payload || {};
  var rows = getLLPPayables(payload).data || [];
  var filterMonth = String(payload.month || payload.Month || '').trim();

  function monthKey(value) {
    var d = String(value || '').slice(0, 10);
    return d && d.length >= 7 ? d.slice(0, 7) : '';
  }

  if (filterMonth) {
    rows = rows.filter(function(r) {
      return monthKey(r.BillDate) === filterMonth || String(r.BillingMonth || '') === filterMonth;
    });
  }

  var reportRows = rows.map(function(r) {
    return {
      BillDate: r.BillDate || '',
      BillNo: r.BillNo || '',
      VendorName: r.VendorName || '',
      VendorGSTIN: r.VendorGSTIN || '',
      VendorCategory: r.VendorCategory || '',
      ExpenseType: r.ExpenseType || '',
      TaxableAmount: toNumber(r.TaxableAmount),
      GSTAmount: toNumber(r.GSTAmount),
      GrossAmount: toNumber(r.GrossAmount),
      TDSSection: r.TDSSection || '',
      TDSRate: toNumber(r.TDSRate),
      TDSAmount: toNumber(r.TDSAmount),
      NetPayable: toNumber(r.NetPayable),
      PaidAmount: toNumber(r.PaidAmount),
      BalanceAmount: toNumber(r.BalanceAmount),
      Status: r.Status || '',
      PaymentDate: r.PaymentDate || '',
      ReferenceNo: r.ReferenceNo || '',
      Notes: r.Notes || ''
    };
  });

  var summary = reportRows.reduce(function(acc, r) {
    acc.TaxableAmount += r.TaxableAmount;
    acc.GSTAmount += r.GSTAmount;
    acc.GrossAmount += r.GrossAmount;
    acc.TDSAmount += r.TDSAmount;
    acc.NetPayable += r.NetPayable;
    acc.PaidAmount += r.PaidAmount;
    acc.BalanceAmount += r.BalanceAmount;
    return acc;
  }, {
    TaxableAmount: 0,
    GSTAmount: 0,
    GrossAmount: 0,
    TDSAmount: 0,
    NetPayable: 0,
    PaidAmount: 0,
    BalanceAmount: 0
  });

  return { ok: true, data: reportRows, summary: summary };
}

function getCATDSReport(payload) {
  payload = payload || {};
  var rows = getLLPPayables(payload).data || [];
  var filterMonth = String(payload.month || payload.Month || '').trim();

  function monthKey(value) {
    var d = String(value || '').slice(0, 10);
    return d && d.length >= 7 ? d.slice(0, 7) : '';
  }

  if (filterMonth) {
    rows = rows.filter(function(r) {
      return monthKey(r.PaymentDate || r.BillDate) === filterMonth;
    });
  }

  rows = rows.filter(function(r) {
    return toNumber(r.TDSAmount) > 0;
  });

  var reportRows = rows.map(function(r, i) {
    var interest = toNumber(r.InterestAmount);
    var taxDeducted = toNumber(r.TDSAmount);
    return {
      'S No.': i + 1,
      'Deductee Name': r.VendorName || '',
      'PAN of  Deductee': r.VendorPAN || '',
      'Nature of Payment': r.ExpenseType || r.VendorCategory || r.Description || '',
      'Section': r.TDSSection || '',
      'Date of Payment/ Credit': r.PaymentDate || r.BillDate || '',
      'Amount Paid/ Credited': toNumber(r.TaxableAmount),
      'Rate of TDS (%)': toNumber(r.TDSRate),
      'Tax Deducted': taxDeducted,
      'Interest, If any': interest,
      'Total Amount Paid': taxDeducted + interest,
      'Challan No.': r.ChallanNo || '',
      'Date of Payment': r.ChallanDate || '',
      'Remarks': r.Notes || r.BillNo || ''
    };
  });

  var summary = reportRows.reduce(function(acc, r) {
    acc.AmountPaidCredited += toNumber(r['Amount Paid/ Credited']);
    acc.TaxDeducted += toNumber(r['Tax Deducted']);
    acc.Interest += toNumber(r['Interest, If any']);
    acc.TotalAmountPaid += toNumber(r['Total Amount Paid']);
    return acc;
  }, {
    AmountPaidCredited: 0,
    TaxDeducted: 0,
    Interest: 0,
    TotalAmountPaid: 0
  });

  return {
    ok: true,
    headers: [
      'S No.',
      'Deductee Name',
      'PAN of  Deductee',
      'Nature of Payment',
      'Section',
      'Date of Payment/ Credit',
      'Amount Paid/ Credited',
      'Rate of TDS (%)',
      'Tax Deducted',
      'Interest, If any',
      'Total Amount Paid',
      'Challan No.',
      'Date of Payment',
      'Remarks'
    ],
    data: reportRows,
    summary: summary
  };
}

function getVendorLedger(payload) {
  payload = payload || {};
  var rows = getLLPPayables(payload).data || [];
  var vendor = normalizeVendorLedgerKey_(payload.vendor || payload.VendorName || payload.vendorName);
  var vendorId = String(payload.VendorID || '').trim();

  if (vendorId && !vendor) {
    try {
      var vendors = getDataRows('Vendors');
      var matchedVendor = vendors.filter(function(v) {
        return String(v.VendorID || '').trim() === vendorId;
      })[0];
      if (matchedVendor) vendor = normalizeVendorLedgerKey_(matchedVendor.VendorName);
    } catch (e) {}
  }

  if (vendor || vendorId) {
    rows = rows.filter(function(r) {
      var rowVendor = normalizeVendorLedgerKey_(r.VendorName);
      return (vendor && (rowVendor === vendor || rowVendor.indexOf(vendor) !== -1 || vendor.indexOf(rowVendor) !== -1)) ||
        (vendorId && String(r.VendorID || '').trim() === vendorId);
    });
  }

  rows.sort(function(a, b) {
    return String(a.BillDate || a.PaymentDate || '').localeCompare(String(b.BillDate || b.PaymentDate || '')) ||
      String(a.BillNo || '').localeCompare(String(b.BillNo || ''));
  });

  var balance = 0;
  var ledgerRows = [];
  rows.forEach(function(r) {
    var gross = toNumber(r.GrossAmount);
    var tds = toNumber(r.TDSAmount);
    var net = toNumber(r.NetPayable);
    var paid = toNumber(r.PaidAmount);

    balance += net;
    ledgerRows.push({
      Date: r.BillDate || '',
      VendorName: r.VendorName || '',
      Particulars: 'Bill ' + (r.BillNo || '') + (r.Description ? ' - ' + r.Description : ''),
      BillNo: r.BillNo || '',
      Debit: net,
      Credit: 0,
      GrossAmount: gross,
      TDSAmount: tds,
      PaidAmount: 0,
      Balance: balance,
      ReferenceNo: '',
      Status: r.Status || '',
      Notes: r.Notes || ''
    });

    if (paid > 0) {
      balance -= paid;
      ledgerRows.push({
        Date: r.PaymentDate || '',
        VendorName: r.VendorName || '',
        Particulars: 'Payment against ' + (r.BillNo || ''),
        BillNo: r.BillNo || '',
        Debit: 0,
        Credit: paid,
        GrossAmount: 0,
        TDSAmount: 0,
        PaidAmount: paid,
        Balance: balance,
        ReferenceNo: r.ReferenceNo || '',
        Status: r.Status || '',
        Notes: r.PaymentMode || ''
      });
    }
  });

  var summary = ledgerRows.reduce(function(acc, r) {
    acc.Debit += toNumber(r.Debit);
    acc.Credit += toNumber(r.Credit);
    acc.GrossAmount += toNumber(r.GrossAmount);
    acc.TDSAmount += toNumber(r.TDSAmount);
    acc.ClosingBalance = toNumber(r.Balance);
    return acc;
  }, {
    Debit: 0,
    Credit: 0,
    GrossAmount: 0,
    TDSAmount: 0,
    ClosingBalance: 0
  });

  return {
    ok: true,
    headers: ['Date','VendorName','Particulars','BillNo','Debit','Credit','GrossAmount','TDSAmount','PaidAmount','Balance','ReferenceNo','Status','Notes'],
    data: ledgerRows,
    summary: summary
  };
}

function normalizeVendorLedgerKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getReconciliationSummary(payload) {
  payload = payload || {};
  var payables = getLLPPayables(payload).data || [];
  var data = payables.map(function(p) {
    var net = toNumber(p.NetPayable);
    var paid = toNumber(p.PaidAmount);
    var variance = net - paid;
    return {
      BillNo: p.BillNo || '',
      BillMonth: String(p.BillDate || '').slice(0, 7),
      VendorName: p.VendorName || '',
      GSTMode: p.GSTAmount ? 'With GST' : 'Without GST',
      GrossAmount: toNumber(p.GrossAmount),
      TDSDeducted: toNumber(p.TDSAmount),
      NetPayable: net,
      PaidAmount: paid,
      BalanceAmount: variance,
      Status: p.Status || ''
    };
  });
  return { ok: true, data: data };
}

function getReimbursementReport(payload) {
  payload = payload || {};
  var expenses = filterRowsByLLP_(getDataRows('Expenses'), payload);
  var cashBook = filterRowsByLLP_(getDataRows('CashBook'), payload);
  var rows = [];

  expenses.forEach(function(r) {
    if (!r.PaidBy) return;
    rows.push({
      Source: 'Expense',
      RefID: r.ExpenseID || '',
      Date: r.Date || '',
      PaidBy: r.PaidBy,
      Description: r.Description || r.Category || r.ExpenseType || r.VendorOrPerson || '',
      BillingMonth: r.BillingMonth || '',
      Amount: toNumber(r.Amount),
      Status: r.Status || ''
    });
  });

  cashBook.forEach(function(r) {
    if (!r.PaidBy) return;
    var amtIn = toNumber(r.AmountIn);
    if (amtIn <= 0) return;
    rows.push({
      Source: 'Petty Cash',
      RefID: r.EntryID || '',
      Date: r.Date || '',
      PaidBy: r.PaidBy,
      Description: r.Description || 'Cash deposited to petty cash',
      BillingMonth: '',
      Amount: amtIn,
      Status: 'Submitted'
    });
  });

  rows.sort(function(a, b) {
    return String(b.Date).localeCompare(String(a.Date));
  });

  return { ok: true, data: rows };
}
