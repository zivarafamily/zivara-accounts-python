import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { billingMonthOptions, formatDate } from "../utils/format";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function billingMonthFromDate(value) {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

const today = () => new Date().toISOString().slice(0,10);

const initial = {
  Date:today(),
  ExpenseType:"Travel",
  Category:"",
  PaidBy:"",
  ChargeTo:"",
  PaymentMode:"Card",
  Amount:"",
  VendorOrPerson:"",
  Description:"",
  BillAvailable:"No",
  BillLink:"",
  TaxableValue:"",
  CGSTAmount:"",
  SGSTAmount:"",
  IGSTAmount:"",
  GSTAmount:"",
  EmployeeName:"",
  ReimburseTo:"",
  BillingMonth:billingMonthFromDate(today()),
  Notes:"",
  Status:"Approved",
};

const card = {
  background:"var(--card)",
  border:"1px solid var(--border)",
  borderRadius:"var(--radius)",
  padding:"1.25rem",
};

const label = {
  display:"block",
  fontSize:".75rem",
  color:"var(--muted)",
  marginBottom:".35rem",
  fontWeight:500,
};

const inp = { width:"100%", boxSizing:"border-box" };

const btn = (primary=true) => ({
  padding:".55rem 1rem",
  borderRadius:"6px",
  border:primary ? "none" : "1px solid var(--border)",
  fontWeight:600,
  fontSize:".84rem",
  cursor:"pointer",
  background:primary ? "var(--accent)" : "transparent",
  color:primary ? "#fff" : "var(--muted)",
});

const STATUS_COLOR = {
  Draft:"var(--muted)",
  Submitted:"var(--warning)",
  Approved:"var(--success)",
  Reimbursed:"var(--accent2)",
  Paid:"var(--accent2)",
  Recovered:"var(--warning)",
};

const fmt = n =>
  "₹" + Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits:2,
    maximumFractionDigits:2,
  });

function Badge({value}) {
  const color = STATUS_COLOR[value] || "var(--muted)";
  return (
    <span style={{
      fontSize:".7rem",
      padding:".2rem .6rem",
      borderRadius:"99px",
      fontWeight:600,
      background:color+"22",
      color,
      border:`1px solid ${color}`,
    }}>
      {value || "Draft"}
    </span>
  );
}

export default function Expenses() {
  const [expenses,setExpenses] = useState([]);
  const [vendors,setVendors] = useState([]);
  const [partners,setPartners] = useState([]);
  const [form,setForm] = useState(initial);
  const [formOpen,setFormOpen] = useState(false);
  const [editId,setEditId] = useState(null);
  const [loading,setLoading] = useState(false);
  const [formError,setFormError] = useState("");
  const [showGST,setShowGST] = useState(false);
  const [showMore,setShowMore] = useState(false);
  const [filterMonth,setFilterMonth] = useState("");
  const [filterPerson,setFilterPerson] = useState("");
  const [filterSeller,setFilterSeller] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [e,v,p] = await Promise.allSettled([
        apiGet("getExpenses"),
        apiGet("getVendors"),
        apiGet("getPartners"),
      ]);

      if (e.status==="fulfilled" && e.value.ok) setExpenses(e.value.data || []);
      if (v.status==="fulfilled" && v.value.ok) setVendors((v.value.data || []).filter(x=>x.Status!=="Inactive"));
      if (p.status==="fulfilled" && p.value.ok) setPartners((p.value.data || []).filter(x=>x.Status!=="Inactive"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ load(); },[]);

  const partnerNames = useMemo(
    ()=>[...new Set(partners.map(p=>String(p.PartnerName||"").trim()).filter(Boolean))].sort(),
    [partners]
  );

  const sellerOptions = useMemo(
    ()=>[...new Set([
      ...expenses.map(e=>String(e.VendorOrPerson||"").trim()).filter(Boolean),
      ...vendors.map(v=>String(v.VendorName||"").trim()).filter(Boolean),
    ])].sort(),
    [expenses,vendors]
  );

  const expenseMonths = useMemo(()=>{
    const values=[...new Set(expenses.map(e=>e.BillingMonth).filter(Boolean))];
    const order=billingMonthOptions(36,12);
    return values.sort((a,b)=>{
      const ai=order.indexOf(a), bi=order.indexOf(b);
      if(ai===-1 || bi===-1) return a.localeCompare(b);
      return ai-bi;
    });
  },[expenses]);

  const paidByOptions = useMemo(
    ()=>[...new Set(expenses.map(e=>String(e.PaidBy||"").trim()).filter(Boolean))].sort(),
    [expenses]
  );

  const filtered = useMemo(() => {
    return expenses
      .filter(e =>
        (!filterMonth || e.BillingMonth===filterMonth) &&
        (!filterPerson || e.PaidBy===filterPerson) &&
        (!filterSeller || e.VendorOrPerson===filterSeller)
      )
      .sort((a,b) => {
        const ad = String(a.Date || "");
        const bd = String(b.Date || "");
        if (ad !== bd) return bd.localeCompare(ad); // newest date first
        return String(b.CreatedAt || b.ExpenseID || "").localeCompare(
          String(a.CreatedAt || a.ExpenseID || "")
        );
      });
  }, [expenses,filterMonth,filterPerson,filterSeller]);

  const totals = useMemo(
    ()=>filtered.reduce((s,e)=>({
      amount:s.amount+Number(e.Amount||0),
      taxable:s.taxable+Number(e.TaxableValue||0),
      gst:s.gst+Number(e.GSTAmount||0),
    }),{amount:0,taxable:0,gst:0}),
    [filtered]
  );

  const gstTotal =
    Number(form.CGSTAmount||0) +
    Number(form.SGSTAmount||0) +
    Number(form.IGSTAmount||0);

  function set(k,v) {
    setForm(p=>({...p,[k]:v}));
  }

  function openAdd() {
    const d=today();
    setForm({...initial,Date:d,BillingMonth:billingMonthFromDate(d),Status:"Approved"});
    setEditId(null);
    setFormError("");
    setShowGST(false);
    setShowMore(false);
    setFormOpen(true);
  }

  function openEdit(e) {
    const cgst=e.CGSTAmount||"";
    const sgst=e.SGSTAmount||"";
    const igst=e.IGSTAmount||"";
    const hasGST=
      Number(cgst||0)>0 ||
      Number(sgst||0)>0 ||
      Number(igst||0)>0 ||
      Number(e.TaxableValue||0)>0;

    const hasMore=!!(e.ChargeTo || e.Notes || e.BillLink);

    setForm({
      Date:String(e.Date||"").slice(0,10),
      ExpenseType:e.ExpenseType||"Misc",
      Category:e.Category||"",
      PaidBy:e.PaidBy||"",
      ChargeTo:e.ChargeTo||"",
      PaymentMode:e.PaymentMode||"Cash",
      Amount:e.Amount||"",
      VendorOrPerson:e.VendorOrPerson||"",
      Description:e.Description||"",
      BillAvailable:e.BillAvailable||"No",
      BillLink:e.BillLink||"",
      TaxableValue:e.TaxableValue||"",
      CGSTAmount:cgst,
      SGSTAmount:sgst,
      IGSTAmount:igst,
      GSTAmount:e.GSTAmount||"",
      EmployeeName:e.EmployeeName||"",
      ReimburseTo:e.ReimburseTo||e.SettlementTo||e.PaidBy||"",
      BillingMonth:e.BillingMonth||billingMonthFromDate(String(e.Date||"").slice(0,10)),
      Notes:e.Notes||"",
      Status:e.Status||"Draft",
    });

    setEditId(e.ExpenseID);
    setFormError("");
    setShowGST(hasGST);
    setShowMore(hasMore);
    setFormOpen(true);
  }

  function updateDate(value) {
    setForm(p=>({
      ...p,
      Date:value,
      BillingMonth:billingMonthFromDate(value) || p.BillingMonth,
    }));
  }

  function updatePaidBy(value) {
    setForm(p=>({
      ...p,
      PaidBy:value,
      ReimburseTo:
        !p.ReimburseTo || p.ReimburseTo===p.PaidBy
          ? value
          : p.ReimburseTo,
      EmployeeName:
        !p.EmployeeName || p.EmployeeName===p.PaidBy
          ? value
          : p.EmployeeName,
    }));
  }

  function applyVendor(value) {
    const vendor=vendors.find(v=>String(v.VendorName||"").trim()===value);
    setForm(p=>({
      ...p,
      VendorOrPerson:value,
      Category:vendor?.Category && !p.Category ? vendor.Category : p.Category,
    }));
  }

  function setGstPart(key,value) {
    setForm(p=>{
      const next={...p,[key]:value};
      const total=
        Number(next.CGSTAmount||0)+
        Number(next.SGSTAmount||0)+
        Number(next.IGSTAmount||0);
      return {...next,GSTAmount:total ? total.toFixed(2) : ""};
    });
  }

  async function save(e) {
    e.preventDefault();
    setFormError("");

    try {
      const payload = {
        ...form,
        GSTAmount:gstTotal ? gstTotal.toFixed(2) : "",
        BillAvailable:form.BillAvailable || "No",
        EmployeeName:form.ReimburseTo || form.EmployeeName || form.PaidBy || "",
        ReimburseTo:form.ReimburseTo || form.PaidBy || "",
        BillingMonth:form.BillingMonth || billingMonthFromDate(form.Date),
        ...(editId ? {ExpenseID:editId} : {}),
      };

      const r=await apiPost(editId ? "updateExpense" : "saveExpense",payload);
      if (!r.ok) throw new Error(r.error || "Unable to save expense");

      setFormOpen(false);
      setEditId(null);
      await load();
    } catch(err) {
      setFormError(err.message || "Unable to save expense");
    }
  }

  async function removeExpense(e) {
    if (!confirm(`Delete expense ${e.Description || e.ExpenseID}?`)) return;
    try {
      await apiPost("deleteExpense",{ExpenseID:e.ExpenseID});
      await load();
    } catch(err) {
      alert(err.message || "Unable to delete expense");
    }
  }

  const accountingExpenseName = {
    Food:"Food Expenses",
    Hotel:"Hotel Expenses",
    Travel:"Travel Expenses",
    Office:"Office Expenses",
    Vendor:"Other Expenses",
    SalaryAdvance:"Staff Advances",
    Misc:"Other Expenses",
  }[form.ExpenseType] || `${form.ExpenseType} Expenses`;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1.25rem"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap"}}>
        <div>
          <h2 style={{fontWeight:700,fontSize:"1.25rem"}}>Expenses</h2>
          <p style={{color:"var(--muted)",fontSize:".8rem",marginTop:".2rem"}}>
            Fast entry for partner-paid business expenses and reimbursements
          </p>
        </div>
        <button style={btn()} onClick={openAdd}>+ Add Expense</button>
      </div>

      {formOpen && (
        <div style={card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
            <div>
              <h3 style={{fontWeight:700}}>{editId ? "Edit Expense" : "New Expense"}</h3>
              <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:".2rem"}}>
                Core fields first. GST and allocation details are optional.
              </div>
            </div>
            <button style={btn(false)} onClick={()=>setFormOpen(false)}>Close</button>
          </div>

          {formError && <div style={{marginBottom:"1rem",color:"var(--danger)"}}>{formError}</div>}

          <form onSubmit={save}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:"1rem"}}>
              <div>
                <label style={label}>Date *</label>
                <input style={inp} type="date" required value={form.Date} onChange={e=>updateDate(e.target.value)}/>
              </div>

              <div>
                <label style={label}>Expense Type *</label>
                <select style={inp} value={form.ExpenseType} onChange={e=>set("ExpenseType",e.target.value)}>
                  {["Travel","Hotel","Food","Office","Vendor","SalaryAdvance","Misc"].map(x=><option key={x}>{x}</option>)}
                </select>
              </div>

              <div>
                <label style={label}>Amount (₹) *</label>
                <input style={inp} type="number" min="0" step=".01" required value={form.Amount} onChange={e=>set("Amount",e.target.value)} placeholder="0.00"/>
              </div>

              <div>
                <label style={label}>Actual Paid By *</label>
                <select style={inp} required value={form.PaidBy} onChange={e=>updatePaidBy(e.target.value)}>
                  <option value="">— Select partner —</option>
                  {partnerNames.map(x=><option key={x}>{x}</option>)}
                </select>
              </div>

              <div>
                <label style={label}>Payment Mode *</label>
                <select style={inp} value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>
                  {["Card","Cash","UPI","Bank"].map(x=><option key={x}>{x}</option>)}
                </select>
              </div>

              <div>
                <label style={label}>Vendor / Person</label>
                <input
                  style={inp}
                  list="expense-vendor-options"
                  value={form.VendorOrPerson}
                  onChange={e=>applyVendor(e.target.value)}
                  placeholder="Select or type vendor"
                />
                <datalist id="expense-vendor-options">
                  {sellerOptions.map(x=><option key={x} value={x}/>)}
                </datalist>
              </div>

              <div>
                <label style={label}>Reimburse To</label>
                <select style={inp} value={form.ReimburseTo} onChange={e=>set("ReimburseTo",e.target.value)}>
                  <option value="">Same as actual payer</option>
                  {partnerNames.map(x=><option key={x}>{x}</option>)}
                </select>
                <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:".25rem"}}>
                  Defaults automatically to Actual Paid By.
                </div>
              </div>

              <div>
                <label style={label}>Status *</label>
                <select style={inp} value={form.Status} onChange={e=>set("Status",e.target.value)}>
                  {["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}
                </select>
              </div>

              <div style={{gridColumn:"1/-1"}}>
                <label style={label}>Description</label>
                <input style={inp} value={form.Description} onChange={e=>set("Description",e.target.value)} placeholder="Brief note / invoice reference / purpose"/>
              </div>
            </div>

            <div style={{display:"flex",gap:".6rem",marginTop:"1rem",flexWrap:"wrap"}}>
              <button type="button" style={btn(false)} onClick={()=>setShowGST(x=>!x)}>
                {showGST ? "Hide GST Details" : "+ GST Details"}
              </button>
              <button type="button" style={btn(false)} onClick={()=>setShowMore(x=>!x)}>
                {showMore ? "Hide More Details" : "+ More Details"}
              </button>
            </div>

            {showGST && (
              <div style={{...card,marginTop:"1rem"}}>
                <div style={{fontWeight:700,marginBottom:".8rem"}}>GST Details</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:".8rem"}}>
                  <div><label style={label}>Taxable Value (₹)</label><input style={inp} type="number" min="0" step=".01" value={form.TaxableValue} onChange={e=>set("TaxableValue",e.target.value)}/></div>
                  <div><label style={label}>CGST (₹)</label><input style={inp} type="number" min="0" step=".01" value={form.CGSTAmount} onChange={e=>setGstPart("CGSTAmount",e.target.value)}/></div>
                  <div><label style={label}>SGST (₹)</label><input style={inp} type="number" min="0" step=".01" value={form.SGSTAmount} onChange={e=>setGstPart("SGSTAmount",e.target.value)}/></div>
                  <div><label style={label}>IGST (₹)</label><input style={inp} type="number" min="0" step=".01" value={form.IGSTAmount} onChange={e=>setGstPart("IGSTAmount",e.target.value)}/></div>
                  <div><label style={label}>GST Total</label><input style={inp} readOnly value={fmt(gstTotal)}/></div>
                </div>
              </div>
            )}

            {showMore && (
              <div style={{...card,marginTop:"1rem"}}>
                <div style={{fontWeight:700,marginBottom:".8rem"}}>More Details</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".8rem"}}>
                  <div><label style={label}>Category</label><input style={inp} value={form.Category} onChange={e=>set("Category",e.target.value)} placeholder="Cab / Meals / Subscription"/></div>
                  <div><label style={label}>Charge To</label><input style={inp} value={form.ChargeTo} onChange={e=>set("ChargeTo",e.target.value)} placeholder="LLP / partner / client"/></div>
                  <div>
                    <label style={label}>Billing Month</label>
                    <select style={inp} value={form.BillingMonth} onChange={e=>set("BillingMonth",e.target.value)}>
                      {billingMonthOptions(36,12).map(x=><option key={x}>{x}</option>)}
                    </select>
                  </div>
                  <div><label style={label}>Notes</label><input style={inp} value={form.Notes} onChange={e=>set("Notes",e.target.value)}/></div>
                </div>
              </div>
            )}

            {form.PaidBy && Number(form.Amount||0)>0 && (
              <div style={{
                marginTop:"1rem",
                padding:".8rem 1rem",
                border:"1px solid var(--border)",
                borderRadius:"7px",
                fontSize:".78rem",
                color:"var(--muted)",
              }}>
                Accounting preview:{" "}
                <strong style={{color:"var(--text)"}}>Dr {accountingExpenseName} {fmt(form.Amount)}</strong>
                {" · "}
                <strong style={{color:"var(--text)"}}>Cr {form.ReimburseTo || form.PaidBy} {fmt(form.Amount)}</strong>
              </div>
            )}

            <div style={{display:"flex",gap:".75rem",marginTop:"1rem"}}>
              <button style={btn()} type="submit">{editId ? "Update Expense" : "Save Expense"}</button>
              <button style={btn(false)} type="button" onClick={()=>setFormOpen(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:"1rem"}}>
        <div style={card}><div style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700}}>FILTERED TOTAL</div><div style={{fontSize:"1.3rem",fontWeight:800,marginTop:".25rem"}}>{fmt(totals.amount)}</div></div>
        <div style={card}><div style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700}}>TAXABLE VALUE</div><div style={{fontSize:"1.3rem",fontWeight:800,marginTop:".25rem"}}>{fmt(totals.taxable)}</div></div>
        <div style={card}><div style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700}}>GST TOTAL</div><div style={{fontSize:"1.3rem",fontWeight:800,marginTop:".25rem"}}>{fmt(totals.gst)}</div></div>
        <div style={card}><div style={{fontSize:".7rem",color:"var(--muted)",fontWeight:700}}>ROWS</div><div style={{fontSize:"1.3rem",fontWeight:800,marginTop:".25rem"}}>{filtered.length}</div></div>
      </div>

      <div style={{...card,display:"flex",gap:".75rem",flexWrap:"wrap"}}>
        <select style={{maxWidth:180}} value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
          <option value="">All months</option>
          {expenseMonths.map(x=><option key={x}>{x}</option>)}
        </select>
        <select style={{maxWidth:220}} value={filterPerson} onChange={e=>setFilterPerson(e.target.value)}>
          <option value="">All paid by</option>
          {paidByOptions.map(x=><option key={x}>{x}</option>)}
        </select>
        <select style={{maxWidth:220}} value={filterSeller} onChange={e=>setFilterSeller(e.target.value)}>
          <option value="">All vendors/persons</option>
          {sellerOptions.map(x=><option key={x}>{x}</option>)}
        </select>
        {(filterMonth||filterPerson||filterSeller) && (
          <button style={btn(false)} onClick={()=>{setFilterMonth("");setFilterPerson("");setFilterSeller("");}}>Clear</button>
        )}
        <span style={{marginLeft:"auto",fontSize:".8rem",color:"var(--muted)"}}>
          {filtered.length} of {expenses.length} records · newest first
        </span>
      </div>

      <div style={{...card,padding:0,overflow:"hidden"}}>
        <div style={{padding:".9rem 1rem",fontWeight:700,borderBottom:"1px solid var(--border)"}}>
          All Expenses <span style={{fontWeight:400,color:"var(--muted)"}}>· {filtered.length} records</span>
        </div>
        <div style={{overflowX:"auto"}}>
          {loading ? (
            <p style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>Loading...</p>
          ) : filtered.length===0 ? (
            <p style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>No expenses found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Paid By</th>
                  <th>Reimburse To</th><th>Mode</th><th>Status</th><th>Description</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e=>(
                  <tr key={e.ExpenseID}>
                    <td>{formatDate(e.Date)}</td>
                    <td>{e.ExpenseType||"—"}</td>
                    <td>{e.Category||"—"}</td>
                    <td style={{fontWeight:700}}>{fmt(e.Amount)}</td>
                    <td>{e.PaidBy||"—"}</td>
                    <td>{e.ReimburseTo||e.SettlementTo||e.PaidBy||"—"}</td>
                    <td>{e.PaymentMode||"—"}</td>
                    <td><Badge value={e.Status}/></td>
                    <td>{e.Description||"—"}</td>
                    <td style={{whiteSpace:"nowrap"}}>
                      <button style={btn(false)} onClick={()=>openEdit(e)}>Edit</button>{" "}
                      <button style={{...btn(false),color:"var(--danger)"}} onClick={()=>removeExpense(e)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
