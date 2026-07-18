import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost } from "../api/client";
import { formatDate } from "../utils/format";

const card  = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const inp   = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const fmt   = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

const PENDING      = ["Draft", "Submitted", "Approved", "Pending"];
const REIMBURSED   = "Reimbursed";
const sourceColor  = { Expense: "#f59e0b", Payable: "#6366f1" };

export default function Reimbursements({ role = "admin", employeeRef = "" }) {
  const isOwn = (role === "partner" || role === "rm") && employeeRef;
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [reimbursing,  setReimbursing]  = useState(false);
  const [paidByFilter, setPaidByFilter] = useState("");
  const [settleFilter, setSettleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter,  setMonthFilter]  = useState("");
  const [selected,     setSelected]     = useState({});
  const [payment,      setPayment]      = useState({
    ReimburseDate: new Date().toISOString().slice(0, 10),
    ReimburseMode: "Bank",
    ReimburseAccount: "",
    ReimburseRef: "",
  });

  function loadData() {
    setLoading(true);
    apiGet("getReimbursementReport")
      .then(r => {
        if (r.ok) {
          setRows((r.data || []).map(row => ({
            ...row,
            SettlementTo: row.SettlementTo || row.ReimburseTo || row.PaidBy || "",
            ReimburseTo: row.ReimburseTo || row.SettlementTo || row.PaidBy || "",
            ActualPaidBy: row.ActualPaidBy || row.PaidBy || "",
            Amount: Number(row.Amount || 0),
          })));
        }
      })
      .finally(() => {
        setLoading(false);
        setSelected({});
      });
  }

  useEffect(() => { loadData(); }, []);

  const canManage = ["admin", "managing_partner"].includes(role);

  const allPaidBy = useMemo(() => [...new Set(rows.map(r => r.ActualPaidBy).filter(Boolean))].sort(), [rows]);
  const allSettleTo = useMemo(() => [...new Set(rows.map(r => r.SettlementTo).filter(Boolean))].sort(), [rows]);
  const allMonths = useMemo(() => [...new Set(rows.map(r => r.BillingMonth).filter(Boolean))].sort().reverse(), [rows]);

  const filtered = useMemo(() => {
    const base = isOwn
      ? rows.filter(r =>
          String(r.ActualPaidBy || "").trim() === String(employeeRef).trim() ||
          String(r.SettlementTo || "").trim() === String(employeeRef).trim()
        )
      : rows;
    return base.filter(r => {
      if (paidByFilter && r.ActualPaidBy !== paidByFilter) return false;
      if (settleFilter && r.SettlementTo !== settleFilter) return false;
      if (statusFilter && r.Status !== statusFilter) return false;
      if (monthFilter  && r.BillingMonth !== monthFilter) return false;
      return true;
    });
  }, [rows, paidByFilter, settleFilter, statusFilter, monthFilter, isOwn, employeeRef]);

  const summaryBase = isOwn
    ? rows.filter(r =>
        String(r.ActualPaidBy || "").trim() === String(employeeRef).trim() ||
        String(r.SettlementTo || "").trim() === String(employeeRef).trim()
      )
    : rows;

  const summary = useMemo(() => {
    const map = {};
    summaryBase.forEach(r => {
      if (!r.SettlementTo) return;
      if (!map[r.SettlementTo]) map[r.SettlementTo] = { total: 0, pending: 0, count: 0, pendingCount: 0 };
      map[r.SettlementTo].total += r.Amount;
      map[r.SettlementTo].count += 1;
      if (PENDING.includes(r.Status)) {
        map[r.SettlementTo].pending += r.Amount;
        map[r.SettlementTo].pendingCount += 1;
      }
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.pending - a.pending);
  }, [summaryBase]);

  const grandPending = summary.reduce((s, x) => s + x.pending, 0);
  const selectedRows = filtered.filter(r => selected[r.RefID] && PENDING.includes(r.Status));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.Amount, 0);
  const allPendingFiltered = filtered.filter(r => PENDING.includes(r.Status));
  const allVisibleSelected = allPendingFiltered.length > 0 && allPendingFiltered.every(r => selected[r.RefID]);
  const selectedSettleNames = [...new Set(selectedRows.map(r => r.SettlementTo).filter(Boolean))];

  function toggleAllVisible() {
    setSelected(prev => {
      const next = { ...prev };
      if (allVisibleSelected) allPendingFiltered.forEach(r => delete next[r.RefID]);
      else allPendingFiltered.forEach(r => { next[r.RefID] = true; });
      return next;
    });
  }

  async function reimburseSelected() {
    if (selectedRows.length === 0) return;
    setReimbursing(true);
    try {
      for (const row of selectedRows) {
        if (row.Source === "Payable") {
          await apiPost("reimbursePayable", {
            PayableID: row.RefID,
            ReimburseTo: row.SettlementTo,
            ReimbursementDate: payment.ReimburseDate,
            ReimbursementRef: payment.ReimburseRef,
            force: true,
          });
        } else {
          await apiPost("reimburseExpense", {
            ExpenseID: row.RefID,
            ReimburseTo: row.SettlementTo,
            ReimburseDate: payment.ReimburseDate,
            ReimburseMode: payment.ReimburseMode,
            ReimburseAccount: payment.ReimburseAccount || payment.ReimburseMode,
            ReimburseRef: payment.ReimburseRef,
            force: true,
          });
        }
      }
      loadData();
    } catch (err) {
      alert(err.message);
    } finally {
      setReimbursing(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Reimbursements Due</h2>
        <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>
          Expenses paid personally, grouped by the person the LLP will reimburse
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: ".75rem" }}>
        <div style={{ ...card, borderLeft: "3px solid var(--accent)" }}>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>Total Pending</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent)", marginTop: ".35rem" }}>{fmt(grandPending)}</div>
          <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".2rem" }}>Draft, Submitted &amp; Approved</div>
        </div>

        {summary.map(s => (
          <div
            key={s.name}
            style={{
              ...card,
              borderLeft: `3px solid ${s.pending > 0 ? "#f59e0b" : "#22c55e"}`,
              cursor: "pointer",
              outline: settleFilter === s.name ? "2px solid var(--accent)" : "none",
            }}
            onClick={() => setSettleFilter(p => p === s.name ? "" : s.name)}
          >
            <div style={{ fontSize: ".72rem", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>{s.name}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.pending > 0 ? "#f59e0b" : "#22c55e", marginTop: ".35rem" }}>{fmt(s.pending)}</div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".2rem" }}>
              {s.pendingCount} pending · {fmt(s.total)} total
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...card, display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
        {!isOwn && <div style={{ minWidth: "150px" }}>
          <select style={inp} value={paidByFilter} onChange={e => setPaidByFilter(e.target.value)}>
            <option value="">All actual payers</option>
            {allPaidBy.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>}
        {!isOwn && <div style={{ minWidth: "150px" }}>
          <select style={inp} value={settleFilter} onChange={e => setSettleFilter(e.target.value)}>
            <option value="">All reimburse to</option>
            {allSettleTo.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>}
        <div style={{ minWidth: "140px" }}>
          <select style={inp} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {["Draft", "Submitted", "Approved", "Pending", "Reimbursed", "Rejected"].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ minWidth: "140px" }}>
          <select style={inp} value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
            <option value="">All months</option>
            {allMonths.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        {(paidByFilter || settleFilter || statusFilter || monthFilter) && (
          <button
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", padding: ".5rem .8rem", color: "var(--muted)", fontSize: ".8rem", cursor: "pointer" }}
            onClick={() => { setPaidByFilter(""); setSettleFilter(""); setStatusFilter(""); setMonthFilter(""); }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: ".8rem", color: "var(--muted)" }}>
          {filtered.length} rows &nbsp;·&nbsp;
          <strong style={{ color: "var(--accent)" }}>{fmt(filtered.reduce((s, r) => s + r.Amount, 0))}</strong>
        </span>
      </div>

      {canManage && (
        <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: ".75rem", alignItems: "end" }}>
          <div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: ".35rem" }}>Selected to reimburse</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: selectedTotal > 0 ? "#22c55e" : "var(--muted)" }}>{fmt(selectedTotal)}</div>
            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
              {selectedRows.length} expense{selectedRows.length !== 1 ? "s" : ""}
              {selectedSettleNames.length === 1 ? ` to ${selectedSettleNames[0]}` : selectedSettleNames.length > 1 ? " across multiple receivers" : ""}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72rem", color: "var(--muted)", marginBottom: ".35rem" }}>Payment Date</label>
            <input style={inp} type="date" value={payment.ReimburseDate} onChange={e => setPayment(p => ({ ...p, ReimburseDate: e.target.value }))} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72rem", color: "var(--muted)", marginBottom: ".35rem" }}>Mode</label>
            <select style={inp} value={payment.ReimburseMode} onChange={e => setPayment(p => ({ ...p, ReimburseMode: e.target.value }))}>
              {["Bank", "UPI", "Cheque", "Petty Cash"].map(x => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72rem", color: "var(--muted)", marginBottom: ".35rem" }}>Account</label>
            <input style={inp} value={payment.ReimburseAccount} onChange={e => setPayment(p => ({ ...p, ReimburseAccount: e.target.value }))} placeholder="Company bank / petty cash" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72rem", color: "var(--muted)", marginBottom: ".35rem" }}>Reference</label>
            <input style={inp} value={payment.ReimburseRef} onChange={e => setPayment(p => ({ ...p, ReimburseRef: e.target.value }))} placeholder="UTR / cheque no." />
          </div>
          <button
            disabled={reimbursing || selectedRows.length === 0}
            onClick={reimburseSelected}
            style={{
              padding: ".55rem .8rem", borderRadius: "6px", border: "1px solid #22c55e",
              background: "#22c55e22", color: "#22c55e", fontWeight: 700,
              fontSize: ".8rem", cursor: selectedRows.length ? "pointer" : "not-allowed",
              opacity: reimbursing || selectedRows.length === 0 ? .55 : 1,
            }}
          >
            {reimbursing ? "Marking..." : "Mark Selected Reimbursed"}
          </button>
        </div>
      )}

      <div style={card}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>No records found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[
                    canManage ? (
                      <input key="select-all" type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                    ) : "",
                    "Date", "Source", "Actual Paid By", "Reimburse To", "Description", "Billing Month", "Amount", "Status", "Payment Ref"
                  ].map((h, idx) => (
                    <th key={idx} style={{ padding: ".5rem .65rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const isPending    = PENDING.includes(r.Status);
                  const isReimbursed = r.Status === REIMBURSED;
                  const isApproved   = r.Status === "Approved";
                  return (
                    <tr key={r.RefID || i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: ".5rem .65rem" }}>
                        {canManage && isPending && (
                          <input
                            type="checkbox"
                            checked={!!selected[r.RefID]}
                            onChange={e => setSelected(prev => ({ ...prev, [r.RefID]: e.target.checked }))}
                          />
                        )}
                      </td>
                      <td style={{ padding: ".5rem .65rem", whiteSpace: "nowrap" }}>{formatDate(r.Date)}</td>
                      <td style={{ padding: ".5rem .65rem" }}>
                        <span style={{
                          background: (sourceColor[r.Source] || "#6366f1") + "22",
                          color: sourceColor[r.Source] || "#6366f1",
                          padding: ".18rem .55rem", borderRadius: "99px",
                          fontSize: ".72rem", fontWeight: 600, whiteSpace: "nowrap",
                        }}>{r.Source}</span>
                      </td>
                      <td style={{ padding: ".5rem .65rem", fontWeight: 600 }}>{r.ActualPaidBy || r.PaidBy}</td>
                      <td style={{ padding: ".5rem .65rem", fontWeight: 600, color: r.SettlementTo !== r.ActualPaidBy ? "var(--accent)" : "var(--text)" }}>{r.SettlementTo}</td>
                      <td style={{ padding: ".5rem .65rem", color: "var(--text)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.Description || "-"}
                      </td>
                      <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{r.BillingMonth || "-"}</td>
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
                          {r.Status || "-"}
                        </span>
                      </td>
                      <td style={{ padding: ".5rem .65rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {r.ReimburseRef || r.ReimburseDate || "-"}
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
