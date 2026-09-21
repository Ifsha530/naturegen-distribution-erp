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
  products:[], customers:[], users:[], sales:[], payments:[], expenses:[], movements:[], settings:null,
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
function activeProducts(){ return state.products.filter(p=>p.active!==false); }
function accessibleSales(){ return state.sales; }
function calcStatus(total, paid){ return Number(paid||0) >= Number(total||0)-0.001 ? 'paid' : Number(paid||0)>0 ? 'partial' : 'unpaid'; }

const navByRole = {
  admin:[['dashboard','Dashboard','⌂'],['sales','Sales & Invoices','🧾'],['customers','Customers','◫'],['inventory','Inventory','▣'],['recovery','Recovery','₨'],['expenses','Expenses','−'],['reports','Reports','▤'],['users','Users & Roles','♙'],['settings','Settings','⚙']],
  inventory:[['dashboard','Dashboard','⌂'],['sales','Invoices','🧾'],['customers','Customers','◫'],['inventory','Inventory','▣']],
  salesman:[['dashboard','My Dashboard','⌂'],['sales','My Sales','🧾'],['customers','My Customers','◫'],['recovery','My Recovery','₨']],
  recovery:[['dashboard','Dashboard','⌂'],['sales','Invoices','🧾'],['customers','Customers','◫'],['recovery','Recovery','₨']]
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
  const fn={dashboard:renderDashboard,sales:renderSales,customers:renderCustomers,inventory:renderInventory,recovery:renderRecovery,expenses:renderExpenses,reports:renderReports,users:renderUsers,settings:renderSettings}[state.page];
  if(fn) fn();
}

function clearListeners(){ state.unsubs.forEach(u=>{try{u();}catch{}}); state.unsubs=[]; state.liveReady=false; }
function userQueryFor(collectionName){
  const ref=collection(db,collectionName);
  if(role()==='salesman'){
    if(collectionName==='sales' || collectionName==='payments') return query(ref,where('salesmanId','==',state.user.uid));
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
  attachCollection('payments','payments');
  if(can('admin')) attachCollection('expenses','expenses'); else state.expenses=[];
  if(can('admin','inventory')) attachCollection('stockMovements','movements'); else state.movements=[];
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
  const start=monthStart(); const sales=accessibleSales().filter(s=>(asDate(s.saleDate)||new Date(0))>=start);
  const total=sales.reduce((a,s)=>a+Number(s.total||0),0);
  const collected=sales.reduce((a,s)=>a+Number(s.paidAmount||0),0);
  const outstanding=accessibleSales().reduce((a,s)=>a+Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)),0);
  const stock=state.products.reduce((a,p)=>a+Number(p.stockQty||0),0);
  const low=activeProducts().filter(p=>Number(p.stockQty||0)<=Number(p.lowStockThreshold||0));
  let perf='';
  if(can('admin')){
    const reps=state.users.filter(p=>p.role==='salesman'&&p.active!==false);
    perf=`<div class="section-head"><h3>Salesman Performance — This Month</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Salesman</th><th>Route</th><th>Invoices</th><th>Sales</th><th>Recovery</th><th>Outstanding</th><th>Target</th><th>Achievement</th></tr></thead><tbody>${reps.map(p=>{
      const ss=sales.filter(s=>s.salesmanId===p.id), st=ss.reduce((a,s)=>a+Number(s.total||0),0), rec=ss.reduce((a,s)=>a+Number(s.paidAmount||0),0), out=ss.reduce((a,s)=>a+Math.max(0,Number(s.total||0)-Number(s.paidAmount||0)),0), pct=Number(p.monthlyTarget||0)>0?Math.min(100,st/Number(p.monthlyTarget)*100):0;
      return `<tr><td><b>${esc(p.fullName)}</b></td><td>${esc(p.routeArea||'—')}</td><td>${ss.length}</td><td>${money(st)}</td><td>${money(rec)}</td><td>${money(out)}</td><td>${money(p.monthlyTarget)}</td><td><div>${pct.toFixed(1)}%</div><div class="progress"><span style="width:${pct}%"></span></div></td></tr>`;
    }).join('')||'<tr><td colspan="8" class="empty">No salesman users yet.</td></tr>'}</tbody></table></div>`;
  }
  $('#dashboardPage').innerHTML=`
    <div class="grid cards">
      <div class="card stat"><small>${can('salesman')?'My ':''}Sales This Month</small><strong>${money(total)}</strong><div class="sub">${sales.length} invoice(s)</div></div>
      <div class="card stat"><small>Collected This Month</small><strong>${money(collected)}</strong><div class="sub">Accessible invoices</div></div>
      <div class="card stat"><small>Outstanding</small><strong>${money(outstanding)}</strong><div class="sub">Current receivables</div></div>
      <div class="card stat"><small>Total Stock Units</small><strong>${fmt(stock)}</strong><div class="sub">${low.length} low-stock product(s)</div></div>
    </div>
    ${low.length?`<div class="section-head"><h3>Low Stock Alerts</h3></div><div class="grid">${low.map(p=>`<div class="card"><b>${esc(p.name)}</b><div class="kpi-line"><span>Available</span><strong>${fmt(p.stockQty)}</strong></div><div class="kpi-line"><span>Alert level</span><span>${fmt(p.lowStockThreshold)}</span></div></div>`).join('')}</div>`:''}
    ${perf}
    <div class="section-head"><h3>Recent Invoices</h3></div>${salesTable(accessibleSales().slice(0,8),false)}
  `;
}

function salesTable(rows,actions=true){
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Salesman</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th>${actions?'<th></th>':''}</tr></thead><tbody>${rows.map(s=>`<tr><td><b>${esc(s.invoiceNo)}</b></td><td>${date(s.saleDate)}</td><td>${esc(customerName(s.customerId))}</td><td>${esc(profileName(s.salesmanId))}</td><td>${money(s.total)}</td><td>${money(s.paidAmount)}</td><td>${money(Number(s.total||0)-Number(s.paidAmount||0))}</td><td>${badgeStatus(s.paymentStatus)}</td>${actions?`<td><button class="btn ghost small" data-invoice="${s.id}">View</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${actions?9:8}" class="empty">No invoices found.</td></tr>`}</tbody></table></div>`;
}

function renderSales(){
  const reps=state.users.filter(u=>u.role==='salesman'&&u.active!==false);
  const canCreate=can('admin','salesman');
  $('#salesPage').innerHTML=`<div class="section-head"><div><h3>${can('salesman')?'My Sales':'Sales & Invoices'}</h3><div class="muted">Stock is deducted automatically when a sale is saved.</div></div>${canCreate?'<button id="newSaleBtn" class="btn primary">+ New Sale</button>':''}</div>
  <div class="filters"><label>Search<input id="saleSearch" placeholder="Invoice / customer"></label>${can('admin')?`<label>Salesman<select id="saleRepFilter"><option value="">All</option>${reps.map(r=>`<option value="${r.id}">${esc(r.fullName)}</option>`).join('')}</select></label>`:''}</div><div id="salesTableHost">${salesTable(accessibleSales())}</div>`;
  if(canCreate) $('#newSaleBtn').onclick=openSaleForm;
  const refresh=()=>{
    const term=($('#saleSearch')?.value||'').toLowerCase(), rep=$('#saleRepFilter')?.value||'';
    const rows=accessibleSales().filter(s=>(!rep||s.salesmanId===rep) && (!term||String(s.invoiceNo||'').toLowerCase().includes(term)||customerName(s.customerId).toLowerCase().includes(term)));
    $('#salesTableHost').innerHTML=salesTable(rows); bindInvoiceButtons();
  };
  $('#saleSearch').oninput=refresh; if($('#saleRepFilter')) $('#saleRepFilter').onchange=refresh; bindInvoiceButtons();
}
function bindInvoiceButtons(){ $$('[data-invoice]').forEach(b=>b.onclick=()=>openInvoice(b.dataset.invoice)); }

function openSaleForm(){
  if(!state.customers.length) return toast('Add a customer first.',true);
  if(!activeProducts().length) return toast('No active products available.',true);
  const reps=state.users.filter(u=>u.role==='salesman'&&u.active!==false);
  const salesmanSelect=can('admin')?`<label>Salesman<select id="saleSalesman" required><option value="">Select salesman</option>${reps.map(r=>`<option value="${r.id}">${esc(r.fullName)} — ${esc(r.routeArea||'')}</option>`).join('')}</select></label>`:`<input id="saleSalesman" type="hidden" value="${state.user.uid}">`;
  showModal('New Sale / Invoice',`<form id="saleForm" class="stack">
    <div class="form-grid"><label>Date<input id="saleDate" type="date" value="${todayISO()}" required></label>${salesmanSelect}<label class="full">Customer<select id="saleCustomer" required><option value="">Select pharmacy/customer</option>${state.customers.map(c=>`<option value="${c.id}">${esc(c.shopName)}${c.routeArea?' — '+esc(c.routeArea):''}</option>`).join('')}</select></label></div>
    <div><b>Products</b><div class="help">Enter paid quantity. Free quantity is calculated from each product's scheme.</div></div>
    <div class="sale-lines">${activeProducts().map(p=>`<div class="sale-line" data-product="${p.id}"><div class="wide"><b>${esc(p.name)}</b><div class="metric-note">Stock ${fmt(p.stockQty)} • Scheme ${p.schemeBuy||0}+${p.schemeFree||0} • Price ${money(p.salePrice)}</div></div><label>Paid Qty<input class="line-qty" type="number" min="0" step="1" value="0"></label><label>Free<input class="line-free" value="0" disabled></label><label>Unit Price<input class="line-price" type="number" min="0" step="0.01" value="${Number(p.salePrice||0)}" ${can('admin')?'':'readonly'}></label><div class="line-total">${money(0)}</div></div>`).join('')}</div>
    <div class="form-grid"><label>Discount<input id="saleDiscount" type="number" min="0" step="0.01" value="0"></label><label>Received Now<input id="salePaid" type="number" min="0" step="0.01" value="0"></label><label class="full">Notes<textarea id="saleNotes"></textarea></label></div>
    <div class="card"><div class="kpi-line"><span>Gross</span><strong id="saleGross">${money(0)}</strong></div><div class="kpi-line"><span>Discount</span><span id="saleDiscountView">${money(0)}</span></div><div class="kpi-line"><span>Invoice Total</span><strong id="saleTotal">${money(0)}</strong></div></div>
    <button class="btn primary" type="submit">Save Sale & Deduct Stock</button>
  </form>`);
  const recalc=()=>{
    let gross=0;
    $$('.sale-line').forEach(row=>{
      const p=state.products.find(x=>x.id===row.dataset.product); const qty=Math.max(0,Math.floor(Number(row.querySelector('.line-qty').value||0))); const price=Math.max(0,Number(row.querySelector('.line-price').value||0));
      const free=(p?.schemeBuy||0)>0?Math.floor(qty/Number(p.schemeBuy))*Number(p.schemeFree||0):0;
      row.querySelector('.line-free').value=free; const lt=qty*price; gross+=lt; row.querySelector('.line-total').textContent=money(lt);
    });
    const disc=Math.max(0,Number($('#saleDiscount').value||0)), total=Math.max(0,gross-disc); $('#saleGross').textContent=money(gross); $('#saleDiscountView').textContent=money(disc); $('#saleTotal').textContent=money(total);
    $('#salePaid').max=String(total);
  };
  $$('.line-qty,.line-price').forEach(i=>i.oninput=recalc); $('#saleDiscount').oninput=recalc; recalc();
  $('#saleForm').onsubmit=saveSale;
}

async function saveSale(e){
  e.preventDefault();
  const salesmanId=$('#saleSalesman').value, customerId=$('#saleCustomer').value;
  if(!salesmanId||!customerId) return toast('Select salesman and customer.',true);
  if(can('salesman') && salesmanId!==state.user.uid) return toast('Salesman mismatch.',true);
  const items=[];
  $$('.sale-line').forEach(row=>{
    const p=state.products.find(x=>x.id===row.dataset.product), paidQty=Math.max(0,Math.floor(Number(row.querySelector('.line-qty').value||0))), unitPrice=Math.max(0,Number(row.querySelector('.line-price').value||0));
    if(p && paidQty>0){ const freeQty=Number(p.schemeBuy||0)>0?Math.floor(paidQty/Number(p.schemeBuy))*Number(p.schemeFree||0):0; items.push({productId:p.id,sku:p.sku||'',name:p.name,paidQty,freeQty,issuedQty:paidQty+freeQty,unitPrice,lineTotal:paidQty*unitPrice,costPrice:Number(p.costPrice||0),mrp:Number(p.mrp||0)}); }
  });
  if(!items.length) return toast('Enter at least one product quantity.',true);
  const gross=items.reduce((a,i)=>a+i.lineTotal,0), discount=Math.max(0,Number($('#saleDiscount').value||0)), total=Math.max(0,gross-discount), paidNow=Math.max(0,Number($('#salePaid').value||0));
  if(paidNow>total+0.001) return toast('Received amount cannot exceed invoice total.',true);
  const saleRef=doc(collection(db,'sales')); const counterRef=doc(db,'counters','invoice'); const paymentRef=paidNow>0?doc(collection(db,'payments')):null;
  const productRefs=items.map(i=>doc(db,'products',i.productId));
  try{
    const result=await runTransaction(db,async tx=>{
      const productSnaps=[]; for(const ref of productRefs) productSnaps.push(await tx.get(ref));
      const counterSnap=await tx.get(counterRef);
      let next=counterSnap.exists()?Number(counterSnap.data().next||1):1;
      const invoiceNo=`NG-${String(next).padStart(6,'0')}`;
      const now=Timestamp.now();
      productSnaps.forEach((snap,idx)=>{
        if(!snap.exists()) throw new Error(`Product not found: ${items[idx].name}`);
        const p=snap.data(), need=Number(items[idx].issuedQty), old=Number(p.stockQty||0); if(old<need) throw new Error(`${p.name}: only ${old} in stock, ${need} required including free quantity.`);
        tx.update(productRefs[idx],{stockQty:old-need,updatedAt:now});
        const mref=doc(collection(db,'stockMovements'));
        tx.set(mref,{productId:items[idx].productId,productName:items[idx].name,movementType:'sale',qtyChange:-need,balanceAfter:old-need,refType:'sale',refId:saleRef.id,notes:`Invoice ${invoiceNo}`,enteredBy:state.user.uid,createdAt:now});
      });
      tx.set(counterRef,{next:next+1},{merge:true});
      const sale={invoiceNo,saleDate:tsFromInput($('#saleDate').value),customerId,salesmanId,items,subtotal:gross,discount,total,paidAmount:paidNow,paymentStatus:calcStatus(total,paidNow),notes:$('#saleNotes').value.trim()||'',createdBy:state.user.uid,createdAt:now,updatedAt:now};
      tx.set(saleRef,sale);
      if(paymentRef) tx.set(paymentRef,{saleId:saleRef.id,invoiceNo,customerId,salesmanId,amount:paidNow,method:'cash',reference:'',notes:'Received with sale',paymentDate:now,enteredBy:state.user.uid,createdAt:now});
      return {invoiceNo};
    });
    closeModal(); toast(`Sale saved: ${result.invoiceNo}`);
  }catch(err){ console.error(err); toast(err.message||'Sale could not be saved.',true); }
}

function openInvoice(id){
  const s=state.sales.find(x=>x.id===id); if(!s) return;
  const cust=state.customers.find(x=>x.id===s.customerId); const settings=state.settings||{};
  showModal(`Invoice ${s.invoiceNo}`,`<div class="invoice" id="invoicePrintable"><h2>${esc(settings.companyName||'Naturegen Distribution')}</h2><p>${esc(settings.address||'')}</p><p>${esc(settings.phone||'')}</p><hr><div class="two-col"><div><b>Invoice:</b> ${esc(s.invoiceNo)}<br><b>Date:</b> ${date(s.saleDate)}<br><b>Salesman:</b> ${esc(profileName(s.salesmanId))}</div><div><b>Customer:</b> ${esc(cust?.shopName||'—')}<br>${esc(cust?.address||'')}<br>${esc(cust?.phone||'')}</div></div><table><thead><tr><th>Product</th><th>Paid Qty</th><th>Free</th><th>Rate</th><th>Total</th></tr></thead><tbody>${(s.items||[]).map(i=>`<tr><td>${esc(i.name)}</td><td>${fmt(i.paidQty)}</td><td>${fmt(i.freeQty)}</td><td>${money(i.unitPrice)}</td><td>${money(i.lineTotal)}</td></tr>`).join('')}</tbody></table><p class="right"><b>Subtotal:</b> ${money(s.subtotal)}<br><b>Discount:</b> ${money(s.discount)}<br><b>Total:</b> ${money(s.total)}<br><b>Paid:</b> ${money(s.paidAmount)}<br><b>Balance:</b> ${money(Number(s.total)-Number(s.paidAmount))}</p></div><div class="actions"><button id="printInvoiceBtn" class="btn primary">Print Invoice</button>${(can('admin','recovery')||can('salesman'))&&Number(s.paidAmount)<Number(s.total)?`<button id="invoiceRecoverBtn" class="btn ghost">Receive Payment</button>`:''}</div>`);
  $('#printInvoiceBtn').onclick=()=>printInvoiceHtml($('#invoicePrintable').innerHTML);
  if($('#invoiceRecoverBtn')) $('#invoiceRecoverBtn').onclick=()=>openRecoveryForm(id);
}
function printInvoiceHtml(html){ const w=window.open('','_blank','width=900,height=750'); if(!w)return toast('Allow popups to print invoices.',true); w.document.write(`<html><head><title>Invoice</title><style>body{font-family:Arial;padding:28px;color:#111}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #bbb;padding:8px;text-align:left}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}.right{text-align:right}</style></head><body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close(); }

function renderCustomers(){
  $('#customersPage').innerHTML=`<div class="section-head"><div><h3>Customers / Pharmacies</h3><div class="muted">${state.customers.length} accessible customer(s)</div></div>${can('admin','salesman')?'<button id="addCustomerBtn" class="btn primary">+ Customer</button>':''}</div><div class="table-wrap"><table class="table"><thead><tr><th>Shop / Pharmacy</th><th>Owner</th><th>Phone</th><th>Route</th><th>Salesman</th><th>Address</th><th></th></tr></thead><tbody>${state.customers.map(c=>`<tr><td><b>${esc(c.shopName)}</b></td><td>${esc(c.ownerName||'')}</td><td>${esc(c.phone||'')}</td><td>${esc(c.routeArea||'')}</td><td>${esc(profileName(c.assignedSalesmanId))}</td><td>${esc(c.address||'')}</td><td>${can('admin')||c.assignedSalesmanId===state.user.uid?`<button class="btn ghost small" data-customer="${c.id}">Edit</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No customers yet.</td></tr>'}</tbody></table></div>`;
  if($('#addCustomerBtn')) $('#addCustomerBtn').onclick=()=>openCustomerForm(); $$('[data-customer]').forEach(b=>b.onclick=()=>openCustomerForm(b.dataset.customer));
}
function openCustomerForm(id=null){
  const c=id?state.customers.find(x=>x.id===id):null; const reps=state.users.filter(u=>u.role==='salesman'&&u.active!==false);
  const assigned=c?.assignedSalesmanId || (can('salesman')?state.user.uid:'');
  showModal(c?'Edit Customer':'Add Customer',`<form id="customerForm" class="form-grid"><label>Shop / Pharmacy Name<input id="cShop" required value="${esc(c?.shopName||'')}"></label><label>Owner / Contact<input id="cOwner" value="${esc(c?.ownerName||'')}"></label><label>Phone<input id="cPhone" value="${esc(c?.phone||'')}"></label><label>Route / Area<input id="cRoute" value="${esc(c?.routeArea||state.me.routeArea||'')}"></label>${can('admin')?`<label>Assigned Salesman<select id="cSalesman" required><option value="">Select</option>${reps.map(r=>`<option value="${r.id}" ${assigned===r.id?'selected':''}>${esc(r.fullName)}</option>`).join('')}</select></label>`:`<input id="cSalesman" type="hidden" value="${state.user.uid}">`}<label class="full">Address<textarea id="cAddress">${esc(c?.address||'')}</textarea></label><div class="full"><button class="btn primary">Save Customer</button></div></form>`);
  $('#customerForm').onsubmit=async e=>{ e.preventDefault(); const data={shopName:$('#cShop').value.trim(),ownerName:$('#cOwner').value.trim(),phone:$('#cPhone').value.trim(),routeArea:$('#cRoute').value.trim(),assignedSalesmanId:$('#cSalesman').value,address:$('#cAddress').value.trim(),active:true,updatedAt:serverTimestamp()}; if(!data.assignedSalesmanId)return toast('Select salesman.',true); try{ if(c) await updateDoc(doc(db,'customers',c.id),data); else await addDoc(collection(db,'customers'),{...data,createdBy:state.user.uid,createdAt:serverTimestamp()}); closeModal();toast('Customer saved.'); }catch(err){toast(err.message,true);} };
}

function renderInventory(){
  if(!can('admin','inventory')) return;
  $('#inventoryPage').innerHTML=`<div class="section-head"><div><h3>Inventory</h3><div class="muted">Live stock shared across all users</div></div><button id="stockAdjustBtn" class="btn primary">+ Stock Movement</button></div><div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Low Alert</th><th>MRP</th><th>Sale Price</th><th>Scheme</th><th></th></tr></thead><tbody>${state.products.map(p=>`<tr><td>${esc(p.sku||'')}</td><td><b>${esc(p.name)}</b></td><td>${fmt(p.stockQty)}</td><td>${fmt(p.lowStockThreshold)}</td><td>${money(p.mrp)}</td><td>${money(p.salePrice)}</td><td>${fmt(p.schemeBuy)}+${fmt(p.schemeFree)}</td><td>${can('admin')?`<button class="btn ghost small" data-product-edit="${p.id}">Edit</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No products. Admin can initialize default data in Settings.</td></tr>'}</tbody></table></div><div class="section-head"><h3>Recent Stock Movements</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty Change</th><th>Balance</th><th>Notes</th></tr></thead><tbody>${state.movements.slice(0,100).map(m=>`<tr><td>${dt(m.createdAt)}</td><td>${esc(m.productName||productName(m.productId))}</td><td>${esc(m.movementType)}</td><td>${fmt(m.qtyChange)}</td><td>${fmt(m.balanceAfter)}</td><td>${esc(m.notes||'')}</td></tr>`).join('')}</tbody></table></div>`;
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
  const rows=accessibleSales().filter(s=>Number(s.paidAmount||0)<Number(s.total||0));
  $('#recoveryPage').innerHTML=`<div class="section-head"><div><h3>${can('salesman')?'My Recovery':'Recovery / Outstanding'}</h3><div class="muted">${rows.length} unpaid/partial invoice(s)</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Customer</th><th>Salesman</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(s.invoiceNo)}</td><td>${esc(customerName(s.customerId))}</td><td>${esc(profileName(s.salesmanId))}</td><td>${money(s.total)}</td><td>${money(s.paidAmount)}</td><td><b>${money(Number(s.total)-Number(s.paidAmount))}</b></td><td><button class="btn primary small" data-recover="${s.id}">Receive</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No outstanding invoices.</td></tr>'}</tbody></table></div><div class="section-head"><h3>Recent Payments</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>${state.payments.slice(0,100).map(p=>`<tr><td>${dt(p.paymentDate)}</td><td>${esc(p.invoiceNo||'')}</td><td>${esc(customerName(p.customerId))}</td><td>${money(p.amount)}</td><td>${esc(p.method||'')}</td><td>${esc(p.reference||'')}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-recover]').forEach(b=>b.onclick=()=>openRecoveryForm(b.dataset.recover));
}
function openRecoveryForm(saleId){
  const s=state.sales.find(x=>x.id===saleId); if(!s)return; if(can('salesman')&&s.salesmanId!==state.user.uid)return toast('This invoice is not assigned to you.',true);
  const balance=Number(s.total||0)-Number(s.paidAmount||0);
  showModal(`Receive Payment — ${s.invoiceNo}`,`<form id="recoveryForm" class="form-grid"><label>Balance<input value="${balance}" disabled></label><label>Amount<input id="rAmount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance}" required></label><label>Method<select id="rMethod"><option value="cash">Cash</option><option value="bank">Bank</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option><option value="cheque">Cheque</option></select></label><label>Reference<input id="rRef"></label><label class="full">Notes<textarea id="rNotes"></textarea></label><div class="full"><button class="btn primary">Save Recovery</button></div></form>`);
  $('#recoveryForm').onsubmit=async e=>{e.preventDefault();const amt=Number($('#rAmount').value||0);if(amt<=0||amt>balance+0.001)return toast('Invalid amount.',true);const sRef=doc(db,'sales',saleId),pRef=doc(collection(db,'payments'));try{await runTransaction(db,async tx=>{const snap=await tx.get(sRef);if(!snap.exists())throw new Error('Invoice not found.');const cur=snap.data(),newPaid=Number(cur.paidAmount||0)+amt;if(newPaid>Number(cur.total||0)+0.001)throw new Error('Payment exceeds current balance.');const now=Timestamp.now();tx.update(sRef,{paidAmount:newPaid,paymentStatus:calcStatus(cur.total,newPaid),updatedAt:now});tx.set(pRef,{saleId,invoiceNo:cur.invoiceNo,customerId:cur.customerId,salesmanId:cur.salesmanId,amount:amt,method:$('#rMethod').value,reference:$('#rRef').value.trim(),notes:$('#rNotes').value.trim(),paymentDate:now,enteredBy:state.user.uid,createdAt:now});});closeModal();toast('Payment recorded.');}catch(err){toast(err.message,true);}};
}

function renderExpenses(){
  if(!can('admin'))return;
  const total=state.expenses.reduce((a,e)=>a+Number(e.amount||0),0);
  $('#expensesPage').innerHTML=`<div class="section-head"><div><h3>Expenses</h3><div class="muted">Loaded total ${money(total)}</div></div><button id="addExpenseBtn" class="btn primary">+ Expense</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${state.expenses.map(e=>`<tr><td>${date(e.expenseDate)}</td><td>${esc(e.category)}</td><td>${esc(e.description||'')}</td><td>${money(e.amount)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No expenses yet.</td></tr>'}</tbody></table></div>`;
  $('#addExpenseBtn').onclick=()=>{showModal('Add Expense',`<form id="expenseForm" class="form-grid"><label>Date<input id="eDate" type="date" value="${todayISO()}"></label><label>Category<select id="eCat"><option>Salary</option><option>Petrol/Transport</option><option>Marketing</option><option>Office</option><option>Recovery Incentive</option><option>Other</option></select></label><label>Amount<input id="eAmount" type="number" min="0.01" step="0.01" required></label><label class="full">Description<textarea id="eDesc"></textarea></label><div class="full"><button class="btn primary">Save Expense</button></div></form>`);$('#expenseForm').onsubmit=async e=>{e.preventDefault();try{await addDoc(collection(db,'expenses'),{expenseDate:tsFromInput($('#eDate').value),category:$('#eCat').value,description:$('#eDesc').value.trim(),amount:Number($('#eAmount').value),enteredBy:state.user.uid,createdAt:serverTimestamp()});closeModal();toast('Expense saved.');}catch(err){toast(err.message,true);}};};
}

function renderReports(){
  if(!can('admin'))return;
  const start=monthStart(), sales=state.sales.filter(s=>(asDate(s.saleDate)||new Date(0))>=start), rev=sales.reduce((a,s)=>a+Number(s.total||0),0), collected=sales.reduce((a,s)=>a+Number(s.paidAmount||0),0), expenses=state.expenses.filter(e=>(asDate(e.expenseDate)||new Date(0))>=start).reduce((a,e)=>a+Number(e.amount||0),0);
  const cogs=sales.reduce((sum,s)=>sum+(s.items||[]).reduce((a,i)=>a+Number(i.costPrice||0)*Number(i.issuedQty||0),0),0);
  $('#reportsPage').innerHTML=`<div class="grid cards"><div class="card stat"><small>Monthly Sales</small><strong>${money(rev)}</strong></div><div class="card stat"><small>Monthly Collection</small><strong>${money(collected)}</strong></div><div class="card stat"><small>Estimated COGS</small><strong>${money(cogs)}</strong><div class="sub">Includes paid + free units at saved cost</div></div><div class="card stat"><small>Monthly Expenses</small><strong>${money(expenses)}</strong></div></div><div class="section-head"><h3>Salesman Summary</h3><div class="actions"><button id="reportCsvBtn" class="btn ghost">Export Sales CSV</button><button id="backupBtn" class="btn ghost">Export JSON Backup</button></div></div>${salesmanSummaryTable(sales)}`;
  $('#reportCsvBtn').onclick=exportSales; $('#backupBtn').onclick=exportBackup;
}
function salesmanSummaryTable(sales){ const reps=state.users.filter(p=>p.role==='salesman'); return `<div class="table-wrap"><table class="table"><thead><tr><th>Salesman</th><th>Route</th><th>Invoices</th><th>Sales</th><th>Collected</th><th>Outstanding</th><th>Target</th><th>%</th></tr></thead><tbody>${reps.map(p=>{const ss=sales.filter(s=>s.salesmanId===p.id),v=ss.reduce((a,s)=>a+Number(s.total||0),0),c=ss.reduce((a,s)=>a+Number(s.paidAmount||0),0),pct=Number(p.monthlyTarget||0)>0?v/Number(p.monthlyTarget)*100:0;return `<tr><td>${esc(p.fullName)}</td><td>${esc(p.routeArea||'')}</td><td>${ss.length}</td><td>${money(v)}</td><td>${money(c)}</td><td>${money(v-c)}</td><td>${money(p.monthlyTarget)}</td><td>${pct.toFixed(1)}%</td></tr>`}).join('')||'<tr><td colspan="8" class="empty">No salesmen.</td></tr>'}</tbody></table></div>`; }
function exportSales(){ const rows=[['Invoice','Date','Customer','Salesman','Total','Paid','Balance','Status'],...state.sales.map(s=>[s.invoiceNo,asDate(s.saleDate)?.toISOString()||'',customerName(s.customerId),profileName(s.salesmanId),s.total,s.paidAmount,Number(s.total)-Number(s.paidAmount),s.paymentStatus])]; const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'); downloadBlob(csv,`naturegen-sales-${todayISO()}.csv`,'text/csv'); }
function exportBackup(){ const clean=(v)=>JSON.parse(JSON.stringify(v,(k,val)=>val?.toDate?val.toDate().toISOString():val)); const data=clean({exportedAt:new Date().toISOString(),settings:state.settings,users:state.users,products:state.products,customers:state.customers,sales:state.sales,payments:state.payments,expenses:state.expenses,stockMovements:state.movements}); downloadBlob(JSON.stringify(data,null,2),`naturegen-backup-${todayISO()}.json`,'application/json'); }
function downloadBlob(content,name,type){ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000); }

function renderUsers(){
  if(!can('admin'))return;
  $('#usersPage').innerHTML=`<div class="section-head"><div><h3>Users & Roles</h3><div class="muted">Create Salesman, Inventory and Recovery logins from here.</div></div><button id="createUserBtn" class="btn primary">+ Create User Login</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Route</th><th>Monthly Target</th><th>Active</th><th></th></tr></thead><tbody>${state.users.map(p=>`<tr><td><b>${esc(p.fullName)}</b></td><td>${esc(p.email||'')}</td><td><span class="badge role-pill">${esc(p.role)}</span></td><td>${esc(p.phone||'')}</td><td>${esc(p.routeArea||'')}</td><td>${money(p.monthlyTarget)}</td><td>${p.active!==false?'Yes':'No'}</td><td><button class="btn ghost small" data-user="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#createUserBtn').onclick=openCreateUserForm; $$('[data-user]').forEach(b=>b.onclick=()=>openUserForm(b.dataset.user));
}
function openCreateUserForm(){
  showModal('Create Staff Login',`<form id="createUserForm" class="form-grid"><label>Full Name<input id="nuName" required></label><label>Email<input id="nuEmail" type="email" required></label><label>Temporary Password<input id="nuPassword" type="password" minlength="6" required></label><label>Role<select id="nuRole"><option value="salesman">Salesman</option><option value="inventory">Inventory / Store</option><option value="recovery">Recovery</option><option value="admin">Admin</option></select></label><label>Phone<input id="nuPhone"></label><label>Route / Area<input id="nuRoute"></label><label>Monthly Target<input id="nuTarget" type="number" min="0" step="0.01" value="0"></label><div class="full help">The user can later use “Forgot password?” on the login screen to set a private password.</div><div class="full"><button class="btn primary">Create Login</button></div></form>`);
  $('#createUserForm').onsubmit=async e=>{e.preventDefault();let secondary=null;try{secondary=initializeApp(C,`staff-${Date.now()}`);const a=getAuth(secondary);const cred=await createUserWithEmailAndPassword(a,$('#nuEmail').value.trim(),$('#nuPassword').value);await setDoc(doc(db,'users',cred.user.uid),{fullName:$('#nuName').value.trim(),email:$('#nuEmail').value.trim().toLowerCase(),role:$('#nuRole').value,phone:$('#nuPhone').value.trim(),routeArea:$('#nuRoute').value.trim(),monthlyTarget:Number($('#nuTarget').value||0),active:true,createdAt:serverTimestamp(),createdBy:state.user.uid,updatedAt:serverTimestamp()});await signOut(a);await deleteApp(secondary);secondary=null;closeModal();toast('Staff login created.');}catch(err){console.error(err);if(secondary)try{await deleteApp(secondary);}catch{}toast(err.message,true);}};
}
function openUserForm(id){
  const p=state.users.find(x=>x.id===id); if(!p)return;
  showModal('Edit User Role',`<form id="userForm" class="form-grid"><label>Full Name<input id="uName" value="${esc(p.fullName||'')}"></label><label>Email<input value="${esc(p.email||'')}" disabled></label><label>Phone<input id="uPhone" value="${esc(p.phone||'')}"></label><label>Role<select id="uRole">${['admin','inventory','salesman','recovery'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join('')}</select></label><label>Route / Area<input id="uRoute" value="${esc(p.routeArea||'')}"></label><label>Monthly Target<input id="uTarget" type="number" min="0" step="0.01" value="${p.monthlyTarget||0}"></label><label>Active<select id="uActive"><option value="true" ${p.active!==false?'selected':''}>Yes</option><option value="false" ${p.active===false?'selected':''}>No</option></select></label><div class="full"><button class="btn primary">Save User</button></div></form>`);
  $('#userForm').onsubmit=async e=>{e.preventDefault();if(id===state.user.uid&&$('#uActive').value==='false')return toast('You cannot deactivate your own admin access.',true);try{await updateDoc(doc(db,'users',id),{fullName:$('#uName').value.trim(),phone:$('#uPhone').value.trim(),role:$('#uRole').value,routeArea:$('#uRoute').value.trim(),monthlyTarget:Number($('#uTarget').value||0),active:$('#uActive').value==='true',updatedAt:serverTimestamp()});closeModal();toast('User updated.');}catch(err){toast(err.message,true);}};
}

function renderSettings(){
  if(!can('admin'))return;
  const s=state.settings||{}, needsSetup=state.products.length===0;
  $('#settingsPage').innerHTML=`${needsSetup?`<div class="card setup-card"><h3>Initial Business Setup</h3><p>Products are empty. Create Naturegen's starting products and stock with one click.</p><button id="seedBtn" class="btn primary">Initialize Aimacid + Iron Data</button></div>`:''}<div class="card" style="max-width:760px;margin-top:16px"><h3>Company Settings</h3><form id="settingsForm" class="form-grid"><label>Company Name<input id="setName" value="${esc(s.companyName||'Naturegen Distribution')}"></label><label>Phone<input id="setPhone" value="${esc(s.phone||'')}"></label><label class="full">Address<textarea id="setAddress">${esc(s.address||'')}</textarea></label><label>Monthly Profit Target<input id="setTarget" type="number" min="0" step="0.01" value="${s.monthlyProfitTarget||100000}"></label><div class="full"><button class="btn primary">Save Settings</button></div></form></div>`;
  if($('#seedBtn')) $('#seedBtn').onclick=seedInitialData;
  $('#settingsForm').onsubmit=async e=>{e.preventDefault();try{await setDoc(doc(db,'settings','company'),{companyName:$('#setName').value.trim(),phone:$('#setPhone').value.trim(),address:$('#setAddress').value.trim(),monthlyProfitTarget:Number($('#setTarget').value||0),updatedAt:serverTimestamp()},{merge:true});toast('Settings saved.');}catch(err){toast(err.message,true);}};
}
async function seedInitialData(){
  if(!can('admin'))return;
  if(state.products.length) return toast('Products already exist; setup was not repeated.',true);
  const batch=writeBatch(db), now=serverTimestamp();
  const p1=doc(collection(db,'products')),p2=doc(collection(db,'products'));
  batch.set(p1,{sku:'AIMACID-120',name:'Aimacid Syrup 120 ml',mrp:190,salePrice:65,costPrice:35,stockQty:10400,lowStockThreshold:500,schemeBuy:10,schemeFree:1,active:true,createdAt:now,updatedAt:now});
  batch.set(p2,{sku:'IRON-120',name:'Iron Syrup 120 ml',mrp:0,salePrice:90,costPrice:35,stockQty:2600,lowStockThreshold:200,schemeBuy:10,schemeFree:1,active:true,createdAt:now,updatedAt:now});
  batch.set(doc(db,'counters','invoice'),{next:1},{merge:true});
  batch.set(doc(db,'settings','company'),{companyName:'Naturegen Distribution',monthlyProfitTarget:100000,updatedAt:now},{merge:true});
  const m1=doc(collection(db,'stockMovements')),m2=doc(collection(db,'stockMovements'));
  batch.set(m1,{productId:p1.id,productName:'Aimacid Syrup 120 ml',movementType:'opening',qtyChange:10400,balanceAfter:10400,refType:'opening',refId:'',notes:'Initial opening stock',enteredBy:state.user.uid,createdAt:now});
  batch.set(m2,{productId:p2.id,productName:'Iron Syrup 120 ml',movementType:'opening',qtyChange:2600,balanceAfter:2600,refType:'opening',refId:'',notes:'Initial opening stock',enteredBy:state.user.uid,createdAt:now});
  try{await batch.commit();toast('Initial Naturegen data created.');}catch(err){toast(err.message,true);}
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
