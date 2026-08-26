import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem"};
const inp={width:"100%",boxSizing:"border-box",padding:".55rem .7rem",background:"var(--input)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:"6px"};
const btn=(p=false)=>({padding:".55rem .9rem",borderRadius:"6px",cursor:"pointer",fontWeight:650,border:p?"none":"1px solid var(--border)",background:p?"var(--accent)":"transparent",color:p?"#fff":"var(--muted)"});
const toneCard=(tone="neutral")=>({...card,borderColor:tone==="green"?"#22c55e66":tone==="amber"?"#f59e0b66":tone==="blue"?"#38bdf866":"var(--border)",background:tone==="green"?"#22c55e12":tone==="amber"?"#f59e0b12":tone==="blue"?"#38bdf812":"var(--card)"});
const toneValue=tone=>({fontSize:"1.12rem",fontWeight:800,marginTop:".2rem",color:tone==="green"?"#4ade80":tone==="amber"?"#fbbf24":tone==="blue"?"#38bdf8":"var(--text)"});
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const fyStart="2026-04-01";
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const dmy=v=>{const s=String(v||"").slice(0,10),p=s.split("-");return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:s};
const PURPOSES=["Expense Reimbursement","Advance / Transfer","Partner Drawing","Loan / Settlement","Other"];
const purposeTag=p=>p?`[Purpose: ${p}]`:"";
const getPurpose=text=>{
  const m=String(text||"").match(/\[Purpose:\s*([^\]]+)\]/i);
  if(m)return m[1].trim();
  const n=String(text||"").toLowerCase();
  if(n.includes("against invoice")||n.includes("against invouce")||n.includes("expenses paid as per invoice"))return "Expense Reimbursement";
  return "Advance / Transfer";
};
const cleanNarration=text=>String(text||"").replace(/\s*\[Purpose:\s*[^\]]+\]\s*/ig," ").replace(/\s+/g," ").trim();

function bucket(expense){
  const t=String(expense.ExpenseType||"").trim().toLowerCase();
  const c=String(expense.Category||"").trim().toLowerCase();
  const s=`${t} ${c}`;
  if(s.includes("hotel")||s.includes("stay")||s.includes("accommodation")) return "Hotel";
  if(s.includes("food")||s.includes("meal")||s.includes("restaurant")) return "Food";
  if(s.includes("travel")||s.includes("flight")||s.includes("air")||s.includes("cab")||s.includes("taxi")) return "Travel";
  if(s.includes("misc")||s.includes("other")||s.includes("office")) return "Misc / Other";
  return "Misc / Other";
}

export default function PartnerStaffStatement(){
  const {currentLLP}=useLLP();
  const[expenses,setExpenses]=useState([]);
  const[bankRows,setBankRows]=useState([]);
  const[ledgers,setLedgers]=useState([]);
  const[partners,setPartners]=useState([]);
  const[users,setUsers]=useState([]);
  const[person,setPerson]=useState("");
  const[from,setFrom]=useState(fyStart);
  const[to,setTo]=useState("");
  const[category,setCategory]=useState("");
  const[status,setStatus]=useState("");
  const[statement,setStatement]=useState([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");

  async function load(){
    setLoading(true);setError("");
    try{
      const[e,l,p,u,b]=await Promise.all([
        apiGet("getExpenses"),apiGet("getLedgers"),apiGet("getPartners"),apiGet("getUsers"),apiGet("getBankTransactions")
      ]);
      setExpenses(e.data||[]);
      setLedgers(l.data||[]);
      setPartners((p.data||[]).filter(x=>x.Status!=="Inactive"));
      setUsers((u.data||[]).filter(x=>x.Status!=="Inactive"));
      setBankRows(b.data||[]);
    }catch(err){setError(err.message||"Unable to load report data")}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[currentLLP?.llpId,currentLLP?.LLPID,currentLLP?.global]);

  const people=useMemo(()=>[...new Set([
    ...partners.map(x=>x.PartnerName),
    ...users.map(x=>x.Name||x.FullName||x.Username),
    ...expenses.map(x=>x.PaidBy),
    ...expenses.map(x=>x.ReimburseTo)
  ].map(x=>String(x||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[partners,users,expenses]);

  useEffect(()=>{if(!person&&people.length)setPerson(people[0])},[people,person]);

  const personLedger=useMemo(()=>{
    const n=String(person||"").trim().toLowerCase();
    if(!n)return null;
    const exact=ledgers.find(l=>String(l.LedgerName||"").trim().toLowerCase()===n);
    if(exact)return exact;
    return ledgers.find(l=>{
      const name=String(l.LedgerName||"").trim().toLowerCase();
      const group=String(l.GroupName||"").toLowerCase();
      return name.includes(n)&&(group.includes("partner")||group.includes("staff")||group.includes("current liabilities"));
    })||null;
  },[ledgers,person]);

  useEffect(()=>{
    let cancelled=false;
    async function loadStatement(){
      if(!personLedger){setStatement([]);return}
      try{
        const r=await apiGet("getLedgerStatement",{ledger_id:personLedger.LedgerID});
        if(!cancelled)setStatement(r.data||[]);
      }catch(err){if(!cancelled)setError(err.message||"Unable to load person ledger")}
    }
    loadStatement();
    return()=>{cancelled=true};
  },[personLedger]);

  const personExpenses=useMemo(()=>expenses.filter(e=>{
    const d=String(e.Date||"").slice(0,10);
    if(String(e.PaidBy||"").trim()!==person)return false;
    if(from&&d<from)return false;
    if(to&&d>to)return false;
    if(category&&bucket(e)!==category)return false;
    if(status&&String(e.Status||"")!==status)return false;
    return true;
  }).sort((a,b)=>String(b.Date||"").localeCompare(String(a.Date||""))),[expenses,person,from,to,category,status]);

  const repayments=useMemo(()=>statement.filter(r=>{
    const d=String(r.Date||"").slice(0,10);
    const source=String(r.SourceType||"").toLowerCase();
    const voucher=String(r.VoucherType||"").toLowerCase();
    const isTransfer=source==="cash_book"||source==="bank"||["bank","cash","payment","receipt"].includes(voucher);
    if(!isTransfer||Number(r.Debit||0)<=0)return false;
    if(from&&d<from)return false;
    if(to&&d>to)return false;
    return true;
  }).map(r=>{
    const bank=bankRows.find(x=>x.EntryID===r.SourceID)
      ||bankRows.find(x=>String(x.ReferenceID||"")&&String(x.ReferenceID||"")===String(r.VoucherNo||""))
      ||bankRows.find(x=>String(x.Date||"").slice(0,10)===String(r.Date||"").slice(0,10)&&Math.abs(Number(x.AmountOut||0)-Number(r.Debit||0))<0.01&&String(x.LedgerID||"")===String(personLedger?.LedgerID||""));
    const narration=bank?.Description||r.Narration||r.Particulars||"";
    return {...r,_bank:bank,_purpose:getPurpose(narration),_narration:cleanNarration(narration)};
  }).sort((a,b)=>String(b.Date||"").localeCompare(String(a.Date||""))),[statement,bankRows,from,to,personLedger]);

  const reimbursementRows=useMemo(()=>repayments.filter(r=>r._purpose==="Expense Reimbursement"),[repayments]);
  const otherTransferRows=useMemo(()=>repayments.filter(r=>r._purpose!=="Expense Reimbursement"),[repayments]);

  const expenseTotal=useMemo(()=>personExpenses.reduce((s,x)=>s+Number(x.Amount||0),0),[personExpenses]);
  const reimbursedTotal=useMemo(()=>reimbursementRows.reduce((s,x)=>s+Number(x.Debit||0),0),[reimbursementRows]);
  const otherTransferTotal=useMemo(()=>otherTransferRows.reduce((s,x)=>s+Number(x.Debit||0),0),[otherTransferRows]);
  const byCategory=useMemo(()=>{
    const x={"Travel":0,"Hotel":0,"Food":0,"Misc / Other":0};
    personExpenses.forEach(e=>{x[bucket(e)]=(x[bucket(e)]||0)+Number(e.Amount||0)});
    return x;
  },[personExpenses]);

  const opening=Number(personLedger?.OpeningBalance||0);
  const openingSigned=(personLedger?.OpeningSide==="Cr"?opening:-opening);
  const closingRow=statement.length?statement[statement.length-1]:null;
  const closing=closingRow?`${fmt(closingRow.RunningBalance)} ${closingRow.BalanceSide}`:personLedger?`${fmt(opening)} ${personLedger.OpeningSide}`:"—";

  function resetFilters(){ setFrom(fyStart); setTo(""); setCategory(""); setStatus(""); }
  async function markPurpose(row,purpose){
    const x=row._bank;
    if(!x){alert("Could not identify the original bank transaction for this row.");return}
    const description=[cleanNarration(x.Description||row._narration),purposeTag(purpose)].filter(Boolean).join(" ");
    const receipt=Number(x.AmountIn||0)>0;
    try{
      await apiPost("updateBankTransaction",{
        EntryID:x.EntryID,BankAccountID:x.BankAccountID,Date:String(x.Date||"").slice(0,10),
        Type:receipt?"Receipt":"Payment",AmountIn:receipt?Number(x.AmountIn||0):"",
        AmountOut:receipt?"":Number(x.AmountOut||0),ReferenceType:x.ReferenceType||"Ledger",
        ReferenceID:x.ReferenceID||"",Description,LedgerID:x.LedgerID||personLedger?.LedgerID||""
      });
      await load();
      const r=await apiGet("getLedgerStatement",{ledger_id:personLedger.LedgerID});
      setStatement(r.data||[]);
    }catch(err){alert(err.message||"Unable to update transfer purpose")}
  }

  function exportExcel(){
    if(!person)return;
    const rows=[
      ["Partner / Staff Statement",person],
      ["From",from||"Start"],["To",to||"Latest"],
      ["Total Personal Expenses",expenseTotal.toFixed(2)],
      ["Expense Reimbursed",reimbursedTotal.toFixed(2)],
      ["Other Transfers / Advances",otherTransferTotal.toFixed(2)],
      ["Current Ledger Balance",closing],
      [],["EXPENSE HISTORY"],
      ["Date","Category","Description","Amount","Paid By","Status"],
      ...personExpenses.map(e=>[dmy(e.Date),bucket(e),e.Description||e.VendorOrPerson||"",Number(e.Amount||0).toFixed(2),e.PaidBy||"",e.Status||""]),
      [],["REPAYMENT / TRANSFER HISTORY"],
      ["Date","Reference / UTR","Narration","Purpose","Amount"],
      ...repayments.map(r=>[dmy(r.Date),r._bank?.ReferenceID||r.VoucherNo||r.SourceID||"",r._narration||"",r._purpose,Number(r.Debit||0).toFixed(2)])
    ];
    const table=`<table>${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table>`;
    const blob=new Blob([`<html><head><meta charset="utf-8"></head><body>${table}</body></html>`],{type:"application/vnd.ms-excel;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`${person.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-expense-statement.xls`;
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  function exportPDF(){
    if(!person)return;
    const w=window.open("","_blank","width=1200,height=850");if(!w)return alert("Please allow pop-ups to export PDF.");
    const expenseRows=personExpenses.map(e=>`<tr><td>${esc(dmy(e.Date))}</td><td>${esc(bucket(e))}</td><td>${esc(e.Description||e.VendorOrPerson||"")}</td><td class="n">${esc(fmt(e.Amount))}</td><td>${esc(e.Status||"")}</td></tr>`).join("");
    const repayRows=repayments.map(r=>`<tr><td>${esc(dmy(r.Date))}</td><td>${esc(r._bank?.ReferenceID||r.VoucherNo||r.SourceID||"")}</td><td>${esc(r._narration||"")}</td><td>${esc(r._purpose)}</td><td class="n">${esc(fmt(r.Debit))}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>${esc(person)} Statement</title><style>
      body{font-family:Arial,sans-serif;padding:20px;font-size:11px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin-top:20px}.muted{color:#666}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.c{border:1px solid #bbb;padding:8px 12px;min-width:145px}.v{font-weight:700;font-size:13px;margin-top:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;vertical-align:top}th{background:#eee;text-align:left}.n{text-align:right;white-space:nowrap}@page{size:landscape;margin:10mm}
    </style></head><body>
      <h1>Zivara Family Office LLP — Partner / Staff Expense Statement</h1>
      <div class="muted">${esc(person)} · ${esc(from||"Start")} to ${esc(to||"Latest")}</div>
      <div class="cards">
        <div class="c">Personal Expenses<div class="v">${esc(fmt(expenseTotal))}</div></div>
        <div class="c">Expense Reimbursed<div class="v">${esc(fmt(reimbursedTotal))}</div></div><div class="c">Other Transfers / Advances<div class="v">${esc(fmt(otherTransferTotal))}</div></div>
        <div class="c">Current Ledger Balance<div class="v">${esc(closing)}</div></div>
        <div class="c">Travel<div class="v">${esc(fmt(byCategory.Travel))}</div></div>
        <div class="c">Hotel<div class="v">${esc(fmt(byCategory.Hotel))}</div></div>
        <div class="c">Food<div class="v">${esc(fmt(byCategory.Food))}</div></div>
        <div class="c">Misc / Other<div class="v">${esc(fmt(byCategory["Misc / Other"]))}</div></div>
      </div>
      <h2>Expense History</h2><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>${expenseRows||'<tr><td colspan="5">No expenses</td></tr>'}</tbody></table>
      <h2>Repayment / Transfer History</h2><table><thead><tr><th>Date</th><th>Reference / UTR</th><th>Narration</th><th>Purpose</th><th>Amount</th></tr></thead><tbody>${repayRows||'<tr><td colspan="5">No transfers</td></tr>'}</tbody></table>
      <script>window.onload=()=>window.print();<\/script>
    </body></html>`);w.document.close();
  }

  return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
      <div><h2 style={{margin:0}}>Partner / Staff Statement</h2><p style={{color:"var(--muted)",fontSize:".8rem",margin:".25rem 0 0"}}>Personal expense, category and repayment history for a selected person.</p></div>
      <div style={{display:"flex",gap:".5rem"}}><button style={btn()} onClick={exportExcel}>Export Excel</button><button style={btn()} onClick={exportPDF}>Export PDF</button></div>
    </div>

    {error&&<div style={{...card,color:"var(--danger)"}}>{error}</div>}

    <div style={{...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".7rem",alignItems:"end"}}>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Person</label><select style={inp} value={person} onChange={e=>setPerson(e.target.value)}><option value="">— Select —</option>{people.map(x=><option key={x}>{x}</option>)}</select></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>From Date</label><input style={inp} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>To Date</label><input style={inp} type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Category</label><select style={inp} value={category} onChange={e=>setCategory(e.target.value)}><option value="">All</option>{["Travel","Hotel","Food","Misc / Other"].map(x=><option key={x}>{x}</option>)}</select></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Expense Status</label><select style={inp} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option>{["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}</select></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Filters</label><button type="button" style={{...btn(),width:"100%"}} onClick={resetFilters}>Reset Filters</button></div>
    </div>

    {loading?<div style={card}>Loading...</div>:<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(165px,1fr))",gap:".7rem"}}>
        <div style={toneCard()}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>PERSONAL EXPENSES</div><div style={toneValue("neutral")}>{fmt(expenseTotal)}</div></div>
        <div style={toneCard("green")}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>EXPENSE REIMBURSED</div><div style={toneValue("green")}>{fmt(reimbursedTotal)}</div></div>
        <div style={toneCard("amber")}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>OTHER TRANSFERS / ADVANCES</div><div style={toneValue("amber")}>{fmt(otherTransferTotal)}</div></div>
        {[["Travel",byCategory.Travel],["Hotel",byCategory.Hotel],["Food",byCategory.Food],["Misc / Other",byCategory["Misc / Other"]]].map(([k,v])=><div key={k} style={toneCard()}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>{k.toUpperCase()}</div><div style={toneValue("neutral")}>{fmt(v)}</div></div>)}
        <div style={toneCard(closingRow?.BalanceSide==="Cr"?"amber":"blue")}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>CURRENT LEDGER BALANCE</div><div style={toneValue(closingRow?.BalanceSide==="Cr"?"amber":"blue")}>{closing}</div></div>
      </div>

      <div style={{...card,padding:0,overflow:"hidden"}}><div style={{padding:".85rem 1rem",fontWeight:750,borderBottom:"1px solid var(--border)"}}>Expense History · {personExpenses.length} records</div><div style={{overflowX:"auto"}}><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Paid By</th><th>Status</th></tr></thead><tbody>{personExpenses.length?personExpenses.map(e=><tr key={e.ExpenseID}><td>{dmy(e.Date)}</td><td>{bucket(e)}</td><td>{e.Description||e.VendorOrPerson||"—"}</td><td style={{fontWeight:700}}>{fmt(e.Amount)}</td><td>{e.PaidBy||"—"}</td><td>{e.Status||"—"}</td></tr>):<tr><td colSpan="6" style={{padding:"1.5rem",textAlign:"center"}}>No expenses for the selected filters.</td></tr>}</tbody></table></div></div>

      <div style={{...card,padding:0,overflow:"hidden"}}><div style={{padding:".85rem 1rem",fontWeight:750,borderBottom:"1px solid var(--border)"}}>Repayment / Transfer History · {repayments.length} records</div><div style={{overflowX:"auto"}}><table><thead><tr><th>Date</th><th>Reference / UTR</th><th>Narration</th><th>Purpose</th><th>Amount</th></tr></thead><tbody>{repayments.length?repayments.map((r,i)=><tr key={`${r.JournalID}-${i}`}><td>{dmy(r.Date)}</td><td>{r._bank?.ReferenceID||r.VoucherNo||r.SourceID||"—"}</td><td>{r._narration||"—"}</td><td><select style={{...inp,minWidth:190}} value={r._purpose} disabled={!r._bank} onChange={e=>markPurpose(r,e.target.value)}>{PURPOSES.map(x=><option key={x}>{x}</option>)}</select></td><td style={{fontWeight:700}}>{fmt(r.Debit)}</td></tr>):<tr><td colSpan="5" style={{padding:"1.5rem",textAlign:"center"}}>No bank/cash transfers found in the selected period.</td></tr>}</tbody></table></div></div>

      <div style={{...card,fontSize:".76rem",color:"var(--muted)"}}>
        <strong style={{color:"var(--text)"}}>Reconciliation note:</strong> Use the Purpose dropdown to classify each transfer. Expense Reimbursement is reported separately from advances, drawings, loan settlements and other transfers.
      </div>
    </>}
  </div>;
}
