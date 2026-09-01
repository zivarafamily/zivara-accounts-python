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

const emptyLine=()=>({Particulars:"",LedgerID:"",LedgerName:"",TaxableAmount:"",GSTType:"IGST",GSTRate:"18",CGSTAmount:"",SGSTAmount:"",IGSTAmount:""});
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
  const s=(f.LineItems||[]).reduce((a,x)=>{
    const c=lineCalc(x);
    a.taxable+=c.taxable;a.cgst+=c.cgst;a.sgst+=c.sgst;a.igst+=c.igst;
    return a;
  },{taxable:0,cgst:0,sgst:0,igst:0});
  s.gst=s.cgst+s.sgst+s.igst;
  s.tcs=num(f.TCSAmount);
  s.gross=s.taxable+s.gst+s.tcs;
  s.tds=f.TDSAmount!==""?num(f.TDSAmount):Math.round(s.taxable*num(f.TDSRate))/100;
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

  const[batchOpen,setBatchOpen]=useState(false);
  const[batchVendor,setBatchVendor]=useState("");
  const[batchTransactionId,setBatchTransactionId]=useState("");
  const[batchSelected,setBatchSelected]=useState([]);
  const[batchAmount,setBatchAmount]=useState("");
  const[batchSaving,setBatchSaving]=useState(false);
  const[batchError,setBatchError]=useState("");

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

  const filtered=rows.filter(r=>
    !search||[r.VendorName,r.BillNo,r.Description].some(v=>norm(v).includes(norm(search)))
  );

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

  const batchTransaction=candidateBankTransactions.find(x=>x.EntryID===batchTransactionId);
  const selectedBatchBills=batchBills.filter(r=>batchSelected.includes(r.PayableID));
  const selectedBatchBalance=selectedBatchBills.reduce((sum,r)=>sum+num(r.BalanceAmount),0);

  const allocationPreview=useMemo(()=>{
    let remaining=num(batchAmount);
    return [...selectedBatchBills]
      .sort((x,y)=>{
        const bill=String(x.BillNo||"").localeCompare(String(y.BillNo||""));
        return bill||String(x.BillDate||"").localeCompare(String(y.BillDate||""));
      })
      .map(r=>{
        const balance=num(r.BalanceAmount);
        const applied=Math.min(balance,Math.max(remaining,0));
        remaining-=applied;
        return {...r,_allocation:applied};
      });
  },[selectedBatchBills,batchAmount]);

  function set(k,v){setForm(p=>({...p,[k]:v}));}

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
    setBatchError("");
    setBatchOpen(true);
  }

  function chooseBatchVendor(value){
    setBatchVendor(value);
    setBatchTransactionId("");
    setBatchSelected([]);
    setBatchAmount("");
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
    if(amount>tx._available+0.01){
      return setBatchError(`Amount cannot exceed unused bank debit of ${fmt(tx._available)}.`);
    }
    if(amount>selectedBatchBalance+0.01){
      return setBatchError(`Amount cannot exceed selected bill balance of ${fmt(selectedBatchBalance)}.`);
    }

    setBatchSaving(true);
    try{
      await apiPost("batchPayLLPPayables",{
        PayableIDs:batchSelected,
        PaidAmount:amount,
        PaymentDate:String(tx.Date||"").slice(0,10),
        PaymentMode:"Existing Bank Transaction",
        BankAccount:tx.BankAccountID||"",
        ReferenceNo:tx.ReferenceID||tx.EntryID,
        PaidByType:"Company",
        PaidByName:"Company"
      });
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
        <button style={btn("ghost")} onClick={openBatchSettlement}>Batch Settlement</button>
        <button style={btn()} onClick={add}>+ Add Bill</button>
      </div>
    </div>

    {error&&<div style={{...card,color:"var(--danger)"}}>{error}</div>}

    <div style={card}>
      <input
        style={input}
        placeholder="Search vendor, bill no or description"
        value={search}
        onChange={e=>setSearch(e.target.value)}
      />
    </div>

    <div style={{...card,padding:0,overflowX:"auto"}}>
      <table>
        <thead>
          <tr>
            <th>Vendor</th><th>Bill</th><th>Date</th><th>Gross</th><th>TCS</th><th>TDS</th>
            <th>Round Off</th><th>Net</th><th>Paid</th><th>Balance</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(r=><tr key={r.PayableID}>
            <td><strong>{r.VendorName}</strong></td>
            <td>{r.BillNo||"—"}</td>
            <td>{formatDate(r.BillDate)}</td>
            <td>{fmt(r.GrossAmount)}</td>
            <td>{fmt(r.TCSAmount)}</td>
            <td>{fmt(r.TDSAmount)}</td>
            <td>{fmt(r.RoundOffAmount||0)}</td>
            <td><strong>{fmt(r.NetPayable)}</strong></td>
            <td>{fmt(r.PaidAmount)}</td>
            <td>{fmt(r.BalanceAmount)}</td>
            <td><Badge value={r.Status}/></td>
            <td>
              <button style={btn("ghost")} onClick={()=>edit(r)}>Edit</button>{" "}
              <button style={{...btn("ghost"),color:"var(--danger)"}} onClick={()=>remove(r)}>Delete</button>
            </td>
          </tr>)}
          {!filtered.length&&<tr>
            <td colSpan="12" style={{padding:"2rem",textAlign:"center"}}>No bills</td>
          </tr>}
        </tbody>
      </table>
    </div>

    {batchOpen&&<div
      onMouseDown={e=>{if(e.target===e.currentTarget)setBatchOpen(false)}}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.68)",zIndex:95,padding:"1rem",overflowY:"auto"}}
    >
      <div style={{...card,maxWidth:1050,margin:"3vh auto 0"}}>
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
        </div>

        {batchVendor&&<div style={{marginTop:"1rem",border:"1px solid var(--border)",borderRadius:"7px",overflow:"hidden"}}>
          <div style={{padding:".7rem .8rem",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",borderBottom:"1px solid var(--border)",flexWrap:"wrap"}}>
            <strong>Outstanding bills · {batchBills.length}</strong>
            <div style={{display:"flex",gap:".5rem",alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontSize:".73rem",color:"var(--muted)"}}>Selected balance {fmt(selectedBatchBalance)}</span>
              <button type="button" style={btn("ghost")} onClick={selectAllBatchBills}>Select all</button>
              <button type="button" style={btn("ghost")} onClick={()=>setBatchSelected([])}>Clear</button>
            </div>
          </div>
          <div style={{overflowX:"auto",maxHeight:"46vh",overflowY:"auto"}}>
            <table>
              <thead>
                <tr><th></th><th>Bill</th><th>Date</th><th>Net</th><th>Paid</th><th>Balance</th><th>Allocation Preview</th></tr>
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
                    <td>{fmt(r.NetPayable)}</td>
                    <td>{fmt(r.PaidAmount)}</td>
                    <td>{fmt(r.BalanceAmount)}</td>
                    <td>{preview&&preview._allocation>0?<strong>{fmt(preview._allocation)}</strong>:"—"}</td>
                  </tr>;
                })}
                {!batchBills.length&&<tr><td colSpan="7" style={{padding:"1.5rem",textAlign:"center"}}>No outstanding bills for this vendor.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>}

        <div style={{...card,marginTop:"1rem",fontSize:".76rem",lineHeight:1.5}}>
          <strong>Accounting treatment:</strong> this only marks the selected Vendor Bills as paid/part-paid against the
          bank debit that already exists in Transactions. The existing transaction should be posted to the vendor ledger.
          The app will not create another bank debit for these bills.
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
                style={{display:"grid",gridTemplateColumns:"1.4fr 2fr 1fr 1fr .8fr 1fr auto",gap:".45rem",alignItems:"end",marginBottom:".5rem"}}
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
                  <label style={label}>Line Total</label>
                  <input style={input} readOnly value={fmt(lineCalc(x).total)}/>
                </div>
                <button
                  type="button"
                  style={{...btn("ghost"),color:"var(--danger)"}}
                  onClick={()=>setForm(p=>({
                    ...p,
                    LineItems:p.LineItems.length>1?p.LineItems.filter((_,j)=>j!==i):[emptyLine()]
                  }))}
                >Remove</button>
              </div>)}
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
              <input style={input} type="number" step=".01" value={form.TDSRate} onChange={e=>set("TDSRate",e.target.value)}/>
            </div>

            <div>
              <label style={label}>TDS Amount</label>
              <input style={input} type="number" step=".01" placeholder={String(a.tds)} value={form.TDSAmount} onChange={e=>set("TDSAmount",e.target.value)}/>
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
              <div>Less TDS<br/><strong>{fmt(a.tds)}</strong></div>
              <div>Round Off<br/><strong>{fmt(a.round)}</strong></div>
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
