import { Fragment, useEffect, useState, useMemo } from "react";
import { apiGet, apiPost } from "../api/client";
import { billingMonthOptions } from "../utils/format";
import { useLLP } from "../context/LLPContext";

const initial = {
  PAN: "", ClientName: "", RMName: "",
  TransactionDate: "", Product: "", TransactionType: "", SchemeName: "",
  InvestmentAmount: "", CommissionPercent: "",
  RevenueMonth: "", RevenueAmount: "", YTDValue: "",
  StatementRef: "", Notes: "",
  PartnerName: "", LLPName: "", IncomeType: "",
  InvoiceNo: "", InvoiceMonth: "", InvoiceStatus: "", ReceiptStatus: "",
};

const card  = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const label = { display: "block", fontSize: ".75rem", color: "var(--muted)", marginBottom: ".35rem", fontWeight: 500 };
const inp   = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const btn   = (v = "primary") => ({
  padding: ".55rem 1.2rem", borderRadius: "6px",
  fontWeight: 600, fontSize: ".875rem", cursor: "pointer",
  background: v === "primary" ? "var(--accent)" : v === "outline" ? "transparent" : "transparent",
  color: v === "primary" ? "#fff" : "var(--muted)",
  border: v === "outline" ? "1px solid var(--border)" : "none",
});
const fmt   = n => (n != null && n !== "" && Number(n) !== 0) ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—";
const revenueTypeLabel = v => String(v || "").trim().toUpperCase() === "ARR" ? "ARR" : "TRB";
const secTitle = { fontWeight: 600, marginBottom: ".75rem", fontSize: ".78rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" };

export default function NeoRevenue({ role = "admin", employeeRef = "", fullName = "", user = "" }) {
  const [rows,     setRows]     = useState([]);
  const { currentLLP } = useLLP();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const isPartnerRole = normalizedRole === "partner";
  const ownPartnerName = String(employeeRef || fullName || user || "").trim();
  const canManageRevenue = ["admin", "managing_partner"].includes(normalizedRole);
  const [form,     setForm]     = useState(initial);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [search,   setSearch]   = useState("");      // by ClientName or PAN
  const [monthFilter, setMonthFilter] = useState(""); // by RevenueMonth
  const [partnerFilter, setPartnerFilter] = useState("");
  const [clients,  setClients]  = useState([]);
  const [partners, setPartners] = useState([]);
  const [llps,     setLlps]     = useState([]);
  const [revenueMeta, setRevenueMeta] = useState({ months: [], partners: [], schemes: [], totalRows: 0 });
  const [activeTab,setActiveTab]= useState("data");  // "data" | "reports"
  const [dataPage, setDataPage] = useState(1);
  const [dataPageSize] = useState(100);
  // Reports state
  const [report,       setReport]       = useState(null);
  const [reportLoading,setReportLoading]= useState(false);
  const [reportMonth,  setReportMonth]  = useState("");
  const [reportFromMonth, setReportFromMonth] = useState("");
  const [reportToMonth, setReportToMonth] = useState("");
  const [reportFY, setReportFY] = useState("");
  const [reportFromDate, setReportFromDate] = useState("");
  const [reportToDate, setReportToDate] = useState("");
  const [reportPartner,setReportPartner]= useState("");
  const [reportSuperFamily, setReportSuperFamily] = useState("");
  const [reportFamily, setReportFamily] = useState("");
  const [reportScheme, setReportScheme] = useState("");
  const [reportPAN, setReportPAN] = useState("");
  const [reportRevenueType, setReportRevenueType] = useState("");
  const [reportView,   setReportView]   = useState("client"); // client|partner|llp|scheme|month|invoice
  const [deleting,     setDeleting]     = useState(null); // RevenueID being deleted
  const currentScopeLLPName = () => {
    // Neo Revenue imports may not exactly match the selected LLP name.
    // For admin / managing partner, show all Neo Revenue by default.
    if (!isPartnerRole) return "__ALL__";

    if (currentLLP?.global) return "";
    return currentLLP?.llpName || currentLLP?.LLPName || currentLLP?.Name || "";
  };

  async function handleDelete(row) {
    if (!window.confirm(`Delete entry for "${row.ClientName}" (${row.RevenueMonth})? This cannot be undone.`)) return;
    setDeleting(row.RevenueID);
    try {
      const r = await apiPost("deleteNeoRevenue", { RevenueID: row.RevenueID });
      if (r.ok) load();
      else alert(r.error || "Delete failed");
    } catch { alert("Delete failed"); }
    finally { setDeleting(null); }
  }

  function neoRevenueScopeParams(extra = {}) {
    const llpName = currentScopeLLPName();
    return {
      ...(llpName ? { llpName } : {}),
      ...(isPartnerRole && ownPartnerName ? {
        partnerName: ownPartnerName,
        requesterRole: normalizedRole,
        requesterName: ownPartnerName,
      } : {}),
      ...extra,
    };
  }

  async function loadDataPage(page = dataPage, pageSize = dataPageSize, overrides = {}) {
    setLoading(true);
    try {
      const activePartner = isPartnerRole ? ownPartnerName : partnerFilter;
      const params = neoRevenueScopeParams({
        offset: (page - 1) * pageSize,
        limit: pageSize,
        ...(search ? { search } : {}),
        ...(monthFilter ? { month: monthFilter } : {}),
        ...(reportFY ? { financialYear: reportFY } : {}),
        ...(activePartner ? { partnerName: activePartner } : {}),
        ...overrides,
      });
      const rev = await apiGet("getNeoRevenue", params);
      if (rev.ok) {
        setRows((rev.data || []).map(r => ({ ...r, RevenueMonth: normRevMonth(r.RevenueMonth) })));
        setDataPage(Math.floor(Number(rev.offset || 0) / Number(rev.limit || pageSize)) + 1);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Unable to load Neo Revenue", err);
    } finally { setLoading(false); }
  }

  async function loadMetaAndMasters() {
    try {
      const scopeParams = neoRevenueScopeParams();
      const [meta, cli, par, llp] = await Promise.allSettled([
        apiGet("getNeoRevenueMeta", scopeParams),
        apiGet("getClients"),
        apiGet("getPartners"),
        apiGet("getLLPs"),
      ]);
      if (meta.status === "fulfilled" && meta.value.ok) {
        setRevenueMeta({
          months: (meta.value.months || []).map(normRevMonth),
          partners: meta.value.partners || [],
          schemes: meta.value.schemes || [],
          totalRows: Number(meta.value.totalRows || 0),
        });
      }
      if (cli.status === "fulfilled" && cli.value.ok) setClients(cli.value.data || []);
      if (par.status === "fulfilled" && par.value.ok) setPartners(par.value.data || []);
      if (llp.status === "fulfilled" && llp.value.ok) setLlps(llp.value.data || []);
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Unable to load Neo Revenue metadata", err);
    }
  }

  async function load(page = dataPage) {
    await Promise.all([loadMetaAndMasters(), loadDataPage(page)]);
  }

  useEffect(() => {
    setDataPage(1);
    loadMetaAndMasters();
  }, [currentLLP?.global, currentLLP?.llpName, currentLLP?.LLPName, currentLLP?.Name, normalizedRole, ownPartnerName]);

  useEffect(() => {
    const timer = setTimeout(() => loadDataPage(dataPage), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [currentLLP?.global, currentLLP?.llpName, currentLLP?.LLPName, currentLLP?.Name, normalizedRole, ownPartnerName, dataPage, dataPageSize, search, monthFilter, reportFY, partnerFilter]);

  useEffect(() => { setDataPage(1); }, [search, monthFilter, reportFY, partnerFilter, dataPageSize]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const effectiveReportPartner = isPartnerRole ? ownPartnerName : reportPartner;

  const partnerOptions = useMemo(() => {
    const names = new Set();
    (revenueMeta.partners || []).forEach(p => {
      const name = String(p || "").trim();
      if (name) names.add(name);
    });
    partners.forEach(p => {
      const name = String(p.PartnerName || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [partners, revenueMeta.partners]);

  const familyOptions = useMemo(() => {
    const names = new Set();
    clients.forEach(c => {
      const name = String(c.FamilyName || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const superFamilyOptions = useMemo(() => {
    const names = new Set();
    clients.forEach(c => {
      const name = String(c.SuperFamilyName || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  const schemeOptions = useMemo(() => {
    const names = new Set();
    (revenueMeta.schemes || []).forEach(r => {
      const name = String(r || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [revenueMeta.schemes]);

  function reportParams(overrides = {}) {
    const month = overrides.month !== undefined ? overrides.month : reportMonth;
    const partner = overrides.partner !== undefined ? overrides.partner : effectiveReportPartner;
    const fromMonth = overrides.fromMonth !== undefined ? overrides.fromMonth : reportFromMonth;
    const toMonth = overrides.toMonth !== undefined ? overrides.toMonth : reportToMonth;
    const financialYear = overrides.financialYear !== undefined ? overrides.financialYear : reportFY;
    const fromDate = overrides.fromDate !== undefined ? overrides.fromDate : reportFromDate;
    const toDate = overrides.toDate !== undefined ? overrides.toDate : reportToDate;
    const superFamilyName = overrides.superFamilyName !== undefined ? overrides.superFamilyName : reportSuperFamily;
    const familyName = overrides.familyName !== undefined ? overrides.familyName : reportFamily;
    const schemeName = overrides.schemeName !== undefined ? overrides.schemeName : reportScheme;
    const pan = overrides.pan !== undefined ? overrides.pan : reportPAN;
    const revenueType = overrides.revenueType !== undefined ? overrides.revenueType : reportRevenueType;
    const llpName = currentScopeLLPName();
    return {
      ...(month ? { month } : {}),
      ...(fromMonth ? { fromMonth } : {}),
      ...(toMonth ? { toMonth } : {}),
      ...(financialYear ? { financialYear } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(llpName ? { llpName } : {}),
      ...(partner ? { partnerName: partner } : {}),
      ...(superFamilyName ? { superFamilyName } : {}),
      ...(familyName ? { familyName } : {}),
      ...(schemeName ? { schemeName } : {}),
      ...(pan ? { pan } : {}),
      ...(revenueType ? { revenueType } : {}),
      ...(isPartnerRole && ownPartnerName ? { requesterRole: normalizedRole, requesterName: ownPartnerName } : {}),
    };
  }

  async function refreshReport(overrides = {}) {
    setReportLoading(true);
    try {
      const r = await apiGet("getNeoRevenueReport", reportParams(overrides));
      if (r.ok) setReport(r);
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Unable to load Neo Revenue report", err);
    }
    finally { setReportLoading(false); }
  }

  function drillNeoRevenueReport(field, value, nextView = "client") {
    const val = String(value || "").trim();
    if (!val || val === "—") return;
    const overrides = {};
    if (field === "revenueType") { setReportRevenueType(val); overrides.revenueType = val; }
    if (field === "month") { setReportMonth(val); overrides.month = val; overrides.fromMonth = ""; overrides.toMonth = ""; setReportFromMonth(""); setReportToMonth(""); }
    if (field === "date") { setReportFromDate(val); setReportToDate(val); overrides.fromDate = val; overrides.toDate = val; }
    if (field === "partner" && !isPartnerRole) { setReportPartner(val); overrides.partner = val; }
    if (field === "superFamily") { setReportSuperFamily(val); overrides.superFamilyName = val; }
    if (field === "family") { setReportFamily(val); overrides.familyName = val; }
    if (field === "scheme") { setReportScheme(val); overrides.schemeName = val; }
    if (field === "pan") { setReportPAN(val.toUpperCase()); overrides.pan = val.toUpperCase(); }
    setReportView(nextView);
    setReport(null);
    refreshReport(overrides);
  }

  function openAdd()  { setForm(initial); setEditId(null); setFormOpen(true); }
  function openEdit(row) {
    setForm({
      PAN: row.PAN || "", ClientName: row.ClientName || "", RMName: row.RMName || "",
      TransactionDate: row.TransactionDate?.toString().slice(0, 10) || "",
      Product: row.Product || "", TransactionType: row.TransactionType || "",
      SchemeName: row.SchemeName || "",
      InvestmentAmount: row.InvestmentAmount || "", CommissionPercent: row.CommissionPercent || "",
      RevenueMonth: row.RevenueMonth || "", RevenueAmount: row.RevenueAmount || "",
      YTDValue: row.YTDValue || "", StatementRef: row.StatementRef || "", Notes: row.Notes || "",
      PartnerName: row.PartnerName || "", LLPName: row.LLPName || "",
      IncomeType: row.IncomeType || "", InvoiceNo: row.InvoiceNo || "",
      InvoiceMonth: row.InvoiceMonth || "", InvoiceStatus: row.InvoiceStatus || "",
      ReceiptStatus: row.ReceiptStatus || "",
    });
    setEditId(row.RevenueID);
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const action  = editId ? "updateNeoRevenue" : "saveNeoRevenue";
      const payload = editId ? { ...form, RevenueID: editId } : form;
      const r = await apiPost(action, payload);
      if (r.ok) { setFormOpen(false); setEditId(null); setForm(initial); load(); }
      else alert(r.error || "Error saving");
    } finally { setSaving(false); }
  }

  // Unique months for filter dropdown — sorted in FY order (Apr → Mar).
  // Use metadata because rows only contains the current paginated data page.
  const months = useMemo(() => {
    const FY_ORDER = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
    const moSort = mo => {
      if (!mo) return 99999;
      const [m, y] = mo.split("-");
      const mi = FY_ORDER.indexOf(m);
      const yr = parseInt(y, 10) || 0;
      return yr * 100 + (mi === -1 ? 99 : mi);
    };
    const set = new Set([
      ...(revenueMeta.months || []),
      ...rows.map(r => r.RevenueMonth),
    ].filter(Boolean));
    return Array.from(set).sort((a, b) => moSort(a) - moSort(b));
  }, [revenueMeta.months, rows]);

  const fyOptions = useMemo(() => Array.from(new Set(months.map(fyFromRevenueMonth).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b)), [months]);

  // Do not auto-select FY.
  // Auto FY filter can hide imported old Sheet data.
  useEffect(() => {
    return;
  }, [fyOptions, reportFY]);

  const monthsInSelectedFY = useMemo(() => (
    reportFY ? months.filter(m => fyFromRevenueMonth(m) === reportFY) : months
  ), [months, reportFY]);

  useEffect(() => {
    if (monthFilter && reportFY && fyFromRevenueMonth(monthFilter) !== reportFY) {
      setMonthFilter("");
    }
    if (reportMonth && reportFY && fyFromRevenueMonth(reportMonth) !== reportFY) {
      setReportMonth("");
    }
    if (reportFromMonth && reportFY && fyFromRevenueMonth(reportFromMonth) !== reportFY) {
      setReportFromMonth("");
    }
    if (reportToMonth && reportFY && fyFromRevenueMonth(reportToMonth) !== reportFY) {
      setReportToMonth("");
    }
  }, [reportFY, monthFilter, reportMonth, reportFromMonth, reportToMonth]);

  const filtered = useMemo(() => {
    const MONTH_ORDER = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
    function moSort(mo) {
      if (!mo) return 99999;
      const [m, y] = mo.split("-");
      const mi = MONTH_ORDER.indexOf(m);
      const yr = parseInt(y, 10) || 0;
      // Apr-2025 = FY start; Jan onwards belongs to next calendar year but same FY
      return yr * 100 + (mi === -1 ? 99 : mi);
    }
    return rows
      .filter(r => {
        const s = search.toLowerCase();
        const matchSearch = !s ||
          (r.ClientName || "").toLowerCase().includes(s) ||
          (r.PAN        || "").toLowerCase().includes(s);
        const matchMonth = !monthFilter || r.RevenueMonth === monthFilter;
        const matchFY = !reportFY || fyFromRevenueMonth(r.RevenueMonth) === reportFY;
        const activePartner = isPartnerRole ? ownPartnerName : partnerFilter;
        const matchPartner = !activePartner ||
          String(r.PartnerName || r.RMName || "").trim().toLowerCase() === String(activePartner).trim().toLowerCase();
        return matchSearch && matchMonth && matchFY && matchPartner;
      })
      .sort((a, b) => moSort(a.RevenueMonth) - moSort(b.RevenueMonth));
  }, [rows, search, monthFilter, reportFY, partnerFilter, isPartnerRole, ownPartnerName]);

  const summaryRows = useMemo(() => rows.filter(r => {
    const s = search.toLowerCase();
    const matchSearch = !s ||
      (r.ClientName || "").toLowerCase().includes(s) ||
      (r.PAN || "").toLowerCase().includes(s);
    const activePartner = isPartnerRole ? ownPartnerName : partnerFilter;
    const matchPartner = !activePartner ||
      String(r.PartnerName || r.RMName || "").trim().toLowerCase() === String(activePartner).trim().toLowerCase();
    const matchFY = !reportFY || fyFromRevenueMonth(r.RevenueMonth) === reportFY;
    return matchSearch && matchPartner && matchFY;
  }), [rows, search, reportFY, partnerFilter, isPartnerRole, ownPartnerName]);

  const latestRevenueMonth = useMemo(() => {
    if (monthFilter) return monthFilter;
    return summaryRows.reduce((latest, r) => {
      if (!r.RevenueMonth) return latest;
      return !latest || revenueMonthSortValue(r.RevenueMonth) > revenueMonthSortValue(latest)
        ? r.RevenueMonth
        : latest;
    }, "");
  }, [summaryRows, monthFilter]);

  const totalRevenue = useMemo(() => {
    const revenueRows = latestRevenueMonth
      ? summaryRows.filter(r => r.RevenueMonth === latestRevenueMonth)
      : filtered;
    return revenueRows.reduce((s, r) => s + Number(r.RevenueAmount || 0), 0);
  }, [filtered, summaryRows, latestRevenueMonth]);

  // FY YTD is revenue from April through the selected/latest visible revenue month.
  const totalYTD = useMemo(() => {
    const cutoffLabel = latestRevenueMonth;
    if (!cutoffLabel) return 0;
    const cutoff = revenueMonthSortValue(cutoffLabel);
    const fy = fyFromRevenueMonth(cutoffLabel);
    return summaryRows.reduce((sum, r) => {
      if (fyFromRevenueMonth(r.RevenueMonth) !== fy || revenueMonthSortValue(r.RevenueMonth) > cutoff) return sum;
      return sum + Number(r.RevenueAmount || 0);
    }, 0);
  }, [summaryRows, latestRevenueMonth]);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>Neo Revenue</h2>
          <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>
            Commission statements from Neo &nbsp;·&nbsp; {rows.length} rows
          </p>
        </div>
        <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: ".45rem", color: "var(--muted)", fontSize: ".78rem", fontWeight: 600 }}>
            FY
            <select
              style={{ ...inp, width: "auto", minWidth: "125px", padding: ".55rem .75rem" }}
              value={reportFY}
              onChange={e => {
                const nextFY = e.target.value;
                const nextMonth = nextFY && fyFromRevenueMonth(reportMonth) !== nextFY ? "" : reportMonth;
                const nextFromMonth = nextFY && fyFromRevenueMonth(reportFromMonth) !== nextFY ? "" : reportFromMonth;
                const nextToMonth = nextFY && fyFromRevenueMonth(reportToMonth) !== nextFY ? "" : reportToMonth;
                setReportFY(nextFY);
                setReportMonth(nextMonth);
                setReportFromMonth(nextFromMonth);
                setReportToMonth(nextToMonth);
                setReport(null);
                if (activeTab === "reports") {
                  refreshReport({
                    financialYear: nextFY,
                    month: nextMonth,
                    fromMonth: nextFromMonth,
                    toMonth: nextToMonth,
                  });
                }
              }}
            >
              <option value="">All FYs</option>
              {fyOptions.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>
          </label>
          {canManageRevenue && <button style={btn("primary")} onClick={openAdd}>+ New Revenue Entry</button>}
        </div>
      </div>

      {/* Summary */}
      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: ".75rem" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: ".3rem" }}>
              {latestRevenueMonth ? `${latestRevenueMonth} Revenue` : "Latest Month Revenue"}
            </div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--accent)" }}>{fmt(totalRevenue)}</div>
          </div>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: ".3rem" }}>FY YTD (from Apr 1)</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#22d3ee" }}>{fmt(totalYTD)}</div>
          </div>
        </div>
      )}

      {/* ── FORM MODAL ──────────────────────────────────────────────────── */}
      {formOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 100, overflowY: "auto", padding: "1.5rem 1rem" }}>
          <div style={{ maxWidth: "680px", margin: "0 auto", background: "var(--card)", borderRadius: "var(--radius)", padding: "1.5rem", border: "1px solid var(--border)" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                {editId ? "Edit Revenue Entry" : "New Revenue Entry"}
              </h3>
              <button style={btn("ghost")} onClick={() => setFormOpen(false)}>✕</button>
            </div>

            <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

              {/* Client Info */}
              <div>
                <div style={secTitle}>Client Info</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: ".75rem" }}>
                  <div><label style={label}>PAN</label>
                    <input style={inp} value={form.PAN} onChange={e => set("PAN", e.target.value)}
                      list="rev-pan-list" autoComplete="off" />
                    <datalist id="rev-pan-list">
                      {clients.map(c => c.PAN ? <option key={c.ClientID} value={c.PAN}>{c.ClientName}</option> : null)}
                    </datalist></div>
                  <div><label style={label}>Client Name <span style={{ color: "var(--accent)" }}>*</span></label>
                    <input style={inp} value={form.ClientName} onChange={e => {
                      set("ClientName", e.target.value);
                      const found = clients.find(c => c.ClientName === e.target.value);
                      if (found) {
                        if (!form.PAN) set("PAN", found.PAN || "");
                        if (!form.PartnerName) set("PartnerName", found.PartnerName || found.RMName || "");
                      }
                    }} required list="rev-client-list" autoComplete="off" />
                    <datalist id="rev-client-list">
                      {clients.map(c => <option key={c.ClientID} value={c.ClientName} />)}
                    </datalist></div>
                  <div><label style={label}>Partner Name</label>
                    <input style={inp} value={form.PartnerName} onChange={e => set("PartnerName", e.target.value)}
                      list="rev-partner-list" autoComplete="off" />
                    <datalist id="rev-partner-list">
                      {partners.map(p => <option key={p.PartnerID} value={p.PartnerName} />)}
                    </datalist></div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)" }} />

              {/* Transaction */}
              <div>
                <div style={secTitle}>Transaction</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: ".75rem" }}>
                  <div><label style={label}>Transaction Date</label>
                    <input type="date" style={inp} value={form.TransactionDate} onChange={e => set("TransactionDate", e.target.value)} /></div>
                  <div><label style={label}>Product</label>
                    <input style={inp} placeholder="AIF, MF, PMS…" value={form.Product} onChange={e => set("Product", e.target.value)} /></div>
                  <div><label style={label}>Transaction Type</label>
                    <input style={inp} placeholder="Purchase, SIP…" value={form.TransactionType} onChange={e => set("TransactionType", e.target.value)} /></div>
                </div>
                <div style={{ marginTop: ".75rem" }}>
                  <label style={label}>Scheme Name</label>
                  <input style={inp} value={form.SchemeName} onChange={e => set("SchemeName", e.target.value)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: ".75rem", marginTop: ".75rem" }}>
                  <div><label style={label}>Investment Amount</label>
                    <input type="number" min="0" style={inp} value={form.InvestmentAmount} onChange={e => set("InvestmentAmount", e.target.value)} /></div>
                  <div><label style={label}>Commission %</label>
                    <input type="number" min="0" max="100" step="0.01" style={inp} value={form.CommissionPercent} onChange={e => set("CommissionPercent", e.target.value)} /></div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)" }} />

              {/* Attribution & Invoice */}
              <div>
                <div style={secTitle}>Attribution &amp; Invoice</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: ".75rem" }}>
                  <div><label style={label}>LLP Name</label>
                    <input style={inp} value={form.LLPName} onChange={e => set("LLPName", e.target.value)}
                      list="rev-llp-list" autoComplete="off" />
                    <datalist id="rev-llp-list">
                      {llps.map(l => <option key={l.LLPID} value={l.LLPName} />)}
                    </datalist></div>
                  <div><label style={label}>Income Type</label>
                    <select style={inp} value={form.IncomeType} onChange={e => set("IncomeType", e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Trail</option>
                      <option>Upfront</option>
                      <option>Advisory</option>
                      <option>Other</option>
                    </select></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: ".75rem", marginTop: ".75rem" }}>
                  <div><label style={label}>Invoice No</label>
                    <input style={inp} value={form.InvoiceNo} onChange={e => set("InvoiceNo", e.target.value)} /></div>
                  <div><label style={label}>Invoice Month</label>
                    <select style={inp} value={form.InvoiceMonth} onChange={e => set("InvoiceMonth", e.target.value)}>
                      <option value="">— Select —</option>
                      {billingMonthOptions().map(m => <option key={m}>{m}</option>)}
                    </select></div>
                  <div><label style={label}>Invoice Status</label>
                    <select style={inp} value={form.InvoiceStatus} onChange={e => set("InvoiceStatus", e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Draft</option>
                      <option>Sent</option>
                      <option>Paid</option>
                      <option>Cancelled</option>
                    </select></div>
                  <div><label style={label}>Receipt Status</label>
                    <select style={inp} value={form.ReceiptStatus} onChange={e => set("ReceiptStatus", e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Pending</option>
                      <option>Received</option>
                      <option>Partial</option>
                    </select></div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)" }} />

              {/* Revenue */}
              <div>
                <div style={secTitle}>Revenue</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: ".75rem" }}>
                  <div><label style={label}>Revenue Month <span style={{ color: "var(--accent)" }}>*</span></label>
                    <select style={inp} value={form.RevenueMonth} onChange={e => set("RevenueMonth", e.target.value)} required>
                      <option value="">— Select month —</option>
                      {billingMonthOptions().map(m => <option key={m}>{m}</option>)}
                    </select></div>
                  <div><label style={label}>Revenue Amount</label>
                    <input type="number" min="0" style={inp} value={form.RevenueAmount} onChange={e => set("RevenueAmount", e.target.value)} /></div>
                  <div><label style={label}>YTD Value</label>
                    <input type="number" min="0" style={inp} value={form.YTDValue} onChange={e => set("YTDValue", e.target.value)} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: ".75rem", marginTop: ".75rem" }}>
                  <div><label style={label}>Statement Ref</label>
                    <input style={inp} placeholder="Neo statement ref / file" value={form.StatementRef} onChange={e => set("StatementRef", e.target.value)} /></div>
                  <div><label style={label}>Notes</label>
                    <input style={inp} value={form.Notes} onChange={e => set("Notes", e.target.value)} /></div>
                </div>
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: ".75rem", justifyContent: "flex-end", paddingTop: ".25rem" }}>
                <button type="button" style={btn("ghost")} onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" style={btn("primary")} disabled={saving}>
                  {saving ? "Saving…" : editId ? "Update" : "Save"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ── TAB SWITCHER ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: ".5rem", borderBottom: "2px solid var(--border)", paddingBottom: 0 }}>
        {[{ key: "data", label: "📋 Data" }, { key: "reports", label: "📊 Reports" }].map(t => (
          <button
            key={t.key}
            onClick={() => {
              setActiveTab(t.key);
              if (t.key === "reports" && !report && !reportLoading) {
                refreshReport();
              }
            }}
            style={{
              padding: ".45rem 1.1rem", borderRadius: "6px 6px 0 0",
              border: "none", fontWeight: 600, fontSize: ".85rem", cursor: "pointer",
              background: activeTab === t.key ? "var(--accent)" : "transparent",
              color:      activeTab === t.key ? "#fff"          : "var(--muted)",
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── FILTERS ─────────────────────────────────────────────────────── */}
      {activeTab === "reports" && (
        <ReportsPanel
          report={report} loading={reportLoading} reportView={reportView}
          setReportView={setReportView} reportMonth={reportMonth}
          reportFromMonth={reportFromMonth} setReportFromMonth={setReportFromMonth}
          reportToMonth={reportToMonth} setReportToMonth={setReportToMonth}
          reportFromDate={reportFromDate} setReportFromDate={setReportFromDate}
          reportToDate={reportToDate} setReportToDate={setReportToDate}
          reportSuperFamily={reportSuperFamily} setReportSuperFamily={setReportSuperFamily}
          reportFamily={reportFamily} setReportFamily={setReportFamily}
          reportScheme={reportScheme} setReportScheme={setReportScheme}
          reportPAN={reportPAN} setReportPAN={setReportPAN}
          reportRevenueType={reportRevenueType} setReportRevenueType={setReportRevenueType}
          reportPartner={effectiveReportPartner}
          onMonthChange={m => {
            setReportMonth(m);
            setReport(null);
            refreshReport({ month: m });
          }}
          onPartnerChange={p => {
            if (isPartnerRole) return;
            setReportPartner(p);
            setReport(null);
            refreshReport({ partner: p });
          }}
          partnerOptions={partnerOptions}
          superFamilyOptions={superFamilyOptions}
          familyOptions={familyOptions}
          schemeOptions={schemeOptions}
          canFilterPartner={!isPartnerRole}
          onApply={() => { setReport(null); refreshReport(); }}
          onClear={() => {
            setReportMonth("");
            setReportFromMonth("");
            setReportToMonth("");
            setReportFromDate("");
            setReportToDate("");
            setReportSuperFamily("");
            setReportFamily("");
            setReportScheme("");
            setReportPAN("");
            setReportRevenueType("");
            if (!isPartnerRole) setReportPartner("");
            setReport(null);
            refreshReport({ month: "", fromMonth: "", toMonth: "", financialYear: reportFY, fromDate: "", toDate: "", superFamilyName: "", familyName: "", schemeName: "", pan: "", revenueType: "", partner: isPartnerRole ? ownPartnerName : "" });
          }}
          months={monthsInSelectedFY}
          onDrill={drillNeoRevenueReport}
        />
      )}
      {activeTab === "data" && (
      <>
      <div style={{ ...card, display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          style={{ ...inp, maxWidth: "260px" }}
          placeholder="Search by Client Name or PAN…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          style={{ ...inp, maxWidth: "180px" }}
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
        >
          <option value="">All Months</option>
          {monthsInSelectedFY.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {!isPartnerRole && (
          <select
            style={{ ...inp, maxWidth: "220px" }}
            value={partnerFilter}
            onChange={e => setPartnerFilter(e.target.value)}
          >
            <option value="">All Partners</option>
            {partnerOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {(search || monthFilter || partnerFilter) && (
          <button style={btn("ghost")} onClick={() => { setSearch(""); setMonthFilter(""); setPartnerFilter(""); }}>
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: ".8rem", color: "var(--muted)" }}>
          {filtered.length} of {rows.length} rows
        </span>
      </div>

      {/* ── TABLE ───────────────────────────────────────────────────────── */}
      <div style={card}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>
            {rows.length === 0 ? "No entries yet. Click \"+ New Revenue Entry\" to add one." : "No rows match your filter."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Month","PAN","Client","Partner","Product","Txn Type","Scheme","Inv. Amt","Comm%","Rev. Amt","YTD","Ref",""].map(h =>
                    <th key={h} style={{ padding: ".5rem .65rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.RevenueID} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: ".5rem .65rem", fontWeight: 600, whiteSpace: "nowrap" }}>{row.RevenueMonth || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)", fontSize: ".78rem" }}>{row.PAN || "—"}</td>
                    <td style={{ padding: ".5rem .65rem" }}>{row.ClientName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{row.PartnerName || row.RMName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)" }}>{row.Product || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", color: revenueTypeLabel(row.TransactionType) === "ARR" ? "#22d3ee" : "#f59e0b", fontWeight: 600 }}>{revenueTypeLabel(row.TransactionType)}</td>
                    <td style={{ padding: ".5rem .65rem", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.SchemeName}>{row.SchemeName || "—"}</td>
                    <td style={{ padding: ".5rem .65rem", whiteSpace: "nowrap" }}>{fmt(row.InvestmentAmount)}</td>
                    <td style={{ padding: ".5rem .65rem" }}>{row.CommissionPercent != null && row.CommissionPercent !== "" ? row.CommissionPercent + "%" : "—"}</td>
                    <td style={{ padding: ".5rem .65rem", fontWeight: 600, color: "var(--accent)", whiteSpace: "nowrap" }}>{fmt(row.RevenueAmount)}</td>
                    <td style={{ padding: ".5rem .65rem", whiteSpace: "nowrap" }}>{fmt(row.YTDValue)}</td>
                    <td style={{ padding: ".5rem .65rem", color: "var(--muted)", fontSize: ".78rem" }}>{row.StatementRef || "—"}</td>
                    <td style={{ padding: ".5rem .4rem", whiteSpace: "nowrap" }}>
                      {canManageRevenue ? (
                        <>
                          <button style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem" }} onClick={() => openEdit(row)}>Edit</button>
                          <button
                            style={{ ...btn("ghost"), padding: ".25rem .6rem", fontSize: ".78rem", color: "#f87171", marginLeft: ".3rem" }}
                            disabled={deleting === row.RevenueID}
                            onClick={() => handleDelete(row)}
                          >{deleting === row.RevenueID ? "…" : "Delete"}</button>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>
      )}

    </div>
  );
}

// Normalize RevenueMonth: Google Sheets auto-converts "Sep-2025" to a date serial.
// GAS returns it as an ISO string (UTC). Add IST offset (+5:30) to recover the original month.
function normRevMonth(val) {
  if (!val) return val;
  const s = String(val);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s; // already a string like "Sep-2025"
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date(new Date(s).getTime() + 5.5 * 3600 * 1000); // shift to IST
  return MONTHS[d.getUTCMonth()] + "-" + d.getUTCFullYear();
}

const VIEWS = [
  { key: "client",  label: "By Client" },
  { key: "superFamily", label: "By Super Family" },
  { key: "family",  label: "By Family" },
  { key: "partner", label: "By Partner" },
  { key: "llp",     label: "By LLP" },
  { key: "scheme",  label: "By Scheme" },
  { key: "month",   label: "By Month" },
  { key: "invoice", label: "Invoice Reconciliation" },
  { key: "share",   label: "⚖️ Share-wise" },
  { key: "date",    label: "By Date" },
];

const fmt2 = n => (n != null && n !== "" && Number(n) !== 0)
  ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })
  : "—";

const card2 = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const inp2  = { boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
function revenueMonthSortValue(value) {
  const match = String(value || "").match(/^([A-Za-z]{3})-(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const month = months[match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase()];
  return Number(match[2]) * 12 + (month ?? 99);
}
function fyFromRevenueMonth(value) {
  const n = revenueMonthSortValue(value);
  if (n === Number.MAX_SAFE_INTEGER) return "";
  const year = Math.floor(n / 12);
  const start = n % 12 >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function ReportsPanel({
  report, loading, reportView, setReportView, reportMonth, onMonthChange, months,
  reportFromMonth, setReportFromMonth, reportToMonth, setReportToMonth,
  reportFromDate, setReportFromDate, reportToDate, setReportToDate,
  reportSuperFamily, setReportSuperFamily, reportFamily, setReportFamily, reportScheme, setReportScheme, reportPAN, setReportPAN,
  reportRevenueType, setReportRevenueType,
  reportPartner, onPartnerChange, partnerOptions, superFamilyOptions, familyOptions, schemeOptions, canFilterPartner, onApply, onClear, onDrill,
}) {
  const kpis = report?.kpis || {};
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const rawData = reportView === "invoice"  ? (report?.invoiceReconciliation || [])
                : reportView === "share"    ? (report?.partnerShareWise      || [])
                : reportView === "date"     ? (report?.dateWise              || [])
                : (report?.[reportView + "Wise"] || []);

  // Reset sort when view changes
  useEffect(() => { setSortCol(null); setSortDir("asc"); }, [reportView]);

  const sortKey = {
    client:  { "Client": "ClientName", "PAN": "PAN", "Super Family": "SuperFamilyName", "Family": "FamilyName", "Partner": "PartnerName", "LLP": "LLPName", "Max Investment": "MaxInvestmentAmount", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "YTD": "TotalYTD", "Txns": "TxnCount" },
    superFamily: { "Super Family": "SuperFamilyName", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "AUM": "TotalAUM", "Families": "FamilyCount", "Clients": "ClientCount", "Partners": "PartnerCount", "LLPs": "LLPCount" },
    family:  { "Family": "FamilyName", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "AUM": "TotalAUM", "Clients": "ClientCount", "Partners": "PartnerCount", "LLPs": "LLPCount" },
    partner: { "Partner": "PartnerName", "LLP": "LLPName", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "YTD": "TotalYTD", "Clients": "ClientCount", "Txns": "TxnCount" },
    llp:     { "LLP": "LLPName", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "YTD": "TotalYTD", "Partners": "PartnerCount", "Clients": "ClientCount", "Txns": "TxnCount" },
    scheme:  { "Scheme": "SchemeName", "Product": "Product", "Income Type": "IncomeType", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "YTD": "TotalYTD", "Clients": "ClientCount" },
    month:   { "Month": "RevenueMonth", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "YTD": "TotalYTD", "Clients": "ClientCount", "Partners": "PartnerCount" },
    invoice: { "Invoice No": "InvoiceNo", "Invoice Month": "InvoiceMonth", "Invoice Status": "InvoiceStatus", "Receipt Status": "ReceiptStatus", "Clients": "ClientCount", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue" },
    share:   { "Partner": "PartnerName", "LLP": "LLPName", "Gross Revenue": "GrossRevenue", "Share %": "SharePct", "Share Amount": "ShareAmount", "Clients": "ClientCount" },
    date:    { "Transaction Date": "TransactionDate", "Revenue": "TotalRevenue", "ARR": "ARRRevenue", "TRB": "TRBRevenue", "Clients": "ClientCount", "Partners": "PartnerCount" },
  };

  const data = useMemo(() => {
    if (!sortCol) return rawData;
    const field = (sortKey[reportView] || {})[sortCol];
    if (!field) return rawData;
    return [...rawData].sort((a, b) => {
      const av = a[field] ?? ""; const bv = b[field] ?? "";
      const n = field === "RevenueMonth"
        ? revenueMonthSortValue(av) - revenueMonthSortValue(bv)
        : typeof av === "number" || (!isNaN(Number(av)) && av !== "") ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? n : -n;
    });
  }, [rawData, sortCol, sortDir, reportView]);

  const appliedFilters = [
    reportRevenueType ? { key: "Revenue Type", value: reportRevenueType } : null,
    reportMonth ? { key: "Revenue Month", value: reportMonth } : null,
    !reportMonth && (reportFromMonth || reportToMonth) ? { key: "Revenue Period", value: `${reportFromMonth || "Start"} to ${reportToMonth || "End"}` } : null,
    reportFromDate || reportToDate ? { key: "Transaction Period", value: `${reportFromDate || "Start"} to ${reportToDate || "End"}` } : null,
    canFilterPartner && reportPartner ? { key: "Partner", value: reportPartner } : null,
    reportSuperFamily ? { key: "Super Family", value: reportSuperFamily } : null,
    reportFamily ? { key: "Family", value: reportFamily } : null,
    reportScheme ? { key: "Fund", value: reportScheme } : null,
    reportPAN ? { key: "PAN", value: reportPAN } : null,
  ].filter(Boolean);

  const hiddenHeaders = new Set();
  if (reportRevenueType) { hiddenHeaders.add("ARR"); hiddenHeaders.add("TRB"); }
  if (reportMonth || reportFromMonth || reportToMonth) hiddenHeaders.add("Month");
  if (reportFromDate || reportToDate) hiddenHeaders.add("Transaction Date");
  if (reportPartner) hiddenHeaders.add("Partner");
  if (reportSuperFamily) hiddenHeaders.add("Super Family");
  if (reportFamily) hiddenHeaders.add("Family");
  if (reportScheme) hiddenHeaders.add("Scheme");
  if (reportPAN) hiddenHeaders.add("PAN");

  function handleSort(h) {
    if (sortCol === h) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(h); setSortDir("asc"); }
  }

  const viewHeaders = {
    client:  ["Client", "PAN", "Super Family", "Family", "Partner", "LLP", "Max Investment", "Revenue", "ARR", "TRB", "YTD", "Txns"],
    superFamily: ["Super Family", "Revenue", "ARR", "TRB", "AUM", "Families", "Clients", "Partners", "LLPs"],
    family:  ["Family", "Revenue", "ARR", "TRB", "AUM", "Clients", "Partners", "LLPs"],
    partner: ["Partner", "LLP", "Revenue", "ARR", "TRB", "YTD", "Clients", "Txns"],
    llp:     ["LLP", "Revenue", "ARR", "TRB", "YTD", "Partners", "Clients", "Txns"],
    scheme:  ["Scheme", "Product", "Income Type", "Revenue", "ARR", "TRB", "YTD", "Clients"],
    month:   ["Month", "Revenue", "ARR", "TRB", "YTD", "Clients", "Partners"],
    invoice: ["Invoice No", "Invoice Month", "Invoice Status", "Receipt Status", "Clients", "Revenue", "ARR", "TRB"],
    share:   ["Partner", "LLP", "Gross Revenue", "Share %", "Share Amount", "Clients", "Rule Type"],
    date:    ["Transaction Date", "Revenue", "ARR", "TRB", "Clients", "Partners"],
  };
  const visibleHeaders = (viewHeaders[reportView] || []).filter(h => !hiddenHeaders.has(h));

  function renderRow(row) {
    const drillStyle = { color: "var(--accent)", fontWeight: 700, cursor: "pointer" };
    const td = (val, opts = {}, drill) => (
      <td
        onClick={drill ? drill : undefined}
        style={{ padding: ".45rem .65rem", whiteSpace: "nowrap", ...opts }}
      >
        {val ?? "—"}
      </td>
    );
    const ruleColor = row.RuleType === "client-override" ? "#f59e0b" : row.RuleType === "none" ? "#f87171" : "#818cf8";
    const ruleLabel = row.RuleType === "client-override" ? "client-override" : row.RuleType === "none" ? "unallocated" : "default";
    const cell = {
      "Client": () => td(row.ClientName, drillStyle, () => onDrill?.("pan", row.PAN, "scheme")),
      "PAN": () => td(row.PAN, { ...drillStyle, fontSize: ".78rem" }, () => onDrill?.("pan", row.PAN, "scheme")),
      "Super Family": () => td(row.SuperFamilyName, drillStyle, () => onDrill?.("superFamily", row.SuperFamilyName, "family")),
      "Family": () => td(row.FamilyName, drillStyle, () => onDrill?.("family", row.FamilyName, "client")),
      "Partner": () => td(row.PartnerName, drillStyle, () => onDrill?.("partner", row.PartnerName, "client")),
      "LLP": () => td(row.LLPName, { color: "var(--muted)" }),
      "Max Investment": () => td(fmt2(row.MaxInvestmentAmount)),
      "Revenue": () => td(fmt2(row.TotalRevenue), { fontWeight: 700, color: "var(--accent)" }),
      "ARR": () => td(fmt2(row.ARRRevenue), { color: "#22d3ee", fontWeight: 600 }),
      "TRB": () => td(fmt2(row.TRBRevenue), { color: "#f59e0b", fontWeight: 600 }),
      "YTD": () => td(fmt2(row.TotalYTD)),
      "Txns": () => td(row.TxnCount),
      "AUM": () => td(fmt2(row.TotalAUM)),
      "Families": () => td(row.FamilyCount),
      "Clients": () => td(row.ClientCount),
      "Partners": () => td(row.PartnerCount),
      "LLPs": () => td(row.LLPCount),
      "Scheme": () => td(row.SchemeName, { ...drillStyle, maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }, () => onDrill?.("scheme", row.SchemeName, "client")),
      "Product": () => td(row.Product, { color: "var(--muted)" }),
      "Income Type": () => td(row.IncomeType, { color: "var(--muted)" }),
      "Month": () => td(row.RevenueMonth, drillStyle, () => onDrill?.("month", row.RevenueMonth, "client")),
      "Invoice No": () => td(row.InvoiceNo, { fontFamily: "monospace", fontSize: ".8rem" }),
      "Invoice Month": () => td(row.InvoiceMonth),
      "Invoice Status": () => td(row.InvoiceStatus, { color: row.InvoiceStatus === "Paid" ? "#22c55e" : row.InvoiceStatus === "Sent" ? "#6366f1" : "var(--muted)" }),
      "Receipt Status": () => td(row.ReceiptStatus, { color: row.ReceiptStatus === "Received" ? "#22c55e" : row.ReceiptStatus === "Partial" ? "#f59e0b" : "var(--muted)" }),
      "Gross Revenue": () => td(fmt2(row.GrossRevenue)),
      "Share %": () => td(row.SharePct != null ? `${Number(row.SharePct).toFixed(1)}%` : "—", { color: "var(--muted)" }),
      "Share Amount": () => td(fmt2(row.ShareAmount), { fontWeight: 700, color: "var(--accent)" }),
      "Rule Type": () => td(<span style={{ fontSize:".72rem", padding:".1rem .4rem", borderRadius:"99px", background: ruleColor + "22", color: ruleColor, fontWeight:600 }}>{ruleLabel}</span>),
      "Transaction Date": () => td(row.TransactionDate, { ...drillStyle, fontFamily:"monospace", fontSize:".82rem" }, () => onDrill?.("date", row.TransactionDate, "client")),
    };
    return <>{visibleHeaders.map(h => <Fragment key={h}>{cell[h]?.() || td("—")}</Fragment>)}</>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: ".75rem" }}>
        {[
          { label: "Total Revenue", value: fmt2(kpis.TotalRevenue),              color: "var(--accent)" },
          { label: "ARR Revenue",   value: fmt2(kpis.ARRRevenue),                color: "#22d3ee" },
          { label: "TRB Revenue",   value: fmt2(kpis.TRBRevenue),                color: "#f59e0b" },
          { label: "ARR %",         value: `${Number(kpis.ARRPercent || 0).toFixed(1)}%`, color: "var(--text)" },
          { label: "FY YTD (from Apr 1)", value: fmt2(kpis.TotalYTD),            color: "#22d3ee" },
          { label: "Total Clients", value: kpis.ClientCount ?? 0,                color: "var(--text)" },
          { label: "Unique Funds",  value: report?.schemeWise?.length ?? 0,      color: "var(--text)" },
        ].map(k => (
          <div key={k.label} style={{ ...card2, textAlign: "center" }}>
            <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: ".3rem" }}>{k.label}</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {!!report?.monthWise?.length && (
        <div>
          <div style={{ fontSize: ".75rem", color: "var(--muted)", fontWeight: 600, marginBottom: ".5rem" }}>
            Month Revenue
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: ".6rem" }}>
            {report.monthWise.map(m => (
              <div key={m.RevenueMonth} style={{ ...card2, padding: ".85rem", textAlign: "center" }}>
                <div style={{ fontSize: ".72rem", color: "var(--muted)", marginBottom: ".25rem" }}>{m.RevenueMonth}</div>
                <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)" }}>{fmt2(m.TotalRevenue)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ ...card2, display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Revenue Type
          <select style={{ ...inp2, minWidth: "130px" }} value={reportRevenueType} onChange={e => setReportRevenueType(e.target.value)}>
            <option value="">ARR + TRB</option>
            <option value="ARR">ARR</option>
            <option value="TRB">TRB</option>
          </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Revenue Month
        <select
          style={{ ...inp2, minWidth: "145px" }}
          value={reportMonth}
          onChange={e => onMonthChange(e.target.value)}
        >
          <option value="">All Months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          From Month
          <select style={{ ...inp2, minWidth: "145px" }} value={reportFromMonth} onChange={e => setReportFromMonth(e.target.value)}>
            <option value="">Any</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          To Month
          <select style={{ ...inp2, minWidth: "145px" }} value={reportToMonth} onChange={e => setReportToMonth(e.target.value)}>
            <option value="">Any</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Transaction From
          <input type="date" style={inp2} value={reportFromDate} onChange={e => setReportFromDate(e.target.value)} />
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Transaction To
          <input type="date" style={inp2} value={reportToDate} onChange={e => setReportToDate(e.target.value)} />
        </label>
        {canFilterPartner && (
          <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
            Partner
            <select style={{ ...inp2, minWidth: "180px" }} value={reportPartner} onChange={e => onPartnerChange(e.target.value)}>
              <option value="">All Partners</option>
              {(partnerOptions || []).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Super Family
          <select style={{ ...inp2, minWidth: "210px" }} value={reportSuperFamily} onChange={e => setReportSuperFamily(e.target.value)}>
            <option value="">All Super Families</option>
            {(superFamilyOptions || []).map(f => <option key={f} value={f}>{f}</option>)}
            <option value="Unmapped Super Family">Unmapped Super Family</option>
          </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Family
          <select style={{ ...inp2, minWidth: "190px" }} value={reportFamily} onChange={e => setReportFamily(e.target.value)}>
            <option value="">All Families</option>
            {(familyOptions || []).map(f => <option key={f} value={f}>{f}</option>)}
            <option value="Unmapped Family">Unmapped Family</option>
          </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          Fund
          <select style={{ ...inp2, minWidth: "240px" }} value={reportScheme} onChange={e => setReportScheme(e.target.value)}>
            <option value="">All Funds</option>
            {(schemeOptions || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display:"grid", gap:".25rem", fontSize:".72rem", color:"var(--muted)" }}>
          PAN
          <input style={{ ...inp2, width:"150px" }} value={reportPAN} onChange={e => setReportPAN(e.target.value.toUpperCase())} placeholder="Client PAN" />
        </label>
        <button style={{ ...btn("primary"), padding:".52rem 1rem" }} onClick={onApply}>Apply</button>
        <button style={{ ...btn("outline"), padding:".52rem 1rem" }} onClick={onClear}>Clear</button>
      </div>
      <div style={{
        position: "sticky", top: 0, zIndex: 3,
        ...card2, padding: ".75rem .9rem",
        display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center"
      }}>
        <span style={{ fontSize: ".72rem", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
          Applied
        </span>
        {appliedFilters.length === 0 ? (
          <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>All Neo Revenue</span>
        ) : appliedFilters.map(f => (
          <span key={f.key} style={{ fontSize: ".78rem", padding: ".2rem .5rem", border: "1px solid var(--border)", borderRadius: "999px", background: "var(--input,#1e293b)" }}>
            <span style={{ color: "var(--muted)" }}>{f.key}: </span>
            <strong>{f.value}</strong>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
          {VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => setReportView(v.key)}
              style={{
                padding: ".35rem .85rem", borderRadius: "6px",
                fontSize: ".8rem", fontWeight: 600, cursor: "pointer",
                background: reportView === v.key ? "var(--accent)" : "var(--card)",
                color:      reportView === v.key ? "#fff"          : "var(--muted)",
                border: reportView === v.key ? "none" : "1px solid var(--border)",
              }}
            >{v.label}</button>
          ))}
      </div>

      {/* Table */}
      <div style={card2}>
        {loading ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>Loading report…</p>
        ) : !report ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>No report data. Add revenue entries first.</p>
        ) : data.length === 0 ? (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "2rem 0" }}>No data for this view / filter.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {visibleHeaders.map(h => {
                    const active = sortCol === h;
                    return (
                      <th key={h} onClick={() => handleSort(h)}
                        style={{ padding: ".45rem .65rem", textAlign: "left", color: active ? "var(--accent)" : "var(--muted)", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
                        {h}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    {renderRow(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
