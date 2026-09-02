import { useEffect,useMemo,useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client";
import { useLLP } from "../context/LLPContext";
import { formatDate } from "../utils/format";

const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem 1.1rem"};
const label={fontSize:".68rem",color:"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"};
const btn=(primary=false)=>({border:primary?"none":"1px solid var(--border)",background:primary?"var(--accent)":"transparent",color:primary?"#fff":"var(--text)",borderRadius:"7px",padding:".55rem .85rem",cursor:"pointer",fontWeight:700,fontSize:".78rem"});
const fyStart="2026-04-01";

function pick(s,...keys){for(const k of keys){if(s?.[k]!==undefined&&s?.[k]!==null)return Number(s[k])||0}return 0}

const journalMeta=(text,key)=>{
 const m=String(text||"").match(new RegExp(`\\[${key}:\\s*([^\\]]+)\\]`,"i"));
 return m?m[1].trim():"";
};

const getPurpose=text=>{
 const m=String(text||"").match(/\[Purpose:\s*([^\]]+)\]/i);
 if(m)return m[1].trim();
 const n=String(text||"").toLowerCase();
 if(n.includes("against invoice")||n.includes("against invouce")||n.includes("expenses paid as per invoice"))return "Expense Reimbursement";
 return "Advance / Transfer";
};

function findPersonLedger(ledgers,person){
 const n=String(person||"").trim().toLowerCase();
 if(!n)return null;
 const exact=(ledgers||[]).find(l=>String(l.LedgerName||"").trim().toLowerCase()===n);
 if(exact)return exact;
 return (ledgers||[]).find(l=>{
  const name=String(l.LedgerName||"").trim().toLowerCase();
  const group=String(l.GroupName||"").toLowerCase();
  const systemKey=String(l.SystemKey||"").toLowerCase();
  return name.includes(n)&&(
   group.includes("partner")||
   group.includes("staff")||
   group.includes("current liabilities")||
   systemKey.startsWith("person:")
  );
 })||null;
}

function managementJournalType(row){
 const text=String(row.Narration||row.Particulars||"");
 let type=journalMeta(text,"JournalType");
 if(type)return type;
 const n=text.toLowerCase();
 if(n.includes("refund")||n.includes("cancel"))return "Refund / Cancellation";
 if((n.includes("paid to")||n.includes(" paid "))&&(n.includes("dinu")||n.includes("manu")||n.includes("manugopal")))return "Inter-person Settlement";
 if(n.includes("opening"))return "Opening Adjustment";
 return "General Adjustment";
}

function rowInPeriod(row){
 const d=String(row?.Date||"").slice(0,10);
 return !d||d>=fyStart;
}

function computePersonSettlement({person,expenses,statement,bankRows,personLedger}){
 const personExpenses=(expenses||[]).filter(e=>{
  const d=String(e.Date||"").slice(0,10);
  return String(e.PaidBy||"").trim()===person&&(!d||d>=fyStart);
 });

 const managementJournals=(statement||[])
  .filter(r=>rowInPeriod(r)&&String(r.SourceType||"").toLowerCase()==="manual")
  .map(r=>({...r,_journalType:managementJournalType(r)}));

 const refundTotal=managementJournals
  .filter(r=>r._journalType==="Refund / Cancellation"&&Number(r.Debit||0)>0)
  .reduce((a,r)=>a+Number(r.Debit||0),0);

 const receivedFromPersonTotal=managementJournals
  .filter(r=>r._journalType==="Inter-person Settlement"&&Number(r.Debit||0)>0)
  .reduce((a,r)=>a+Number(r.Debit||0),0);

 const paidToPersonTotal=managementJournals
  .filter(r=>r._journalType==="Inter-person Settlement"&&Number(r.Credit||0)>0)
  .reduce((a,r)=>a+Number(r.Credit||0),0);

 const otherAdjustmentNet=managementJournals
  .filter(r=>!["Refund / Cancellation","Inter-person Settlement"].includes(r._journalType))
  .reduce((a,r)=>a+Number(r.Credit||0)-Number(r.Debit||0),0);

 const personalVendorBillTotal=(statement||[])
  .filter(r=>
   rowInPeriod(r)&&
   String(r.SourceType||"").toLowerCase()==="payable_payment_personal"&&
   Number(r.Credit||0)>0
  )
  .reduce((a,r)=>a+Number(r.Credit||0),0);

 const repayments=(statement||[]).filter(r=>{
  if(!rowInPeriod(r))return false;
  const source=String(r.SourceType||"").toLowerCase();
  const voucher=String(r.VoucherType||"").toLowerCase();
  const isTransfer=source==="cash_book"||source==="bank"||["bank","cash","payment","receipt"].includes(voucher);
  return isTransfer&&Number(r.Debit||0)>0;
 }).map(r=>{
  const bank=(bankRows||[]).find(x=>x.EntryID===r.SourceID)
   ||(bankRows||[]).find(x=>String(x.ReferenceID||"")&&String(x.ReferenceID||"")===String(r.VoucherNo||""))
   ||(bankRows||[]).find(x=>
    String(x.Date||"").slice(0,10)===String(r.Date||"").slice(0,10)&&
    Math.abs(Number(x.AmountOut||0)-Number(r.Debit||0))<0.01&&
    String(x.LedgerID||"")===String(personLedger?.LedgerID||"")
   );
  const narration=bank?.Description||r.Narration||r.Particulars||"";
  return {...r,_purpose:getPurpose(narration)};
 });

 const expenseTotal=personExpenses.reduce((s,x)=>s+Number(x.Amount||0),0);
 const reimbursedTotal=repayments
  .filter(r=>r._purpose==="Expense Reimbursement")
  .reduce((s,r)=>s+Number(r.Debit||0),0);

 const totalClaimBeforeZivara=
  expenseTotal+
  personalVendorBillTotal-
  refundTotal-
  receivedFromPersonTotal+
  otherAdjustmentNet+
  paidToPersonTotal;

 return Math.max(0,totalClaimBeforeZivara-reimbursedTotal);
}

export default function Dashboard(){
 const navigate=useNavigate(),{currentLLP}=useLLP();
 const[data,setData]=useState({summary:{},payables:[],bankAccounts:[]}),[loading,setLoading]=useState(true);
 const[settlementPending,setSettlementPending]=useState(null);

 async function load(){
  setLoading(true);
  try{
   const[d,b,e,l,p,u,bt]=await Promise.allSettled([
    apiGet("getAccountsDashboard"),
    apiGet("getBankAccounts"),
    apiGet("getExpenses"),
    apiGet("getLedgers"),
    apiGet("getPartners"),
    apiGet("getUsers"),
    apiGet("getBankTransactions")
   ]);

   if(d.status==="fulfilled"&&d.value.ok)setData(prev=>({...prev,...d.value}));
   if(b.status==="fulfilled"&&b.value.ok)setData(prev=>({...prev,bankAccounts:b.value.data||[]}));

   if(
    e.status==="fulfilled"&&e.value.ok&&
    l.status==="fulfilled"&&l.value.ok&&
    p.status==="fulfilled"&&p.value.ok&&
    u.status==="fulfilled"&&u.value.ok&&
    bt.status==="fulfilled"&&bt.value.ok
   ){
    const expenses=e.value.data||[];
    const ledgers=l.value.data||[];
    const partners=(p.value.data||[]).filter(x=>x.Status!=="Inactive");
    const users=(u.value.data||[]).filter(x=>x.Status!=="Inactive");
    const bankRows=bt.value.data||[];

    const people=[...new Set([
     ...partners.map(x=>x.PartnerName),
     ...users.map(x=>x.Name||x.FullName||x.Username),
     ...expenses.map(x=>x.PaidBy),
     ...expenses.map(x=>x.ReimburseTo),
     ...ledgers
      .filter(x=>String(x.SystemKey||"").toLowerCase().startsWith("person:"))
      .map(x=>x.LedgerName)
    ].map(x=>String(x||"").trim()).filter(Boolean))];

    const personContexts=people
     .map(person=>({person,personLedger:findPersonLedger(ledgers,person)}))
     .filter(x=>x.personLedger);

    const statementResults=await Promise.allSettled(
     personContexts.map(x=>apiGet("getLedgerStatement",{ledger_id:x.personLedger.LedgerID}))
    );

    let total=0;
    let usable=0;
    statementResults.forEach((result,index)=>{
     if(result.status!=="fulfilled"||!result.value.ok)return;
     const ctx=personContexts[index];
     total+=computePersonSettlement({
      person:ctx.person,
      expenses,
      statement:result.value.data||[],
      bankRows,
      personLedger:ctx.personLedger
     });
     usable+=1;
    });

    if(usable>0||personContexts.length===0)setSettlementPending(total);
   }
  }finally{
   setLoading(false);
  }
 }

 useEffect(()=>{load()},[currentLLP?.llpId,currentLLP?.LLPID,currentLLP?.global]);

 const s=data.summary||{};
 const bankBalance=pick(s,"ActiveBankBalance","bank_balance_total");
 const payablesOutstanding=pick(s,"PayablesOutstanding","pending_payables_total");
 const legacyReimbursementPending=pick(s,"ReimbursementPending","pending_reimbursements_total");
 const reimbursementPending=settlementPending===null?legacyReimbursementPending:settlementPending;
 const gstAmount=pick(s,"PayablesGST");
 const tdsAmount=pick(s,"PayablesTDS");
 const activeBanks=useMemo(()=>(data.bankAccounts||[]).filter(a=>String(a.IsActive||"Yes").toLowerCase()!=="no"),[data.bankAccounts]);
 const payables=useMemo(()=>(data.payables||[]).filter(p=>Number(p.BalanceAmount||0)>0).sort((a,b)=>String(a.DueDate||"9999").localeCompare(String(b.DueDate||"9999"))).slice(0,5),[data.payables]);
 const kpis=[
  ["Bank Balance",fmt(bankBalance),"var(--success)","/transactions"],
  ["Vendor Bills Outstanding",fmt(payablesOutstanding),"var(--warning)","/payment-tracker"],
  ["Partner / Staff Settlement Due",fmt(reimbursementPending),"var(--warning)","/partner-staff-statement"],
  ["GST Input",fmt(gstAmount),"var(--accent2)","/reconciliation"]
 ];

 return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
   <div><h2 style={{margin:0,fontSize:"1.25rem",fontWeight:800}}>Accounts Dashboard</h2><p style={{margin:".2rem 0 0",color:"var(--muted)",fontSize:".8rem"}}>Key balances and items needing attention</p></div>
   <button onClick={load} style={btn(false)}>Refresh</button>
  </div>

  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:".8rem"}}>
   {kpis.map(([name,val,color,to])=><button key={name} onClick={()=>navigate(to)} style={{...card,textAlign:"left",cursor:"pointer",minHeight:88}}><div style={label}>{name}</div><div style={{fontSize:"1.3rem",fontWeight:800,marginTop:".35rem",color}}>{val}</div></button>)}
  </div>

  <div style={{...card,display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
   <div><div style={{fontWeight:700}}>Quick Actions</div><div style={{color:"var(--muted)",fontSize:".73rem",marginTop:".15rem"}}>Go directly to the entry screen you need</div></div>
   <div style={{display:"flex",gap:".55rem",flexWrap:"wrap"}}>
    <button style={btn(true)} onClick={()=>navigate("/transactions")}>+ Add Transaction</button>
    <button style={btn(false)} onClick={()=>navigate("/payment-tracker")}>+ Vendor Bill</button>
    <button style={btn(false)} onClick={()=>navigate("/expenses")}>+ Partner / Staff Expense</button>
   </div>
  </div>

  {loading?<div style={{...card,textAlign:"center",color:"var(--muted)",padding:"2rem"}}>Loading dashboard…</div>:
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:"1rem"}}>
   <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:700}}>Outstanding Vendor Bills</div><div style={{color:"var(--muted)",fontSize:".72rem"}}>Next bills requiring payment</div></div><button style={btn(false)} onClick={()=>navigate("/payment-tracker")}>View Bills</button></div>
    {payables.length===0?<p style={{color:"var(--muted)",fontSize:".8rem"}}>No outstanding vendor bills.</p>:payables.map(p=><div key={p.PayableID||p.BillNo} style={{display:"flex",justifyContent:"space-between",gap:"1rem",padding:".65rem 0",borderBottom:"1px solid var(--border)",fontSize:".78rem"}}><div><div style={{fontWeight:650}}>{p.VendorName||"Vendor"}</div><div style={{color:"var(--muted)",fontSize:".7rem"}}>{p.BillNo||"Bill"}{p.DueDate?` · Due ${formatDate(p.DueDate)}`:""}</div></div><strong style={{color:"var(--warning)"}}>{fmt(p.BalanceAmount)}</strong></div>)}
   </div>

   <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontWeight:700}}>Bank Accounts</div><div style={{color:"var(--muted)",fontSize:".72rem"}}>Current balances</div></div><button style={btn(false)} onClick={()=>navigate("/bankaccounts")}>Manage</button></div>
    {activeBanks.length===0?<p style={{color:"var(--muted)",fontSize:".8rem"}}>No active bank accounts.</p>:activeBanks.map(a=><div key={a.AccountID||a.AccountNumber} style={{display:"flex",justifyContent:"space-between",gap:"1rem",padding:".65rem 0",borderBottom:"1px solid var(--border)",fontSize:".78rem"}}><div><div style={{fontWeight:650}}>{a.AccountName||a.BankName||"Bank"}</div><div style={{color:"var(--muted)",fontSize:".7rem"}}>{a.BankName||""}{a.AccountNumber?` · ...${String(a.AccountNumber).slice(-4)}`:""}</div></div><strong style={{color:Number(a.CurrentBalance||0)>=0?"var(--success)":"var(--danger)"}}>{fmt(a.CurrentBalance)}</strong></div>)}
   </div>

   <div style={card}>
    <div style={{fontWeight:700}}>Compliance</div><div style={{color:"var(--muted)",fontSize:".72rem"}}>Tax balances requiring attention</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".7rem",marginTop:".85rem"}}>
     <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:7}}><div style={label}>GST Input</div><div style={{marginTop:".25rem",fontWeight:800,color:"var(--accent2)"}}>{fmt(gstAmount)}</div></div>
     <div style={{padding:".75rem",border:"1px solid var(--border)",borderRadius:7}}><div style={label}>TDS To Deduct</div><div style={{marginTop:".25rem",fontWeight:800,color:"var(--danger)"}}>{fmt(tdsAmount)}</div></div>
    </div>
    <div style={{display:"flex",gap:".55rem",flexWrap:"wrap",marginTop:".85rem"}}><button style={btn(false)} onClick={()=>navigate("/reconciliation")}>Reconciliation</button><button style={btn(false)} onClick={()=>navigate("/ca-tds-report")}>TDS Report</button></div>
   </div>
  </div>}
 </div>
}
