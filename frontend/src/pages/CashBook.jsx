import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { formatDate } from "../utils/format";

const initial = {
  Date:"", Type:"Payment", OpeningBalance:"",
  AmountIn:"", AmountOut:"", ReferenceType:"Manual",
  ReferenceID:"", Description:"", LedgerID:""
};

const card  = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn   = (v="primary") => ({
  padding:".55rem 1.2rem", borderRadius:"6px", border:"none",
  fontWeight:600, fontSize:".875rem", cursor:"pointer",
  background: v==="primary" ? "var(--accent)" : "transparent",
  color: v==="primary" ? "#fff" : "var(--muted)",
});

const TYPE_COLOR = {
  Receipt:"var(--success)", Payment:"var(--danger)",
  Adjustment:"var(--warning)", CashDeposit:"var(--accent2)"
};

function Badge({ v, colors }) {
  const c = (colors||{})[v] || "var(--muted)";
  return (
    <span style={{
      fontSize:".7rem", padding:".2rem .6rem", borderRadius:"99px", fontWeight:600,
      background:c+"22", color:c, border:`1px solid ${c}`,
    }}>{v}</span>
  );
}

const fmt = n => n != null && n !== "" ? "₹"+Number(n).toLocaleString("en-IN") : "—";

export default function CashBook() {
  const [entries, setEntries]   = useState([]);
  const [ledgers, setLedgers]     = useState([]);
  const [form, setForm]         = useState(initial);
  const [loading, setLoading]   = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [cashResult, ledgerResult] = await Promise.allSettled([
        apiGet("getCashBook"),
        apiGet("getLedgers"),
      ]);

      if (cashResult.status === "fulfilled" && cashResult.value.ok) {
        const data = cashResult.value.data || [];
        setEntries(data);

        if (data.length > 0) {
          setForm(p => ({
            ...p,
            OpeningBalance: String(
              data[data.length - 1].ClosingBalance || ""
            ),
          }));
        }
      }

      if (ledgerResult.status === "fulfilled" && ledgerResult.value.ok) {
        setLedgers(
          (ledgerResult.value.data || []).filter(
            ledger => ledger.Status !== "Inactive"
          )
        );
      }
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save(e) {
    e.preventDefault();

    const amountIn = Number(form.AmountIn) || 0;
    const amountOut = Number(form.AmountOut) || 0;

    if (!form.LedgerID) {
      alert("Select a ledger for this cash entry");
      return;
    }

    if (amountIn <= 0 && amountOut <= 0) {
      alert("Enter either Amount In or Amount Out");
      return;
    }

    if (amountIn > 0 && amountOut > 0) {
      alert("Use either Amount In or Amount Out, not both");
      return;
    }

    try {
      const r = await apiPost("saveCashEntry", form);

      if (!r.ok || !r.data?.EntryID) {
        alert(r.error || "Error saving");
        return;
      }

      await apiPost("postCashToLedger", {
        EntryID: r.data.EntryID,
        LedgerID: form.LedgerID,
      });

      setForm(initial);
      setFormOpen(false);
      await load();
    } catch (err) {
      alert(err.message || "Error saving cash entry");
    }
  }

  async function removeEntry(en) {
    if (!window.confirm(`Delete cash entry ${en.ReferenceID || en.EntryID}?`)) return;
    try {
      const r = await apiPost("deleteCashEntry", { EntryID:en.EntryID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete cash entry");
    }
  }

  const closing = entries.length > 0 ? entries[entries.length-1].ClosingBalance : null;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Cash Book</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>Daily cash inflows and outflows</p>
        </div>
        <button style={btn()} onClick={() => setFormOpen(o => !o)}>
          {formOpen ? "✕ Close" : "+ Add Entry"}
        </button>
      </div>

      <div style={{ display:"flex", gap:"1rem" }}>
        <div style={{ ...card, flex:1, padding:".9rem 1.25rem", display:"flex", flexDirection:"column", gap:".3rem" }}>
          <span style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>LATEST CLOSING BALANCE</span>
          <span style={{ fontSize:"1.5rem", fontWeight:700, color: closing != null && Number(closing) >= 0 ? "var(--success)" : "var(--danger)" }}>
            {closing != null ? fmt(closing) : "—"}
          </span>
        </div>
        <div style={{ ...card, flex:1, padding:".9rem 1.25rem", display:"flex", flexDirection:"column", gap:".3rem" }}>
          <span style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>TOTAL ENTRIES</span>
          <span style={{ fontSize:"1.5rem", fontWeight:700, color:"var(--accent2)" }}>{entries.length}</span>
        </div>
      </div>

      {formOpen && (
        <div style={card}>
          <h3 style={{ fontWeight:600, marginBottom:"1rem", color:"var(--text)" }}>New Cash Entry</h3>
          <form onSubmit={save}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:"1rem" }}>
              <div><label style={label}>Date</label><input type="date" value={form.Date} onChange={e=>set("Date",e.target.value)} required /></div>
              <div><label style={label}>Type</label>
                <select value={form.Type} onChange={e=>set("Type",e.target.value)}>
                  {["Receipt","Payment","Adjustment","CashDeposit"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Opening Balance (₹)</label><input type="number" placeholder="0.00" value={form.OpeningBalance} onChange={e=>set("OpeningBalance",e.target.value)} /></div>
              <div><label style={label}>Amount In (₹)</label><input type="number" placeholder="0.00" min="0" value={form.AmountIn} onChange={e=>set("AmountIn",e.target.value)} /></div>
              <div><label style={label}>Amount Out (₹)</label><input type="number" placeholder="0.00" min="0" value={form.AmountOut} onChange={e=>set("AmountOut",e.target.value)} /></div>
              <div><label style={label}>Ledger *</label>
                <select value={form.LedgerID} onChange={e=>set("LedgerID",e.target.value)} required>
                  <option value="">— Select ledger —</option>
                  {ledgers.map(ledger => (
                    <option key={ledger.LedgerID} value={ledger.LedgerID}>
                      {ledger.LedgerName} · {ledger.GroupName}
                    </option>
                  ))}
                </select>
              </div>
              <div><label style={label}>Reference Type</label>
                <select value={form.ReferenceType} onChange={e=>set("ReferenceType",e.target.value)}>
                  {["Manual","Expense","Advance","InvoiceReceipt","Salary"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Reference ID</label><input placeholder="e.g. EXP-001" value={form.ReferenceID} onChange={e=>set("ReferenceID",e.target.value)} /></div>
              <div><label style={label}>Description</label><input placeholder="Notes" value={form.Description} onChange={e=>set("Description",e.target.value)} /></div>
            </div>
            <div style={{ display:"flex", gap:".75rem", marginTop:"1.25rem" }}>
              <button type="submit" style={btn()}>Save Entry</button>
              <button type="button" style={btn("ghost")} onClick={()=>setFormOpen(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:600, fontSize:".875rem" }}>Entries</span>
          <span style={{ fontSize:".75rem", color:"var(--muted)" }}>{entries.length} record{entries.length!==1?"s":""}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Opening</th>
                  <th>In</th><th>Out</th><th>Closing</th>
                  <th>Ref Type</th><th>Ref ID</th><th>Description</th><th></th>
                </tr>
              </thead>
              <tbody>
                {entries.length===0 ? (
                  <tr><td colSpan="10" style={{ textAlign:"center", color:"var(--muted)", padding:"2.5rem" }}>No entries yet</td></tr>
                ) : entries.map(en => (
                  <tr key={en.EntryID}>
                    <td style={{ whiteSpace:"nowrap" }}>{formatDate(en.Date)}</td>
                    <td><Badge v={en.Type} colors={TYPE_COLOR}/></td>
                    <td style={{ color:"var(--muted)" }}>{fmt(en.OpeningBalance)}</td>
                    <td style={{ color:"var(--success)", fontWeight:600 }}>{en.AmountIn ? fmt(en.AmountIn) : "—"}</td>
                    <td style={{ color:"var(--danger)", fontWeight:600 }}>{en.AmountOut ? fmt(en.AmountOut) : "—"}</td>
                    <td style={{ fontWeight:700 }}>{fmt(en.ClosingBalance)}</td>
                    <td style={{ color:"var(--muted)" }}>{en.ReferenceType}</td>
                    <td style={{ color:"var(--accent2)", fontSize:".8rem" }}>{en.ReferenceID}</td>
                    <td style={{ color:"var(--muted)", maxWidth:"180px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{en.Description}</td>
                    <td><button onClick={()=>removeEntry(en)} style={{ background:"transparent", border:"1px solid var(--border)", color:"var(--danger)", borderRadius:"6px", padding:".3rem .7rem", fontSize:".75rem", cursor:"pointer" }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}
