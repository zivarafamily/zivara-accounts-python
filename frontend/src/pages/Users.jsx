import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const MODULE_OPTIONS = [
  { key:"dashboard", label:"Dashboard" },
  { key:"paymenttracker", label:"Payables" },
  { key:"vendors", label:"Vendors" },
  { key:"expenses", label:"Expenses" },
  { key:"receipts", label:"Receipts" },
  { key:"clients", label:"Clients" },
  { key:"neoinvoices", label:"Neo Invoices" },
  { key:"neorevenue", label:"Neo Revenue" },
  { key:"reimbursements", label:"Reimbursements" },
  { key:"reconciliation", label:"Reconciliation" },
  { key:"vendorledger", label:"Vendor Ledger" },
  { key:"catdsreport", label:"CA TDS Report" },
  { key:"bankaccounts", label:"Bank Accounts" },
  { key:"cashbook", label:"Cash Book" },
  { key:"imports", label:"Import Excel" },
  { key:"llps", label:"LLPs" },
  { key:"partners", label:"Partners" },
  { key:"users", label:"Users" },
];

const ROLES = ["admin", "managing_partner", "partner", "viewer"];
const initial = {
  Name:"", Username:"", Email:"", Password:"ChangeMe123!", Role:"viewer", Status:"Active",
  LLPID:"", MemberRole:"partner", Percentage:"",
};

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const inp = { width:"100%", boxSizing:"border-box", padding:".5rem .65rem", background:"var(--input,#1e293b)", border:"1px solid var(--border)", borderRadius:"6px", color:"var(--text)", fontSize:".875rem" };
const btn = (v = "primary") => ({
  padding:".55rem 1rem", borderRadius:"6px", border:v === "ghost" ? "1px solid var(--border)" : "none",
  fontWeight:600, fontSize:".84rem", cursor:"pointer",
  background:v === "primary" ? "var(--accent)" : "transparent",
  color:v === "primary" ? "#fff" : "var(--muted)",
});

function parseModules(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
}

function ModulePicker({ selected, onChange }) {
  function toggle(key) {
    onChange(selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key]);
  }
  function selectAll() {
    onChange(MODULE_OPTIONS.map(item => item.key));
  }
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:".75rem", marginBottom:".35rem" }}>
        <label style={{ ...label, marginBottom:0 }}>Module Access</label>
        <div style={{ display:"flex", gap:".4rem" }}>
          <button type="button" style={{ ...btn("ghost"), padding:".18rem .5rem", fontSize:".7rem" }} onClick={selectAll}>All</button>
          <button type="button" style={{ ...btn("ghost"), padding:".18rem .5rem", fontSize:".7rem" }} onClick={() => onChange([])}>None</button>
        </div>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:".4rem", padding:".6rem", background:"var(--input,#1e293b)", border:"1px solid var(--border)", borderRadius:"6px" }}>
        {MODULE_OPTIONS.map(item => {
          const active = selected.includes(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item.key)}
              style={{
                padding:".2rem .55rem", borderRadius:"99px", fontSize:".72rem", fontWeight:600, cursor:"pointer",
                background:active ? "#6366f1" : "transparent",
                color:active ? "#fff" : "var(--muted)",
                border:active ? "1px solid #6366f1" : "1px solid var(--border)",
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [llps, setLlps] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [form, setForm] = useState(initial);
  const [modules, setModules] = useState(MODULE_OPTIONS.map(item => item.key));
  const [editId, setEditId] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [ur, lr, mr] = await Promise.all([apiGet("getUsers"), apiGet("getLLPs"), apiGet("getLLPPartners")]);
      if (ur.ok) setUsers(ur.data || []);
      if (lr.ok) setLlps(lr.data || []);
      if (mr.ok) setMemberships(mr.data || []);
    } catch (err) {
      setError(err.message || "Unable to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const llpMap = useMemo(() => Object.fromEntries(llps.map(llp => [llp.LLPID, llp.LLPName])), [llps]);
  const membershipsByUsername = useMemo(() => {
    const map = {};
    memberships.forEach(row => {
      const key = String(row.Username || "").toLowerCase();
      if (!key) return;
      map[key] = [...(map[key] || []), row];
    });
    return map;
  }, [memberships]);

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  function openAdd() {
    setForm({ ...initial, LLPID: llps[0]?.LLPID || "" });
    setModules(MODULE_OPTIONS.map(item => item.key));
    setEditId(null);
    setError("");
    setMessage("");
    setOpen(true);
  }

  function openEdit(user) {
    const username = String(user.Username || "").toLowerCase();
    const firstMembership = membershipsByUsername[username]?.[0];
    setForm({
      Name:user.Name || "",
      Username:user.Username || "",
      Email:user.Email || "",
      Password:"",
      Role:user.Role || "viewer",
      Status:user.Status || "Active",
      LLPID:firstMembership?.LLPID || llps[0]?.LLPID || "",
      MemberRole:firstMembership?.Role || "partner",
      Percentage:firstMembership?.Percentage != null ? String(firstMembership.Percentage) : "",
    });
    setModules(parseModules(user.AllowedModules));
    setEditId(user.UserID);
    setError("");
    setMessage("");
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        Name:form.Name,
        Username:form.Username.trim().toLowerCase(),
        Email:form.Email.trim().toLowerCase() || form.Username.trim().toLowerCase(),
        Role:form.Role,
        Status:form.Status,
        AllowedModules:modules.join(","),
      };
      if (form.Password) payload.Password = form.Password;
      const userRes = await apiPost(editId ? "updateUser" : "saveUser", editId ? { ...payload, UserID:editId } : payload);
      const userId = editId || userRes.data?.UserID;
      const username = payload.Username;

      if (form.LLPID && username) {
        const existing = memberships.find(row =>
          String(row.Username || "").toLowerCase() === username && row.LLPID === form.LLPID
        );
        const membershipPayload = {
          LLPID:form.LLPID,
          Username:username,
          Role:form.MemberRole,
          Percentage:form.Percentage,
          AllowedModules:modules.join(","),
          Status:"Active",
        };
        await apiPost(existing ? "updateLLPPartner" : "saveLLPPartner", existing ? { ...membershipPayload, MappingID:existing.MappingID } : membershipPayload);
      }

      setMessage(userId ? "User saved" : "User saved");
      setOpen(false);
      setEditId(null);
      await load();
    } catch (err) {
      setError(err.message || "Unable to save user");
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(user) {
    if (!window.confirm(`Delete user ${user.Username || user.Name}?`)) return;
    setError("");
    setMessage("");
    try {
      const r = await apiPost("deleteUser", { UserID:user.UserID });
      if (r.ok) {
        setMessage("User deleted");
        await load();
      }
    } catch (err) {
      setError(err.message || "Unable to delete user");
    }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:".75rem" }}>
        <div>
          <h2 style={{ margin:0, fontSize:"1.25rem", fontWeight:700 }}>Users</h2>
          <p style={{ margin:0, color:"var(--muted)", fontSize:".8rem" }}>Create users, assign roles, modules, and LLP access</p>
        </div>
        <button style={btn()} onClick={openAdd}>+ Add User</button>
      </div>

      {message && <div style={{ ...card, color:"var(--success)" }}>{message}</div>}
      {error && <div style={{ ...card, color:"var(--danger)", borderColor:"var(--danger)" }}>{error}</div>}

      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontWeight:700 }}>All Users</span>
          <span style={{ color:"var(--muted)", fontSize:".8rem" }}>{users.length} user{users.length === 1 ? "" : "s"}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading...</p>
          ) : users.length === 0 ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>No users yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>LLP Access</th><th>Modules</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const mods = parseModules(user.AllowedModules);
                  const memberRows = membershipsByUsername[String(user.Username || "").toLowerCase()] || [];
                  return (
                    <tr key={user.UserID}>
                      <td style={{ fontWeight:700 }}>{user.Name || "—"}</td>
                      <td style={{ fontFamily:"monospace", color:"var(--accent2)" }}>{user.Username || "—"}</td>
                      <td>{user.Email || "—"}</td>
                      <td>{user.Role || "viewer"}</td>
                      <td>{memberRows.length ? memberRows.map(row => llpMap[row.LLPID] || row.LLPID).join(", ") : "—"}</td>
                      <td style={{ maxWidth:260, color:"var(--muted)", fontSize:".76rem" }}>{mods.length ? mods.join(", ") : "—"}</td>
                      <td>
                        <span style={{ fontSize:".72rem", fontWeight:700, padding:".15rem .5rem", borderRadius:"99px",
                          background:user.Status === "Active" ? "#22c55e22" : "#6b728022",
                          color:user.Status === "Active" ? "#22c55e" : "#94a3b8" }}>
                          {user.Status || "Active"}
                        </span>
                      </td>
                      <td style={{ whiteSpace:"nowrap" }}>
                        <button style={{ ...btn("ghost"), padding:".3rem .65rem" }} onClick={() => openEdit(user)}>Edit</button>
                        {" "}
                        <button style={{ ...btn("ghost"), padding:".3rem .65rem", color:"var(--danger)" }} onClick={() => removeUser(user)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {open && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)", zIndex:100, padding:"1.5rem 1rem", overflowY:"auto" }}>
          <div style={{ ...card, maxWidth:720, margin:"0 auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
              <h3 style={{ margin:0, fontSize:"1rem", fontWeight:700 }}>{editId ? "Edit User" : "Add User"}</h3>
              <button style={btn("ghost")} onClick={() => setOpen(false)}>Close</button>
            </div>
            <form onSubmit={save} style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:".85rem" }}>
                <div><label style={label}>Name</label><input style={inp} value={form.Name} onChange={e => set("Name", e.target.value)} /></div>
                <div><label style={label}>Username *</label><input style={inp} value={form.Username} onChange={e => set("Username", e.target.value.toLowerCase())} required disabled={!!editId} /></div>
                <div><label style={label}>Email</label><input type="email" style={inp} value={form.Email} onChange={e => set("Email", e.target.value)} /></div>
                <div><label style={label}>{editId ? "New Password" : "Password *"}</label><input type="password" style={inp} value={form.Password} onChange={e => set("Password", e.target.value)} required={!editId} /></div>
                <div><label style={label}>App Role</label><select style={inp} value={form.Role} onChange={e => set("Role", e.target.value)}>{ROLES.map(role => <option key={role}>{role}</option>)}</select></div>
                <div><label style={label}>Status</label><select style={inp} value={form.Status} onChange={e => set("Status", e.target.value)}><option>Active</option><option>Inactive</option></select></div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:".85rem" }}>
                <div><label style={label}>LLP Access</label><select style={inp} value={form.LLPID} onChange={e => set("LLPID", e.target.value)}><option value="">No LLP assignment</option>{llps.map(llp => <option key={llp.LLPID} value={llp.LLPID}>{llp.LLPName}</option>)}</select></div>
                <div><label style={label}>LLP Role</label><select style={inp} value={form.MemberRole} onChange={e => set("MemberRole", e.target.value)}><option>admin</option><option>managing_partner</option><option>partner</option><option>viewer</option></select></div>
                <div><label style={label}>Ownership %</label><input style={inp} type="number" min="0" max="100" step="0.01" value={form.Percentage} onChange={e => set("Percentage", e.target.value)} /></div>
              </div>

              <ModulePicker selected={modules} onChange={setModules} />

              <div style={{ display:"flex", justifyContent:"flex-end", gap:".75rem", flexWrap:"wrap" }}>
                <button type="button" style={btn("ghost")} onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" style={btn()} disabled={saving}>{saving ? "Saving..." : "Save User"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
