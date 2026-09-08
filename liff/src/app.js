/* ---- icon helper (SVG sprite, replaces emoji) ---- */
function ic(n, size){ return '<svg class="ico"'+(size?' style="font-size:'+size+'"':'')+'><use href="#i-'+n+'"/></svg>'; }

// คืนชื่อเด็กสำหรับแสดงผล ใช้รูปแบบเดียวกับ renderChildSelectModal
function childDisplayName(child){
  if(!child) return '';
  return (child.name || child.first_name || '').trim();
}

const THAI_MONTHS_FULL=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

// เติมตัวเลือกวัน/เดือน/ปี(พ.ศ.) ให้ช่องวันเกิด — prefix คือ 'reg' หรือ 'add'
function fillDobSelects(prefix){
  const d=document.getElementById(prefix+'-dob-d');
  const m=document.getElementById(prefix+'-dob-m');
  const y=document.getElementById(prefix+'-dob-y');
  if(!d||!m||!y) return;
  d.innerHTML='<option value="">วัน</option>';
  for(let i=1;i<=31;i++) d.innerHTML+='<option value="'+i+'">'+i+'</option>';
  m.innerHTML='<option value="">เดือน</option>';
  THAI_MONTHS_FULL.forEach((n,i)=>{ m.innerHTML+='<option value="'+(i+1)+'">'+n+'</option>'; });
  const nowBE=new Date().getFullYear()+543;
  y.innerHTML='<option value="">ปี พ.ศ.</option>';
  for(let b=nowBE;b>=nowBE-20;b--) y.innerHTML+='<option value="'+b+'">'+b+'</option>';
}

// อ่านค่าวันเกิดเป็น ISO ค.ศ. YYYY-MM-DD, คืน '' ถ้ายังกรอกไม่ครบ, คืน null ถ้าวันที่ไม่มีจริง
function dobIsoFrom(prefix){
  const d=document.getElementById(prefix+'-dob-d').value;
  const m=document.getElementById(prefix+'-dob-m').value;
  const b=document.getElementById(prefix+'-dob-y').value;
  if(!d||!m||!b) return '';
  const g=parseInt(b,10)-543;
  const dt=new Date(g,parseInt(m,10)-1,parseInt(d,10));
  if(dt.getFullYear()!==g||dt.getMonth()!==parseInt(m,10)-1||dt.getDate()!==parseInt(d,10)) return null;
  return g+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}

function clearDobSelects(prefix){
  ['-dob-d','-dob-m','-dob-y'].forEach(s=>{
    const el=document.getElementById(prefix+s); if(el) el.value='';
  });
}

fillDobSelects('reg'); fillDobSelects('add');

/* ---- SIGNATURE: session path — completed sessions as filled beads,
       the next one as a pulsing ring. Mirrors the sticker-reward cards
       therapists actually use with the children. ---- */
function sessionPath(bookings, now){
  const done = bookings.filter(b => new Date(b.booking_time) <= now).length;
  const MAX = 8;
  const shown = Math.min(done, MAX - 1);
  let html = '';
  for(let i=0;i<MAX;i++){
    const cls = i < shown ? 'done' : (i === shown ? 'next' : 'todo');
    if(i) html += '<span class="bead-link'+(i > shown ? ' dim' : '')+'"></span>';
    html += '<span class="bead '+cls+'"></span>';
  }
  return '<div class="path">'
       +   '<div class="path-head"><span class="n">มาแล้ว '+done+' ครั้ง</span>'
       +   '<span class="l">เส้นทางการฝึก</span></div>'
       +   '<div class="beads">'+html+'</div>'
       + '</div>';
}

// ---------- ฟังก์ชันเปิดดูรายละเอียดการจอง + ผลการฝึก ----------
function openBookingDetail(bookingId) {
  const b = currentBookings.find(x => x.id === bookingId);
  if(!b) return;

  const now = new Date();
  const isPast = new Date(b.booking_time) <= now;

  // 1. ใส่ข้อมูลคอร์สและเวลา
  document.getElementById('bd-course-name').textContent = b.course_name;
  document.getElementById('bd-datetime').innerHTML = `${ic('cal')} ${formatDate(b.booking_time)} น.`;

  // 2. จัดการ Tag สถานะ
  const statusTag = document.getElementById('bd-status-tag');
  if (isPast) {
    statusTag.textContent = 'เข้าเรียนแล้ว';
    statusTag.style.background = 'var(--mint-bg)';
    statusTag.style.color = 'var(--mint)';
  } else if (b.status === 'pending') {
    statusTag.textContent = 'รอยืนยันจากคลินิก';
    statusTag.style.background = 'var(--amber-bg)';
    statusTag.style.color = 'var(--amber)';
  } else {
    statusTag.textContent = 'ยืนยันแล้ว';
    statusTag.style.background = 'var(--pink-soft)';
    statusTag.style.color = 'var(--pink)';
  }

  // 3. จัดการกล่องผลการฝึก (โชว์เฉพาะคอร์สที่เรียนไปแล้ว)
  const progBox = document.getElementById('bd-progress-container');
  const progText = document.getElementById('bd-progress-text');

  if (isPast) {
    progBox.style.display = 'block';
    // หาผลการฝึกที่ตรงกับ Booking นี้
    const p = currentProgress.find(x => x.booking_id === b.id || (x.course_name === b.course_name && x.booking_time === b.booking_time));
    
    if (p && p.parent_summary) {
      progText.innerHTML = escHtml(p.parent_summary).replace(/\n/g, '<br>');
      progBox.style.background = 'var(--mint-bg)';
      progBox.style.borderColor = '#CDEadd';
      progText.style.color = '#2A7D53';
    } else {
      progText.innerHTML = '<i>นักกิจกรรมบำบัดยังไม่ได้บันทึกผลการฝึกสำหรับคลาสนี้ค่ะ</i>';
      progBox.style.background = '#F7F2F4';
      progBox.style.borderColor = '#EFE4E9';
      progText.style.color = 'var(--ink-soft)';
    }
  } else {
    progBox.style.display = 'none'; // ซ่อนไว้ถ้าเป็นคลาสในอนาคต
  }

  // เปิด Modal
  document.getElementById('modal-booking-detail').classList.add('active');
}
  
// ---------- UI Logic ----------
function toggleCard(el){ el.classList.toggle('open'); }

function go(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const target = document.getElementById('s-'+name);
  if(target) {
    target.classList.add('active');
    target.scrollTop = 0; // เลื่อนกลับไปด้านบนสุดทุกครั้งที่เปลี่ยนหน้า
  }
  
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  const homeBtn = document.querySelector('.home-btn');
  if(homeBtn) homeBtn.classList.remove('on');
  
  if(name==='home'){ if(homeBtn) homeBtn.classList.add('on'); }
  else { const t=document.querySelector(`.tab[data-t="${name}"]`); if(t) t.classList.add('on'); }

  if(name==='book') loadCourses();
  if(name==='bookings') loadBookings();
  if(name==='progress') loadProgress();
  if(name==='home') loadHomeData();
}

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}

document.getElementById('modal-add-child').addEventListener('click',function(e){
  if(e.target===this) this.classList.remove('active');
});

// ---------- Child Selection Logic ----------
function renderChildSelectModal() {
  const container = document.getElementById('child-list-container');
  if (!children || children.length === 0) {
    container.innerHTML = '<div class="empty-state">ยังไม่มีข้อมูลเด็ก</div>';
    return;
  }

  container.innerHTML = children.map(child => {
    const isActive = child.id === activeChildId;
    const activeStyle = isActive ? 'border-color: var(--pink); background: var(--pink-soft);' : 'border-color: #F3ECEF;';
    const avaStyle = isActive ? '' : 'background: #EAF0FB; color: #3E6FB0;';
    const checkIcon = isActive ? '<div style="margin-left:auto;color:var(--pink);font-size:19px">'+ic('check')+'</div>' : '';
    
    // จัดการชื่อให้ดึงตัวอักษรแรกได้ถูกต้อง
    const displayName = child.name || child.first_name || 'ไม่ระบุชื่อ';
    const cleanName = displayName.replace(/^น้อง/, '').trim();
    const firstLetter = cleanName.charAt(0) || '?';

    return `
      <div class="child-chip" style="margin: 0; width: 100%; ${activeStyle}" onclick="switchChild(${child.id})">
        <div class="ava" style="${avaStyle}">${firstLetter}</div>
        <div>
          <div class="cn">${escHtml(displayName)}</div>
          <div class="ca">${child.age || '?'} ปี</div>
        </div>
        ${checkIcon}
      </div>
    `;
  }).join('');
}

function switchChild(newChildId) {
  activeChildId = newChildId;
  document.getElementById('modal-select-child').classList.remove('active');
  
  // อัปเดต UI ใน Modal ให้ตัวที่เพิ่งถูกเลือกมีเครื่องหมายติ๊กถูก
  renderChildSelectModal(); 
  
  // โหลดข้อมูลในหน้าปัจจุบันใหม่ให้ตรงกับเด็กที่ถูกเลือก
  const activeScreen = document.querySelector('.screen.active').id;
  if (activeScreen === 's-home') loadHomeData();
  if (activeScreen === 's-bookings') loadBookings();
  if (activeScreen === 's-progress') loadProgress();
  
  const childData = children.find(c => c.id === newChildId);
  const childName = childData ? (childData.name || childData.first_name || '') : '';
  showToast(`สลับข้อมูลเป็น ${childName} เรียบร้อย`);
}


// ---------- API Logic ----------
const LIFF_ID  = "2010547408-0yph195f";

// ---- Rich Menu deep link: ?tab= ----
// อ่านหลัง liff.init() เท่านั้น เพราะ LIFF อาจ redirect แล้วห่อ query ไว้ใน liff.state
const VALID_TABS = ['home','book','bookings','progress','chat'];
function getTabFromUrl(){
  try{
    const q = new URLSearchParams(location.search);
    let tab = q.get('tab');
    if(!tab){
      const st = q.get('liff.state');
      if(st) tab = new URLSearchParams(st.replace(/^\?/,'')).get('tab');
    }
    return VALID_TABS.includes(tab) ? tab : null;
  }catch(e){ return null; }
}
// HTTP API stage is $default — no stage segment in the path (do NOT add /prod)
const API_BASE = "https://mulbd1y5bj.execute-api.ap-southeast-7.amazonaws.com";
const CLINIC_LINE_OA = "@153iemks";
const CLINIC_TIMES = ['09:00','10:00','11:00','13:00','14:00','15:00','16:00','17:00'];
// Clinic booking windows (lunch 12:00-13:00, clinic closes 18:00). Slots are built
// per course so each slot's length matches that course's duration -- e.g. a 120-min
// group course shows non-overlapping 2-hour blocks instead of fixed 1-hour ranges.
const CLINIC_WINDOWS = [['09:00','12:00'], ['13:00','18:00']];
const _t2m = hhmm => { const [h,m]=hhmm.split(':').map(Number); return h*60+m; };
const _m2t = mins => String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');
function buildSlots(durMin){
  durMin = durMin>0 ? durMin : 60;
  const out=[];
  for(const [ws,we] of CLINIC_WINDOWS){
    for(let s=_t2m(ws), end=_t2m(we); s+durMin<=end; s+=durMin){ out.push({ t:_m2t(s), end:_m2t(s+durMin) }); }
  }
  return out;
}
const IS_DEV = ['localhost','127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).has('preview');

let lineUserId=null, parentData=null, children=[], activeChildId=null;
let bookingCourseId=null, bookingCourseDur=60, selectedDate=null, selectedSlot=null, selectedSessionId=null;
let allCourses=[], courseTab='individual', groupEventsCourseId=null;
let calYear=new Date().getFullYear(), calMonth=new Date().getMonth();

let currentBookings = []; 
let currentProgress = [];

async function api(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(!IS_DEV){
    const token = liff.getIDToken();
    if(!token){ liff.login(); throw new Error('not logged in'); }
    headers['Authorization'] = 'Bearer ' + token;
  }
  
  try {
    const response = await fetch(API_BASE + path, Object.assign({}, opts, {headers}));
    
    // หาก Token หมดอายุ หรือ Authorizer ตอบกลับเป็น 403 / 401 ให้บังคับ Login ใหม่เพื่อสร้าง Token
    if (response.status === 403 || response.status === 401) {
      console.warn('ID Token expired or invalid (HTTP 403/401). Redirecting to LINE login...');
      liff.logout(); // <-- เติมบรรทัดนี้: ล้าง Token เก่าที่หมดอายุทิ้งไปก่อน
      liff.login();
      throw new Error('Session expired. Logging in again...');
    }
    
    return response;
  } catch (error) {
    console.error(`API Error (${path}):`, error);
    throw error;
  }
}

function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function formatDate(iso){ return new Date(iso).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function formatDay(iso){ return new Date(iso).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).replace(',',' ·'); }

async function loadHomeData(){
  if(!parentData || !children.length) return;
  document.getElementById('home-name').textContent = `คุณ${parentData.name}`;
  
  const ac = children.find(c=>c.id===activeChildId) || children[0];
  const displayName = ac.name || ac.first_name || 'ไม่ระบุชื่อ';
  const cleanName = displayName.replace(/^น้อง/, '').trim();
  document.getElementById('active-child-avatar').textContent = cleanName.charAt(0) || '?';
  document.getElementById('active-child-name').textContent = escHtml(displayName);
  document.getElementById('active-child-age').textContent = `${ac.age || '?'} ปี · เพิ่มเด็ก/สลับ`;

  try{
    const res = await api(`/bookings?child_id=${activeChildId}`);
    const bookings = await res.json();
    const now = new Date();
    
    // Upcoming
    const upcoming = bookings.filter(b=>new Date(b.booking_time)>now).sort((a,b)=>new Date(a.booking_time)-new Date(b.booking_time));
    const hero = document.getElementById('hero-container');
    if(upcoming.length){
      const nb = upcoming[0];
      hero.innerHTML = `<div class="hero">
        <div class="lbl">${ic('cal')} นัดหมายถัดไป</div>
        <div class="cn">${escHtml(nb.course_name)}</div>
        <div class="dt">${formatDay(nb.booking_time)} น.</div>
        <div class="foot">
          <span class="countdown">สถานะ: ${nb.status==='pending'?'รอยืนยัน':'ยืนยันแล้ว'}</span>
          <button class="go" onclick="go('bookings')">ดูรายละเอียด</button>
        </div>
        ${sessionPath(bookings, now)}
      </div>`;
    } else {
      hero.innerHTML = `<div class="hero" style="background:#7C6570">
        <div class="lbl">${ic('cal')} ยังไม่มีนัดหมาย</div>
        <div class="cn">เริ่มต้นการฝึกของน้อง</div>
        <div class="dt">เลือกคอร์สที่เหมาะกับน้อง แล้วจองวันเวลาที่สะดวก</div>
        <div class="foot"><button class="go" onclick="go('book')" style="color:#6B5460">ดูคอร์สทั้งหมด</button></div>
        ${sessionPath(bookings, now)}
      </div>`;
    }

    // Recent Bookings
    const list = document.getElementById('home-bookings');
    if(!bookings.length){
      list.innerHTML = '<div class="empty-state">ยังไม่มีการจอง</div>';
    } else {
      list.innerHTML = bookings.slice(0,3).map(b=>{
        const isPast = new Date(b.booking_time) <= now;
        const status = isPast ? '<span class="st pill ok">เข้าเรียนแล้ว</span>' : (b.status==='pending'?'<span class="st pill wait">รอยืนยัน</span>':'<span class="st pill ok">ยืนยันแล้ว</span>');
        return `<div class="booking"><div class="ic">${ic('list')}</div><div><div class="bn">${escHtml(b.course_name)}</div><div class="bd">${formatDate(b.booking_time)}</div></div>${status}</div>`;
      }).join('');
    }
  }catch(e){console.error(e);}
}

async function loadCourses(){
  const c=document.getElementById('courses-list');
  c.innerHTML='<div class="course"><div class="top"><div class="sk" style="height:16px;width:34%"></div><div class="sk" style="height:19px;width:62%;margin-top:11px"></div><div class="sk" style="height:12px;width:88%;margin-top:9px"></div></div><div class="meta"><div class="sk" style="height:12px;width:100%"></div></div></div>';
  try{
    const res=await api('/courses');
    allCourses=await res.json();
    if(!allCourses.length){c.innerHTML='<div class="empty-state">ยังไม่มีคอร์ส</div>';return;}
    const indiv=allCourses.filter(co=>co.session_type!=='group');
    const group=allCourses.filter(co=>co.session_type==='group');
    c.innerHTML=`
      <div class="ctabs">
        <button class="ctab" id="ctab-individual" onclick="switchCourseTab('individual')">คอร์สเดี่ยว</button>
        <button class="ctab" id="ctab-group" onclick="switchCourseTab('group')">คอร์สกลุ่ม</button>
      </div>
      <div id="courses-individual">${indiv.length?indiv.map(individualCard).join(''):'<div class="empty-state">ยังไม่มีคอร์สเดี่ยว</div>'}</div>
      <div id="courses-group">${group.length?group.map(groupCard).join(''):'<div class="empty-state">ยังไม่มีคอร์สกลุ่ม</div>'}</div>`;
    switchCourseTab(courseTab);
  }catch(e){c.innerHTML='<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>';}
}

function individualCard(co){
  return `<div class="course">
    <div class="top">
      <span class="tag">เหมาะสำหรับ ${co.min_age}–${co.max_age} ปี</span>
      <h3>${escHtml(co.name)}</h3>
      <p class="desc">${escHtml(co.description||'')}</p>
    </div>
    <div class="meta"><span>⏱ ${co.duration_minutes} นาที</span><span class="price">฿${Number(co.price).toLocaleString()}</span></div>
    <button class="book" onclick="openCalendar(${co.id}, '${escHtml(co.name)}', ${co.duration_minutes}, ${co.price})">จองคอร์สนี้ →</button>
  </div>`;
}

function groupCard(co){
  return `<div class="course">
    <div class="top">
      <span class="tag">เหมาะสำหรับ ${co.min_age}–${co.max_age} ปี</span>
      <h3>${escHtml(co.name)}<span class="badge-group">กลุ่ม</span></h3>
      <p class="desc">${escHtml(co.description||'')}</p>
    </div>
    <div class="meta"><span>${ic('clock')} ${co.duration_minutes} นาที</span><span>${ic('users')} สูงสุด ${co.capacity} คน</span><span class="price">฿${Number(co.price).toLocaleString()}</span></div>
    <button class="book" onclick="openGroupEvents(${co.id})">ดูรอบที่เปิดรับสมัคร →</button>
  </div>`;
}

function switchCourseTab(kind){
  courseTab=kind;
  const iv=document.getElementById('courses-individual'), gp=document.getElementById('courses-group');
  const tiv=document.getElementById('ctab-individual'), tgp=document.getElementById('ctab-group');
  if(!iv||!gp) return;
  const isGroup=kind==='group';
  iv.style.display=isGroup?'none':'block';
  gp.style.display=isGroup?'block':'none';
  tiv.classList.toggle('on',!isGroup);
  tgp.classList.toggle('on',isGroup);
}

// ===== Admin-led group booking: list pre-created events, join existing only =====
async function openGroupEvents(cid){
  const co=allCourses.find(c=>c.id===cid);
  groupEventsCourseId=cid;
  document.getElementById('ge-title').textContent=co?co.name:'คลาสกลุ่ม';
  document.getElementById('ge-sub').textContent=co?`กลุ่มละไม่เกิน ${co.capacity} คน · ${co.duration_minutes} นาที · ฿${Number(co.price).toLocaleString()}`:'';
  const body=document.getElementById('ge-body');
  body.innerHTML='<div class="empty-state">กำลังโหลดรอบเรียน...</div>';
  document.getElementById('modal-group-events').classList.add('active');
  try{
    const res=await api(`/sessions?course_id=${cid}`);
    const rows=res.ok?await res.json():[];
    const events=rows.filter(s=>s.session_type==='group' && s.status!=='cancelled');
    renderGroupEvents(events);
  }catch(e){ renderGroupEvents(null); }
}

function renderGroupEvents(events){
  const body=document.getElementById('ge-body');
  if(!events || !events.length){
    body.innerHTML=`
      <div class="ge-empty">
        <div style="font-size:30px;color:var(--ink-faint)">${ic('cal')}</div>
        <p style="font-weight:700;color:var(--ink);margin-top:6px;font-family:'Baloo Thai 2'">ยังไม่มีรอบที่เปิดรับสมัคร</p>
        <p style="color:var(--ink-soft);font-size:13.5px;margin-top:6px;line-height:1.6">คลาสกลุ่มจะเปิดรับเมื่อคลินิกจัดรอบเรียน<br>ทักแชทเพื่อสอบถามหรือขอเปิดรอบใหม่ได้เลยค่ะ</p>
        <button class="btn-pink" style="margin-top:16px" onclick="contactAdminForGroup()">ติดต่อคลินิกผ่าน LINE</button>
      </div>`;
    return;
  }
  body.innerHTML=events.map(s=>{
    const left=(s.seats_left!==undefined)?s.seats_left:Math.max(0,s.capacity-s.seats_taken);
    const full=left<=0;
    const occ=`${s.seats_taken}/${s.capacity}`;
    const who=s.therapist_nickname?`ครู${s.therapist_nickname}`:(s.therapist_name||'');
    return `<div class="gevent${full?' full':''}">
      <div class="ge-when">
        <div class="ge-date">${formatDay(s.starts_at)}</div>
        ${who?`<div class="ge-who">${escHtml(who)}</div>`:''}
      </div>
      <div class="ge-right">
        <span class="occ${full?' full':''}">${full?`เต็ม ${occ}`:`ว่าง ${occ}`}</span>
        ${full?`<button class="gjoin" disabled>เต็มแล้ว</button>`:`<button class="gjoin" onclick="joinGroupSession(${s.id})">เข้าร่วม</button>`}
      </div>
    </div>`;
  }).join('');
}

function contactAdminForGroup(){
  const co=allCourses.find(c=>c.id===groupEventsCourseId);
  const childName=(children.find(c=>c.id===activeChildId)||{}).name||'';
  openClinicChat(`สวัสดีค่ะ สนใจคลาสกลุ่ม "${co?co.name:''}"\nน้อง: ${childName}\nรบกวนสอบถาม/ขอเปิดรอบเรียนค่ะ`);
}

async function joinGroupSession(sessionId){
  if(!activeChildId){ showToast('กรุณาเลือกน้องก่อน'); return; }
  document.querySelectorAll('#ge-body .gjoin').forEach(b=>b.disabled=true);
  try{
    const res=await api('/bookings',{method:'POST',body:JSON.stringify({child_id:activeChildId,session_id:sessionId})});
    if(res.ok){
      document.getElementById('modal-group-events').classList.remove('active');
      showToast('เข้าร่วมคลาสกลุ่มสำเร็จแล้ว');
      go('home');
    }else{
      const err=await res.json().catch(()=>({}));
      showToast(err.error==='SESSION_FULL'?'รอบนี้เพิ่งเต็ม กรุณาเลือกรอบอื่น':err.error==='ALREADY_BOOKED'?'น้องเข้าร่วมรอบนี้ไว้แล้ว':'เข้าร่วมไม่สำเร็จ');
      openGroupEvents(groupEventsCourseId); // refresh occupancy
    }
  }catch(e){ showToast('เข้าร่วมไม่สำเร็จ กรุณาลองใหม่'); openGroupEvents(groupEventsCourseId); }
}

async function loadBookings(){
  const _h = document.getElementById('bookings-title');
  if(_h){
    const _c = children.find(c=>c.id===activeChildId);
    const _n = childDisplayName(_c);
    _h.textContent = _n ? 'นัดหมายของ' + _n : 'นัดหมายของน้อง';
  }
  const up=document.getElementById('bookings-upcoming'), pa=document.getElementById('bookings-past');
  if(!activeChildId){ up.innerHTML='<div class="empty-state">กรุณาเพิ่มเด็ก</div>'; pa.innerHTML=''; return; }
  up.innerHTML='<div class="empty-state">กำลังโหลด...</div>'; pa.innerHTML='';
  
  try{
    // ดึงข้อมูลการจอง และ ผลการฝึก มาพร้อมกัน
    const [bRes, pRes] = await Promise.all([
      api(`/bookings?child_id=${activeChildId}`),
      api(`/progress?child_id=${activeChildId}`).catch(() => ({ ok: true, json: () => [] }))
    ]);
    
    currentBookings = await bRes.json();
    currentProgress = pRes.ok ? await pRes.json() : [];
    
    const now=new Date();
    const up2=currentBookings.filter(b=>new Date(b.booking_time)>now).sort((a,b)=>new Date(a.booking_time)-new Date(b.booking_time));
    const pa2=currentBookings.filter(b=>new Date(b.booking_time)<=now).sort((a,b)=>new Date(b.booking_time)-new Date(a.booking_time));
    
    // ปรับ UI ให้มีลูกศร › และฝัง onclick="openBookingDetail(id)"
    const row=(b,past)=>`
      <div class="booking" style="cursor:pointer; border-bottom:1px solid #F3ECEF; transition:background 0.2s;" onclick="openBookingDetail(${b.id})">
        <div class="ic">${ic('list')}</div>
        <div style="flex:1;">
          <div class="bn">${escHtml(b.course_name)}</div>
          <div class="bd">${formatDay(b.booking_time)}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <span class="st pill ${past?'ok':(b.status==='pending'?'wait':'ok')}">${past?'เข้าเรียนแล้ว':(b.status==='pending'?'รอยืนยัน':'ยืนยันแล้ว')}</span>
          <span style="color:var(--ink-faint); font-size:18px; line-height:0.5;">›</span>
        </div>
      </div>`;
    
    up.innerHTML = up2.length ? up2.map(b=>row(b,false)).join('') : '<div class="empty-state">ยังไม่มีนัดหมายที่กำลังจะมาถึง</div>';
    pa.innerHTML = pa2.length ? pa2.map(b=>row(b,true)).join('') : '<div class="empty-state">ยังไม่มีประวัติ</div>';
  }catch(e){ up.innerHTML='<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>'; }
}

async function loadProgress(){
  if(!activeChildId) return;
  const c=document.getElementById('progress-list');
  c.innerHTML='<div class="empty-state">กำลังโหลดความก้าวหน้า...</div>';
  try{
    const res=await api(`/progress?child_id=${activeChildId}`);
    const items=await res.json();
    const withNotes=items.filter(i=>i.parent_summary);
    if(!withNotes.length){
      c.innerHTML='<div class="empty-state">นักกิจกรรม (OT) ยังไม่ได้บันทึกความก้าวหน้า<br><small>ข้อมูลจะปรากฏหลังจากเซสชัน</small></div>';
      return;
    }
    c.innerHTML=withNotes.map(i=>`<div class="pcard" onclick="toggleCard(this)">
      <div class="ph">
        <div class="pic">${ic('star')}</div>
        <div><div class="pt">${escHtml(i.course_name)}</div><div class="pd">${formatDate(i.booking_time)}</div></div>
        <div class="chev">›</div>
      </div>
      <div class="pbody"><div class="inner">
        <p>${escHtml(i.parent_summary)}</p>
        <div class="tags"><span class="tg b">${ic('lock')} บันทึกจากนักกิจกรรมบำบัด</span></div>
      </div></div>
    </div>`).join('');
    const f=c.querySelector('.pcard'); if(f) f.classList.add('open');
  }catch(e){c.innerHTML='<div class="empty-state">โหลดไม่สำเร็จ</div>';}
}

// ---------- Calendar Logic ----------
function openCalendar(cid,name,dur,price){
  const _co=allCourses.find(c=>c.id===cid);
  if(_co && _co.session_type==='group'){ openGroupEvents(cid); return; } // group courses never use the free-slot calendar
  bookingCourseId=cid; bookingCourseDur=dur||60; selectedDate=null; selectedSlot=null;
  document.getElementById('bcal-name').textContent=name;
  document.getElementById('bcal-meta').textContent=`⏱ ${dur} นาที · ฿${Number(price).toLocaleString()}`;
  document.getElementById('confirm-book-btn').disabled=true;
  document.getElementById('booking-summary').textContent='กรุณาเลือกวันที่ต้องการ';
  document.getElementById('slot-section').style.display='none';
  calYear=new Date().getFullYear(); calMonth=new Date().getMonth();
  renderCalendar(); 
  go('booking-cal');
}

function changeMonth(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0) {calMonth=11;calYear--;}
  selectedDate=null; selectedSlot=null;
  document.getElementById('slot-section').style.display='none';
  document.getElementById('confirm-book-btn').disabled=true;
  document.getElementById('booking-summary').textContent='กรุณาเลือกวันที่ต้องการ';
  renderCalendar();
}

function renderCalendar(){
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  document.getElementById('cal-month-label').textContent=`${months[calMonth]} ${calYear+543}`;
  const grid=document.getElementById('cal-grid');
  const dows=['อา','จ','อ','พ','พฤ','ศ','ส'];
  const today=new Date(); today.setHours(0,0,0,0);
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  
  let html=dows.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-day empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(calYear,calMonth,d); date.setHours(0,0,0,0);
    const isPast=date<today, isToday=date.getTime()===today.getTime();
    const isAvail=!isPast;
    const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSel=selectedDate===ds;
    
    let cls='cal-day';
    if(isPast) cls+=' past'; else if(isAvail) cls+=' avail';
    if(isToday) cls+=' today';
    if(isSel) cls+=' selected';
    
    const click=isAvail?`onclick="selectCalDay('${ds}',${d})"` :'';
    html+=`<div class="${cls}" ${click}>${d}</div>`;
  }
  grid.innerHTML=html;
}

async function selectCalDay(ds,d){
  selectedDate=ds; selectedSlot=null; selectedSessionId=null;
  document.getElementById('confirm-book-btn').disabled=true;
  document.getElementById('booking-summary').textContent='กรุณาเลือกเวลา';
  renderCalendar();
  const mShort=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  document.getElementById('slot-label').textContent=`เลือกเวลา — ${d} ${mShort[calMonth]} ${calYear+543}`;
  const grid=document.getElementById('slot-grid');
  grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--ink-soft);font-size:13px;padding:10px 0">กำลังตรวจสอบเวลาว่าง...</div>';
  document.getElementById('slot-section').style.display='block';

  const hm = iso => new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'});
  // Occupied windows in Bangkok wall-clock minutes-since-midnight, one per
  // existing session for this (fixed) therapist on the day — not just their
  // start times — so a slot that starts INSIDE a longer session (e.g. a
  // 90-min group course) is caught too, not only an exact start-time clash.
  let occupied=[], sessions=[];

  try{
    const [bRes,sRes]=await Promise.all([
      api(`/bookings?date=${ds}`),
      api(`/sessions?course_id=${bookingCourseId}&from=${ds}T00:00:00%2B07:00&to=${ds}T23:59:59%2B07:00`)
    ]);
    if(bRes.ok){
      const rows=await bRes.json();
      occupied=rows.map(r=>{ const start=_t2m(hm(r.booking_time)); return { start, end: start+r.duration_minutes }; });
    }
    if(sRes.ok) sessions=await sRes.json();
  }catch(e){ console.warn(e); }

  if(selectedDate!==ds) return;

  const byTime={}; sessions.forEach(sn=>{ byTime[hm(sn.starts_at)]=sn; });

  const slots = buildSlots(bookingCourseDur);
  if(!slots.length){ grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--ink-soft);font-size:13px;padding:10px 0">ไม่มีเวลาว่างสำหรับคอร์สนี้</div>'; return; }

  grid.innerHTML=slots.map(({t,end})=>{
    const sn=byTime[t];
    const range=`${t} - ${end}`;
    
    if(new Date(`${ds}T${t}:00+07:00`).getTime() <= Date.now()){
      return `<div class="slot full"><span class="slot-time">${range}</span><span class="slot-sub">เวลาผ่านไปแล้ว</span></div>`;
    }

    if(sn){
      const left = (sn.seats_left !== undefined) ? sn.seats_left : Math.max(0, sn.capacity - sn.seats_taken);
      const isGroup = sn.session_type==='group';
      if(left<=0) return `<div class="slot full"><span class="slot-time">${range}</span><span class="slot-sub">${isGroup?'เต็มแล้ว':'ไม่ว่าง'}</span></div>`;
      if(isGroup) return `<div class="slot group" onclick="askAboutGroup('${ds}','${range}')"><span class="slot-time">${range}</span><span class="slot-sub">คลาสกลุ่ม · เหลือ ${left} ที่</span></div>`;
      return `<div class="slot" onclick="selectSlot(this,'${ds}T${t}:00+07:00',${sn.id})"><span class="slot-time">${range}</span><span class="slot-sub">ว่าง</span></div>`;
    }
    const slotStart=_t2m(t), slotEnd=_t2m(end);
    const overlapsOccupied=occupied.some(w=>slotStart<w.end && slotEnd>w.start);
    if(overlapsOccupied) return `<div class="slot full"><span class="slot-time">${range}</span><span class="slot-sub">ไม่ว่าง</span></div>`;
    return `<div class="slot" onclick="selectSlot(this,'${ds}T${t}:00+07:00',null)"><span class="slot-time">${range}</span><span class="slot-sub">ว่าง</span></div>`;
  }).join('');
}

function selectSlot(el,iso,sessionId){
  document.querySelectorAll('.slot').forEach(s=>s.classList.remove('selected'));
  el.classList.add('selected');
  selectedSlot=iso; selectedSessionId=sessionId||null;
  const timeText=(el.querySelector('.slot-time')||el).textContent.trim();
  document.getElementById('booking-summary').innerHTML=`จอง <strong>${document.getElementById('bcal-name').textContent}</strong><br>${formatDay(selectedDate)} เวลา ${timeText}`;
  document.getElementById('confirm-book-btn').disabled=false;
}

async function confirmBooking(){
  if(!selectedSlot||!activeChildId||!bookingCourseId) return;
  const btn=document.getElementById('confirm-book-btn');
  btn.disabled=true; btn.textContent='กำลังจอง...';
  try{
    const res=await api('/bookings',{
      method:'POST',
      body:JSON.stringify(selectedSessionId
        ? {child_id:activeChildId,session_id:selectedSessionId}
        : {child_id:activeChildId,course_id:bookingCourseId,booking_time:selectedSlot})
    });
    if(res.ok){showToast('จองสำเร็จ! รอการยืนยันจากคลินิก'); go('home');}
    else if(res.status===409){
      const err=await res.json().catch(()=>({}));
      showToast(err.error==='SESSION_FULL'?'คลาสนี้เพิ่งเต็ม กรุณาเลือกเวลาอื่น' : err.error==='ALREADY_BOOKED'?'น้องจองคลาสนี้ไว้แล้ว':'เวลานี้เพิ่งถูกจองไป');
      btn.textContent='ยืนยันการจอง';
      selectCalDay(selectedDate, parseInt(selectedDate.slice(8),10));
    } else throw new Error();
  }catch(e){showToast('จองไม่สำเร็จ กรุณาลองใหม่'); btn.disabled=false; btn.textContent='ยืนยันการจอง';}
}

// ---------- Chat Logic ----------
function openClinicChat(prefill){
  const url = `https://line.me/R/oaMessage/${encodeURIComponent(CLINIC_LINE_OA)}/?${encodeURIComponent(prefill||'')}`;
  if(window.liff && liff.openWindow){ liff.openWindow({url, external:false}); } else { window.open(url,'_blank'); }
}
function askAboutGroup(ds,range){
  const childName = document.getElementById('bcal-name').textContent||'';
  openClinicChat(`สวัสดีค่ะ สนใจจองคลาสกลุ่ม\n${childName}\nวันที่ ${ds} เวลา ${range}`);
}

// ---------- Auth / Init Logic ----------
async function submitAddChild(){
  const fn=document.getElementById('add-first-name').value.trim(), ln=document.getElementById('add-last-name').value.trim();
  const nk=document.getElementById('add-nickname').value.trim(), gd=document.getElementById('add-gender').value;
  const dob=dobIsoFrom('add'), ma=document.getElementById('add-medical-alerts').value.trim();
  if(dob===null){showToast('วันเกิดไม่ถูกต้อง');return;}
  if(!fn||!ln||!nk||!dob){showToast('กรุณากรอกข้อมูลให้ครบ');return;}
  
  const btn=document.getElementById('add-child-btn'); btn.disabled=true; btn.textContent='กำลังเพิ่ม...';
  try{
    const res=await api('/children',{
      method:'POST', body:JSON.stringify({first_name:fn, last_name:ln, nickname:nk, gender:gd||null, date_of_birth:dob, medical_alerts:ma||null})
    });
    if(res.ok){
      const nc=await res.json(); 
      children.push(nc); 
      activeChildId=nc.id;
      
      document.getElementById('modal-add-child').classList.remove('active');
      ['add-first-name','add-last-name','add-nickname','add-gender','add-medical-alerts'].forEach(id=>document.getElementById(id).value='');
      clearDobSelects('add');
      
      // อัปเดต Modal เลือกเด็กให้มีชื่อน้องคนใหม่โผล่ขึ้นมาด้วย
      renderChildSelectModal();
      
      showToast(`เพิ่ม ${nk} สำเร็จ`); 
      loadHomeData();
    } else throw new Error();
  }catch(e){showToast('เพิ่มไม่สำเร็จ');}
  btn.disabled=false; btn.textContent='เพิ่มเด็ก';
}

async function submitRegistration(){
  const pn=document.getElementById('reg-parent-name').value.trim(), ph=document.getElementById('reg-phone').value.trim();
  const fn=document.getElementById('reg-first-name').value.trim(), ln=document.getElementById('reg-last-name').value.trim();
  const nk=document.getElementById('reg-nickname').value.trim(), gd=document.getElementById('reg-gender').value;
  const dob=dobIsoFrom('reg'), ma=document.getElementById('reg-medical-alerts').value.trim();
  if(dob===null){showToast('วันเกิดไม่ถูกต้อง');return;}
  if(!pn||!ph||!fn||!ln||!nk||!dob){showToast('กรุณากรอกข้อมูลให้ครบ');return;}
  if(!/^0\d{9}$/.test(ph)){showToast('เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0');return;}
  
  const btn=document.getElementById('reg-btn'); btn.disabled=true; btn.textContent='กำลังลงทะเบียน...';
  try{
    const res=await api('/parents',{
      method:'POST', body:JSON.stringify({parent_name:pn, parent_phone:ph, first_name:fn, last_name:ln, nickname:nk, gender:gd||null, date_of_birth:dob, medical_alerts:ma||null})
    });
    if(res.ok){
      const data=await res.json(); parentData=data.parent; children=[data.child]; activeChildId=data.child.id;
      launchApp();
    } else {
      const err=await res.json();
      showToast(err.error&&err.error.includes('already registered')?'บัญชีนี้ลงทะเบียนแล้ว':'ลงทะเบียนไม่สำเร็จ');
    }
  }catch(e){showToast('ลงทะเบียนไม่สำเร็จ');}
  btn.disabled=false; btn.textContent='ลงทะเบียน';
}

function launchApp(){
  document.getElementById('bottom-nav').style.display='flex';
  renderChildSelectModal(); // สั่งสร้างปุ่มใน Modal ทันทีที่เข้าแอป
  go('home');
  const _t = getTabFromUrl();
  if(_t && _t !== 'home') go(_t);
}

function showError(title, msg){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('s-error').classList.add('active');
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-desc').innerHTML = msg;
}

async function init(){
  if(IS_DEV){ lineUserId='dev-mode-user'; document.getElementById('s-loading').classList.remove('active'); document.getElementById('s-register').classList.add('active'); return; }
  try{
    await liff.init({liffId:LIFF_ID});
    if(!liff.isLoggedIn()){liff.login();return;}
    lineUserId=(await liff.getProfile()).userId;
  }catch(e){
    if(IS_DEV){ lineUserId='dev-mode-user'; document.getElementById('s-loading').classList.remove('active'); document.getElementById('s-register').classList.add('active'); return; }
    showError('กรุณาเปิดผ่านแอป LINE', 'แอปนี้ต้องเข้าสู่ระบบด้วยบัญชี LINE<br>กรุณาเปิดลิงก์ในแอป LINE'); return;
  }
  try{
    const res=await api('/parents');
    if(res.status===404){
      document.getElementById('s-loading').classList.remove('active');
      document.getElementById('s-register').classList.add('active');
    } else if(res.ok){
      const data=await res.json(); parentData=data.parent; children=data.children;
      activeChildId=children.length?children[0].id:null;
      launchApp();
    } else { showError('API Error', `Backend ตอบกลับ Status: <b>${res.status}</b>`); }
  }catch(e){ showError('Network Error', `<span style="color:var(--pink);word-break:break-all">${e.message}</span>`); }
}

init();