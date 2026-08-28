import { useEffect,useMemo,useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet,apiPost } from "../api/client";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.25rem"};
const inp={width:"100%",boxSizing:"border-box",padding:".55rem .7rem",background:"var(--input)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:"6px"};
const btn=(p=false)=>({padding:".55rem .9rem",borderRadius:"6px",cursor:"pointer",fontWeight:600,border:p?"none":"1px solid var(--border)",background:p?"var(--accent)":"transparent",color:p?"#fff":"var(--muted)"});
const types=["Asset","Liability","Equity","Income","Expense"];
const standardGroups=["Cash & Bank","Current Assets","Fixed Assets","Investments","Capital Advances","Accounts Receivable","Accounts Payable","Current Liabilities","Other Current Liabilities","Partner Current Accounts","Staff Current Accounts","Duties & Taxes","Capital","Income","Administrative Expenses","Employee Costs","Other Expenses"];
const initial={LedgerCode:"",LedgerName:"",GroupName:"Current Assets",AccountType:"Asset",OpeningBalance:"",OpeningSide:"Dr",Status:"Active",Notes:""};
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const dmy=v=>{const s=String(v||"").slice(0,10),p=s.split("-");return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:s};

function typeForGroup(g){
  if(["Cash & Bank","Current Assets","Fixed Assets","Investments","Capital Advances","Accounts Receivable"].includes(g))return"Asset";
  if(["Accounts Payable","Current Liabilities","Other Current Liabilities","Partner Current Accounts","Staff Current Accounts","Duties & Taxes"].includes(g))return"Liability";
  if(g==="Capital")return"Equity";
  if(g==="Income")return"Income";
  if(["Administrative Expenses","Employee Costs","Other Expenses"].includes(g))return"Expense";
  return"";
}

function sourceKind(row){
  const source=String(row.SourceType||"").toLowerCase();
  const voucher=String(row.VoucherType||"").toLowerCase();
  if(source==="expense"||voucher==="expense")return"Expenses";
  if(source==="cash_book"||["bank","cash","payment","receipt"].includes(voucher))return"Bank Transfers";
  if(source==="manual"||voucher==="journal")return"Journals";
  if(["payable","purchase","vendor_bill"].includes(source)||voucher==="purchase")return"Vendor Bills";
  return"Other";
}

function journalClass(row){
  if(sourceKind(row)!=="Journals")return "";
  const n=String(row.Narration||row.Particulars||"").toLowerCase();
  if(n.includes("refund")||n.includes("cancel"))return "Refund / Cancellation";
  if((n.includes("paid to")||n.includes("transfer"))&&(n.includes("dinu")||n.includes("manu")||n.includes("manugopal")))return "Inter-person Settlement";
  if(n.includes("opening"))return "Opening Adjustment";
  return "Adjustment";
}
function sourceAction(row){
  const source=String(row.SourceType||"").toLowerCase();
  const voucher=String(row.VoucherType||"").toLowerCase();
  const id=row.SourceID||row.JournalID||"";
  if(source==="expense"||voucher==="expense")return{label:"Edit Expense",path:`/expenses?edit=${encodeURIComponent(row.SourceID||"")}`};
  if(["payable","purchase","vendor_bill"].includes(source)||voucher==="purchase")return{label:"Edit Vendor Bill",path:`/payment-tracker?edit=${encodeURIComponent(row.SourceID||"")}`};
  if(source==="cash_book"||["bank","cash","payment","receipt"].includes(voucher))return{label:"Edit Transaction",path:`/transactions?edit=${encodeURIComponent(row.SourceID||"")}`};
  if(source==="manual"||voucher==="journal")return{label:"Edit Journal",path:`/journal-entries?edit=${encodeURIComponent(row.JournalID||id)}`};
  if(source.includes("neo")||voucher.includes("invoice"))return{label:"View Source",path:"/neoinvoices"};
  return null;
}

export default function Ledgers(){
  const navigate=useNavigate();
  const[rows,setRows]=useState([]),[selected,setSelected]=useState(""),[statement,setStatement]=useState([]),[search,setSearch]=useState(""),[open,setOpen]=useState(false),[editId,setEditId]=useState(""),[form,setForm]=useState(initial),[customGroup,setCustomGroup]=useState(false),[sourceFilter,setSourceFilter]=useState("All");

  async function load(){const r=await apiGet("getLedgers");if(r.ok)setRows(r.data||[])}
  async function pick(id){setSelected(id);setSourceFilter("All");if(!id)return setStatement([]);const r=await apiGet("getLedgerStatement",{ledger_id:id});if(r.ok)setStatement(r.data||[])}
  useEffect(()=>{load()},[]);

  const ledger=useMemo(()=>rows.find(x=>x.LedgerID===selected),[rows,selected]);
  const groups=useMemo(()=>[...new Set([...standardGroups,...rows.map(x=>x.GroupName).filter(Boolean)])].sort((a,b)=>a.localeCompare(b)),[rows]);
  const filtered=rows.filter(x=>!search||[x.LedgerName,x.LedgerCode,x.GroupName].some(v=>String(v||"").toLowerCase().includes(search.toLowerCase())));
  const current=statement.length?statement[statement.length-1]:null;
  const visibleStatement=useMemo(()=>sourceFilter==="All"?statement:statement.filter(r=>sourceKind(r)===sourceFilter),[statement,sourceFilter]);
  const filterTotals=useMemo(()=>visibleStatement.reduce((x,r)=>({debit:x.debit+Number(r.Debit||0),credit:x.credit+Number(r.Credit||0)}),{debit:0,credit:0}),[visibleStatement]);
  const filterNet=Math.abs(filterTotals.debit-filterTotals.credit);
  const filterNetSide=filterTotals.debit===filterTotals.credit?"—":filterTotals.debit>filterTotals.credit?"Dr":"Cr";
  const journalBreakdown=useMemo(()=>visibleStatement.reduce((x,r)=>{if(sourceKind(r)!=="Journals")return x;const k=journalClass(r);x[k]=(x[k]||0)+Number(r.Debit||0)+Number(r.Credit||0);return x},{}),[visibleStatement]);

  const partnerStaffLedger=useMemo(()=>{
    const g=String(ledger?.GroupName||"").toLowerCase();
    return g.includes("partner")||g.includes("staff")||g.includes("other current liabilities");
  },[ledger]);

  const summary=useMemo(()=>{
    let expensesCredited=0,bankDebits=0;
    for(const r of statement){
      const kind=sourceKind(r),dr=Number(r.Debit||0),cr=Number(r.Credit||0);
      if(kind==="Expenses")expensesCredited+=cr;
      if(kind==="Bank Transfers")bankDebits+=dr;
    }
    return{expensesCredited,bankDebits};
  },[statement]);

  function add(){setEditId("");setForm(initial);setCustomGroup(false);setOpen(true)}
  function edit(){if(!ledger)return;setEditId(ledger.LedgerID);setForm({LedgerCode:ledger.LedgerCode||"",LedgerName:ledger.LedgerName||"",GroupName:ledger.GroupName||"",AccountType:ledger.AccountType||"Asset",OpeningBalance:ledger.OpeningBalance??"",OpeningSide:ledger.OpeningSide||"Dr",Status:ledger.Status||"Active",Notes:ledger.Notes||""});setCustomGroup(false);setOpen(true)}
  function changeGroup(v){if(v==="__CUSTOM__"){setCustomGroup(true);setForm(p=>({...p,GroupName:""}));return}const t=typeForGroup(v);setCustomGroup(false);setForm(p=>({...p,GroupName:v,AccountType:t||p.AccountType}))}
  async function save(e){e.preventDefault();if(!form.GroupName.trim())return alert("Select or enter a Group");const r=await apiPost(editId?"updateLedger":"saveLedger",editId?{...form,LedgerID:editId}:form);const id=r.data?.LedgerID||editId;setOpen(false);await load();if(id)await pick(id)}
  async function del(){if(!ledger||!confirm(`Delete ledger "${ledger.LedgerName}"?`))return;try{await apiPost("deleteLedger",{LedgerID:ledger.LedgerID});setSelected("");setStatement([]);await load()}catch(err){alert(err.message)}}
  function openSource(r){const action=sourceAction(r);if(action)navigate(action.path,{state:{sourceId:r.SourceID||"",journalId:r.JournalID||"",fromLedger:ledger?.LedgerID||""}})}

  function exportExcel(){
    if(!ledger)return;
    const head=["Date","Source","Voucher","Narration","Debit","Credit","Balance"];
    const body=visibleStatement.map(r=>[dmy(r.Date),sourceKind(r),`${r.VoucherType||""}${r.VoucherNo?` · ${r.VoucherNo}`:""}`,r.Narration||r.Particulars||"",Number(r.Debit||0).toFixed(2),Number(r.Credit||0).toFixed(2),`${Number(r.RunningBalance||0).toFixed(2)} ${r.BalanceSide||""}`]);
    const html=`<html><head><meta charset="utf-8"></head><body><h2>${esc(ledger.LedgerName)} Ledger</h2><p>View: ${esc(sourceFilter)} | Opening: ${esc(fmt(ledger.OpeningBalance))} ${esc(ledger.OpeningSide)}</p><table border="1"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
    const blob=new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`ledger-${String(ledger.LedgerName||"ledger").replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-${sourceFilter.toLowerCase().replace(/\s+/g,"-")}.xls`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  function exportPDF(){
    if(!ledger)return;
    const w=window.open("","_blank","width=1200,height=800");if(!w)return alert("Please allow pop-ups to export PDF.");
    const bal=current?`${fmt(current.RunningBalance)} ${current.BalanceSide}`:`${fmt(ledger.OpeningBalance)} ${ledger.OpeningSide}`;
    const trs=visibleStatement.map(r=>`<tr><td>${esc(dmy(r.Date))}</td><td>${esc(sourceKind(r))}</td><td>${esc(r.VoucherType||"")}${r.VoucherNo?` · ${esc(r.VoucherNo)}`:""}</td><td>${esc(r.Narration||r.Particulars||"")}</td><td class="n">${Number(r.Debit||0)>0?esc(fmt(r.Debit)):"—"}</td><td class="n">${Number(r.Credit||0)>0?esc(fmt(r.Credit)):"—"}</td><td class="n">${esc(fmt(r.RunningBalance))} ${esc(r.BalanceSide||"")}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>${esc(ledger.LedgerName)} Ledger</title><style>body{font-family:Arial;padding:20px;font-size:11px}h1{font-size:20px}.meta{color:#555;margin-bottom:12px}.sum{display:flex;gap:25px;margin:12px 0 16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px}th{background:#eee;text-align:left}.n{text-align:right;white-space:nowrap}@page{size:landscape;margin:10mm}</style></head><body><h1>Zivara Family Office LLP — Ledger Statement</h1><div class="meta">${esc(ledger.LedgerName)} · ${esc(ledger.LedgerCode||"")} · ${esc(ledger.GroupName||"")} · View: ${esc(sourceFilter)}</div><div class="sum"><div><b>Opening:</b> ${esc(fmt(ledger.OpeningBalance))} ${esc(ledger.OpeningSide)}</div><div><b>Current Balance:</b> ${esc(bal)}</div><div><b>Displayed:</b> ${visibleStatement.length}</div></div><table><thead><tr><th>Date</th><th>Source</th><th>Management Type</th><th>Voucher</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${trs||'<tr><td colspan="7">No transactions</td></tr>'}</tbody></table><script>window.onload=()=>window.print();<\/script></body></html>`);w.document.close();
  }

  return <div style={{display:"flex",flexDirection:"column",gap:"1.25rem"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap"}}><div><h2>Ledger Master</h2><p style={{color:"var(--muted)"}}>Select a ledger to see details and transactions.</p></div><button style={btn(true)} onClick={add}>+ Add Ledger</button></div>

    <div style={card}><input style={inp} placeholder="Search ledger, code or group" value={search} onChange={e=>setSearch(e.target.value)}/><select style={{...inp,marginTop:".75rem"}} value={selected} onChange={e=>e.target.value==="__NEW__"?add():pick(e.target.value)}><option value="">— Select ledger —</option>{filtered.map(x=><option key={x.LedgerID} value={x.LedgerID}>{x.LedgerName} · {x.GroupName}</option>)}<option value="__NEW__">+ Add New Ledger</option></select></div>

    {open&&<form style={card} onSubmit={save}><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".75rem"}}>
      <input style={inp} placeholder="Ledger Code" value={form.LedgerCode} onChange={e=>setForm({...form,LedgerCode:e.target.value})}/><input style={inp} required placeholder="Ledger Name" value={form.LedgerName} onChange={e=>setForm({...form,LedgerName:e.target.value})}/>
      {!customGroup?<select style={inp} value={form.GroupName} onChange={e=>changeGroup(e.target.value)} required><option value="">— Select Group —</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}<option value="__CUSTOM__">+ Add New Group</option></select>:<div style={{display:"flex",gap:".4rem"}}><input style={inp} autoFocus required placeholder="Custom group name" value={form.GroupName} onChange={e=>setForm({...form,GroupName:e.target.value})}/><button type="button" style={btn()} onClick={()=>{setCustomGroup(false);setForm(p=>({...p,GroupName:""}))}}>Back</button></div>}
      <select style={inp} value={form.AccountType} onChange={e=>setForm({...form,AccountType:e.target.value})}>{types.map(t=><option key={t}>{t}</option>)}</select><input style={inp} type="number" step=".01" placeholder="Opening Balance" value={form.OpeningBalance} onChange={e=>setForm({...form,OpeningBalance:e.target.value})}/><select style={inp} value={form.OpeningSide} onChange={e=>setForm({...form,OpeningSide:e.target.value})}><option>Dr</option><option>Cr</option></select><select style={inp} value={form.Status} onChange={e=>setForm({...form,Status:e.target.value})}><option>Active</option><option>Inactive</option></select><input style={inp} placeholder="Notes" value={form.Notes} onChange={e=>setForm({...form,Notes:e.target.value})}/>
    </div><div style={{marginTop:"1rem"}}><button style={btn(true)} type="submit">Save</button>{" "}<button style={btn()} type="button" onClick={()=>setOpen(false)}>Cancel</button></div></form>}

    {ledger&&<>
      <div style={card}>
        <div style={{display:"flex",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap"}}>
          <div><div style={{fontSize:".72rem",color:"var(--muted)"}}>SELECTED LEDGER</div><h3>{ledger.LedgerName}</h3><div style={{color:"var(--muted)"}}>{ledger.LedgerCode} · {ledger.GroupName} · {ledger.AccountType}</div></div>
          <div style={{display:"flex",gap:".45rem",flexWrap:"wrap",alignItems:"flex-start"}}><button style={btn()} onClick={exportExcel}>Export Excel</button><button style={btn()} onClick={exportPDF}>Export PDF</button><button style={btn()} onClick={edit}>Edit</button>{!ledger.SystemKey&&<button style={{...btn(),color:"var(--danger)"}} onClick={del}>Delete</button>}</div>
        </div>

        {partnerStaffLedger?<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".7rem",marginTop:"1rem"}}>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>PERSONAL EXPENSES CREDITED</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{fmt(summary.expensesCredited)}</div></div>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>AMOUNTS PAID / TRANSFERRED</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{fmt(summary.bankDebits)}</div></div>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>NET CURRENT BALANCE</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{current?`${fmt(current.RunningBalance)} ${current.BalanceSide}`:`${fmt(ledger.OpeningBalance)} ${ledger.OpeningSide}`}</div></div>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TRANSACTIONS</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{statement.length}</div></div>
        </div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".7rem",marginTop:"1rem"}}>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>OPENING BALANCE</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{fmt(ledger.OpeningBalance)} {ledger.OpeningSide}</div></div>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>CURRENT BALANCE</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{current?`${fmt(current.RunningBalance)} ${current.BalanceSide}`:`${fmt(ledger.OpeningBalance)} ${ledger.OpeningSide}`}</div></div>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>STATUS</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{ledger.Status}</div></div>
          <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:"7px"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TRANSACTIONS</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{statement.length}</div></div>
        </div>}
      </div>

      <div style={{...card,padding:".8rem 1rem"}}>
        <div style={{display:"flex",gap:".45rem",flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:".72rem",color:"var(--muted)",fontWeight:700,marginRight:".25rem"}}>SHOW:</span>
          {["All","Expenses","Bank Transfers","Journals","Vendor Bills","Other"].map(x=><button key={x} onClick={()=>setSourceFilter(x)} style={{...btn(sourceFilter===x),padding:".42rem .7rem"}}>{x}</button>)}
          <span style={{fontSize:".72rem",color:"var(--muted)",marginLeft:"auto"}}>{visibleStatement.length} of {statement.length} entries</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:".55rem",marginTop:".75rem",paddingTop:".75rem",borderTop:"1px solid var(--border)"}}>
          <div><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>SELECTED DEBIT</div><div style={{fontWeight:800}}>{fmt(filterTotals.debit)}</div></div>
          <div><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>SELECTED CREDIT</div><div style={{fontWeight:800}}>{fmt(filterTotals.credit)}</div></div>
          <div><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>SELECTED NET</div><div style={{fontWeight:800}}>{fmt(filterNet)} {filterNetSide}</div></div>
          <div><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>ENTRIES</div><div style={{fontWeight:800}}>{visibleStatement.length}</div></div>
        </div>
        {sourceFilter==="Journals"&&<div style={{display:"flex",gap:".5rem",flexWrap:"wrap",marginTop:".65rem"}}>{Object.entries(journalBreakdown).map(([k,v])=><span key={k} style={{fontSize:".7rem",padding:".3rem .55rem",border:"1px solid var(--border)",borderRadius:"99px",color:"var(--muted)"}}>{k}: <strong style={{color:"var(--text)"}}>{fmt(v)}</strong></span>)}</div>}
      </div>

      <div style={{...card,padding:0,overflow:"hidden"}}>
        <table><thead><tr><th>Date</th><th>Source</th><th>Voucher</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Action</th></tr></thead>
        <tbody>{visibleStatement.length?visibleStatement.map((r,i)=>{const action=sourceAction(r);return <tr key={`${r.JournalID}-${i}`}><td>{r.Date||"—"}</td><td><span style={{fontSize:".72rem",fontWeight:700}}>{sourceKind(r)}</span></td><td><span style={{fontSize:".7rem",color:"var(--muted)"}}>{sourceKind(r)==="Journals"?journalClass(r):sourceKind(r)==="Expenses"?"Personal Expense":sourceKind(r)==="Bank Transfers"?"Zivara Bank Transfer":"—"}</span></td><td>{r.VoucherType}{r.VoucherNo?` · ${r.VoucherNo}`:""}</td><td>{r.Narration||r.Particulars||"—"}</td><td>{Number(r.Debit||0)>0?fmt(r.Debit):"—"}</td><td>{Number(r.Credit||0)>0?fmt(r.Credit):"—"}</td><td>{fmt(r.RunningBalance)} {r.BalanceSide}</td><td style={{whiteSpace:"nowrap"}}>{action?<button style={btn()} onClick={()=>openSource(r)}>{action.label}</button>:<span style={{fontSize:".72rem",color:"var(--muted)"}}>Protected</span>}</td></tr>}):<tr><td colSpan="9" style={{padding:"2rem",textAlign:"center"}}>No entries in this view.</td></tr>}</tbody></table>
      </div>
    </>}
  </div>
}
