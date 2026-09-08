/* ===== My Clinic Kids admin — 70-pending.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

let PENDING_BOOKINGS = [];
let PENDING_ARCHIVE = [];

// The clickable "คำขอจองคิว" alert card shown as the 3rd summary card on the schedule.
function pendingStatCard(){
  const n = PENDING_BOOKINGS.length;
  return `<div class="stat pending-stat" onclick="switchToPending()" title="ดูคำขอจองคิว">
    <div class="n" id="stat-pending-count">${n}</div>
    <div class="l">คำขอจองคิว · รออนุมัติ</div>
  </div>`;
}

// Open the dedicated pending view (no nav item; reached from the card).
function switchToPending(){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-pending').classList.add('active');
  const sched=document.querySelector('.nav-item[data-view="schedule"]');
  if(sched) sched.classList.add('active');   // keep sidebar context on Schedule
  setPendingTab('active');
  loadPendingBookings();
}
function backToSchedule(){
  const sched=document.querySelector('.nav-item[data-view="schedule"]');
  if(sched) sched.click();
}

function setPendingTab(tab){
  const isArchive = tab==='archive';
  document.getElementById('ptab-active').classList.toggle('active', !isArchive);
  document.getElementById('ptab-archive').classList.toggle('active', isArchive);
  document.getElementById('pending-active-panel').style.display  = isArchive ? 'none' : '';
  document.getElementById('pending-archive-panel').style.display = isArchive ? '' : 'none';
  if(isArchive) loadPendingArchive();
}

// History of handled requests (approved + rejected).
// NOTE: needs the deferred backend (reject -> soft 'rejected' status + this GET).
async function loadPendingArchive(){
  const tbody = document.getElementById('pending-archive-rows');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999">กำลังโหลด…</td></tr>';
  try{
    const res = await adminApi('/admin/bookings/history');
    if(!res.ok){
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;color:#B0AAB2">ประวัติคำขอยังไม่พร้อมใช้งาน<br><span style="font-size:12px">ต้องเปิดใช้งานฝั่งเซิร์ฟเวอร์ก่อน (บันทึกคำขอที่ปฏิเสธ/อนุมัติ)</span></td></tr>';
      return;
    }
    const data = await res.json();
    PENDING_ARCHIVE = Array.isArray(data) ? data : (data.bookings || data.items || []);
    renderPendingArchive();
  }catch(e){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;color:#B0AAB2">ประวัติคำขอยังไม่พร้อมใช้งาน<br><span style="font-size:12px">ต้องเปิดใช้งานฝั่งเซิร์ฟเวอร์ก่อน</span></td></tr>';
  }
}
function renderPendingArchive(){
  const tbody = document.getElementById('pending-archive-rows');
  if(!tbody) return;
  if(!PENDING_ARCHIVE.length){
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:26px;color:#999">ยังไม่มีประวัติคำขอ</td></tr>';
    return;
  }
  tbody.innerHTML = PENDING_ARCHIVE.map(b=>{
    const d = b.starts_at ? new Date(b.starts_at) : null;
    const when = d ? d.toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}) : '-';
    const child = b.child_name || [b.child_first_name,b.child_last_name].filter(Boolean).join(' ') || '-';
    const status = b.status==='approved'
      ? '<span style="color:var(--green-ink);font-weight:600">อนุมัติแล้ว</span>'
      : b.status==='rejected'
      ? '<span style="color:var(--pink-dark);font-weight:600">ปฏิเสธแล้ว</span>'
      : (b.status || '-');
    return `<tr>
      <td>${when}</td>
      <td>${b.course_name||'-'}</td>
      <td>${child}</td>
      <td>${(b.parent_name||'-')} / ${(b.parent_phone||'-')}</td>
      <td style="text-align:right">${status}</td>
    </tr>`;
  }).join('');
}
let pendingSortAsc = false; // false = ใหม่ไปเก่า (↓), true = เก่าไปใหม่ (↑)

// 🚀 ใช้ Event Delegation ดักจับ Click ระดับ Document (ท่านี้คลิกติดชัวร์ 100%)
document.addEventListener('click', function(e) {
  // เช็คว่าจุดที่คลิกคือ th ที่มี id="pending-sort-btn" หรือคลิกโดนลูกศรข้างใน
  if (e.target && (e.target.id === 'pending-sort-btn' || e.target.closest('#pending-sort-btn'))) {
    pendingSortAsc = !pendingSortAsc; // สลับสถานะ
    renderPendingBookings();          // สั่งวาดตารางใหม่
  }
});

function renderSkeletonPending() {
  const tbody = document.getElementById('pending-rows');
  if(!tbody) return;
  
  let skeletonHTML = '';
  // จำลองว่ามีคิวรออยู่ 4 แถว เพื่อให้หน้าเว็บดูเต็ม
  for(let i = 0; i < 4; i++) { 
    skeletonHTML += `
      <tr>
        <td><div class="skeleton-box" style="width: 80%;"></div></td>
        <td><div class="skeleton-box" style="width: 60%;"></div></td>
        <td><div class="skeleton-box" style="width: 70%;"></div></td>
        <td><div class="skeleton-box" style="width: 90%;"></div></td>
        <td style="text-align: right;">
          <div class="skeleton-box skeleton-btn"></div>
          <div class="skeleton-box skeleton-btn"></div>
        </td>
      </tr>
    `;
  }
  tbody.innerHTML = skeletonHTML;
}

// ฟังก์ชันแสดงผลตารางและอัปเดตตัวเลขแจ้งเตือน (Badge)
function renderPendingBookings() {
  const tbody = document.getElementById('pending-rows');
  const badge = document.getElementById('pending-badge');
  const sortIcon = document.getElementById('pending-sort-icon'); 
  if(!tbody || !badge) return;

  const n = PENDING_BOOKINGS.length;
  const statCount = document.getElementById('stat-pending-count');
  if(statCount) statCount.textContent = n;
  const tabCount = document.getElementById('ptab-active-count');
  if(tabCount) tabCount.textContent = n;

  tbody.innerHTML = '';

  // อัปเดตลูกศรที่หัวตาราง
  if (sortIcon) {
    sortIcon.textContent = pendingSortAsc ? '↑' : '↓';
  }

  // ถ้าไม่มีคิว
  if(PENDING_BOOKINGS.length === 0) {
    badge.style.display = 'none';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #666;">ไม่มีคำขอจองคิวใหม่ในขณะนี้</td></tr>';
    return;
  }

  badge.style.display = 'inline-block';
  badge.textContent = PENDING_BOOKINGS.length;

  // เรียงลำดับข้อมูลโดยอิงจาก booking_id
  const sortedBookings = [...PENDING_BOOKINGS].sort((a, b) => {
    return pendingSortAsc ? a.booking_id - b.booking_id : b.booking_id - a.booking_id;
  });

  // วนลูปสร้างตาราง
  sortedBookings.forEach(b => {
    const tr = document.createElement('tr');
    
    let dateStr = '-';
    let timeStr = '';
    if (b.starts_at) {
      const d = new Date(b.starts_at);
      dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
      timeStr = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
    }

    // ... โค้ดส่วนดึงวันที่และคอร์สของเดิม ...
    const course = b.course_name || '-';

    // 1. ดึงข้อมูลตัวแปรใหม่ (ถ้ามี)
    const fname = b.child_first_name || ''; 
    const lname = b.child_last_name || '';
    const nickname = b.child_nickname ? `(${b.child_nickname})` : '';
    
    let childFullName = '';
    
    // 2. เช็คว่ามีข้อมูลแบบใหม่ส่งมาไหม
    if (fname || lname || nickname) {
      // ถ้ามีข้อมูลใหม่ จัด Format: ชื่อจริง นามสกุล (ชื่อเล่น)
      childFullName = `${fname} ${lname} ${nickname}`.trim();
    } else {
      // ถ้าไม่มีข้อมูลใหม่ (เป็นข้อมูลเก่าที่จองเข้ามาก่อนแก้ระบบ) ให้ใช้คอลัมน์เดิม
      childFullName = b.child_name || '-';
    }

    // 3. ดึงข้อมูลอายุ (ถ้าไม่มี ให้ขึ้นว่า ไม่ระบุ)
    const ageText = b.child_age ? `อายุ ${b.child_age} ปี` : 'ไม่ระบุอายุ';

    // 4. จัด Layout ก้อนข้อมูลเด็ก
    const childDisplay = `
      <div style="line-height: 1.4;">
        <div style="font-weight: 500;">${childFullName}</div>
        <div style="font-size: 13px; color: #6b7280;">${ageText}</div>
      </div>
    `;

    const parent = b.parent_name || '-';
    const phone = b.parent_phone || '-';

    tr.innerHTML = `
      <td>${dateStr} ${timeStr}</td>
      <td>${course}</td>
      <td>${childDisplay}</td> <!-- 👈 นำตัวแปรที่ประกอบร่างแล้วมาใส่ตรงนี้ -->
      <td>${parent} / ${phone}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button onclick="approveBooking('${b.booking_id}')" style="background-color: var(--pink); color: white; border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 8px;">อนุมัติ</button>
        <button onclick="rejectBooking('${b.booking_id}')" style="background-color: white; color: #4b5563; border: 1px solid #d1d5db; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 14px;">ปฏิเสธ</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// ฟังก์ชัน อนุมัติ / ปฏิเสธ คิวจอง
// ==========================================

// ฟังก์ชันดึงข้อมูลคิวที่รออนุมัติจาก API
async function loadPendingBookings() {
  // 🚀 โชว์ Skeleton ทันทีก่อนที่จะยิง API 
  renderSkeletonPending();

  try {
    const res = await adminApi('/admin/bookings/pending');
    if (res.ok) {
      const data = await res.json();
      PENDING_BOOKINGS = Array.isArray(data) ? data : (data.bookings || data.data || data.items || []);
    } else {
      console.error(`HTTP Error ${res.status}:`, await res.text());
      PENDING_BOOKINGS = [];
    }
  } catch(e) {
    console.error("Fetch Pending Bookings Failed:", e);
    PENDING_BOOKINGS = [];
  }
  
  // พอได้ข้อมูลมาแล้ว ฟังก์ชันนี้จะเอาข้อมูลจริงไปเขียนทับ Skeleton ทันที
  renderPendingBookings(); 
}

async function approveBooking(bookingId) {
  if (!confirm('ยืนยันการอนุมัติคิวจองนี้ใช่หรือไม่?')) return;
  
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'กำลังดำเนินการ...';
  btn.disabled = true;

  try {
    const res = await adminApi(`/admin/bookings/${bookingId}/approve`, {
      method: 'PUT'
    });

    if (res.ok) {
      showToast('✅ อนุมัติคิวสำเร็จ!');
      loadPendingBookings(); 
      renderSchedule(); // รีเฟรชตารางหลักเผื่อมีคิวใหม่โผล่เข้าไปในตาราง
    } else {
      const err = await res.json().catch(()=>({}));
      showToast('เกิดข้อผิดพลาด: ' + (err.error || 'ไม่สามารถอนุมัติได้'));
      btn.textContent = originalText;
      btn.disabled = false;
    }
  } catch (error) {
    showToast('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function rejectBooking(bookingId) {
  if (!confirm('ยืนยันการปฏิเสธและลบคำขอจองนี้ใช่หรือไม่?')) return;
  
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'กำลังดำเนินการ...';
  btn.disabled = true;

  try {
    // ใช้ endpoint เดียวกับการลบ booking ทั่วไป หรือ endpoint /reject แล้วแต่คุณเขียนใน Lambda ไว้
    const res = await adminApi(`/admin/sessions?booking_id=${bookingId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      showToast('❌ ปฏิเสธคำขอจองคิวแล้ว');
      loadPendingBookings();
    } else {
      const err = await res.json().catch(()=>({}));
      showToast('เกิดข้อผิดพลาด: ' + (err.error || 'ไม่สามารถปฏิเสธได้'));
      btn.textContent = originalText;
      btn.disabled = false;
    }
  } catch (error) {
    showToast('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
