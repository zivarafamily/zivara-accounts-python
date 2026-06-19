import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, uploadBill } from "../api/client";
import { formatDate } from "../utils/format";
import { useLLP } from "../context/LLPContext";

const CATEGORIES = ["Travel Agency", "CA / Professional", "Consultant", "Contractor", "Office Purchase", "Software", "Rent", "Other"];
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

const initial = {
  VendorID:"", VendorName:"", VendorCategory:"Travel Agency", VendorGSTIN:"", VendorPAN:"",
  BillNo:"", BillDate:new Date().toISOString().slice(0, 10), DueDate:"",
  ExpenseType:"Vendor Bill", Description:"",
  TaxableAmount:"", GSTAmount:"", GrossAmount:"",
  TDSSection:"393(1)-6(i)-2", TDSRate:"2", TDSAmount:"",
  PaidAmount:"", PaymentDate:"", PaymentMode:"Bank", BankAccount:"", ReferenceNo:"",
  ChallanNo:"", ChallanDate:"", InterestAmount:"",
  Status:"Pending", Notes:"",
};

const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn = (v = "primary") => ({
  padding:".55rem 1rem", borderRadius:"6px", border:v === "ghost" ? "1px solid var(--border)" : "none",
  fontWeight:600, fontSize:".84rem", cursor:"pointer",
  background:v === "primary" ? "var(--accent)" : "transparent",
  color:v === "primary" ? "#fff" : "var(--muted)",
});

const fmt = n => n != null && n !== "" && !isNaN(Number(n))
  ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })
  : "—";

function calc(form) {
  const taxable = Number(form.TaxableAmount || 0);
  const gst = Number(form.GSTAmount || 0);
  const gross = Number(form.GrossAmount || 0) || taxable + gst;
  const tdsRate = Number(form.TDSRate || 0);
  const tds = form.TDSAmount !== "" ? Number(form.TDSAmount || 0) : Math.round(taxable * tdsRate) / 100;
  const net = Math.max(gross - tds, 0);
  return { taxable, gst, gross, tds, net };
}

function statusColor(status) {
  return { Pending:"var(--warning)", "Part Paid":"var(--accent2)", Paid:"var(--success)", Cancelled:"var(--danger)" }[status] || "var(--muted)";
}

function Badge({ value }) {
  const color = statusColor(value);
  return <span style={{ background:color+"22", color, padding:".2rem .6rem", borderRadius:"99px", fontSize:".72rem", fontWeight:700, whiteSpace:"nowrap" }}>{value || "Pending"}</span>;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default function PaymentTracker() {
  const { currentLLP } = useLLP();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(initial);
  const [vendorChoice, setVendorChoice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [billFile, setBillFile] = useState(null);
  const [uploadMessage, setUploadMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [payRes, vendorRes] = await Promise.allSettled([
        apiGet("getLLPPayables"),
        apiGet("getVendors"),
      ]);
      if (payRes.status === "fulfilled" && payRes.value.ok) {
        setRows(payRes.value.data || []);
        setSummary(payRes.value.summary || {});
      } else if (payRes.status === "rejected") {
        setError(payRes.reason?.message || "Unable to load payables");
      }
      if (vendorRes.status === "fulfilled" && vendorRes.value.ok) {
        setVendors((vendorRes.value.data || []).filter(v => v.Status !== "Inactive"));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [currentLLP?.llpId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      const text = [row.VendorName, row.VendorCategory, row.BillNo, row.Description, row.TDSSection].join(" ").toLowerCase();
      return (!q || text.includes(q)) && (!status || row.Status === status) && (!category || row.VendorCategory === category);
    });
  }, [rows, search, status, category]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd() {
    setForm(initial);
    setVendorChoice("");
    setBillFile(null);
    setUploadMessage("");
    setEditId(null);
    setOpen(true);
  }

  function openEdit(row) {
    const matchedVendor = vendors.find(v =>
      (row.VendorGSTIN && v.GSTIN && normalizeKey(row.VendorGSTIN) === normalizeKey(v.GSTIN)) ||
      (row.VendorName && normalizeKey(row.VendorName) === normalizeKey(v.VendorName))
    );
    setForm({
      VendorID: matchedVendor?.VendorID || "",
      VendorName: row.VendorName || "",
      VendorCategory: row.VendorCategory || "Other",
      VendorGSTIN: row.VendorGSTIN || "",
      VendorPAN: row.VendorPAN || "",
      BillNo: row.BillNo || "",
      BillDate: String(row.BillDate || "").slice(0, 10),
      DueDate: String(row.DueDate || "").slice(0, 10),
      ExpenseType: row.ExpenseType || "Vendor Bill",
      Description: row.Description || "",
      TaxableAmount: row.TaxableAmount || "",
      GSTAmount: row.GSTAmount || "",
      GrossAmount: row.GrossAmount || "",
      TDSSection: row.TDSSection || "",
      TDSRate: row.TDSRate || "",
      TDSAmount: row.TDSAmount || "",
      PaidAmount: row.PaidAmount || "",
      PaymentDate: String(row.PaymentDate || "").slice(0, 10),
      PaymentMode: row.PaymentMode || "Bank",
      BankAccount: row.BankAccount || "",
      ReferenceNo: row.ReferenceNo || "",
      ChallanNo: row.ChallanNo || "",
      ChallanDate: String(row.ChallanDate || "").slice(0, 10),
      InterestAmount: row.InterestAmount || "",
      Status: row.Status || "Pending",
      Notes: row.Notes || "",
    });
    setVendorChoice(matchedVendor?.VendorID || "__new__");
    setBillFile(null);
    setUploadMessage("");
    setEditId(row.PayableID);
    setOpen(true);
  }

  function applyVendorChoice(vendorId) {
    setVendorChoice(vendorId);
    if (vendorId === "__new__") {
      setForm(p => ({ ...p, VendorID:"", VendorName:"", VendorCategory:"Travel Agency", VendorGSTIN:"", VendorPAN:"" }));
      return;
    }
    if (!vendorId) {
      setForm(p => ({ ...p, VendorID:"", VendorName:"", VendorGSTIN:"", VendorPAN:"" }));
      return;
    }
    const v = vendors.find(x => x.VendorID === vendorId);
    if (!v) return;
    setForm(p => ({
      ...p,
      VendorID: v.VendorID || "",
      VendorName: v.VendorName || p.VendorName,
      VendorCategory: v.Category || p.VendorCategory,
      VendorGSTIN: v.GSTIN || p.VendorGSTIN,
      VendorPAN: v.PAN || p.VendorPAN,
    }));
  }

  function findExistingVendorFromForm() {
    const name = normalizeKey(form.VendorName);
    const gstin = normalizeKey(form.VendorGSTIN);
    return vendors.find(v =>
      (gstin && normalizeKey(v.GSTIN) === gstin) ||
      (name && normalizeKey(v.VendorName) === name)
    );
  }

  function applyTDS(section) {
    const opt = TDS_SECTIONS.find(x => x.section === section);
    setForm(p => ({ ...p, TDSSection:section, TDSRate: opt ? String(opt.rate) : p.TDSRate, TDSAmount:"" }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let vendorPayload = { ...form };
      if (!form.VendorName) throw new Error("Vendor is required");
      if (!form.VendorID) {
        const existingVendor = findExistingVendorFromForm();
        if (existingVendor) {
          vendorPayload = {
            ...vendorPayload,
            VendorID: existingVendor.VendorID || "",
            VendorName: existingVendor.VendorName || vendorPayload.VendorName,
            VendorCategory: existingVendor.Category || vendorPayload.VendorCategory,
            VendorGSTIN: existingVendor.GSTIN || vendorPayload.VendorGSTIN,
            VendorPAN: existingVendor.PAN || vendorPayload.VendorPAN,
          };
        } else {
          const vendorRes = await apiPost("saveVendor", {
            VendorName: form.VendorName,
            Category: form.VendorCategory,
            GSTIN: form.VendorGSTIN,
            PAN: form.VendorPAN,
            Status: "Active",
          });
          const savedVendor = vendorRes.data || {};
          vendorPayload = {
            ...vendorPayload,
            VendorID: savedVendor.VendorID || "",
            VendorName: savedVendor.VendorName || vendorPayload.VendorName,
            VendorCategory: savedVendor.Category || vendorPayload.VendorCategory,
            VendorGSTIN: savedVendor.GSTIN || vendorPayload.VendorGSTIN,
            VendorPAN: savedVendor.PAN || vendorPayload.VendorPAN,
          };
        }
      }
      const amounts = calc(form);
      const payload = {
        ...vendorPayload,
        GrossAmount: amounts.gross,
        TDSAmount: amounts.tds,
        NetPayable: amounts.net,
      };
      const saved = await apiPost(editId ? "updateLLPPayable" : "saveLLPPayable", editId ? { ...payload, PayableID: editId } : payload);
      const payableId = editId || saved.data?.PayableID;
      if (billFile && payableId) {
        const uploaded = await uploadBill(billFile, {
          payable_id: payableId,
          source_type: "payable",
          source_id: payableId,
        });
        setUploadMessage(uploaded.message || "Bill uploaded");
        setBillFile(null);
      }
      setOpen(false);
      setEditId(null);
      setForm(initial);
      setVendorChoice("");
      await load();
    } catch (err) {
      setError(err.message || "Unable to save payable");
    } finally {
      setSaving(false);
    }
  }

  async function markPaid(row) {
    const ref = window.prompt(`Payment reference / UTR for ${row.VendorName || row.BillNo || "bill"}`);
    if (ref === null) return;
    setSaving(true);
    try {
      await apiPost("markLLPPayablePaid", {
        PayableID: row.PayableID,
        PaidAmount: row.NetPayable,
        PaymentDate: new Date().toISOString().slice(0, 10),
        PaymentMode: row.PaymentMode || "Bank",
        BankAccount: row.BankAccount || "",
        ReferenceNo: ref,
      });
      await load();
    } catch (err) {
      setError(err.message || "Unable to mark paid");
    } finally {
      setSaving(false);
    }
  }

  const amounts = calc(form);
  const kpis = [
    { label:"Gross Bills", value:fmt(summary.grossAmount), color:"var(--accent2)" },
    { label:"TDS Deducted", value:fmt(summary.tdsAmount), color:"var(--warning)" },
    { label:"Net Payable", value:fmt(summary.netPayable), color:"var(--accent)" },
    { label:"Balance Due", value:fmt(summary.balanceAmount), color:"var(--danger)" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Payment Tracker</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>LLP vendor bills, TDS deduction, net payable, and payment status</p>
        </div>
        <button style={btn()} onClick={openAdd}>+ Add Bill</button>
      </div>

      {error && <div style={{ ...card, borderColor:"var(--danger)", color:"var(--danger)" }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:"1rem" }}>
        {kpis.map(k => (
          <div key={k.label} style={{ ...card, padding:".9rem 1rem" }}>
            <div style={{ fontSize:".7rem", color:"var(--muted)", fontWeight:700, textTransform:"uppercase" }}>{k.label}</div>
            <div style={{ fontSize:"1.3rem", fontWeight:800, color:k.color, marginTop:".25rem" }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, display:"flex", gap:".75rem", alignItems:"center", flexWrap:"wrap" }}>
        <input style={{ maxWidth:260 }} placeholder="Search vendor, bill no, TDS..." value={search} onChange={e=>setSearch(e.target.value)} />
        <select style={{ maxWidth:170 }} value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["Pending","Part Paid","Paid","Cancelled"].map(s => <option key={s}>{s}</option>)}
        </select>
        <select style={{ maxWidth:190 }} value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        {(search || status || category) && <button style={btn("ghost")} onClick={()=>{ setSearch(""); setStatus(""); setCategory(""); }}>Clear</button>}
        <span style={{ marginLeft:"auto", fontSize:".8rem", color:"var(--muted)" }}>{filtered.length} bill{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading...</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>No payable bills found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Vendor</th><th>Category</th><th>Bill</th><th>Bill Date</th><th>Gross</th><th>TDS</th><th>Net Payable</th><th>Paid</th><th>Balance</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.PayableID}>
                    <td style={{ fontWeight:700, minWidth:170 }}>{row.VendorName || "—"}</td>
                    <td>{row.VendorCategory || "—"}</td>
                    <td style={{ color:"var(--accent2)", whiteSpace:"nowrap" }}>{row.BillNo || "—"}</td>
                    <td style={{ whiteSpace:"nowrap" }}>{formatDate(row.BillDate)}</td>
                    <td style={{ fontWeight:700, whiteSpace:"nowrap" }}>{fmt(row.GrossAmount)}</td>
                    <td style={{ color:"var(--warning)", whiteSpace:"nowrap" }}>{row.TDSSection ? `${row.TDSSection} ` : ""}{fmt(row.TDSAmount)}</td>
                    <td style={{ color:"var(--accent)", fontWeight:700, whiteSpace:"nowrap" }}>{fmt(row.NetPayable)}</td>
                    <td style={{ color:"var(--success)", whiteSpace:"nowrap" }}>{fmt(row.PaidAmount)}</td>
                    <td style={{ color:Number(row.BalanceAmount) > 0 ? "var(--danger)" : "var(--muted)", fontWeight:700, whiteSpace:"nowrap" }}>{fmt(row.BalanceAmount)}</td>
                    <td><Badge value={row.Status} /></td>
                    <td style={{ whiteSpace:"nowrap" }}>
                      <button style={{ ...btn("ghost"), padding:".3rem .6rem" }} onClick={()=>openEdit(row)}>Edit</button>{" "}
                      {row.Status !== "Paid" && row.Status !== "Cancelled" && <button style={{ ...btn("ghost"), padding:".3rem .6rem", color:"var(--success)" }} onClick={()=>markPaid(row)} disabled={saving}>Pay</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {open && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)", zIndex:90, padding:"2rem 1rem", overflowY:"auto" }}>
          <div style={{ ...card, maxWidth:920, margin:"0 auto" }}>
            <h3 style={{ fontWeight:700, marginBottom:"1rem" }}>{editId ? "Edit Payable Bill" : "New Payable Bill"}</h3>
            <form onSubmit={save}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:".85rem" }}>
                <div>
                  <label style={label}>Vendor *</label>
                  <select value={vendorChoice} onChange={e=>applyVendorChoice(e.target.value)} required>
                    <option value="">— Select vendor —</option>
                    {vendors.map(v => <option key={v.VendorID} value={v.VendorID}>{v.VendorName}{v.Category ? ` · ${v.Category}` : ""}</option>)}
                    <option value="__new__">+ Add new vendor</option>
                  </select>
                </div>
                {vendorChoice === "__new__" && (
                  <>
                    <div><label style={label}>New Vendor Name *</label><input value={form.VendorName} onChange={e=>set("VendorName", e.target.value)} required /></div>
                    <div><label style={label}>Category</label><select value={form.VendorCategory} onChange={e=>set("VendorCategory", e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
                    <div><label style={label}>Vendor GSTIN</label><input value={form.VendorGSTIN} onChange={e=>set("VendorGSTIN", e.target.value.toUpperCase())} maxLength={15} /></div>
                    <div><label style={label}>Vendor PAN</label><input value={form.VendorPAN} onChange={e=>set("VendorPAN", e.target.value.toUpperCase())} maxLength={10} /></div>
                  </>
                )}
                {vendorChoice && vendorChoice !== "__new__" && (
                  <>
                    <div><label style={label}>Category</label><input value={form.VendorCategory || ""} readOnly /></div>
                    <div><label style={label}>Vendor GSTIN</label><input value={form.VendorGSTIN || ""} readOnly /></div>
                    <div><label style={label}>Vendor PAN</label><input value={form.VendorPAN || ""} onChange={e=>set("VendorPAN", e.target.value.toUpperCase())} maxLength={10} /></div>
                  </>
                )}
                <div><label style={label}>Bill No</label><input value={form.BillNo} onChange={e=>set("BillNo", e.target.value)} /></div>
                <div><label style={label}>Bill Date *</label><input type="date" value={form.BillDate} onChange={e=>set("BillDate", e.target.value)} required /></div>
                <div><label style={label}>Due Date</label><input type="date" value={form.DueDate} onChange={e=>set("DueDate", e.target.value)} /></div>
                <div><label style={label}>Taxable Amount</label><input type="number" min="0" step="0.01" value={form.TaxableAmount} onChange={e=>set("TaxableAmount", e.target.value)} /></div>
                <div><label style={label}>GST Amount</label><input type="number" min="0" step="0.01" value={form.GSTAmount} onChange={e=>set("GSTAmount", e.target.value)} /></div>
                <div><label style={label}>Gross Bill Amount</label><input type="number" min="0" step="0.01" value={form.GrossAmount} onChange={e=>set("GrossAmount", e.target.value)} placeholder="Auto: taxable + GST" /></div>
                <div>
                  <label style={label}>TDS Section</label>
                  <select value={form.TDSSection} onChange={e=>applyTDS(e.target.value)}>{TDS_SECTIONS.map(s => <option key={s.section || "none"} value={s.section}>{s.label}</option>)}</select>
                  <div style={{ fontSize:".68rem", color:"var(--muted)", marginTop:".25rem" }}>
                    From 1 Apr 2026, TDS uses Section 393 table items. Section 394 is for TCS.
                  </div>
                </div>
                <div><label style={label}>TDS Rate (%)</label><input type="number" min="0" step="0.01" value={form.TDSRate} onChange={e=>{ set("TDSRate", e.target.value); set("TDSAmount", ""); }} /></div>
                <div><label style={label}>TDS Amount</label><input type="number" min="0" step="0.01" value={form.TDSAmount} onChange={e=>set("TDSAmount", e.target.value)} placeholder={String(amounts.tds)} /></div>
                <div><label style={label}>Paid Amount</label><input type="number" min="0" step="0.01" value={form.PaidAmount} onChange={e=>set("PaidAmount", e.target.value)} /></div>
                <div><label style={label}>Payment Date</label><input type="date" value={form.PaymentDate} onChange={e=>set("PaymentDate", e.target.value)} /></div>
                <div><label style={label}>Payment Mode</label><select value={form.PaymentMode} onChange={e=>set("PaymentMode", e.target.value)}>{["Bank","NEFT","RTGS","IMPS","UPI","Cheque","Cash"].map(o => <option key={o}>{o}</option>)}</select></div>
                <div><label style={label}>Bank Account</label><input value={form.BankAccount} onChange={e=>set("BankAccount", e.target.value)} /></div>
                <div><label style={label}>Reference / UTR</label><input value={form.ReferenceNo} onChange={e=>set("ReferenceNo", e.target.value)} /></div>
                <div><label style={label}>Challan No</label><input value={form.ChallanNo} onChange={e=>set("ChallanNo", e.target.value)} /></div>
                <div><label style={label}>Challan Date</label><input type="date" value={form.ChallanDate} onChange={e=>set("ChallanDate", e.target.value)} /></div>
                <div><label style={label}>Interest, If Any</label><input type="number" min="0" step="0.01" value={form.InterestAmount} onChange={e=>set("InterestAmount", e.target.value)} /></div>
                <div style={{ gridColumn:"1 / -1" }}><label style={label}>Description</label><input value={form.Description} onChange={e=>set("Description", e.target.value)} placeholder="e.g. Flight booking for LLP travel / CA audit fees" /></div>
                <div style={{ gridColumn:"1 / -1" }}>
                  <label style={label}>Upload Bill</label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.csv"
                    onChange={e => setBillFile(e.target.files?.[0] || null)}
                  />
                  <div style={{ fontSize:".7rem", color:"var(--muted)", marginTop:".25rem" }}>
                    PDF, PNG, JPG, JPEG, XLS, XLSX, CSV
                  </div>
                  {uploadMessage && <div style={{ color:"var(--success)", fontSize:".8rem", marginTop:".4rem" }}>{uploadMessage}</div>}
                </div>
                <div style={{ gridColumn:"1 / -1" }}><label style={label}>Notes</label><input value={form.Notes} onChange={e=>set("Notes", e.target.value)} /></div>
              </div>

              <div style={{ marginTop:"1rem", padding:".75rem 1rem", border:"1px solid var(--border)", borderRadius:"6px", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:".75rem" }}>
                <div><span style={{ color:"var(--muted)", fontSize:".72rem" }}>Gross</span><br/><strong>{fmt(amounts.gross)}</strong></div>
                <div><span style={{ color:"var(--muted)", fontSize:".72rem" }}>Less TDS</span><br/><strong style={{ color:"var(--warning)" }}>{fmt(amounts.tds)}</strong></div>
                <div><span style={{ color:"var(--muted)", fontSize:".72rem" }}>Net Payable</span><br/><strong style={{ color:"var(--success)" }}>{fmt(amounts.net)}</strong></div>
              </div>

              <div style={{ display:"flex", justifyContent:"flex-end", gap:".75rem", marginTop:"1.25rem", flexWrap:"wrap" }}>
                <button type="button" style={btn("ghost")} onClick={()=>{ setOpen(false); setVendorChoice(""); }}>Cancel</button>
                <button type="submit" style={btn()} disabled={saving}>{saving ? "Saving..." : editId ? "Update Bill" : "Save Bill"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
