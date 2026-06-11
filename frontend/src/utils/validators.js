// utils/validators.js – Frontend validation helpers (backend also validates)

export function validateGSTIN(gstin) {
  if (!gstin) return null; // optional
  if (gstin.length !== 15) return 'GSTIN must be exactly 15 characters';
  const pattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!pattern.test(gstin)) return 'Invalid GSTIN format';
  return null;
}

export function validateHSN(hsn) {
  if (!hsn) return null;
  if (!/^\d{4,8}$/.test(hsn)) return 'HSN/SAC must be 4–8 digits';
  return null;
}

export function validateRequired(value, fieldName) {
  if (!value || String(value).trim() === '') return `${fieldName} is required`;
  return null;
}

export function validateMobile(mobile) {
  if (!mobile) return null;
  if (!/^[6-9]\d{9}$/.test(mobile)) return 'Enter a valid 10-digit Indian mobile number';
  return null;
}

export function validateEmail(email) {
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
  return null;
}

// Returns an object of { field: errorMessage } for a customer payload
export function validateCustomer(data) {
  const errors = {};
  const name = validateRequired(data.CustomerName, 'Customer Name');
  if (name) errors.CustomerName = name;
  const gstin = validateGSTIN(data.GSTIN);
  if (gstin) errors.GSTIN = gstin;
  const mobile = validateMobile(data.Mobile);
  if (mobile) errors.Mobile = mobile;
  const email = validateEmail(data.Email);
  if (email) errors.Email = email;
  return errors;
}

export function validateItem(data) {
  const errors = {};
  const name = validateRequired(data.ItemName, 'Item Name');
  if (name) errors.ItemName = name;
  const hsn = validateHSN(data.HSN_SAC);
  if (hsn) errors.HSN_SAC = hsn;
  return errors;
}
