import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const CATEGORIES = ["Accommodation", "Air Travel", "Cab / Transport", "Food", "Consulting", "Office Supplies", "Software", "Utilities", "Misc"];
const STATUSES   = ["Active", "Inactive"];

const initial = { VendorName: "", Category: "", GSTIN: "", State: "", Notes: "", Status: "Active" };

const card  = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const label = { display: "block", fontSize: ".75rem", color: "var(--muted)", marginBottom: ".35rem", fontWeight: 500 };
const inp   = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const btn   = (v = "primary") => ({
  padding: ".55rem 1.2rem", borderRadius: "6px",
  border: v === "outline" ? "1px solid var(--border)" : "none",
  fontWeight: 600, fontSize: ".875rem", cursor: "pointer",
  background: v === "primary" ? "var(--accent)" : "transparent",
  color: v === "primary" ? "#fff" : "var(--muted)",
});
const g3 = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: ".75rem" };

const STATUS_COLOR = { Active: "var(--success,#22c55e)", Inactive: "var(--muted)" };

export default function Vendors() {
  const [vendors,  setVendors]  = useState([]);
  const [form,     setForm]     = useState(initial);
  const [editId,   setEditId]   = useState(null);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [search,   setSearch]   = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await apiGet("getVendors");
      if (r.ok) setVendors(r.data || []);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd() { setForm(initial); setEditId(null); setOpen(true); }
  function openEdit(v) {
    setForm({
      VendorName: v.VendorName || "",
      Category:   v.Category   || "",
      GSTIN:      v.GSTIN      || "",
      State:      v.State      || "",
      Notes:      v.Notes      || "",
      Status:     v.Status     || "Active",
    });
    setEditId(v.VendorID);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const action  = editId ? "updateVendor" : "saveVendor";
      const payload = editId ? { ...form, VendorID: editId } : form;
      const r = await apiPost(action, payload);
      if (r.ok) { setOpen(false); setEditId(null); setForm(initial); load(); }
      else alert(r.error || "Error saving vendor");
    } finally { setSaving(false); }
  }

  async function removeVendor(v) {
    if (!window.confirm(`Delete vendor ${v.VendorName}?`)) return;
    try {
      const r = await apiPost("deleteVendor", { VendorID:v.VendorID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete vendor");
    }
  }

  const filtered = vendors.filter(v => {
    const s = search.toLowerCase();
    return !s ||
      (v.VendorName || "").toLowerCase().includes(s) ||
      (v.Category   || "").toLowerCase().includes(s) ||
      (v.GSTIN      || "").toLowerCase().includes(s);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "var(--text)" }}>Vendors</h2>
          <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>
            Master list of vendors / parties paid via expenses
          </p>
        </div>
        <button style={btn("primary")} onClick={openAdd}>+ Add Vendor</button>
      </div>

      {/* Modal */}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, overflowY: "auto", padding: "1.5rem 1rem" }}>
          <div style={{ maxWidth: "560px", margin: "0 auto", background: "var(--card)", borderRadius: "var(--radius)", padding: "1.5rem", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{editId ? "Edit Vendor" : "Add Vendor"}</h3>
              <button style={btn("ghost")} onClick={() => setOpen(false)}>✕</button>
            </div>
            <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: ".9rem" }}>
              <div style={g3}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={label}>Vendor Name <span style={{ color: "var(--accent)" }}>*</span></label>
                  <input style={inp} value={form.VendorName} onChange={e => set("VendorName", e.target.value)} required placeholder="e.g. Consolidated Private Limited" />
                </div>
                <div>
                  <label style={label}>Category</label>
                  <select style={inp} value={form.Category} onChange={e => set("Category", e.target.value)}>
                    <option value="">— Select —</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Status</label>
                  <select style={inp} value={form.Status} onChange={e => set("Status", e.target.value)}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>GSTIN</label>
                  <input style={inp} value={form.GSTIN} onChange={e => set("GSTIN", e.target.value)} placeholder="e.g. 33AAJCC2660E1Z0" maxLength={15} />
                </div>
                <div>
                  <label style={label}>State</label>
                  <input style={inp} value={form.State} onChange={e => set("State", e.target.value)} placeholder="e.g. Tamil Nadu" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={label}>Notes</label>
                  <input style={inp} value={form.Notes} onChange={e => set("Notes", e.target.value)} placeholder="Optional notes" />
                </div>
              </div>
              <div style={{ display: "flex", gap: ".75rem", justifyContent: "flex-end", paddingTop: ".25rem" }}>
                <button type="button" style={btn("ghost")} onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" style={btn("primary")} disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Save Vendor"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ ...card, padding: ".85rem 1.25rem" }}>
        <input
          style={{ ...inp, maxWidth: "300px" }}
          placeholder="Search name, category, GSTIN…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div style={card}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>
            {vendors.length === 0 ? "No vendors yet. Click \"+ Add Vendor\" to create one." : "No vendors match your search."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Vendor Name", "Category", "GSTIN", "State", "Status", "Notes", ""].map(h => (
                    <th key={h} style={{ padding: ".5rem .65rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.VendorID} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: ".5rem .65rem", fontWeight: 600 }}>{v.VendorName}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{v.Category || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", fontFamily: "monospace", fontSize: ".78rem" }}>{v.GSTIN || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{v.State || "—"}</td>
                    <td style={{ padding: ".5rem .65rem" }}>
                      <span style={{
                        fontSize: ".72rem", padding: ".2rem .6rem", borderRadius: "99px", fontWeight: 600,
                        background: (STATUS_COLOR[v.Status] || "var(--muted)") + "22",
                        color: STATUS_COLOR[v.Status] || "var(--muted)",
                        border: `1px solid ${STATUS_COLOR[v.Status] || "var(--muted)"}`,
                      }}>{v.Status || "Active"}</span>
                    </td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.Notes || "—"}</td>
                    <td style={{ padding: ".5rem .4rem", whiteSpace: "nowrap" }}>
                      <button style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem" }} onClick={() => openEdit(v)}>Edit</button>
                      {" "}
                      <button style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem", color: "var(--danger)" }} onClick={() => removeVendor(v)}>Delete</button>
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
