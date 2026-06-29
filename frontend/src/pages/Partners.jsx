import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const initial = { PartnerName: "", LLPID: "", LLPName: "", Email: "", Mobile: "", Status: "Active" };

const card  = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const label = { display: "block", fontSize: ".75rem", color: "var(--muted)", marginBottom: ".35rem", fontWeight: 500 };
const inp   = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const btn   = (v = "primary") => ({
  padding: ".55rem 1.2rem", borderRadius: "6px",
  fontWeight: 600, fontSize: ".875rem", cursor: "pointer",
  background: v === "primary" ? "var(--accent)" : "transparent",
  color: v === "primary" ? "#fff" : "var(--muted)",
  border: v === "outline" ? "1px solid var(--border)" : "none",
});

export default function Partners() {
  const [rows,     setRows]     = useState([]);
  const [llps,     setLlps]     = useState([]);
  const [form,     setForm]     = useState(initial);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId,   setEditId]   = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [p, l] = await Promise.allSettled([apiGet("getPartners"), apiGet("getLLPs")]);
      if (p.status === "fulfilled" && p.value.ok) setRows(p.value.data || []);
      if (l.status === "fulfilled" && l.value.ok) setLlps(l.value.data || []);
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Unable to load partners", err);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd()  { setForm(initial); setEditId(null); setFormOpen(true); }
  function openEdit(row) {
    setForm({
      PartnerName: row.PartnerName || "",
      LLPID:       row.LLPID     || "",
      LLPName:     row.LLPName    || "",
      Email:       row.Email      || "",
      Mobile:      row.Mobile     || "",
      Status:      row.Status     || "Active",
    });
    setEditId(row.PartnerID);
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const action  = editId ? "updatePartner" : "savePartner";
      const payload = editId ? { ...form, PartnerID: editId } : form;
      const r = await apiPost(action, payload);
      if (r.ok) { setFormOpen(false); setEditId(null); setForm(initial); load(); }
      else alert(r.error || "Error saving");
    } finally { setSaving(false); }
  }

  async function removePartner(row) {
    if (!window.confirm(`Delete partner ${row.PartnerName}?`)) return;
    try {
      const r = await apiPost("deletePartner", { PartnerID:row.PartnerID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete partner");
    }
  }

  const active = rows.filter(r => r.Status !== "Inactive");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Partners</h2>
          <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>
            Partner master &nbsp;·&nbsp; {rows.length} total, {active.length} active
          </p>
        </div>
        <button style={btn("primary")} onClick={openAdd}>+ Add Partner</button>
      </div>

      {/* Modal */}
      {formOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, overflowY: "auto", padding: "1.5rem 1rem" }}>
          <div style={{ maxWidth: "480px", margin: "0 auto", background: "var(--card)", borderRadius: "var(--radius)", padding: "1.5rem", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{editId ? "Edit Partner" : "Add Partner"}</h3>
              <button style={btn("ghost")} onClick={() => setFormOpen(false)}>✕</button>
            </div>
            <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
              <div>
                <label style={label}>Partner Name <span style={{ color: "var(--accent)" }}>*</span></label>
                <input style={inp} value={form.PartnerName} onChange={e => set("PartnerName", e.target.value)} required />
              </div>
              <div>
                <label style={label}>LLP Name</label>
                <select
                  style={inp}
                  value={form.LLPID}
                  onChange={e => {
                    const selected = llps.find(l => l.LLPID === e.target.value);
                    setForm(p => ({ ...p, LLPID: e.target.value, LLPName: selected?.LLPName || "" }));
                  }}
                >
                  <option value="">Select LLP</option>
                  {llps.map(l => <option key={l.LLPID} value={l.LLPID}>{l.LLPName}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem" }}>
                <div>
                  <label style={label}>Email</label>
                  <input type="email" style={inp} value={form.Email} onChange={e => set("Email", e.target.value)} />
                </div>
                <div>
                  <label style={label}>Mobile</label>
                  <input style={inp} value={form.Mobile} onChange={e => set("Mobile", e.target.value)} />
                </div>
              </div>
              <div>
                <label style={label}>Status</label>
                <select style={inp} value={form.Status} onChange={e => set("Status", e.target.value)}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: ".75rem", justifyContent: "flex-end", paddingTop: ".25rem" }}>
                <button type="button" style={btn("ghost")} onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" style={btn("primary")} disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={card}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>No partners yet. Click "+ Add Partner" to start.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Partner Name", "LLP", "Email", "Mobile", "Status", ""].map(h =>
                    <th key={h} style={{ padding: ".5rem .65rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.PartnerID} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: ".5rem .65rem", fontWeight: 600 }}>{row.PartnerName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{row.LLPName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{row.Email  || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{row.Mobile || "—"}</td>
                    <td style={{ padding: ".5rem .65rem" }}>
                      <span style={{ fontSize: ".72rem", fontWeight: 700, padding: ".15rem .5rem", borderRadius: "99px",
                        background: row.Status === "Active" ? "#22c55e22" : "#6b728022",
                        color:      row.Status === "Active" ? "#22c55e"   : "#94a3b8" }}>
                        {row.Status || "Active"}
                      </span>
                    </td>
                    <td style={{ padding: ".5rem .4rem", whiteSpace: "nowrap" }}>
                      <button style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem" }} onClick={() => openEdit(row)}>Edit</button>
                      {" "}
                      <button style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem", color: "var(--danger)" }} onClick={() => removePartner(row)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
