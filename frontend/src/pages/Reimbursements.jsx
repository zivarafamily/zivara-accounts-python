import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { formatDate } from "../utils/format";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.25rem"};
const inp={width:"100%",boxSizing:"border-box",padding:".5rem .65rem",background:"var(--input,#1e293b)",border:"1px solid var(--border)",borderRadius:"6px",color:"var(--text)",fontSize:".875rem"};
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2});
const PENDING=["Draft","Submitted","Approved","Pending"];
const sourceColor={Expense:"#f59e0b",Payable:"#6366f1"};

export default function Reimbursements({role="admin",employeeRef=""}){
  const isOwn=(role==="partner"||role==="rm")&&employeeRef;
  const[rows,setRows]=useState([]),[banks,setBanks]=useState([]),[loading,setLoading]=useState(false),[reimbursing,setReimbursing]=useState(false);
  const[paidByFilter,setPaidByFilter]=useState(""),[settleFilter,setSettleFilter]=useState(""),[statusFilter,setStatusFilter]=useState(""),[monthFilter,setMonthFilter]=useState("");
  const[selected,setSelected]=useState({});
  const[payment,setPayment]=useState({ReimburseDate:new Date().toISOString().slice(0,10),ReimburseMode:"Bank",ReimburseAccount:"",ReimburseRef:""});

  async function loadData(){
    setLoading(true);
    try{
      const[report,bankRes]=await Promise.allSettled([apiGet("getReimbursementReport"),apiGet("getBankAccounts")]);
      if(report.status==="fulfilled"&&report.value.ok)setRows((report.value.data||[]).map(r=>({...r,SettlementTo:r.SettlementTo||r.ReimburseTo||r.PaidBy||"",ReimburseTo:r.ReimburseTo||r.SettlementTo||r.PaidBy||"",ActualPaidBy:r.ActualPaidBy||r.PaidBy||"",Amount:Number(r.Amount||0)})));
      if(bankRes.status==="fulfilled"&&bankRes.value.ok)setBanks((bankRes.value.data||[]).filter(b=>b.IsActive!=="No"));
    }finally{setLoading(false);setSelected({});}
  }
  useEffect(()=>{loadData()},[]);

  const canManage=["admin","managing_partner"].includes(role);
  const base=isOwn?rows.filter(r=>String(r.ActualPaidBy||"").trim()===String(employeeRef).trim()||String(r.SettlementTo||"").trim()===String(employeeRef).trim()):rows;
  const allPaidBy=useMemo(()=>[...new Set(rows.map(r=>r.ActualPaidBy).filter(Boolean))].sort(),[rows]);
  const allSettle=useMemo(()=>[...new Set(rows.map(r=>r.SettlementTo).filter(Boolean))].sort(),[rows]);
  const allMonths=useMemo(()=>[...new Set(rows.map(r=>r.BillingMonth).filter(Boolean))].sort().reverse(),[rows]);
  const filtered=base.filter(r=>(!paidByFilter||r.ActualPaidBy===paidByFilter)&&(!settleFilter||r.SettlementTo===settleFilter)&&(!statusFilter||r.Status===statusFilter)&&(!monthFilter||r.BillingMonth===monthFilter));
  const pending=filtered.filter(r=>PENDING.includes(r.Status));
  const selectedRows=pending.filter(r=>selected[r.RefID]);
  const selectedTotal=selectedRows.reduce((s,r)=>s+r.Amount,0);
  const allSelected=pending.length>0&&pending.every(r=>selected[r.RefID]);

  const summary=useMemo(()=>{
    const map={};
    base.forEach(r=>{if(!r.SettlementTo)return;if(!map[r.SettlementTo])map[r.SettlementTo]={total:0,pending:0,count:0};map[r.SettlementTo].total+=r.Amount;if(PENDING.includes(r.Status)){map[r.SettlementTo].pending+=r.Amount;map[r.SettlementTo].count+=1;}});
    return Object.entries(map).map(([name,v])=>({name,...v})).sort((a,b)=>b.pending-a.pending);
  },[base]);

  function toggleAll(){
    setSelected(prev=>{const next={...prev};if(allSelected)pending.forEach(r=>delete next[r.RefID]);else pending.forEach(r=>next[r.RefID]=true);return next;});
  }

  async function reimburseSelected(){
    if(!selectedRows.length)return;
    if(payment.ReimburseMode!=="Petty Cash"&&!payment.ReimburseAccount){alert("Select the Zivara bank account used for reimbursement");return;}
    setReimbursing(true);
    try{
      for(const row of selectedRows){
        if(row.Source==="Payable"){
          // Store the actual reimbursement bank on the existing payable field.
          // Accounting sync then creates Dr Partner / Cr Bank automatically.
          if(payment.ReimburseMode!=="Petty Cash"){
            await apiPost("updatePayable",{PayableID:row.RefID,BankAccount:payment.ReimburseAccount});
          }
          await apiPost("reimbursePayable",{PayableID:row.RefID,ReimburseTo:row.SettlementTo,ReimbursementDate:payment.ReimburseDate,ReimbursementRef:payment.ReimburseRef,force:true});
        }else{
          await apiPost("reimburseExpense",{ExpenseID:row.RefID,ReimburseTo:row.SettlementTo,ReimburseDate:payment.ReimburseDate,ReimburseMode:payment.ReimburseMode,ReimburseAccount:payment.ReimburseMode==="Petty Cash"?"Petty Cash":payment.ReimburseAccount,ReimburseRef:payment.ReimburseRef,force:true});
        }
      }
      await loadData();
    }catch(err){alert(err.message||"Unable to reimburse selected items");}
    finally{setReimbursing(false);}
  }

  return <div style={{display:"flex",flexDirection:"column",gap:"1.25rem"}}>
    <div><h2 style={{margin:0,fontSize:"1.2rem",fontWeight:700}}>Reimbursements Due</h2><p style={{margin:0,fontSize:".8rem",color:"var(--muted)"}}>Partner/personal payments that Zivara must reimburse. Reimbursement posts automatically to the selected bank ledger.</p></div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:".75rem"}}>
      <div style={{...card,borderLeft:"3px solid var(--accent)"}}><div style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600,textTransform:"uppercase"}}>Total Pending</div><div style={{fontSize:"1.4rem",fontWeight:700,color:"var(--accent)",marginTop:".35rem"}}>{fmt(summary.reduce((s,x)=>s+x.pending,0))}</div></div>
      {summary.map(s=><div key={s.name} onClick={()=>setSettleFilter(p=>p===s.name?"":s.name)} style={{...card,borderLeft:`3px solid ${s.pending>0?"#f59e0b":"#22c55e"}`,cursor:"pointer",outline:settleFilter===s.name?"2px solid var(--accent)":"none"}}><div style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600,textTransform:"uppercase"}}>{s.name}</div><div style={{fontSize:"1.25rem",fontWeight:700,color:s.pending>0?"#f59e0b":"#22c55e",marginTop:".35rem"}}>{fmt(s.pending)}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{s.count} pending · {fmt(s.total)} total</div></div>)}
    </div>

    <div style={{...card,display:"flex",gap:".75rem",flexWrap:"wrap"}}>
      {!isOwn&&<select style={{...inp,maxWidth:180}} value={paidByFilter} onChange={e=>setPaidByFilter(e.target.value)}><option value="">All actual payers</option>{allPaidBy.map(x=><option key={x}>{x}</option>)}</select>}
      {!isOwn&&<select style={{...inp,maxWidth:180}} value={settleFilter} onChange={e=>setSettleFilter(e.target.value)}><option value="">All reimburse to</option>{allSettle.map(x=><option key={x}>{x}</option>)}</select>}
      <select style={{...inp,maxWidth:160}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{["Draft","Submitted","Approved","Pending","Reimbursed","Rejected"].map(x=><option key={x}>{x}</option>)}</select>
      <select style={{...inp,maxWidth:160}} value={monthFilter} onChange={e=>setMonthFilter(e.target.value)}><option value="">All months</option>{allMonths.map(x=><option key={x}>{x}</option>)}</select>
    </div>

    {canManage&&<div style={{...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:".75rem",alignItems:"end"}}>
      <div><div style={{fontSize:".72rem",color:"var(--muted)"}}>Selected</div><div style={{fontSize:"1.25rem",fontWeight:700,color:selectedTotal?"#22c55e":"var(--muted)"}}>{fmt(selectedTotal)}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{selectedRows.length} item(s)</div></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Payment Date</label><input style={inp} type="date" value={payment.ReimburseDate} onChange={e=>setPayment(p=>({...p,ReimburseDate:e.target.value}))}/></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Mode</label><select style={inp} value={payment.ReimburseMode} onChange={e=>setPayment(p=>({...p,ReimburseMode:e.target.value,ReimburseAccount:e.target.value==="Petty Cash"?"":p.ReimburseAccount}))}><option>Bank</option><option>UPI</option><option>Cheque</option><option>Petty Cash</option></select></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Zivara Bank Account</label><select style={inp} disabled={payment.ReimburseMode==="Petty Cash"} value={payment.ReimburseAccount} onChange={e=>setPayment(p=>({...p,ReimburseAccount:e.target.value}))}><option value="">— Select bank —</option>{banks.map(b=><option key={b.AccountID} value={b.AccountID}>{b.AccountName} · {b.BankName} · {String(b.AccountNumber||"").slice(-4)}</option>)}</select></div>
      <div><label style={{fontSize:".72rem",color:"var(--muted)"}}>Reference / UTR</label><input style={inp} value={payment.ReimburseRef} onChange={e=>setPayment(p=>({...p,ReimburseRef:e.target.value}))}/></div>
      <button disabled={reimbursing||!selectedRows.length} onClick={reimburseSelected} style={{padding:".55rem .8rem",borderRadius:"6px",border:"1px solid #22c55e",background:"#22c55e22",color:"#22c55e",fontWeight:700,cursor:selectedRows.length?"pointer":"not-allowed"}}>{reimbursing?"Posting...":"Reimburse Selected"}</button>
    </div>}

    <div style={card}>
      {loading?<p style={{color:"var(--muted)",textAlign:"center"}}>Loading...</p>:filtered.length===0?<p style={{color:"var(--muted)",textAlign:"center"}}>No records found.</p>:<div style={{overflowX:"auto"}}><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th><th>Source</th><th>Date</th><th>Actual Paid By</th><th>Reimburse To</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filtered.map(r=><tr key={`${r.Source}-${r.RefID}`}><td>{PENDING.includes(r.Status)&&<input type="checkbox" checked={!!selected[r.RefID]} onChange={e=>setSelected(p=>({...p,[r.RefID]:e.target.checked}))}/>}</td><td><span style={{color:sourceColor[r.Source]||"var(--muted)",fontWeight:700}}>{r.Source}</span></td><td>{formatDate(r.Date)}</td><td>{r.ActualPaidBy||"—"}</td><td style={{fontWeight:600}}>{r.SettlementTo||"—"}</td><td>{r.Description||r.VendorName||"—"}</td><td style={{fontWeight:700}}>{fmt(r.Amount)}</td><td>{r.Status}</td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}
