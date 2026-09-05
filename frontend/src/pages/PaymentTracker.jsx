import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, uploadBill } from "../api/client";
import { formatDate } from "../utils/format";
import { useLLP } from "../context/LLPContext";

const CATEGORIES=["Travel Agency","CA / Professional","Consultant","Contractor","Office Purchase","Software","Rent","Motor Vehicle","Other"];
const PAYMENT_MODES=["Bank","NEFT","RTGS","IMPS","UPI","Cheque","Cash"];
const TDS_SECTIONS=[
  {section:"",label:"No TDS / Not applicable",rate:0},
  {section:"393(1)-6(i)-1",label:"Contractor - individual/HUF (1%)",rate:1},
  {section:"393(1)-6(i)-2",label:"Contractor / travel operator - other payee (2%)",rate:2},
  {section:"393(1)-6(iii)-10",label:"Professional / consultancy (10%)",rate:10},
  {section:"393(1)-6(iii)-2",label:"Technical fees (2%)",rate:2},
  {section:"393(1)-2(ii)-10",label:"Rent - land/building (10%)",rate:10},
  {section:"393(1)-2(ii)-2",label:"Rent - plant/machinery/equipment (2%)",rate:2},
  {section:"393(1)-8(ii)",label:"Purchase of goods over threshold (0.1%)",rate:.1},
];

const num=v=>v==null||v===""?0:Number(String(v).replace(/[^0-9.-]/g,""))||0;
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const norm=v=>String(v||"").trim().toLowerCase().replace(/\s+/g," ");
const personal=t=>norm(t||"Company")!=="company";

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.1rem"};
const label={display:"block",fontSize:".72rem",color:"var(--muted)",marginBottom:".3rem"};
const input={width:"100%",boxSizing:"border-box"};
const btn=(kind="primary")=>({
  padding:".55rem .9rem",borderRadius:"6px",cursor:"pointer",fontWeight:600,
  border:kind==="ghost"?"1px solid var(--border)":"none",
  background:kind==="primary"?"var(--accent)":"transparent",
  color:kind==="primary"?"#fff":"var(--muted)"
});

const emptyLine=()=>({
  Particulars:"",LedgerID:"",LedgerName:"",TaxableAmount:"",GSTType:"IGST",GSTRate:"18",
  CGSTAmount:"",SGSTAmount:"",IGSTAmount:"",TDSApplicable:false,TDSConfigured:false
});
const initial=()=>({
  VendorID:"",VendorName:"",VendorCategory:"Other",VendorGSTIN:"",VendorPAN:"",
  BillNo:"",BillDate:new Date().toISOString().slice(0,10),DueDate:"",
  Description:"",ExpenseType:"Vendor Bill",LineItems:[emptyLine()],
  TDSSection:"",TDSRate:"0",TDSAmount:"",
  TCSAmount:"",
  RoundOffAmount:"0",
  PaidAmount:"",PaymentDate:"",PaymentMode:"Bank",BankAccount:"",ReferenceNo:"",
  PaidByType:"Company",PaidByName:"",ReimburseTo:"",ReimbursementStatus:"Not Required",
  ChallanNo:"",ChallanDate:"",Notes:""
});

function lineCalc(x){
  const taxable=num(x.TaxableAmount),rate=num(x.GSTRate);
  let cgst=num(x.CGSTAmount),sgst=num(x.SGSTAmount),igst=num(x.IGSTAmount);
  if(!cgst&&!sgst&&!igst&&taxable&&rate){
    const gst=Math.round(taxable*rate)/100;
    if(x.GSTType==="CGST_SGST"){
      cgst=Math.round(gst/2*100)/100;
      sgst=Math.round((gst-cgst)*100)/100;
    }else if(x.GSTType!=="None") igst=gst;
  }
  return {taxable,cgst,sgst,igst,total:taxable+cgst+sgst+igst};
}

function totals(f){
  const items=f.LineItems||[];
  const lineTDSConfigured=items.some(x=>x.TDSConfigured===true);
  const s=items.reduce((a,x)=>{
    const c=lineCalc(x);
    a.taxable+=c.taxable;a.cgst+=c.cgst;a.sgst+=c.sgst;a.igst+=c.igst;
    if(!lineTDSConfigured||x.TDSApplicable===true)a.tdsBase+=c.taxable;
    return a;
  },{taxable:0,cgst:0,sgst:0,igst:0,tdsBase:0});
  s.lineTDSConfigured=lineTDSConfigured;
  s.gst=s.cgst+s.sgst+s.igst;
  s.tcs=num(f.TCSAmount);
  s.gross=s.taxable+s.gst+s.tcs;
  s.autoTDS=Math.round(s.tdsBase*num(f.TDSRate))/100;
  s.tds=f.TDSAmount!==""?num(f.TDSAmount):s.autoTDS;
  s.round=num(f.RoundOffAmount);
  s.net=Math.max(s.gross-s.tds+s.round,0);
  s.paid=num(f.PaidAmount);
  s.balance=Math.max(s.net-s.paid,0);
  s.status=s.paid<=0?"Pending":s.paid+0.005<s.net?"Part Paid":s.paid>s.net+0.005?"Overpaid":"Paid";
  return s;
}

function Badge({value}){
  return <span style={{fontSize:".72rem",fontWeight:700}}>{value||"Pending"}</span>;
}

function sameVendorTransaction(tx,vendorName){
  const vendor=norm(vendorName);
  const ledger=norm(tx.LedgerName);
  const desc=norm(tx.Description);
  if(!vendor||num(tx.AmountOut)<=0)return false;
  const ledgerMatch=ledger&&(
    ledger===vendor ||
    (ledger.length>=8&&vendor.includes(ledger)) ||
    (vendor.length>=8&&ledger.includes(vendor))
  );
  const narrationMatch=desc&&vendor.length>=8&&desc.includes(vendor);
  return ledgerMatch||narrationMatch;
}

const BATCH_META_PREFIX="[[BATCH_SETTLEMENT_V2:";
const TDS_PAYMENT_META_PREFIX="[[TDS_PAYMENT_V1:";
const TDS_QUARTER_META_PREFIX="[[TDS_QUARTERLY_V2:";
const META_SUFFIX="]]";
function readMeta(notes,prefix){
  const text=String(notes||"");
  const start=text.indexOf(prefix);
  if(start<0)return null;
  const end=text.indexOf(META_SUFFIX,start+prefix.length);
  if(end<0)return null;
  try{return JSON.parse(text.slice(start+prefix.length,end))}catch{return null}
}
function removeMeta(notes,prefix){
  const text=String(notes||"");
  const start=text.indexOf(prefix);
  if(start<0)return text.trim();
  const end=text.indexOf(META_SUFFIX,start+prefix.length);
  if(end<0)return text.trim();
  return (text.slice(0,start)+text.slice(end+META_SUFFIX.length)).replace(/\n{3,}/g,"\n\n").trim();
}
function upsertMeta(notes,prefix,value){
  const clean=removeMeta(notes,prefix);
  const marker=`${prefix}${JSON.stringify(value)}${META_SUFFIX}`;
  return `${clean}${clean?"\n":""}${marker}`.trim();
}
function roundOffOf(r){
  return num(r.RoundOffAmount ?? (Array.isArray(r.LineItems)?r.LineItems[0]?.RoundOffAmount:0));
}
function vendorLiabilityOf(r){
  // Vendor ledger liability is reduced only by TDS explicitly marked paid/filed.
  return Math.max(num(r.GrossAmount)+roundOffOf(r)-num(r.TDSDeductedAmount),0);
}
function batchMetaPaidOf(r){
  const meta=readMeta(r.Notes,BATCH_META_PREFIX);
  return meta?num(meta.bankAllocated):null;
}

function fyStartOf(value){
  const s=String(value||"").slice(0,10);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return null;
  const y=Number(m[1]),month=Number(m[2]);
  return month>=4?y:y-1;
}
function fyLabel(start){
  return start?`${start}-${String(start+1).slice(-2)}`:"—";
}
function quarterOf(value){
  const s=String(value||"").slice(0,10);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return "";
  const month=Number(m[2]);
  if(month>=4&&month<=6)return "Q1";
  if(month>=7&&month<=9)return "Q2";
  if(month>=10&&month<=12)return "Q3";
  return "Q4";
}
function tdsSectionLabel(section){
  const hit=TDS_SECTIONS.find(x=>x.section===section);
  return hit?.label||section||"No section";
}
function escXml(v){
  return String(v??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

export default function PaymentTracker(){
  const {currentLLP}=useLLP();

  const[rows,setRows]=useState([]);
  const[vendors,setVendors]=useState([]);
  const[banks,setBanks]=useState([]);
  const[partners,setPartners]=useState([]);
  const[ledgers,setLedgers]=useState([]);
  const[bankTransactions,setBankTransactions]=useState([]);

  const[open,setOpen]=useState(false);
  const[editId,setEditId]=useState(null);
  const[form,setForm]=useState(initial());
  const[vendorChoice,setVendorChoice]=useState("");
  const[saving,setSaving]=useState(false);
  const[error,setError]=useState("");
  const[billFile,setBillFile]=useState(null);
  const[showMore,setShowMore]=useState(false);
  const[search,setSearch]=useState("");
  const[filterVendor,setFilterVendor]=useState("");
  const[filterStatus,setFilterStatus]=useState("");
  const[fromDate,setFromDate]=useState("");
  const[toDate,setToDate]=useState("");

  const[batchOpen,setBatchOpen]=useState(false);
  const[batchVendor,setBatchVendor]=useState("");
  const[batchTransactionId,setBatchTransactionId]=useState("");
  const[batchSelected,setBatchSelected]=useState([]);
  const[batchAmount,setBatchAmount]=useState("");
  const[batchTDSByBill,setBatchTDSByBill]=useState({});
  const[batchTDSTotalInput,setBatchTDSTotalInput]=useState("");
  const[batchTreatment,setBatchTreatment]=useState("gross_tds_separate");
  const[tdsPaymentTransactionId,setTdsPaymentTransactionId]=useState("");
  const[tdsPaidTotalInput,setTdsPaidTotalInput]=useState("");
  const[tdsMarking,setTdsMarking]=useState(false);
  const[batchSaving,setBatchSaving]=useState(false);
  const[batchError,setBatchError]=useState("");
  const[batchHistoryOpen,setBatchHistoryOpen]=useState(false);
  const[batchHistoryDeleting,setBatchHistoryDeleting]=useState("");

  const currentFYStart=fyStartOf(new Date().toISOString().slice(0,10))||new Date().getFullYear();
  const currentQuarter=quarterOf(new Date().toISOString().slice(0,10))||"Q1";
  const[tdsRegisterOpen,setTdsRegisterOpen]=useState(false);
  const[tdsFY,setTdsFY]=useState(currentFYStart);
  const[tdsQuarter,setTdsQuarter]=useState(currentQuarter);
  const[tdsVendorFilter,setTdsVendorFilter]=useState("");
  const[tdsSectionFilter,setTdsSectionFilter]=useState("");
  const[tdsStatusFilter,setTdsStatusFilter]=useState("");
  const[tdsRegisterTransactionId,setTdsRegisterTransactionId]=useState("");
  const[tdsChallanNo,setTdsChallanNo]=useState("");
  const[tdsChallanDate,setTdsChallanDate]=useState("");
  const[tdsAllocations,setTdsAllocations]=useState({});
  const[tdsRegisterSaving,setTdsRegisterSaving]=useState(false);
  const[tdsRegisterError,setTdsRegisterError]=useState("");

  async function load(){
    setError("");
    try{
      const[p,v,b,pt,l,t]=await Promise.all([
        apiGet("getLLPPayables"),
        apiGet("getVendors"),
        apiGet("getBankAccounts"),
        apiGet("getPartners"),
        apiGet("getLedgers"),
        apiGet("getBankTransactions")
      ]);
      setRows(p.data||[]);
      setVendors((v.data||[]).filter(x=>x.Status!=="Inactive"));
      setBanks((b.data||[]).filter(x=>x.IsActive!=="No"));
      setPartners((pt.data||[]).filter(x=>x.Status!=="Inactive"));
      setLedgers((l.data||[]).filter(x=>x.Status!=="Inactive"));
      setBankTransactions(t.data||[]);
    }catch(e){
      setError(e.message);
    }
  }

  useEffect(()=>{load()},[currentLLP?.llpId,currentLLP?.LLPID]);

  const partnerNames=useMemo(
    ()=>[...new Set(partners.map(x=>x.PartnerName).filter(Boolean))].sort(),
    [partners]
  );

  const accountLedgers=useMemo(
    ()=>ledgers
      .filter(x=>!["Accounts Payable","Partner Current Accounts","Staff Current Accounts"].includes(x.GroupName))
      .sort((a,b)=>a.LedgerName.localeCompare(b.LedgerName)),
    [ledgers]
  );

  const a=totals(form);
  const selectedBank=banks.find(x=>x.AccountID===form.BankAccount);
  const duplicate=useMemo(
    ()=>rows.find(r=>
      r.PayableID!==editId&&
      form.BillNo&&
      norm(r.BillNo)===norm(form.BillNo)&&
      (r.VendorID===form.VendorID||norm(r.VendorName)===norm(form.VendorName))
    ),
    [rows,form.BillNo,form.VendorID,form.VendorName,editId]
  );

  const vendorNames=useMemo(()=>[...new Set(
    rows.map(r=>String(r.VendorName||"").trim()).filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b)),[rows]);

  const statusNames=useMemo(()=>[...new Set(
    rows.map(r=>String(r.Status||"").trim()).filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b)),[rows]);

  const filtered=useMemo(()=>rows.filter(r=>{
    if(filterVendor&&norm(r.VendorName)!==norm(filterVendor))return false;
    if(filterStatus&&norm(r.Status)!==norm(filterStatus))return false;
    const billDate=String(r.BillDate||"").slice(0,10);
    if(fromDate&&billDate&&billDate<fromDate)return false;
    if(toDate&&billDate&&billDate>toDate)return false;
    if(search&&![r.VendorName,r.BillNo,r.Description,r.ReferenceNo].some(v=>norm(v).includes(norm(search))))return false;
    return true;
  }),[rows,filterVendor,filterStatus,fromDate,toDate,search]);

  const snapshot=useMemo(()=>{
    const today=new Date().toISOString().slice(0,10);
    const live=filtered.filter(r=>norm(r.Status)!=="cancelled");
    const txByRef={};
    for(const tx of bankTransactions){
      const ref=norm(tx.ReferenceID||tx.EntryID);
      if(!ref)continue;
      const key=`${tx.BankAccountID||""}|${ref}`;
      txByRef[key]=tx;
      txByRef[`|${ref}`]=tx;
    }
    const usedLegacyTx=new Set();
    const s=live.reduce((a,r)=>{
      a.bills+=1;
      const gross=num(r.GrossAmount)+roundOffOf(r);
      a.gross+=gross;
      a.net+=num(r.NetPayable);
      a.vendorLiability+=vendorLiabilityOf(r);
      a.tds+=num(r.TDSAmount);
      a.tdsPaid+=num(r.TDSDeductedAmount);

      const metaPaid=batchMetaPaidOf(r);
      if(metaPaid!==null){
        a.paid+=metaPaid;
      }else if(norm(r.PaymentMode)==="existing bank transaction"&&r.ReferenceNo){
        // Legacy batches may store NetPayable in PaidAmount even though the
        // bank actually paid the gross amount. Count the linked bank debit once.
        const ref=norm(r.ReferenceNo);
        const key=`${r.BankAccount||""}|${ref}`;
        const tx=txByRef[key]||txByRef[`|${ref}`];
        const unique=tx?.EntryID||key;
        if(tx&&!usedLegacyTx.has(unique)){
          a.paid+=num(tx.AmountOut);
          usedLegacyTx.add(unique);
        }else if(!tx){
          a.paid+=num(r.PaidAmount);
        }
      }else{
        a.paid+=num(r.PaidAmount);
      }

      const due=String(r.DueDate||"").slice(0,10);
      const rowBalance=Math.max(vendorLiabilityOf(r)-(metaPaid!==null?metaPaid:num(r.PaidAmount)),0);
      if(rowBalance>0.005&&due&&due<today){
        a.overdue+=rowBalance;
        a.overdueBills+=1;
      }
      return a;
    },{bills:0,gross:0,net:0,paid:0,vendorLiability:0,tds:0,tdsPaid:0,overdue:0,overdueBills:0});
    s.balance=Math.max(s.vendorLiability-s.paid,0);
    s.tdsPending=Math.max(s.tds-s.tdsPaid,0);
    s.cancelled=filtered.filter(r=>norm(r.Status)==="cancelled").length;
    return s;
  },[filtered,bankTransactions]);


  const tdsFYOptions=useMemo(()=>{
    const values=[...new Set(rows
      .filter(r=>norm(r.Status)!=="cancelled"&&num(r.TDSAmount)>0)
      .map(r=>fyStartOf(r.BillDate))
      .filter(Boolean)
    )].sort((a,b)=>b-a);
    return values.length?values:[currentFYStart];
  },[rows,currentFYStart]);

  const tdsQuarterBaseRows=useMemo(()=>rows.filter(r=>
    norm(r.Status)!=="cancelled"&&
    num(r.TDSAmount)>0&&
    fyStartOf(r.BillDate)===Number(tdsFY)&&
    quarterOf(r.BillDate)===tdsQuarter
  ),[rows,tdsFY,tdsQuarter]);

  const tdsRegisterVendors=useMemo(()=>[...new Set(
    tdsQuarterBaseRows.map(r=>String(r.VendorName||"").trim()).filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b)),[tdsQuarterBaseRows]);

  const tdsRegisterSections=useMemo(()=>[...new Set(
    tdsQuarterBaseRows.map(r=>String(r.TDSSection||"").trim()).filter(Boolean)
  )].sort(),[tdsQuarterBaseRows]);

  const tdsQuarterRows=useMemo(()=>tdsQuarterBaseRows.filter(r=>{
    if(tdsVendorFilter&&norm(r.VendorName)!==norm(tdsVendorFilter))return false;
    if(tdsSectionFilter&&String(r.TDSSection||"")!==tdsSectionFilter)return false;
    const payable=num(r.TDSAmount);
    const paid=Math.min(num(r.TDSDeductedAmount),payable);
    const pending=Math.max(payable-paid,0);
    if(tdsStatusFilter==="pending"&&pending<=0.005)return false;
    if(tdsStatusFilter==="cleared"&&pending>0.005)return false;
    return true;
  }),[tdsQuarterBaseRows,tdsVendorFilter,tdsSectionFilter,tdsStatusFilter]);

  const tdsVendorSummary=useMemo(()=>{
    const groups={};
    for(const r of tdsQuarterRows){
      const vendor=String(r.VendorName||"Unknown Vendor").trim()||"Unknown Vendor";
      const key=norm(vendor);
      if(!groups[key]){
        groups[key]={
          key,vendor,pan:r.VendorPAN||"",bills:0,payable:0,paid:0,pending:0,sections:new Set()
        };
      }
      const g=groups[key];
      const payable=num(r.TDSAmount);
      const paid=Math.min(num(r.TDSDeductedAmount),payable);
      g.bills+=1;
      g.payable+=payable;
      g.paid+=paid;
      g.pending+=Math.max(payable-paid,0);
      if(r.TDSSection)g.sections.add(r.TDSSection);
      if(!g.pan&&r.VendorPAN)g.pan=r.VendorPAN;
    }
    return Object.values(groups)
      .map(g=>({...g,sections:[...g.sections]}))
      .sort((a,b)=>b.pending-a.pending||a.vendor.localeCompare(b.vendor));
  },[tdsQuarterRows]);

  const tdsQuarterTotals=useMemo(()=>tdsVendorSummary.reduce((a,g)=>{
    a.vendors+=1;a.bills+=g.bills;a.payable+=g.payable;a.paid+=g.paid;a.pending+=g.pending;
    return a;
  },{vendors:0,bills:0,payable:0,paid:0,pending:0}),[tdsVendorSummary]);

  const tdsTransactionUsage=useMemo(()=>{
    const usage={};
    for(const r of rows){
      const quarterly=readMeta(r.Notes,TDS_QUARTER_META_PREFIX);
      for(const p of (Array.isArray(quarterly?.payments)?quarterly.payments:[])){
        const id=String(p.transactionId||"").trim();
        if(id)usage[id]=(usage[id]||0)+num(p.amount);
      }
      const legacy=readMeta(r.Notes,TDS_PAYMENT_META_PREFIX);
      const legacyId=String(legacy?.transactionId||"").trim();
      if(legacyId)usage[legacyId]=(usage[legacyId]||0)+num(legacy.billPaidFiled);
    }
    return usage;
  },[rows]);

  const tdsRegisterTransactions=useMemo(()=>bankTransactions
    .filter(tx=>num(tx.AmountOut)>0)
    .map(tx=>({...tx,_tdsUsed:tdsTransactionUsage[tx.EntryID]||0,_tdsAvailable:Math.max(num(tx.AmountOut)-(tdsTransactionUsage[tx.EntryID]||0),0)}))
    .sort((a,b)=>String(b.Date||"").localeCompare(String(a.Date||""))),[bankTransactions,tdsTransactionUsage]);

  const tdsRegisterTransaction=tdsRegisterTransactions.find(x=>x.EntryID===tdsRegisterTransactionId);
  const tdsRegisterAllocationTotal=Object.values(tdsAllocations).reduce((s,v)=>s+num(v),0);

  const tdsPaymentHistory=useMemo(()=>{
    const groups={};
    for(const r of rows){
      const q=readMeta(r.Notes,TDS_QUARTER_META_PREFIX);
      for(const p of (Array.isArray(q?.payments)?q.payments:[])){
        if(Number(p.fyStart)!==Number(tdsFY)||String(p.quarter||"")!==tdsQuarter)continue;
        const key=[
          p.transactionId||"",p.challanNo||p.reference||"",p.challanDate||p.date||""
        ].join("|");
        if(!groups[key]){
          groups[key]={
            key,date:p.challanDate||p.date||"",challan:p.challanNo||p.reference||"",
            transactionId:p.transactionId||"",amount:0,vendors:new Set(),bills:0,legacy:false
          };
        }
        groups[key].amount+=num(p.amount);
        groups[key].vendors.add(p.vendor||r.VendorName||"");
        groups[key].bills+=1;
      }
      const legacy=readMeta(r.Notes,TDS_PAYMENT_META_PREFIX);
      if(
        legacy&&
        fyStartOf(r.BillDate)===Number(tdsFY)&&
        quarterOf(r.BillDate)===tdsQuarter&&
        num(legacy.billPaidFiled)>0
      ){
        const key=`legacy|${legacy.transactionId||legacy.reference||""}|${legacy.date||""}`;
        if(!groups[key]){
          groups[key]={
            key,date:legacy.date||"",challan:legacy.reference||"Legacy TDS mark",
            transactionId:legacy.transactionId||"",amount:0,vendors:new Set(),bills:0,legacy:true
          };
        }
        groups[key].amount+=num(legacy.billPaidFiled);
        groups[key].vendors.add(r.VendorName||"");
        groups[key].bills+=1;
      }
    }
    return Object.values(groups)
      .map(g=>({...g,vendors:[...g.vendors].filter(Boolean)}))
      .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  },[rows,tdsFY,tdsQuarter]);

  useEffect(()=>{
    if(tdsRegisterOpen&&!tdsFYOptions.includes(Number(tdsFY))){
      setTdsFY(tdsFYOptions[0]||currentFYStart);
    }
  },[tdsRegisterOpen,tdsFYOptions,tdsFY,currentFYStart]);

  useEffect(()=>{
    setTdsAllocations({});
    setTdsRegisterError("");
  },[tdsFY,tdsQuarter,tdsVendorFilter,tdsSectionFilter,tdsStatusFilter]);

  const batchHistory=useMemo(()=>{
    const groups={};
    for(const r of rows){
      const meta=readMeta(r.Notes,BATCH_META_PREFIX);
      const legacy=norm(r.PaymentMode)==="existing bank transaction"&&num(r.PaidAmount)>0;
      if(!meta&&!legacy)continue;
      const date=String(meta?.paymentDate||r.PaymentDate||"").slice(0,10);
      const ref=String(meta?.reference||r.ReferenceNo||"").trim();
      const bank=String(meta?.bankAccount||r.BankAccount||"").trim();
      const vendor=String(r.VendorName||meta?.vendor||"").trim();
      const transactionId=String(meta?.transactionId||"").trim();
      const key=transactionId||[norm(vendor),date,norm(bank),norm(ref)].join("|");
      if(!groups[key]){
        groups[key]={
          key,vendor,date,reference:ref,bank,transactionId,treatment:meta?.treatment||"legacy",
          bills:[],gross:0,net:0,paid:0,tds:0,tdsDeducted:0
        };
      }
      const g=groups[key];
      g.bills.push(r);
      g.gross+=num(r.GrossAmount)+roundOffOf(r);
      g.net+=num(r.NetPayable);
      g.paid+=meta?num(meta.bankAllocated):num(r.PaidAmount);
      g.tds+=num(r.TDSAmount);
      g.tdsDeducted+=num(r.TDSDeductedAmount);
    }
    return Object.values(groups).sort((a,b)=>
      String(b.date||"").localeCompare(String(a.date||""))||
      String(b.reference||"").localeCompare(String(a.reference||""))
    );
  },[rows]);

  function batchHistoryBankName(value){
    const b=banks.find(x=>x.AccountID===value);
    return b?`${b.AccountName||b.BankName||"Bank"}${b.AccountNumber?` · ...${String(b.AccountNumber).slice(-4)}`:""}`:(value||"—");
  }

  const outstandingVendors=useMemo(()=>[...new Set(
    rows
      .filter(r=>String(r.Status||"").toLowerCase()!=="cancelled"&&num(r.BalanceAmount)>0.005)
      .map(r=>String(r.VendorName||"").trim())
      .filter(Boolean)
  )].sort(),[rows]);

  const batchBills=useMemo(
    ()=>rows
      .filter(r=>
        batchVendor&&
        norm(r.VendorName)===norm(batchVendor)&&
        String(r.Status||"").toLowerCase()!=="cancelled"&&
        num(r.BalanceAmount)>0.005
      )
      .sort((x,y)=>{
        const bill=String(x.BillNo||"").localeCompare(String(y.BillNo||""));
        return bill||String(x.BillDate||"").localeCompare(String(y.BillDate||""));
      }),
    [rows,batchVendor]
  );

  const alreadyAllocatedByBankTx=useMemo(()=>{
    const out={};
    for(const r of rows){
      const meta=readMeta(r.Notes,BATCH_META_PREFIX);
      if(meta){
        const reference=norm(meta.reference||r.ReferenceNo);
        const bank=meta.bankAccount||r.BankAccount||"";
        if(!reference)continue;
        const key=`${bank}|${reference}`;
        out[key]=(out[key]||0)+num(meta.bankAllocated);
        continue;
      }
      if(norm(r.PaymentMode)!=="existing bank transaction")continue;
      const reference=norm(r.ReferenceNo);
      if(!reference)continue;
      const key=`${r.BankAccount||""}|${reference}`;
      out[key]=(out[key]||0)+num(r.PaidAmount);
    }
    return out;
  },[rows]);

  const candidateBankTransactions=useMemo(()=>{
    if(!batchVendor)return [];
    return bankTransactions
      .filter(tx=>sameVendorTransaction(tx,batchVendor))
      .map(tx=>{
        const reference=norm(tx.ReferenceID||tx.EntryID);
        const key=`${tx.BankAccountID||""}|${reference}`;
        const used=alreadyAllocatedByBankTx[key]||0;
        return {...tx,_used:used,_available:Math.max(num(tx.AmountOut)-used,0)};
      })
      .filter(tx=>tx._available>0.005)
      .sort((x,y)=>String(y.Date||"").localeCompare(String(x.Date||"")));
  },[bankTransactions,batchVendor,alreadyAllocatedByBankTx]);

  const tdsPaymentTransactions=useMemo(()=>bankTransactions
    .filter(tx=>num(tx.AmountOut)>0)
    .sort((a,b)=>String(b.Date||"").localeCompare(String(a.Date||""))),[bankTransactions]);
  const tdsPaymentTransaction=tdsPaymentTransactions.find(x=>x.EntryID===tdsPaymentTransactionId);

  const batchTransaction=candidateBankTransactions.find(x=>x.EntryID===batchTransactionId);
  const selectedBatchBills=batchBills.filter(r=>batchSelected.includes(r.PayableID));

  useEffect(()=>{
    setBatchTDSByBill(prev=>{
      const next={...prev};
      let changed=false;
      for(const r of selectedBatchBills){
        if(next[r.PayableID]===undefined){
          next[r.PayableID]=String(num(r.TDSAmount));
          changed=true;
        }
      }
      for(const id of Object.keys(next)){
        if(!batchSelected.includes(id)){
          delete next[id];
          changed=true;
        }
      }
      return changed?next:prev;
    });
  },[batchSelected,batchBills]);

  const selectedBatchPreview=useMemo(()=>selectedBatchBills.map(r=>{
    const paidFiled=Math.min(num(r.TDSDeductedAmount),Math.max(num(r.TDSAmount),num(batchTDSByBill[r.PayableID]??r.TDSAmount)));
    const exactTDS=batchTDSByBill[r.PayableID]===undefined?num(r.TDSAmount):Math.max(num(batchTDSByBill[r.PayableID]),0);
    const roundOff=roundOffOf(r);
    const grossWithRound=Math.max(num(r.GrossAmount)+roundOff,0);
    const adjustedNet=Math.max(grossWithRound-exactTDS,0);
    const vendorTarget=batchTreatment==="gross_tds_separate"?grossWithRound:adjustedNet;
    const currentMeta=readMeta(r.Notes,BATCH_META_PREFIX);
    const alreadyBankAllocated=currentMeta?num(currentMeta.bankAllocated):0;
    const vendorBalance=Math.max(vendorTarget-alreadyBankAllocated,0);
    return {...r,_paidFiled:paidFiled,_exactTDS:exactTDS,_roundOff:roundOff,_grossWithRound:grossWithRound,_adjustedNet:adjustedNet,_vendorTarget:vendorTarget,_vendorBalance:vendorBalance};
  }),[selectedBatchBills,batchTDSByBill,batchTreatment]);

  const batchInvoiceCount=selectedBatchPreview.length;
  const batchGrossTotal=selectedBatchPreview.reduce((sum,r)=>sum+num(r._grossWithRound),0);
  const batchTaxableTotal=selectedBatchPreview.reduce((sum,r)=>sum+num(r.TaxableAmount),0);
  const batchGSTTotal=selectedBatchPreview.reduce((sum,r)=>sum+num(r.GSTAmount),0);
  const batchCurrentTDSTotal=selectedBatchPreview.reduce((sum,r)=>sum+num(r.TDSAmount),0);
  const batchExactTDSTotal=selectedBatchPreview.reduce((sum,r)=>sum+num(r._exactTDS),0);
  const batchTDSMarkedPaidTotal=selectedBatchPreview.reduce((sum,r)=>sum+Math.min(num(r.TDSDeductedAmount),num(r._exactTDS)),0);
  const batchTDSPendingTotal=Math.max(batchExactTDSTotal-batchTDSMarkedPaidTotal,0);
  const batchAdjustedNetTotal=selectedBatchPreview.reduce((sum,r)=>sum+num(r._adjustedNet),0);
  const selectedBatchBalance=selectedBatchPreview.reduce((sum,r)=>sum+num(r._vendorBalance),0);
  const batchAllocationAmount=num(batchAmount);
  const batchDifference=selectedBatchBalance-batchAllocationAmount;

  const vendorBillsForTDS=useMemo(()=>rows.filter(r=>
    batchVendor&&norm(r.VendorName)===norm(batchVendor)&&String(r.Status||"").toLowerCase()!=="cancelled"
  ),[rows,batchVendor]);
  const vendorTDSPayableAfterEdits=vendorBillsForTDS.reduce((sum,r)=>{
    const edited=batchTDSByBill[r.PayableID];
    return sum+(edited===undefined?num(r.TDSAmount):Math.max(num(edited),0));
  },0);
  const vendorTDSPaidFiled=vendorBillsForTDS.reduce((sum,r)=>sum+num(r.TDSDeductedAmount),0);
  const vendorTDSPending=Math.max(vendorTDSPayableAfterEdits-vendorTDSPaidFiled,0);
  const priorOtherTDSPending=Math.max(vendorTDSPending-batchTDSPendingTotal,0);
  const vendorPaymentShortfall=Math.max(selectedBatchBalance-batchAllocationAmount,0);
  const totalCashStillRequired=vendorPaymentShortfall+vendorTDSPending;

  useEffect(()=>{
    setBatchTDSTotalInput(batchSelected.length?batchExactTDSTotal.toFixed(2):"");
  },[batchExactTDSTotal,batchSelected.length]);

  useEffect(()=>{
    if(batchVendor)setTdsPaidTotalInput(vendorTDSPaidFiled.toFixed(2));
  },[batchVendor,vendorTDSPaidFiled]);

  const allocationPreview=useMemo(()=>{
    let remaining=num(batchAmount);
    return [...selectedBatchPreview]
      .sort((x,y)=>{
        const bill=String(x.BillNo||"").localeCompare(String(y.BillNo||""));
        return bill||String(x.BillDate||"").localeCompare(String(y.BillDate||""));
      })
      .map(r=>{
        const balance=num(r._vendorBalance);
        const applied=Math.min(balance,Math.max(remaining,0));
        remaining-=applied;
        return {...r,_allocation:applied};
      });
  },[selectedBatchPreview,batchAmount]);

  function set(k,v){setForm(p=>({...p,[k]:v}));}

  function setLineTDS(i,checked){
    setForm(p=>{
      const items=[...p.LineItems];
      items[i]={...items[i],TDSApplicable:checked,TDSConfigured:true};
      return {...p,LineItems:items,TDSAmount:""};
    });
  }

  function resetLineTDS(){
    setForm(p=>({
      ...p,
      LineItems:(p.LineItems||[]).map(x=>({...x,TDSApplicable:false,TDSConfigured:false})),
      TDSAmount:""
    }));
  }

  function setBatchBillTDS(payableId,value){
    const exact=Math.max(num(value),0);
    setBatchTDSByBill(prev=>({...prev,[payableId]:exact.toFixed(2)}));
  }

  function setBatchExactTDSTotal(value){
    if(!selectedBatchBills.length)return;
    const target=Math.max(num(value),0);
    const currentWeights=selectedBatchBills.map(r=>Math.max(num(r.TDSAmount),0));
    const currentWeightTotal=currentWeights.reduce((a,b)=>a+b,0);
    const taxableWeights=selectedBatchBills.map(r=>Math.max(num(r.TaxableAmount),0));
    const taxableWeightTotal=taxableWeights.reduce((a,b)=>a+b,0);
    const weights=currentWeightTotal>0?currentWeights:taxableWeightTotal>0?taxableWeights:selectedBatchBills.map(()=>1);
    const weightTotal=weights.reduce((a,b)=>a+b,0)||selectedBatchBills.length;
    let assigned=0;
    const next={};
    selectedBatchBills.forEach((r,i)=>{
      let amount;
      if(i===selectedBatchBills.length-1){
        amount=Math.max(target-assigned,0);
      }else{
        amount=Math.round((target*(weights[i]/weightTotal))*100)/100;
        assigned+=amount;
      }
      next[r.PayableID]=amount.toFixed(2);
    });
    setBatchTDSByBill(next);
    setBatchTDSTotalInput(target.toFixed(2));
  }

  function resetBatchTDS(){
    const next={};
    for(const r of selectedBatchBills)next[r.PayableID]=String(num(r.TDSAmount));
    setBatchTDSByBill(next);
  }


  function chooseTDSRegisterTransaction(entryId){
    setTdsRegisterTransactionId(entryId);
    const tx=tdsRegisterTransactions.find(x=>x.EntryID===entryId);
    if(tx){
      if(!tdsChallanDate)setTdsChallanDate(String(tx.Date||"").slice(0,10));
      if(!tdsChallanNo)setTdsChallanNo(tx.ReferenceID||tx.EntryID||"");
    }
    setTdsRegisterError("");
  }

  function fillTDSVendorPending(key){
    const g=tdsVendorSummary.find(x=>x.key===key);
    if(!g)return;
    setTdsAllocations(prev=>({...prev,[key]:g.pending.toFixed(2)}));
  }

  function fillAllTDSPending(){
    const next={};
    let available=tdsRegisterTransaction?num(tdsRegisterTransaction._tdsAvailable):Infinity;
    for(const g of tdsVendorSummary){
      if(available<=0.005)break;
      const amount=Math.min(g.pending,available);
      if(amount>0.005){
        next[g.key]=amount.toFixed(2);
        available-=amount;
      }
    }
    setTdsAllocations(next);
  }

  function exportQuarterlyTDSExcel(){
    const vendorRows=tdsVendorSummary;
    const invoiceRows=[...tdsQuarterRows].sort((a,b)=>
      String(a.VendorName||"").localeCompare(String(b.VendorName||""))||
      String(a.BillDate||"").localeCompare(String(b.BillDate||""))||
      String(a.BillNo||"").localeCompare(String(b.BillNo||""))
    );

    const cell=(value,type="String",style="")=>`<Cell${style?` ss:StyleID="${style}"`:""}><Data ss:Type="${type}">${type==="String"?escXml(value):value}</Data></Cell>`;
    const row=cells=>`<Row>${cells.join("")}</Row>`;
    const title=`Zivara TDS Register · FY ${fyLabel(Number(tdsFY))} · ${tdsQuarter}`;
    const filterText=[
      tdsVendorFilter?`Vendor: ${tdsVendorFilter}`:"All vendors",
      tdsSectionFilter?`Section: ${tdsSectionLabel(tdsSectionFilter)}`:"All sections",
      tdsStatusFilter?`Status: ${tdsStatusFilter}`:"All statuses"
    ].join(" · ");

    const vendorSheet=[
      row([cell(title,"String","Title")]),
      row([cell(filterText)]),
      row([cell("TDS Payable","String","Hdr"),cell(tdsQuarterTotals.payable,"Number","Money"),cell("TDS Paid / Filed","String","Hdr"),cell(tdsQuarterTotals.paid,"Number","Money"),cell("TDS Pending","String","Hdr"),cell(tdsQuarterTotals.pending,"Number","Money")]),
      row([cell("Vendor","String","Hdr"),cell("PAN","String","Hdr"),cell("TDS Section(s)","String","Hdr"),cell("Bills","String","Hdr"),cell("TDS Payable","String","Hdr"),cell("TDS Paid / Filed","String","Hdr"),cell("TDS Pending","String","Hdr")]),
      ...vendorRows.map(g=>row([
        cell(g.vendor),cell(g.pan),cell(g.sections.map(tdsSectionLabel).join(" | ")),
        cell(g.bills,"Number"),cell(g.payable,"Number","Money"),cell(g.paid,"Number","Money"),cell(g.pending,"Number","Money")
      ]))
    ].join("");

    const invoiceSheet=[
      row([cell(title,"String","Title")]),
      row([cell(filterText)]),
      row([cell("Vendor","String","Hdr"),cell("PAN","String","Hdr"),cell("Bill No","String","Hdr"),cell("Bill Date","String","Hdr"),cell("TDS Section","String","Hdr"),cell("TDS Rate %","String","Hdr"),cell("Taxable","String","Hdr"),cell("Invoice Total","String","Hdr"),cell("TDS Payable","String","Hdr"),cell("TDS Paid / Filed","String","Hdr"),cell("TDS Pending","String","Hdr"),cell("Challan No","String","Hdr"),cell("Challan Date","String","Hdr")]),
      ...invoiceRows.map(r=>{
        const payable=num(r.TDSAmount),paid=Math.min(num(r.TDSDeductedAmount),payable);
        return row([
          cell(r.VendorName),cell(r.VendorPAN),cell(r.BillNo),cell(String(r.BillDate||"").slice(0,10)),
          cell(tdsSectionLabel(r.TDSSection)),cell(num(r.TDSRate),"Number"),cell(num(r.TaxableAmount),"Number","Money"),
          cell(num(r.GrossAmount)+roundOffOf(r),"Number","Money"),cell(payable,"Number","Money"),
          cell(paid,"Number","Money"),cell(Math.max(payable-paid,0),"Number","Money"),
          cell(r.ChallanNo||""),cell(String(r.ChallanDate||"").slice(0,10))
        ]);
      })
    ].join("");

    const historySheet=[
      row([cell(title,"String","Title")]),
      row([cell("Payment / challan history for selected quarter")]),
      row([cell("Date","String","Hdr"),cell("Challan / Reference","String","Hdr"),cell("Transaction ID","String","Hdr"),cell("Vendors","String","Hdr"),cell("Bills","String","Hdr"),cell("TDS Paid / Filed","String","Hdr"),cell("Type","String","Hdr")]),
      ...tdsPaymentHistory.map(h=>row([
        cell(h.date),cell(h.challan),cell(h.transactionId),cell(h.vendors.join(", ")),
        cell(h.bills,"Number"),cell(h.amount,"Number","Money"),cell(h.legacy?"Legacy mark":"Quarterly challan")
      ]))
    ].join("");

    const xml=`<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="10"/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1"/></Style>
  <Style ss:ID="Hdr"><Font ss:Bold="1"/><Interior ss:Pattern="Solid" ss:Color="#DCE6F1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Money"><NumberFormat ss:Format="#,##0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="Vendor Summary"><Table>${vendorSheet}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>4</SplitHorizontal><TopRowBottomPane>4</TopRowBottomPane></WorksheetOptions></Worksheet>
 <Worksheet ss:Name="Invoice Detail"><Table>${invoiceSheet}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane></WorksheetOptions></Worksheet>
 <Worksheet ss:Name="Payment History"><Table>${historySheet}</Table></Worksheet>
</Workbook>`;
    const blob=new Blob([xml],{type:"application/vnd.ms-excel"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`TDS_Register_${fyLabel(Number(tdsFY)).replace("-","_")}_${tdsQuarter}.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveQuarterlyTDSPayment(){
    setTdsRegisterError("");
    const tx=tdsRegisterTransaction;
    if(!tx)return setTdsRegisterError("Select the bank transaction used to pay TDS to Government.");
    if(!tdsChallanDate)return setTdsRegisterError("Enter Challan / Payment Date.");
    if(tdsRegisterAllocationTotal<=0)return setTdsRegisterError("Allocate the TDS payment to at least one vendor.");
    if(tdsRegisterAllocationTotal>num(tx._tdsAvailable)+0.01){
      return setTdsRegisterError(`Allocation ${fmt(tdsRegisterAllocationTotal)} exceeds unused transaction amount ${fmt(tx._tdsAvailable)}.`);
    }

    for(const g of tdsVendorSummary){
      const amount=num(tdsAllocations[g.key]);
      if(amount>g.pending+0.01){
        return setTdsRegisterError(`${g.vendor}: allocation ${fmt(amount)} exceeds TDS pending ${fmt(g.pending)}.`);
      }
    }

    setTdsRegisterSaving(true);
    try{
      for(const g of tdsVendorSummary){
        let remaining=num(tdsAllocations[g.key]);
        if(remaining<=0.005)continue;

        const bills=tdsQuarterRows
          .filter(r=>norm(r.VendorName)===g.key)
          .sort((a,b)=>
            String(a.BillDate||"").localeCompare(String(b.BillDate||""))||
            String(a.BillNo||"").localeCompare(String(b.BillNo||""))
          );

        for(const r of bills){
          if(remaining<=0.005)break;
          const payable=num(r.TDSAmount);
          const already=Math.min(num(r.TDSDeductedAmount),payable);
          const pending=Math.max(payable-already,0);
          if(pending<=0.005)continue;

          const applied=Math.min(pending,remaining);
          remaining-=applied;
          const existing=readMeta(r.Notes,TDS_QUARTER_META_PREFIX);
          const payments=Array.isArray(existing?.payments)?[...existing.payments]:[];
          payments.push({
            version:2,
            fyStart:Number(tdsFY),
            financialYear:fyLabel(Number(tdsFY)),
            quarter:tdsQuarter,
            vendor:r.VendorName||"",
            pan:r.VendorPAN||"",
            section:r.TDSSection||"",
            billNo:r.BillNo||"",
            transactionId:tx.EntryID||"",
            bankAccount:tx.BankAccountID||"",
            reference:tx.ReferenceID||tx.EntryID||"",
            transactionAmount:num(tx.AmountOut),
            challanNo:tdsChallanNo||tx.ReferenceID||tx.EntryID||"",
            challanDate:tdsChallanDate,
            date:String(tx.Date||tdsChallanDate).slice(0,10),
            amount:Math.round(applied*100)/100
          });

          await apiPost("updateLLPPayable",{
            PayableID:r.PayableID,
            TDSAmount:payable,
            TDSDeductedAmount:Math.round((already+applied)*100)/100,
            TDSRate:r.TDSRate,
            TDSSection:r.TDSSection,
            ChallanNo:tdsChallanNo||r.ChallanNo||"",
            ChallanDate:tdsChallanDate||r.ChallanDate||"",
            Notes:upsertMeta(r.Notes,TDS_QUARTER_META_PREFIX,{payments})
          });
        }

        if(remaining>0.01){
          throw new Error(`${g.vendor}: ${fmt(remaining)} could not be allocated to invoice TDS.`);
        }
      }

      await load();
      setTdsAllocations({});
      setTdsRegisterTransactionId("");
      setTdsChallanNo("");
      setTdsChallanDate("");
    }catch(e){
      setTdsRegisterError(e.message||"Unable to save TDS challan allocation.");
    }finally{
      setTdsRegisterSaving(false);
    }
  }

  async function markTDSPaidFiled(){
    setBatchError("");
    if(!batchVendor)return setBatchError("Select the vendor first.");
    if(!vendorBillsForTDS.length)return setBatchError("No Vendor Bills found for this vendor.");
    if(!tdsPaymentTransaction)return setBatchError("Select the bank transaction used as TDS payment / filing evidence.");

    const cumulative=Math.max(num(tdsPaidTotalInput),0);
    if(cumulative>vendorTDSPayableAfterEdits+0.01){
      return setBatchError(`Cumulative TDS paid / filed cannot exceed vendor TDS payable of ${fmt(vendorTDSPayableAfterEdits)}.`);
    }

    setTdsMarking(true);
    try{
      let remaining=cumulative;
      const ordered=[...vendorBillsForTDS].sort((a,b)=>
        String(a.BillDate||"").localeCompare(String(b.BillDate||""))||
        String(a.BillNo||"").localeCompare(String(b.BillNo||""))
      );

      for(const r of ordered){
        const edited=batchTDSByBill[r.PayableID];
        const payable=Math.max(edited===undefined?num(r.TDSAmount):num(edited),0);
        const allocated=Math.min(payable,remaining);
        remaining=Math.max(remaining-allocated,0);

        const meta={
          transactionId:tdsPaymentTransaction.EntryID||"",
          reference:tdsPaymentTransaction.ReferenceID||tdsPaymentTransaction.EntryID||"",
          date:String(tdsPaymentTransaction.Date||"").slice(0,10),
          transactionAmount:num(tdsPaymentTransaction.AmountOut),
          vendor:batchVendor,
          vendorCumulative:cumulative,
          vendorTDSPayable:vendorTDSPayableAfterEdits,
          billPaidFiled:allocated
        };

        await apiPost("updateLLPPayable",{
          PayableID:r.PayableID,
          TDSAmount:payable,
          TDSDeductedAmount:allocated,
          TDSRate:r.TDSRate,
          TDSSection:r.TDSSection,
          Notes:upsertMeta(r.Notes,TDS_PAYMENT_META_PREFIX,meta)
        });
      }

      await load();
      setTdsPaidTotalInput(cumulative.toFixed(2));
    }catch(e){
      setBatchError(e.message||"Unable to mark TDS paid / filed.");
    }finally{
      setTdsMarking(false);
    }
  }

  async function deleteBatchSettlement(group){
    const billList=group.bills.map(r=>r.BillNo||r.PayableID).join(", ");
    const ok=confirm(
      `Delete this batch settlement allocation?\n\nVendor: ${group.vendor}\nUTR / Reference: ${group.reference||"—"}\nInvoices: ${group.bills.length}\nAllocated bank amount: ${fmt(group.paid)}\n\nThis reverses only the invoice batch-payment link. It does NOT delete the bank transaction and it does NOT change TDS payable / paid-filed tracking.\n\nBills: ${billList}`
    );
    if(!ok)return;

    setBatchHistoryDeleting(group.key);
    setError("");
    try{
      for(const r of group.bills){
        const meta=readMeta(r.Notes,BATCH_META_PREFIX);
        const prev=meta?.previous||{};
        await apiPost("updateLLPPayable",{
          PayableID:r.PayableID,
          PaidAmount:meta?num(prev.PaidAmount):0,
          PaymentDate:meta?(prev.PaymentDate||""):"",
          PaymentMode:meta?(prev.PaymentMode||"Bank"):"Bank",
          BankAccount:meta?(prev.BankAccount||""):"",
          ReferenceNo:meta?(prev.ReferenceNo||""):"",
          PaidByType:meta?(prev.PaidByType||"Company"):"Company",
          PaidByName:meta?(prev.PaidByName||""):"",
          ReimburseTo:meta?(prev.ReimburseTo||""):"",
          ReimbursementStatus:meta?(prev.ReimbursementStatus||"Not Required"):"Not Required",
          TDSAmount:r.TDSAmount,
          TDSDeductedAmount:r.TDSDeductedAmount,
          TDSRate:r.TDSRate,
          TDSSection:r.TDSSection,
          Notes:removeMeta(r.Notes,BATCH_META_PREFIX)
        });
      }
      await load();
    }catch(e){
      setError(e.message||"Unable to delete batch settlement.");
    }finally{
      setBatchHistoryDeleting("");
    }
  }

  function chooseVendor(id){
    setVendorChoice(id);
    if(id==="__new__"){
      setForm(p=>({...p,VendorID:"",VendorName:"",VendorCategory:"Other",VendorGSTIN:"",VendorPAN:""}));
      return;
    }
    const v=vendors.find(x=>x.VendorID===id);
    if(v){
      setForm(p=>({
        ...p,
        VendorID:v.VendorID,
        VendorName:v.VendorName,
        VendorCategory:v.Category||"Other",
        VendorGSTIN:v.GSTIN||"",
        VendorPAN:v.PAN||""
      }));
    }
  }

  function updateLine(i,k,v){
    setForm(p=>{
      const items=[...p.LineItems];
      items[i]={...items[i],[k]:v};
      if(k==="LedgerID"){
        const l=ledgers.find(x=>x.LedgerID===v);
        items[i].LedgerName=l?.LedgerName||"";
      }
      return {...p,LineItems:items};
    });
  }

  function add(){
    setEditId(null);
    setVendorChoice("");
    setForm(initial());
    setBillFile(null);
    setShowMore(false);
    setOpen(true);
  }

  function edit(r){
    const v=vendors.find(x=>x.VendorID===r.VendorID)||
      vendors.find(x=>norm(x.VendorName)===norm(r.VendorName));
    const items=(Array.isArray(r.LineItems)&&r.LineItems.length?r.LineItems:[emptyLine()])
      .map(x=>({...emptyLine(),...x}));
    const ro=r.RoundOffAmount ?? items[0]?.RoundOffAmount ?? 0;

    setVendorChoice(v?.VendorID||"__new__");
    setEditId(r.PayableID);
    setBillFile(null);
    setShowMore(!!(r.ChallanNo||r.ChallanDate||r.Notes));
    setForm({
      ...initial(),
      VendorID:v?.VendorID||r.VendorID||"",
      VendorName:r.VendorName||"",
      VendorCategory:r.VendorCategory||"Other",
      VendorGSTIN:r.VendorGSTIN||"",
      VendorPAN:r.VendorPAN||"",
      BillNo:r.BillNo||"",
      BillDate:String(r.BillDate||"").slice(0,10),
      DueDate:String(r.DueDate||"").slice(0,10),
      Description:r.Description||"",
      LineItems:items,
      TDSSection:r.TDSSection||"",
      TDSRate:r.TDSRate||"0",
      TDSAmount:r.TDSAmount||"",
      TCSAmount:r.TCSAmount||"",
      RoundOffAmount:String(ro||0),
      PaidAmount:r.PaidAmount||"",
      PaymentDate:String(r.PaymentDate||"").slice(0,10),
      PaymentMode:r.PaymentMode||"Bank",
      BankAccount:r.BankAccount||"",
      ReferenceNo:r.ReferenceNo||"",
      PaidByType:r.PaidByType||"Company",
      PaidByName:r.PaidByName||"",
      ReimburseTo:r.ReimburseTo||"",
      ReimbursementStatus:r.ReimbursementStatus||"Not Required",
      ChallanNo:r.ChallanNo||"",
      ChallanDate:String(r.ChallanDate||"").slice(0,10),
      Notes:r.Notes||""
    });
    setOpen(true);
  }

  function validate(){
    if(!form.VendorName)throw new Error("Vendor is required");
    if(!form.BillDate)throw new Error("Bill Date is required");
    if(!form.LineItems.some(x=>num(x.TaxableAmount)>0))throw new Error("Enter at least one bill line");
    for(const x of form.LineItems){
      if(num(x.TaxableAmount)>0&&!x.LedgerID){
        throw new Error(`Select Ledger / Account Head for ${x.Particulars||"each line"}`);
      }
    }
    if(duplicate)throw new Error("Possible duplicate: this vendor + bill number already exists");
    if(a.paid>0){
      if(!form.PaymentDate)throw new Error("Payment Date is required");
      if(personal(form.PaidByType)){
        if(!form.PaidByName)throw new Error("Actual Paid By is required");
        if(!form.ReimburseTo)throw new Error("Reimburse To is required");
      }else if(norm(form.PaymentMode)!=="cash"){
        if(!form.BankAccount)throw new Error("Select Zivara Bank Account");
        if(!form.ReferenceNo.trim())throw new Error("Reference / UTR is required");
      }
    }
  }

  async function save(e){
    e.preventDefault();
    setSaving(true);
    setError("");
    try{
      validate();
      let payload={...form};

      if(!form.VendorID){
        const ex=vendors.find(v=>norm(v.VendorName)===norm(form.VendorName));
        if(ex){
          payload={...payload,VendorID:ex.VendorID};
        }else{
          const vr=await apiPost("saveVendor",{
            VendorName:form.VendorName,
            Category:form.VendorCategory,
            GSTIN:form.VendorGSTIN,
            PAN:form.VendorPAN,
            Status:"Active"
          });
          payload.VendorID=vr.data?.VendorID||"";
        }
      }

      const items=form.LineItems.map((x,i)=>({
        ...x,
        ...lineCalc(x),
        RoundOffAmount:i===0?a.round:undefined
      }));

      payload={
        ...payload,
        LineItems:items,
        TaxableAmount:a.taxable,
        CGSTAmount:a.cgst,
        SGSTAmount:a.sgst,
        IGSTAmount:a.igst,
        GSTAmount:a.gst,
        TCSAmount:a.tcs,
        GrossAmount:a.gross,
        TDSAmount:a.tds,
        NetPayable:a.net,
        Status:a.status,
        RoundOffAmount:a.round
      };

      if(personal(form.PaidByType)){
        payload.BankAccount="";
        payload.ReimbursementStatus=a.paid>0?"Pending":"Not Required";
      }else{
        payload.PaidByName=a.paid>0?"Company":"";
        payload.ReimburseTo="";
        payload.ReimbursementStatus="Not Required";
      }

      const r=await apiPost(
        editId?"updateLLPPayable":"saveLLPPayable",
        editId?{...payload,PayableID:editId}:payload
      );
      const id=editId||r.data?.PayableID;
      if(billFile&&id){
        await uploadBill(billFile,{
          payable_id:id,
          source_type:"payable",
          source_id:id
        });
      }
      setOpen(false);
      await load();
    }catch(e){
      setError(e.message);
    }finally{
      setSaving(false);
    }
  }

  async function remove(r){
    if(!confirm(`Delete ${r.VendorName} / ${r.BillNo}?`))return;
    try{
      await apiPost("deleteLLPPayable",{PayableID:r.PayableID});
      await load();
    }catch(e){
      setError(e.message);
    }
  }

  function openBatchSettlement(){
    setBatchVendor("");
    setBatchTransactionId("");
    setBatchSelected([]);
    setBatchAmount("");
    setBatchTDSByBill({});
    setBatchTDSTotalInput("");
    setBatchTreatment("gross_tds_separate");
    setTdsPaymentTransactionId("");
    setTdsPaidTotalInput("");
    setBatchError("");
    setBatchOpen(true);
  }

  function chooseBatchVendor(value){
    setBatchVendor(value);
    setBatchTransactionId("");
    setBatchSelected([]);
    setBatchAmount("");
    setBatchTDSByBill({});
    setBatchTDSTotalInput("");
    setBatchTreatment("gross_tds_separate");
    setTdsPaymentTransactionId("");
    setTdsPaidTotalInput("");
    setBatchError("");
  }

  function chooseBatchTransaction(entryId){
    setBatchTransactionId(entryId);
    const tx=candidateBankTransactions.find(x=>x.EntryID===entryId);
    setBatchAmount(tx?String(tx._available):"");
    setBatchError("");
  }

  function toggleBatchBill(id){
    setBatchSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  }

  function selectAllBatchBills(){
    setBatchSelected(batchBills.map(x=>x.PayableID));
  }

  async function saveBatchSettlement(){
    setBatchError("");
    const tx=batchTransaction;
    const amount=num(batchAmount);

    if(!batchVendor)return setBatchError("Select a vendor.");
    if(!tx)return setBatchError("Select the existing bank debit.");
    if(!batchSelected.length)return setBatchError("Select at least one Vendor Bill.");
    if(amount<=0)return setBatchError("Enter an amount to allocate.");
    if(batchExactTDSTotal>batchGrossTotal+0.01)return setBatchError("Exact TDS cannot exceed the selected invoice gross total.");
    const invalidTDSBill=selectedBatchPreview.find(r=>num(r._exactTDS)>num(r._grossWithRound)+0.01);
    if(invalidTDSBill)return setBatchError(`Exact TDS cannot exceed invoice total for ${invalidTDSBill.BillNo||invalidTDSBill.PayableID}.`);
    if(amount>tx._available+0.01)return setBatchError(`Amount cannot exceed unused bank debit of ${fmt(tx._available)}.`);
    if(amount>selectedBatchBalance+0.01)return setBatchError(`Amount cannot exceed selected vendor-payment target of ${fmt(selectedBatchBalance)}.`);

    const unselectedOutstanding=batchBills.filter(r=>!batchSelected.includes(r.PayableID));
    const settlesSelected=Math.abs(selectedBatchBalance-amount)<=0.01;
    if(!unselectedOutstanding.length&&settlesSelected&&vendorTDSPending>0.01){
      return setBatchError(`This is the last outstanding vendor settlement, but TDS pending is ${fmt(vendorTDSPending)}. Mark the remaining TDS paid / filed against a transaction before paying the last invoice.`);
    }

    setBatchSaving(true);
    try{
      for(const preview of allocationPreview){
        const r=preview;
        const bankApplied=Math.round(num(r._allocation)*100)/100;
        if(bankApplied<=0)continue;
        const exactTDS=Math.round(num(r._exactTDS)*100)/100;
        const fullTarget=num(r._vendorTarget);
        const fullSettlement=bankApplied+0.01>=num(r._vendorBalance);
        const adjustedNet=Math.max(num(r._adjustedNet),0);
        const priorPaid=num(r.PaidAmount);
        const accountingPaid=fullSettlement?adjustedNet:Math.min(adjustedNet,priorPaid+bankApplied);
        const existingMeta=readMeta(r.Notes,BATCH_META_PREFIX);
        const previous=existingMeta?.previous||{
          PaidAmount:r.PaidAmount,
          PaymentDate:String(r.PaymentDate||"").slice(0,10),
          PaymentMode:r.PaymentMode||"",
          BankAccount:r.BankAccount||"",
          ReferenceNo:r.ReferenceNo||"",
          PaidByType:r.PaidByType||"Company",
          PaidByName:r.PaidByName||"",
          ReimburseTo:r.ReimburseTo||"",
          ReimbursementStatus:r.ReimbursementStatus||"Not Required"
        };
        const meta={
          version:2,
          vendor:batchVendor,
          transactionId:tx.EntryID||"",
          paymentDate:String(tx.Date||"").slice(0,10),
          bankAccount:tx.BankAccountID||"",
          reference:tx.ReferenceID||tx.EntryID||"",
          bankAllocated:bankApplied,
          treatment:batchTreatment,
          vendorTarget:fullTarget,
          exactTDS,
          previous
        };
        await apiPost("updateLLPPayable",{
          PayableID:r.PayableID,
          TDSAmount:exactTDS,
          TDSDeductedAmount:r.TDSDeductedAmount,
          TDSRate:r.TDSRate,
          TDSSection:r.TDSSection,
          PaidAmount:accountingPaid,
          PaymentDate:String(tx.Date||"").slice(0,10),
          PaymentMode:"Existing Bank Transaction",
          BankAccount:tx.BankAccountID||"",
          ReferenceNo:tx.ReferenceID||tx.EntryID,
          PaidByType:"Company",
          PaidByName:"Company",
          ReimburseTo:"",
          ReimbursementStatus:"Not Required",
          Notes:upsertMeta(r.Notes,BATCH_META_PREFIX,meta)
        });
      }
      setBatchOpen(false);
      await load();
    }catch(e){
      setBatchError(e.message||"Unable to settle selected bills.");
    }finally{
      setBatchSaving(false);
    }
  }

  return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
      <div>
        <h2>Payment Tracker</h2>
        <p style={{color:"var(--muted)",fontSize:".8rem"}}>
          Vendor bills, GST/TDS/TCS, exact round-off and accounting-linked payments
        </p>
      </div>
      <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
        <button style={btn("ghost")} onClick={()=>setTdsRegisterOpen(true)}>TDS Quarterly Register</button>
        <button style={btn("ghost")} onClick={()=>setBatchHistoryOpen(true)}>Batch History · {batchHistory.length}</button>
        <button style={btn("ghost")} onClick={openBatchSettlement}>Batch Settlement</button>
        <button style={btn()} onClick={add}>+ Add Bill</button>
      </div>
    </div>

    {error&&<div style={{...card,color:"var(--danger)"}}>{error}</div>}

    <div style={{...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".7rem",alignItems:"end"}}>
      <div>
        <label style={label}>Vendor</label>
        <select style={input} value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}>
          <option value="">All vendors</option>
          {vendorNames.map(x=><option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <div>
        <label style={label}>Status</label>
        <select style={input} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statusNames.map(x=><option key={x} value={x}>{x}</option>)}
          {!statusNames.includes("Pending")&&<option>Pending</option>}
          {!statusNames.includes("Part Paid")&&<option>Part Paid</option>}
          {!statusNames.includes("Paid")&&<option>Paid</option>}
          {!statusNames.includes("Cancelled")&&<option>Cancelled</option>}
        </select>
      </div>
      <div>
        <label style={label}>From bill date</label>
        <input style={input} type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/>
      </div>
      <div>
        <label style={label}>To bill date</label>
        <input style={input} type="date" min={fromDate||undefined} value={toDate} onChange={e=>setToDate(e.target.value)}/>
      </div>
      <div style={{gridColumn:"span 2"}}>
        <label style={label}>Search</label>
        <input
          style={input}
          placeholder="Bill no, description, UTR..."
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />
      </div>
      <div>
        <button style={btn("ghost")} onClick={()=>{setFilterVendor("");setFilterStatus("");setFromDate("");setToDate("");setSearch("")}}>Reset</button>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".7rem"}}>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>{filterVendor?"VENDOR":"FILTERED"} BILLS</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{snapshot.bills}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TOTAL INVOICE AMOUNT</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.gross)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>NET PAYABLE</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.net)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>ACTUAL PAID / ALLOCATED</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.paid)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>VENDOR BALANCE</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.balance)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>OVERDUE</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.overdue)}<div style={{fontSize:".7rem",fontWeight:600,color:"var(--muted)"}}>{snapshot.overdueBills} bill(s)</div></div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TDS PAYABLE</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.tds)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TDS PAID / FILED</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem"}}>{fmt(snapshot.tdsPaid)}</div></div>
      <div style={{...card,borderColor:snapshot.tdsPending>0.005?"#f59e0b66":"#22c55e66"}}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TDS PENDING</div><div style={{fontSize:"1.15rem",fontWeight:800,marginTop:".2rem",color:snapshot.tdsPending>0.005?"var(--warning)":"var(--success)"}}>{fmt(snapshot.tdsPending)}</div></div>
    </div>

    <div style={{...card,padding:0,overflowX:"auto"}}>
      <table>
        <thead>
          <tr>
            <th>Vendor</th><th>Bill</th><th>Date</th><th>Due</th><th>Gross Bill</th><th>TCS</th><th>TDS</th>
            <th>Round Off</th><th>Invoice Total</th><th>Net Payable</th><th>Paid</th><th>Balance</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(r=>{
            const today=new Date().toISOString().slice(0,10);
            const due=String(r.DueDate||"").slice(0,10);
            const overdue=num(r.BalanceAmount)>0.005&&due&&due<today;
            return <tr key={r.PayableID}>
            <td><strong>{r.VendorName}</strong></td>
            <td>{r.BillNo||"—"}</td>
            <td>{formatDate(r.BillDate)}</td>
            <td style={overdue?{color:"var(--danger)",fontWeight:700}:undefined}>{due?formatDate(r.DueDate):"—"}</td>
            <td>{fmt(r.GrossAmount)}</td>
            <td>{fmt(r.TCSAmount)}</td>
            <td>{fmt(r.TDSAmount)}</td>
            <td>{fmt(roundOffOf(r))}</td>
            <td><strong>{fmt(num(r.GrossAmount)+roundOffOf(r))}</strong></td>
            <td><strong>{fmt(r.NetPayable)}</strong></td>
            <td>{fmt(r.PaidAmount)}</td>
            <td><strong>{fmt(r.BalanceAmount)}</strong></td>
            <td><Badge value={r.Status}/></td>
            <td>
              <button style={btn("ghost")} onClick={()=>edit(r)}>Edit</button>{" "}
              <button style={{...btn("ghost"),color:"var(--danger)"}} onClick={()=>remove(r)}>Delete</button>
            </td>
          </tr>})}
          {!filtered.length&&<tr>
            <td colSpan="14" style={{padding:"2rem",textAlign:"center"}}>No bills</td>
          </tr>}
        </tbody>
        {filtered.length>0&&<tfoot>
          <tr>
            <td colSpan="4"><strong>Filtered total{filterVendor?` · ${filterVendor}`:""}</strong></td>
            <td><strong>{fmt(filtered.filter(r=>norm(r.Status)!=="cancelled").reduce((s,r)=>s+num(r.GrossAmount),0))}</strong></td>
            <td></td>
            <td><strong>{fmt(snapshot.tds)}</strong></td>
            <td></td>
            <td><strong>{fmt(snapshot.gross)}</strong></td>
            <td><strong>{fmt(snapshot.net)}</strong></td>
            <td><strong>{fmt(snapshot.paid)}</strong></td>
            <td><strong>{fmt(snapshot.balance)}</strong></td>
            <td colSpan="2"></td>
          </tr>
        </tfoot>}
      </table>
    </div>

    {tdsRegisterOpen&&<div
      onMouseDown={e=>{if(e.target===e.currentTarget)setTdsRegisterOpen(false)}}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:98,padding:"1rem",overflowY:"auto"}}
    >
      <div style={{...card,maxWidth:1280,margin:"2vh auto 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <h3 style={{margin:0}}>Quarterly TDS Register</h3>
            <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:".25rem",maxWidth:760,lineHeight:1.5}}>
              Reconcile invoice TDS vendor-wise for quarterly filing. TDS Payable comes from Vendor Bills; Paid / Filed changes only when you allocate an actual Government TDS payment / challan below.
            </div>
          </div>
          <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
            <button type="button" style={btn("ghost")} onClick={exportQuarterlyTDSExcel}>Export Excel</button>
            <button type="button" style={btn("ghost")} onClick={()=>setTdsRegisterOpen(false)}>Close</button>
          </div>
        </div>

        {tdsRegisterError&&<div style={{...card,color:"var(--danger)",marginTop:".8rem"}}>{tdsRegisterError}</div>}

        <div style={{...card,marginTop:".8rem",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".65rem",alignItems:"end"}}>
          <div>
            <label style={label}>Financial Year</label>
            <select style={input} value={tdsFY} onChange={e=>setTdsFY(Number(e.target.value))}>
              {tdsFYOptions.map(y=><option key={y} value={y}>FY {fyLabel(y)}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Quarter</label>
            <select style={input} value={tdsQuarter} onChange={e=>setTdsQuarter(e.target.value)}>
              <option value="Q1">Q1 · Apr–Jun</option>
              <option value="Q2">Q2 · Jul–Sep</option>
              <option value="Q3">Q3 · Oct–Dec</option>
              <option value="Q4">Q4 · Jan–Mar</option>
            </select>
          </div>
          <div>
            <label style={label}>Vendor</label>
            <select style={input} value={tdsVendorFilter} onChange={e=>setTdsVendorFilter(e.target.value)}>
              <option value="">All vendors</option>
              {tdsRegisterVendors.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>TDS Section</label>
            <select style={input} value={tdsSectionFilter} onChange={e=>setTdsSectionFilter(e.target.value)}>
              <option value="">All sections</option>
              {tdsRegisterSections.map(s=><option key={s} value={s}>{tdsSectionLabel(s)}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>TDS Status</label>
            <select style={input} value={tdsStatusFilter} onChange={e=>setTdsStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="cleared">Fully Paid / Filed</option>
            </select>
          </div>
          <div>
            <button type="button" style={btn("ghost")} onClick={()=>{setTdsVendorFilter("");setTdsSectionFilter("");setTdsStatusFilter("")}}>Reset TDS Filters</button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".65rem",marginTop:".8rem"}}>
          <div style={card}><div style={label}>Vendors</div><strong style={{fontSize:"1.15rem"}}>{tdsQuarterTotals.vendors}</strong></div>
          <div style={card}><div style={label}>Bills With TDS</div><strong style={{fontSize:"1.15rem"}}>{tdsQuarterTotals.bills}</strong></div>
          <div style={card}><div style={label}>TDS Payable</div><strong style={{fontSize:"1.15rem"}}>{fmt(tdsQuarterTotals.payable)}</strong></div>
          <div style={card}><div style={label}>TDS Paid / Filed</div><strong style={{fontSize:"1.15rem",color:"var(--success)"}}>{fmt(tdsQuarterTotals.paid)}</strong></div>
          <div style={{...card,borderColor:tdsQuarterTotals.pending>0.005?"#f59e0b66":"#22c55e66"}}><div style={label}>TDS Pending</div><strong style={{fontSize:"1.15rem",color:tdsQuarterTotals.pending>0.005?"var(--warning)":"var(--success)"}}>{fmt(tdsQuarterTotals.pending)}</strong></div>
          <div style={card}><div style={label}>Check</div><strong style={{fontSize:"1.05rem"}}>{fmt(tdsQuarterTotals.payable-tdsQuarterTotals.paid)}</strong><div style={{fontSize:".65rem",color:"var(--muted)"}}>Payable − Paid = Pending</div></div>
        </div>

        <div style={{...card,marginTop:".8rem",padding:0,overflowX:"auto"}}>
          <div style={{padding:".75rem .85rem",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap",borderBottom:"1px solid var(--border)"}}>
            <div>
              <strong>Vendor-wise TDS Reconciliation</strong>
              <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".2rem"}}>Allocate a Government TDS payment vendor-wise. Partial allocations are allowed.</div>
            </div>
            <button type="button" style={btn("ghost")} disabled={!tdsRegisterTransaction} onClick={fillAllTDSPending}>Fill Pending From Available Transaction</button>
          </div>
          <table>
            <thead>
              <tr><th>Vendor</th><th>PAN</th><th>TDS Section(s)</th><th>Bills</th><th>TDS Payable</th><th>Paid / Filed</th><th>Pending</th><th>This Challan Allocation</th><th></th></tr>
            </thead>
            <tbody>
              {tdsVendorSummary.map(g=><tr key={g.key}>
                <td><strong>{g.vendor}</strong></td>
                <td>{g.pan||"—"}</td>
                <td style={{maxWidth:260,whiteSpace:"normal"}}>{g.sections.length?g.sections.map(tdsSectionLabel).join(" · "):"—"}</td>
                <td>{g.bills}</td>
                <td>{fmt(g.payable)}</td>
                <td><strong style={{color:g.paid>0?"var(--success)":"inherit"}}>{fmt(g.paid)}</strong></td>
                <td><strong style={{color:g.pending>0.005?"var(--warning)":"var(--success)"}}>{fmt(g.pending)}</strong></td>
                <td>
                  <input
                    style={{...input,minWidth:115}}
                    type="number"
                    min="0"
                    max={g.pending}
                    step=".01"
                    disabled={g.pending<=0.005}
                    value={tdsAllocations[g.key]??""}
                    onChange={e=>setTdsAllocations(prev=>({...prev,[g.key]:e.target.value}))}
                    placeholder="0.00"
                  />
                </td>
                <td><button type="button" style={btn("ghost")} disabled={g.pending<=0.005} onClick={()=>fillTDSVendorPending(g.key)}>Fill Pending</button></td>
              </tr>)}
              {!tdsVendorSummary.length&&<tr><td colSpan="9" style={{padding:"1.5rem",textAlign:"center"}}>No TDS Vendor Bills for this quarter / filter.</td></tr>}
            </tbody>
            {tdsVendorSummary.length>0&&<tfoot><tr>
              <td colSpan="4"><strong>Quarter Total</strong></td>
              <td><strong>{fmt(tdsQuarterTotals.payable)}</strong></td>
              <td><strong>{fmt(tdsQuarterTotals.paid)}</strong></td>
              <td><strong>{fmt(tdsQuarterTotals.pending)}</strong></td>
              <td><strong>{fmt(tdsRegisterAllocationTotal)}</strong></td>
              <td></td>
            </tr></tfoot>}
          </table>
        </div>

        <div style={{...card,marginTop:".8rem",borderColor:tdsQuarterTotals.pending>0.005?"#f59e0b55":"#22c55e55"}}>
          <div style={{fontWeight:800,marginBottom:".2rem"}}>Mark Government TDS Payment / Challan</div>
          <div style={{fontSize:".72rem",color:"var(--muted)",marginBottom:".65rem"}}>
            Select the actual bank debit used for TDS remittance, enter challan details, then allocate the payment across vendors above. This does not change the vendor bank payment.
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(260px,2fr) minmax(160px,1fr) minmax(160px,1fr)",gap:".65rem",alignItems:"end"}}>
            <div>
              <label style={label}>Existing Bank Transaction *</label>
              <select style={input} value={tdsRegisterTransactionId} onChange={e=>chooseTDSRegisterTransaction(e.target.value)}>
                <option value="">— Select Government TDS payment bank debit —</option>
                {tdsRegisterTransactions.map(tx=><option key={tx.EntryID} value={tx.EntryID}>
                  {formatDate(tx.Date)} · {fmt(tx._tdsAvailable)} available of {fmt(tx.AmountOut)} · {tx.ReferenceID||tx.EntryID} · {tx.LedgerName||""} · {tx.Description||""}
                </option>)}
              </select>
              {tdsRegisterTransaction&&<small style={{color:"var(--muted)"}}>
                Previously allocated to TDS {fmt(tdsRegisterTransaction._tdsUsed)} · Available {fmt(tdsRegisterTransaction._tdsAvailable)}
              </small>}
            </div>
            <div>
              <label style={label}>Challan / Reference No</label>
              <input style={input} value={tdsChallanNo} onChange={e=>setTdsChallanNo(e.target.value)} placeholder="CIN / challan / bank ref"/>
            </div>
            <div>
              <label style={label}>Challan / Payment Date *</label>
              <input style={input} type="date" value={tdsChallanDate} onChange={e=>setTdsChallanDate(e.target.value)}/>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginTop:".75rem",flexWrap:"wrap"}}>
            <div style={{fontSize:".76rem"}}>
              Allocation <strong>{fmt(tdsRegisterAllocationTotal)}</strong>
              {tdsRegisterTransaction&&<> · Transaction available <strong>{fmt(tdsRegisterTransaction._tdsAvailable)}</strong></>}
              · Quarter pending <strong>{fmt(tdsQuarterTotals.pending)}</strong>
            </div>
            <button
              type="button"
              style={btn()}
              disabled={tdsRegisterSaving||!tdsRegisterTransaction||tdsRegisterAllocationTotal<=0}
              onClick={saveQuarterlyTDSPayment}
            >
              {tdsRegisterSaving?"Saving TDS...":"Mark TDS Paid / Filed"}
            </button>
          </div>
        </div>

        <div style={{...card,marginTop:".8rem",padding:0,overflowX:"auto"}}>
          <div style={{padding:".75rem .85rem",borderBottom:"1px solid var(--border)"}}>
            <strong>TDS Payment / Challan History · FY {fyLabel(Number(tdsFY))} · {tdsQuarter}</strong>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Challan / Reference</th><th>Transaction</th><th>Vendors</th><th>Bills</th><th>TDS Paid / Filed</th><th>Type</th></tr></thead>
            <tbody>
              {tdsPaymentHistory.map(h=><tr key={h.key}>
                <td>{h.date?formatDate(h.date):"—"}</td>
                <td>{h.challan||"—"}</td>
                <td style={{maxWidth:220,whiteSpace:"normal",overflowWrap:"anywhere"}}>{h.transactionId||"—"}</td>
                <td style={{maxWidth:300,whiteSpace:"normal"}}>{h.vendors.join(", ")||"—"}</td>
                <td>{h.bills}</td>
                <td><strong>{fmt(h.amount)}</strong></td>
                <td>{h.legacy?"Legacy mark":"Quarterly challan"}</td>
              </tr>)}
              {!tdsPaymentHistory.length&&<tr><td colSpan="7" style={{padding:"1.4rem",textAlign:"center"}}>No TDS payments / challans recorded for this quarter.</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={{...card,marginTop:".8rem",padding:0,overflowX:"auto"}}>
          <div style={{padding:".75rem .85rem",borderBottom:"1px solid var(--border)"}}>
            <strong>Invoice Detail</strong>
          </div>
          <table>
            <thead><tr><th>Vendor</th><th>PAN</th><th>Bill</th><th>Date</th><th>Section</th><th>Rate</th><th>Taxable</th><th>Invoice Total</th><th>TDS Payable</th><th>Paid / Filed</th><th>Pending</th><th>Challan</th></tr></thead>
            <tbody>
              {tdsQuarterRows.map(r=>{
                const payable=num(r.TDSAmount),paid=Math.min(num(r.TDSDeductedAmount),payable),pending=Math.max(payable-paid,0);
                return <tr key={r.PayableID}>
                  <td><strong>{r.VendorName}</strong></td><td>{r.VendorPAN||"—"}</td><td>{r.BillNo||"—"}</td><td>{formatDate(r.BillDate)}</td>
                  <td>{tdsSectionLabel(r.TDSSection)}</td><td>{num(r.TDSRate).toFixed(2)}%</td><td>{fmt(r.TaxableAmount)}</td>
                  <td>{fmt(num(r.GrossAmount)+roundOffOf(r))}</td><td>{fmt(payable)}</td><td>{fmt(paid)}</td>
                  <td><strong style={{color:pending>0.005?"var(--warning)":"var(--success)"}}>{fmt(pending)}</strong></td>
                  <td>{r.ChallanNo||"—"}</td>
                </tr>;
              })}
              {!tdsQuarterRows.length&&<tr><td colSpan="12" style={{padding:"1.4rem",textAlign:"center"}}>No invoice TDS detail for the selected quarter.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>}

    {batchHistoryOpen&&<div
      onMouseDown={e=>{if(e.target===e.currentTarget)setBatchHistoryOpen(false)}}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.68)",zIndex:96,padding:"1rem",overflowY:"auto"}}
    >
      <div style={{...card,maxWidth:1180,margin:"3vh auto 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginBottom:"1rem"}}>
          <div>
            <h3 style={{margin:0}}>Batch Settlement History</h3>
            <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:".2rem"}}>
              Current Vendor Bills linked through Existing Bank Transaction batch settlements. Deleting a batch reverses the invoice allocations only; the bank transaction and TDS already deducted / filed are preserved.
            </div>
          </div>
          <button style={btn("ghost")} onClick={()=>setBatchHistoryOpen(false)}>Close</button>
        </div>

        <div style={{overflowX:"auto"}}>
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Vendor</th><th>Reference / UTR</th><th>Bank</th><th>Invoices</th>
                <th>Gross</th><th>TDS</th><th>TDS Deducted / Filed</th><th>Allocated</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {batchHistory.map(g=><tr key={g.key}>
                <td>{formatDate(g.date)}</td>
                <td><strong>{g.vendor||"—"}</strong></td>
                <td style={{maxWidth:220,whiteSpace:"normal",overflowWrap:"anywhere"}}>{g.reference||"—"}</td>
                <td>{batchHistoryBankName(g.bank)}</td>
                <td>
                  <strong>{g.bills.length}</strong>
                  <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:".2rem",maxWidth:260,whiteSpace:"normal",overflowWrap:"anywhere"}}>
                    {g.bills.map(r=>r.BillNo||r.PayableID).join(", ")}
                  </div>
                </td>
                <td>{fmt(g.gross)}</td>
                <td>{fmt(g.tds)}</td>
                <td><strong>{fmt(g.tdsDeducted)}</strong></td>
                <td><strong>{fmt(g.paid)}</strong></td>
                <td>
                  <button
                    type="button"
                    style={{...btn("ghost"),color:"var(--danger)"}}
                    disabled={batchHistoryDeleting===g.key}
                    onClick={()=>deleteBatchSettlement(g)}
                  >
                    {batchHistoryDeleting===g.key?"Deleting...":"Delete Batch Settlement"}
                  </button>
                </td>
              </tr>)}
              {!batchHistory.length&&<tr><td colSpan="10" style={{padding:"1.5rem",textAlign:"center"}}>No current batch settlements found.</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={{...card,marginTop:"1rem",fontSize:".74rem",lineHeight:1.5}}>
          <strong>Important:</strong> history is reconstructed from the current Vendor Bill payment links. If a bill had an older payment before it was converted into an Existing Bank Transaction batch settlement, deleting the batch resets the current linked Paid Amount on that bill. TDS Amount and TDS Deducted / Filed are deliberately not reduced.
        </div>
      </div>
    </div>}

    {batchOpen&&<div
      onMouseDown={e=>{if(e.target===e.currentTarget)setBatchOpen(false)}}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.68)",zIndex:95,padding:"1rem",overflowY:"auto"}}
    >
      <div style={{...card,maxWidth:1180,margin:"3vh auto 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginBottom:"1rem"}}>
          <div>
            <h3 style={{margin:0}}>Batch Vendor Settlement</h3>
            <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:".2rem"}}>
              Allocate an existing bank debit across multiple Vendor Bills. No new bank transaction is created.
            </div>
          </div>
          <button style={btn("ghost")} onClick={()=>setBatchOpen(false)}>Close</button>
        </div>

        {batchError&&<div style={{...card,color:"var(--danger)",marginBottom:".8rem"}}>{batchError}</div>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:".75rem"}}>
          <div>
            <label style={label}>Vendor *</label>
            <select style={input} value={batchVendor} onChange={e=>chooseBatchVendor(e.target.value)}>
              <option value="">— Select vendor —</option>
              {outstandingVendors.map(x=><option key={x} value={x}>{x}</option>)}
            </select>
          </div>

          <div style={{gridColumn:"span 2"}}>
            <label style={label}>Existing Bank Debit *</label>
            <select
              style={input}
              value={batchTransactionId}
              disabled={!batchVendor}
              onChange={e=>chooseBatchTransaction(e.target.value)}
            >
              <option value="">— Select already-entered bank payment —</option>
              {candidateBankTransactions.map(tx=><option key={tx.EntryID} value={tx.EntryID}>
                {formatDate(tx.Date)} · {fmt(tx._available)} available · {tx.LedgerName||"Vendor"} · {tx.ReferenceID||"No UTR"} · {tx.Description||""}
              </option>)}
            </select>
            {batchVendor&&candidateBankTransactions.length===0&&
              <small style={{color:"var(--warning)"}}>
                No matching vendor-ledger bank debit found. In Transactions, post the debit to the {batchVendor} vendor ledger first.
              </small>}
          </div>

          <div>
            <label style={label}>Amount to Allocate *</label>
            <input
              style={input}
              type="number"
              min="0"
              step=".01"
              value={batchAmount}
              disabled={!batchTransaction}
              onChange={e=>setBatchAmount(e.target.value)}
            />
            {batchTransaction&&<small style={{color:"var(--muted)"}}>
              Bank debit {fmt(batchTransaction.AmountOut)} · previously allocated {fmt(batchTransaction._used)} · available {fmt(batchTransaction._available)}
            </small>}
          </div>

          <div>
            <label style={label}>Vendor Payment Treatment *</label>
            <select style={input} value={batchTreatment} onChange={e=>setBatchTreatment(e.target.value)}>
              <option value="gross_tds_separate">Gross invoice payment · TDS tracked separately</option>
              <option value="net_of_tds">Net of TDS · TDS withheld from vendor payment</option>
            </select>
            <small style={{color:"var(--muted)"}}>
              Use Gross when the bank paid the invoice amount without reducing TDS. TDS payable/paid/pending is tracked separately below.
            </small>
          </div>
        </div>

        {batchVendor&&<div style={{marginTop:"1rem",border:"1px solid var(--border)",borderRadius:"7px",overflow:"hidden"}}>
          <div style={{padding:".7rem .8rem",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",borderBottom:"1px solid var(--border)",flexWrap:"wrap"}}>
            <strong>Outstanding bills · {batchBills.length}</strong>
            <div style={{display:"flex",gap:".5rem",alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:".73rem",color:"var(--muted)"}}>Selected invoices {batchInvoiceCount} · Vendor payment target {fmt(selectedBatchBalance)}</span>
              <button type="button" style={btn("ghost")} onClick={selectAllBatchBills}>Select all</button>
              <button type="button" style={btn("ghost")} onClick={()=>{setBatchSelected([]);setBatchTDSByBill({});setBatchTDSTotalInput("")}}>Clear</button>
            </div>
          </div>

          {batchSelected.length>0&&<div style={{padding:".8rem",borderBottom:"1px solid var(--border)",background:"rgba(255,255,255,.02)"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:".55rem"}}>
              <div style={card}><div style={label}>Invoices</div><strong>{batchInvoiceCount}</strong></div>
              <div style={card}><div style={label}>Invoice Total</div><strong>{fmt(batchGrossTotal)}</strong></div>
              <div style={card}><div style={label}>Taxable</div><strong>{fmt(batchTaxableTotal)}</strong></div>
              <div style={card}><div style={label}>GST</div><strong>{fmt(batchGSTTotal)}</strong></div>
              <div style={card}><div style={label}>Selected Batch TDS Payable</div><strong>{fmt(batchExactTDSTotal)}</strong></div>
              <div style={{...card,borderColor:batchTDSPendingTotal>0?"#f59e0b66":"#22c55e66"}}><div style={label}>Selected Batch TDS Pending</div><strong style={{color:batchTDSPendingTotal>0?"var(--warning)":"var(--success)"}}>{fmt(batchTDSPendingTotal)}</strong></div>
              <div style={{...card,borderColor:priorOtherTDSPending>0?"#f59e0b66":"#22c55e66"}}><div style={label}>Earlier / Other TDS Pending</div><strong style={{color:priorOtherTDSPending>0?"var(--warning)":"var(--success)"}}>{fmt(priorOtherTDSPending)}</strong></div>
              <div style={{...card,borderColor:"#38bdf866"}}><div style={label}>Vendor TDS Payable · Cumulative</div><strong>{fmt(vendorTDSPayableAfterEdits)}</strong></div>
              <div style={{...card,borderColor:vendorTDSPaidFiled>0?"#22c55e66":"var(--border)"}}><div style={label}>Vendor TDS Paid / Filed</div><strong style={{color:vendorTDSPaidFiled>0?"var(--success)":"inherit"}}>{fmt(vendorTDSPaidFiled)}</strong></div>
              <div style={{...card,borderColor:vendorTDSPending>0?"#f59e0b66":"#22c55e66"}}><div style={label}>Vendor TDS Pending · Cumulative</div><strong style={{color:vendorTDSPending>0?"var(--warning)":"var(--success)"}}>{fmt(vendorTDSPending)}</strong></div>
              <div style={card}><div style={label}>Net Liability</div><strong>{fmt(batchAdjustedNetTotal)}</strong></div>
              <div style={card}><div style={label}>Vendor Payment Target</div><strong>{fmt(selectedBatchBalance)}</strong></div>
              <div style={card}><div style={label}>Bank Allocation</div><strong>{fmt(batchAllocationAmount)}</strong></div>
              <div style={{...card,borderColor:totalCashStillRequired>0.01?"#f59e0b66":"#22c55e66"}}><div style={label}>Total Still to Pay · Vendor + TDS</div><strong style={{color:totalCashStillRequired>0.01?"var(--warning)":"var(--success)"}}>{fmt(totalCashStillRequired)}</strong><div style={{fontSize:".65rem",color:"var(--muted)",marginTop:".2rem"}}>Vendor shortfall {fmt(vendorPaymentShortfall)} + cumulative TDS pending {fmt(vendorTDSPending)}</div></div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"minmax(220px,1fr) auto minmax(180px,auto)",gap:".6rem",alignItems:"end",marginTop:".75rem"}}>
              <div>
                <label style={label}>Exact TDS Total — editable</label>
                <input
                  style={input}
                  type="number"
                  min="0"
                  step=".01"
                  value={batchTDSTotalInput}
                  onChange={e=>setBatchTDSTotalInput(e.target.value)}
                  onBlur={()=>setBatchExactTDSTotal(batchTDSTotalInput)}
                  onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur()}}}
                />
                <small style={{color:"var(--muted)"}}>
                  This edits TDS payable only for the selected invoices. Earlier settled invoices remain included in the cumulative Vendor TDS cards above.
                </small>
              </div>
              <button type="button" style={btn("ghost")} onClick={resetBatchTDS}>Reset to current TDS</button>
              <div style={{...card,padding:".65rem .75rem",borderColor:Math.abs(batchDifference)<=0.01?"#22c55e66":"#f59e0b66"}}>
                <div style={label}>{batchDifference>0.01?"Vendor payment still to allocate":batchDifference<-0.01?"Bank exceeds vendor payment target":"Vendor payment difference"}</div>
                <strong style={{color:Math.abs(batchDifference)<=0.01?"var(--success)":"var(--warning)"}}>{fmt(Math.abs(batchDifference))}</strong>
              </div>
            </div>

            <div style={{...card,marginTop:".8rem",padding:".8rem",borderColor:vendorTDSPending>0?"#f59e0b66":"#22c55e66"}}>
              <div style={{fontWeight:750,marginBottom:".15rem"}}>Mark Vendor TDS Paid / Filed</div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginBottom:".55rem"}}>
                This is cumulative across all {batchVendor} Vendor Bills, including invoices already settled in earlier bank batches. Use this to carry earlier TDS pending forward to the final settlement.
              </div>
              <div style={{display:"grid",gridTemplateColumns:"minmax(220px,1.5fr) minmax(160px,.7fr) auto",gap:".6rem",alignItems:"end"}}>
                <div>
                  <label style={label}>Any Existing Bank Transaction *</label>
                  <select style={input} value={tdsPaymentTransactionId} onChange={e=>setTdsPaymentTransactionId(e.target.value)}>
                    <option value="">— Select TDS payment / filing transaction —</option>
                    {tdsPaymentTransactions.map(tx=><option key={tx.EntryID} value={tx.EntryID}>
                      {formatDate(tx.Date)} · {fmt(tx.AmountOut)} · {tx.ReferenceID||tx.EntryID} · {tx.LedgerName||""} · {tx.Description||""}
                    </option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Vendor Cumulative TDS Paid / Filed *</label>
                  <input style={input} type="number" min="0" step=".01" placeholder={vendorTDSPaidFiled.toFixed(2)} value={tdsPaidTotalInput} onChange={e=>setTdsPaidTotalInput(e.target.value)}/>
                  <small style={{color:"var(--muted)"}}>Enter cumulative paid/filed for this vendor, e.g. ₹236.00. Later enter ₹372.84 when the remaining ₹136.84 is paid/filed.</small>
                </div>
                <button type="button" style={btn()} disabled={tdsMarking||!tdsPaymentTransactionId||tdsPaidTotalInput===""} onClick={markTDSPaidFiled}>
                  {tdsMarking?"Marking...":"Mark TDS Paid / Filed"}
                </button>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".5rem"}}>
                Cumulative vendor TDS: Payable {fmt(vendorTDSPayableAfterEdits)} · Paid / Filed {fmt(vendorTDSPaidFiled)} · Earlier / Other Pending {fmt(priorOtherTDSPending)} · Total Pending {fmt(vendorTDSPending)}. For quarterly challan allocation and CA reconciliation, use <button type="button" onClick={()=>{setBatchOpen(false);setTdsRegisterOpen(true)}} style={{border:0,background:"transparent",padding:0,color:"var(--accent)",cursor:"pointer",fontWeight:700}}>TDS Quarterly Register</button>.
              </div>
            </div>
          </div>}

          <div style={{overflowX:"auto",maxHeight:"46vh",overflowY:"auto"}}>
            <table>
              <thead>
                <tr><th></th><th>Bill</th><th>Date</th><th>Gross</th><th>Current TDS</th><th>TDS Paid / Filed</th><th>Exact TDS</th><th>Net Liability</th><th>Paid</th><th>Vendor Payment Target</th><th>Allocation Preview</th></tr>
              </thead>
              <tbody>
                {batchBills.map(r=>{
                  const preview=allocationPreview.find(x=>x.PayableID===r.PayableID);
                  return <tr key={r.PayableID}>
                    <td>
                      <input
                        type="checkbox"
                        checked={batchSelected.includes(r.PayableID)}
                        onChange={()=>toggleBatchBill(r.PayableID)}
                      />
                    </td>
                    <td><strong>{r.BillNo||"—"}</strong><div style={{fontSize:".7rem",color:"var(--muted)"}}>{r.Description||""}</div></td>
                    <td>{formatDate(r.BillDate)}</td>
                    <td>{fmt(r.GrossAmount)}</td>
                    <td>{fmt(r.TDSAmount)}</td>
                    <td><strong>{fmt(r.TDSDeductedAmount)}</strong></td>
                    <td>
                      {batchSelected.includes(r.PayableID)
                        ?<input style={{...input,minWidth:95}} type="number" min="0" step=".01" value={batchTDSByBill[r.PayableID]??String(num(r.TDSAmount))} onChange={e=>setBatchBillTDS(r.PayableID,e.target.value)}/>
                        :"—"}
                    </td>
                    <td>{preview?fmt(preview._adjustedNet):fmt(r.NetPayable)}</td>
                    <td>{fmt(r.PaidAmount)}</td>
                    <td>{preview?fmt(preview._vendorBalance):fmt(r.BalanceAmount)}</td>
                    <td>{preview&&preview._allocation>0?<strong>{fmt(preview._allocation)}</strong>:"—"}</td>
                  </tr>;
                })}
                {!batchBills.length&&<tr><td colSpan="11" style={{padding:"1.5rem",textAlign:"center"}}>No outstanding bills for this vendor.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>}

        <div style={{...card,marginTop:"1rem",fontSize:".76rem",lineHeight:1.5}}>
          <strong>Accounting treatment:</strong> Vendor payment and TDS are tracked separately. In Gross mode, the existing bank debit can settle the full invoice amount while TDS remains payable until it is marked paid/filed against a transaction. In Net-of-TDS mode, the vendor-payment target is reduced by TDS. The app never creates another bank debit.
        </div>

        <div style={{display:"flex",justifyContent:"flex-end",gap:".6rem",marginTop:"1rem"}}>
          <button type="button" style={btn("ghost")} onClick={()=>setBatchOpen(false)}>Cancel</button>
          <button
            type="button"
            style={btn()}
            disabled={batchSaving||!batchTransaction||!batchSelected.length||num(batchAmount)<=0}
            onClick={saveBatchSettlement}
          >
            {batchSaving?"Saving...":"Allocate Existing Bank Payment"}
          </button>
        </div>
      </div>
    </div>}

    {open&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:90,padding:"1rem",overflowY:"auto"}}>
      <div style={{...card,maxWidth:1100,margin:"0 auto"}}>
        <h3>{editId?"Edit Payable Bill":"New Payable Bill"}</h3>

        <form onSubmit={save}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".75rem"}}>
            <div>
              <label style={label}>Vendor *</label>
              <select style={input} required value={vendorChoice} onChange={e=>chooseVendor(e.target.value)}>
                <option value="">— Select vendor —</option>
                {vendors.map(v=><option key={v.VendorID} value={v.VendorID}>{v.VendorName} · {v.Category||"Other"}</option>)}
                <option value="__new__">+ Add new vendor</option>
              </select>
            </div>

            {vendorChoice==="__new__"&&<>
              <div>
                <label style={label}>New Vendor Name *</label>
                <input style={input} required value={form.VendorName} onChange={e=>set("VendorName",e.target.value)}/>
              </div>
              <div>
                <label style={label}>Category</label>
                <select style={input} value={form.VendorCategory} onChange={e=>set("VendorCategory",e.target.value)}>
                  {CATEGORIES.map(x=><option key={x}>{x}</option>)}
                </select>
              </div>
            </>}

            <div>
              <label style={label}>Bill No</label>
              <input style={input} value={form.BillNo} onChange={e=>set("BillNo",e.target.value)}/>
              {duplicate&&<small style={{color:"var(--danger)"}}>Duplicate vendor + bill number found</small>}
            </div>

            <div>
              <label style={label}>Bill Date *</label>
              <input style={input} type="date" required value={form.BillDate} onChange={e=>set("BillDate",e.target.value)}/>
            </div>

            <div>
              <label style={label}>Due Date</label>
              <input style={input} type="date" value={form.DueDate} onChange={e=>set("DueDate",e.target.value)}/>
            </div>

            <div style={{gridColumn:"1/-1",border:"1px solid var(--border)",borderRadius:"6px",padding:".8rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:".6rem"}}>
                <strong>Bill line items</strong>
                <button
                  type="button"
                  style={btn("ghost")}
                  onClick={()=>setForm(p=>({...p,LineItems:[...p.LineItems,emptyLine()]}))}
                >+ Add line</button>
              </div>

              {(form.LineItems||[]).map((x,i)=><div
                key={i}
                style={{display:"grid",gridTemplateColumns:"1.35fr 1.9fr .9fr .95fr .72fr .62fr .95fr auto",gap:".45rem",alignItems:"end",marginBottom:".5rem"}}
              >
                <div>
                  <label style={label}>Particulars</label>
                  <input style={input} value={x.Particulars||""} onChange={e=>updateLine(i,"Particulars",e.target.value)}/>
                </div>
                <div>
                  <label style={label}>Ledger / Account Head *</label>
                  <select
                    style={input}
                    required={num(x.TaxableAmount)>0}
                    value={x.LedgerID||""}
                    onChange={e=>updateLine(i,"LedgerID",e.target.value)}
                  >
                    <option value="">— Select ledger —</option>
                    {accountLedgers.map(l=><option key={l.LedgerID} value={l.LedgerID}>
                      {l.LedgerName} · {l.GroupName}
                    </option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Taxable</label>
                  <input style={input} type="number" step=".01" value={x.TaxableAmount||""} onChange={e=>updateLine(i,"TaxableAmount",e.target.value)}/>
                </div>
                <div>
                  <label style={label}>GST Type</label>
                  <select style={input} value={x.GSTType||"IGST"} onChange={e=>updateLine(i,"GSTType",e.target.value)}>
                    <option value="IGST">IGST</option>
                    <option value="CGST_SGST">CGST + SGST</option>
                    <option value="None">No GST</option>
                  </select>
                </div>
                <div>
                  <label style={label}>GST %</label>
                  <input style={input} type="number" step=".01" value={x.GSTRate||""} onChange={e=>updateLine(i,"GSTRate",e.target.value)}/>
                </div>
                <div>
                  <label style={label}>TDS?</label>
                  <label style={{...input,minHeight:36,display:"flex",alignItems:"center",justifyContent:"center",gap:".35rem",border:"1px solid var(--border)",borderRadius:"6px",cursor:"pointer"}}>
                    <input type="checkbox" checked={x.TDSApplicable===true} onChange={e=>setLineTDS(i,e.target.checked)}/>
                    <span style={{fontSize:".7rem"}}>{x.TDSApplicable===true?"Yes":"No"}</span>
                  </label>
                </div>
                <div>
                  <label style={label}>Line Total</label>
                  <input style={input} readOnly value={fmt(lineCalc(x).total)}/>
                </div>
                <button
                  type="button"
                  style={{...btn("ghost"),color:"var(--danger)"}}
                  onClick={()=>setForm(p=>({
                    ...p,
                    LineItems:p.LineItems.length>1?p.LineItems.filter((_,j)=>j!==i):[emptyLine()],
                    TDSAmount:""
                  }))}
                >Remove</button>
              </div>)}
            </div>

            <div style={{gridColumn:"1/-1",...card,padding:".7rem .85rem",fontSize:".74rem",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",flexWrap:"wrap"}}>
              <div>
                <strong>TDS Base: {fmt(a.tdsBase)}</strong>
                <span style={{color:"var(--muted)",marginLeft:".5rem"}}>
                  {a.lineTDSConfigured?"Calculated only on bill lines marked TDS = Yes.":"No line-specific TDS selection yet; TDS uses all taxable lines (legacy mode)."}
                </span>
              </div>
              {a.lineTDSConfigured&&<button type="button" style={btn("ghost")} onClick={resetLineTDS}>Use all taxable lines</button>}
            </div>

            <div>
              <label style={label}>TCS Amount</label>
              <input
                style={input}
                type="number"
                min="0"
                step=".01"
                value={form.TCSAmount}
                onChange={e=>set("TCSAmount",e.target.value)}
                placeholder="TCS charged by vendor"
              />
              <small style={{color:"var(--muted)"}}>
                Enter TCS separately exactly as shown on the vendor invoice.
              </small>
            </div>

            <div>
              <label style={label}>TDS Section</label>
              <select
                style={input}
                value={form.TDSSection}
                onChange={e=>{
                  const t=TDS_SECTIONS.find(x=>x.section===e.target.value);
                  setForm(p=>({...p,TDSSection:e.target.value,TDSRate:String(t?.rate||0),TDSAmount:""}));
                }}
              >
                {TDS_SECTIONS.map(x=><option key={x.section||"none"} value={x.section}>{x.label}</option>)}
              </select>
            </div>

            <div>
              <label style={label}>TDS Rate (%)</label>
              <input
                style={input}
                type="number"
                step=".01"
                value={form.TDSRate}
                onChange={e=>setForm(p=>({...p,TDSRate:e.target.value,TDSAmount:""}))}
              />
            </div>

            <div>
              <label style={label}>TDS Amount</label>
              <input style={input} type="number" min="0" step=".01" placeholder={String(a.autoTDS)} value={form.TDSAmount} onChange={e=>set("TDSAmount",e.target.value)}/>
              <small style={{color:"var(--muted)"}}>Auto {fmt(a.autoTDS)} on TDS base {fmt(a.tdsBase)} · editable for exact TDS.</small>
            </div>

            <div>
              <label style={label}>Round Off</label>
              <input style={input} type="number" step=".01" value={form.RoundOffAmount} onChange={e=>set("RoundOffAmount",e.target.value)}/>
              <small style={{color:"var(--muted)"}}>Use -0.30 to reduce ₹48,708.30 to ₹48,708.00</small>
            </div>

            <div style={{gridColumn:"1/-1",...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(115px,1fr))",gap:".5rem"}}>
              <div>Taxable<br/><strong>{fmt(a.taxable)}</strong></div>
              <div>GST Input<br/><strong>{fmt(a.gst)}</strong></div>
              <div>TCS<br/><strong>{fmt(a.tcs)}</strong></div>
              <div>Gross Bill<br/><strong>{fmt(a.gross)}</strong></div>
              <div>Round Off<br/><strong>{fmt(a.round)}</strong></div>
              <div>Invoice Total<br/><strong>{fmt(a.gross+a.round)}</strong></div>
              <div>TDS Base<br/><strong>{fmt(a.tdsBase)}</strong></div>
              <div>Less TDS<br/><strong>{fmt(a.tds)}</strong></div>
              <div>Net Payable<br/><strong style={{color:"var(--success)"}}>{fmt(a.net)}</strong></div>
            </div>

            <div style={{gridColumn:"1/-1",fontWeight:700}}>
              Payment Details{" "}
              <span style={{fontWeight:400,color:"var(--muted)",fontSize:".72rem"}}>
                — optional; leave Paid Amount blank for an unpaid bill
              </span>
              <div style={{fontWeight:400,color:"var(--warning)",fontSize:".72rem",marginTop:".25rem"}}>
                If this bill is part of a vendor batch payment already visible in Transactions,
                leave Paid Amount blank here and use <strong>Batch Settlement</strong>.
              </div>
            </div>

            <div>
              <label style={label}>Paid Amount</label>
              <input style={input} type="number" min="0" step=".01" value={form.PaidAmount} onChange={e=>set("PaidAmount",e.target.value)}/>
              <small style={{color:"var(--muted)"}}>Status: {a.status} · Balance {fmt(a.balance)}</small>
            </div>

            {a.paid>0&&<>
              <div>
                <label style={label}>Payment Date *</label>
                <input style={input} type="date" required value={form.PaymentDate} onChange={e=>set("PaymentDate",e.target.value)}/>
              </div>

              <div>
                <label style={label}>Paid By Type *</label>
                <select
                  style={input}
                  value={form.PaidByType}
                  onChange={e=>setForm(p=>({
                    ...p,
                    PaidByType:e.target.value,
                    PaidByName:e.target.value==="Company"?"Company":"",
                    ReimburseTo:"",
                    BankAccount:e.target.value==="Company"?p.BankAccount:""
                  }))}
                >
                  <option>Company</option><option>Partner</option><option>Staff</option><option>Other</option>
                </select>
              </div>

              <div>
                <label style={label}>Payment Mode *</label>
                <select style={input} value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>
                  {PAYMENT_MODES.map(x=><option key={x}>{x}</option>)}
                </select>
              </div>

              {!personal(form.PaidByType)&&norm(form.PaymentMode)!=="cash"&&<>
                <div>
                  <label style={label}>Zivara Bank Account *</label>
                  <select style={input} required value={form.BankAccount} onChange={e=>set("BankAccount",e.target.value)}>
                    <option value="">— Select bank —</option>
                    {banks.map(b=><option key={b.AccountID} value={b.AccountID}>
                      {b.AccountName} · {b.BankName} · ...{String(b.AccountNumber||"").slice(-4)}
                    </option>)}
                  </select>
                  {selectedBank&&<small style={{color:"var(--muted)"}}>
                    Current {fmt(selectedBank.CurrentBalance)} · After payment {fmt(num(selectedBank.CurrentBalance)-a.paid)}
                  </small>}
                </div>
                <div>
                  <label style={label}>Reference / UTR *</label>
                  <input style={input} required value={form.ReferenceNo} onChange={e=>set("ReferenceNo",e.target.value)}/>
                </div>
              </>}

              {personal(form.PaidByType)&&<>
                <div>
                  <label style={label}>Actual Paid By *</label>
                  <select
                    style={input}
                    required
                    value={form.PaidByName}
                    onChange={e=>setForm(p=>({...p,PaidByName:e.target.value,ReimburseTo:p.ReimburseTo||e.target.value}))}
                  >
                    <option value="">— Select person —</option>
                    {partnerNames.map(x=><option key={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Reimburse To *</label>
                  <select style={input} required value={form.ReimburseTo} onChange={e=>set("ReimburseTo",e.target.value)}>
                    <option value="">— Select person —</option>
                    {partnerNames.map(x=><option key={x}>{x}</option>)}
                  </select>
                </div>
              </>}
            </>}

            <div style={{gridColumn:"1/-1"}}>
              <label style={label}>Description</label>
              <input style={input} value={form.Description} onChange={e=>set("Description",e.target.value)}/>
            </div>

            <div style={{gridColumn:"1/-1"}}>
              <button type="button" style={btn("ghost")} onClick={()=>setShowMore(x=>!x)}>
                {showMore?"Hide":"Show"} More Details
              </button>
            </div>

            {showMore&&<>
              <div>
                <label style={label}>Challan No</label>
                <input style={input} value={form.ChallanNo} onChange={e=>set("ChallanNo",e.target.value)}/>
              </div>
              <div>
                <label style={label}>Challan Date</label>
                <input style={input} type="date" value={form.ChallanDate} onChange={e=>set("ChallanDate",e.target.value)}/>
              </div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={label}>Notes</label>
                <input style={input} value={form.Notes} onChange={e=>set("Notes",e.target.value)}/>
              </div>
            </>}

            <div style={{gridColumn:"1/-1"}}>
              <label style={label}>Upload Bill</label>
              <input
                style={input}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv"
                onChange={e=>setBillFile(e.target.files?.[0]||null)}
              />
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"flex-end",gap:".6rem",marginTop:"1rem"}}>
            <button type="button" style={btn("ghost")} onClick={()=>setOpen(false)}>Cancel</button>
            <button type="submit" style={btn()} disabled={saving||!!duplicate}>
              {saving?"Saving...":editId?"Update Bill":"Save Bill"}
            </button>
          </div>
        </form>
      </div>
    </div>}
  </div>;
}
