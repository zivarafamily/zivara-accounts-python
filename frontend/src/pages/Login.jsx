import { useState } from "react";
import { gasPost } from "../api/client";

const inp = {
  width: "100%", padding: ".6rem .75rem", borderRadius: "6px",
  border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--text)", fontSize: ".875rem", boxSizing: "border-box",
  outline: "none",
};
const lbl = {
  display: "block", fontSize: ".75rem", color: "var(--muted)",
  marginBottom: ".35rem", fontWeight: 500,
};

export default function Login({ onLogin }) {
  const [form, setForm]   = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await gasPost("login", {
        username: form.username.trim(),
        password: form.password.trim(),
      });
      const defaultLLP = Array.isArray(res.llps) && res.llps.length === 1 ? res.llps[0] : null;
      if (defaultLLP) localStorage.setItem("zivara_llp", JSON.stringify(defaultLLP));
      localStorage.setItem("zivara_token", res.access_token);
      localStorage.setItem("zivara_auth", JSON.stringify({
        user: res.user, role: res.role || "viewer", fullName: res.fullName || res.user,
        employeeRef: res.employeeRef || "", designation: res.designation || "",
        allowedModules: res.allowedModules || [], llps: res.llps || [], accessToken: res.access_token, ts: Date.now()
      }));
      onLogin({
        user: res.user, role: res.role || "viewer", fullName: res.fullName || res.user,
        employeeRef: res.employeeRef || "", designation: res.designation || "",
        allowedModules: res.allowedModules || [], llps: res.llps || [], accessToken: res.access_token, ts: Date.now()
      });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "var(--bg)", padding: "1rem",
    }}>
      <div style={{ width: "100%", maxWidth: "360px" }}>

        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "2.25rem", marginBottom: ".5rem" }}>⚡</div>
          <div style={{ fontWeight: 700, fontSize: "1.4rem", color: "var(--text)" }}>Zivara</div>
          <div style={{ color: "var(--muted)", fontSize: ".8rem", marginTop: ".2rem" }}>Billing &amp; Ops</div>
        </div>

        {/* Card */}
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "2rem",
        }}>
          <form onSubmit={handleSubmit} autoComplete="on">

            <div style={{ marginBottom: "1.25rem" }}>
              <label style={lbl}>Username</label>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={form.username}
                onChange={set("username")}
                required
                autoFocus
                style={inp}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={lbl}>Password</label>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={form.password}
                onChange={set("password")}
                required
                style={inp}
              />
            </div>

            {error && (
              <div style={{
                marginBottom: "1rem", padding: ".6rem .75rem",
                background: "#ef444422", border: "1px solid #ef444466",
                borderRadius: "6px", color: "#ef4444", fontSize: ".8rem",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%", padding: ".7rem", borderRadius: "6px", border: "none",
                background: "var(--accent)", color: "#fff", fontWeight: 600,
                fontSize: ".875rem", cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? .6 : 1,
              }}
            >
              {busy ? "Signing in…" : "Sign In"}
            </button>

          </form>
        </div>

      </div>
    </div>
  );
}
