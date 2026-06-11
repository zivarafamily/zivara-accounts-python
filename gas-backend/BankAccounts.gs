function getBankAccounts(payload) {
  payload = payload || {};
  return { ok: true, data: filterRowsByLLP_(getDataRows('BankAccounts'), payload) };
}

function saveBankAccount(payload) {
  if (!payload.AccountName) throw new Error('Account name is required');
  if (!payload.BankName)    throw new Error('Bank name is required');
  if (!payload.AccountNumber) throw new Error('Account number is required');

  const account = {
    AccountID:      payload.AccountID || makeId('BANK'),
    LLPID:          '',
    LLPName:        '',
    AccountName:    payload.AccountName || '',
    BankName:       payload.BankName || '',
    AccountNumber:  String(payload.AccountNumber || ''),
    IFSC:           payload.IFSC || '',
    AccountType:    payload.AccountType || 'Current',
    Branch:         payload.Branch || '',
    OpeningBalance: toNumber(payload.OpeningBalance),
    CurrentBalance: toNumber(payload.CurrentBalance || payload.OpeningBalance),
    IsActive:       normalizeYesNo(payload.IsActive, 'Yes'),
    Notes:          payload.Notes || '',
    CreatedAt:      nowISO()
  };
  fillLLPFields_(account, payload);

  appendRow('BankAccounts', account);
  return { ok: true, message: 'Bank account saved', data: account };
}

function updateBankAccount(payload) {
  if (!payload.AccountID) throw new Error('AccountID is required');

  const updateData = {
    AccountName:    payload.AccountName,
    LLPID:          payload.LLPID,
    LLPName:        payload.LLPName,
    BankName:       payload.BankName,
    AccountNumber:  payload.AccountNumber !== undefined ? String(payload.AccountNumber) : undefined,
    IFSC:           payload.IFSC,
    AccountType:    payload.AccountType,
    Branch:         payload.Branch,
    OpeningBalance: payload.OpeningBalance !== undefined ? toNumber(payload.OpeningBalance) : undefined,
    CurrentBalance: payload.CurrentBalance !== undefined ? toNumber(payload.CurrentBalance) : undefined,
    IsActive:       payload.IsActive !== undefined ? normalizeYesNo(payload.IsActive) : undefined,
    Notes:          payload.Notes,
    UpdatedAt:      nowISO()
  };

  // Remove undefined keys
  Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);

  updateRowById('BankAccounts', 'AccountID', payload.AccountID, updateData);
  return { ok: true, message: 'Bank account updated' };
}
