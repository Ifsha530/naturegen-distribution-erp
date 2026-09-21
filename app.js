(() => {
  'use strict';

  const C = window.NATUREGEN_CONFIG || {};
  const configured = C.SUPABASE_URL && C.SUPABASE_KEY && !C.SUPABASE_URL.includes('PASTE_') && !C.SUPABASE_KEY.includes('PASTE_');
  const sb = configured ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fmt = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number(n || 0));
  const money = (n) => `Rs. ${fmt(n)}`;
  const date = (v) => v ? new Date(v).toLocaleDateString('en-PK') : '';
  const dt = (v) => v ? new Date(v).toLocaleString('en-PK') : '';
  const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

  const state = { session:null, me:null, products:[], customers:[], profiles:[], sales:[], payments:[], expenses:[], movements:[], settings:null, channel:null, page:'dashboard' };

  function toast(msg, error=false){ const el=$('#toast'); el.textContent=msg; el.className=`toast show${error?' error':''}`; clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',3200); }
  function showModal(title, html){ $('#modalTitle').textContent=title; $('#modalBody').innerHTML=html; $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false'); }
  function closeModal(){ $('#modal').classList.add('hidden'); $('#modal').setAttribute('aria-hidden','true'); }
  function role(){ return state.me?.role || ''; }
  function can(...roles){ return roles.includes(role()); }
  function profileName(id){ return state.profiles.find(x=>x.id===id)?.full_name || '—'; }
  function customerName(id){ return state.customers.find(x=>x.id===id)?.shop_name || '—'; }
  function productName(id){ return state.products.find(x=>x.id===id)?.name || '—'; }
  function badgeStatus(s){ const cls=s==='paid'?'ok':s==='partial'?'warn':'danger'; return `<span class="badge ${cls}">${esc(s)}</span>`; }
  function setSync(text){ $('#syncStatus').textContent=text; }

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
  function go(page){ state.page=page; $$('.page').forEach(p=>p.classList.add('hidden')); $(`#${page}Page`)?.classList.remove('hidden'); $('#pageTitle').textContent=(navByRole[role()]||[]).find(x=>x[0]===page)?.[1]||'Naturegen'; renderNav(); renderPage(); }
  function renderPage(){
    const fn={dashboard:renderDashboard,sales:renderSales,customers:renderCustomers,inventory:renderInventory,recovery:renderRecovery,expenses:renderExpenses,reports:renderReports,users:renderUsers,settings:renderSettings}[state.page];
    if(fn) fn();
  }

  async function query(table, opts={}){
    let q=sb.from(table).select(opts.select||'*');
    if(opts.order) q=q.order(opts.order.col,{ascending:opts.order.asc??false});
    if(opts.limit) q=q.limit(opts.limit);
    const {data,error}=await q; if(error) throw error; return data||[];
  }

  async function loadAll(){
    if(!sb || !state.session) return;
    setSync('Syncing cloud data…');
    try{
      const meRes=await sb.from('profiles').select('*').eq('id',state.session.user.id).single();
      if(meRes.error) throw meRes.error; state.me=meRes.data;
      const core=await Promise.all([
        query('products',{order:{col:'name',asc:true}}), query('customers',{order:{col:'shop_name',asc:true}}), query('profiles',{order:{col:'full_name',asc:true}}),
        query('sales',{order:{col:'sale_date',asc:false},limit:1000}), query('payments',{order:{col:'payment_date',asc:false},limit:1500}), query('app_settings',{limit:1})
      ]);
      [state.products,state.customers,state.profiles,state.sales,state.payments]=core;
      state.settings=core[5][0]||null;
      if(can('admin')) state.expenses=await query('expenses',{order:{col:'expense_date',asc:false},limit:1000});
      if(can('admin','inventory')) state.movements=await query('stock_movements',{order:{col:'created_at',asc:false},limit:1000});
      $('#userName').textContent=state.me.full_name||state.session.user.email;
      $('#userRole').textContent=state.me.role;
      renderNav(); renderPage(); setSync(`Live • ${new Date().toLocaleTimeString('en-PK')}`);
      subscribeRealtime();
    }catch(e){ console.error(e); toast(e.message||'Could not load cloud data',true); setSync('Sync error'); }
  }

  function subscribeRealtime(){
    if(state.channel) return;
    state.channel=sb.channel('naturegen-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'products'},()=>debouncedReload())
      .on('postgres_changes',{event:'*',schema:'public',table:'sales'},()=>debouncedReload())
      .on('postgres_changes',{event:'*',schema:'public',table:'payments'},()=>debouncedReload())
      .on('postgres_changes',{event:'*',schema:'public',table:'customers'},()=>debouncedReload())
      .subscribe(s=>setSync(s==='SUBSCRIBED'?'Live connected':`Realtime: ${s}`));
  }
  let reloadTimer; function debouncedReload(){ clearTimeout(reloadTimer); reloadTimer=setTimeout(loadAll,500); }

  function renderDashboard(){
    const start=monthStart(); const sales=state.sales.filter(s=>new Date(s.sale_date)>=start);
    const total=sales.reduce((a,s)=>a+Number(s.total),0); const collected=sales.reduce((a,s)=>a+Number(s.paid_amount),0);
    const outstanding=state.sales.reduce((a,s)=>a+Math.max(0,Number(s.total)-Number(s.paid_amount)),0);
    const stock=state.products.reduce((a,p)=>a+Number(p.stock_qty),0);
    const low=state.products.filter(p=>p.active && p.stock_qty<=p.low_stock_threshold);
    const page=$('#dashboardPage');
    let perf='';
    if(can('admin')){
      const reps=state.profiles.filter(p=>p.role==='salesman'&&p.active);
      perf=`<div class="section-head"><h3>Salesman Performance — This Month</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Salesman</th><th>Route</th><th>Invoices</th><th>Sales</th><th>Recovery</th><th>Outstanding</th><th>Target</th><th>Achievement</th></tr></thead><tbody>${reps.map(p=>{
        const ss=sales.filter(s=>s.salesman_id===p.id), st=ss.reduce((a,s)=>a+Number(s.total),0), rec=ss.reduce((a,s)=>a+Number(s.paid_amount),0), out=ss.reduce((a,s)=>a+Number(s.total)-Number(s.paid_amount),0), pct=p.monthly_target>0?Math.min(100,st/Number(p.monthly_target)*100):0;
        return `<tr><td><b>${esc(p.full_name)}</b></td><td>${esc(p.route_area||'—')}</td><td>${ss.length}</td><td>${money(st)}</td><td>${money(rec)}</td><td>${money(out)}</td><td>${money(p.monthly_target)}</td><td><div>${pct.toFixed(1)}%</div><div class="progress"><span style="width:${pct}%"></span></div></td></tr>`;
      }).join('')||'<tr><td colspan="8" class="empty">No salesman users yet.</td></tr>'}</tbody></table></div>`;
    }
    page.innerHTML=`
      <div class="grid cards">
        <div class="card stat"><small>${can('salesman')?'My ':''}Sales This Month</small><strong>${money(total)}</strong><div class="sub">${sales.length} invoice(s)</div></div>
        <div class="card stat"><small>Collected This Month</small><strong>${money(collected)}</strong><div class="sub">From accessible invoices</div></div>
        <div class="card stat"><small>Outstanding</small><strong>${money(outstanding)}</strong><div class="sub">Current receivables</div></div>
        <div class="card stat"><small>Total Stock Units</small><strong>${fmt(stock)}</strong><div class="sub">${low.length} low-stock product(s)</div></div>
      </div>
      ${low.length?`<div class="section-head"><h3>Low Stock Alerts</h3></div><div class="grid">${low.map(p=>`<div class="card"><b>${esc(p.name)}</b><div class="kpi-line"><span>Available</span><strong>${fmt(p.stock_qty)}</strong></div><div class="kpi-line"><span>Alert level</span><span>${fmt(p.low_stock_threshold)}</span></div></div>`).join('')}</div>`:''}
      ${perf}
      <div class="section-head"><h3>Recent Invoices</h3></div>${salesTable(state.sales.slice(0,8),false)}
    `;
  }

  function salesTable(rows,actions=true){
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Salesman</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th>${actions?'<th></th>':''}</tr></thead><tbody>${rows.map(s=>`<tr><td><b>${esc(s.invoice_no)}</b></td><td>${date(s.sale_date)}</td><td>${esc(customerName(s.customer_id))}</td><td>${esc(profileName(s.salesman_id))}</td><td>${money(s.total)}</td><td>${money(s.paid_amount)}</td><td>${money(Number(s.total)-Number(s.paid_amount))}</td><td>${badgeStatus(s.payment_status)}</td>${actions?`<td><button class="btn ghost small" data-invoice="${s.id}">View</button></td>`:''}</tr>`).join('')||`<tr><td colspan="${actions?9:8}" class="empty">No invoices found.</td></tr>`}</tbody></table></div>`;
  }

  function renderSales(){
    const page=$('#salesPage');
    page.innerHTML=`<div class="section-head"><div><h3>Sales & Invoices</h3><div class="muted">Live cloud invoices</div></div><div class="actions">${can('admin','salesman')?'<button id="newSaleBtn" class="btn primary">+ New Sale</button>':''}<button id="salesCsvBtn" class="btn ghost">Export CSV</button></div></div>
    <div class="filters"><input id="salesSearch" placeholder="Search invoice/customer"><select id="salesStatus"><option value="">All status</option><option>unpaid</option><option>partial</option><option>paid</option></select>${can('admin','inventory','recovery')?`<select id="salesRep"><option value="">All salesmen</option>${state.profiles.filter(p=>['salesman','admin'].includes(p.role)).map(p=>`<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select>`:''}</div><div id="salesTableBox" style="margin-top:10px">${salesTable(state.sales)}</div>`;
    $('#newSaleBtn')?.addEventListener('click',openSaleForm); $('#salesCsvBtn').onclick=exportSales;
    ['#salesSearch','#salesStatus','#salesRep'].forEach(sel=>$(sel)?.addEventListener('input',filterSales)); bindInvoiceButtons();
  }
  function filterSales(){ const q=($('#salesSearch')?.value||'').toLowerCase(), st=$('#salesStatus')?.value||'', rep=$('#salesRep')?.value||''; const rows=state.sales.filter(s=>(!st||s.payment_status===st)&&(!rep||s.salesman_id===rep)&&(!q||s.invoice_no.toLowerCase().includes(q)||customerName(s.customer_id).toLowerCase().includes(q))); $('#salesTableBox').innerHTML=salesTable(rows); bindInvoiceButtons(); }
  function bindInvoiceButtons(){ $$('[data-invoice]').forEach(b=>b.onclick=()=>viewInvoice(b.dataset.invoice)); }

  function openSaleForm(){
    if(!state.products.filter(p=>p.active).length||!state.customers.filter(c=>c.active).length){ toast('Add at least one active product and customer first.',true); return; }
    showModal('New Sale / Invoice',`<form id="saleForm" class="stack"><div class="form-grid">
      <label>Customer<select id="saleCustomer" required>${state.customers.filter(c=>c.active).map(c=>`<option value="${c.id}">${esc(c.shop_name)} — ${esc(c.area||'')}</option>`).join('')}</select></label>
      ${can('admin')?`<label>Salesman<select id="saleSalesman">${state.profiles.filter(p=>p.active&&['salesman','admin'].includes(p.role)).map(p=>`<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select></label>`:`<label>Salesman<input value="${esc(state.me.full_name)}" disabled></label>`}
      <label>Discount (Rs.)<input id="saleDiscount" type="number" min="0" step="0.01" value="0"></label>
      <label>Initial Payment (Rs.)<input id="salePaid" type="number" min="0" step="0.01" value="0"></label>
      <label>Payment Method<select id="saleMethod"><option>cash</option><option>bank</option><option>easypaisa</option><option>jazzcash</option><option>cheque</option></select></label>
      <label class="full">Notes<textarea id="saleNotes"></textarea></label>
    </div><div class="section-head"><h3>Items</h3><button type="button" id="addSaleRow" class="btn ghost small">+ Add Item</button></div><div id="saleRows"></div><div id="salePreview" class="card"></div><button class="btn primary" type="submit">Save Sale & Deduct Stock</button></form>`);
    const add=()=>{ const div=document.createElement('div'); div.className='form-grid sale-row'; div.style.marginBottom='10px'; div.innerHTML=`<label>Product<select class="sr-product">${state.products.filter(p=>p.active).map(p=>`<option value="${p.id}">${esc(p.name)} | Stock ${p.stock_qty}</option>`).join('')}</select></label><label>Paid Qty<input class="sr-qty" type="number" min="1" value="10"></label><label>Unit Price<input class="sr-price" type="number" min="0" step="0.01"></label><label>&nbsp;<button type="button" class="btn danger sr-remove">Remove</button></label>`; $('#saleRows').appendChild(div); const p=state.products.find(x=>x.id===div.querySelector('.sr-product').value); div.querySelector('.sr-price').value=p?.sale_price||0; div.querySelector('.sr-product').onchange=e=>{div.querySelector('.sr-price').value=state.products.find(x=>x.id===e.target.value)?.sale_price||0; preview();}; div.querySelector('.sr-remove').onclick=()=>{div.remove();preview();}; div.querySelectorAll('input').forEach(i=>i.oninput=preview); preview(); };
    const preview=()=>{ let sub=0, free=0, units=0; $$('.sale-row').forEach(r=>{const p=state.products.find(x=>x.id===r.querySelector('.sr-product').value), q=Number(r.querySelector('.sr-qty').value||0), pr=Number(r.querySelector('.sr-price').value||0), f=p&&p.scheme_buy>0?Math.floor(q/p.scheme_buy)*p.scheme_free:0; sub+=q*pr;free+=f;units+=q;}); const dis=Number($('#saleDiscount').value||0); $('#salePreview').innerHTML=`<div class="kpi-line"><span>Paid units</span><b>${units}</b></div><div class="kpi-line"><span>Free scheme units</span><b>${free}</b></div><div class="kpi-line"><span>Invoice total</span><b>${money(Math.max(0,sub-dis))}</b></div>`; };
    $('#addSaleRow').onclick=add; $('#saleDiscount').oninput=preview; add();
    $('#saleForm').onsubmit=async e=>{e.preventDefault(); const items=$$('.sale-row').map(r=>({product_id:r.querySelector('.sr-product').value,qty:Number(r.querySelector('.sr-qty').value),unit_price:Number(r.querySelector('.sr-price').value)})); if(!items.length){toast('Add at least one item.',true);return;} try{ const {data,error}=await sb.rpc('create_sale',{p_customer_id:$('#saleCustomer').value,p_items:items,p_discount:Number($('#saleDiscount').value||0),p_initial_payment:Number($('#salePaid').value||0),p_payment_method:$('#saleMethod').value,p_notes:$('#saleNotes').value||null,p_salesman_id:can('admin')?$('#saleSalesman').value:null}); if(error) throw error; closeModal(); toast(`Invoice ${data?.[0]?.invoice_no||''} saved.`); await loadAll(); }catch(err){toast(err.message,true);} };
  }

  async function viewInvoice(id){
    const s=state.sales.find(x=>x.id===id); if(!s)return;
    const {data:items,error}=await sb.from('sale_items').select('*').eq('sale_id',id); if(error){toast(error.message,true);return;}
    const c=state.customers.find(x=>x.id===s.customer_id)||{};
    const html=`<div id="invoiceView" class="invoice"><h2>${esc(state.settings?.company_name||'Naturegen Distribution')}</h2><p>${esc(state.settings?.address||'')}</p><p>${esc(state.settings?.phone||'')}</p><hr><div class="two-col"><div><b>Invoice:</b> ${esc(s.invoice_no)}<br><b>Date:</b> ${dt(s.sale_date)}<br><b>Salesman:</b> ${esc(profileName(s.salesman_id))}</div><div><b>Customer:</b> ${esc(c.shop_name||'')}<br><b>Owner:</b> ${esc(c.owner_name||'')}<br><b>Area:</b> ${esc(c.area||'')}<br><b>Phone:</b> ${esc(c.phone||'')}</div></div><table><thead><tr><th>Product</th><th>Paid Qty</th><th>Free</th><th>Price</th><th>Total</th></tr></thead><tbody>${(items||[]).map(i=>`<tr><td>${esc(productName(i.product_id))}</td><td>${i.qty_paid}</td><td>${i.qty_free}</td><td>${money(i.unit_price)}</td><td>${money(i.line_total)}</td></tr>`).join('')}</tbody></table><div style="margin-left:auto;width:280px;margin-top:14px"><div class="kpi-line"><span>Subtotal</span><b>${money(s.subtotal)}</b></div><div class="kpi-line"><span>Discount</span><b>${money(s.discount)}</b></div><div class="kpi-line"><span>Total</span><b>${money(s.total)}</b></div><div class="kpi-line"><span>Paid</span><b>${money(s.paid_amount)}</b></div><div class="kpi-line"><span>Balance</span><b>${money(Number(s.total)-Number(s.paid_amount))}</b></div></div></div><div class="actions" style="margin-top:16px"><button id="printInvoiceBtn" class="btn primary">Print Invoice</button>${Number(s.total)>Number(s.paid_amount)&&can('admin','recovery','salesman')?'<button id="recoverFromInvoiceBtn" class="btn ghost">Record Payment</button>':''}</div>`;
    showModal(`Invoice ${s.invoice_no}`,html); $('#printInvoiceBtn').onclick=()=>printInvoice($('#invoiceView').innerHTML); $('#recoverFromInvoiceBtn')?.addEventListener('click',()=>openRecoveryForm(s.id));
  }
  function printInvoice(content){ const w=window.open('','_blank'); w.document.write(`<html><head><title>Invoice</title><style>body{font-family:Arial;padding:25px;color:#111}table{width:100%;border-collapse:collapse;margin-top:15px}th,td{border:1px solid #bbb;padding:7px}.two-col{display:grid;grid-template-columns:1fr 1fr}.kpi-line{display:flex;justify-content:space-between;margin:5px}</style></head><body>${content}</body></html>`); w.document.close(); w.focus(); w.print(); }

  function renderCustomers(){
    const page=$('#customersPage'); const rows=state.customers.filter(c=>!can('salesman')||c.assigned_salesman===state.me.id);
    page.innerHTML=`<div class="section-head"><div><h3>Customers / Pharmacies</h3><div class="muted">${rows.length} customer(s)</div></div>${can('admin','salesman')?'<button id="newCustomerBtn" class="btn primary">+ Add Customer</button>':''}</div><div class="table-wrap"><table class="table"><thead><tr><th>Shop</th><th>Owner</th><th>Phone</th><th>Area</th><th>Salesman</th><th>Credit Limit</th></tr></thead><tbody>${rows.map(c=>`<tr><td><b>${esc(c.shop_name)}</b></td><td>${esc(c.owner_name||'—')}</td><td>${esc(c.phone||'—')}</td><td>${esc(c.area||'—')}</td><td>${esc(profileName(c.assigned_salesman))}</td><td>${money(c.credit_limit)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No customers yet.</td></tr>'}</tbody></table></div>`;
    $('#newCustomerBtn')?.addEventListener('click',openCustomerForm);
  }
  function openCustomerForm(){ showModal('Add Customer / Pharmacy',`<form id="customerForm" class="form-grid"><label>Shop / Pharmacy Name<input id="cShop" required></label><label>Owner Name<input id="cOwner"></label><label>Phone<input id="cPhone"></label><label>Area / Route<input id="cArea"></label><label class="full">Address<textarea id="cAddress"></textarea></label><label>Credit Limit<input id="cLimit" type="number" min="0" value="0"></label>${can('admin')?`<label>Assigned Salesman<select id="cRep"><option value="">Unassigned</option>${state.profiles.filter(p=>p.active&&p.role==='salesman').map(p=>`<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select></label>`:''}<div class="full"><button class="btn primary" type="submit">Save Customer</button></div></form>`); $('#customerForm').onsubmit=async e=>{e.preventDefault(); const payload={shop_name:$('#cShop').value,owner_name:$('#cOwner').value||null,phone:$('#cPhone').value||null,area:$('#cArea').value||null,address:$('#cAddress').value||null,credit_limit:Number($('#cLimit').value||0),assigned_salesman:can('admin')?($('#cRep').value||null):state.me.id,created_by:state.me.id}; const {error}=await sb.from('customers').insert(payload); if(error)return toast(error.message,true); closeModal();toast('Customer added.');loadAll();}; }

  function renderInventory(){
    const page=$('#inventoryPage');
    page.innerHTML=`<div class="section-head"><div><h3>Products & Live Stock</h3><div class="muted">Stock is shared across all computers</div></div><div class="actions">${can('admin')?'<button id="addProductBtn" class="btn ghost">+ Product</button>':''}${can('admin','inventory')?'<button id="stockBtn" class="btn primary">Stock In / Adjustment</button>':''}</div></div><div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Sale Price</th><th>Cost</th><th>MRP</th><th>Scheme</th><th>Alert</th></tr></thead><tbody>${state.products.map(p=>`<tr><td>${esc(p.sku)}</td><td><b>${esc(p.name)}</b></td><td><span class="badge ${p.stock_qty<=p.low_stock_threshold?'danger':'ok'}">${fmt(p.stock_qty)}</span></td><td>${money(p.sale_price)}</td><td>${money(p.cost_price)}</td><td>${money(p.mrp)}</td><td>${p.scheme_buy}+${p.scheme_free}</td><td>${fmt(p.low_stock_threshold)}</td></tr>`).join('')}</tbody></table></div>${can('admin','inventory')?`<div class="section-head"><h3>Recent Stock Movements</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Change</th><th>Balance</th><th>Notes</th></tr></thead><tbody>${state.movements.slice(0,30).map(m=>`<tr><td>${dt(m.created_at)}</td><td>${esc(productName(m.product_id))}</td><td>${esc(m.movement_type)}</td><td>${m.qty_change>0?'+':''}${m.qty_change}</td><td>${m.balance_after}</td><td>${esc(m.notes||'')}</td></tr>`).join('')}</tbody></table></div>`:''}`;
    $('#stockBtn')?.addEventListener('click',openStockForm); $('#addProductBtn')?.addEventListener('click',openProductForm);
  }
  function openStockForm(){ showModal('Stock In / Adjustment',`<form id="stockForm" class="form-grid"><label>Product<select id="stProduct">${state.products.map(p=>`<option value="${p.id}">${esc(p.name)} — current ${p.stock_qty}</option>`).join('')}</select></label><label>Movement Type<select id="stType"><option value="production">Production Received</option><option value="purchase">Purchase</option><option value="return">Return In</option><option value="damage">Damage / Loss</option><option value="adjustment">Adjustment</option></select></label><label>Quantity Change<input id="stQty" type="number" required placeholder="+100 or -5"></label><label class="full">Notes<textarea id="stNotes"></textarea></label><div class="full"><button class="btn primary">Update Stock</button></div></form>`); $('#stockForm').onsubmit=async e=>{e.preventDefault(); let q=Number($('#stQty').value); if($('#stType').value==='damage'&&q>0)q=-q; const {error}=await sb.rpc('adjust_stock',{p_product_id:$('#stProduct').value,p_qty_change:q,p_movement_type:$('#stType').value,p_notes:$('#stNotes').value||null}); if(error)return toast(error.message,true);closeModal();toast('Stock updated.');loadAll();}; }
  function openProductForm(){ showModal('Add Product',`<form id="productForm" class="form-grid"><label>SKU<input id="pSku" required></label><label>Product Name<input id="pName" required></label><label>MRP<input id="pMrp" type="number" min="0" step="0.01" value="0"></label><label>Sale Price<input id="pSale" type="number" min="0" step="0.01" value="0"></label><label>Cost Price<input id="pCost" type="number" min="0" step="0.01" value="0"></label><label>Low Stock Alert<input id="pLow" type="number" min="0" value="100"></label><label>Scheme Buy<input id="pBuy" type="number" min="0" value="10"></label><label>Scheme Free<input id="pFree" type="number" min="0" value="1"></label><div class="full"><button class="btn primary">Add Product</button></div></form>`); $('#productForm').onsubmit=async e=>{e.preventDefault(); const {error}=await sb.from('products').insert({sku:$('#pSku').value,name:$('#pName').value,mrp:Number($('#pMrp').value),sale_price:Number($('#pSale').value),cost_price:Number($('#pCost').value),stock_qty:0,low_stock_threshold:Number($('#pLow').value),scheme_buy:Number($('#pBuy').value),scheme_free:Number($('#pFree').value)}); if(error)return toast(error.message,true);closeModal();toast('Product added. Use Stock In to add quantity.');loadAll();}; }

  function renderRecovery(){
    const due=state.sales.filter(s=>Number(s.total)>Number(s.paid_amount));
    $('#recoveryPage').innerHTML=`<div class="section-head"><div><h3>Recovery / Outstanding</h3><div class="muted">${due.length} invoice(s) with balance</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Invoice</th><th>Customer</th><th>Salesman</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>${due.map(s=>`<tr><td>${esc(s.invoice_no)}</td><td>${esc(customerName(s.customer_id))}</td><td>${esc(profileName(s.salesman_id))}</td><td>${money(s.total)}</td><td>${money(s.paid_amount)}</td><td><b>${money(Number(s.total)-Number(s.paid_amount))}</b></td><td>${can('admin','recovery')||s.salesman_id===state.me.id?`<button class="btn primary small" data-recover="${s.id}">Receive</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No outstanding invoices.</td></tr>'}</tbody></table></div><div class="section-head"><h3>Recent Payments</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Amount</th><th>Method</th><th>Collected By</th></tr></thead><tbody>${state.payments.slice(0,50).map(p=>{const s=state.sales.find(x=>x.id===p.sale_id);return `<tr><td>${dt(p.payment_date)}</td><td>${esc(s?.invoice_no||'—')}</td><td>${esc(customerName(p.customer_id))}</td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(profileName(p.collected_by))}</td></tr>`}).join('')}</tbody></table></div>`;
    $$('[data-recover]').forEach(b=>b.onclick=()=>openRecoveryForm(b.dataset.recover));
  }
  function openRecoveryForm(saleId){ const s=state.sales.find(x=>x.id===saleId); if(!s)return; const balance=Number(s.total)-Number(s.paid_amount); showModal(`Receive Payment — ${s.invoice_no}`,`<form id="recoveryForm" class="form-grid"><label>Balance<input value="${balance}" disabled></label><label>Amount<input id="rAmount" type="number" min="0.01" max="${balance}" step="0.01" value="${balance}" required></label><label>Method<select id="rMethod"><option>cash</option><option>bank</option><option>easypaisa</option><option>jazzcash</option><option>cheque</option></select></label><label>Reference<input id="rRef"></label><label class="full">Notes<textarea id="rNotes"></textarea></label><div class="full"><button class="btn primary">Save Recovery</button></div></form>`); $('#recoveryForm').onsubmit=async e=>{e.preventDefault();const {error}=await sb.rpc('record_payment',{p_sale_id:saleId,p_amount:Number($('#rAmount').value),p_method:$('#rMethod').value,p_reference:$('#rRef').value||null,p_notes:$('#rNotes').value||null});if(error)return toast(error.message,true);closeModal();toast('Payment recorded.');loadAll();}; }

  function renderExpenses(){ if(!can('admin'))return; const total=state.expenses.reduce((a,e)=>a+Number(e.amount),0); $('#expensesPage').innerHTML=`<div class="section-head"><div><h3>Expenses</h3><div class="muted">Loaded total ${money(total)}</div></div><button id="addExpenseBtn" class="btn primary">+ Expense</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${state.expenses.map(e=>`<tr><td>${date(e.expense_date)}</td><td>${esc(e.category)}</td><td>${esc(e.description||'')}</td><td>${money(e.amount)}</td></tr>`).join('')}</tbody></table></div>`; $('#addExpenseBtn').onclick=()=>{showModal('Add Expense',`<form id="expenseForm" class="form-grid"><label>Date<input id="eDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label><label>Category<select id="eCat"><option>Salary</option><option>Petrol/Transport</option><option>Marketing</option><option>Office</option><option>Recovery Incentive</option><option>Other</option></select></label><label>Amount<input id="eAmount" type="number" min="0.01" step="0.01" required></label><label class="full">Description<textarea id="eDesc"></textarea></label><div class="full"><button class="btn primary">Save Expense</button></div></form>`);$('#expenseForm').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('expenses').insert({expense_date:$('#eDate').value,category:$('#eCat').value,description:$('#eDesc').value||null,amount:Number($('#eAmount').value),entered_by:state.me.id});if(error)return toast(error.message,true);closeModal();toast('Expense saved.');loadAll();};}; }

  function renderReports(){ if(!can('admin'))return; const start=monthStart(), sales=state.sales.filter(s=>new Date(s.sale_date)>=start), rev=sales.reduce((a,s)=>a+Number(s.total),0), collected=sales.reduce((a,s)=>a+Number(s.paid_amount),0), expenses=state.expenses.filter(e=>new Date(e.expense_date)>=start).reduce((a,e)=>a+Number(e.amount),0); let cogs=0; // approximate from current product cost * paid qty fetched only on demand, so report labels this as contribution before COGS.
    $('#reportsPage').innerHTML=`<div class="grid cards"><div class="card stat"><small>Monthly Sales</small><strong>${money(rev)}</strong></div><div class="card stat"><small>Monthly Collection</small><strong>${money(collected)}</strong></div><div class="card stat"><small>Monthly Expenses</small><strong>${money(expenses)}</strong></div><div class="card stat"><small>Cash Contribution*</small><strong>${money(collected-expenses)}</strong><div class="sub">*Collection minus expenses; not accounting profit</div></div></div><div class="section-head"><h3>Salesman Summary</h3><button id="reportCsvBtn" class="btn ghost">Export Sales CSV</button></div>${can('admin')?salesmanSummaryTable(sales):''}`; $('#reportCsvBtn').onclick=exportSales;
  }
  function salesmanSummaryTable(sales){ const reps=state.profiles.filter(p=>p.role==='salesman'); return `<div class="table-wrap"><table class="table"><thead><tr><th>Salesman</th><th>Route</th><th>Invoices</th><th>Sales</th><th>Collected</th><th>Outstanding</th><th>Target</th><th>%</th></tr></thead><tbody>${reps.map(p=>{const ss=sales.filter(s=>s.salesman_id===p.id),v=ss.reduce((a,s)=>a+Number(s.total),0),c=ss.reduce((a,s)=>a+Number(s.paid_amount),0),pct=Number(p.monthly_target)>0?v/Number(p.monthly_target)*100:0;return `<tr><td>${esc(p.full_name)}</td><td>${esc(p.route_area||'')}</td><td>${ss.length}</td><td>${money(v)}</td><td>${money(c)}</td><td>${money(v-c)}</td><td>${money(p.monthly_target)}</td><td>${pct.toFixed(1)}%</td></tr>`}).join('')}</tbody></table></div>`; }
  function exportSales(){ const rows=[['Invoice','Date','Customer','Salesman','Total','Paid','Balance','Status'],...state.sales.map(s=>[s.invoice_no,new Date(s.sale_date).toISOString(),customerName(s.customer_id),profileName(s.salesman_id),s.total,s.paid_amount,Number(s.total)-Number(s.paid_amount),s.payment_status])]; const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'); const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`naturegen-sales-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href); }

  function renderUsers(){ if(!can('admin'))return; $('#usersPage').innerHTML=`<div class="section-head"><div><h3>Users & Roles</h3><div class="muted">Create Auth users in Supabase, then assign their role here.</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Route</th><th>Monthly Target</th><th>Active</th><th></th></tr></thead><tbody>${state.profiles.map(p=>`<tr><td><b>${esc(p.full_name)}</b></td><td><span class="badge">${esc(p.role)}</span></td><td>${esc(p.phone||'')}</td><td>${esc(p.route_area||'')}</td><td>${money(p.monthly_target)}</td><td>${p.active?'Yes':'No'}</td><td><button class="btn ghost small" data-user="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`; $$('[data-user]').forEach(b=>b.onclick=()=>openUserForm(b.dataset.user)); }
  function openUserForm(id){ const p=state.profiles.find(x=>x.id===id); showModal('Edit User Role',`<form id="userForm" class="form-grid"><label>Full Name<input id="uName" value="${esc(p.full_name)}"></label><label>Phone<input id="uPhone" value="${esc(p.phone||'')}"></label><label>Role<select id="uRole">${['admin','inventory','salesman','recovery'].map(r=>`<option ${p.role===r?'selected':''}>${r}</option>`).join('')}</select></label><label>Route / Area<input id="uRoute" value="${esc(p.route_area||'')}"></label><label>Monthly Target<input id="uTarget" type="number" min="0" step="0.01" value="${p.monthly_target||0}"></label><label>Active<select id="uActive"><option value="true" ${p.active?'selected':''}>Yes</option><option value="false" ${!p.active?'selected':''}>No</option></select></label><div class="full"><button class="btn primary">Save User</button></div></form>`); $('#userForm').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('profiles').update({full_name:$('#uName').value,phone:$('#uPhone').value||null,role:$('#uRole').value,route_area:$('#uRoute').value||null,monthly_target:Number($('#uTarget').value||0),active:$('#uActive').value==='true'}).eq('id',id);if(error)return toast(error.message,true);closeModal();toast('User updated.');loadAll();}; }

  function renderSettings(){ if(!can('admin'))return; const s=state.settings||{}; $('#settingsPage').innerHTML=`<div class="card" style="max-width:720px"><h3>Company Settings</h3><form id="settingsForm" class="form-grid"><label>Company Name<input id="setName" value="${esc(s.company_name||'Naturegen Distribution')}"></label><label>Phone<input id="setPhone" value="${esc(s.phone||'')}"></label><label class="full">Address<textarea id="setAddress">${esc(s.address||'')}</textarea></label><label>Monthly Profit Target<input id="setTarget" type="number" min="0" step="0.01" value="${s.monthly_profit_target||100000}"></label><div class="full"><button class="btn primary">Save Settings</button></div></form></div>`; $('#settingsForm').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('app_settings').update({company_name:$('#setName').value,phone:$('#setPhone').value||null,address:$('#setAddress').value||null,monthly_profit_target:Number($('#setTarget').value||0),updated_at:new Date().toISOString()}).eq('id',1);if(error)return toast(error.message,true);toast('Settings saved.');loadAll();}; }

  function showLogin(){ $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }
  function showApp(){ $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }

  async function init(){
    if(!configured){ $('#configWarning').classList.remove('hidden'); return; }
    const {data}=await sb.auth.getSession(); state.session=data.session;
    if(state.session){ showApp(); await loadAll(); } else showLogin();
    sb.auth.onAuthStateChange((_e,session)=>{ state.session=session; if(session){showApp();setTimeout(loadAll,0);}else{state.me=null;state.channel=null;showLogin();} });
  }

  $('#loginForm').onsubmit=async e=>{e.preventDefault();if(!sb)return toast('Connect Supabase in config.js first.',true);const {error}=await sb.auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value});if(error)toast(error.message,true);};
  $('#logoutBtn').onclick=async()=>{ if(state.channel){await sb.removeChannel(state.channel);state.channel=null;} await sb.auth.signOut(); };
  $('#refreshBtn').onclick=loadAll; $('#modalClose').onclick=closeModal; $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
  init();
})();
