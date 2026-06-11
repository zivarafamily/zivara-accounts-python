// Utils.gs – Sheet access helpers, validators, audit logging

var SPREADSHEET_ID = '1AqLiO_vDvFrcA9dxeSxW-Lbj2Ph3oyriBaDqejIwsl8';

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  var sh = getSS().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

// Returns all rows as array of objects keyed by header row
function sheetToObjects(sheetName) {
  var sh = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      obj[h] = normalizeSheetCellForJson_(h, row[i]);
    });
    return obj;
  });
}

function normalizeSheetCellForJson_(header, value) {
  if (!(value instanceof Date)) return value;

  var h = String(header || '');
  // Month columns stored as date serials - return "MMM-YYYY" string.
  if (h === 'Month' || h === 'BillingMonth') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'MMM-yyyy');
  }
  if (h === 'Date' || /Date$/.test(h)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return value.toISOString();
}

// Appends a row — accepts either an ordered array or a key-value object.
// When passed an object the values are mapped to sheet column headers.
function appendRow(sheetName, values) {
  var sh = getSheet(sheetName);
  if (Array.isArray(values)) {
    sh.appendRow(values);
  } else {
    var headers = sh.getDataRange().getValues()[0] || [];
    var row = headers.map(function(h) {
      var v = values[h];
      return v !== undefined ? v : '';
    });
    sh.appendRow(row);
  }
}

// Updates a row — two call signatures supported:
//   Old: updateRowById(sheetName, idValue, updatedValuesArray)   — matches first column
//   New: updateRowById(sheetName, idField, idValue, updateDataObj) — matches named column, partial update
function updateRowById(sheetName, idFieldOrValue, idValueOrUpdated, updateDataOrUndefined) {
  var sh = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  var headers = data[0];

  if (updateDataOrUndefined !== undefined) {
    // New 4-param signature
    var idField = idFieldOrValue;
    var idValue = idValueOrUpdated;
    var updateData = updateDataOrUndefined;
    var idColIdx = headers.indexOf(idField);
    if (idColIdx === -1) throw new Error('ID field not found in sheet ' + sheetName + ': ' + idField);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idColIdx]) === String(idValue)) {
        Object.keys(updateData).forEach(function(key) {
          if (updateData[key] !== undefined) {
            var colIdx = headers.indexOf(key);
            if (colIdx !== -1) sh.getRange(i + 1, colIdx + 1).setValue(updateData[key]);
          }
        });
        return true;
      }
    }
    return false;
  } else {
    // Old 3-param signature — match first column, replace full row
    var idVal = idFieldOrValue;
    var updatedValues = idValueOrUpdated;
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]) === String(idVal)) {
        sh.getRange(j + 1, 1, 1, updatedValues.length).setValues([updatedValues]);
        return true;
      }
    }
    return false;
  }
}

// ---------------------
// ID generators
// ---------------------
function generateId(prefix) {
  return prefix + '_' + new Date().getTime();
}

// Alias used by newer modules
function makeId(prefix) {
  return generateId(prefix);
}

// ---------------------
// Common helpers used by newer modules
// ---------------------
function toNumber(val) {
  var n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeYesNo(val, defaultVal) {
  if (val === undefined || val === null || val === '') return defaultVal || 'No';
  var s = String(val).trim().toLowerCase();
  if (s === 'yes' || s === 'true' || s === '1') return 'Yes';
  if (s === 'no'  || s === 'false' || s === '0') return 'No';
  return defaultVal || 'No';
}

// Alias used by newer modules (same as sheetToObjects)
function getDataRows(sheetName) {
  return sheetToObjects(sheetName);
}

function getAccountsLLP_(llpId) {
  if (!llpId) return null;
  var id = String(llpId).trim();
  if (!id) return null;
  try {
    var rows = getDataRows('LLPs');
    return rows.filter(function(l) {
      return String(l.LLPID || '').trim() === id;
    })[0] || null;
  } catch (e) {
    return null;
  }
}

function fillLLPFields_(target, payload) {
  payload = payload || {};
  var llp = getAccountsLLP_(payload.LLPID || payload.llpId);
  target.LLPID = llp ? (llp.LLPID || '') : (payload.LLPID || payload.llpId || '');
  target.LLPName = llp ? (llp.LLPName || '') : (payload.LLPName || '');
  return target;
}

function filterRowsByLLP_(rows, payload) {
  payload = payload || {};
  var llp = getAccountsLLP_(payload.llpId || payload.LLPID);
  if (!llp) return rows;
  var id = String(llp.LLPID || '').trim();
  var name = String(llp.LLPName || '').trim().toLowerCase();
  return rows.filter(function(r) {
    return String(r.LLPID || '').trim() === id ||
      String(r.LLPName || '').trim().toLowerCase() === name;
  });
}

// Deletes the first row where idField === idValue
function deleteRowById(sheetName, idField, idValue) {
  var sh = getSheet(sheetName);
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idColIdx = headers.indexOf(idField);
  if (idColIdx === -1) throw new Error('ID field not found: ' + idField);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idColIdx]) === String(idValue)) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  throw new Error('Record not found: ' + idValue);
}

// ---------------------
// Validators
// ---------------------
function validateGSTIN(gstin) {
  if (!gstin) return true; // optional in some cases
  if (gstin.length !== 15) throw new Error('GSTIN must be exactly 15 characters: ' + gstin);
  return true;
}

function validateHSN(hsn) {
  if (!hsn) return true;
  if (hsn.length < 4 || hsn.length > 8) throw new Error('HSN/SAC must be 4–8 digits: ' + hsn);
  return true;
}

// ---------------------
// Tax calculation helpers
// ---------------------
function calcGST(taxableValue, gstPercent, isInterState) {
  var total = taxableValue * gstPercent / 100;
  if (isInterState) {
    return { CGST: 0, SGST: 0, IGST: total };
  }
  var half = total / 2;
  return { CGST: half, SGST: half, IGST: 0 };
}

// ---------------------
// Audit log
// ---------------------
function writeAuditLog(userEmail, module, action, refNo, oldVal, newVal, remarks) {
  appendRow('AuditLog', [
    generateId('LOG'),
    new Date().toISOString(),
    userEmail || 'system',
    module,
    action,
    refNo || '',
    oldVal || '',
    newVal || '',
    remarks || ''
  ]);
}

// ---------------------
// Settings helpers
// ---------------------
function getSettings() {
  var rows = sheetToObjects('Settings');
  var result = {};
  rows.forEach(function(r) { result[r.Key] = r.Value; });
  return { ok: true, data: result };
}

function saveSettings(payload) {
  var sh = getSheet('Settings');
  var data = sh.getDataRange().getValues();
  Object.keys(payload).forEach(function(key) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sh.getRange(i + 1, 2).setValue(payload[key]);
        found = true;
        break;
      }
    }
    if (!found) sh.appendRow([key, payload[key]]);
  });
  return { ok: true };
}
