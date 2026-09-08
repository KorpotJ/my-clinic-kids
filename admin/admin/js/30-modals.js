/* ===== My Clinic Kids admin — 30-modals.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

function openCreateCourse(){
  document.getElementById('nc-name').value='';
  document.getElementById('nc-desc').value='';
  document.getElementById('nc-type').value='individual';
  document.getElementById('nc-capacity').value=4;
  document.getElementById('nc-minage').value=3;
  document.getElementById('nc-maxage').value=8;
  document.getElementById('nc-price').value=650;
  onCourseTypeChange();
  document.getElementById('course-create-modal').classList.add('active');
}
function closeCreateCourse(){ document.getElementById('course-create-modal').classList.remove('active'); }

function onCourseTypeChange(){
  const isGroup=document.getElementById('nc-type').value==='group';
  document.getElementById('nc-capacity-block').style.display=isGroup?'':'none';
  document.getElementById('nc-type-hint').textContent=isGroup
    ? 'คาบกลุ่มใช้เวลา 2 ชั่วโมงตามระบบตาราง'
    : 'คาบเดี่ยวใช้เวลา 1 ชั่วโมง รับได้ 1 คน';
}

async function submitCreateCourse(){
  const name=document.getElementById('nc-name').value.trim();
  const description=document.getElementById('nc-desc').value.trim();
  const session_type=document.getElementById('nc-type').value;
  const capacity=Number(document.getElementById('nc-capacity').value);
  const min_age=Number(document.getElementById('nc-minage').value);
  const max_age=Number(document.getElementById('nc-maxage').value);
  const price=Number(document.getElementById('nc-price').value);

  if(!name){ showToast('กรุณากรอกชื่อคอร์ส'); return; }
  if(!Number.isFinite(min_age)||!Number.isFinite(max_age)||max_age<min_age){
    showToast('ช่วงอายุไม่ถูกต้อง'); return;
  }
  if(!Number.isFinite(price)||price<0){ showToast('ราคาไม่ถูกต้อง'); return; }
  if(session_type==='group' && (!Number.isFinite(capacity)||capacity<2)){
    showToast('คาบกลุ่มต้องรับอย่างน้อย 2 คน'); return;
  }

  const payload={ name, description, session_type, min_age, max_age, price };
  if(session_type==='group') payload.capacity=capacity;

  const btn=document.getElementById('nc-save-btn');
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังสร้าง…';
  try{
    const res=await adminApi('/admin/courses',{method:'POST',body:JSON.stringify(payload)});
    if(res.status===201){
      closeCreateCourse();
      showToast('✅ สร้างคอร์สเรียบร้อย');
      loadCourses();
      return;
    }
    const err=await res.json().catch(()=>({}));
    if(res.status===403){ showToast('ไม่มีสิทธิ์สร้างคอร์ส (เฉพาะผู้อำนวยการ/ผู้ดูแลระบบ)'); }
    else { showToast('สร้างคอร์สไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){
    showToast('สร้างคอร์สไม่สำเร็จ: '+e.message);
  }finally{
    btn.disabled=false; btn.textContent=original;
  }
}

/* ---------- CREATE EMPLOYEE ---------- */
function openCreateStaff(){
  document.getElementById('ns-name').value='';
  document.getElementById('ns-email').value='';
  document.getElementById('ns-role').innerHTML=
    ROLE_OPTIONS.map(r=>`<option value="${r}" ${r==='OT'?'selected':''}>${r} · ${roleLabelTh(r)}</option>`).join('');
  document.getElementById('staff-create-modal').classList.add('active');
}
function closeCreateStaff(){ document.getElementById('staff-create-modal').classList.remove('active'); }

async function submitCreateStaff(){
  const name=document.getElementById('ns-name').value.trim();
  const email=document.getElementById('ns-email').value.trim();
  const role=document.getElementById('ns-role').value;

  if(!name){ showToast('กรุณากรอกชื่อ'); return; }
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showToast('กรุณากรอกอีเมลให้ถูกต้อง'); return; }

  const btn=document.getElementById('ns-save-btn');
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังสร้าง…';
  try{
    const res=await adminApi('/admin/staff-create',{
      method:'POST',
      body:JSON.stringify({ name, email, role })
    });
    if(res.status===201){
      closeCreateStaff();
      showToast('✅ สร้างบัญชีแล้ว — ส่งอีเมลเชิญไปที่ '+email);
      loadStaff();
      return;
    }
    const err=await res.json().catch(()=>({}));
    if(err.error==='USER_EXISTS'){ showToast('อีเมลนี้มีบัญชีอยู่แล้ว'); }
    else { showToast('สร้างบัญชีไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){
    showToast('สร้างบัญชีไม่สำเร็จ: '+e.message);
  }finally{
    btn.disabled=false; btn.textContent=original;
  }
}

/* ---------- CREATE SESSION ---------- */
let createHour = null;   // the clicked slot hour (Bangkok)

// Build a UTC ISO timestamp for the given Bangkok wall-clock hour on viewDate.
// Bangkok is UTC+7 (no DST): UTC = Bangkok - 7h.
function bangkokHourToUTCISO(hour){
  const y=viewDate.getFullYear(), m=viewDate.getMonth(), d=viewDate.getDate();
  // Date.UTC treats args as UTC; subtract 7h from the Bangkok hour to get UTC.
  return new Date(Date.UTC(y, m, d, hour - 7, 0, 0)).toISOString();
}

async function openCreate(hour){
  createHour=hour;
  const hh=String(hour).padStart(2,'0');
  document.getElementById('cr-when').textContent=
    `${viewDate.getDate()} ${MONTH[viewDate.getMonth()]} ${viewDate.getFullYear()+543} · ${hh}:00 น.`;

  // course options
  const csel=document.getElementById('cr-course');
  csel.innerHTML=COURSES.map(c=>{
    const tag=c.session_type==='group'?' (กลุ่ม)':'';
    return `<option value="${c.id}">${c.name}${tag}</option>`;
  }).join('');

  // child options — ALWAYS current ACTIVE children (never the archive view's list)
  const chsel=document.getElementById('cr-child');
  chsel.innerHTML='<option value="">กำลังโหลดรายชื่อเด็ก…</option>';

  onCreateCourseChange();
  document.getElementById('create-modal').classList.add('active');

  await refreshActiveChildren();
  chsel.innerHTML='<option value="">— เลือกเด็ก —</option>'
    + CHILDREN.map(c=>`<option value="${c.id}">${c.name} (${c.age} ปี)</option>`).join('');
}
function closeCreate(){ document.getElementById('create-modal').classList.remove('active'); createHour=null; }

function onCreateCourseChange(){
  const co=COURSES.find(c=>c.id===Number(document.getElementById('cr-course').value));
  const hint=document.getElementById('cr-course-hint');
  if(!co){ hint.textContent=''; return; }
  const hh=String(createHour).padStart(2,'0');
  const endMin=createHour*60+co.duration_minutes;
  const end=`${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`;
  if(co.session_type==='group'){
    hint.textContent=`คาบกลุ่ม ${co.duration_minutes} นาที (${hh}:00–${end}) · รับได้ ${co.capacity} คน`;
  }else{
    hint.textContent=`คาบเดี่ยว ${co.duration_minutes} นาที (${hh}:00–${end}) · รับได้ 1 คน`;
  }
}

async function submitCreate(){
  const courseId=Number(document.getElementById('cr-course').value);
  const childVal=document.getElementById('cr-child').value;
  const childId=childVal?Number(childVal):null;
  if(!courseId){ showToast('กรุณาเลือกคอร์ส'); return; }
  if(!childVal){ showToast('กรุณาเลือกเด็ก'); return; }

  const payload={
    course_id: courseId,
    therapist_id: 2,                                   // ครูขนุน (only therapist)
    starts_at: bangkokHourToUTCISO(createHour)
  };
  if(childId) payload.child_id=childId;

  const btn=document.getElementById('cr-save-btn');
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังสร้าง…';
  try{
    const res=await adminApi('/admin/sessions',{method:'POST',body:JSON.stringify(payload)});
    if(res.status===201){
      closeCreate();
      showToast('✅ สร้างคาบเรียบร้อย');
      renderSchedule();
      return;
    }
    // known conflicts
    const err=await res.json().catch(()=>({}));
    if(err.error==='THERAPIST_SLOT_TAKEN'){ showToast('เวลานี้มีคาบของครูขนุนอยู่แล้ว'); }
    else if(err.error==='ALREADY_BOOKED'){ showToast('เด็กคนนี้ถูกจองในคาบนี้แล้ว'); }
    else { showToast('สร้างคาบไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){
    showToast('สร้างคาบไม่สำเร็จ: '+e.message);
  }finally{
    btn.disabled=false; btn.textContent=original;
  }
}

/* ---------- NOTE MODAL (carries real booking_id) ---------- */
function openNote(bookingId, childName, courseName, timeLabel){
  noteContext={booking_id:bookingId};
  document.getElementById('note-who').textContent=`${childName} · ${courseName} · ${timeLabel} น.`;
  document.getElementById('note-clinical').value='';
  document.getElementById('note-parent').value='';
  closeDetail();
  document.getElementById('note-modal').classList.add('active');
}
function closeNote(){document.getElementById('note-modal').classList.remove('active');noteContext=null}

async function saveNote(){
  if(!noteContext) return;
  const clinical=document.getElementById('note-clinical').value.trim();
  const parent=document.getElementById('note-parent').value.trim();
  if(!clinical && !parent){
    showToast('กรุณากรอกบันทึกอย่างน้อยหนึ่งช่อง');
    return;
  }

  const btn=document.getElementById('note-save-btn');
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังบันทึก…';

  try{
    const res=await adminApi('/admin/session-notes',{
      method:'POST',
      body:JSON.stringify({
        booking_id:noteContext.booking_id,
        clinical_note:clinical,
        parent_summary:parent
      })
    });
    if(res.status!==201 && res.status!==200){
      const err=await res.json().catch(()=>({}));
      throw new Error(err.error||('status '+res.status));
    }
    closeNote();
    showToast('✅ บันทึกผลเรียบร้อย');
    renderSchedule();   // refresh so the 📝 flag / "บันทึกแล้ว" appears
  }catch(e){
    showToast('บันทึกไม่สำเร็จ: '+e.message);
  }finally{
    btn.disabled=false; btn.textContent=original;
  }
}

/* ---------- CHILDREN ---------- */