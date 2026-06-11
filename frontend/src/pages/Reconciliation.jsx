import { useEffect, useState } from "react";
import { gasGet } from "../api/client";

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const fmt  = n => n != null && n !== "" ? "₹"+Number(n).toLocaleString("en-IN") : "—";

function StatusBadge({ variance }) {
  const v = Number(variance||0);
  const [label, color] =
    v === 0 ? ["Settled",    "var(--success)"] :
    v >  0  ? ["Pending",    "var(--warning)"] :
              ["Overpaid",   "var(--danger)"];
  return <span style={{ fontSize:".7rem", padding:".2rem .6rem", borderRadius:"99px", fontWeight:600,
    background:color+"22", color, border:`1px solid ${color}` }}>{label}</span>;
}

export default function Reconciliation() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState("All");

  async function load() {
    setLoading(true);
    try { const r = await gasGet("getReconciliationSummary"); if (r.ok) setRows(r.data||[]); }
    catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = filter === "All" ? rows
    : filter === "Pending"  ? rows.filter(r => Number(r.BalanceAmount||0) > 0)
    : filter === "Settled"  ? rows.filter(r => Number(r.BalanceAmount||0) === 0)
    : rows.filter(r => Number(r.BalanceAmount||0) < 0);

  const totalBilled  = rows.reduce((s,r) => s+Number(r.GrossAmount||0), 0);
  const totalNet      = rows.reduce((s,r) => s+Number(r.NetPayable||0), 0);
  const totalPaid = rows.reduce((s,r) => s+Number(r.PaidAmount||0), 0);
  const totalBalance = rows.reduce((s,r) => s+Number(r.BalanceAmount||0), 0);
  const settled       = rows.filter(r => Number(r.BalanceAmount||0) === 0).length;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Payables Reconciliation</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>Match vendor bills against TDS deductions and payments</p>
        </div>
        <button onClick={load} style={{ padding:".5rem 1rem", borderRadius:"6px", border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:".8rem", cursor:"pointer", display:"flex", alignItems:"center", gap:".4rem" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
        {[
          { label:"TOTAL BILLED",      value:fmt(totalBilled), color:"var(--accent2)" },
          { label:"TOTAL NET PAYABLE", value:fmt(totalNet),        color:"var(--accent)" },
          { label:"TOTAL PAID",        value:fmt(totalPaid),   color:"var(--success)" },
          { label:"BALANCE DUE",       value:fmt(totalBalance),   color: totalBalance > 0 ? "var(--warning)" : totalBalance < 0 ? "var(--danger)" : "var(--success)" },
          { label:"SETTLED BILLS",     value:`${settled} / ${rows.length}`, color:"var(--accent2)" },
        ].map(s => (
          <div key={s.label} style={{ ...card, flex:1, minWidth:160, padding:".9rem 1.25rem" }}>
            <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>{s.label}</div>
            <div style={{ fontSize:"1.4rem", fontWeight:700, color:s.color, marginTop:".25rem" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display:"flex", gap:".5rem" }}>
        {["All","Pending","Settled","Overpaid"].map(f => (
          <button key={f} onClick={()=>setFilter(f)} style={{
            padding:".4rem .9rem", borderRadius:"6px", fontSize:".8rem", fontWeight:600, cursor:"pointer",
            border: filter===f ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: filter===f ? "rgba(99,102,241,.15)" : "transparent",
            color: filter===f ? "var(--accent)" : "var(--muted)",
          }}>{f}</button>
        ))}
        <span style={{ marginLeft:"auto", fontSize:".75rem", color:"var(--muted)", alignSelf:"center" }}>
          {filtered.length} bill{filtered.length!==1?"s":""}
        </span>
      </div>

      {/* Table */}
      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          {loading ? <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading…</p> : (
            <table>
              <thead>
                <tr>
                  <th>Bill No</th><th>Month</th><th>Vendor</th><th>GST Mode</th>
                  <th>Gross Amt</th><th>TDS</th>
                  <th>Net Payable</th><th>Paid</th><th>Balance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length===0
                  ? <tr><td colSpan="10" style={{ textAlign:"center", color:"var(--muted)", padding:"2.5rem" }}>No records found</td></tr>
                  : filtered.map((r,i) => {
                    const balance = Number(r.BalanceAmount||0);
                    return (
                      <tr key={r.BillNo||i}>
                        <td style={{ color:"var(--accent2)", fontFamily:"monospace", fontSize:".85rem", fontWeight:600 }}>{r.BillNo}</td>
                        <td style={{ color:"var(--muted)" }}>{r.BillMonth}</td>
                        <td>{r.VendorName || "—"}</td>
                        <td style={{ color:"var(--muted)", fontSize:".78rem" }}>{r.GSTMode || "—"}</td>
                        <td>{fmt(r.GrossAmount)}</td>
                        <td style={{ color:"var(--danger)" }}>{fmt(r.TDSDeducted)}</td>
                        <td style={{ fontWeight:600 }}>{fmt(r.NetPayable)}</td>
                        <td style={{ fontWeight:600, color:"var(--success)" }}>{fmt(r.PaidAmount)}</td>
                        <td style={{ fontWeight:700, color: balance===0 ? "var(--success)" : balance>0 ? "var(--warning)" : "var(--danger)" }}>
                          {balance > 0 ? "+" : ""}{fmt(balance)}
                        </td>
                        <td><StatusBadge variance={r.BalanceAmount}/></td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}
