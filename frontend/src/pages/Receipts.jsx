import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { formatDate, billingMonthOptions } from "../utils/format";

const initial = {
  Date:"", ReferenceType:"Receipt", ReferenceNo:"", Month:"", AmountReceived:"",
  ReceiptMode:"Bank", BankAccount:"", Notes:""
};

const card  = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn   = (v="primary") => ({
  padding:".55rem 1.2rem", borderRadius:"6px", border:"none",
  fontWeight:600, fontSize:".875rem", cursor:"pointer",
  background: v==="primary" ? "var(--accent)" : "transparent",
  color: v==="primary" ? "#fff" : "var(--muted)",
});

const MODE_COLOR = { Bank:"var(--accent)", NEFT:"var(--accent2)", UPI:"var(--success)", Cash:"var(--warning)", Cheque:"var(--muted)" };

function Badge({ v, colors }) {
  const c = (colors||{})[v] || "var(--muted)";
  return <span style={{ fontSize:".7rem", padding:".2rem .6rem", borderRadius:"99px", fontWeight:600,
    background:c+"22", color:c, border:`1px solid ${c}` }}>{v}</span>;
}

const fmt = n => n != null && n !== "" ? "₹"+Number(n).toLocaleString("en-IN") : "—";

export default function Receipts() {
  const [receipts, setReceipts]   = useState([]);
  const [form, setForm]           = useState(initial);
  const [loading, setLoading]     = useState(false);
  const [formOpen, setFormOpen]   = useState(false);
  const [editId, setEditId]       = useState(null);

  async function load() {
    setLoading(true);
    try { const r = await apiGet("getReceipts"); if (r.ok) setReceipts(r.data||[]); }
    catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd()  { setForm(initial); setEditId(null); setFormOpen(true); }
  function openEdit(r) {
    setForm({ Date:r.Date||"", ReferenceType:r.ReferenceType||"Receipt", ReferenceNo:r.ReferenceNo||"", Month:r.Month||"",
      AmountReceived:r.AmountReceived||"", ReceiptMode:r.ReceiptMode||"Bank",
      BankAccount:r.BankAccount||"", ReferenceNo:r.ReferenceNo||"", Notes:r.Notes||"" });
    setEditId(r.ReceiptID); setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    const action = editId ? "updateReceipt" : "saveReceipt";
    const payload = editId ? { ...form, ReceiptID: editId } : form;
    const r = await apiPost(action, payload);
    if (r.ok) { setFormOpen(false); setEditId(null); setForm(initial); load(); }
    else alert(r.error || "Error saving");
  }

  const totalReceived = receipts.reduce((s,r) => s+Number(r.AmountReceived||0), 0);
  const thisMonth = new Date().toISOString().slice(0,7);
  const monthReceipts = receipts.filter(r => (r.Month||r.Date||"").startsWith(thisMonth));
  const monthTotal = monthReceipts.reduce((s,r) => s+Number(r.AmountReceived||0), 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Receipts</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>Track all incoming payments</p>
        </div>
        <button style={btn()} onClick={openAdd}>+ Add Receipt</button>
      </div>

      <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
        {[
          { label:"TOTAL RECEIVED",        value:fmt(totalReceived), color:"var(--success)" },
          { label:"THIS MONTH",            value:fmt(monthTotal),    color:"var(--accent2)" },
          { label:"TOTAL TRANSACTIONS",    value:receipts.length,    color:"var(--accent)" },
        ].map(s => (
          <div key={s.label} style={{ ...card, flex:1, minWidth:160, padding:".9rem 1.25rem" }}>
            <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>{s.label}</div>
            <div style={{ fontSize:"1.4rem", fontWeight:700, color:s.color, marginTop:".25rem" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div style={card}>
          <h3 style={{ fontWeight:600, marginBottom:"1rem", color:"var(--text)" }}>{editId ? "Edit Receipt" : "New Receipt"}</h3>
          <form onSubmit={save}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:"1rem" }}>
              <div><label style={label}>Date *</label><input type="date" value={form.Date} onChange={e=>set("Date",e.target.value)} required /></div>
              <div><label style={label}>Reference Type</label><input placeholder="Receipt / Capital / Refund" value={form.ReferenceType} onChange={e=>set("ReferenceType",e.target.value)} /></div>
              <div><label style={label}>Month</label>
                <select value={form.Month} onChange={e=>set("Month",e.target.value)}>
                  <option value="">— Select month —</option>
                  {billingMonthOptions().map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div><label style={label}>Amount Received (₹) *</label><input type="number" min="0" placeholder="0" value={form.AmountReceived} onChange={e=>set("AmountReceived",e.target.value)} required /></div>
              <div><label style={label}>Receipt Mode</label>
                <select value={form.ReceiptMode} onChange={e=>set("ReceiptMode",e.target.value)}>
                  {["Bank","NEFT","UPI","Cash","Cheque"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Bank Account</label><input placeholder="e.g. HDFC Current" value={form.BankAccount} onChange={e=>set("BankAccount",e.target.value)} /></div>
              <div><label style={label}>Reference / UTR No</label><input placeholder="TXN12345" value={form.ReferenceNo} onChange={e=>set("ReferenceNo",e.target.value)} /></div>
              <div><label style={label}>Notes</label><input placeholder="Any notes" value={form.Notes} onChange={e=>set("Notes",e.target.value)} /></div>
            </div>
            <div style={{ display:"flex", gap:".75rem", marginTop:"1.25rem" }}>
              <button type="submit" style={btn()}>{editId ? "Update" : "Save Receipt"}</button>
              <button type="button" style={btn("ghost")} onClick={()=>{ setFormOpen(false); setEditId(null); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:600, fontSize:".875rem" }}>All Receipts</span>
          <span style={{ fontSize:".75rem", color:"var(--muted)" }}>{receipts.length} record{receipts.length!==1?"s":""}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading…</p> : (
            <table>
              <thead>
                <tr><th>Date</th><th>Reference Type</th><th>Month</th><th>Amount</th><th>Mode</th><th>Bank Account</th><th>Reference No</th><th>Notes</th><th></th></tr>
              </thead>
              <tbody>
                {receipts.length===0
                  ? <tr><td colSpan="9" style={{ textAlign:"center", color:"var(--muted)", padding:"2.5rem" }}>No receipts yet</td></tr>
                  : receipts.map(r => (
                    <tr key={r.ReceiptID}>
                      <td style={{ whiteSpace:"nowrap" }}>{formatDate(r.Date)}</td>
                      <td style={{ color:"var(--accent2)", fontFamily:"monospace", fontSize:".85rem" }}>{r.ReferenceType}</td>
                      <td style={{ color:"var(--muted)" }}>{r.Month}</td>
                      <td style={{ fontWeight:700, color:"var(--success)" }}>{fmt(r.AmountReceived)}</td>
                      <td><Badge v={r.ReceiptMode} colors={MODE_COLOR}/></td>
                      <td style={{ color:"var(--muted)", fontSize:".8rem" }}>{r.BankAccount}</td>
                      <td style={{ fontFamily:"monospace", fontSize:".8rem", color:"var(--muted)" }}>{r.ReferenceNo}</td>
                      <td style={{ color:"var(--muted)", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.Notes}</td>
                      <td><button onClick={()=>openEdit(r)} style={{ background:"transparent", border:"1px solid var(--border)", color:"var(--muted)", borderRadius:"6px", padding:".3rem .7rem", fontSize:".75rem", cursor:"pointer" }}>Edit</button></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}
