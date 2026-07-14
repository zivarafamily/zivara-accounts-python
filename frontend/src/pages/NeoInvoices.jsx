import { useEffect, useState, useMemo } from "react";
import { apiGet, apiPost, uploadSignature } from "../api/client";
import { formatDate, billingMonthOptions } from "../utils/format";
import { useLLP } from "../context/LLPContext";

const BUYER_DEFAULTS = {
  BuyerName:    "Neo Wealth Management Private Limited",
  BuyerAddress: "B-903, Marathon Futurex, Mafatlal Mills Compound, N. M. Joshi Marg, Lower Parel, Mumbai - 400013",
  BuyerGSTIN:   "27AAHCN8058K1ZV",
  BuyerState:   "Maharashtra, Code 27",
};

// ── Zivara seller defaults ──────────────────────────────────────────
const ZIVARA_GSTIN = "29AAEFZ3224B1ZD";
const ZIVARA_PAN   = "AAEFZ3224B";

// Indian number → words (Rupees Only)
function amountToWords(amount) {
  if (!amount || isNaN(amount)) return "";
  const num = Math.round(Number(amount));
  if (num === 0) return "Zero Rupees Only";
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function tw(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? " "+ones[n%10] : "");
    if (n < 1000) return ones[Math.floor(n/100)] + " Hundred" + (n%100 ? " "+tw(n%100) : "");
    if (n < 100000) return tw(Math.floor(n/1000)) + " Thousand" + (n%1000 ? " "+tw(n%1000) : "");
    if (n < 10000000) return tw(Math.floor(n/100000)) + " Lakh" + (n%100000 ? " "+tw(n%100000) : "");
    return tw(Math.floor(n/10000000)) + " Crore" + (n%10000000 ? " "+tw(n%10000000) : "");
  }
  return tw(num) + " Rupees Only";
}

// Normalise BillingMonth: ISO date → "Mar-2026", pass-through if already formatted
function formatBillingMonth(val) {
  if (!val) return "—";
  const s = String(val);
  if (/^[A-Za-z]{3}-\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d)) return s;
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return MO[d.getMonth()] + "-" + d.getFullYear();
}

// Invoice series: known partners use fixed prefixes; user rows can still override via InvoicePrefixGST/InvoicePrefixNG.
const ZIVARA_SIGNER = { label: "Zivara (default)", prefixGST: "ZivNeo", prefixNG: "ZivNeoN", signatory: "", signatureUrl: "https://drive.google.com/thumbnail?id=1rRNQV2R_T1uFfyy_N1aUpJH8hMwqcyGa&sz=w400" };
const PARTNER_SIGNERS = [
  { label: "Manugopal", prefixGST: "MAK", prefixNG: "MAKN", signatory: "Manugopal", signatureUrl: "" },
  { label: "Khushboo",  prefixGST: "AAF", prefixNG: "AAFN", signatory: "Khushboo",  signatureUrl: "" },
];

function normalizePersonName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function knownSignerForName(value) {
  const name = normalizePersonName(value);
  return PARTNER_SIGNERS.find(s => normalizePersonName(s.label) === name) || null;
}

function uniqueSigners(signers) {
  const seen = new Set();
  return signers.filter(s => {
    const key = normalizePersonName(s.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function signerMatches(signer, name) {
  const target = normalizePersonName(name);
  if (!target || !signer) return false;
  return normalizePersonName(signer.label) === target || normalizePersonName(signer.signatory) === target;
}

function findInvoiceSigner(inv, signersList) {
  const list = signersList || [ZIVARA_SIGNER];
  return list.find(s => signerMatches(s, inv.RaisedBy)) ||
    list.find(s => signerMatches(s, inv.AuthorisedSignatory)) ||
    list[0];
}

const cleanFilterValue = value => String(value || "").trim();
const partnerFilterValue = inv => cleanFilterValue(inv.RaisedBy || inv.AuthorisedSignatory);
const llpFilterValue = inv => cleanFilterValue(inv.SellerName);
const clientFilterValue = inv => cleanFilterValue(inv.BuyerName);
const monthFilterValue = inv => {
  const formatted = formatBillingMonth(inv.BillingMonth);
  return formatted === "—" ? "" : formatted;
};
const uniqueFilterOptions = (rows, getter) =>
  Array.from(new Set(rows.map(getter).map(cleanFilterValue).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

const GST_STATE_NAMES = {
  "01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh",
  "05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh",
  "10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur",
  "15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal",
  "20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh",
  "24":"Gujarat","25":"Daman & Diu","26":"Dadra & Nagar Haveli","27":"Maharashtra",
  "28":"Andhra Pradesh","29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala",
  "33":"Tamil Nadu","34":"Puducherry","35":"Andaman & Nicobar Islands","36":"Telangana",
  "37":"Andhra Pradesh","38":"Ladakh",
};
function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || "";
  if (typeof window !== "undefined") {
    const pageHost = window.location.hostname;
    const isLocalPage = ["localhost", "127.0.0.1", ""].includes(pageHost);
    const configuredHost = (() => {
      try {
        return configured ? new URL(configured, window.location.origin).hostname : "";
      } catch {
        return "";
      }
    })();
    if (!isLocalPage && (!configured || configuredHost === "zivara-accounts-api.onrender.com")) {
      return "/api";
    }
  }
  return configured || "http://127.0.0.1:8000";
}

const API_BASE_URL = resolveApiBaseUrl();

function resolveAssetUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/api/")) return value;
  return value.startsWith("/") ? `${API_BASE_URL}${value}` : value;
}

function panFromGSTIN(gstin) {
  const s = String(gstin || "").trim();
  return s.length >= 12 ? s.slice(2, 12) : "";
}

function stateFromGSTIN(gstin) {
  const code = String(gstin || "").trim().slice(0, 2);
  return GST_STATE_NAMES[code] ? `${GST_STATE_NAMES[code]}, Code : ${code}` : "";
}

function cleanPrefixPart(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").slice(0, 8);
}

function getLLPSellerDefaults(currentLLP) {
  if (!currentLLP || currentLLP.global) {
    return {
      SellerLLPID: "",
      SellerName: "Zivara Family Office LLP",
      SellerAddress: "",
      SellerGSTIN: ZIVARA_GSTIN,
      SellerPAN: ZIVARA_PAN,
      SellerState: "Karnataka, Code : 29",
      signer: ZIVARA_SIGNER,
    };
  }

  const llpName = currentLLP.llpName || currentLLP.LLPName || currentLLP.Name || "";
  const gstin = currentLLP.gstin || currentLLP.GSTIN || "";
  const pan = currentLLP.pan || currentLLP.PAN || panFromGSTIN(gstin);
  const address = currentLLP.address || currentLLP.Address || "";
  const shortCode = cleanPrefixPart(currentLLP.shortCode || currentLLP.ShortCode);
  const prefixBase = shortCode || cleanPrefixPart(llpName).slice(0, 3).toUpperCase() || "Neo";
  const isZivara = /zivara/i.test(llpName);
  const prefixGST = isZivara ? ZIVARA_SIGNER.prefixGST : `${prefixBase}Neo`;

  return {
    SellerName: llpName,
    SellerLLPID: currentLLP.llpId || currentLLP.LLPID || "",
    SellerAddress: address,
    SellerGSTIN: gstin,
    SellerPAN: pan,
    SellerState: stateFromGSTIN(gstin),
    signer: {
      label: `${llpName || "Entity"} (default)`,
      prefixGST,
      prefixNG: isZivara ? ZIVARA_SIGNER.prefixNG : `${prefixGST}N`,
      signatory: "",
      signatureUrl: isZivara ? ZIVARA_SIGNER.signatureUrl : "",
    },
  };
}

function llpRowToContext(llp) {
  if (!llp) return null;
  return {
    llpId: llp.llpId || llp.LLPID || "",
    llpName: llp.llpName || llp.LLPName || llp.Name || "",
    shortCode: llp.shortCode || llp.ShortCode || "",
    gstin: llp.gstin || llp.GSTIN || "",
    pan: llp.pan || llp.PAN || "",
    address: llp.address || llp.Address || "",
    global: !!llp.global,
  };
}

function getPrefix(signerLabel, signersList, isProforma) {
  const list = signersList || [ZIVARA_SIGNER];
  const s = list.find(x => x.label === signerLabel) || list[0];
  // Only Proforma uses the separate series. All regular invoices share prefixGST.
  return isProforma ? s.prefixNG : s.prefixGST;
}

function nextInvoiceNo(invoices, prefix) {
  const p = (prefix || "ZivNeo").toUpperCase();
  let max = 0;
  invoices.forEach(inv => {
    const m = String(inv.InvoiceNo || "").toUpperCase().match(new RegExp("^" + p + "(\\d+)$"));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + String(max + 1).padStart(3, "0");
}

function getAccountNumber(acct) {
  return acct?.AccountNumber ? String(acct.AccountNumber) : "";
}

function getBranchIFSC(acct) {
  return [acct?.Branch || "", acct?.IFSC || ""].filter(Boolean).join(" / ");
}

function getDefaultBankAccount(accounts, currentLLP) {
  const active = (accounts || []).filter(a => String(a.IsActive || "Yes").toLowerCase() !== "no");
  const llpName = String(currentLLP?.llpName || currentLLP?.LLPName || "").toLowerCase();
  const shortCode = String(currentLLP?.shortCode || currentLLP?.ShortCode || "").toLowerCase();
  const entityMatch = active.find(a => {
    const text = [a.AccountName, a.BankName, a.Notes].filter(Boolean).join(" ").toLowerCase();
    return (llpName && text.includes(llpName)) || (shortCode && text.includes(shortCode));
  });
  const zivara = active.find(a =>
    [a.AccountName, a.BankName, a.Notes].filter(Boolean).join(" ").toLowerCase().includes("zivara")
  );
  const current = active.find(a =>
    String(a.AccountType || "").toLowerCase() === "current" && getAccountNumber(a)
  );
  const withAccountNo = active.find(a => getAccountNumber(a));
  return entityMatch || zivara || current || withAccountNo || (active.length === 1 ? active[0] : null);
}

// GST calc helper
function calcGST(taxable, rate) {
  const t = Number(taxable) || 0;
  const r = Number(rate)    || 0;
  const gstAmt   = Math.round(t * r / 100 * 100) / 100;
  const total    = Math.round((t + gstAmt) * 100) / 100;
  return { gstAmt, total };
}

const initial = {
  SellerLLPID:     "",
  RaisedBy:        "Zivara (default)",
  InvoiceType:     "Professional Fees",
  GSTMode:         "Without GST",
  GSTType:         "IGST",
  GSTRate:         "",
  TaxableAmount:   "",
  GSTAmount:       "",
  TaxAmountInWords:"",
  TDSRate:         "",
  TDSAmount:       "",
  NetPayable:      "",
  SACCode:         "998311",
  IsProforma:      "No",
  InvoiceNo:       "",
  InvoiceDate:     new Date().toISOString().slice(0, 10),
  BillingMonth:    "",
  SellerName:      "Zivara Family Office LLP",
  SellerAddress:   "",
  SellerGSTIN:     ZIVARA_GSTIN,
  SellerPAN:       ZIVARA_PAN,
  SellerState:     "Karnataka, Code : 29",
  ...BUYER_DEFAULTS,
  Particulars:     "",
  Amount:          "",
  AmountInWords:   "",
  Narration:       "",
  BankName:        "",
  AccountNo:       "",
  BranchIFSC:      "",
  AuthorisedSignatory: "",
  Status:          "Draft",
  Notes:           "",
};

const card   = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.25rem" };
const lbl    = { display: "block", fontSize: ".75rem", color: "var(--muted)", marginBottom: ".35rem", fontWeight: 500 };
const inp    = { width: "100%", boxSizing: "border-box", padding: ".5rem .65rem", background: "var(--input,#1e293b)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: ".875rem" };
const btn    = (v = "primary") => ({
  padding: ".55rem 1.2rem", borderRadius: "6px", border: v === "outline" ? "1px solid var(--border)" : "none",
  fontWeight: 600, fontSize: ".875rem", cursor: "pointer",
  background: v === "primary" ? "var(--accent)" : "transparent",
  color: v === "primary" ? "#fff" : "var(--muted)",
});
const g2     = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: ".75rem" };
const g3     = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: ".75rem" };
const secHdr = { fontWeight: 600, fontSize: ".78rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: ".75rem" };
const fmt    = n => (n != null && n !== "" && !isNaN(Number(n))) ? "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—";

const INVOICE_TYPES = ["Professional Fees", "Transition Capital", "Revenue Sharing"];
const GST_MODES     = ["With GST", "Without GST"];
const STATUSES      = ["Draft", "Sent", "Paid", "Cancelled"];
const SAC_OPTIONS   = [
  { code: "998311", label: "998311 - Management consulting / advisory" },
  { code: "998312", label: "998312 - Business consulting" },
  { code: "998313", label: "998313 - IT consulting / support" },
];

function printInvoice(inv, signersList) {
  const fmtD = v => { if (!v) return ""; const s = String(v).slice(0,10); const [y,m,d] = s.split('-'); return (d&&m&&y) ? `${d}-${m}-${y}` : String(v); };
  const fmtA = n => "\u20B9" + Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2});
  const esc  = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // ── Determine invoice type ──────────────────────────────────────
  // Rule 1: Proforma Invoice + With GST → SAC column, GST breakup, Tax Details
  // Rule 2: Proforma Invoice + Without GST → no SAC, just Amount + Total
  // Rule 3: Invoice + Without GST → no SAC, no GST breakup, just Amount + Total
  // Rule 4: Invoice + With GST    → SAC column, GST row, Tax Details table, Tax Amount in words
  const withGST    = String(inv.GSTMode||'').toLowerCase() === 'with gst';

  // Compute amounts
  const amountRaw  = Number(inv.Amount||0);
  const gstRate    = Number(inv.GSTRate||0) || (withGST ? 18 : 0);
  let   taxable    = withGST ? Number(inv.TaxableAmount||0) : amountRaw;
  if (withGST && taxable === 0 && amountRaw > 0)
    taxable = Math.round(amountRaw / (1 + gstRate / 100));
  const gstAmt     = withGST ? (Number(inv.GSTAmount||0) || Math.round(taxable * gstRate / 100 * 100) / 100) : 0;
  const grandTotal = withGST ? Math.round((taxable + gstAmt) * 100) / 100 : amountRaw;
  const tdsRate    = Number(inv.TDSRate||0);
  const tdsAmt     = Number(inv.TDSAmount||0) || Math.round(taxable * tdsRate / 100 * 100) / 100;
  const netPayable = tdsAmt > 0 ? Math.round((grandTotal - tdsAmt) * 100) / 100 : 0;
  const gstType    = inv.GSTType || 'IGST';
  const sac        = inv.SACCode || (withGST ? '998311' : '');
  const includeSAC = withGST || !!String(sac).trim();
  const isCGST     = gstType === 'CGST+SGST';
  const halfAmt    = Math.round(gstAmt / 2 * 100) / 100;
  const halfRate   = gstRate / 2;

  // ── Item table rows ──────────────────────────────────────────────
  const itemHeader = includeSAC
    ? `<tr><th class="c" style="width:5%">Sl<br>No.</th><th colspan="2">Particulars</th><th class="c" style="width:12%">SAC<br>Code</th><th class="r" style="width:18%">Amount</th></tr>`
    : `<tr><th class="c" style="width:5%">Sl<br>No.</th><th colspan="3">Particulars</th><th class="r" style="width:18%">Amount</th></tr>`;

  const itemRow = includeSAC
    ? `<tr><td class="c">1</td><td colspan="2" class="y b" style="padding:5px 7px">${esc(inv.Particulars)}</td><td class="c y b">${esc(sac)}</td><td class="r y b">${fmtA(taxable)}</td></tr>`
    : `<tr><td class="c">1</td><td colspan="3" class="y b" style="padding:5px 7px">${esc(inv.Particulars)}</td><td class="r y b">${fmtA(amountRaw)}</td></tr>`;

  const gstRow = withGST
    ? `<tr><td></td><td colspan="2" class="r">Output ${esc(gstType)}@${gstRate}%</td><td></td><td class="r">${fmtA(gstAmt)}</td></tr>`
    : includeSAC
      ? `<tr><td></td><td colspan="2" style="height:22px"></td><td></td><td></td></tr>`
      : `<tr><td></td><td colspan="3" style="height:22px"></td><td></td></tr>`;

  const taxWordsRow = withGST && gstAmt
    ? `<tr><td colspan="2">Tax Amount (in words)&nbsp;:</td><td colspan="3" class="y">${esc(inv.TaxAmountInWords || amountToWords(gstAmt))}</td></tr>`
    : '';

  // ── Tax Details table (only With GST) ───────────────────────────
  const taxTable = withGST ? `
<tr><td colspan="5" style="padding:3px 7px;font-weight:600;background:#f5f5f5">Tax Details</td></tr>
<tr>
  <th class="r" colspan="2">Taxable Value</th>
  ${isCGST
    ? `<th class="c">CGST %</th><th class="r">CGST Amt</th><th class="r">SGST Amt</th>`
    : `<th class="c">IGST %</th><th colspan="2" class="r">IGST Amount</th>`}
</tr>
<tr>
  <td class="r" colspan="2">${fmtA(taxable)}</td>
  ${isCGST
    ? `<td class="c">${halfRate}%</td><td class="r">${fmtA(halfAmt)}</td><td class="r">${fmtA(halfAmt)}</td>`
    : `<td class="c">${gstRate}%</td><td colspan="2" class="r">${fmtA(gstAmt)}</td>`}
</tr>
<tr>
  <td class="b" colspan="2">Total</td>
  ${isCGST
    ? `<td></td><td class="r b">${fmtA(halfAmt)}</td><td class="r b">${fmtA(halfAmt)}</td>`
    : `<td></td><td colspan="2" class="r b">${fmtA(gstAmt)}</td>`}
</tr>` : '';

  // TDS row in PDF (only when TDS is present)
  const tdsRow = tdsAmt > 0
    ? `<tr><td colspan="3" class="r">Less: TDS @${tdsRate > 0 ? tdsRate + '%' : ''}</td><td></td><td class="r" style="color:#c00">(${fmtA(tdsAmt)})</td></tr>
<tr><td colspan="3" style="border:none"></td><td class="r b">Net Payable</td><td class="r b">${fmtA(netPayable)}</td></tr>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${esc(inv.InvoiceNo)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10pt;color:#000;background:#fff}
.page{width:720px;margin:0 auto;padding:16px}
table{border-collapse:collapse;width:100%;table-layout:fixed}
td,th{border:1px solid #000;padding:3px 7px;vertical-align:top;font-size:10pt;word-break:break-word}
.y{background:#fff}.b{font-weight:bold}.c{text-align:center}.r{text-align:right}
@media print{body,html{margin:0;padding:0}.page{width:100%;padding:0}@page{size:A4;margin:12mm 10mm}}
</style></head><body><div class="page"><table>
<colgroup><col style="width:6%"><col style="width:27%"><col style="width:27%"><col style="width:18%"><col style="width:22%"></colgroup>
<tr><td colspan="5" class="c b" style="font-size:13pt;padding:7px;letter-spacing:.5px">${esc(inv.InvoiceTitle || (inv.IsProforma==='Yes' ? 'Proforma Invoice' : inv.GSTMode==='With GST' ? 'Tax Invoice' : 'Invoice'))}</td></tr>
<tr><td colspan="3" class="y b">NAME</td><td>Invoice No.</td><td>Dated</td></tr>
<tr><td colspan="3">${esc(inv.SellerName)}</td><td class="y b">${esc(inv.InvoiceNo)}</td><td>${fmtD(inv.InvoiceDate)}</td></tr>
${inv.SellerAddress ? `<tr><td colspan="3">${esc(inv.SellerAddress).replace(/\n/g,'<br>')}</td><td colspan="2"></td></tr>` : ''}
<tr><td colspan="3">GSTIN/UIN:&nbsp;${esc(inv.SellerGSTIN)}</td><td colspan="2"></td></tr>
<tr><td colspan="3" class="y">PAN&nbsp;&nbsp;${esc(inv.SellerPAN)}</td><td colspan="2"></td></tr>
<tr><td colspan="5">State Name :&nbsp;&nbsp;${esc(inv.SellerState||'Karnataka, Code : 29')}</td></tr>
<tr><td colspan="5" style="font-size:9pt;color:#555;padding:2px 7px">Consignee (Ship to)</td></tr>
<tr><td colspan="5" class="b">${esc(inv.BuyerName)}</td></tr>
<tr><td colspan="5">${esc(inv.BuyerAddress)}</td></tr>
<tr><td colspan="5">GSTIN/UIN:&nbsp;&nbsp;${esc(inv.BuyerGSTIN)}</td></tr>
<tr><td colspan="5">State Name :&nbsp;&nbsp;${esc(inv.BuyerState)}</td></tr>
<tr><td colspan="5" style="font-size:9pt;color:#555;padding:2px 7px">Buyer (Bill to)</td></tr>
<tr><td colspan="5" class="b">${esc(inv.BuyerName)}</td></tr>
<tr><td colspan="5">${esc(inv.BuyerAddress)}</td></tr>
<tr><td colspan="5">GSTIN/UIN:&nbsp;&nbsp;${esc(inv.BuyerGSTIN)}</td></tr>
<tr><td colspan="5">State Name :&nbsp;&nbsp;${esc(inv.BuyerState)}</td></tr>
${itemHeader}
${itemRow}
${gstRow}
<tr><td></td><td colspan="3" style="height:22px"></td><td></td></tr>
<tr><td colspan="3" style="border:none"></td><td class="r b">Total</td><td class="r b">${fmtA(grandTotal)}</td></tr>
<tr><td colspan="4">Amount Chargeable (in words)</td><td class="r" style="font-size:8pt">E. &amp; O.E</td></tr>
<tr><td colspan="5" class="y b">INR&nbsp;${esc(inv.AmountInWords||'')}</td></tr>
${tdsRow}
${taxWordsRow}
${taxTable}
<tr><td colspan="2">Remarks:</td><td colspan="3">Company's Bank Details</td></tr>
<tr>
  <td colspan="2" style="min-height:50px;padding:5px 7px">${esc(inv.Narration||'')}</td>
  <td colspan="3" style="line-height:1.8">Bank Name:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${esc(inv.BankName)}<br>A/c No.:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${esc(inv.AccountNo)}<br>Branch &amp; IFS Code:&nbsp;${esc(inv.BranchIFSC)}</td>
</tr>
<tr><td colspan="2" class="y b" style="padding:5px 7px">${esc(inv.AuthorisedSignatory||'')}</td><td colspan="3" style="text-align:right;padding:5px 7px">${
  (() => {
    const signer = findInvoiceSigner(inv, signersList);
    const sigUrl = signer && signer.signatureUrl ? signer.signatureUrl : '';
    return sigUrl
      ? `<img src="${sigUrl}" alt="signature" style="max-height:48px;max-width:140px;display:block;margin-left:auto;margin-bottom:2px">`
      : '';
  })()
}<span class="b">Authorised Signatory</span></td></tr>
</table></div>
<script>window.onload=function(){window.print()}</script></body></html>`;

  const w = window.open('', '_blank', 'width=900,height=1200');
  if (w) { w.document.write(html); w.document.close(); }
}

export default function NeoInvoices({ role = "admin", employeeRef = "" }) {
  const { currentLLP } = useLLP();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const isPartner = normalizedRole === "partner";
  const canPickSeller = ["admin", "managing_partner"].includes(normalizedRole);
  const [invoices, setInvoices] = useState([]);
  const [form,     setForm]     = useState(initial);
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [open,         setOpen]         = useState(false);
  const [editId,       setEditId]       = useState(null);
  const [search,       setSearch]       = useState("");
  const [statusF,      setStatusF]      = useState("");
  const [partnerF,     setPartnerF]     = useState("");
  const [llpF,         setLlpF]         = useState("");
  const [clientF,      setClientF]      = useState("");
  const [monthF,       setMonthF]       = useState("");
  const [typeF,        setTypeF]        = useState("");
  const [gstF,         setGstF]         = useState("");
  const [bankAccounts, setBankAccounts] = useState([]);
  const [employees,    setEmployees]    = useState([]);
  const [llps,         setLlps]         = useState([]);
  const [signatureOverrides, setSignatureOverrides] = useState({});
  const authSignatureUrl = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("zivara_auth") || "null")?.signatureURL || "";
    } catch {
      return "";
    }
  }, []);

  const effectiveCurrentLLP = useMemo(() => {
    if (!currentLLP || currentLLP.global) return currentLLP;
    const currentId = String(currentLLP.llpId || currentLLP.LLPID || "");
    const full = (llps || []).find(l => String(l.LLPID || l.llpId || "") === currentId);
    return full ? { ...currentLLP, ...llpRowToContext(full) } : currentLLP;
  }, [currentLLP, llps]);
  const llpDefaults = useMemo(() => getLLPSellerDefaults(effectiveCurrentLLP), [effectiveCurrentLLP]);

  function currentSellerContext() {
    if (!effectiveCurrentLLP || effectiveCurrentLLP.global) return effectiveCurrentLLP;
    const currentId = String(effectiveCurrentLLP.llpId || effectiveCurrentLLP.LLPID || "");
    const full = (llps || []).find(l => String(l.LLPID || l.llpId || "") === currentId);
    return full ? { ...effectiveCurrentLLP, ...llpRowToContext(full) } : effectiveCurrentLLP;
  }

  const sellerLLPs = useMemo(() => {
    if (canPickSeller) {
      return (llps || [])
        .filter(l => String(l.Status || "Active").trim().toLowerCase() !== "inactive")
        .map(llpRowToContext)
        .filter(l => l?.llpName);
    }
    return effectiveCurrentLLP && !effectiveCurrentLLP.global ? [llpRowToContext(effectiveCurrentLLP)] : [];
  }, [canPickSeller, llps, effectiveCurrentLLP]);

  const signers = useMemo(() => {
    const loggedInPartnerSigner = knownSignerForName(employeeRef);
    const signedInSignature = signatureOverrides[employeeRef] || authSignatureUrl;
    const defaultSigner = llpDefaults.signer || ZIVARA_SIGNER;
    const defaultSignature = signatureOverrides[defaultSigner.label] ||
      signatureOverrides[defaultSigner.signatory] ||
      defaultSigner.signatureUrl;
    const employeeSigners = employees
      .filter(e => e.InvoicePrefixGST || knownSignerForName(e.Name))
      .map(e => {
        const known = knownSignerForName(e.Name);
        return {
          label:        e.Name,
          prefixGST:    e.InvoicePrefixGST || known?.prefixGST || "",
          prefixNG:     e.InvoicePrefixNG || known?.prefixNG || ((e.InvoicePrefixGST || known?.prefixGST || "") + "N"),
          signatory:    e.Name,
          signatureUrl: resolveAssetUrl(signatureOverrides[e.Name] || e.SignatureURL || known?.signatureUrl || ""),
        };
      });
    return uniqueSigners([
      { ...defaultSigner, signatureUrl: resolveAssetUrl(defaultSignature) },
      ...(loggedInPartnerSigner ? [{ ...loggedInPartnerSigner, signatureUrl: resolveAssetUrl(signedInSignature || loggedInPartnerSigner.signatureUrl) }] : []),
      ...employeeSigners,
      ...PARTNER_SIGNERS.map(s => ({ ...s, signatureUrl: resolveAssetUrl(signatureOverrides[s.label] || s.signatureUrl) })),
    ]);
  }, [employees, employeeRef, llpDefaults.signer, signatureOverrides, authSignatureUrl]);

  async function load() {
    setLoading(true);
    try {
      const [invRes, bankRes, empRes, llpRes] = await Promise.allSettled([
        apiGet("getNeoInvoices"),
        apiGet("getBankAccounts"),
        apiGet("getUsers"),
        apiGet("getLLPs"),
      ]);
      if (invRes.status  === "fulfilled" && invRes.value.ok)  setInvoices(invRes.value.data || []);
      if (bankRes.status === "fulfilled" && bankRes.value.ok) setBankAccounts(bankRes.value.data || []);
      if (empRes.status  === "fulfilled" && empRes.value.ok)  setEmployees(empRes.value.data || []);
      if (llpRes.status  === "fulfilled" && llpRes.value.ok)  setLlps(llpRes.value.data || []);
    } catch {
      // Keep the existing screen state if one of the parallel lookups fails.
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [currentLLP?.llpId]);

  // Fill form bank fields from a BankAccounts row
  function applyBankAccount(acct) {
    if (!acct) return;
    setForm(p => ({
      ...p,
      BankName:  acct.BankName    || "",
      AccountNo: getAccountNumber(acct),
      BranchIFSC: getBranchIFSC(acct),
    }));
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  function sellerOptionKey(llp) {
    return String(llp?.llpId || llp?.llpName || "");
  }

  function findSelectedSellerLLP() {
    const sellerLLPId = String(form.SellerLLPID || "").trim();
    if (sellerLLPId) {
      const byId = sellerLLPs.find(l => String(l.llpId || "") === sellerLLPId);
      if (byId) return byId;
    }
    const sellerName = String(form.SellerName || "").trim().toLowerCase();
    const sellerGSTIN = String(form.SellerGSTIN || "").trim().toLowerCase();
    return sellerLLPs.find(l => {
      const llpName = String(l.llpName || "").trim().toLowerCase();
      const gstin = String(l.gstin || "").trim().toLowerCase();
      return (sellerGSTIN && gstin && sellerGSTIN === gstin) ||
        (sellerName && llpName && sellerName === llpName);
    }) || null;
  }

  function applySellerLLP(key) {
    const llp = sellerLLPs.find(l => sellerOptionKey(l) === key);
    if (!llp) return;
    const { signer: _entitySigner, ...sellerDefaults } = getLLPSellerDefaults(llp);
    const bank = getDefaultBankAccount(bankAccounts, llp);
    setForm(p => ({
      ...p,
      ...sellerDefaults,
      SellerLLPID: llp.llpId || "",
      ...(bank ? {
        BankName: bank.BankName || "",
        AccountNo: getAccountNumber(bank),
        BranchIFSC: getBranchIFSC(bank),
      } : {}),
    }));
  }

  // Auto-derive InvoiceTitle label (display only)
  const invoiceTitle = form.IsProforma === "Yes" ? "Proforma Invoice"
    : form.GSTMode === "With GST" ? "Tax Invoice"
    : "Invoice";
  const includeSAC = !!String(form.SACCode || "").trim();
  const sacSelected = form.GSTMode === "With GST" || includeSAC;
  const canUseTDS = form.GSTMode === "With GST" ||
    (form.GSTMode === "Without GST" && form.IsProforma === "No");

  function openAdd() {
    // Partners always raise under their own name
    const signerLabel = isPartner ? (employeeRef || signers[0].label) : signers[0].label;
    const signer = signers.find(s => s.label === signerLabel) || signers[0];
    const prefix = getPrefix(signer.label, signers, initial.IsProforma === "Yes");
    const sellerContext = currentSellerContext();
    const { signer: _entitySigner, ...sellerDefaults } = getLLPSellerDefaults(sellerContext);
    const base = {
      ...initial,
      ...sellerDefaults,
      RaisedBy: signer.label,
      InvoiceNo: nextInvoiceNo(invoices, prefix),
      AuthorisedSignatory: signer.signatory,
    };
    const b = getDefaultBankAccount(bankAccounts, sellerContext);
    if (b) {
      base.BankName   = b.BankName     || "";
      base.AccountNo  = getAccountNumber(b);
      base.BranchIFSC = getBranchIFSC(b);
    }
    setForm(base); setEditId(null); setOpen(true);
  }

  // When RaisedBy changes: update InvoiceNo series + AuthorisedSignatory
  function handleRaisedByChange(label) {
    const signer = signers.find(s => s.label === label) || signers[0];
    const prefix = getPrefix(label, signers, form.IsProforma === "Yes");
    setForm(p => ({
      ...p,
      RaisedBy:            signer.label,
      InvoiceNo:           nextInvoiceNo(invoices, prefix),
      AuthorisedSignatory: signer.signatory || p.AuthorisedSignatory,
    }));
  }

  // When TaxableAmount or GSTRate changes: recalc GSTAmount, Amount, words, NetPayable
  function handleTaxableChange(taxable, rate, mode) {
    const useGST = (mode || form.GSTMode) === "With GST";
    const { gstAmt, total } = calcGST(taxable, useGST ? (rate !== undefined ? rate : form.GSTRate) : 0);
    const grandTotal = useGST ? total : (Number(taxable) || 0);
    const tdsAmt = Math.round((Number(taxable) || 0) * (Number(form.TDSRate) || 0) / 100 * 100) / 100;
    const netPayable = grandTotal - tdsAmt;
    setForm(p => ({
      ...p,
      TaxableAmount:    taxable,
      GSTRate:          rate !== undefined ? rate : p.GSTRate,
      GSTAmount:        useGST ? gstAmt : "",
      TaxAmountInWords: useGST && gstAmt ? amountToWords(gstAmt) : "",
      Amount:           grandTotal || "",
      AmountInWords:    grandTotal ? amountToWords(grandTotal) : "",
      TDSAmount:        tdsAmt || "",
      NetPayable:       netPayable || "",
    }));
  }

  function handleTDSRateChange(tdsRate) {
    const grandTotal = Number(form.Amount) || 0;
    const taxable    = Number(form.TaxableAmount) || 0;
    const tdsAmt     = Math.round(taxable * (Number(tdsRate) || 0) / 100 * 100) / 100;
    const netPayable = grandTotal - tdsAmt;
    setForm(p => ({ ...p, TDSRate: tdsRate, TDSAmount: tdsAmt || "", NetPayable: netPayable || "" }));
  }

  function handleSACToggle(checked) {
    setForm(p => ({ ...p, SACCode: checked ? (p.SACCode || SAC_OPTIONS[0].code) : "" }));
  }

  async function handleSignatureUpload(file) {
    if (!file) return;
    try {
      const res = await uploadSignature(file, form.RaisedBy);
      if (res.ok && res.url) {
        const signer = res.signer || form.RaisedBy;
        setSignatureOverrides(p => ({ ...p, [signer]: res.url, [form.RaisedBy]: res.url }));
        setEmployees(rows => rows.map(e =>
          normalizePersonName(e.Name) === normalizePersonName(signer)
            ? { ...e, SignatureURL: res.url }
            : e
        ));
        if (normalizePersonName(signer) === normalizePersonName(employeeRef)) {
          try {
            const auth = JSON.parse(localStorage.getItem("zivara_auth") || "null");
            if (auth) localStorage.setItem("zivara_auth", JSON.stringify({ ...auth, signatureURL: res.url }));
          } catch {
            // Ignore storage failures; the current screen still has the uploaded signature.
          }
        }
      }
    } catch (err) {
      alert(err.message || "Signature upload failed");
    }
  }

  function openEdit(inv) {
    const isGSTInv = (inv.GSTMode||'') === 'With GST';
    const storedRate     = Number(inv.GSTRate||0);
    const effectiveRate  = storedRate || (isGSTInv ? 18 : 0);
    const storedTaxable  = Number(inv.TaxableAmount||0);
    const storedAmount   = Number(inv.Amount||0);
    const storedGSTAmt   = Number(inv.GSTAmount||0);
    // Back-calculate taxable from grand total if missing
    const derivedTaxable = (isGSTInv && storedTaxable === 0 && storedAmount > 0 && effectiveRate > 0)
      ? Math.round(storedAmount / (1 + effectiveRate / 100))
      : storedTaxable;
    const derivedGST = (isGSTInv && storedGSTAmt === 0 && derivedTaxable > 0)
      ? Math.round(derivedTaxable * effectiveRate / 100 * 100) / 100
      : storedGSTAmt;
    setForm({
      RaisedBy:            inv.RaisedBy            || "Zivara (default)",
      GSTType:             inv.GSTType             || "IGST",
      GSTRate:             isGSTInv ? String(effectiveRate) : (inv.GSTRate || ""),
      TaxableAmount:       derivedTaxable || "",
      GSTAmount:           derivedGST    || "",
      TaxAmountInWords:    inv.TaxAmountInWords     || (derivedGST ? amountToWords(derivedGST) : ""),
      TDSRate:             inv.TDSRate              || "",
      TDSAmount:           inv.TDSAmount            || "",
      NetPayable:          inv.NetPayable           || "",
      SACCode:             inv.SACCode              || "998311",
      InvoiceType:         inv.InvoiceType         || "Professional Fees",
      GSTMode:             inv.GSTMode             || "Without GST",
      IsProforma:          inv.IsProforma          || "No",
      InvoiceNo:           inv.InvoiceNo           || "",
      InvoiceDate:         inv.InvoiceDate?.toString().slice(0,10) || "",
      BillingMonth:        formatBillingMonth(inv.BillingMonth) || "",
      SellerName:          inv.SellerName          || llpDefaults.SellerName || "",
      SellerLLPID:         inv.SellerLLPID         || llpDefaults.SellerLLPID || "",
      SellerAddress:       inv.SellerAddress       || llpDefaults.SellerAddress || "",
      SellerGSTIN:         inv.SellerGSTIN         || llpDefaults.SellerGSTIN || ZIVARA_GSTIN,
      SellerPAN:           inv.SellerPAN           || llpDefaults.SellerPAN || ZIVARA_PAN,
      SellerState:         inv.SellerState         || llpDefaults.SellerState || "Karnataka, Code : 29",
      BuyerName:           inv.BuyerName           || BUYER_DEFAULTS.BuyerName,
      BuyerAddress:        inv.BuyerAddress        || BUYER_DEFAULTS.BuyerAddress,
      BuyerGSTIN:          inv.BuyerGSTIN          || BUYER_DEFAULTS.BuyerGSTIN,
      BuyerState:          inv.BuyerState          || BUYER_DEFAULTS.BuyerState,
      Particulars:         inv.Particulars         || "",
      Amount:              inv.Amount              || "",
      AmountInWords:       inv.AmountInWords       || "",
      Narration:           inv.Narration           || "",
      BankName:            inv.BankName            || "",
      AccountNo:           inv.AccountNo           || "",
      BranchIFSC:          inv.BranchIFSC          || "",
      AuthorisedSignatory: inv.AuthorisedSignatory || "",
      Status:              inv.Status              || "Draft",
      Notes:               inv.Notes               || "",
    });
    setEditId(inv.NeoInvoiceID);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const action  = editId ? "updateNeoInvoice" : "saveNeoInvoice";
      const payload = editId ? { ...form, NeoInvoiceID: editId } : form;
      const r = await apiPost(action, payload);
      if (r.ok) { setOpen(false); setEditId(null); setForm(initial); load(); }
      else alert(r.error || "Error saving invoice");
    } finally { setSaving(false); }
  }

  async function removeInvoice(inv) {
    if (!window.confirm(`Delete invoice ${inv.InvoiceNo}?`)) return;
    try {
      const r = await apiPost("deleteNeoInvoice", { NeoInvoiceID:inv.NeoInvoiceID });
      if (r.ok) load();
    } catch (err) {
      alert(err.message || "Unable to delete invoice");
    }
  }

  const visibleInvoices = useMemo(() => invoices.filter(inv => {
    // Partners only see their own invoices
    // Match on RaisedBy first; fall back to AuthorisedSignatory for invoices saved before RaisedBy column existed
    const raisedBy = partnerFilterValue(inv);
    if (isPartner && employeeRef && raisedBy !== String(employeeRef).trim()) return false;
    return true;
  }), [invoices, isPartner, employeeRef]);

  const partnerOptions = useMemo(() => uniqueFilterOptions(visibleInvoices, partnerFilterValue), [visibleInvoices]);
  const llpOptions = useMemo(() => uniqueFilterOptions(visibleInvoices, llpFilterValue), [visibleInvoices]);
  const clientOptions = useMemo(() => uniqueFilterOptions(visibleInvoices, clientFilterValue), [visibleInvoices]);
  const monthOptions = useMemo(() => uniqueFilterOptions(visibleInvoices, monthFilterValue), [visibleInvoices]);
  const typeOptions = useMemo(() => uniqueFilterOptions(visibleInvoices, inv => inv.InvoiceType), [visibleInvoices]);
  const gstOptions = useMemo(() => uniqueFilterOptions(visibleInvoices, inv => inv.GSTMode), [visibleInvoices]);

  const filtered = useMemo(() => visibleInvoices.filter(inv => {
    const s = search.trim().toLowerCase();
    const partner = partnerFilterValue(inv);
    const llp = llpFilterValue(inv);
    const client = clientFilterValue(inv);
    const month = monthFilterValue(inv);
    const type = cleanFilterValue(inv.InvoiceType);
    const gst = cleanFilterValue(inv.GSTMode);
    const searchableText = [
      inv.InvoiceNo,
      inv.InvoiceTitle,
      inv.InvoiceDate,
      inv.BillingMonth,
      month,
      type,
      gst,
      partner,
      llp,
      client,
      inv.Particulars,
      inv.Status,
    ].map(v => String(v || "").toLowerCase()).join(" ");
    const matchSearch = !s ||
      searchableText.includes(s);
    const matchStatus = !statusF || inv.Status === statusF;
    const matchPartner = !partnerF || partner === partnerF;
    const matchLLP = !llpF || llp === llpF;
    const matchClient = !clientF || client === clientF;
    const matchMonth = !monthF || month === monthF;
    const matchType = !typeF || type === typeF;
    const matchGST = !gstF || gst === gstF;
    return matchSearch && matchStatus && matchPartner && matchLLP && matchClient && matchMonth && matchType && matchGST;
  }), [visibleInvoices, search, statusF, partnerF, llpF, clientF, monthF, typeF, gstF]);

  const statusColor = s => ({ Draft:"#f59e0b", Sent:"#6366f1", Paid:"#22c55e", Cancelled:"#ef4444" }[s] || "var(--muted)");

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:".75rem" }}>
        <div>
          <h2 style={{ margin:0, fontSize:"1.2rem", fontWeight:700 }}>Neo Invoices</h2>
          <p style={{ margin:0, fontSize:".8rem", color:"var(--muted)" }}>{invoices.length} invoices</p>
        </div>
        <button style={btn("primary")} onClick={openAdd}>+ New Invoice</button>
      </div>

      {/* ── FORM MODAL ──────────────────────────────────────────────────────── */}
      {open && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:100, overflowY:"auto", padding:"1.5rem 1rem" }}>
          <div style={{ maxWidth:"700px", margin:"0 auto", background:"var(--card)", borderRadius:"var(--radius)", padding:"1.5rem", border:"1px solid var(--border)" }}>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <div>
                <h3 style={{ margin:0, fontSize:"1rem", fontWeight:700 }}>
                  {editId ? "Edit Invoice" : "New Invoice"}
                </h3>
                <div style={{ fontSize:".75rem", color:"var(--accent)", marginTop:".2rem" }}>
                  Title: <strong>{invoiceTitle}</strong>
                </div>
              </div>
              <button style={btn("ghost")} onClick={() => setOpen(false)}>✕</button>
            </div>

            <form onSubmit={save} style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>

              {/* Invoice Header */}
              <div>
                <div style={secHdr}>Invoice Details</div>
                <div style={g3}>
                  <div>
                    <label style={lbl}>Raised By</label>
                    <select style={inp} value={form.RaisedBy} onChange={e=>handleRaisedByChange(e.target.value)} disabled={!!editId || isPartner}>
                      {signers.map(s=><option key={s.label}>{s.label}</option>)}
                    </select>
                    <label style={{ ...btn("outline"), display:"inline-block", marginTop:".45rem", padding:".35rem .65rem", fontSize:".75rem" }}>
                      Upload signature
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display:"none" }}
                        onChange={e => { handleSignatureUpload(e.target.files?.[0]); e.target.value = ""; }}
                      />
                    </label>
                    {(signers.find(s => s.label === form.RaisedBy)?.signatureUrl || signatureOverrides[form.RaisedBy]) && (
                      <span style={{ marginLeft:".5rem", fontSize:".72rem", color:"#22c55e" }}>Signature ready</span>
                    )}
                  </div>
                  <div>
                    <label style={lbl}>Invoice Type</label>
                    <select style={inp} value={form.InvoiceType} onChange={e=>set("InvoiceType",e.target.value)}>
                      {INVOICE_TYPES.map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>GST Mode</label>
                    <select style={inp} value={form.GSTMode} onChange={e => {
                      const newMode = e.target.value;
                      const useGST    = newMode === "With GST";
                      const { gstAmt, total } = calcGST(form.TaxableAmount, useGST ? form.GSTRate : 0);
                      const grandTotal = useGST ? total : (Number(form.TaxableAmount) || 0);
                      const tdsAllowed = useGST || form.IsProforma === "No";
                      setForm(p => ({
                        ...p,
                        GSTMode:          newMode,
                        // Only generate a new InvoiceNo for new invoices, not edits
                        ...(!editId && { InvoiceNo: nextInvoiceNo(invoices, getPrefix(form.RaisedBy, signers, form.IsProforma === "Yes")) }),
                        SACCode:          useGST && !p.SACCode ? SAC_OPTIONS[0].code : p.SACCode,
                        GSTAmount:        useGST ? gstAmt : "",
                        TaxAmountInWords: useGST && gstAmt ? amountToWords(gstAmt) : "",
                        Amount:           grandTotal || "",
                        AmountInWords:    grandTotal ? amountToWords(grandTotal) : "",
                        ...(tdsAllowed ? {} : { TDSRate:"", TDSAmount:"", NetPayable:"" }),
                      }));
                    }}>
                      {GST_MODES.map(g=><option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Is Proforma?</label>
                    <select style={inp} value={form.IsProforma} onChange={e => {
                      const newIsProforma = e.target.value;
                      const tdsAllowed = form.GSTMode === "With GST" ||
                        (form.GSTMode === "Without GST" && newIsProforma === "No");
                      setForm(p => ({
                        ...p,
                        IsProforma: newIsProforma,
                        // Regenerate InvoiceNo for new invoices when proforma toggle changes
                        ...(!editId && { InvoiceNo: nextInvoiceNo(invoices, getPrefix(p.RaisedBy, signers, newIsProforma === "Yes")) }),
                        ...(tdsAllowed ? {} : { TDSRate:"", TDSAmount:"", NetPayable:"" }),
                      }));
                    }}>
                      <option>No</option><option>Yes</option>
                    </select>
                  </div>
                </div>
                <div style={{ ...g3, marginTop:".75rem" }}>
                  <div>
                    <label style={lbl}>Invoice No <span style={{color:"var(--accent)"}}>*</span></label>
                    <input style={inp} value={form.InvoiceNo} onChange={e=>set("InvoiceNo",e.target.value)} required disabled={!!editId} />
                  </div>
                  <div>
                    <label style={lbl}>Invoice Date</label>
                    <input type="date" style={inp} value={form.InvoiceDate} onChange={e=>set("InvoiceDate",e.target.value)} />
                  </div>
                  <div>
                    <label style={lbl}>Billing Month <span style={{color:"var(--accent)"}}>*</span></label>
                    <select style={inp} value={form.BillingMonth} onChange={e=>set("BillingMonth",e.target.value)} required>
                      <option value="">— Select month —</option>
                      {billingMonthOptions().map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div style={{ borderTop:"1px solid var(--border)" }} />

              {/* Seller */}
              <div>
                <div style={secHdr}>Seller</div>
                {sellerLLPs.length > 0 && (
                  <div style={{ marginBottom:".75rem" }}>
                    <label style={lbl}>Seller LLP</label>
                    <select
                      style={inp}
                      value={sellerOptionKey(findSelectedSellerLLP())}
                      onChange={e => applySellerLLP(e.target.value)}
                      disabled={isPartner}
                    >
                      {canPickSeller && <option value="">— Select seller —</option>}
                      {sellerLLPs.map(l => (
                        <option key={sellerOptionKey(l)} value={sellerOptionKey(l)}>
                          {l.llpName}{l.shortCode ? ` [${l.shortCode}]` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={g3}>
                  <div><label style={lbl}>Seller Name</label><input style={inp} value={form.SellerName} onChange={e=>set("SellerName",e.target.value)} disabled={isPartner} /></div>
                  <div><label style={lbl}>Seller Address</label><textarea rows={2} style={{ ...inp, resize:"vertical" }} value={form.SellerAddress} onChange={e=>set("SellerAddress",e.target.value)} disabled={isPartner} /></div>
                  <div><label style={lbl}>Seller GSTIN</label><input style={inp} value={form.SellerGSTIN} onChange={e=>set("SellerGSTIN",e.target.value)} disabled={isPartner} /></div>
                  <div><label style={lbl}>Seller PAN</label><input style={inp} value={form.SellerPAN} onChange={e=>set("SellerPAN",e.target.value)} disabled={isPartner} /></div>
                  <div><label style={lbl}>Seller State</label><input style={inp} value={form.SellerState} onChange={e=>set("SellerState",e.target.value)} disabled={isPartner} placeholder="e.g. Karnataka, Code : 29" /></div>
                </div>
              </div>

              <div style={{ borderTop:"1px solid var(--border)" }} />

              {/* Buyer */}
              <div>
                <div style={secHdr}>Buyer (Bill To)</div>
                <div style={g2}>
                  <div><label style={lbl}>Buyer Name</label><input style={inp} value={form.BuyerName} onChange={e=>set("BuyerName",e.target.value)} /></div>
                  <div><label style={lbl}>Buyer GSTIN</label><input style={inp} value={form.BuyerGSTIN} onChange={e=>set("BuyerGSTIN",e.target.value)} /></div>
                </div>
                <div style={{ marginTop:".75rem" }}>
                  <label style={lbl}>Buyer Address</label>
                  <textarea rows={2} style={{ ...inp, resize:"vertical" }} value={form.BuyerAddress} onChange={e=>set("BuyerAddress",e.target.value)} />
                </div>
                <div style={{ marginTop:".75rem" }}>
                  <label style={lbl}>Buyer State</label>
                  <input style={inp} value={form.BuyerState} onChange={e=>set("BuyerState",e.target.value)} />
                </div>
              </div>

              <div style={{ borderTop:"1px solid var(--border)" }} />

              {/* Invoice Body */}
              <div>
                <div style={secHdr}>Invoice Body</div>
                <div style={g2}>
                  <div>
                    <label style={lbl}>Particulars</label>
                    <textarea rows={3} style={{ ...inp, resize:"vertical" }} value={form.Particulars} onChange={e=>set("Particulars",e.target.value)} placeholder="Description of service rendered…" />
                  </div>
                  <div>
                    <label style={lbl}>SAC Code</label>
                    <label style={{ display:"flex", alignItems:"center", gap:".45rem", marginBottom:".45rem", color:"var(--text)", fontSize:".8rem" }}>
                      <input
                        type="checkbox"
                        checked={sacSelected}
                        disabled={form.GSTMode === "With GST"}
                        onChange={e => handleSACToggle(e.target.checked)}
                      />
                      Include SAC on invoice
                    </label>
                    <select
                      style={{ ...inp, opacity: sacSelected ? 1 : .45 }}
                      value={form.SACCode || SAC_OPTIONS[0].code}
                      onChange={e=>set("SACCode",e.target.value)}
                      disabled={!sacSelected}
                    >
                      {SAC_OPTIONS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Amount + GST */}
                <div style={{ ...g3, marginTop:".75rem" }}>
                  <div>
                    <label style={lbl}>Taxable Amount (₹) <span style={{color:"var(--accent)"}}>*</span></label>
                    <input type="text" inputMode="decimal" style={inp} value={form.TaxableAmount}
                      onChange={e => {
                        const stripped = e.target.value.replace(/,/g, "");
                        handleTaxableChange(stripped, form.GSTRate);
                      }}
                      placeholder="e.g. 1500000 or 15,00,000" />
                    {form.TaxableAmount !== "" && !isNaN(Number(form.TaxableAmount)) && Number(form.TaxableAmount) > 0 && (
                      <div style={{ fontSize:".72rem", color:"var(--accent)", marginTop:".2rem" }}>
                        = ₹{Number(form.TaxableAmount).toLocaleString("en-IN", {minimumFractionDigits:2})}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={lbl}>GST Rate (%){form.GSTMode==="Without GST" && <span style={{color:"var(--muted)",fontWeight:400}}> — disabled</span>}</label>
                    <input type="number" min="0" max="100" step="0.01" style={{ ...inp, opacity: form.GSTMode==="Without GST" ? .45 : 1 }}
                      value={form.GSTRate} disabled={form.GSTMode==="Without GST"}
                      onChange={e => handleTaxableChange(form.TaxableAmount, e.target.value)}
                      placeholder="e.g. 18" />
                  </div>
                  {form.GSTMode==="With GST" && (
                    <div>
                      <label style={lbl}>GST Type</label>
                      <select style={inp} value={form.GSTType} onChange={e=>{ set("GSTType",e.target.value); }}>
                        <option>IGST</option><option>CGST+SGST</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* TDS fields */}
                {canUseTDS && (
                  <div style={{ ...g3, marginTop:".75rem" }}>
                    <div>
                      <label style={lbl}>TDS Rate (%)</label>
                      <input type="number" min="0" max="100" step="0.01" style={inp}
                        value={form.TDSRate} onChange={e => handleTDSRateChange(e.target.value)}
                        placeholder="e.g. 10" />
                    </div>
                    <div>
                      <label style={lbl}>TDS Amount (₹)</label>
                      <input type="text" style={{...inp, opacity:.7}} value={form.TDSAmount ? "₹"+Number(form.TDSAmount).toLocaleString("en-IN",{minimumFractionDigits:2}) : ""} readOnly placeholder="Auto-calculated" />
                    </div>
                    <div>
                      <label style={lbl}>Net Payable (₹)</label>
                      <input type="text" style={{...inp, opacity:.7, fontWeight:700, color:"#22c55e"}} value={form.NetPayable ? "₹"+Number(form.NetPayable).toLocaleString("en-IN",{minimumFractionDigits:2}) : ""} readOnly placeholder="Grand Total − TDS" />
                    </div>
                  </div>
                )}

                {/* Auto-calc summary */}
                {canUseTDS && form.TaxableAmount && (
                  <div style={{ marginTop:".75rem", padding:".65rem .85rem", background:"#6366f111", border:"1px solid #6366f133", borderRadius:"6px", fontSize:".82rem", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:".5rem" }}>
                    <div><span style={{color:"var(--muted)"}}>Taxable</span><br/><strong>₹{Number(form.TaxableAmount||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</strong></div>
                    {form.GSTMode==="With GST" && <div><span style={{color:"var(--muted)"}}>{form.GSTType||"IGST"} @{form.GSTRate}%</span><br/><strong style={{color:"#f59e0b"}}>₹{Number(form.GSTAmount||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</strong></div>}
                    <div><span style={{color:"var(--muted)"}}>Grand Total</span><br/><strong style={{color:"#22c55e"}}>₹{Number(form.Amount||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</strong></div>
                    {form.TDSRate && Number(form.TDSRate) > 0 && (
                      <div><span style={{color:"var(--muted)"}}>TDS @{form.TDSRate}%</span><br/><strong style={{color:"#ef4444"}}>−₹{Number(form.TDSAmount||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</strong></div>
                    )}
                    {form.TDSRate && Number(form.TDSRate) > 0 && (
                      <div><span style={{color:"var(--muted)"}}>Net Payable</span><br/><strong style={{color:"#22c55e",fontSize:"1rem"}}>₹{Number(form.NetPayable||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</strong></div>
                    )}
                  </div>
                )}

                <div style={{ ...g2, marginTop:".75rem" }}>
                  <div>
                    <label style={lbl}>Grand Total in Words</label>
                    <input style={inp} value={form.AmountInWords} onChange={e=>set("AmountInWords",e.target.value)} placeholder="Auto-filled" />
                  </div>
                  {form.GSTMode==="With GST" && (
                    <div>
                      <label style={lbl}>Tax Amount in Words</label>
                      <input style={inp} value={form.TaxAmountInWords} onChange={e=>set("TaxAmountInWords",e.target.value)} placeholder="Auto-filled" />
                    </div>
                  )}
                </div>
                <div style={{ marginTop:".75rem" }}>
                  <label style={lbl}>Narration</label>
                  <input style={inp} value={form.Narration} onChange={e=>set("Narration",e.target.value)} />
                </div>
              </div>

              <div style={{ borderTop:"1px solid var(--border)" }} />

              {/* Bank Details */}
              <div>
                <div style={secHdr}>Bank Details</div>
                {bankAccounts.length > 0 && (
                  <div style={{ marginBottom:".75rem" }}>
                    <label style={lbl}>Select Bank Account</label>
                    <select style={inp}
                      value={bankAccounts.find(b =>
                        getAccountNumber(b) === form.AccountNo && b.BankName === form.BankName
                      )?.AccountID || ""}
                      onChange={e => {
                        const acct = bankAccounts.find(b => b.AccountID === e.target.value);
                        applyBankAccount(acct);
                      }}>
                      <option value="">— Pick account to auto-fill —</option>
                      {bankAccounts.map(b => (
                        <option key={b.AccountID} value={b.AccountID}>
                          {b.AccountName || b.BankName}
                          {b.AccountNumber ? " (••" + String(b.AccountNumber).slice(-4) + ")" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={g3}>
                  <div><label style={lbl}>Bank Name</label><input style={inp} value={form.BankName} onChange={e=>set("BankName",e.target.value)} /></div>
                  <div><label style={lbl}>Account No</label><input style={inp} value={form.AccountNo} onChange={e=>set("AccountNo",e.target.value)} /></div>
                  <div><label style={lbl}>Branch / IFSC</label><input style={inp} value={form.BranchIFSC} onChange={e=>set("BranchIFSC",e.target.value)} /></div>
                </div>
                <div style={{ marginTop:".75rem" }}>
                  <label style={lbl}>Authorised Signatory</label>
                  <input style={inp} value={form.AuthorisedSignatory} onChange={e=>set("AuthorisedSignatory",e.target.value)} />
                </div>
              </div>

              <div style={{ borderTop:"1px solid var(--border)" }} />

              {/* Status + Notes */}
              <div style={g2}>
                <div>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.Status} onChange={e=>set("Status",e.target.value)}>
                    {STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Notes</label>
                  <input style={inp} value={form.Notes} onChange={e=>set("Notes",e.target.value)} />
                </div>
              </div>

              {/* Buttons */}
              <div style={{ display:"flex", gap:".75rem", justifyContent:"flex-end", paddingTop:".25rem", flexWrap:"wrap" }}>
                <button type="button" style={btn("ghost")} onClick={()=>setOpen(false)}>Cancel</button>
                <button type="button"
                  style={{ ...btn("ghost"), border:"1px solid #6366f1", color:"#6366f1" }}
                  onClick={() => printInvoice(form, signers)}>
                  Download PDF
                </button>
                <button type="submit" style={btn("primary")} disabled={saving}>
                  {saving ? "Saving…" : editId ? "Update Invoice" : "Save Invoice"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ── FILTERS ──────────────────────────────────────────────────────────── */}
      <div style={{ ...card, display:"flex", gap:".75rem", flexWrap:"wrap", alignItems:"center" }}>
        <input
          style={{ ...inp, maxWidth:"260px" }}
          placeholder="Search invoice no, client, partner…"
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />
        <select style={{ ...inp, maxWidth:"190px" }} value={partnerF} onChange={e=>setPartnerF(e.target.value)}>
          <option value="">All partners</option>
          {partnerOptions.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...inp, maxWidth:"210px" }} value={llpF} onChange={e=>setLlpF(e.target.value)}>
          <option value="">All LLPs</option>
          {llpOptions.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...inp, maxWidth:"230px" }} value={clientF} onChange={e=>setClientF(e.target.value)}>
          <option value="">All clients</option>
          {clientOptions.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...inp, maxWidth:"150px" }} value={monthF} onChange={e=>setMonthF(e.target.value)}>
          <option value="">All months</option>
          {monthOptions.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...inp, maxWidth:"160px" }} value={typeF} onChange={e=>setTypeF(e.target.value)}>
          <option value="">All types</option>
          {typeOptions.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...inp, maxWidth:"160px" }} value={gstF} onChange={e=>setGstF(e.target.value)}>
          <option value="">All GST modes</option>
          {gstOptions.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <select style={{ ...inp, maxWidth:"160px" }} value={statusF} onChange={e=>setStatusF(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s=><option key={s}>{s}</option>)}
        </select>
        {(search || statusF || partnerF || llpF || clientF || monthF || typeF || gstF) && (
          <button
            style={btn("ghost")}
            onClick={()=>{
              setSearch("");
              setStatusF("");
              setPartnerF("");
              setLlpF("");
              setClientF("");
              setMonthF("");
              setTypeF("");
              setGstF("");
            }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft:"auto", fontSize:".8rem", color:"var(--muted)" }}>{filtered.length} of {visibleInvoices.length}</span>
      </div>

      {/* ── TABLE ──────────────────────────────────────────────────────────── */}
      <div style={card}>
        {loading ? (
          <p style={{ color:"var(--muted)", textAlign:"center", padding:"2rem 0" }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={{ color:"var(--muted)", textAlign:"center", padding:"2rem 0" }}>
            {invoices.length === 0 ? "No invoices yet. Click \"+ New Invoice\" to create one." : "No invoices match your filter."}
          </p>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".83rem" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["Invoice No","Title","Date","Month","Type","GST Mode","Partner","LLP","Client","Amount","Status",""].map(h=>
                    <th key={h} style={{ padding:".5rem .65rem", textAlign:"left", color:"var(--muted)", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.NeoInvoiceID} style={{ borderBottom:"1px solid var(--border)" }}>
                    <td style={{ padding:".5rem .65rem", fontWeight:600 }}>{inv.InvoiceNo || "—"}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", fontSize:".78rem" }}>{inv.InvoiceTitle || "Invoice"}</td>
                    <td style={{ padding:".5rem .65rem", whiteSpace:"nowrap" }}>{formatDate(inv.InvoiceDate)}</td>
                    <td style={{ padding:".5rem .65rem" }}>{formatBillingMonth(inv.BillingMonth)}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", fontSize:".78rem" }}>{inv.InvoiceType || "—"}</td>
                    <td style={{ padding:".5rem .65rem", color:"var(--muted)", fontSize:".78rem" }}>{inv.GSTMode || "—"}</td>
                    <td style={{ padding:".5rem .65rem" }}>{partnerFilterValue(inv) || "—"}</td>
                    <td style={{ padding:".5rem .65rem" }}>{llpFilterValue(inv) || "—"}</td>
                    <td style={{ padding:".5rem .65rem" }}>{clientFilterValue(inv) || "—"}</td>
                    <td style={{ padding:".5rem .65rem", fontWeight:600, color:"var(--accent)", whiteSpace:"nowrap" }}>{fmt(inv.Amount)}</td>
                    <td style={{ padding:".5rem .65rem" }}>
                      <span style={{ background:statusColor(inv.Status)+"22", color:statusColor(inv.Status), padding:".2rem .65rem", borderRadius:"99px", fontSize:".72rem", fontWeight:600 }}>
                        {inv.Status || "Draft"}
                      </span>
                    </td>
                    <td style={{ padding:".5rem .4rem", whiteSpace:"nowrap" }}>
                      <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem" }} onClick={()=>openEdit(inv)}>Edit</button>
                      {" "}
                      <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem", border:"1px solid #6366f1", color:"#6366f1" }} onClick={()=>printInvoice(inv, signers)}>Download PDF</button>
                      {" "}
                      <button style={{ ...btn("ghost"), padding:".25rem .6rem", fontSize:".78rem", color:"var(--danger)" }} onClick={()=>removeInvoice(inv)}>Delete</button>
                    </td>
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

