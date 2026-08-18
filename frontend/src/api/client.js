// api/client.js - compatibility helpers over the FastAPI backend.

function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || "";

  if (typeof window !== "undefined") {
    const pageHost = window.location.hostname;
    const isLocalPage = ["localhost", "127.0.0.1", ""].includes(pageHost);

    const configuredHost = (() => {
      try {
        return configured
          ? new URL(configured, window.location.origin).hostname
          : "";
      } catch {
        return "";
      }
    })();

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

function assertApiBaseReachableFromPage() {
  const pageHost = window.location.hostname;
  const isLocalPage = ["localhost", "127.0.0.1", ""].includes(pageHost);
  const isLocalApi =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(BASE_URL);

  if (!isLocalPage && isLocalApi) {
    throw new Error(
      "Public app is still configured to use the local backend. " +
      "Set VITE_API_BASE_URL to the public backend URL and redeploy."
    );
  }
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStoredLLPId() {
  try {
    const raw = localStorage.getItem("zivara_llp");

    if (!raw) {
      const auth = JSON.parse(
        localStorage.getItem("zivara_auth") || "null"
      );
      const llps = Array.isArray(auth?.llps) ? auth.llps : [];

      return llps.length === 1
        ? llps[0].llpId
        : null;
    }

    const llp = JSON.parse(raw);

    return llp && !llp.global
      ? (llp.llpId || llp.LLPID || null)
      : null;
  } catch {
    return null;
  }
}

function getToken() {
  try {
    const auth = JSON.parse(
      localStorage.getItem("zivara_auth") || "null"
    );

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

function authHeaders(extra = {}) {
  const token = getToken();
  const llpId = getStoredLLPId();

  return {
    ...(token
      ? { Authorization: `Bearer ${token}` }
      : {}),
    ...(llpId
      ? { "X-LLP-ID": llpId }
      : {}),
    ...extra,
  };
}

async function request(path, options = {}) {
  assertApiBaseReachableFromPage();

  const { headers = {}, ...fetchOptions } = options;
  const url = `${BASE_URL}${path}`;

  let res;

  try {
    res = await fetch(url, {
      ...fetchOptions,
      headers: authHeaders(headers),
    });
  } catch (err) {
    throw new Error(
      `Unable to reach backend at ${BASE_URL}. ` +
      `Check VITE_API_BASE_URL, backend deployment, and CORS settings. ` +
      `(${err?.message || "fetch failed"})`
    );
  }

  const raw = await res.text();
  const data = parseJsonSafe(raw);

  if (!res.ok) {
    const err = new Error(
      data?.detail ||
      data?.error ||
      data?.message ||
      `Network error: ${res.status}`
    );

    err.payload = data;
    throw err;
  }

  if (!data) {
    throw new Error(
      `Invalid backend response: ${raw.slice(0, 300)}`
    );
  }

  if (data.ok === false) {
    throw new Error(
      data.error ||
      data.message ||
      "Backend error"
    );
  }

  return data;
}

const getRoutes = {
  ping: "/health",

  getUsers: "/users",
  getEmployees: "/users",

  getLLPs: "/llps",
  getLLPsForUser: "/llps/for-user",
  getLLPPartners: "/llp-partners",

  getPartners: "/partners",
  getClients: "/clients",

  getNeoRevenue: "/neo-revenue",
  getNeoRevenueMeta: "/neo-revenue/meta",
  getNeoRevenueReport: "/neo-revenue/report",

  getVendors: "/vendors",

  getLLPPayables: "/payables",
  getPayables: "/payables",

  getExpenses: "/expenses",
  getReceipts: "/receipts",

  getNeoInvoices: "/neo-invoices",

  getBankAccounts: "/bank-accounts",
  getCashBook: "/cash-book",

  // Ledger Master
  getLedgers: "/ledgers",
  getLedgerStatement: "/ledger-journal",

  getAccountsDashboard: "/reports/dashboard",
  getDashboard: "/reports/dashboard",

  getGSTTDSReport: "/reports/ca-tds",
  getCATDSReport: "/reports/ca-tds",

  getVendorLedger: "/reports/vendor-ledger",
  getReconciliationSummary: "/reports/reconciliation",
  getReimbursementReport: "/reports/reimbursements",
};

const postRoutes = {
  login: ["POST", "/auth/login"],

  saveUser: ["POST", "/users"],
  updateUser: [
    "PUT",
    p => `/users/${p.UserID}`,
  ],
  deleteUser: [
    "DELETE",
    p => `/users/${p.UserID}`,
  ],

  saveLLP: ["POST", "/llps"],
  updateLLP: [
    "PUT",
    p => `/llps/${p.LLPID}`,
  ],
  deleteLLP: [
    "DELETE",
    p => `/llps/${p.LLPID}`,
  ],

  saveLLPPartner: ["POST", "/llp-partners"],
  updateLLPPartner: [
    "PUT",
    p => `/llp-partners/${p.MappingID}`,
  ],
  deleteLLPPartner: [
    "DELETE",
    p => `/llp-partners/${p.MappingID}`,
  ],

  savePartner: ["POST", "/partners"],
  updatePartner: [
    "PUT",
    p => `/partners/${p.PartnerID}`,
  ],
  deletePartner: [
    "DELETE",
    p => `/partners/${p.PartnerID}`,
  ],

  saveClient: ["POST", "/clients"],
  updateClient: [
    "PUT",
    p => `/clients/${p.ClientID}`,
  ],
  deleteClient: [
    "DELETE",
    p => `/clients/${p.ClientID}`,
  ],

  saveNeoRevenue: ["POST", "/neo-revenue"],
  updateNeoRevenue: [
    "PUT",
    p => `/neo-revenue/${p.RevenueID}`,
  ],
  deleteNeoRevenue: [
    "DELETE",
    p => `/neo-revenue/${p.RevenueID}`,
  ],
  deleteNeoRevenueMonth: [
    "DELETE",
    p => `/neo-revenue/month/${encodeURIComponent(
      p.RevenueMonth
    )}`,
  ],

  saveVendor: ["POST", "/vendors"],
  updateVendor: [
    "PUT",
    p => `/vendors/${p.VendorID}`,
  ],
  deleteVendor: [
    "DELETE",
    p => `/vendors/${p.VendorID}`,
  ],

  saveLLPPayable: ["POST", "/payables"],
  savePayable: ["POST", "/payables"],

  updateLLPPayable: [
    "PUT",
    p => `/payables/${p.PayableID}`,
  ],
  updatePayable: [
    "PUT",
    p => `/payables/${p.PayableID || p.id}`,
  ],

  deleteLLPPayable: [
    "DELETE",
    p => `/payables/${p.PayableID}`,
  ],

  batchPayLLPPayables: [
    "POST",
    "/payables/batch-payment",
  ],

  markLLPPayablePaid: [
    "POST",
    p => `/payables/${p.PayableID}/mark-paid`,
  ],

  markPayablePaid: [
    "POST",
    p => `/payables/${p.PayableID || p.id}/mark-paid`,
  ],

  reimbursePayable: [
    "POST",
    p => `/payables/${p.PayableID}/reimburse`,
  ],

  saveExpense: ["POST", "/expenses"],
  updateExpense: [
    "PUT",
    p => `/expenses/${p.ExpenseID}`,
  ],
  deleteExpense: [
    "DELETE",
    p => `/expenses/${p.ExpenseID}`,
  ],
  approveExpense: [
    "POST",
    p => `/expenses/${p.ExpenseID}/approve`,
  ],
  reimburseExpense: [
    "POST",
    p => `/expenses/${p.ExpenseID}/reimburse`,
  ],

  saveReceipt: ["POST", "/receipts"],
  updateReceipt: [
    "PUT",
    p => `/receipts/${p.ReceiptID}`,
  ],
  deleteReceipt: [
    "DELETE",
    p => `/receipts/${p.ReceiptID}`,
  ],

  saveNeoInvoice: ["POST", "/neo-invoices"],
  updateNeoInvoice: [
    "PUT",
    p => `/neo-invoices/${p.NeoInvoiceID}`,
  ],
  deleteNeoInvoice: [
    "DELETE",
    p => `/neo-invoices/${p.NeoInvoiceID}`,
  ],

  saveBankAccount: ["POST", "/bank-accounts"],
  updateBankAccount: [
    "PUT",
    p => `/bank-accounts/${p.AccountID}`,
  ],
  deleteBankAccount: [
    "DELETE",
    p => `/bank-accounts/${p.AccountID}`,
  ],

  saveCashEntry: ["POST", "/cash-book"],
  updateCashEntry: [
    "PUT",
    p => `/cash-book/${p.EntryID}`,
  ],
  deleteCashEntry: [
    "DELETE",
    p => `/cash-book/${p.EntryID}`,
  ],

  // Ledger Master / Journal
  seedDefaultLedgers: [
    "POST",
    "/ledgers/seed-defaults",
  ],

  saveLedger: [
    "POST",
    "/ledgers",
  ],

  updateLedger: [
    "PUT",
    p => `/ledgers/${p.LedgerID}`,
  ],

  deleteLedger: [
    "DELETE",
    p => `/ledgers/${p.LedgerID}`,
  ],

  saveJournal: [
    "POST",
    "/ledger-journal",
  ],

  postCashToLedger: [
    "POST",
    "/ledger-post-cash",
  ],
};

export async function gasGet(
  action,
  params = {}
) {
  const route = getRoutes[action];

  if (!route) {
    throw new Error(
      `Unsupported API action: ${action}`
    );
  }

  const query = new URLSearchParams(
    params
  ).toString();

  return request(
    `${route}${query ? `?${query}` : ""}`,
    {
      headers: {},
    }
  );
}

export async function gasPost(
  action,
  payload = {}
) {
  if (action === "uploadBill") {
    if (!payload.file) {
      throw new Error(
        "File is required for bill upload"
      );
    }

    return uploadBill(
      payload.file,
      payload
    );
  }

  const entry = postRoutes[action];

  if (!entry) {
    throw new Error(
      `Unsupported API action: ${action}`
    );
  }

  const [method, pathDef] = entry;

  const path =
    typeof pathDef === "function"
      ? pathDef(payload)
      : pathDef;

  return request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body:
      method === "DELETE"
        ? undefined
        : JSON.stringify(payload),
  });
}

export async function uploadBill(
  file,
  metadata = {}
) {
  const formData = new FormData();

  formData.append("file", file);

  const normalized = {
    ...metadata,
  };

  if (
    metadata.expense_id ||
    metadata.ExpenseID
  ) {
    normalized.source_type = "expense";
    normalized.source_id =
      metadata.expense_id ||
      metadata.ExpenseID;
  }

  if (
    metadata.payable_id ||
    metadata.PayableID
  ) {
    normalized.source_type = "payable";
    normalized.source_id =
      metadata.payable_id ||
      metadata.PayableID;
  }

  Object.entries(normalized).forEach(
    ([key, value]) => {
      if (key === "file") return;

      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        formData.append(
          key,
          String(value)
        );
      }
    }
  );

  return request(
    "/uploads/bills",
    {
      method: "POST",
      headers: {},
      body: formData,
    }
  );
}

export async function uploadSignature(
  file,
  signerName = ""
) {
  const formData = new FormData();

  formData.append("file", file);

  if (signerName) {
    formData.append(
      "signer_name",
      signerName
    );
  }

  const result = await request(
    "/uploads/signatures",
    {
      method: "POST",
      headers: {},
      body: formData,
    }
  );

  if (
    result.url &&
    result.url.startsWith("/")
  ) {
    result.url =
      `${BASE_URL}${result.url}`;
  }

  return result;
}

export async function importAccountsWorkbook(
  file
) {
  const formData = new FormData();

  formData.append("file", file);

  return request(
    "/imports/accounts-workbook",
    {
      method: "POST",
      headers: {},
      body: formData,
    }
  );
}

export async function importNeoRevenueWorkbook(
  file,
  revenueMonth
) {
  const formData = new FormData();

  formData.append("file", file);
  formData.append(
    "revenue_month",
    revenueMonth
  );

  return request(
    "/imports/neo-revenue-workbook",
    {
      method: "POST",
      headers: {},
      body: formData,
    }
  );
}

export async function importNeoInvoicesCsv(
  file
) {
  const formData = new FormData();

  formData.append("file", file);

  return request(
    "/imports/neo-invoices-csv",
    {
      method: "POST",
      headers: {},
      body: formData,
    }
  );
}

// Clearer names for the active FastAPI backend.
// Old gasGet/gasPost names are kept so existing pages do not break.
export const apiGet = gasGet;
export const apiPost = gasPost;
