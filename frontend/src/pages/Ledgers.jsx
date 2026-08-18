import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn = (v="primary") => ({
  padding:".55rem 1rem", borderRadius:"6px", cursor:"pointer", fontWeight:600,
  background:v==="primary" ? "var(--accent)" : "transparent",
  color:v==="primary" ? "#fff" : "var(--muted)",
  border:v==="primary" ? "none" : "1px solid var(--border)",
});
const input = { width:"100%", boxSizing:"border-box", padding:".5rem .65rem", background:"var(--input)", color:"var(--text)", border:"1px solid var(--border)", borderRadius:"6px" };
const initial = { LedgerCode:"", LedgerName:"", GroupName:"Current Assets", AccountType:"Asset", OpeningBalance:"", OpeningSide:"Dr", Status:"Active", Notes:"" };
const groups = ["Cash & Bank","Current Assets","Fixed Assets","Current Liabilities","Duties & Taxes","Capital","Income","Other Income","Administrative Expenses","Employee Costs","Other Expenses"];
const types = ["Asset","Liability","Equity","Income","Expense"];
const fmt = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits:2 });

export default function Ledgers() {
  const [rows,setRows] = useState([]);
  const [selected,setSelected] = useState("");
  const [statement,setStatement] = useState([]);
  const [form,setForm] = useState(initial);
  const [formOpen,setFormOpen] = useState(false);
  const [editId,setEditId] = useState("");
  const [loading,setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await apiGet("getLedgers");
      if (r.ok) setRows(r.data || []);
    } finally { setLoading(false); }
  }

  async function loadStatement(id) {
    setSelected(id);
    if (!id) { setStatement([]); return; }
    const r = await apiGet("getLedgerStatement", { ledger_id:id });
    if (r.ok) setStatement(r.data || []);
  }

  useEffect(()=>{ load(); },[]);

  const selectedLedger = useMemo(()=>rows.find(r=>r.LedgerID===selected),[rows,selected]);

  async function seedDefaults() {
    await apiPost("seedDefaultLedgers", {});
    await load();
  }

  function openAdd() { setForm(initial); setEditId(""); setFormOpen(true); }
  function openEdit(row) {
    setEditId(row.LedgerID);
    setForm({
      LedgerCode:row.LedgerCode||"", LedgerName:row.LedgerName||"", GroupName:row.GroupName||"",
      AccountType:row.AccountType||"Asset", OpeningBalance:row.OpeningBalance||"",
      OpeningSide:row.OpeningSide||"Dr", Status:row.Status||"Active", Notes:row.Notes||"",
    });
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    const action = editId ? "updateLedger" : "saveLedger";
    await apiPost(action, editId ? { ...form, LedgerID:editId } : form);
    setFormOpen(false); setEditId(""); setForm(initial); await load();
  }

  async function remove(row) {
    if (!window.confirm(`Delete ledger "${row.LedgerName}"?`)) return;
    await apiPost("deleteLedger", { LedgerID:row.LedgerID });
    if (selected === row.LedgerID) { setSelected(""); setStatement([]); }
    await load();
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.25rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
        <div>
          <h2 style={{fontWeight:700,fontSize:"1.25rem"}}>Ledger Master</h2>
          <p style={{color:"var(--muted)",fontSize:".8rem",marginTop:".2rem"}}>Chart of accounts and ledger statements</p>
        </div>
        <div style={{display:"flex",gap:".75rem"}}>
          <button style={btn("ghost")} onClick={seedDefaults}>Create Standard Ledgers</button>
          <button style={btn()} onClick={openAdd}>+ Add Ledger</button>
        </div>
      </div>

      {formOpen && <div style={card}>
        <h3 style={{marginBottom:"1rem"}}>{editId ? "Edit Ledger" : "New Ledger"}</h3>
        <form onSubmit={save}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:"1rem"}}>
            <div><label style={label}>Ledger Code</label><input style={input} value={form.LedgerCode} onChange={e=>setForm(p=>({...p,LedgerCode:e.target.value}))}/></div>
            <div><label style={label}>Ledger Name *</label><input style={input} required value={form.LedgerName} onChange={e=>setForm(p=>({...p,LedgerName:e.target.value}))}/></div>
            <div><label style={label}>Group</label><select style={input} value={form.GroupName} onChange={e=>setForm(p=>({...p,GroupName:e.target.value}))}>{groups.map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label style={label}>Type</label><select style={input} value={form.AccountType} onChange={e=>setForm(p=>({...p,AccountType:e.target.value}))}>{types.map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label style={label}>Opening Balance</label><input style={input} type="number" step="0.01" value={form.OpeningBalance} onChange={e=>setForm(p=>({...p,OpeningBalance:e.target.value}))}/></div>
            <div><label style={label}>Opening Side</label><select style={input} value={form.OpeningSide} onChange={e=>setForm(p=>({...p,OpeningSide:e.target.value}))}><option>Dr</option><option>Cr</option></select></div>
            <div><label style={label}>Status</label><select style={input} value={form.Status} onChange={e=>setForm(p=>({...p,Status:e.target.value}))}><option>Active</option><option>Inactive</option></select></div>
            <div><label style={label}>Notes</label><input style={input} value={form.Notes} onChange={e=>setForm(p=>({...p,Notes:e.target.value}))}/></div>
          </div>
          <div style={{display:"flex",gap:".75rem",marginTop:"1rem"}}>
            <button style={btn()} type="submit">Save Ledger</button>
            <button style={btn("ghost")} type="button" onClick={()=>setFormOpen(false)}>Cancel</button>
          </div>
        </form>
      </div>}

      <div style={{display:"grid",gridTemplateColumns:"minmax(360px,1fr) minmax(420px,1.3fr)",gap:"1rem"}}>
        <div style={{...card,padding:0,overflow:"hidden"}}>
          <div style={{padding:".8rem 1rem",borderBottom:"1px solid var(--border)",fontWeight:600}}>Ledgers</div>
          <div style={{overflowX:"auto"}}>
            <table>
              <thead><tr><th>Code</th><th>Ledger</th><th>Group</th><th>Opening</th><th></th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="5">Loading…</td></tr> :
                rows.map(row=><tr key={row.LedgerID} onClick={()=>loadStatement(row.LedgerID)} style={{cursor:"pointer",background:selected===row.LedgerID?"rgba(99,102,241,.12)":"transparent"}}>
                  <td>{row.LedgerCode}</td>
                  <td style={{fontWeight:600}}>{row.LedgerName}</td>
                  <td>{row.GroupName}</td>
                  <td>{fmt(row.OpeningBalance)} {row.OpeningSide}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <button style={btn("ghost")} onClick={()=>openEdit(row)}>Edit</button>
                    {!row.SystemKey && <button style={{...btn("ghost"),marginLeft:".35rem",color:"var(--danger)"}} onClick={()=>remove(row)}>Delete</button>}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{...card,padding:0,overflow:"hidden"}}>
          <div style={{padding:".8rem 1rem",borderBottom:"1px solid var(--border)",fontWeight:600}}>
            {selectedLedger ? selectedLedger.LedgerName : "Ledger Statement"}
          </div>
          {!selectedLedger ? <div style={{padding:"2rem",color:"var(--muted)"}}>Select a ledger to view transactions.</div> :
          <div style={{overflowX:"auto"}}>
            <table>
              <thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
              <tbody>
                {statement.length===0 ? <tr><td colSpan="6" style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>No journal transactions</td></tr> :
                statement.map((r,i)=><tr key={`${r.JournalID}-${i}`}>
                  <td>{r.Date||"—"}</td>
                  <td>{r.VoucherType}{r.VoucherNo?` · ${r.VoucherNo}`:""}</td>
                  <td>{r.Narration||r.Particulars||"—"}</td>
                  <td>{r.Debit?fmt(r.Debit):"—"}</td>
                  <td>{r.Credit?fmt(r.Credit):"—"}</td>
                  <td style={{fontWeight:700}}>{fmt(r.RunningBalance)} {r.BalanceSide}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        </div>
      </div>
    </div>
  );
}
