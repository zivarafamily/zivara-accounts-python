import { useEffect, useMemo, useState } from "react";
import { gasGet } from "../api/client";

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

export default function VendorLedger() {
  const [vendors, setVendors] = useState([]);
  const [vendor, setVendor] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadVendors() {
    try {
      const [vendorRes, payableRes] = await Promise.all([
        gasGet("getVendors"),
        gasGet("getLLPPayables"),
      ]);
      const byName = new Map();
      (vendorRes.data || [])
        .filter(v => v.Status !== "Inactive")
        .forEach(v => {
          const name = String(v.VendorName || "").trim();
          if (name) byName.set(name.toLowerCase(), { VendorID: v.VendorID || name, VendorName: name });
        });
      (payableRes.data || []).forEach(p => {
        const name = String(p.VendorName || "").trim();
        if (name && !byName.has(name.toLowerCase())) {
          byName.set(name.toLowerCase(), { VendorID: name, VendorName: name });
        }
      });
      setVendors(Array.from(byName.values()).sort((a, b) => a.VendorName.localeCompare(b.VendorName)));
    } catch {}
  }

  async function loadLedger(nextVendor = vendor) {
    setLoading(true);
    setError("");
    try {
      const r = await gasGet("getVendorLedger", nextVendor ? { vendor: nextVendor } : {});
      setHeaders(r.headers || []);
      setRows(r.data || []);
      setSummary(r.summary || {});
    } catch (err) {
      setError(err.message || "Unable to load vendor ledger");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadVendors(); loadLedger(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tsv = useMemo(() => {
    const clean = v => String(v ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
    return [
      headers.join("\t"),
      ...rows.map(row => headers.map(h => clean(row[h])).join("\t")),
    ].join("\n");
  }, [headers, rows]);

  async function copyTSV() {
    await navigator.clipboard.writeText(tsv);
    alert("Vendor ledger copied. Paste into Google Sheets.");
  }

  function onVendorChange(value) {
    setVendor(value);
    loadLedger(value);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"1rem", flexWrap:"wrap" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Vendor Ledger</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>Bill, TDS, payment, and outstanding statement by vendor</p>
        </div>
        <div style={{ display:"flex", gap:".6rem", flexWrap:"wrap" }}>
          <select value={vendor} onChange={e=>onVendorChange(e.target.value)} style={{ minWidth:260 }}>
            <option value="">All vendors</option>
            {vendors.map(v => <option key={v.VendorID} value={v.VendorName}>{v.VendorName}</option>)}
          </select>
          <button style={btn("ghost")} onClick={()=>loadLedger()}>Refresh</button>
          <button style={btn()} onClick={copyTSV} disabled={!rows.length}>Copy to Sheets</button>
        </div>
      </div>

      <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
        {[
          ["Net Bills", summary.Debit],
          ["Payments", summary.Credit],
          ["TDS Deducted", summary.TDSAmount],
          ["Closing Balance", summary.ClosingBalance],
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
          <span style={{ fontWeight:600, fontSize:".875rem" }}>Ledger Statement</span>
          <span style={{ color:"var(--muted)", fontSize:".75rem" }}>{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", textAlign:"center", color:"var(--muted)" }}>Loading...</p>
          ) : rows.length === 0 ? (
            <p style={{ padding:"2rem", textAlign:"center", color:"var(--muted)" }}>No ledger rows found.</p>
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
