import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { billingMonthOptions, formatDate } from "../utils/format";

const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const today=()=>new Date().toISOString().slice(0,10);
const fyStart="2026-04-01";
const billingMonthFromDate=value=>{
  if(!value)return "";
  const d=new Date(`${value}T00:00:00`);
  if(Number.isNaN(d.getTime()))return "";
  return `${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};

const initial={
  Date:today(),ExpenseType:"Travel",Category:"",PaidByType:"Partner",PaidBy:"",
  ChargeTo:"",PaymentMode:"Card",Amount:"",VendorOrPerson:"",Description:"",
  BillAvailable:"No",BillLink:"",TaxableValue:"",CGSTAmount:"",SGSTAmount:"",
  IGSTAmount:"",GSTAmount:"",EmployeeName:"",ReimburseTo:"",
  BillingMonth:billingMonthFromDate(today()),Notes:"",Status:"Approved"
};

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem"};
const label={display:"block",fontSize:".73rem",color:"var(--muted)",marginBottom:".32rem",fontWeight:600};
const inp={width:"100%",boxSizing:"border-box"};
const btn=(primary=true)=>({
  padding:".55rem .9rem",borderRadius:"6px",
  border:primary?"none":"1px solid var(--border)",
  fontWeight:650,fontSize:".82rem",cursor:"pointer",
  background:primary?"var(--accent)":"transparent",
  color:primary?"#fff":"var(--muted)"
});
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const STATUS_COLOR={Draft:"var(--muted)",Submitted:"var(--warning)",Approved:"var(--success)",Reimbursed:"var(--accent2)",Paid:"var(--accent2)",Recovered:"var(--warning)"};

function Badge({value}){
  const color=STATUS_COLOR[value]||"var(--muted)";
  return <span style={{fontSize:".7rem",padding:".2rem .55rem",borderRadius:"99px",fontWeight:650,background:color+"22",color,border:`1px solid ${color}`}}>{value||"Draft"}</span>;
}

export default function Expenses(){
  const[expenses,setExpenses]=useState([]);
  const[vendors,setVendors]=useState([]);
  const[partners,setPartners]=useState([]);
  const[users,setUsers]=useState([]);
  const[form,setForm]=useState(initial);
  const[formOpen,setFormOpen]=useState(false);
  const[editId,setEditId]=useState(null);
  const[loading,setLoading]=useState(false);
  const[formError,setFormError]=useState("");
  const[showGST,setShowGST]=useState(false);
  const[showMore,setShowMore]=useState(false);

  const[fromDate,setFromDate]=useState(fyStart);
  const[toDate,setToDate]=useState("");
  const[filterPerson,setFilterPerson]=useState("");
  const[filterStatus,setFilterStatus]=useState("");
  const[search,setSearch]=useState("");

  async function load(){
    setLoading(true);
    try{
      const[e,v,p,u]=await Promise.allSettled([
        apiGet("getExpenses"),apiGet("getVendors"),apiGet("getPartners"),apiGet("getUsers")
      ]);
      if(e.status==="fulfilled"&&e.value.ok)setExpenses(e.value.data||[]);
      if(v.status==="fulfilled"&&v.value.ok)setVendors((v.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(p.status==="fulfilled"&&p.value.ok)setPartners((p.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(u.status==="fulfilled"&&u.value.ok)setUsers((u.value.data||[]).filter(x=>x.Status!=="Inactive"));
    }finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);

  const partnerNames=useMemo(
    ()=>[...new Set(partners.map(p=>String(p.PartnerName||"").trim()).filter(Boolean))].sort(),
    [partners]
  );

  const staffNames=useMemo(()=>[...new Set(
    users
      .filter(u=>!["partner","managing_partner"].includes(String(u.Role||"").toLowerCase()))
      .map(u=>String(u.Name||u.FullName||u.Username||"").trim())
      .filter(Boolean)
  )].sort(),[users]);

  const allPeople=useMemo(()=>[...new Set([
    ...partnerNames,...staffNames,
    ...expenses.map(e=>String(e.PaidBy||"").trim()).filter(Boolean)
  ])].sort(),[partnerNames,staffNames,expenses]);

  const paidByChoices=form.PaidByType==="Staff"?staffNames:partnerNames;

  const sellerOptions=useMemo(()=>[...new Set([
    ...expenses.map(e=>String(e.VendorOrPerson||"").trim()).filter(Boolean),
    ...vendors.map(v=>String(v.VendorName||"").trim()).filter(Boolean)
  ])].sort(),[expenses,vendors]);

  const filtered=useMemo(()=>expenses
    .filter(e=>{
      const d=String(e.Date||"").slice(0,10);
      const hay=[e.ExpenseType,e.Category,e.PaidBy,e.ReimburseTo,e.VendorOrPerson,e.Description,e.PaymentMode,e.Status].join(" ").toLowerCase();
      return(!fromDate||d>=fromDate)&&(!toDate||d<=toDate)&&
        (!filterPerson||e.PaidBy===filterPerson)&&
        (!filterStatus||e.Status===filterStatus)&&
        (!search||hay.includes(search.toLowerCase()));
    })
    .sort((a,b)=>{
      const ad=String(a.Date||""),bd=String(b.Date||"");
      if(ad!==bd)return bd.localeCompare(ad);
      return String(b.CreatedAt||b.ExpenseID||"").localeCompare(String(a.CreatedAt||a.ExpenseID||""));
    }),[expenses,fromDate,toDate,filterPerson,filterStatus,search]);

  const totals=useMemo(()=>filtered.reduce((s,e)=>({
    amount:s.amount+Number(e.Amount||0),
    taxable:s.taxable+Number(e.TaxableValue||0),
    gst:s.gst+Number(e.GSTAmount||0)
  }),{amount:0,taxable:0,gst:0}),[filtered]);

  const gstTotal=Number(form.CGSTAmount||0)+Number(form.SGSTAmount||0)+Number(form.IGSTAmount||0);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  function inferPayerType(name){
    return staffNames.includes(name)?"Staff":"Partner";
  }

  function openAdd(){
    const d=today();
    setForm({...initial,Date:d,BillingMonth:billingMonthFromDate(d),Status:"Approved"});
    setEditId(null);setFormError("");setShowGST(false);setShowMore(false);setFormOpen(true);
  }

  function openEdit(e){
    const cgst=e.CGSTAmount||"",sgst=e.SGSTAmount||"",igst=e.IGSTAmount||"";
    setForm({
      Date:String(e.Date||"").slice(0,10),
      ExpenseType:e.ExpenseType||"Misc",Category:e.Category||"",
      PaidByType:inferPayerType(e.PaidBy||""),PaidBy:e.PaidBy||"",
      ChargeTo:e.ChargeTo||"",PaymentMode:e.PaymentMode||"Cash",
      Amount:e.Amount||"",VendorOrPerson:e.VendorOrPerson||"",
      Description:e.Description||"",BillAvailable:e.BillAvailable||"No",
      BillLink:e.BillLink||"",TaxableValue:e.TaxableValue||"",
      CGSTAmount:cgst,SGSTAmount:sgst,IGSTAmount:igst,GSTAmount:e.GSTAmount||"",
      EmployeeName:e.EmployeeName||"",ReimburseTo:e.ReimburseTo||e.SettlementTo||e.PaidBy||"",
      BillingMonth:e.BillingMonth||billingMonthFromDate(String(e.Date||"").slice(0,10)),
      Notes:e.Notes||"",Status:e.Status||"Draft"
    });
    setEditId(e.ExpenseID);setFormError("");
    setShowGST(Number(cgst||0)>0||Number(sgst||0)>0||Number(igst||0)>0||Number(e.TaxableValue||0)>0);
    setShowMore(!!(e.ChargeTo||e.Notes||e.BillLink||e.Category));
    setFormOpen(true);
  }

  function changePayerType(type){
    setForm(p=>({...p,PaidByType:type,PaidBy:"",ReimburseTo:"",EmployeeName:""}));
  }
  function updatePaidBy(value){
    setForm(p=>({...p,PaidBy:value,ReimburseTo:value,EmployeeName:p.PaidByType==="Staff"?value:""}));
  }
  function updateDate(value){
    setForm(p=>({...p,Date:value,BillingMonth:billingMonthFromDate(value)||p.BillingMonth}));
  }
  function applyVendor(value){
    const vendor=vendors.find(v=>String(v.VendorName||"").trim()===value);
    setForm(p=>({...p,VendorOrPerson:value,Category:vendor?.Category&&!p.Category?vendor.Category:p.Category}));
  }
  function setGstPart(key,value){
    setForm(p=>{
      const next={...p,[key]:value};
      const total=Number(next.CGSTAmount||0)+Number(next.SGSTAmount||0)+Number(next.IGSTAmount||0);
      return {...next,GSTAmount:total?total.toFixed(2):""};
    });
  }

  async function save(e){
    e.preventDefault();setFormError("");
    if(!form.PaidBy){setFormError("Select who actually paid the expense.");return}
    try{
      const payload={
        ...form,
        GSTAmount:gstTotal?gstTotal.toFixed(2):"",
        BillAvailable:form.BillAvailable||"No",
        EmployeeName:form.PaidByType==="Staff"?form.PaidBy:(form.EmployeeName||""),
        ReimburseTo:form.ReimburseTo||form.PaidBy,
        BillingMonth:form.BillingMonth||billingMonthFromDate(form.Date),
        ...(editId?{ExpenseID:editId}:{})
      };
      delete payload.PaidByType;
      const r=await apiPost(editId?"updateExpense":"saveExpense",payload);
      if(!r.ok)throw new Error(r.error||"Unable to save expense");
      setFormOpen(false);setEditId(null);await load();
    }catch(err){setFormError(err.message||"Unable to save expense")}
  }

  async function removeExpense(e){
    if(!confirm(`Delete expense ${e.Description||e.ExpenseID}?`))return;
    try{await apiPost("deleteExpense",{ExpenseID:e.ExpenseID});await load()}
    catch(err){alert(err.message||"Unable to delete expense")}
  }

  const accountingExpenseName={
    Food:"Food Expenses",Hotel:"Hotel Expenses",Travel:"Travel Expenses",
    Office:"Office Expenses",Vendor:"Other Expenses",SalaryAdvance:"Staff Advances",Misc:"Other Expenses"
  }[form.ExpenseType]||`${form.ExpenseType} Expenses`;

  return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap"}}>
      <div>
        <h2 style={{fontWeight:750,fontSize:"1.25rem",margin:0}}>Partner / Staff Expenses</h2>
        <p style={{color:"var(--muted)",fontSize:".8rem",margin:".2rem 0 0"}}>Personal-paid business expenses and reimbursements</p>
      </div>
      <button style={btn()} onClick={openAdd}>+ Add Expense</button>
    </div>

    <div style={{...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".7rem",alignItems:"end"}}>
      <div><label style={label}>From</label><input style={inp} type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></div>
      <div><label style={label}>To</label><input style={inp} type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></div>
      <div><label style={label}>Paid By</label><select style={inp} value={filterPerson} onChange={e=>setFilterPerson(e.target.value)}><option value="">All people</option>{allPeople.map(x=><option key={x}>{x}</option>)}</select></div>
      <div><label style={label}>Status</label><select style={inp} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">All statuses</option>{["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}</select></div>
      <div style={{gridColumn:"span 2"}}><label style={label}>Search</label><input style={inp} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type, category, vendor, description..."/></div>
      <div><button style={btn(false)} onClick={()=>{setFromDate(fyStart);setToDate("");setFilterPerson("");setFilterStatus("");setSearch("")}}>Reset</button></div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:".75rem"}}>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>FILTERED TOTAL</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{fmt(totals.amount)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>GST TOTAL</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{fmt(totals.gst)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>RECORDS</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{filtered.length}</div></div>
    </div>

    <div style={{...card,padding:0,overflow:"hidden"}}>
      <div style={{padding:".85rem 1rem",fontWeight:700,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",gap:"1rem"}}>
        <span>All Expenses <span style={{fontWeight:400,color:"var(--muted)"}}>· {filtered.length} records</span></span>
        <span style={{fontSize:".72rem",fontWeight:400,color:"var(--muted)"}}>Newest date first</span>
      </div>
      <div style={{overflowX:"auto"}}>
        {loading?<p style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>Loading...</p>:
        filtered.length===0?<p style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>No expenses found.</p>:
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Paid By</th><th>Reimburse To</th><th>Mode</th><th>Status</th><th>Description</th><th></th></tr></thead>
          <tbody>{filtered.map(e=><tr key={e.ExpenseID}>
            <td>{formatDate(e.Date)}</td><td>{e.ExpenseType||"—"}</td><td>{e.Category||"—"}</td>
            <td style={{fontWeight:700}}>{fmt(e.Amount)}</td><td>{e.PaidBy||"—"}</td>
            <td>{e.ReimburseTo||e.SettlementTo||e.PaidBy||"—"}</td><td>{e.PaymentMode||"—"}</td>
            <td><Badge value={e.Status}/></td><td>{e.Description||"—"}</td>
            <td style={{whiteSpace:"nowrap"}}><button style={btn(false)} onClick={()=>openEdit(e)}>Edit</button>{" "}<button style={{...btn(false),color:"var(--danger)"}} onClick={()=>removeExpense(e)}>Delete</button></td>
          </tr>)}</tbody>
        </table>}
      </div>
    </div>

    {formOpen&&<div onMouseDown={e=>{if(e.target===e.currentTarget)setFormOpen(false)}} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.62)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{...card,width:"min(980px,96vw)",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginBottom:"1rem"}}>
          <div><h3 style={{margin:0,fontWeight:750}}>{editId?"Edit Expense":"Add Expense"}</h3><div style={{fontSize:".73rem",color:"var(--muted)",marginTop:".2rem"}}>Partner or staff-paid incidental business expense</div></div>
          <button style={btn(false)} onClick={()=>setFormOpen(false)}>Close</button>
        </div>
        {formError&&<div style={{marginBottom:"1rem",color:"var(--danger)"}}>{formError}</div>}

        <form onSubmit={save}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".85rem"}}>
            <div><label style={label}>Date *</label><input style={inp} type="date" required value={form.Date} onChange={e=>updateDate(e.target.value)}/></div>
            <div><label style={label}>Expense Type *</label><select style={inp} value={form.ExpenseType} onChange={e=>set("ExpenseType",e.target.value)}>{["Travel","Hotel","Food","Office","Vendor","SalaryAdvance","Misc"].map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label style={label}>Category</label><input style={inp} value={form.Category} onChange={e=>set("Category",e.target.value)} placeholder="Meals / Cab / Printing..."/></div>
            <div><label style={label}>Amount (₹) *</label><input style={inp} type="number" min="0" step=".01" required value={form.Amount} onChange={e=>set("Amount",e.target.value)}/></div>

            <div><label style={label}>Paid By Type *</label><select style={inp} value={form.PaidByType} onChange={e=>changePayerType(e.target.value)}><option>Partner</option><option>Staff</option></select></div>
            <div><label style={label}>{form.PaidByType==="Staff"?"Staff Name":"Partner Name"} *</label>
              <select style={inp} required value={form.PaidBy} onChange={e=>updatePaidBy(e.target.value)}>
                <option value="">— Select {form.PaidByType.toLowerCase()} —</option>
                {paidByChoices.map(x=><option key={x}>{x}</option>)}
                {form.PaidBy&&!paidByChoices.includes(form.PaidBy)&&<option>{form.PaidBy}</option>}
              </select>
            </div>
            <div><label style={label}>Reimburse To</label><select style={inp} value={form.ReimburseTo} onChange={e=>set("ReimburseTo",e.target.value)}><option value="">Same as payer</option>{allPeople.map(x=><option key={x}>{x}</option>)}{form.ReimburseTo&&!allPeople.includes(form.ReimburseTo)&&<option>{form.ReimburseTo}</option>}</select></div>
            <div><label style={label}>Payment Mode *</label><select style={inp} value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>{["Card","Cash","UPI","Bank"].map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label style={label}>Vendor / Person</label><input style={inp} list="expense-vendor-options" value={form.VendorOrPerson} onChange={e=>applyVendor(e.target.value)} placeholder="Select or type"/><datalist id="expense-vendor-options">{sellerOptions.map(x=><option key={x} value={x}/>)}</datalist></div>
            <div><label style={label}>Status *</label><select style={inp} value={form.Status} onChange={e=>set("Status",e.target.value)}>{["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}</select></div>
            <div style={{gridColumn:"1/-1"}}><label style={label}>Description</label><input style={inp} value={form.Description} onChange={e=>set("Description",e.target.value)} placeholder="Purpose / invoice reference / brief note"/></div>
          </div>

          <div style={{display:"flex",gap:".6rem",marginTop:"1rem",flexWrap:"wrap"}}>
            <button type="button" style={btn(false)} onClick={()=>setShowGST(x=>!x)}>{showGST?"Hide GST Details":"+ GST Details"}</button>
            <button type="button" style={btn(false)} onClick={()=>setShowMore(x=>!x)}>{showMore?"Hide More Details":"+ More Details"}</button>
          </div>

          {showGST&&<div style={{...card,marginTop:".85rem"}}>
            <div style={{fontWeight:700,marginBottom:".7rem"}}>GST Details</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".7rem"}}>
              <div><label style={label}>Taxable Value</label><input style={inp} type="number" min="0" step=".01" value={form.TaxableValue} onChange={e=>set("TaxableValue",e.target.value)}/></div>
              <div><label style={label}>CGST</label><input style={inp} type="number" min="0" step=".01" value={form.CGSTAmount} onChange={e=>setGstPart("CGSTAmount",e.target.value)}/></div>
              <div><label style={label}>SGST</label><input style={inp} type="number" min="0" step=".01" value={form.SGSTAmount} onChange={e=>setGstPart("SGSTAmount",e.target.value)}/></div>
              <div><label style={label}>IGST</label><input style={inp} type="number" min="0" step=".01" value={form.IGSTAmount} onChange={e=>setGstPart("IGSTAmount",e.target.value)}/></div>
              <div><label style={label}>GST Total</label><input style={inp} readOnly value={fmt(gstTotal)}/></div>
            </div>
          </div>}

          {showMore&&<div style={{...card,marginTop:".85rem"}}>
            <div style={{fontWeight:700,marginBottom:".7rem"}}>More Details</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".7rem"}}>
              <div><label style={label}>Charge To</label><input style={inp} value={form.ChargeTo} onChange={e=>set("ChargeTo",e.target.value)}/></div>
              <div><label style={label}>Billing Month</label><select style={inp} value={form.BillingMonth} onChange={e=>set("BillingMonth",e.target.value)}>{billingMonthOptions(36,12).map(x=><option key={x}>{x}</option>)}</select></div>
              <div><label style={label}>Bill Available</label><select style={inp} value={form.BillAvailable} onChange={e=>set("BillAvailable",e.target.value)}><option>No</option><option>Yes</option></select></div>
              <div><label style={label}>Bill Link</label><input style={inp} value={form.BillLink} onChange={e=>set("BillLink",e.target.value)}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={label}>Notes</label><input style={inp} value={form.Notes} onChange={e=>set("Notes",e.target.value)}/></div>
            </div>
          </div>}

          {form.PaidBy&&Number(form.Amount||0)>0&&<div style={{marginTop:".85rem",padding:".75rem .9rem",border:"1px solid var(--border)",borderRadius:"7px",fontSize:".76rem",color:"var(--muted)"}}>
            Accounting preview: <strong style={{color:"var(--text)"}}>Dr {accountingExpenseName} {fmt(form.Amount)}</strong>{" · "}
            <strong style={{color:"var(--text)"}}>Cr {form.ReimburseTo||form.PaidBy} {fmt(form.Amount)}</strong>
          </div>}

          <div style={{display:"flex",gap:".65rem",justifyContent:"flex-end",marginTop:"1rem"}}>
            <button type="button" style={btn(false)} onClick={()=>setFormOpen(false)}>Cancel</button>
            <button style={btn()} type="submit">{editId?"Update Expense":"Save Expense"}</button>
          </div>
        </form>
      </div>
    </div>}
  </div>;
}
