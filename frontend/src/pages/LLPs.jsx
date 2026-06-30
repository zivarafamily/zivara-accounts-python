import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const MODULE_OPTIONS = [
  { key:"dashboard",        label:"Dashboard" },
  { key:"paymenttracker",   label:"Payables / Payment Tracker" },
  { key:"vendors",          label:"Vendors" },
  { key:"expenses",         label:"Expenses" },
  { key:"receipts",         label:"Receipts" },
  { key:"reconciliation",   label:"Reconciliation" },
  { key:"reimbursements",   label:"Reimbursements" },
  { key:"bankaccounts",     label:"Bank Accounts" },
  { key:"cashbook",         label:"Cash Book" },
  { key:"llps",             label:"LLPs" },
  { key:"partners",         label:"Partners" },
];

const ROLES = ["Managing Partner","Partner","rm","viewer"];

const card  = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const inp   = { width:"100%", boxSizing:"border-box", padding:".5rem .65rem", background:"var(--input,#1e293b)", border:"1px solid var(--border)", borderRadius:"6px", color:"var(--text)", fontSize:".875rem" };
const btn   = (v = "primary") => ({
  padding:".55rem 1.2rem", borderRadius:"6px",
  border: v === "outline" ? "1px solid var(--border)" : "none",
  fontWeight:600, fontSize:".875rem", cursor:"pointer",
  background: v === "primary" ? "var(--accent)" : "transparent",
  color: v === "primary" ? "#fff" : "var(--muted)",
});

// ── LLP master section ────────────────────────────────────────────────────
const llpInitial = { LLPName:"", ShortCode:"", GSTIN:"", PAN:"", Address:"", Status:"Active" };

function LLPsSection({ llps, onRefresh }) {
  const [form,     setForm]     = useState(llpInitial);
  const [saving,   setSaving]   = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId,   setEditId]   = useState(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd()  { setForm(llpInitial); setEditId(null); setFormOpen(true); }
  function openEdit(row) {
    setForm({
      LLPName: row.LLPName||"",
      ShortCode: row.ShortCode||"",
      GSTIN: row.GSTIN||"",
      PAN: row.PAN||"",
      Address: row.Address||"",
      Status: row.Status||"Active",
    });
    setEditId(row.LLPID);
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const action  = editId ? "updateLLP" : "saveLLP";
      const payload = editId ? { ...form, LLPID: editId } : form;
      const r = await apiPost(action, payload);
      if (r.ok) { setFormOpen(false); setEditId(null); setForm(llpInitial); onRefresh(); }
      else alert(r.error || "Error saving");
    } catch (err) {
      alert(err.message || "Error saving LLP");
    } finally { setSaving(false); }
  }

  async function removeLLP(row) {
    if (!window.confirm(`Delete LLP ${row.LLPName}?`)) return;
    try {
      const r = await apiPost("deleteLLP", { LLPID:row.LLPID });
      if (r.ok) onRefresh();
    } catch (err) {
      alert(err.message || "Unable to delete LLP");
    }
  }

  const active = llps.filter(r => r.Status !== "Inactive");

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:".75rem" }}>
        <div>
          <h2 style={{ margin:0, fontSize:"1.2rem", fontWeight:700 }}>LLPs</h2>
          <p style={{ margin:0, fontSize:".8rem", color:"var(--muted)" }}>
            LLP master &nbsp;·&nbsp; {llps.length} total, {active.length} active
          </p>
        </div>
        <button style={btn("primary")} onClick={openAdd}>+ Add LLP</button>
      </div>

      {formOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:100, overflowY:"auto", padding:"1.5rem 1rem" }}>
          <div style={{ maxWidth:"440px", margin:"0 auto", background:"var(--card)", borderRadius:"var(--radius)", padding:"1.5rem", border:"1px solid var(--border)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <h3 style={{ margin:0, fontSize:"1rem", fontWeight:700 }}>{editId ? "Edit LLP" : "Add LLP"}</h3>
              <button style={btn("ghost")} onClick={() => setFormOpen(false)}>✕</button>
            </div>
            <form onSubmit={save} style={{ display:"flex", flexDirection:"column", gap:".85rem" }}>
              <div>
                <label style={label}>LLP Name <span style={{ color:"var(--accent)" }}>*</span></label>
                <input style={inp} value={form.LLPName} onChange={e => set("LLPName", e.target.value)} required />
              </div>
              <div>
                <label style={label}>Short Code</label>
                <input style={inp} value={form.ShortCode} onChange={e => set("ShortCode", e.target.value.toUpperCase())}
                  placeholder="e.g. ZIV, KKG, SRK" maxLength={10} />
              </div>
              <div>
                <label style={label}>GSTIN</label>
                <input style={inp} value={form.GSTIN} onChange={e => set("GSTIN", e.target.value.toUpperCase())}
                  placeholder="e.g. 27AABCS1429B1ZB" maxLength={15} />
              </div>
              <div>
                <label style={label}>PAN</label>
                <input style={inp} value={form.PAN} onChange={e => set("PAN", e.target.value.toUpperCase())}
                  placeholder="e.g. AABCS1429B" maxLength={10} />
              </div>
              <div>
                <label style={label}>Registered Address</label>
                <textarea rows={3} style={{ ...inp, resize:"vertical" }} value={form.Address}
                  onChange={e => set("Address", e.target.value)}
                  placeholder="Registered office address for invoices" />
              </div>
              <div>
                <label style={label}>Status</label>
                <select style={inp} value={form.Status} onChange={e => set("Status", e.target.value)}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
              <div style={{ display:"flex", gap:".75rem", justifyContent:"flex-end", paddingTop:".25rem" }}>
                <button type="button" style={btn("ghost")} onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" style={btn("primary")} disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={card}>
        {llps.length === 0 ? (
          <p style={{ color:"var(--muted)", textAlign:"center", padding:"2rem 0" }}>No LLPs yet.</p>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".83rem" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["LLP Name","Short Code","GSTIN","PAN","Address","Status",""].map(h =>
                    <th key={h} style={{ padding:".5rem .65rem", textAlign:"left", color:"var(--muted)", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {llps.map(row => (
                  <tr key={row.LLPID} style={{ borderBottom:"1px solid var(--border)" }}>
                    <td style={{ padding:".5rem .65rem", fontWeight:600 }}>{row.LLPName||"—"}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", fontFamily:"monospace", fontSize:".8rem" }}>{row.ShortCode||"—"}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", fontFamily:"monospace", fontSize:".8rem" }}>{row.GSTIN||"—"}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", fontFamily:"monospace", fontSize:".8rem" }}>{row.PAN||"—"}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", maxWidth:260 }}>{row.Address||"—"}</td>
                    <td style={{ padding:".5rem .65rem" }}>
                      <span style={{ fontSize:".72rem", fontWeight:700, padding:".15rem .5rem", borderRadius:"99px",
                        background: row.Status==="Active" ? "#22c55e22" : "#6b728022",
                        color:      row.Status==="Active" ? "#22c55e"   : "#94a3b8" }}>
                        {row.Status||"Active"}
                      </span>
                    </td>
                    <td style={{ padding:".5rem .4rem" }}>
                      <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem" }} onClick={() => openEdit(row)}>Edit</button>
                      {" "}
                      <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem", color:"var(--danger)" }} onClick={() => removeLLP(row)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── LLP Memberships section ───────────────────────────────────────────────
const mpInitial = { LLPID:"", Username:"", Role:"Partner", Percentage:"", AllowedModules:"", Status:"Active" };

function MembershipsSection({ llps, users }) {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [form,     setForm]     = useState(mpInitial);
  const [saving,   setSaving]   = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [filterLLP, setFilterLLP] = useState("");

  const [selMods, setSelMods] = useState([]);

  async function load() {
    setLoading(true);
    try {
      const r = await apiGet("getLLPPartners");
      if (r.ok) setRows(r.data || []);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd() {
    setForm(mpInitial); setSelMods([]); setEditId(null); setFormOpen(true);
  }
  function openEdit(row) {
    const mods = row.AllowedModules ? row.AllowedModules.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    setSelMods(mods);
    setForm({
      LLPID:          row.LLPID          || "",
      Username:       row.Username       || "",
      Role:           row.Role           || "Partner",
      Percentage:     row.Percentage != null ? String(row.Percentage) : "",
      AllowedModules: row.AllowedModules || "",
      Status:         row.Status         || "Active",
    });
    setEditId(row.MappingID);
    setFormOpen(true);
  }

  function toggleMod(key) {
    const next = selMods.includes(key) ? selMods.filter(k => k !== key) : [...selMods, key];
    setSelMods(next);
    set("AllowedModules", next.join(","));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, AllowedModules: selMods.join(",") };
      if (editId) payload.MappingID = editId;
      const action = editId ? "updateLLPPartner" : "saveLLPPartner";
      const r = await apiPost(action, payload);
      if (r.ok) { setFormOpen(false); setEditId(null); setForm(mpInitial); setSelMods([]); load(); }
      else alert(r.error || "Error saving");
    } finally { setSaving(false); }
  }

  async function removeMembership(row) {
    if (!window.confirm(`Delete membership for ${row.Username}?`)) return;
    try {
      const r = await apiPost("deleteLLPPartner", { MappingID:row.MappingID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete membership");
    }
  }

  const llpMap = {};
  llps.forEach(l => { llpMap[l.LLPID] = l.LLPName; });

  const displayed = filterLLP ? rows.filter(r => r.LLPID === filterLLP) : rows;

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:".75rem", marginTop:".5rem" }}>
        <div>
          <h2 style={{ margin:0, fontSize:"1.2rem", fontWeight:700 }}>LLP Memberships</h2>
          <p style={{ margin:0, fontSize:".8rem", color:"var(--muted)" }}>
            Assign users to LLPs, set ownership % and module access
          </p>
        </div>
        <div style={{ display:"flex", gap:".6rem", alignItems:"center", flexWrap:"wrap" }}>
          <select style={{ ...inp, width:"auto", minWidth:140 }} value={filterLLP} onChange={e => setFilterLLP(e.target.value)}>
            <option value="">All LLPs</option>
            {llps.map(l => <option key={l.LLPID} value={l.LLPID}>{l.LLPName}</option>)}
          </select>
          <button style={btn("primary")} onClick={openAdd}>+ Add Membership</button>
        </div>
      </div>

      {formOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:100, overflowY:"auto", padding:"1.5rem 1rem" }}>
          <div style={{ maxWidth:"500px", margin:"0 auto", background:"var(--card)", borderRadius:"var(--radius)", padding:"1.5rem", border:"1px solid var(--border)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <h3 style={{ margin:0, fontSize:"1rem", fontWeight:700 }}>{editId ? "Edit Membership" : "Add Membership"}</h3>
              <button style={btn("ghost")} onClick={() => setFormOpen(false)}>✕</button>
            </div>
            <form onSubmit={save} style={{ display:"flex", flexDirection:"column", gap:".85rem" }}>
              <div>
                <label style={label}>LLP <span style={{ color:"var(--accent)" }}>*</span></label>
                <select style={inp} value={form.LLPID} onChange={e => set("LLPID", e.target.value)} required disabled={!!editId}>
                  <option value="">— Select LLP —</option>
                  {llps.map(l => <option key={l.LLPID} value={l.LLPID}>{l.LLPName}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Username <span style={{ color:"var(--accent)" }}>*</span></label>
                <select style={inp} value={form.Username} onChange={e => set("Username", e.target.value)} required disabled={!!editId}>
                  <option value="">— Select User —</option>
                  {users.filter(u => u.Username).map(u => (
                    <option key={u.Username} value={u.Username}>{u.Name ? `${u.Name} (${u.Username})` : u.Username}</option>
                  ))}
                </select>
                {editId && <div style={{ fontSize:".68rem", color:"var(--muted)", marginTop:".2rem" }}>LLP and Username cannot be changed. Add a new row instead.</div>}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".75rem" }}>
                <div>
                  <label style={label}>Role</label>
                  <select style={inp} value={form.Role} onChange={e => set("Role", e.target.value)}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Ownership %</label>
                  <input style={inp} type="number" min="0" max="100" step="0.01" placeholder="e.g. 80"
                    value={form.Percentage} onChange={e => set("Percentage", e.target.value)} />
                </div>
              </div>

              <div>
                <label style={label}>Module Access <span style={{ color:"var(--muted)", fontWeight:400 }}>(blank = full access)</span></label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:".4rem", padding:".6rem", background:"var(--input,#1e293b)", border:"1px solid var(--border)", borderRadius:"6px" }}>
                  {MODULE_OPTIONS.map(m => {
                    const on = selMods.includes(m.key);
                    return (
                      <button key={m.key} type="button" onClick={() => toggleMod(m.key)}
                        style={{ padding:".2rem .55rem", borderRadius:"99px", fontSize:".72rem", fontWeight:600, cursor:"pointer",
                          background: on ? "#6366f1" : "transparent",
                          color:      on ? "#fff"    : "var(--muted)",
                          border:     on ? "1px solid #6366f1" : "1px solid var(--border)" }}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                {selMods.length > 0 && (
                  <div style={{ fontSize:".68rem", color:"var(--muted)", marginTop:".3rem" }}>
                    Restricted to: <strong style={{ color:"#818cf8" }}>{selMods.join(", ")}</strong>
                  </div>
                )}
                {selMods.length === 0 && (
                  <div style={{ fontSize:".68rem", color:"var(--success)", marginTop:".3rem" }}>All modules accessible</div>
                )}
              </div>

              <div>
                <label style={label}>Status</label>
                <select style={inp} value={form.Status} onChange={e => set("Status", e.target.value)}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>

              <div style={{ display:"flex", gap:".75rem", justifyContent:"flex-end", paddingTop:".25rem" }}>
                <button type="button" style={btn("ghost")} onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" style={btn("primary")} disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={card}>
        {loading ? (
          <p style={{ color:"var(--muted)", textAlign:"center", padding:"2rem 0" }}>Loading…</p>
        ) : displayed.length === 0 ? (
          <p style={{ color:"var(--muted)", textAlign:"center", padding:"2rem 0" }}>
            {filterLLP ? "No members in this LLP yet." : "No memberships yet. Click '+ Add Membership' to start."}
          </p>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".83rem" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["LLP","Username","Role","Ownership %","Module Access","Status",""].map(h =>
                    <th key={h} style={{ padding:".5rem .65rem", textAlign:"left", color:"var(--muted)", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {displayed.map(row => {
                  const mods = row.AllowedModules ? row.AllowedModules.split(",").map(s => s.trim()).filter(Boolean) : [];
                  return (
                    <tr key={row.MappingID} style={{ borderBottom:"1px solid var(--border)" }}>
                      <td style={{ padding:".5rem .65rem", fontWeight:600 }}>{llpMap[row.LLPID] || row.LLPID}</td>
                      <td style={{ padding:".5rem .65rem", fontFamily:"monospace", fontSize:".8rem" }}>{row.Username||"—"}</td>
                      <td style={{ padding:".5rem .65rem" }}>
                        <span style={{ fontSize:".7rem", padding:".15rem .5rem", borderRadius:"99px", fontWeight:600,
                          background: row.Role==="Managing Partner" ? "#6366f122" : "#f59e0b22",
                          color:      row.Role==="Managing Partner" ? "#818cf8"   : "#f59e0b" }}>
                          {row.Role||"Partner"}
                        </span>
                      </td>
                      <td style={{ padding:".5rem .65rem", textAlign:"center" }}>
                        {row.Percentage != null && row.Percentage !== "" ? `${row.Percentage}%` : "—"}
                      </td>
                      <td style={{ padding:".5rem .65rem", maxWidth:240 }}>
                        {mods.length === 0
                          ? <span style={{ color:"var(--success)", fontSize:".72rem" }}>All modules</span>
                          : <span style={{ color:"var(--muted)", fontSize:".72rem" }}>{mods.join(", ")}</span>
                        }
                      </td>
                      <td style={{ padding:".5rem .65rem" }}>
                        <span style={{ fontSize:".72rem", fontWeight:700, padding:".15rem .5rem", borderRadius:"99px",
                          background: row.Status==="Active" ? "#22c55e22" : "#6b728022",
                          color:      row.Status==="Active" ? "#22c55e"   : "#94a3b8" }}>
                          {row.Status||"Active"}
                        </span>
                      </td>
                      <td style={{ padding:".5rem .4rem" }}>
                        <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem" }} onClick={() => openEdit(row)}>Edit</button>
                        {" "}
                        <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem", color:"var(--danger)" }} onClick={() => removeMembership(row)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────
export default function LLPs() {
  const [llps,    setLlps]    = useState([]);
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [lr, ur] = await Promise.all([
        apiGet("getLLPs"),
        apiGet("getUsers"),
      ]);
      if (lr.ok) setLlps(lr.data || []);
      if (ur.ok) setUsers(ur.data || []);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  if (loading && llps.length === 0) {
    return <p style={{ color:"var(--muted)", padding:"2rem" }}>Loading…</p>;
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.5rem" }}>
      <LLPsSection llps={llps} onRefresh={loadAll} />
      <hr style={{ border:"none", borderTop:"1px solid var(--border)" }} />
      <MembershipsSection llps={llps} users={users} />
    </div>
  );
}
