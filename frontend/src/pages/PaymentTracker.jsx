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
  TaxableAmount:"", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", GSTAmount:"", TCSAmount:"", GrossAmount:"",
  LineItems:[{ Particulars:"", TaxableAmount:"", GSTType:"IGST", GSTRate:"18", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", TCSAmount:"" }],
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

const tdsDeducted = row => Number(row.TDSDeductedAmount || 0);
const tdsPending = row => Math.max(Number(row.TDSAmount || 0) - tdsDeducted(row), 0);

const tdsDisplay = row => {
  const parts = [];
  if (row.TDSSection) parts.push(row.TDSSection);
  if (Number(row.TDSRate) > 0) parts.push(`${Number(row.TDSRate).toLocaleString("en-IN")}%`);
  parts.push(fmt(row.TDSAmount));
  if (tdsPending(row) > 0) parts.push(`pending ${fmt(tdsPending(row))}`);
  return parts.join(" · ");
};

function calc(form) {
  const lineTotals = calcLineItems(form.LineItems || []);
  const useLines = lineTotals.hasValues;
  const taxable = useLines ? lineTotals.taxable : Number(form.TaxableAmount || 0);
  const cgst = useLines ? lineTotals.cgst : Number(form.CGSTAmount || 0);
  const sgst = useLines ? lineTotals.sgst : Number(form.SGSTAmount || 0);
  const igst = useLines ? lineTotals.igst : Number(form.IGSTAmount || 0);
  const gst = cgst + sgst + igst || Number(form.GSTAmount || 0);
  const tcs = useLines ? lineTotals.tcs : Number(form.TCSAmount || 0);
  const gross = Number(form.GrossAmount || 0) || taxable + gst + tcs;
  const tdsRate = Number(form.TDSRate || 0);
  const tds = form.TDSAmount !== "" ? Number(form.TDSAmount || 0) : Math.round(taxable * tdsRate) / 100;
  const net = Math.max(gross - tds, 0);
  return { taxable, cgst, sgst, igst, gst, tcs, gross, tds, net };
}

function calcLineItems(items = []) {
  return items.reduce((sum, item) => {
    const { taxable, cgst, sgst, igst, tcs } = calcLineItem(item);
    return {
      taxable:sum.taxable + taxable,
      cgst:sum.cgst + cgst,
      sgst:sum.sgst + sgst,
      igst:sum.igst + igst,
      tcs:sum.tcs + tcs,
      hasValues:sum.hasValues || taxable > 0 || cgst > 0 || sgst > 0 || igst > 0 || tcs > 0,
    };
  }, { taxable:0, cgst:0, sgst:0, igst:0, tcs:0, hasValues:false });
}

function calcLineItem(item = {}) {
  const taxable = Number(item.TaxableAmount || 0);
  const rate = Number(item.GSTRate || 0);
  let cgst = Number(item.CGSTAmount || 0);
  let sgst = Number(item.SGSTAmount || 0);
  let igst = Number(item.IGSTAmount || 0);
  const tcs = Number(item.TCSAmount || 0);
  if (!cgst && !sgst && !igst && taxable && rate) {
    const gst = Math.round(taxable * rate) / 100;
    if (item.GSTType === "CGST_SGST") {
      cgst = Math.round(gst / 2 * 100) / 100;
      sgst = Math.round((gst - cgst) * 100) / 100;
    } else if (item.GSTType !== "None") {
      igst = gst;
    }
  }
  return { taxable, cgst, sgst, igst, tcs, total:taxable + cgst + sgst + igst + tcs };
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

function compactVendorKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]/g, "");
}

function payableVendorKey(row) {
  return compactVendorKey(row.VendorName) || row.VendorID;
}

function compareBillNo(a, b) {
  const billA = String(a.BillNo || "").trim();
  const billB = String(b.BillNo || "").trim();
  const byBill = billA.localeCompare(billB, undefined, { numeric:true, sensitivity:"base" });
  if (byBill !== 0) return byBill;
  return String(a.BillDate || "").localeCompare(String(b.BillDate || ""));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function PaymentTracker() {
  const { currentLLP } = useLLP();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(initial);
  const [vendorChoice, setVendorChoice] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [billFilter, setBillFilter] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [billFile, setBillFile] = useState(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    VendorKey:"",
    PayableIDs:[],
    PaidAmount:"",
    TDSMode:"net_after_tds",
    PaymentDate:new Date().toISOString().slice(0, 10),
    PaymentMode:"Bank",
    BankAccount:"",
    ReferenceNo:"",
  });

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

  const vendorFilterOptions = useMemo(() => {
    const map = new Map();
    rows.forEach(row => {
      const key = payableVendorKey(row);
      if (!key) return;
      const current = map.get(key) || { key, name:row.VendorName || "Unknown Vendor", count:0 };
      current.count += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const billFilterOptions = useMemo(() => {
    const sourceRows = vendorFilter ? rows.filter(row => payableVendorKey(row) === vendorFilter) : rows;
    const map = new Map();
    sourceRows.forEach(row => {
      const billNo = String(row.BillNo || "").trim();
      if (!billNo) return;
      map.set(billNo, billNo);
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric:true }));
  }, [rows, vendorFilter]);

  const filtered = useMemo(() => {
    return rows.filter(row => {
      const billNo = String(row.BillNo || "").trim();
      return (!vendorFilter || payableVendorKey(row) === vendorFilter) &&
        (!billFilter || billNo === billFilter) &&
        (!status || row.Status === status) &&
        (!category || row.VendorCategory === category);
      }).sort(compareBillNo);
  }, [rows, vendorFilter, billFilter, status, category]);

  const filteredSummary = useMemo(() => filtered.reduce((sum, row) => ({
    grossAmount:sum.grossAmount + Number(row.GrossAmount || 0),
    tdsAmount:sum.tdsAmount + Number(row.TDSAmount || 0),
    tdsDeductedAmount:sum.tdsDeductedAmount + tdsDeducted(row),
    tdsPendingAmount:sum.tdsPendingAmount + tdsPending(row),
    netPayable:sum.netPayable + Number(row.NetPayable || 0),
    balanceAmount:sum.balanceAmount + Number(row.BalanceAmount || 0),
  }), { grossAmount:0, tdsAmount:0, tdsDeductedAmount:0, tdsPendingAmount:0, netPayable:0, balanceAmount:0 }), [filtered]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setBatch = (k, v) => setBatchForm(p => ({ ...p, [k]: v }));

  const outstandingPayables = useMemo(
    () => rows.filter(row => row.Status !== "Paid" && row.Status !== "Cancelled" && Number(row.BalanceAmount || row.NetPayable || 0) > 0),
    [rows]
  );

  const vendorBatchOptions = useMemo(() => {
    const map = new Map();
    outstandingPayables.forEach(row => {
      const key = payableVendorKey(row);
      if (!key) return;
      const current = map.get(key) || { key, name:row.VendorName || "Unknown Vendor", count:0, total:0 };
      current.count += 1;
      current.total += Number(row.BalanceAmount || row.NetPayable || 0);
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [outstandingPayables]);

  const batchVendorRows = useMemo(
    () => outstandingPayables
      .filter(row => batchForm.VendorKey && payableVendorKey(row) === batchForm.VendorKey)
      .sort(compareBillNo),
    [outstandingPayables, batchForm.VendorKey]
  );

  const selectedBatchTotal = useMemo(
    () => batchVendorRows
      .filter(row => batchForm.PayableIDs.includes(row.PayableID))
      .reduce((sum, row) => sum + Number(row.BalanceAmount || row.NetPayable || 0), 0),
    [batchVendorRows, batchForm.PayableIDs]
  );
  const selectedBatchGross = useMemo(
    () => batchVendorRows
      .filter(row => batchForm.PayableIDs.includes(row.PayableID))
      .reduce((sum, row) => sum + Number(row.GrossAmount || 0), 0),
    [batchVendorRows, batchForm.PayableIDs]
  );
  const selectedBatchTDS = useMemo(
    () => batchVendorRows
      .filter(row => batchForm.PayableIDs.includes(row.PayableID))
      .reduce((sum, row) => sum + Number(row.TDSAmount || 0), 0),
    [batchVendorRows, batchForm.PayableIDs]
  );
  const selectedBatchPaymentTarget = batchForm.TDSMode === "gross_pending_tds" ? selectedBatchGross : selectedBatchTotal;

  function batchTotalFor(payableIds, sourceRows = batchVendorRows) {
    return sourceRows
      .filter(row => payableIds.includes(row.PayableID))
      .reduce((sum, row) => sum + Number(row.BalanceAmount || row.NetPayable || 0), 0);
  }

  function batchGrossTotalFor(payableIds, sourceRows = batchVendorRows) {
    return sourceRows
      .filter(row => payableIds.includes(row.PayableID))
      .reduce((sum, row) => sum + Number(row.GrossAmount || 0), 0);
  }

  function batchPaymentTarget(payableIds, sourceRows = batchVendorRows, tdsMode = batchForm.TDSMode) {
    return tdsMode === "gross_pending_tds" ? batchGrossTotalFor(payableIds, sourceRows) : batchTotalFor(payableIds, sourceRows);
  }

  function openAdd() {
    setForm(initial);
    setVendorChoice("");
    setBillFile(null);
    setUploadMessage("");
    setEditId(null);
    setOpen(true);
  }

  function openBatchPay() {
    const first = vendorBatchOptions[0];
    const firstRows = first ? outstandingPayables.filter(row => payableVendorKey(row) === first.key).sort(compareBillNo) : [];
    const payableIds = firstRows.map(row => row.PayableID);
    setBatchForm({
      VendorKey:first?.key || "",
      PayableIDs:payableIds,
      PaidAmount:batchTotalFor(payableIds, firstRows).toFixed(2),
      TDSMode:"net_after_tds",
      PaymentDate:new Date().toISOString().slice(0, 10),
      PaymentMode:"Bank",
      BankAccount:"",
      ReferenceNo:"",
    });
    setBatchOpen(true);
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
      CGSTAmount: row.CGSTAmount || "",
      SGSTAmount: row.SGSTAmount || "",
      IGSTAmount: row.IGSTAmount || "",
      GSTAmount: row.GSTAmount || "",
      TCSAmount: row.TCSAmount || "",
      GrossAmount: row.GrossAmount || "",
      LineItems: Array.isArray(row.LineItems) && row.LineItems.length ? row.LineItems : [{ Particulars:"", TaxableAmount:"", GSTType:"IGST", GSTRate:"18", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", TCSAmount:"" }],
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

  function syncLineTotals(items) {
    const totals = calcLineItems(items);
    if (!totals.hasValues) return { LineItems:items };
    const gst = totals.cgst + totals.sgst + totals.igst;
    const gross = totals.taxable + gst + totals.tcs;
    return {
      LineItems:items,
      TaxableAmount:totals.taxable ? totals.taxable.toFixed(2) : "",
      CGSTAmount:totals.cgst ? totals.cgst.toFixed(2) : "",
      SGSTAmount:totals.sgst ? totals.sgst.toFixed(2) : "",
      IGSTAmount:totals.igst ? totals.igst.toFixed(2) : "",
      GSTAmount:gst ? gst.toFixed(2) : "",
      TCSAmount:totals.tcs ? totals.tcs.toFixed(2) : "",
      GrossAmount:gross ? gross.toFixed(2) : "",
      TDSAmount:"",
    };
  }

  function updateLineItem(index, key, value) {
    setForm(p => {
      const items = [...(p.LineItems || [])];
      items[index] = { ...items[index], [key]:value };
      return { ...p, ...syncLineTotals(items) };
    });
  }

  function addLineItem() {
    setForm(p => ({ ...p, LineItems:[...(p.LineItems || []), { Particulars:"", TaxableAmount:"", GSTType:"IGST", GSTRate:"18", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", TCSAmount:"" }] }));
  }

  function removeLineItem(index) {
    setForm(p => {
      const items = (p.LineItems || []).filter((_, i) => i !== index);
      const nextItems = items.length ? items : [{ Particulars:"", TaxableAmount:"", GSTType:"IGST", GSTRate:"18", CGSTAmount:"", SGSTAmount:"", IGSTAmount:"", TCSAmount:"" }];
      return { ...p, ...syncLineTotals(nextItems) };
    });
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
        TaxableAmount: amounts.taxable,
        CGSTAmount: amounts.cgst,
        SGSTAmount: amounts.sgst,
        IGSTAmount: amounts.igst,
        GSTAmount: amounts.gst,
        TCSAmount: amounts.tcs,
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

  async function removePayable(row) {
    if (!window.confirm(`Delete payable bill ${row.BillNo || row.VendorName}?`)) return;
    setSaving(true);
    setError("");
    try {
      await apiPost("deleteLLPPayable", { PayableID:row.PayableID });
      await load();
    } catch (err) {
      setError(err.message || "Unable to delete payable");
    } finally {
      setSaving(false);
    }
  }

  function applyBatchVendor(vendorKey) {
    const payableRows = outstandingPayables.filter(row => payableVendorKey(row) === vendorKey).sort(compareBillNo);
    const payableIds = payableRows.map(row => row.PayableID);
    setBatchForm(p => ({
      ...p,
      VendorKey:vendorKey,
      PayableIDs:payableIds,
      PaidAmount:batchPaymentTarget(payableIds, payableRows, p.TDSMode).toFixed(2),
    }));
  }

  function setBatchTDSMode(tdsMode) {
    setBatchForm(p => ({ ...p, TDSMode:tdsMode, PaidAmount:batchPaymentTarget(p.PayableIDs, batchVendorRows, tdsMode).toFixed(2) }));
  }

  function toggleBatchBill(payableId) {
    setBatchForm(p => {
      const nextPayableIDs = p.PayableIDs.includes(payableId)
        ? p.PayableIDs.filter(id => id !== payableId)
        : [...p.PayableIDs, payableId];
      return {
        ...p,
        PayableIDs:nextPayableIDs,
        PaidAmount:batchPaymentTarget(nextPayableIDs, batchVendorRows, p.TDSMode).toFixed(2),
      };
    });
  }

  function setAllBatchBills(checked) {
    const payableIds = checked ? batchVendorRows.map(row => row.PayableID) : [];
    setBatchForm(p => ({ ...p, PayableIDs:payableIds, PaidAmount:batchPaymentTarget(payableIds, batchVendorRows, p.TDSMode).toFixed(2) }));
  }

  async function saveBatchPayment(e) {
    e.preventDefault();
    if (!batchForm.PayableIDs.length) {
      setError("Select at least one bill for batch payment");
      return;
    }
    const paidAmount = Number(batchForm.PaidAmount || 0);
    if (paidAmount <= 0) {
      setError("Paid amount must be greater than zero");
      return;
    }
    if (paidAmount > selectedBatchPaymentTarget) {
      setError(`Paid amount cannot exceed selected ${batchForm.TDSMode === "gross_pending_tds" ? "gross" : "net"} amount ${fmt(selectedBatchPaymentTarget)}. Select the missing bill or record the extra separately.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiPost("batchPayLLPPayables", {
        PayableIDs:batchForm.PayableIDs,
        PaidAmount:batchForm.PaidAmount,
        TDSMode:batchForm.TDSMode,
        PaymentDate:batchForm.PaymentDate,
        PaymentMode:batchForm.PaymentMode,
        BankAccount:batchForm.BankAccount,
        ReferenceNo:batchForm.ReferenceNo,
      });
      setBatchOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Unable to save batch payment");
    } finally {
      setSaving(false);
    }
  }

  function exportFilteredCSV() {
    const headers = [
      "Vendor", "Category", "Bill No", "Bill Date", "Taxable Amount", "CGST", "SGST", "IGST", "GST Amount", "TCS", "Gross Amount",
      "TDS Section", "TDS Rate (%)", "Expected TDS", "TDS Deducted", "Pending TDS", "Net Payable", "Paid Amount", "Balance Amount",
      "Status", "Payment Date", "Payment Mode", "Bank Account", "Reference / UTR", "Challan No",
      "Challan Date", "Interest Amount", "Notes",
    ];
    const dataRows = filtered.map(row => [
      row.VendorName, row.VendorCategory, row.BillNo, formatDate(row.BillDate), row.TaxableAmount,
      row.CGSTAmount, row.SGSTAmount, row.IGSTAmount, row.GSTAmount, row.TCSAmount, row.GrossAmount,
      row.TDSSection, row.TDSRate, row.TDSAmount, tdsDeducted(row), tdsPending(row), row.NetPayable,
      row.PaidAmount, row.BalanceAmount, row.Status, formatDate(row.PaymentDate), row.PaymentMode,
      row.BankAccount, row.ReferenceNo, row.ChallanNo, formatDate(row.ChallanDate), row.InterestAmount,
      row.Notes,
    ]);
    const summaryRows = [
      ["Summary"],
      ["Gross Bills", filteredSummary.grossAmount],
      ["Expected TDS", filteredSummary.tdsAmount],
      ["TDS Deducted", filteredSummary.tdsDeductedAmount],
      ["Pending TDS", filteredSummary.tdsPendingAmount],
      ["Net Payable", filteredSummary.netPayable],
      ["Balance Due", filteredSummary.balanceAmount],
      [],
    ];
    const csv = [
      ...summaryRows.map(row => row.map(csvCell).join(",")),
      headers.map(csvCell).join(","),
      ...dataRows.map(row => row.map(csvCell).join(",")),
    ].join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const amounts = calc(form);
  const kpis = [
    { label:"Gross Bills", value:fmt(filteredSummary.grossAmount), color:"var(--accent2)" },
    { label:"Expected TDS", value:fmt(filteredSummary.tdsAmount), color:"var(--warning)" },
    { label:"Pending TDS", value:fmt(filteredSummary.tdsPendingAmount), color:"var(--danger)" },
    { label:"Net Payable", value:fmt(filteredSummary.netPayable), color:"var(--accent)" },
    { label:"Balance Due", value:fmt(filteredSummary.balanceAmount), color:"var(--danger)" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"1rem", flexWrap:"wrap" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Payment Tracker</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>LLP vendor bills, TDS deduction, net payable, and payment status</p>
        </div>
        <div style={{ display:"flex", gap:".6rem", flexWrap:"wrap" }}>
          <button style={btn("ghost")} onClick={openBatchPay} disabled={!vendorBatchOptions.length}>Batch Pay Vendor</button>
          <button style={btn()} onClick={openAdd}>+ Add Bill</button>
        </div>
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
        <select
          style={{ maxWidth:280 }}
          value={vendorFilter}
          onChange={e=>{ setVendorFilter(e.target.value); setBillFilter(""); }}
        >
          <option value="">All vendors</option>
          {vendorFilterOptions.map(v => <option key={v.key} value={v.key}>{v.name} ({v.count})</option>)}
        </select>
        <select style={{ maxWidth:230 }} value={billFilter} onChange={e=>setBillFilter(e.target.value)}>
          <option value="">All bills</option>
          {billFilterOptions.map(billNo => <option key={billNo} value={billNo}>{billNo}</option>)}
        </select>
        <select style={{ maxWidth:170 }} value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["Pending","Part Paid","Paid","Cancelled"].map(s => <option key={s}>{s}</option>)}
        </select>
        <select style={{ maxWidth:190 }} value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        {(vendorFilter || billFilter || status || category) && <button style={btn("ghost")} onClick={()=>{ setVendorFilter(""); setBillFilter(""); setStatus(""); setCategory(""); }}>Clear</button>}
        <button style={btn("ghost")} onClick={exportFilteredCSV} disabled={!filtered.length}>Export Excel</button>
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
                    <td title={row.TDSSectionLabel || row.TDSSection || ""} style={{ color:"var(--warning)", whiteSpace:"nowrap" }}>{tdsDisplay(row)}</td>
                    <td style={{ color:"var(--accent)", fontWeight:700, whiteSpace:"nowrap" }}>{fmt(row.NetPayable)}</td>
                    <td style={{ color:"var(--success)", whiteSpace:"nowrap" }}>{fmt(row.PaidAmount)}</td>
                    <td style={{ color:Number(row.BalanceAmount) > 0 ? "var(--danger)" : "var(--muted)", fontWeight:700, whiteSpace:"nowrap" }}>{fmt(row.BalanceAmount)}</td>
                    <td><Badge value={row.Status} /></td>
                    <td style={{ whiteSpace:"nowrap" }}>
                      <button style={{ ...btn("ghost"), padding:".3rem .6rem" }} onClick={()=>openEdit(row)}>Edit</button>{" "}
                      {row.Status !== "Paid" && row.Status !== "Cancelled" && <button style={{ ...btn("ghost"), padding:".3rem .6rem", color:"var(--success)" }} onClick={()=>markPaid(row)} disabled={saving}>Pay</button>}
                      {" "}
                      <button style={{ ...btn("ghost"), padding:".3rem .6rem", color:"var(--danger)" }} onClick={()=>removePayable(row)} disabled={saving}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {batchOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)", zIndex:90, padding:"2rem 1rem", overflowY:"auto" }}>
          <div style={{ ...card, maxWidth:900, margin:"0 auto" }}>
            <h3 style={{ fontWeight:700, marginBottom:"1rem" }}>Batch Vendor Payment</h3>
            <form onSubmit={saveBatchPayment}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:".85rem", marginBottom:"1rem" }}>
                <div>
                  <label style={label}>Vendor</label>
                  <select value={batchForm.VendorKey} onChange={e=>applyBatchVendor(e.target.value)} required>
                    <option value="">— Select vendor —</option>
                    {vendorBatchOptions.map(v => <option key={v.key} value={v.key}>{v.name} · {v.count} bill{v.count !== 1 ? "s" : ""} · {fmt(v.total)}</option>)}
                  </select>
                </div>
                <div><label style={label}>Payment Date</label><input type="date" value={batchForm.PaymentDate} onChange={e=>setBatch("PaymentDate", e.target.value)} required /></div>
                <div><label style={label}>Payment Mode</label><select value={batchForm.PaymentMode} onChange={e=>setBatch("PaymentMode", e.target.value)}>{["Bank","NEFT","RTGS","IMPS","UPI","Cheque","Cash"].map(o => <option key={o}>{o}</option>)}</select></div>
                <div><label style={label}>Bank Account</label><input value={batchForm.BankAccount} onChange={e=>setBatch("BankAccount", e.target.value)} /></div>
                <div><label style={label}>Reference / UTR</label><input value={batchForm.ReferenceNo} onChange={e=>setBatch("ReferenceNo", e.target.value)} /></div>
                <div>
                  <label style={label}>TDS Treatment</label>
                  <select value={batchForm.TDSMode} onChange={e=>setBatchTDSMode(e.target.value)}>
                    <option value="net_after_tds">Pay net after TDS</option>
                    <option value="gross_pending_tds">Pay gross, keep TDS pending</option>
                  </select>
                </div>
                <div><label style={label}>Paid Amount</label><input type="number" min="0" step="0.01" value={batchForm.PaidAmount} onChange={e=>setBatch("PaidAmount", e.target.value)} /></div>
              </div>

              <div style={{ border:"1px solid var(--border)", borderRadius:"6px", overflow:"hidden" }}>
                <div style={{ padding:".75rem 1rem", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"1rem", flexWrap:"wrap", borderBottom:"1px solid var(--border)" }}>
                  <label style={{ display:"flex", alignItems:"center", gap:".5rem", color:"var(--text)", fontSize:".85rem", fontWeight:700 }}>
                    <input type="checkbox" checked={batchVendorRows.length > 0 && batchForm.PayableIDs.length === batchVendorRows.length} onChange={e=>setAllBatchBills(e.target.checked)} />
                    Select all bills
                  </label>
                  <span style={{ color:"var(--accent)", fontWeight:800 }}>{batchForm.PayableIDs.length} selected · Gross {fmt(selectedBatchGross)} · TDS {fmt(selectedBatchTDS)} · Net {fmt(selectedBatchTotal)} · Paying {fmt(batchForm.PaidAmount)}</span>
                </div>
                <div style={{ maxHeight:320, overflowY:"auto" }}>
                  {batchVendorRows.length === 0 ? (
                    <p style={{ padding:"1.5rem", color:"var(--muted)", textAlign:"center" }}>No outstanding bills for this vendor.</p>
                  ) : (
                    <table>
                      <thead><tr><th></th><th>Bill</th><th>Bill Date</th><th>Gross</th><th>TDS</th><th>Net / Balance</th><th>Status</th></tr></thead>
                      <tbody>
                        {batchVendorRows.map(row => (
                          <tr key={row.PayableID}>
                            <td><input type="checkbox" checked={batchForm.PayableIDs.includes(row.PayableID)} onChange={()=>toggleBatchBill(row.PayableID)} /></td>
                            <td style={{ color:"var(--accent2)", whiteSpace:"nowrap" }}>{row.BillNo || "—"}</td>
                            <td style={{ whiteSpace:"nowrap" }}>{formatDate(row.BillDate)}</td>
                            <td style={{ whiteSpace:"nowrap" }}>{fmt(row.GrossAmount)}</td>
                            <td style={{ color:"var(--warning)", whiteSpace:"nowrap" }}>{fmt(row.TDSAmount)}</td>
                            <td style={{ color:"var(--danger)", fontWeight:700, whiteSpace:"nowrap" }}>{fmt(row.BalanceAmount || row.NetPayable)}</td>
                            <td><Badge value={row.Status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div style={{ display:"flex", justifyContent:"flex-end", gap:".75rem", marginTop:"1.25rem", flexWrap:"wrap" }}>
                <button type="button" style={btn("ghost")} onClick={()=>setBatchOpen(false)}>Cancel</button>
                <button type="submit" style={btn()} disabled={saving || !batchForm.PayableIDs.length}>{saving ? "Saving..." : "Mark Selected Paid"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                <div style={{ gridColumn:"1 / -1", border:"1px solid var(--border)", borderRadius:"6px", padding:".8rem", display:"flex", flexDirection:"column", gap:".65rem" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:".75rem", flexWrap:"wrap" }}>
                    <strong style={{ fontSize:".85rem" }}>Tax / GST line items</strong>
                    <button type="button" style={{ ...btn("ghost"), padding:".35rem .65rem" }} onClick={addLineItem}>+ Add line</button>
                  </div>
                  {(form.LineItems || []).map((item, index) => (
                    <div key={index} style={{ display:"grid", gridTemplateColumns:"minmax(160px,1.5fr) repeat(5,minmax(105px,1fr)) auto", gap:".55rem", alignItems:"end" }}>
                      <div><label style={label}>Particulars</label><input value={item.Particulars || ""} onChange={e=>updateLineItem(index, "Particulars", e.target.value)} placeholder="Service / item" /></div>
                      <div><label style={label}>Taxable</label><input type="number" min="0" step="0.01" value={item.TaxableAmount || ""} onChange={e=>updateLineItem(index, "TaxableAmount", e.target.value)} /></div>
                      <div><label style={label}>GST Type</label><select value={item.GSTType || "IGST"} onChange={e=>updateLineItem(index, "GSTType", e.target.value)}><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option><option value="None">No GST</option></select></div>
                      <div><label style={label}>GST %</label><input type="number" min="0" step="0.01" value={item.GSTRate || ""} onChange={e=>updateLineItem(index, "GSTRate", e.target.value)} /></div>
                      <div><label style={label}>TCS</label><input type="number" min="0" step="0.01" value={item.TCSAmount || ""} onChange={e=>updateLineItem(index, "TCSAmount", e.target.value)} /></div>
                      <div><label style={label}>Line Total</label><input readOnly value={fmt(calcLineItem(item).total)} /></div>
                      <button type="button" style={{ ...btn("ghost"), padding:".45rem .55rem", color:"var(--danger)" }} onClick={()=>removeLineItem(index)}>Remove</button>
                    </div>
                  ))}
                  <div style={{ fontSize:".72rem", color:"var(--muted)" }}>
                    Use separate rows when one invoice has 18% GST for one item and 5% GST for another. Totals below are calculated from these rows.
                  </div>
                </div>
                <div><label style={label}>Taxable Value</label><input type="number" min="0" step="0.01" value={form.TaxableAmount} onChange={e=>set("TaxableAmount", e.target.value)} /></div>
                <div><label style={label}>CGST</label><input type="number" min="0" step="0.01" value={form.CGSTAmount} onChange={e=>set("CGSTAmount", e.target.value)} /></div>
                <div><label style={label}>SGST</label><input type="number" min="0" step="0.01" value={form.SGSTAmount} onChange={e=>set("SGSTAmount", e.target.value)} /></div>
                <div><label style={label}>IGST</label><input type="number" min="0" step="0.01" value={form.IGSTAmount} onChange={e=>set("IGSTAmount", e.target.value)} /></div>
                <div><label style={label}>TCS</label><input type="number" min="0" step="0.01" value={form.TCSAmount} onChange={e=>set("TCSAmount", e.target.value)} /></div>
                <div><label style={label}>GST Total</label><input type="text" value={fmt(amounts.gst)} readOnly /></div>
                <div><label style={label}>Gross Bill Amount</label><input type="text" value={fmt(amounts.gross)} readOnly /></div>
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
                <div><span style={{ color:"var(--muted)", fontSize:".72rem" }}>Taxable</span><br/><strong>{fmt(amounts.taxable)}</strong></div>
                <div><span style={{ color:"var(--muted)", fontSize:".72rem" }}>GST Input</span><br/><strong style={{ color:"var(--accent2)" }}>{fmt(amounts.gst)}</strong></div>
                <div><span style={{ color:"var(--muted)", fontSize:".72rem" }}>TCS</span><br/><strong>{fmt(amounts.tcs)}</strong></div>
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
