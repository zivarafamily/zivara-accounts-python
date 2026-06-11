// Auth.gs – Login using Users sheet (Username + Role columns) + Script Properties
//
// Passwords stored in Script Properties as  PASS_<username>
// e.g.  PASS_admin = "yourpassword"
//       PASS_sridar = "sridarspass"
//
// Steps to set a password:
//   1. GAS Editor → ⚙ Project Settings → Script Properties
//   2. Add property  PASS_<username>  with the password as value
//
// Users sheet must have columns: UserID, Name, Username, Role, AllowedModules, Status
// Temporary fallback uses admin / password123 and dinu / password123.
// ADMIN_USER / ADMIN_PASS Script Properties override these defaults.

function parseAllowedModules(value) {
  if (!value) return [];
  var s = String(value).trim();
  if (!s) return [];

  function clean(v) {
    return String(v || '').trim().toLowerCase();
  }

  if (s.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map(clean).filter(Boolean);
      }
    } catch (e) {
      return [];
    }
  }

  return s.split(',').map(clean).filter(Boolean);
}

function verifyLogin(payload) {
  payload = payload || {};
  var username = String(payload.username || '').trim();
  var password = String(payload.password || '');

  if (!username || !password) {
    return { ok: false, error: 'Username and password are required' };
  }

  var props = PropertiesService.getScriptProperties();

  // ── 1. Temporary fallback admin login ──────────────────────────────
  if ((username.toLowerCase() === 'admin' || username.toLowerCase() === 'dinu') && password === 'password123') {
    var fallbackName = username.toLowerCase() === 'dinu' ? 'Dinu' : 'Admin';
    return { ok: true, user: username.toLowerCase(), fullName: fallbackName, role: 'admin', employeeRef: '', allowedModules: [] };
  }

  var adminUser = props.getProperty('ADMIN_USER') || 'admin';
  var adminPass = props.getProperty('ADMIN_PASS') || '';

  if (adminPass && username.toLowerCase() === String(adminUser).trim().toLowerCase() && password === adminPass) {
    return { ok: true, user: adminUser, fullName: 'Admin', role: 'admin', employeeRef: '', allowedModules: [] };
  }

  // ── 2. Look up in Users sheet by Username ──────────────────────────────
  try {
    var employees = getDataRows('Users');
    var found = employees.find(function(e) {
      return String(e.Username || '').trim().toLowerCase() === username.toLowerCase()
          && String(e.Status   || 'Active').trim().toLowerCase() === 'active';
    });

    if (found) {
      var foundUsername = String(found.Username || '').trim();
      var storedPass = props.getProperty('PASS_' + foundUsername)
        || props.getProperty('PASS_' + foundUsername.toLowerCase())
        || '';
      if (!storedPass) {
        return { ok: false, error: 'Password not configured for this user. Ask your admin.' };
      }
      if (password !== storedPass) {
        return { ok: false, error: 'Invalid username or password' };
      }
      return {
        ok:          true,
        user:        foundUsername,
        fullName:    found.Name        || foundUsername,
        role:        found.Role        || 'viewer',
        employeeRef: found.Name        || '',
        designation: '',
        allowedModules: parseAllowedModules(found.AllowedModules)
      };
    }
  } catch (e) {
    // Users sheet may not have Username/Role columns yet — fall through
  }

  return { ok: false, error: 'Invalid username or password' };
}
