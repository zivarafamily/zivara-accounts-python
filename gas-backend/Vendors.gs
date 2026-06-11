// Vendors.gs – Vendor master (parties paid via expenses)
//
// Sheet: Vendors
// Columns:
//   VendorID | VendorName | Category | GSTIN | PAN | State | Notes | Status | CreatedAt

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

function getVendors() {
  return { ok: true, data: getDataRows('Vendors') };
}

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

function saveVendor(payload) {
  if (!payload.VendorName) throw new Error('VendorName is required');
  var existing = findDuplicateVendor_(payload);
  if (existing) {
    return { ok: true, duplicate: true, message: 'Vendor already exists', data: existing };
  }

  var row = {
    VendorID:   payload.VendorID   || makeId('VND'),
    VendorName: payload.VendorName.trim(),
    Category:   payload.Category   || '',
    GSTIN:      payload.GSTIN      || '',
    PAN:        payload.PAN        || payload.VendorPAN || '',
    State:      payload.State      || '',
    Notes:      payload.Notes      || '',
    Status:     payload.Status     || 'Active',
    CreatedAt:  nowISO()
  };

  appendRow('Vendors', row);
  return { ok: true, message: 'Vendor saved', data: row };
}

// ─────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────

function updateVendor(payload) {
  if (!payload.VendorID) throw new Error('VendorID is required');
  var existing = findDuplicateVendor_(payload, payload.VendorID);
  if (existing) throw new Error('Duplicate vendor already exists: ' + existing.VendorName);

  var updateData = {};
  var fields = ['VendorName', 'Category', 'GSTIN', 'PAN', 'State', 'Notes', 'Status'];
  fields.forEach(function(f) {
    if (payload[f] !== undefined) updateData[f] = payload[f];
  });

  updateRowById('Vendors', 'VendorID', payload.VendorID, updateData);
  return { ok: true, message: 'Vendor updated' };
}

// ─────────────────────────────────────────────
// SETUP — run once from Apps Script editor
// ─────────────────────────────────────────────

function setupVendorsSheet() {
  var ss   = getSS();
  var name = 'Vendors';
  if (ss.getSheetByName(name)) { Logger.log(name + ' sheet already exists.'); return; }
  var sh = ss.insertSheet(name);
  sh.appendRow(['VendorID', 'VendorName', 'Category', 'GSTIN', 'PAN', 'State', 'Notes', 'Status', 'CreatedAt']);
  sh.setFrozenRows(1);
  Logger.log(name + ' sheet created.');
}

function normalizeVendorKey_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDuplicateVendor_(payload, ignoreVendorId) {
  var name = normalizeVendorKey_(payload.VendorName);
  var gstin = normalizeVendorKey_(payload.GSTIN);
  if (!name && !gstin) return null;
  var rows = getDataRows('Vendors');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (ignoreVendorId && String(row.VendorID || '') === String(ignoreVendorId)) continue;
    var rowName = normalizeVendorKey_(row.VendorName);
    var rowGSTIN = normalizeVendorKey_(row.GSTIN);
    if (gstin && rowGSTIN && gstin === rowGSTIN) return row;
    if (name && rowName && name === rowName) return row;
  }
  return null;
}
