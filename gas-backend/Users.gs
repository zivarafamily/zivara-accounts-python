// Users.gs - login users and module access
//
// Sheet: Users
// Columns: UserID | Name | Username | Role | AllowedModules | Status | CreatedAt | UpdatedAt
//
// Passwords are stored in Script Properties, not in the sheet:
//   PASS_<username> = password

function getUsers() {
  return { ok: true, data: getDataRows('Users') };
}

function saveUser(payload) {
  payload = payload || {};
  if (!payload.Username) throw new Error('Username is required');

  var username = String(payload.Username).trim();
  var existing = getDataRows('Users');
  if (existing.find(function(r) { return String(r.Username || '').trim().toLowerCase() === username.toLowerCase(); })) {
    throw new Error('Username already exists: ' + username);
  }

  if (payload.Password) {
    PropertiesService.getScriptProperties()
      .setProperty('PASS_' + username, payload.Password);
    PropertiesService.getScriptProperties()
      .setProperty('PASS_' + username.toLowerCase(), payload.Password);
  }

  var user = {
    UserID:         payload.UserID || makeId('USR'),
    Name:           payload.Name || username,
    Username:       username,
    Role:           payload.Role || 'viewer',
    AllowedModules: payload.AllowedModules || '',
    Status:         payload.Status || 'Active',
    CreatedAt:      nowISO()
  };

  appendRow('Users', user);
  return { ok: true, message: 'User saved', data: user };
}

function updateUser(payload) {
  payload = payload || {};
  var userId = payload.UserID;
  if (!userId) throw new Error('UserID is required');

  if (payload.Username && payload.Password) {
    var username = String(payload.Username).trim();
    PropertiesService.getScriptProperties()
      .setProperty('PASS_' + username, payload.Password);
    PropertiesService.getScriptProperties()
      .setProperty('PASS_' + username.toLowerCase(), payload.Password);
  }

  var updateData = {
    Name:           payload.Name,
    Username:       payload.Username !== undefined ? String(payload.Username).trim() : undefined,
    Role:           payload.Role,
    AllowedModules: payload.AllowedModules,
    Status:         payload.Status,
    UpdatedAt:      nowISO()
  };

  Object.keys(updateData).forEach(function(k) {
    if (updateData[k] === undefined) delete updateData[k];
  });

  updateRowById('Users', 'UserID', userId, updateData);
  return { ok: true, message: 'User updated' };
}
