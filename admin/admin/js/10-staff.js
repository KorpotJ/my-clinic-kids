/* ===== My Clinic Kids admin — 10-staff.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

async function loadStaff(){
  const rows=document.getElementById('staff-rows');
  try{
    const q = VIEWING_STAFF_ARCHIVE ? '/admin/staff?archived=1' : '/admin/staff';
    const res=await adminApi(q);
    if(!res.ok) throw new Error('status '+res.status);
    STAFF=await res.json();
  }catch(e){
    STAFF=[];
    if(rows) rows.innerHTML='<tr><td colspan="4"><div class="empty" style="padding:24px"><span class="ic">🔒</span>โหลดรายชื่อพนักงานไม่สำเร็จ (ต้องเป็นผู้อำนวยการหรือผู้ดูแลระบบ)</div></td></tr>';
    return;
  }
  renderStaff();
}

function renderStaff(){
  const rows=document.getElementById('staff-rows');
  if(!rows) return;
  if(!STAFF.length){
    rows.innerHTML=`<tr><td colspan="4"><div class="empty" style="padding:24px"><span class="ic">👥</span>${VIEWING_STAFF_ARCHIVE?'ไม่มีบัญชีที่ถูกระงับ':'ยังไม่มีพนักงานในระบบ'}</div></td></tr>`;
    return;
  }
  const canDirect=isDirector(USER.role);
  rows.innerHTML=STAFF.map((s,i)=>{
    const display=s.name || s.email || s.username;
    const initial=(display||'?').charAt(0);
    const safe=String(s.username||'').replace(/'/g,"\\'");
    const isSelf=!!(USER.email && s.email && s.email===USER.email);

    // ----- suspended-accounts view: read-only role + restore / (Director) permanent delete -----
    if(VIEWING_STAFF_ARCHIVE){
      const roleTxt=s.role?`${s.role} · ${roleLabelTh(s.role)}`:'ยังไม่กำหนดบทบาท';
      let actions=`<button class="btn btn-ghost btn-sm" onclick="setStaffStatus('${safe}','enable')">↩ กู้คืนบัญชีที่ถูกระงับ</button>`;
      if(canDirect){
        actions+=` <button class="btn btn-danger btn-sm" onclick="setStaffStatus('${safe}','delete')">🗑️ ลบบัญชีออกจากระบบถาวร</button>`;
      }
      return `<tr>
        <td data-label="ชื่อ"><span class="avatar">${initial}</span><span class="cellname">${display}</span></td>
        <td data-label="อีเมล" style="color:var(--ink-soft)">${s.email||'—'}</td>
        <td data-label="บทบาท" style="color:var(--ink-soft)">${roleTxt}</td>
        <td data-label="" style="text-align:right;white-space:nowrap">${actions}</td>
      </tr>`;
    }

    // ----- active roster: role select + save + suspend (own row can't be suspended) -----
    const opts=ROLE_OPTIONS.map(r=>`<option value="${r}" ${r===s.role?'selected':''}>${r} · ${roleLabelTh(r)}</option>`).join('');
    const noRole=s.role?'':`<option value="" selected>— ยังไม่กำหนด —</option>`;
    const suspendBtn=isSelf?'':`<button class="btn btn-danger btn-sm" style="margin-left:8px" onclick="setStaffStatus('${safe}','disable')">🚫 ระงับบัญชีพนักงาน</button>`;
    return `<tr>
      <td data-label="ชื่อ"><span class="avatar">${initial}</span><span class="cellname">${display}</span></td>
      <td data-label="อีเมล" style="color:var(--ink-soft)">${s.email||'—'}</td>
      <td data-label="บทบาท"><select id="staff-role-${i}">${noRole}${opts}</select></td>
      <td data-label="" style="text-align:right;white-space:nowrap"><button class="btn btn-primary btn-sm" id="staff-btn-${i}" onclick="saveStaffRole(${i})">บันทึก</button>${suspendBtn}</td>
    </tr>`;
  }).join('');
}

function toggleStaffArchive(){
  VIEWING_STAFF_ARCHIVE=!VIEWING_STAFF_ARCHIVE;
  document.getElementById('staff-title').textContent = VIEWING_STAFF_ARCHIVE ? 'บัญชีพนักงานที่ถูกระงับ' : 'จัดการพนักงาน';
  document.getElementById('staff-sub').textContent = VIEWING_STAFF_ARCHIVE
    ? 'บัญชีที่ถูกระงับการใช้งาน — เข้าสู่ระบบไม่ได้ กู้คืนได้ภายหลัง'
    : 'กำหนดบทบาทของพนักงานแต่ละคน';
  document.getElementById('staff-archive-toggle').innerHTML = VIEWING_STAFF_ARCHIVE ? '← กลับไปรายชื่อพนักงาน' : `${SVG_ARCHIVE}รายการบัญชีที่ถูกระงับ`;
  document.getElementById('staff-add-btn').style.display = VIEWING_STAFF_ARCHIVE ? 'none' : '';
  loadStaff();
}

async function setStaffStatus(username, action){
  if(action==='disable' && !confirm('ระงับบัญชีพนักงานนี้?\n\nผู้ใช้จะเข้าสู่ระบบไม่ได้จนกว่าจะกู้คืน\nบทบาทและข้อมูลยังอยู่ครบ')) return;
  if(action==='delete'  && !confirm('⚠️ ลบบัญชีนี้ออกจากระบบถาวร?\n\nย้อนกลับไม่ได้ — บัญชีจะถูกลบออกจากระบบยืนยันตัวตนทั้งหมด')) return;
  try{
    const res=await adminApi('/admin/staff-status',{method:'POST',body:JSON.stringify({username,action})});
    if(res.ok){
      showToast(action==='disable' ? '🚫 ระงับบัญชีแล้ว'
              : action==='enable'  ? '↩ กู้คืนบัญชีแล้ว'
              :                      '🗑 ลบบัญชีออกจากระบบถาวรแล้ว');
      loadStaff();
      return;
    }
    const err=await res.json().catch(()=>({}));
    const map={
      CANNOT_MODIFY_SELF:'ไม่สามารถระงับหรือลบบัญชีของตัวเองได้',
      DIRECTOR_ONLY:'เฉพาะผู้อำนวยการคลินิกเท่านั้นที่ลบบัญชีถาวรได้',
      LAST_DIRECTOR:'ไม่สามารถระงับหรือลบผู้อำนวยการคลินิกคนสุดท้ายได้',
      USER_NOT_FOUND:'ไม่พบบัญชีนี้'
    };
    showToast(map[err.error] || ('ไม่สำเร็จ: '+(err.error||('status '+res.status))));
  }catch(e){ showToast('ไม่สำเร็จ: '+e.message); }
}

async function saveStaffRole(i){
  const s=STAFF[i];
  const sel=document.getElementById('staff-role-'+i);
  const newRole=sel.value;
  if(!newRole){ showToast('กรุณาเลือกบทบาท'); return; }
  if(newRole===s.role){ showToast('บทบาทไม่เปลี่ยนแปลง'); return; }

  const btn=document.getElementById('staff-btn-'+i);
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังบันทึก…';
  try{
    const res=await adminApi('/admin/staff-role',{
      method:'POST',
      body:JSON.stringify({ username:s.username, role:newRole })
    });
    if(res.ok){
      STAFF[i].role=newRole;
      showToast(`✅ ตั้งบทบาท ${s.name||s.email} → ${roleLabelTh(newRole)}`);
    }else{
      const err=await res.json().catch(()=>({}));
      if(err.error && err.error.includes('own top-level')){
        showToast('ไม่สามารถลดบทบาทตัวเองออกจากระดับผู้บริหารได้');
      }else{
        showToast('บันทึกไม่สำเร็จ: '+(err.error||('status '+res.status)));
      }
      sel.value=s.role||'';   // revert the dropdown
    }
  }catch(e){
    showToast('บันทึกไม่สำเร็จ: '+e.message);
    sel.value=s.role||'';
  }finally{
    btn.disabled=false; btn.textContent=original;
  }
}

// COURSES is loaded live from GET /admin/courses (see loadCourses)
