import { BrowserRouter, NavLink, Routes, Route, Navigate, useLocation } from "react-router-dom";
import React, { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard";
import PaymentTracker from "./pages/PaymentTracker";
import Vendors from "./pages/Vendors";
import Expenses from "./pages/Expenses";
import Reimbursements from "./pages/Reimbursements";
import BankAccounts from "./pages/BankAccounts";
import CashBook from "./pages/CashBook";
import Reconciliation from "./pages/Reconciliation";
import CATDSReport from "./pages/CATDSReport";
import VendorLedger from "./pages/VendorLedger";
import Imports from "./pages/Imports";
import LLPs from "./pages/LLPs";
import Partners from "./pages/Partners";
import Users from "./pages/Users";
import NeoInvoices from "./pages/NeoInvoices";
import Clients from "./pages/Clients";
import NeoRevenue from "./pages/NeoRevenue";
import Ledgers from "./pages/Ledgers";
import Transactions from "./pages/Transactions";
import JournalEntries from "./pages/JournalEntries";
import { LLPProvider, useLLP } from "./context/LLPContext";
import Login from "./pages/Login";

const ADMIN_ROLES = ["admin", "managing_partner"];
const NAV_ALL = [
  { key:"dashboard",      to:"/dashboard",        icon:"🏠", label:"Dashboard",                 group:"Overview", baselineRoles:["admin","managing_partner"] },
  { key:"paymenttracker", to:"/payment-tracker",  icon:"📤", label:"Vendor Bills",              group:"Accounts", baselineRoles:["admin","managing_partner","partner"] },
  { key:"vendors",        to:"/vendors",          icon:"🏪", label:"Vendors",                   group:"Accounts", baselineRoles:["admin","managing_partner"] },
  { key:"expenses",       to:"/expenses",         icon:"🧾", label:"Partner / Staff Expenses",  group:"Accounts", baselineRoles:["admin","managing_partner"] },
  { key:"ledgers",        to:"/ledgers",          icon:"📚", label:"Ledgers",                   group:"Accounts", baselineRoles:["admin","managing_partner"] },
  { key:"transactions",   to:"/transactions",     icon:"🔁", label:"Transactions",              group:"Accounts", baselineRoles:["admin","managing_partner"] },
  { key:"journalentries", to:"/journal-entries",  icon:"📝", label:"Journal Entry",             group:"Accounts", baselineRoles:["admin","managing_partner"] },
  { key:"clients",        to:"/clients",          icon:"👥", label:"Clients",                   group:"Revenue",  baselineRoles:["admin","managing_partner","partner"] },
  { key:"neoinvoices",    to:"/neoinvoices",      icon:"🧾", label:"Neo Invoices",              group:"Accounts", baselineRoles:["admin","managing_partner","partner"] },
  { key:"neorevenue",     to:"/neorevenue",       icon:"📊", label:"Neo Revenue",               group:"Revenue",  baselineRoles:["admin","managing_partner","partner"] },
  { key:"reimbursements", to:"/reimbursements",   icon:"💸", label:"Reimbursements",            group:"Accounts", baselineRoles:["admin","managing_partner","partner"] },
  { key:"reconciliation", to:"/reconciliation",   icon:"⚖️", label:"Reconciliation",            group:"Reports",  baselineRoles:["admin","managing_partner"] },
  { key:"vendorledger",   to:"/vendor-ledger",    icon:"📒", label:"Vendor Ledger",             group:"Reports",  baselineRoles:["admin","managing_partner"] },
  { key:"catdsreport",    to:"/ca-tds-report",    icon:"📑", label:"CA TDS Report",             group:"Reports",  baselineRoles:["admin","managing_partner"] },
  { key:"bankaccounts",   to:"/bankaccounts",     icon:"🏦", label:"Bank A/C",                  group:"Treasury", baselineRoles:["admin","managing_partner"] },
  { key:"cashbook",       to:"/cashbook",         icon:"💵", label:"Cash Book",                 group:"Treasury", baselineRoles:["admin","managing_partner"] },
  { key:"imports",        to:"/imports",          icon:"⬆️", label:"Import Excel",              group:"Treasury", baselineRoles:["admin","managing_partner"] },
  { key:"users",          to:"/users",            icon:"👤", label:"Users",                     group:"Setup",    baselineRoles:["admin","managing_partner"] },
  { key:"llps",           to:"/llps",             icon:"🏢", label:"LLPs",                      group:"Setup",    baselineRoles:["admin","managing_partner"] },
  { key:"partners",       to:"/partners",         icon:"🤝", label:"Partners",                  group:"Setup",    baselineRoles:["admin","managing_partner"] },
];

function normalizeModules(value) {
  if (Array.isArray(value)) return value.map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
  if (!value) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeModules(parsed);
    } catch {
      return [];
    }
  }
  return raw.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
}

function canAccessModule(moduleKey, role, allowedModules = []) {
  const normalizedRole = String(role || "viewer").trim().toLowerCase();
  const key = String(moduleKey || "").trim().toLowerCase();
  if (!key) return false;
  if (ADMIN_ROLES.includes(normalizedRole)) return true;
  if (normalizeModules(allowedModules).includes(key)) return true;
  const item = NAV_ALL.find(n => n.key === key);
  return !!item && item.baselineRoles.includes(normalizedRole);
}

const linkBase = {
  display:"flex",
  alignItems:"center",
  gap:".65rem",
  padding:".65rem 1.25rem",
  fontSize:".875rem",
  color:"var(--muted)",
  borderRadius:"6px",
  margin:".15rem .5rem",
  textDecoration:"none",
  whiteSpace:"nowrap",
};

const AUTH_TTL = 8 * 60 * 60 * 1000;

function getStoredAuth() {
  try {
    const raw = localStorage.getItem("zivara_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > AUTH_TTL) {
      localStorage.removeItem("zivara_auth");
      localStorage.removeItem("zivara_token");
      return null;
    }
    if (parsed.role) parsed.role = parsed.role.toLowerCase().trim();
    parsed.allowedModules = normalizeModules(parsed.allowedModules);
    return parsed;
  } catch {
    return null;
  }
}

function Sidebar({ open, onClose, user, role, designation, allowedModules, onLogout }) {
  const nav = NAV_ALL.filter(n => canAccessModule(n.key, role, allowedModules));
  const { currentLLP, clearLLP } = useLLP();
  return (
    <>
      {open && <div onClick={onClose} className="mob-overlay" style={{ display:"none", position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:40 }} />}
      <aside className={`sidebar${open ? " sidebar-open" : ""}`} style={{ width:"220px", minHeight:"100vh", background:"var(--sidebar)", borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"1rem 1.25rem .75rem", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <img src="/logo.png" alt="Zivara Accounts" style={{ height:"48px", width:"auto", objectFit:"contain", display:"block" }} onError={e => { e.currentTarget.style.display="none"; e.currentTarget.nextSibling.style.display="block"; }} />
          <div style={{ display:"none" }}>
            <div style={{ fontWeight:700, fontSize:"1.05rem", color:"var(--text)" }}>Zivara Accounts</div>
            <div style={{ fontSize:".72rem", color:"var(--muted)", marginTop:".2rem" }}>GST, TDS & Payments</div>
          </div>
          <button onClick={onClose} className="sidebar-close-btn" style={{ background:"none", border:"none", color:"var(--muted)", fontSize:"1.2rem", cursor:"pointer", padding:".2rem" }}>×</button>
        </div>

        <nav style={{ marginTop:".75rem", flex:1, overflowY:"auto" }}>
          {(() => {
            const seen = new Set();
            return nav.map(({ to, icon, label, group }, idx) => {
              const showHeader = group && !seen.has(group) && seen.add(group);
              const prevGroup = idx > 0 ? nav[idx - 1].group : null;
              const addDivider = showHeader && prevGroup && prevGroup !== group;
              return (
                <React.Fragment key={to}>
                  {addDivider && <div style={{ height:"1px", background:"var(--border)", margin:".35rem .75rem" }} />}
                  {showHeader && <div style={{ padding:".45rem 1.35rem .15rem", fontSize:".62rem", fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:".08em", opacity:.7 }}>{group}</div>}
                  <NavLink to={to} onClick={onClose} style={({ isActive }) => ({
                    ...linkBase,
                    paddingLeft: group ? "1.6rem" : "1.25rem",
                    background:isActive ? "rgba(99,102,241,.18)" : "transparent",
                    color:isActive ? "var(--accent)" : "var(--muted)",
                    fontWeight:isActive ? 600 : 400,
                  })}>
                    <span style={{ fontSize:"1rem" }}>{icon}</span>{label}
                  </NavLink>
                </React.Fragment>
              );
            });
          })()}
        </nav>

        <div style={{ padding:".75rem 1.25rem", borderTop:"1px solid var(--border)" }}>
          <div style={{ fontSize:".68rem", color:"var(--muted)", marginBottom:".25rem" }}>
            Signed in: <strong style={{ color:"var(--text)" }}>{user}</strong>
          </div>
          <div style={{ marginBottom:".5rem" }}>
            <span style={{ fontSize:".65rem", padding:".1rem .5rem", borderRadius:"99px", fontWeight:600, background:"#6366f122", color:"#818cf8" }}>{designation || role}</span>
          </div>
          {currentLLP && (
            <div style={{ fontSize:".65rem", color:"var(--muted)", marginBottom:".5rem" }}>
              Entity: <button onClick={clearLLP} style={{ background:"none", border:"none", color:"#818cf8", fontWeight:700, cursor:"pointer" }}>{currentLLP.shortCode || currentLLP.llpName}</button>
            </div>
          )}
          <button onClick={onLogout} style={{ width:"100%", padding:".4rem", borderRadius:"6px", border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontSize:".75rem", cursor:"pointer" }}>Sign Out</button>
        </div>
      </aside>
    </>
  );
}

function AppLayout({ user, role, fullName, employeeRef, designation, allowedModules, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { currentLLP } = useLLP();
  const normalizedAllowedModules = normalizeModules(allowedModules);
  const llpModules = normalizeModules(currentLLP?.allowedModules);
  const effectiveModules = llpModules.length > 0 ? llpModules : normalizedAllowedModules;
  const nav = NAV_ALL.filter(n => canAccessModule(n.key, role, effectiveModules));
  const can = key => canAccessModule(key, role, effectiveModules);
  const defaultPath = nav[0]?.to || "/payment-tracker";
  const currentPage = NAV_ALL.find(n => n.to === location.pathname);

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  return (
    <div style={{ display:"flex", minHeight:"100vh" }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={fullName || user} role={role} designation={designation} allowedModules={effectiveModules} onLogout={onLogout} />
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
        <header style={{ height:"52px", background:"var(--sidebar)", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 1rem", gap:"1rem", position:"sticky", top:0, zIndex:30 }}>
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} style={{ background:"none", border:"none", color:"var(--text)", fontSize:"1.25rem", cursor:"pointer", padding:".2rem .4rem", display:"none" }}>☰</button>
          <span style={{ color:"var(--muted)", fontSize:".8rem", flex:1 }}>
            <span className="header-page-title" style={{ color:"var(--text)", fontWeight:600, marginRight:".5rem" }}>{currentPage ? `${currentPage.icon} ${currentPage.label}` : ""}</span>
            {new Date().toLocaleDateString("en-IN", { dateStyle:"long" })}
          </span>
        </header>
        <main style={{ flex:1, padding:"1.25rem", overflowY:"auto" }}>
          <Routes>
            <Route path="/" element={<Navigate to={defaultPath} replace />} />
            <Route path="/dashboard" element={can("dashboard") ? <Dashboard /> : <Navigate to={defaultPath} replace />} />
            <Route path="/payment-tracker" element={can("paymenttracker") ? <PaymentTracker /> : <Navigate to={defaultPath} replace />} />
            <Route path="/vendors" element={can("vendors") ? <Vendors /> : <Navigate to={defaultPath} replace />} />
            <Route path="/expenses" element={can("expenses") ? <Expenses /> : <Navigate to={defaultPath} replace />} />
            <Route path="/receipts" element={<Navigate to="/transactions" replace />} />
            <Route path="/ledgers" element={can("ledgers") ? <Ledgers /> : <Navigate to={defaultPath} replace />} />
            <Route path="/transactions" element={can("transactions") ? <Transactions /> : <Navigate to={defaultPath} replace />} />
            <Route path="/journal-entries" element={can("journalentries") ? <JournalEntries /> : <Navigate to={defaultPath} replace />} />
            <Route path="/clients" element={can("clients") ? <Clients role={role} employeeRef={employeeRef} /> : <Navigate to={defaultPath} replace />} />
            <Route path="/neoinvoices" element={can("neoinvoices") ? <NeoInvoices role={role} employeeRef={employeeRef} /> : <Navigate to={defaultPath} replace />} />
            <Route path="/neorevenue" element={can("neorevenue") ? <NeoRevenue role={role} employeeRef={employeeRef} fullName={fullName} user={user} /> : <Navigate to={defaultPath} replace />} />
            <Route path="/reimbursements" element={can("reimbursements") ? <Reimbursements role={role} employeeRef={employeeRef} /> : <Navigate to={defaultPath} replace />} />
            <Route path="/bankaccounts" element={can("bankaccounts") ? <BankAccounts /> : <Navigate to={defaultPath} replace />} />
            <Route path="/cashbook" element={can("cashbook") ? <CashBook /> : <Navigate to={defaultPath} replace />} />
            <Route path="/imports" element={can("imports") ? <Imports /> : <Navigate to={defaultPath} replace />} />
            <Route path="/reconciliation" element={can("reconciliation") ? <Reconciliation /> : <Navigate to={defaultPath} replace />} />
            <Route path="/vendor-ledger" element={can("vendorledger") ? <VendorLedger /> : <Navigate to={defaultPath} replace />} />
            <Route path="/ca-tds-report" element={can("catdsreport") ? <CATDSReport /> : <Navigate to={defaultPath} replace />} />
            <Route path="/users" element={can("users") ? <Users /> : <Navigate to={defaultPath} replace />} />
            <Route path="/llps" element={can("llps") ? <LLPs /> : <Navigate to={defaultPath} replace />} />
            <Route path="/partners" element={can("partners") ? <Partners /> : <Navigate to={defaultPath} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AppWithLLP({ auth, onLogout }) {
  const { currentLLP, selectLLP } = useLLP();
  useEffect(() => {
    const llps = Array.isArray(auth.llps) ? auth.llps : [];
    if ((!currentLLP || currentLLP.global) && llps.length === 1) {
      selectLLP(llps[0]);
    }
  }, [auth, currentLLP, selectLLP]);

  return (
    <BrowserRouter>
      <AppLayout
        user={auth.user}
        role={auth.role || "viewer"}
        fullName={auth.fullName}
        employeeRef={auth.employeeRef || ""}
        designation={auth.designation || ""}
        allowedModules={auth.allowedModules || []}
        onLogout={onLogout}
      />
    </BrowserRouter>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => getStoredAuth());
  const handleLogout = () => {
    localStorage.removeItem("zivara_auth");
    localStorage.removeItem("zivara_token");
    localStorage.removeItem("zivara_llp");
    setAuth(null);
  };
  return (
    <LLPProvider>
      {auth ? <AppWithLLP auth={auth} onLogout={handleLogout} /> : <Login onLogin={setAuth} />}
    </LLPProvider>
  );
}
