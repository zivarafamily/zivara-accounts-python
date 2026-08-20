import { useEffect,useMemo,useState } from "react";
import { apiGet,apiPost } from "../api/client";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.25rem"};
const inp={width:"100%",boxSizing:"border-box",padding:".55rem .7rem",background:"var(--input)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:"6px"};
const btn=(p=false)=>({padding:".55rem .9rem",borderRadius:"6px",cursor:"pointer",fontWeight:600,border:p?"none":"1px solid var(--border)",background:p?"var(--accent)":"transparent",color:p?"#fff":"var(--muted)"});
const types=["Asset","Liability","Equity","Income","Expense"];
const standardGroups=["Cash & Bank","Current Assets","Fixed Assets","Investments","Capital Advances","Accounts Receivable","Accounts Payable","Current Liabilities","Other Current Liabilities","Partner Current Accounts","Staff Current Accounts","Duties & Taxes","Capital","Income","Administrative Expenses","Employee Costs","Other Expenses"];
const initial={LedgerCode:"",LedgerName:"",GroupName:"Current Assets",AccountType:"Asset",OpeningBalance:"",OpeningSide:"Dr",Status:"Active",Notes:""};
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2});

function typeForGroup(g){
  if(["Cash & Bank","Current Assets","Fixed Assets","Investments","Capital Advances","Accounts Receivable"].includes(g)) return "Asset";
  if(["Accounts Payable","Current Liabilities","Other Current Liabilities","Partner Current Accounts","Staff Current Accounts","Duties & Taxes"].includes(g)) return "Liability";
  if(g==="Capital") return "Equity";
  if(g==="Income") return "Income";
  if(["Administrative Expenses","Employee Costs","Other Expenses"].includes(g)) return "Expense";
  return "";
}

export default function Ledgers(){
  const[rows,setRows]=useState([]),[selected,setSelected]=useState(""),[statement,setStatement]=useState([]),[search,setSearch]=useState(""),[open,setOpen]=useState(false),[editId,setEditId]=useState(""),[form,setForm]=useState(initial),[customGroup,setCustomGroup]=useState(false);

  async function load(){const r=await apiGet("getLedgers");if(r.ok)setRows(r.data||[])}
  async function pick(id){setSelected(id);if(!id)return setStatement([]);const r=await apiGet("getLedgerStatement",{ledger_id:id});if(r.ok)setStatement(r.data||[])}
  useEffect(()=>{load()},[]);

  const ledger=useMemo(()=>rows.find(x=>x.LedgerID===selected),[rows,selected]);
  const groups=useMemo(()=>[...new Set([...standardGroups,...rows.map(x=>x.GroupName).filter(Boolean)])].sort((a,b)=>a.localeCompare(b)),[rows]);
  const filtered=rows.filter(x=>!search||[x.LedgerName,x.LedgerCode,x.GroupName].some(v=>String(v||"").toLowerCase().includes(search.toLowerCase())));

  function add(){setEditId("");setForm(initial);setCustomGroup(false);setOpen(true)}
  function edit(){if(!ledger)return;setEditId(ledger.LedgerID);setForm({LedgerCode:ledger.LedgerCode||"",LedgerName:ledger.LedgerName||"",GroupName:ledger.GroupName||"",AccountType:ledger.AccountType||"Asset",OpeningBalance:ledger.OpeningBalance??"",OpeningSide:ledger.OpeningSide||"Dr",Status:ledger.Status||"Active",Notes:ledger.Notes||""});setCustomGroup(false);setOpen(true)}
  function changeGroup(value){if(value==="__CUSTOM__"){setCustomGroup(true);setForm(p=>({...p,GroupName:""}));return} const t=typeForGroup(value);setCustomGroup(false);setForm(p=>({...p,GroupName:value,AccountType:t||p.AccountType}))}
  async function save(e){e.preventDefault();if(!form.GroupName.trim())return alert("Select or enter a Group");const r=await apiPost(editId?"updateLedger":"saveLedger",editId?{...form,LedgerID:editId}:form);const id=r.data?.LedgerID||editId;setOpen(false);await load();if(id)await pick(id)}
  async function del(){if(!ledger||!confirm(`Delete ledger "${ledger.LedgerName}"?`))return;try{await apiPost("deleteLedger",{LedgerID:ledger.LedgerID});setSelected("");setStatement([]);await load()}catch(err){alert(err.message)}}

  return <div style={{display:"flex",flexDirection:"column",gap:"1.25rem"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap"}}><div><h2>Ledger Master</h2><p style={{color:"var(--muted)"}}>Select a ledger to see details and transactions.</p></div><button style={btn(true)} onClick={add}>+ Add Ledger</button></div>

    <div style={card}>
      <input style={inp} placeholder="Search ledger, code or group" value={search} onChange={e=>setSearch(e.target.value)}/>
      <select style={{...inp,marginTop:".75rem"}} value={selected} onChange={e=>e.target.value==="__NEW__"?add():pick(e.target.value)}>
        <option value="">— Select ledger —</option>
        {filtered.map(x=><option key={x.LedgerID} value={x.LedgerID}>{x.LedgerName} · {x.GroupName}</option>)}
        <option value="__NEW__">+ Add New Ledger</option>
      </select>
    </div>

    {open&&<form style={card} onSubmit={save}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".75rem"}}>
        <input style={inp} placeholder="Ledger Code" value={form.LedgerCode} onChange={e=>setForm({...form,LedgerCode:e.target.value})}/>
        <input style={inp} required placeholder="Ledger Name" value={form.LedgerName} onChange={e=>setForm({...form,LedgerName:e.target.value})}/>
        {!customGroup?
          <select style={inp} value={form.GroupName} onChange={e=>changeGroup(e.target.value)} required>
            <option value="">— Select Group —</option>
            {groups.map(g=><option key={g} value={g}>{g}</option>)}
            <option value="__CUSTOM__">+ Add New Group</option>
          </select>
          :
          <div style={{display:"flex",gap:".4rem"}}><input style={inp} autoFocus required placeholder="Custom group name" value={form.GroupName} onChange={e=>setForm({...form,GroupName:e.target.value})}/><button type="button" style={btn()} onClick={()=>{setCustomGroup(false);setForm(p=>({...p,GroupName:""}))}}>Back</button></div>
        }
        <select style={inp} value={form.AccountType} onChange={e=>setForm({...form,AccountType:e.target.value})}>{types.map(t=><option key={t}>{t}</option>)}</select>
        <input style={inp} type="number" step=".01" placeholder="Opening Balance" value={form.OpeningBalance} onChange={e=>setForm({...form,OpeningBalance:e.target.value})}/>
        <select style={inp} value={form.OpeningSide} onChange={e=>setForm({...form,OpeningSide:e.target.value})}><option>Dr</option><option>Cr</option></select>
        <select style={inp} value={form.Status} onChange={e=>setForm({...form,Status:e.target.value})}><option>Active</option><option>Inactive</option></select>
        <input style={inp} placeholder="Notes" value={form.Notes} onChange={e=>setForm({...form,Notes:e.target.value})}/>
      </div>
      {form.GroupName==="Fixed Assets"&&<div style={{marginTop:".8rem",padding:".65rem .8rem",border:"1px solid var(--border)",borderRadius:"6px",color:"var(--muted)",fontSize:".75rem"}}>For the Zivara car use <strong style={{color:"var(--text)"}}>Motor Vehicle · Fixed Assets · Asset</strong>.</div>}
      <div style={{marginTop:"1rem"}}><button style={btn(true)} type="submit">Save</button>{" "}<button style={btn()} type="button" onClick={()=>setOpen(false)}>Cancel</button></div>
    </form>}

    {ledger&&<>
      <div style={card}>
        <div style={{display:"flex",justifyContent:"space-between",gap:"1rem"}}>
          <div><div style={{fontSize:".72rem",color:"var(--muted)"}}>SELECTED LEDGER</div><h3>{ledger.LedgerName}</h3><div style={{color:"var(--muted)"}}>{ledger.LedgerCode} · {ledger.GroupName} · {ledger.AccountType}</div></div>
          <div><button style={btn()} onClick={edit}>Edit</button>{!ledger.SystemKey&&<>{" "}<button style={{...btn(),color:"var(--danger)"}} onClick={del}>Delete</button></>}</div>
        </div>
        <div style={{marginTop:".75rem"}}>Opening: <strong>{fmt(ledger.OpeningBalance)} {ledger.OpeningSide}</strong> · Status: <strong>{ledger.Status}</strong> · Transactions: <strong>{statement.length}</strong></div>
      </div>
      <div style={{...card,padding:0,overflow:"hidden"}}>
        <table><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
        <tbody>{statement.length?statement.map((r,i)=><tr key={`${r.JournalID}-${i}`}><td>{r.Date||"—"}</td><td>{r.VoucherType}{r.VoucherNo?` · ${r.VoucherNo}`:""}</td><td>{r.Narration||r.Particulars||"—"}</td><td>{Number(r.Debit||0)>0?fmt(r.Debit):"—"}</td><td>{Number(r.Credit||0)>0?fmt(r.Credit):"—"}</td><td>{fmt(r.RunningBalance)} {r.BalanceSide}</td></tr>):<tr><td colSpan="6" style={{padding:"2rem",textAlign:"center"}}>No transactions</td></tr>}</tbody></table>
      </div>
    </>}
  </div>
}
