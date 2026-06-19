import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api/client";

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const btn = (v = "primary") => ({
  padding:".5rem .9rem",
  borderRadius:"6px",
  border:v === "ghost" ? "1px solid var(--border)" : "none",
  background:v === "primary" ? "var(--accent)" : "transparent",
  color:v === "primary" ? "#fff" : "var(--muted)",
  fontSize:".8rem",
  fontWeight:600,
  cursor:"pointer",
});
const fmt = n => n != null && n !== "" ? "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—";

export default function CATDSReport() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [month, setMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await apiGet("getCATDSReport", month ? { month } : {});
      setHeaders(r.headers || []);
      setRows(r.data || []);
      setSummary(r.summary || {});
    } catch (err) {
      setError(err.message || "Unable to load CA TDS report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tsv = useMemo(() => {
    const clean = v => String(v ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
    return [
      headers.join("\t"),
      ...rows.map(row => headers.map(h => clean(row[h])).join("\t")),
    ].join("\n");
  }, [headers, rows]);

  async function copyTSV() {
    await navigator.clipboard.writeText(tsv);
    alert("CA TDS report copied. Paste into Google Sheets.");
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"1rem", flexWrap:"wrap" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>CA TDS Report</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>TDS working format for CA challan and return preparation</p>
        </div>
        <div style={{ display:"flex", gap:".6rem", flexWrap:"wrap" }}>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{ width:150 }} />
          <button style={btn("ghost")} onClick={load}>Refresh</button>
          <button style={btn()} onClick={copyTSV} disabled={!rows.length}>Copy to Sheets</button>
        </div>
      </div>

      <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
        {[
          ["Amount Paid / Credited", summary.AmountPaidCredited],
          ["Tax Deducted", summary.TaxDeducted],
          ["Interest", summary.Interest],
          ["Total Amount Paid", summary.TotalAmountPaid],
        ].map(([label, value]) => (
          <div key={label} style={{ ...card, flex:1, minWidth:180, padding:".9rem 1.25rem" }}>
            <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:600, textTransform:"uppercase" }}>{label}</div>
            <div style={{ fontSize:"1.25rem", fontWeight:700, color:"var(--accent)", marginTop:".25rem" }}>{fmt(value)}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ ...card, color:"var(--danger)" }}>{error}</div>}

      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontWeight:600, fontSize:".875rem" }}>CA TDS Working</span>
          <span style={{ color:"var(--muted)", fontSize:".75rem" }}>{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", textAlign:"center", color:"var(--muted)" }}>Loading...</p>
          ) : rows.length === 0 ? (
            <p style={{ padding:"2rem", textAlign:"center", color:"var(--muted)" }}>No TDS rows found.</p>
          ) : (
            <table>
              <thead>
                <tr>{headers.map(h => <th key={h} style={{ whiteSpace:"nowrap" }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>
                    {headers.map(h => <td key={h} style={{ whiteSpace:"nowrap" }}>{row[h]}</td>)}
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
