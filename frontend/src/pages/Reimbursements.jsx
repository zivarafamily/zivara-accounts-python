import { useEffect, useState, useMemo } from "react";
import { gasGet, gasPost } from "../api/client";
import { formatDate } from "../utils/format";

const card  = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const inp   = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const fmt   = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

const PENDING      = ["Draft", "Submitted"];
const REIMBURSED   = "Reimbursed";
const sourceColor  = { "Legacy Client Gifting": "#ec4899", "Expense": "#f59e0b", "Petty Cash": "#6366f1" };
const SOURCE_ACTION = { "Expense": "updateExpense" };
const SOURCE_ID     = { "Expense": "ExpenseID" };

export default function Reimbursements({ role = "admin", employeeRef = "" }) {
  const isOwn = (role === "partner" || role === "rm") && employeeRef;
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [reimbursing,  setReimbursing]  = useState(null); // RefID being processed
  const [paidByFilter, setPaidByFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter,  setMonthFilter]  = useState("");

  function loadData() {
    setLoading(true);
    gasGet("getReimbursementReport")
      .then(r => { if (r.ok) setRows(r.data || []); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadData(); }, []);

  async function reimburse(row) {
    if (!SOURCE_ACTION[row.Source]) return;
    setReimbursing(row.RefID);
    try {
      await gasPost(SOURCE_ACTION[row.Source], {
        [SOURCE_ID[row.Source]]: row.RefID,
        Status: REIMBURSED,
      });
      loadData();
    } catch (err) {
      alert(err.message);
    } finally {
      setReimbursing(null);
    }
  }

  const allPaidBy = useMemo(() => [...new Set(rows.map(r => r.PaidBy).filter(Boolean))].sort(), [rows]);
  const allMonths = useMemo(() => [...new Set(rows.map(r => r.BillingMonth).filter(Boolean))].sort().reverse(), [rows]);

  const filtered = useMemo(() => {
    const base = isOwn
      ? rows.filter(r => String(r.PaidBy || "").trim() === String(employeeRef).trim())
      : rows;
    return base.filter(r => {
      if (paidByFilter && r.PaidBy !== paidByFilter) return false;
      if (statusFilter && r.Status !== statusFilter) return false;
      if (monthFilter  && r.BillingMonth !== monthFilter) return false;
      return true;
    });
  }, [rows, paidByFilter, statusFilter, monthFilter, isOwn, employeeRef]);

  // Per-person summary — scoped to own rows if partner/rm
  const summaryBase = isOwn ? rows.filter(r => String(r.PaidBy || "").trim() === String(employeeRef).trim()) : rows;
  const summary = useMemo(() => {
    const map = {};
    summaryBase.forEach(r => {
      if (!r.PaidBy) return;
      if (!map[r.PaidBy]) map[r.PaidBy] = { total: 0, pending: 0, count: 0, pendingCount: 0 };
      map[r.PaidBy].total       += r.Amount;
      map[r.PaidBy].count       += 1;
      if (PENDING.includes(r.Status)) {
        map[r.PaidBy].pending      += r.Amount;
        map[r.PaidBy].pendingCount += 1;
      }
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.pending - a.pending);
  }, [summaryBase]);

  const grandPending = summary.reduce((s, x) => s + x.pending, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Reimbursements Due</h2>
        <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>
          Staff who paid on behalf of Zivara — pending amounts to be reimbursed
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: ".75rem" }}>

        {/* Grand total card */}
        <div style={{ ...card, borderLeft: "3px solid var(--accent)" }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>Total Pending</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent)", marginTop: ".35rem" }}>{fmt(grandPending)}</div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".2rem" }}>across {isOwn ? "your" : "all staff"} · Draft &amp; Submitted</div>
        </div>

        {/* Per-person cards — click to filter */}
        {summary.map(s => (
          <div
            key={s.name}
            style={{
              ...card,
              borderLeft: `3px solid ${s.pending > 0 ? "#f59e0b" : "#22c55e"}`,
              cursor: "pointer",
              outline: paidByFilter === s.name ? "2px solid var(--accent)" : "none",
            }}
            onClick={() => setPaidByFilter(p => p === s.name ? "" : s.name)}
          >
            <div style={{ fontSize: ".72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>{s.name}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.pending > 0 ? "#f59e0b" : "#22c55e", marginTop: ".35rem" }}>{fmt(s.pending)}</div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".2rem" }}>
              {s.pendingCount} pending · {fmt(s.total)} total
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ ...card, display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
        {/* Paid By filter — hide for partner/rm (already scoped to their own) */}
        {!isOwn && <div style={{ minWidth: "150px" }}>
          <select style={inp} value={paidByFilter} onChange={e => setPaidByFilter(e.target.value)}>
            <option value="">All Staff</option>
            {allPaidBy.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>}
        <div style={{ minWidth: "140px" }}>
          <select style={inp} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {["Draft", "Submitted", "Reimbursed", "Approved", "Rejected"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ minWidth: "140px" }}>
          <select style={inp} value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
            <option value="">All Months</option>
            {allMonths.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        {(paidByFilter || statusFilter || monthFilter) && (
          <button
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", padding: ".5rem .8rem", color: "var(--muted)", fontSize: ".8rem", cursor: "pointer" }}
            onClick={() => { setPaidByFilter(""); setStatusFilter(""); setMonthFilter(""); }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: ".8rem", color: "var(--muted)" }}>
          {filtered.length} rows &nbsp;·&nbsp;
          <strong style={{ color: "var(--accent)" }}>{fmt(filtered.reduce((s, r) => s + r.Amount, 0))}</strong>
        </span>
      </div>

      {/* Detail table */}
      <div style={card}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>No records found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Date", "Source", "Paid By", "Description", "Billing Month", "Amount", "Status", ""].map(h => (
                    <th key={h} style={{ padding: ".5rem .65rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const isPending    = PENDING.includes(r.Status);
                  const isReimbursed = r.Status === REIMBURSED;
                  const isApproved   = r.Status === "Approved";
                  const canReimburse = isPending && SOURCE_ACTION[r.Source] && ["admin","managing_partner"].includes(role);
                  return (
                    <tr key={r.RefID || i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: ".5rem .65rem", whiteSpace: "nowrap" }}>{formatDate(r.Date)}</td>
                      <td style={{ padding: ".5rem .65rem" }}>
                        <span style={{
                          background: (sourceColor[r.Source] || "#6366f1") + "22",
                          color: sourceColor[r.Source] || "#6366f1",
                          padding: ".18rem .55rem", borderRadius: "99px",
                          fontSize: ".72rem", fontWeight: 600, whiteSpace: "nowrap",
                        }}>{r.Source}</span>
                      </td>
                      <td style={{ padding: ".5rem .65rem", fontWeight: 600 }}>{r.PaidBy}</td>
                      <td style={{ padding: ".5rem .65rem", color: "var(--text)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.Description || "—"}
                      </td>
                      <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{r.BillingMonth || "—"}</td>
                      <td style={{ padding: ".5rem .65rem", fontWeight: 700, whiteSpace: "nowrap", color: isPending ? "#f59e0b" : "var(--muted)" }}>
                        {fmt(r.Amount)}
                      </td>
                      <td style={{ padding: ".5rem .65rem" }}>
                        <span style={{
                          padding: ".18rem .55rem", borderRadius: "99px", fontSize: ".72rem", fontWeight: 600,
                          background: isPending    ? "#f59e0b22" :
                                      isReimbursed ? "#22c55e22" :
                                      isApproved   ? "#22c55e22" : "#6b728022",
                          color:      isPending    ? "#f59e0b"   :
                                      isReimbursed ? "#22c55e"   :
                                      isApproved   ? "#22c55e"   : "var(--muted)",
                        }}>
                          {r.Status || "—"}
                        </span>
                      </td>
                      <td style={{ padding: ".5rem .4rem" }}>
                        {canReimburse && (
                          <button
                            onClick={() => reimburse(r)}
                            disabled={reimbursing === r.RefID}
                            style={{
                              padding: ".25rem .65rem", borderRadius: "6px", border: "1px solid #22c55e",
                              background: "#22c55e22", color: "#22c55e", fontWeight: 600,
                              fontSize: ".75rem", cursor: "pointer", whiteSpace: "nowrap",
                              opacity: reimbursing === r.RefID ? .5 : 1,
                            }}
                          >
                            {reimbursing === r.RefID ? "…" : "✓ Reimburse"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
