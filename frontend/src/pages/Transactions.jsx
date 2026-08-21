import { useEffect,useMemo,useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet,apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";
import { formatDate } from "../utils/format";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.1rem"};
const label={display:"block",fontSize:".72rem",color:"var(--muted)",marginBottom:".3rem"};
const input={width:"100%",boxSizing:"border-box",padding:".55rem .7rem",background:"var(--input)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:"6px"};
const btn=(p=false)=>({padding:".55rem .9rem",borderRadius:"6px",cursor:"pointer",fontWeight:600,border:p?"none":"1px solid var(--border)",background:p?"var(--accent)":"transparent",color:p?"#fff":"var(--muted)"});
const empty={EntryID:"",BankAccountID:"",Date:"",Type:"Payment",Amount:"",LedgerID:"",ReferenceID:"",Description:""};
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const num=n=>Number(n||0)||0;
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export default function Transactions(){
 const navigate=useNavigate(),{currentLLP}=useLLP();
 const[accounts,setAccounts]=useState([]),[ledgers,setLedgers]=useState([]),[rows,setRows]=useState([]),[loading,setLoading]=useState(false);
 const[bank,setBank]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[type,setType]=useState(""),[search,setSearch]=useState("");
 const[open,setOpen]=useState(false),[editing,setEditing]=useState(false),[form,setForm]=useState(empty),[exportOpen,setExportOpen]=useState(false);

 async function load(){
  setLoading(true);
  try{
   const[b,l,t]=await Promise.all([apiGet("getBankAccounts"),apiGet("getLedgers"),apiGet("getBankTransactions")]);
   const a=(b.data||[]).filter(x=>x.IsActive!=="No");
   setAccounts(a);setLedgers((l.data||[]).filter(x=>x.Status!=="Inactive"));setRows(t.data||[]);
   setBank(prev=>prev||a[0]?.AccountID||"");
  }finally{setLoading(false)}
 }
 useEffect(()=>{load()},[currentLLP?.llpId,currentLLP?.LLPID,currentLLP?.global]);

 const all=bank==="__ALL__",acct=accounts.find(a=>a.AccountID===bank);
 const filtered=useMemo(()=>rows.filter(r=>{
  const rt=num(r.AmountIn)>0?"Receipt":"Payment";
  if(bank&&bank!=="__ALL__"&&r.BankAccountID!==bank)return false;
  if(from&&String(r.Date||"")<from)return false;if(to&&String(r.Date||"")>to)return false;if(type&&rt!==type)return false;
  if(search){const q=search.toLowerCase();if(![r.Description,r.LedgerName,r.ReferenceID,r.BankAccountName,r.ManagedBy].some(v=>String(v||"").toLowerCase().includes(q)))return false}
  return true;
 }).sort((a,b)=>String(b.Date||"").localeCompare(String(a.Date||""))),[rows,bank,from,to,type,search]);

 const summary=useMemo(()=>{
  const x=[...filtered].sort((a,b)=>String(a.Date||"").localeCompare(String(b.Date||"")));
  return {
   opening:x.length?num(x[0].OpeningBalance):num(acct?.OpeningBalance),
   receipts:x.reduce((s,r)=>s+num(r.AmountIn),0),
   payments:x.reduce((s,r)=>s+num(r.AmountOut),0),
   closing:x.length?num(x[x.length-1].ClosingBalance):num(acct?.CurrentBalance)
  };
 },[filtered,acct]);

 function add(){
  setEditing(false);setForm({...empty,Date:new Date().toISOString().slice(0,10),BankAccountID:bank!=="__ALL__"?bank:""});setOpen(true)
 }
 function edit(r){
  if(r.Managed)return;
  setEditing(true);setForm({EntryID:r.EntryID,BankAccountID:r.BankAccountID||"",Date:r.Date||"",Type:num(r.AmountIn)>0?"Receipt":"Payment",Amount:String(num(r.AmountIn)>0?r.AmountIn:r.AmountOut||""),LedgerID:r.LedgerID||"",ReferenceID:r.ReferenceID||"",Description:r.Description||""});setOpen(true)
 }
 async function save(e){
  e.preventDefault();const amount=num(form.Amount);if(!form.BankAccountID||!form.LedgerID||amount<=0)return alert("Bank, Ledger and positive Amount are required");
  const receipt=form.Type==="Receipt",payload={BankAccountID:form.BankAccountID,Date:form.Date,Type:form.Type,AmountIn:receipt?amount:"",AmountOut:receipt?"":amount,ReferenceType:"Ledger",ReferenceID:form.ReferenceID,Description:form.Description,LedgerID:form.LedgerID};
  try{
   if(editing)await apiPost("updateBankTransaction",{...payload,EntryID:form.EntryID});
   else{const r=await apiPost("saveCashEntry",payload);await apiPost("postCashToLedger",{EntryID:r.data?.EntryID,LedgerID:form.LedgerID})}
   setOpen(false);setBank(form.BankAccountID);await load();
  }catch(err){alert(err.message)}
 }
 async function remove(r){if(r.Managed||!confirm("Delete this transaction?"))return;try{await apiPost("deleteBankTransaction",{EntryID:r.EntryID});await load()}catch(e){alert(e.message)}}

 const exportData=()=>filtered.map(r=>({Date:r.Date||"",Type:num(r.AmountIn)>0?"Receipt":"Payment",Bank:r.BankAccountName||r.BankName||"",Narration:r.Description||"",Ledger:r.LedgerName||"",Reference:r.ReferenceID||"",Receipt:num(r.AmountIn),Payment:num(r.AmountOut),Balance:num(r.ClosingBalance),Source:r.Managed?(r.ManagedBy||"Managed"):"Manual"}));
 function exportExcel(){
  const body=exportData().map(r=>`<tr>${[r.Date,r.Type,r.Bank,r.Narration,r.Ledger,r.Reference,r.Receipt||"",r.Payment||"",r.Balance,r.Source].map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("");
  const html=`<html><body><table border="1"><tr><th>Date</th><th>Type</th><th>Bank</th><th>Narration</th><th>Ledger</th><th>Reference/UTR</th><th>Receipt</th><th>Payment</th><th>Balance</th><th>Source</th></tr>${body}</table></body></html>`;
  const blob=new Blob([html],{type:"application/vnd.ms-excel"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="zivara-transactions.xls";a.click();URL.revokeObjectURL(url);setExportOpen(false)
 }
 function exportPDF(){
  const body=exportData().map(r=>`<tr><td>${esc(formatDate(r.Date))}</td><td>${esc(r.Type)}</td>${all?`<td>${esc(r.Bank)}</td>`:""}<td>${esc(r.Narration)}</td><td>${esc(r.Ledger)}</td><td>${esc(r.Reference)}</td><td>${r.Receipt?fmt(r.Receipt):""}</td><td>${r.Payment?fmt(r.Payment):""}</td><td>${fmt(r.Balance)}</td><td>${esc(r.Source)}</td></tr>`).join("");
  const w=window.open("","_blank");if(!w)return alert("Allow pop-ups to export PDF");
  w.document.write(`<html><head><style>body{font-family:Arial;padding:20px}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #bbb;padding:5px}th{background:#eee}@page{size:landscape}</style></head><body><h2>Zivara Transactions - ${esc(acct?.AccountName||"All Banks")}</h2><p>${from||"Start"} to ${to||"Latest"}</p><p>Opening ${fmt(summary.opening)} | Receipts ${fmt(summary.receipts)} | Payments ${fmt(summary.payments)} | Closing ${fmt(summary.closing)}</p><table><tr><th>Date</th><th>Type</th>${all?"<th>Bank</th>":""}<th>Narration</th><th>Ledger</th><th>Reference/UTR</th><th>Receipt</th><th>Payment</th><th>Balance</th><th>Source</th></tr>${body}</table><script>window.onload=()=>window.print()</script></body></html>`);w.document.close();setExportOpen(false)
 }

 return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}><div><h2>Transactions</h2><p style={{color:"var(--muted)",fontSize:".8rem"}}>Bank statement register. Managed Payable/Reimbursement entries are protected.</p></div><button style={btn(true)} onClick={add}>+ Add Transaction</button></div>

  <div style={card}><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".7rem",alignItems:"end"}}>
   <div><label style={label}>Bank Account</label>{accounts.length<=1?<div style={input}>{accounts[0]?`${accounts[0].AccountName} · ${accounts[0].BankName} · ...${String(accounts[0].AccountNumber||"").slice(-4)}`:"No active bank"}</div>:<select style={input} value={bank} onChange={e=>setBank(e.target.value)}><option value="__ALL__">All Banks</option>{accounts.map(a=><option key={a.AccountID} value={a.AccountID}>{a.AccountName} · {a.BankName} · ...{String(a.AccountNumber||"").slice(-4)}</option>)}</select>}</div>
   <div><label style={label}>From Date</label><input style={input} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
   <div><label style={label}>To Date</label><input style={input} type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
   <div><label style={label}>Type</label><select style={input} value={type} onChange={e=>setType(e.target.value)}><option value="">All</option><option>Receipt</option><option>Payment</option></select></div>
   <div><label style={label}>Search</label><input style={input} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Narration, ledger or UTR"/></div>
   <div style={{position:"relative"}}><label style={label}>Export</label><button style={{...btn(),width:"100%"}} onClick={()=>setExportOpen(v=>!v)}>Export ▾</button>{exportOpen&&<div style={{position:"absolute",zIndex:20,right:0,top:"100%",background:"var(--card)",border:"1px solid var(--border)",borderRadius:"6px",padding:".4rem",minWidth:150}}><button style={{...btn(),width:"100%",marginBottom:".3rem"}} onClick={exportExcel}>Export Excel</button><button style={{...btn(),width:"100%"}} onClick={exportPDF}>Export PDF</button></div>}</div>
  </div></div>

  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".7rem"}}>{[["Opening Balance",summary.opening],["Total Receipts",summary.receipts],["Total Payments",summary.payments],["Closing Balance",summary.closing]].map(([k,v])=><div key={k} style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>{k.toUpperCase()}</div><div style={{fontSize:"1.05rem",fontWeight:800,marginTop:".2rem"}}>{fmt(v)}</div></div>)}</div>

  <div style={{...card,padding:0,overflow:"hidden"}}><div style={{overflowX:"auto"}}>{loading?<p style={{padding:"2rem",textAlign:"center"}}>Loading...</p>:<table><thead><tr><th>Date</th><th>Type</th>{all&&<th>Bank</th>}<th>Narration</th><th>Ledger</th><th>Reference / UTR</th><th>Receipt</th><th>Payment</th><th>Balance</th><th>Source</th><th>Edit</th></tr></thead><tbody>{filtered.length?filtered.map(r=>{const receipt=num(r.AmountIn)>0;return <tr key={r.EntryID}><td>{formatDate(r.Date)}</td><td style={{fontWeight:700,color:receipt?"var(--success)":"var(--danger)"}}>{receipt?"Receipt":"Payment"}</td>{all&&<td>{r.BankAccountName||r.BankName||"—"}</td>}<td>{r.Description||"—"}</td><td>{r.LedgerName||"—"}</td><td>{r.ReferenceID||"—"}</td><td>{receipt?fmt(r.AmountIn):"—"}</td><td>{!receipt?fmt(r.AmountOut):"—"}</td><td><strong>{fmt(r.ClosingBalance)}</strong></td><td>{r.Managed?<span style={{color:"var(--accent2)",fontWeight:600}}>{r.ManagedBy}</span>:"Manual"}</td><td>{r.Managed?<span style={{fontSize:".7rem",color:"var(--muted)"}}>Managed</span>:<><button style={btn()} onClick={()=>edit(r)}>Edit</button>{" "}<button style={{...btn(),color:"var(--danger)"}} onClick={()=>remove(r)}>Delete</button></>}</td></tr>}):<tr><td colSpan={all?11:10} style={{padding:"2rem",textAlign:"center"}}>No transactions for selected filters.</td></tr>}</tbody></table>}</div></div>

  {open&&<div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,.65)",padding:"1rem",overflowY:"auto"}}><div style={{...card,maxWidth:850,margin:"5vh auto 0"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}><h3 style={{margin:0}}>{editing?"Edit Transaction":"Add Transaction"}</h3><button style={btn()} onClick={()=>setOpen(false)}>× Close</button></div>
   <form onSubmit={save}><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:".8rem"}}>
    <div><label style={label}>Transaction Type *</label><select style={input} value={form.Type} onChange={e=>setForm({...form,Type:e.target.value})}><option>Payment</option><option>Receipt</option></select></div>
    <div><label style={label}>Date *</label><input style={input} type="date" required value={form.Date} onChange={e=>setForm({...form,Date:e.target.value})}/></div>
    <div><label style={label}>Bank Account *</label><select style={input} required value={form.BankAccountID} onChange={e=>setForm({...form,BankAccountID:e.target.value})}><option value="">— Select bank —</option>{accounts.map(a=><option key={a.AccountID} value={a.AccountID}>{a.AccountName} · {a.BankName} · ...{String(a.AccountNumber||"").slice(-4)}</option>)}</select></div>
    <div><label style={label}>Amount *</label><input style={input} type="number" step=".01" min="0" required value={form.Amount} onChange={e=>setForm({...form,Amount:e.target.value})}/></div>
    <div><label style={label}>Ledger *</label><select style={input} required value={form.LedgerID} onChange={e=>e.target.value==="__NEW__"?navigate("/ledgers"):setForm({...form,LedgerID:e.target.value})}><option value="">— Select ledger —</option>{ledgers.map(l=><option key={l.LedgerID} value={l.LedgerID}>{l.LedgerName} · {l.GroupName}</option>)}<option value="__NEW__">+ Add New Ledger</option></select></div>
    <div><label style={label}>Reference / UTR</label><input style={input} value={form.ReferenceID} onChange={e=>setForm({...form,ReferenceID:e.target.value})}/></div>
    <div style={{gridColumn:"1/-1"}}><label style={label}>Narration</label><input style={input} value={form.Description} onChange={e=>setForm({...form,Description:e.target.value})}/></div>
   </div><div style={{display:"flex",justifyContent:"flex-end",gap:".6rem",marginTop:"1rem"}}><button type="button" style={btn()} onClick={()=>setOpen(false)}>Cancel</button><button type="submit" style={btn(true)}>{editing?"Update Transaction":"Save Transaction"}</button></div></form>
  </div></div>}
 </div>
}
