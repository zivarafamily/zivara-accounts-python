// pages/LLPSelector.jsx – Post-login entity selection screen
// Shown after login if the user belongs to >1 LLP.
// Auto-selects immediately if the user belongs to exactly 1 LLP.
// admin/managing_partner: falls back to all LLPs if no personal mappings, or bypasses entirely.

import { useEffect, useState } from "react";
import { apiGet } from "../api/client";
import { useLLP } from "../context/LLPContext";

const ADMIN_ROLES = ["admin", "managing_partner"];

const ROLE_COLORS = {
  managing_partner: { bg: "#a855f722", color: "#c084fc" },
  partner:          { bg: "#ec489922", color: "#f472b6" },
  admin:            { bg: "#6366f122", color: "#818cf8" },
  rm:               { bg: "#f59e0b22", color: "#fbbf24" },
};
function roleStyle(role) {
  return ROLE_COLORS[(role || "").toLowerCase()] || { bg: "#22c55e22", color: "#22c55e" };
}

export default function LLPSelector({ username, role, onLogout }) {
  const { selectLLP } = useLLP();
  const [llps,    setLlps]    = useState(null); // null = loading
  const [error,   setError]   = useState("");
  const [picking, setPicking] = useState(false); // auto-select in progress
  const isAdmin = ADMIN_ROLES.includes((role || "").toLowerCase());

  useEffect(() => {
    let cancelled = false;
    async function fetchLLPs() {
      try {
        const res = await apiGet("getLLPsForUser", { username });
        if (cancelled) return;
        const data = res.data || [];

        if (data.length === 0 && isAdmin) {
          selectLLP({ llpId: null, llpName: "All Entities", shortCode: "ALL", global: true });
          return;
        }

        setLlps(isAdmin && data.length > 1
          ? [{ llpId: null, llpName: "All Entities", shortCode: "ALL", global: true, role: role || "admin" }, ...data]
          : data
        );
        if (data.length === 1) { setPicking(true); selectLLP(data[0]); }
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not fetch entities");
      }
    }
    fetchLLPs();
    return () => { cancelled = true; };
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render helpers ────────────────────────────────────────────────────
  const overlay = {
    minHeight: "100vh", display: "flex", alignItems: "center",
    justifyContent: "center", background: "var(--bg)", padding: "1.5rem",
  };
  const card = {
    width: "100%", maxWidth: "480px", background: "var(--card)",
    border: "1px solid var(--border)", borderRadius: "var(--radius)",
    padding: "2rem",
  };
  const heading = {
    fontWeight: 700, fontSize: "1.1rem", color: "var(--text)", marginBottom: ".35rem",
  };
  const sub = { color: "var(--muted)", fontSize: ".82rem", marginBottom: "1.75rem" };
  const llpCard = (hover) => ({
    width: "100%", textAlign: "left", background: hover ? "rgba(99,102,241,.12)" : "var(--input,#1e293b)",
    border: `1px solid ${hover ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "8px", padding: "1rem 1.25rem", cursor: "pointer",
    marginBottom: ".75rem", transition: "background .15s,border-color .15s",
    display: "flex", alignItems: "center", justifyContent: "space-between",
  });

  // Loading
  if (llps === null && !error) {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--muted)", fontSize: ".9rem" }}>
            ⏳ Loading your entities…
          </div>
        </div>
      </div>
    );
  }

  // Auto-selecting (1 LLP) — brief flash before context updates
  if (picking) {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--muted)", fontSize: ".9rem" }}>
            ✅ Entering {llps[0]?.llpName}…
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ color: "#ef4444", marginBottom: "1.5rem", fontSize: ".875rem" }}>
            ⚠️ {error}
          </div>
          <button onClick={onLogout} style={{ fontSize: ".8rem", color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "6px", padding: ".4rem .9rem", cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // No entities
  if (llps.length === 0) {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "1rem" }}>🏢</div>
          <div style={heading}>No entities found</div>
          <p style={{ ...sub, marginBottom: "1.5rem" }}>
            Your account (<strong>{username}</strong>) is not assigned to any entity yet.
            Please ask your administrator to add you to an LLP.
          </p>
          <button onClick={onLogout} style={{ fontSize: ".8rem", color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "6px", padding: ".4rem .9rem", cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Multiple entities — show picker
  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "1rem" }}>🏢</div>
        <div style={heading}>Select an entity</div>
        <div style={sub}>Signed in as <strong style={{ color: "var(--text)" }}>{username}</strong></div>

        {llps.map((llp) => {
          const rs = roleStyle(llp.role);
          return (
            <LLPCard
              key={llp.llpId || "all-entities"}
              llp={llp}
              rs={rs}
              llpCardStyle={llpCard}
              onSelect={() => selectLLP(llp)}
            />
          );
        })}

        <div style={{ marginTop: "1rem", textAlign: "center" }}>
          <button
            onClick={onLogout}
            style={{ fontSize: ".75rem", color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function LLPCard({ llp, rs, llpCardStyle, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      style={llpCardStyle(hover)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
    >
      <div>
        <div style={{ fontWeight: 600, color: "var(--text)", fontSize: ".95rem", marginBottom: ".2rem" }}>
          {llp.llpName}
          {llp.shortCode && (
            <span style={{ marginLeft: ".5rem", fontSize: ".72rem", color: "var(--muted)", fontWeight: 400 }}>
              [{llp.shortCode}]
            </span>
          )}
        </div>
        {llp.gstin && (
          <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>GSTIN: {llp.gstin}</div>
        )}
      </div>
      <span style={{ fontSize: ".7rem", padding: ".15rem .6rem", borderRadius: "99px", fontWeight: 600, background: rs.bg, color: rs.color, whiteSpace: "nowrap" }}>
        {llp.role}
      </span>
    </button>
  );
}
