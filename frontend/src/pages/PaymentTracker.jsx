import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, uploadBill } from "../api/client";
import { formatDate } from "../utils/format";
import { useLLP } from "../context/LLPContext";

const CATEGORIES = ["Travel Agency","CA / Professional","Consultant","Contractor","Office Purchase","Software","Rent","Other"];
const PAYMENT_MODES = ["Bank","NEFT","RTGS","IMPS","UPI","Cheque","Cash"];
const TDS_SECTIONS = [
  { section:"", label:"No TDS / Not applicable", rate:0 },
  { section:"393(1)-6(i)-1", label:"393(1) Table 6(i) - Contractor, individual/HUF payee (old 194C) - 1%", rate:1 },
  { section:"393(1)-6(i)-2", label:"393(1) Table 6(i) - Contractor / travel operator, other payee (old 194C) - 2%", rate:2 },
  { section:"393(1)-6(iii)-10", label:"393(1) Table 6(iii) - Professional fees / CA / consultancy (old 194J) - 10%", rate:10 },
  { section:"393(1)-6(iii)-2", label:"393(1) Table 6(iii) - Technical fees / call centre / certain royalty (old 194J) - 2%", rate:2 },
  { section:"393(1)-2(ii)-10", label:"393(1) Table 2(ii) - Rent: land/building/furniture/fittings (old 194I) - 10%", rate:10 },
  { section:"393(1)-2(ii)-2", label:"393(1) Table 2(ii) - Rent: plant/machinery/equipment (old 194I) - 2%", rate:2 },
  { section:"393(1)-8(ii)", label:"393(1) Table 8(ii) - Purchase of goods over threshold (old 194Q) - 0.1%", rate:0.1 },
];

const emptyLine = () => ({
  Particulars:"", TaxableAmount:"", GSTType:"IGST", GSTRate:"18",
  CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", TCSAmount:"",
});

const initial = {
  VendorID:"", VendorName:"", VendorCategory:"Travel Agency", VendorGSTIN:"", VendorPAN:"",
  BillNo:"", BillDate:new Date().toISOString().slice(0,10), DueDate:"",
  ExpenseType:"Vendor Bill", Description:"",
  TaxableAmount:"", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", GSTAmount:"", TCSAmount:"", GrossAmount:"",
  LineItems:[emptyLine()],
  TDSSection:"393(1)-6(i)-2", TDSRate:"2", TDSAmount:"",
  PaidAmount:"", PaymentDate:"", PaymentMode:"Bank", BankAccount:"", ReferenceNo:"",
  PaidByType:"Company", PaidByName:"", ReimburseTo:"", ReimbursementStatus:"Not Required",
  ChallanNo:"", ChallanDate:"", InterestAmount:"",
  Status:"Pending", Notes:"",
};

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const input = { width:"100%", boxSizing:"border-box" };
const btn = (v="primary") => ({
  padding:".55rem 1rem", borderRadius:"6px",
  border:v==="ghost" ? "1px solid var(--border)" : "none",
  fontWeight:600, fontSize:".84rem", cursor:"pointer",
  background:v==="primary" ? "var(--accent)" : "transparent",
  color:v==="primary" ? "#fff" : "var(--muted)",
});

const num = value => {
  if (value == null || value === "") return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g,"");
  return cleaned && !isNaN(Number(cleaned)) ? Number(cleaned) : 0;
};

const fmt = n => "₹" + Number(n || 0).toLocaleString("en-IN", {
  minimumFractionDigits:2, maximumFractionDigits:2,
});

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g," ");
}

function reimbursementRequired(value) {
  return normalizeKey(value || "Company") !== "company";
}

function bankPaymentRequired(form) {
  return num(form.PaidAmount) > 0 &&
    !reimbursementRequired(form.PaidByType) &&
    normalizeKey(form.PaymentMode) !== "cash";
}

function calcLineItem(item={}) {
  const taxable = num(item.TaxableAmount);
  const rate = num(item.GSTRate);
  let cgst = num(item.CGSTAmount);
  let sgst = num(item.SGSTAmount);
  let igst = num(item.IGSTAmount);
  const tcs = num(item.TCSAmount);

  if (!cgst && !sgst && !igst && taxable && rate) {
    const gst = Math.round(taxable * rate) / 100;
    if (item.GSTType === "CGST_SGST") {
      cgst = Math.round(gst / 2 * 100) / 100;
      sgst = Math.round((gst - cgst) * 100) / 100;
    } else if (item.GSTType !== "None") {
      igst = gst;
    }
  }
  return { taxable,cgst,sgst,igst,tcs,total:taxable+cgst+sgst+igst+tcs };
}

function calc(form) {
  const lines = (form.LineItems || []).reduce((s,item) => {
    const x = calcLineItem(item);
    return {
      taxable:s.taxable+x.taxable, cgst:s.cgst+x.cgst, sgst:s.sgst+x.sgst,
      igst:s.igst+x.igst, tcs:s.tcs+x.tcs,
      has:s.has || x.taxable>0 || x.cgst>0 || x.sgst>0 || x.igst>0 || x.tcs>0,
    };
  },{taxable:0,cgst:0,sgst:0,igst:0,tcs:0,has:false});

  const taxable = lines.has ? lines.taxable : num(form.TaxableAmount);
  const cgst = lines.has ? lines.cgst : num(form.CGSTAmount);
  const sgst = lines.has ? lines.sgst : num(form.SGSTAmount);
  const igst = lines.has ? lines.igst : num(form.IGSTAmount);
  const gst = cgst + sgst + igst || num(form.GSTAmount);
  const tcs = lines.has ? lines.tcs : num(form.TCSAmount);
  const gross = num(form.GrossAmount) || taxable + gst + tcs;
  const tds = form.TDSAmount !== ""
    ? num(form.TDSAmount)
    : Math.round(taxable * num(form.TDSRate)) / 100;
  const net = Math.max(gross - tds,0);

  return { taxable,cgst,sgst,igst,gst,tcs,gross,tds,net };
}

function Badge({value}) {
  const color = {Pending:"var(--warning)","Part Paid":"var(--accent2)",Paid:"var(--success)",Cancelled:"var(--danger)"}[value] || "var(--muted)";
  return <span style={{background:color+"22",color,padding:".2rem .6rem",borderRadius:"99px",fontSize:".72rem",fontWeight:700}}>{value || "Pending"}</span>;
}

function BankBalance({account, amount}) {
  if (!account) return null;
  const current = num(account.CurrentBalance);
  const after = current - num(amount);
  return (
    <div style={{
      marginTop:".4rem", padding:".55rem .7rem", border:"1px solid var(--border)",
      borderRadius:"6px", fontSize:".72rem", lineHeight:1.5,
    }}>
      <div style={{color:"var(--muted)"}}>Current Bank Balance</div>
      <strong style={{color:current>=0 ? "var(--success)" : "var(--danger)"}}>{fmt(current)}</strong>
      {num(amount)>0 && <>
        <span style={{color:"var(--muted)"}}> · After payment </span>
        <strong style={{color:after>=0 ? "var(--success)" : "var(--danger)"}}>{fmt(after)}</strong>
      </>}
    </div>
  );
}

export default function PaymentTracker() {
  const { currentLLP } = useLLP();
  const [rows,setRows] = useState([]);
  const [vendors,setVendors] = useState([]);
  const [banks,setBanks] = useState([]);
  const [partners,setPartners] = useState([]);
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState("");
  const [open,setOpen] = useState(false);
  const [editId,setEditId] = useState(null);
  const [form,setForm] = useState(initial);
  const [vendorChoice,setVendorChoice] = useState("");
  const [billFile,setBillFile] = useState(null);
  const [vendorFilter,setVendorFilter] = useState("");
  const [statusFilter,setStatusFilter] = useState("");
  const [batchOpen,setBatchOpen] = useState(false);
  const [batch,setBatch] = useState({
    VendorID:"", PayableIDs:[], PaidAmount:"", PaymentDate:new Date().toISOString().slice(0,10),
    PaymentMode:"Bank", BankAccount:"", ReferenceNo:"", PaidByType:"Company",
    PaidByName:"", ReimburseTo:"", TDSMode:"net_after_tds",
  });

  async function load() {
    setLoading(true); setError("");
    try {
      const results = await Promise.allSettled([
        apiGet("getLLPPayables"),
        apiGet("getVendors"),
        apiGet("getBankAccounts"),
        apiGet("getPartners"),
      ]);
      const [p,v,b,pt] = results;
      if (p.status==="fulfilled" && p.value.ok) setRows(p.value.data || []);
      if (v.status==="fulfilled" && v.value.ok) setVendors((v.value.data || []).filter(x=>x.Status!=="Inactive"));
      if (b.status==="fulfilled" && b.value.ok) setBanks((b.value.data || []).filter(x=>x.IsActive!=="No"));
      if (pt.status==="fulfilled" && pt.value.ok) setPartners((pt.value.data || []).filter(x=>x.Status!=="Inactive"));
    } catch(err) {
      setError(err.message || "Unable to load Payment Tracker");
    } finally { setLoading(false); }
  }

  useEffect(()=>{ load(); },[currentLLP?.llpId,currentLLP?.LLPID]);

  const partnerNames = useMemo(
    ()=>[...new Set(partners.map(x=>String(x.PartnerName||"").trim()).filter(Boolean))].sort(),
    [partners]
  );

  const filtered = useMemo(
    ()=>rows.filter(r=>
      (!vendorFilter || r.VendorID===vendorFilter || normalizeKey(r.VendorName)===normalizeKey(vendors.find(v=>v.VendorID===vendorFilter)?.VendorName)) &&
      (!statusFilter || r.Status===statusFilter)
    ),
    [rows,vendorFilter,statusFilter,vendors]
  );

  const totals = useMemo(()=>filtered.reduce((s,r)=>({
    gross:s.gross+num(r.GrossAmount),
    tds:s.tds+num(r.TDSAmount),
    paid:s.paid+num(r.PaidAmount),
    balance:s.balance+num(r.BalanceAmount),
  }),{gross:0,tds:0,paid:0,balance:0}),[filtered]);

  const amounts = calc(form);
  const selectedBank = banks.find(b=>b.AccountID===form.BankAccount);
  const selectedBatchBank = banks.find(b=>b.AccountID===batch.BankAccount);

  function set(k,v) {
    setForm(p=>({...p,[k]:v}));
  }

  function openAdd() {
    setEditId(null); setVendorChoice(""); setBillFile(null); setForm({...initial,LineItems:[emptyLine()]}); setOpen(true);
  }

  function openEdit(row) {
    const vendor = vendors.find(v=>v.VendorID===row.VendorID) ||
      vendors.find(v=>normalizeKey(v.VendorName)===normalizeKey(row.VendorName));
    setVendorChoice(vendor?.VendorID || "__new__");
    setEditId(row.PayableID);
    setBillFile(null);
    setForm({
      ...initial,
      VendorID:vendor?.VendorID || row.VendorID || "",
      VendorName:row.VendorName || "",
      VendorCategory:row.VendorCategory || "Other",
      VendorGSTIN:row.VendorGSTIN || "",
      VendorPAN:row.VendorPAN || "",
      BillNo:row.BillNo || "",
      BillDate:String(row.BillDate || "").slice(0,10),
      DueDate:String(row.DueDate || "").slice(0,10),
      ExpenseType:row.ExpenseType || "Vendor Bill",
      Description:row.Description || "",
      TaxableAmount:row.TaxableAmount || "",
      CGSTAmount:row.CGSTAmount || "",
      SGSTAmount:row.SGSTAmount || "",
      IGSTAmount:row.IGSTAmount || "",
      GSTAmount:row.GSTAmount || "",
      TCSAmount:row.TCSAmount || "",
      GrossAmount:row.GrossAmount || "",
      LineItems:Array.isArray(row.LineItems) && row.LineItems.length ? row.LineItems : [emptyLine()],
      TDSSection:row.TDSSection || "",
      TDSRate:row.TDSRate || "",
      TDSAmount:row.TDSAmount || "",
      PaidAmount:row.PaidAmount || "",
      PaymentDate:String(row.PaymentDate || "").slice(0,10),
      PaymentMode:row.PaymentMode || "Bank",
      BankAccount:row.BankAccount || "",
      ReferenceNo:row.ReferenceNo || "",
      PaidByType:row.PaidByType || "Company",
      PaidByName:row.PaidByName || "",
      ReimburseTo:row.ReimburseTo || row.SettlementTo || "",
      ReimbursementStatus:row.ReimbursementStatus || "Not Required",
      ChallanNo:row.ChallanNo || "",
      ChallanDate:String(row.ChallanDate || "").slice(0,10),
      InterestAmount:row.InterestAmount || "",
      Status:row.Status || "Pending",
      Notes:row.Notes || "",
    });
    setOpen(true);
  }

  function chooseVendor(id) {
    setVendorChoice(id);
    if (id==="__new__") {
      setForm(p=>({...p,VendorID:"",VendorName:"",VendorCategory:"Other",VendorGSTIN:"",VendorPAN:""}));
      return;
    }
    const v=vendors.find(x=>x.VendorID===id);
    if (v) setForm(p=>({...p,VendorID:v.VendorID,VendorName:v.VendorName,VendorCategory:v.Category||"Other",VendorGSTIN:v.GSTIN||"",VendorPAN:v.PAN||""}));
  }

  function updateLine(index,key,value) {
    setForm(p=>{
      const LineItems=[...(p.LineItems||[])];
      LineItems[index]={...LineItems[index],[key]:value};
      return {...p,LineItems};
    });
  }

  function validatePayment(f) {
    if (num(f.PaidAmount)<=0) return;
    if (!f.PaymentDate) throw new Error("Payment Date is required when Paid Amount is entered");
    if (!f.PaymentMode) throw new Error("Payment Mode is required when Paid Amount is entered");
    if (!f.PaidByType) throw new Error("Paid By Type is required when Paid Amount is entered");

    if (reimbursementRequired(f.PaidByType)) {
      if (!String(f.PaidByName||"").trim()) throw new Error("Actual Paid By is required for Partner/Staff/Other payments");
      if (!String(f.ReimburseTo||f.PaidByName||"").trim()) throw new Error("Reimburse To is required for personal payments");
    } else if (normalizeKey(f.PaymentMode)!=="cash") {
      if (!f.BankAccount) throw new Error("Select the Zivara Bank Account used for payment");
      if (!String(f.ReferenceNo||"").trim()) throw new Error("Reference / UTR is required for bank payment");
    }
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setError("");
    try {
      validatePayment(form);
      let payload={...form};
      if (!form.VendorName) throw new Error("Vendor is required");

      if (!form.VendorID) {
        const existing=vendors.find(v=>normalizeKey(v.VendorName)===normalizeKey(form.VendorName));
        if (existing) {
          payload={...payload,VendorID:existing.VendorID,VendorName:existing.VendorName,VendorCategory:existing.Category||payload.VendorCategory,VendorGSTIN:existing.GSTIN||payload.VendorGSTIN,VendorPAN:existing.PAN||payload.VendorPAN};
        } else {
          const vr=await apiPost("saveVendor",{VendorName:form.VendorName,Category:form.VendorCategory,GSTIN:form.VendorGSTIN,PAN:form.VendorPAN,Status:"Active"});
          payload={...payload,VendorID:vr.data?.VendorID||""};
        }
      }

      const a=calc(form);
      const personal=reimbursementRequired(form.PaidByType);
      payload={
        ...payload,
        TaxableAmount:a.taxable,CGSTAmount:a.cgst,SGSTAmount:a.sgst,IGSTAmount:a.igst,GSTAmount:a.gst,TCSAmount:a.tcs,
        GrossAmount:a.gross,TDSAmount:a.tds,NetPayable:a.net,
        BankAccount:(!personal && normalizeKey(form.PaymentMode)!=="cash") ? form.BankAccount : "",
        PaidByName:personal ? form.PaidByName : (num(form.PaidAmount)>0 ? "Company" : ""),
        ReimburseTo:personal ? (form.ReimburseTo || form.PaidByName) : "",
        ReimbursementStatus:personal && num(form.PaidAmount)>0 ? "Pending" : "Not Required",
      };

      const r=await apiPost(editId ? "updateLLPPayable" : "saveLLPPayable", editId ? {...payload,PayableID:editId} : payload);
      const id=editId || r.data?.PayableID;
      if (billFile && id) await uploadBill(billFile,{payable_id:id,source_type:"payable",source_id:id});

      setOpen(false); setEditId(null); setForm(initial); setVendorChoice(""); await load();
    } catch(err) {
      setError(err.message || "Unable to save payable");
    } finally { setSaving(false); }
  }

  async function remove(row) {
    if (!confirm(`Delete payable ${row.BillNo || row.VendorName}?`)) return;
    try { await apiPost("deleteLLPPayable",{PayableID:row.PayableID}); await load(); }
    catch(err){ setError(err.message); }
  }

  const outstanding=rows.filter(r=>r.Status!=="Paid" && r.Status!=="Cancelled" && num(r.BalanceAmount||r.NetPayable)>0);
  const batchVendors=useMemo(()=>{
    const m=new Map();
    outstanding.forEach(r=>{
      const key=r.VendorID||normalizeKey(r.VendorName);
      const x=m.get(key)||{key,name:r.VendorName,count:0,total:0};
      x.count++; x.total+=num(r.BalanceAmount||r.NetPayable); m.set(key,x);
    });
    return [...m.values()].sort((a,b)=>a.name.localeCompare(b.name));
  },[rows]);

  const batchRows=outstanding.filter(r=>(r.VendorID||normalizeKey(r.VendorName))===batch.VendorID);
  const batchSelected=batchRows.filter(r=>batch.PayableIDs.includes(r.PayableID));
  const batchNet=batchSelected.reduce((s,r)=>s+num(r.BalanceAmount||r.NetPayable),0);

  function openBatch(){
    setBatch({
      VendorID:"",PayableIDs:[],PaidAmount:"",PaymentDate:new Date().toISOString().slice(0,10),
      PaymentMode:"Bank",BankAccount:"",ReferenceNo:"",PaidByType:"Company",PaidByName:"",ReimburseTo:"",TDSMode:"net_after_tds"
    });
    setBatchOpen(true);
  }

  function chooseBatchVendor(key){
    const list=outstanding.filter(r=>(r.VendorID||normalizeKey(r.VendorName))===key);
    setBatch(p=>({...p,VendorID:key,PayableIDs:list.map(r=>r.PayableID),PaidAmount:list.reduce((s,r)=>s+num(r.BalanceAmount||r.NetPayable),0).toFixed(2)}));
  }

  async function saveBatch(e){
    e.preventDefault();
    try{
      validatePayment(batch);
      if(!batch.PayableIDs.length) throw new Error("Select at least one payable");
      await apiPost("batchPayLLPPayables",{
        PayableIDs:batch.PayableIDs,PaidAmount:batch.PaidAmount,TDSMode:batch.TDSMode,
        PaymentDate:batch.PaymentDate,PaymentMode:batch.PaymentMode,
        BankAccount:reimbursementRequired(batch.PaidByType) ? "" : batch.BankAccount,
        ReferenceNo:batch.ReferenceNo,PaidByType:batch.PaidByType,
        PaidByName:reimbursementRequired(batch.PaidByType)?batch.PaidByName:"Company",
        ReimburseTo:reimbursementRequired(batch.PaidByType)?(batch.ReimburseTo||batch.PaidByName):"",
      });
      setBatchOpen(false); await load();
    }catch(err){setError(err.message);}
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.25rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"1rem"}}>
        <div>
          <h2 style={{fontWeight:700,fontSize:"1.25rem"}}>Payment Tracker</h2>
          <p style={{color:"var(--muted)",fontSize:".8rem"}}>Vendor bills, GST/TDS, payment status and accounting-linked bank payments</p>
        </div>
        <div style={{display:"flex",gap:".6rem"}}>
          <button style={btn("ghost")} disabled={!batchVendors.length} onClick={openBatch}>Batch Pay Vendor</button>
          <button style={btn()} onClick={openAdd}>+ Add Bill</button>
        </div>
      </div>

      {error && <div style={{...card,borderColor:"var(--danger)",color:"var(--danger)"}}>{error}</div>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:"1rem"}}>
        {[["Gross Bills",totals.gross],["TDS",totals.tds],["Paid",totals.paid],["Balance Due",totals.balance]].map(([name,val])=>
          <div key={name} style={card}><div style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700}}>{name.toUpperCase()}</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".25rem"}}>{fmt(val)}</div></div>
        )}
      </div>

      <div style={{...card,display:"flex",gap:".75rem",flexWrap:"wrap"}}>
        <select style={{maxWidth:260}} value={vendorFilter} onChange={e=>setVendorFilter(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map(v=><option key={v.VendorID} value={v.VendorID}>{v.VendorName}</option>)}
        </select>
        <select style={{maxWidth:180}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="">All statuses</option><option>Pending</option><option>Part Paid</option><option>Paid</option><option>Cancelled</option>
        </select>
        <span style={{marginLeft:"auto",color:"var(--muted)",fontSize:".8rem"}}>{filtered.length} bill(s)</span>
      </div>

      <div style={{...card,padding:0,overflow:"hidden"}}><div style={{overflowX:"auto"}}>
        {loading ? <p style={{padding:"2rem",textAlign:"center"}}>Loading...</p> :
        <table><thead><tr><th>Vendor</th><th>Category</th><th>Bill</th><th>Bill Date</th><th>Gross</th><th>TDS</th><th>Net Payable</th><th>Paid</th><th>Bank / Paid By</th><th>Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>{filtered.length ? filtered.map(r=><tr key={r.PayableID}>
          <td style={{fontWeight:700}}>{r.VendorName}</td><td>{r.VendorCategory||"—"}</td><td>{r.BillNo||"—"}</td><td>{formatDate(r.BillDate)}</td>
          <td>{fmt(r.GrossAmount)}</td><td>{fmt(r.TDSAmount)}</td><td style={{fontWeight:700}}>{fmt(r.NetPayable)}</td><td>{fmt(r.PaidAmount)}</td>
          <td>{r.PaidByType==="Company" ? (banks.find(b=>b.AccountID===r.BankAccount)?.AccountName || r.BankAccount || "Company") : `${r.PaidByName||"—"} (${r.PaidByType||"Other"})`}</td>
          <td style={{fontWeight:700}}>{fmt(r.BalanceAmount)}</td><td><Badge value={r.Status}/></td>
          <td style={{whiteSpace:"nowrap"}}><button style={btn("ghost")} onClick={()=>openEdit(r)}>Edit</button>{" "}<button style={{...btn("ghost"),color:"var(--danger)"}} onClick={()=>remove(r)}>Delete</button></td>
        </tr>) : <tr><td colSpan="12" style={{padding:"2rem",textAlign:"center"}}>No payable bills.</td></tr>}</tbody></table>}
      </div></div>

      {open && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:90,padding:"2rem 1rem",overflowY:"auto"}}>
        <div style={{...card,maxWidth:980,margin:"0 auto"}}>
          <h3>{editId?"Edit Payable Bill":"New Payable Bill"}</h3>
          <form onSubmit={save}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".85rem"}}>
              <div><label style={label}>Vendor *</label><select style={input} required value={vendorChoice} onChange={e=>chooseVendor(e.target.value)}><option value="">— Select vendor —</option>{vendors.map(v=><option key={v.VendorID} value={v.VendorID}>{v.VendorName} · {v.Category||"Other"}</option>)}<option value="__new__">+ Add new vendor</option></select></div>
              {vendorChoice==="__new__" && <><div><label style={label}>New Vendor Name *</label><input style={input} required value={form.VendorName} onChange={e=>set("VendorName",e.target.value)}/></div><div><label style={label}>Category</label><select style={input} value={form.VendorCategory} onChange={e=>set("VendorCategory",e.target.value)}>{CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></div></>}
              <div><label style={label}>Bill No</label><input style={input} value={form.BillNo} onChange={e=>set("BillNo",e.target.value)}/></div>
              <div><label style={label}>Bill Date *</label><input style={input} type="date" required value={form.BillDate} onChange={e=>set("BillDate",e.target.value)}/></div>
              <div><label style={label}>Due Date</label><input style={input} type="date" value={form.DueDate} onChange={e=>set("DueDate",e.target.value)}/></div>

              <div style={{gridColumn:"1/-1",border:"1px solid var(--border)",borderRadius:"6px",padding:".8rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".65rem"}}><strong>Tax / GST line items</strong><button type="button" style={btn("ghost")} onClick={()=>setForm(p=>({...p,LineItems:[...(p.LineItems||[]),emptyLine()]}))}>+ Add line</button></div>
                {(form.LineItems||[]).map((item,i)=><div key={i} style={{display:"grid",gridTemplateColumns:"2fr repeat(4,1fr) auto",gap:".55rem",alignItems:"end",marginBottom:".55rem"}}>
                  <div><label style={label}>Particulars</label><input style={input} value={item.Particulars||""} onChange={e=>updateLine(i,"Particulars",e.target.value)}/></div>
                  <div><label style={label}>Taxable</label><input style={input} value={item.TaxableAmount||""} onChange={e=>updateLine(i,"TaxableAmount",e.target.value)}/></div>
                  <div><label style={label}>GST Type</label><select style={input} value={item.GSTType||"IGST"} onChange={e=>updateLine(i,"GSTType",e.target.value)}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option><option value="None">No GST</option></select></div>
                  <div><label style={label}>GST %</label><input style={input} value={item.GSTRate||""} onChange={e=>updateLine(i,"GSTRate",e.target.value)}/></div>
                  <div><label style={label}>Line Total</label><input style={input} readOnly value={fmt(calcLineItem(item).total)}/></div>
                  <button type="button" style={{...btn("ghost"),color:"var(--danger)"}} onClick={()=>setForm(p=>({...p,LineItems:p.LineItems.filter((_,idx)=>idx!==i).length?p.LineItems.filter((_,idx)=>idx!==i):[emptyLine()]}))}>Remove</button>
                </div>)}
              </div>

              <div><label style={label}>Taxable Value</label><input style={input} value={form.TaxableAmount} onChange={e=>set("TaxableAmount",e.target.value)}/></div>
              <div><label style={label}>CGST</label><input style={input} value={form.CGSTAmount} onChange={e=>set("CGSTAmount",e.target.value)}/></div>
              <div><label style={label}>SGST</label><input style={input} value={form.SGSTAmount} onChange={e=>set("SGSTAmount",e.target.value)}/></div>
              <div><label style={label}>IGST</label><input style={input} value={form.IGSTAmount} onChange={e=>set("IGSTAmount",e.target.value)}/></div>
              <div><label style={label}>Gross Bill</label><input style={input} readOnly value={fmt(amounts.gross)}/></div>
              <div><label style={label}>TDS Section</label><select style={input} value={form.TDSSection} onChange={e=>{const x=TDS_SECTIONS.find(t=>t.section===e.target.value);setForm(p=>({...p,TDSSection:e.target.value,TDSRate:String(x?.rate??p.TDSRate),TDSAmount:""}))}}>{TDS_SECTIONS.map(x=><option key={x.section||"none"} value={x.section}>{x.label}</option>)}</select></div>
              <div><label style={label}>TDS Rate (%)</label><input style={input} type="number" step=".01" value={form.TDSRate} onChange={e=>set("TDSRate",e.target.value)}/></div>
              <div><label style={label}>TDS Amount</label><input style={input} type="number" step=".01" value={form.TDSAmount} placeholder={String(amounts.tds)} onChange={e=>set("TDSAmount",e.target.value)}/></div>

              <div style={{gridColumn:"1/-1",marginTop:".3rem",fontWeight:700}}>Payment Details <span style={{fontWeight:400,color:"var(--muted)",fontSize:".75rem"}}>— only required when Paid Amount &gt; 0</span></div>
              <div><label style={label}>Paid Amount</label><input style={input} type="number" min="0" step=".01" value={form.PaidAmount} onChange={e=>set("PaidAmount",e.target.value)}/></div>
              {num(form.PaidAmount)>0 && <>
                <div><label style={label}>Payment Date *</label><input style={input} type="date" required value={form.PaymentDate} onChange={e=>set("PaymentDate",e.target.value)}/></div>
                <div><label style={label}>Paid By Type *</label><select style={input} value={form.PaidByType} onChange={e=>setForm(p=>({...p,PaidByType:e.target.value,PaidByName:e.target.value==="Company"?"Company":"",ReimburseTo:"",BankAccount:e.target.value==="Company"?p.BankAccount:""}))}><option>Company</option><option>Partner</option><option>Staff</option><option>Other</option></select></div>
                <div><label style={label}>Payment Mode *</label><select style={input} value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>{PAYMENT_MODES.map(x=><option key={x}>{x}</option>)}</select></div>

                {!reimbursementRequired(form.PaidByType) && normalizeKey(form.PaymentMode)!=="cash" && <div>
                  <label style={label}>Zivara Bank Account *</label>
                  <select style={input} required value={form.BankAccount} onChange={e=>set("BankAccount",e.target.value)}>
                    <option value="">— Select bank account —</option>
                    {banks.map(b=><option key={b.AccountID} value={b.AccountID}>{b.AccountName} · {b.BankName} · ...{String(b.AccountNumber||"").slice(-4)}</option>)}
                  </select>
                  <BankBalance account={selectedBank} amount={form.PaidAmount}/>
                </div>}

                {!reimbursementRequired(form.PaidByType) && normalizeKey(form.PaymentMode)!=="cash" && <div><label style={label}>Reference / UTR *</label><input style={input} required value={form.ReferenceNo} onChange={e=>set("ReferenceNo",e.target.value)} placeholder="Bank UTR / cheque / reference"/></div>}

                {reimbursementRequired(form.PaidByType) && <>
                  <div><label style={label}>Actual Paid By *</label><select style={input} required value={form.PaidByName} onChange={e=>setForm(p=>({...p,PaidByName:e.target.value,ReimburseTo:p.ReimburseTo||e.target.value}))}><option value="">— Select / choose payer —</option>{partnerNames.map(x=><option key={x}>{x}</option>)}</select></div>
                  <div><label style={label}>Reimburse To *</label><select style={input} required value={form.ReimburseTo} onChange={e=>set("ReimburseTo",e.target.value)}><option value="">— Select person —</option>{partnerNames.map(x=><option key={x}>{x}</option>)}</select></div>
                  <div><label style={label}>Reimbursement Status</label><input style={input} readOnly value={form.ReimbursementStatus==="Reimbursed"?"Reimbursed":"Pending"}/></div>
                </>}
              </>}

              <div style={{gridColumn:"1/-1"}}><label style={label}>Description</label><input style={input} value={form.Description} onChange={e=>set("Description",e.target.value)}/></div>
              <div><label style={label}>Challan No</label><input style={input} value={form.ChallanNo} onChange={e=>set("ChallanNo",e.target.value)}/></div>
              <div><label style={label}>Challan Date</label><input style={input} type="date" value={form.ChallanDate} onChange={e=>set("ChallanDate",e.target.value)}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={label}>Upload Bill</label><input style={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv" onChange={e=>setBillFile(e.target.files?.[0]||null)}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={label}>Notes</label><input style={input} value={form.Notes} onChange={e=>set("Notes",e.target.value)}/></div>
            </div>

            <div style={{...card,marginTop:"1rem",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:".6rem"}}>
              <div>Taxable<br/><strong>{fmt(amounts.taxable)}</strong></div>
              <div>GST Input<br/><strong>{fmt(amounts.gst)}</strong></div>
              <div>Gross<br/><strong>{fmt(amounts.gross)}</strong></div>
              <div>Less TDS<br/><strong>{fmt(amounts.tds)}</strong></div>
              <div>Net Payable<br/><strong style={{color:"var(--success)"}}>{fmt(amounts.net)}</strong></div>
            </div>

            <div style={{display:"flex",justifyContent:"flex-end",gap:".75rem",marginTop:"1rem"}}><button type="button" style={btn("ghost")} onClick={()=>setOpen(false)}>Cancel</button><button type="submit" style={btn()} disabled={saving}>{saving?"Saving...":editId?"Update Bill":"Save Bill"}</button></div>
          </form>
        </div>
      </div>}

      {batchOpen && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:90,padding:"2rem 1rem",overflowY:"auto"}}>
        <div style={{...card,maxWidth:900,margin:"0 auto"}}>
          <h3>Batch Vendor Payment</h3>
          <form onSubmit={saveBatch}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".85rem"}}>
              <div><label style={label}>Vendor</label><select style={input} required value={batch.VendorID} onChange={e=>chooseBatchVendor(e.target.value)}><option value="">— Select vendor —</option>{batchVendors.map(v=><option key={v.key} value={v.key}>{v.name} · {v.count} bills · {fmt(v.total)}</option>)}</select></div>
              <div><label style={label}>Payment Date *</label><input style={input} type="date" required value={batch.PaymentDate} onChange={e=>setBatch(p=>({...p,PaymentDate:e.target.value}))}/></div>
              <div><label style={label}>Paid By Type *</label><select style={input} value={batch.PaidByType} onChange={e=>setBatch(p=>({...p,PaidByType:e.target.value,BankAccount:e.target.value==="Company"?p.BankAccount:"",PaidByName:"",ReimburseTo:""}))}><option>Company</option><option>Partner</option><option>Staff</option><option>Other</option></select></div>
              <div><label style={label}>Payment Mode *</label><select style={input} value={batch.PaymentMode} onChange={e=>setBatch(p=>({...p,PaymentMode:e.target.value}))}>{PAYMENT_MODES.map(x=><option key={x}>{x}</option>)}</select></div>
              {!reimbursementRequired(batch.PaidByType) && normalizeKey(batch.PaymentMode)!=="cash" && <div><label style={label}>Zivara Bank Account *</label><select style={input} required value={batch.BankAccount} onChange={e=>setBatch(p=>({...p,BankAccount:e.target.value}))}><option value="">— Select bank —</option>{banks.map(b=><option key={b.AccountID} value={b.AccountID}>{b.AccountName} · {b.BankName} · ...{String(b.AccountNumber||"").slice(-4)}</option>)}</select><BankBalance account={selectedBatchBank} amount={batch.PaidAmount}/></div>}
              {!reimbursementRequired(batch.PaidByType) && normalizeKey(batch.PaymentMode)!=="cash" && <div><label style={label}>Reference / UTR *</label><input style={input} required value={batch.ReferenceNo} onChange={e=>setBatch(p=>({...p,ReferenceNo:e.target.value}))}/></div>}
              {reimbursementRequired(batch.PaidByType) && <><div><label style={label}>Actual Paid By *</label><select style={input} required value={batch.PaidByName} onChange={e=>setBatch(p=>({...p,PaidByName:e.target.value,ReimburseTo:e.target.value}))}><option value="">— Select payer —</option>{partnerNames.map(x=><option key={x}>{x}</option>)}</select></div><div><label style={label}>Reimburse To *</label><select style={input} required value={batch.ReimburseTo} onChange={e=>setBatch(p=>({...p,ReimburseTo:e.target.value}))}><option value="">— Select person —</option>{partnerNames.map(x=><option key={x}>{x}</option>)}</select></div></>}
              <div><label style={label}>Paid Amount</label><input style={input} type="number" step=".01" min="0" value={batch.PaidAmount} onChange={e=>setBatch(p=>({...p,PaidAmount:e.target.value}))}/></div>
            </div>
            <div style={{marginTop:"1rem",border:"1px solid var(--border)",borderRadius:"6px",overflow:"hidden"}}><table><thead><tr><th></th><th>Bill</th><th>Date</th><th>Balance</th></tr></thead><tbody>{batchRows.map(r=><tr key={r.PayableID}><td><input type="checkbox" checked={batch.PayableIDs.includes(r.PayableID)} onChange={e=>setBatch(p=>({...p,PayableIDs:e.target.checked?[...p.PayableIDs,r.PayableID]:p.PayableIDs.filter(id=>id!==r.PayableID)}))}/></td><td>{r.BillNo}</td><td>{formatDate(r.BillDate)}</td><td>{fmt(r.BalanceAmount||r.NetPayable)}</td></tr>)}</tbody></table></div>
            <div style={{marginTop:".6rem",fontWeight:700}}>Selected balance: {fmt(batchNet)}</div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:".75rem",marginTop:"1rem"}}><button type="button" style={btn("ghost")} onClick={()=>setBatchOpen(false)}>Cancel</button><button type="submit" style={btn()}>Post Payment</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
