/* ===== My Clinic Kids admin — 20-schedule.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

let COURSES = [];

// CHILDREN is loaded live from GET /admin/children (see loadChildren)
let CHILDREN = [];

function ymd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const today = new Date(); today.setHours(0,0,0,0);

/* ---------- STATE ---------- */
let viewDate = new Date(today);
let noteContext = null;

const childById  = id=>CHILDREN.find(c=>c.id===id);
const courseById = id=>COURSES.find(c=>c.id===id);

/* ---------- NAV & TABS ---------- */
document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view;
    document.getElementById('view-'+view).classList.add('active');
    
    // refresh the merged pending queue when returning to the schedule page
    if(view==='schedule') loadPendingBookings();
    
    // ถ้าเข้ามาหน้าสมาชิกรวม ให้โหลดข้อมูลของ Tab ที่เปิดอยู่
    if(view==='members') {
      if(document.getElementById('tab-parents').classList.contains('active')) {
        loadParents();
      } else {
        loadChildren();
      }
    }
  });
});

function switchMemberTab(tabName) {
  // เปลี่ยนสีปุ่ม Tab
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('tab-btn-' + tabName).classList.add('active');
  
  // สลับเนื้อหา Tab
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  
  // โหลดข้อมูลจาก API ใหม่เมื่อสลับ Tab
  if(tabName === 'parents') loadParents();
  if(tabName === 'children') loadChildren();
}

/* ---------- SCHEDULE (real data, timetable) ---------- */
const DOW=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const MONTH=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// working hours 09:00–18:00, lunch 12:00–13:00 blocked
const OPEN_HOUR=9, CLOSE_HOUR=18, LUNCH_HOUR=12;
const HOURS=[]; for(let h=OPEN_HOUR;h<CLOSE_HOUR;h++) HOURS.push(h);   // 9..17 (block start hours)

let currentSessions=[];   // grouped sessions for the viewed day

// Bangkok wall-clock parts from a UTC timestamp
const bkkFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false});
function bkkHM(iso){const p=bkkFmt.format(new Date(iso));const [h,m]=p.split(':').map(Number);return {h,m,label:p};}

// group the flat /admin/sessions rows (one row per booking) into sessions
function groupSessions(rows){
  const map=new Map();
  rows.forEach(r=>{
    // 1. สร้างก้อนข้อมูลรอบเรียน (Session)
    if(!map.has(r.session_id)){
      map.set(r.session_id,{
        session_id:r.session_id, starts_at:r.starts_at,
        session_type:r.session_type, course_name:r.course_name,
        duration_minutes:r.duration_minutes, capacity:r.capacity,
        seats_taken:r.seats_taken, session_status:r.session_status,
        therapist_nickname:r.therapist_nickname, therapist_name:r.therapist_name,
        bookings:[] // เตรียม Array ว่างไว้ใส่คนจอง
      });
    }
    
    // 2. เอาข้อมูลคนจอง (Booking) ยัดเข้าไปในรอบเรียนนั้นๆ
    if(r.booking_id){
      map.get(r.session_id).bookings.push({
        booking_id:r.booking_id,
        booking_status:r.booking_status,
        child_id:r.child_id,
        // GET /admin/sessions returns child_name (CONCAT) + child_age
        child_name: r.child_name,
        child_age: r.child_age,
        has_note:r.has_note
      });
    }
  });
  return [...map.values()];
}

/* ---------- VIEW SWITCHING (เดือน / วัน) ---------- */
let CAL_VIEW = 'month';        // 'month' | 'day'

function setCalView(v){
  CAL_VIEW = v;
  document.getElementById('vt-year').classList.toggle('on', v==='year');
  document.getElementById('vt-month').classList.toggle('on', v==='month');
  document.getElementById('vt-day').classList.toggle('on', v==='day');
  
  const btnCx = document.getElementById('vt-cancelled');
  if(btnCx) btnCx.classList.toggle('on', v==='cancelled');
  
  // ควบคุมการแสดงผลของปุ่มย้อนกลับ
  const backBtn = document.getElementById('cx-back-btn');
  if(backBtn) backBtn.style.display = (v === 'cancelled') ? 'flex' : 'none';

  renderSchedule();
}

const MIN_YEAR = 2026;   // clinic opened 2569 BE (2026 CE) — no data before this
function shiftPeriod(step){
  if(CAL_VIEW==='year'){
    const target = viewDate.getFullYear()+step;
    if(target < MIN_YEAR){
      showToast('ปี '+(MIN_YEAR+543)+' เป็นปีแรกที่คลินิกเปิด');
      return;
    }
    viewDate.setFullYear(target, 0, 1);
  }
  else if(CAL_VIEW==='month' || CAL_VIEW==='cancelled'){ viewDate.setMonth(viewDate.getMonth()+step, 1); }
  else { viewDate.setDate(viewDate.getDate()+step); }
  renderSchedule();
}

/* ---------- YEAR OVERVIEW (12-month grid, click to drill into month) ---------- */
async function renderYear(){
  const mount=document.getElementById('yr-mount');
  const y=viewDate.getFullYear();
  document.getElementById('date-label').innerHTML=`${y+543}`;
  const _di=document.getElementById('date-input'); if(_di) _di.value=ymd(viewDate);

  mount.innerHTML='<div class="empty"><span class="ic">⏳</span>กำลังโหลดภาพรวมทั้งปี…</div>';

  // one range query for the whole calendar year (Bangkok dates)
  const from=`${y}-01-01`, to=`${y}-12-31`;
  let rows=[];
  try{
    const res=await adminApi(`/admin/sessions?from=${from}&to=${to}`);
    if(!res.ok) throw new Error('status '+res.status);
    rows=await res.json();
  }catch(e){
    mount.innerHTML='<div class="empty"><span class="ic">⚠️</span>โหลดภาพรวมทั้งปีไม่สำเร็จ</div>';
    return;
  }

  const sessions=groupSessions(rows);

  // bucket by Bangkok month index 0..11
  const byMonth=Array.from({length:12},()=>({sessions:0,bookings:0}));
  sessions.forEach(sn=>{
    const key=bkkDateKey(sn.starts_at);       // YYYY-MM-DD (Bangkok)
    const mi=Number(key.slice(5,7))-1;
    if(mi>=0 && mi<12){
      byMonth[mi].sessions++;
      byMonth[mi].bookings += sn.bookings.length;
    }
  });

  const totalSessions=byMonth.reduce((n,mm)=>n+mm.sessions,0);
  const totalBookings=byMonth.reduce((n,mm)=>n+mm.bookings,0);
  document.getElementById('day-summary').innerHTML=`
    <div class="stat accent"><div class="n">${totalSessions}</div><div class="l">คาบเรียนทั้งปี</div></div>
    <div class="stat"><div class="n">${totalBookings}</div><div class="l">การจองทั้งปี</div></div>
    <div class="stat"><div class="n">${y+543}</div><div class="l">ปีปัจจุบัน (พ.ศ.)</div></div>`;

  const nowY=today.getFullYear(), nowM=today.getMonth();
  const cells=byMonth.map((mm,mi)=>{
    const isCur=(y===nowY && mi===nowM);
    return `<div class="year-cell ${isCur?'is-current':''}" onclick="drillToMonth(${y},${mi})">
      <div class="ym">${MONTH[mi]}</div>
      <div class="yc-stat"><span>คาบเรียน</span><b>${mm.sessions}</b></div>
      <div class="yc-stat"><span>การจอง</span><b>${mm.bookings}</b></div>
    </div>`;
  }).join('');
  mount.innerHTML=`<div class="year-grid">${cells}</div>`;
}

// click a month in the year grid -> jump into that month's calendar
function drillToMonth(y,mi){
  viewDate=new Date(y,mi,1);
  setCalView('month');
}

/* ---------- MONTH CALENDAR ---------- */
const DOW_SHORT=['อา','จ','อ','พ','พฤ','ศ','ส'];

async function renderMonth(){
  const mount=document.getElementById('cal-mount');
  const y=viewDate.getFullYear(), m=viewDate.getMonth();

  document.getElementById('date-label').innerHTML=
    `${MONTH[m]} ${y+543}`;
  const _di=document.getElementById('date-input'); if(_di) _di.value=ymd(viewDate);

  // grid spans from the Sunday before the 1st, to the Saturday after the last day
  const first=new Date(y,m,1);
  const gridStart=new Date(y,m,1-first.getDay());
  const last=new Date(y,m+1,0);
  const gridEnd=new Date(y,m+1,0+(6-last.getDay()));

  mount.innerHTML='<div class="empty"><span class="ic">⏳</span>กำลังโหลดปฏิทิน…</div>';

  let rows=[];
  try{
    const res=await adminApi(`/admin/sessions?from=${ymd(gridStart)}&to=${ymd(gridEnd)}`);
    if(!res.ok) throw new Error('status '+res.status);
    rows=await res.json();
  }catch(e){
    mount.innerHTML='<div class="empty"><span class="ic">⚠️</span>โหลดปฏิทินไม่สำเร็จ</div>';
    return;
  }

  const sessions=groupSessions(rows);
  currentSessions=sessions;   // so openDetailById works from the calendar too

  // bucket sessions by Bangkok calendar date
  const byDay={};
  sessions.forEach(sn=>{
    const key=bkkDateKey(sn.starts_at);
    (byDay[key]=byDay[key]||[]).push(sn);
  });
  Object.values(byDay).forEach(list=>list.sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)));

  // month summary
  const total=sessions.reduce((n,s)=>n+s.bookings.length,0);
  const noted=sessions.reduce((n,s)=>n+s.bookings.filter(b=>b.has_note).length,0);
  document.getElementById('day-summary').innerHTML=`
    <div class="stat accent"><div class="n">${sessions.length}</div><div class="l">คาบเรียนเดือนนี้</div></div>
    <div class="stat" style="cursor: pointer; transition: transform 0.2s;" onclick="setCalView('year')" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
      <div class="n">${total}</div>
      <div class="l">การจองทั้งหมด <span style="font-size: 16px; line-height: 0.5; color: var(--pink);">›</span></div>
    </div>
    ${pendingStatCard()}`;

  let cells=DOW_SHORT.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  const todayKey=ymd(today);
  const cur=new Date(gridStart);
  while(cur<=gridEnd){
    const key=ymd(cur);
    const inMonth=cur.getMonth()===m;
    const isToday=key===todayKey;
    const list=byDay[key]||[];

    let chips=list.slice(0,3).map(sn=>{
      const {label}=bkkHM(sn.starts_at);
      const isGrp=sn.session_type==='group';
      const who=isGrp
        ? `กลุ่ม ${sn.seats_taken}/${sn.capacity}`
        : (sn.bookings[0] ? sn.bookings[0].child_name : 'ว่าง');
      return `<button class="cal-chip ${isGrp?'grp':'ind'}" onclick="event.stopPropagation();openDetailById(${sn.session_id})">${label} ${who}</button>`;
    }).join('');
    if(list.length>3) chips+=`<div class="cal-more">+${list.length-3} เพิ่มเติม</div>`;

    cells+=`<div class="cal-cell ${inMonth?'':'dim'} ${isToday?'today':''}" onclick="openDayFromCalendar('${key}')">
      <div class="cal-daynum">${cur.getDate()}</div>${chips}</div>`;
    cur.setDate(cur.getDate()+1);
  }

  mount.innerHTML=`<div class="cal-wrap"><div class="cal-grid">${cells}</div></div>`;
}

// Bangkok calendar date (YYYY-MM-DD) for a UTC timestamp
const bkkDateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'});
function bkkDateKey(iso){ return bkkDateFmt.format(new Date(iso)); }

function openDayFromCalendar(key){
  const [y,m,d]=key.split('-').map(Number);
  viewDate=new Date(y,m-1,d); viewDate.setHours(0,0,0,0);
  setCalView('day');
}

async function renderSchedule(){
  document.getElementById('cal-mount').style.display      = CAL_VIEW==='month' ? '' : 'none';
  document.getElementById('yr-mount').style.display       = CAL_VIEW==='year' ? '' : 'none';
  document.getElementById('cx-mount').style.display       = CAL_VIEW==='cancelled' ? '' : 'none';
  document.getElementById('tt-mount').style.display       = CAL_VIEW==='day'   ? '' : 'none';
  document.getElementById('tt-extra-mount').style.display = CAL_VIEW==='day'   ? '' : 'none';
  if(CAL_VIEW!=='day') document.getElementById('tt-extra-mount').innerHTML='';
  if(CAL_VIEW==='year')      return renderYear();
  if(CAL_VIEW==='month')     return renderMonth();
  if(CAL_VIEW==='cancelled') return renderCancelled();
  return renderDay();
}

/* ---------- แฟ้มจัดเก็บคาบที่ยกเลิก (cancelled sessions archive) ---------- */
async function renderCancelled(){
  const mount=document.getElementById('cx-mount');
  
  // 1. ปรับหัวข้อให้ชัดเจนว่าเป็น "ประวัติการยกเลิกทั้งหมด" ไม่จำกัดเดือน[cite: 3]
  document.getElementById('date-label').innerHTML=`ประวัติการยกเลิกทั้งหมด`;
  const _di=document.getElementById('date-input'); if(_di) _di.value='';

  mount.innerHTML='<div class="empty"><span class="ic">⏳</span>กำลังโหลด…</div>';

  let rows=[];
  try{
    // 2. 🚨 ถอด from และ to ออกจาก URL ให้เหลือแค่ cancelled=1 เพื่อดึงทั้งหมด[cite: 3]
    const res=await adminApi(`/admin/sessions?cancelled=1`);
    if(!res.ok) throw new Error('status '+res.status);
    rows=await res.json();
  }catch(e){
    mount.innerHTML='<div class="empty"><span class="ic">⚠️</span>โหลดไม่สำเร็จ</div>';
    return;
  }

  const sessions=groupSessions(rows);
  
  // 3. ปรับสรุปตัวเลขด้านบน[cite: 3]
  document.getElementById('day-summary').innerHTML=`
    <div class="stat accent"><div class="n">${sessions.length}</div><div class="l">คาบที่ยกเลิกทั้งหมด</div></div>`;

  if(!sessions.length){
    mount.innerHTML='<div class="empty"><span class="ic">🗑</span>ไม่มีประวัติคาบที่ถูกยกเลิก</div>';
    return;
  }

  const canDirect=isDirector(USER.role);
  mount.innerHTML='<div class="panel"><table><thead><tr><th>วันเวลา</th><th>คอร์ส</th><th>เด็ก</th><th style="text-align:right">จัดการ</th></tr></thead><tbody>'
    + sessions.map(sn=>{
        const d=new Date(sn.starts_at);
        const {label}=bkkHM(sn.starts_at);
        const dayKey=bkkDateKey(sn.starts_at).split('-');
        const who=sn.bookings.length?sn.bookings.map(b=>b.child_name).join(', '):'—';
        const safe=String(sn.course_name).replace(/'/g,"\\'");
        const del=canDirect
          ? `<button class="btn btn-danger btn-sm" onclick="permanentDeleteSession(${sn.session_id},'${safe}')">ลบถาวร</button>` : '';
        return `<tr>
          <!-- 4. 🚨 เพิ่มปี พ.ศ. เข้าไปในคอลัมน์วันเวลา (Number(dayKey[0])+543)[cite: 3] -->
          <td data-label="วันเวลา">${Number(dayKey[2])} ${MONTH[Number(dayKey[1])-1]} ${Number(dayKey[0])+543} · ${label} น.</td>
          <td data-label="คอร์ส">${sn.course_name}</td>
          <td data-label="เด็ก" style="color:var(--ink-soft)">${who}</td>
          <td data-label="" style="text-align:right;white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="restoreSession(${sn.session_id},'${safe}')">↩ กู้คืน</button>
            ${del}
          </td></tr>`;
      }).join('')
    + '</tbody></table></div>';
}

async function restoreSession(sessionId, name){
  if(!confirm(`กู้คืนคาบ "${name}"?\n\nการจองที่ถูกยกเลิกพร้อมคาบนี้จะกลับมาด้วย`)) return;
  try{
    const res=await adminApi('/admin/sessions',{method:'POST',body:JSON.stringify({action:'restore',session_id:sessionId})});
    if(res.ok){ showToast(`↩ กู้คืนคาบ "${name}" แล้ว`); renderSchedule(); return; }
    const err=await res.json().catch(()=>({}));
    showToast('กู้คืนไม่สำเร็จ: '+(err.error||('status '+res.status)));
  }catch(e){ showToast('กู้คืนไม่สำเร็จ: '+e.message); }
}

async function permanentDeleteSession(sessionId, name){
  if(!confirm(`ลบคาบ "${name}" ถาวร?\n\n⚠️ ย้อนกลับไม่ได้\nหากมีบันทึกผลการรักษา ระบบจะไม่อนุญาตให้ลบ`)) return;
  try{
    const res=await adminApi('/admin/sessions?session_id='+encodeURIComponent(sessionId)+'&permanent=1',{method:'DELETE'});
    if(res.ok){ showToast(`🗑 ลบคาบ "${name}" ถาวรแล้ว`); renderSchedule(); return; }
    const err=await res.json().catch(()=>({}));
    if(err.error==='HAS_NOTES'){
      // Escalation: notes are clinical records, so require a second, explicit
      // confirmation that names exactly what will be destroyed.
      const go = confirm(
        `⚠️ คาบนี้มีบันทึกผลการรักษา ${err.notes} รายการ\n\n` +
        `บันทึกเหล่านี้เป็นประวัติการรักษาของเด็ก\n` +
        `หากลบต่อไป บันทึกทั้ง ${err.notes} รายการจะถูกลบถาวรด้วย และกู้คืนไม่ได้\n\n` +
        `ยืนยันลบคาบ "${name}" พร้อมบันทึกทั้งหมด?`
      );
      if(!go){ showToast('ยกเลิกการลบ'); return; }
      const res2=await adminApi('/admin/sessions?session_id='+encodeURIComponent(sessionId)+'&permanent=1&force=1',{method:'DELETE'});
      if(res2.ok){
        const d2=await res2.json().catch(()=>({}));
        showToast(`🗑 ลบคาบและบันทึก ${d2.notes_deleted||0} รายการถาวรแล้ว`);
        renderSchedule();
        return;
      }
      const e2=await res2.json().catch(()=>({}));
      showToast('ลบไม่สำเร็จ: '+(e2.error||('status '+res2.status)));
      return;
    }else if(err.error==='DIRECTOR_ONLY'){ showToast('เฉพาะผู้อำนวยการคลินิกเท่านั้นที่ลบถาวรได้'); }
    else { showToast('ลบไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){ showToast('ลบไม่สำเร็จ: '+e.message); }
}

async function renderDay(){
  const dow=viewDate.getDay();
  document.getElementById('date-label').innerHTML=
    `${viewDate.getDate()} ${MONTH[viewDate.getMonth()]} ${viewDate.getFullYear()+543} <span class="dow">· ${DOW[dow]}</span>`;
  const _di=document.getElementById('date-input'); if(_di) _di.value=ymd(viewDate);

  const mount=document.getElementById('tt-mount');
  const extra=document.getElementById('tt-extra-mount');
  const summary=document.getElementById('day-summary');
  extra.innerHTML='';

  mount.innerHTML='<div class="empty"><span class="ic">⏳</span>กำลังโหลดตาราง…</div>';
  let rows;
  try{
    const res=await adminApi(`/admin/sessions?date=${ymd(viewDate)}`);
    if(!res.ok) throw new Error('status '+res.status);
    rows=await res.json();
  }catch(e){
    mount.innerHTML='<div class="empty"><span class="ic">⚠️</span>โหลดตารางไม่สำเร็จ ลองใหม่อีกครั้ง</div>';
    return;
  }

  currentSessions=groupSessions(rows);

  // split into in-grid (on the hour, within hours, not lunch) vs out-of-hours
  const inGrid=[], outside=[];
  currentSessions.forEach(sn=>{
    const {h,m}=bkkHM(sn.starts_at);
    const span=Math.max(1, Math.ceil(sn.duration_minutes/60));
    const fitsGrid = m===0 && h>=OPEN_HOUR && (h+span)<=CLOSE_HOUR && h!==LUNCH_HOUR && !(h<LUNCH_HOUR && h+span>LUNCH_HOUR);
    if(fitsGrid){ sn._h=h; sn._span=span; inGrid.push(sn); }
    else outside.push(sn);
  });

  // day summary
  const booked=currentSessions.reduce((n,s)=>n+s.bookings.length,0);
  const noted =currentSessions.reduce((n,s)=>n+s.bookings.filter(b=>b.has_note).length,0);
  const occupiedHours=inGrid.reduce((n,s)=>n+s._span,0);
  const freeHours=Math.max(0,(HOURS.length-1)-occupiedHours); // minus lunch hour
  summary.innerHTML=`
    <div class="stat accent"><div class="n">${booked}</div><div class="l">นัดหมายวันนี้</div></div>
    <div class="stat"><div class="n">${freeHours}</div><div class="l">ชั่วโมงว่าง</div></div>
    ${pendingStatCard()}`;

  // build the grid (รองรับหลายคิวในเวลาเดียวกัน)
  const byHour={}; 
  inGrid.forEach(s=>{ 
    if(!byHour[s._h]) byHour[s._h]=[];
    byHour[s._h].push(s); 
  });
  
  // also mark hours covered by a 2h block so we don't draw an empty lane there
  const covered={}; 
  inGrid.forEach(s=>{ 
    for(let k=0;k<s._span;k++) covered[s._h+k]=true; 
  });

  let cells='';
  HOURS.forEach(h=>{
    const rowIndex=h-OPEN_HOUR+1;
    const hh=String(h).padStart(2,'0');
    const hhNext=String(h+1).padStart(2,'0');
    cells+=`<div class="tt-hour" style="grid-row:${rowIndex}">${hh}:00 - ${hhNext}:00</div>`;
    
    if(h===LUNCH_HOUR){
      cells+=`<div class="tt-lane lunch" style="grid-row:${rowIndex}"><span>พักกลางวัน</span></div>`;
      return;
    }
    
    const sessions = byHour[h];
    if(sessions && sessions.length > 0){
      const maxSpan = Math.max(...sessions.map(s => s._span));
      const blocksHtml = sessions.map(sn => blockHtml(sn)).join('');
      cells+=`<div class="tt-lane" style="grid-row:${rowIndex}/span ${maxSpan}">${blocksHtml}</div>`;
    } else if(!covered[h]){
      cells+=`<div class="tt-lane" style="grid-row:${rowIndex}">
        <div class="tt-block empty" onclick="openCreate(${h})">+ ว่าง</div></div>`;
    }
    // สังเกตว่าลบ else { cells+=... } สุดท้ายทิ้งไปแล้ว เพื่อไม่ให้มีเส้นตัดทับบล็อก 2 ชม.
  });
  
  mount.innerHTML=`<div class="tt-wrap"><div class="tt-grid">${cells}</div></div>`;

  // out-of-hours sessions (odd/legacy times) — surfaced, not hidden
  if(outside.length){
    let rowsHtml=outside.map(sn=>{
      const {label}=bkkHM(sn.starts_at);
      const who=sn.bookings.length?sn.bookings.map(b=>b.child_name).join(', '):'ว่าง';
      return `<div class="row" onclick="openDetailById(${sn.session_id})"><span>${label} น. · ${sn.course_name}</span><span>${who} ›</span></div>`;
    }).join('');
    extra.innerHTML=`<div class="tt-extra"><h4>นอกเวลาทำการ / เวลาที่ไม่ตรงคาบ (${outside.length})</h4>${rowsHtml}</div>`;
  }
}

function blockHtml(sn){
  const isGrp=sn.session_type==='group';
  const anyNote=sn.bookings.some(b=>b.has_note);
  let head, meta, cls;
  if(isGrp){
    cls='grp';
    head=`กลุ่ม · ${sn.seats_taken}/${sn.capacity} คน`;
    let pips=''; for(let k=0;k<sn.capacity;k++) pips+=`<i class="${k<sn.seats_taken?'on':''}"></i>`;
    meta=`<span class="bk-course">${sn.course_name}</span><span class="tt-seat">${pips}</span>`;
  }else{
    const b=sn.bookings[0];
    cls=b?'ind':'ind is-open';
    head=b?b.child_name:'ว่าง';
    meta=`<span class="bk-course">${sn.course_name}${b?(' · '+b.child_age+' ปี'):''}</span>`;
  }
  return `<div class="tt-block ${cls}" onclick="openDetailById(${sn.session_id})">
    ${anyNote?'<span class="noteflag">📝</span>':''}
    <div class="bk-child">${head}</div>
    <div class="bk-meta">${meta}</div>
  </div>`;
}

function goToday(){viewDate=new Date(today);renderSchedule()}
function pickDate(val){
  if(!val) return;
  const [y,m,d]=val.split('-').map(Number);
  viewDate=new Date(y, m-1, d); viewDate.setHours(0,0,0,0);
  renderSchedule();
}

/* ---------- SESSION DETAIL MODAL ---------- */
function openDetailById(sessionId){
  const sn=currentSessions.find(s=>s.session_id===sessionId);
  if(!sn) return;
  const isGrp=sn.session_type==='group';
  const {label}=bkkHM(sn.starts_at);
  document.getElementById('sd-title').textContent=sn.course_name+(isGrp?' (กลุ่ม)':'');
  document.getElementById('sd-when').textContent=
    `${viewDate.getDate()} ${MONTH[viewDate.getMonth()]} · ${label} น. · ${sn.duration_minutes} นาที`;

  const statusTh=({scheduled:'ตามกำหนด',confirmed:'ยืนยันแล้ว',completed:'เสร็จสิ้น',cancelled:'ยกเลิก'})[sn.session_status]||sn.session_status;
  let body=`
    <div class="sd-row"><span class="k">ประเภท</span><span class="v">${isGrp?'กลุ่ม':'เดี่ยว'}</span></div>
    <div class="sd-row"><span class="k">นักกิจกรรมบำบัด</span><span class="v">${sn.therapist_nickname||sn.therapist_name}</span></div>
    <div class="sd-row"><span class="k">สถานะคาบ</span><span class="v">${statusTh}</span></div>
    <div class="sd-row"><span class="k">ที่นั่ง</span><span class="v">${sn.seats_taken}/${sn.capacity}</span></div>`;

  if(sn.bookings.length){
    body+='<div class="sd-parts">';
    sn.bookings.forEach(b=>{
      const bst=({pending:'รอยืนยัน',confirmed:'ยืนยันแล้ว',cancelled:'ยกเลิก'})[b.booking_status]||b.booking_status;
      body+=`<div class="sd-part">
        <span class="pav">${(b.child_name||'?').replace(/^น้อง/,'').charAt(0)}</span>
        <div class="pinfo"><div class="pname">${b.child_name} <span style="font-weight:400;color:var(--ink-soft)">(${b.child_age} ปี)</span></div>
        <div class="pmeta">${bst}${b.has_note?' · 📝 บันทึกแล้ว':''}</div></div>
        <button class="btn ${b.has_note?'btn-ghost':'btn-primary'} btn-sm" onclick="openNote(${b.booking_id},'${(b.child_name||'').replace(/'/g,"")}','${sn.course_name.replace(/'/g,"")}','${label}')">${b.has_note?'ดู/แก้':'บันทึกผล'}</button>
        <button class="btn btn-danger btn-sm" title="เอาเด็กออกจากคาบ" onclick="removeBooking(${b.booking_id},'${(b.child_name||'').replace(/'/g,"")}',${sn.session_id})">ลบ</button>
      </div>`;
    });
    body+='</div>';
  }else{
    body+='<div class="empty" style="padding:22px 10px"><span class="ic">🪑</span>ยังไม่มีเด็กจองคาบนี้</div>';
  }
  document.getElementById('sd-body').innerHTML=body;

  // Seats left → offer to add another child (this is how group sessions fill up)
  const seatsLeft = sn.capacity - sn.seats_taken;
  let foot = '';
  if(seatsLeft > 0){
    const opts = CHILDREN
      .filter(c=>!sn.bookings.some(b=>b.child_id===c.id))
      .map(c=>`<option value="${c.id}">${c.name} (${c.age} ปี)</option>`).join('');
    if(opts){
      foot += `<div style="flex:1;display:flex;gap:8px;align-items:center">
        <select id="sd-add-child" style="flex:1;font-family:'Sarabun';font-size:13px;padding:9px 11px;border:1.5px solid var(--border);border-radius:10px">${opts}</select>
        <button class="btn btn-primary btn-sm" id="sd-add-btn" onclick="addChildToSession(${sn.session_id})">+ เพิ่มเด็ก</button>
      </div>`;
    }
  }
  foot += `<button class="btn btn-danger" onclick="cancelSession(${sn.session_id},'${sn.course_name.replace(/'/g,"")}')">ยกเลิกคาบนี้</button>`;
  foot += `<button class="btn btn-ghost" onclick="closeDetail()">ปิด</button>`;
  document.getElementById('sd-foot').innerHTML = foot;
  document.getElementById('sd-foot').style.cssText='margin-top:22px;display:flex;gap:10px;align-items:center';
  document.getElementById('detail-modal').classList.add('active');
}
async function addChildToSession(sessionId){
  const sel=document.getElementById('sd-add-child');
  if(!sel || !sel.value) return;
  const childId=Number(sel.value);
  const btn=document.getElementById('sd-add-btn');
  const original=btn.textContent;
  btn.disabled=true; btn.textContent='กำลังเพิ่ม…';
  try{
    const res=await adminApi('/admin/sessions',{
      method:'POST',
      body:JSON.stringify({ session_id:sessionId, child_id:childId })
    });
    if(res.status===201){
      showToast('✅ เพิ่มเด็กเข้าคาบแล้ว');
      closeDetail();
      await renderSchedule();
      const fresh=currentSessions.find(s=>s.session_id===sessionId);
      if(fresh) openDetailById(sessionId);   // reopen with the updated roster
      return;
    }
    const err=await res.json().catch(()=>({}));
    if(err.error==='SESSION_FULL'){ showToast('คาบนี้เต็มแล้ว'); }
    else if(err.error==='ALREADY_BOOKED'){ showToast('เด็กคนนี้อยู่ในคาบนี้แล้ว'); }
    else { showToast('เพิ่มไม่สำเร็จ: '+(err.error||('status '+res.status))); }
  }catch(e){
    showToast('เพิ่มไม่สำเร็จ: '+e.message);
  }finally{
    btn.disabled=false; btn.textContent=original;
  }
}

async function removeBooking(bookingId, childName, sessionId){
  if(!confirm(`เอา "${childName}" ออกจากคาบนี้?\n\nที่นั่งจะถูกคืน และประวัติการยกเลิกจะถูกเก็บไว้`)) return;
  try{
    const res=await adminApi('/admin/sessions?booking_id='+encodeURIComponent(bookingId),{method:'DELETE'});
    if(res.ok){
      showToast(`เอา "${childName}" ออกจากคาบแล้ว`);
      closeDetail();
      await renderSchedule();
      if(currentSessions.some(s=>s.session_id===sessionId)) openDetailById(sessionId);
      return;
    }
    const err=await res.json().catch(()=>({}));
    showToast('ลบไม่สำเร็จ: '+(err.error||('status '+res.status)));
  }catch(e){ showToast('ลบไม่สำเร็จ: '+e.message); }
}

async function cancelSession(sessionId, courseName){
  if(!confirm(`ยกเลิกคาบ "${courseName}" ทั้งคาบ?\n\n⚠️ การจองทั้งหมดในคาบนี้จะถูกยกเลิกด้วย\nประวัติเดิมยังถูกเก็บไว้`)) return;
  try{
    const res=await adminApi('/admin/sessions?session_id='+encodeURIComponent(sessionId),{method:'DELETE'});
    if(res.ok){
      const d=await res.json().catch(()=>({}));
      showToast(`ยกเลิกคาบแล้ว (ยกเลิกการจอง ${d.bookings_cancelled||0} รายการ)`);
      closeDetail();
      renderSchedule();
      return;
    }
    const err=await res.json().catch(()=>({}));
    showToast('ยกเลิกไม่สำเร็จ: '+(err.error||('status '+res.status)));
  }catch(e){ showToast('ยกเลิกไม่สำเร็จ: '+e.message); }
}

function closeDetail(){document.getElementById('detail-modal').classList.remove('active')}

/* ---------- CREATE COURSE (top roles only) ---------- */
