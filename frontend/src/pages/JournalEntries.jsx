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
const JOURNAL_TYPES=["General Adjustment","Refund / Cancellation","Inter-person Settlement","Opening Adjustment","Other"];
const metaTag=(type,fromPerson,toPerson)=>[
  type?`[JournalType: ${type}]`:"",
  fromPerson?`[From: ${fromPerson}]`:"",
  toPerson?`[To: ${toPerson}]`:""
].filter(Boolean).join(" ");
const cleanMeta=text=>String(text||"")
  .replace(/\s*\[JournalType:\s*[^\]]+\]/ig,"")
  .replace(/\s*\[From:\s*[^\]]+\]/ig,"")
  .replace(/\s*\[To:\s*[^\]]+\]/ig,"")
  .replace(/\s+/g," ").trim();
const readMeta=(text,label)=>{
  const m=String(text||"").match(new RegExp(`\\[${label}:\\s*([^\\]]+)\\]`,"i"));
  return m?m[1].trim():"";
};

export default function JournalEntries(){
  const{currentLLP}=useLLP();
  const[ledgers,setLedgers]=useState([]);
  const[history,setHistory]=useState([]);
  const[date,setDate]=useState(today());
  const[voucherNo,setVoucherNo]=useState("");
  const[narration,setNarration]=useState("");
  const[journalType,setJournalType]=useState("General Adjustment");
  const[fromPerson,setFromPerson]=useState("");
  const[toPerson,setToPerson]=useState("");
  const[settlementAmount,setSettlementAmount]=useState("");
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

  const personLedgers=useMemo(()=>ledgers.filter(l=>{
    const g=String(l.GroupName||"").toLowerCase();
    return g.includes("partner")||g.includes("staff")||g.includes("other current liabilities");
  }).sort((a,b)=>String(a.LedgerName||"").localeCompare(String(b.LedgerName||""))),[ledgers]);

  function syncInterPerson(nextFrom=fromPerson,nextTo=toPerson,nextAmount=settlementAmount){
    const amount=Number(nextAmount||0);
    const fromLedger=personLedgers.find(l=>l.LedgerID===nextFrom);
    const toLedger=personLedgers.find(l=>l.LedgerID===nextTo);
    if(nextFrom&&nextTo&&nextFrom===nextTo){
      setError("From Person and To Person cannot be the same.");
      return;
    }
    const base=cleanMeta(narration);
    const human=(fromLedger&&toLedger&&amount>0)
      ?`${fromLedger.LedgerName} paid ${toLedger.LedgerName} ${money(amount)} against Zivara expenses`
      :base;
    if(fromLedger&&toLedger&&amount>0){
      setLines([
        {LedgerID:toLedger.LedgerID,Debit:String(amount),Credit:"",Particulars:`Received from ${fromLedger.LedgerName} against Zivara expenses`},
        {LedgerID:fromLedger.LedgerID,Debit:"",Credit:String(amount),Particulars:`Paid to ${toLedger.LedgerName} against Zivara expenses`}
      ]);
      if(!base||base.includes(" paid ")||base.includes("against Zivara expenses"))setNarration(human);
    }
  }

  function changeJournalType(value){
    setJournalType(value);
    setError("");setMessage("");
    if(value!=="Inter-person Settlement"){
      setFromPerson("");setToPerson("");setSettlementAmount("");
      if(lines.length<2)setLines([blankLine(),blankLine()]);
    }
  }

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
    setJournalType("General Adjustment");setFromPerson("");setToPerson("");setSettlementAmount("");
    setLines([blankLine(),blankLine()]);setEditId("");
    setError("");
  }

  function validate(){
    if(!date)return"Date is required.";
    if(journalType==="Inter-person Settlement"){
      if(!fromPerson)return"Select From Person.";
      if(!toPerson)return"Select To Person.";
      if(fromPerson===toPerson)return"From Person and To Person cannot be the same.";
      if(Number(settlementAmount||0)<=0)return"Enter the settlement amount.";
    }
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
    const baseNarration=cleanMeta(narration);
    const taggedNarration=[
      baseNarration,
      metaTag(journalType,journalType==="Inter-person Settlement"?personLedgers.find(l=>l.LedgerID===fromPerson)?.LedgerName:"",journalType==="Inter-person Settlement"?personLedgers.find(l=>l.LedgerID===toPerson)?.LedgerName:"")
    ].filter(Boolean).join(" ");
    return{
      Date:date,VoucherType:"Journal",VoucherNo:voucherNo.trim(),
      Narration:taggedNarration,SourceType:"manual",
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
      const rawNarration=j.Narration||"";
      const savedType=readMeta(rawNarration,"JournalType")||(
        /refund|cancel/i.test(rawNarration)?"Refund / Cancellation":
        /paid .* against zivara expenses|paid to|inter-person/i.test(rawNarration)?"Inter-person Settlement":
        /opening/i.test(rawNarration)?"Opening Adjustment":"General Adjustment"
      );
      setJournalType(savedType);
      setNarration(cleanMeta(rawNarration));
      const loaded=(j.Lines||[]).map(x=>({
        LedgerID:x.LedgerID||"",
        Debit:Number(x.Debit||0)>0?String(x.Debit):"",
        Credit:Number(x.Credit||0)>0?String(x.Credit):"",
        Particulars:x.Particulars||""
      }));
      setLines(loaded.length>=2?loaded:[...loaded,...Array(2-loaded.length).fill(0).map(blankLine)]);
      if(savedType==="Inter-person Settlement"&&loaded.length>=2){
        const fromName=readMeta(rawNarration,"From");
        const toName=readMeta(rawNarration,"To");
        const fromLedger=personLedgers.find(l=>String(l.LedgerName||"").trim()===fromName)||personLedgers.find(l=>l.LedgerID===loaded.find(x=>Number(x.Credit||0)>0)?.LedgerID);
        const toLedger=personLedgers.find(l=>String(l.LedgerName||"").trim()===toName)||personLedgers.find(l=>l.LedgerID===loaded.find(x=>Number(x.Debit||0)>0)?.LedgerID);
        setFromPerson(fromLedger?.LedgerID||"");
        setToPerson(toLedger?.LedgerID||"");
        setSettlementAmount(String(loaded.find(x=>Number(x.Debit||0)>0)?.Debit||""));
      }else{
        setFromPerson("");setToPerson("");setSettlementAmount("");
      }
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
        Use journals for accounting adjustments, refunds and inter-person settlements. System-generated journals must be changed in their originating module.
      </p>
    </div>

    {editId&&<div style={{...card,borderColor:"var(--warning)"}}>
      <strong>Editing manual journal:</strong> {editId}
      <span style={{color:"var(--muted)",marginLeft:".5rem"}}>Changes will replace this journal's existing ledger lines.</span>
    </div>}

    <div style={card}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".8rem"}}>
        <label style={{fontSize:".76rem",fontWeight:700}}>Date
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{...inputStyle,marginTop:".3rem"}}/>
        </label>
        <label style={{fontSize:".76rem",fontWeight:700}}>Journal Type
          <select value={journalType} onChange={e=>changeJournalType(e.target.value)} style={{...inputStyle,marginTop:".3rem"}}>
            {JOURNAL_TYPES.map(x=><option key={x}>{x}</option>)}
          </select>
        </label>
        <label style={{fontSize:".76rem",fontWeight:700}}>Voucher No.
          <input value={voucherNo} onChange={e=>setVoucherNo(e.target.value)} placeholder="Optional" style={{...inputStyle,marginTop:".3rem"}}/>
        </label>
        <label style={{fontSize:".76rem",fontWeight:700}}>Narration
          <input value={narration} onChange={e=>setNarration(e.target.value)} placeholder="Reason for adjustment" style={{...inputStyle,marginTop:".3rem"}}/>
        </label>
      </div>

      {journalType==="Inter-person Settlement"&&<div style={{marginTop:".9rem",padding:".85rem",border:"1px solid var(--border)",borderRadius:"8px",background:"rgba(56,189,248,.05)"}}>
        <div style={{fontWeight:800,fontSize:".8rem",marginBottom:".65rem"}}>Inter-person Settlement</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".75rem"}}>
          <label style={{fontSize:".74rem",fontWeight:700}}>From Person
            <select value={fromPerson} onChange={e=>{const v=e.target.value;setFromPerson(v);syncInterPerson(v,toPerson,settlementAmount)}} style={{...inputStyle,marginTop:".3rem"}}>
              <option value="">Select person...</option>{personLedgers.map(l=><option key={l.LedgerID} value={l.LedgerID}>{l.LedgerName}</option>)}
            </select>
          </label>
          <label style={{fontSize:".74rem",fontWeight:700}}>To Person
            <select value={toPerson} onChange={e=>{const v=e.target.value;setToPerson(v);syncInterPerson(fromPerson,v,settlementAmount)}} style={{...inputStyle,marginTop:".3rem"}}>
              <option value="">Select person...</option>{personLedgers.map(l=><option key={l.LedgerID} value={l.LedgerID}>{l.LedgerName}</option>)}
            </select>
          </label>
          <label style={{fontSize:".74rem",fontWeight:700}}>Amount
            <input type="number" min="0" step=".01" value={settlementAmount} onChange={e=>{const v=e.target.value;setSettlementAmount(v);syncInterPerson(fromPerson,toPerson,v)}} placeholder="0.00" style={{...inputStyle,marginTop:".3rem",textAlign:"right"}}/>
          </label>
        </div>
        <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".65rem"}}>
          Accounting: <strong style={{color:"var(--text)"}}>Dr To Person</strong> · <strong style={{color:"var(--text)"}}>Cr From Person</strong>. No Zivara bank movement is created.
        </div>
      </div>}
    </div>

    <div style={{...card,padding:0,overflow:"hidden"}}>
      <div style={{padding:".85rem 1rem",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--border)"}}>
        <div><div style={{fontWeight:750}}>Journal Lines</div><div style={{color:"var(--muted)",fontSize:".72rem",marginTop:".1rem"}}>Total Debit must equal Total Credit.</div></div>
        <button onClick={addLine} disabled={journalType==="Inter-person Settlement"} style={{...btn(false),opacity:journalType==="Inter-person Settlement"?.4:1}}>+ Add Line</button>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%"}}>
          <thead><tr><th style={{minWidth:260}}>Ledger</th><th style={{minWidth:130}}>Debit</th><th style={{minWidth:130}}>Credit</th><th style={{minWidth:240}}>Particulars</th><th style={{width:70}}></th></tr></thead>
          <tbody>{lines.map((line,index)=><tr key={index}>
            <td><select value={line.LedgerID} onChange={e=>updateLine(index,"LedgerID",e.target.value)} disabled={journalType==="Inter-person Settlement"} style={inputStyle}>
              <option value="">Select ledger...</option>{ledgers.map(l=><option key={l.LedgerID} value={l.LedgerID}>{l.LedgerName} · {l.GroupName}</option>)}
            </select></td>
            <td><input type="number" min="0" step="0.01" value={line.Debit} onChange={e=>updateLine(index,"Debit",e.target.value)} disabled={journalType==="Inter-person Settlement"} placeholder="0.00" style={{...inputStyle,textAlign:"right"}}/></td>
            <td><input type="number" min="0" step="0.01" value={line.Credit} onChange={e=>updateLine(index,"Credit",e.target.value)} disabled={journalType==="Inter-person Settlement"} placeholder="0.00" style={{...inputStyle,textAlign:"right"}}/></td>
            <td><input value={line.Particulars} onChange={e=>updateLine(index,"Particulars",e.target.value)} placeholder="Optional line note" style={inputStyle}/></td>
            <td style={{textAlign:"center"}}><button onClick={()=>removeLine(index)} disabled={lines.length<=2||journalType==="Inter-person Settlement"} style={{...btn(false),padding:".4rem .55rem",opacity:lines.length<=2?.35:1}}>×</button></td>
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
          <thead><tr><th>Date</th><th>Type</th><th>Voucher No.</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Created By</th><th></th></tr></thead>
          <tbody>{history.map(j=><tr key={j.JournalID}>
            <td>{String(j.Date||"").slice(0,10)}</td>
            <td>{readMeta(j.Narration,"JournalType")||(/refund|cancel/i.test(j.Narration||"")?"Refund / Cancellation":/paid to|paid .* against zivara/i.test(j.Narration||"")?"Inter-person Settlement":/opening/i.test(j.Narration||"")?"Opening Adjustment":"General Adjustment")}</td>
            <td>{j.VoucherNo||"—"}</td>
            <td>{cleanMeta(j.Narration)||"—"}</td>
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
