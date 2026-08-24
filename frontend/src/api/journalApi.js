function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || "";

  if (typeof window !== "undefined") {
    const pageHost = window.location.hostname;
    const isLocalPage = ["localhost", "127.0.0.1", ""].includes(pageHost);

    let configuredHost = "";
    try {
      configuredHost = configured
        ? new URL(configured, window.location.origin).hostname
        : "";
    } catch {
      configuredHost = "";
    }

    if (
      !isLocalPage &&
      (!configured || configuredHost === "zivara-accounts-api.onrender.com")
    ) {
      return "/api";
    }
  }

  return configured || "http://127.0.0.1:8000";
}

const BASE_URL = resolveBaseUrl();

function getToken() {
  try {
    const auth = JSON.parse(localStorage.getItem("zivara_auth") || "null");
    return (
      auth?.accessToken ||
      auth?.access_token ||
      localStorage.getItem("zivara_token") ||
      ""
    );
  } catch {
    return localStorage.getItem("zivara_token") || "";
  }
}

function getLLPId() {
  try {
    const raw = localStorage.getItem("zivara_llp");
    if (raw) {
      const llp = JSON.parse(raw);
      if (llp && !llp.global) return llp.llpId || llp.LLPID || "";
    }

    const auth = JSON.parse(localStorage.getItem("zivara_auth") || "null");
    const llps = Array.isArray(auth?.llps) ? auth.llps : [];
    if (llps.length === 1) return llps[0].llpId || llps[0].LLPID || "";
  } catch {
    return "";
  }
  return "";
}

async function request(path, options = {}) {
  const token = getToken();
  const llpId = getLLPId();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(llpId ? { "X-LLP-ID": llpId } : {}),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(
      data?.detail || data?.error || data?.message || `Network error: ${res.status}`
    );
  }

  if (!data) throw new Error("Invalid backend response.");
  if (data.ok === false) throw new Error(data.error || data.message || "Backend error.");
  return data;
}

export const listManualJournals = () => request("/manual-journals");
export const getManualJournal = id =>
  request(`/manual-journals/${encodeURIComponent(id)}`);
export const updateManualJournal = (id, payload) =>
  request(`/manual-journals/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
export const deleteManualJournal = id =>
  request(`/manual-journals/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
