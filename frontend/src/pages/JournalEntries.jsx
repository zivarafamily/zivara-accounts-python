import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";

const card = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "1rem",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: ".58rem .65rem",
  borderRadius: "7px",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
};

const btn = (primary = false) => ({
  border: primary ? "none" : "1px solid var(--border)",
  background: primary ? "var(--accent)" : "transparent",
  color: primary ? "#fff" : "var(--text)",
  borderRadius: "7px",
  padding: ".55rem .85rem",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: ".8rem",
});

const money = n =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = () => new Date().toISOString().slice(0, 10);

const blankLine = () => ({
  LedgerID: "",
  Debit: "",
  Credit: "",
  Particulars: "",
});

export default function JournalEntries() {
  const { currentLLP } = useLLP();
  const [ledgers, setLedgers] = useState([]);
  const [date, setDate] = useState(today());
  const [voucherNo, setVoucherNo] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadLedgers() {
    try {
      const res = await apiGet("getLedgers");
      if (res?.ok) {
        setLedgers(
          (res.data || []).filter(
            x => String(x.Status || "Active").toLowerCase() !== "inactive"
          )
        );
      }
    } catch (e) {
      setError(e?.message || "Could not load ledgers.");
    }
  }

  useEffect(() => {
    loadLedgers();
  }, [currentLLP?.llpId, currentLLP?.LLPID, currentLLP?.global]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, x) => s + Number(x.Debit || 0), 0);
    const credit = lines.reduce((s, x) => s + Number(x.Credit || 0), 0);
    return { debit, credit, difference: debit - credit };
  }, [lines]);

  const balanced =
    totals.debit > 0 &&
    totals.credit > 0 &&
    Math.abs(totals.difference) < 0.005;

  function updateLine(index, field, value) {
    setLines(prev =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, [field]: value };

        // A journal line can be debit OR credit, never both.
        if (field === "Debit" && Number(value || 0) > 0) next.Credit = "";
        if (field === "Credit" && Number(value || 0) > 0) next.Debit = "";

        return next;
      })
    );
    setError("");
    setMessage("");
  }

  function addLine() {
    setLines(prev => [...prev, blankLine()]);
  }

  function removeLine(index) {
    if (lines.length <= 2) return;
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setDate(today());
    setVoucherNo("");
    setNarration("");
    setLines([blankLine(), blankLine()]);
  }

  function validate() {
    if (!date) return "Date is required.";

    const used = lines.filter(
      x =>
        x.LedgerID ||
        Number(x.Debit || 0) > 0 ||
        Number(x.Credit || 0) > 0
    );

    if (used.length < 2) return "Enter at least two journal lines.";

    for (const line of used) {
      if (!line.LedgerID) return "Select a ledger for every journal line.";

      const dr = Number(line.Debit || 0);
      const cr = Number(line.Credit || 0);

      if (dr < 0 || cr < 0) return "Debit and credit cannot be negative.";
      if (dr > 0 && cr > 0)
        return "A journal line cannot contain both debit and credit.";
      if (dr <= 0 && cr <= 0)
        return "Each journal line must contain a debit or credit amount.";
    }

    if (!balanced)
      return `Journal is not balanced. Difference: ${money(
        Math.abs(totals.difference)
      )}`;

    return "";
  }

  async function save() {
    setError("");
    setMessage("");

    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        Date: date,
        VoucherType: "Journal",
        VoucherNo: voucherNo.trim(),
        Narration: narration.trim(),
        SourceType: "manual",
        Lines: lines
          .filter(
            x =>
              x.LedgerID &&
              (Number(x.Debit || 0) > 0 || Number(x.Credit || 0) > 0)
          )
          .map(x => ({
            LedgerID: x.LedgerID,
            Debit: Number(x.Debit || 0),
            Credit: Number(x.Credit || 0),
            Particulars: (x.Particulars || narration || "").trim(),
          })),
      };

      const res = await apiPost("saveJournal", payload);
      setMessage(
        `Journal saved successfully${res?.JournalID ? ` · ${res.JournalID}` : ""}.`
      );
      resetForm();
    } catch (e) {
      setError(e?.message || "Could not save journal entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800 }}>
          Journal Entry
        </h2>
        <p
          style={{
            margin: ".25rem 0 0",
            color: "var(--muted)",
            fontSize: ".8rem",
          }}
        >
          Use journals for accounting adjustments only — not normal bank
          receipts/payments or vendor bills.
        </p>
      </div>

      <div style={card}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(150px,220px) minmax(180px,280px) 1fr",
            gap: ".8rem",
          }}
        >
          <label style={{ fontSize: ".76rem", fontWeight: 700 }}>
            Date
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ ...inputStyle, marginTop: ".3rem" }}
            />
          </label>

          <label style={{ fontSize: ".76rem", fontWeight: 700 }}>
            Voucher No.
            <input
              value={voucherNo}
              onChange={e => setVoucherNo(e.target.value)}
              placeholder="Optional"
              style={{ ...inputStyle, marginTop: ".3rem" }}
            />
          </label>

          <label style={{ fontSize: ".76rem", fontWeight: 700 }}>
            Narration
            <input
              value={narration}
              onChange={e => setNarration(e.target.value)}
              placeholder="Reason for adjustment"
              style={{ ...inputStyle, marginTop: ".3rem" }}
            />
          </label>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div
          style={{
            padding: ".85rem 1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontWeight: 750 }}>Journal Lines</div>
            <div
              style={{
                color: "var(--muted)",
                fontSize: ".72rem",
                marginTop: ".1rem",
              }}
            >
              Total Debit must equal Total Credit.
            </div>
          </div>
          <button onClick={addLine} style={btn(false)}>
            + Add Line
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Ledger</th>
                <th style={{ minWidth: 130 }}>Debit</th>
                <th style={{ minWidth: 130 }}>Credit</th>
                <th style={{ minWidth: 240 }}>Particulars</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <select
                      value={line.LedgerID}
                      onChange={e =>
                        updateLine(index, "LedgerID", e.target.value)
                      }
                      style={inputStyle}
                    >
                      <option value="">Select ledger...</option>
                      {ledgers.map(l => (
                        <option key={l.LedgerID} value={l.LedgerID}>
                          {l.LedgerName} · {l.GroupName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.Debit}
                      onChange={e => updateLine(index, "Debit", e.target.value)}
                      placeholder="0.00"
                      style={{ ...inputStyle, textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.Credit}
                      onChange={e => updateLine(index, "Credit", e.target.value)}
                      placeholder="0.00"
                      style={{ ...inputStyle, textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <input
                      value={line.Particulars}
                      onChange={e =>
                        updateLine(index, "Particulars", e.target.value)
                      }
                      placeholder="Optional line note"
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      onClick={() => removeLine(index)}
                      disabled={lines.length <= 2}
                      title="Remove line"
                      style={{
                        ...btn(false),
                        padding: ".4rem .55rem",
                        opacity: lines.length <= 2 ? 0.35 : 1,
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: ".9rem 1rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "var(--muted)", fontSize: ".68rem" }}>
                TOTAL DEBIT
              </div>
              <strong>{money(totals.debit)}</strong>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: ".68rem" }}>
                TOTAL CREDIT
              </div>
              <strong>{money(totals.credit)}</strong>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: ".68rem" }}>
                DIFFERENCE
              </div>
              <strong
                style={{
                  color: balanced
                    ? "var(--success)"
                    : totals.debit || totals.credit
                    ? "var(--danger)"
                    : "var(--muted)",
                }}
              >
                {money(Math.abs(totals.difference))}
              </strong>
            </div>
          </div>

          <div style={{ display: "flex", gap: ".55rem" }}>
            <button onClick={resetForm} style={btn(false)}>
              Clear
            </button>
            <button
              onClick={save}
              disabled={saving || !balanced}
              style={{
                ...btn(true),
                opacity: saving || !balanced ? 0.55 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Journal"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            ...card,
            borderColor: "var(--danger)",
            color: "var(--danger)",
            fontSize: ".8rem",
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            ...card,
            borderColor: "var(--success)",
            color: "var(--success)",
            fontSize: ".8rem",
          }}
        >
          {message}
        </div>
      )}

      <div style={{ ...card, fontSize: ".78rem", color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>Example — FD maturity adjustment:</strong>{" "}
        if the bank receipt has already been entered in Transactions, post only
        the adjustment here, e.g. Dr Fixed Deposit ₹1,923 + Dr TDS Receivable
        ₹214 / Cr Interest Income ₹2,137.
      </div>
    </div>
  );
}
