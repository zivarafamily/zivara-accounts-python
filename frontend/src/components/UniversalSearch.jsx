import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/client";
import { useLLP } from "../context/LLPContext";
import { formatDate } from "../utils/format";

const card={
  background:"var(--card)",
  border:"1px solid var(--border)",
  borderRadius:"var(--radius)"
};

const SOURCE_CONFIG=[
  {key:"vendors",action:"getVendors",type:"Vendor",path:"/vendors"},
  {key:"payables",action:"getLLPPayables",type:"Vendor Bill",path:"/payment-tracker"},
  {key:"bank",action:"getBankTransactions",type:"Bank Transaction",path:"/transactions"},
  {key:"expenses",action:"getExpenses",type:"Partner / Staff Expense",path:"/expenses"},
  {key:"ledgers",action:"getLedgers",type:"Ledger",path:"/ledgers"},
  {key:"invoices",action:"getNeoInvoices",type:"Invoice",path:"/neoinvoices"},
  {key:"receipts",action:"getReceipts",type:"Receipt",path:"/transactions"},
  {key:"partners",action:"getPartners",type:"Partner",path:"/partners"},
  {key:"staff",action:"getUsers",type:"Staff / User",path:"/users"},
  {key:"clients",action:"getClients",type:"Client",path:"/clients"}
];

const norm=v=>String(v??"").trim().toLowerCase();
const money=n=>{
  const x=Number(n||0);
  return Number.isFinite(x)?"₹"+x.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}):"";
};

function primitiveText(row){
  if(!row||typeof row!=="object")return "";
  return Object.values(row)
    .filter(v=>["string","number","boolean"].includes(typeof v))
    .map(v=>String(v))
    .join(" ")
    .toLowerCase();
}

function displayAmount(row){
  const candidates=[
    row.AmountOut,row.AmountIn,row.Amount,row.GrossAmount,row.NetPayable,row.PaidAmount,
    row.BalanceAmount,row.AmountReceived,row.CurrentBalance,row.Debit,row.Credit
  ];
  const found=candidates.find(v=>v!==undefined&&v!==null&&v!==""&&Number(v)!==0);
  return found===undefined?"":money(found);
}

function displayDate(row){
  const v=row.Date||row.BillDate||row.InvoiceDate||row.PaymentDate||row.ExpenseDate||row.EntryDate||row.CreatedAt;
  return v?formatDate(v):"";
}

function titleFor(type,row){
  if(type==="Vendor")return row.VendorName||row.Name||"Vendor";
  if(type==="Vendor Bill")return `${row.VendorName||"Vendor"} · ${row.BillNo||"Bill"}`;
  if(type==="Bank Transaction")return row.LedgerName||row.Description||row.ReferenceID||"Bank Transaction";
  if(type==="Partner / Staff Expense")return row.VendorOrPerson||row.Description||row.PaidBy||"Partner / Staff Expense";
  if(type==="Ledger")return row.LedgerName||row.LedgerCode||"Ledger";
  if(type==="Invoice")return `${row.BuyerName||row.ClientName||"Invoice"} · ${row.InvoiceNo||""}`.replace(/ · $/,"");
  if(type==="Receipt")return `${row.ReferenceType||"Receipt"} · ${row.ReferenceNo||row.ReceiptID||""}`.replace(/ · $/,"");
  if(type==="Partner")return row.PartnerName||row.Name||"Partner";
  if(type==="Staff / User")return row.Name||row.FullName||row.Username||row.Email||"Staff / User";
  if(type==="Client")return row.ClientName||row.Name||"Client";
  return type;
}

function subtitleFor(type,row){
  if(type==="Vendor")return [row.Category,row.PAN&&`PAN ${row.PAN}`,row.GSTIN&&`GSTIN ${row.GSTIN}`].filter(Boolean).join(" · ");
  if(type==="Vendor Bill"){
    const payer=norm(row.PaidByType)==="company"
      ? "Company / Bank"
      : (row.PaidByName||row.ReimburseTo||"Partner / Staff");
    return [row.Description,row.Status,`Paid by ${payer}`,row.ReferenceNo&&`Ref ${row.ReferenceNo}`].filter(Boolean).join(" · ");
  }
  if(type==="Bank Transaction")return [row.Description,row.ReferenceID&&`Ref ${row.ReferenceID}`,row.BankAccountName||row.PaidBy].filter(Boolean).join(" · ");
  if(type==="Partner / Staff Expense")return [
    row.Description,
    row.PaidBy&&`Paid by ${row.PaidBy}`,
    row.ReimburseTo&&`Settle to ${row.ReimburseTo}`,
    row.Status
  ].filter(Boolean).join(" · ");
  if(type==="Ledger")return [row.LedgerCode,row.GroupName,row.AccountType].filter(Boolean).join(" · ");
  if(type==="Invoice")return [row.Particulars,row.BillingMonth,row.Status,row.PAN].filter(Boolean).join(" · ");
  if(type==="Receipt")return [row.Notes,row.ReceiptMode,row.BankAccount].filter(Boolean).join(" · ");
  if(type==="Partner")return [row.PAN,row.Email,row.Status].filter(Boolean).join(" · ");
  if(type==="Staff / User")return [row.Email,row.Role,row.Status].filter(Boolean).join(" · ");
  if(type==="Client")return [row.PAN,row.FamilyName,row.Status].filter(Boolean).join(" · ");
  return "";
}

function resultScore(row,q){
  const values=Object.values(row||{})
    .filter(v=>["string","number"].includes(typeof v))
    .map(v=>norm(v))
    .filter(Boolean);
  if(values.some(v=>v===q))return 0;
  if(values.some(v=>v.startsWith(q)))return 1;
  if(values.some(v=>v.includes(q)))return 2;
  return 9;
}

export default function UniversalSearch(){
  const navigate=useNavigate();
  const {currentLLP}=useLLP();
  const[query,setQuery]=useState("");
  const[results,setResults]=useState([]);
  const[searching,setSearching]=useState(false);
  const[error,setError]=useState("");
  const[open,setOpen]=useState(false);
  const cacheRef=useRef({key:"",data:null,promise:null});

  const llpKey=currentLLP?.global?"__GLOBAL__":String(currentLLP?.llpId||currentLLP?.LLPID||"");

  useEffect(()=>{
    cacheRef.current={key:llpKey,data:null,promise:null};
    setResults([]);
    setQuery("");
    setOpen(false);
    setError("");
  },[llpKey]);

  async function loadSearchData(){
    const cached=cacheRef.current;
    if(cached.key===llpKey&&cached.data)return cached.data;
    if(cached.key===llpKey&&cached.promise)return cached.promise;

    const promise=Promise.allSettled(SOURCE_CONFIG.map(s=>apiGet(s.action))).then(values=>{
      const data={};
      values.forEach((res,i)=>{
        const key=SOURCE_CONFIG[i].key;
        data[key]=res.status==="fulfilled"&&res.value?.ok?(res.value.data||[]):[];
      });
      cacheRef.current={key:llpKey,data,promise:null};
      return data;
    }).catch(err=>{
      cacheRef.current={key:llpKey,data:null,promise:null};
      throw err;
    });

    cacheRef.current={key:llpKey,data:null,promise};
    return promise;
  }

  function rowInSelectedLLP(row){
    if(currentLLP?.global)return true;
    const selected=String(currentLLP?.llpId||currentLLP?.LLPID||"");
    if(!selected)return true;
    const rowLLP=String(row?.LLPID||row?.llpId||row?.LLPId||"");
    return !rowLLP||rowLLP===selected;
  }

  function searchRows(data,raw){
    const q=norm(raw);
    if(q.length<2)return [];
    const qNumeric=q.replace(/[₹,\s]/g,"");
    const found=[];

    SOURCE_CONFIG.forEach(source=>{
      const rows=Array.isArray(data[source.key])?data[source.key]:[];
      rows.forEach(row=>{
        if(!rowInSelectedLLP(row))return;
        const text=primitiveText(row);
        const numericText=text.replace(/[₹,\s]/g,"");
        if(!text.includes(q)&&!(qNumeric&&numericText.includes(qNumeric)))return;
        found.push({
          type:source.type,
          path:source.path,
          title:titleFor(source.type,row),
          subtitle:subtitleFor(source.type,row),
          date:displayDate(row),
          amount:displayAmount(row),
          score:resultScore(row,q),
          id:row.PayableID||row.EntryID||row.ExpenseID||row.VendorID||row.LedgerID||
             row.NeoInvoiceID||row.InvoiceID||row.ReceiptID||row.PartnerID||row.UserID||
             row.ClientID||`${source.key}-${found.length}`
        });
      });
    });

    return found
      .sort((a,b)=>a.score-b.score||String(b.date||"").localeCompare(String(a.date||""))||a.title.localeCompare(b.title))
      .slice(0,40);
  }

  useEffect(()=>{
    const q=query.trim();
    if(q.length<2){
      setResults([]);
      setSearching(false);
      setError("");
      return;
    }

    const timer=setTimeout(async()=>{
      setSearching(true);
      setError("");
      try{
        const data=await loadSearchData();
        setResults(searchRows(data,q));
        setOpen(true);
      }catch(e){
        setResults([]);
        setError(e?.message||"Search could not be loaded.");
        setOpen(true);
      }finally{
        setSearching(false);
      }
    },220);

    return()=>clearTimeout(timer);
  },[query,llpKey]);

  function openResult(result){
    setOpen(false);
    navigate(result.path,{state:{universalSearch:query,universalSearchType:result.type}});
  }

  return <div style={{position:"relative",zIndex:20}}>
    <div style={{...card,padding:".65rem .75rem",boxShadow:open&&query.trim().length>=2?"0 10px 30px rgba(0,0,0,.16)":"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:".65rem"}}>
        <div aria-hidden="true" style={{fontSize:"1rem",lineHeight:1}}>⌕</div>
        <input
          value={query}
          onChange={e=>setQuery(e.target.value)}
          onFocus={()=>{if(query.trim().length>=2)setOpen(true)}}
          onKeyDown={e=>{if(e.key==="Escape")setOpen(false)}}
          placeholder="Search anything — vendor, bill, payment, partner/staff, invoice, UTR, amount…"
          style={{
            flex:1,minWidth:0,border:0,outline:"none",background:"transparent",
            color:"var(--text)",fontSize:".86rem",padding:".25rem 0"
          }}
        />
        {searching&&<span style={{fontSize:".7rem",color:"var(--muted)"}}>Searching…</span>}
        {query&&<button
          type="button"
          onClick={()=>{setQuery("");setResults([]);setOpen(false)}}
          style={{border:0,background:"transparent",color:"var(--muted)",cursor:"pointer",fontSize:".8rem"}}
        >Clear</button>}
      </div>
    </div>

    {open&&query.trim().length>=2&&<div style={{
      ...card,position:"absolute",left:0,right:0,top:"calc(100% + .35rem)",
      padding:0,maxHeight:"min(62vh,520px)",overflowY:"auto",
      boxShadow:"0 16px 40px rgba(0,0,0,.28)"
    }}>
      <div style={{
        position:"sticky",top:0,zIndex:1,background:"var(--card)",
        padding:".55rem .75rem",borderBottom:"1px solid var(--border)",
        display:"flex",justifyContent:"space-between",gap:"1rem",fontSize:".7rem",color:"var(--muted)"
      }}>
        <span>{searching?"Searching all records…":`${results.length} result${results.length===1?"":"s"} for “${query.trim()}”`}</span>
        <span>Click a result to open its module</span>
      </div>

      {error?<div style={{padding:"1rem",color:"var(--danger)",fontSize:".78rem"}}>{error}</div>:
      !searching&&results.length===0?<div style={{padding:"1.2rem",color:"var(--muted)",fontSize:".8rem"}}>
        No match found. Try part of the name, bill number, UTR/reference, description or amount.
      </div>:
      results.map((r,i)=><button
        type="button"
        key={`${r.type}-${r.id}-${i}`}
        onClick={()=>openResult(r)}
        style={{
          width:"100%",display:"grid",gridTemplateColumns:"minmax(90px,120px) 1fr auto",
          gap:".75rem",alignItems:"center",textAlign:"left",border:0,borderBottom:"1px solid var(--border)",
          background:"transparent",color:"var(--text)",padding:".7rem .75rem",cursor:"pointer"
        }}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(127,127,127,.08)"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}
      >
        <span style={{
          fontSize:".66rem",fontWeight:800,color:"var(--accent)",
          textTransform:"uppercase",letterSpacing:".035em"
        }}>{r.type}</span>

        <span style={{minWidth:0}}>
          <span style={{display:"block",fontSize:".8rem",fontWeight:750,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title}</span>
          {r.subtitle&&<span style={{display:"block",fontSize:".68rem",color:"var(--muted)",marginTop:".12rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.subtitle}</span>}
        </span>

        <span style={{textAlign:"right",whiteSpace:"nowrap"}}>
          {r.amount&&<span style={{display:"block",fontSize:".77rem",fontWeight:800}}>{r.amount}</span>}
          {r.date&&<span style={{display:"block",fontSize:".65rem",color:"var(--muted)",marginTop:".12rem"}}>{r.date}</span>}
        </span>
      </button>)}
    </div>}

    {open&&<div
      onClick={()=>setOpen(false)}
      style={{position:"fixed",inset:0,zIndex:-1}}
      aria-hidden="true"
    />}
  </div>;
}
