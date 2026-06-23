import { useState } from "react";
import { importAccountsWorkbook, importNeoInvoicesCsv, importNeoRevenueWorkbook } from "../api/client";
import { billingMonthOptions } from "../utils/format";

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn = (v = "primary") => ({
  padding:".55rem 1rem", borderRadius:"6px", border:v === "ghost" ? "1px solid var(--border)" : "none",
  fontWeight:600, fontSize:".84rem", cursor:"pointer",
  background:v === "primary" ? "var(--accent)" : "transparent",
  color:v === "primary" ? "#fff" : "var(--muted)",
});

const IMPORTS = [
  {
    key: "Clients",
    title: "Clients",
    sheets: "Clients",
    columns: "ClientID, ClientName, PAN, RMName, Segment, PartnerName, LLPName, FamilyName, SuperFamilyName, Status",
  },
  {
    key: "NeoRevenue",
    title: "Neo Revenue",
    sheets: "NeoRevenue",
    columns: "RevenueID, PAN, ClientName, PartnerName, TransactionDate, Product, SchemeName, RevenueMonth, RevenueAmount, LLPName",
  },
  {
    key: "Expenses",
    title: "Expenses",
    sheets: "Expenses",
    columns: "LLPID, Date, ExpenseType, Category, PaidBy, PaymentMode, Amount, VendorOrPerson, Description, BillAvailable, Status",
  },
  {
    key: "LLPPayables",
    title: "Payables",
    sheets: "LLPPayables or Payables",
    columns: "LLPID, VendorName, BillNo, BillDate, TaxableAmount, GSTAmount, GrossAmount, TDSSection, TDSRate, PaidAmount, Status",
  },
  {
    key: "BankStatement",
    title: "Bank Statement",
    sheets: "BankStatement or BankStatements",
    columns: "LLPID, Date, Description/Narration, Debit/Withdrawal, Credit/Deposit, Balance, ReferenceNo/UTR",
  },
];

function skippedRows(result) {
  if (!result) return [];
  return Object.entries(result).flatMap(([module, summary]) => (
    Array.isArray(summary?.errors)
      ? summary.errors.map(err => ({ module, ...err, data: err.data || {} }))
      : []
  ));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadSkippedRows(result) {
  const rows = skippedRows(result);
  if (!rows.length) return;

  const dataKeys = Array.from(new Set(rows.flatMap(row => Object.keys(row.data || {})))).sort();
  const headers = ["Module", "SourceRow", "Reason", ...dataKeys];
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map(row => [
      row.module,
      row.row,
      row.message,
      ...dataKeys.map(key => row.data?.[key] ?? ""),
    ].map(csvCell).join(",")),
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `skipped-import-rows-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function skippedBreakdown(rows) {
  const counts = new Map();
  rows.forEach(row => {
    const month = row.data?.RevenueMonth || row.data?.BillingMonth || row.data?.Month || "No month";
    const key = [row.module, month, row.message].join("\u001f");
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([key, count]) => {
      const [module, month, reason] = key.split("\u001f");
      return { module, month, reason, count };
    })
    .sort((a, b) => b.count - a.count || a.module.localeCompare(b.module) || a.month.localeCompare(b.month));
}

function SummaryCard({ title, summary }) {
  const imported = summary?.imported || 0;
  const skipped = summary?.skipped || 0;
  return (
    <div style={{ ...card, padding:"1rem" }}>
      <div style={{ fontWeight:700, color:"var(--text)" }}>{title}</div>
      <div style={{ display:"flex", gap:"1rem", marginTop:".65rem", flexWrap:"wrap" }}>
        <span style={{ color:"var(--success)", fontWeight:700 }}>{imported} imported</span>
        <span style={{ color: skipped ? "var(--warning)" : "var(--muted)", fontWeight:700 }}>{skipped} skipped</span>
      </div>
      {Array.isArray(summary?.errors) && summary.errors.length > 0 && (
        <div style={{ marginTop:".75rem", display:"flex", flexDirection:"column", gap:".3rem" }}>
          {summary.errors.slice(0, 5).map((err, idx) => (
            <div key={`${err.row}-${idx}`} style={{ fontSize:".75rem", color:"var(--danger)" }}>
              Row {err.row}: {err.message}
            </div>
          ))}
          {summary.errors.length > 5 && <div style={{ fontSize:".75rem", color:"var(--muted)" }}>+{summary.errors.length - 5} more</div>}
        </div>
      )}
    </div>
  );
}

export default function Imports() {
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [neoRevenueFile, setNeoRevenueFile] = useState(null);
  const [neoRevenueMonth, setNeoRevenueMonth] = useState("");
  const [neoRevenueFileInputKey, setNeoRevenueFileInputKey] = useState(0);
  const [neoRevenueBusy, setNeoRevenueBusy] = useState(false);
  const [neoFile, setNeoFile] = useState(null);
  const [neoFileInputKey, setNeoFileInputKey] = useState(0);
  const [neoBusy, setNeoBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const skipped = skippedRows(result);
  const skippedGroups = skippedBreakdown(skipped);
  const monthOptions = billingMonthOptions(30, 6);

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await importAccountsWorkbook(file);
      setResult(res.summary || {});
      setFile(null);
      setFileInputKey(key => key + 1);
    } catch (err) {
      setError(err.message || "Unable to import workbook");
    } finally {
      setBusy(false);
    }
  }

  async function submitNeoInvoices(e) {
    e.preventDefault();
    if (!neoFile) return;
    setNeoBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await importNeoInvoicesCsv(neoFile);
      setResult(res.summary || {});
      setNeoFile(null);
      setNeoFileInputKey(key => key + 1);
    } catch (err) {
      setError(err.message || "Unable to import NeoInvoices CSV");
    } finally {
      setNeoBusy(false);
    }
  }

  async function submitNeoRevenue(e) {
    e.preventDefault();
    if (!neoRevenueFile || !neoRevenueMonth) return;
    setNeoRevenueBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await importNeoRevenueWorkbook(neoRevenueFile, neoRevenueMonth);
      setResult(res.summary || {});
      setNeoRevenueFile(null);
      setNeoRevenueFileInputKey(key => key + 1);
    } catch (err) {
      setError(err.message || "Unable to import Neo Revenue workbook");
    } finally {
      setNeoRevenueBusy(false);
    }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div>
        <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Import Excel</h2>
        <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>
          Upload one workbook to import expenses, payables, and bank statement rows.
        </p>
      </div>

      <div style={card}>
        <form onSubmit={submit} style={{ display:"flex", gap:"1rem", alignItems:"end", flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 280px" }}>
            <label style={label}>Workbook (.xlsx or .xlsm)</label>
            <input
              key={fileInputKey}
              type="file"
              accept=".xlsx,.xlsm"
              onChange={e => setFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <button type="submit" style={btn()} disabled={!file || busy}>{busy ? "Importing..." : "Import Workbook"}</button>
          {file && <button type="button" style={btn("ghost")} onClick={() => { setFile(null); setResult(null); setFileInputKey(key => key + 1); }}>Clear</button>}
        </form>
        {error && <div style={{ color:"var(--danger)", fontSize:".8rem", marginTop:".75rem" }}>{error}</div>}
      </div>

      <div style={card}>
        <form onSubmit={submitNeoRevenue} style={{ display:"flex", gap:"1rem", alignItems:"end", flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 220px" }}>
            <label style={label}>Neo Revenue month</label>
            <select style={{ width:"100%", padding:".5rem .65rem", borderRadius:"6px", border:"1px solid var(--border)", background:"var(--input)", color:"var(--text)" }} value={neoRevenueMonth} onChange={e => setNeoRevenueMonth(e.target.value)} required>
              <option value="">Select month</option>
              {monthOptions.map(month => <option key={month} value={month}>{month}</option>)}
            </select>
          </div>
          <div style={{ flex:"1 1 280px" }}>
            <label style={label}>Neo Revenue workbook (.xlsx or .xlsm)</label>
            <input
              key={neoRevenueFileInputKey}
              type="file"
              accept=".xlsx,.xlsm"
              onChange={e => setNeoRevenueFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <button type="submit" style={btn()} disabled={!neoRevenueFile || !neoRevenueMonth || neoRevenueBusy}>
            {neoRevenueBusy ? "Importing..." : "Import Neo Revenue"}
          </button>
          {neoRevenueFile && <button type="button" style={btn("ghost")} onClick={() => { setNeoRevenueFile(null); setResult(null); setNeoRevenueFileInputKey(key => key + 1); }}>Clear</button>}
        </form>
        <div style={{ color:"var(--muted)", fontSize:".75rem", marginTop:".65rem" }}>
          Imports only the selected Gross Revenue month from the Neo statement.
        </div>
      </div>

      <div style={card}>
        <form onSubmit={submitNeoInvoices} style={{ display:"flex", gap:"1rem", alignItems:"end", flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 280px" }}>
            <label style={label}>NeoInvoices CSV (.csv)</label>
            <input
              key={neoFileInputKey}
              type="file"
              accept=".csv"
              onChange={e => setNeoFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <button type="submit" style={btn()} disabled={!neoFile || neoBusy}>{neoBusy ? "Importing..." : "Import Neo Invoices"}</button>
          {neoFile && <button type="button" style={btn("ghost")} onClick={() => { setNeoFile(null); setResult(null); setNeoFileInputKey(key => key + 1); }}>Clear</button>}
        </form>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:"1rem" }}>
        {IMPORTS.map(item => (
          <div key={item.key} style={{ ...card, padding:"1rem" }}>
            <div style={{ fontWeight:700 }}>{item.title}</div>
            <div style={{ fontSize:".72rem", color:"var(--muted)", marginTop:".45rem" }}>Sheet: {item.sheets}</div>
            <div style={{ fontSize:".72rem", color:"var(--muted)", marginTop:".45rem", lineHeight:1.5 }}>{item.columns}</div>
          </div>
        ))}
      </div>

      {result && (
        <>
          {skipped.length > 0 && (
            <div style={{ ...card, display:"flex", flexDirection:"column", gap:".9rem" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontWeight:700 }}>Skipped rows found</div>
                  <div style={{ fontSize:".78rem", color:"var(--muted)", marginTop:".25rem" }}>
                    Export {skipped.length} skipped rows with reasons and source values.
                  </div>
                </div>
                <button type="button" style={btn()} onClick={() => downloadSkippedRows(result)}>
                  Export skipped rows for Excel
                </button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:".45rem" }}>
                {skippedGroups.slice(0, 8).map(group => (
                  <div key={`${group.module}-${group.month}-${group.reason}`} style={{ fontSize:".75rem", color:"var(--muted)", border:"1px solid var(--border)", borderRadius:"6px", padding:".55rem .65rem" }}>
                    <strong style={{ color:"var(--text)" }}>{group.count}</strong> skipped · {group.module} · {group.month}
                    <div style={{ color:"var(--danger)", marginTop:".2rem" }}>{group.reason}</div>
                  </div>
                ))}
                {skippedGroups.length > 8 && (
                  <div style={{ fontSize:".75rem", color:"var(--muted)", padding:".55rem .65rem" }}>
                    +{skippedGroups.length - 8} more groups in export
                  </div>
                )}
              </div>
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:"1rem" }}>
            <SummaryCard title="Expenses" summary={result.Expenses} />
            <SummaryCard title="Clients" summary={result.Clients} />
            <SummaryCard title="Neo Revenue" summary={result.NeoRevenue} />
            <SummaryCard title="Payables" summary={result.LLPPayables} />
            <SummaryCard title="Neo Invoices" summary={result.NeoInvoices} />
            <SummaryCard title="Bank Statement" summary={result.BankStatement} />
          </div>
        </>
      )}
    </div>
  );
}
