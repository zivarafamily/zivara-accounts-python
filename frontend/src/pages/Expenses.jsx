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
  Office:["Printing","Stationery","Subscription","Courier","Furnishing"],
  Vendor:["Professional Fee","Service Charge"],
  Misc:["Miscellaneous"]
};

const EXPENSE_TAXONOMY_KEY="zivara_expense_taxonomy_v1";
const EMPTY_EXPENSE_TAXONOMY={categoryAliases:{},subCategoryAliases:{},customCategories:[],customSubCategories:[],hiddenCategories:[],hiddenSubCategories:[]};
function loadExpenseTaxonomy(){
  try{
    const raw=JSON.parse(localStorage.getItem(EXPENSE_TAXONOMY_KEY)||"{}");
    return {
      categoryAliases:raw?.categoryAliases&&typeof raw.categoryAliases==="object"?raw.categoryAliases:{},
      subCategoryAliases:raw?.subCategoryAliases&&typeof raw.subCategoryAliases==="object"?raw.subCategoryAliases:{},
      customCategories:Array.isArray(raw?.customCategories)?raw.customCategories:[],
      customSubCategories:Array.isArray(raw?.customSubCategories)?raw.customSubCategories:[],
      hiddenCategories:Array.isArray(raw?.hiddenCategories)?raw.hiddenCategories:[],
      hiddenSubCategories:Array.isArray(raw?.hiddenSubCategories)?raw.hiddenSubCategories:[]
    };
  }catch{return {...EMPTY_EXPENSE_TAXONOMY}}
}
function saveExpenseTaxonomy(value){
  try{localStorage.setItem(EXPENSE_TAXONOMY_KEY,JSON.stringify(value||EMPTY_EXPENSE_TAXONOMY))}catch{}
}
function resolveExpenseAlias(value,map){
  let current=String(value||"").trim(),guard=0;
  const seen=new Set();
  while(current&&guard++<20){
    const key=Object.keys(map||{}).find(k=>k.toLowerCase()===current.toLowerCase());
    if(!key||seen.has(key.toLowerCase()))break;
    seen.add(key.toLowerCase());
    const next=String(map[key]||"").trim();
    if(!next||next.toLowerCase()===current.toLowerCase())break;
    current=next;
  }
  return current;
}
const canonicalCategoryValue=(taxonomy,value)=>resolveExpenseAlias(value,taxonomy?.categoryAliases||{});
const canonicalSubCategoryValue=(taxonomy,value)=>resolveExpenseAlias(value,taxonomy?.subCategoryAliases||{});
const isExpenseCategoryHidden=(taxonomy,value)=>(taxonomy?.hiddenCategories||[]).some(x=>String(x||"").trim().toLowerCase()===String(value||"").trim().toLowerCase());
const isExpenseSubCategoryHidden=(taxonomy,value)=>(taxonomy?.hiddenSubCategories||[]).some(x=>String(x||"").trim().toLowerCase()===String(value||"").trim().toLowerCase());
function uniqueExpenseLabels(values){
  const byKey=new Map();
  for(const raw of values||[]){
    const value=String(raw||"").trim().replace(/\s+/g," ");
    if(!value)continue;
    const key=value.toLowerCase();
    if(!byKey.has(key))byKey.set(key,value);
  }
  return [...byKey.values()];
}
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

const UNCLASSIFIED_SUBCATEGORY="__UNCLASSIFIED__";
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

const VENDOR_BILL_CLASSIFICATION_KEY="zivara_expense_vendor_bill_classifications_v1";
function loadVendorBillClassifications(){
  try{
    const parsed=JSON.parse(localStorage.getItem(VENDOR_BILL_CLASSIFICATION_KEY)||"{}");
    return parsed&&typeof parsed==="object"?parsed:{};
  }catch{return {}}
}
function saveVendorBillClassifications(value){
  try{localStorage.setItem(VENDOR_BILL_CLASSIFICATION_KEY,JSON.stringify(value||{}))}catch{}
}

function normExpenseText(value){
  return String(value||"").trim().toLowerCase().replace(/\s+/g," ");
}
function vendorBillCategory(row){
  const lineNames=(Array.isArray(row.LineItems)?row.LineItems:[])
    .map(x=>String(x.LedgerName||x.Particulars||"").trim()).filter(Boolean);
  const raw=lineNames[0]||String(row.VendorCategory||row.ExpenseType||"Vendor Bill").trim();
  const key=normExpenseText(raw);
  if(key.includes("travel")||key.includes("flight")||key.includes("air"))return "Travel";
  if(key.includes("hotel")||key.includes("stay")||key.includes("accommodation"))return "Hotel";
  if(key.includes("food")||key.includes("meal")||key.includes("restaurant"))return "Food";
  if(key.includes("cab")||key.includes("taxi"))return "Travel";
  if(key.includes("professional")||key.includes("consult")||key.includes("ca /"))return "Professional Fees";
  return raw.replace(/\bexpenses?\b/ig,"").replace(/\s+/g," ").trim()||"Vendor Bill";
}
function vendorBillSubCategory(row){
  const lineNames=(Array.isArray(row.LineItems)?row.LineItems:[])
    .map(x=>String(x.LedgerName||x.Particulars||"").trim()).filter(Boolean);
  const text=`${row.VendorCategory||""} ${row.Description||""} ${lineNames.join(" ")}`.toLowerCase();
  if(text.includes("international")||text.includes("overseas")) {
    if(text.includes("hotel")||text.includes("stay"))return "International Hotel";
    if(text.includes("flight")||text.includes("air")||text.includes("travel"))return "International Flight";
  }
  if(text.includes("domestic")) {
    if(text.includes("hotel")||text.includes("stay"))return "Domestic Hotel";
    if(text.includes("flight")||text.includes("air")||text.includes("travel"))return "Domestic Flight";
  }
  if(text.includes("cab")||text.includes("taxi"))return "Cab Charges";
  return "";
}
function isPersonalExpenseDuplicateOfVendorBill(expense,payables){
  const eAmount=Number(expense.Amount||0);
  const eDate=String(expense.Date||"").slice(0,10);
  const ePaidBy=normExpenseText(expense.PaidBy||"");
  const eVendor=normExpenseText(expense.VendorOrPerson||"");
  const eDesc=normExpenseText(expense.Description||"");
  if(eAmount<=0||!ePaidBy)return false;

  const dayValue=d=>{
    const t=Date.parse(String(d||"").slice(0,10));
    return Number.isFinite(t)?Math.floor(t/86400000):null;
  };
  const eDay=dayValue(eDate);

  return (payables||[]).some(v=>{
    if(String(v.Status||"").toLowerCase()==="cancelled")return false;
    const paidByType=normExpenseText(v.PaidByType||"Company");
    if(paidByType==="company")return false;

    const vPaidBy=normExpenseText(v.PaidByName||v.ReimburseTo||"");
    if(!vPaidBy||vPaidBy!==ePaidBy)return false;

    const gross=Number(v.GrossAmount||0);
    const net=Number(v.NetPayable||0);
    const paid=Number(v.PaidAmount||0);
    const amountMatch=[gross,net,paid].some(x=>x>0&&Math.abs(x-eAmount)<=2);
    if(!amountMatch)return false;

    const vDay=dayValue(v.BillDate||v.PaymentDate);
    if(eDay!=null&&vDay!=null&&Math.abs(eDay-vDay)>3)return false;

    const vVendor=normExpenseText(v.VendorName||"");
    const vDesc=normExpenseText(v.Description||"");
    const vendorMatch=!!(eVendor&&vVendor&&(eVendor.includes(vVendor)||vVendor.includes(eVendor)));
    const descMatch=!!(eDesc&&vDesc&&(eDesc.includes(vDesc)||vDesc.includes(eDesc)));
    const crossMatch=!!(
      (eDesc&&vVendor&&eDesc.includes(vVendor))||
      (eVendor&&vDesc&&vDesc.includes(eVendor))
    );

    // Same person + near-identical amount + same/near date is already strong;
    // vendor/description overlap makes it safer. If text is missing, still allow exact-day match.
    const exactDay=eDay!=null&&vDay!=null&&eDay===vDay;
    return vendorMatch||descMatch||crossMatch||exactDay;
  });
}

function isPayableSettlementBankRow(row,payables){
  const managed=normExpenseText(row.ManagedBy||"");
  const ledger=normExpenseText(row.LedgerName||"");
  if(managed.includes("payable")||managed.includes("vendor bill")||managed.includes("reimbursement"))return true;
  if(ledger.includes("accounts payable")||ledger.includes("creditor")||ledger.includes("vendor payable"))return true;

  const ref=normExpenseText(row.ReferenceID||"");
  const desc=normExpenseText(row.Description||"");
  const rowDate=String(row.Date||"").slice(0,10);
  const rowAmount=Number(row.AmountOut||0);
  const rows=payables||[];

  // Vendor-ledger safeguard:
  // bank payment posted to a vendor ledger that already has Vendor Bills
  // is settlement only, not a new expense.
  if(ledger&&rows.some(p=>{
    const vendor=normExpenseText(p.VendorName||"");
    if(!vendor)return false;
    return ledger===vendor||ledger.includes(vendor)||vendor.includes(ledger);
  }))return true;

  if(rows.some(p=>{
    const payableId=normExpenseText(p.PayableID||"");
    const paymentRef=normExpenseText(p.ReferenceNo||"");
    const billNo=normExpenseText(p.BillNo||"");
    const vendor=normExpenseText(p.VendorName||"");
    if(payableId&&(ref===payableId||desc.includes(payableId)))return true;
    if(paymentRef&&ref&&ref===paymentRef)return true;
    if(billNo&&desc.includes(billNo))return true;
    if(vendor&&desc.includes(vendor))return true;
    return false;
  }))return true;

  const groups={};
  for(const p of rows){
    if(String(p.Status||"").toLowerCase()==="cancelled")continue;
    const paid=Number(p.PaidAmount||0);
    if(paid<=0)continue;
    const payDate=String(p.PaymentDate||"").slice(0,10);
    const paymentRef=normExpenseText(p.ReferenceNo||"");
    const vendor=normExpenseText(p.VendorName||"");
    if(!vendor)continue;
    if(rowDate&&payDate&&rowDate!==payDate)continue;
    const referenceMatch=ref&&paymentRef&&ref===paymentRef;
    const vendorMention=vendor&&desc.includes(vendor);
    const ledgerMatch=ledger&&(ledger===vendor||ledger.includes(vendor)||vendor.includes(ledger));
    if(!referenceMatch&&!vendorMention&&!ledgerMatch)continue;
    const key=`${vendor}|${paymentRef||rowDate}`;
    if(!groups[key])groups[key]={sum:0};
    groups[key].sum+=paid;
  }
  if(rowAmount>0&&Object.values(groups).some(g=>Math.abs(g.sum-rowAmount)<=2))return true;

  return false;
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
  const[addingExpenseFor,setAddingExpenseFor]=useState(false);
  const[newExpenseFor,setNewExpenseFor]=useState("");
  const[bankTransactions,setBankTransactions]=useState([]);
  const[payables,setPayables]=useState([]);
  const[bankClassifications,setBankClassifications]=useState(()=>loadBankClassifications());
  const[vendorBillClassifications,setVendorBillClassifications]=useState(()=>loadVendorBillClassifications());
  const[classifyOpen,setClassifyOpen]=useState(false);
  const[classifyKind,setClassifyKind]=useState("bank");
  const[classifyRow,setClassifyRow]=useState(null);
  const[classifyForm,setClassifyForm]=useState({Category:"",SubCategory:"",ExpenseFor:"",TravelScope:""});
  const[classifyAddingCategory,setClassifyAddingCategory]=useState(false);
  const[classifyNewCategory,setClassifyNewCategory]=useState("");
  const[classifyAddingSubCategory,setClassifyAddingSubCategory]=useState(false);
  const[classifyNewSubCategory,setClassifyNewSubCategory]=useState("");
  const[view,setView]=useState("entries");
  const[analysisPageSize,setAnalysisPageSize]=useState(25);
  const[analysisPage,setAnalysisPage]=useState(1);
  const[expandedAnalysisRows,setExpandedAnalysisRows]=useState({});
  const[categoryDrill,setCategoryDrill]=useState({});
  const[fundingDrill,setFundingDrill]=useState({});
  const[showCategoryDrill,setShowCategoryDrill]=useState(false);
  const[showFundingDrill,setShowFundingDrill]=useState(false);
  const[subCategoryDrill,setSubCategoryDrill]=useState({});
  const[expenseTaxonomy,setExpenseTaxonomy]=useState(()=>loadExpenseTaxonomy());
  const[taxonomyOpen,setTaxonomyOpen]=useState(false);

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
      const[e,v,p,u,b,pay]=await Promise.allSettled([
        apiGet("getExpenses"),apiGet("getVendors"),apiGet("getPartners"),apiGet("getUsers"),apiGet("getBankTransactions"),apiGet("getLLPPayables")
      ]);
      if(e.status==="fulfilled"&&e.value.ok)setExpenses(e.value.data||[]);
      if(v.status==="fulfilled"&&v.value.ok)setVendors((v.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(p.status==="fulfilled"&&p.value.ok)setPartners((p.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(u.status==="fulfilled"&&u.value.ok)setUsers((u.value.data||[]).filter(x=>x.Status!=="Inactive"));
      if(b.status==="fulfilled"&&b.value.ok)setBankTransactions(b.value.data||[]);
      if(pay.status==="fulfilled"&&pay.value.ok)setPayables(pay.value.data||[]);
    }finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);
  useEffect(()=>{saveBankClassifications(bankClassifications)},[bankClassifications]);
  useEffect(()=>{saveVendorBillClassifications(vendorBillClassifications)},[vendorBillClassifications]);
  useEffect(()=>{saveExpenseTaxonomy(expenseTaxonomy)},[expenseTaxonomy]);

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
    ...expenses.map(e=>String(e.PaidBy||"").trim()).filter(Boolean),
    ...expenses.map(e=>readExpenseMeta(e.Notes).meta.expenseFor).filter(Boolean),
    ...Object.values(vendorBillClassifications||{}).map(x=>x?.ExpenseFor).filter(Boolean),
    ...Object.values(bankClassifications||{}).map(x=>x?.ExpenseFor).filter(Boolean)
  ].map(x=>String(x||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"})),[partnerNames,staffNames,expenses,vendorBillClassifications,bankClassifications]);

  const paidByChoices=form.PaidByType==="Staff"?staffNames:partnerNames;

  const sellerOptions=useMemo(()=>[...new Set([
    ...expenses.map(e=>String(e.VendorOrPerson||"").trim()).filter(Boolean),
    ...vendors.map(v=>String(v.VendorName||"").trim()).filter(Boolean)
  ])].sort(),[expenses,vendors]);

  const categoryOptions=useMemo(()=>{
    const raw=[
      ...expenses.map(e=>String(e.Category||e.ExpenseType||"").trim()).filter(Boolean),
      ...vendors.map(v=>String(v.Category||"").trim()).filter(Boolean),
      ...payables.map(v=>String(v.VendorCategory||v.ExpenseType||"").trim()).filter(Boolean),
      ...payables.flatMap(v=>(Array.isArray(v.LineItems)?v.LineItems:[])
        .map(x=>String(x.LedgerName||x.Particulars||"").trim())
        .filter(Boolean)
        .map(x=>x.replace(/\bexpenses?\b/ig,"").replace(/\s+/g," ").trim())
        .filter(Boolean)),
      ...Object.values(vendorBillClassifications||{}).map(x=>String(x?.Category||"").trim()).filter(Boolean),
      ...Object.values(bankClassifications||{}).map(x=>String(x?.Category||"").trim()).filter(Boolean),
      ...(expenseTaxonomy.customCategories||[]),
      "Travel","Hotel","Food","Office","Vendor","Misc"
    ].map(x=>canonicalCategoryValue(expenseTaxonomy,x)).filter(x=>x&&!isExpenseCategoryHidden(expenseTaxonomy,x));
    return uniqueExpenseLabels(raw).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  },[expenses,vendors,payables,vendorBillClassifications,bankClassifications,expenseTaxonomy]);

  const subCategoryOptions=useMemo(()=>{
    const formCategory=canonicalCategoryValue(expenseTaxonomy,form.Category);
    const saved=expenses.flatMap(e=>{
      const {meta}=readExpenseMeta(e.Notes);
      const cat=canonicalCategoryValue(expenseTaxonomy,String(e.Category||e.ExpenseType||"").trim());
      return cat===formCategory&&meta.subCategory?[canonicalSubCategoryValue(expenseTaxonomy,String(meta.subCategory).trim())]:[];
    });
    const custom=(expenseTaxonomy.customSubCategories||[]).flatMap(x=>{
      if(typeof x==="string")return [canonicalSubCategoryValue(expenseTaxonomy,x)];
      const cat=canonicalCategoryValue(expenseTaxonomy,x?.category||"");
      return (!cat||cat===formCategory)&&x?.name?[canonicalSubCategoryValue(expenseTaxonomy,x.name)]:[];
    });
    const defaults=(DEFAULT_SUBCATEGORIES[formCategory]||[]).map(x=>canonicalSubCategoryValue(expenseTaxonomy,x));
    return uniqueExpenseLabels([...defaults,...saved,...custom].filter(x=>x&&!isExpenseSubCategoryHidden(expenseTaxonomy,x)))
      .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  },[expenses,form.Category,expenseTaxonomy]);

  const taxonomyCategoryRows=useMemo(()=>{
    const counts={};
    const add=(value,count=0)=>{
      const name=canonicalCategoryValue(expenseTaxonomy,value);if(!name||isExpenseCategoryHidden(expenseTaxonomy,name))return;
      const key=name.toLowerCase();if(!counts[key])counts[key]={name,count:0};counts[key].count+=count;
    };
    for(const e of expenses)add(e.Category||e.ExpenseType,1);
    for(const v of payables)add((vendorBillClassifications[v.PayableID]||{}).Category||vendorBillCategory(v),1);
    for(const r of bankTransactions){const c=(bankClassifications[r.EntryID]||{}).Category||bankExpenseCategory(r);if(c)add(c,1)}
    for(const x of expenseTaxonomy.customCategories||[])add(x,0);
    ["Travel","Hotel","Food","Office","Vendor","Misc"].forEach(x=>add(x,0));
    return Object.values(counts).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
  },[expenses,payables,bankTransactions,vendorBillClassifications,bankClassifications,expenseTaxonomy]);

  const taxonomySubCategoryRows=useMemo(()=>{
    const counts={};
    const add=(value,count=0)=>{
      const name=canonicalSubCategoryValue(expenseTaxonomy,value);if(!name||isExpenseSubCategoryHidden(expenseTaxonomy,name))return;
      const key=name.toLowerCase();if(!counts[key])counts[key]={name,count:0};counts[key].count+=count;
    };
    for(const e of expenses)add(readExpenseMeta(e.Notes).meta.subCategory,1);
    for(const v of payables)add((vendorBillClassifications[v.PayableID]||{}).SubCategory||vendorBillSubCategory(v),1);
    for(const r of bankTransactions)add((bankClassifications[r.EntryID]||{}).SubCategory,1);
    Object.values(DEFAULT_SUBCATEGORIES).flat().forEach(x=>add(x,0));
    for(const x of expenseTaxonomy.customSubCategories||[])add(typeof x==="string"?x:x?.name,0);
    return Object.values(counts).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}));
  },[expenses,payables,bankTransactions,vendorBillClassifications,bankClassifications,expenseTaxonomy]);


  const classifySubCategoryOptions=useMemo(()=>{
    const cat=canonicalCategoryValue(expenseTaxonomy,classifyForm.Category);
    if(!cat)return [];
    const values=[...(DEFAULT_SUBCATEGORIES[cat]||[])];
    for(const e of expenses){
      const meta=readExpenseMeta(e.Notes).meta;
      const ecat=canonicalCategoryValue(expenseTaxonomy,e.Category||e.ExpenseType||"");
      if(ecat===cat&&meta.subCategory)values.push(meta.subCategory);
    }
    for(const x of Object.values(vendorBillClassifications||{})){
      if(canonicalCategoryValue(expenseTaxonomy,x?.Category||"")===cat&&x?.SubCategory)values.push(x.SubCategory);
    }
    for(const x of Object.values(bankClassifications||{})){
      if(canonicalCategoryValue(expenseTaxonomy,x?.Category||"")===cat&&x?.SubCategory)values.push(x.SubCategory);
    }
    for(const x of expenseTaxonomy.customSubCategories||[]){
      if(typeof x==="string")values.push(x);
      else if(!x?.category||canonicalCategoryValue(expenseTaxonomy,x.category)===cat)values.push(x?.name);
    }
    return uniqueExpenseLabels(values.map(x=>canonicalSubCategoryValue(expenseTaxonomy,x)).filter(x=>x&&!isExpenseSubCategoryHidden(expenseTaxonomy,x)))
      .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:"base"}));
  },[classifyForm.Category,expenses,vendorBillClassifications,bankClassifications,expenseTaxonomy]);


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
    setAddingCategory(false);setNewCategory("");setAddingSubCategory(false);setNewSubCategory("");setAddingExpenseFor(false);setNewExpenseFor("");setFormOpen(true);
  }

  function openEdit(e){
    const cgst=e.CGSTAmount||"",sgst=e.SGSTAmount||"",igst=e.IGSTAmount||"";
    const parsed=readExpenseMeta(e.Notes);
    setForm({
      Date:String(e.Date||"").slice(0,10),
      ExpenseType:e.ExpenseType||"Misc",Category:canonicalCategoryValue(expenseTaxonomy,e.Category||""),
      SubCategory:canonicalSubCategoryValue(expenseTaxonomy,parsed.meta.subCategory||""),ExpenseFor:parsed.meta.expenseFor||"",TravelScope:parsed.meta.travelScope||"",
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
    setAddingCategory(false);setNewCategory("");setAddingSubCategory(false);setNewSubCategory("");setAddingExpenseFor(false);setNewExpenseFor("");
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
    setForm(p=>({...p,Category:canonicalCategoryValue(expenseTaxonomy,value),SubCategory:""}));
  }
  function addCategory(){
    const value=String(newCategory||"").trim();if(!value)return;
    setExpenseTaxonomy(prev=>({...prev,customCategories:uniqueExpenseLabels([...(prev.customCategories||[]),value]),hiddenCategories:(prev.hiddenCategories||[]).filter(x=>String(x||"").toLowerCase()!==value.toLowerCase())}));
    setForm(p=>({...p,Category:value,SubCategory:""}));setAddingCategory(false);setNewCategory("");
  }
  function changeSubCategory(value){
    if(value==="__add_subcategory__"){setAddingSubCategory(true);setNewSubCategory("");return}
    setAddingSubCategory(false);setNewSubCategory("");set("SubCategory",canonicalSubCategoryValue(expenseTaxonomy,value));
  }
  function addSubCategory(){
    const value=String(newSubCategory||"").trim();if(!value)return;
    const category=canonicalCategoryValue(expenseTaxonomy,form.Category);
    setExpenseTaxonomy(prev=>({...prev,customSubCategories:[...(prev.customSubCategories||[]),{category,name:value}],hiddenSubCategories:(prev.hiddenSubCategories||[]).filter(x=>String(x||"").toLowerCase()!==value.toLowerCase())}));
    set("SubCategory",value);setAddingSubCategory(false);setNewSubCategory("");
  }
  function changeExpenseFor(value){
    if(value==="__add_person__"){setAddingExpenseFor(true);setNewExpenseFor("");return}
    setAddingExpenseFor(false);setNewExpenseFor("");set("ExpenseFor",value);
  }
  function addExpenseFor(){
    const value=String(newExpenseFor||"").trim();if(!value)return;
    set("ExpenseFor",value);setAddingExpenseFor(false);setNewExpenseFor("");
  }
  function renameTaxonomyLabel(kind,oldName){
    const oldValue=String(oldName||"").trim();if(!oldValue)return;
    const next=prompt(`Rename / merge ${kind==="category"?"category":"subcategory"} "${oldValue}" to:`,oldValue);
    const newValue=String(next||"").trim();if(!newValue||newValue.toLowerCase()===oldValue.toLowerCase())return;
    setExpenseTaxonomy(prev=>{
      const key=kind==="category"?"categoryAliases":"subCategoryAliases";
      const map={...(prev[key]||{})};
      // Redirect any older aliases that currently resolve to this label.
      for(const [from,to] of Object.entries(map)){
        if(resolveExpenseAlias(to,map).toLowerCase()===oldValue.toLowerCase())map[from]=newValue;
      }
      map[oldValue]=newValue;
      const customCategories=(prev.customCategories||[]).map(x=>String(x||"").toLowerCase()===oldValue.toLowerCase()?newValue:x);
      const customSubCategories=(prev.customSubCategories||[]).map(x=>{
        if(typeof x==="string")return x.toLowerCase()===oldValue.toLowerCase()?newValue:x;
        return {...x,name:String(x?.name||"").toLowerCase()===oldValue.toLowerCase()?newValue:x?.name};
      });
      return {...prev,[key]:map,customCategories:uniqueExpenseLabels(customCategories),customSubCategories,
        hiddenCategories:kind==="category"?(prev.hiddenCategories||[]).filter(x=>![oldValue.toLowerCase(),newValue.toLowerCase()].includes(String(x||"").toLowerCase())):(prev.hiddenCategories||[]),
        hiddenSubCategories:kind==="subcategory"?(prev.hiddenSubCategories||[]).filter(x=>![oldValue.toLowerCase(),newValue.toLowerCase()].includes(String(x||"").toLowerCase())):(prev.hiddenSubCategories||[])};
    });
    if(kind==="category"){
      setAnalysisCategory(v=>String(v||"").toLowerCase()===oldValue.toLowerCase()?newValue:v);
      setForm(v=>({...v,Category:String(v.Category||"").toLowerCase()===oldValue.toLowerCase()?newValue:v.Category}));
      setClassifyForm(v=>({...v,Category:String(v.Category||"").toLowerCase()===oldValue.toLowerCase()?newValue:v.Category}));
    }else{
      setAnalysisSubCategory(v=>String(v||"").toLowerCase()===oldValue.toLowerCase()?newValue:v);
      setForm(v=>({...v,SubCategory:String(v.SubCategory||"").toLowerCase()===oldValue.toLowerCase()?newValue:v.SubCategory}));
      setClassifyForm(v=>({...v,SubCategory:String(v.SubCategory||"").toLowerCase()===oldValue.toLowerCase()?newValue:v.SubCategory}));
    }
  }
  function deleteTaxonomyLabel(kind,name,count){
    if(Number(count||0)>0){alert(`${name} is used by ${count} current record(s). Use Rename / Merge instead so no expense loses its classification.`);return}
    if(!confirm(`Delete unused ${kind==="category"?"category":"subcategory"} "${name}" from the pick lists?`))return;
    setExpenseTaxonomy(prev=>{
      if(kind==="category"){
        const aliases=Object.fromEntries(Object.entries(prev.categoryAliases||{}).filter(([k,v])=>k.toLowerCase()!==name.toLowerCase()&&String(v||"").toLowerCase()!==name.toLowerCase()));
        return {...prev,categoryAliases:aliases,
          customCategories:(prev.customCategories||[]).filter(x=>String(x||"").toLowerCase()!==name.toLowerCase()),
          customSubCategories:(prev.customSubCategories||[]).filter(x=>typeof x==="string"||String(x?.category||"").toLowerCase()!==name.toLowerCase()),
          hiddenCategories:uniqueExpenseLabels([...(prev.hiddenCategories||[]),name])};
      }
      const aliases=Object.fromEntries(Object.entries(prev.subCategoryAliases||{}).filter(([k,v])=>k.toLowerCase()!==name.toLowerCase()&&String(v||"").toLowerCase()!==name.toLowerCase()));
      return {...prev,subCategoryAliases:aliases,
        customSubCategories:(prev.customSubCategories||[]).filter(x=>String(typeof x==="string"?x:x?.name||"").toLowerCase()!==name.toLowerCase()),
        hiddenSubCategories:uniqueExpenseLabels([...(prev.hiddenSubCategories||[]),name])};
    });
  }
  function addTaxonomyCategory(){
    const value=String(prompt("New category name:")||"").trim();if(!value)return;
    setExpenseTaxonomy(prev=>({...prev,customCategories:uniqueExpenseLabels([...(prev.customCategories||[]),value]),hiddenCategories:(prev.hiddenCategories||[]).filter(x=>String(x||"").toLowerCase()!==value.toLowerCase())}));
  }
  function addTaxonomySubCategory(){
    const category=String(prompt("Category for the new subcategory:",canonicalCategoryValue(expenseTaxonomy,form.Category||analysisCategory||"Office"))||"").trim();if(!category)return;
    const value=String(prompt("New subcategory name:")||"").trim();if(!value)return;
    setExpenseTaxonomy(prev=>({...prev,customCategories:uniqueExpenseLabels([...(prev.customCategories||[]),category]),customSubCategories:[...(prev.customSubCategories||[]),{category,name:value}],hiddenSubCategories:(prev.hiddenSubCategories||[]).filter(x=>String(x||"").toLowerCase()!==value.toLowerCase())}));
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
          expenseFor:form.ExpenseFor
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

  function openBankClassification(row){
    const existing=bankClassifications[row.EntryID]||{};
    setClassifyKind("bank");
    setClassifyRow(row);
    setClassifyForm({
      Category:canonicalCategoryValue(expenseTaxonomy,existing.Category||bankExpenseCategory(row)||""),
      SubCategory:canonicalSubCategoryValue(expenseTaxonomy,existing.SubCategory||""),
      ExpenseFor:existing.ExpenseFor||"",
      TravelScope:existing.TravelScope||""
    });
    setClassifyAddingCategory(false);setClassifyNewCategory("");
    setClassifyAddingSubCategory(false);setClassifyNewSubCategory("");
    setClassifyOpen(true);
  }
  function openVendorBillClassification(row){
    const existing=vendorBillClassifications[row.PayableID]||{};
    const autoSub=vendorBillSubCategory(row);
    setClassifyKind("vendor");
    setClassifyRow(row);
    setClassifyForm({
      Category:canonicalCategoryValue(expenseTaxonomy,existing.Category||vendorBillCategory(row)||""),
      SubCategory:canonicalSubCategoryValue(expenseTaxonomy,existing.SubCategory||autoSub||""),
      ExpenseFor:existing.ExpenseFor||"",
      TravelScope:existing.TravelScope||(/international|overseas/i.test(autoSub)?"International":/domestic/i.test(autoSub)?"Domestic":"")
    });
    setClassifyAddingCategory(false);setClassifyNewCategory("");
    setClassifyAddingSubCategory(false);setClassifyNewSubCategory("");
    setClassifyOpen(true);
  }
  function changeClassifyCategory(value){
    if(value==="__add_category__"){setClassifyAddingCategory(true);setClassifyNewCategory("");return}
    setClassifyAddingCategory(false);setClassifyNewCategory("");
    setClassifyForm(p=>({...p,Category:canonicalCategoryValue(expenseTaxonomy,value),SubCategory:""}));
  }
  function addClassifyCategory(){
    const value=String(classifyNewCategory||"").trim();if(!value)return;
    setExpenseTaxonomy(prev=>({...prev,customCategories:uniqueExpenseLabels([...(prev.customCategories||[]),value]),hiddenCategories:(prev.hiddenCategories||[]).filter(x=>String(x||"").toLowerCase()!==value.toLowerCase())}));
    setClassifyForm(p=>({...p,Category:value,SubCategory:""}));
    setClassifyAddingCategory(false);setClassifyNewCategory("");
  }
  function changeClassifySubCategory(value){
    if(value==="__add_subcategory__"){setClassifyAddingSubCategory(true);setClassifyNewSubCategory("");return}
    setClassifyAddingSubCategory(false);setClassifyNewSubCategory("");
    setClassifyForm(p=>({...p,SubCategory:canonicalSubCategoryValue(expenseTaxonomy,value)}));
  }
  function addClassifySubCategory(){
    const value=String(classifyNewSubCategory||"").trim();if(!value)return;
    const category=canonicalCategoryValue(expenseTaxonomy,classifyForm.Category);
    setExpenseTaxonomy(prev=>({...prev,customSubCategories:[...(prev.customSubCategories||[]),{category,name:value}],hiddenSubCategories:(prev.hiddenSubCategories||[]).filter(x=>String(x||"").toLowerCase()!==value.toLowerCase())}));
    setClassifyForm(p=>({...p,SubCategory:value}));
    setClassifyAddingSubCategory(false);setClassifyNewSubCategory("");
  }

  function saveClassification(){
    const data={
      Category:canonicalCategoryValue(expenseTaxonomy,String(classifyForm.Category||"").trim()),
      SubCategory:canonicalSubCategoryValue(expenseTaxonomy,String(classifyForm.SubCategory||"").trim()),
      ExpenseFor:String(classifyForm.ExpenseFor||"").trim(),
      TravelScope:/international|overseas/i.test(String(classifyForm.SubCategory||""))?"International":/domestic/i.test(String(classifyForm.SubCategory||""))?"Domestic":""
    };
    if(classifyKind==="vendor"){
      if(!classifyRow?.PayableID)return;
      setVendorBillClassifications(prev=>({...prev,[classifyRow.PayableID]:data}));
    }else{
      if(!classifyRow?.EntryID)return;
      setBankClassifications(prev=>({...prev,[classifyRow.EntryID]:data}));
    }
    setClassifyOpen(false);
  }
  function clearClassification(){
    if(classifyKind==="vendor"){
      if(!classifyRow?.PayableID)return;
      setVendorBillClassifications(prev=>{
        const next={...prev}; delete next[classifyRow.PayableID]; return next;
      });
    }else{
      if(!classifyRow?.EntryID)return;
      setBankClassifications(prev=>{
        const next={...prev}; delete next[classifyRow.EntryID]; return next;
      });
    }
    setClassifyOpen(false);
  }

  const managementRows=useMemo(()=>{
    const personal=expenses.flatMap(e=>{
      // If the same personally-paid expense already exists as a Vendor Bill,
      // keep the Vendor Bill as the management expense source and suppress this
      // duplicate Partner / Staff Expense row from Expense Analysis only.
      if(isPersonalExpenseDuplicateOfVendorBill(e,payables))return [];
      const {meta}=readExpenseMeta(e.Notes);
      return [{
        id:`EXP-${e.ExpenseID}`,date:String(e.Date||"").slice(0,10),
        category:canonicalCategoryValue(expenseTaxonomy,String(e.Category||e.ExpenseType||"Other").trim())||"Other",
        subCategory:canonicalSubCategoryValue(expenseTaxonomy,String(meta.subCategory||"").trim()),
        person:String(meta.expenseFor||e.ChargeTo||"").trim(),
        funding:String(e.PaidBy||"").trim()||"Personal",
        scope:/international|overseas/i.test(String(meta.subCategory||""))?"International":/domestic/i.test(String(meta.subCategory||""))?"Domestic":"",
        amount:Number(e.Amount||0),description:e.Description||e.VendorOrPerson||"",
        source:"Partner / Staff Expense",status:e.Status||"",
        rawExpense:e
      }];
    });

    // Vendor Bills are recognised as expenses on the BILL DATE.
    // Later bank payments merely settle the payable and are deliberately not another expense.
    const vendorBills=payables.flatMap(v=>{
      if(String(v.Status||"").toLowerCase()==="cancelled")return [];
      const amount=Number(v.GrossAmount||0);
      if(amount<=0)return [];
      const personallyPaid=normExpenseText(v.PaidByType||"Company")!=="company"&&String(v.PaidByName||"").trim();
      const classification=vendorBillClassifications[v.PayableID]||{};
      const autoSub=vendorBillSubCategory(v);
      const sub=canonicalSubCategoryValue(expenseTaxonomy,String(classification.SubCategory||autoSub||"").trim());
      const scope=String(classification.TravelScope||(/international|overseas/i.test(sub)?"International":/domestic/i.test(sub)?"Domestic":"")).trim();
      return [{
        id:`PAY-${v.PayableID}`,
        date:String(v.BillDate||"").slice(0,10),
        category:canonicalCategoryValue(expenseTaxonomy,String(classification.Category||vendorBillCategory(v)||"Vendor Bill").trim()),
        subCategory:sub,
        person:String(classification.ExpenseFor||"").trim(),
        funding:personallyPaid?String(v.PaidByName).trim():"Zivara / Vendor Bill",
        scope,
        amount,
        description:[v.VendorName,v.BillNo,v.Description].filter(Boolean).join(" · "),
        source:"Vendor Bill",
        status:v.Status||"",
        rawPayable:v,
        classified:!!vendorBillClassifications[v.PayableID]
      }];
    });

    const company=bankTransactions.flatMap(r=>{
      // Critical safeguard: never count a bank payment that is only settling an
      // already-recognised Vendor Bill / payable.
      if(isPayableSettlementBankRow(r,payables))return [];
      const amount=Number(r.AmountOut||0),autoCategory=bankExpenseCategory(r),classification=bankClassifications[r.EntryID]||{};
      const category=canonicalCategoryValue(expenseTaxonomy,String(classification.Category||autoCategory||"").trim());
      if(amount<=0||!category)return [];
      return [{
        id:`BANK-${r.EntryID}`,entryId:r.EntryID,date:String(r.Date||"").slice(0,10),category,
        subCategory:canonicalSubCategoryValue(expenseTaxonomy,String(classification.SubCategory||"").trim()),
        person:String(classification.ExpenseFor||"").trim(),
        funding:"Zivara",
        scope:String(classification.TravelScope||"").trim(),
        amount,
        description:r.Description||r.ReferenceID||"",
        source:"Zivara Bank · Direct Expense",status:"Paid",
        rawBankRow:r,
        classified:!!bankClassifications[r.EntryID]
      }];
    });
    return [...personal,...vendorBills,...company];
  },[expenses,payables,bankTransactions,bankClassifications,vendorBillClassifications,expenseTaxonomy]);

  const analysisRows=useMemo(()=>managementRows.filter(r=>{
    if(fromDate&&r.date<fromDate)return false;if(toDate&&r.date>toDate)return false;
    if(analysisCategory&&r.category!==analysisCategory)return false;
    if(analysisSubCategory===UNCLASSIFIED_SUBCATEGORY&&String(r.subCategory||"").trim())return false;
    if(analysisSubCategory&&analysisSubCategory!==UNCLASSIFIED_SUBCATEGORY&&r.subCategory!==analysisSubCategory)return false;
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

  const categoryDrillData=useMemo(()=>{
    const result={};
    for(const r of analysisRows){
      const cat=r.category||"Unclassified";
      if(!result[cat])result[cat]={total:0,subs:{},people:{},vendors:{},rows:[]};
      const g=result[cat];
      g.total+=r.amount;g.rows.push(r);
      const sub=r.subCategory||"Unclassified";
      g.subs[sub]=(g.subs[sub]||0)+r.amount;
      const person=r.person||"Unassigned";
      g.people[person]=(g.people[person]||0)+r.amount;
      const vendor=r.rawPayable?.VendorName||r.rawExpense?.VendorOrPerson||r.rawBankRow?.Description||r.source||"Other";
      const vendorKey=String(vendor||"Other").trim()||"Other";
      g.vendors[vendorKey]=(g.vendors[vendorKey]||0)+r.amount;
    }
    return result;
  },[analysisRows]);

  const fundingDrillData=useMemo(()=>{
    const result={};
    for(const r of analysisRows){
      const fund=r.funding||"Unassigned";
      if(!result[fund])result[fund]={total:0,categories:{},subs:{},people:{},vendors:{},rows:[]};
      const g=result[fund];
      g.total+=r.amount;g.rows.push(r);
      const cat=r.category||"Unclassified";
      g.categories[cat]=(g.categories[cat]||0)+r.amount;
      const sub=r.subCategory||"Unclassified";
      g.subs[sub]=(g.subs[sub]||0)+r.amount;
      const person=r.person||"Unassigned";
      g.people[person]=(g.people[person]||0)+r.amount;
      const vendor=r.rawPayable?.VendorName||r.rawExpense?.VendorOrPerson||r.rawBankRow?.Description||r.source||"Other";
      const vendorKey=String(vendor||"Other").trim()||"Other";
      g.vendors[vendorKey]=(g.vendors[vendorKey]||0)+r.amount;
    }
    return result;
  },[analysisRows]);

  const sortedPairs=obj=>Object.entries(obj||{}).sort((a,b)=>b[1]-a[1]);
  const analysisSourceTotals=useMemo(()=>analysisRows.reduce((a,r)=>{
    if(r.source==="Vendor Bill")a.vendorBills+=r.amount;
    else if(r.source==="Partner / Staff Expense")a.personal+=r.amount;
    else if(String(r.source||"").startsWith("Zivara Bank"))a.directZivara+=r.amount;
    return a;
  },{vendorBills:0,personal:0,directZivara:0}),[analysisRows]);
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
    const w=window.open("","_blank","width=1300,height=900");if(!w)return alert("Please allow pop-ups to export PDF.");

    const pct=value=>analysisTotal>0?`${((Number(value||0)/analysisTotal)*100).toFixed(1)}%`:"0.0%";
    const filterSummary=[
      fromDate?`From ${exportDate(fromDate)}`:"",
      toDate?`To ${exportDate(toDate)}`:"",
      analysisCategory?`Category: ${analysisCategory}`:"",
      analysisSubCategory===UNCLASSIFIED_SUBCATEGORY?"Subcategory: Unclassified":analysisSubCategory?`Subcategory: ${analysisSubCategory}`:"",
      analysisPerson?`Person / Traveller: ${analysisPerson}`:"",
      analysisFunding?`Funding: ${analysisFunding}`:"",
      analysisScope?`Scope: ${analysisScope}`:"",
      search?`Search: ${search}`:""
    ].filter(Boolean).join(" · ")||"All Expense Analysis records";

    const subTotals=Object.entries(analysisRows.reduce((a,r)=>{
      const key=String(r.subCategory||"Unclassified").trim()||"Unclassified";
      a[key]=(a[key]||0)+r.amount;return a;
    },{})).sort((a,b)=>b[1]-a[1]);

    const vendorTotals=Object.entries(analysisRows.reduce((a,r)=>{
      const raw=r.rawPayable?.VendorName||r.rawExpense?.VendorOrPerson||r.rawBankRow?.LedgerName||r.rawBankRow?.Description||r.source||"Other";
      const key=String(raw||"Other").trim()||"Other";
      a[key]=(a[key]||0)+r.amount;return a;
    },{})).sort((a,b)=>b[1]-a[1]);

    const summaryTable=(title,pairs)=>`<section class="summary-section"><h2>${escapeHtml(title)}</h2><table class="summary-table"><thead><tr><th>${escapeHtml(title.replace(/ Summary$/,""))}</th><th class="num">Amount</th><th class="num">% of Total</th></tr></thead><tbody>${pairs.map(([name,amount])=>`<tr><td>${escapeHtml(name)}</td><td class="num">${escapeHtml(fmt(amount))}</td><td class="num">${escapeHtml(pct(amount))}</td></tr>`).join("")}</tbody></table></section>`;

    const categoryDetail=analysisCategoryTotals.map(([category,total])=>{
      const group=categoryDrillData[category]||{subs:{},rows:[]};
      const subSections=sortedPairs(group.subs).map(([sub,subTotal])=>{
        const subRows=(group.rows||[]).filter(r=>(r.subCategory||"Unclassified")===sub);
        const vendors={};
        for(const r of subRows){
          const raw=r.rawPayable?.VendorName||r.rawExpense?.VendorOrPerson||r.rawBankRow?.LedgerName||r.rawBankRow?.Description||r.source||"Other";
          const key=String(raw||"Other").trim()||"Other";
          vendors[key]=(vendors[key]||0)+r.amount;
        }
        return `<div class="sub-block"><div class="sub-head"><strong>${escapeHtml(sub)}</strong><strong>${escapeHtml(fmt(subTotal))}</strong></div><table class="mini"><thead><tr><th>Vendor / Source</th><th class="num">Amount</th></tr></thead><tbody>${sortedPairs(vendors).map(([vendor,amount])=>`<tr><td>${escapeHtml(vendor)}</td><td class="num">${escapeHtml(fmt(amount))}</td></tr>`).join("")}</tbody></table></div>`;
      }).join("");
      return `<section class="category-block"><div class="category-head"><h2>${escapeHtml(category)}</h2><div><strong>${escapeHtml(fmt(total))}</strong> · ${escapeHtml(pct(total))}</div></div>${subSections}</section>`;
    }).join("");

    const detailRows=analysisRows.map(r=>`<tr><td>${escapeHtml(exportDate(r.date))}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.subCategory||"Unclassified")}</td><td>${escapeHtml(r.person||"—")}</td><td>${escapeHtml(r.scope||"—")}</td><td>${escapeHtml(r.funding)}</td><td class="num">${escapeHtml(fmt(r.amount))}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.description)}</td></tr>`).join("");

    w.document.write(`<!doctype html><html><head><title>Expense Analysis - Full View</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:9.5px;color:#111;padding:16px;line-height:1.35}h1{font-size:19px;margin:0 0 3px}h2{font-size:12px;margin:0}.muted{color:#666}.filters{margin:4px 0 12px;color:#555;font-size:9.5px}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:10px 0 14px}.metric{border:1px solid #bbb;border-radius:5px;padding:7px}.metric .k{font-size:7.5px;color:#666;font-weight:bold;text-transform:uppercase}.metric .v{font-size:12px;font-weight:bold;margin-top:2px}.overview{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}.summary-section{break-inside:avoid;margin:0 0 10px}.summary-section h2{margin:0 0 4px}.summary-table,.mini,.detail{width:100%;border-collapse:collapse}.summary-table th,.summary-table td,.mini th,.mini td,.detail th,.detail td{border:1px solid #aaa;padding:3.5px;vertical-align:top;overflow-wrap:anywhere}.summary-table th,.mini th,.detail th{background:#eee;text-align:left}.num{text-align:right!important;white-space:nowrap}.page-title{margin:14px 0 7px;padding-top:6px;border-top:2px solid #333;font-size:14px;font-weight:bold}.category-block{break-inside:avoid;margin-bottom:12px;border:1px solid #aaa;padding:7px}.category-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:5px}.sub-block{margin:6px 0 0 8px;break-inside:avoid}.sub-head{display:flex;justify-content:space-between;gap:12px;background:#f5f5f5;border:1px solid #bbb;border-bottom:0;padding:4px}.mini{margin:0}.detail thead{display:table-header-group}.detail tr{break-inside:avoid}.report-note{margin-top:8px;color:#555;font-size:8.5px}@page{size:A4 landscape;margin:8mm}@media print{body{padding:0}.overview{grid-template-columns:1fr 1fr}.category-block{page-break-inside:avoid}}
    </style></head><body>
      <h1>Zivara Family Office LLP - Expense Analysis</h1>
      <div class="muted">Full management-expense view</div>
      <div class="filters">${escapeHtml(filterSummary)}</div>
      <div class="cards">
        <div class="metric"><div class="k">Total Expense</div><div class="v">${escapeHtml(fmt(analysisTotal))}</div></div>
        <div class="metric"><div class="k">Vendor Bills</div><div class="v">${escapeHtml(fmt(analysisSourceTotals.vendorBills))}</div></div>
        <div class="metric"><div class="k">Personally Paid</div><div class="v">${escapeHtml(fmt(analysisSourceTotals.personal))}</div></div>
        <div class="metric"><div class="k">Direct Zivara</div><div class="v">${escapeHtml(fmt(analysisSourceTotals.directZivara))}</div></div>
        <div class="metric"><div class="k">Records</div><div class="v">${analysisRows.length}</div></div>
      </div>

      <div class="page-title">Management Summary - Full List</div>
      <div class="overview">
        ${summaryTable("Category Summary",analysisCategoryTotals)}
        ${summaryTable("Subcategory Summary",subTotals)}
        ${summaryTable("Vendor / Source Summary",vendorTotals)}
        ${summaryTable("Funding Source Summary",analysisFundingTotals)}
      </div>

      <div class="page-title">Category > Subcategory > Vendor / Source</div>
      ${categoryDetail}

      <div class="page-title">Detailed Expense Analysis - ${analysisRows.length} Records</div>
      <table class="detail"><thead><tr><th>Date</th><th>Category</th><th>Subcategory</th><th>Expense For</th><th>Scope</th><th>Funding Source</th><th class="num">Amount</th><th>Source</th><th>Description / Narration</th></tr></thead><tbody>${detailRows}</tbody></table>
      <div class="report-note">Vendor Bills are recognised on bill date. Vendor settlements and reimbursements are not counted again as expenses. This PDF uses the same active Expense Analysis filters as the on-screen report.</div>
      <script>window.onload=()=>window.print()<\/script>
    </body></html>`);w.document.close();
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
        <button style={btn(false)} onClick={()=>setTaxonomyOpen(true)}>Manage Categories</button>
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
        <div><label style={label}>Subcategory</label><select style={inp} value={analysisSubCategory} onChange={e=>setAnalysisSubCategory(e.target.value)}><option value="">All subcategories</option><option value={UNCLASSIFIED_SUBCATEGORY}>Unclassified</option>{analysisSubs.map(x=><option key={x}>{x}</option>)}</select></div>
        <div><label style={label}>Person / Traveller</label><input style={inp} value={analysisPerson} onChange={e=>setAnalysisPerson(e.target.value)} placeholder="Manu, Dinu, Zara..."/></div>
        <div><label style={label}>Funding Source</label><select style={inp} value={analysisFunding} onChange={e=>setAnalysisFunding(e.target.value)}><option value="">All funding</option>{analysisFundingOptions.map(x=><option key={x}>{x}</option>)}</select></div>
        <div><button style={btn(false)} onClick={()=>{setAnalysisCategory("");setAnalysisSubCategory("");setAnalysisPerson("");setAnalysisFunding("");setAnalysisScope("");setSearch("");setFromDate(fyStart);setToDate("")}}>Reset</button></div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(175px,1fr))",gap:".75rem"}}>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>TOTAL EXPENSE</div><div style={{fontSize:"1.25rem",fontWeight:800,marginTop:".2rem"}}>{fmt(analysisTotal)}</div></div>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>VENDOR BILLS</div><div style={{fontSize:"1.08rem",fontWeight:800,marginTop:".2rem"}}>{fmt(analysisSourceTotals.vendorBills)}</div></div>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>PERSONALLY PAID</div><div style={{fontSize:"1.08rem",fontWeight:800,marginTop:".2rem"}}>{fmt(analysisSourceTotals.personal)}</div></div>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>DIRECT ZIVARA EXPENSES</div><div style={{fontSize:"1.08rem",fontWeight:800,marginTop:".2rem"}}>{fmt(analysisSourceTotals.directZivara)}</div></div>
        <div style={card}><div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700}}>RECORDS</div><div style={{fontSize:"1.08rem",fontWeight:800,marginTop:".2rem"}}>{analysisRows.length}</div></div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:".75rem"}}>
        <div style={card}>
          <button type="button" onClick={()=>setShowCategoryDrill(v=>!v)} style={{width:"100%",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",background:"transparent",border:0,color:"inherit",padding:0,cursor:"pointer",textAlign:"left"}}>
            <span style={{fontWeight:800}}>{showCategoryDrill?"▼":"▶"} By Category · {analysisCategoryTotals.length}</span>
            <span style={{fontSize:".7rem",color:"var(--muted)"}}>{showCategoryDrill?"Hide":"Expand"}</span>
          </button>
          {showCategoryDrill&&<div style={{marginTop:".55rem"}}>
            {analysisCategoryTotals.map(([k,v])=>{
              const open=!!categoryDrill[k],g=categoryDrillData[k]||{};
              return <div key={k} style={{borderBottom:"1px solid var(--border)",padding:".28rem 0"}}>
                <button type="button" onClick={()=>setCategoryDrill(p=>({...p,[k]:!p[k]}))} style={{width:"100%",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",background:"transparent",border:0,color:"inherit",padding:".18rem 0",cursor:"pointer",textAlign:"left"}}>
                  <span style={{fontWeight:650,overflowWrap:"anywhere"}}>{open?"▼":"▶"} {k}</span><strong style={{whiteSpace:"nowrap"}}>{fmt(v)}</strong>
                </button>
                {open&&<div style={{margin:".4rem 0 .5rem 1rem",paddingLeft:".65rem",borderLeft:"2px solid var(--border)"}}>
                  <div style={{display:"grid",gridTemplateColumns:"minmax(160px,1fr) auto",gap:".35rem .75rem",alignItems:"start"}}>
                    <div style={{fontSize:".64rem",fontWeight:800,color:"var(--muted)"}}>SUBCATEGORY</div>
                    <div style={{fontSize:".64rem",fontWeight:800,color:"var(--muted)",textAlign:"right"}}>AMOUNT</div>
                    {sortedPairs(g.subs).map(([sub,amt])=>{
                      const drillKey=`${k}|||${sub}`;
                      const subOpen=!!subCategoryDrill[drillKey];
                      const subRows=(g.rows||[]).filter(r=>(r.subCategory||"Unclassified")===sub);
                      const vendorTotals={};
                      for(const r of subRows){
                        const vendor=r.rawPayable?.VendorName||r.rawExpense?.VendorOrPerson||r.rawBankRow?.Description||"—";
                        const vendorKey=String(vendor||"—").trim()||"—";
                        vendorTotals[vendorKey]=(vendorTotals[vendorKey]||0)+r.amount;
                      }
                      return <div key={drillKey} style={{gridColumn:"1/-1",borderBottom:"1px solid var(--border)",padding:".18rem 0"}}>
                        <button type="button" onClick={()=>{
                          setSubCategoryDrill(p=>({...p,[drillKey]:!p[drillKey]}));
                          setAnalysisCategory(k);
                          setAnalysisSubCategory(sub==="Unclassified"?UNCLASSIFIED_SUBCATEGORY:sub);
                          setAnalysisPage(1);
                        }} style={{width:"100%",display:"grid",gridTemplateColumns:"minmax(160px,1fr) auto",gap:".75rem",alignItems:"center",background:"transparent",border:0,color:"inherit",padding:".12rem 0",cursor:"pointer",textAlign:"left"}}>
                          <span style={{fontSize:".76rem",overflowWrap:"anywhere"}}>{subOpen?"▼":"▶"} {sub}</span>
                          <strong style={{fontSize:".76rem",whiteSpace:"nowrap",textAlign:"right"}}>{fmt(amt)}</strong>
                        </button>
                        {subOpen&&<div style={{margin:".3rem 0 .35rem 1.05rem",paddingLeft:".55rem",borderLeft:"2px solid rgba(255,255,255,.08)"}}>
                          <div style={{display:"grid",gridTemplateColumns:"minmax(150px,1fr) auto",gap:".28rem .75rem"}}>
                            <div style={{fontSize:".62rem",fontWeight:800,color:"var(--muted)"}}>VENDOR</div>
                            <div style={{fontSize:".62rem",fontWeight:800,color:"var(--muted)",textAlign:"right"}}>AMOUNT</div>
                            {sortedPairs(vendorTotals).map(([vendor,vamt])=><>
                              <div key={`${drillKey}-${vendor}-v`} style={{fontSize:".73rem",overflowWrap:"anywhere"}}>{vendor}</div>
                              <strong key={`${drillKey}-${vendor}-a`} style={{fontSize:".73rem",whiteSpace:"nowrap",textAlign:"right"}}>{fmt(vamt)}</strong>
                            </>)}
                          </div>
                          <button type="button" style={{...btn(false),marginTop:".4rem",padding:".3rem .5rem",fontSize:".7rem"}} onClick={()=>{
                            setAnalysisCategory(k);
                            setAnalysisSubCategory(sub==="Unclassified"?UNCLASSIFIED_SUBCATEGORY:sub);
                            setAnalysisPage(1);
                          }}>Show {subRows.length} transactions</button>
                        </div>}
                      </div>
                    })}
                  </div>
                  <button type="button" style={{...btn(false),marginTop:".55rem",padding:".35rem .55rem",fontSize:".72rem"}} onClick={()=>{setAnalysisCategory(k);setAnalysisSubCategory("");setAnalysisPage(1)}}>Show all {g.rows?.length||0} {k} transactions</button>
                </div>}
              </div>
            })}
          </div>}
        </div>

        <div style={card}>
          <button type="button" onClick={()=>setShowFundingDrill(v=>!v)} style={{width:"100%",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",background:"transparent",border:0,color:"inherit",padding:0,cursor:"pointer",textAlign:"left"}}>
            <span style={{fontWeight:800}}>{showFundingDrill?"▼":"▶"} By Funding Source · {analysisFundingTotals.length}</span>
            <span style={{fontSize:".7rem",color:"var(--muted)"}}>{showFundingDrill?"Hide":"Expand"}</span>
          </button>
          {showFundingDrill&&<div style={{marginTop:".55rem"}}>
            {analysisFundingTotals.map(([k,v])=>{
              const open=!!fundingDrill[k],g=fundingDrillData[k]||{};
              return <div key={k} style={{borderBottom:"1px solid var(--border)",padding:".28rem 0"}}>
                <button type="button" onClick={()=>setFundingDrill(p=>({...p,[k]:!p[k]}))} style={{width:"100%",display:"flex",justifyContent:"space-between",gap:"1rem",alignItems:"center",background:"transparent",border:0,color:"inherit",padding:".18rem 0",cursor:"pointer",textAlign:"left"}}>
                  <span style={{fontWeight:650,overflowWrap:"anywhere"}}>{open?"▼":"▶"} {k}</span><strong style={{whiteSpace:"nowrap"}}>{fmt(v)}</strong>
                </button>
                {open&&<div style={{margin:".4rem 0 .5rem 1rem",paddingLeft:".65rem",borderLeft:"2px solid var(--border)"}}>
                  <div style={{fontSize:".66rem",fontWeight:800,color:"var(--muted)",marginBottom:".25rem"}}>CATEGORY</div>
                  {sortedPairs(g.categories).map(([name,amt])=><div key={name} style={{display:"flex",justifyContent:"space-between",gap:".8rem",fontSize:".75rem",padding:".14rem 0"}}><span>{name}</span><strong>{fmt(amt)}</strong></div>)}
                  <div style={{fontSize:".66rem",fontWeight:800,color:"var(--muted)",margin:".5rem 0 .25rem"}}>SUBCATEGORY</div>
                  {sortedPairs(g.subs).slice(0,10).map(([name,amt])=><div key={name} style={{display:"flex",justifyContent:"space-between",gap:".8rem",fontSize:".75rem",padding:".14rem 0"}}><span>{name}</span><strong>{fmt(amt)}</strong></div>)}
                  <div style={{fontSize:".66rem",fontWeight:800,color:"var(--muted)",margin:".5rem 0 .25rem"}}>TOP VENDORS / SOURCES</div>
                  {sortedPairs(g.vendors).slice(0,8).map(([name,amt])=><div key={name} style={{display:"flex",justifyContent:"space-between",gap:".8rem",fontSize:".75rem",padding:".14rem 0"}}><span style={{overflowWrap:"anywhere"}}>{name}</span><strong style={{whiteSpace:"nowrap"}}>{fmt(amt)}</strong></div>)}
                  <button type="button" style={{...btn(false),marginTop:".5rem",padding:".35rem .55rem",fontSize:".72rem"}} onClick={()=>{setAnalysisFunding(k);setAnalysisPage(1)}}>Show {g.rows?.length||0} transactions</button>
                </div>}
              </div>
            })}
          </div>}
        </div>
      </div>

      <div style={{...card,padding:0,overflow:"hidden"}}>
        <div style={{padding:".85rem 1rem",fontWeight:700,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",gap:"1rem",flexWrap:"wrap",alignItems:"center"}}>
          <div>
            <span>Expense Analysis · {analysisRows.length} records</span>
            <div style={{fontSize:".68rem",fontWeight:400,color:"var(--muted)",marginTop:".18rem"}}>Use Action to classify Zivara-paid rows or edit personal-paid expenses. Open Details for narration, scope and source.</div>
          </div>
          <div style={{display:"flex",gap:".5rem",alignItems:"center",flexWrap:"wrap"}}>
            <select style={{...inp,width:"auto",minWidth:95}} value={analysisPageSize} onChange={e=>setAnalysisPageSize(Number(e.target.value))}>
              {[25,50,100].map(n=><option key={n} value={n}>{n} rows</option>)}
            </select>
            <button style={btn(false)} onClick={exportAnalysisExcel}>Export Excel</button>
            <button style={btn(false)} onClick={exportAnalysisPDF}>Export Full PDF</button>
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
              <th style={{width:"145px"}}>Action</th>
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
                  <td>
                    {String(r.source||"").startsWith("Zivara Bank")
                      ? <button style={{...btn(false),padding:".38rem .55rem",fontSize:".74rem"}} onClick={()=>openBankClassification(r.rawBankRow)}>{r.classified?"Edit Classification":"Classify"}</button>
                      : r.source==="Partner / Staff Expense"
                        ? <button style={{...btn(false),padding:".38rem .55rem",fontSize:".74rem"}} onClick={()=>openEdit(r.rawExpense)}>Edit Expense</button>
                        : r.source==="Vendor Bill"
                          ? <button style={{...btn(false),padding:".38rem .55rem",fontSize:".74rem"}} onClick={()=>openVendorBillClassification(r.rawPayable)}>{r.classified?"Edit Classification":"Classify"}</button>
                          : <span style={{color:"var(--muted)"}}>—</span>}
                  </td>
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
      <div style={{fontSize:".72rem",color:"var(--muted)",marginBottom:".25rem"}}><strong>Drill-down:</strong> By Category and By Funding Source stay collapsed until clicked. In By Category, clicking a Subcategory now immediately filters the detailed table to that Subcategory and also expands its Vendor breakup. Unclassified therefore shows only unclassified rows.</div>
      <div style={{fontSize:".72rem",color:"var(--muted)"}}><strong>Double-count safeguard:</strong> Vendor Bills are counted on their bill date and can now be classified by Category, Subcategory, Person/Traveller and Domestic/International. Later Zivara bank payments that settle those bills are excluded from expense totals. Personal-paid expenses are counted once when incurred; later reimbursements are not added again. Only genuine direct Zivara bank expenses without an underlying Vendor Bill are counted from Transactions. PDF/Excel export the same filtered management-expense view.</div>
    </>}

    {taxonomyOpen&&<div onMouseDown={e=>{if(e.target===e.currentTarget)setTaxonomyOpen(false)}} style={{position:"fixed",inset:0,zIndex:1200,background:"rgba(0,0,0,.64)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{...card,width:"min(900px,96vw)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",flexWrap:"wrap",marginBottom:".85rem"}}>
          <div><h3 style={{margin:0,fontWeight:800}}>Manage Categories & Subcategories</h3><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".22rem"}}>Rename / Merge corrects spelling across Expense Analysis without changing amounts, GST, payments or accounting journals.</div></div>
          <button style={btn(false)} onClick={()=>setTaxonomyOpen(false)}>Close</button>
        </div>
        <div style={{padding:".65rem .75rem",border:"1px solid var(--border)",borderRadius:"7px",fontSize:".72rem",color:"var(--muted)",marginBottom:".85rem"}}>
          For your current duplicate, use <strong style={{color:"var(--text)"}}>Rename / Merge</strong> on <strong style={{color:"var(--text)"}}>Furnshing</strong> and enter <strong style={{color:"var(--text)"}}>Furnishing</strong>. The totals merge immediately, and Edit Expense will show the corrected value. Delete is blocked while a label is still used by records.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:".85rem"}}>
          <div style={{border:"1px solid var(--border)",borderRadius:"8px",overflow:"hidden"}}>
            <div style={{padding:".65rem .75rem",display:"flex",justifyContent:"space-between",alignItems:"center",gap:".5rem",borderBottom:"1px solid var(--border)"}}><strong>Categories · {taxonomyCategoryRows.length}</strong><button type="button" style={{...btn(false),padding:".35rem .55rem",fontSize:".72rem"}} onClick={addTaxonomyCategory}>+ Add</button></div>
            <div style={{maxHeight:"55vh",overflowY:"auto"}}>{taxonomyCategoryRows.map(x=><div key={x.name} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:".5rem",alignItems:"center",padding:".5rem .65rem",borderBottom:"1px solid var(--border)"}}><div><div style={{fontWeight:650,overflowWrap:"anywhere"}}>{x.name}</div><div style={{fontSize:".66rem",color:"var(--muted)"}}>{x.count} record(s)</div></div><div style={{display:"flex",gap:".35rem"}}><button type="button" style={{...btn(false),padding:".3rem .45rem",fontSize:".68rem"}} onClick={()=>renameTaxonomyLabel("category",x.name)}>Rename / Merge</button><button type="button" style={{...btn(false),padding:".3rem .45rem",fontSize:".68rem",color:"var(--danger)"}} onClick={()=>deleteTaxonomyLabel("category",x.name,x.count)}>Delete</button></div></div>)}</div>
          </div>
          <div style={{border:"1px solid var(--border)",borderRadius:"8px",overflow:"hidden"}}>
            <div style={{padding:".65rem .75rem",display:"flex",justifyContent:"space-between",alignItems:"center",gap:".5rem",borderBottom:"1px solid var(--border)"}}><strong>Subcategories · {taxonomySubCategoryRows.length}</strong><button type="button" style={{...btn(false),padding:".35rem .55rem",fontSize:".72rem"}} onClick={addTaxonomySubCategory}>+ Add</button></div>
            <div style={{maxHeight:"55vh",overflowY:"auto"}}>{taxonomySubCategoryRows.map(x=><div key={x.name} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:".5rem",alignItems:"center",padding:".5rem .65rem",borderBottom:"1px solid var(--border)"}}><div><div style={{fontWeight:650,overflowWrap:"anywhere"}}>{x.name}</div><div style={{fontSize:".66rem",color:"var(--muted)"}}>{x.count} record(s)</div></div><div style={{display:"flex",gap:".35rem"}}><button type="button" style={{...btn(false),padding:".3rem .45rem",fontSize:".68rem"}} onClick={()=>renameTaxonomyLabel("subcategory",x.name)}>Rename / Merge</button><button type="button" style={{...btn(false),padding:".3rem .45rem",fontSize:".68rem",color:"var(--danger)"}} onClick={()=>deleteTaxonomyLabel("subcategory",x.name,x.count)}>Delete</button></div></div>)}</div>
          </div>
        </div>
        <div style={{marginTop:".75rem",fontSize:".68rem",color:"var(--muted)"}}>Category/subcategory rename rules are management-reporting aliases stored with the same browser storage approach already used by Expense Analysis classifications. Saving an edited Expense writes the corrected canonical label back to that Expense record.</div>
      </div>
    </div>}

    {classifyOpen&&<div onMouseDown={e=>{if(e.target===e.currentTarget)setClassifyOpen(false)}} style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,.62)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{...card,width:"min(620px,95vw)",boxShadow:"0 20px 60px rgba(0,0,0,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"1rem",marginBottom:"1rem"}}>
          <div>
            <h3 style={{margin:0,fontWeight:750}}>{classifyKind==="vendor"?"Classify Vendor Bill":"Classify Zivara-Paid Expense"}</h3>
            <div style={{fontSize:".73rem",color:"var(--muted)",marginTop:".2rem"}}>
              {classifyKind==="vendor"
                ? `${classifyRow?.VendorName||"Vendor"} · ${classifyRow?.BillNo||""} · ${fmt(classifyRow?.GrossAmount||0)}`
                : `${classifyRow?.Description||classifyRow?.ReferenceID||"Bank payment"} · ${fmt(classifyRow?.AmountOut||0)}`}
            </div>
          </div>
          <button style={btn(false)} onClick={()=>setClassifyOpen(false)}>Close</button>
        </div>
        <div style={{marginBottom:".85rem",padding:".7rem .8rem",border:"1px solid var(--border)",borderRadius:"7px",background:"rgba(255,255,255,.025)"}}>
          <div style={{fontSize:".64rem",color:"var(--muted)",fontWeight:700,marginBottom:".25rem"}}>DESCRIPTION / NARRATION</div>
          <div style={{fontSize:".82rem",lineHeight:1.4,whiteSpace:"normal",overflowWrap:"anywhere",wordBreak:"break-word"}}>
            {classifyKind==="vendor"
              ? (classifyRow?.Description||classifyRow?.VendorName||"—")
              : (classifyRow?.Description||classifyRow?.Narration||classifyRow?.ReferenceID||"—")}
          </div>
          <div style={{display:"flex",gap:".8rem",flexWrap:"wrap",marginTop:".45rem",fontSize:".7rem",color:"var(--muted)"}}>
            {classifyKind==="vendor"&&classifyRow?.BillNo&&<span>Bill: <strong style={{color:"var(--text)"}}>{classifyRow.BillNo}</strong></span>}
            {classifyKind==="bank"&&classifyRow?.ReferenceID&&<span>Reference: <strong style={{color:"var(--text)"}}>{classifyRow.ReferenceID}</strong></span>}
            {classifyKind==="bank"&&classifyRow?.LedgerName&&<span>Ledger: <strong style={{color:"var(--text)"}}>{classifyRow.LedgerName}</strong></span>}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:".75rem"}}>
          <div><label style={label}>Category</label><select style={inp} value={classifyAddingCategory?"__add_category__":classifyForm.Category} onChange={e=>changeClassifyCategory(e.target.value)}><option value="">— Select category —</option>{categoryOptions.map(x=><option key={x} value={x}>{x}</option>)}{classifyForm.Category&&!categoryOptions.includes(classifyForm.Category)&&<option value={classifyForm.Category}>{classifyForm.Category}</option>}<option disabled>────────────</option><option value="__add_category__">+ Add Category</option></select>{classifyAddingCategory&&<div style={{display:"flex",gap:".4rem",marginTop:".4rem"}}><input style={{...inp,minWidth:0}} autoFocus value={classifyNewCategory} onChange={e=>setClassifyNewCategory(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addClassifyCategory()}if(e.key==="Escape"){setClassifyAddingCategory(false);setClassifyNewCategory("")}}} placeholder="Enter new category"/><button type="button" style={{...btn(),padding:".4rem .65rem"}} onClick={addClassifyCategory}>Add</button></div>}</div>
          <div>
            <label style={label}>Subcategory</label>
            <select
              style={inp}
              value={classifyAddingSubCategory?"__add_subcategory__":classifyForm.SubCategory}
              onChange={e=>changeClassifySubCategory(e.target.value)}
              disabled={!classifyForm.Category}
            >
              <option value="">— Select subcategory —</option>
              {classifySubCategoryOptions.map(x=><option key={x} value={x}>{x}</option>)}
              {classifyForm.SubCategory&&!classifySubCategoryOptions.includes(classifyForm.SubCategory)&&<option value={classifyForm.SubCategory}>{classifyForm.SubCategory}</option>}
              <option disabled>────────────</option>
              <option value="__add_subcategory__">+ Add Subcategory</option>
            </select>
            {classifyAddingSubCategory&&<div style={{display:"flex",gap:".4rem",marginTop:".4rem"}}><input style={{...inp,minWidth:0}} autoFocus value={classifyNewSubCategory} onChange={e=>setClassifyNewSubCategory(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addClassifySubCategory()}if(e.key==="Escape"){setClassifyAddingSubCategory(false);setClassifyNewSubCategory("")}}} placeholder="Enter new subcategory"/><button type="button" style={{...btn(),padding:".4rem .65rem"}} onClick={addClassifySubCategory}>Add</button></div>}
          </div>
          <div><label style={label}>Expense For / Traveller</label><select style={inp} value={classifyForm.ExpenseFor} onChange={e=>setClassifyForm(p=>({...p,ExpenseFor:e.target.value}))}><option value="">— Select person / traveller —</option>{allPeople.map(x=><option key={x} value={x}>{x}</option>)}{classifyForm.ExpenseFor&&!allPeople.includes(classifyForm.ExpenseFor)&&<option value={classifyForm.ExpenseFor}>{classifyForm.ExpenseFor}</option>}</select></div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",gap:".65rem",marginTop:"1rem",flexWrap:"wrap"}}>
          <button type="button" style={{...btn(false),color:"var(--danger)"}} onClick={clearClassification}>Clear Classification</button>
          <div style={{display:"flex",gap:".65rem"}}><button type="button" style={btn(false)} onClick={()=>setClassifyOpen(false)}>Cancel</button><button type="button" style={btn()} onClick={saveClassification}>Save Classification</button></div>
        </div>
        <div style={{marginTop:".75rem",fontSize:".7rem",color:"var(--muted)"}}>
          {classifyKind==="vendor"
            ?"This changes Expense Analysis classification only. Vendor bill amount, GST/TDS, payment status and accounting posting are not edited."
            :"This changes management reporting only. The bank transaction, ledger posting, amount and accounting narration are not edited."}
        </div>
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
            <div><label style={label}>Expense For / Traveller</label>
              <select style={inp} value={addingExpenseFor?"__add_person__":form.ExpenseFor} onChange={e=>changeExpenseFor(e.target.value)}>
                <option value="">— Select person / traveller —</option>{allPeople.map(x=><option key={x} value={x}>{x}</option>)}{form.ExpenseFor&&!allPeople.includes(form.ExpenseFor)&&<option value={form.ExpenseFor}>{form.ExpenseFor}</option>}<option disabled>────────────</option><option value="__add_person__">+ Add Person / Traveller</option>
              </select>
              {addingExpenseFor&&<div style={{display:"flex",gap:".4rem",marginTop:".4rem"}}><input style={{...inp,minWidth:0}} autoFocus value={newExpenseFor} onChange={e=>setNewExpenseFor(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addExpenseFor()}if(e.key==="Escape"){setAddingExpenseFor(false);setNewExpenseFor("")}}} placeholder="Enter person / traveller name"/><button type="button" style={{...btn(),padding:".4rem .65rem"}} onClick={addExpenseFor}>Add</button></div>}
            </div>
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
