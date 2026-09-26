import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, onSnapshot, runTransaction, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const C = window.NATUREGEN_FIREBASE_CONFIG || {};
const configured = Boolean(
  C.apiKey && C.projectId && C.appId &&
  !String(C.apiKey).includes('PASTE_') && !String(C.projectId).includes('PASTE_') && !String(C.appId).includes('PASTE_')
);

const app = configured ? initializeApp(C) : null;
const auth = configured ? getAuth(app) : null;
const db = configured ? getFirestore(app) : null;
if (auth) setPersistence(auth, browserLocalPersistence).catch(console.error);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number(n || 0));
const money = (n) => `Rs. ${fmt(n)}`;
const todayISO = () => new Date().toISOString().slice(0,10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const asDate = (v) => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d;
};
const date = (v) => asDate(v)?.toLocaleDateString('en-PK') || '';
const dt = (v) => asDate(v)?.toLocaleString('en-PK') || '';
const tsFromInput = (v) => Timestamp.fromDate(new Date(`${v}T12:00:00`));
const sortDesc = (rows, field) => [...rows].sort((a,b)=>(asDate(b[field])?.getTime()||0)-(asDate(a[field])?.getTime()||0));
const sortAscText = (rows, field) => [...rows].sort((a,b)=>String(a[field]||'').localeCompare(String(b[field]||'')));

const state = {
  user:null, me:null, page:'dashboard',
  products:[], customers:[], users:[], sales:[], payments:[], expenses:[], movements:[], ledgerEntries:[], auditTrail:[], accounts:[], settings:null,
  unsubs:[], liveReady:false
};

function toast(msg, error=false){
  const el=$('#toast'); el.textContent=msg; el.className=`toast show${error?' error':''}`;
  clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',3400);
}
function showModal(title, html){ $('#modalTitle').textContent=title; $('#modalBody').innerHTML=html; $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false'); }
function closeModal(){ $('#modal').classList.add('hidden'); $('#modal').setAttribute('aria-hidden','true'); }
function role(){ return state.me?.role || ''; }
function can(...roles){ return roles.includes(role()); }
function profileName(id){ return state.users.find(x=>x.id===id)?.fullName || '—'; }
function customerName(id){ return state.customers.find(x=>x.id===id)?.shopName || '—'; }
function productName(id){ return state.products.find(x=>x.id===id)?.name || '—'; }
function setSync(text){ $('#syncStatus').textContent=text; }
function badgeStatus(s){ const cls=s==='paid'?'ok':s==='partial'?'warn':'danger'; return `<span class="badge ${cls}">${esc(s||'unpaid')}</span>`; }
function invoiceStatus(s){ return s?.status || 'approved'; }
function statusBadge(s){ const v=invoiceStatus(s); return `<span class="badge status-${esc(v)}">${esc(v.replaceAll('_',' '))}</span>`; }
function activeProducts(){ return state.products.filter(p=>p.active!==false); }
function accessibleSales(){ return state.sales; }
function approvedSales(){ return state.sales.filter(s=>invoiceStatus(s)==='approved'); }
function calcStatus(total, paid){ return Number(paid||0) >= Number(total||0)-0.001 ? 'paid' : Number(paid||0)>0 ? 'partial' : 'unpaid'; }
function isManagement(){ return can('admin','marketing_director','erp_manager'); }
function canApproveInvoice(){ return can('marketing_director'); }
function canControlInvoice(){ return can('marketing_director','erp_manager'); }
function canDeactivateCustomer(){ return can('marketing_director','erp_manager'); }
function canManageCustomers(){ return can('admin','marketing_director','erp_manager'); }
function canManageExpenses(){ return can('admin','marketing_director','erp_manager'); }
function customerOutstanding(customerId){
  return approvedSales().filter(s=>s.customerId===customerId && invoiceStatus(s)!=='cancelled')
    .reduce((a,s)=>a+Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)),0);
}
function dueDateFor(customer,saleDateValue){
  const d=asDate(saleDateValue)||new Date(); d.setDate(d.getDate()+Number(customer?.creditDays||0)); return Timestamp.fromDate(d);
}
function auditSet(tx, action, entityType, entityId, details={}){
  const ref=doc(collection(db,'auditTrail')), now=Timestamp.now();
  tx.set(ref,{action,entityType,entityId,actorId:state.user.uid,actorName:state.me?.fullName||state.user.email||'',actorRole:role(),details,createdAt:now});
}
async function writeAudit(action,entityType,entityId,details={}){
  await addDoc(collection(db,'auditTrail'),{action,entityType,entityId,actorId:state.user.uid,actorName:state.me?.fullName||state.user.email||'',actorRole:role(),details,createdAt:serverTimestamp()});
}
function normalizeKey(v=''){ return String(v).trim().toLowerCase().replace(/\s+/g,' '); }
function idxId(prefix,v=''){ return `${prefix}:${encodeURIComponent(normalizeKey(v))}`; }
function ledgerEntry(tx,data){
  const ref=doc(collection(db,'ledgerEntries'));
  tx.set(ref,{...data,createdAt:Timestamp.now(),createdBy:state.user.uid});
  return ref;
}
function ledgerRowsForCustomer(customerId){
  const stored=state.ledgerEntries.filter(e=>e.customerId===customerId);
  const sourceKeys=new Set(stored.map(e=>`${e.sourceType||e.documentType||''}:${e.sourceId||e.documentId||''}:${e.entryType||''}`));
  const extra=[];
  const cust=state.customers.find(c=>c.id===customerId);
  if(Number(cust?.openingBalance||0)!==0 && !stored.some(e=>e.entryType==='opening_balance')){
    const ob=Number(cust.openingBalance||0); extra.push({id:'legacy-opening',customerId,entryType:'opening_balance',documentNo:'OPENING',transactionDate:cust.createdAt||Timestamp.fromDate(new Date(0)),debit:ob>0?ob:0,credit:ob<0?-ob:0,notes:'Opening balance'});
  }
  state.sales.filter(s=>s.customerId===customerId && invoiceStatus(s)==='approved').forEach(s=>{
    const key=`sale:${s.id}:invoice`; if(!sourceKeys.has(key)){
      extra.push({id:`legacy-sale-${s.id}`,customerId,entryType:'credit_sale',sourceType:'sale',sourceId:s.id,documentType:'invoice',documentId:s.id,documentNo:s.invoiceNo,invoiceNo:s.invoiceNo,transactionDate:s.saleDate,debit:Number(s.total||0),credit:0,paymentStatus:s.paymentStatus,dueDate:s.dueDate||dueDateFor(cust,s.saleDate),notes:'Approved invoice'});
      if(Number(s.paidAmount||0)>0) extra.push({id:`legacy-pay-${s.id}`,customerId,entryType:'payment_received',sourceType:'legacy_payment',sourceId:s.id,documentType:'receipt',documentId:s.id,documentNo:`${s.invoiceNo}-PAY`,invoiceNo:s.invoiceNo,transactionDate:s.saleDate,debit:0,credit:Number(s.paidAmount||0),notes:'Legacy recorded payment'});
    }
  });
  return [...stored,...extra].sort((a,b)=>(asDate(a.transactionDate)?.getTime()||0)-(asDate(b.transactionDate)?.getTime()||0));
}
function readSmallAttachment(file){
  if(!file) return Promise.resolve(null);
  if(file.size>500000) return Promise.reject(new Error('Attachment must be 500 KB or smaller.'));
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve({name:file.name,type:file.type||'application/octet-stream',dataUrl:r.result}); r.onerror=()=>reject(r.error||new Error('Attachment could not be read.')); r.readAsDataURL(file); });
}

const navByRole = {
  admin:[['dashboard','Dashboard','⌂'],['sales','Sales & Invoices','🧾'],['customers','Customers','◫'],['ledger','Customer Ledger','▤'],['inventory','Inventory','▣'],['recovery','Recovery','₨'],['expenses','Expenses','−'],['reports','Reports','▥'],['users','Users & Roles','♙'],['audit','Audit Trail','☷'],['settings','Settings','⚙']],
  marketing_director:[['dashboard','Dashboard','⌂'],['sales','Invoice Approval','🧾'],['customers','Customers','◫'],['ledger','Customer Ledger','▤'],['recovery','Recovery','₨'],['expenses','Expenses','−'],['reports','Reports','▥']],
  erp_manager:[['dashboard','Dashboard','⌂'],['sales','Sales & Invoices','🧾'],['customers','Customers','◫'],['ledger','Customer Ledger','▤'],['inventory','Inventory','▣'],['recovery','Recovery','₨'],['expenses','Expenses','−'],['reports','Reports','▥'],['users','Users & Roles','♙'],['audit','Audit Trail','☷'],['settings','Settings','⚙']],
  inventory:[['dashboard','Dashboard','⌂'],['sales','Invoices','🧾'],['customers','Customers','◫'],['inventory','Inventory','▣']],
  salesman:[['dashboard','My Dashboard','⌂'],['sales','My Sales','🧾'],['customers','My Customers','◫'],['ledger','Customer Ledger','▤']],
  recovery:[['dashboard','Dashboard','⌂'],['sales','Invoices','🧾'],['customers','Customers','◫'],['ledger','Customer Ledger','▤'],['recovery','Recovery','₨']]
};

function renderNav(){
  const items=navByRole[role()]||[];
  $('#nav').innerHTML=items.map(([id,label,icon])=>`<button class="nav-btn ${state.page===id?'active':''}" data-page="${id}"><b>${icon}</b><span>${label}</span></button>`).join('');
  $$('#nav .nav-btn').forEach(b=>b.onclick=()=>go(b.dataset.page));
}
function go(page){
  const allowed=(navByRole[role()]||[]).some(x=>x[0]===page); if(!allowed) page='dashboard';
  state.page=page; $$('.page').forEach(p=>p.classList.add('hidden')); $(`#${page}Page`)?.classList.remove('hidden');
  $('#pageTitle').textContent=(navByRole[role()]||[]).find(x=>x[0]===page)?.[1]||'Naturegen'; renderNav(); renderPage();
}
function renderPage(){
  const fn={dashboard:renderDashboard,sales:renderSales,customers:renderCustomers,ledger:renderLedger,inventory:renderInventory,recovery:renderRecovery,expenses:renderExpenses,reports:renderReports,users:renderUsers,audit:renderAudit,settings:renderSettings}[state.page];
  if(fn) fn();
}

function clearListeners(){ state.unsubs.forEach(u=>{try{u();}catch{}}); state.unsubs=[]; state.liveReady=false; }
function userQueryFor(collectionName){
  const ref=collection(db,collectionName);
  if(role()==='salesman'){
    if(collectionName==='sales' || collectionName==='payments' || collectionName==='ledgerEntries') return query(ref,where('salesmanId','==',state.user.uid));
    if(collectionName==='customers') return query(ref,where('assignedSalesmanId','==',state.user.uid));
  }
  return ref;
}
function attachCollection(name, target, transform=(x)=>x){
  const q=userQueryFor(name);
  const unsub=onSnapshot(q, snap=>{
    state[target]=snap.docs.map(d=>transform({id:d.id,...d.data()}));
    if(target==='products') state.products=sortAscText(state.products,'name');
    if(target==='customers') state.customers=sortAscText(state.customers,'shopName');
    if(target==='users') state.users=sortAscText(state.users,'fullName');
    if(target==='sales') state.sales=sortDesc(state.sales,'saleDate');
    if(target==='payments') state.payments=sortDesc(state.payments,'paymentDate');
    if(target==='expenses') state.expenses=sortDesc(state.expenses,'expenseDate');
    if(target==='movements') state.movements=sortDesc(state.movements,'createdAt');
    if(target==='ledgerEntries') state.ledgerEntries=sortDesc(state.ledgerEntries,'transactionDate');
    if(target==='auditTrail') state.auditTrail=sortDesc(state.auditTrail,'createdAt');
    setSync(`Live • ${new Date().toLocaleTimeString('en-PK')}`); renderPage();
  }, err=>{ console.error(name,err); setSync(`Sync error: ${name}`); toast(`${name}: ${err.message}`,true); });
  state.unsubs.push(unsub);
}

async function startLiveData(){
  clearListeners();
  attachCollection('products','products');
  attachCollection('customers','customers');
  attachCollection('users','users');
  attachCollection('sales','sales');
  if(can('admin','marketing_director','erp_manager','recovery')) attachCollection('payments','payments'); else if(can('salesman')) attachCollection('payments','payments'); else state.payments=[];
  if(can('admin','marketing_director','erp_manager')) attachCollection('expenses','expenses'); else state.expenses=[];
  if(can('admin','erp_manager','inventory','marketing_director')) attachCollection('stockMovements','movements'); else state.movements=[];
  if(can('admin','marketing_director','erp_manager','recovery','salesman')) attachCollection('ledgerEntries','ledgerEntries'); else state.ledgerEntries=[];
  if(can('admin','erp_manager')) attachCollection('auditTrail','auditTrail'); else state.auditTrail=[];
  if(can('admin','marketing_director','erp_manager')) attachCollection('cashBankAccounts','accounts'); else state.accounts=[];
  state.unsubs.push(onSnapshot(doc(db,'settings','company'), s=>{ state.settings=s.exists()?{id:s.id,...s.data()}:null; renderPage(); }));
  state.liveReady=true;
}

async function loadProfile(user){
  const snap=await getDoc(doc(db,'users',user.uid));
  if(!snap.exists()) return null;
  const p={id:snap.id,...snap.data()};
  if(p.active===false) return null;
  return p;
}

function showLogin(){ $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }
function showApp(){ $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }

function renderDashboard(){
  const start=monthStart(), sales=approvedSales().filter(s=>(asDate(s.saleDate)||new Date(0))>=start);
  const total=sales.reduce((a,s)=>a+Number(s.total||0),0), collected=sales.reduce((a,s)=>a+Number(s.paidAmount||0),0), outstanding=approvedSales().reduce((a,s)=>a+Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)),0), stock=state.products.reduce((a,p)=>a+Number(p.stockQty||0),0), low=activeProducts().filter(p=>Number(p.stockQty||0)<=Number(p.lowStockThreshold||0)), pending=accessibleSales().filter(s=>invoiceStatus(s)==='pending_approval').length;
  let perf='';
  if(can('admin','marketing_director','erp_manager')){const reps=state.users.filter(p=>p.role==='salesman'&&p.active!==false);perf=`<div class="section-head"><h3>Salesman Performance — Approved Sales This Month</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Salesman</th><th>Route</th><th>Invoices</th><th>Sales</th><th>Recovery</th><th>Outstanding</th><th>Target</th><th>Achievement</th></tr></thead><tbody>${reps.map(p=>{const ss=sales.filter(s=>s.salesmanId===p.id),st=ss.reduce((a,s)=>a+Number(s.total||0),0),rec=ss.reduce((a,s)=>a+Number(s.paidAmount||0),0),out=ss.reduce((a,s)=>a+Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)),0),pct=Number(p.monthlyTarget||0)>0?Math.min(100,st/Number(p.monthlyTarget)*100):0;return `<tr><td><b>${esc(p.fullName)}</b></td><td>${esc(p.routeArea||'—')}</td><td>${ss.length}</td><td>${money(st)}</td><td>${money(rec)}</td><td>${money(out)}</td><td>${money(p.monthlyTarget)}</td><td><div>${pct.toFixed(1)}%</div><div class="progress"><span style="width:${pct}%"></span></div></td></tr>`;}).join('')||'<tr><td colspan="8" class="empty">No salesman users yet.</td></tr>'}</tbody></table></div>`;}
  $('#dashboardPage').innerHTML=`<div class="grid cards"><div class="card stat"><small>${can('salesman')?'My ':''}Approved Sales This Month</small><strong>${money(total)}</strong><div class="sub">${sales.length} approved invoice(s)</div></div><div class="card stat"><small>Collected This Month</small><strong>${money(collected)}</strong><div class="sub">Approved invoices only</div></div><div class="card stat"><small>Outstanding</small><strong>${money(outstanding)}</strong><div class="sub">Current approved receivables</div></div><div class="card stat"><small>${canApproveInvoice()?'Pending Approval':'Total Stock Units'}</small><strong>${canApproveInvoice()?fmt(pending):fmt(stock)}</strong><div class="sub">${canApproveInvoice()?'Invoices waiting for review':low.length+' low-stock product(s)'}</div></div></div>${low.length?`<div class="section-head"><h3>Low Stock Alerts</h3></div><div class="grid">${low.map(p=>`<div class="card"><b>${esc(p.name)}</b><div class="kpi-line"><span>Available</span><strong>${fmt(p.stockQty)}</strong></div><div class="kpi-line"><span>Alert level</span><span>${fmt(p.lowStockThreshold)}</span></div></div>`).join('')}</div>`:''}${perf}<div class="section-head"><h3>Recent Invoices</h3></div>${salesTable(accessibleSales().slice(0,8),false)}`;
}

function salesTable(rows,actions=true){
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Salesman</th><th>Total</th><th>Paid</th><th>Balance</th><th>Approval</th><th>Payment</th>${actions?'<th></th>':''}</tr></thead><tbody>${rows.map(s=>`<tr><td><b>${esc(s.invoiceNo)}</b></td><td>${date(s.saleDate)}</td><td>${esc(customerName(s.customerId))}</td><td>${esc(profileName(s.salesmanId))}</td><td>${money(s.total)}</td><td>${money(s.paidAmount)}</td><td>${money(Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)))}</td><td>${statusBadge(s)}</td><td>${badgeStatus(s.paymentStatus)}</td>${actions?`<td><button class="btn ghost small" data-invoice="${s.id}">View</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${actions?10:9}" class="empty">No invoices found.</td></tr>`}</tbody></table></div>`;
}

function renderSales(){
  const reps=state.users.filter(u=>u.role==='salesman'&&u.active!==false);
  const canCreate=can('admin','salesman');
  const title=can('marketing_director')?'Invoice Approval':can('salesman')?'My Sales':'Sales & Invoices';
  $('#salesPage').innerHTML=`<div class="section-head"><div><h3>${title}</h3><div class="muted">Stock, ledger and dispatch become effective only after invoice approval.</div></div>${canCreate?'<button id="newSaleBtn" class="btn primary">+ New Invoice</button>':''}</div>
  <div class="filters"><label>Search<input id="saleSearch" placeholder="Invoice / customer"></label><label>Approval Status<select id="saleStatusFilter"><option value="">All</option><option value="draft">Draft</option><option value="pending_approval">Pending Approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label>${can('admin','marketing_director','erp_manager')?`<label>Salesman<select id="saleRepFilter"><option value="">All</option>${reps.map(r=>`<option value="${r.id}">${esc(r.fullName)}</option>`).join('')}</select></label>`:''}</div><div id="salesTableHost">${salesTable(accessibleSales())}</div>`;
  if(canCreate) $('#newSaleBtn').onclick=openSaleForm;
  const refresh=()=>{
    const term=($('#saleSearch')?.value||'').toLowerCase(), rep=$('#saleRepFilter')?.value||'', st=$('#saleStatusFilter')?.value||'';
    const rows=accessibleSales().filter(s=>(!rep||s.salesmanId===rep) && (!st||invoiceStatus(s)===st) && (!term||String(s.invoiceNo||'').toLowerCase().includes(term)||customerName(s.customerId).toLowerCase().includes(term)));
    $('#salesTableHost').innerHTML=salesTable(rows); bindInvoiceButtons();
  };
  $('#saleSearch').oninput=refresh; $('#saleStatusFilter').onchange=refresh; if($('#saleRepFilter')) $('#saleRepFilter').onchange=refresh; bindInvoiceButtons();
}
function bindInvoiceButtons(){ $$('[data-invoice]').forEach(b=>b.onclick=()=>openInvoice(b.dataset.invoice)); }

function openSaleForm(){
  if(!state.customers.filter(c=>c.active!==false).length) return toast('Add an active customer first.',true);
  if(!activeProducts().length) return toast('No active products available.',true);
  const reps=state.users.filter(u=>u.role==='salesman'&&u.active!==false);
  const salesmanSelect=can('admin')?`<label>Salesman<select id="saleSalesman" required><option value="">Select salesman</option>${reps.map(r=>`<option value="${r.id}">${esc(r.fullName)} — ${esc(r.routeArea||'')}</option>`).join('')}</select></label>`:`<input id="saleSalesman" type="hidden" value="${state.user.uid}">`;
  showModal('New Sales Invoice',`<form id="saleForm" class="stack">
    <div class="form-grid"><label>Date<input id="saleDate" type="date" value="${todayISO()}" required></label>${salesmanSelect}<label class="full">Customer<select id="saleCustomer" required><option value="">Select pharmacy/customer</option>${state.customers.filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${esc(c.customerCode||'')} ${esc(c.shopName)}${c.routeArea?' — '+esc(c.routeArea):''}</option>`).join('')}</select></label></div>
    <div><b>Products</b><div class="help">Complimentary/Free Quantity starts at zero. It is scheme-authorized only for customers marked eligible; otherwise Marketing Director approval is required.</div><div id="customerSchemeNote" class="metric-note"></div></div>
    <div class="sale-lines">${activeProducts().map(p=>`<div class="sale-line" data-product="${p.id}"><div class="wide"><b>${esc(p.name)}</b><div class="metric-note">Stock ${fmt(p.stockQty)} • Authorized scheme ${p.schemeBuy||0}+${p.schemeFree||0} • Price ${money(p.salePrice)}</div></div><label>Paid Qty<input class="line-qty" type="number" min="0" step="1" value="0"></label><label>Free Qty<input class="line-free" type="number" min="0" step="1" value="0"></label><label>Unit Price<input class="line-price" type="number" min="0" step="0.01" value="${Number(p.salePrice||0)}" ${can('admin')?'':'readonly'}></label><div class="line-total">${money(0)}</div></div>`).join('')}</div>
    <div id="freeExceptionNote" class="approval-note hidden">Complimentary quantity exceeds the product scheme limit. Marketing Director approval is required.</div>
    <div class="form-grid"><label>Discount<input id="saleDiscount" type="number" min="0" step="0.01" value="0"></label><label>Proposed Received Amount<input id="salePaid" type="number" min="0" step="0.01" value="0"></label><label>Payment Method<select id="salePaymentMethod"><option value="cash">Cash</option><option value="bank">Bank</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option><option value="cheque">Cheque</option></select></label><label class="full">Notes<textarea id="saleNotes"></textarea></label></div>
    <div class="card"><div class="kpi-line"><span>Gross</span><strong id="saleGross">${money(0)}</strong></div><div class="kpi-line"><span>Discount</span><span id="saleDiscountView">${money(0)}</span></div><div class="kpi-line"><span>Invoice Total</span><strong id="saleTotal">${money(0)}</strong></div></div>
    <div class="actions">${can('admin')?'<button class="btn ghost" type="submit" data-action="draft">Save Draft</button>':''}<button class="btn primary" type="submit" data-action="submit">Submit for Approval</button></div>
  </form>`);
  const recalc=()=>{
    let gross=0,exception=false;
    const selectedCustomer=state.customers.find(x=>x.id===$('#saleCustomer').value);
    const eligible=selectedCustomer?.complimentarySchemeEligible===true;
    if($('#customerSchemeNote')) $('#customerSchemeNote').textContent=selectedCustomer ? (eligible?'Customer is eligible for the standard complimentary scheme.':'Customer is not scheme-authorized; any free quantity will be treated as an exception for Marketing Director review.') : 'Select a customer to check complimentary scheme eligibility.';
    $('.sale-line').forEach(row=>{
      const p=state.products.find(x=>x.id===row.dataset.product), qty=Math.max(0,Math.floor(Number(row.querySelector('.line-qty').value||0))), free=Math.max(0,Math.floor(Number(row.querySelector('.line-free').value||0))), price=Math.max(0,Number(row.querySelector('.line-price').value||0));
      const limit=Number(p?.schemeBuy||0)>0?Math.floor(qty/Number(p.schemeBuy))*Number(p.schemeFree||0):0;
      if(free>0 && (!eligible || free>limit)) exception=true;
      const lt=qty*price; gross+=lt; row.querySelector('.line-total').textContent=money(lt);
    });
    const disc=Math.max(0,Number($('#saleDiscount').value||0)), total=Math.max(0,gross-disc); $('#saleGross').textContent=money(gross); $('#saleDiscountView').textContent=money(disc); $('#saleTotal').textContent=money(total); $('#salePaid').max=String(total);
    $('#freeExceptionNote').classList.toggle('hidden',!exception);
  };
  $('.line-qty,.line-free,.line-price').forEach(i=>i.oninput=recalc); $('#saleDiscount').oninput=recalc; $('#saleCustomer').onchange=recalc; recalc();
  $('#saleForm').onsubmit=saveSale;
}

async function saveSale(e){
  e.preventDefault();
  const action=e.submitter?.dataset.action||'submit';
  const status=(action==='draft' && can('admin'))?'draft':'pending_approval';
  const salesmanId=$('#saleSalesman').value, customerId=$('#saleCustomer').value;
  if(!salesmanId||!customerId) return toast('Select salesman and customer.',true);
  if(can('salesman') && salesmanId!==state.user.uid) return toast('Salesman mismatch.',true);
  const selectedCustomer=state.customers.find(x=>x.id===customerId);
  const customerSchemeEligible=selectedCustomer?.complimentarySchemeEligible===true;
  const items=[]; let exceptionalFree=false;
  $('.sale-line').forEach(row=>{
    const p=state.products.find(x=>x.id===row.dataset.product), paidQty=Math.max(0,Math.floor(Number(row.querySelector('.line-qty').value||0))), freeQty=Math.max(0,Math.floor(Number(row.querySelector('.line-free').value||0))), unitPrice=Math.max(0,Number(row.querySelector('.line-price').value||0));
    if(p && (paidQty>0||freeQty>0)){
      const schemeFreeLimit=Number(p.schemeBuy||0)>0?Math.floor(paidQty/Number(p.schemeBuy))*Number(p.schemeFree||0):0;
      const freeException=freeQty>0 && (!customerSchemeEligible || freeQty>schemeFreeLimit);
      if(freeException) exceptionalFree=true;
      items.push({productId:p.id,sku:p.sku||'',name:p.name,paidQty,freeQty,issuedQty:paidQty+freeQty,schemeFreeLimit,complimentaryCustomerEligible:customerSchemeEligible,complimentaryException:freeException,complimentaryAddedBy:freeQty>0?state.user.uid:null,complimentaryAddedByName:freeQty>0?(state.me?.fullName||''):null,unitPrice,lineTotal:paidQty*unitPrice,costPrice:Number(p.costPrice||0),mrp:Number(p.mrp||0)});
    }
  });
  if(!items.length) return toast('Enter at least one paid or complimentary quantity.',true);
  if(items.some(i=>i.issuedQty>Number(state.products.find(p=>p.id===i.productId)?.stockQty||0))) return toast('One or more lines exceed currently available stock.',true);
  const gross=items.reduce((a,i)=>a+i.lineTotal,0), discount=Math.max(0,Number($('#saleDiscount').value||0)), total=Math.max(0,gross-discount), proposedPaidAmount=Math.max(0,Number($('#salePaid').value||0));
  if(proposedPaidAmount>total+0.001) return toast('Proposed received amount cannot exceed invoice total.',true);
  const saleRef=doc(collection(db,'sales')), counterRef=doc(db,'counters','invoice'), customerRef=doc(db,'customers',customerId);
  try{
    const result=await runTransaction(db,async tx=>{
      const counterSnap=await tx.get(counterRef), customerSnap=await tx.get(customerRef);
      if(!customerSnap.exists()||customerSnap.data().active===false) throw new Error('Customer is inactive or missing.');
      let next=counterSnap.exists()?Number(counterSnap.data().next||1):1;
      const invoiceNo=`NG-${String(next).padStart(6,'0')}`, now=Timestamp.now(), customer=customerSnap.data(), saleTs=tsFromInput($('#saleDate').value);
      tx.set(counterRef,{next:next+1},{merge:true});
      const totalPaidUnits=items.reduce((a,i)=>a+Number(i.paidQty||0),0), totalFreeUnits=items.reduce((a,i)=>a+Number(i.freeQty||0),0), totalDeliveredUnits=totalPaidUnits+totalFreeUnits;
      tx.set(saleRef,{invoiceNo,saleDate:saleTs,customerId,salesmanId,items,subtotal:gross,discount,total,proposedPaidAmount,paymentMethod:$('#salePaymentMethod').value,paidAmount:0,paymentStatus:calcStatus(total,0),status,dispatchEligible:false,stockApplied:false,customerSchemeEligible,exceptionalFreeRequired:exceptionalFree,totalPaidUnits,totalFreeUnits,totalDeliveredUnits,notes:$('#saleNotes').value.trim()||'',dueDate:dueDateFor(customer,saleTs),createdBy:state.user.uid,creatorName:state.me?.fullName||'',createdAt:now,submittedAt:status==='pending_approval'?now:null,updatedAt:now});
      auditSet(tx,status==='draft'?'invoice_draft_created':'invoice_submitted','invoice',saleRef.id,{invoiceNo,total,customerId,salesmanId,exceptionalFree,totalPaidUnits,totalFreeUnits,totalDeliveredUnits});
      if(totalFreeUnits>0) auditSet(tx,'complimentary_qty_proposed','invoice',saleRef.id,{invoiceNo,customerId,salesmanId,totalFreeUnits,customerSchemeEligible,exceptionalFree,addedBy:state.user.uid});
      return {invoiceNo,status};
    });
    closeModal(); toast(result.status==='draft'?`Draft saved: ${result.invoiceNo}`:`Submitted for approval: ${result.invoiceNo}`);
  }catch(err){ console.error(err); toast(err.message||'Invoice could not be saved.',true); }
}

async function submitInvoice(id){
  const s=state.sales.find(x=>x.id===id); if(!s||invoiceStatus(s)!=='draft') return;
  if(can('salesman')&&s.createdBy!==state.user.uid) return toast('You can submit only your own draft.',true);
  const ref=doc(db,'sales',id);
  try{
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists()||invoiceStatus(snap.data())!=='draft') throw new Error('Draft is no longer available.');
      const now=Timestamp.now();
      tx.update(ref,{status:'pending_approval',submittedAt:now,updatedAt:now});
      auditSet(tx,'invoice_submitted','invoice',id,{invoiceNo:snap.data().invoiceNo});
    });
    closeModal(); toast('Invoice submitted for Marketing Director approval.');
  }catch(err){toast(err.message,true);}
}

async function approveInvoice(id){
  if(!canApproveInvoice()) return toast('Approval permission required.',true);
  const saleRef=doc(db,'sales',id), s0=state.sales.find(x=>x.id===id); if(!s0)return;
  const productRefs=(s0.items||[]).map(i=>doc(db,'products',i.productId)), customerRef=doc(db,'customers',s0.customerId);
  const fallbackBalance=customerOutstanding(s0.customerId);
  try{
    await runTransaction(db,async tx=>{
      const saleSnap=await tx.get(saleRef); if(!saleSnap.exists()) throw new Error('Invoice not found.');
      const s=saleSnap.data(); if(invoiceStatus(s)!=='pending_approval') throw new Error('Invoice is not pending approval.');
      if(s.createdBy===state.user.uid) throw new Error('Creator cannot approve the same invoice.');
      const customerSnap=await tx.get(customerRef); if(!customerSnap.exists()) throw new Error('Customer not found.');
      const productSnaps=[]; for(const ref of productRefs) productSnaps.push(await tx.get(ref));
      const now=Timestamp.now();
      productSnaps.forEach((snap,idx)=>{
        if(!snap.exists()) throw new Error(`Product not found: ${(s.items||[])[idx]?.name||''}`);
        const p=snap.data(), item=s.items[idx], need=Number(item.issuedQty||0), old=Number(p.stockQty||0);
        if(old<need) throw new Error(`${p.name}: only ${old} units available; ${need} required.`);
      });
      productSnaps.forEach((snap,idx)=>{
        const p=snap.data(), item=s.items[idx], need=Number(item.issuedQty||0), old=Number(p.stockQty||0), bal=old-need;
        tx.update(productRefs[idx],{stockQty:bal,updatedAt:now});
        const mref=doc(collection(db,'stockMovements'));
        tx.set(mref,{productId:item.productId,productName:item.name,movementType:'sale_approved',qtyChange:-need,paidQty:Number(item.paidQty||0),freeQty:Number(item.freeQty||0),balanceAfter:bal,refType:'sale',refId:id,notes:`Approved invoice ${s.invoiceNo}`,enteredBy:state.user.uid,createdAt:now});
      });
      const initialPaid=Math.min(Number(s.proposedPaidAmount||0),Number(s.total||0));
      const customer=customerSnap.data(), base=Number.isFinite(Number(customer.currentBalance))?Number(customer.currentBalance):fallbackBalance;
      tx.update(customerRef,{currentBalance:base+Number(s.total||0)-initialPaid,updatedAt:now});
      ledgerEntry(tx,{customerId:s.customerId,salesmanId:s.salesmanId,entryType:initialPaid>=Number(s.total||0)&&Number(s.total||0)>0?'cash_sale':'credit_sale',sourceType:'sale',sourceId:id,documentType:'invoice',documentId:id,documentNo:s.invoiceNo,invoiceNo:s.invoiceNo,transactionDate:s.saleDate,debit:Number(s.subtotal||s.total||0),credit:0,paymentStatus:calcStatus(s.total,initialPaid),dueDate:s.dueDate||dueDateFor(customer,s.saleDate),notes:'Approved sales invoice'});
      if(Number(s.discount||0)>0) ledgerEntry(tx,{customerId:s.customerId,salesmanId:s.salesmanId,entryType:'discount',sourceType:'sale_discount',sourceId:id,documentType:'invoice',documentId:id,documentNo:s.invoiceNo,invoiceNo:s.invoiceNo,transactionDate:s.saleDate,debit:0,credit:Number(s.discount),notes:'Approved invoice discount'});
      if(initialPaid>0){
        const pRef=doc(collection(db,'payments'));
        tx.set(pRef,{saleId:id,invoiceNo:s.invoiceNo,customerId:s.customerId,salesmanId:s.salesmanId,amount:initialPaid,method:s.paymentMethod||'cash',reference:'',notes:'Received with approved invoice',paymentDate:now,enteredBy:state.user.uid,createdAt:now,reversed:false});
        ledgerEntry(tx,{customerId:s.customerId,salesmanId:s.salesmanId,entryType:'payment_received',sourceType:'payment',sourceId:pRef.id,documentType:'receipt',documentId:pRef.id,documentNo:`RCPT-${s.invoiceNo}`,invoiceNo:s.invoiceNo,transactionDate:now,debit:0,credit:initialPaid,notes:'Payment received with invoice approval'});
      }
      tx.update(saleRef,{status:'approved',approvedBy:state.user.uid,approverName:state.me?.fullName||'',approvedAt:now,reviewedBy:state.user.uid,reviewedAt:now,exceptionalFreeApprovedBy:s.exceptionalFreeRequired?state.user.uid:null,stockApplied:true,dispatchEligible:true,paidAmount:initialPaid,paymentStatus:calcStatus(s.total,initialPaid),updatedAt:now});
      auditSet(tx,'invoice_approved','invoice',id,{invoiceNo:s.invoiceNo,total:s.total,exceptionalFreeApproved:Boolean(s.exceptionalFreeRequired),initialPaid});
    });
    closeModal(); toast('Invoice approved. Stock, ledger and dispatch are now active.');
  }catch(err){console.error(err);toast(err.message,true);}
}

function rejectInvoice(id){
  const s=state.sales.find(x=>x.id===id); if(!s||!canApproveInvoice())return;
  showModal(`Reject ${s.invoiceNo}`,`<form id="rejectInvoiceForm" class="stack"><label>Mandatory rejection reason<textarea id="rejectReason" required></textarea></label><button class="btn danger">Reject Invoice</button></form>`);
  $('#rejectInvoiceForm').onsubmit=async e=>{e.preventDefault();const reason=$('#rejectReason').value.trim();if(!reason)return;const ref=doc(db,'sales',id);try{await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists()||invoiceStatus(snap.data())!=='pending_approval')throw new Error('Invoice is no longer pending.');if(snap.data().createdBy===state.user.uid)throw new Error('Creator cannot review the same invoice.');const now=Timestamp.now();tx.update(ref,{status:'rejected',rejectionReason:reason,reviewedBy:state.user.uid,reviewerName:state.me?.fullName||'',reviewedAt:now,dispatchEligible:false,updatedAt:now});auditSet(tx,'invoice_rejected','invoice',id,{invoiceNo:snap.data().invoiceNo,reason});});closeModal();toast('Invoice rejected.');}catch(err){toast(err.message,true);}};
}

async function cancelInvoice(id,softDelete=false){
  const s0=state.sales.find(x=>x.id===id); if(!s0||!canControlInvoice())return;
  showModal(`${softDelete?'Archive/Delete':'Cancel'} ${s0.invoiceNo}`,`<form id="cancelInvoiceForm" class="stack"><label>Mandatory reason<textarea id="cancelReason" required></textarea></label><div class="danger-note">The record will remain in the audit trail. Approved invoices will have stock, ledger and payment effects reversed automatically.</div><button class="btn danger">${softDelete?'Archive Record':'Cancel Invoice'}</button></form>`);
  $('#cancelInvoiceForm').onsubmit=async e=>{
    e.preventDefault(); const reason=$('#cancelReason').value.trim(); if(!reason)return;
    const paymentSnap=await getDocs(query(collection(db,'payments'),where('saleId','==',id)));
    const payRefs=paymentSnap.docs.map(d=>doc(db,'payments',d.id)), payData=paymentSnap.docs.map(d=>({id:d.id,...d.data()}));
    const saleRef=doc(db,'sales',id), customerRef=doc(db,'customers',s0.customerId), productRefs=(s0.items||[]).map(i=>doc(db,'products',i.productId));
    const fallbackBalance=customerOutstanding(s0.customerId);
    try{
      await runTransaction(db,async tx=>{
        const saleSnap=await tx.get(saleRef); if(!saleSnap.exists())throw new Error('Invoice not found.');
        const s=saleSnap.data(), currentStatus=invoiceStatus(s); if(currentStatus==='cancelled')throw new Error('Invoice is already cancelled.');
        const approved=currentStatus==='approved' || (!s.status && s.stockApplied!==false);
        const customerSnap=await tx.get(customerRef);
        const productSnaps=[]; if(approved) for(const ref of productRefs) productSnaps.push(await tx.get(ref));
        const currentPaymentSnaps=[]; if(approved) for(const ref of payRefs) currentPaymentSnaps.push(await tx.get(ref));
        const now=Timestamp.now(); let reversedPayments=0;
        if(approved){
          productSnaps.forEach((snap,idx)=>{
            if(!snap.exists())return; const p=snap.data(),item=s.items[idx],add=Number(item.issuedQty||0),bal=Number(p.stockQty||0)+add;
            tx.update(productRefs[idx],{stockQty:bal,updatedAt:now});
            const mref=doc(collection(db,'stockMovements'));tx.set(mref,{productId:item.productId,productName:item.name,movementType:'invoice_cancel_reversal',qtyChange:add,paidQty:Number(item.paidQty||0),freeQty:Number(item.freeQty||0),balanceAfter:bal,refType:'sale',refId:id,notes:`Cancellation ${s.invoiceNo}: ${reason}`,enteredBy:state.user.uid,createdAt:now});
          });
          currentPaymentSnaps.forEach((snap,idx)=>{
            if(!snap.exists())return;
            const p=snap.data(); if(p.reversed===true)return;
            reversedPayments+=Number(p.amount||0);
            tx.update(payRefs[idx],{reversed:true,reversedBy:state.user.uid,reversedAt:now,reversalReason:reason});
            ledgerEntry(tx,{customerId:s.customerId,salesmanId:s.salesmanId,entryType:'payment_reversal',sourceType:'payment_reversal',sourceId:payData[idx].id,documentType:'receipt_reversal',documentId:payData[idx].id,documentNo:`REV-${p.invoiceNo||s.invoiceNo}`,invoiceNo:s.invoiceNo,transactionDate:now,debit:Number(p.amount||0),credit:0,notes:`Payment reversed due to invoice cancellation: ${reason}`});
          });
          ledgerEntry(tx,{customerId:s.customerId,salesmanId:s.salesmanId,entryType:'invoice_cancel_reversal',sourceType:'sale_cancel',sourceId:id,documentType:'invoice_cancellation',documentId:id,documentNo:s.invoiceNo,invoiceNo:s.invoiceNo,transactionDate:now,debit:Number(s.discount||0),credit:Number(s.subtotal||s.total||0),notes:`Invoice cancelled: ${reason}`});
          if(customerSnap.exists()){const cur=customerSnap.data(),base=Number.isFinite(Number(cur.currentBalance))?Number(cur.currentBalance):fallbackBalance;tx.update(customerRef,{currentBalance:base-Number(s.total||0)+reversedPayments,updatedAt:now});}
        }
        tx.update(saleRef,{status:'cancelled',cancelledBy:state.user.uid,cancelledByName:state.me?.fullName||'',cancelledAt:now,cancellationReason:reason,softDeleted:Boolean(softDelete),dispatchEligible:false,stockApplied:false,reversedPaidAmount:reversedPayments,paidAmount:0,paymentStatus:'cancelled',updatedAt:now});
        auditSet(tx,softDelete?'invoice_soft_deleted':'invoice_cancelled','invoice',id,{invoiceNo:s.invoiceNo,reason,previousStatus:currentStatus,reversedPayments});
      });
      closeModal();toast(softDelete?'Invoice archived; audit history preserved.':'Invoice cancelled and impacts reversed.');
    }catch(err){console.error(err);toast(err.message,true);}
  };
}

function openInvoice(id){
  const s=state.sales.find(x=>x.id===id); if(!s) return;
  const cust=state.customers.find(x=>x.id===s.customerId), settings=state.settings||{}, st=invoiceStatus(s), approved=st==='approved';
  const freeException=(s.items||[]).some(i=>Number(i.freeQty||0)>Number(i.schemeFreeLimit||0));
  showModal(`Invoice ${s.invoiceNo}`,`<div class="invoice-status-line">${statusBadge(s)} ${badgeStatus(s.paymentStatus)}${freeException?'<span class="badge warn">Free Qty Exception</span>':''}</div>${st!=='approved'?'<div class="approval-note">This invoice is not final. Printing and dispatch remain locked until Marketing Director approval.</div>':''}<div class="invoice" id="invoicePrintable"><div class="invoice-brand"><img src="assets/naturegen.logo.png" alt="Naturegen Laboratory"><div><h2>${esc(settings.companyName||'Naturegen Distribution')}</h2><p>Distribution ERP</p><p>${esc(settings.address||'')}</p><p>${esc(settings.phone||'')}</p></div></div><hr><div class="two-col"><div><b>Invoice:</b> ${esc(s.invoiceNo)}<br><b>Date:</b> ${date(s.saleDate)}<br><b>Salesman:</b> ${esc(profileName(s.salesmanId))}<br><b>Created by:</b> ${esc(s.creatorName||profileName(s.createdBy))}<br><b>Created:</b> ${dt(s.createdAt)}</div><div><b>Customer:</b> ${esc(cust?.shopName||'—')}<br><b>Code:</b> ${esc(cust?.customerCode||'—')}<br>${esc(cust?.address||'')}<br>${esc(cust?.phone||'')}${s.approvedAt?`<br><b>Approved by:</b> ${esc(s.approverName||profileName(s.approvedBy))}<br><b>Approved:</b> ${dt(s.approvedAt)}`:''}</div></div><table><thead><tr><th>Product</th><th>Paid Qty</th><th>Complimentary/Free</th><th>Total Delivered</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${(s.items||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${fmt(i.paidQty)}</td><td>${fmt(i.freeQty)}</td><td>${fmt(Number(i.paidQty||0)+Number(i.freeQty||0))}</td><td>${money(i.unitPrice)}</td><td>${money(i.lineTotal)}</td></tr>`).join('')}</tbody></table><p class="right"><b>Subtotal:</b> ${money(s.subtotal)}<br><b>Discount:</b> ${money(s.discount)}<br><b>Total:</b> ${money(s.total)}<br><b>Paid:</b> ${money(s.paidAmount)}<br><b>Balance:</b> ${money(Math.max(0,Number(s.total)-Number(s.paidAmount)))}</p>${s.cancellationReason?`<div class="danger-note"><b>Cancellation reason:</b> ${esc(s.cancellationReason)}</div>`:''}</div><div class="actions">${approved?'<button id="printInvoiceBtn" class="btn primary">Print Invoice</button>':''}${st==='draft'&&(can('admin')||s.createdBy===state.user.uid)?'<button id="submitInvoiceBtn" class="btn primary">Submit for Approval</button>':''}${st==='pending_approval'&&canApproveInvoice()&&s.createdBy!==state.user.uid?'<button id="approveInvoiceBtn" class="btn primary">Approve</button><button id="rejectInvoiceBtn" class="btn danger">Reject</button>':''}${approved&&can('admin','recovery')&&Number(s.paidAmount)<Number(s.total)?'<button id="invoiceRecoverBtn" class="btn ghost">Receive Payment</button>':''}${canControlInvoice()&&st!=='cancelled'?`<button id="cancelInvoiceBtn" class="btn danger">${['draft','rejected'].includes(st)?'Archive/Delete':'Cancel Invoice'}</button>`:''}</div>`);
  if($('#printInvoiceBtn')) $('#printInvoiceBtn').onclick=()=>printInvoiceHtml($('#invoicePrintable').innerHTML);
  if($('#submitInvoiceBtn')) $('#submitInvoiceBtn').onclick=()=>submitInvoice(id);
  if($('#approveInvoiceBtn')) $('#approveInvoiceBtn').onclick=()=>approveInvoice(id);
  if($('#rejectInvoiceBtn')) $('#rejectInvoiceBtn').onclick=()=>rejectInvoice(id);
  if($('#invoiceRecoverBtn')) $('#invoiceRecoverBtn').onclick=()=>openRecoveryForm(id);
  if($('#cancelInvoiceBtn')) $('#cancelInvoiceBtn').onclick=()=>cancelInvoice(id,['draft','rejected'].includes(st));
}
function printInvoiceHtml(html){ const w=window.open('','_blank','width=900,height=750'); if(!w)return toast('Allow popups to print invoices.',true); w.document.write(`<html><head><title>Invoice</title><base href="${window.location.href}"><style>body{font-family:Arial;padding:28px;color:#111}.invoice-brand{display:flex;align-items:center;gap:16px;margin-bottom:12px}.invoice-brand img{width:105px;height:76px;object-fit:contain}.invoice-brand h2{color:#176b34;margin:0 0 4px}.invoice-brand p{margin:2px 0;color:#566c61}hr{border:0;border-top:2px solid #dcebd9;margin:14px 0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eef7eb;color:#214b31}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}.right{text-align:right}</style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close(); }

function renderCustomers(){
  const rows=state.customers;
  $('#customersPage').innerHTML=`<div class="section-head"><div><h3>Customers / Pharmacies</h3><div class="muted">${rows.length} accessible customer(s)</div></div>${can('admin','salesman','erp_manager')?'<button id="addCustomerBtn" class="btn primary">+ Add Customer</button>':''}</div><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Customer / Pharmacy</th><th>Contact</th><th>Phone</th><th>Territory</th><th>Salesman</th><th>Credit Limit</th><th>Days</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.customerCode||'—')}</td><td><b>${esc(c.shopName||c.customerName||'')}</b><div class="metric-note">${esc(c.customerName||'')}</div></td><td>${esc(c.ownerName||'')}</td><td>${esc(c.phone||'')}</td><td>${esc(c.territory||c.routeArea||'')}</td><td>${esc(profileName(c.assignedSalesmanId))}</td><td>${money(c.creditLimit)}</td><td>${fmt(c.creditDays)}</td><td><b>${money(Number(c.currentBalance||0))}</b></td><td><span class="badge status-${c.active===false?'inactive':'active'}">${c.active===false?'Inactive':'Active'}</span></td><td><div class="actions">${(canManageCustomers()||c.assignedSalesmanId===state.user.uid)?`<button class="btn ghost small" data-customer="${c.id}">Edit</button>`:''}${canDeactivateCustomer()&&c.active!==false?`<button class="btn danger small" data-deactivate-customer="${c.id}">Deactivate</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="11" class="empty">No customers yet.</td></tr>'}</tbody></table></div>`;
  if($('#addCustomerBtn')) $('#addCustomerBtn').onclick=()=>openCustomerForm();
  $$('[data-customer]').forEach(b=>b.onclick=()=>openCustomerForm(b.dataset.customer));
  $$('[data-deactivate-customer]').forEach(b=>b.onclick=()=>deactivateCustomer(b.dataset.deactivateCustomer));
}

function openCustomerForm(id=null){
  const existing=id?state.customers.find(x=>x.id===id):null;
  const reps=state.users.filter(u=>u.role==='salesman'&&u.active!==false);
  const management=canManageCustomers(), assigned=existing?.assignedSalesmanId || (can('salesman')?state.user.uid:'');
  const salesmanField=management?`<label>Assigned Salesman<select id="cSalesman" required><option value="">Select</option>${reps.map(r=>`<option value="${r.id}" ${assigned===r.id?'selected':''}>${esc(r.fullName)}</option>`).join('')}</select></label>`:`<input id="cSalesman" type="hidden" value="${esc(assigned||state.user.uid)}">`;
  const readonlySalesmanEdit=existing&&can('salesman');
  showModal(existing?'Edit Customer':'Add Customer',`<form id="customerForm" class="form-grid"><label>Customer / Contact Name<input id="cName" ${readonlySalesmanEdit?'disabled':''} value="${esc(existing?.customerName||'')}"></label><label>Business / Pharmacy Name<input id="cShop" required ${readonlySalesmanEdit?'disabled':''} value="${esc(existing?.shopName||'')}"></label><label>Phone<input id="cPhone" ${readonlySalesmanEdit?'disabled':''} value="${esc(existing?.phone||'')}"></label><label>Territory / Route<input id="cTerritory" value="${esc(existing?.territory||existing?.routeArea||state.me?.routeArea||'')}"></label>${salesmanField}<label>Credit Limit<input id="cCreditLimit" type="number" min="0" step="0.01" ${readonlySalesmanEdit?'disabled':''} value="${Number(existing?.creditLimit||0)}"></label><label>Credit Days<input id="cCreditDays" type="number" min="0" step="1" ${readonlySalesmanEdit?'disabled':''} value="${Number(existing?.creditDays||0)}"></label><label>NTN / CNIC<input id="cTaxId" ${readonlySalesmanEdit?'disabled':''} value="${esc(existing?.ntnCnic||'')}"></label>${existing?'':`<label>Opening Balance<input id="cOpening" type="number" step="0.01" value="0"></label>`}<label class="full">Address<textarea id="cAddress">${esc(existing?.address||'')}</textarea></label><div class="full help">Duplicate checks use customer name, phone and business/pharmacy name. Customer code is generated automatically.</div><div class="full"><button class="btn primary">Save Customer</button></div></form>`);
  $('#customerForm').onsubmit=async e=>{
    e.preventDefault();
    const assignedSalesmanId=$('#cSalesman').value; if(!assignedSalesmanId)return toast('Select salesman.',true);
    try{
      if(existing){
        const data=can('salesman')?{territory:$('#cTerritory').value.trim(),routeArea:$('#cTerritory').value.trim(),address:$('#cAddress').value.trim(),creditLimit:Number(existing.creditLimit||0),creditDays:Number(existing.creditDays||0),updatedAt:serverTimestamp()}:{customerName:$('#cName').value.trim(),shopName:$('#cShop').value.trim(),ownerName:$('#cName').value.trim(),phone:$('#cPhone').value.trim(),territory:$('#cTerritory').value.trim(),routeArea:$('#cTerritory').value.trim(),assignedSalesmanId,creditLimit:Number($('#cCreditLimit').value||0),creditDays:Number($('#cCreditDays').value||0),ntnCnic:$('#cTaxId').value.trim(),address:$('#cAddress').value.trim(),updatedAt:serverTimestamp()};
        await updateDoc(doc(db,'customers',existing.id),data); await writeAudit('customer_updated','customer',existing.id,{customerCode:existing.customerCode||'',fields:can('salesman')?['territory','address']:['profile']}); closeModal(); toast('Customer updated.'); return;
      }
      const customerName=$('#cName').value.trim(), shopName=$('#cShop').value.trim(), phone=$('#cPhone').value.trim(), customerRef=doc(collection(db,'customers')), counterRef=doc(db,'counters','customer');
      const indexRefs=[customerName?doc(db,'customerIndex',idxId('name',customerName)):null,shopName?doc(db,'customerIndex',idxId('shop',shopName)):null,phone?doc(db,'customerIndex',idxId('phone',phone)):null].filter(Boolean);
      await runTransaction(db,async tx=>{
        const counterSnap=await tx.get(counterRef); const idxSnaps=[]; for(const ref of indexRefs)idxSnaps.push(await tx.get(ref)); if(idxSnaps.some(s=>s.exists()))throw new Error('Possible duplicate customer found by name, phone or business details.');
        const next=counterSnap.exists()?Number(counterSnap.data().next||1):1, customerCode=`CUST-${String(next).padStart(6,'0')}`, openingBalance=Number($('#cOpening').value||0), now=Timestamp.now();
        tx.set(counterRef,{next:next+1},{merge:true});
        tx.set(customerRef,{customerCode,customerName,shopName,ownerName:customerName,phone,territory:$('#cTerritory').value.trim(),routeArea:$('#cTerritory').value.trim(),assignedSalesmanId,creditLimit:Number($('#cCreditLimit').value||0),creditDays:Number($('#cCreditDays').value||0),ntnCnic:$('#cTaxId').value.trim(),openingBalance,currentBalance:openingBalance,address:$('#cAddress').value.trim(),active:true,createdBy:state.user.uid,createdAt:now,updatedAt:now});
        indexRefs.forEach(ref=>tx.set(ref,{customerId:customerRef.id,createdBy:state.user.uid,createdAt:now}));
        if(openingBalance!==0) ledgerEntry(tx,{customerId:customerRef.id,salesmanId:assignedSalesmanId,entryType:'opening_balance',sourceType:'customer',sourceId:customerRef.id,documentType:'opening',documentId:customerRef.id,documentNo:customerCode,transactionDate:now,debit:openingBalance>0?openingBalance:0,credit:openingBalance<0?-openingBalance:0,notes:'Opening balance'});
        auditSet(tx,'customer_created','customer',customerRef.id,{customerCode,shopName,openingBalance});
      });
      closeModal();toast('Customer created.');
    }catch(err){toast(err.message,true);}
  };
}

function deactivateCustomer(id){
  if(!canDeactivateCustomer())return;
  const cust=state.customers.find(c=>c.id===id); if(!cust)return;
  showModal(`Deactivate ${cust.shopName||cust.customerCode}`,`<form id="deactivateCustomerForm" class="stack"><label>Mandatory reason<textarea id="customerDeactivateReason" required></textarea></label><div class="approval-note">Records with invoices, payments, balances or ledger history are preserved and only marked Inactive.</div><button class="btn danger">Deactivate Customer</button></form>`);
  $('#deactivateCustomerForm').onsubmit=async e=>{e.preventDefault();const reason=$('#customerDeactivateReason').value.trim();if(!reason)return;const ref=doc(db,'customers',id);try{await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error('Customer not found.');const now=Timestamp.now();tx.update(ref,{active:false,deactivatedBy:state.user.uid,deactivatedByName:state.me?.fullName||'',deactivatedAt:now,deactivationReason:reason,updatedAt:now});auditSet(tx,'customer_deactivated','customer',id,{customerCode:snap.data().customerCode||'',reason});});closeModal();toast('Customer marked inactive.');}catch(err){toast(err.message,true);}};
}

function renderLedger(){
  const visibleCustomers=state.customers;
  const selected=$('#ledgerCustomerFilter')?.value || visibleCustomers[0]?.id || '';
  const customer=visibleCustomers.find(c=>c.id===selected);
  if(!customer){$('#ledgerPage').innerHTML='<div class="empty">No accessible customers for ledger.</div>';return;}
  const raw=ledgerRowsForCustomer(selected); let running=0;
  const start=$('#ledgerStart')?.value||'', end=$('#ledgerEnd')?.value||'', invoice=$('#ledgerInvoice')?.value?.trim().toLowerCase()||'', pstatus=$('#ledgerPaymentStatus')?.value||'';
  const rows=raw.filter(r=>{const d=asDate(r.transactionDate),iso=d?d.toISOString().slice(0,10):'';return(!start||iso>=start)&&(!end||iso<=end)&&(!invoice||String(r.invoiceNo||r.documentNo||'').toLowerCase().includes(invoice))&&(!pstatus||String(r.paymentStatus||'')===pstatus);});
  const computed=rows.map(r=>{running+=Number(r.debit||0)-Number(r.credit||0);return{...r,running};});
  const totalSales=raw.filter(r=>['credit_sale','cash_sale'].includes(r.entryType)).reduce((a,r)=>a+Number(r.debit||0)-Number(r.credit||0),0), recovery=raw.filter(r=>r.entryType==='payment_received').reduce((a,r)=>a+Number(r.credit||0),0), outstanding=raw.reduce((a,r)=>a+Number(r.debit||0)-Number(r.credit||0),0), overdue=approvedSales().filter(s=>s.customerId===selected&&asDate(s.dueDate)&&asDate(s.dueDate)<new Date()&&Number(s.total||0)>Number(s.paidAmount||0)).reduce((a,s)=>a+Number(s.total||0)-Number(s.paidAmount||0),0);
  $('#ledgerPage').innerHTML=`<div class="section-head"><div><h3>Customer-Wise Ledger</h3><div class="muted">Automatically updated from approved invoices, payments and controlled adjustments.</div></div><div class="actions"><button id="printLedgerBtn" class="btn ghost">Print Statement</button><button id="downloadLedgerBtn" class="btn ghost">Download CSV</button>${canManageCustomers()?'<button id="ledgerAdjustBtn" class="btn primary">+ Adjustment / Note</button>':''}</div></div><div class="filter-grid"><label>Customer<select id="ledgerCustomerFilter">${visibleCustomers.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.customerCode||'')} ${esc(c.shopName||c.customerName||'')}</option>`).join('')}</select></label><label>From<input id="ledgerStart" type="date" value="${esc(start)}"></label><label>To<input id="ledgerEnd" type="date" value="${esc(end)}"></label><label>Invoice #<input id="ledgerInvoice" value="${esc(invoice)}"></label><label>Payment Status<select id="ledgerPaymentStatus"><option value="">All</option><option value="unpaid" ${pstatus==='unpaid'?'selected':''}>Unpaid</option><option value="partial" ${pstatus==='partial'?'selected':''}>Partial</option><option value="paid" ${pstatus==='paid'?'selected':''}>Paid</option></select></label></div><div class="metric-grid"><div class="metric-box"><small>Total Sales</small><strong>${money(totalSales)}</strong></div><div class="metric-box"><small>Total Recovery</small><strong>${money(recovery)}</strong></div><div class="metric-box"><small>Outstanding</small><strong>${money(outstanding)}</strong></div><div class="metric-box"><small>Overdue</small><strong>${money(overdue)}</strong></div></div><div class="card"><b>${esc(customer.customerCode||'')} — ${esc(customer.shopName||customer.customerName||'')}</b><div class="metric-note">Opening ${money(customer.openingBalance||0)} • Credit limit ${money(customer.creditLimit||0)} • Credit days ${fmt(customer.creditDays)}</div></div><div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Invoice</th><th>Debit</th><th>Credit</th><th>Running Balance</th><th>Due</th><th>Notes</th></tr></thead><tbody>${computed.map(r=>`<tr><td>${date(r.transactionDate)}</td><td>${esc(String(r.entryType||'').replaceAll('_',' '))}</td><td>${r.sourceType==='sale'?`<button class="btn link small" data-ledger-invoice="${r.sourceId}">${esc(r.documentNo||'')}</button>`:esc(r.documentNo||'')}</td><td>${esc(r.invoiceNo||'')}</td><td class="ledger-positive">${Number(r.debit||0)?money(r.debit):''}</td><td class="ledger-negative">${Number(r.credit||0)?money(r.credit):''}</td><td class="ledger-balance">${money(r.running)}</td><td>${date(r.dueDate)}</td><td>${esc(r.notes||'')}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">No ledger entries in this filter.</td></tr>'}</tbody></table></div>`;
  const rerender=()=>renderLedger(); $('#ledgerCustomerFilter').onchange=rerender; $('#ledgerStart').onchange=rerender; $('#ledgerEnd').onchange=rerender; $('#ledgerInvoice').oninput=rerender; $('#ledgerPaymentStatus').onchange=rerender; $$('[data-ledger-invoice]').forEach(b=>b.onclick=()=>openInvoice(b.dataset.ledgerInvoice));
  $('#printLedgerBtn').onclick=()=>printCustomerStatement(customer,computed,outstanding); $('#downloadLedgerBtn').onclick=()=>downloadLedgerCsv(customer,computed); if($('#ledgerAdjustBtn'))$('#ledgerAdjustBtn').onclick=()=>openLedgerAdjustment(customer.id);
}

function printCustomerStatement(customer,rows,balance){
  const body=`<h2>Naturegen Distribution — Customer Statement</h2><p><b>${esc(customer.customerCode||'')}</b> ${esc(customer.shopName||customer.customerName||'')}</p><p>${esc(customer.address||'')} ${esc(customer.phone||'')}</p><table><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${date(r.transactionDate)}</td><td>${esc(r.entryType)}</td><td>${esc(r.documentNo||'')}</td><td>${money(r.debit||0)}</td><td>${money(r.credit||0)}</td><td>${money(r.running)}</td></tr>`).join('')}</tbody></table><h3>Closing Balance: ${money(balance)}</h3>`; const w=window.open('','_blank','width=1000,height=760');if(!w)return toast('Allow popups to print statements.',true);w.document.write(`<html><head><title>Customer Statement</title><style>body{font-family:Arial;padding:28px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:7px}</style></head><body>${body}<script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
}
function downloadLedgerCsv(customer,rows){const data=[['Date','Type','Document','Invoice','Debit','Credit','Running Balance','Due','Notes'],...rows.map(r=>[date(r.transactionDate),r.entryType,r.documentNo||'',r.invoiceNo||'',r.debit||0,r.credit||0,r.running,date(r.dueDate),r.notes||''])];const csv=data.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');downloadBlob(csv,`${customer.customerCode||'customer'}-ledger-${todayISO()}.csv`,'text/csv');}
function openLedgerAdjustment(customerId){
  const cust=state.customers.find(c=>c.id===customerId);if(!cust||!canManageCustomers())return;
  showModal('Ledger Adjustment / Note',`<form id="ledgerAdjustmentForm" class="form-grid"><label>Type<select id="laType"><option value="debit_note">Debit Note</option><option value="credit_note">Credit Note</option><option value="sales_return">Sales Return</option><option value="approved_adjustment_debit">Approved Adjustment +</option><option value="approved_adjustment_credit">Approved Adjustment -</option></select></label><label>Date<input id="laDate" type="date" value="${todayISO()}"></label><label>Amount<input id="laAmount" type="number" min="0.01" step="0.01" required></label><label>Reference / Document<input id="laDoc" required></label><label class="full">Reason / Notes<textarea id="laNotes" required></textarea></label><div class="full"><button class="btn primary">Post Approved Entry</button></div></form>`);
  $('#ledgerAdjustmentForm').onsubmit=async e=>{e.preventDefault();const amount=Number($('#laAmount').value||0),type=$('#laType').value,credit=['credit_note','sales_return','approved_adjustment_credit'].includes(type),ref=doc(db,'customers',customerId);if(amount<=0)return;try{await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error('Customer not found.');const cur=snap.data(),base=Number.isFinite(Number(cur.currentBalance))?Number(cur.currentBalance):customerOutstanding(customerId),delta=credit?-amount:amount,now=Timestamp.now();tx.update(ref,{currentBalance:base+delta,updatedAt:now});ledgerEntry(tx,{customerId,salesmanId:cur.assignedSalesmanId||'',entryType:type,sourceType:'adjustment',sourceId:'',documentType:type,documentId:'',documentNo:$('#laDoc').value.trim(),transactionDate:tsFromInput($('#laDate').value),debit:credit?0:amount,credit:credit?amount:0,status:'approved',approvedBy:state.user.uid,approvedAt:now,notes:$('#laNotes').value.trim()});auditSet(tx,'ledger_adjustment_posted','customer',customerId,{type,amount,documentNo:$('#laDoc').value.trim(),notes:$('#laNotes').value.trim()});});closeModal();toast('Ledger entry posted.');}catch(err){toast(err.message,true);}};
}

function renderInventory(){
  if(!can('admin','erp_manager','inventory')) return;
  $('#inventoryPage').innerHTML=`<div class="section-head"><div><h3>Inventory</h3><div class="muted">Live stock shared across all users</div></div><button id="stockAdjustBtn" class="btn primary">+ Stock Movement</button></div><div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Low Alert</th><th>MRP</th><th>Sale Price</th><th>Scheme</th><th></th></tr></thead><tbody>${state.products.map(p=>`<tr><td>${esc(p.sku||'')}</td><td><b>${esc(p.name)}</b></td><td>${fmt(p.stockQty)}</td><td>${fmt(p.lowStockThreshold)}</td><td>${money(p.mrp)}</td><td>${money(p.salePrice)}</td><td>${fmt(p.schemeBuy)}+${fmt(p.schemeFree)}</td><td>${can('admin','erp_manager')?`<button class="btn ghost small" data-product-edit="${p.id}">Edit</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No products. Admin can initialize default data in Settings.</td></tr>'}</tbody></table></div><div class="section-head"><h3>Recent Stock Movements</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty Change</th><th>Balance</th><th>Notes</th></tr></thead><tbody>${state.movements.slice(0,100).map(m=>`<tr><td>${dt(m.createdAt)}</td><td>${esc(m.productName||productName(m.productId))}</td><td>${esc(m.movementType)}</td><td>${fmt(m.qtyChange)}</td><td>${fmt(m.balanceAfter)}</td><td>${esc(m.notes||'')}</td></tr>`).join('')}</tbody></table></div>`;
  $('#stockAdjustBtn').onclick=openStockForm; $$('[data-product-edit]').forEach(b=>b.onclick=()=>openProductForm(b.dataset.productEdit));
}
function openStockForm(){
  showModal('Stock Movement',`<form id="stockForm" class="form-grid"><label>Product<select id="stProduct" required><option value="">Select</option>${activeProducts().map(p=>`<option value="${p.id}">${esc(p.name)} — Stock ${fmt(p.stockQty)}</option>`).join('')}</select></label><label>Type<select id="stType"><option value="production_received">Production Received</option><option value="purchase_received">Purchase Received</option><option value="sales_return">Sales Return</option><option value="damage">Damage / Breakage</option><option value="adjustment_plus">Adjustment +</option><option value="adjustment_minus">Adjustment -</option></select></label><label>Quantity<input id="stQty" type="number" min="1" step="1" required></label><label class="full">Notes<textarea id="stNotes"></textarea></label><div class="full"><button class="btn primary">Save Movement</button></div></form>`);
  $('#stockForm').onsubmit=async e=>{e.preventDefault();const productId=$('#stProduct').value,type=$('#stType').value,qty=Math.floor(Number($('#stQty').value||0));if(!productId||qty<=0)return;const negative=['damage','adjustment_minus'].includes(type),delta=negative?-qty:qty,pRef=doc(db,'products',productId),mRef=doc(collection(db,'stockMovements'));try{await runTransaction(db,async tx=>{const ps=await tx.get(pRef);if(!ps.exists())throw new Error('Product not found.');const p=ps.data(),old=Number(p.stockQty||0),bal=old+delta;if(bal<0)throw new Error(`Only ${old} units available.`);tx.update(pRef,{stockQty:bal,updatedAt:Timestamp.now()});tx.set(mRef,{productId,productName:p.name,movementType:type,qtyChange:delta,balanceAfter:bal,refType:'manual',refId:'',notes:$('#stNotes').value.trim(),enteredBy:state.user.uid,createdAt:Timestamp.now()});});closeModal();toast('Stock updated.');}catch(err){toast(err.message,true);}};
}
function openProductForm(id){
  const p=state.products.find(x=>x.id===id); if(!p)return;
  showModal('Edit Product',`<form id="productForm" class="form-grid"><label>SKU<input id="pSku" value="${esc(p.sku||'')}"></label><label>Name<input id="pName" required value="${esc(p.name)}"></label><label>MRP<input id="pMrp" type="number" min="0" step="0.01" value="${p.mrp||0}"></label><label>Sale Price<input id="pSale" type="number" min="0" step="0.01" value="${p.salePrice||0}"></label><label>Cost Price<input id="pCost" type="number" min="0" step="0.01" value="${p.costPrice||0}"></label><label>Low Stock Alert<input id="pLow" type="number" min="0" step="1" value="${p.lowStockThreshold||0}"></label><label>Scheme Buy<input id="pBuy" type="number" min="0" step="1" value="${p.schemeBuy||0}"></label><label>Scheme Free<input id="pFree" type="number" min="0" step="1" value="${p.schemeFree||0}"></label><label>Active<select id="pActive"><option value="true" ${p.active!==false?'selected':''}>Yes</option><option value="false" ${p.active===false?'selected':''}>No</option></select></label><div class="full"><button class="btn primary">Save Product</button></div></form>`);
  $('#productForm').onsubmit=async e=>{e.preventDefault();try{await updateDoc(doc(db,'products',id),{sku:$('#pSku').value.trim(),name:$('#pName').value.trim(),mrp:Number($('#pMrp').value||0),salePrice:Number($('#pSale').value||0),costPrice:Number($('#pCost').value||0),lowStockThreshold:Number($('#pLow').value||0),schemeBuy:Number($('#pBuy').value||0),schemeFree:Number($('#pFree').value||0),active:$('#pActive').value==='true',updatedAt:serverTimestamp()});closeModal();toast('Product updated.');}catch(err){toast(err.message,true);}};
}

function renderRecovery(){
  const rows=approvedSales().filter(s=>Number(s.paidAmount||0)<Number(s.total||0));
  const canReceive=can('admin','recovery');
  $('#recoveryPage').innerHTML=`<div class="section-head"><div><h3>Recovery / Outstanding</h3><div class="muted">Only approved invoices are eligible for recovery.</div></div></div><div class="metric-grid"><div class="metric-box"><small>Approved Outstanding</small><strong>${money(rows.reduce((a,s)=>a+Number(s.total||0)-Number(s.paidAmount||0),0))}</strong></div><div class="metric-box"><small>Open Invoices</small><strong>${rows.length}</strong></div><div class="metric-box"><small>Payments Loaded</small><strong>${state.payments.filter(p=>p.reversed!==true).length}</strong></div><div class="metric-box"><small>Role</small><strong>${esc(role().replaceAll('_',' '))}</strong></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Customer</th><th>Salesman</th><th>Due Date</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><button class="btn link small" data-invoice="${s.id}">${esc(s.invoiceNo)}</button></td><td>${esc(customerName(s.customerId))}</td><td>${esc(profileName(s.salesmanId))}</td><td>${date(s.dueDate)}</td><td>${money(s.total)}</td><td>${money(s.paidAmount)}</td><td><b>${money(Number(s.total)-Number(s.paidAmount))}</b></td><td>${canReceive?`<button class="btn primary small" data-recover="${s.id}">Receive</button>`:'View only'}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No approved outstanding invoices.</td></tr>'}</tbody></table></div><div class="section-head"><h3>Recent Payments</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead><tbody>${state.payments.slice(0,100).map(p=>`<tr><td>${dt(p.paymentDate)}</td><td>${esc(p.invoiceNo||'')}</td><td>${esc(customerName(p.customerId))}</td><td>${money(p.amount)}</td><td>${esc(p.method||'')}</td><td>${esc(p.reference||'')}</td><td>${p.reversed===true?'<span class="badge status-cancelled">Reversed</span>':'<span class="badge status-approved">Posted</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-invoice]').forEach(b=>b.onclick=()=>openInvoice(b.dataset.invoice)); $$('[data-recover]').forEach(b=>b.onclick=()=>openRecoveryForm(b.dataset.recover));
}
function openRecoveryForm(saleId){
  if(!can('admin','recovery'))return toast('Recovery entry permission required.',true);
  const s=state.sales.find(x=>x.id===saleId); if(!s||invoiceStatus(s)!=='approved')return toast('Only approved invoices can receive payment.',true);
  const balance=Number(s.total||0)-Number(s.paidAmount||0);
  showModal(`Receive Payment — ${s.invoiceNo}`,`<form id="recoveryForm" class="form-grid"><label>Balance<input value="${balance}" disabled></label><label>Amount<input id="rAmount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance}" required></label><label>Method<select id="rMethod"><option value="cash">Cash</option><option value="bank">Bank</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option><option value="cheque">Cheque</option></select></label><label>Reference<input id="rRef"></label><label class="full">Notes<textarea id="rNotes"></textarea></label><div class="full"><button class="btn primary">Save Recovery</button></div></form>`);
  $('#recoveryForm').onsubmit=async e=>{e.preventDefault();const amt=Number($('#rAmount').value||0);if(amt<=0||amt>balance+0.001)return toast('Invalid amount.',true);const sRef=doc(db,'sales',saleId),pRef=doc(collection(db,'payments')),cRef=doc(db,'customers',s.customerId);try{await runTransaction(db,async tx=>{const saleSnap=await tx.get(sRef),custSnap=await tx.get(cRef);if(!saleSnap.exists()||invoiceStatus(saleSnap.data())!=='approved')throw new Error('Invoice is not approved.');if(!custSnap.exists())throw new Error('Customer not found.');const cur=saleSnap.data(),newPaid=Number(cur.paidAmount||0)+amt;if(newPaid>Number(cur.total||0)+0.001)throw new Error('Payment exceeds current balance.');const now=Timestamp.now(),cust=custSnap.data(),base=Number.isFinite(Number(cust.currentBalance))?Number(cust.currentBalance):customerOutstanding(s.customerId);tx.update(sRef,{paidAmount:newPaid,paymentStatus:calcStatus(cur.total,newPaid),updatedAt:now});tx.update(cRef,{currentBalance:base-amt,updatedAt:now});tx.set(pRef,{saleId,invoiceNo:cur.invoiceNo,customerId:cur.customerId,salesmanId:cur.salesmanId,amount:amt,method:$('#rMethod').value,reference:$('#rRef').value.trim(),notes:$('#rNotes').value.trim(),paymentDate:now,enteredBy:state.user.uid,enteredByName:state.me?.fullName||'',createdAt:now,reversed:false});ledgerEntry(tx,{customerId:cur.customerId,salesmanId:cur.salesmanId,entryType:'payment_received',sourceType:'payment',sourceId:pRef.id,documentType:'receipt',documentId:pRef.id,documentNo:`RCPT-${cur.invoiceNo}-${pRef.id.slice(0,5)}`,invoiceNo:cur.invoiceNo,transactionDate:now,debit:0,credit:amt,notes:$('#rNotes').value.trim()||'Payment received'});auditSet(tx,'payment_received','payment',pRef.id,{saleId,invoiceNo:cur.invoiceNo,amount:amt,method:$('#rMethod').value});});closeModal();toast('Payment recorded and customer ledger updated.');}catch(err){toast(err.message,true);}};
}

function renderExpenses(){
  if(!can('admin','marketing_director','erp_manager'))return;
  const head=$('#expenseHeadFilter')?.value||'', start=$('#expenseStartFilter')?.value||'', end=$('#expenseEndFilter')?.value||'', dept=$('#expenseDeptFilter')?.value||'', method=$('#expenseMethodFilter')?.value||'', status=$('#expenseStatusFilter')?.value||'', entered=$('#expenseEnteredFilter')?.value||'';
  const rows=state.expenses.filter(e=>{const iso=asDate(e.expenseDate)?.toISOString().slice(0,10)||'';return(!head||e.category===head)&&(!start||iso>=start)&&(!end||iso<=end)&&(!dept||e.department===dept)&&(!method||e.paymentMethod===method)&&(!status||e.status===status)&&(!entered||e.enteredBy===entered);});
  const approved=rows.filter(e=>e.status==='approved').reduce((a,e)=>a+Number(e.amount||0),0), month=monthStart(), monthly=state.expenses.filter(e=>e.status==='approved'&&(asDate(e.expenseDate)||new Date(0))>=month).reduce((a,e)=>a+Number(e.amount||0),0), pending=state.expenses.filter(e=>e.status==='pending_approval').length;
  const heads=[...new Set(state.expenses.map(e=>e.category).filter(Boolean))], depts=[...new Set(state.expenses.map(e=>e.department).filter(Boolean))], users=state.users.filter(u=>u.active!==false);
  $('#expensesPage').innerHTML=`<div class="section-head"><div><h3>Expense Management</h3><div class="muted">Controlled vouchers, approval, cash/bank posting and audit history.</div></div><button id="addExpenseBtn" class="btn primary">+ Add Expense</button></div><div class="metric-grid"><div class="metric-box"><small>Approved in Filter</small><strong>${money(approved)}</strong></div><div class="metric-box"><small>Approved This Month</small><strong>${money(monthly)}</strong></div><div class="metric-box"><small>Pending Approval</small><strong>${pending}</strong></div><div class="metric-box"><small>Filtered Vouchers</small><strong>${rows.length}</strong></div></div><div class="filter-grid"><label>Expense Head<select id="expenseHeadFilter"><option value="">All</option>${heads.map(v=>`<option ${v===head?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>From<input id="expenseStartFilter" type="date" value="${esc(start)}"></label><label>To<input id="expenseEndFilter" type="date" value="${esc(end)}"></label><label>Department<select id="expenseDeptFilter"><option value="">All</option>${depts.map(v=>`<option ${v===dept?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Payment Method<select id="expenseMethodFilter"><option value="">All</option>${['cash','bank','easypaisa','jazzcash','cheque'].map(v=>`<option value="${v}" ${v===method?'selected':''}>${v}</option>`).join('')}</select></label><label>Status<select id="expenseStatusFilter"><option value="">All</option>${['draft','pending_approval','approved','rejected','cancelled'].map(v=>`<option value="${v}" ${v===status?'selected':''}>${v.replaceAll('_',' ')}</option>`).join('')}</select></label><label>Entered By<select id="expenseEnteredFilter"><option value="">All</option>${users.map(u=>`<option value="${u.id}" ${u.id===entered?'selected':''}>${esc(u.fullName)}</option>`).join('')}</select></label></div><div class="table-wrap"><table class="table"><thead><tr><th>Voucher</th><th>Date</th><th>Head</th><th>Vendor / Paid To</th><th>Department</th><th>Method</th><th>Account</th><th>Amount</th><th>Status</th><th>Entered By</th><th></th></tr></thead><tbody>${rows.map(e=>`<tr><td><b>${esc(e.voucherNo||'')}</b></td><td>${date(e.expenseDate)}</td><td>${esc(e.category||'')}</td><td>${esc(e.vendorName||'')}</td><td>${esc(e.department||'')}</td><td>${esc(e.paymentMethod||'')}</td><td>${esc(e.accountName||e.accountId||'')}</td><td>${money(e.amount)}</td><td><span class="badge status-${esc(e.status||'draft')}">${esc((e.status||'draft').replaceAll('_',' '))}</span></td><td>${esc(profileName(e.enteredBy))}</td><td><button class="btn ghost small" data-expense="${e.id}">View</button></td></tr>`).join('')||'<tr><td colspan="11" class="empty">No expense vouchers.</td></tr>'}</tbody></table></div>`;
  const rerender=()=>renderExpenses(); ['expenseHeadFilter','expenseStartFilter','expenseEndFilter','expenseDeptFilter','expenseMethodFilter','expenseStatusFilter','expenseEnteredFilter'].forEach(id=>{if($('#'+id))$('#'+id).onchange=rerender;}); $('#addExpenseBtn').onclick=()=>openExpenseForm(); $$('[data-expense]').forEach(b=>b.onclick=()=>openExpense(b.dataset.expense));
}

function openExpenseForm(id=null){
  const exp=id?state.expenses.find(e=>e.id===id):null;
  if(exp&&!['draft','rejected'].includes(exp.status))return toast('Only draft or rejected expenses can be edited.',true);
  const accounts=state.accounts.filter(a=>a.active!==false), defaultAccount=exp?.accountId||accounts[0]?.id||'cash-main';
  showModal(exp?'Edit Expense':'Add Expense',`<form id="expenseForm" class="form-grid"><label>Expense Date<input id="eDate" type="date" value="${exp?asDate(exp.expenseDate)?.toISOString().slice(0,10):todayISO()}" required></label><label>Expense Head / Category<input id="eCat" value="${esc(exp?.category||'')}" placeholder="e.g. Petrol/Transport" required></label><label>Amount<input id="eAmount" type="number" min="0.01" step="0.01" value="${Number(exp?.amount||0)||''}" required></label><label>Payment Method<select id="eMethod">${['cash','bank','easypaisa','jazzcash','cheque'].map(v=>`<option value="${v}" ${exp?.paymentMethod===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Cash / Bank Account<select id="eAccount">${accounts.length?accounts.map(a=>`<option value="${a.id}" ${a.id===defaultAccount?'selected':''}>${esc(a.name)} — ${money(a.balance)}</option>`).join(''):`<option value="cash-main">Main Cash</option>`}</select></label><label>Paid To / Vendor<input id="eVendor" value="${esc(exp?.vendorName||'')}" required></label><label>Department / Cost Centre<input id="eDept" value="${esc(exp?.department||'')}" required></label><label>Supporting Receipt<input id="eAttachment" type="file" accept="image/*,.pdf"></label><label class="full">Description<textarea id="eDesc" required>${esc(exp?.description||'')}</textarea></label>${exp?.attachment?.name?`<div class="full expense-attachment">Existing attachment: ${esc(exp.attachment.name)}</div>`:''}<div class="full help">Receipt attachments are stored with the voucher and limited to 500 KB in this no-server version.</div><div class="full actions"><button class="btn ghost" type="submit" data-action="draft">Save Draft</button><button class="btn primary" type="submit" data-action="submit">Submit for Approval</button></div></form>`);
  $('#expenseForm').onsubmit=async e=>{e.preventDefault();const action=e.submitter?.dataset.action||'submit',status=action==='draft'?'draft':'pending_approval',file=$('#eAttachment').files[0];try{const attachment=file?await readSmallAttachment(file):(exp?.attachment||null), accountId=$('#eAccount').value,account=state.accounts.find(a=>a.id===accountId), data={expenseDate:tsFromInput($('#eDate').value),category:$('#eCat').value.trim(),amount:Number($('#eAmount').value),paymentMethod:$('#eMethod').value,accountId,accountName:account?.name||'Main Cash',vendorName:$('#eVendor').value.trim(),department:$('#eDept').value.trim(),description:$('#eDesc').value.trim(),attachment,status,enteredBy:exp?.enteredBy||state.user.uid,enteredByName:exp?.enteredByName||state.me?.fullName||'',submittedAt:status==='pending_approval'?Timestamp.now():null,updatedAt:Timestamp.now()};if(exp){await runTransaction(db,async tx=>{const ref=doc(db,'expenses',id),snap=await tx.get(ref);if(!snap.exists()||!['draft','rejected'].includes(snap.data().status))throw new Error('Expense can no longer be edited.');tx.update(ref,{...data,rejectionReason:null});auditSet(tx,'expense_updated','expense',id,{voucherNo:snap.data().voucherNo,status});});closeModal();toast('Expense updated.');}else{const ref=doc(collection(db,'expenses')),counterRef=doc(db,'counters','expense');await runTransaction(db,async tx=>{const cs=await tx.get(counterRef),next=cs.exists()?Number(cs.data().next||1):1,voucherNo=`EXP-${String(next).padStart(6,'0')}`,now=Timestamp.now();tx.set(counterRef,{next:next+1},{merge:true});tx.set(ref,{...data,voucherNo,approvalStatus:status,financialApplied:false,createdAt:now});auditSet(tx,status==='draft'?'expense_draft_created':'expense_submitted','expense',ref.id,{voucherNo,amount:data.amount,category:data.category});});closeModal();toast('Expense voucher created.');}}catch(err){toast(err.message,true);}};
}

function openExpense(id){
  const e=state.expenses.find(x=>x.id===id);if(!e)return;
  showModal(`Expense ${e.voucherNo||''}`,`<div class="invoice-status-line"><span class="badge status-${esc(e.status||'draft')}">${esc((e.status||'draft').replaceAll('_',' '))}</span></div><div class="card"><div class="two-col"><div><b>Date:</b> ${date(e.expenseDate)}<br><b>Head:</b> ${esc(e.category||'')}<br><b>Amount:</b> ${money(e.amount)}<br><b>Method:</b> ${esc(e.paymentMethod||'')}<br><b>Account:</b> ${esc(e.accountName||e.accountId||'')}</div><div><b>Paid To:</b> ${esc(e.vendorName||'')}<br><b>Department:</b> ${esc(e.department||'')}<br><b>Entered By:</b> ${esc(e.enteredByName||profileName(e.enteredBy))}<br><b>Created:</b> ${dt(e.createdAt)}${e.approvedAt?`<br><b>Approved By:</b> ${esc(e.approvedByName||profileName(e.approvedBy))}<br><b>Approved:</b> ${dt(e.approvedAt)}`:''}</div></div><p><b>Description:</b> ${esc(e.description||'')}</p>${e.attachment?.dataUrl?`<p><a class="btn ghost small" href="${e.attachment.dataUrl}" download="${esc(e.attachment.name||'receipt')}">Download Receipt</a></p>`:''}${e.cancellationReason?`<div class="danger-note"><b>Cancellation:</b> ${esc(e.cancellationReason)}</div>`:''}${e.rejectionReason?`<div class="danger-note"><b>Rejection:</b> ${esc(e.rejectionReason)}</div>`:''}</div><div class="actions">${['draft','rejected'].includes(e.status)?'<button id="editExpenseBtn" class="btn ghost">Edit</button>':''}${e.status==='draft'?'<button id="submitExpenseBtn" class="btn primary">Submit for Approval</button>':''}${e.status==='pending_approval'?'<button id="approveExpenseBtn" class="btn primary">Approve</button><button id="rejectExpenseBtn" class="btn danger">Reject</button>':''}${e.status!=='cancelled'?'<button id="cancelExpenseBtn" class="btn danger">Cancel / Archive</button>':''}</div>`);
  if($('#editExpenseBtn'))$('#editExpenseBtn').onclick=()=>openExpenseForm(id); if($('#submitExpenseBtn'))$('#submitExpenseBtn').onclick=()=>submitExpense(id); if($('#approveExpenseBtn'))$('#approveExpenseBtn').onclick=()=>approveExpense(id); if($('#rejectExpenseBtn'))$('#rejectExpenseBtn').onclick=()=>rejectExpense(id); if($('#cancelExpenseBtn'))$('#cancelExpenseBtn').onclick=()=>cancelExpense(id);
}
async function submitExpense(id){const ref=doc(db,'expenses',id);try{await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists()||snap.data().status!=='draft')throw new Error('Expense is no longer a draft.');const now=Timestamp.now();tx.update(ref,{status:'pending_approval',approvalStatus:'pending_approval',submittedAt:now,updatedAt:now});auditSet(tx,'expense_submitted','expense',id,{voucherNo:snap.data().voucherNo});});closeModal();toast('Expense submitted for approval.');}catch(err){toast(err.message,true);}}
async function approveExpense(id){
  if(!canManageExpenses())return; const ref=doc(db,'expenses',id),e0=state.expenses.find(e=>e.id===id);if(!e0)return;const accountId=e0.accountId||'cash-main',aRef=doc(db,'cashBankAccounts',accountId);
  try{await runTransaction(db,async tx=>{const es=await tx.get(ref),as=await tx.get(aRef);if(!es.exists()||es.data().status!=='pending_approval')throw new Error('Expense is not pending approval.');const e=es.data(),now=Timestamp.now(),old=as.exists()?Number(as.data().balance||0):0,newBal=old-Number(e.amount||0);if(as.exists())tx.update(aRef,{balance:newBal,updatedAt:now});else tx.set(aRef,{name:e.accountName||'Main Cash',type:e.paymentMethod==='bank'?'bank':'cash',balance:newBal,active:true,createdAt:now,updatedAt:now});tx.update(ref,{status:'approved',approvalStatus:'approved',approvedBy:state.user.uid,approvedByName:state.me?.fullName||'',approvedAt:now,financialApplied:true,updatedAt:now});auditSet(tx,'expense_approved','expense',id,{voucherNo:e.voucherNo,amount:e.amount,accountId,newBalance:newBal});});closeModal();toast('Expense approved and cash/bank balance updated.');}catch(err){toast(err.message,true);}
}
function rejectExpense(id){const e=state.expenses.find(x=>x.id===id);if(!e||!canManageExpenses())return;showModal(`Reject ${e.voucherNo}`,`<form id="rejectExpenseForm" class="stack"><label>Mandatory reason<textarea id="expenseRejectReason" required></textarea></label><button class="btn danger">Reject Expense</button></form>`);$('#rejectExpenseForm').onsubmit=async ev=>{ev.preventDefault();const reason=$('#expenseRejectReason').value.trim();if(!reason)return;const ref=doc(db,'expenses',id);try{await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists()||snap.data().status!=='pending_approval')throw new Error('Expense is no longer pending.');const now=Timestamp.now();tx.update(ref,{status:'rejected',approvalStatus:'rejected',rejectionReason:reason,rejectedBy:state.user.uid,rejectedAt:now,updatedAt:now});auditSet(tx,'expense_rejected','expense',id,{voucherNo:snap.data().voucherNo,reason});});closeModal();toast('Expense rejected.');}catch(err){toast(err.message,true);}};}
function cancelExpense(id){const e0=state.expenses.find(x=>x.id===id);if(!e0||!canManageExpenses())return;showModal(`Cancel ${e0.voucherNo}`,`<form id="cancelExpenseForm" class="stack"><label>Mandatory cancellation / deletion reason<textarea id="expenseCancelReason" required></textarea></label><button class="btn danger">Cancel Expense</button></form>`);$('#cancelExpenseForm').onsubmit=async ev=>{ev.preventDefault();const reason=$('#expenseCancelReason').value.trim();if(!reason)return;const ref=doc(db,'expenses',id),aRef=doc(db,'cashBankAccounts',e0.accountId||'cash-main');try{await runTransaction(db,async tx=>{const es=await tx.get(ref),as=await tx.get(aRef);if(!es.exists())throw new Error('Expense not found.');const e=es.data();if(e.status==='cancelled')throw new Error('Already cancelled.');const now=Timestamp.now();if(e.status==='approved'&&e.financialApplied===true){const old=as.exists()?Number(as.data().balance||0):0,newBal=old+Number(e.amount||0);if(as.exists())tx.update(aRef,{balance:newBal,updatedAt:now});else tx.set(aRef,{name:e.accountName||'Main Cash',type:'cash',balance:newBal,active:true,createdAt:now,updatedAt:now});}tx.update(ref,{status:'cancelled',approvalStatus:'cancelled',cancellationReason:reason,cancelledBy:state.user.uid,cancelledByName:state.me?.fullName||'',cancelledAt:now,financialApplied:false,softDeleted:['draft','rejected'].includes(e.status),updatedAt:now});auditSet(tx,'expense_cancelled','expense',id,{voucherNo:e.voucherNo,reason,previousStatus:e.status});});closeModal();toast('Expense cancelled; any financial impact was reversed.');}catch(err){toast(err.message,true);}};}

function renderReports(){
  if(!can('admin','marketing_director','erp_manager'))return;
  const start=monthStart(), sales=approvedSales().filter(s=>(asDate(s.saleDate)||new Date(0))>=start), rev=sales.reduce((a,s)=>a+Number(s.total||0),0), collected=sales.reduce((a,s)=>a+Number(s.paidAmount||0),0), expenses=state.expenses.filter(e=>e.status==='approved'&&(asDate(e.expenseDate)||new Date(0))>=start).reduce((a,e)=>a+Number(e.amount||0),0), paidUnits=sales.reduce((sum,s)=>sum+(s.items||[]).reduce((a,i)=>a+Number(i.paidQty||0),0),0), freeUnits=sales.reduce((sum,s)=>sum+(s.items||[]).reduce((a,i)=>a+Number(i.freeQty||0),0),0);
  const cogs=sales.reduce((sum,s)=>sum+(s.items||[]).reduce((a,i)=>a+Number(i.costPrice||0)*Number(i.issuedQty||0),0),0);
  $('#reportsPage').innerHTML=`<div class="grid cards"><div class="card stat"><small>Approved Monthly Sales</small><strong>${money(rev)}</strong></div><div class="card stat"><small>Monthly Collection</small><strong>${money(collected)}</strong></div><div class="card stat"><small>Approved Expenses</small><strong>${money(expenses)}</strong></div><div class="card stat"><small>Estimated COGS</small><strong>${money(cogs)}</strong></div></div><div class="metric-grid"><div class="metric-box"><small>Paid Stock Units</small><strong>${fmt(paidUnits)}</strong></div><div class="metric-box"><small>Complimentary Units</small><strong>${fmt(freeUnits)}</strong></div><div class="metric-box"><small>Total Delivered</small><strong>${fmt(paidUnits+freeUnits)}</strong></div><div class="metric-box"><small>Pending Invoices</small><strong>${state.sales.filter(s=>invoiceStatus(s)==='pending_approval').length}</strong></div></div><div class="section-head"><h3>Salesman Summary — Approved Invoices</h3><div class="actions"><button id="reportCsvBtn" class="btn ghost">Export Sales CSV</button>${can('admin','erp_manager')?'<button id="backupBtn" class="btn ghost">Export JSON Backup</button>':''}</div></div>${salesmanSummaryTable(sales)}`;
  $('#reportCsvBtn').onclick=exportSales; if($('#backupBtn'))$('#backupBtn').onclick=exportBackup;
}
function salesmanSummaryTable(sales){ const reps=state.users.filter(p=>p.role==='salesman'); return `<div class="table-wrap"><table class="table"><thead><tr><th>Salesman</th><th>Route</th><th>Invoices</th><th>Sales</th><th>Collected</th><th>Outstanding</th><th>Free Units</th><th>Target</th><th>%</th></tr></thead><tbody>${reps.map(p=>{const ss=sales.filter(s=>s.salesmanId===p.id),v=ss.reduce((a,s)=>a+Number(s.total||0),0),rec=ss.reduce((a,s)=>a+Number(s.paidAmount||0),0),free=ss.reduce((x,s)=>x+(s.items||[]).reduce((a,i)=>a+Number(i.freeQty||0),0),0),pct=Number(p.monthlyTarget||0)>0?v/Number(p.monthlyTarget)*100:0;return `<tr><td>${esc(p.fullName)}</td><td>${esc(p.routeArea||'')}</td><td>${ss.length}</td><td>${money(v)}</td><td>${money(rec)}</td><td>${money(v-rec)}</td><td>${fmt(free)}</td><td>${money(p.monthlyTarget)}</td><td>${pct.toFixed(1)}%</td></tr>`}).join('')||'<tr><td colspan="9" class="empty">No salesmen.</td></tr>'}</tbody></table></div>`; }
function exportSales(){ const rows=[['Invoice','Date','Customer','Salesman','Approval Status','Paid Units','Complimentary Units','Total Delivered','Invoice Total','Paid','Balance','Payment Status'],...state.sales.map(s=>[s.invoiceNo,asDate(s.saleDate)?.toISOString()||'',customerName(s.customerId),profileName(s.salesmanId),invoiceStatus(s),(s.items||[]).reduce((a,i)=>a+Number(i.paidQty||0),0),(s.items||[]).reduce((a,i)=>a+Number(i.freeQty||0),0),(s.items||[]).reduce((a,i)=>a+Number(i.issuedQty||0),0),s.total,s.paidAmount,Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)),s.paymentStatus])]; const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'); downloadBlob(csv,`naturegen-sales-${todayISO()}.csv`,'text/csv'); }
function exportBackup(){ const clean=(v)=>JSON.parse(JSON.stringify(v,(k,val)=>val?.toDate?val.toDate().toISOString():val)); const data=clean({exportedAt:new Date().toISOString(),settings:state.settings,users:state.users,products:state.products,customers:state.customers,sales:state.sales,payments:state.payments,expenses:state.expenses,stockMovements:state.movements,ledgerEntries:state.ledgerEntries,auditTrail:state.auditTrail,cashBankAccounts:state.accounts}); downloadBlob(JSON.stringify(data,null,2),`naturegen-backup-${todayISO()}.json`,'application/json'); }
function downloadBlob(content,name,type){ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000); }

function renderUsers(){
  if(!can('admin','erp_manager'))return;
  $('#usersPage').innerHTML=`<div class="section-head"><div><h3>Users & Roles</h3><div class="muted">Controlled roles: Salesman, Marketing Director, ERP Manager, Inventory, Recovery and Admin.</div></div><button id="createUserBtn" class="btn primary">+ Create User Login</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Route</th><th>Monthly Target</th><th>Active</th><th></th></tr></thead><tbody>${state.users.map(p=>`<tr><td><b>${esc(p.fullName)}</b></td><td>${esc(p.email||'')}</td><td><span class="badge role-pill">${esc((p.role||'').replaceAll('_',' '))}</span></td><td>${esc(p.phone||'')}</td><td>${esc(p.routeArea||'')}</td><td>${money(p.monthlyTarget)}</td><td>${p.active!==false?'Yes':'No'}</td><td><button class="btn ghost small" data-user="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#createUserBtn').onclick=openCreateUserForm; $$('[data-user]').forEach(b=>b.onclick=()=>openUserForm(b.dataset.user));
}
function roleOptions(selected='salesman'){return ['salesman','marketing_director','erp_manager','inventory','recovery','admin'].map(r=>`<option value="${r}" ${selected===r?'selected':''}>${r.replaceAll('_',' ')}</option>`).join('');}
function openCreateUserForm(){
  if(!can('admin','erp_manager'))return;
  showModal('Create Staff Login',`<form id="createUserForm" class="form-grid"><label>Full Name<input id="nuName" required></label><label>Email<input id="nuEmail" type="email" required></label><label>Temporary Password<input id="nuPassword" type="password" minlength="6" required></label><label>Role<select id="nuRole">${roleOptions()}</select></label><label>Phone<input id="nuPhone"></label><label>Route / Area<input id="nuRoute"></label><label>Monthly Target<input id="nuTarget" type="number" min="0" step="0.01" value="0"></label><div class="full help">The user can later use “Forgot password?” on the login screen to set a private password.</div><div class="full"><button class="btn primary">Create Login</button></div></form>`);
  $('#createUserForm').onsubmit=async e=>{e.preventDefault();let secondary=null;try{secondary=initializeApp(C,`staff-${Date.now()}`);const a=getAuth(secondary);const cred=await createUserWithEmailAndPassword(a,$('#nuEmail').value.trim(),$('#nuPassword').value);await setDoc(doc(db,'users',cred.user.uid),{fullName:$('#nuName').value.trim(),email:$('#nuEmail').value.trim().toLowerCase(),role:$('#nuRole').value,phone:$('#nuPhone').value.trim(),routeArea:$('#nuRoute').value.trim(),monthlyTarget:Number($('#nuTarget').value||0),active:true,createdAt:serverTimestamp(),createdBy:state.user.uid,updatedAt:serverTimestamp()});await writeAudit('user_created','user',cred.user.uid,{email:$('#nuEmail').value.trim().toLowerCase(),role:$('#nuRole').value});await signOut(a);await deleteApp(secondary);secondary=null;closeModal();toast('Staff login created.');}catch(err){console.error(err);if(secondary)try{await deleteApp(secondary);}catch{}toast(err.message,true);}};
}
function openUserForm(id){
  if(!can('admin','erp_manager'))return; const p=state.users.find(x=>x.id===id); if(!p)return;
  showModal('Edit User Role',`<form id="userForm" class="form-grid"><label>Full Name<input id="uName" value="${esc(p.fullName||'')}"></label><label>Email<input value="${esc(p.email||'')}" disabled></label><label>Phone<input id="uPhone" value="${esc(p.phone||'')}"></label><label>Role<select id="uRole">${roleOptions(p.role)}</select></label><label>Route / Area<input id="uRoute" value="${esc(p.routeArea||'')}"></label><label>Monthly Target<input id="uTarget" type="number" min="0" step="0.01" value="${p.monthlyTarget||0}"></label><label>Active<select id="uActive"><option value="true" ${p.active!==false?'selected':''}>Yes</option><option value="false" ${p.active===false?'selected':''}>No</option></select></label><div class="full"><button class="btn primary">Save User</button></div></form>`);
  $('#userForm').onsubmit=async e=>{e.preventDefault();if(id===state.user.uid&&$('#uActive').value==='false')return toast('You cannot deactivate your own access.',true);try{const changes={fullName:$('#uName').value.trim(),phone:$('#uPhone').value.trim(),role:$('#uRole').value,routeArea:$('#uRoute').value.trim(),monthlyTarget:Number($('#uTarget').value||0),active:$('#uActive').value==='true',updatedAt:serverTimestamp()};await updateDoc(doc(db,'users',id),changes);await writeAudit('user_permissions_updated','user',id,{role:changes.role,active:changes.active});closeModal();toast('User updated.');}catch(err){toast(err.message,true);}};
}

function renderAudit(){
  if(!can('admin','erp_manager'))return;
  const term=($('#auditSearch')?.value||'').toLowerCase(), entity=$('#auditEntityFilter')?.value||'', action=$('#auditActionFilter')?.value||'', actor=$('#auditActorFilter')?.value||'', start=$('#auditStart')?.value||'', end=$('#auditEnd')?.value||'';
  const actions=[...new Set(state.auditTrail.map(a=>a.action).filter(Boolean))], actors=[...new Set(state.auditTrail.map(a=>a.actorId).filter(Boolean))];
  const rows=state.auditTrail.filter(a=>{const iso=asDate(a.createdAt)?.toISOString().slice(0,10)||'',blob=JSON.stringify(a.details||{}).toLowerCase();return(!term||String(a.action||'').toLowerCase().includes(term)||String(a.actorName||'').toLowerCase().includes(term)||blob.includes(term))&&(!entity||a.entityType===entity)&&(!action||a.action===action)&&(!actor||a.actorId===actor)&&(!start||iso>=start)&&(!end||iso<=end);});
  $('#auditPage').innerHTML=`<div class="section-head"><div><h3>Non-Editable Audit Trail</h3><div class="muted">Invoice, customer, complimentary stock, recovery, permissions and expense actions are append-only.</div></div></div><div class="filter-grid"><label>Search<input id="auditSearch" value="${esc(term)}" placeholder="action / user / details"></label><label>Entity<select id="auditEntityFilter"><option value="">All</option>${['invoice','customer','payment','expense','user'].map(v=>`<option value="${v}" ${v===entity?'selected':''}>${v}</option>`).join('')}</select></label><label>Action<select id="auditActionFilter"><option value="">All</option>${actions.map(v=>`<option value="${esc(v)}" ${v===action?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>User<select id="auditActorFilter"><option value="">All</option>${actors.map(v=>`<option value="${v}" ${v===actor?'selected':''}>${esc(profileName(v))}</option>`).join('')}</select></label><label>From<input id="auditStart" type="date" value="${esc(start)}"></label><label>To<input id="auditEnd" type="date" value="${esc(end)}"></label></div><div class="table-wrap"><table class="table"><thead><tr><th>Date/Time</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Details</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${dt(a.createdAt)}</td><td>${esc(a.actorName||profileName(a.actorId))}</td><td>${esc((a.actorRole||'').replaceAll('_',' '))}</td><td><b>${esc(a.action||'')}</b></td><td>${esc(a.entityType||'')}</td><td>${esc(a.entityId||'')}</td><td><div class="audit-details">${esc(JSON.stringify(a.details||{}))}</div></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No audit entries in this filter.</td></tr>'}</tbody></table></div>`;
  const rerender=()=>renderAudit(); $('#auditSearch').oninput=rerender; ['auditEntityFilter','auditActionFilter','auditActorFilter','auditStart','auditEnd'].forEach(id=>{if($('#'+id))$('#'+id).onchange=rerender;});
}

function renderSettings(){
  if(!can('admin','erp_manager'))return;
  const s=state.settings||{}, needsSetup=state.products.length===0;
  $('#settingsPage').innerHTML=`${needsSetup?`<div class="card setup-card"><h3>Initial Business Setup</h3><p>Products are empty. Create Naturegen's starting products and stock with one click.</p><button id="seedBtn" class="btn primary">Initialize Aimacid + Iron Data</button></div>`:''}<div class="card setup-card" style="margin-top:16px"><h3>Controlled Workflow Setup</h3><p>Ensures invoice/customer/expense counters and a Main Cash account exist without removing existing data.</p><button id="controlSetupBtn" class="btn ghost">Initialize / Repair Control Data</button></div><div class="card" style="max-width:760px;margin-top:16px"><h3>Company Settings</h3><form id="settingsForm" class="form-grid"><label>Company Name<input id="setName" value="${esc(s.companyName||'Naturegen Distribution')}"></label><label>Phone<input id="setPhone" value="${esc(s.phone||'')}"></label><label class="full">Address<textarea id="setAddress">${esc(s.address||'')}</textarea></label><label>Monthly Profit Target<input id="setTarget" type="number" min="0" step="0.01" value="${s.monthlyProfitTarget||100000}"></label><div class="full"><button class="btn primary">Save Settings</button></div></form></div><div class="section-head"><h3>Cash / Bank Accounts</h3><button id="addAccountBtn" class="btn primary">+ Add Account</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Type</th><th>Balance</th><th>Status</th></tr></thead><tbody>${state.accounts.map(a=>`<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.type||'')}</td><td>${money(a.balance)}</td><td>${a.active!==false?'Active':'Inactive'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No accounts yet. Initialize control data to create Main Cash.</td></tr>'}</tbody></table></div>`;
  if($('#seedBtn')) $('#seedBtn').onclick=seedInitialData; $('#controlSetupBtn').onclick=initializeControlData; $('#addAccountBtn').onclick=openAccountForm;
  $('#settingsForm').onsubmit=async e=>{e.preventDefault();try{await setDoc(doc(db,'settings','company'),{companyName:$('#setName').value.trim(),phone:$('#setPhone').value.trim(),address:$('#setAddress').value.trim(),monthlyProfitTarget:Number($('#setTarget').value||0),updatedAt:serverTimestamp()},{merge:true});await writeAudit('company_settings_updated','settings','company',{});toast('Settings saved.');}catch(err){toast(err.message,true);}};
}
function openAccountForm(){
  showModal('Add Cash / Bank Account',`<form id="accountForm" class="form-grid"><label>Account Name<input id="accName" required></label><label>Type<select id="accType"><option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option></select></label><label>Opening Balance<input id="accBalance" type="number" step="0.01" value="0"></label><div class="full"><button class="btn primary">Create Account</button></div></form>`);
  $('#accountForm').onsubmit=async e=>{e.preventDefault();try{const ref=doc(collection(db,'cashBankAccounts')),now=Timestamp.now();await setDoc(ref,{name:$('#accName').value.trim(),type:$('#accType').value,balance:Number($('#accBalance').value||0),active:true,createdBy:state.user.uid,createdAt:now,updatedAt:now});await writeAudit('cash_bank_account_created','account',ref.id,{name:$('#accName').value.trim(),type:$('#accType').value,openingBalance:Number($('#accBalance').value||0)});closeModal();toast('Account created.');}catch(err){toast(err.message,true);}};
}
async function initializeControlData(){
  if(!can('admin','erp_manager'))return;
  try{const batch=writeBatch(db),now=serverTimestamp();batch.set(doc(db,'counters','invoice'),{next:1},{merge:true});batch.set(doc(db,'counters','customer'),{next:1},{merge:true});batch.set(doc(db,'counters','expense'),{next:1},{merge:true});batch.set(doc(db,'cashBankAccounts','cash-main'),{name:'Main Cash',type:'cash',balance:0,active:true,updatedAt:now},{merge:true});await batch.commit();await writeAudit('control_data_initialized','settings','controls',{});toast('Control data initialized without removing existing records.');}catch(err){toast(err.message,true);}
}
async function seedInitialData(){
  if(!can('admin','erp_manager'))return;
  if(state.products.length) return toast('Products already exist; setup was not repeated.',true);
  const batch=writeBatch(db), now=serverTimestamp();
  const p1=doc(collection(db,'products')),p2=doc(collection(db,'products'));
  batch.set(p1,{sku:'AIMACID-120',name:'Aimacid Syrup 120 ml',mrp:190,salePrice:65,costPrice:35,stockQty:10400,lowStockThreshold:500,schemeBuy:10,schemeFree:1,active:true,createdAt:now,updatedAt:now});
  batch.set(p2,{sku:'IRON-120',name:'Iron Syrup 120 ml',mrp:0,salePrice:90,costPrice:35,stockQty:2600,lowStockThreshold:200,schemeBuy:10,schemeFree:1,active:true,createdAt:now,updatedAt:now});
  batch.set(doc(db,'counters','invoice'),{next:1},{merge:true});batch.set(doc(db,'counters','customer'),{next:1},{merge:true});batch.set(doc(db,'counters','expense'),{next:1},{merge:true});
  batch.set(doc(db,'cashBankAccounts','cash-main'),{name:'Main Cash',type:'cash',balance:0,active:true,updatedAt:now},{merge:true});
  batch.set(doc(db,'settings','company'),{companyName:'Naturegen Distribution',monthlyProfitTarget:100000,updatedAt:now},{merge:true});
  const m1=doc(collection(db,'stockMovements')),m2=doc(collection(db,'stockMovements'));
  batch.set(m1,{productId:p1.id,productName:'Aimacid Syrup 120 ml',movementType:'opening',qtyChange:10400,balanceAfter:10400,refType:'opening',refId:'',notes:'Initial opening stock',enteredBy:state.user.uid,createdAt:now});
  batch.set(m2,{productId:p2.id,productName:'Iron Syrup 120 ml',movementType:'opening',qtyChange:2600,balanceAfter:2600,refType:'opening',refId:'',notes:'Initial opening stock',enteredBy:state.user.uid,createdAt:now});
  try{await batch.commit();await writeAudit('initial_business_data_created','settings','initial',{products:['Aimacid Syrup 120 ml','Iron Syrup 120 ml']});toast('Initial Naturegen data created.');}catch(err){toast(err.message,true);}
}

async function init(){
  if(!configured){ $('#configWarning').classList.remove('hidden'); return; }
  onAuthStateChanged(auth,async user=>{
    clearListeners(); state.user=user; state.me=null;
    if(!user){ showLogin(); return; }
    try{
      const me=await loadProfile(user);
      if(!me){ $('#accessWarning').classList.remove('hidden'); await signOut(auth); return; }
      $('#accessWarning').classList.add('hidden'); state.me=me; $('#userName').textContent=me.fullName||user.email; $('#userRole').textContent=me.role; showApp(); renderNav(); go('dashboard'); setSync('Connecting live data…'); await startLiveData();
    }catch(err){console.error(err);toast(err.message,true);await signOut(auth);}
  });
}

$('#loginForm').onsubmit=async e=>{e.preventDefault();if(!configured)return toast('Connect Firebase in config.js first.',true);try{await signInWithEmailAndPassword(auth,$('#loginEmail').value.trim(),$('#loginPassword').value);}catch(err){toast('Login failed: '+err.message,true);}};
$('#forgotPasswordBtn').onclick=async()=>{if(!configured)return;const email=$('#loginEmail').value.trim();if(!email)return toast('Enter your email first.',true);try{await sendPasswordResetEmail(auth,email);toast('Password reset email sent.');}catch(err){toast(err.message,true);}};
$('#logoutBtn').onclick=async()=>{clearListeners();await signOut(auth);};
$('#refreshBtn').onclick=()=>{ if(state.user&&state.me){ setSync('Refreshing live listeners…'); startLiveData(); } };
$('#modalClose').onclick=closeModal; $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});

init();
