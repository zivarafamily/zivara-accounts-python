import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";
import {
  listManualJournals,
  getManualJournal,
  updateManualJournal,
  deleteManualJournal,
} from "../api/journalApi";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem"};
const inputStyle={width:"100%",boxSizing:"border-box",padding:".58rem .65rem",borderRadius:"7px",border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)"};
const btn=(primary=false)=>({border:primary?"none":"1px solid var(--border)",background:primary?"var(--accent)":"transparent",color:primary?"#fff":"var(--text)",borderRadius:"7px",padding:".55rem .85rem",cursor:"pointer",fontWeight:700,fontSize:".8rem"});
const money=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const blankLine=()=>({LedgerID:"",Debit:"",Credit:"",Particulars:""});

export default function JournalEntries(){
  const{currentLLP}=useLLP();
  const[ledgers,setLedgers]=useState([]);
  const[history,setHistory]=useState([]);
  const[date,setDate]=useState(today());
  const[voucherNo,setVoucherNo]=useState("");
  const[narration,setNarration]=useState("");
  const[lines,setLines]=useState([blankLine(),blankLine()]);
  const[editId,setEditId]=useState("");
  const[saving,setSaving]=useState(false);
  const[loadingHistory,setLoadingHistory]=useState(false);
  const[message,setMessage]=useState("");
  const[error,setError]=useState("");

  async function loadLedgers(){
    try{
      const res=await apiGet("getLedgers");
      if(res?.ok)setLedgers((res.data||[]).filter(x=>String(x.Status||"Active").toLowerCase()!=="inactive"));
    }catch(e){setError(e?.message||"Could not load ledgers.")}
  }

  async function loadHistory(){
    setLoadingHistory(true);
    try{
      const res=await listManualJournals();
      if(res?.ok)setHistory(res.data||[]);
    }catch(e){setError(e?.message||"Could not load journal history.")}
    finally{setLoadingHistory(false)}
  }

  useEffect(()=>{
    loadLedgers();
    loadHistory();
  },[currentLLP?.llpId,currentLLP?.LLPID,currentLLP?.global]);

  const totals=useMemo(()=>{
    const debit=lines.reduce((s,x)=>s+Number(x.Debit||0),0);
    const credit=lines.reduce((s,x)=>s+Number(x.Credit||0),0);
    return{debit,credit,difference:debit-credit};
  },[lines]);

  const balanced=totals.debit>0&&totals.credit>0&&Math.abs(totals.difference)<0.005;

  function updateLine(index,field,value){
    setLines(prev=>prev.map((line,i)=>{
      if(i!==index)return line;
      const next={...line,[field]:value};
      if(field==="Debit"&&Number(value||0)>0)next.Credit="";
      if(field==="Credit"&&Number(value||0)>0)next.Debit="";
      return next;
    }));
    setError("");setMessage("");
  }

  function addLine(){setLines(prev=>[...prev,blankLine()])}
  function removeLine(index){
    if(lines.length<=2)return;
    setLines(prev=>prev.filter((_,i)=>i!==index));
  }

  function resetForm(){
    setDate(today());setVoucherNo("");setNarration("");
    setLines([blankLine(),blankLine()]);setEditId("");
    setError("");
  }

  function validate(){
    if(!date)return"Date is required.";
    const used=lines.filter(x=>x.LedgerID||Number(x.Debit||0)>0||Number(x.Credit||0)>0);
    if(used.length<2)return"Enter at least two journal lines.";
    for(const line of used){
      if(!line.LedgerID)return"Select a ledger for every journal line.";
      const dr=Number(line.Debit||0),cr=Number(line.Credit||0);
      if(dr<0||cr<0)return"Debit and credit cannot be negative.";
      if(dr>0&&cr>0)return"A journal line cannot contain both debit and credit.";
      if(dr<=0&&cr<=0)return"Each journal line must contain a debit or credit amount.";
    }
    if(!balanced)return`Journal is not balanced. Difference: ${money(Math.abs(totals.difference))}`;
    return"";
  }

  function payload(){
    return{
      Date:date,VoucherType:"Journal",VoucherNo:voucherNo.trim(),
      Narration:narration.trim(),SourceType:"manual",
      Lines:lines.filter(x=>x.LedgerID&&(Number(x.Debit||0)>0||Number(x.Credit||0)>0)).map(x=>({
        LedgerID:x.LedgerID,Debit:Number(x.Debit||0),Credit:Number(x.Credit||0),
        Particulars:(x.Particulars||narration||"").trim()
      }))
    };
  }

  async function save(){
    setError("");setMessage("");
    const validation=validate();
    if(validation){setError(validation);return}
    setSaving(true);
    try{
      if(editId){
        await updateManualJournal(editId,payload());
        setMessage(`Journal updated successfully · ${editId}.`);
      }else{
        const res=await apiPost("saveJournal",payload());
        setMessage(`Journal saved successfully${res?.JournalID?` · ${res.JournalID}`:""}.`);
      }
      resetForm();
      await loadHistory();
    }catch(e){setError(e?.message||"Could not save journal entry.")}
    finally{setSaving(false)}
  }

  async function editJournal(item){
    setError("");setMessage("");
    try{
      const res=await getManualJournal(item.JournalID);
      const j=res.data;
      setEditId(j.JournalID);
      setDate(String(j.Date||"").slice(0,10));
      setVoucherNo(j.VoucherNo||"");
      setNarration(j.Narration||"");
      const loaded=(j.Lines||[]).map(x=>({
        LedgerID:x.LedgerID||"",
        Debit:Number(x.Debit||0)>0?String(x.Debit):"",
        Credit:Number(x.Credit||0)>0?String(x.Credit):"",
        Particulars:x.Particulars||""
      }));
      setLines(loaded.length>=2?loaded:[...loaded,...Array(2-loaded.length).fill(0).map(blankLine)]);
      window.scrollTo({top:0,behavior:"smooth"});
    }catch(e){setError(e?.message||"Could not load journal for editing.")}
  }

  async function removeJournal(item){
    const label=item.VoucherNo||item.JournalID;
    if(!window.confirm(`Delete manual journal ${label}? This will remove its effect from all linked ledgers.`))return;
    setError("");setMessage("");
    try{
      await deleteManualJournal(item.JournalID);
      if(editId===item.JournalID)resetForm();
      setMessage(`Journal deleted successfully · ${label}.`);
      await loadHistory();
    }catch(e){setError(e?.message||"Could not delete journal.")}
  }

  return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
    <div>
      <h2 style={{margin:0,fontSize:"1.25rem",fontWeight:800}}>Journal Entry</h2>
      <p style={{margin:".25rem 0 0",color:"var(--muted)",fontSize:".8rem"}}>
        Use journals for accounting adjustments only. System-generated journals must be changed in their originating module.
      </p>
    </div>

    {editId&&<div style={{...card,borderColor:"var(--warning)"}}>
      <strong>Editing manual journal:</strong> {editId}
      <span style={{color:"var(--muted)",marginLeft:".5rem"}}>Changes will replace this journal's existing ledger lines.</span>
    </div>}

    <div style={card}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(150px,220px) minmax(180px,280px) 1fr",gap:".8rem"}}>
        <label style={{fontSize:".76rem",fontWeight:700}}>Date
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...inputStyle,marginTop:".3rem"}}/>
        </label>
        <label style={{fontSize:".76rem",fontWeight:700}}>Voucher No.
          <input value={voucherNo} onChange={e=>setVoucherNo(e.target.value)} placeholder="Optional" style={{...inputStyle,marginTop:".3rem"}}/>
        </label>
        <label style={{fontSize:".76rem",fontWeight:700}}>Narration
          <input value={narration} onChange={e=>setNarration(e.target.value)} placeholder="Reason for adjustment" style={{...inputStyle,marginTop:".3rem"}}/>
        </label>
      </div>
    </div>

    <div style={{...card,padding:0,overflow:"hidden"}}>
      <div style={{padding:".85rem 1rem",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--border)"}}>
        <div><div style={{fontWeight:750}}>Journal Lines</div><div style={{color:"var(--muted)",fontSize:".72rem",marginTop:".1rem"}}>Total Debit must equal Total Credit.</div></div>
        <button onClick={addLine} style={btn(false)}>+ Add Line</button>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th style={{minWidth:260}}>Ledger</th><th style={{minWidth:130}}>Debit</th><th style={{minWidth:130}}>Credit</th><th style={{minWidth:240}}>Particulars</th><th style={{width:70}}></th></tr></thead>
          <tbody>{lines.map((line,index)=><tr key={index}>
            <td><select value={line.LedgerID} onChange={e=>updateLine(index,"LedgerID",e.target.value)} style={inputStyle}>
              <option value="">Select ledger...</option>{ledgers.map(l=><option key={l.LedgerID} value={l.LedgerID}>{l.LedgerName} · {l.GroupName}</option>)}
            </select></td>
            <td><input type="number" min="0" step="0.01" value={line.Debit} onChange={e=>updateLine(index,"Debit",e.target.value)} placeholder="0.00" style={{...inputStyle,textAlign:"right"}}/></td>
            <td><input type="number" min="0" step="0.01" value={line.Credit} onChange={e=>updateLine(index,"Credit",e.target.value)} placeholder="0.00" style={{...inputStyle,textAlign:"right"}}/></td>
            <td><input value={line.Particulars} onChange={e=>updateLine(index,"Particulars",e.target.value)} placeholder="Optional line note" style={inputStyle}/></td>
            <td style={{textAlign:"center"}}><button onClick={()=>removeLine(index)} disabled={lines.length<=2} style={{...btn(false),padding:".4rem .55rem",opacity:lines.length<=2?.35:1}}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div style={{padding:".9rem 1rem",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:"1.25rem",flexWrap:"wrap"}}>
          <div><div style={{color:"var(--muted)",fontSize:".68rem"}}>TOTAL DEBIT</div><strong>{money(totals.debit)}</strong></div>
          <div><div style={{color:"var(--muted)",fontSize:".68rem"}}>TOTAL CREDIT</div><strong>{money(totals.credit)}</strong></div>
          <div><div style={{color:"var(--muted)",fontSize:".68rem"}}>DIFFERENCE</div><strong style={{color:balanced?"var(--success)":totals.debit||totals.credit?"var(--danger)":"var(--muted)"}}>{money(Math.abs(totals.difference))}</strong></div>
        </div>
        <div style={{display:"flex",gap:".55rem"}}>
          <button onClick={resetForm} style={btn(false)}>{editId?"Cancel Edit":"Clear"}</button>
          <button onClick={save} disabled={saving||!balanced} style={{...btn(true),opacity:saving||!balanced?.55:1}}>
            {saving?"Saving...":editId?"Update Journal":"Save Journal"}
          </button>
        </div>
      </div>
    </div>

    {error&&<div style={{...card,borderColor:"var(--danger)",color:"var(--danger)",fontSize:".8rem"}}>{error}</div>}
    {message&&<div style={{...card,borderColor:"var(--success)",color:"var(--success)",fontSize:".8rem"}}>{message}</div>}

    <div style={{...card,padding:0,overflow:"hidden"}}>
      <div style={{padding:".9rem 1rem",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--border)"}}>
        <div><div style={{fontWeight:750}}>Manual Journal History</div><div style={{color:"var(--muted)",fontSize:".72rem",marginTop:".1rem"}}>Only manually entered journals appear here and can be edited/deleted.</div></div>
        <button onClick={loadHistory} style={btn(false)}>Refresh</button>
      </div>
      <div style={{overflowX:"auto"}}>
        {loadingHistory?<div style={{padding:"1.5rem",color:"var(--muted)"}}>Loading journal history...</div>:
        history.length===0?<div style={{padding:"1.5rem",color:"var(--muted)"}}>No manual journals yet.</div>:
        <table style={{width:"100%"}}>
          <thead><tr><th>Date</th><th>Voucher No.</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Created By</th><th></th></tr></thead>
          <tbody>{history.map(j=><tr key={j.JournalID}>
            <td>{String(j.Date||"").slice(0,10)}</td>
            <td>{j.VoucherNo||"—"}</td>
            <td>{j.Narration||"—"}</td>
            <td style={{fontWeight:700}}>{money(j.TotalDebit)}</td>
            <td style={{fontWeight:700}}>{money(j.TotalCredit)}</td>
            <td>{j.CreatedBy||"—"}</td>
            <td style={{whiteSpace:"nowrap"}}>
              <button onClick={()=>editJournal(j)} style={btn(false)}>Edit</button>{" "}
              <button onClick={()=>removeJournal(j)} style={{...btn(false),color:"var(--danger)"}}>Delete</button>
            </td>
          </tr>)}</tbody>
        </table>}
      </div>
    </div>

    <div style={{...card,fontSize:".78rem",color:"var(--muted)"}}>
      <strong style={{color:"var(--text)"}}>Safety:</strong>{" "}
      Vendor Bills, Partner / Staff Expenses, Transactions, Neo invoices and other system-generated journals are deliberately excluded from this history. Edit them from their original module.
    </div>
  </div>;
}
