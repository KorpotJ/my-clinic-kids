/* ===== My Clinic Kids admin — 60-parents.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

let PARENTS_ALL = [];        // full list from GET /admin/parents
let VIEWING_PARENT_ARCHIVE = false;
let editingParentId = null;  // null = create, id = edit

async function loadParents(){
  const rows = document.getElementById('parents-rows');
  try{
    const res = await adminApi('/admin/parents');
    if(!res.ok){
      rows.innerHTML = `<tr><td colspan="6"><div class="empty" style="padding:24px">โหลดข้อมูลผู้ปกครองไม่สำเร็จ</div></td></tr>`;
      return;
    }
    PARENTS_ALL = await res.json();
    renderParents();
  }catch(e){
    rows.innerHTML = `<tr><td colspan="6"><div class="empty" style="padding:24px">โหลดข้อมูลผู้ปกครองไม่สำเร็จ</div></td></tr>`;
  }
}

function toggleParentArchive(){
  VIEWING_PARENT_ARCHIVE = !VIEWING_PARENT_ARCHIVE;
  
  const title = document.getElementById('members-title');
  if(title) title.textContent = VIEWING_PARENT_ARCHIVE ? 'บัญชีผู้ปกครองที่ถูกระงับ' : 'จัดการสมาชิก';
  
  document.getElementById('parent-archive-toggle').innerHTML = VIEWING_PARENT_ARCHIVE ? '← กลับไปรายชื่อผู้ปกครอง' : SVG_ARCHIVE + 'รายการบัญชีที่ถูกระงับ';
  document.getElementById('parent-add-btn').style.display = VIEWING_PARENT_ARCHIVE ? 'none' : '';
  loadParents();
}

function renderParents(){
  const rows = document.getElementById('parents-rows');
  if(!PARENTS_ALL.length){
    rows.innerHTML = `<tr><td colspan="6"><div class="empty" style="padding:26px"><span class="ic">👪</span>${VIEWING_PARENT_ARCHIVE?'ไม่มีบัญชีที่ถูกระงับ':'ยังไม่มีผู้ปกครองในระบบ'}</div></td></tr>`;
    return;
  }
  const canEdit = isTopRole(USER.role);
  const canDirect = isDirector(USER.role);
  rows.innerHTML = PARENTS_ALL.map(p=>{
    const badge = p.is_offline
      ? `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:#FFF3CD;color:#856404;font-size:12px;font-weight:600">ออฟไลน์</span>`
      : `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:var(--green-bg,#D9F0E1);color:var(--green-ink,#1B6E42);font-size:12px;font-weight:600">✓ ผูก LINE แล้ว</span>`;
    const phone = p.phone
      ? `<a href="tel:${String(p.phone).replace(/[^0-9+]/g,'')}" class="phone-link" onclick="event.stopPropagation()">${p.phone}</a>`
      : `<span style="color:var(--ink-soft)">—</span>`;
    const p2 = p.parent2_name ? p.parent2_name : `<span style="color:var(--ink-soft)">—</span>`;
    const safe = String(p.name).replace(/'/g,"\\'");

    let actions = '';
    if(VIEWING_PARENT_ARCHIVE){
      if(canEdit)   actions += `<button class="btn btn-ghost btn-sm" onclick="setParentStatus(${p.id},'restore','${safe}')">${SVG_RESTORE}กู้คืนบัญชีที่ถูกระงับ</button>`;
      if(canDirect) actions += ` <button class="btn btn-danger btn-sm" onclick="setParentStatus(${p.id},'delete','${safe}')">🗑️ ลบบัญชีออกจากระบบถาวร</button>`;
    } else if(canEdit){
      actions += `<button class="btn btn-ghost btn-sm" onclick="openParentForm(${p.id})">✏️ แก้ไข</button>`;
      actions += ` <button class="btn btn-danger btn-sm" onclick="setParentStatus(${p.id},'archive','${safe}')">${SVG_ARCHIVE}ระงับบัญชี</button>`;
    }

    return `<tr>
      <td data-label="ชื่อผู้ปกครอง"><span class="cellname">${p.name}</span></td>
      <td data-label="สถานะ">${badge}</td>
      <td data-label="เบอร์ติดต่อ">${phone}</td>
      <td data-label="ผู้ปกครองคนที่ 2">${p2}</td>
      <td data-label="จำนวนเด็ก">${p.child_count} คน</td>
      <td style="text-align:right;white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('');
}

async function setParentStatus(id, action, name){
  if(action==='archive' && !confirm(`ระงับบัญชีผู้ปกครอง "${name}"?\n\nจะไม่แสดงในรายชื่อปกติ แต่ยังเข้าแอป LINE ได้ตามเดิม\nกู้คืนได้ภายหลัง`)) return;
  if(action==='delete'  && !confirm(`⚠️ ลบบัญชี "${name}" ออกจากระบบถาวร?\n\nย้อนกลับไม่ได้`)) return;
  try{
    const res = await adminApi('/admin/parents',{method:'POST',body:JSON.stringify({action, id})});
    if(res.ok){
      showToast(action==='archive' ? '🚫 ระงับบัญชีแล้ว'
              : action==='restore' ? '↩ กู้คืนบัญชีแล้ว'
              :                      '🗑 ลบบัญชีออกจากระบบถาวรแล้ว');
      loadParents();
      return;
    }
    const err = await res.json().catch(()=>({}));
    const map = {
      HAS_ACTIVE_CHILDREN: `ยังมีเด็กที่ยังไม่ถูกจัดเก็บ ${err.children||''} คน — กรุณาจัดเก็บเด็กก่อนจึงจะระงับได้`,
      HAS_CHILDREN:        `ลบไม่ได้ — ยังมีเด็ก ${err.children||''} คนในระเบียนนี้ ต้องลบเด็กออกก่อน`,
      DIRECTOR_ONLY:       'เฉพาะผู้อำนวยการคลินิกเท่านั้นที่ลบบัญชีถาวรได้'
    };
    showToast(map[err.error] || ('ไม่สำเร็จ: '+(err.error||('status '+res.status))));
  }catch(e){ showToast('ไม่สำเร็จ: '+e.message); }
}

function openParentForm(id){
  editingParentId = id || null;
  const p = id ? PARENTS_ALL.find(x=>x.id===id) : null;
  document.getElementById('parent-modal-title').textContent = p ? 'แก้ไขข้อมูลผู้ปกครอง' : 'เพิ่มผู้ปกครอง';
  document.getElementById('pf-name').value          = p ? (p.name||'') : '';
  document.getElementById('pf-phone').value         = p ? (p.phone||'') : '';
  document.getElementById('pf-parent2-name').value  = p ? (p.parent2_name||'') : '';
  document.getElementById('pf-parent2-phone').value = p ? (p.parent2_phone||'') : '';
  document.getElementById('parent-dup-warn').style.display = 'none';
  document.getElementById('parent-modal').classList.add('active');
}
function closeParentForm(){
  document.getElementById('parent-modal').classList.remove('active');
  editingParentId = null;
  if(parentReturnToChild){ parentReturnToChild=false; document.getElementById('child-modal').classList.add('active'); }
}

// force=false : normal save (backend may return 409 duplicate)
// force=true  : "save as new anyway" after the admin sees the duplicate warning
async function submitParentForm(force){
  const name          = document.getElementById('pf-name').value.trim();
  const phone         = document.getElementById('pf-phone').value.trim();
  const parent2_name  = document.getElementById('pf-parent2-name').value.trim();
  const parent2_phone = document.getElementById('pf-parent2-phone').value.trim();
  if(!name){ showToast('กรุณากรอกชื่อผู้ปกครอง'); return; }

  const payload = editingParentId
    ? { action:'update', id:editingParentId, name, phone, parent2_name, parent2_phone }
    : { action:'create', name, phone, parent2_name, parent2_phone, force:!!force };

  const btn = document.getElementById('pf-save-btn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try{
    const res = await adminApi('/admin/parents',{method:'POST',body:JSON.stringify(payload)});
    if(res.ok){
      const created = await res.json().catch(()=>null);
      showToast(editingParentId ? '✅ แก้ไขข้อมูลผู้ปกครองแล้ว' : '✅ เพิ่มผู้ปกครองแล้ว');
      if(parentReturnToChild && !editingParentId && created && created.id){
        parentReturnToChild=false;
        document.getElementById('parent-modal').classList.remove('active');
        editingParentId=null;
        await loadParents();
        document.getElementById('child-modal').classList.add('active');
        rebuildChildParentPicker(created.id);   // back to child form, new parent selected
        return;
      }
      closeParentForm();
      await loadParents();
      return;
    }
    if(res.status===409){
      // duplicate-guard: show matches, offer "save as new anyway"
      const data = await res.json().catch(()=>({}));
      const matches = (data.matches||[]);
      const list = matches.map(m=>{
        const tag = m.is_offline ? 'ออฟไลน์' : 'ผูก LINE แล้ว';
        const ph = m.phone ? ' · '+m.phone : '';
        return `• ${m.name} (${tag}${ph}) — มีเด็ก ${m.child_count} คน`;
      }).join('<br>');
      document.getElementById('parent-dup-list').innerHTML =
        list + '<br><br>กด "บันทึกเป็นรายใหม่" หากยืนยันว่าเป็นคนละคน หรือปิดหน้าต่างเพื่อใช้ระเบียนเดิม';
      document.getElementById('parent-dup-warn').style.display = '';
      btn.textContent = 'บันทึกเป็นรายใหม่';
      btn.disabled = false;
      btn.setAttribute('onclick','submitParentForm(true)');
      return;
    }
    if(res.status===403){ showToast('ไม่มีสิทธิ์เพิ่ม/แก้ไขผู้ปกครอง'); }
    else { const e=await res.json().catch(()=>({})); showToast('บันทึกไม่สำเร็จ: '+(e.error||('status '+res.status))); }
  }catch(e){ showToast('บันทึกไม่สำเร็จ: '+e.message); }
  finally{
    btn.disabled = false;
    if(btn.textContent==='กำลังบันทึก…') btn.textContent = orig;
  }
}

// close parent modal on backdrop click
document.getElementById('parent-modal').addEventListener('click',function(e){
  if(e.target===this) closeParentForm();
});
document.getElementById('pf-name').addEventListener('input',function(){
  const warn=document.getElementById('parent-dup-warn');
  if(warn.style.display!=='none'){
    warn.style.display='none';
    const btn=document.getElementById('pf-save-btn');
    btn.textContent='บันทึก';
    btn.setAttribute('onclick','submitParentForm(false)');
  }
});

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2600);
}
document.getElementById('note-modal').addEventListener('click',function(e){
  if(e.target===this) closeNote();
});
document.getElementById('detail-modal').addEventListener('click',function(e){
  if(e.target===this) closeDetail();
});
document.getElementById('create-modal').addEventListener('click',function(e){
  if(e.target===this) closeCreate();
});
document.getElementById('staff-create-modal').addEventListener('click',function(e){
  if(e.target===this) closeCreateStaff();
});
document.getElementById('course-create-modal').addEventListener('click',function(e){
  if(e.target===this) closeCreateCourse();
});
document.getElementById('child-modal').addEventListener('click',function(e){
  if(e.target===this) closeChildForm();
});

/* ---------- INIT ---------- */

// ==========================================
// ระบบจัดการคำขอจองคิว (Pending Bookings)
// ==========================================