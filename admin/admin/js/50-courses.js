/* ===== My Clinic Kids admin — 50-courses.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

let VIEWING_ARCHIVE = false;

async function loadCourses(){
  try{
    const q = VIEWING_ARCHIVE ? '/admin/courses?archived=1' : '/admin/courses';
    const res=await adminApi(q);
    if(!res.ok) throw new Error('status '+res.status);
    COURSES=await res.json();
  }catch(e){
    COURSES=[];
  }
  renderCourses();
}

function toggleArchiveView(){
  if(!VIEWING_ARCHIVE && !isDirector(USER.role)){
    showToast('เฉพาะผู้อำนวยการคลินิกเท่านั้นที่เข้าแฟ้มจัดเก็บได้');
    return;
  }
  VIEWING_ARCHIVE = !VIEWING_ARCHIVE;
  document.getElementById('courses-title').textContent = VIEWING_ARCHIVE ? 'แฟ้มจัดเก็บคอร์ส' : 'คอร์สทั้งหมด';
  document.getElementById('courses-sub').textContent = VIEWING_ARCHIVE
    ? 'คอร์สที่ย้ายเข้าแฟ้มจัดเก็บแล้ว — ผู้ปกครองจะไม่เห็น'
    : 'โปรแกรมที่เปิดให้จอง';
  document.getElementById('archive-toggle').innerHTML = VIEWING_ARCHIVE ? '← กลับไปคอร์สที่เปิดใช้' : `${SVG_ARCHIVE}คอร์สที่ถูกจัดเก็บ`;
  document.getElementById('add-course-btn').style.display = VIEWING_ARCHIVE ? 'none' : '';
  loadCourses();
}

function renderCourses(){
  const grid=document.getElementById('course-grid');
  if(!COURSES.length){
  grid.innerHTML = VIEWING_ARCHIVE
      ? `<div class="empty"><span class="ic">${SVG_ARCHIVE}</span>แฟ้มจัดเก็บว่าง — ยังไม่มีคอร์สที่ถูกย้ายเข้าแฟ้มจัดเก็บ</div>`
      : '<div class="empty"><span class="ic">📚</span>ยังไม่มีคอร์ส หรือโหลดไม่สำเร็จ</div>';
    return;
  }
  const canManage = isTopRole(USER.role);      // create + archive
  const canDirect  = isDirector(USER.role);    // คลัง: restore + ลบถาวร
  grid.innerHTML=COURSES.map(co=>{
    const price=Number(co.price||0).toLocaleString(undefined,{minimumFractionDigits:0});
    const isGrp=co.session_type==='group';
    const typeTag=isGrp
      ? `<span class="tag tag-grp">👥 กลุ่ม · สูงสุด ${co.capacity} คน</span>`
      : `<span class="tag tag-ind">👤 เดี่ยว</span>`;
    const safeName=String(co.name).replace(/'/g,"\\'");

    let actions='';
    if(VIEWING_ARCHIVE){
      if(canDirect){
        actions = `<div class="course-actions">
             <button class="btn btn-ghost" onclick="restoreCourse(${co.id},'${safeName}')">↩ กู้คืน</button>
             <button class="btn btn-danger" onclick="permanentDeleteCourse(${co.id},'${safeName}')">ลบถาวร</button>
           </div>`;
      }
    }else if(canManage){
      actions = `<div class="course-actions">
             <button class="btn btn-ghost" onclick="archiveCourse(${co.id},'${safeName}')">${SVG_ARCHIVE}จัดเก็บคอร์สนี้</button>
           </div>`;
    }

    return `<div class="course-card ${VIEWING_ARCHIVE?'archived-card':''}">
      <div class="tag-row"><span class="tag">อายุ ${co.min_age}–${co.max_age} ปี</span>${typeTag}</div>
      <h3>${co.name}</h3>
      <p>${co.description||''}</p>
      <div class="meta"><span>⏱ ${co.duration_minutes} นาที</span><span class="price">฿${price}</span></div>
      ${actions}
    </div>`;
  }).join('');
}

/* ---------- ARCHIVE / RESTORE / PERMANENT DELETE ---------- */
async function archiveCourse(id, name){
  if(!confirm(`ย้าย "${name}" ไปในแฟ้มจัดเก็บ?\n\nผู้ปกครองจะไม่เห็นคอร์สนี้อีก แต่ประวัติการเรียนเดิมยังอยู่ครบ\nสามารถกู้คืนได้ภายหลัง`)) return;
  try{
    const res=await adminApi('/admin/courses?id='+encodeURIComponent(id),{method:'DELETE'});
    if(res.ok){ showToast(`📦 ย้าย "${name}" ไปในแฟ้มจัดเก็บแล้ว`); loadCourses(); return; }
    const err=await res.json().catch(()=>({}));
    if(res.status===403){ showToast('ไม่มีสิทธิ์จัดการคอร์ส'); }
    else { showToast('ไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){ showToast('ไม่สำเร็จ: '+e.message); }
}

async function restoreCourse(id, name){
  try{
    const res=await adminApi('/admin/courses',{method:'POST',body:JSON.stringify({action:'restore',id})});
    if(res.ok){ showToast(`↩ กู้คืน "${name}" แล้ว`); loadCourses(); return; }
    const err=await res.json().catch(()=>({}));
    if(err.error==='DIRECTOR_ONLY'){ showToast('เฉพาะผู้อำนวยการคลินิกเท่านั้นที่กู้คืนได้'); }
    else { showToast('กู้คืนไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){ showToast('กู้คืนไม่สำเร็จ: '+e.message); }
}

async function permanentDeleteCourse(id, name){
  if(!confirm(`ลบ "${name}" ถาวร?\n\n⚠️ การกระทำนี้ย้อนกลับไม่ได้\nหากคอร์สนี้เคยมีคาบเรียน ระบบจะไม่อนุญาตให้ลบ`)) return;
  try{
    const res=await adminApi('/admin/courses?id='+encodeURIComponent(id)+'&permanent=1',{method:'DELETE'});
    if(res.ok){ showToast(`🗑 ลบ "${name}" ถาวรแล้ว`); loadCourses(); return; }
    const err=await res.json().catch(()=>({}));
    if(err.error==='HAS_HISTORY'){
      alert(`ลบถาวรไม่ได้\n\n"${name}" มีคาบเรียนในประวัติ ${err.sessions} คาบ\nซึ่งผูกกับการจองและบันทึกผลของเด็ก\n\nคอร์สนี้จะอยู่ในแฟ้มจัดเก็บต่อไปเพื่อรักษาประวัติ`);
    }else if(err.error==='DIRECTOR_ONLY'){ showToast('เฉพาะผู้อำนวยการคลินิกเท่านั้นที่ลบถาวรได้'); }
    else if(res.status===403){ showToast('ไม่มีสิทธิ์ลบคอร์ส'); }
    else { showToast('ลบไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){ showToast('ลบไม่สำเร็จ: '+e.message); }
}

/* ---------- UTIL ---------- */
/* ================= PARENTS (offline-parent management, Slice 1) ================= */
