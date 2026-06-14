import { useEffect, useState, useMemo } from "react";
import { gasGet, gasPost } from "../api/client";

const initial = {
  ClientName: "",
  PAN:        "",
  RMName:     "Manugopal A K",
  Segment:    "",
  Status:     "Active",
  Notes:      "",
  LLPName:    "",
  FamilyName: "",
  SuperFamilyName: "",
};

const SEGMENTS = ["", "HNI", "UHNI", "NRI", "Retail", "Corporate", "Other"];
const STATUSES = ["Active", "Inactive", "Prospect"];

const card = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const lbl  = { display: "block", fontSize: ".75rem", color: "var(--muted)", marginBottom: ".35rem", fontWeight: 500 };
const inp  = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const btn  = (v = "primary") => ({
  padding: ".55rem 1.2rem", borderRadius: "6px",
  border: v === "outline" ? "1px solid var(--border)" : "none",
  fontWeight: 600, fontSize: ".875rem", cursor: "pointer",
  background: v === "primary" ? "var(--accent)" : "transparent",
  color: v === "primary" ? "#fff" : "var(--muted)",
});
const g2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: ".75rem" };
const g3 = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: ".75rem" };

const statusColor = s => ({ Active: "#22c55e", Inactive: "#f59e0b", Prospect: "#6366f1" }[s] || "var(--muted)");

export default function Clients({ role = "admin", employeeRef = "" }) {
  const isPartner = role === "partner";
  const [clients, setClients] = useState([]);
  const [llps,    setLlps]    = useState([]);
  const [form,    setForm]    = useState(initial);
  const [open,    setOpen]    = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [search,  setSearch]  = useState("");

  async function load() {
    setLoading(true);
    try { const r = await gasGet("getClients"); if (r.ok) setClients(r.data || []); }
    catch {} finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    gasGet("getLLPs").then(r => { if (r.ok) setLlps(r.data || []); }).catch(() => {});
  }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd() { setForm({ ...initial, RMName: isPartner ? employeeRef : initial.RMName }); setEditId(null); setOpen(true); }
  function openEdit(c) {
    setForm({
      ClientName: c.ClientName || "",
      PAN:        c.PAN        || "",
      RMName:     c.RMName     || "",
      Segment:    c.Segment    || "",
      Status:     c.Status     || "Active",
      Notes:      c.Notes      || "",
      LLPName:    c.LLPName    || "",
      FamilyName: c.FamilyName || "",
      SuperFamilyName: c.SuperFamilyName || "",
    });
    setEditId(c.ClientID);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const action  = editId ? "updateClient" : "saveClient";
      const payload = editId ? { ...form, ClientID: editId } : form;
      const r = await gasPost(action, payload);
      if (r.ok) { setOpen(false); setEditId(null); setForm(initial); load(); }
      else alert(r.error || "Error saving client");
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  }

  const filtered = useMemo(() => {
    // Partners only see their own clients (matched by RMName)
    const base = isPartner && employeeRef
      ? clients.filter(c => String(c.RMName || "").trim() === String(employeeRef).trim())
      : clients;
    if (!search) return base;
    const s = search.toLowerCase();
    return base.filter(c =>
      (c.ClientName || "").toLowerCase().includes(s) ||
      (c.PAN        || "").toLowerCase().includes(s) ||
      (c.RMName     || "").toLowerCase().includes(s) ||
      (c.FamilyName || "").toLowerCase().includes(s) ||
      (c.SuperFamilyName || "").toLowerCase().includes(s)
    );
  }, [clients, search, isPartner, employeeRef]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Clients</h2>
          <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>{filtered.length}{isPartner ? " of your" : ""} clients</p>
        </div>
        <button style={btn("primary")} onClick={openAdd}>+ Add Client</button>
      </div>

      {/* ── FORM MODAL ──────────────────────────────────────────────────── */}
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, overflowY: "auto", padding: "1.5rem 1rem" }}>
          <div style={{ maxWidth: "560px", margin: "0 auto", background: "var(--card)", borderRadius: "var(--radius)", padding: "1.5rem", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                {editId ? "Edit Client" : "New Client"}
              </h3>
              <button style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "1.2rem", cursor: "pointer" }} onClick={() => setOpen(false)}>✕</button>
            </div>

            <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: ".85rem" }}>
              <div>
                <label style={lbl}>Client Name <span style={{ color: "var(--accent)" }}>*</span></label>
                <input style={inp} value={form.ClientName} onChange={e => set("ClientName", e.target.value)} required />
              </div>
              <div style={g2}>
                <div>
                  <label style={lbl}>PAN</label>
                  <input style={inp} value={form.PAN} onChange={e => set("PAN", e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
                </div>
                <div>
                  <label style={lbl}>RM Name</label>
                  <input style={inp} value={form.RMName} onChange={e => set("RMName", e.target.value)} />
                </div>
              </div>
              <div style={g2}>
                <div>
                  <label style={lbl}>Segment</label>
                  <select style={inp} value={form.Segment} onChange={e => set("Segment", e.target.value)}>
                    {SEGMENTS.map(s => <option key={s} value={s}>{s || "— Select —"}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.Status} onChange={e => set("Status", e.target.value)}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={g2}>
                <div>
                  <label style={lbl}>LLP</label>
                  <select style={inp} value={form.LLPName} onChange={e => set("LLPName", e.target.value)}>
                    <option value="">— None / Not assigned —</option>
                    {llps.map(l => <option key={l.LLPID || l.LLPName} value={l.LLPName}>{l.LLPName}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Family Name</label>
                  <input style={inp} value={form.FamilyName} onChange={e => set("FamilyName", e.target.value)} placeholder="Family revenue group" />
                </div>
              </div>
              <div>
                <label style={lbl}>Super Family Name</label>
                <input style={inp} value={form.SuperFamilyName} onChange={e => set("SuperFamilyName", e.target.value)} placeholder="Top-level family group" />
              </div>
              <div>
                <label style={lbl}>Notes</label>
                <textarea rows={2} style={{ ...inp, resize: "vertical" }} value={form.Notes} onChange={e => set("Notes", e.target.value)} />
              </div>

              <div style={{ display: "flex", gap: ".75rem", justifyContent: "flex-end", paddingTop: ".5rem", borderTop: "1px solid var(--border)" }}>
                <button type="button" style={btn("ghost")} onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" style={btn("primary")} disabled={saving}>
                  {saving ? "Saving…" : editId ? "Update Client" : "Save Client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <div style={{ ...card, display: "flex", gap: ".75rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          style={{ ...inp, maxWidth: "280px" }}
          placeholder="Search name, PAN, RM, family, super family…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button style={btn("ghost")} onClick={() => setSearch("")}>Clear</button>}
        <span style={{ marginLeft: "auto", fontSize: ".8rem", color: "var(--muted)" }}>{filtered.length} of {clients.length}</span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div style={card}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>
            {clients.length === 0 ? "No clients yet. Click \"+ Add Client\" to add one." : "No clients match your search."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Client Name","PAN",...(isPartner ? [] : ["RM"]),"Super Family","Family","Segment","LLP","Status","Notes",""].map(h => (
                    <th key={h} style={{ padding: ".5rem .65rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.ClientID} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: ".5rem .65rem", fontWeight: 600 }}>{c.ClientName}</td>
                    <td style={{ padding: ".5rem .65rem", fontFamily: "monospace", fontSize: ".8rem" }}>{c.PAN || "—"}</td>
                    {!isPartner && <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{c.RMName || "—"}</td>}
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{c.SuperFamilyName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{c.FamilyName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)", fontSize: ".78rem" }}>{c.Segment || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)", fontSize: ".78rem" }}>{c.LLPName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem" }}>
                      <span style={{ background: statusColor(c.Status) + "22", color: statusColor(c.Status), padding: ".18rem .6rem", borderRadius: "99px", fontSize: ".72rem", fontWeight: 600 }}>
                        {c.Status || "Active"}
                      </span>
                    </td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.Notes || "—"}</td>
                    <td style={{ padding: ".5rem .4rem" }}>
                      <button style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem" }} onClick={() => openEdit(c)}>Edit</button>
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
