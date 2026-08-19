import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client";
import { useLLP } from "../context/LLPContext";
import { formatDate } from "../utils/format";

const fmt = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.05rem 1.15rem" };
const label = { fontSize:".7rem", color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:".06em" };
const actionBtn = (primary=false) => ({
  border:primary ? "none" : "1px solid var(--border)",
  background:primary ? "var(--accent)" : "transparent",
  color:primary ? "#fff" : "var(--text)",
  borderRadius:"7px", padding:".58rem .9rem", cursor:"pointer", fontWeight:700, fontSize:".8rem"
});

function pick(summary, ...keys) {
  for (const key of keys) {
    if (summary?.[key] !== undefined && summary?.[key] !== null) return Number(summary[key]) || 0;
  }
  return 0;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentLLP } = useLLP();
  const [data, setData] = useState({ summary:{}, payables:[], bankAccounts:[] });
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [d, t, b] = await Promise.allSettled([
        apiGet("getAccountsDashboard"),
        apiGet("getBankTransactions"),
        apiGet("getBankAccounts"),
      ]);
      if (d.status === "fulfilled" && d.value.ok) setData(prev => ({ ...prev, ...d.value }));
      if (t.status === "fulfilled" && t.value.ok) setTransactions(t.value.data || []);
      if (b.status === "fulfilled" && b.value.ok) setData(prev => ({ ...prev, bankAccounts:b.value.data || [] }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [currentLLP?.llpId, currentLLP?.LLPID, currentLLP?.global]);

  const s = data.summary || {};
  const bankBalance = pick(s, "ActiveBankBalance", "bank_balance_total");
  const cashBalance = pick(s, "CashBalance", "petty_cash_balance");
  const payablesOutstanding = pick(s, "PayablesOutstanding", "pending_payables_total");
  const expenseTotal = pick(s, "ExpenseTotal", "expenses_total");
  const reimbursementPending = pick(s, "ReimbursementPending", "pending_reimbursements_total");
  const gstAmount = pick(s, "PayablesGST");
  const tdsAmount = pick(s, "PayablesTDS");

  const recentTransactions = useMemo(() => (transactions || []).slice(0, 8), [transactions]);
  const activeBanks = useMemo(() => (data.bankAccounts || []).filter(a => String(a.IsActive || "Yes").toLowerCase() !== "no"), [data.bankAccounts]);
  const payables = useMemo(() => (data.payables || []).filter(p => Number(p.BalanceAmount || 0) > 0).slice(0, 6), [data.payables]);

  const kpis = [
    ["Bank Balance", fmt(bankBalance), "var(--success)", "/bankaccounts"],
    ["Cash Balance", fmt(cashBalance), "var(--accent2)", "/cashbook"],
    ["Payables Outstanding", fmt(payablesOutstanding), "var(--warning)", "/payment-tracker"],
    ["Expenses", fmt(expenseTotal), "var(--text)", "/expenses"],
    ["Reimbursements Pending", fmt(reimbursementPending), "var(--warning)", "/reimbursements"],
  ];

  return <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
      <div>
        <h2 style={{ margin:0, fontSize:"1.25rem", fontWeight:800 }}>Accounts Dashboard</h2>
        <p style={{ margin:".2rem 0 0", color:"var(--muted)", fontSize:".8rem" }}>Banking, payables, expenses and accounting activity</p>
      </div>
      <button onClick={load} style={actionBtn(false)}>Refresh</button>
    </div>

    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:".8rem" }}>
      {kpis.map(([name,val,color,to]) => <button key={name} onClick={()=>navigate(to)} style={{ ...card, textAlign:"left", cursor:"pointer", minHeight:92 }}>
        <div style={label}>{name}</div><div style={{ fontSize:"1.35rem", fontWeight:800, marginTop:".35rem", color }}>{val}</div>
      </button>)}
    </div>

    <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
      <div><div style={label}>Quick Actions</div><div style={{ color:"var(--muted)", fontSize:".75rem", marginTop:".2rem" }}>Start the most common accounting entries</div></div>
      <div style={{ display:"flex", gap:".55rem", flexWrap:"wrap" }}>
        <button style={actionBtn(true)} onClick={()=>navigate("/transactions")}>+ Receipt</button>
        <button style={actionBtn(false)} onClick={()=>navigate("/transactions")}>+ Payment</button>
        <button style={actionBtn(false)} onClick={()=>navigate("/expenses")}>+ Expense</button>
        <button style={actionBtn(false)} onClick={()=>navigate("/payment-tracker")}>+ Payable</button>
      </div>
    </div>

    <div style={{ ...card, padding:0, overflow:"hidden" }}>
      <div style={{ padding:".9rem 1.05rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div><div style={{ fontWeight:700 }}>Recent Transactions</div><div style={{ color:"var(--muted)", fontSize:".72rem", marginTop:".15rem" }}>Latest bank receipts and payments</div></div>
        <button onClick={()=>navigate("/transactions")} style={actionBtn(false)}>View All</button>
      </div>
      <div style={{ overflowX:"auto" }}>
        {loading ? <div style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading dashboard…</div> :
        recentTransactions.length === 0 ? <div style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>No bank transactions yet.</div> :
        <table><thead><tr><th>Date</th><th>Type</th><th>Bank</th><th>Ledger</th><th>Amount</th><th>Narration</th></tr></thead>
        <tbody>{recentTransactions.map(r => {
          const receipt = Number(r.AmountIn || 0) > 0;
          const amount = receipt ? r.AmountIn : r.AmountOut;
          return <tr key={r.EntryID}>
            <td>{formatDate(r.Date)}</td>
            <td style={{ fontWeight:700, color:receipt ? "var(--success)" : "var(--danger)" }}>{receipt ? "Receipt" : "Payment"}</td>
            <td>{r.BankAccountName || "—"}</td>
            <td>{r.LedgerName || "—"}</td>
            <td style={{ fontWeight:700, color:receipt ? "var(--success)" : "var(--danger)" }}>{receipt ? "+" : "-"}{fmt(amount)}</td>
            <td style={{ color:"var(--muted)", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.Description || r.ReferenceID || "—"}</td>
          </tr>
        })}</tbody></table>}
      </div>
    </div>

    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))", gap:"1rem" }}>
      <div style={card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}><div><div style={{ fontWeight:700 }}>Upcoming Payables</div><div style={{ color:"var(--muted)", fontSize:".72rem" }}>Outstanding vendor bills</div></div><button style={actionBtn(false)} onClick={()=>navigate("/payment-tracker")}>Open</button></div>
        {payables.length === 0 ? <p style={{ color:"var(--muted)", fontSize:".8rem" }}>No outstanding payables.</p> : payables.map(p => <div key={p.PayableID || p.BillNo} style={{ display:"flex", justifyContent:"space-between", gap:"1rem", padding:".65rem 0", borderBottom:"1px solid var(--border)", fontSize:".78rem" }}>
          <div><div style={{ fontWeight:600 }}>{p.VendorName || "Vendor"}</div><div style={{ color:"var(--muted)", fontSize:".7rem" }}>{p.BillNo || "Bill"}{p.DueDate ? ` · Due ${formatDate(p.DueDate)}` : ""}</div></div>
          <strong style={{ color:"var(--warning)" }}>{fmt(p.BalanceAmount)}</strong>
        </div>)}
      </div>

      <div style={card}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}><div><div style={{ fontWeight:700 }}>Bank Accounts</div><div style={{ color:"var(--muted)", fontSize:".72rem" }}>Active operating accounts</div></div><button style={actionBtn(false)} onClick={()=>navigate("/bankaccounts")}>Manage</button></div>
        {activeBanks.length === 0 ? <p style={{ color:"var(--muted)", fontSize:".8rem" }}>No active bank accounts.</p> : activeBanks.map(a => <div key={a.AccountID || a.AccountNumber} style={{ display:"flex", justifyContent:"space-between", gap:"1rem", padding:".65rem 0", borderBottom:"1px solid var(--border)", fontSize:".78rem" }}>
          <div><div style={{ fontWeight:600 }}>{a.AccountName || a.BankName || "Bank"}</div><div style={{ color:"var(--muted)", fontSize:".7rem" }}>{a.BankName || ""}{a.AccountNumber ? ` · ...${String(a.AccountNumber).slice(-4)}` : ""}</div></div>
          <strong style={{ color:Number(a.CurrentBalance || 0) >= 0 ? "var(--success)" : "var(--danger)" }}>{fmt(a.CurrentBalance)}</strong>
        </div>)}
      </div>

      <div style={card}>
        <div style={{ fontWeight:700 }}>Compliance Snapshot</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:".75rem", marginTop:"1rem" }}>
          <div style={{ padding:".8rem", border:"1px solid var(--border)", borderRadius:7 }}><div style={label}>GST Input</div><div style={{ marginTop:".25rem", fontWeight:800, color:"var(--accent2)" }}>{fmt(gstAmount)}</div></div>
          <div style={{ padding:".8rem", border:"1px solid var(--border)", borderRadius:7 }}><div style={label}>TDS To Deduct</div><div style={{ marginTop:".25rem", fontWeight:800, color:"var(--danger)" }}>{fmt(tdsAmount)}</div></div>
        </div>
        <button style={{ ...actionBtn(false), marginTop:"1rem" }} onClick={()=>navigate("/reconciliation")}>Open Reconciliation</button>
      </div>

      <div style={card}>
        <div style={{ fontWeight:700 }}>Accounting</div>
        <div style={{ color:"var(--muted)", fontSize:".75rem", marginTop:".25rem" }}>Ledgers and transaction entry</div>
        <div style={{ display:"flex", gap:".55rem", flexWrap:"wrap", marginTop:"1rem" }}>
          <button style={actionBtn(false)} onClick={()=>navigate("/ledgers")}>Ledgers</button>
          <button style={actionBtn(false)} onClick={()=>navigate("/transactions")}>Transactions</button>
          <button style={actionBtn(false)} onClick={()=>navigate("/cashbook")}>Cash Book</button>
        </div>
      </div>
    </div>
  </div>;
}
