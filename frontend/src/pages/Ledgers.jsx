import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.25rem"};
const label={display:"block",fontSize:".75rem",color:"var(--muted)",marginBottom:".35rem",fontWeight:500};
const btn=(v="primary")=>({padding:".55rem 1rem",borderRadius:"6px",cursor:"pointer",fontWeight:600,background:v==="primary"?"var(--accent)":"transparent",color:v==="primary"?"#fff":"var(--muted)",border:v==="primary"?"none":"1px solid var(--border)"});
const input={width:"100%",boxSizing:"border-box",padding:".55rem .7rem",background:"var(--input)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:"6px"};
const DEFAULT_GROUPS=["Cash & Bank","Current Assets","Fixed Assets","Current Liabilities","Duties & Taxes","Capital","Partner Current Accounts","Income","Other Income","Administrative Expenses","Employee Costs","Other Expenses"];
const TYPES=["Asset","Liability","Equity","Income","Expense"];
const initial={LedgerCode:"",LedgerName:"",GroupName:"Current Assets",AccountType:"Asset",OpeningBalance:"",OpeningSide:"Dr",Status:"Active",Notes:""};
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

export default function Ledgers(){
  const [rows,setRows]=useState([]),[selected,setSelected]=useState(""),[statement,setStatement]=useState([]);
  const [form,setForm]=useState(initial),[formOpen,setFormOpen]=useState(false),[editId,setEditId]=useState("");
  const [loading,setLoading]=useState(false),[statementLoading,setStatementLoading]=useState(false),[search,setSearch]=useState("");
  const [customGroupOpen,setCustomGroupOpen]=useState(false),[customGroup,setCustomGroup]=useState("");

  async function load(preferredId=""){
    setLoading(true);
    try{
      const r=await apiGet("getLedgers");
      if(r.ok){
        const data=r.data||[]; setRows(data);
        const keepId=preferredId||selected;
        if(keepId&&data.some(x=>x.LedgerID===keepId)) setSelected(keepId);
        else if(selected&&!data.some(x=>x.LedgerID===selected)){setSelected("");setStatement([]);}
      }
    }catch(err){alert(err.message||"Unable to load ledgers");}
    finally{setLoading(false);}
  }

  async function loadStatement(id){
    setSelected(id);
    if(!id){setStatement([]);return;}
    setStatementLoading(true);
    try{const r=await apiGet("getLedgerStatement",{ledger_id:id});if(r.ok)setStatement(r.data||[]);}
    catch(err){setStatement([]);alert(err.message||"Unable to load ledger statement");}
    finally{setStatementLoading(false);}
  }

  useEffect(()=>{load();},[]);
  const selectedLedger=useMemo(()=>rows.find(r=>r.LedgerID===selected)||null,[rows,selected]);
  const groups=useMemo(()=>Array.from(new Set([...DEFAULT_GROUPS,...rows.map(r=>r.GroupName).filter(Boolean)])).sort((a,b)=>a.localeCompare(b)),[rows]);
  const filteredRows=useMemo(()=>{const q=search.trim().toLowerCase();if(!q)return rows;return rows.filter(r=>[r.LedgerName,r.LedgerCode,r.GroupName,r.AccountType].some(v=>String(v||"").toLowerCase().includes(q)));},[rows,search]);
  const currentBalance=useMemo(()=>{if(!selectedLedger)return null;if(statement.length){const last=statement[statement.length-1];return{amount:last.RunningBalance,side:last.BalanceSide};}return{amount:selectedLedger.OpeningBalance,side:selectedLedger.OpeningSide};},[selectedLedger,statement]);

  async function seedDefaults(){try{await apiPost("seedDefaultLedgers",{});await load(selected);}catch(err){alert(err.message||"Unable to create standard ledgers");}}
  function openAdd(){setForm(initial);setEditId("");setCustomGroupOpen(false);setCustomGroup("");setFormOpen(true);}
  function openEdit(row){setEditId(row.LedgerID);setForm({LedgerCode:row.LedgerCode||"",LedgerName:row.LedgerName||"",GroupName:row.GroupName||"",AccountType:row.AccountType||"Asset",OpeningBalance:row.OpeningBalance??"",OpeningSide:row.OpeningSide||"Dr",Status:row.Status||"Active",Notes:row.Notes||""});setCustomGroupOpen(false);setCustomGroup("");setFormOpen(true);}
  function chooseGroup(value){if(value==="__ADD_NEW__"){setCustomGroupOpen(true);setCustomGroup("");return;}setCustomGroupOpen(false);setCustomGroup("");setForm(p=>({...p,GroupName:value}));}
  function applyCustomGroup(){const value=customGroup.trim();if(!value){alert("Enter a group name");return;}setForm(p=>({...p,GroupName:value}));setCustomGroupOpen(false);}

  async function save(e){
    e.preventDefault();
    const payload={...form,GroupName:String(form.GroupName||"").trim()};
    if(!payload.GroupName){alert("Group is required");return;}
    try{
      const action=editId?"updateLedger":"saveLedger";
      const r=await apiPost(action,editId?{...payload,LedgerID:editId}:payload);
      const savedId=r?.data?.LedgerID||editId||"";
      setFormOpen(false);setEditId("");setForm(initial);setCustomGroupOpen(false);setCustomGroup("");
      await load(savedId);if(savedId)await loadStatement(savedId);
    }catch(err){alert(err.message||"Unable to save ledger");}
  }

  async function remove(row){
    if(!window.confirm(`Delete ledger "${row.LedgerName}"?\n\nLedgers with transactions cannot be deleted.`))return;
    try{await apiPost("deleteLedger",{LedgerID:row.LedgerID});if(selected===row.LedgerID){setSelected("");setStatement([]);}await load();}
    catch(err){alert(err.message||"Unable to delete ledger");}
  }

  function handleLedgerSelect(value){if(value==="__ADD_NEW__"){openAdd();return;}loadStatement(value);}

  return <div style={{display:"flex",flexDirection:"column",gap:"1.25rem",maxWidth:"1200px",margin:"0 auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
      <div><h2 style={{fontWeight:700,fontSize:"1.25rem"}}>Ledger Master</h2><p style={{color:"var(--muted)",fontSize:".8rem",marginTop:".2rem"}}>Select a ledger to view, edit and review its transactions.</p></div>
      <div style={{display:"flex",gap:".75rem",flexWrap:"wrap"}}><button style={btn("ghost")} onClick={seedDefaults}>Create Standard Ledgers</button><button style={btn()} onClick={openAdd}>+ Add Ledger</button></div>
    </div>

    <div style={card}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(220px,1fr) minmax(260px,2fr)",gap:"1rem",alignItems:"end"}}>
        <div><label style={label}>Search</label><input style={input} placeholder="Search ledger, code or group" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div><label style={label}>Ledger</label><select style={input} value={selected} disabled={loading} onChange={e=>handleLedgerSelect(e.target.value)}>
          <option value="">{loading?"Loading ledgers…":"— Select ledger —"}</option>
          {filteredRows.map(r=><option key={r.LedgerID} value={r.LedgerID}>{r.LedgerName}{r.LedgerCode?` · ${r.LedgerCode}`:""}{r.GroupName?` · ${r.GroupName}`:""}</option>)}
          <option value="__ADD_NEW__">+ Add New Ledger</option>
        </select></div>
      </div>
    </div>

    {formOpen&&<div style={card}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}><h3>{editId?"Edit Ledger":"New Ledger"}</h3><button type="button" style={btn("ghost")} onClick={()=>setFormOpen(false)}>Close</button></div>
      <form onSubmit={save}><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:"1rem"}}>
        <div><label style={label}>Ledger Code</label><input style={input} value={form.LedgerCode} onChange={e=>setForm(p=>({...p,LedgerCode:e.target.value}))}/></div>
        <div><label style={label}>Ledger Name *</label><input style={input} required value={form.LedgerName} onChange={e=>setForm(p=>({...p,LedgerName:e.target.value}))}/></div>
        <div><label style={label}>Group *</label><select style={input} value={customGroupOpen?"__ADD_NEW__":(groups.includes(form.GroupName)?form.GroupName:"__CURRENT_CUSTOM__")} onChange={e=>chooseGroup(e.target.value)}>
          {!groups.includes(form.GroupName)&&form.GroupName&&<option value="__CURRENT_CUSTOM__">{form.GroupName}</option>}
          {groups.map(g=><option key={g} value={g}>{g}</option>)}<option value="__ADD_NEW__">+ Add New Group</option>
        </select>{customGroupOpen&&<div style={{display:"flex",gap:".5rem",marginTop:".5rem"}}><input style={input} autoFocus placeholder="New group name" value={customGroup} onChange={e=>setCustomGroup(e.target.value)}/><button type="button" style={btn()} onClick={applyCustomGroup}>Add</button></div>}</div>
        <div><label style={label}>Type</label><select style={input} value={form.AccountType} onChange={e=>setForm(p=>({...p,AccountType:e.target.value}))}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
        <div><label style={label}>Opening Balance</label><input style={input} type="number" step="0.01" value={form.OpeningBalance} onChange={e=>setForm(p=>({...p,OpeningBalance:e.target.value}))}/></div>
        <div><label style={label}>Opening Side</label><select style={input} value={form.OpeningSide} onChange={e=>setForm(p=>({...p,OpeningSide:e.target.value}))}><option>Dr</option><option>Cr</option></select></div>
        <div><label style={label}>Status</label><select style={input} value={form.Status} onChange={e=>setForm(p=>({...p,Status:e.target.value}))}><option>Active</option><option>Inactive</option></select></div>
        <div><label style={label}>Notes</label><input style={input} value={form.Notes} onChange={e=>setForm(p=>({...p,Notes:e.target.value}))}/></div>
      </div><div style={{display:"flex",gap:".75rem",marginTop:"1rem"}}><button style={btn()} type="submit">{editId?"Update Ledger":"Save Ledger"}</button><button style={btn("ghost")} type="button" onClick={()=>setFormOpen(false)}>Cancel</button></div></form>
    </div>}

    {selectedLedger?<><div style={card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"1rem",flexWrap:"wrap"}}>
        <div><div style={{color:"var(--muted)",fontSize:".72rem",fontWeight:700,textTransform:"uppercase"}}>Selected Ledger</div><h3 style={{fontSize:"1.2rem",marginTop:".3rem"}}>{selectedLedger.LedgerName}</h3><div style={{color:"var(--muted)",fontSize:".8rem",marginTop:".25rem"}}>{selectedLedger.LedgerCode||"No code"} · {selectedLedger.GroupName} · {selectedLedger.AccountType}</div></div>
        <div style={{display:"flex",gap:".5rem"}}><button style={btn("ghost")} onClick={()=>openEdit(selectedLedger)}>Edit Ledger</button>{!selectedLedger.SystemKey&&<button style={{...btn("ghost"),color:"var(--danger)"}} onClick={()=>remove(selectedLedger)}>Delete Ledger</button>}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".75rem",marginTop:"1rem"}}>
        <div style={{padding:".85rem",border:"1px solid var(--border)",borderRadius:"8px"}}><div style={{fontSize:".7rem",color:"var(--muted)"}}>OPENING BALANCE</div><div style={{fontWeight:700,marginTop:".25rem"}}>{fmt(selectedLedger.OpeningBalance)} {selectedLedger.OpeningSide}</div></div>
        <div style={{padding:".85rem",border:"1px solid var(--border)",borderRadius:"8px"}}><div style={{fontSize:".7rem",color:"var(--muted)"}}>CURRENT BALANCE</div><div style={{fontWeight:700,marginTop:".25rem"}}>{currentBalance?`${fmt(currentBalance.amount)} ${currentBalance.side}`:"—"}</div></div>
        <div style={{padding:".85rem",border:"1px solid var(--border)",borderRadius:"8px"}}><div style={{fontSize:".7rem",color:"var(--muted)"}}>STATUS</div><div style={{fontWeight:700,marginTop:".25rem"}}>{selectedLedger.Status}</div></div>
        <div style={{padding:".85rem",border:"1px solid var(--border)",borderRadius:"8px"}}><div style={{fontSize:".7rem",color:"var(--muted)"}}>TRANSACTIONS</div><div style={{fontWeight:700,marginTop:".25rem"}}>{statement.length}</div></div>
      </div>
      {selectedLedger.SystemKey&&<div style={{marginTop:".9rem",color:"var(--muted)",fontSize:".75rem"}}>System-linked ledger: Delete is disabled to protect linked accounting data.</div>}
    </div>

    <div style={{...card,padding:0,overflow:"hidden"}}><div style={{padding:".9rem 1.1rem",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700}}>Ledger Statement</span><span style={{fontSize:".75rem",color:"var(--muted)"}}>{selectedLedger.LedgerName}</span></div>
      <div style={{overflowX:"auto"}}>{statementLoading?<div style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>Loading statement…</div>:<table><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>
        {statement.length===0?<tr><td colSpan="6" style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>No journal transactions for this ledger.</td></tr>:statement.map((r,i)=><tr key={`${r.JournalID}-${i}`}><td>{r.Date||"—"}</td><td>{r.VoucherType||"Journal"}{r.VoucherNo?` · ${r.VoucherNo}`:""}</td><td>{r.Narration||r.Particulars||"—"}</td><td>{Number(r.Debit||0)>0?fmt(r.Debit):"—"}</td><td>{Number(r.Credit||0)>0?fmt(r.Credit):"—"}</td><td style={{fontWeight:700}}>{fmt(r.RunningBalance)} {r.BalanceSide}</td></tr>)}
      </tbody></table>}</div>
    </div></>:<div style={{...card,textAlign:"center",color:"var(--muted)",padding:"2rem"}}>Select a ledger above to see its details, Edit/Delete options and ledger statement.</div>}
  </div>;
}
