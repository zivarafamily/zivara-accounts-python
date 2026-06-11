// Partners.gs – Partner and LLP master CRUD
//
// Sheet: Partners
// Columns: PartnerID | PartnerName | LLPName | Email | Mobile | Status | CreatedAt
//
// Sheet: LLPs
// Columns: LLPID | LLPName | ShortCode | GSTIN | PAN | Address | Status | CreatedAt

// ─────────────────────────────────────────────
// PARTNERS
// ─────────────────────────────────────────────

function getPartners() {
  return { ok: true, data: getDataRows('Partners') };
}

function savePartner(payload) {
  if (!payload.PartnerName) throw new Error('PartnerName is required');

  var row = {
    PartnerID:   payload.PartnerID   || makeId('PRT'),
    PartnerName: payload.PartnerName,
    LLPName:     payload.LLPName     || '',
    Email:       payload.Email       || '',
    Mobile:      payload.Mobile      || '',
    Status:      payload.Status      || 'Active',
    CreatedAt:   nowISO()
  };

  appendRow('Partners', row);
  return { ok: true, message: 'Partner saved', data: row };
}

function updatePartner(payload) {
  if (!payload.PartnerID) throw new Error('PartnerID is required');

  var updateData = {
    PartnerName: payload.PartnerName,
    LLPName:     payload.LLPName,
    Email:       payload.Email,
    Mobile:      payload.Mobile,
    Status:      payload.Status
  };

  Object.keys(updateData).forEach(function(k) {
    if (updateData[k] === undefined) delete updateData[k];
  });

  updateRowById('Partners', 'PartnerID', payload.PartnerID, updateData);
  return { ok: true, message: 'Partner updated' };
}

// Run once from Apps Script editor to create the Partners sheet.
function setupPartnersSheet() {
  var ss   = getSS();
  var name = 'Partners';
  if (ss.getSheetByName(name)) {
    Logger.log(name + ' sheet already exists — skipping.');
    return;
  }
  var sh = ss.insertSheet(name);
  sh.appendRow(['PartnerID','PartnerName','LLPName','Email','Mobile','Status','CreatedAt']);
  sh.setFrozenRows(1);
  Logger.log(name + ' sheet created.');
}

// ─────────────────────────────────────────────
// LLPs
// ─────────────────────────────────────────────

function getLLPs() {
  return { ok: true, data: getDataRows('LLPs') };
}

function saveLLP(payload) {
  if (!payload.LLPName) throw new Error('LLPName is required');

  var row = {
    LLPID:     payload.LLPID     || makeId('LLP'),
    LLPName:   payload.LLPName,
    ShortCode: payload.ShortCode || '',
    GSTIN:     payload.GSTIN     || '',
    PAN:       payload.PAN       || '',
    Address:   payload.Address   || '',
    Status:    payload.Status    || 'Active',
    CreatedAt: nowISO()
  };

  appendRow('LLPs', row);
  return { ok: true, message: 'LLP saved', data: row };
}

function updateLLP(payload) {
  if (!payload.LLPID) throw new Error('LLPID is required');

  var updateData = {
    LLPName:   payload.LLPName,
    ShortCode: payload.ShortCode,
    GSTIN:     payload.GSTIN,
    PAN:       payload.PAN,
    Address:   payload.Address,
    Status:    payload.Status
  };

  Object.keys(updateData).forEach(function(k) {
    if (updateData[k] === undefined) delete updateData[k];
  });

  updateRowById('LLPs', 'LLPID', payload.LLPID, updateData);
  return { ok: true, message: 'LLP updated' };
}

// Run once from Apps Script editor to create the LLPs sheet.
// Columns: LLPID | LLPName | ShortCode | GSTIN | PAN | Address | Status | CreatedAt
function setupLLPsSheet() {
  var ss   = getSS();
  var name = 'LLPs';
  if (ss.getSheetByName(name)) {
    Logger.log(name + ' sheet already exists — skipping.');
    return;
  }
  var sh = ss.insertSheet(name);
  sh.appendRow(['LLPID','LLPName','ShortCode','GSTIN','PAN','Address','Status','CreatedAt']);
  sh.setFrozenRows(1);
  Logger.log(name + ' sheet created.');
}

// Run once from Apps Script editor if your LLPs sheet was created before PAN/Address columns.
function migrateLLPsSheet() {
  var sh = getSS().getSheetByName('LLPs');
  if (!sh) { Logger.log('LLPs sheet not found. Run setupLLPsSheet() first.'); return; }
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(h) { return String(h || '').trim(); });
  ['PAN','Address'].forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col);
      Logger.log('Added LLPs column: ' + col);
    }
  });
}

// ─────────────────────────────────────────────
// LLP PARTNERS (user ↔ entity membership)
// Sheet: LLPPartners
// Columns: MappingID | LLPID | Username | Role | Percentage | AllowedModules | Status | CreatedAt
// ─────────────────────────────────────────────

// Returns all LLPs a given username belongs to (active mappings only, joined with LLPs sheet).
function getLLPPartners() {
  try {
    return { ok: true, data: getDataRows('LLPPartners') };
  } catch (e) {
    return { ok: true, data: [] };
  }
}

// Returns all LLPs a given username belongs to (active mappings only, joined with LLPs sheet).
function getLLPsForUser(payload) {
  payload = payload || {};
  var username = String(payload.username || '').trim();
  if (!username) return { ok: false, error: 'username is required' };

  var mappings = [];
  try { mappings = getDataRows('LLPPartners'); } catch (e) {
    // LLPPartners sheet not yet created — return empty
    return { ok: true, data: [] };
  }
  var userMappings = mappings.filter(function(p) {
    return String(p.Username || '').trim().toLowerCase() === username.toLowerCase()
        && String(p.Status || 'Active').trim().toLowerCase() === 'active';
  });

  if (!userMappings.length) return { ok: true, data: [] };

  var llps = getDataRows('LLPs');
  var llpMap = {};
  llps.forEach(function(l) { llpMap[String(l.LLPID || '')] = l; });

  var result = userMappings
    .map(function(m) {
      var llp = llpMap[String(m.LLPID || '')] || {};
      return {
        llpId:          String(m.LLPID || ''),
        llpName:        llp.LLPName   || String(m.LLPID || ''),
        shortCode:      llp.ShortCode || '',
        gstin:          llp.GSTIN     || '',
        pan:            llp.PAN       || '',
        address:        llp.Address   || '',
        status:         String(llp.Status || 'Active'),
        role:           String(m.Role || 'Partner'),
        percentage:     m.Percentage  !== undefined ? Number(m.Percentage || 0) : 0,
        allowedModules: String(m.AllowedModules || '')
      };
    })
    .filter(function(r) { return r.status !== 'Inactive'; });

  return { ok: true, data: result };
}

function saveLLPPartner(payload) {
  if (!payload.LLPID)    throw new Error('LLPID is required');
  if (!payload.Username) throw new Error('Username is required');

  // Prevent duplicate active mappings
  var existing = getDataRows('LLPPartners');
  var dupe = existing.find(function(p) {
    return String(p.LLPID    || '').trim() === String(payload.LLPID).trim()
        && String(p.Username || '').trim().toLowerCase() === String(payload.Username).trim().toLowerCase()
        && String(p.Status   || 'Active').toLowerCase() !== 'inactive';
  });
  if (dupe) throw new Error('This user is already an active partner of this LLP');

  var row = {
    MappingID:      makeId('MP'),
    LLPID:          String(payload.LLPID).trim(),
    Username:       String(payload.Username).trim(),
    Role:           payload.Role           || 'Partner',
    Percentage:     payload.Percentage     !== undefined ? Number(payload.Percentage) : 0,
    AllowedModules: payload.AllowedModules || '',
    Status:         payload.Status         || 'Active',
    CreatedAt:      nowISO()
  };

  appendRow('LLPPartners', row);
  return { ok: true, message: 'Partner added to LLP', data: row };
}

function updateLLPPartner(payload) {
  if (!payload.MappingID) throw new Error('MappingID is required');

  var updateData = {};
  if (payload.Role           !== undefined) updateData.Role           = payload.Role;
  if (payload.Percentage     !== undefined) updateData.Percentage     = Number(payload.Percentage);
  if (payload.AllowedModules !== undefined) updateData.AllowedModules = payload.AllowedModules;
  if (payload.Status         !== undefined) updateData.Status         = payload.Status;

  updateRowById('LLPPartners', 'MappingID', payload.MappingID, updateData);
  return { ok: true, message: 'LLP partner updated' };
}

// Run once from Apps Script editor to create the LLPPartners sheet.
function setupLLPPartnersSheet() {
  var ss   = getSS();
  var name = 'LLPPartners';
  if (ss.getSheetByName(name)) {
    Logger.log(name + ' sheet already exists — skipping.');
    return;
  }
  var sh = ss.insertSheet(name);
  sh.appendRow(['MappingID','LLPID','Username','Role','Percentage','AllowedModules','Status','CreatedAt']);
  sh.setFrozenRows(1);
  Logger.log(name + ' sheet created.');
}
