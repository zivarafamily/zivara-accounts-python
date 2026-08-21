import { useEffect,useMemo,useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client";
import { useLLP } from "../context/LLPContext";
import { formatDate } from "../utils/format";

const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem 1.1rem"};
const label={fontSize:".68rem",color:"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"};
const btn=(primary=false)=>({border:primary?"none":"1px solid var(--border)",background:primary?"var(--accent)":"transparent",color:primary?"#fff":"var(--text)",borderRadius:"7px",padding:".55rem .85rem",cursor:"pointer",fontWeight:700,fontSize:".78rem"});
function pick(s,...keys){for(const k of keys){if(s?.[k]!==undefined&&s?.[k]!==null)return Number(s[k])||0}return 0}

export default function Dashboard(){
 const navigate=useNavigate(),{currentLLP}=useLLP();
 const[data,setData]=useState({summary:{},payables:[],bankAccounts:[]}),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);try{const[d,b]=await Promise.allSettled([apiGet("getAccountsDashboard"),apiGet("getBankAccounts")]);if(d.status==="fulfilled"&&d.value.ok)setData(p=>({...p,...d.value}));if(b.status==="fulfilled"&&b.value.ok)setData(p=>({...p,bankAccounts:b.value.data||[]}));}finally{setLoading(false)}}
 useEffect(()=>{load()},[currentLLP?.llpId,currentLLP?.LLPID,currentLLP?.global]);
 const s=data.summary||{};
 const bankBalance=pick(s,"ActiveBankBalance","bank_balance_total");
 const payablesOutstanding=pick(s,"PayablesOutstanding","pending_payables_total");
 const reimbursementPending=pick(s,"ReimbursementPending","pending_reimbursements_total");
 const gstAmount=pick(s,"PayablesGST");
 const tdsAmount=pick(s,"PayablesTDS");
 const activeBanks=useMemo(()=>(data.bankAccounts||[]).filter(a=>String(a.IsActive||"Yes").toLowerCase()!=="no"),[data.bankAccounts]);
 const payables=useMemo(()=>(data.payables||[]).filter(p=>Number(p.BalanceAmount||0)>0).sort((a,b)=>String(a.DueDate||"9999").localeCompare(String(b.DueDate||"9999"))).slice(0,5),[data.payables]);
 const kpis=[["Bank Balance",fmt(bankBalance),"var(--success)","/transactions"],["Vendor Bills Outstanding",fmt(payablesOutstanding),"var(--warning)","/payment-tracker"],["Reimbursements Pending",fmt(reimbursementPending),"var(--warning)","/reimbursements"],["GST Input",fmt(gstAmount),"var(--accent2)","/reconciliation"]];

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
