/* ===== My Clinic Kids admin — 00-app-core.js ===== */
/* Part of admin.html, split for maintainability. Loaded as a plain (non-module) script; global scope is shared across all files, in the order listed in admin.html. */

/* ================= COGNITO LOGIN (Authorization Code + PKCE) ================= */
/* ---- Shared archive/restore icons (scale via 1em; currentColor matches button text + hover) ---- */
const SVG_ARCHIVE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="vertical-align: text-bottom; margin-right: 6px;"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 15.9853L15.182 12.8033L14.1213 11.7427L12.75 13.114L12.75 5.25L11.25 5.25L11.25 13.114L9.8787 11.7427L8.81804 12.8033L12 15.9853ZM12 13.864L12 13.864L12.0001 13.864L12 13.864Z" fill="currentColor"/><path d="M18 17.25L18 18.75L6 18.75L6 17.25L18 17.25Z" fill="currentColor"/></svg>';
const SVG_RESTORE = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" style="vertical-align:-.15em;margin-right:.35em" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M18 18.7499L18 17.2499L6 17.2499L6 18.7499L18 18.7499ZM8.81793 8.12119L11.9999 4.93921L15.1819 8.12119L14.1212 9.18185L12.7499 7.81053L12.7499 15.6745L11.2499 15.6745L11.2499 7.81053L9.87859 9.18185L8.81793 8.12119ZM11.9999 7.06053L12 7.06058L11.9999 7.06058L11.9999 7.06053Z" fill="currentColor"/></svg>';

const COGNITO = {
  domain:      "https://mck-clinic-th.auth.ap-southeast-7.amazoncognito.com",
  clientId:    "4sb40s74b86rq3836599soj0lg",
  redirectUri: "https://dzl3k1dxnqyo5.cloudfront.net/admin.html",
  scope:       "openid email"
};
const API_BASE = "https://mulbd1y5bj.execute-api.ap-southeast-7.amazonaws.com";
let ID_TOKEN = null;

// ฟังก์ชันสำหรับ Filter ค้นหาข้อมูลในตาราง
function filterTable(tbodyId, keyword) {
  const rows = document.querySelectorAll(`#${tbodyId} tr`);
  const lowerKey = keyword.toLowerCase();
  
  rows.forEach(row => {
    // ถ้าแถวไหนคือกล่องบอกว่า "ยังไม่มีข้อมูล" ให้ข้ามไป
    if(row.querySelector('.empty')) return; 
    
    // ค้นหาจากข้อความทั้งหมดในแถวนั้น
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(lowerKey) ? '' : 'none';
  });
}

function b64url(bytes){
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function initApp() {
  // 1. ตรวจสอบการล็อกอิน / Token (โค้ดเดิมของพี่)
  const isLoggedIn = await checkAuth(); 
  
  if (isLoggedIn) {
    // 🚀 2. ปิดตัวหมุนๆ เต็มจอทิ้งทันทีที่รู้ว่าล็อกอินผ่าน!
    const bootLoader = document.getElementById('boot-loading');
    if (bootLoader) {
      bootLoader.style.display = 'none';
    }

    // 🚀 3. ให้ Skeleton เริ่มทำงาน และยิง API ดึงข้อมูล
    loadPendingBookings(); 
    
    // (ถ้ามีดึงข้อมูลตารางอื่นอีก ก็เรียกต่อตรงนี้ได้เลย Skeleton จะทำงานพร้อมกัน)
    // loadOtherData(); 
  } else {
    // โยนกลับไปหน้าล็อกอิน
  }
}

async function sha256(str){ return await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); }
function randomVerifier(){ const a=new Uint8Array(64); crypto.getRandomValues(a); return b64url(a); }

async function adminLogin(){
  const verifier=randomVerifier();
  const challenge=b64url(await sha256(verifier));
  sessionStorage.setItem('pkce_verifier', verifier);
  const url=`${COGNITO.domain}/oauth2/authorize?client_id=${COGNITO.clientId}`
    +`&response_type=code&scope=${encodeURIComponent(COGNITO.scope)}`
    +`&redirect_uri=${encodeURIComponent(COGNITO.redirectUri)}`
    +`&code_challenge_method=S256&code_challenge=${challenge}`;
  window.location.href=url;
}

function adminLogout(){
  ID_TOKEN=null;
  const url=`${COGNITO.domain}/logout?client_id=${COGNITO.clientId}`
    +`&logout_uri=${encodeURIComponent(COGNITO.redirectUri)}`;
  window.location.href=url;
}

async function completeLoginIfReturning(){
  const params=new URLSearchParams(window.location.search);
  const code=params.get('code');
  if(!code) return false;
  const verifier=sessionStorage.getItem('pkce_verifier');
  if(!verifier){ showLoginError('เซสชันหมดอายุ กรุณาลองใหม่'); return false; }
  try{
    const res=await fetch(`${COGNITO.domain}/oauth2/token`,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'authorization_code',client_id:COGNITO.clientId,code,redirect_uri:COGNITO.redirectUri,code_verifier:verifier})
    });
    if(!res.ok) throw new Error('token exchange failed');
    const tokens=await res.json();
    ID_TOKEN=tokens.id_token;
    sessionStorage.removeItem('pkce_verifier');
    window.history.replaceState({}, document.title, COGNITO.redirectUri);
    return true;
  }catch(e){ showLoginError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'); return false; }
}

function showLoginError(msg){ const el=document.getElementById('login-error'); el.textContent=msg; el.style.display='block'; }
function showApp(){ document.getElementById('login-screen').style.display='none'; document.getElementById('app-root').style.display='block'; }
function showLogin(){ document.getElementById('app-root').style.display='none'; document.getElementById('login-screen').style.display='flex'; }

/* Authenticated staff API helper */
async function adminApi(path, opts={}){
  const headers=Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(ID_TOKEN) headers['Authorization']='Bearer '+ID_TOKEN;
  const res=await fetch(API_BASE+path, Object.assign({}, opts, {headers}));
  if(res.status===401){ ID_TOKEN=null; showLogin(); throw new Error('unauthorized'); }
  return res;
}

/* Connection check.
   Normal use: silent — the status bar stays hidden and the result goes to console.
   Failure:    an honest, actionable banner the person can act on.
   ?dev=1:     always show the bar, for our own debugging. */
function isDevView(){
  return new URLSearchParams(location.search).has('dev')
      || location.hostname==='localhost' || location.hostname==='127.0.0.1';
}

function setStatus(state, html){
  const el=document.getElementById('statusbar');
  if(!el) return;
  el.className='statusbar '+(state?('is-'+state):'');
  el.innerHTML=html||'';
  el.hidden=!state;
}

async function connectionCheck(){
  try{
    const res=await adminApi('/admin/courses');
    if(res.ok){
      console.log('[BabyPlayTime] API connected');
      if(isDevView()) setStatus('dev','โหมดนักพัฒนา · เชื่อมต่อ API สำเร็จ');
      else setStatus(null);
      return;
    }
    console.warn('[BabyPlayTime] API returned', res.status);
    setStatus('error','เชื่อมต่อระบบไม่ได้ (รหัส '+res.status+') — <a href="#" onclick="location.reload();return false">โหลดหน้าใหม่</a>');
  }catch(e){
    console.error('[BabyPlayTime] API unreachable', e);
    setStatus('error','เชื่อมต่อระบบไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้ว <a href="#" onclick="location.reload();return false">โหลดหน้าใหม่</a>');
  }
}

/* Boot: complete login if returning, else show login screen */
async function bootAdmin(){
  const ok=await completeLoginIfReturning();
  if(!(ok && ID_TOKEN)){ showLogin(); return; }

  showApp();

  // RBAC: read identity + role from the token, adjust nav/profile before rendering.
  loadUserFromToken();
  applyRbac();
  if(isTopRole(USER.role)) loadStaff();   // staff list is top-role only

  const bootLoader = document.getElementById('boot-loading');
    if (bootLoader) {
    bootLoader.style.display = 'none';
  }

  // Fire all network-dependent work in parallel so cold-starting Lambdas
  // wake up concurrently instead of one-after-another. allSettled = one slow
  // or failing call never blocks the others.
  await Promise.allSettled([
    renderSchedule(),   // GET /admin/sessions
    loadChildren(),     // GET /admin/children
    loadCourses(),      // GET /admin/courses
    connectionCheck(),   // GET /admin/courses (banner status)
    loadPendingBookings()
  ]);

  const boot = document.getElementById('boot-loading');
  if (boot) {
    boot.style.display = 'none';
  }
}
/* ============================================================================= */

/* ================= RBAC (roles from Cognito groups in the ID token) =========== */
/* NOTE: this is UX only. Real enforcement must live in the backend — every
   owner-only route (especially changing a user's role) must verify
   cognito:groups server-side. Hiding a nav item does NOT secure anything. */

let USER = { name:'', email:'', groups:[], role:null };

const ROLE_LABEL = { ClinicDirector:'ผู้อำนวยการคลินิก', Admin:'ผู้ดูแลระบบ', OT:'นักกิจกรรมบำบัด (OT)', SpecialEd:'ครูกิจกรรมพิเศษ' };
function roleLabelTh(role){ return ROLE_LABEL[role] || 'ยังไม่กำหนดบทบาท'; }

// Decode a JWT payload (base64url + UTF-8 safe, so Thai names survive).
function decodeJwt(token){
  try{
    const part=token.split('.')[1];
    const b64=part.replace(/-/g,'+').replace(/_/g,'/');
    const json=decodeURIComponent(
      atob(b64).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  }catch(e){ return null; }
}

function loadUserFromToken(){
  const c=decodeJwt(ID_TOKEN)||{};
  USER.email=c.email||'';
  USER.name =c.name || c.email || 'ผู้ใช้';
  USER.groups=c['cognito:groups']||[];
  // ClinicDirector and Admin are the top-level roles (full access).
  USER.role = USER.groups.includes('ClinicDirector') ? 'ClinicDirector'
            : USER.groups.includes('Admin')          ? 'Admin'
            : USER.groups.includes('OT')             ? 'OT'
            : USER.groups.includes('SpecialEd')      ? 'SpecialEd'
            : null;   // no group → basic staff (work views only)
}

// Top-level roles that can see the Dashboard + Staff Management.
function isDirector(role){ return role==='ClinicDirector'; }
function isTopRole(role){ return role==='ClinicDirector' || role==='Admin'; }

function applyRbac(){
  // profile card
  document.getElementById('staff-name').textContent=USER.name;
  document.getElementById('staff-role').textContent=roleLabelTh(USER.role);
  // top-level-only nav items (ClinicDirector / Admin)
  const top=isTopRole(USER.role);
  document.querySelectorAll('[data-owner-only]').forEach(el=>{
    el.style.display=top?'':'none';
  });
  // Director-only: the คลัง (archive) — restore and permanent delete live there.
  const dir=isDirector(USER.role);
  document.querySelectorAll('[data-director-only]').forEach(el=>{
    el.style.display=dir?'':'none';
  });
}

/* ---------- STAFF MANAGEMENT (top-level view) — real Cognito data ---------- */
const ROLE_OPTIONS=['ClinicDirector','Admin','OT','SpecialEd'];
let STAFF=[];   // loaded from GET /admin/staff
let VIEWING_STAFF_ARCHIVE=false;   // false = active roster, true = suspended accounts (?archived=1)