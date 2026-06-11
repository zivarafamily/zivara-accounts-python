// Code.gs - Zivara Accounts backend entrypoint

function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : '';

    switch (action) {
      case 'ping':
        return jsonOut({
          ok: true,
          message: 'Zivara Accounts backend connected to accounts sheet',
          timestamp: new Date().toISOString()
        });

      case 'getUsers':
        return jsonOut(getUsers());

      case 'getLLPs':
        return jsonOut(getLLPs());

      case 'getLLPsForUser':
        return jsonOut(getLLPsForUser(e.parameter || {}));

      case 'getLLPPartners':
        return jsonOut(getLLPPartners());

      case 'getPartners':
        return jsonOut(getPartners());

      case 'getVendors':
        return jsonOut(getVendors());

      case 'getLLPPayables':
        return jsonOut(getLLPPayables(e.parameter || {}));

      case 'getExpenses':
        return jsonOut(getExpenses(e.parameter || {}));

      case 'getReceipts':
        return jsonOut(getReceipts(e.parameter || {}));

      case 'getBankAccounts':
        return jsonOut(getBankAccounts(e.parameter || {}));

      case 'getCashBook':
        return jsonOut(getCashBook(e.parameter || {}));

      case 'getCashBalance':
        return jsonOut({ ok: true, balance: getLatestCashClosingBalance(e.parameter || {}) });

      case 'getAccountsDashboard':
        return jsonOut(getAccountsDashboard(e.parameter || {}));

      case 'getGSTTDSReport':
        return jsonOut(getGSTTDSReport(e.parameter || {}));

      case 'getCATDSReport':
        return jsonOut(getCATDSReport(e.parameter || {}));

      case 'getVendorLedger':
        return jsonOut(getVendorLedger(e.parameter || {}));

      case 'getReimbursementReport':
        return jsonOut(getReimbursementReport(e.parameter || {}));

      default:
        return jsonOut({ ok: false, error: 'Invalid action' });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var action = body.action;
    var payload = body.payload || {};

    switch (action) {
      case 'login':
        return jsonOut(verifyLogin(payload));

      case 'saveUser':
        return jsonOut(saveUser(payload));

      case 'updateUser':
        return jsonOut(updateUser(payload));

      case 'saveLLP':
        return jsonOut(saveLLP(payload));

      case 'updateLLP':
        return jsonOut(updateLLP(payload));

      case 'saveLLPPartner':
        return jsonOut(saveLLPPartner(payload));

      case 'updateLLPPartner':
        return jsonOut(updateLLPPartner(payload));

      case 'savePartner':
        return jsonOut(savePartner(payload));

      case 'updatePartner':
        return jsonOut(updatePartner(payload));

      case 'saveVendor':
        return jsonOut(saveVendor(payload));

      case 'updateVendor':
        return jsonOut(updateVendor(payload));

      case 'saveLLPPayable':
        return jsonOut(saveLLPPayable(payload));

      case 'updateLLPPayable':
        return jsonOut(updateLLPPayable(payload));

      case 'markLLPPayablePaid':
        return jsonOut(markLLPPayablePaid(payload));

      case 'saveExpense':
        return jsonOut(saveExpense(payload));

      case 'updateExpense':
        return jsonOut(updateExpense(payload));

      case 'deleteExpense':
        return jsonOut(deleteExpense(payload));

      case 'approveExpense':
        return jsonOut(approveExpense(payload));

      case 'reimburseExpense':
        return jsonOut(reimburseExpense(payload));

      case 'saveReceipt':
        return jsonOut(saveReceipt(payload));

      case 'updateReceipt':
        return jsonOut(updateReceipt(payload));

      case 'deleteReceipt':
        return jsonOut(deleteReceipt(payload));

      case 'saveBankAccount':
        return jsonOut(saveBankAccount(payload));

      case 'updateBankAccount':
        return jsonOut(updateBankAccount(payload));

      case 'saveCashEntry':
        return jsonOut(saveCashEntry(payload));

      case 'updateCashEntry':
        return jsonOut(updateCashEntry(payload));

      case 'deleteCashEntry':
        return jsonOut(deleteCashEntry(payload));

      case 'uploadBill':
        return jsonOut(uploadBill(payload));

      case 'parseInvoiceWithAI':
        return jsonOut(parseInvoiceWithAI(payload));

      case 'getBillsFolderInfo':
        return jsonOut(getBillsFolderInfo());

      case 'shareBillsFolder':
        return jsonOut(shareBillsFolder(payload));

      case 'removeBillsFolderAccess':
        return jsonOut(removeBillsFolderAccess(payload));

      default:
        return jsonOut({ ok: false, error: 'Invalid action' });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
