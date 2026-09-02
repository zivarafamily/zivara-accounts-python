import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem",boxSizing:"border-box",minWidth:0,overflow:"hidden"};
const page={display:"flex",flexDirection:"column",gap:"1rem",width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",overflow:"hidden"};
const grid12={display:"grid",gridTemplateColumns:"repeat(12,minmax(0,1fr))",gap:".75rem",width:"100%",alignItems:"stretch"};
const tableWrap={width:"100%",overflowX:"auto"};
const tableStyle={width:"100%",borderCollapse:"collapse",tableLayout:"fixed"};
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
const journalMeta=(text,label)=>{
  const m=String(text||"").match(new RegExp(`\\[${label}:\\s*([^\\]]+)\\]`,"i"));
  return m?m[1].trim():"";
};
const cleanJournalMeta=text=>String(text||"")
  .replace(/\s*\[JournalType:\s*[^\]]+\]/ig,"")
  .replace(/\s*\[From:\s*[^\]]+\]/ig,"")
  .replace(/\s*\[To:\s*[^\]]+\]/ig,"")
  .replace(/\s+/g," ").trim();

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

  const managementJournals=useMemo(()=>statement.filter(r=>{
    const d=String(r.Date||"").slice(0,10);
    const source=String(r.SourceType||"").toLowerCase(),voucher=String(r.VoucherType||"").toLowerCase();
    if(!(source==="manual"||voucher==="journal"))return false;
    if(from&&d<from)return false;if(to&&d>to)return false;
    return true;
  }).map(r=>{
    const text=String(r.Narration||r.Particulars||"");
    let type=journalMeta(text,"JournalType");
    if(!type){
      const n=text.toLowerCase();
      type=n.includes("refund")||n.includes("cancel")?"Refund / Cancellation":
        ((n.includes("paid to")||n.includes(" paid "))&&(n.includes("dinu")||n.includes("manu")||n.includes("manugopal")))?"Inter-person Settlement":
        n.includes("opening")?"Opening Adjustment":"General Adjustment";
    }
    return {...r,_journalType:type,_from:journalMeta(text,"From"),_to:journalMeta(text,"To"),_clean:cleanJournalMeta(text)};
  }),[statement,from,to]);

  const refundTotal=useMemo(()=>managementJournals.filter(r=>r._journalType==="Refund / Cancellation"&&Number(r.Debit||0)>0).reduce((a,r)=>a+Number(r.Debit||0),0),[managementJournals]);
  const receivedFromPersonTotal=useMemo(()=>managementJournals.filter(r=>r._journalType==="Inter-person Settlement"&&Number(r.Debit||0)>0).reduce((a,r)=>a+Number(r.Debit||0),0),[managementJournals]);
  const paidToPersonTotal=useMemo(()=>managementJournals.filter(r=>r._journalType==="Inter-person Settlement"&&Number(r.Credit||0)>0).reduce((a,r)=>a+Number(r.Credit||0),0),[managementJournals]);
  const otherAdjustmentNet=useMemo(()=>managementJournals.filter(r=>!["Refund / Cancellation","Inter-person Settlement"].includes(r._journalType)).reduce((a,r)=>a+Number(r.Credit||0)-Number(r.Debit||0),0),[managementJournals]);

  const reimbursementRows=useMemo(()=>repayments.filter(r=>r._purpose==="Expense Reimbursement"),[repayments]);
  const otherTransferRows=useMemo(()=>repayments.filter(r=>r._purpose!=="Expense Reimbursement"),[repayments]);

  const expenseTotal=useMemo(()=>personExpenses.reduce((s,x)=>s+Number(x.Amount||0),0),[personExpenses]);
  const reimbursedTotal=useMemo(()=>reimbursementRows.reduce((s,x)=>s+Number(x.Debit||0),0),[reimbursementRows]);
  const ownClaimAfterRefunds=expenseTotal-refundTotal-receivedFromPersonTotal+otherAdjustmentNet;
  const totalClaimBeforeZivara=ownClaimAfterRefunds+paidToPersonTotal;
  const managementBalance=totalClaimBeforeZivara-reimbursedTotal;
  const reimbursementBalance=Math.max(0,managementBalance);
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
        ReferenceID:x.ReferenceID||"",Description:description,LedgerID:x.LedgerID||personLedger?.LedgerID||""
      });
      await load();
      const r=await apiGet("getLedgerStatement",{ledger_id:personLedger.LedgerID});
      setStatement(r.data||[]);
    }catch(err){alert(err.message||"Unable to update transfer purpose")}
  }

  function exportExcel(){
    if(!person)return;
    const n=x=>Number(x||0).toFixed(2);
    const html=`<html><head><meta charset="utf-8"><style>
      body{font-family:Arial;font-size:11pt}table{border-collapse:collapse;margin-bottom:16px}
      td,th{border:1px solid #bbb;padding:6px 8px;vertical-align:top}th{background:#e9edf3;text-align:left}
      .title{font-size:16pt;font-weight:700;border:none}.section{font-weight:700;background:#e9edf3}
      .amt{text-align:right;mso-number-format:"₹"#,##0.00}.total{font-weight:700;background:#f3f5f7}.net{font-weight:800;background:#fff2cc}
    </style></head><body>
    <table><tr><td class="title" colspan="2">${esc(person)} — Partner / Staff Settlement Statement</td></tr><tr><td>From</td><td>${esc(dmy(from)||"Start")}</td></tr><tr><td>To</td><td>${esc(dmy(to)||"Latest")}</td></tr></table>
    <table><tr><td class="section" colspan="2">Settlement Summary</td></tr>
      <tr><td>Own Expenses Paid Personally</td><td class="amt">${n(expenseTotal)}</td></tr>
      <tr><td>Less: Refunds / Cancellations</td><td class="amt">${n(refundTotal)}</td></tr>
      <tr><td>Less: Received from Another Person</td><td class="amt">${n(receivedFromPersonTotal)}</td></tr>
      <tr><td>Add: Paid to Another Person on behalf of Zivara</td><td class="amt">${n(paidToPersonTotal)}</td></tr>
      ${Math.abs(otherAdjustmentNet)>0.005?`<tr><td>Other Adjustments Net</td><td class="amt">${n(otherAdjustmentNet)}</td></tr>`:""}
      <tr class="total"><td>Total Claim Before Zivara Payment</td><td class="amt">${n(totalClaimBeforeZivara)}</td></tr>
      <tr><td>Less: Paid Directly by Zivara</td><td class="amt">${n(reimbursedTotal)}</td></tr>
      <tr class="net"><td>NET AMOUNT DUE</td><td class="amt">${n(reimbursementBalance)}</td></tr>
    </table>
    <table><tr><td class="section" colspan="2">Expense Mix</td></tr><tr><td>Travel</td><td class="amt">${n(byCategory.Travel)}</td></tr><tr><td>Hotel</td><td class="amt">${n(byCategory.Hotel)}</td></tr><tr><td>Food</td><td class="amt">${n(byCategory.Food)}</td></tr><tr><td>Misc / Other</td><td class="amt">${n(byCategory["Misc / Other"])}</td></tr>${otherTransferTotal>0?`<tr><td>Other Transfers / Advances</td><td class="amt">${n(otherTransferTotal)}</td></tr>`:""}</table>
    <table><tr><td class="section" colspan="6">Expense Transactions</td></tr><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Paid By</th><th>Status</th></tr>${personExpenses.map(e=>`<tr><td>${esc(dmy(e.Date))}</td><td>${esc(bucket(e))}</td><td>${esc(e.Description||e.VendorOrPerson||"")}</td><td class="amt">${n(e.Amount)}</td><td>${esc(e.PaidBy||"")}</td><td>${esc(e.Status||"")}</td></tr>`).join("")}</table>
    <table><tr><td class="section" colspan="7">Refund / Inter-person / Adjustment Transactions</td></tr><tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th>Narration</th><th>Debit</th><th>Credit</th></tr>${managementJournals.length?managementJournals.map(r=>`<tr><td>${esc(dmy(r.Date))}</td><td>${esc(r._journalType)}</td><td>${esc(r._from||"")}</td><td>${esc(r._to||"")}</td><td>${esc(r._clean||"")}</td><td class="amt">${Number(r.Debit||0)>0?n(r.Debit):""}</td><td class="amt">${Number(r.Credit||0)>0?n(r.Credit):""}</td></tr>`).join(""):`<tr><td colspan="7">No journal settlement transactions</td></tr>`}</table>
    <table><tr><td class="section" colspan="5">Zivara Payment / Transfer Transactions</td></tr><tr><th>Date</th><th>Reference / UTR</th><th>Narration</th><th>Purpose</th><th>Amount</th></tr>${repayments.length?repayments.map(r=>`<tr><td>${esc(dmy(r.Date))}</td><td>${esc(r._bank?.ReferenceID||r.VoucherNo||r.SourceID||"")}</td><td>${esc(r._narration||"")}</td><td>${esc(r._purpose)}</td><td class="amt">${n(r.Debit)}</td></tr>`).join(""):`<tr><td colspan="5">No Zivara payment / transfer transactions</td></tr>`}</table>
    </body></html>`;
    const blob=new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=`${person.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-settlement-statement.xls`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }

  function exportPDF(){
    if(!person)return;
    const w=window.open("","_blank","width=1200,height=850");if(!w)return alert("Please allow pop-ups to export PDF.");
    const expenseRows=personExpenses.map(e=>`<tr><td>${esc(dmy(e.Date))}</td><td>${esc(bucket(e))}</td><td>${esc(e.Description||e.VendorOrPerson||"")}</td><td class="num">${esc(fmt(e.Amount))}</td><td>${esc(e.Status||"")}</td></tr>`).join("");
    const journalRows=managementJournals.map(r=>`<tr><td>${esc(dmy(r.Date))}</td><td>${esc(r._journalType)}</td><td>${esc(r._from||"—")}</td><td>${esc(r._to||"—")}</td><td>${esc(r._clean||"—")}</td><td class="num">${Number(r.Debit||0)>0?esc(fmt(r.Debit)):"—"}</td><td class="num">${Number(r.Credit||0)>0?esc(fmt(r.Credit)):"—"}</td></tr>`).join("");
    const paymentRows=repayments.map(r=>`<tr><td>${esc(dmy(r.Date))}</td><td>${esc(r._bank?.ReferenceID||r.VoucherNo||r.SourceID||"")}</td><td>${esc(r._narration||"")}</td><td>${esc(r._purpose)}</td><td class="num">${esc(fmt(r.Debit))}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>${esc(person)} Settlement Statement</title><style>
      @page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#111;font-size:10px;margin:0}h1{font-size:18px;margin:0 0 3px}h2{font-size:13px;margin:18px 0 7px;border-bottom:1px solid #777;padding-bottom:4px}
      .summary{width:540px;max-width:100%;border-collapse:collapse;margin-top:8px}.summary td{padding:4px 2px;border:0}.summary td:last-child{text-align:right;font-weight:600}.summary .total td{padding-top:7px;border-top:1px solid #999;font-weight:700}.summary .net td{padding-top:7px;border-top:2px solid #222;font-size:12px;font-weight:800}
      .mix{margin-top:10px;line-height:1.8}.mix span{margin-right:18px;white-space:nowrap}.txn{width:100%;border-collapse:collapse}.txn th,.txn td{border:1px solid #aaa;padding:4px 5px;vertical-align:top;line-height:1.3;overflow-wrap:anywhere;word-break:break-word}.txn th{background:#eee;text-align:left}.num{text-align:right;white-space:nowrap}
    </style></head><body>
      <h1>Zivara Family Office LLP — Partner / Staff Settlement Statement</h1><div><strong>${esc(person)}</strong> · ${esc(dmy(from)||"Start")} to ${esc(dmy(to)||"Latest")}</div>
      <h2>Settlement Summary</h2><table class="summary">
        <tr><td>Own Expenses Paid Personally</td><td>${esc(fmt(expenseTotal))}</td></tr><tr><td>Less: Refunds / Cancellations</td><td>${esc(fmt(refundTotal))}</td></tr><tr><td>Less: Received from Another Person</td><td>${esc(fmt(receivedFromPersonTotal))}</td></tr><tr><td>Add: Paid to Another Person on behalf of Zivara</td><td>${esc(fmt(paidToPersonTotal))}</td></tr>
        ${Math.abs(otherAdjustmentNet)>0.005?`<tr><td>Other Adjustments Net</td><td>${esc(fmt(otherAdjustmentNet))}</td></tr>`:""}<tr class="total"><td>Total Claim Before Zivara Payment</td><td>${esc(fmt(totalClaimBeforeZivara))}</td></tr><tr><td>Less: Paid Directly by Zivara</td><td>${esc(fmt(reimbursedTotal))}</td></tr><tr class="net"><td>NET AMOUNT DUE</td><td>${esc(fmt(reimbursementBalance))}</td></tr>
      </table>
      <div class="mix"><strong>Expense Mix:</strong> <span>Travel ${esc(fmt(byCategory.Travel))}</span><span>Hotel ${esc(fmt(byCategory.Hotel))}</span><span>Food ${esc(fmt(byCategory.Food))}</span><span>Misc / Other ${esc(fmt(byCategory["Misc / Other"]))}</span>${otherTransferTotal>0?`<span>Other Transfers / Advances ${esc(fmt(otherTransferTotal))}</span>`:""}</div>
      <h2>Expense Transactions</h2><table class="txn"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>${expenseRows||'<tr><td colspan="5">No expense transactions</td></tr>'}</tbody></table>
      <h2>Refund / Inter-person / Adjustment Transactions</h2><table class="txn"><thead><tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th>Narration</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${journalRows||'<tr><td colspan="7">No journal settlement transactions</td></tr>'}</tbody></table>
      <h2>Zivara Payment / Transfer Transactions</h2><table class="txn"><thead><tr><th>Date</th><th>Reference / UTR</th><th>Narration</th><th>Purpose</th><th>Amount</th></tr></thead><tbody>${paymentRows||'<tr><td colspan="5">No Zivara payment / transfer transactions</td></tr>'}</tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);w.document.close();
  }

  return <div style={page}>
    <div style={{display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
      <div><h2 style={{margin:0}}>Partner / Staff Statement</h2><p style={{color:"var(--muted)",fontSize:".8rem",margin:".25rem 0 0"}}>Personal expense, category and repayment history for a selected person.</p></div>
      <div style={{display:"flex",gap:".5rem"}}><button style={btn()} onClick={exportExcel}>Export Excel</button><button style={btn()} onClick={exportPDF}>Export PDF</button></div>
    </div>

    {error&&<div style={{...card,color:"var(--danger)"}}>{error}</div>}

    <div style={{...card,...grid12,alignItems:"end"}}>
      <div style={{gridColumn:"span 2"}}><label style={{fontSize:".72rem",color:"var(--muted)"}}>Person</label><select style={inp} value={person} onChange={e=>setPerson(e.target.value)}><option value="">— Select —</option>{people.map(x=><option key={x}>{x}</option>)}</select></div>
      <div style={{gridColumn:"span 2"}}><label style={{fontSize:".72rem",color:"var(--muted)"}}>From Date</label><input style={inp} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
      <div style={{gridColumn:"span 2"}}><label style={{fontSize:".72rem",color:"var(--muted)"}}>To Date</label><input style={inp} type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
      <div style={{gridColumn:"span 2"}}><label style={{fontSize:".72rem",color:"var(--muted)"}}>Category</label><select style={inp} value={category} onChange={e=>setCategory(e.target.value)}><option value="">All</option>{["Travel","Hotel","Food","Misc / Other"].map(x=><option key={x}>{x}</option>)}</select></div>
      <div style={{gridColumn:"span 2"}}><label style={{fontSize:".72rem",color:"var(--muted)"}}>Expense Status</label><select style={inp} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option>{["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}</select></div>
      <div style={{gridColumn:"span 2"}}><label style={{fontSize:".72rem",color:"var(--muted)"}}>Filters</label><button type="button" style={{...btn(),width:"100%"}} onClick={resetFilters}>Reset Filters</button></div>
    </div>

    {loading?<div style={card}>Loading...</div>:<>
      <div style={grid12}>
        <div style={{...card,gridColumn:"span 8",padding:"1rem 1.1rem"}}>
          <div style={{fontWeight:800,fontSize:".92rem",marginBottom:".8rem",whiteSpace:"normal",overflowWrap:"anywhere"}}>{person} · Settlement Summary</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:".8rem"}}>
            <div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700,lineHeight:1.3}}>OWN EXPENSES PAID PERSONALLY</div><div style={{fontSize:".95rem",fontWeight:800,marginTop:".15rem"}}>{fmt(expenseTotal)}</div></div>
            <div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700,lineHeight:1.3}}>LESS: REFUNDS / CANCELLATIONS</div><div style={{fontSize:".95rem",fontWeight:800,marginTop:".15rem",color:"#4ade80"}}>{fmt(refundTotal)}</div></div>
            {receivedFromPersonTotal>0&&<div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700,lineHeight:1.3}}>LESS: RECEIVED FROM ANOTHER PERSON</div><div style={{fontSize:".95rem",fontWeight:800,marginTop:".15rem",color:"#4ade80"}}>{fmt(receivedFromPersonTotal)}</div></div>}
            {paidToPersonTotal>0&&<div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700,lineHeight:1.3}}>ADD: PAID TO ANOTHER PERSON ON BEHALF OF ZIVARA</div><div style={{fontSize:".95rem",fontWeight:800,marginTop:".15rem",color:"#fbbf24"}}>{fmt(paidToPersonTotal)}</div></div>}
            {Math.abs(otherAdjustmentNet)>0.005&&<div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700,lineHeight:1.3}}>OTHER ADJUSTMENTS NET</div><div style={{fontSize:".95rem",fontWeight:800,marginTop:".15rem"}}>{fmt(Math.abs(otherAdjustmentNet))}</div></div>}
          </div>
          <div style={{marginTop:".85rem",padding:".75rem",border:"1px solid var(--border)",borderRadius:"8px",display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:".75rem"}}>
            <div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:800,lineHeight:1.3}}>TOTAL CLAIM BEFORE ZIVARA PAYMENT</div><div style={{fontSize:"1rem",fontWeight:850,marginTop:".15rem"}}>{fmt(Math.max(0,totalClaimBeforeZivara))}</div></div>
            <div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:800,lineHeight:1.3}}>LESS: PAID DIRECTLY BY ZIVARA</div><div style={{fontSize:"1rem",fontWeight:850,marginTop:".15rem",color:"#4ade80"}}>{fmt(reimbursedTotal)}</div></div>
            <div><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:800,lineHeight:1.3}}>NET AMOUNT DUE</div><div style={{fontSize:"1.12rem",fontWeight:900,marginTop:".12rem",color:reimbursementBalance>0?"#fbbf24":"#4ade80"}}>{fmt(reimbursementBalance)}</div></div>
          </div>
        </div>
        <div style={{...card,gridColumn:"span 4",padding:"1rem 1.1rem"}}>
          <div style={{fontWeight:800,fontSize:".92rem",marginBottom:".8rem"}}>Expense Mix</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:".9rem"}}>
            {[["Travel",byCategory.Travel],["Hotel",byCategory.Hotel],["Food",byCategory.Food],["Misc / Other",byCategory["Misc / Other"]]].map(([k,v])=><div key={k} style={{minWidth:0}}><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700,lineHeight:1.3,whiteSpace:"normal",overflowWrap:"anywhere"}}>{k.toUpperCase()}</div><div style={{fontSize:".95rem",fontWeight:800,marginTop:".15rem",whiteSpace:"nowrap"}}>{fmt(v)}</div></div>)}
          </div>
          {otherTransferTotal>0&&<div style={{marginTop:".9rem",paddingTop:".75rem",borderTop:"1px solid var(--border)"}}><div style={{fontSize:".62rem",color:"var(--muted)",fontWeight:700}}>OTHER TRANSFERS / ADVANCES</div><div style={{fontSize:".95rem",fontWeight:800,color:"#fbbf24",marginTop:".15rem"}}>{fmt(otherTransferTotal)}</div></div>}
        </div>
      </div>

      <div style={{...card,padding:0}}><div style={{padding:".85rem 1rem",fontWeight:750,borderBottom:"1px solid var(--border)"}}>Expense History · {personExpenses.length} records</div><div style={tableWrap}><table style={tableStyle}><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Paid By</th><th>Status</th></tr></thead><tbody>{personExpenses.length?personExpenses.map(e=><tr key={e.ExpenseID}><td>{dmy(e.Date)}</td><td>{bucket(e)}</td><td style={{whiteSpace:"normal",overflowWrap:"anywhere",wordBreak:"break-word",lineHeight:1.35}}>{e.Description||e.VendorOrPerson||"—"}</td><td style={{fontWeight:700}}>{fmt(e.Amount)}</td><td>{e.PaidBy||"—"}</td><td>{e.Status||"—"}</td></tr>):<tr><td colSpan="6" style={{padding:"1.5rem",textAlign:"center"}}>No expenses for the selected filters.</td></tr>}</tbody></table></div></div>

      <div style={{...card,padding:0}}><div style={{padding:".85rem 1rem",fontWeight:750,borderBottom:"1px solid var(--border)"}}>Refund / Inter-person / Adjustment History · {managementJournals.length} records</div><div style={tableWrap}><table style={tableStyle}><thead><tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th>Narration</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{managementJournals.length?managementJournals.map((r,i)=><tr key={`${r.JournalID}-${i}`}><td>{dmy(r.Date)}</td><td>{r._journalType}</td><td>{r._from||"—"}</td><td>{r._to||"—"}</td><td style={{whiteSpace:"normal",overflowWrap:"anywhere",wordBreak:"break-word",lineHeight:1.35}}>{r._clean||"—"}</td><td>{Number(r.Debit||0)>0?fmt(r.Debit):"—"}</td><td>{Number(r.Credit||0)>0?fmt(r.Credit):"—"}</td></tr>):<tr><td colSpan="7" style={{padding:"1.5rem",textAlign:"center"}}>No refund or inter-person journal entries in the selected period.</td></tr>}</tbody></table></div></div>

      <div style={{...card,padding:0}}><div style={{padding:".85rem 1rem",fontWeight:750,borderBottom:"1px solid var(--border)"}}>Repayment / Transfer History · {repayments.length} records</div><div style={tableWrap}><table style={tableStyle}><thead><tr><th>Date</th><th>Reference / UTR</th><th>Narration</th><th>Purpose</th><th>Amount</th></tr></thead><tbody>{repayments.length?repayments.map((r,i)=><tr key={`${r.JournalID}-${i}`}><td>{dmy(r.Date)}</td><td>{r._bank?.ReferenceID||r.VoucherNo||r.SourceID||"—"}</td><td style={{whiteSpace:"normal",overflowWrap:"anywhere",wordBreak:"break-word",lineHeight:1.35}}>{r._narration||"—"}</td><td><select style={{...inp,minWidth:160}} value={r._purpose} disabled={!r._bank} onChange={e=>markPurpose(r,e.target.value)}>{PURPOSES.map(x=><option key={x}>{x}</option>)}</select></td><td style={{fontWeight:700}}>{fmt(r.Debit)}</td></tr>):<tr><td colSpan="5" style={{padding:"1.5rem",textAlign:"center"}}>No bank/cash transfers found in the selected period.</td></tr>}</tbody></table></div></div>

      <div style={{...card,fontSize:".76rem",color:"var(--muted)"}}>
        <strong style={{color:"var(--text)"}}>Reconciliation note:</strong> Use the Purpose dropdown to classify each transfer. Expense Reimbursement is reported separately from advances, drawings, loan settlements and other transfers.
      </div>
    </>}
  </div>;
}
