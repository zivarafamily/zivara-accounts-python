// SetupSheets.gs - create/update sheet tabs and headers without touching data rows.
//
// Run setupAccountsSheets() once from Apps Script after setting SPREADSHEET_ID.
// Existing data is preserved:
// - missing sheets are created
// - empty row 1 gets the full header row
// - existing header rows keep their order
// - missing header columns are appended to the right

var ACCOUNTS_SHEET_HEADERS = {
  Settings: [
    'Key', 'Value'
  ],

  Users: [
    'UserID', 'Name', 'Username', 'Role', 'AllowedModules', 'Status',
    'CreatedAt', 'UpdatedAt'
  ],

  LLPs: [
    'LLPID', 'LLPName', 'ShortCode', 'GSTIN', 'PAN', 'Address', 'Status',
    'CreatedAt'
  ],

  LLPPartners: [
    'MappingID', 'LLPID', 'Username', 'Role', 'Percentage', 'AllowedModules',
    'Status', 'CreatedAt'
  ],

  Partners: [
    'PartnerID', 'PartnerName', 'LLPName', 'Email', 'Mobile', 'Status',
    'CreatedAt'
  ],

  Vendors: [
    'VendorID', 'VendorName', 'Category', 'GSTIN', 'PAN', 'State', 'Notes',
    'Status', 'CreatedAt'
  ],

  LLPPayables: [
    'PayableID', 'LLPID', 'LLPName', 'VendorName', 'VendorCategory',
    'VendorGSTIN', 'VendorPAN', 'BillNo', 'BillDate', 'DueDate',
    'ExpenseType', 'Description', 'TaxableAmount', 'GSTAmount', 'GrossAmount',
    'TDSSection', 'TDSRate', 'TDSAmount', 'NetPayable', 'PaidAmount',
    'PaymentDate', 'PaymentMode', 'BankAccount', 'ReferenceNo', 'ChallanNo',
    'ChallanDate', 'InterestAmount', 'Status', 'Notes', 'CreatedAt',
    'UpdatedAt'
  ],

  Expenses: [
    'ExpenseID', 'LLPID', 'LLPName', 'Date', 'ExpenseType', 'Category',
    'PaidBy', 'ChargeTo', 'ReimburseTo', 'PaymentMode', 'TaxableValue',
    'CGSTAmount', 'SGSTAmount', 'IGSTAmount', 'GSTAmount', 'Amount',
    'VendorOrPerson', 'Description', 'BillAvailable', 'BillLink',
    'EmployeeName', 'BillingMonth', 'TravelID', 'VendorName', 'VendorGSTIN',
    'BillNo', 'PartnerAllocations', 'Notes', 'Status', 'ReimburseMode',
    'ReimburseAccount', 'ReimburseDate', 'ReimburseRef', 'ReimburseBy',
    'ApprovedBy', 'ApprovedAt', 'CreatedAt'
  ],

  Receipts: [
    'ReceiptID', 'LLPID', 'LLPName', 'Date', 'ReferenceType', 'ReferenceNo',
    'Month', 'AmountReceived', 'ReceiptMode', 'BankAccount', 'Notes',
    'CreatedAt'
  ],

  BankAccounts: [
    'AccountID', 'LLPID', 'LLPName', 'AccountName', 'BankName',
    'AccountNumber', 'IFSC', 'AccountType', 'Branch', 'OpeningBalance',
    'CurrentBalance', 'IsActive', 'Notes', 'CreatedAt', 'UpdatedAt'
  ],

  CashBook: [
    'EntryID', 'LLPID', 'LLPName', 'Date', 'Type', 'OpeningBalance',
    'AmountIn', 'AmountOut', 'ClosingBalance', 'ReferenceType',
    'ReferenceID', 'Description', 'PaidBy', 'CreatedAt'
  ],

  AuditLog: [
    'LogID', 'Timestamp', 'UserEmail', 'Module', 'Action', 'RefNo',
    'OldValue', 'NewValue', 'Remarks'
  ]
};

function setupAccountsSheets() {
  var ss = getSS();
  Object.keys(ACCOUNTS_SHEET_HEADERS).forEach(function(sheetName) {
    ensureSheetHeaders_(ss, sheetName, ACCOUNTS_SHEET_HEADERS[sheetName]);
  });
  Logger.log('Accounts sheets checked. Existing data rows were not modified.');
}

function ensureSheetHeaders_(ss, sheetName, requiredHeaders) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
    sh.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    sh.setFrozenRows(1);
    Logger.log('Created sheet: ' + sheetName);
    return;
  }

  var lastCol = Math.max(sh.getLastColumn(), 1);
  var currentHeaders = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var hasAnyHeader = currentHeaders.some(function(h) {
    return String(h || '').trim() !== '';
  });

  if (!hasAnyHeader) {
    sh.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    sh.setFrozenRows(1);
    Logger.log('Added headers to empty sheet: ' + sheetName);
    return;
  }

  var existing = {};
  currentHeaders.forEach(function(h) {
    var key = String(h || '').trim();
    if (key) existing[key] = true;
  });

  var missing = requiredHeaders.filter(function(h) {
    return !existing[h];
  });

  if (missing.length) {
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    Logger.log('Appended missing headers to ' + sheetName + ': ' + missing.join(', '));
  } else {
    Logger.log(sheetName + ' headers already OK.');
  }

  sh.setFrozenRows(1);
}
