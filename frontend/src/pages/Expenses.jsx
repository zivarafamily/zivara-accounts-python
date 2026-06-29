import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { billingMonthOptions, formatDate } from "../utils/format";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const currentBillingMonth = () => {
  const d = new Date();
  return `${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};

const initial = {
  Date:"", ExpenseType:"Travel", Category:"", PaidBy:"",
  PaymentMode:"Cash", Amount:"", VendorOrPerson:"", Description:"",
  BillAvailable:"No", BillLink:"",
  TaxableValue:"", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", GSTAmount:"",
  EmployeeName:"", ReimburseTo:"", BillingMonth:currentBillingMonth(), Notes:"", Status:"Draft"
};

const card  = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn   = (variant="primary") => ({
  padding:".55rem 1.2rem", borderRadius:"6px", border:"none",
  fontWeight:600, fontSize:".875rem",
  background: variant==="primary" ? "var(--accent)" : "transparent",
  color: variant==="primary" ? "#fff" : "var(--muted)",
  cursor:"pointer",
});

const STATUS_COLOR = { Draft:"var(--muted)", Approved:"var(--success)", Paid:"var(--accent2)", Recovered:"var(--warning)" };

function Badge({ v }) {
  return (
    <span style={{
      fontSize:".7rem", padding:".2rem .6rem", borderRadius:"99px", fontWeight:600,
      background: STATUS_COLOR[v] ? STATUS_COLOR[v]+"22" : "var(--border)",
      color: STATUS_COLOR[v] || "var(--text)",
      border: `1px solid ${STATUS_COLOR[v] || "var(--border)"}`,
    }}>{v}</span>
  );
}

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [vendors,  setVendors]  = useState([]);
  const [partners, setPartners] = useState([]);
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formError, setFormError] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterPerson, setFilterPerson] = useState("");
  const [filterSeller, setFilterSeller] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [expRes, vndRes, partnerRes] = await Promise.allSettled([
        apiGet("getExpenses"),
        apiGet("getVendors"),
        apiGet("getPartners"),
      ]);
      if (expRes.status === "fulfilled" && expRes.value.ok) setExpenses(expRes.value.data || []);
      if (vndRes.status === "fulfilled" && vndRes.value.ok) setVendors((vndRes.value.data || []).filter(v => v.Status !== "Inactive"));
      if (partnerRes.status === "fulfilled" && partnerRes.value.ok) {
        setPartners((partnerRes.value.data || []).filter(p => p.Status !== "Inactive"));
      }
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const gstTotal = Number(form.CGSTAmount || 0) + Number(form.SGSTAmount || 0) + Number(form.IGSTAmount || 0);

  function setGstPart(key, value) {
    setForm(p => {
      const next = { ...p, [key]: value };
      const total = Number(next.CGSTAmount || 0) + Number(next.SGSTAmount || 0) + Number(next.IGSTAmount || 0);
      return { ...next, GSTAmount: total ? total.toFixed(2) : "" };
    });
  }

  function openAdd() { setForm({ ...initial, BillingMonth:currentBillingMonth() }); setEditId(null); setFormError(""); setFormOpen(true); }
  function openEdit(e) {
    const cgst = e.CGSTAmount || "";
    const sgst = e.SGSTAmount || "";
    const igst = e.IGSTAmount || "";
    const gst = Number(cgst || 0) + Number(sgst || 0) + Number(igst || 0);
    setForm({
      Date: e.Date?.toString().slice(0,10) || "",
      ExpenseType: e.ExpenseType || "Misc",
      Category: e.Category || "",
      PaidBy: e.PaidBy || "",
      PaymentMode: e.PaymentMode || "Cash",
      Amount: e.Amount || "",
      VendorOrPerson: e.VendorOrPerson || "",
      Description: e.Description || "",
      BillAvailable: e.BillAvailable || "No",
      BillLink: e.BillLink || "",
      TaxableValue: e.TaxableValue || "",
      CGSTAmount: cgst,
      SGSTAmount: sgst,
      IGSTAmount: igst,
      GSTAmount: gst ? gst.toFixed(2) : e.GSTAmount || "",
      EmployeeName: e.EmployeeName || "",
      ReimburseTo: e.ReimburseTo || e.EmployeeName || "",
      BillingMonth: e.BillingMonth || currentBillingMonth(),
      Notes: e.Notes || "",
      Status: e.Status || "Draft",
    });
    setEditId(e.ExpenseID);
    setFormError("");
    setFormOpen(true);
  }

  const partnerNames = Array.from(new Set(partners.map(p => String(p.PartnerName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const expenseMonths = Array.from(new Set(expenses.map(e => e.BillingMonth).filter(Boolean))).sort((a, b) => {
    const order = billingMonthOptions(36, 12);
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 || bi === -1) return a.localeCompare(b);
    return ai - bi;
  });
  const paidByOptions = Array.from(new Set(expenses.map(e => String(e.PaidBy || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const sellerOptions = Array.from(new Set(expenses.map(e => String(e.VendorOrPerson || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filteredExpenses = expenses.filter(e =>
    (!filterMonth || e.BillingMonth === filterMonth) &&
    (!filterPerson || e.PaidBy === filterPerson) &&
    (!filterSeller || e.VendorOrPerson === filterSeller)
  );
  const totals = filteredExpenses.reduce((acc, e) => ({
    amount: acc.amount + Number(e.Amount || 0),
    taxable: acc.taxable + Number(e.TaxableValue || 0),
    gst: acc.gst + Number(e.GSTAmount || 0),
  }), { amount:0, taxable:0, gst:0 });
  const fmt = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  async function save(e) {
    e.preventDefault();
    const action  = editId ? "updateExpense" : "saveExpense";
    const payload = {
      ...form,
      GSTAmount: gstTotal ? gstTotal.toFixed(2) : "",
      BillAvailable: "No",
      BillLink: "",
      EmployeeName: form.ReimburseTo || form.EmployeeName || "",
      ReimburseTo: form.ReimburseTo || "",
      ...(editId ? { ExpenseID: editId } : {}),
    };
    setFormError("");
    try {
      const r = await apiPost(action, payload);
      if (r.ok) {
        setForm({ ...initial, BillingMonth:currentBillingMonth() }); setEditId(null); setFormOpen(false); load();
      }
      else alert(r.error || "Error saving");
    } catch (err) {
      setFormError(err.message || "Unable to save expense");
    }
  }

  async function removeExpense(e) {
    if (!window.confirm(`Delete expense ${e.Description || e.ExpenseID}?`)) return;
    try {
      const r = await apiPost("deleteExpense", { ExpenseID:e.ExpenseID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete expense");
    }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Expenses</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>
            Track and manage all business expenses
          </p>
        </div>
        <button style={btn()} onClick={openAdd}>
          + Add Expense
        </button>
      </div>

      {/* Form */}
      {formOpen && (
        <div style={card}>
          <h3 style={{ fontWeight:600, marginBottom:"1rem", color:"var(--text)" }}>{editId ? "Edit Expense" : "New Expense"}</h3>
          <form onSubmit={save}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:"1rem" }}>
              <div><label style={label}>Date</label><input type="date" value={form.Date} onChange={e=>set("Date",e.target.value)} required /></div>
              <div><label style={label}>Expense Type</label>
                <select value={form.ExpenseType} onChange={e=>set("ExpenseType",e.target.value)}>
                  {["Travel","Hotel","Food","Office","Vendor","SalaryAdvance","Misc"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Category</label><input placeholder="e.g. Cab" value={form.Category} onChange={e=>set("Category",e.target.value)} /></div>
              <div><label style={label}>Paid By</label>
                <select value={form.PaidBy} onChange={e=>set("PaidBy",e.target.value)} required>
                  <option value="">Select partner</option>
                  {partnerNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div><label style={label}>Payment Mode</label>
                <select value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>
                  {["Cash","Bank","UPI","Card"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Amount (₹)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={form.Amount} onChange={e=>set("Amount",e.target.value)} required /></div>
              {vendors.length > 0 && (
                <div>
                  <label style={label}>Pick Vendor</label>
                  <select style={{ width:"100%", padding:".5rem .65rem", background:"var(--input,#1e293b)", border:"1px solid var(--border)", borderRadius:"6px", color:"var(--text)", fontSize:".875rem" }}
                    value=""
                    onChange={e => {
                      const v = vendors.find(x => x.VendorID === e.target.value);
                      if (!v) return;
                      set("VendorOrPerson", v.VendorName);
                      if (v.Category && !form.Category) set("Category", v.Category);
                      if (v.GSTIN) set("Notes", form.Notes ? form.Notes : "GSTIN: " + v.GSTIN);
                    }}>
                    <option value="">— Select from list —</option>
                    {vendors.map(v => <option key={v.VendorID} value={v.VendorID}>{v.VendorName}{v.Category ? " · " + v.Category : ""}</option>)}
                  </select>
                </div>
              )}
              <div><label style={label}>Vendor / Person</label><input placeholder="Vendor name or type manually" value={form.VendorOrPerson} onChange={e=>set("VendorOrPerson",e.target.value)} /></div>
              <div><label style={label}>Description</label><input placeholder="Brief note" value={form.Description} onChange={e=>set("Description",e.target.value)} /></div>
              <div><label style={label}>Taxable Value (₹)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={form.TaxableValue} onChange={e=>set("TaxableValue",e.target.value)} /></div>
              <div><label style={label}>CGST (₹)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={form.CGSTAmount} onChange={e=>setGstPart("CGSTAmount",e.target.value)} /></div>
              <div><label style={label}>SGST (₹)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={form.SGSTAmount} onChange={e=>setGstPart("SGSTAmount",e.target.value)} /></div>
              <div><label style={label}>IGST (₹)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={form.IGSTAmount} onChange={e=>setGstPart("IGSTAmount",e.target.value)} /></div>
              <div><label style={label}>GST Total (₹)</label><input type="number" min="0" step="0.01" placeholder="auto" value={gstTotal ? gstTotal.toFixed(2) : ""} readOnly /></div>
              <div><label style={label}>Reimburse To</label>
                <select value={form.ReimburseTo} onChange={e=>set("ReimburseTo",e.target.value)}>
                  <option value="">Same / not applicable</option>
                  {partnerNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div><label style={label}>Billing Month</label>
                <select value={form.BillingMonth} onChange={e=>set("BillingMonth",e.target.value)}>
                  {billingMonthOptions().map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div><label style={label}>Notes</label><input placeholder="Notes" value={form.Notes} onChange={e=>set("Notes",e.target.value)} /></div>
              <div><label style={label}>Status</label>
                <select value={form.Status} onChange={e=>set("Status",e.target.value)}>
                  {["Draft","Approved","Paid","Recovered"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:"flex", gap:".75rem", marginTop:"1.25rem" }}>
              <button type="submit" style={btn()}>{editId ? "Update Expense" : "Save Expense"}</button>
              <button type="button" style={btn("ghost")} onClick={()=>setFormOpen(false)}>Cancel</button>
            </div>
            {formError && <div style={{ color:"var(--danger)", fontSize:".8rem", marginTop:".75rem" }}>{formError}</div>}
          </form>
        </div>
      )}

      <div style={{ ...card, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:"1rem" }}>
        <div>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:700 }}>FILTERED TOTAL</div>
          <div style={{ fontSize:"1.35rem", fontWeight:800, color:"var(--accent2)", marginTop:".25rem" }}>{fmt(totals.amount)}</div>
        </div>
        <div>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:700 }}>TAXABLE VALUE</div>
          <div style={{ fontSize:"1.35rem", fontWeight:800, color:"var(--accent)", marginTop:".25rem" }}>{fmt(totals.taxable)}</div>
        </div>
        <div>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:700 }}>GST TOTAL</div>
          <div style={{ fontSize:"1.35rem", fontWeight:800, color:"var(--warning)", marginTop:".25rem" }}>{fmt(totals.gst)}</div>
        </div>
        <div>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:700 }}>ROWS</div>
          <div style={{ fontSize:"1.35rem", fontWeight:800, color:"var(--text)", marginTop:".25rem" }}>{filteredExpenses.length}</div>
        </div>
      </div>

      <div style={{ ...card, display:"flex", gap:".75rem", alignItems:"center", flexWrap:"wrap" }}>
        <select style={{ maxWidth:190 }} value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
          <option value="">All months</option>
          {expenseMonths.map(m => <option key={m}>{m}</option>)}
        </select>
        <select style={{ maxWidth:220 }} value={filterPerson} onChange={e=>setFilterPerson(e.target.value)}>
          <option value="">All paid by</option>
          {paidByOptions.map(name => <option key={name}>{name}</option>)}
        </select>
        <select style={{ maxWidth:260 }} value={filterSeller} onChange={e=>setFilterSeller(e.target.value)}>
          <option value="">All vendors / sellers</option>
          {sellerOptions.map(name => <option key={name}>{name}</option>)}
        </select>
        {(filterMonth || filterPerson || filterSeller) && (
          <button style={btn("ghost")} onClick={()=>{ setFilterMonth(""); setFilterPerson(""); setFilterSeller(""); }}>Clear</button>
        )}
        <span style={{ marginLeft:"auto", fontSize:".8rem", color:"var(--muted)" }}>{filteredExpenses.length} of {expenses.length} record{expenses.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Table */}
      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:600, fontSize:".875rem" }}>All Expenses</span>
          <span style={{ fontSize:".75rem", color:"var(--muted)" }}>{filteredExpenses.length} record{filteredExpenses.length!==1?"s":""}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Category</th>
                  <th>Amount</th><th>Paid By</th><th>Mode</th>
                  <th>Status</th><th>Description</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length===0 ? (
                  <tr><td colSpan="9" style={{ textAlign:"center", color:"var(--muted)", padding:"2.5rem" }}>No expenses yet</td></tr>
                ) : (
                  filteredExpenses.map(e => (
                    <tr key={e.ExpenseID}>
                      <td style={{ whiteSpace:"nowrap" }}>{formatDate(e.Date)}</td>
                      <td>{e.ExpenseType}</td>
                      <td style={{ color:"var(--muted)" }}>{e.Category}</td>
                      <td style={{ fontWeight:600, color:"var(--accent2)" }}>₹{Number(e.Amount||0).toLocaleString("en-IN")}</td>
                      <td>{e.PaidBy}</td><td>{e.PaymentMode}</td>
                      <td><Badge v={e.Status}/></td>
                      <td style={{ color:"var(--muted)", maxWidth:"200px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.Description}</td>
                      <td style={{ whiteSpace:"nowrap" }}>
                        <button style={{ ...btn("ghost"), padding:".2rem .55rem", fontSize:".78rem" }} onClick={()=>openEdit(e)}>Edit</button>
                        {" "}
                        <button style={{ ...btn("ghost"), padding:".2rem .55rem", fontSize:".78rem", color:"var(--danger)" }} onClick={()=>removeExpense(e)}>Delete</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
