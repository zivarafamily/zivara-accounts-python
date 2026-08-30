import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api/client";
import { billingMonthOptions, formatDate } from "../utils/format";

const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const today=()=>new Date().toISOString().slice(0,10);
const fyStart="2026-04-01";
const billingMonthFromDate=value=>{
  if(!value)return "";
  const d=new Date(`${value}T00:00:00`);
  if(Number.isNaN(d.getTime()))return "";
  return `${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};

const initial={
  Date:today(),ExpenseType:"Travel",Category:"",SubCategory:"",ExpenseFor:"",TravelScope:"",PaidByType:"Partner",PaidBy:"",
  ChargeTo:"",PaymentMode:"Card",Amount:"",VendorOrPerson:"",Description:"",
  BillAvailable:"No",BillLink:"",TaxableValue:"",CGSTAmount:"",SGSTAmount:"",
  IGSTAmount:"",GSTAmount:"",EmployeeName:"",ReimburseTo:"",
  BillingMonth:billingMonthFromDate(today()),Notes:"",Status:"Approved"
};

const card={background:"var(--card)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1rem"};
const label={display:"block",fontSize:".73rem",color:"var(--muted)",marginBottom:".32rem",fontWeight:600};
const inp={width:"100%",boxSizing:"border-box"};
const btn=(primary=true)=>({
  padding:".55rem .9rem",borderRadius:"6px",
  border:primary?"none":"1px solid var(--border)",
  fontWeight:650,fontSize:".82rem",cursor:"pointer",
  background:primary?"var(--accent)":"transparent",
  color:primary?"#fff":"var(--muted)"
});
const fmt=n=>"₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

const escapeHtml=value=>String(value??"")
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;");

const exportDate=value=>{
  const raw=String(value||"").slice(0,10);
  if(!raw)return "";
  const [y,m,d]=raw.split("-");
  return y&&m&&d?`${d}-${m}-${y}`:raw;
};
const STATUS_COLOR={Draft:"var(--muted)",Submitted:"var(--warning)",Approved:"var(--success)",Reimbursed:"var(--accent2)",Paid:"var(--accent2)",Recovered:"var(--warning)"};

const EXP_META_PREFIX="[[EXP_META:";
const EXP_META_SUFFIX="]]";
const DEFAULT_SUBCATEGORIES={
  Travel:["Domestic Flight","International Flight","Cab Charges","Train","Bus","Visa","Airport Transfer"],
  Hotel:["Domestic Hotel","International Hotel"],
  Food:["Meals","Business Meal","Travel Meal"],
  Office:["Printing","Stationery","Subscription","Courier"],
  Vendor:["Professional Fee","Service Charge"],
  Misc:["Miscellaneous"]
};
function readExpenseMeta(notes){
  const text=String(notes||"");
  const start=text.indexOf(EXP_META_PREFIX);
  if(start<0)return {meta:{},notes:text};
  const end=text.indexOf(EXP_META_SUFFIX,start+EXP_META_PREFIX.length);
  if(end<0)return {meta:{},notes:text};
  try{
    const meta=JSON.parse(text.slice(start+EXP_META_PREFIX.length,end));
    const clean=(text.slice(0,start)+text.slice(end+EXP_META_SUFFIX.length)).trim();
    return {meta:meta&&typeof meta==="object"?meta:{},notes:clean};
  }catch{return {meta:{},notes:text}}
}
function writeExpenseMeta(notes,meta){
  const clean=readExpenseMeta(notes).notes.trim();
  const compact=Object.fromEntries(Object.entries(meta||{}).filter(([,v])=>String(v||"").trim()));
  return `${clean}${clean&&Object.keys(compact).length?"\n":""}${Object.keys(compact).length?`${EXP_META_PREFIX}${JSON.stringify(compact)}${EXP_META_SUFFIX}`:""}`.trim();
}
function bankExpenseCategory(row){
  const ledger=String(row.LedgerName||"").trim();
  if(!ledger)return "";
  if(!/(expense|travel|hotel|food|cab|printing|stationery|subscription|courier|visa)/i.test(ledger))return "";
  return ledger
    .replace(/\bexpenses?\b/ig,"")
    .replace(/\s+/g," ")
    .trim() || "Other";
}

const BANK_CLASSIFICATION_KEY="zivara_expense_bank_classifications_v1";
function loadBankClassifications(){
  try{
    const parsed=JSON.parse(localStorage.getItem(BANK_CLASSIFICATION_KEY)||"{}");
    return parsed&&typeof parsed==="object"?parsed:{};
  }catch{return {}}
}
function saveBankClassifications(value){
  try{localStorage.setItem(BANK_CLASSIFICATION_KEY,JSON.stringify(value||{}))}catch{}
}

function Badge({value}){
  const color=STATUS_COLOR[value]||"var(--muted)";
  return <span style={{fontSize:".7rem",padding:".2rem .55rem",borderRadius:"99px",fontWeight:650,background:color+"22",color,border:`1px solid ${color}`}}>{value||"Draft"}</span>;
}

export default function Expenses(){
  const[expenses,setExpenses]=useState([]);
  const[vendors,setVendors]=useState([]);
  const[partners,setPartners]=useState([]);
  const[users,setUsers]=useState([]);
  const[form,setForm]=useState(initial);
  const[formOpen,setFormOpen]=useState(false);
  const[editId,setEditId]=useState(null);
  const[loading,setLoading]=useState(false);
  const[formError,setFormError]=useState("");
  const[showGST,setShowGST]=useState(false);
  const[showMore,setShowMore]=useState(false);
  const[addingCategory,setAddingCategory]=useState(false);
  const[newCategory,setNewCategory]=useState("");
  const[addingSubCategory,setAddingSubCategory]=useState(false);
  const[newSubCategory,setNewSubCategory]=useState("");
  const[bankTransactions,setBankTransactions]=useState([]);
  const[bankClassifications,setBankClassifications]=useState(()=>loadBankClassifications());
  const[classifyOpen,setClassifyOpen]=useState(false);
  const[classifyRow,setClassifyRow]=useState(null);
  const[classifyForm,setClassifyForm]=useState({Category:"",SubCategory:"",ExpenseFor:"",TravelScope:""});
  const[view,setView]=useState("entries");
  const[analysisPageSize,setAnalysisPageSize]=useState(25);
  const[analysisPage,setAnalysisPage]=useState(1);
  const[expandedAnalysisRows,setExpandedAnalysisRows]=useState({});

  const[fromDate,setFromDate]=useState(fyStart);
  const[toDate,setToDate]=useState("");
  const[filterPerson,setFilterPerson]=useState("");
  const[filterStatus,setFilterStatus]=useState("");
  const[search,setSearch]=useState("");
  const[analysisCategory,setAnalysisCategory]=useState("");
  const[analysisSubCategory,setAnalysisSubCategory]=useState("");
  const[analysisPerson,setAnalysisPerson]=useState("");
  const[analysisFunding,setAnalysisFunding]=useState("");
  const[analysisScope,setAnalysisScope]=useState("");

  async function load(){
    setLoading(true);
    try{
      const[e,v,p,u,b]=await Promise.allSettled([
        apiGet("getExpenses"),apiGet("getVendors"),apiGet("getPartners"),apiGet("getUsers"),apiGet("getBankTransactions")
      ]);
      if(e.status==="fulfilled"&&e.value.ok)setExpenses(e.value.data||[]);
      if(v.status==="fulfilled"&&v.value.ok)setVendors((v.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(p.status==="fulfilled"&&p.value.ok)setPartners((p.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(u.status==="fulfilled"&&u.value.ok)setUsers((u.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(b.status==="fulfilled"&&b.value.ok)setBankTransactions(b.value.data||[]);
    }finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  useEffect(()=>{saveBankClassifications(bankClassifications)},[bankClassifications]);

  const partnerNames=useMemo(
    ()=>[...new Set(partners.map(p=>String(p.PartnerName||"").trim()).filter(Boolean))].sort(),
    [partners]
  );

  const staffNames=useMemo(()=>[...new Set(
    users
      .filter(u=>!["partner","managing_partner"].includes(String(u.Role||"").toLowerCase()))
      .map(u=>String(u.Name||u.FullName||u.Username||"").trim())
      .filter(Boolean)
  )].sort(),[users]);

  const allPeople=useMemo(()=>[...new Set([
    ...partnerNames,...staffNames,
    ...expenses.map(e=>String(e.PaidBy||"").trim()).filter(Boolean)
  ])].sort(),[partnerNames,staffNames,expenses]);

  const paidByChoices=form.PaidByType==="Staff"?staffNames:partnerNames;

  const sellerOptions=useMemo(()=>[...new Set([
    ...expenses.map(e=>String(e.VendorOrPerson||"").trim()).filter(Boolean),
    ...vendors.map(v=>String(v.VendorName||"").trim()).filter(Boolean)
  ])].sort(),[expenses,vendors]);

  const categoryOptions=useMemo(()=>[...new Set([
    ...expenses.map(e=>String(e.Category||e.ExpenseType||"").trim()).filter(Boolean),
    ...vendors.map(v=>String(v.Category||"").trim()).filter(Boolean),
    "Travel","Hotel","Food","Office","Vendor","Misc"
  ])].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"})),[expenses,vendors]);

  const subCategoryOptions=useMemo(()=>{
    const saved=expenses.flatMap(e=>{
      const {meta}=readExpenseMeta(e.Notes);
      const cat=String(e.Category||e.ExpenseType||"").trim();
      return cat===form.Category&&meta.subCategory?[String(meta.subCategory).trim()]:[];
    });
    return [...new Set([...(DEFAULT_SUBCATEGORIES[form.Category]||[]),...saved].filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  },[expenses,form.Category]);

  const filtered=useMemo(()=>expenses
    .filter(e=>{
      const d=String(e.Date||"").slice(0,10);
      const hay=[e.ExpenseType,e.Category,e.PaidBy,e.ReimburseTo,e.VendorOrPerson,e.Description,e.PaymentMode,e.Status].join(" ").toLowerCase();
      return(!fromDate||d>=fromDate)&&(!toDate||d<=toDate)&&
        (!filterPerson||e.PaidBy===filterPerson)&&
        (!filterStatus||e.Status===filterStatus)&&
        (!search||hay.includes(search.toLowerCase()));
    })
    .sort((a,b)=>{
      const ad=String(a.Date||""),bd=String(b.Date||"");
      if(ad!==bd)return bd.localeCompare(ad);
      return String(b.CreatedAt||b.ExpenseID||"").localeCompare(String(a.CreatedAt||a.ExpenseID||""));
    }),[expenses,fromDate,toDate,filterPerson,filterStatus,search]);

  const totals=useMemo(()=>filtered.reduce((s,e)=>({
    amount:s.amount+Number(e.Amount||0),
    taxable:s.taxable+Number(e.TaxableValue||0),
    gst:s.gst+Number(e.GSTAmount||0)
  }),{amount:0,taxable:0,gst:0}),[filtered]);

  const gstTotal=Number(form.CGSTAmount||0)+Number(form.SGSTAmount||0)+Number(form.IGSTAmount||0);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  function changeFromDate(value){
    setFromDate(value);
    setToDate(value||"");
  }

  function inferPayerType(name){
    return staffNames.includes(name)?"Staff":"Partner";
  }

  function openAdd(){
    const d=today();
    setForm({...initial,Date:d,BillingMonth:billingMonthFromDate(d),Status:"Approved"});
    setEditId(null);setFormError("");setShowGST(false);setShowMore(false);
    setAddingCategory(false);setNewCategory("");setAddingSubCategory(false);setNewSubCategory("");setFormOpen(true);
  }

  function openEdit(e){
    const cgst=e.CGSTAmount||"",sgst=e.SGSTAmount||"",igst=e.IGSTAmount||"";
    const parsed=readExpenseMeta(e.Notes);
    setForm({
      Date:String(e.Date||"").slice(0,10),
      ExpenseType:e.ExpenseType||"Misc",Category:e.Category||"",
      SubCategory:parsed.meta.subCategory||"",ExpenseFor:parsed.meta.expenseFor||"",TravelScope:parsed.meta.travelScope||"",
      PaidByType:inferPayerType(e.PaidBy||""),PaidBy:e.PaidBy||"",
      ChargeTo:e.ChargeTo||"",PaymentMode:e.PaymentMode||"Cash",
      Amount:e.Amount||"",VendorOrPerson:e.VendorOrPerson||"",
      Description:e.Description||"",BillAvailable:e.BillAvailable||"No",
      BillLink:e.BillLink||"",TaxableValue:e.TaxableValue||"",
      CGSTAmount:cgst,SGSTAmount:sgst,IGSTAmount:igst,GSTAmount:e.GSTAmount||"",
      EmployeeName:e.EmployeeName||"",ReimburseTo:e.ReimburseTo||e.SettlementTo||e.PaidBy||"",
      BillingMonth:e.BillingMonth||billingMonthFromDate(String(e.Date||"").slice(0,10)),
      Notes:parsed.notes||"",Status:e.Status||"Draft"
    });
    setEditId(e.ExpenseID);setFormError("");
    setShowGST(Number(cgst||0)>0||Number(sgst||0)>0||Number(igst||0)>0||Number(e.TaxableValue||0)>0);
    setShowMore(!!(e.ChargeTo||parsed.notes||e.BillLink||e.Category));
    setAddingCategory(false);setNewCategory("");setAddingSubCategory(false);setNewSubCategory("");
    setFormOpen(true);
  }

  function changePayerType(type){
    setForm(p=>({...p,PaidByType:type,PaidBy:"",ReimburseTo:"",EmployeeName:""}));
  }
  function updatePaidBy(value){
    setForm(p=>({...p,PaidBy:value,ReimburseTo:value,EmployeeName:p.PaidByType==="Staff"?value:""}));
  }
  function updateDate(value){
    setForm(p=>({...p,Date:value,BillingMonth:billingMonthFromDate(value)||p.BillingMonth}));
  }
  function applyVendor(value){
    const vendor=vendors.find(v=>String(v.VendorName||"").trim()===value);
    setForm(p=>({...p,VendorOrPerson:value,Category:vendor?.Category&&!p.Category?vendor.Category:p.Category}));
  }
  function changeCategory(value){
    if(value==="__add_category__"){setAddingCategory(true);setNewCategory("");return}
    setAddingCategory(false);setNewCategory("");
    setForm(p=>({...p,Category:value,SubCategory:""}));
  }
  function addCategory(){
    const value=String(newCategory||"").trim();if(!value)return;
    setForm(p=>({...p,Category:value,SubCategory:""}));setAddingCategory(false);setNewCategory("");
  }
  function changeSubCategory(value){
    if(value==="__add_subcategory__"){setAddingSubCategory(true);setNewSubCategory("");return}
    setAddingSubCategory(false);setNewSubCategory("");set("SubCategory",value);
  }
  function addSubCategory(){
    const value=String(newSubCategory||"").trim();if(!value)return;
    set("SubCategory",value);setAddingSubCategory(false);setNewSubCategory("");
  }
  function setGstPart(key,value){
    setForm(p=>{
      const next={...p,[key]:value};
      const total=Number(next.CGSTAmount||0)+Number(next.SGSTAmount||0)+Number(next.IGSTAmount||0);
      return {...next,GSTAmount:total?total.toFixed(2):""};
    });
  }

  async function save(e){
    e.preventDefault();setFormError("");
    if(!form.PaidBy){setFormError("Select who actually paid the expense.");return}
    try{
      const payload={
        ...form,
        Notes:writeExpenseMeta(form.Notes,{
          subCategory:form.SubCategory,
          expenseFor:form.ExpenseFor,
          travelScope:form.TravelScope
        }),
        GSTAmount:gstTotal?gstTotal.toFixed(2):"",
        BillAvailable:form.BillAvailable||"No",
        EmployeeName:form.PaidByType==="Staff"?form.PaidBy:(form.EmployeeName||""),
        ReimburseTo:form.ReimburseTo||form.PaidBy,
        BillingMonth:form.BillingMonth||billingMonthFromDate(form.Date),
        ...(editId?{ExpenseID:editId}:{})
      };
      delete payload.PaidByType;
      delete payload.SubCategory;delete payload.ExpenseFor;delete payload.TravelScope;
      const r=await apiPost(editId?"updateExpense":"saveExpense",payload);
      if(!r.ok)throw new Error(r.error||"Unable to save expense");
      setFormOpen(false);setEditId(null);await load();
    }catch(err){setFormError(err.message||"Unable to save expense")}
  }

  async function removeExpense(e){
    if(!confirm(`Delete expense ${e.Description||e.ExpenseID}?`))return;
    try{await apiPost("deleteExpense",{ExpenseID:e.ExpenseID});await load()}
    catch(err){alert(err.message||"Unable to delete expense")}
  }

  function exportExcel(){
    if(!filtered.length){alert("No expenses to export.");return}
    const rows=filtered.map(e=>[
      exportDate(e.Date),
      e.ExpenseType||"",
      e.Category||"",
      readExpenseMeta(e.Notes).meta.subCategory||"",
      readExpenseMeta(e.Notes).meta.expenseFor||"",
      readExpenseMeta(e.Notes).meta.travelScope||"",
      Number(e.Amount||0).toFixed(2),
      e.PaidBy||"",
      e.ReimburseTo||e.SettlementTo||e.PaidBy||"",
      e.PaymentMode||"",
      e.Status||"",
      e.VendorOrPerson||"",
      e.Description||"",
      Number(e.TaxableValue||0).toFixed(2),
      Number(e.GSTAmount||0).toFixed(2)
    ]);
    const headers=["Date","Type","Category","Subcategory","Expense For","Scope","Amount","Paid By","Reimburse To","Mode","Status","Vendor / Person","Description","Taxable Value","GST"];
    const table=`<table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map(r=>`<tr>${r.map(v=>`<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")
    }</tbody></table>`;
    const html=`<html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
    const blob=new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`partner-staff-expenses-${fromDate||"all"}-to-${toDate||"latest"}.xls`;
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  function exportPDF(){
    if(!filtered.length){alert("No expenses to export.");return}
    const w=window.open("","_blank","width=1200,height=800");
    if(!w){alert("Please allow pop-ups to export PDF.");return}
    const filterSummary=[
      fromDate?`From ${exportDate(fromDate)}`:"",
      toDate?`To ${exportDate(toDate)}`:"",
      filterPerson?`Paid By: ${filterPerson}`:"",
      filterStatus?`Status: ${filterStatus}`:"",
      search?`Search: ${search}`:""
    ].filter(Boolean).join(" · ")||"All records";
    const bodyRows=filtered.map(e=>`<tr>
      <td>${escapeHtml(exportDate(e.Date))}</td>
      <td>${escapeHtml(e.ExpenseType||"")}</td>
      <td>${escapeHtml(e.Category||"")}</td>
      <td class="num">${escapeHtml(Number(e.Amount||0).toFixed(2))}</td>
      <td>${escapeHtml(e.PaidBy||"")}</td>
      <td>${escapeHtml(e.ReimburseTo||e.SettlementTo||e.PaidBy||"")}</td>
      <td>${escapeHtml(e.PaymentMode||"")}</td>
      <td>${escapeHtml(e.Status||"")}</td>
      <td>${escapeHtml(e.Description||"")}</td>
    </tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Partner / Staff Expenses</title>
      <style>
        body{font-family:Arial,sans-serif;color:#111;padding:20px;font-size:11px}
        h1{font-size:20px;margin:0 0 4px}.muted{color:#666;margin-bottom:12px}
        .summary{display:flex;gap:24px;margin:10px 0 16px;font-size:12px}
        table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;vertical-align:top}
        th{background:#eee;text-align:left}.num{text-align:right;white-space:nowrap}
        @page{size:landscape;margin:10mm}
      </style></head><body>
      <h1>Zivara Family Office LLP — Partner / Staff Expenses</h1>
      <div class="muted">${escapeHtml(filterSummary)}</div>
      <div class="summary">
        <div><strong>Records:</strong> ${filtered.length}</div>
        <div><strong>Total:</strong> ${escapeHtml(fmt(totals.amount))}</div>
        <div><strong>GST:</strong> ${escapeHtml(fmt(totals.gst))}</div>
      </div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Subcategory</th><th>Amount</th><th>Paid By</th><th>Reimburse To</th><th>Mode</th><th>Status</th><th>Description</th></tr></thead>
      <tbody>${bodyRows}</tbody></table>
      <script>window.onload=()=>{window.print();}<\/script>
      </body></html>`);
    w.document.close();
  }

  function openClassification(row){
    const existing=bankClassifications[row.EntryID]||{};
    setClassifyRow(row);
    setClassifyForm({
      Category:existing.Category||bankExpenseCategory(row)||"",
      SubCategory:existing.SubCategory||"",
      ExpenseFor:existing.ExpenseFor||"",
      TravelScope:existing.TravelScope||""
    });
    setClassifyOpen(true);
  }
  function saveClassification(){
    if(!classifyRow?.EntryID)return;
    setBankClassifications(prev=>({
      ...prev,
      [classifyRow.EntryID]:{
        Category:String(classifyForm.Category||"").trim(),
        SubCategory:String(classifyForm.SubCategory||"").trim(),
        ExpenseFor:String(classifyForm.ExpenseFor||"").trim(),
        TravelScope:String(classifyForm.TravelScope||"").trim()
      }
    }));
    setClassifyOpen(false);
  }
  function clearClassification(){
    if(!classifyRow?.EntryID)return;
    setBankClassifications(prev=>{
      const next={...prev};
      delete next[classifyRow.EntryID];
      return next;
    });
    setClassifyOpen(false);
  }

  const managementRows=useMemo(()=>{
    const personal=expenses.map(e=>{
      const {meta}=readExpenseMeta(e.Notes);
      return {
        id:`EXP-${e.ExpenseID}`,date:String(e.Date||"").slice(0,10),
        category:String(e.Category||e.ExpenseType||"Other").trim()||"Other",
        subCategory:String(meta.subCategory||"").trim(),
        person:String(meta.expenseFor||e.ChargeTo||"").trim(),
        funding:String(e.PaidBy||"").trim()||"Personal",
        scope:String(meta.travelScope||"").trim(),
        amount:Number(e.Amount||0),description:e.Description||e.VendorOrPerson||"",
        source:"Partner / Staff Expense",status:e.Status||""
      };
    });
    const company=bankTransactions.flatMap(r=>{
      const amount=Number(r.AmountOut||0),autoCategory=bankExpenseCategory(r),classification=bankClassifications[r.EntryID]||{};
      const category=String(classification.Category||autoCategory||"").trim();
      if(amount<=0||!category)return [];
      return [{
        id:`BANK-${r.EntryID}`,entryId:r.EntryID,date:String(r.Date||"").slice(0,10),category,
        subCategory:String(classification.SubCategory||"").trim(),
        person:String(classification.ExpenseFor||"").trim(),
        funding:"Zivara",
        scope:String(classification.TravelScope||"").trim(),
        amount,
        description:r.Description||r.ReferenceID||"",
        source:"Zivara Bank",status:"Paid",
        rawBankRow:r,
        classified:!!bankClassifications[r.EntryID]
      }];
    });
    return [...personal,...company];
  },[expenses,bankTransactions,bankClassifications]);

  const analysisRows=useMemo(()=>managementRows.filter(r=>{
    if(fromDate&&r.date<fromDate)return false;if(toDate&&r.date>toDate)return false;
    if(analysisCategory&&r.category!==analysisCategory)return false;
    if(analysisSubCategory&&r.subCategory!==analysisSubCategory)return false;
    if(analysisPerson&&!String(r.person||"").toLowerCase().includes(analysisPerson.toLowerCase()))return false;
    if(analysisFunding&&r.funding!==analysisFunding)return false;
    if(analysisScope&&r.scope!==analysisScope)return false;
    if(search&&!`${r.category} ${r.subCategory} ${r.person} ${r.funding} ${r.description}`.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  }).sort((a,b)=>b.date.localeCompare(a.date)),[managementRows,fromDate,toDate,analysisCategory,analysisSubCategory,analysisPerson,analysisFunding,analysisScope,search]);

  const analysisTotal=useMemo(()=>analysisRows.reduce((s,r)=>s+r.amount,0),[analysisRows]);
  const analysisCategories=useMemo(()=>[...new Set(managementRows.map(r=>r.category).filter(Boolean))].sort(),[managementRows]);
  const analysisSubs=useMemo(()=>[...new Set(managementRows.filter(r=>!analysisCategory||r.category===analysisCategory).map(r=>r.subCategory).filter(Boolean))].sort(),[managementRows,analysisCategory]);
  const analysisFundingOptions=useMemo(()=>[...new Set(managementRows.map(r=>r.funding).filter(Boolean))].sort(),[managementRows]);
  const analysisCategoryTotals=useMemo(()=>Object.entries(analysisRows.reduce((a,r)=>{a[r.category]=(a[r.category]||0)+r.amount;return a},{})).sort((a,b)=>b[1]-a[1]),[analysisRows]);
  const analysisFundingTotals=useMemo(()=>Object.entries(analysisRows.reduce((a,r)=>{a[r.funding]=(a[r.funding]||0)+r.amount;return a},{})).sort((a,b)=>b[1]-a[1]),[analysisRows]);
  const analysisPageCount=Math.max(1,Math.ceil(analysisRows.length/analysisPageSize));
  const safeAnalysisPage=Math.min(analysisPage,analysisPageCount);
  const analysisPageRows=useMemo(()=>{
    const start=(safeAnalysisPage-1)*analysisPageSize;
    return analysisRows.slice(start,start+analysisPageSize);
  },[analysisRows,analysisPageSize,safeAnalysisPage]);

  useEffect(()=>{setAnalysisPage(1)},[fromDate,toDate,analysisCategory,analysisSubCategory,analysisPerson,analysisFunding,analysisScope,search,analysisPageSize]);
  useEffect(()=>{if(analysisPage>analysisPageCount)setAnalysisPage(analysisPageCount)},[analysisPage,analysisPageCount]);

  function toggleAnalysisDetails(id){
    setExpandedAnalysisRows(prev=>({...prev,[id]:!prev[id]}));
  }

  function exportAnalysisExcel(){
    if(!analysisRows.length)return alert("No analysis rows to export.");
    const summary=`<table><tr><th colspan="2">Expense Analysis Summary</th></tr><tr><td>Total Expense</td><td>${analysisTotal.toFixed(2)}</td></tr><tr><td>Records</td><td>${analysisRows.length}</td></tr></table>`;
    const rows=analysisRows.map(r=>`<tr>${[exportDate(r.date),r.category,r.subCategory,r.person,r.scope,r.funding,r.amount.toFixed(2),r.source,r.description].map(v=>`<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("");
    const html=`<html><head><meta charset="utf-8"></head><body>${summary}<br><table><tr><th>Date</th><th>Category</th><th>Subcategory</th><th>Expense For</th><th>Scope</th><th>Funding Source</th><th>Amount</th><th>Source</th><th>Description</th></tr>${rows}</table></body></html>`;
    const blob=new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`expense-analysis-${fromDate||"all"}-to-${toDate||"latest"}.xls`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }
  function exportAnalysisPDF(){
    if(!analysisRows.length)return alert("No analysis rows to export.");
    const w=window.open("","_blank","width=1200,height=850");if(!w)return alert("Please allow pop-ups to export PDF.");
    const rows=analysisRows.map(r=>`<tr><td>${escapeHtml(exportDate(r.date))}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.subCategory||"—")}</td><td>${escapeHtml(r.person||"—")}</td><td>${escapeHtml(r.scope||"—")}</td><td>${escapeHtml(r.funding)}</td><td class="num">${escapeHtml(fmt(r.amount))}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.description)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><style>body{font-family:Arial,sans-serif;font-size:10px;color:#111;padding:18px}h1{font-size:18px;margin:0 0 4px}.summary{margin:10px 0 14px;font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:4px;vertical-align:top;overflow-wrap:anywhere}th{background:#eee;text-align:left}.num{text-align:right;white-space:nowrap}@page{size:A4 landscape;margin:10mm}</style></head><body><h1>Zivara Family Office LLP — Expense Analysis</h1><div class="summary"><strong>Total:</strong> ${escapeHtml(fmt(analysisTotal))} · <strong>Records:</strong> ${analysisRows.length}</div><table><tr><th>Date</th><th>Category</th><th>Subcategory</th><th>Expense For</th><th>Scope</th><th>Funding Source</th><th>Amount</th><th>Source</th><th>Description</th></tr>${rows}</table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
  }

  const accountingExpenseName={
    Food:"Food Expenses",Hotel:"Hotel Expenses",Travel:"Travel Expenses",
    Office:"Office Expenses",Vendor:"Other Expenses",SalaryAdvance:"Staff Advances",Misc:"Other Expenses"
  }[form.ExpenseType]||`${form.ExpenseType} Expenses`;

  return <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap"}}>
      <div>
        <h2 style={{fontWeight:750,fontSize:"1.25rem",margin:0}}>Partner / Staff Expenses</h2>
        <p style={{color:"var(--muted)",fontSize:".8rem",margin:".2rem 0 0"}}>Personal-paid business expenses and reimbursements</p>
      </div>
      <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
        <button style={btn(false)} onClick={()=>setView(view==="entries"?"analysis":"entries")}>{view==="entries"?"Expense Analysis":"Expense Entries"}</button>
        {view==="entries"&&<button style={btn()} onClick={openAdd}>+ Add Expense</button>}
      </div>
    </div>

    {view==="entries"&&<>\n    <div style={{...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".7rem",alignItems:"end"}}>
      <div><label style={label}>From</label><input style={inp} type="date" value={fromDate} onChange={e=>changeFromDate(e.target.value)}/></div>
      <div><label style={label}>To</label><input style={inp} type="date" min={fromDate||undefined} value={toDate} onChange={e=>setToDate(e.target.value)}/></div>
      <div><label style={label}>Paid By</label><select style={inp} value={filterPerson} onChange={e=>setFilterPerson(e.target.value)}><option value="">All people</option>{allPeople.map(x=><option key={x}>{x}</option>)}</select></div>
      <div><label style={label}>Status</label><select style={inp} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">All statuses</option>{["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}</select></div>
      <div style={{gridColumn:"span 2"}}><label style={label}>Search</label><input style={inp} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type, category, vendor, description..."/></div>
      <div><button style={btn(false)} onClick={()=>{setFromDate(fyStart);setToDate("");setFilterPerson("");setFilterStatus("");setSearch("")}}>Reset</button></div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:".75rem"}}>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>FILTERED TOTAL</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{fmt(totals.amount)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>GST TOTAL</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{fmt(totals.gst)}</div></div>
      <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>RECORDS</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{filtered.length}</div></div>
    </div>

    <div style={{...card,padding:0,overflow:"hidden"}}>
      <div style={{padding:".85rem 1rem",fontWeight:700,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
        <span>All Expenses <span style={{fontWeight:400,color:"var(--muted)"}}>· {filtered.length} records</span></span>
        <div style={{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap"}}>
          <span style={{fontSize:".72rem",fontWeight:400,color:"var(--muted)"}}>Newest date first</span>
          <button style={btn(false)} onClick={exportExcel}>Export Excel</button>
          <button style={btn(false)} onClick={exportPDF}>Export PDF</button>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        {loading?<p style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>Loading...</p>:
        filtered.length===0?<p style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>No expenses found.</p>:
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Paid By</th><th>Reimburse To</th><th>Mode</th><th>Status</th><th>Description</th><th></th></tr></thead>
          <tbody>{filtered.map(e=><tr key={e.ExpenseID}>
            <td>{formatDate(e.Date)}</td><td>{e.ExpenseType||"—"}</td><td>{e.Category||"—"}</td><td>{readExpenseMeta(e.Notes).meta.subCategory||"—"}</td>
            <td style={{fontWeight:700}}>{fmt(e.Amount)}</td><td>{e.PaidBy||"—"}</td>
            <td>{e.ReimburseTo||e.SettlementTo||e.PaidBy||"—"}</td><td>{e.PaymentMode||"—"}</td>
            <td><Badge value={e.Status}/></td><td>{e.Description||"—"}</td>
            <td style={{whiteSpace:"nowrap"}}><button style={btn(false)} onClick={()=>openEdit(e)}>Edit</button>{" "}<button style={{...btn(false),color:"var(--danger)"}} onClick={()=>removeExpense(e)}>Delete</button></td>
          </tr>)}</tbody>
        </table>}
      </div>
    </div>

    </>}

    {view==="analysis"&&<>
      <div style={{...card,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:".7rem",alignItems:"end"}}>
        <div><label style={label}>From</label><input style={inp} type="date" value={fromDate} onChange={e=>changeFromDate(e.target.value)}/></div>
        <div><label style={label}>To</label><input style={inp} type="date" min={fromDate||undefined} value={toDate} onChange={e=>setToDate(e.target.value)}/></div>
        <div><label style={label}>Category</label><select style={inp} value={analysisCategory} onChange={e=>{setAnalysisCategory(e.target.value);setAnalysisSubCategory("")}}><option value="">All categories</option>{analysisCategories.map(x=><option key={x}>{x}</option>)}</select></div>
        <div><label style={label}>Subcategory</label><select style={inp} value={analysisSubCategory} onChange={e=>setAnalysisSubCategory(e.target.value)}><option value="">All subcategories</option>{analysisSubs.map(x=><option key={x}>{x}</option>)}</select></div>
        <div><label style={label}>Person / Traveller</label><input style={inp} value={analysisPerson} onChange={e=>setAnalysisPerson(e.target.value)} placeholder="Manu, Dinu, Zara..."/></div>
        <div><label style={label}>Funding Source</label><select style={inp} value={analysisFunding} onChange={e=>setAnalysisFunding(e.target.value)}><option value="">All funding</option>{analysisFundingOptions.map(x=><option key={x}>{x}</option>)}</select></div>
        <div><label style={label}>Domestic / International</label><select style={inp} value={analysisScope} onChange={e=>setAnalysisScope(e.target.value)}><option value="">All</option><option>Domestic</option><option>International</option></select></div>
        <div><button style={btn(false)} onClick={()=>{setAnalysisCategory("");setAnalysisSubCategory("");setAnalysisPerson("");setAnalysisFunding("");setAnalysisScope("");setSearch("");setFromDate(fyStart);setToDate("")}}>Reset</button></div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:".75rem"}}>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TOTAL EXPENSE</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{fmt(analysisTotal)}</div></div>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>RECORDS</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{analysisRows.length}</div></div>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>CATEGORIES</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{analysisCategoryTotals.length}</div></div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:".75rem"}}>
        <details style={card}>
          <summary style={{fontWeight:700,cursor:"pointer",userSelect:"none"}}>By Category · {analysisCategoryTotals.length}</summary>
          <div style={{marginTop:".6rem"}}>{analysisCategoryTotals.map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",gap:"1rem",padding:".28rem 0",borderBottom:"1px solid var(--border)"}}><span style={{overflowWrap:"anywhere"}}>{k}</span><strong style={{whiteSpace:"nowrap"}}>{fmt(v)}</strong></div>)}</div>
        </details>
        <details style={card}>
          <summary style={{fontWeight:700,cursor:"pointer",userSelect:"none"}}>By Funding Source · {analysisFundingTotals.length}</summary>
          <div style={{marginTop:".6rem"}}>{analysisFundingTotals.map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",gap:"1rem",padding:".28rem 0",borderBottom:"1px solid var(--border)"}}><span style={{overflowWrap:"anywhere"}}>{k}</span><strong style={{whiteSpace:"nowrap"}}>{fmt(v)}</strong></div>)}</div>
        </details>
      </div>

      <div style={{...card,padding:0,overflow:"hidden"}}>
        <div style={{padding:".85rem 1rem",fontWeight:700,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap",alignItems:"center"}}>
          <div>
            <span>Expense Analysis · {analysisRows.length} records</span>
            <div style={{fontSize:".68rem",fontWeight:400,color:"var(--muted)",marginTop:".18rem"}}>Compact view. Open Details for narration, scope and source information.</div>
          </div>
          <div style={{display:"flex",gap:".5rem",alignItems:"center",flexWrap:"wrap"}}>
            <select style={{...inp,width:"auto",minWidth:95}} value={analysisPageSize} onChange={e=>setAnalysisPageSize(Number(e.target.value))}>
              {[25,50,100].map(n=><option key={n} value={n}>{n} rows</option>)}
            </select>
            <button style={btn(false)} onClick={exportAnalysisExcel}>Export Excel</button>
            <button style={btn(false)} onClick={exportAnalysisPDF}>Export PDF</button>
          </div>
        </div>

        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
          <table style={{width:"100%",minWidth:"900px",tableLayout:"fixed"}}>
            <thead><tr>
              <th style={{width:"92px"}}>Date</th>
              <th style={{width:"135px"}}>Category</th>
              <th style={{width:"155px"}}>Subcategory</th>
              <th style={{width:"150px"}}>Person</th>
              <th style={{width:"145px"}}>Funding</th>
              <th style={{width:"125px"}}>Amount</th>
              <th style={{width:"120px"}}>Classify</th>
              <th style={{width:"90px"}}>Details</th>
            </tr></thead>
            <tbody>
              {analysisPageRows.length?analysisPageRows.map(r=><>
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td>
                  <td style={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{r.category}</td>
                  <td style={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{r.subCategory||"—"}</td>
                  <td style={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{r.person||"—"}</td>
                  <td style={{whiteSpace:"normal",overflowWrap:"anywhere"}}>{r.funding}</td>
                  <td style={{fontWeight:700,whiteSpace:"nowrap"}}>{fmt(r.amount)}</td>
                  <td>{r.source==="Zivara Bank"?<button style={{...btn(false),padding:".38rem .55rem",fontSize:".74rem"}} onClick={()=>openClassification(r.rawBankRow)}>{r.classified?"Edit":"Classify"}</button>:<span style={{color:"var(--muted)"}}>—</span>}</td>
                  <td><button style={{...btn(false),padding:".38rem .55rem",fontSize:".74rem"}} onClick={()=>toggleAnalysisDetails(r.id)}>{expandedAnalysisRows[r.id]?"Hide":"View"}</button></td>
                </tr>
                {expandedAnalysisRows[r.id]&&<tr key={`${r.id}-details`}>
                  <td colSpan="8" style={{padding:".8rem 1rem",background:"rgba(255,255,255,.02)"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".75rem"}}>
                      <div><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>SCOPE</div><div style={{marginTop:".15rem"}}>{r.scope||"—"}</div></div>
                      <div><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>SOURCE</div><div style={{marginTop:".15rem"}}>{r.source||"—"}</div></div>
                      <div style={{gridColumn:"span 2"}}><div style={{fontSize:".65rem",color:"var(--muted)",fontWeight:700}}>DESCRIPTION / NARRATION</div><div style={{marginTop:".15rem",whiteSpace:"normal",overflowWrap:"anywhere",wordBreak:"break-word",lineHeight:1.4}}>{r.description||"—"}</div></div>
                    </div>
                  </td>
                </tr>}
              </>):<tr><td colSpan="8" style={{padding:"2rem",textAlign:"center",color:"var(--muted)"}}>No expenses for selected filters.</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={{padding:".75rem 1rem",borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
          <div style={{fontSize:".75rem",color:"var(--muted)"}}>
            Showing {analysisRows.length?((safeAnalysisPage-1)*analysisPageSize)+1:0}–{Math.min(safeAnalysisPage*analysisPageSize,analysisRows.length)} of {analysisRows.length}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:".45rem"}}>
            <button style={btn(false)} disabled={safeAnalysisPage<=1} onClick={()=>setAnalysisPage(p=>Math.max(1,p-1))}>Previous</button>
            <span style={{fontSize:".76rem",color:"var(--muted)",padding:"0 .3rem"}}>Page {safeAnalysisPage} of {analysisPageCount}</span>
            <button style={btn(false)} disabled={safeAnalysisPage>=analysisPageCount} onClick={()=>setAnalysisPage(p=>Math.min(analysisPageCount,p+1))}>Next</button>
          </div>
        </div>
      </div>
      <div style={{fontSize:".72rem",color:"var(--muted)"}}>Zivara-paid rows are picked from bank payments posted to expense-type ledgers. <strong>Classify</strong> changes management reporting only; <strong>Details</strong> shows scope, source and narration. PDF/Excel continue to export all filtered rows, not only the current page.</div>
    </>}

    {classifyOpen&&<div onMouseDown={e=>{if(e.target===e.currentTarget)setClassifyOpen(false)}} style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,.62)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{...card,width:"min(620px,95vw)",boxShadow:"0 20px 60px rgba(0,0,0,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginBottom:"1rem"}}>
          <div><h3 style={{margin:0,fontWeight:750}}>Classify Zivara-Paid Expense</h3><div style={{fontSize:".73rem",color:"var(--muted)",marginTop:".2rem"}}>{classifyRow?.Description||classifyRow?.ReferenceID||"Bank payment"} · {fmt(classifyRow?.AmountOut||0)}</div></div>
          <button style={btn(false)} onClick={()=>setClassifyOpen(false)}>Close</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".75rem"}}>
          <div><label style={label}>Category</label><select style={inp} value={classifyForm.Category} onChange={e=>setClassifyForm(p=>({...p,Category:e.target.value,SubCategory:""}))}><option value="">— Select —</option>{categoryOptions.map(x=><option key={x}>{x}</option>)}{classifyForm.Category&&!categoryOptions.includes(classifyForm.Category)&&<option>{classifyForm.Category}</option>}</select></div>
          <div><label style={label}>Subcategory</label><input style={inp} list="bank-classification-subcategories" value={classifyForm.SubCategory} onChange={e=>setClassifyForm(p=>({...p,SubCategory:e.target.value}))} placeholder="Domestic Flight / Cab..."/><datalist id="bank-classification-subcategories">{[...new Set([...(DEFAULT_SUBCATEGORIES[classifyForm.Category]||[]),...expenses.flatMap(e=>{const m=readExpenseMeta(e.Notes).meta;return m.subCategory?[m.subCategory]:[]})])].map(x=><option key={x} value={x}/>)}</datalist></div>
          <div><label style={label}>Expense For / Traveller</label><input style={inp} list="bank-classification-people" value={classifyForm.ExpenseFor} onChange={e=>setClassifyForm(p=>({...p,ExpenseFor:e.target.value}))} placeholder="Manu / Dinu / Zara..."/><datalist id="bank-classification-people">{allPeople.map(x=><option key={x} value={x}/>)}</datalist></div>
          <div><label style={label}>Domestic / International</label><select style={inp} value={classifyForm.TravelScope} onChange={e=>setClassifyForm(p=>({...p,TravelScope:e.target.value}))}><option value="">— Not applicable —</option><option>Domestic</option><option>International</option></select></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",gap:".65rem",marginTop:"1rem",flexWrap:"wrap"}}>
          <button type="button" style={{...btn(false),color:"var(--danger)"}} onClick={clearClassification}>Clear Classification</button>
          <div style={{display:"flex",gap:".65rem"}}><button type="button" style={btn(false)} onClick={()=>setClassifyOpen(false)}>Cancel</button><button type="button" style={btn()} onClick={saveClassification}>Save Classification</button></div>
        </div>
        <div style={{marginTop:".75rem",fontSize:".7rem",color:"var(--muted)"}}>This changes management reporting only. The bank transaction, ledger posting, amount and accounting narration are not edited.</div>
      </div>
    </div>}

    {formOpen&&<div onMouseDown={e=>{if(e.target===e.currentTarget)setFormOpen(false)}} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.62)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{...card,width:"min(980px,96vw)",maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginBottom:"1rem"}}>
          <div><h3 style={{margin:0,fontWeight:750}}>{editId?"Edit Expense":"Add Expense"}</h3><div style={{fontSize:".73rem",color:"var(--muted)",marginTop:".2rem"}}>Partner or staff-paid incidental business expense</div></div>
          <button style={btn(false)} onClick={()=>setFormOpen(false)}>Close</button>
        </div>
        {formError&&<div style={{marginBottom:"1rem",color:"var(--danger)"}}>{formError}</div>}

        <form onSubmit={save}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".85rem"}}>
            <div><label style={label}>Date *</label><input style={inp} type="date" required value={form.Date} onChange={e=>updateDate(e.target.value)}/></div>
            <div><label style={label}>Expense Type *</label><select style={inp} value={form.ExpenseType} onChange={e=>set("ExpenseType",e.target.value)}>{["Travel","Hotel","Food","Office","Vendor","SalaryAdvance","Misc"].map(x=><option key={x}>{x}</option>)}</select></div>
            <div>
              <label style={label}>Category</label>
              <select style={inp} value={addingCategory?"__add_category__":form.Category} onChange={e=>changeCategory(e.target.value)}>
                <option value="">— Select category —</option>{categoryOptions.map(x=><option key={x} value={x}>{x}</option>)}{form.Category&&!categoryOptions.includes(form.Category)&&<option>{form.Category}</option>}<option disabled>────────────</option><option value="__add_category__">+ Add Category</option>
              </select>
              {addingCategory&&<div style={{display:"flex",gap:".4rem",marginTop:".4rem"}}><input style={{...inp,minWidth:0}} autoFocus value={newCategory} onChange={e=>setNewCategory(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addCategory()}if(e.key==="Escape"){setAddingCategory(false);setNewCategory("")}}} placeholder="New category"/><button type="button" style={{...btn(),padding:".4rem .65rem"}} onClick={addCategory}>Add</button></div>}
            </div>
            <div>
              <label style={label}>Subcategory</label>
              <select style={inp} value={addingSubCategory?"__add_subcategory__":form.SubCategory} onChange={e=>changeSubCategory(e.target.value)} disabled={!form.Category}>
                <option value="">— Select subcategory —</option>{subCategoryOptions.map(x=><option key={x} value={x}>{x}</option>)}{form.SubCategory&&!subCategoryOptions.includes(form.SubCategory)&&<option>{form.SubCategory}</option>}<option disabled>────────────</option><option value="__add_subcategory__">+ Add Subcategory</option>
              </select>
              {addingSubCategory&&<div style={{display:"flex",gap:".4rem",marginTop:".4rem"}}><input style={{...inp,minWidth:0}} autoFocus value={newSubCategory} onChange={e=>setNewSubCategory(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSubCategory()}if(e.key==="Escape"){setAddingSubCategory(false);setNewSubCategory("")}}} placeholder="New subcategory"/><button type="button" style={{...btn(),padding:".4rem .65rem"}} onClick={addSubCategory}>Add</button></div>}
            </div>
            <div><label style={label}>Expense For / Traveller</label><input style={inp} list="expense-for-options" value={form.ExpenseFor} onChange={e=>set("ExpenseFor",e.target.value)} placeholder="Person name(s)"/><datalist id="expense-for-options">{allPeople.map(x=><option key={x} value={x}/>)}</datalist></div>
            <div><label style={label}>Domestic / International</label><select style={inp} value={form.TravelScope} onChange={e=>set("TravelScope",e.target.value)}><option value="">— Not applicable —</option><option>Domestic</option><option>International</option></select></div>
            <div><label style={label}>Amount (₹) *</label><input style={inp} type="number" min="0" step=".01" required value={form.Amount} onChange={e=>set("Amount",e.target.value)}/></div>

            <div><label style={label}>Paid By Type *</label><select style={inp} value={form.PaidByType} onChange={e=>changePayerType(e.target.value)}><option>Partner</option><option>Staff</option></select></div>
            <div><label style={label}>{form.PaidByType==="Staff"?"Staff Name":"Partner Name"} *</label>
              <select style={inp} required value={form.PaidBy} onChange={e=>updatePaidBy(e.target.value)}>
                <option value="">— Select {form.PaidByType.toLowerCase()} —</option>
                {paidByChoices.map(x=><option key={x}>{x}</option>)}
                {form.PaidBy&&!paidByChoices.includes(form.PaidBy)&&<option>{form.PaidBy}</option>}
              </select>
            </div>
            <div><label style={label}>Reimburse To</label><select style={inp} value={form.ReimburseTo} onChange={e=>set("ReimburseTo",e.target.value)}><option value="">Same as payer</option>{allPeople.map(x=><option key={x}>{x}</option>)}{form.ReimburseTo&&!allPeople.includes(form.ReimburseTo)&&<option>{form.ReimburseTo}</option>}</select></div>
            <div><label style={label}>Payment Mode *</label><select style={inp} value={form.PaymentMode} onChange={e=>set("PaymentMode",e.target.value)}>{["Card","Cash","UPI","Bank"].map(x=><option key={x}>{x}</option>)}</select></div>
            <div><label style={label}>Vendor / Person</label><input style={inp} list="expense-vendor-options" value={form.VendorOrPerson} onChange={e=>applyVendor(e.target.value)} placeholder="Select or type"/><datalist id="expense-vendor-options">{sellerOptions.map(x=><option key={x} value={x}/>)}</datalist></div>
            <div><label style={label}>Status *</label><select style={inp} value={form.Status} onChange={e=>set("Status",e.target.value)}>{["Draft","Submitted","Approved","Reimbursed"].map(x=><option key={x}>{x}</option>)}</select></div>
            <div style={{gridColumn:"1/-1"}}><label style={label}>Description</label><input style={inp} value={form.Description} onChange={e=>set("Description",e.target.value)} placeholder="Purpose / invoice reference / brief note"/></div>
          </div>

          <div style={{display:"flex",gap:".6rem",marginTop:"1rem",flexWrap:"wrap"}}>
            <button type="button" style={btn(false)} onClick={()=>setShowGST(x=>!x)}>{showGST?"Hide GST Details":"+ GST Details"}</button>
            <button type="button" style={btn(false)} onClick={()=>setShowMore(x=>!x)}>{showMore?"Hide More Details":"+ More Details"}</button>
          </div>

          {showGST&&<div style={{...card,marginTop:".85rem"}}>
            <div style={{fontWeight:700,marginBottom:".7rem"}}>GST Details</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:".7rem"}}>
              <div><label style={label}>Taxable Value</label><input style={inp} type="number" min="0" step=".01" value={form.TaxableValue} onChange={e=>set("TaxableValue",e.target.value)}/></div>
              <div><label style={label}>CGST</label><input style={inp} type="number" min="0" step=".01" value={form.CGSTAmount} onChange={e=>setGstPart("CGSTAmount",e.target.value)}/></div>
              <div><label style={label}>SGST</label><input style={inp} type="number" min="0" step=".01" value={form.SGSTAmount} onChange={e=>setGstPart("SGSTAmount",e.target.value)}/></div>
              <div><label style={label}>IGST</label><input style={inp} type="number" min="0" step=".01" value={form.IGSTAmount} onChange={e=>setGstPart("IGSTAmount",e.target.value)}/></div>
              <div><label style={label}>GST Total</label><input style={inp} readOnly value={fmt(gstTotal)}/></div>
            </div>
          </div>}

          {showMore&&<div style={{...card,marginTop:".85rem"}}>
            <div style={{fontWeight:700,marginBottom:".7rem"}}>More Details</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:".7rem"}}>
              <div><label style={label}>Charge To</label><input style={inp} value={form.ChargeTo} onChange={e=>set("ChargeTo",e.target.value)}/></div>
              <div><label style={label}>Billing Month</label><select style={inp} value={form.BillingMonth} onChange={e=>set("BillingMonth",e.target.value)}>{billingMonthOptions(36,12).map(x=><option key={x}>{x}</option>)}</select></div>
              <div><label style={label}>Bill Available</label><select style={inp} value={form.BillAvailable} onChange={e=>set("BillAvailable",e.target.value)}><option>No</option><option>Yes</option></select></div>
              <div><label style={label}>Bill Link</label><input style={inp} value={form.BillLink} onChange={e=>set("BillLink",e.target.value)}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={label}>Notes</label><input style={inp} value={form.Notes} onChange={e=>set("Notes",e.target.value)}/></div>
            </div>
          </div>}

          {form.PaidBy&&Number(form.Amount||0)>0&&<div style={{marginTop:".85rem",padding:".75rem .9rem",border:"1px solid var(--border)",borderRadius:"7px",fontSize:".76rem",color:"var(--muted)"}}>
            Accounting preview: <strong style={{color:"var(--text)"}}>Dr {accountingExpenseName} {fmt(form.Amount)}</strong>{" · "}
            <strong style={{color:"var(--text)"}}>Cr {form.ReimburseTo||form.PaidBy} {fmt(form.Amount)}</strong>
          </div>}

          <div style={{display:"flex",gap:".65rem",justifyContent:"flex-end",marginTop:"1rem"}}>
            <button type="button" style={btn(false)} onClick={()=>setFormOpen(false)}>Cancel</button>
            <button style={btn()} type="submit">{editId?"Update Expense":"Save Expense"}</button>
          </div>
        </form>
      </div>
    </div>}
  </div>;
}
