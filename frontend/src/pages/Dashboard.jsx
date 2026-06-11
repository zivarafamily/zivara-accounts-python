import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gasGet } from "../api/client";

const fmt = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.1rem 1.25rem" };
const label = { fontSize:".72rem", color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:".06em" };
const value = { fontSize:"1.4rem", fontWeight:800, marginTop:".3rem" };
const row = { display:"flex", justifyContent:"space-between", gap:".75rem", marginTop:".35rem", fontSize:".78rem" };

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState({ summary:{}, payables:[], bankAccounts:[] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    gasGet("getAccountsDashboard")
      .then(r => { if (r.ok) setData(r); })
      .finally(() => setLoading(false));
  }, []);

  const s = data.summary || {};
  const cards = [
    { label:"Bank Balance", value:fmt(s.ActiveBankBalance), color:"var(--success)", to:"/bankaccounts" },
    { label:"Cash Balance", value:fmt(s.CashBalance), color:"var(--accent2)", to:"/cashbook" },
    { label:"Payables Outstanding", value:fmt(s.PayablesOutstanding), color:"var(--warning)", to:"/payment-tracker" },
    { label:"Net Payable", value:fmt(s.PayablesNet), color:"var(--accent)", to:"/payment-tracker" },
    { label:"TDS To Deduct", value:fmt(s.PayablesTDS), color:"var(--danger)", to:"/reconciliation" },
    { label:"GST Input", value:fmt(s.PayablesGST), color:"var(--accent2)", to:"/reconciliation" },
    { label:"Expenses", value:fmt(s.ExpenseTotal), color:"var(--muted)", to:"/expenses" },
    { label:"Reimbursements Pending", value:fmt(s.ReimbursementPending), color:"var(--warning)", to:"/reimbursements" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
        <div>
          <h2 style={{ margin:0, fontSize:"1.25rem", fontWeight:800 }}>Accounts Dashboard</h2>
          <p style={{ margin:0, color:"var(--muted)", fontSize:".8rem" }}>GST, TDS, vendor payments, bank and cash overview</p>
        </div>
        <button onClick={() => window.location.reload()} style={{ padding:".5rem .9rem", borderRadius:"6px", border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontWeight:600 }}>Refresh</button>
      </div>

      {loading ? (
        <p style={{ color:"var(--muted)" }}>Loading...</p>
      ) : (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:"1rem" }}>
            {cards.map(c => (
              <button key={c.label} onClick={() => navigate(c.to)} style={{ ...card, textAlign:"left", cursor:"pointer" }}>
                <div style={label}>{c.label}</div>
                <div style={{ ...value, color:c.color }}>{c.value}</div>
              </button>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:"1rem" }}>
            <div style={card}>
              <div style={label}>Recent Payables</div>
              {(data.payables || []).length === 0 ? (
                <p style={{ color:"var(--muted)", fontSize:".82rem", marginTop:".75rem" }}>No payables yet.</p>
              ) : (
                (data.payables || []).slice(0, 6).map(p => (
                  <div key={p.PayableID || p.BillNo} style={row}>
                    <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.VendorName || "Vendor"} · {p.BillNo || "Bill"}</span>
                    <strong style={{ color:Number(p.BalanceAmount || 0) > 0 ? "var(--warning)" : "var(--success)", whiteSpace:"nowrap" }}>{fmt(p.BalanceAmount)}</strong>
                  </div>
                ))
              )}
            </div>

            <div style={card}>
              <div style={label}>Active Bank Accounts</div>
              {(data.bankAccounts || []).filter(a => String(a.IsActive || "Yes").toLowerCase() !== "no").length === 0 ? (
                <p style={{ color:"var(--muted)", fontSize:".82rem", marginTop:".75rem" }}>No active bank accounts.</p>
              ) : (
                (data.bankAccounts || []).filter(a => String(a.IsActive || "Yes").toLowerCase() !== "no").map(a => (
                  <div key={a.AccountID || a.AccountNumber} style={row}>
                    <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.AccountName || a.BankName || "Bank"}{a.AccountNumber ? ` (...${String(a.AccountNumber).slice(-4)})` : ""}</span>
                    <strong style={{ color:"var(--success)", whiteSpace:"nowrap" }}>{fmt(a.CurrentBalance)}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
