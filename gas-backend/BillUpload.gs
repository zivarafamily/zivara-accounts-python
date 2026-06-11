// BillUpload.gs – Upload internal expense bills to Google Drive
//
// Folder structure in Drive:
//   Zivara Bills/
//     {LLP e.g. "Zivara LLP"}/          ← skipped if LLP not provided
//       {Partner e.g. "Sridar"}/        ← skipped if Partner not provided
//         {BillingMonth e.g. "Apr-2026"}/
//           {EmployeeName}_{FileName}
//
// The main folder is created once and can be shared manually with staff.

var BILLS_FOLDER_NAME = 'Zivara Bills';

// Helper: find a named sub-folder inside a parent folder.
// Throws if the folder does not exist — folders must be created manually in Drive.
function getSubFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  if (!folders.hasNext()) throw new Error('Drive folder not found: "' + name + '". Please create it manually inside "' + parent.getName() + '".');
  return folders.next();
}

/**
 * uploadBill(payload)
 *
 * payload {
 *   base64      : string   – base64-encoded file content
 *   mimeType    : string   – e.g. "image/jpeg", "application/pdf"
 *   fileName    : string   – original file name
 *   ExpenseID   : string   – (optional) link back to Expense row
 *   LLP         : string   – (optional) LLP folder name, e.g. "Zivara LLP"
 *   Partner     : string   – (optional) Partner folder name, e.g. "Sridar"
 *   BillingMonth: string   – e.g. "Apr-2026" (used as sub-folder name)
 *   EmployeeName: string   – prefixed to file name for easy identification
 * }
 *
 * Returns { ok, url, fileId, message }
 */
function uploadBill(payload) {
  if (!payload.base64)   throw new Error('No file data received');
  if (!payload.fileName) throw new Error('File name is required');

  // 1. Find root "Zivara Bills" folder (must exist — create it manually in Drive)
  var rootFolders = DriveApp.getFoldersByName(BILLS_FOLDER_NAME);
  if (!rootFolders.hasNext()) throw new Error('Drive folder not found: "' + BILLS_FOLDER_NAME + '". Please create it manually in Google Drive.');
  var root = rootFolders.next();

  // 2. Optional LLP sub-folder (must exist if provided)
  var llpName = payload.LLP ? String(payload.LLP).trim() : '';
  var llpFolder = llpName ? getSubFolder_(root, llpName) : root;

  // 3. Optional Partner sub-folder (must exist if provided)
  var partnerName = payload.Partner ? String(payload.Partner).trim() : '';
  var partnerFolder = partnerName ? getSubFolder_(llpFolder, partnerName) : llpFolder;

  // 4. BillingMonth sub-folder (must exist)
  var subName = payload.BillingMonth
    ? String(payload.BillingMonth)
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM-yyyy');
  var sub = getSubFolder_(partnerFolder, subName);

  // 6. Build file name: "{EmployeeName}_{originalName}" for easy identification
  var prefix    = payload.EmployeeName ? payload.EmployeeName.replace(/\s+/g, '_') + '_' : '';
  var safeName  = prefix + payload.fileName;

  // 7. Decode and create file
  var bytes = Utilities.base64Decode(payload.base64);
  var blob  = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', safeName);
  var file  = sub.createFile(blob);

  // 8. Try to make it viewable by anyone with link (read-only).
  // Some Google Workspace domains block public link sharing and DriveApp
  // reports that as the unhelpful "Service error: Drive". Do not fail the
  // upload after the file has already been created.
  var sharingWarning = '';
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingErr) {
    sharingWarning = sharingErr && sharingErr.message ? sharingErr.message : String(sharingErr);
    Logger.log('[Bill upload sharing warning] ' + sharingWarning);
  }

  var url    = file.getUrl();
  var fileId = file.getId();

  // 9. Write the Drive URL back to the source record
  if (payload.ExpenseID) {
    updateRowById('Expenses', 'ExpenseID', payload.ExpenseID, {
      BillLink:      url,
      BillAvailable: 'Yes'
    });
  }

  return {
    ok: true,
    url: url,
    fileId: fileId,
    message: sharingWarning
      ? 'Bill uploaded to Drive, but public link sharing was not enabled. Share the Zivara Bills folder with required users from settings.'
      : 'Bill uploaded to Drive',
    sharingWarning: sharingWarning
  };
}

/**
 * getBillsFolderInfo()
 * Returns the URL, ID and current viewers/editors of the "Zivara Bills" folder.
 */
function getBillsFolderInfo() {
  var folders = DriveApp.getFoldersByName(BILLS_FOLDER_NAME);
  if (!folders.hasNext()) throw new Error('Drive folder not found: "' + BILLS_FOLDER_NAME + '". Please create it manually in Google Drive.');
  var folder  = folders.next();

  var viewers = folder.getViewers().map(function(u) {
    return { email: u.getEmail(), name: u.getName(), role: 'viewer' };
  });
  var editors = folder.getEditors().map(function(u) {
    return { email: u.getEmail(), name: u.getName(), role: 'editor' };
  });

  return {
    ok:      true,
    url:     folder.getUrl(),
    id:      folder.getId(),
    name:    folder.getName(),
    users:   viewers.concat(editors)
  };
}

/**
 * shareBillsFolder(payload)
 * payload { email: string, role: 'viewer' | 'editor' }
 * Adds the given Google account to the Zivara Bills folder.
 */
function shareBillsFolder(payload) {
  if (!payload.email) throw new Error('Email is required');
  var role = (payload.role || 'viewer').toLowerCase();

  var folders = DriveApp.getFoldersByName(BILLS_FOLDER_NAME);
  if (!folders.hasNext()) throw new Error('Drive folder not found: "' + BILLS_FOLDER_NAME + '". Please create it manually in Google Drive.');
  var folder  = folders.next();

  if (role === 'editor') {
    folder.addEditor(payload.email);
  } else {
    folder.addViewer(payload.email);
  }

  return { ok: true, message: payload.email + ' added as ' + role };
}

/**
 * removeBillsFolderAccess(payload)
 * payload { email: string }
 * Removes the user from both viewers and editors.
 */
function removeBillsFolderAccess(payload) {
  if (!payload.email) throw new Error('Email is required');

  var folders = DriveApp.getFoldersByName(BILLS_FOLDER_NAME);
  if (!folders.hasNext()) return { ok: true, message: 'Folder not found, nothing to remove' };
  var folder = folders.next();

  folder.removeViewer(payload.email);
  folder.removeEditor(payload.email);

  return { ok: true, message: payload.email + ' access removed' };
}

