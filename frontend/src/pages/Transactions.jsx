import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";
import { formatDate } from "../utils/format";

const card = {
  background:"var(--card)",
  border:"1px solid var(--border)",
  borderRadius:"var(--radius)",
  padding:"1.25rem",
};

const label = {
  display:"block",
  fontSize:".75rem",
  color:"var(--muted)",
  marginBottom:".35rem",
  fontWeight:500,
};

const btn = (v="primary") => ({
  padding:".55rem 1rem",
  borderRadius:"6px",
  cursor:"pointer",
  fontWeight:600,
  border:v==="primary" ? "none" : "1px solid var(--border)",
  background:v==="primary" ? "var(--accent)" : "transparent",
  color:v==="primary" ? "#fff" : "var(--muted)",
});

const input = {
  width:"100%",
  boxSizing:"border-box",
  padding:".55rem .7rem",
  background:"var(--input)",
  color:"var(--text)",
  border:"1px solid var(--border)",
  borderRadius:"6px",
};

const initial = {
  EntryID:"",
  BankAccountID:"",
  Date:"",
  Type:"Receipt",
  Amount:"",
  LedgerID:"",
  ReferenceID:"",
  Description:"",
};

const fmt = n =>
  "₹" + Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits:2,
    maximumFractionDigits:2,
  });

export default function Transactions() {
  const navigate = useNavigate();
  const { currentLLP } = useLLP();

  const [accounts,setAccounts] = useState([]);
  const [ledgers,setLedgers] = useState([]);
  const [transactions,setTransactions] = useState([]);
  const [form,setForm] = useState(initial);
  const [formOpen,setFormOpen] = useState(false);
  const [editing,setEditing] = useState(false);
  const [loading,setLoading] = useState(false);
  const [search,setSearch] = useState("");

  const scopeLabel = currentLLP?.global
    ? "All Entities"
    : (currentLLP?.llpName || currentLLP?.LLPName || "Selected LLP");

  async function load() {
    setLoading(true);

    try {
      const [bankResult, ledgerResult, txnResult] =
        await Promise.allSettled([
          apiGet("getBankAccounts"),
          apiGet("getLedgers"),
          apiGet("getBankTransactions"),
        ]);

      if (bankResult.status === "fulfilled" && bankResult.value.ok) {
        setAccounts(
          (bankResult.value.data || []).filter(
            row => row.IsActive !== "No"
          )
        );
      }

      if (ledgerResult.status === "fulfilled" && ledgerResult.value.ok) {
        setLedgers(
          (ledgerResult.value.data || []).filter(
            row => row.Status !== "Inactive"
          )
        );
      }

      if (txnResult.status === "fulfilled" && txnResult.value.ok) {
        setTransactions(txnResult.value.data || []);
      }
    } catch (err) {
      alert(err.message || "Unable to load transactions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [
    currentLLP?.llpId,
    currentLLP?.LLPID,
    currentLLP?.global,
  ]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;

    return transactions.filter(row =>
      [
        row.BankAccountName,
        row.BankName,
        row.LedgerName,
        row.ReferenceID,
        row.Description,
        row.Type,
      ].some(value =>
        String(value || "").toLowerCase().includes(q)
      )
    );
  }, [transactions, search]);

  function newTransaction(type="Receipt") {
    setEditing(false);
    setForm({
      ...initial,
      Type:type,
      Date:new Date().toISOString().slice(0,10),
    });
    setFormOpen(true);
  }

  function editTransaction(row) {
    setEditing(true);
    setForm({
      EntryID:row.EntryID,
      BankAccountID:row.BankAccountID || "",
      Date:row.Date || "",
      Type:Number(row.AmountIn || 0) > 0 ? "Receipt" : "Payment",
      Amount:String(
        Number(row.AmountIn || 0) > 0
          ? row.AmountIn
          : row.AmountOut || ""
      ),
      LedgerID:row.LedgerID || "",
      ReferenceID:row.ReferenceID || "",
      Description:row.Description || "",
    });
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();

    const amount = Number(form.Amount) || 0;

    if (!form.BankAccountID) {
      alert("Select a bank account");
      return;
    }

    if (!form.LedgerID) {
      alert("Select a ledger");
      return;
    }

    if (amount <= 0) {
      alert("Enter an amount greater than zero");
      return;
    }

    const isReceipt = form.Type === "Receipt";

    const payload = {
      BankAccountID:form.BankAccountID,
      Date:form.Date,
      Type:form.Type,
      AmountIn:isReceipt ? amount : "",
      AmountOut:isReceipt ? "" : amount,
      ReferenceType:"Ledger",
      ReferenceID:form.ReferenceID,
      Description:form.Description,
      LedgerID:form.LedgerID,
    };

    try {
      if (editing) {
        const r = await apiPost("updateBankTransaction", {
          ...payload,
          EntryID:form.EntryID,
        });

        if (!r.ok) {
          alert(r.error || "Unable to update transaction");
          return;
        }
      } else {
        const r = await apiPost("saveCashEntry", payload);

        if (!r.ok || !r.data?.EntryID) {
          alert(r.error || "Unable to save transaction");
          return;
        }

        await apiPost("postCashToLedger", {
          EntryID:r.data.EntryID,
          LedgerID:form.LedgerID,
        });
      }

      setForm(initial);
      setFormOpen(false);
      setEditing(false);
      await load();
    } catch (err) {
      alert(err.message || "Unable to save transaction");
    }
  }

  async function remove(row) {
    const label =
      row.ReferenceID ||
      row.Description ||
      row.EntryID;

    if (!window.confirm(`Delete transaction ${label}?`)) {
      return;
    }

    try {
      await apiPost("deleteBankTransaction", {
        EntryID:row.EntryID,
      });

      if (form.EntryID === row.EntryID) {
        setForm(initial);
        setFormOpen(false);
        setEditing(false);
      }

      await load();
    } catch (err) {
      alert(err.message || "Unable to delete transaction");
    }
  }

  const totalReceipts = transactions.reduce(
    (sum,row) => sum + Number(row.AmountIn || 0),
    0
  );

  const totalPayments = transactions.reduce(
    (sum,row) => sum + Number(row.AmountOut || 0),
    0
  );

  return (
    <div style={{
      display:"flex",
      flexDirection:"column",
      gap:"1.25rem",
    }}>
      <div style={{
        display:"flex",
        alignItems:"center",
        justifyContent:"space-between",
        gap:"1rem",
        flexWrap:"wrap",
      }}>
        <div>
          <h2 style={{
            fontWeight:700,
            fontSize:"1.25rem",
            color:"var(--text)",
          }}>
            Transactions
          </h2>

          <p style={{
            color:"var(--muted)",
            fontSize:".8rem",
            marginTop:".2rem",
          }}>
            Bank receipts and payments · {scopeLabel}
          </p>
        </div>

        <div style={{
          display:"flex",
          gap:".65rem",
          flexWrap:"wrap",
        }}>
          <button
            style={btn("ghost")}
            onClick={() => newTransaction("Payment")}
            disabled={accounts.length === 0}
          >
            + Payment
          </button>

          <button
            style={btn()}
            onClick={() => newTransaction("Receipt")}
            disabled={accounts.length === 0}
          >
            + Receipt
          </button>
        </div>
      </div>

      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",
        gap:"1rem",
      }}>
        <div style={card}>
          <div style={{
            fontSize:".7rem",
            color:"var(--muted)",
            fontWeight:700,
          }}>
            BANK RECEIPTS
          </div>
          <div style={{
            fontSize:"1.35rem",
            fontWeight:700,
            color:"var(--success)",
            marginTop:".3rem",
          }}>
            {fmt(totalReceipts)}
          </div>
        </div>

        <div style={card}>
          <div style={{
            fontSize:".7rem",
            color:"var(--muted)",
            fontWeight:700,
          }}>
            BANK PAYMENTS
          </div>
          <div style={{
            fontSize:"1.35rem",
            fontWeight:700,
            color:"var(--danger)",
            marginTop:".3rem",
          }}>
            {fmt(totalPayments)}
          </div>
        </div>

        <div style={card}>
          <div style={{
            fontSize:".7rem",
            color:"var(--muted)",
            fontWeight:700,
          }}>
            TOTAL TRANSACTIONS
          </div>
          <div style={{
            fontSize:"1.35rem",
            fontWeight:700,
            marginTop:".3rem",
          }}>
            {transactions.length}
          </div>
        </div>
      </div>

      {formOpen && (
        <div style={card}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
            marginBottom:"1rem",
          }}>
            <div>
              <h3 style={{fontWeight:700}}>
                {editing
                  ? `Edit ${form.Type}`
                  : `New ${form.Type}`}
              </h3>

              <div style={{
                fontSize:".75rem",
                color:"var(--muted)",
                marginTop:".2rem",
              }}>
                {form.Type === "Receipt"
                  ? "Money received into Zivara bank"
                  : "Money paid from Zivara bank"}
              </div>
            </div>

            <button
              type="button"
              style={btn("ghost")}
              onClick={() => {
                setFormOpen(false);
                setEditing(false);
                setForm(initial);
              }}
            >
              Close
            </button>
          </div>

          <form onSubmit={save}>
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",
              gap:"1rem",
            }}>
              <div>
                <label style={label}>Transaction Type</label>
                <select
                  style={input}
                  value={form.Type}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      Type:e.target.value,
                    }))
                  }
                >
                  <option>Receipt</option>
                  <option>Payment</option>
                </select>
              </div>

              <div>
                <label style={label}>Date *</label>
                <input
                  style={input}
                  type="date"
                  required
                  value={form.Date}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      Date:e.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label style={label}>Bank Account *</label>
                <select
                  style={input}
                  required
                  value={form.BankAccountID}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      BankAccountID:e.target.value,
                    }))
                  }
                >
                  <option value="">
                    — Select Zivara bank account —
                  </option>

                  {accounts.map(account => (
                    <option
                      key={account.AccountID}
                      value={account.AccountID}
                    >
                      {account.AccountName}
                      {" · "}
                      {account.BankName}
                      {" · "}
                      {String(
                        account.AccountNumber || ""
                      ).slice(-4)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={label}>
                  {form.Type === "Receipt"
                    ? "Credit Amount (₹) *"
                    : "Debit Amount (₹) *"}
                </label>

                <input
                  style={input}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={form.Amount}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      Amount:e.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <label style={label}>Ledger *</label>
                <select
                  style={input}
                  required
                  value={form.LedgerID}
                  onChange={e => {
                    if (e.target.value === "__ADD_NEW__") {
                      navigate("/ledgers");
                      return;
                    }

                    setForm(p => ({
                      ...p,
                      LedgerID:e.target.value,
                    }));
                  }}
                >
                  <option value="">
                    — Select counter ledger —
                  </option>

                  {ledgers.map(ledger => (
                    <option
                      key={ledger.LedgerID}
                      value={ledger.LedgerID}
                    >
                      {ledger.LedgerName}
                      {" · "}
                      {ledger.GroupName}
                    </option>
                  ))}

                  <option value="__ADD_NEW__">
                    + Add New Ledger
                  </option>
                </select>
              </div>

              <div>
                <label style={label}>Reference / UTR</label>
                <input
                  style={input}
                  placeholder="Bank UTR / cheque / reference"
                  value={form.ReferenceID}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      ReferenceID:e.target.value,
                    }))
                  }
                />
              </div>

              <div style={{gridColumn:"span 2"}}>
                <label style={label}>Narration</label>
                <input
                  style={input}
                  placeholder={
                    form.Type === "Receipt"
                      ? "e.g. Revenue received from Neo Wealth"
                      : "e.g. Reimbursement paid to Manugopal"
                  }
                  value={form.Description}
                  onChange={e =>
                    setForm(p => ({
                      ...p,
                      Description:e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div style={{
              marginTop:"1rem",
              padding:".8rem 1rem",
              border:"1px solid var(--border)",
              borderRadius:"8px",
              color:"var(--muted)",
              fontSize:".78rem",
            }}>
              {form.Type === "Receipt"
                ? "Accounting: Dr selected Bank Ledger · Cr selected Ledger"
                : "Accounting: Dr selected Ledger · Cr selected Bank Ledger"}
            </div>

            <div style={{
              display:"flex",
              gap:".75rem",
              marginTop:"1rem",
            }}>
              <button style={btn()} type="submit">
                {editing
                  ? "Update Transaction"
                  : `Save ${form.Type}`}
              </button>

              <button
                style={btn("ghost")}
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setEditing(false);
                  setForm(initial);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={card}>
        <label style={label}>Search Transactions</label>
        <input
          style={input}
          placeholder="Search bank, ledger, UTR or narration"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={{
        ...card,
        padding:0,
        overflow:"hidden",
      }}>
        <div style={{
          padding:".9rem 1.1rem",
          borderBottom:"1px solid var(--border)",
          display:"flex",
          justifyContent:"space-between",
        }}>
          <span style={{fontWeight:700}}>
            Bank Transactions
          </span>

          <span style={{
            color:"var(--muted)",
            fontSize:".75rem",
          }}>
            {filtered.length} record
            {filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        <div style={{overflowX:"auto"}}>
          {loading ? (
            <div style={{
              padding:"2rem",
              color:"var(--muted)",
              textAlign:"center",
            }}>
              Loading transactions…
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Bank Account</th>
                  <th>Bank Entry</th>
                  <th>Ledger</th>
                  <th>Reference / UTR</th>
                  <th>Narration</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan="8"
                      style={{
                        textAlign:"center",
                        color:"var(--muted)",
                        padding:"2.5rem",
                      }}
                    >
                      No bank transactions entered yet.
                    </td>
                  </tr>
                ) : (
                  filtered.map(row => {
                    const receipt =
                      Number(row.AmountIn || 0) > 0;

                    const amount = receipt
                      ? row.AmountIn
                      : row.AmountOut;

                    return (
                      <tr key={row.EntryID}>
                        <td style={{whiteSpace:"nowrap"}}>
                          {formatDate(row.Date)}
                        </td>

                        <td>
                          <span style={{
                            fontWeight:700,
                            color:receipt
                              ? "var(--success)"
                              : "var(--danger)",
                          }}>
                            {receipt ? "Receipt" : "Payment"}
                          </span>
                        </td>

                        <td>
                          <div style={{fontWeight:600}}>
                            {row.BankAccountName || "—"}
                          </div>
                          <div style={{
                            color:"var(--muted)",
                            fontSize:".72rem",
                          }}>
                            {row.BankName || ""}
                          </div>
                        </td>

                        <td style={{
                          fontWeight:700,
                          color:receipt
                            ? "var(--success)"
                            : "var(--danger)",
                        }}>
                          {receipt ? "Credit" : "Debit"}{" "}
                          {fmt(amount)}
                        </td>

                        <td style={{fontWeight:600}}>
                          {row.LedgerName || "—"}
                        </td>

                        <td>
                          {row.ReferenceID || "—"}
                        </td>

                        <td style={{
                          color:"var(--muted)",
                          maxWidth:"260px",
                          overflow:"hidden",
                          textOverflow:"ellipsis",
                          whiteSpace:"nowrap",
                        }}>
                          {row.Description || "—"}
                        </td>

                        <td style={{whiteSpace:"nowrap"}}>
                          <button
                            style={btn("ghost")}
                            onClick={() =>
                              editTransaction(row)
                            }
                          >
                            Edit
                          </button>

                          {" "}

                          <button
                            style={{
                              ...btn("ghost"),
                              color:"var(--danger)",
                            }}
                            onClick={() => remove(row)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{
        ...card,
        color:"var(--muted)",
        fontSize:".78rem",
      }}>
        Example: Neo Wealth pays ₹100 → Receipt → Zivara Bank →
        Neo Wealth Revenue ledger. The bank is shown as a ₹100 credit,
        while accounting posts Dr Bank / Cr Neo Wealth Revenue.
      </div>
    </div>
  );
}
