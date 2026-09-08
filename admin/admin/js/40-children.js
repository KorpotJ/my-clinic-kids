/* ===== My Clinic Kids admin — 40-children.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

let VIEWING_CHILD_ARCHIVE = false;
let PARENTS = [];   // derived from children (every parent registers with a child)
let childReturnToBooking = false, parentReturnToChild = false;   // booking-screen inline create chain
let ARCHIVED_CHILDREN = [];   // archive-view rows only; keeps active CHILDREN unpolluted

async function loadChildren(){
  const rows=document.getElementById('children-rows');
  try{
    const q = VIEWING_CHILD_ARCHIVE ? '/admin/children?archived=1' : '/admin/children';
    const res=await adminApi(q);
    if(!res.ok) throw new Error('status '+res.status);
    const list=await res.json();
    if(VIEWING_CHILD_ARCHIVE){
      // Archived rows populate the archive table ONLY — never overwrite the active
      // CHILDREN list that the schedule + booking dropdowns + name lookups rely on.
      ARCHIVED_CHILDREN=list;
    }else{
      CHILDREN=list;
      // keep a parent list for the "add child" picker (derived from active children)
      const seen={};
      CHILDREN.forEach(c=>{ if(c.parent_id && !seen[c.parent_id]){ seen[c.parent_id]=1; } });
      const merged={};
      PARENTS.forEach(p=>merged[p.id]=p);
      CHILDREN.forEach(c=>{ if(c.parent_id) merged[c.parent_id]={id:c.parent_id,name:c.parent_name}; });
      PARENTS=Object.values(merged);
    }
  }catch(e){
    if(VIEWING_CHILD_ARCHIVE){ ARCHIVED_CHILDREN=[]; } else { CHILDREN=[]; }
    if(rows) rows.innerHTML='<tr><td colspan="6"><div class="empty" style="padding:28px"><span class="ic">🧒</span>โหลดข้อมูลเด็กไม่สำเร็จ</div></td></tr>';
    return;
  }
  renderChildren();
}

// Fetch the current ACTIVE children into CHILDREN, independent of the members
// archive view — the booking dropdowns use this so an archived view can never
// hide active children or surface archived ones.
async function refreshActiveChildren(){
  try{ const res=await adminApi('/admin/children'); if(res.ok) CHILDREN=await res.json(); }catch(e){}
}
function toggleChildArchive(){
  VIEWING_CHILD_ARCHIVE = !VIEWING_CHILD_ARCHIVE;
  
  const title = document.getElementById('members-title');
  if(title) title.textContent = VIEWING_CHILD_ARCHIVE ? 'แฟ้มจัดเก็บรายชื่อเด็ก' : 'จัดการสมาชิก';

  // เตรียมโค้ดไอคอน SVG
  const iconArchive = SVG_ARCHIVE;
  const iconRestore = SVG_RESTORE;

  document.getElementById('ch-archive-toggle').innerHTML = VIEWING_CHILD_ARCHIVE ? `← กลับไปรายชื่อปกติ` : `${iconArchive} รายชื่อเด็กที่ถูกลบ`;
  document.getElementById('ch-add-btn').style.display = VIEWING_CHILD_ARCHIVE ? 'none' : '';
  loadChildren();
}

function renderChildren(){
  const rows=document.getElementById('children-rows');
  const list = VIEWING_CHILD_ARCHIVE ? ARCHIVED_CHILDREN : CHILDREN;
  if(!list.length){
    rows.innerHTML=`<tr><td colspan="6"><div class="empty" style="padding:28px"><span class="ic">🧒</span>${VIEWING_CHILD_ARCHIVE?'แฟ้มจัดเก็บว่าง':'ยังไม่มีข้อมูลเด็ก'}</div></td></tr>`;
    return;
  }
  const canEdit=isTopRole(USER.role);
  const canDirect=isDirector(USER.role);
  
  // เตรียมโค้ดไอคอน SVG
  const iconArchive = SVG_ARCHIVE;
  const iconRestore = SVG_RESTORE;

  rows.innerHTML=list.map(c=>{
    const initial=(c.name||'?').replace(/^น้อง/,'').charAt(0);
    const safe=String(c.name).replace(/'/g,"\\'");
    
    // แทนที่ Emoji ด้วย SVG
    let actions='';
    if(canEdit){
      if(VIEWING_CHILD_ARCHIVE){
        actions += `<button class="btn btn-ghost btn-sm" onclick="restoreChild(${c.id},'${safe}')">${iconRestore} กู้คืน</button>`;
        if(canDirect) actions += ` <button class="btn btn-danger btn-sm" onclick="deleteChild(${c.id},'${safe}')">🗑️ ลบถาวร</button>`;
      } else {
        actions += `<button class="btn btn-ghost btn-sm" onclick="openChildForm(${c.id})">✏️ แก้ไข</button>`;
        actions += ` <button class="btn btn-danger btn-sm" onclick="archiveChild(${c.id},'${safe}')">${iconArchive} จัดเก็บเด็ก</button>`;
      }
    }
    const phone = c.parent_phone
      ? `<a href="tel:${String(c.parent_phone).replace(/[^0-9+]/g,'')}" class="phone-link" onclick="event.stopPropagation()">${c.parent_phone}</a>`
      : `<span style="color:var(--ink-soft)">—</span>`;
    const rowClick = VIEWING_CHILD_ARCHIVE ? '' : `class="clickable" onclick="openChildView(${c.id})"`;
    return `<tr ${rowClick}>
      <td data-label="ชื่อเด็ก"><span class="avatar">${initial}</span><span class="cellname">${c.name}</span></td>
      <td data-label="อายุ">${c.age!=null?c.age+' ปี':'—'}</td>
      <td data-label="ผู้ปกครอง">${c.parent_name||'—'}</td>
      <td data-label="เบอร์ติดต่อ">${phone}</td>
      <td data-label="" style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()">${actions}</td>
    </tr>`;
  }).join('');
}

function toggleRowMenu(e,id){
  e.stopPropagation();
  const m=document.getElementById('rowmenu-'+id);
  const wasOpen=m.classList.contains('open');
  closeRowMenus();
  if(wasOpen) return;
  m.classList.add('open');                 // display:block so we can measure it
  const btn=e.currentTarget||e.target;
  const r=btn.getBoundingClientRect();
  m.style.visibility='hidden';             // measure without a flash at the wrong spot
  const mh=m.offsetHeight, mw=m.offsetWidth;
  let top=r.bottom+4;
  if(top+mh > window.innerHeight-8) top=r.top-mh-4;   // flip up if no room below
  let left=r.right-mw;                                 // right-align to the ⋮ button
  if(left<8) left=8;
  m.style.top=top+'px';
  m.style.left=left+'px';
  m.style.visibility='';
}
function closeRowMenus(){ document.querySelectorAll('.row-menu.open').forEach(m=>m.classList.remove('open')); }
document.addEventListener('click', closeRowMenus);

/* ---------- child add / edit ---------- */
let editingChildId = null;

function fmtThaiDate(iso){
  if(!iso) return '';
  try{ return new Date(iso).toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'}); }
  catch(e){ return String(iso).slice(0,10); }
}
function setVV(elId,val){
  const el=document.getElementById(elId);
  if(val && String(val).trim()){ el.textContent=val; el.classList.remove('empty'); }
  else { el.textContent='— ยังไม่มีข้อมูล —'; el.classList.add('empty'); }
}

// Open in READ-ONLY view mode (clicking a row)
function openChildView(id){
  editingChildId = id;
  const c = CHILDREN.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('ch-title').textContent = c.name || 'ข้อมูลเด็ก';
  document.getElementById('ch-sub').textContent = c.parent_name ? ('ผู้ปกครอง: '+c.parent_name) : '';
  setVV('v-first', c.first_name);
  setVV('v-last', c.last_name);
  setVV('v-nick', c.nickname);
  document.getElementById('v-dob').textContent = fmtThaiDate(c.date_of_birth) || '—';
  document.getElementById('v-gender').textContent = c.gender || '—';
  document.getElementById('v-age').textContent = (c.age!=null? c.age+' ปี' : '—');
  document.getElementById('v-parent').textContent = c.parent_name || '—';
  document.getElementById('v-phone').textContent = c.parent_phone || '—';
  const has2name = c.parent2_name && String(c.parent2_name).trim();
  const has2phone = c.parent2_phone && String(c.parent2_phone).trim();
  document.getElementById('v-parent2-wrap').style.display = has2name ? '' : 'none';
  document.getElementById('v-parent2').textContent = has2name ? c.parent2_name : '';
  document.getElementById('v-parent2-phone-wrap').style.display = has2phone ? '' : 'none';
  document.getElementById('v-parent2-phone').textContent = has2phone ? c.parent2_phone : '';
  setVV('v-alerts', c.medical_alerts);
  setVV('v-chief', c.chief_concern);
  setVV('v-diag', c.medical_diagnosis);
  setVV('v-prev', c.previous_therapy);
  setVV('v-goals', c.treatment_goals);
  showChildView();
  // edit button only for those who can edit
  const canEdit=isTopRole(USER.role);
  document.getElementById('ch-edit-toggle').style.display = canEdit ? '' : 'none';
  document.getElementById('ch-view-edit-btn').style.display = canEdit ? '' : 'none';
  document.getElementById('child-modal').classList.add('active');
}

// Fill the edit-mode form fields from a child (or blanks for new)
function fillChildEdit(c){
  document.getElementById('ch-parent').innerHTML =
    PARENTS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('') || '<option value="">— ไม่มีผู้ปกครองในระบบ —</option>';
  document.getElementById('ch-first-name').value = c && c.first_name ? c.first_name : '';
  document.getElementById('ch-last-name').value  = c && c.last_name ? c.last_name : '';
  document.getElementById('ch-nickname').value   = c && c.nickname ? c.nickname : '';
  document.getElementById('ch-dob').value = c && c.date_of_birth ? String(c.date_of_birth).slice(0,10) : '';
  document.getElementById('ch-gender').value            = c && c.gender ? c.gender : '';
  document.getElementById('ch-medical-alerts').value    = c && c.medical_alerts ? c.medical_alerts : '';
  document.getElementById('ch-chief-concern').value     = c && c.chief_concern ? c.chief_concern : '';
  document.getElementById('ch-medical-diagnosis').value = c && c.medical_diagnosis ? c.medical_diagnosis : '';
  document.getElementById('ch-previous-therapy').value  = c && c.previous_therapy ? c.previous_therapy : '';
  document.getElementById('ch-treatment-goals').value   = c && c.treatment_goals ? c.treatment_goals : '';
  // parent name + phone: only when editing an existing child (they live on the parent record)
  document.getElementById('ch-parent-name').value = c && c.parent_name ? c.parent_name : '';
  document.getElementById('ch-phone').value = c && c.parent_phone ? c.parent_phone : '';
  document.getElementById('ch-parent2-name').value  = c && c.parent2_name  ? c.parent2_name  : '';
  document.getElementById('ch-parent2-phone').value = c && c.parent2_phone ? c.parent2_phone : '';
  document.getElementById('ch-parent-block').style.display = c ? 'none' : '';
  document.getElementById('ch-parentname-block').style.display = c ? '' : 'none';
  document.getElementById('ch-phone-block').style.display = c ? '' : 'none';
  document.getElementById('ch-parent2-block').style.display = c ? '' : 'none';
  document.getElementById('ch-parent2-phone-block').style.display = c ? '' : 'none';
}

// Legacy entry point (nav "+ เพิ่มเด็ก" and ⋮ "แก้ไข") — open straight into edit mode
function openChildForm(id){
  editingChildId = id || null;
  const c = id ? CHILDREN.find(x=>x.id===id) : null;
  document.getElementById('ch-title').textContent = c ? 'แก้ไขข้อมูลเด็ก' : 'เพิ่มเด็ก';
  document.getElementById('ch-sub').textContent = c ? (c.parent_name ? 'ผู้ปกครอง: '+c.parent_name : '') : '';
  fillChildEdit(c);
  showChildEdit();
  document.getElementById('child-modal').classList.add('active');
}

// view/edit mode switches
function showChildView(){
  document.getElementById('ch-view').style.display='';
  document.getElementById('ch-edit').style.display='none';
  document.getElementById('ch-view-foot').style.display='';
  document.getElementById('ch-edit-foot').style.display='none';
  document.getElementById('ch-edit-toggle').style.display='';
}
function showChildEdit(){
  document.getElementById('ch-view').style.display='none';
  document.getElementById('ch-edit').style.display='';
  document.getElementById('ch-view-foot').style.display='none';
  document.getElementById('ch-edit-foot').style.display='';
  document.getElementById('ch-edit-toggle').style.display='none';
}
function enterChildEdit(){
  const c = editingChildId ? CHILDREN.find(x=>x.id===editingChildId) : null;
  document.getElementById('ch-title').textContent = 'แก้ไขข้อมูลเด็ก';
  fillChildEdit(c);
  showChildEdit();
}
function cancelChildEdit(){
  if(editingChildId){ openChildView(editingChildId); }  // back to read-only
  else { closeChildForm(); }
}

function closeChildForm() { 
  document.getElementById('child-modal').classList.remove('active'); 
  editingChildId = null; 

  // บังคับให้ปุ่ม "เพิ่มเด็ก" ในหน้าหลักกลับมาโชว์เสมอ (ถ้าไม่ได้อยู่ในโหมดดูแฟ้มจัดเก็บ)
  if (!VIEWING_CHILD_ARCHIVE) {
    document.getElementById('ch-add-btn').style.display = '';
  }
  if(childReturnToBooking){ childReturnToBooking=false; document.getElementById('create-modal').classList.add('active'); }
}

/* ===== Booking-screen inline create chain: session -> child -> parent ===== */
// Open the child form from the session (create-booking) modal. Hides the session
// modal (preserving the chosen course + hour) and lists ALL parents so a brand-new
// offline parent can be picked once created.
async function openChildFromBooking(){
  childReturnToBooking = true;
  document.getElementById('create-modal').classList.remove('active');
  if(typeof PARENTS_ALL==='undefined' || !PARENTS_ALL.length){ try{ await loadParents(); }catch(e){} }
  openChildForm();                 // fresh create mode
  rebuildChildParentPicker();      // full parent list (incl. childless offline parents)
}

// Rebuild the child form's parent <select> from the FULL parents list, optionally selecting one.
function rebuildChildParentPicker(selectId){
  const sel=document.getElementById('ch-parent'); if(!sel) return;
  const list=(typeof PARENTS_ALL!=='undefined' && PARENTS_ALL.length) ? PARENTS_ALL : PARENTS;
  sel.innerHTML='<option value="">— เลือกผู้ปกครอง —</option>'
    + list.map(p=>`<option value="${p.id}">${p.name}${p.phone?' · '+p.phone:''}</option>`).join('');
  if(selectId!=null) sel.value=String(selectId);
}

// From the child form, open the parent form to create a brand-new (walk-in) parent.
// Hides the child form (its typed fields stay in the DOM) and returns afterward.
function childAddParent(){
  parentReturnToChild = true;
  document.getElementById('child-modal').classList.remove('active');
  openParentForm();                // fresh create mode; duplicate-guard reused as-is
}

// After a child is created in the chain: back to the session modal with it selected.
async function returnToBookingWithChild(childId){
  childReturnToBooking=false;
  document.getElementById('child-modal').classList.remove('active');
  editingChildId=null;
  if(!VIEWING_CHILD_ARCHIVE){ document.getElementById('ch-add-btn').style.display=''; }
  await refreshActiveChildren();   // guarantee the new (active) child is in the list
  const chsel=document.getElementById('cr-child');
  if(chsel){
    chsel.innerHTML='<option value="">— เลือกเด็ก —</option>'
      + CHILDREN.map(c=>`<option value="${c.id}">${c.name} (${c.age} ปี)</option>`).join('');
    chsel.value=String(childId);
  }
  document.getElementById('create-modal').classList.add('active');
}

async function submitChildForm(){
  const firstName = document.getElementById('ch-first-name').value.trim();
  const lastName  = document.getElementById('ch-last-name').value.trim();
  const nickname  = document.getElementById('ch-nickname').value.trim();
  const dob       = document.getElementById('ch-dob').value;

  // Protected fields — must not be blank
  if(!firstName){ showToast('กรุณากรอกชื่อจริง'); return; }
  if(!lastName){ showToast('กรุณากรอกนามสกุล'); return; }
  if(!nickname){ showToast('กรุณากรอกชื่อเล่น'); return; }
  if(!dob){ showToast('กรุณากรอกวันเกิด'); return; }

  const gender           = document.getElementById('ch-gender').value;
  const medicalAlerts    = document.getElementById('ch-medical-alerts').value.trim();
  const chiefConcern     = document.getElementById('ch-chief-concern').value.trim();
  const medicalDiagnosis = document.getElementById('ch-medical-diagnosis').value.trim();
  const previousTherapy  = document.getElementById('ch-previous-therapy').value.trim();
  const treatmentGoals   = document.getElementById('ch-treatment-goals').value.trim();
  const phone        = document.getElementById('ch-phone').value.trim();
  const parentName   = document.getElementById('ch-parent-name').value.trim();
  const parent2Name  = document.getElementById('ch-parent2-name').value.trim();
  const parent2Phone = document.getElementById('ch-parent2-phone').value.trim();

  // Erasable fields: send empty string (not omitted) so the backend can clear them.
  // Protected fields: always send a value.
  const erasable = {
    gender: gender,
    medical_alerts: medicalAlerts,
    chief_concern: chiefConcern,
    medical_diagnosis: medicalDiagnosis,
    previous_therapy: previousTherapy,
    treatment_goals: treatmentGoals
  };

  let payload;
  if(editingChildId){
    if(parentName===''){ showToast('กรุณากรอกชื่อผู้ปกครอง'); return; }
    payload = {
      action:'update', id:editingChildId,
      first_name:firstName, last_name:lastName, nickname:nickname, date_of_birth:dob,
      parent_name:parentName, parent_phone:phone,
      parent2_name:parent2Name, parent2_phone:parent2Phone,
      ...erasable
    };
  } else {
    const parentId = Number(document.getElementById('ch-parent').value);
    if(!parentId){ showToast('กรุณาเลือกผู้ปกครอง'); return; }
    payload = {
      action:'create', parent_id:parentId,
      first_name:firstName, last_name:lastName, nickname:nickname, date_of_birth:dob,
      ...erasable
    };
  }

  const btn=document.getElementById('ch-save-btn');
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังบันทึก…';
  try{
    const res=await adminApi('/admin/children',{method:'POST',body:JSON.stringify(payload)});
    if(res.ok){
      const created = await res.json().catch(()=>null);
      showToast(editingChildId?'✅ แก้ไขข้อมูลแล้ว':'✅ เพิ่มเด็กแล้ว');
      await loadChildren();
      // stay open in the refreshed read-only view when editing; close on create
      if(editingChildId){ openChildView(editingChildId); }
      else if(childReturnToBooking && created && created.id){ await returnToBookingWithChild(created.id); }
      else { closeChildForm(); }
      return;
    }
    const err=await res.json().catch(()=>({}));
    if(res.status===403){ showToast('ไม่มีสิทธิ์แก้ไขข้อมูลเด็ก'); }
    else { showToast('บันทึกไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){ showToast('บันทึกไม่สำเร็จ: '+e.message); }
  finally{ btn.disabled=false; btn.textContent=original; }
}

async function archiveChild(id,name){
  if(!confirm(`ย้าย "${name}" เข้าแฟ้มจัดเก็บ?\n\nจะไม่แสดงในรายชื่อปกติ แต่ประวัติการรักษายังอยู่ครบ\nกู้คืนได้ภายหลัง`)) return;
  await childAction({action:'archive',id}, `📦 ย้าย "${name}" เข้าแฟ้มจัดเก็บแล้ว`);
}
async function restoreChild(id,name){
  await childAction({action:'restore',id}, `↩ กู้คืน "${name}" แล้ว`);
}
async function deleteChild(id,name){
  if(!confirm(`ลบ "${name}" ถาวร?\n\n⚠️ ย้อนกลับไม่ได้\nหากเคยมีการจอง ระบบจะไม่อนุญาตให้ลบ`)) return;
  await childAction({action:'delete',id}, `🗑 ลบ "${name}" ถาวรแล้ว`);
}

async function childAction(payload, okMsg){
  try{
    const res=await adminApi('/admin/children',{method:'POST',body:JSON.stringify(payload)});
    if(res.ok){ showToast(okMsg); loadChildren(); return; }
    const err=await res.json().catch(()=>({}));
    if(err.error==='HAS_HISTORY'){
      alert(`ลบถาวรไม่ได้\n\nเด็กคนนี้มีประวัติการจอง ${err.bookings} รายการ\nซึ่งเป็นประวัติการรักษา จึงลบถาวรไม่ได้\n\nใช้ "ลบ" เพื่อย้ายเข้าแฟ้มจัดเก็บแทน`);
    }else if(err.error==='DIRECTOR_ONLY'){ showToast('เฉพาะผู้อำนวยการคลินิกเท่านั้นที่ลบถาวรได้'); }
    else if(res.status===403){ showToast('ไม่มีสิทธิ์ดำเนินการ'); }
    else { showToast('ไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){ showToast('ไม่สำเร็จ: '+e.message); }
}

/* ---------- COURSES ---------- */