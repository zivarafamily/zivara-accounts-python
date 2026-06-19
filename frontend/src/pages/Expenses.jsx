import { useEffect, useState } from "react";
import { apiGet, apiPost, uploadBill } from "../api/client";
import { formatDate } from "../utils/format";

const initial = {
  Date:"", ExpenseType:"Travel", Category:"", PaidBy:"",
  PaymentMode:"Cash", Amount:"", VendorOrPerson:"", Description:"",
  BillAvailable:"No", BillLink:"",
  TaxableValue:"", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", GSTAmount:"",
  EmployeeName:"", BillingMonth:"", Notes:"", Status:"Draft"
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
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [billFile, setBillFile] = useState(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [expRes, vndRes] = await Promise.allSettled([
        apiGet("getExpenses"),
        apiGet("getVendors"),
      ]);
      if (expRes.status === "fulfilled" && expRes.value.ok) setExpenses(expRes.value.data || []);
      if (vndRes.status === "fulfilled" && vndRes.value.ok) setVendors((vndRes.value.data || []).filter(v => v.Status !== "Inactive"));
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd() { setForm(initial); setEditId(null); setBillFile(null); setUploadMessage(""); setUploadError(""); setFormOpen(true); }
  function openEdit(e) {
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
      CGSTAmount: e.CGSTAmount || "",
      SGSTAmount: e.SGSTAmount || "",
      IGSTAmount: e.IGSTAmount || "",
      GSTAmount: e.GSTAmount || "",
      EmployeeName: e.EmployeeName || "",
      BillingMonth: e.BillingMonth || "",
      Notes: e.Notes || "",
      Status: e.Status || "Draft",
    });
    setEditId(e.ExpenseID);
    setBillFile(null);
    setUploadMessage("");
    setUploadError("");
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    const action  = editId ? "updateExpense" : "saveExpense";
    const payload = editId ? { ...form, ExpenseID: editId } : form;
    setUploadError("");
    setUploadMessage("");
    try {
      const r = await apiPost(action, payload);
      if (r.ok) {
        const expenseId = editId || r.data?.ExpenseID;
        if (billFile && expenseId) {
          const uploaded = await uploadBill(billFile, {
            expense_id: expenseId,
            source_type: "expense",
            source_id: expenseId,
          });
          setUploadMessage(uploaded.message || "Bill uploaded");
          setBillFile(null);
        }
        setForm(initial); setEditId(null); setFormOpen(false); load();
      }
      else alert(r.error || "Error saving");
    } catch (err) {
      setUploadError(err.message || "Unable to save expense or upload bill");
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
              <div><label style={label}>Paid By</label><input placeholder="Name" value={form.PaidBy} onChange={e=>set("PaidBy",e.target.value)} /></div>
              <div><label style={label}>Payment Mode</label>
                <select value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>
                  {["Cash","Bank","UPI","Card"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Amount (₹)</label><input type="number" min="0" placeholder="0.00" value={form.Amount} onChange={e=>set("Amount",e.target.value)} required /></div>
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
              <div><label style={label}>Bill Available</label>
                <select value={form.BillAvailable} onChange={e=>set("BillAvailable",e.target.value)}>
                  <option>Yes</option><option>No</option>
                </select>
              </div>
              <div><label style={label}>Bill Link</label><input placeholder="URL" value={form.BillLink} onChange={e=>set("BillLink",e.target.value)} /></div>
              <div>
                <label style={label}>Upload Bill</label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv"
                  onChange={e => setBillFile(e.target.files?.[0] || null)}
                />
                <div style={{ fontSize:".7rem", color:"var(--muted)", marginTop:".25rem" }}>
                  PDF, PNG, JPG, JPEG, XLS, XLSX, CSV
                </div>
              </div>
              <div><label style={label}>Taxable Value (₹)</label><input type="number" min="0" placeholder="0.00" value={form.TaxableValue} onChange={e=>set("TaxableValue",e.target.value)} /></div>
              <div><label style={label}>CGST (₹)</label><input type="number" min="0" placeholder="0.00" value={form.CGSTAmount} onChange={e=>set("CGSTAmount",e.target.value)} /></div>
              <div><label style={label}>SGST (₹)</label><input type="number" min="0" placeholder="0.00" value={form.SGSTAmount} onChange={e=>set("SGSTAmount",e.target.value)} /></div>
              <div><label style={label}>IGST (₹)</label><input type="number" min="0" placeholder="0.00" value={form.IGSTAmount} onChange={e=>set("IGSTAmount",e.target.value)} /></div>
              <div><label style={label}>GST Total (₹)</label><input type="number" min="0" placeholder="auto" value={form.GSTAmount} onChange={e=>set("GSTAmount",e.target.value)} /></div>
              <div><label style={label}>Employee Name</label><input placeholder="Name" value={form.EmployeeName} onChange={e=>set("EmployeeName",e.target.value)} /></div>
              <div><label style={label}>Billing Month</label><input placeholder="YYYY-MM" value={form.BillingMonth} onChange={e=>set("BillingMonth",e.target.value)} /></div>
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
            {uploadMessage && <div style={{ color:"var(--success)", fontSize:".8rem", marginTop:".75rem" }}>{uploadMessage}</div>}
            {uploadError && <div style={{ color:"var(--danger)", fontSize:".8rem", marginTop:".75rem" }}>{uploadError}</div>}
          </form>
        </div>
      )}

      {/* Table */}
      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:600, fontSize:".875rem" }}>All Expenses</span>
          <span style={{ fontSize:".75rem", color:"var(--muted)" }}>{expenses.length} record{expenses.length!==1?"s":""}</span>
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
                {expenses.length===0 ? (
                  <tr><td colSpan="9" style={{ textAlign:"center", color:"var(--muted)", padding:"2.5rem" }}>No expenses yet</td></tr>
                ) : (
                  expenses.map(e => (
                    <tr key={e.ExpenseID}>
                      <td style={{ whiteSpace:"nowrap" }}>{formatDate(e.Date)}</td>
                      <td>{e.ExpenseType}</td>
                      <td style={{ color:"var(--muted)" }}>{e.Category}</td>
                      <td style={{ fontWeight:600, color:"var(--accent2)" }}>₹{Number(e.Amount||0).toLocaleString("en-IN")}</td>
                      <td>{e.PaidBy}</td><td>{e.PaymentMode}</td>
                      <td><Badge v={e.Status}/></td>
                      <td style={{ color:"var(--muted)", maxWidth:"200px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.Description}</td>
                      <td><button style={{ ...btn("ghost"), padding:".2rem .55rem", fontSize:".78rem" }} onClick={()=>openEdit(e)}>Edit</button></td>
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
