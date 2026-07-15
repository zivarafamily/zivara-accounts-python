import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { useLLP } from "../context/LLPContext";

const initial = {
  AccountName:"", BankName:"", AccountNumber:"", IFSC:"",
  AccountType:"Current", Branch:"", OpeningBalance:"",
  CurrentBalance:"", IsActive:"Yes", Notes:""
};

const card  = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
const label = { display:"block", fontSize:".75rem", color:"var(--muted)", marginBottom:".35rem", fontWeight:500 };
const btn   = (v="primary") => ({
  padding:".55rem 1.2rem", borderRadius:"6px", border:"none",
  fontWeight:600, fontSize:".875rem", cursor:"pointer",
  background: v==="primary" ? "var(--accent)" : "transparent",
  color: v==="primary" ? "#fff" : "var(--muted)",
});

const TYPE_COLOR = {
  Current:"var(--accent)", Savings:"var(--success)",
  OD:"var(--warning)", Loan:"var(--danger)"
};

function Badge({ v, colors }) {
  const c = (colors||{})[v] || "var(--muted)";
  return (
    <span style={{
      fontSize:".7rem", padding:".2rem .6rem", borderRadius:"99px", fontWeight:600,
      background:c+"22", color:c, border:`1px solid ${c}`,
    }}>{v}</span>
  );
}

const fmt = n => n != null && n !== "" ? "₹"+Number(n).toLocaleString("en-IN") : "—";

export default function BankAccounts() {
  const { currentLLP } = useLLP();
  const [accounts, setAccounts]   = useState([]);
  const [form, setForm]           = useState(initial);
  const [loading, setLoading]     = useState(false);
  const [formOpen, setFormOpen]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const scopeLabel = currentLLP?.global ? "All Entities" : (currentLLP?.llpName || currentLLP?.LLPName || "Selected LLP");

  async function load() {
    setLoading(true);
    try {
      const r = await apiGet("getBankAccounts");
      if (r.ok) setAccounts(r.data || []);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [currentLLP?.llpId, currentLLP?.LLPID, currentLLP?.global]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function openAdd() { setForm(initial); setEditId(null); setFormOpen(true); }
  function openEdit(acc) {
    setForm({
      AccountName: acc.AccountName||"", BankName: acc.BankName||"",
      AccountNumber: acc.AccountNumber||"", IFSC: acc.IFSC||"",
      AccountType: acc.AccountType||"Current", Branch: acc.Branch||"",
      OpeningBalance: acc.OpeningBalance||"", CurrentBalance: acc.CurrentBalance||"",
      IsActive: acc.IsActive||"Yes", Notes: acc.Notes||""
    });
    setEditId(acc.AccountID);
    setFormOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      const action  = editId ? "updateBankAccount" : "saveBankAccount";
      const payload = editId ? { ...form, AccountID: editId } : form;
      const r = await apiPost(action, payload);
      if (r.ok) { setFormOpen(false); setEditId(null); setForm(initial); load(); }
      else alert(r.error || "Error saving");
    } catch (err) {
      alert(err.message || "Error saving bank account");
    }
  }

  async function removeAccount(acc) {
    if (!window.confirm(`Delete bank account ${acc.AccountName || acc.BankName}?`)) return;
    try {
      const r = await apiPost("deleteBankAccount", { AccountID:acc.AccountID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete bank account");
    }
  }

  const active   = accounts.filter(a => a.IsActive !== "No");
  const totalBal = active.reduce((s, a) => s + (Number(a.CurrentBalance)||0), 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ fontWeight:700, fontSize:"1.25rem", color:"var(--text)" }}>Bank Accounts</h2>
          <p style={{ color:"var(--muted)", fontSize:".8rem", marginTop:".2rem" }}>Manage company bank accounts · {scopeLabel}</p>
        </div>
        <button style={btn()} onClick={openAdd}>+ Add Account</button>
      </div>

      {/* Stat cards */}
      <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
        <div style={{ ...card, flex:1, minWidth:180, padding:".9rem 1.25rem" }}>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>TOTAL BALANCE</div>
          <div style={{ fontSize:"1.5rem", fontWeight:700, color: totalBal >= 0 ? "var(--success)" : "var(--danger)", marginTop:".25rem" }}>
            {fmt(totalBal)}
          </div>
        </div>
        <div style={{ ...card, flex:1, minWidth:180, padding:".9rem 1.25rem" }}>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>ACTIVE ACCOUNTS</div>
          <div style={{ fontSize:"1.5rem", fontWeight:700, color:"var(--accent2)", marginTop:".25rem" }}>{active.length}</div>
        </div>
        <div style={{ ...card, flex:1, minWidth:180, padding:".9rem 1.25rem" }}>
          <div style={{ fontSize:".72rem", color:"var(--muted)", fontWeight:500 }}>TOTAL ACCOUNTS</div>
          <div style={{ fontSize:"1.5rem", fontWeight:700, color:"var(--accent)", marginTop:".25rem" }}>{accounts.length}</div>
        </div>
      </div>

      {/* Form */}
      {formOpen && (
        <div style={card}>
          <h3 style={{ fontWeight:600, marginBottom:"1rem", color:"var(--text)" }}>
            {editId ? "Edit Account" : "New Bank Account"}
          </h3>
          <form onSubmit={save}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:"1rem" }}>
              <div><label style={label}>Account Name *</label><input placeholder="e.g. HDFC Current" value={form.AccountName} onChange={e=>set("AccountName",e.target.value)} required /></div>
              <div><label style={label}>Bank Name *</label><input placeholder="e.g. HDFC Bank" value={form.BankName} onChange={e=>set("BankName",e.target.value)} required /></div>
              <div><label style={label}>Account Number *</label><input placeholder="Account number" value={form.AccountNumber} onChange={e=>set("AccountNumber",e.target.value)} required /></div>
              <div><label style={label}>IFSC Code</label><input placeholder="e.g. HDFC0001234" value={form.IFSC} onChange={e=>set("IFSC",e.target.value.toUpperCase())} style={{ textTransform:"uppercase" }} /></div>
              <div><label style={label}>Account Type</label>
                <select value={form.AccountType} onChange={e=>set("AccountType",e.target.value)}>
                  {["Current","Savings","OD","Loan"].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div><label style={label}>Branch</label><input placeholder="Branch name" value={form.Branch} onChange={e=>set("Branch",e.target.value)} /></div>
              <div><label style={label}>Opening Balance (₹)</label><input type="number" placeholder="0.00" value={form.OpeningBalance} onChange={e=>set("OpeningBalance",e.target.value)} /></div>
              <div><label style={label}>Current Balance (₹)</label><input type="number" placeholder="0.00" value={form.CurrentBalance} onChange={e=>set("CurrentBalance",e.target.value)} /></div>
              <div><label style={label}>Active</label>
                <select value={form.IsActive} onChange={e=>set("IsActive",e.target.value)}>
                  <option>Yes</option><option>No</option>
                </select>
              </div>
              <div style={{ gridColumn:"span 2" }}><label style={label}>Notes</label><input placeholder="Any notes" value={form.Notes} onChange={e=>set("Notes",e.target.value)} /></div>
            </div>
            <div style={{ display:"flex", gap:".75rem", marginTop:"1.25rem" }}>
              <button type="submit" style={btn()}>{editId ? "Update Account" : "Save Account"}</button>
              <button type="button" style={btn("ghost")} onClick={()=>{ setFormOpen(false); setEditId(null); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        <div style={{ padding:".9rem 1.25rem", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:600, fontSize:".875rem" }}>All Accounts</span>
          <span style={{ fontSize:".75rem", color:"var(--muted)" }}>{accounts.length} account{accounts.length!==1?"s":""}</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {loading ? (
            <p style={{ padding:"2rem", color:"var(--muted)", textAlign:"center" }}>Loading…</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>LLP</th><th>Account Name</th><th>Bank</th><th>Account No.</th>
                  <th>IFSC</th><th>Type</th><th>Branch</th>
                  <th>Opening Bal</th><th>Current Bal</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.length===0 ? (
                  <tr><td colSpan="11" style={{ textAlign:"center", color:"var(--muted)", padding:"2.5rem" }}>No bank accounts added yet for {scopeLabel}</td></tr>
                ) : accounts.map(acc => (
                  <tr key={acc.AccountID}>
                    <td style={{ color:"var(--muted)", fontSize:".8rem" }}>{acc.LLPName || "—"}</td>
                    <td style={{ fontWeight:600 }}>{acc.AccountName}</td>
                    <td>{acc.BankName}</td>
                    <td style={{ fontFamily:"monospace", color:"var(--accent2)", letterSpacing:".05em" }}>
                      {"•".repeat(Math.max(0,String(acc.AccountNumber||"").length-4))}{String(acc.AccountNumber||"").slice(-4)}
                    </td>
                    <td style={{ color:"var(--muted)", fontSize:".8rem" }}>{acc.IFSC}</td>
                    <td><Badge v={acc.AccountType} colors={TYPE_COLOR}/></td>
                    <td style={{ color:"var(--muted)" }}>{acc.Branch}</td>
                    <td style={{ color:"var(--muted)" }}>{fmt(acc.OpeningBalance)}</td>
                    <td style={{ fontWeight:700, color: Number(acc.CurrentBalance||0)>=0 ? "var(--success)" : "var(--danger)" }}>
                      {fmt(acc.CurrentBalance)}
                    </td>
                    <td>
                      <span style={{ fontSize:".7rem", padding:".2rem .6rem", borderRadius:"99px", fontWeight:600,
                        background: acc.IsActive!=="No" ? "var(--success)22" : "var(--danger)22",
                        color: acc.IsActive!=="No" ? "var(--success)" : "var(--danger)",
                        border: `1px solid ${acc.IsActive!=="No" ? "var(--success)" : "var(--danger)"}`,
                      }}>{acc.IsActive!=="No" ? "Active" : "Inactive"}</span>
                    </td>
                    <td>
                      <button onClick={()=>openEdit(acc)} style={{ background:"transparent", border:"1px solid var(--border)", color:"var(--muted)", borderRadius:"6px", padding:".3rem .7rem", fontSize:".75rem", cursor:"pointer" }}>
                        Edit
                      </button>
                      {" "}
                      <button onClick={()=>removeAccount(acc)} style={{ background:"transparent", border:"1px solid var(--border)", color:"var(--danger)", borderRadius:"6px", padding:".3rem .7rem", fontSize:".75rem", cursor:"pointer" }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <LocalBillStoragePanel />

    </div>
  );
}

function LocalBillStoragePanel() {
  const card  = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"1.25rem" };
  return (
    <div style={card}>
      <div style={{ fontWeight:700, fontSize:".95rem" }}>Bill Upload Storage</div>
      <div style={{ fontSize:".78rem", color:"var(--muted)", marginTop:".35rem" }}>
        Bills uploaded from Expenses and Payables are stored locally by the FastAPI backend under backend/uploads. Access is controlled by app login and LLP permissions.
      </div>
    </div>
  );
}
