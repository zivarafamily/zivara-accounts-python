import { useState } from "react";
import { importAccountsWorkbook, importNeoInvoicesCsv } from "../api/client";

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
    columns: "RevenueID, PAN, ClientName, RMName, TransactionDate, Product, SchemeName, RevenueMonth, RevenueAmount, PartnerName, LLPName",
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
  const [neoFile, setNeoFile] = useState(null);
  const [neoFileInputKey, setNeoFileInputKey] = useState(0);
  const [neoBusy, setNeoBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

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
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))", gap:"1rem" }}>
          <SummaryCard title="Expenses" summary={result.Expenses} />
          <SummaryCard title="Clients" summary={result.Clients} />
          <SummaryCard title="Neo Revenue" summary={result.NeoRevenue} />
          <SummaryCard title="Payables" summary={result.LLPPayables} />
          <SummaryCard title="Neo Invoices" summary={result.NeoInvoices} />
          <SummaryCard title="Bank Statement" summary={result.BankStatement} />
        </div>
      )}
    </div>
  );
}
