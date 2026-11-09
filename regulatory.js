import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, onSnapshot, runTransaction, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

let ctx=null;
let currentTab='overview';

const COLLECTIONS=[
  ['suppliers','regSuppliers'],
  ['purchaseReceipts','regGrns'],
  ['inventoryBatches','regBatches'],
  ['temperatureLogs','regTemperatureLogs'],
  ['distributionReturns','regReturns'],
  ['recalls','regRecalls'],
  ['complaints','regComplaints'],
  ['controlledDrugRegister','regControlled'],
  ['selfInspections','regInspections'],
  ['capaActions','regCapa'],
  ['equipmentCalibrations','regCalibrations']
];

export function initRegulatoryContext(value){ ctx=value; }

function C(){ if(!ctx) throw new Error('Regulatory context not initialized.'); return ctx; }
function $(s){ return document.querySelector(s); }
function $$(s){ return Array.from(document.querySelectorAll(s)); }
function e(v){ return C().esc(v==null?'':v); }
function f(v){ return C().fmt(v||0); }
function m(v){ return C().money(v||0); }
function d(v){ return C().date(v); }
function dt(v){ return C().dt(v); }
function asDate(v){ return C().asDate(v); }
function can(){ return C().can.apply(null,arguments); }
function state(){ return C().state; }
function db(){ return C().db; }
function toast(msg,err){ C().toast(msg,err); }
function modal(title,html){ C().showModal(title,html); }
function close(){ C().closeModal(); }
function profileName(id){ return C().profileName(id); }
function customerName(id){ return C().customerName(id); }
function productName(id){ return C().productName(id); }
function setSync(v){ C().setSync(v); }
function writeAudit(){ return C().writeAudit.apply(null,arguments); }
function todayISO(){ return C().todayISO(); }
function tsInput(v){ return v?Timestamp.fromDate(new Date(v+'T12:00:00')):null; }
function iso(v){ const x=asDate(v); return x?x.toISOString().slice(0,10):''; }
function normalize(v){ return String(v||'').trim().toLowerCase(); }
function expired(v,at=new Date()){ const x=asDate(v); if(!x)return false; const end=new Date(x);end.setHours(23,59,59,999);return end<at; }
function daysUntil(v){ const x=asDate(v);if(!x)return null;return Math.ceil((x.getTime()-Date.now())/86400000); }
function activeManagement(){ return can('admin','marketing_director','erp_manager'); }
function inspectionAccess(){ return can('admin','marketing_director','erp_manager','inventory'); }
function productById(id){ return state().products.find(x=>x.id===id); }
function supplierById(id){ return state().regSuppliers.find(x=>x.id===id); }
function batchById(id){ return state().regBatches.find(x=>x.id===id); }
function statusBadge(text,ok){ return '<span class="badge '+(ok?'status-approved':'status-cancelled')+'">'+e(text)+'</span>'; }
function selectOptions(rows,labelFn,selected){ return rows.map(x=>'<option value="'+e(x.id)+'" '+(selected===x.id?'selected':'')+'>'+e(labelFn(x))+'</option>').join(''); }
function sortDateDesc(rows,field){ return rows.slice().sort((a,b)=>(asDate(b[field])?.getTime()||0)-(asDate(a[field])?.getTime()||0)); }

export function attachRegulatoryListeners(){
  if(!inspectionAccess())return;
  const s=state();
  COLLECTIONS.forEach(function(pair){
    const col=pair[0],key=pair[1];
    const unsub=onSnapshot(collection(db(),col),function(snap){
      s[key]=snap.docs.map(x=>Object.assign({id:x.id},x.data()));
      if(['regGrns','regTemperatureLogs','regReturns','regRecalls','regComplaints','regControlled','regInspections','regCapa','regCalibrations'].includes(key)){
        const field=key==='regTemperatureLogs'?'recordedAt':key==='regControlled'?'transactionDate':key==='regCalibrations'?'nextDueDate':'createdAt';
        s[key]=sortDateDesc(s[key],field);
      }
      if(s.page==='regulatory')renderRegulatory();
    },function(err){ console.error('regulatory '+col,err); });
    s.unsubs.push(unsub);
  });
  const us=onSnapshot(doc(db(),'settings','regulatory'),function(snap){
    s.regProfile=snap.exists()?Object.assign({id:snap.id},snap.data()):null;
    if(s.page==='regulatory')renderRegulatory();
  });
  s.unsubs.push(us);
}

function regulatoryTabs(){
  const tabs=[
    ['overview','Overview'],
    ['profile','Licence / Responsible Person'],
    ['suppliers','Suppliers + GRN'],
    ['batches','Batch / Expiry'],
    ['temperature','Temperature / Calibration'],
    ['returns','Returns / Quarantine'],
    ['recalls','Recalls'],
    ['complaints','Complaints'],
    ['controlled','Controlled Drugs'],
    ['capa','Self Inspection / CAPA'],
    ['inspector','Inspector Pack']
  ];
  return '<div class="actions" style="flex-wrap:wrap;margin-bottom:16px">'+tabs.map(function(t){
    return '<button class="btn '+(currentTab===t[0]?'primary':'ghost')+' small" data-reg-tab="'+t[0]+'">'+e(t[1])+'</button>';
  }).join('')+'</div>';
}

export function renderRegulatory(){
  if(!inspectionAccess())return;
  const host=$('#regulatoryPage'); if(!host)return;
  let body='';
  if(currentTab==='overview')body=renderOverview();
  else if(currentTab==='profile')body=renderProfile();
  else if(currentTab==='suppliers')body=renderSuppliers();
  else if(currentTab==='batches')body=renderBatches();
  else if(currentTab==='temperature')body=renderTemperature();
  else if(currentTab==='returns')body=renderReturns();
  else if(currentTab==='recalls')body=renderRecalls();
  else if(currentTab==='complaints')body=renderComplaints();
  else if(currentTab==='controlled')body=renderControlled();
  else if(currentTab==='capa')body=renderCapa();
  else body=renderInspectorPack();
  host.innerHTML='<div class="section-head"><div><h3>Drug Inspector / GDP Compliance</h3><div class="muted">Batch traceability, licences, storage, recall, returns, complaints and inspection evidence.</div></div></div>'+regulatoryTabs()+body;
  $$('[data-reg-tab]').forEach(function(b){b.onclick=function(){currentTab=b.dataset.regTab;renderRegulatory();};});
  bindCurrentTab();
}

function renderOverview(){
  const s=state(), today=new Date();
  const saleable=s.regBatches.filter(x=>x.status==='saleable'&&Number(x.availableQty||0)>0&&!expired(x.expiryDate,today));
  const expiredRows=s.regBatches.filter(x=>expired(x.expiryDate,today)&&Number(x.availableQty||0)>0);
  const near=s.regBatches.filter(x=>{const z=daysUntil(x.expiryDate);return x.status==='saleable'&&Number(x.availableQty||0)>0&&z!==null&&z>=0&&z<=90;});
  const supplierIssues=s.regSuppliers.filter(x=>x.approved!==true||!x.licenseNo||expired(x.licenseExpiryDate,today));
  const customerIssues=s.customers.filter(x=>requiresCustomerLicense(x)&&(!x.drugSaleLicenseNo||x.licenseVerified!==true||expired(x.licenseExpiryDate,today)));
  const excursions=s.regTemperatureLogs.filter(x=>x.excursion===true&&x.closed!==true);
  const recalls=s.regRecalls.filter(x=>x.status!=='closed');
  const capas=s.regCapa.filter(x=>x.status!=='closed');
  return '<div class="metric-grid">'+
    metric('Saleable Batches',saleable.length)+metric('Expiry ≤90 Days',near.length)+metric('Expired Stock Alerts',expiredRows.length)+metric('Open Recalls',recalls.length)+
    metric('Supplier Licence Issues',supplierIssues.length)+metric('Customer Licence Issues',customerIssues.length)+metric('Open Temp Excursions',excursions.length)+metric('Open CAPA',capas.length)+
    '</div>'+
    '<div class="card" style="margin-top:16px"><h3>Inspection Readiness</h3>'+
    readinessRow('Company / distribution licence profile',profileComplete(),currentTabLink('profile'))+
    readinessRow('Approved suppliers with valid licences',supplierIssues.length===0,currentTabLink('suppliers'))+
    readinessRow('Batch + expiry traceability',s.regBatches.length>0||s.products.length===0,currentTabLink('batches'))+
    readinessRow('Customer Drug Sale Licence control',customerIssues.length===0,currentTabLink('inspector'))+
    readinessRow('Temperature / calibration records',s.regTemperatureLogs.length>0,currentTabLink('temperature'))+
    readinessRow('Recall / return / complaint registers',true,currentTabLink('recalls'))+
    readinessRow('Self-inspection and CAPA register',s.regInspections.length>0||s.regCapa.length>0,currentTabLink('capa'))+
    readinessRow('Append-only audit trail and backups',true,'Existing ERP controls')+
    '</div>'+
    '<div class="section-head"><h3>Immediate Alerts</h3></div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Type</th><th>Record</th><th>Issue</th></tr></thead><tbody>'+
    near.slice(0,15).map(x=>'<tr><td>Expiry</td><td>'+e(productName(x.productId))+' / '+e(x.batchNo)+'</td><td>'+e(String(daysUntil(x.expiryDate)))+' days remaining</td></tr>').join('')+
    expiredRows.slice(0,15).map(x=>'<tr><td>Expired</td><td>'+e(productName(x.productId))+' / '+e(x.batchNo)+'</td><td>Available '+f(x.availableQty)+' — must not be sold</td></tr>').join('')+
    excursions.slice(0,15).map(x=>'<tr><td>Temperature</td><td>'+e(x.location||'')+'</td><td>'+e(x.excursionDetails||'Excursion open')+'</td></tr>').join('')+
    ((near.length+expiredRows.length+excursions.length)?'':'<tr><td colspan="3" class="empty">No immediate regulatory alerts.</td></tr>')+
    '</tbody></table></div>';
}
function metric(label,value){return '<div class="metric-box"><small>'+e(label)+'</small><strong>'+e(String(value))+'</strong></div>';}
function readinessRow(label,ok,note){return '<div class="kpi-line"><span>'+e(label)+'</span><span>'+statusBadge(ok?'Ready / no open issue':'Needs attention',ok)+' <small>'+e(note||'')+'</small></span></div>';}
function currentTabLink(tab){return 'Open '+tab+' tab';}
function profileComplete(){
  const p=state().regProfile||{};
  return Boolean(p.distributionLicenseNo&&p.licenseExpiryDate&&p.responsiblePersonName&&p.premisesAddress);
}

function renderProfile(){
  const p=state().regProfile||{}, editable=can('admin','erp_manager');
  return '<div class="card"><h3>Distribution Licence & Responsible Person</h3>'+
    '<form id="regProfileForm" class="form-grid">'+
    '<label>Distribution / Drug Sale Licence No.<input id="rpLicense" value="'+e(p.distributionLicenseNo||'')+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Licence Type<input id="rpType" value="'+e(p.licenseType||'Distribution / Wholesale')+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Issue Date<input id="rpIssue" type="date" value="'+e(iso(p.licenseIssueDate))+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Expiry Date<input id="rpExpiry" type="date" value="'+e(iso(p.licenseExpiryDate))+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Responsible Person / Pharmacist<input id="rpPerson" value="'+e(p.responsiblePersonName||'')+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Qualification<input id="rpQual" value="'+e(p.responsiblePersonQualification||'')+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Pharmacy Council Registration No.<input id="rpPharmReg" value="'+e(p.pharmacistRegistrationNo||'')+'" '+(editable?'':'disabled')+'></label>'+
    '<label>Contact<input id="rpContact" value="'+e(p.contact||'')+'" '+(editable?'':'disabled')+'></label>'+
    '<label class="full">Licensed Premises / Warehouse Address<textarea id="rpAddress" '+(editable?'':'disabled')+'>'+e(p.premisesAddress||'')+'</textarea></label>'+
    '<label>Cold Chain Available<select id="rpCold" '+(editable?'':'disabled')+'><option value="false" '+(p.coldChainAvailable===true?'':'selected')+'>No</option><option value="true" '+(p.coldChainAvailable===true?'selected':'')+'>Yes</option></select></label>'+
    '<label>Record Retention Years<input id="rpRetention" type="number" min="3" value="'+e(String(p.recordRetentionYears||3))+'" '+(editable?'':'disabled')+'></label>'+
    '<label>System Validation Status<select id="rpValidation" '+(editable?'':'disabled')+'><option value="draft" '+((p.systemValidationStatus||'draft')==='draft'?'selected':'')+'>Draft / Not formally validated</option><option value="validated" '+(p.systemValidationStatus==='validated'?'selected':'')+'>Validated</option></select></label>'+
    '<label>Last Validation Date<input id="rpValidationDate" type="date" value="'+e(iso(p.lastValidationDate))+'" '+(editable?'':'disabled')+'></label>'+
    '<label class="full">SOP / Document References<textarea id="rpSops" '+(editable?'':'disabled')+'>'+e(p.sopReferences||'')+'</textarea></label>'+
    (editable?'<div class="full"><button class="btn primary">Save Regulatory Profile</button></div>':'')+
    '</form></div>'+
    '<div class="card" style="margin-top:16px"><h3>Computerized System Control Summary</h3><p>Role-based access, approval workflow, non-editable audit trail, stored/downloadable backups and change history are available in the ERP. Formal validation status should only be marked “Validated” after your organization completes and approves its documented validation protocol.</p></div>';
}

function renderSuppliers(){
  const s=state(), canEdit=activeManagement();
  const suppliers=s.regSuppliers.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  return '<div class="section-head"><h3>Approved Supplier Register</h3>'+(canEdit?'<button id="addSupplierBtn" class="btn primary">+ Add Supplier</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Supplier</th><th>Licence</th><th>Expiry</th><th>Manufacturer Authorization</th><th>Status</th><th></th></tr></thead><tbody>'+
    suppliers.map(x=>'<tr><td>'+e(x.supplierCode||'')+'</td><td><b>'+e(x.name||'')+'</b><div class="metric-note">'+e(x.address||'')+'</div></td><td>'+e(x.licenseType||'')+'<br>'+e(x.licenseNo||'')+'</td><td>'+e(d(x.licenseExpiryDate))+'</td><td>'+e(x.manufacturerAuthorization||'')+'</td><td>'+statusBadge(x.approved===true&&!expired(x.licenseExpiryDate)?'Approved':'Review required',x.approved===true&&!expired(x.licenseExpiryDate))+'</td><td>'+(canEdit?'<button class="btn ghost small" data-edit-supplier="'+x.id+'">Edit</button>':'')+'</td></tr>').join('')+
    (suppliers.length?'':'<tr><td colspan="7" class="empty">No suppliers added.</td></tr>')+'</tbody></table></div>'+
    '<div class="section-head"><div><h3>Purchase / GRN Batch Receiving</h3><div class="muted">Each receipt creates traceable batch stock.</div></div>'+((activeManagement()||can('inventory'))?'<button id="addGrnBtn" class="btn primary">+ Receive GRN / Batch</button>':'')+'</div>'+
    grnTable();
}
function grnTable(){
  const rows=state().regGrns.slice(0,100);
  return '<div class="table-wrap"><table class="table"><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th>Invoice</th><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Status</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td><b>'+e(x.grnNo||x.id)+'</b></td><td>'+e(d(x.receivedDate||x.createdAt))+'</td><td>'+e(x.supplierName||'')+'</td><td>'+e(x.purchaseInvoiceNo||'')+'</td><td>'+e(x.productName||productName(x.productId))+'</td><td>'+e(x.batchNo||'')+'</td><td>'+e(d(x.expiryDate))+'</td><td>'+f(x.receivedQty)+'</td><td>'+e(x.status||'')+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="9" class="empty">No GRNs / batch receipts yet.</td></tr>')+'</tbody></table></div>';
}

function renderBatches(){
  const rows=state().regBatches.slice().sort(function(a,b){
    const pa=String(productName(a.productId)),pb=String(productName(b.productId));if(pa!==pb)return pa.localeCompare(pb);
    return (asDate(a.expiryDate)?.getTime()||0)-(asDate(b.expiryDate)?.getTime()||0);
  });
  return '<div class="section-head"><div><h3>Batch-wise Present Stock</h3><div class="muted">FEFO uses only saleable, non-expired batches.</div></div></div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Batch</th><th>Mfg</th><th>Expiry</th><th>Received</th><th>Available</th><th>Supplier</th><th>Status</th><th>Expiry Alert</th><th></th></tr></thead><tbody>'+
    rows.map(function(x){
      const du=daysUntil(x.expiryDate), isExp=expired(x.expiryDate), alert=isExp?'EXPIRED':du!==null&&du<=30?'≤30 days':du!==null&&du<=60?'≤60 days':du!==null&&du<=90?'≤90 days':du!==null&&du<=180?'≤180 days':'';
      return '<tr><td><b>'+e(productName(x.productId))+'</b></td><td>'+e(x.batchNo||'')+'</td><td>'+e(d(x.mfgDate))+'</td><td>'+e(d(x.expiryDate))+'</td><td>'+f(x.receivedQty)+'</td><td><b>'+f(x.availableQty)+'</b></td><td>'+e(x.supplierName||'')+'</td><td>'+statusBadge(isExp?'expired':(x.status||'saleable'),!isExp&&x.status==='saleable')+'</td><td>'+e(alert)+'</td><td>'+((activeManagement()||can('inventory'))?'<button class="btn ghost small" data-batch-status="'+x.id+'">Status</button>':'')+'</td></tr>';
    }).join('')+
    (rows.length?'':'<tr><td colspan="10" class="empty">No batch stock yet. Receive stock through GRN.</td></tr>')+'</tbody></table></div>';
}

function renderTemperature(){
  const rows=state().regTemperatureLogs.slice(0,100), cal=state().regCalibrations.slice(0,100);
  return '<div class="section-head"><h3>Temperature / Humidity Monitoring</h3>'+((activeManagement()||can('inventory'))?'<button id="addTempBtn" class="btn primary">+ Add Temperature Log</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Date/Time</th><th>Location</th><th>Equipment</th><th>Min</th><th>Max</th><th>Current</th><th>Allowed</th><th>Excursion</th><th>Action</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+e(dt(x.recordedAt))+'</td><td>'+e(x.location||'')+'</td><td>'+e(x.equipmentId||'')+'</td><td>'+e(String(x.minTemp??''))+'</td><td>'+e(String(x.maxTemp??''))+'</td><td>'+e(String(x.currentTemp??''))+'</td><td>'+e(String(x.allowedMin??''))+' to '+e(String(x.allowedMax??''))+' °C</td><td>'+statusBadge(x.excursion?'Yes':'No',!x.excursion)+'</td><td>'+e(x.actionTaken||'')+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="9" class="empty">No temperature records.</td></tr>')+'</tbody></table></div>'+
    '<div class="section-head"><h3>Monitoring Equipment / Calibration</h3>'+(activeManagement()?'<button id="addCalibrationBtn" class="btn primary">+ Add Calibration</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Equipment</th><th>Type</th><th>Location</th><th>Last Calibration</th><th>Next Due</th><th>Certificate Ref</th><th>Status</th></tr></thead><tbody>'+
    cal.map(x=>'<tr><td>'+e(x.equipmentId||'')+'</td><td>'+e(x.equipmentType||'')+'</td><td>'+e(x.location||'')+'</td><td>'+e(d(x.lastCalibrationDate))+'</td><td>'+e(d(x.nextDueDate))+'</td><td>'+e(x.certificateRef||'')+'</td><td>'+statusBadge(expired(x.nextDueDate)?'OVERDUE':'Current',!expired(x.nextDueDate))+'</td></tr>').join('')+
    (cal.length?'':'<tr><td colspan="7" class="empty">No calibration records.</td></tr>')+'</tbody></table></div>';
}

function renderReturns(){
  const rows=state().regReturns.slice(0,100);
  return '<div class="section-head"><div><h3>Customer Returns / Quarantine</h3><div class="muted">Returned stock remains non-saleable until documented disposition.</div></div>'+((activeManagement()||can('inventory'))?'<button id="addReturnBtn" class="btn primary">+ Record Return</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Return</th><th>Date</th><th>Customer</th><th>Invoice</th><th>Product</th><th>Batch</th><th>Qty</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+e(x.returnNo||x.id)+'</td><td>'+e(d(x.returnDate||x.createdAt))+'</td><td>'+e(customerName(x.customerId))+'</td><td>'+e(x.invoiceNo||'')+'</td><td>'+e(productName(x.productId))+'</td><td>'+e(x.batchNo||'')+'</td><td>'+f(x.qty)+'</td><td>'+e(x.reason||'')+'</td><td>'+e(x.status||'quarantine')+'</td><td>'+((x.status||'quarantine')==='quarantine'&&activeManagement()?'<button class="btn ghost small" data-return-disposition="'+x.id+'">Disposition</button>':'')+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="10" class="empty">No returns recorded.</td></tr>')+'</tbody></table></div>';
}

function renderRecalls(){
  const rows=state().regRecalls.slice(0,100);
  return '<div class="section-head"><div><h3>Recall Register</h3><div class="muted">Affected invoices/customers are identified from batch allocations.</div></div>'+(activeManagement()?'<button id="addRecallBtn" class="btn primary">+ Start Recall</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Recall</th><th>Date</th><th>Product / Batch</th><th>Reason</th><th>Affected Customers</th><th>Recovered</th><th>Status</th><th></th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td><b>'+e(x.recallNo||x.id)+'</b><div class="metric-note">'+e(x.drapReference||'')+'</div></td><td>'+e(d(x.recallDate||x.createdAt))+'</td><td>'+e(productName(x.productId))+'<br>'+e(x.batchNo||'')+'</td><td>'+e(x.reason||'')+'</td><td>'+f((x.affectedCustomers||[]).length)+'</td><td>'+f(x.recoveredQty||0)+' / '+f(x.estimatedDistributedQty||0)+'</td><td>'+e(x.status||'open')+'</td><td>'+(activeManagement()?'<button class="btn ghost small" data-edit-recall="'+x.id+'">Update</button>':'')+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="8" class="empty">No recalls recorded.</td></tr>')+'</tbody></table></div>';
}

function renderComplaints(){
  const rows=state().regComplaints.slice(0,100);
  return '<div class="section-head"><h3>Quality / Distribution Complaint Register</h3>'+((activeManagement()||can('inventory'))?'<button id="addComplaintBtn" class="btn primary">+ Add Complaint</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Complaint</th><th>Date</th><th>Product / Batch</th><th>Reporter</th><th>Type</th><th>Seriousness</th><th>Status</th><th>Notifications</th><th></th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+e(x.complaintNo||x.id)+'</td><td>'+e(d(x.complaintDate||x.createdAt))+'</td><td>'+e(productName(x.productId))+'<br>'+e(x.batchNo||'')+'</td><td>'+e(x.reporter||customerName(x.customerId))+'</td><td>'+e(x.complaintType||'')+'</td><td>'+e(x.seriousness||'')+'</td><td>'+e(x.status||'open')+'</td><td>Manufacturer: '+e(x.manufacturerNotified?'Yes':'No')+'<br>DRAP: '+e(x.drapNotified?'Yes':'No')+'</td><td>'+(activeManagement()?'<button class="btn ghost small" data-edit-complaint="'+x.id+'">Update</button>':'')+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="9" class="empty">No complaints recorded.</td></tr>')+'</tbody></table></div>';
}

function renderControlled(){
  const rows=state().regControlled.slice(0,150);
  return '<div class="section-head"><div><h3>Controlled Drug Transaction Register</h3><div class="muted">Controlled-product GRNs and approved sales are logged automatically; manual adjustments can also be recorded.</div></div>'+(activeManagement()?'<button id="addControlledBtn" class="btn primary">+ Manual Entry</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Product</th><th>Batch</th><th>Type</th><th>In</th><th>Out</th><th>Reference</th><th>Party</th><th>By</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+e(dt(x.transactionDate||x.createdAt))+'</td><td>'+e(productName(x.productId))+'</td><td>'+e(x.batchNo||'')+'</td><td>'+e(x.transactionType||'')+'</td><td>'+f(x.qtyIn||0)+'</td><td>'+f(x.qtyOut||0)+'</td><td>'+e(x.reference||'')+'</td><td>'+e(x.partyName||'')+'</td><td>'+e(x.enteredByName||profileName(x.enteredBy))+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="9" class="empty">No controlled-drug transactions.</td></tr>')+'</tbody></table></div>';
}

function renderCapa(){
  const ins=state().regInspections.slice(0,100), capa=state().regCapa.slice(0,100);
  return '<div class="section-head"><h3>Self Inspection Register</h3>'+(activeManagement()?'<button id="addInspectionBtn" class="btn primary">+ Self Inspection Finding</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Area</th><th>Inspector</th><th>Finding</th><th>Severity</th><th>Status</th></tr></thead><tbody>'+
    ins.map(x=>'<tr><td>'+e(d(x.inspectionDate||x.createdAt))+'</td><td>'+e(x.area||'')+'</td><td>'+e(x.inspectorName||'')+'</td><td>'+e(x.finding||'')+'</td><td>'+e(x.severity||'')+'</td><td>'+e(x.status||'open')+'</td></tr>').join('')+
    (ins.length?'':'<tr><td colspan="6" class="empty">No self-inspection findings.</td></tr>')+'</tbody></table></div>'+
    '<div class="section-head"><h3>CAPA Register</h3>'+(activeManagement()?'<button id="addCapaBtn" class="btn primary">+ Add CAPA</button>':'')+'</div>'+
    '<div class="table-wrap"><table class="table"><thead><tr><th>CAPA</th><th>Source</th><th>Root Cause</th><th>Corrective</th><th>Preventive</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>'+
    capa.map(x=>'<tr><td>'+e(x.capaNo||x.id)+'</td><td>'+e(x.sourceType||'')+' '+e(x.sourceRef||'')+'</td><td>'+e(x.rootCause||'')+'</td><td>'+e(x.correctiveAction||'')+'</td><td>'+e(x.preventiveAction||'')+'</td><td>'+e(x.owner||'')+'</td><td>'+e(d(x.dueDate))+'</td><td>'+e(x.status||'open')+'</td><td>'+(activeManagement()?'<button class="btn ghost small" data-edit-capa="'+x.id+'">Update</button>':'')+'</td></tr>').join('')+
    (capa.length?'':'<tr><td colspan="9" class="empty">No CAPA records.</td></tr>')+'</tbody></table></div>';
}

function renderInspectorPack(){
  return '<div class="section-head"><div><h3>Drug Inspector Pack</h3><div class="muted">One-screen access to the core records commonly required for distribution traceability.</div></div><button id="printInspectorPackBtn" class="btn primary">Print Inspector Pack</button></div>'+
    '<div class="grid">'+
    '<div class="card"><h3>Licence / Responsible Person</h3><p><b>Licence:</b> '+e(state().regProfile?.distributionLicenseNo||'Not entered')+'</p><p><b>Expiry:</b> '+e(d(state().regProfile?.licenseExpiryDate))+'</p><p><b>Responsible Person:</b> '+e(state().regProfile?.responsiblePersonName||'Not entered')+'</p></div>'+
    '<div class="card"><h3>Traceability</h3><p>Products: '+f(state().products.length)+'</p><p>Batches: '+f(state().regBatches.length)+'</p><p>Purchase/GRNs: '+f(state().regGrns.length)+'</p><p>Approved Sales: '+f(state().sales.filter(x=>(x.status||'approved')==='approved').length)+'</p></div>'+
    '<div class="card"><h3>Quality Systems</h3><p>Temperature Logs: '+f(state().regTemperatureLogs.length)+'</p><p>Returns: '+f(state().regReturns.length)+'</p><p>Recalls: '+f(state().regRecalls.length)+'</p><p>Complaints: '+f(state().regComplaints.length)+'</p></div>'+
    '</div>'+
    '<div class="section-head"><h3>Purchase Register</h3></div>'+grnTable()+
    '<div class="section-head"><h3>Sales Register — Batch Traceability</h3></div>'+salesRegisterTable()+
    '<div class="section-head"><h3>Customer Licence Register</h3></div>'+customerLicenceTable()+
    '<div class="card" style="margin-top:16px"><h3>Record Retention / Computerized System Notes</h3><p>Configured retention: '+e(String(state().regProfile?.recordRetentionYears||3))+' years. Audit Trail and backups are separate append-only/controlled ERP records. Formal validation status: '+e(state().regProfile?.systemValidationStatus||'draft')+'.</p></div>';
}
function salesRegisterTable(){
  const sales=state().sales.filter(x=>(x.status||'approved')==='approved');
  const lines=[];
  sales.forEach(function(sale){(sale.items||[]).forEach(function(it){lines.push({sale:sale,item:it});});});
  return '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>DSL</th><th>Product</th><th>Manufacturer</th><th>Reg No.</th><th>Batch</th><th>Expiry</th><th>Qty</th></tr></thead><tbody>'+
    lines.map(function(x){return '<tr><td>'+e(d(x.sale.saleDate))+'</td><td>'+e(x.sale.invoiceNo||'')+'</td><td>'+e(customerName(x.sale.customerId))+'</td><td>'+e(state().customers.find(c=>c.id===x.sale.customerId)?.drugSaleLicenseNo||'')+'</td><td>'+e(x.item.name||'')+'</td><td>'+e(x.item.manufacturer||productById(x.item.productId)?.manufacturer||'')+'</td><td>'+e(x.item.registrationNo||productById(x.item.productId)?.registrationNo||'')+'</td><td>'+e(batchText(x.item))+'</td><td>'+e(expiryText(x.item))+'</td><td>'+f(x.item.issuedQty||0)+'</td></tr>';}).join('')+
    (lines.length?'':'<tr><td colspan="10" class="empty">No approved sales.</td></tr>')+'</tbody></table></div>';
}
function customerLicenceTable(){
  const rows=state().customers;
  return '<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Customer</th><th>Type</th><th>Drug Sale Licence</th><th>Type</th><th>Expiry</th><th>Verified</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+e(x.customerCode||'')+'</td><td>'+e(x.shopName||x.customerName||'')+'</td><td>'+e(x.customerType||'')+'</td><td>'+e(x.drugSaleLicenseNo||'')+'</td><td>'+e(x.licenseType||'')+'</td><td>'+e(d(x.licenseExpiryDate))+'</td><td>'+e(x.licenseVerified===true?'Yes':'No')+'</td></tr>').join('')+
    (rows.length?'':'<tr><td colspan="7" class="empty">No customers.</td></tr>')+'</tbody></table></div>';
}

function bindCurrentTab(){
  if(currentTab==='profile'&&$('#regProfileForm'))$('#regProfileForm').onsubmit=saveProfile;
  if(currentTab==='suppliers'){
    if($('#addSupplierBtn'))$('#addSupplierBtn').onclick=function(){openSupplierForm();};
    $$('[data-edit-supplier]').forEach(b=>b.onclick=function(){openSupplierForm(b.dataset.editSupplier);});
    if($('#addGrnBtn'))$('#addGrnBtn').onclick=openGrnForm;
  }
  if(currentTab==='batches')$$('[data-batch-status]').forEach(b=>b.onclick=function(){openBatchStatus(b.dataset.batchStatus);});
  if(currentTab==='temperature'){
    if($('#addTempBtn'))$('#addTempBtn').onclick=openTempForm;
    if($('#addCalibrationBtn'))$('#addCalibrationBtn').onclick=openCalibrationForm;
  }
  if(currentTab==='returns'){
    if($('#addReturnBtn'))$('#addReturnBtn').onclick=openReturnForm;
    $$('[data-return-disposition]').forEach(b=>b.onclick=function(){openReturnDisposition(b.dataset.returnDisposition);});
  }
  if(currentTab==='recalls'){
    if($('#addRecallBtn'))$('#addRecallBtn').onclick=function(){openRecallForm();};
    $$('[data-edit-recall]').forEach(b=>b.onclick=function(){openRecallForm(b.dataset.editRecall);});
  }
  if(currentTab==='complaints'){
    if($('#addComplaintBtn'))$('#addComplaintBtn').onclick=function(){openComplaintForm();};
    $$('[data-edit-complaint]').forEach(b=>b.onclick=function(){openComplaintForm(b.dataset.editComplaint);});
  }
  if(currentTab==='controlled'&&$('#addControlledBtn'))$('#addControlledBtn').onclick=openControlledForm;
  if(currentTab==='capa'){
    if($('#addInspectionBtn'))$('#addInspectionBtn').onclick=openInspectionForm;
    if($('#addCapaBtn'))$('#addCapaBtn').onclick=function(){openCapaForm();};
    $$('[data-edit-capa]').forEach(b=>b.onclick=function(){openCapaForm(b.dataset.editCapa);});
  }
  if(currentTab==='inspector'&&$('#printInspectorPackBtn'))$('#printInspectorPackBtn').onclick=printInspectorPack;
}

async function saveProfile(ev){
  ev.preventDefault();if(!can('admin','erp_manager'))return;
  const data={
    distributionLicenseNo:$('#rpLicense').value.trim(),licenseType:$('#rpType').value.trim(),
    licenseIssueDate:tsInput($('#rpIssue').value),licenseExpiryDate:tsInput($('#rpExpiry').value),
    responsiblePersonName:$('#rpPerson').value.trim(),responsiblePersonQualification:$('#rpQual').value.trim(),
    pharmacistRegistrationNo:$('#rpPharmReg').value.trim(),contact:$('#rpContact').value.trim(),
    premisesAddress:$('#rpAddress').value.trim(),coldChainAvailable:$('#rpCold').value==='true',
    recordRetentionYears:Math.max(3,Number($('#rpRetention').value||3)),systemValidationStatus:$('#rpValidation').value,
    lastValidationDate:tsInput($('#rpValidationDate').value),sopReferences:$('#rpSops').value.trim(),updatedAt:serverTimestamp(),updatedBy:state().user.uid
  };
  try{await setDoc(doc(db(),'settings','regulatory'),data,{merge:true});await writeAudit('regulatory_profile_updated','settings','regulatory',{distributionLicenseNo:data.distributionLicenseNo,systemValidationStatus:data.systemValidationStatus});toast('Regulatory profile saved.');}
  catch(err){toast(err.message,true);}
}

function openSupplierForm(id){
  const x=id?supplierById(id):null;
  modal(x?'Edit Supplier':'Add Supplier','<form id="supplierForm" class="form-grid">'+
    '<label>Supplier Name<input id="sName" required value="'+e(x?.name||'')+'"></label>'+
    '<label>Phone<input id="sPhone" value="'+e(x?.phone||'')+'"></label>'+
    '<label>Email<input id="sEmail" value="'+e(x?.email||'')+'"></label>'+
    '<label>NTN / Registration<input id="sTax" value="'+e(x?.ntn||'')+'"></label>'+
    '<label>Licence Type<input id="sLicType" value="'+e(x?.licenseType||'Drug Sale / Manufacturing Licence')+'"></label>'+
    '<label>Licence No.<input id="sLicNo" required value="'+e(x?.licenseNo||'')+'"></label>'+
    '<label>Licence Expiry<input id="sLicExpiry" type="date" required value="'+e(iso(x?.licenseExpiryDate))+'"></label>'+
    '<label>Manufacturer Authorization Ref<input id="sAuth" value="'+e(x?.manufacturerAuthorization||'')+'"></label>'+
    '<label>Approved<select id="sApproved"><option value="true" '+(x?.approved===false?'':'selected')+'>Yes</option><option value="false" '+(x?.approved===false?'selected':'')+'>No</option></select></label>'+
    '<label class="full">Address<textarea id="sAddress">'+e(x?.address||'')+'</textarea></label>'+
    '<div class="full"><button class="btn primary">Save Supplier</button></div></form>');
  $('#supplierForm').onsubmit=async function(ev){
    ev.preventDefault();const ref=x?doc(db(),'suppliers',x.id):doc(collection(db(),'suppliers')),now=Timestamp.now();
    const data={supplierCode:x?.supplierCode||('SUP-'+ref.id.slice(0,6).toUpperCase()),name:$('#sName').value.trim(),phone:$('#sPhone').value.trim(),email:$('#sEmail').value.trim(),ntn:$('#sTax').value.trim(),licenseType:$('#sLicType').value.trim(),licenseNo:$('#sLicNo').value.trim(),licenseExpiryDate:tsInput($('#sLicExpiry').value),manufacturerAuthorization:$('#sAuth').value.trim(),approved:$('#sApproved').value==='true',address:$('#sAddress').value.trim(),updatedAt:now,updatedBy:state().user.uid};
    if(!x){data.createdAt=now;data.createdBy=state().user.uid;}
    try{await setDoc(ref,data,{merge:true});await writeAudit(x?'supplier_updated':'supplier_created','supplier',ref.id,{supplierCode:data.supplierCode,name:data.name,licenseNo:data.licenseNo,approved:data.approved});close();toast('Supplier saved.');}catch(err){toast(err.message,true);}
  };
}

function openGrnForm(){
  const suppliers=state().regSuppliers.filter(x=>x.approved===true&&!expired(x.licenseExpiryDate));
  const products=state().products.filter(x=>x.active!==false);
  if(!suppliers.length)return toast('Add an approved supplier with a valid licence first.',true);
  if(!products.length)return toast('Add a product first.',true);
  modal('Receive GRN / Batch','<form id="grnForm" class="form-grid">'+
    '<label>Supplier<select id="gSupplier" required><option value="">Select</option>'+selectOptions(suppliers,x=>(x.supplierCode||'')+' '+x.name,'')+'</select></label>'+
    '<label>Purchase Invoice No.<input id="gInvoice" required></label>'+
    '<label>Invoice Date<input id="gInvoiceDate" type="date" value="'+todayISO()+'" required></label>'+
    '<label>Received Date<input id="gReceived" type="date" value="'+todayISO()+'" required></label>'+
    '<label>Product<select id="gProduct" required><option value="">Select</option>'+selectOptions(products,x=>(x.sku||'')+' '+x.name,'')+'</select></label>'+
    '<label>Batch No.<input id="gBatch" required></label>'+
    '<label>Manufacturing Date<input id="gMfg" type="date"></label>'+
    '<label>Expiry Date<input id="gExpiry" type="date" required></label>'+
    '<label>Quantity<input id="gQty" type="number" min="1" step="1" required></label>'+
    '<label>Unit Cost<input id="gCost" type="number" min="0" step="0.01" value="0"></label>'+
    '<label>Status<select id="gStatus"><option value="saleable">Saleable / Released</option><option value="quarantine">Quarantine</option></select></label>'+
    '<label>Storage Location<input id="gLocation" value="Main Warehouse"></label>'+
    '<label class="full">Notes<textarea id="gNotes"></textarea></label>'+
    '<div class="full"><button class="btn primary">Post GRN / Batch</button></div></form>');
  $('#grnForm').onsubmit=async function(ev){
    ev.preventDefault();
    const supplier=supplierById($('#gSupplier').value),product=productById($('#gProduct').value);
    if(!supplier||supplier.approved!==true||expired(supplier.licenseExpiryDate))return toast('Supplier licence is not valid/approved.',true);
    if(!product)return;
    if(expired(tsInput($('#gExpiry').value)))return toast('Expired batch cannot be received as current stock.',true);
    const qty=Math.floor(Number($('#gQty').value||0));if(qty<=0)return;
    const grnRef=doc(collection(db(),'purchaseReceipts')),batchRef=doc(collection(db(),'inventoryBatches')),prodRef=doc(db(),'products',product.id),now=Timestamp.now(),saleable=$('#gStatus').value==='saleable';
    try{
      await runTransaction(db(),async function(tx){
        const ps=await tx.get(prodRef);if(!ps.exists())throw new Error('Product not found.');
        const current=Number(ps.data().stockQty||0),newStock=current+(saleable?qty:0);
        const grnNo='GRN-'+grnRef.id.slice(0,8).toUpperCase();
        const data={grnNo,supplierId:supplier.id,supplierName:supplier.name,purchaseInvoiceNo:$('#gInvoice').value.trim(),invoiceDate:tsInput($('#gInvoiceDate').value),receivedDate:tsInput($('#gReceived').value),productId:product.id,productName:product.name,batchId:batchRef.id,batchNo:$('#gBatch').value.trim(),mfgDate:tsInput($('#gMfg').value),expiryDate:tsInput($('#gExpiry').value),receivedQty:qty,unitCost:Number($('#gCost').value||0),status:$('#gStatus').value,storageLocation:$('#gLocation').value.trim(),notes:$('#gNotes').value.trim(),createdBy:state().user.uid,createdAt:now};
        tx.set(grnRef,data);
        tx.set(batchRef,{productId:product.id,productName:product.name,batchNo:data.batchNo,mfgDate:data.mfgDate,expiryDate:data.expiryDate,supplierId:supplier.id,supplierName:supplier.name,grnId:grnRef.id,receivedQty:qty,availableQty:qty,status:data.status,storageLocation:data.storageLocation,unitCost:data.unitCost,receivedAt:data.receivedDate,createdBy:state().user.uid,createdAt:now,updatedAt:now});
        if(saleable){
          tx.update(prodRef,{stockQty:newStock,updatedAt:now});
          tx.set(doc(collection(db(),'stockMovements')),{productId:product.id,productName:product.name,batchId:batchRef.id,batchNo:data.batchNo,expiryDate:data.expiryDate,movementType:'purchase_received',qtyChange:qty,balanceAfter:newStock,refType:'grn',refId:grnRef.id,notes:'GRN '+grnNo+' / '+supplier.name,enteredBy:state().user.uid,createdAt:now});
        }
        if(product.controlledDrug===true){
          tx.set(doc(collection(db(),'controlledDrugRegister')),{productId:product.id,batchId:batchRef.id,batchNo:data.batchNo,transactionType:'purchase_received',qtyIn:qty,qtyOut:0,reference:grnNo,partyName:supplier.name,transactionDate:now,enteredBy:state().user.uid,enteredByName:state().me?.fullName||'',createdAt:now,automatic:true});
        }
        C().auditSet(tx,'grn_batch_received','grn',grnRef.id,{grnNo,productId:product.id,batchNo:data.batchNo,qty,status:data.status,supplierId:supplier.id});
      });
      close();toast('GRN posted and batch stock created.');
    }catch(err){console.error(err);toast(err.message,true);}
  };
}

function openBatchStatus(id){
  const b=batchById(id);if(!b)return;
  modal('Batch Status — '+b.batchNo,'<form id="batchStatusForm" class="form-grid"><label>Current<input value="'+e(b.status||'')+'" disabled></label><label>New Status<select id="bsStatus"><option value="saleable">Saleable</option><option value="quarantine">Quarantine</option><option value="recalled">Recalled</option><option value="rejected">Rejected</option><option value="expired">Expired</option><option value="returned">Returned to Supplier</option></select></label><label class="full">Reason<textarea id="bsReason" required></textarea></label><div class="full"><button class="btn primary">Update Batch Status</button></div></form>');
  $('#bsStatus').value=b.status||'saleable';
  $('#batchStatusForm').onsubmit=async function(ev){
    ev.preventDefault();const next=$('#bsStatus').value,reason=$('#bsReason').value.trim();if(!reason)return;if(next==='saleable'&&expired(b.expiryDate))return toast('Expired batch cannot be released to saleable stock.',true);
    const bref=doc(db(),'inventoryBatches',id),pref=doc(db(),'products',b.productId);
    try{
      await runTransaction(db(),async function(tx){
        const bs=await tx.get(bref),ps=await tx.get(pref);if(!bs.exists()||!ps.exists())throw new Error('Batch/product missing.');
        const live=bs.data(),old=live.status||'saleable',qty=Number(live.availableQty||0),p=ps.data();let delta=0;
        const oldSale=old==='saleable'&&!expired(live.expiryDate),newSale=next==='saleable'&&!expired(live.expiryDate);
        if(oldSale&&!newSale)delta=-qty;else if(!oldSale&&newSale)delta=qty;
        const bal=Number(p.stockQty||0)+delta;if(bal<0)throw new Error('Product stock would become negative.');
        if(delta!==0)tx.update(pref,{stockQty:bal,updatedAt:Timestamp.now()});
        tx.update(bref,{status:next,statusReason:reason,statusChangedAt:Timestamp.now(),statusChangedBy:state().user.uid,updatedAt:Timestamp.now()});
        if(delta!==0)tx.set(doc(collection(db(),'stockMovements')),{productId:b.productId,productName:p.name,batchId:id,batchNo:live.batchNo,movementType:'batch_status_change',qtyChange:delta,balanceAfter:bal,refType:'batch',refId:id,notes:old+' → '+next+': '+reason,enteredBy:state().user.uid,createdAt:Timestamp.now()});
        C().auditSet(tx,'batch_status_changed','batch',id,{batchNo:live.batchNo,from:old,to:next,qtyAffected:qty,reason});
      });
      close();toast('Batch status updated.');
    }catch(err){toast(err.message,true);}
  };
}

function openTempForm(){
  modal('Temperature Log','<form id="tempForm" class="form-grid"><label>Date / Time<input id="tWhen" type="datetime-local" required></label><label>Location<input id="tLocation" value="Main Warehouse" required></label><label>Equipment ID<input id="tEquipment"></label><label>Min °C<input id="tMin" type="number" step="0.1" required></label><label>Max °C<input id="tMax" type="number" step="0.1" required></label><label>Current °C<input id="tCurrent" type="number" step="0.1"></label><label>Allowed Min °C<input id="tAllowedMin" type="number" step="0.1" value="15"></label><label>Allowed Max °C<input id="tAllowedMax" type="number" step="0.1" value="25"></label><label>Humidity %<input id="tHumidity" type="number" step="0.1"></label><label class="full">Action Taken / Excursion Investigation<textarea id="tAction"></textarea></label><div class="full"><button class="btn primary">Save Temperature Record</button></div></form>');
  const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());$('#tWhen').value=now.toISOString().slice(0,16);
  $('#tempForm').onsubmit=async function(ev){
    ev.preventDefault();const min=Number($('#tMin').value),max=Number($('#tMax').value),amin=Number($('#tAllowedMin').value),amax=Number($('#tAllowedMax').value),exc=min<amin||max>amax,when=Timestamp.fromDate(new Date($('#tWhen').value));
    const data={recordedAt:when,location:$('#tLocation').value.trim(),equipmentId:$('#tEquipment').value.trim(),minTemp:min,maxTemp:max,currentTemp:Number($('#tCurrent').value||0),allowedMin:amin,allowedMax:amax,humidity:Number($('#tHumidity').value||0),excursion:exc,excursionDetails:exc?('Recorded range '+min+' to '+max+' °C outside '+amin+' to '+amax+' °C'):'',actionTaken:$('#tAction').value.trim(),recordedBy:state().user.uid,recordedByName:state().me?.fullName||'',createdAt:serverTimestamp(),closed:!exc};
    try{const ref=await addDoc(collection(db(),'temperatureLogs'),data);await writeAudit('temperature_log_created','temperature',ref.id,{location:data.location,excursion:exc,min,max,allowedMin:amin,allowedMax:amax});close();toast(exc?'Temperature excursion recorded — investigation required.':'Temperature record saved.',exc);}catch(err){toast(err.message,true);}
  };
}

function openCalibrationForm(){
  modal('Equipment Calibration','<form id="calForm" class="form-grid"><label>Equipment ID<input id="calId" required></label><label>Equipment Type<input id="calType" value="Thermometer / Data Logger"></label><label>Location<input id="calLocation" value="Main Warehouse"></label><label>Last Calibration Date<input id="calLast" type="date" required></label><label>Next Due Date<input id="calNext" type="date" required></label><label>Certificate Reference<input id="calCert"></label><label class="full">Notes<textarea id="calNotes"></textarea></label><div class="full"><button class="btn primary">Save Calibration</button></div></form>');
  $('#calForm').onsubmit=async function(ev){ev.preventDefault();try{const ref=await addDoc(collection(db(),'equipmentCalibrations'),{equipmentId:$('#calId').value.trim(),equipmentType:$('#calType').value.trim(),location:$('#calLocation').value.trim(),lastCalibrationDate:tsInput($('#calLast').value),nextDueDate:tsInput($('#calNext').value),certificateRef:$('#calCert').value.trim(),notes:$('#calNotes').value.trim(),createdBy:state().user.uid,createdAt:serverTimestamp()});await writeAudit('calibration_recorded','calibration',ref.id,{equipmentId:$('#calId').value.trim(),nextDueDate:$('#calNext').value});close();toast('Calibration record saved.');}catch(err){toast(err.message,true);}};
}

function openReturnForm(){
  const batches=state().regBatches.filter(x=>x.batchNo);
  modal('Customer Return / Quarantine','<form id="returnForm" class="form-grid"><label>Return Date<input id="rtnDate" type="date" value="'+todayISO()+'" required></label><label>Customer<select id="rtnCustomer" required><option value="">Select</option>'+selectOptions(state().customers,x=>(x.customerCode||'')+' '+(x.shopName||x.customerName||''),'')+'</select></label><label>Original Invoice No.<input id="rtnInvoice"></label><label>Batch<select id="rtnBatch" required><option value="">Select</option>'+selectOptions(batches,x=>productName(x.productId)+' / '+x.batchNo+' / exp '+d(x.expiryDate),'')+'</select></label><label>Quantity<input id="rtnQty" type="number" min="1" step="1" required></label><label>Condition<select id="rtnCondition"><option value="unopened">Unopened</option><option value="damaged">Damaged</option><option value="temperature_unknown">Temperature history unknown</option><option value="other">Other</option></select></label><label class="full">Reason<textarea id="rtnReason" required></textarea></label><div class="full"><button class="btn primary">Receive into Quarantine</button></div></form>');
  $('#returnForm').onsubmit=async function(ev){ev.preventDefault();const b=batchById($('#rtnBatch').value);if(!b)return;const ref=doc(collection(db(),'distributionReturns')),qty=Math.floor(Number($('#rtnQty').value||0)),now=Timestamp.now();try{await setDoc(ref,{returnNo:'RET-'+ref.id.slice(0,8).toUpperCase(),returnDate:tsInput($('#rtnDate').value),customerId:$('#rtnCustomer').value,invoiceNo:$('#rtnInvoice').value.trim(),productId:b.productId,batchId:b.id,batchNo:b.batchNo,expiryDate:b.expiryDate,qty,condition:$('#rtnCondition').value,reason:$('#rtnReason').value.trim(),status:'quarantine',createdBy:state().user.uid,createdAt:now});await writeAudit('customer_return_quarantined','return',ref.id,{productId:b.productId,batchNo:b.batchNo,qty,customerId:$('#rtnCustomer').value});close();toast('Return recorded in quarantine.');}catch(err){toast(err.message,true);}};
}

function openReturnDisposition(id){
  const r=state().regReturns.find(x=>x.id===id);if(!r)return;
  modal('Return Disposition — '+(r.returnNo||''),'<form id="returnDispForm" class="form-grid"><label>Decision<select id="rdDecision"><option value="released">Release to Saleable Stock</option><option value="rejected">Reject / Destroy / Return to Supplier</option></select></label><label class="full">Assessment / Reason<textarea id="rdReason" required></textarea></label><div class="full"><button class="btn primary">Post Disposition</button></div></form>');
  $('#returnDispForm').onsubmit=async function(ev){ev.preventDefault();const decision=$('#rdDecision').value,reason=$('#rdReason').value.trim();if(!reason)return;const rr=doc(db(),'distributionReturns',id),br=doc(db(),'inventoryBatches',r.batchId),pr=doc(db(),'products',r.productId),now=Timestamp.now();try{await runTransaction(db(),async function(tx){const rs=await tx.get(rr),bs=await tx.get(br),ps=await tx.get(pr);if(!rs.exists()||rs.data().status!=='quarantine')throw new Error('Return is no longer awaiting disposition.');if(decision==='released'){if(!bs.exists()||!ps.exists())throw new Error('Original batch/product missing.');if(expired(bs.data().expiryDate))throw new Error('Expired returned stock cannot be released.');if(bs.data().status!=='saleable')throw new Error('Original batch is not currently saleable; keep the return quarantined/rejected.');const qty=Number(rs.data().qty||0),newBatch=Number(bs.data().availableQty||0)+qty,newStock=Number(ps.data().stockQty||0)+qty;tx.update(br,{availableQty:newBatch,updatedAt:now});tx.update(pr,{stockQty:newStock,updatedAt:now});tx.set(doc(collection(db(),'stockMovements')),{productId:r.productId,productName:ps.data().name,batchId:r.batchId,batchNo:r.batchNo,movementType:'return_released',qtyChange:qty,balanceAfter:newStock,refType:'return',refId:id,notes:reason,enteredBy:state().user.uid,createdAt:now});}tx.update(rr,{status:decision,dispositionReason:reason,dispositionBy:state().user.uid,dispositionAt:now,updatedAt:now});C().auditSet(tx,'return_disposition','return',id,{decision,reason,qty:r.qty,productId:r.productId,batchNo:r.batchNo});});close();toast('Return disposition posted.');}catch(err){toast(err.message,true);}};
}

function openRecallForm(id){
  const x=id?state().regRecalls.find(z=>z.id===id):null;
  if(x){
    modal('Update Recall — '+(x.recallNo||''),'<form id="recallUpdateForm" class="form-grid"><label>Recovered Qty<input id="rcRecovered" type="number" min="0" step="1" value="'+e(String(x.recoveredQty||0))+'"></label><label>Status<select id="rcStatus"><option value="open" '+(x.status==='open'?'selected':'')+'>Open</option><option value="closed" '+(x.status==='closed'?'selected':'')+'>Closed</option></select></label><label class="full">Update Notes<textarea id="rcUpdate">'+e(x.updateNotes||'')+'</textarea></label><div class="full"><button class="btn primary">Save Recall Update</button></div></form>');
    $('#recallUpdateForm').onsubmit=async function(ev){ev.preventDefault();try{await updateDoc(doc(db(),'recalls',x.id),{recoveredQty:Number($('#rcRecovered').value||0),status:$('#rcStatus').value,updateNotes:$('#rcUpdate').value.trim(),updatedAt:serverTimestamp(),updatedBy:state().user.uid});await writeAudit('recall_updated','recall',x.id,{recoveredQty:Number($('#rcRecovered').value||0),status:$('#rcStatus').value});close();toast('Recall updated.');}catch(err){toast(err.message,true);}};return;
  }
  const batches=state().regBatches.filter(b=>Number(b.availableQty||0)>=0);
  modal('Start Product / Batch Recall','<form id="recallForm" class="form-grid"><label>Recall Date<input id="rcDate" type="date" value="'+todayISO()+'" required></label><label>Batch<select id="rcBatch" required><option value="">Select</option>'+selectOptions(batches,b=>productName(b.productId)+' / '+b.batchNo+' / exp '+d(b.expiryDate),'')+'</select></label><label>Classification<input id="rcClass" placeholder="e.g. Class I / II / III"></label><label>DRAP / Manufacturer Reference<input id="rcRef"></label><label class="full">Reason<textarea id="rcReason" required></textarea></label><div class="full"><button class="btn danger">Start Recall & Block Batch</button></div></form>');
  $('#recallForm').onsubmit=async function(ev){ev.preventDefault();const b=batchById($('#rcBatch').value);if(!b)return;const affected=[];let distributed=0;state().sales.filter(s=>(s.status||'approved')==='approved').forEach(function(sale){(sale.items||[]).forEach(function(it){(it.batchAllocations||[]).forEach(function(a){if(a.batchId===b.id){distributed+=Number(a.qty||0);affected.push({saleId:sale.id,invoiceNo:sale.invoiceNo,customerId:sale.customerId,customerName:customerName(sale.customerId),qty:Number(a.qty||0)});}});});});const rr=doc(collection(db(),'recalls')),br=doc(db(),'inventoryBatches',b.id),pr=doc(db(),'products',b.productId),now=Timestamp.now();try{await runTransaction(db(),async function(tx){const bs=await tx.get(br),ps=await tx.get(pr);if(!bs.exists()||!ps.exists())throw new Error('Batch/product missing.');const live=bs.data(),saleable=live.status==='saleable'&&!expired(live.expiryDate),blockQty=saleable?Number(live.availableQty||0):0,newStock=Number(ps.data().stockQty||0)-blockQty;if(newStock<0)throw new Error('Product stock inconsistency detected.');tx.update(br,{status:'recalled',recallId:rr.id,updatedAt:now});if(blockQty>0){tx.update(pr,{stockQty:newStock,updatedAt:now});tx.set(doc(collection(db(),'stockMovements')),{productId:b.productId,productName:ps.data().name,batchId:b.id,batchNo:live.batchNo,movementType:'recall_block',qtyChange:-blockQty,balanceAfter:newStock,refType:'recall',refId:rr.id,notes:$('#rcReason').value.trim(),enteredBy:state().user.uid,createdAt:now});}tx.set(rr,{recallNo:'RCL-'+rr.id.slice(0,8).toUpperCase(),recallDate:tsInput($('#rcDate').value),productId:b.productId,batchId:b.id,batchNo:b.batchNo,expiryDate:b.expiryDate,classification:$('#rcClass').value.trim(),drapReference:$('#rcRef').value.trim(),reason:$('#rcReason').value.trim(),affectedCustomers:affected,estimatedDistributedQty:distributed,recoveredQty:0,blockedWarehouseQty:blockQty,status:'open',createdBy:state().user.uid,createdAt:now});C().auditSet(tx,'batch_recall_started','recall',rr.id,{productId:b.productId,batchNo:b.batchNo,affectedCustomers:affected.length,estimatedDistributedQty:distributed,blockedWarehouseQty:blockQty});});close();toast('Recall started and batch blocked from sale.');}catch(err){toast(err.message,true);}};
}

function openComplaintForm(id){
  const x=id?state().regComplaints.find(z=>z.id===id):null;
  const products=state().products;
  modal(x?'Update Complaint':'Add Complaint','<form id="complaintForm" class="form-grid"><label>Complaint Date<input id="cmpDate" type="date" value="'+e(iso(x?.complaintDate)||todayISO())+'" required></label><label>Product<select id="cmpProduct"><option value="">Select</option>'+selectOptions(products,z=>z.name,x?.productId||'')+'</select></label><label>Batch No.<input id="cmpBatch" value="'+e(x?.batchNo||'')+'"></label><label>Reporter / Customer<input id="cmpReporter" value="'+e(x?.reporter||'')+'"></label><label>Complaint Type<select id="cmpType"><option value="quality" '+(x?.complaintType==='quality'?'selected':'')+'>Quality</option><option value="distribution" '+(x?.complaintType==='distribution'?'selected':'')+'>Distribution</option><option value="storage" '+(x?.complaintType==='storage'?'selected':'')+'>Storage / Temperature</option><option value="packaging" '+(x?.complaintType==='packaging'?'selected':'')+'>Packaging</option></select></label><label>Seriousness<select id="cmpSerious"><option value="minor" '+(x?.seriousness==='minor'?'selected':'')+'>Minor</option><option value="major" '+(x?.seriousness==='major'?'selected':'')+'>Major</option><option value="critical" '+(x?.seriousness==='critical'?'selected':'')+'>Critical</option></select></label><label>Status<select id="cmpStatus"><option value="open" '+((x?.status||'open')==='open'?'selected':'')+'>Open</option><option value="investigating" '+(x?.status==='investigating'?'selected':'')+'>Investigating</option><option value="closed" '+(x?.status==='closed'?'selected':'')+'>Closed</option></select></label><label>Manufacturer Notified<select id="cmpMfg"><option value="false" '+(x?.manufacturerNotified?'':'selected')+'>No</option><option value="true" '+(x?.manufacturerNotified?'selected':'')+'>Yes</option></select></label><label>DRAP Notified<select id="cmpDrap"><option value="false" '+(x?.drapNotified?'':'selected')+'>No</option><option value="true" '+(x?.drapNotified?'selected':'')+'>Yes</option></select></label><label class="full">Complaint Details<textarea id="cmpDetails">'+e(x?.details||'')+'</textarea></label><label class="full">Investigation / Conclusion<textarea id="cmpInvestigation">'+e(x?.investigation||'')+'</textarea></label><div class="full"><button class="btn primary">Save Complaint</button></div></form>');
  $('#complaintForm').onsubmit=async function(ev){ev.preventDefault();const ref=x?doc(db(),'complaints',x.id):doc(collection(db(),'complaints')),now=Timestamp.now();const data={complaintNo:x?.complaintNo||('CMP-'+ref.id.slice(0,8).toUpperCase()),complaintDate:tsInput($('#cmpDate').value),productId:$('#cmpProduct').value,batchNo:$('#cmpBatch').value.trim(),reporter:$('#cmpReporter').value.trim(),complaintType:$('#cmpType').value,seriousness:$('#cmpSerious').value,status:$('#cmpStatus').value,manufacturerNotified:$('#cmpMfg').value==='true',drapNotified:$('#cmpDrap').value==='true',details:$('#cmpDetails').value.trim(),investigation:$('#cmpInvestigation').value.trim(),updatedAt:now,updatedBy:state().user.uid};if(!x){data.createdAt=now;data.createdBy=state().user.uid;}try{await setDoc(ref,data,{merge:true});await writeAudit(x?'complaint_updated':'complaint_created','complaint',ref.id,{complaintNo:data.complaintNo,productId:data.productId,batchNo:data.batchNo,status:data.status,seriousness:data.seriousness});close();toast('Complaint saved.');}catch(err){toast(err.message,true);}};
}

function openControlledForm(){
  modal('Controlled Drug Register — Manual Entry','<form id="controlledForm" class="form-grid"><label>Date<input id="cdDate" type="date" value="'+todayISO()+'" required></label><label>Product<select id="cdProduct" required><option value="">Select</option>'+selectOptions(state().products.filter(x=>x.controlledDrug===true),x=>x.name,'')+'</select></label><label>Batch No.<input id="cdBatch"></label><label>Transaction Type<select id="cdType"><option value="adjustment_in">Adjustment In</option><option value="adjustment_out">Adjustment Out</option><option value="return_in">Return In</option><option value="destruction_out">Destruction Out</option></select></label><label>Quantity<input id="cdQty" type="number" min="1" step="1" required></label><label>Reference<input id="cdRef"></label><label>Party / Authority<input id="cdParty"></label><label class="full">Reason / Notes<textarea id="cdNotes" required></textarea></label><div class="full"><button class="btn primary">Save Register Entry</button></div></form>');
  $('#controlledForm').onsubmit=async function(ev){ev.preventDefault();const type=$('#cdType').value,qty=Number($('#cdQty').value||0),isIn=type.endsWith('_in');try{const ref=await addDoc(collection(db(),'controlledDrugRegister'),{productId:$('#cdProduct').value,batchNo:$('#cdBatch').value.trim(),transactionType:type,qtyIn:isIn?qty:0,qtyOut:isIn?0:qty,reference:$('#cdRef').value.trim(),partyName:$('#cdParty').value.trim(),notes:$('#cdNotes').value.trim(),transactionDate:tsInput($('#cdDate').value),enteredBy:state().user.uid,enteredByName:state().me?.fullName||'',createdAt:serverTimestamp(),automatic:false});await writeAudit('controlled_drug_manual_entry','controlled_drug',ref.id,{productId:$('#cdProduct').value,type,qty});close();toast('Controlled-drug register entry saved.');}catch(err){toast(err.message,true);}};
}

function openInspectionForm(){
  modal('Self Inspection Finding','<form id="inspectionForm" class="form-grid"><label>Inspection Date<input id="siDate" type="date" value="'+todayISO()+'" required></label><label>Area<input id="siArea" required placeholder="Warehouse / Documentation / Dispatch"></label><label>Inspector<input id="siInspector" value="'+e(state().me?.fullName||'')+'"></label><label>Severity<select id="siSeverity"><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></label><label>Status<select id="siStatus"><option value="open">Open</option><option value="closed">Closed</option></select></label><label class="full">Finding<textarea id="siFinding" required></textarea></label><div class="full"><button class="btn primary">Save Finding</button></div></form>');
  $('#inspectionForm').onsubmit=async function(ev){ev.preventDefault();try{const ref=await addDoc(collection(db(),'selfInspections'),{inspectionDate:tsInput($('#siDate').value),area:$('#siArea').value.trim(),inspectorName:$('#siInspector').value.trim(),severity:$('#siSeverity').value,status:$('#siStatus').value,finding:$('#siFinding').value.trim(),createdBy:state().user.uid,createdAt:serverTimestamp()});await writeAudit('self_inspection_finding','self_inspection',ref.id,{area:$('#siArea').value.trim(),severity:$('#siSeverity').value,status:$('#siStatus').value});close();toast('Self-inspection finding saved.');}catch(err){toast(err.message,true);}};
}

function openCapaForm(id){
  const x=id?state().regCapa.find(z=>z.id===id):null;
  modal(x?'Update CAPA':'Add CAPA','<form id="capaForm" class="form-grid"><label>Source Type<input id="caSourceType" value="'+e(x?.sourceType||'Self Inspection')+'"></label><label>Source Reference<input id="caSourceRef" value="'+e(x?.sourceRef||'')+'"></label><label>Owner<input id="caOwner" value="'+e(x?.owner||'')+'"></label><label>Due Date<input id="caDue" type="date" value="'+e(iso(x?.dueDate))+'"></label><label>Status<select id="caStatus"><option value="open" '+((x?.status||'open')==='open'?'selected':'')+'>Open</option><option value="in_progress" '+(x?.status==='in_progress'?'selected':'')+'>In Progress</option><option value="closed" '+(x?.status==='closed'?'selected':'')+'>Closed</option></select></label><label class="full">Root Cause<textarea id="caRoot">'+e(x?.rootCause||'')+'</textarea></label><label class="full">Corrective Action<textarea id="caCorrective">'+e(x?.correctiveAction||'')+'</textarea></label><label class="full">Preventive Action<textarea id="caPreventive">'+e(x?.preventiveAction||'')+'</textarea></label><label class="full">Closure Evidence<textarea id="caEvidence">'+e(x?.closureEvidence||'')+'</textarea></label><div class="full"><button class="btn primary">Save CAPA</button></div></form>');
  $('#capaForm').onsubmit=async function(ev){ev.preventDefault();const ref=x?doc(db(),'capaActions',x.id):doc(collection(db(),'capaActions')),now=Timestamp.now(),status=$('#caStatus').value;const data={capaNo:x?.capaNo||('CAPA-'+ref.id.slice(0,8).toUpperCase()),sourceType:$('#caSourceType').value.trim(),sourceRef:$('#caSourceRef').value.trim(),owner:$('#caOwner').value.trim(),dueDate:tsInput($('#caDue').value),status,rootCause:$('#caRoot').value.trim(),correctiveAction:$('#caCorrective').value.trim(),preventiveAction:$('#caPreventive').value.trim(),closureEvidence:$('#caEvidence').value.trim(),closedAt:status==='closed'?now:null,updatedAt:now,updatedBy:state().user.uid};if(!x){data.createdAt=now;data.createdBy=state().user.uid;}try{await setDoc(ref,data,{merge:true});await writeAudit(x?'capa_updated':'capa_created','capa',ref.id,{capaNo:data.capaNo,status:data.status,dueDate:$('#caDue').value});close();toast('CAPA saved.');}catch(err){toast(err.message,true);}};
}

function printInspectorPack(){
  const p=state().regProfile||{}, sales=state().sales.filter(x=>(x.status||'approved')==='approved'), html=
  '<h1>'+e(C().COMPANY_NAME)+'</h1><h2>Drug Inspector / GDP Inspection Pack</h2><p>Generated: '+e(new Date().toLocaleString('en-PK'))+'</p>'+
  '<h3>Licence / Responsible Person</h3><p><b>Licence:</b> '+e(p.distributionLicenseNo||'')+' &nbsp; <b>Expiry:</b> '+e(d(p.licenseExpiryDate))+'<br><b>Responsible Person:</b> '+e(p.responsiblePersonName||'')+' / '+e(p.pharmacistRegistrationNo||'')+'<br><b>Premises:</b> '+e(p.premisesAddress||'')+'</p>'+
  '<h3>Present Batch Stock</h3>'+simplePrintBatchTable()+
  '<h3>Purchase Register</h3>'+simplePrintGrnTable()+
  '<h3>Sales Register / Batch Traceability</h3>'+simplePrintSalesTable(sales)+
  '<h3>Customer Licence Register</h3>'+simplePrintCustomerTable()+
  '<h3>Quality Registers Summary</h3><p>Temperature logs: '+state().regTemperatureLogs.length+' | Returns: '+state().regReturns.length+' | Recalls: '+state().regRecalls.length+' | Complaints: '+state().regComplaints.length+' | CAPA: '+state().regCapa.length+'</p>'+
  '<p><b>Record retention configured:</b> '+e(String(p.recordRetentionYears||3))+' years. <b>System validation status:</b> '+e(p.systemValidationStatus||'draft')+'.</p>';
  const w=window.open('','_blank','width=1200,height=800');if(!w)return toast('Allow popups to print inspector pack.',true);w.document.write('<html><head><title>Drug Inspector Pack</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin:10px 0 24px}th,td{border:1px solid #999;padding:6px;font-size:12px}th{background:#eee}h1,h2,h3{color:#174b2f}</style></head><body>'+html+'<script>window.onload=()=>window.print()<\/script></body></html>');w.document.close();
  writeAudit('inspector_pack_printed','regulatory','inspector-pack',{approvedSales:sales.length,batches:state().regBatches.length});
}
function simplePrintBatchTable(){return '<table><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Available</th><th>Status</th></tr>'+state().regBatches.map(x=>'<tr><td>'+e(productName(x.productId))+'</td><td>'+e(x.batchNo||'')+'</td><td>'+e(d(x.expiryDate))+'</td><td>'+f(x.availableQty)+'</td><td>'+e(expired(x.expiryDate)?'expired':x.status||'')+'</td></tr>').join('')+'</table>';}
function simplePrintGrnTable(){return '<table><tr><th>Date</th><th>GRN</th><th>Supplier</th><th>Invoice</th><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th></tr>'+state().regGrns.map(x=>'<tr><td>'+e(d(x.receivedDate||x.createdAt))+'</td><td>'+e(x.grnNo||'')+'</td><td>'+e(x.supplierName||'')+'</td><td>'+e(x.purchaseInvoiceNo||'')+'</td><td>'+e(x.productName||'')+'</td><td>'+e(x.batchNo||'')+'</td><td>'+e(d(x.expiryDate))+'</td><td>'+f(x.receivedQty)+'</td></tr>').join('')+'</table>';}
function simplePrintSalesTable(sales){let rows='';sales.forEach(s=>{(s.items||[]).forEach(it=>{rows+='<tr><td>'+e(d(s.saleDate))+'</td><td>'+e(s.invoiceNo||'')+'</td><td>'+e(customerName(s.customerId))+'</td><td>'+e(it.name||'')+'</td><td>'+e(batchText(it))+'</td><td>'+e(expiryText(it))+'</td><td>'+f(it.issuedQty||0)+'</td></tr>';});});return '<table><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th></tr>'+rows+'</table>';}
function simplePrintCustomerTable(){return '<table><tr><th>Code</th><th>Customer</th><th>Type</th><th>DSL No.</th><th>Expiry</th><th>Verified</th></tr>'+state().customers.map(x=>'<tr><td>'+e(x.customerCode||'')+'</td><td>'+e(x.shopName||x.customerName||'')+'</td><td>'+e(x.customerType||'')+'</td><td>'+e(x.drugSaleLicenseNo||'')+'</td><td>'+e(d(x.licenseExpiryDate))+'</td><td>'+e(x.licenseVerified===true?'Yes':'No')+'</td></tr>').join('')+'</table>';}

function requiresCustomerLicense(c){
  const type=normalize(c?.customerType||'pharmacy');
  if(c?.licenseRequired===false)return false;
  return ['pharmacy','medical store','distributor','wholesaler','hospital'].includes(type)||c?.licenseRequired===true;
}
export function validateCustomerLicense(customer,onDateValue){
  if(!requiresCustomerLicense(customer))return {ok:true,message:''};
  if(!customer?.drugSaleLicenseNo)return {ok:false,message:'Customer Drug Sale Licence number is missing.'};
  if(customer?.licenseVerified!==true)return {ok:false,message:'Customer Drug Sale Licence is not marked verified.'};
  const at=asDate(onDateValue)||new Date();
  if(customer?.licenseExpiryDate&&expired(customer.licenseExpiryDate,at))return {ok:false,message:'Customer Drug Sale Licence is expired for the invoice date.'};
  return {ok:true,message:''};
}

export function batchText(item){ return (item?.batchAllocations||[]).map(a=>a.batchNo||'').filter(Boolean).join(', '); }
export function expiryText(item){ return (item?.batchAllocations||[]).map(a=>d(a.expiryDate)).filter(Boolean).join(', '); }

function allocationPlanForItem(item){
  let need=Number(item.issuedQty||0);
  const candidates=state().regBatches.filter(function(b){
    return b.productId===item.productId&&b.status==='saleable'&&Number(b.availableQty||0)>0&&!expired(b.expiryDate);
  }).sort(function(a,b){
    const ea=asDate(a.expiryDate)?.getTime()||Number.MAX_SAFE_INTEGER,eb=asDate(b.expiryDate)?.getTime()||Number.MAX_SAFE_INTEGER;
    if(ea!==eb)return ea-eb;
    return (asDate(a.receivedAt)?.getTime()||0)-(asDate(b.receivedAt)?.getTime()||0);
  });
  const plan=[];
  for(const b of candidates){if(need<=0)break;const q=Math.min(need,Number(b.availableQty||0));if(q>0){plan.push({batch:b,qty:q});need-=q;}}
  if(need>0)throw new Error(item.name+': insufficient saleable batch stock. Missing '+need+' unit(s). Receive/Release batch stock first.');
  return plan;
}

export async function applyFefoToApproval(tx,saleData,now){
  const plans=(saleData.items||[]).map(function(item){return {item,plan:allocationPlanForItem(item)};});
  const unique=new Map();plans.forEach(x=>x.plan.forEach(p=>unique.set(p.batch.id,p.batch)));
  const snaps=new Map();
  for(const [id,b] of unique){snaps.set(id,await tx.get(doc(db(),'inventoryBatches',id)));}
  const liveAvail=new Map();
  for(const [id,snap] of snaps){if(!snap.exists())throw new Error('Batch disappeared during approval.');const z=snap.data();if(z.status!=='saleable'||expired(z.expiryDate))throw new Error('Batch '+z.batchNo+' is no longer saleable.');liveAvail.set(id,Number(z.availableQty||0));}
  const updatedItems=[];
  for(const row of plans){
    const allocations=[];
    for(const p of row.plan){
      const id=p.batch.id,live=liveAvail.get(id)||0;if(live<p.qty)throw new Error('Batch '+p.batch.batchNo+' changed; reopen invoice approval.');
      liveAvail.set(id,live-p.qty);
      allocations.push({batchId:id,batchNo:p.batch.batchNo,expiryDate:p.batch.expiryDate,mfgDate:p.batch.mfgDate,qty:p.qty,supplierId:p.batch.supplierId||'',supplierName:p.batch.supplierName||''});
    }
    updatedItems.push(Object.assign({},row.item,{batchAllocations:allocations,manufacturer:row.item.manufacturer||productById(row.item.productId)?.manufacturer||'',registrationNo:row.item.registrationNo||productById(row.item.productId)?.registrationNo||''}));
  }
  for(const [id,newQty] of liveAvail){const snap=snaps.get(id),z=snap.data();tx.update(doc(db(),'inventoryBatches',id),{availableQty:newQty,updatedAt:now,lastIssueAt:now});}
  updatedItems.forEach(function(item){
    const p=productById(item.productId);
    if(p?.controlledDrug===true){
      (item.batchAllocations||[]).forEach(function(a){
        tx.set(doc(collection(db(),'controlledDrugRegister')),{productId:item.productId,batchId:a.batchId,batchNo:a.batchNo,transactionType:'sale_approved',qtyIn:0,qtyOut:Number(a.qty||0),reference:saleData.invoiceNo,partyName:customerName(saleData.customerId),saleId:saleData.id||'',transactionDate:now,enteredBy:state().user.uid,enteredByName:state().me?.fullName||'',createdAt:now,automatic:true});
      });
    }
  });
  return updatedItems;
}

export async function restoreSaleBatches(tx,saleData,now,reason){
  const allocations=[];(saleData.items||[]).forEach(function(item){(item.batchAllocations||[]).forEach(function(a){allocations.push({item,a});});});
  if(!allocations.length)return {};
  const ids=Array.from(new Set(allocations.map(x=>x.a.batchId).filter(Boolean))),snaps=new Map();
  for(const id of ids){snaps.set(id,await tx.get(doc(db(),'inventoryBatches',id)));}
  const additions=new Map(),saleableByProduct={};
  allocations.forEach(x=>additions.set(x.a.batchId,(additions.get(x.a.batchId)||0)+Number(x.a.qty||0)));
  for(const [id,qty] of additions){
    const snap=snaps.get(id);if(!snap?.exists())continue;
    const z=snap.data();
    tx.update(doc(db(),'inventoryBatches',id),{availableQty:Number(z.availableQty||0)+qty,updatedAt:now,lastReturnAt:now});
    if(z.status==='saleable'&&!expired(z.expiryDate)){
      const productId=z.productId;
      saleableByProduct[productId]=(saleableByProduct[productId]||0)+qty;
    }
  }
  allocations.forEach(function(x){
    const p=productById(x.item.productId);
    if(p?.controlledDrug===true)tx.set(doc(collection(db(),'controlledDrugRegister')),{productId:x.item.productId,batchId:x.a.batchId,batchNo:x.a.batchNo,transactionType:'invoice_cancel_return',qtyIn:Number(x.a.qty||0),qtyOut:0,reference:saleData.invoiceNo,partyName:customerName(saleData.customerId),saleId:saleData.id||'',notes:reason||'',transactionDate:now,enteredBy:state().user.uid,enteredByName:state().me?.fullName||'',createdAt:now,automatic:true});
  });
  return saleableByProduct;
}
