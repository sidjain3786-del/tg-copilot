/* ============================================================
   Trader Co-Pilot — vanilla JS (no framework)
   Talks to /api/* (Cloudflare Pages Functions + D1) for
   auth and per-user data storage.
   ============================================================ */

// No built-in trading strategies are shipped with the app.
// Users create and save their own strategies from Notes → ADD STRATEGY.
// Remove strategies that belonged to older demo/default versions of the app.
// This does not affect strategies created by the user.
const LEGACY_DEFAULT_STRATEGY_NAMES = new Set([
  'Asian High/Low Liquidity Sweep (AMD)',
  'ICT Fair Value Gap (FVG) + Breaker',
  'Order Block (OB) Retest with Displacement'
]);

const NOTE_CONCEPTS = ['General','Entry','Exit','Strategy','Market Structure','Risk Management','Psychology','Mistakes','Trading Plan'];

const MINDSET_ARCHETYPES = [
  {id:'calm',name:'Calm Ninja',emoji:'🧘',battery:100,desc:'Rule Follower • Zero Impulse'},
  {id:'focused',name:'Laser Focused',emoji:'⚡',battery:90,desc:'Peak Clarity • Fully Prepared'},
  {id:'hesitant',name:'Hesitant / Fearful',emoji:'🥺',battery:50,desc:'Scared To Click • Doubting Rules'},
  {id:'overconfident',name:'Overconfident',emoji:'🦁',battery:40,desc:'Taking Big Position • Market Ego'},
  {id:'fomo',name:'FOMO Chaser',emoji:'🚀',battery:30,desc:'Chasing Green Candles • Late Entry'},
  {id:'boredom',name:'Boredom / Timepass',emoji:'🥱',battery:25,desc:'Bored • Market Slow Hai'},
  {id:'anxious',name:'Anxious / Stressed',emoji:'🌪️',battery:20,desc:'Distracted • Racing Mind'},
  {id:'tilt',name:'Revenge / Tilt Mode',emoji:'🤬',battery:10,desc:'Loss Recover Karna Hai • DANGEROUS'}
];

const STATE = {
  user: null,
  trades: [], notes: [], customStrategies: [], sessionNotes: {},
  activeTab: 'copilot',
  selectedPlaybookId: '',
  checkedRules: {},
  inspectionTab: 'winning',
  energyLevel: 85, noiseLevel: 15,
  selectedMindsetId: MINDSET_ARCHETYPES[0].id,
  logFormIsSetup: true, logFormDevice: 'Laptop', logFormLocation: 'Desk', logFormImage: '', logFormBeforeImage: '', logFormAfterImage: '', logFormImages: [],
  logEmotions: [], logCustomEmotion: '', editingTradeId: null,
  noteFormStrategy: '', noteFormConcept: 'General', noteFormCustomConcept: '', noteFormImage: '', noteFormBlocks: [], activeNoteId: null, editingNoteId: null, noteConceptFilter: 'ALL',
  annotator: {src:'', baseSrc:'', noteId:null, blockIndex:null, drawing:false, mode:'pen', color:'#ef4444', size:4, pressure:false, strokes:[], history:[], redo:[], activeStroke:null},
  noteAutoSaveTimer: null, noteAutoSaveBusy: false, noteInsertIndex: null,
  dashStrategy: loadDashStrategy(), dashEditStrategy: null, strategyManager: {open:false, editingId:null}, historyStrategyFilter: 'ALL', historyMistakeFilter: 'ALL', historyDateFilter: '', analysisDateFilter: '', historyView: localStorage.getItem('tc_history_view') || 'grid',
  riskSettings: loadRiskSettings()
};
function loadRiskSettings(){
  const defaults={account:100000,riskPct:1,dailyLossPct:2,weeklyLossPct:5,maxTrades:5,maxLossStreak:3,minRR:2,currency:'₹'};
  try {
    const saved=JSON.parse(localStorage.getItem('tc_risk_settings')||'{}');
    return (saved && typeof saved==='object') ? {...defaults, ...saved} : defaults;
  } catch (_) {
    try { localStorage.removeItem('tc_risk_settings'); } catch (_) {}
    return defaults;
  }
}

/* ---------------- utils ---------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function currencySymbol(){ return (STATE?.riskSettings?.currency || '₹'); }
function fmtAmount(n){ const v=Math.round(Math.abs(Number(n)||0)*100)/100; return v.toLocaleString('en-IN',{maximumFractionDigits:2}); }
function money(n){ n=Number(n)||0; return n>=0 ? `+${currencySymbol()}${fmtAmount(n)}` : `-${currencySymbol()}${fmtAmount(n)}`; }
function localDateKey(d=new Date()){ const p=x=>String(x).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function findMindset(id){ return MINDSET_ARCHETYPES.find(m=>m.id===id) || MINDSET_ARCHETYPES[0]; }
function normalizeCustomStrategy(s){
  if (typeof s === 'string') return { id:`custom-${s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`, name:s, entryCriteria:'', exitCriteria:'', rules:[] };
  return s || {id:'', name:'', entryCriteria:'', exitCriteria:'', rules:[]};
}
function allStrategies(){
  return STATE.customStrategies.map(normalizeCustomStrategy);
}
function emptyStrategy(){
  return { id:'', name:'No strategy selected', entryCriteria:'', exitCriteria:'', rules:[], mandatoryRules:[], commonTraps:[], winningExamples:[], losingExamples:[], winRate:0, avgRR:'—' };
}
function findStrategy(id){ return allStrategies().find(p=>p.id===id) || emptyStrategy(); }
function findStrategyByName(name){ return allStrategies().find(p=>p.name===name) || emptyStrategy(); }
function sanitizeCustomStrategies(list){
  return (list || []).map(normalizeCustomStrategy).filter(s => s.name && !LEGACY_DEFAULT_STRATEGY_NAMES.has(s.name.trim()));
}
function customStrategyNames(){ return STATE.customStrategies.map(normalizeCustomStrategy); }
function tradeEmotions(t){
  if (Array.isArray(t?.emotions)) return t.emotions.filter(Boolean);
  if (Array.isArray(t?.emotion)) return t.emotion.filter(Boolean);
  return t?.emotion ? [t.emotion] : [];
}
function emotionText(t){ return tradeEmotions(t).join(' · ') || '—'; }
function sanitizeNoteHtml(html){
  const tpl=document.createElement('template'); tpl.innerHTML=String(html||'');
  const allowed=new Set(['B','STRONG','I','EM','U','MARK','BR','SPAN','DIV','P','FONT']);
  const walk=node=>{ [...node.childNodes].forEach(child=>{ if(child.nodeType!==Node.ELEMENT_NODE) return;
    if(!allowed.has(child.tagName)){ while(child.firstChild) child.parentNode.insertBefore(child.firstChild,child); child.remove(); return; }
    [...child.attributes].forEach(a=>{ if(a.name!=='style' && !(child.tagName==='FONT'&&a.name==='size')) child.removeAttribute(a.name); });
    if(child.hasAttribute('style')){ const st=child.getAttribute('style'); const bg=(st.match(/background-color\s*:\s*([^;]+)/i)||[])[1]; const fs=(st.match(/font-size\s*:\s*([^;]+)/i)||[])[1]; child.removeAttribute('style'); if(bg) child.style.backgroundColor=bg.trim(); if(fs) child.style.fontSize=fs.trim(); }
    walk(child);
  });}; walk(tpl.content); return tpl.innerHTML;
}
function noteTextFromHtml(html){ const d=document.createElement('div'); d.innerHTML=sanitizeNoteHtml(html); return (d.textContent||'').replace(/\u00a0/g,' '); }
function normalizeNoteBlocks(note){
  let raw=Array.isArray(note?.blocks)?note.blocks:[];
  let blocks=raw.filter(b=>b&&(b.type==='image'||b.type==='text')).map(b=>b.type==='image'?{type:'image',src:b.src||'',baseSrc:b.baseSrc||b.src||'',drawingStrokes:Array.isArray(b.drawingStrokes)?b.drawingStrokes:[]}:{type:'text',text:String(b.text||''),html:sanitizeNoteHtml(b.html || (b.text?esc(b.text).replace(/\n/g,'<br>'):''))}).filter(b=>b.type==='image'?!!b.src:true);
  if(!blocks.length&&note?.image) blocks.push({type:'image',src:note.image});
  if(!blocks.length) return [{type:'text',text:'',html:''}];
  const out=[]; blocks.forEach((b,i)=>{out.push(b);if(b.type==='image'&&blocks[i+1]?.type!=='text')out.push({type:'text',text:'',html:''});});
  if(out[out.length-1]?.type!=='text')out.push({type:'text',text:'',html:''}); return out;
}
function noteBlocksForForm(){ return (STATE.noteFormBlocks||[]).filter(b => b && (b.type==='image' ? !!b.src : !!String(b.text||'').trim())); }
function renderNoteBlocksEditor(){
  const blocks=STATE.noteFormBlocks||[];
  const box=$('#note-blocks-editor'); if(!box) return;
  box.innerHTML=blocks.length ? blocks.map((b,i)=> b.type==='image' ? `<div class=\"note-block-editor image\"><img src=\"${esc(imgUrl(b.src))}\" data-action=\"open-note-block-annotator\" data-index=\"${i}\"><div class=\"note-block-actions\"><button type=\"button\" class=\"btn-secondary\" data-action=\"open-note-block-annotator\" data-index=\"${i}\">✍️ Draw</button><button type=\"button\" class=\"item-delete\" data-action=\"remove-note-block\" data-index=\"${i}\">🗑️</button></div></div>` : `<div class=\"note-block-editor text\"><textarea data-note-block-text=\"${i}\" rows=\"3\" placeholder=\"Image ke neeche kya likhna hai?\">${esc(b.text)}</textarea><button type=\"button\" class=\"item-delete\" data-action=\"remove-note-block\" data-index=\"${i}\">🗑️</button></div>`).join('') : `<div class=\"notes-blocks-empty\">Abhi koi screenshot/text block nahi hai. Neeche se image ya text add karein.</div>`;
}

async function api(path, method='GET', body){
  const res = await fetch(path, {
    method, headers: body ? {'Content-Type':'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin'
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/* ---------------- image from a link ----------------
   TradingView snapshot links, direct image links, or pages with a preview image.
   The server downloads it and keeps its own copy, so the journal never breaks
   if the original link goes away. */
async function fetchImageFromLink(link){
  const url=String(link||'').trim();
  if(!/^https?:\/\//i.test(url)) throw new Error('Sahi link paste karo (https://… se shuru).');
  const res=await fetch('/api/fetch-image',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({url})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||'Link se image nahi la paye.');
  return data.url || data.dataUrl;
}
async function runImageLink(inputSel, buttonEl, onImage){
  const input=$(inputSel); const link=input?.value.trim(); if(!link) { input?.focus(); return; }
  const label=buttonEl?.textContent; if(buttonEl){ buttonEl.disabled=true; buttonEl.textContent='Laa rahe hain…'; }
  try { const src=await fetchImageFromLink(link); if(input) input.value=''; onImage(src); }
  catch(e){ alert('🔗 '+(e.message||'Link se image nahi la paye.')); }
  finally { if(buttonEl && buttonEl.isConnected){ buttonEl.disabled=false; buttonEl.textContent=label; } }
}

/* ---------------- broken image diagnostics ----------------
   If a stored chart image can't load, show WHY instead of a broken icon. */
// Older builds served /api/img with a 1-year "immutable" cache header, so a browser
// could keep a bad copy forever. Every display URL gets a version tag so the
// browser asks the server again. Stored data keeps the plain URL.
const IMG_URL_VERSION = '3';
function imgUrl(src){
  const s0 = String(src||'');
  if (!s0.startsWith('/api/img/')) return s0;
  const base = s0.split('?')[0];
  return IMG_GOOD_URL.get(base) || `${base}?v=${IMG_URL_VERSION}`;
}
const IMG_GOOD_URL = new Map();   // base URL -> URL that is known to load
const IMG_STATUS_CACHE = new Map();
const BROKEN_ORIGINALS = new WeakMap();
const IMG_RETRIED = new Set();   // auto-retry each image at most once (no flicker loop)
function imageProblemText(status, body){
  if (status === 501) return 'Image storage (R2) is deployment se connected nahi hai. Cloudflare Pages → Settings → Bindings mein R2 binding "IMAGES" add karke redeploy karo.';
  if (status === 404) return 'Yeh image R2 bucket mein nahi mili. Shayad IMAGES binding ab kisi doosre bucket se judi hai — wahi bucket bind karo jisme pehle images gayi thi.';
  if (status === 401) return 'Login session khatam ho gaya. Dobara login karo.';
  if (status === 422 || status === 'corrupt') return 'R2 mein is image ki file kharab hai (valid image nahi hai). Trade → ✏️ Edit se yeh image hata kar dobara upload karo.';
  if (status === 0) return 'Internet / server se connect nahi ho paya. Thodi der baad Retry karo.';
  return `Image load nahi hui (error ${status}${body&&body.error?': '+body.error:''}).`;
}
async function diagnoseImage(src){
  if (IMG_STATUS_CACHE.has(src)) return IMG_STATUS_CACHE.get(src);
  const p = (async () => {
    if (src.startsWith('data:')) return { status: 'inline', text: 'Yeh purani image database mein hi kharab save hui thi (data corrupt). Edit se nayi image daal do.' };
    try {
      const r = await fetch(src, { credentials:'same-origin', cache:'no-store' });
      const body = await r.clone().json().catch(()=>null);
      if (r.ok && (r.headers.get('Content-Type')||'').startsWith('image/')) {
        // Server says OK — make sure the bytes really decode before trusting it.
        const blob = await r.blob();
        if (typeof createImageBitmap === 'function') {
          try { const bm = await createImageBitmap(blob); bm.close && bm.close(); return { status: 200, text: '' }; }
          catch (_) { return { status: 'corrupt', text: imageProblemText('corrupt') }; }
        }
        return { status: 200, text: '' };
      }
      return { status: r.status, text: imageProblemText(r.status, body) };
    } catch (_) { return { status: 0, text: imageProblemText(0) }; }
  })();
  IMG_STATUS_CACHE.set(src, p);
  return p;
}
document.addEventListener('error', async (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.brokenHandled) return;
  const src = img.getAttribute('src') || '';
  if (!src || !(src.startsWith('/api/img/') || src.startsWith('data:image/'))) return;
  img.dataset.brokenHandled = '1';
  img.style.visibility = 'hidden';   // no broken-icon flash while we check
  const info = { ...(await diagnoseImage(src.split('?')[0])) };
  const baseSrc = src.split('?')[0];
  if (info.status === 200 && !IMG_RETRIED.has(baseSrc)) {          // server copy is fine: fetch a fresh copy exactly once
    IMG_RETRIED.add(baseSrc);
    const fresh = baseSrc + '?r=' + Date.now();
    img.dataset.brokenHandled='';
    img.addEventListener('load',()=>{ img.style.visibility=''; IMG_GOOD_URL.set(baseSrc, fresh); },{once:true});
    img.src = fresh; return;
  }
  if (IMG_GOOD_URL.has(baseSrc) && src !== IMG_GOOD_URL.get(baseSrc)) {   // re-rendered element: use the URL that worked
    img.dataset.brokenHandled=''; img.style.visibility=''; img.src = IMG_GOOD_URL.get(baseSrc); return;
  }
  if (info.status === 200) info.text = 'Image baar-baar load nahi ho rahi. Page refresh karke dekho; phir bhi na aaye to Edit se dobara upload karo.';
  const box = document.createElement('div');
  box.className = 'img-broken';
  box.innerHTML = `<strong>🖼️ Image load nahi hui</strong><p class="img-broken-msg">${esc(info.text)}</p><div class="img-broken-actions"><button type="button" data-action="retry-broken-image">Retry</button>${src.startsWith('/api/img/')?'<button type="button" data-action="check-all-images">Sab images check karo</button>':''}</div>`;
  box.dataset.src = src;
  BROKEN_ORIGINALS.set(box, img);
  img.replaceWith(box);
}, true);
async function checkAllImages(){
  try {
    const r = await fetch('/api/img-health', { credentials:'same-origin', cache:'no-store' });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'Check nahi ho paya.'); return; }
    const lines = [
      `Image storage (R2) connected: ${d.binding ? 'Haan ✅' : 'NAHI ❌'}`,
      `Journal mein R2 images: ${d.referenced}`,
      `Bucket mein mili: ${d.found}`,
      `Gayab: ${d.missing.length}`,
      `Kharab file (damaged): ${(d.damaged||[]).length}`,
      `Abhi bhi database ke andar (inline) images: ${d.inline}`
    ];
    if (!d.binding) lines.push('', 'Fix: Cloudflare Pages → Settings → Bindings → R2 bucket → Variable name IMAGES → redeploy.');
    else if (d.missing.length) lines.push('', 'Gayab images us bucket mein nahi hain jo abhi bind hai. Agar pehle koi aur bucket bind tha, wahi wapas bind karo.');
    if ((d.damaged||[]).length) lines.push('', 'Kharab files ko trade Edit karke hatao aur dobara upload karo.');
    alert(lines.join('\n'));
  } catch (_) { alert('Check nahi ho paya — internet check karo.'); }
}

/* ---------------- motion ---------------- */
const REDUCED_MOTION = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
let LAST_RENDERED_TAB = null;
let DASHBOARD_INTRO_DONE = false;
let TAB_INDICATOR_POS = null;
function playTabEnter(){
  const content=$('#tab-content'); if(!content) return;
  if (LAST_RENDERED_TAB !== null && LAST_RENDERED_TAB !== STATE.activeTab && !REDUCED_MOTION) {
    content.classList.remove('tc-enter'); void content.offsetWidth; content.classList.add('tc-enter');
  }
  LAST_RENDERED_TAB = STATE.activeTab;
}
// Slide the white pill under the active desktop tab from where it was before.
function placeTabIndicator(){
  const nav=$('#tab-nav'); if(!nav) return;
  const active=nav.querySelector('.tab-btn.active'); if(!active) return;
  let ind=document.createElement('span'); ind.className='tab-indicator'; nav.prepend(ind);
  const target={x:active.offsetLeft, w:active.offsetWidth};
  if (!target.w) return; // nav hidden (mobile)
  const from=TAB_INDICATOR_POS || target;
  ind.style.transition='none'; ind.style.transform=`translateX(${from.x}px)`; ind.style.width=from.w+'px';
  void ind.offsetWidth;
  ind.style.transition=''; ind.style.transform=`translateX(${target.x}px)`; ind.style.width=target.w+'px';
  TAB_INDICATOR_POS=target;
  if (active.scrollIntoView && nav.scrollWidth>nav.clientWidth) active.scrollIntoView({block:'nearest',inline:'nearest',behavior:REDUCED_MOTION?'auto':'smooth'});
}
// Count a formatted number up from zero, keeping its prefix/suffix (₹, %, R, /5 ...).
function countUp(el, duration=900){
  if (!el || REDUCED_MOTION || typeof requestAnimationFrame!=='function') return;
  const text=el.textContent; const m=text.match(/-?[\d,]*\.?\d+/); if(!m) return;
  const raw=m[0], target=parseFloat(raw.replace(/,/g,'')); if(!Number.isFinite(target) || target===0) return;
  const decimals=(raw.split('.')[1]||'').length, grouped=raw.includes(',');
  const pre=text.slice(0,m.index), post=text.slice(m.index+raw.length);
  const fmt=v=> grouped ? (v<0?'-':'')+Math.abs(v).toLocaleString('en-IN',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}) : v.toFixed(decimals);
  const t0=performance.now();
  const step=now=>{ const k=Math.min(1,(now-t0)/duration), e=1-Math.pow(1-k,3); el.textContent=pre+fmt(target*e)+post; if(k<1) requestAnimationFrame(step); else el.textContent=text; };
  requestAnimationFrame(step);
}
function playDashboardIntro(){
  if (STATE.activeTab!=='copilot' || DASHBOARD_INTRO_DONE) return;
  DASHBOARD_INTRO_DONE = true;
  const content=$('#tab-content'); if(!content || REDUCED_MOTION) return;
  content.classList.add('tc-intro');
  setTimeout(()=>content.classList.remove('tc-intro'), 3200);
  $$('.hero-today strong, .dashboard-kpi strong', content).forEach(el=>countUp(el));
}
// Motion is decoration: it must never be able to break rendering.
function afterTabRender(){ try { playTabEnter(); playDashboardIntro(); } catch (e) { console.warn('motion skipped', e); } }

/* ---------------- auth flow ---------------- */
let authMode = 'login';

function showLoading(){ $('#loading-screen').style.display='flex'; $('#auth-screen').style.display='none'; $('#app-screen').style.display='none'; }
function showAuth(){ $('#loading-screen').style.display='none'; $('#auth-screen').style.display='flex'; $('#app-screen').style.display='none'; }
function showApp(){ $('#loading-screen').style.display='none'; $('#auth-screen').style.display='none'; $('#app-screen').style.display='block'; render(); }

function setAuthMode(mode){
  authMode = mode;
  $('#auth-name-field').style.display = mode==='signup' ? 'block' : 'none';
  $('#auth-subtitle').textContent = mode==='signup' ? 'Naya account banao' : 'Apne account mein login karo';
  $('#auth-submit').textContent = mode==='signup' ? 'Sign Up' : 'Login';
  $('#auth-toggle-text').textContent = mode==='signup' ? 'Pehle se account hai?' : 'Account nahi hai?';
  $('#auth-toggle-btn').textContent = mode==='signup' ? 'Login' : 'Sign Up';
  $('#auth-error').style.display = 'none';
}

$('#auth-toggle-btn').addEventListener('click', () => setAuthMode(authMode==='login' ? 'signup' : 'login'));

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit');
  const errEl = $('#auth-error');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Please wait...';
  try {
    const payload = { email: $('#auth-email').value.trim(), password: $('#auth-password').value };
    if (authMode === 'signup') payload.name = $('#auth-name').value.trim();
    const data = await api(authMode==='signup' ? '/api/signup' : '/api/login', 'POST', payload);
    STATE.user = data;
    await loadUserData();
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = authMode==='signup' ? 'Sign Up' : 'Login';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', 'POST'); } catch (e) { console.warn('Logout request failed', e); }
  IMAGE_URL_CACHE.clear(); IMAGE_STORE_AVAILABLE = true;
  STATE.user = null; STATE.trades = []; STATE.notes = []; STATE.customStrategies = []; STATE.sessionNotes = {};
  setAuthMode('login');
  showAuth();
});

async function loadUserData(){
  const data = await api('/api/data');
  STATE.trades = data.trades || [];
  STATE.notes = data.notes || [];
  STATE.notes = STATE.notes.map(n => ({...n, concept: n.concept || 'General', customConcept: n.customConcept || '', blocks: normalizeNoteBlocks(n)}));
  STATE.trades = (data.trades || []).map(t => ({...t, emotions: tradeEmotions(t), emotion: emotionText(t)}));
  STATE.customStrategies = sanitizeCustomStrategies(data.customStrategies);
  STATE.sessionNotes = (data.sessionNotes && typeof data.sessionNotes === 'object') ? data.sessionNotes : {};
  if (Array.isArray(data.warnings) && data.warnings.length) setTimeout(()=>alert('⚠️ ' + data.warnings.join(' ') + ' Kuch purana data load nahi hua — naya trade save karne se pehle support se baat karo.'), 300);
  if (STATE.customStrategies.length) {
    if (!STATE.selectedPlaybookId || !allStrategies().some(s => s.id === STATE.selectedPlaybookId)) STATE.selectedPlaybookId = allStrategies()[0].id;
    if (!STATE.noteFormStrategy || !allStrategies().some(s => s.name === STATE.noteFormStrategy)) STATE.noteFormStrategy = allStrategies()[0].name;
  } else {
    STATE.selectedPlaybookId = '';
    STATE.noteFormStrategy = '';
  }
}

/* ---------- image storage ----------
   Screenshots used to be stored as base64 inside the single user_data row,
   which hits D1's 2 MB row limit after ~6-12 charts and then EVERY save fails.
   Now any data:image/... value is uploaded to R2 (/api/upload) before saving,
   and only the short /api/img/... URL is kept in the journal. */
const IMAGE_URL_CACHE = new Map(); // dataUrl -> Promise<url>
let IMAGE_STORE_AVAILABLE = true;
function isDataImage(v){ return typeof v==='string' && v.startsWith('data:image/'); }
async function uploadImageNow(dataUrl){
  const res = await fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ dataUrl }) });
  if (res.status === 501) { IMAGE_STORE_AVAILABLE = false; return dataUrl; }
  const data = await res.json().catch(()=>({}));
  // A single unsupported/too-big image must not block the whole save: keep it inline.
  if (res.status >= 400 && res.status < 500 && res.status !== 401) { console.warn('Image kept inline:', data.error || res.status); return dataUrl; }
  if (!res.ok || !data.url) throw new Error(data.error || 'Image upload failed.');
  // Never swap a working inline image for a link that doesn't open: check it first.
  const check = await fetch(data.url, { credentials:'same-origin', cache:'no-store' }).catch(()=>null);
  const type = check?.headers?.get('Content-Type') || '';
  if (!check || !check.ok || !type.startsWith('image/')) {
    console.warn('Uploaded image not readable back, keeping inline copy', check?.status);
    IMAGE_STORE_AVAILABLE = false;
    return dataUrl;
  }
  return data.url;
}
function uploadImage(dataUrl){
  if (!IMAGE_URL_CACHE.has(dataUrl)) {
    const p = uploadImageNow(dataUrl);
    IMAGE_URL_CACHE.set(dataUrl, p);
    p.catch(() => IMAGE_URL_CACHE.delete(dataUrl)); // allow retry after a failure
  }
  return IMAGE_URL_CACHE.get(dataUrl);
}
// Start uploading as soon as an image is picked/drawn, so Save doesn't wait for it.
function preuploadImage(dataUrl){ if (IMAGE_STORE_AVAILABLE && isDataImage(dataUrl)) uploadImage(dataUrl).catch(()=>{}); return dataUrl; }
async function offloadImagesIn(value){
  if (!IMAGE_STORE_AVAILABLE) return;
  const slots=[]; const stack=[value];
  while (stack.length) {
    const node=stack.pop();
    if (!node || typeof node!=='object') continue;
    for (const key of Object.keys(node)) {
      const v=node[key];
      if (isDataImage(v)) slots.push([node,key,v]);
      else if (v && typeof v==='object') stack.push(v);
    }
  }
  if (!slots.length) return;
  const urls = await Promise.all(slots.map(([,,v]) => uploadImage(v))); // parallel, deduped
  slots.forEach(([node,key,v],i) => { if (node[key] === v) node[key] = urls[i]; });
}
let SAVE_CHAIN = Promise.resolve();
const ALL_PARTS = ['trades','notes','customStrategies','sessionNotes'];
async function persistAll(parts = ALL_PARTS){
  // Serialise saves so two quick saves can't overwrite each other out of order.
  // Only the requested parts are sent — a note save no longer uploads the whole trade journal.
  const run = async () => {
    if (parts.includes('trades')) await offloadImagesIn(STATE.trades);
    if (parts.includes('notes')) await offloadImagesIn(STATE.notes);
    const payload = {};
    parts.forEach(k => { payload[k] = STATE[k]; });
    return api('/api/data', 'POST', payload);
  };
  const p = SAVE_CHAIN.then(run, run);
  SAVE_CHAIN = p.catch(()=>{});
  return p;
}
async function saveUserData(what='Trade', parts = ALL_PARTS){
  try {
    await persistAll(parts);
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    alert(`${what} save nahi hua. ${e.message || 'Please try again.'}`);
    return false;
  }
}

async function autoSaveNote(noteId, attempt=1){
  const note = STATE.notes.find(n => n.id === noteId);
  const status = document.querySelector('[data-note-save-status]');
  if (!note) return;
  if (status) status.textContent = 'Saving…';
  STATE.noteAutoSaveBusy = true;
  try {
    note.updatedAt = new Date().toISOString();
    await persistAll(['notes']);
    const st = document.querySelector('[data-note-save-status]');
    if (st) st.textContent = '✓ Saved';
  } catch (e) {
    console.error('Note auto-save failed:', e);
    const st = document.querySelector('[data-note-save-status]');
    if (attempt < 3) {
      if (st) st.textContent = `⚠ Save failed — retrying (${attempt}/2)…`;
      clearTimeout(STATE.noteAutoSaveTimer);
      STATE.noteAutoSaveTimer = setTimeout(() => autoSaveNote(noteId, attempt+1), 2000*attempt);
    } else if (st) st.textContent = `⚠ Save failed — ${e.message || 'check connection'}`;
  } finally {
    STATE.noteAutoSaveBusy = false;
  }
}
function scheduleNoteAutoSave(noteId){
  clearTimeout(STATE.noteAutoSaveTimer);
  const status = document.querySelector('[data-note-save-status]');
  if (status) status.textContent = 'Unsaved changes…';
  STATE.noteAutoSaveTimer = setTimeout(() => autoSaveNote(noteId), 800);
}
function updateActiveNoteField(noteId, field, value){
  const note = STATE.notes.find(n => n.id === noteId);
  if (!note) return;
  note[field] = value;
  if (field === 'symbol') note.title = value;
  scheduleNoteAutoSave(noteId);
}

function readAndCompressImage(file){
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Invalid image file'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        const max = 1400;
        const scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(preuploadImage(canvas.toDataURL('image/jpeg', 0.68)));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function init(){
  showLoading();
  try {
    const { user } = await api('/api/me');
    if (user) {
      STATE.user = user;
      await loadUserData();
      showApp();
    } else {
      setAuthMode('login');
      showAuth();
    }
  } catch (e) {
    setAuthMode('login');
    showAuth();
  }
}

/* ---------------- journal analytics ---------------- */
const MISTAKE_OPTIONS = [
  ['none','No mistake'], ['fomo','FOMO'], ['early-entry','Early Entry'], ['late-entry','Late Entry'],
  ['moved-sl','Moved SL'], ['early-exit','Early Exit'], ['overtrading','Overtrading'], ['revenge','Revenge Trade'], ['rule-break','Broke Strategy Rule']
];
function tradeStrategyName(t){ return t.strategy || 'No strategy'; }
function tradeDateTimeRaw(t){ return t?.tradeDateTime || t?.date || t?.createdAt || ''; }
function tradeLocalDate(t){
  const raw=tradeDateTimeRaw(t);
  if(!raw) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return String(raw);
  const d=new Date(raw);
  if(Number.isNaN(d.getTime())) return String(raw).slice(0,10);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
// A trade only has a real time if tradeDateTime (or a full timestamp) was logged.
// Date-only values like "2026-09-29" must not be treated as 05:30 IST / 00:00 UTC.
function hasTradeTime(t){ const raw=String(tradeDateTimeRaw(t)||''); return !!raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()); }
function tradeSortTime(t){ const d=new Date(tradeDateTimeRaw(t)); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); }
function tradeLocalHour(t){
  if(!hasTradeTime(t)) return null;
  const raw=tradeDateTimeRaw(t);
  const d=new Date(raw); if(Number.isNaN(d.getTime())) return null;
  return d.getHours();
}
const TRADING_SESSIONS = [
  {id:'sydney', name:'Sydney', emoji:'🌏', start:22, end:7, utc:'22:00–07:00 UTC'},
  {id:'tokyo', name:'Tokyo', emoji:'🗾', start:0, end:9, utc:'00:00–09:00 UTC'},
  {id:'london', name:'London', emoji:'🇬🇧', start:8, end:17, utc:'08:00–17:00 UTC'},
  {id:'newyork', name:'New York', emoji:'🇺🇸', start:13, end:22, utc:'13:00–22:00 UTC'}
];
function hourInSession(hour, session){ return session.start < session.end ? (hour >= session.start && hour < session.end) : (hour >= session.start || hour < session.end); }
function tradeSessionTags(t){
  if(!hasTradeTime(t)) return [];
  const raw=tradeDateTimeRaw(t);
  const d=new Date(raw); if(Number.isNaN(d.getTime())) return [];
  const utcHour=d.getUTCHours() + d.getUTCMinutes()/60;
  return TRADING_SESSIONS.filter(s=>hourInSession(utcHour,s)).map(s=>s.id);
}
function sessionLabel(t){ const tags=tradeSessionTags(t); return tags.map(id=>TRADING_SESSIONS.find(s=>s.id===id)?.name).filter(Boolean).join(' + ') || 'Time not logged'; }
function dailyAnalysis(date){
  const trades=STATE.trades.filter(t=>tradeLocalDate(t)===date);
  const timed=trades.filter(t=>tradeLocalHour(t)!==null);
  const wins=trades.filter(t=>(Number(t.pnl)||0)>0), losses=trades.filter(t=>(Number(t.pnl)||0)<0);
  const pnl=trades.reduce((a,t)=>a+(Number(t.pnl)||0),0), r=trades.reduce((a,t)=>a+(Number(t.rr)||0),0);
  const hours={}; timed.forEach(t=>{const h=tradeLocalHour(t); if(!hours[h]) hours[h]={hour:h,trades:0,wins:0,losses:0,pnl:0,r:0}; const g=hours[h]; g.trades++; g.pnl+=Number(t.pnl)||0; g.r+=Number(t.rr)||0; if((Number(t.pnl)||0)>0)g.wins++; else if((Number(t.pnl)||0)<0)g.losses++;});
  const hourRows=Object.values(hours).sort((a,b)=>b.pnl-a.pnl);
  const sessions={}; TRADING_SESSIONS.forEach(s=>sessions[s.id]={...s,trades:0,wins:0,losses:0,pnl:0,r:0});
  timed.forEach(t=>tradeSessionTags(t).forEach(id=>{const g=sessions[id]; if(!g)return; g.trades++; g.pnl+=Number(t.pnl)||0; g.r+=Number(t.rr)||0; if((Number(t.pnl)||0)>0)g.wins++; else if((Number(t.pnl)||0)<0)g.losses++;}));
  return {trades,wins,losses,pnl,r,avgR:trades.length?r/trades.length:0,timed,untimed:trades.length-timed.length,hourRows,sessions:Object.values(sessions)};
}
function defaultAnalysisDate(){ return STATE.analysisDateFilter || STATE.trades.map(tradeLocalDate).filter(Boolean).sort().at(-1) || localDateKey(); }
function sessionGroupsForTrades(trades){
  const sessions={};
  TRADING_SESSIONS.forEach(s=>sessions[s.id]={...s,trades:0,wins:0,losses:0,pnl:0,r:0});
  trades.filter(t=>tradeLocalHour(t)!==null).forEach(t=>tradeSessionTags(t).forEach(id=>{
    const g=sessions[id]; if(!g)return;
    g.trades++; g.pnl+=Number(t.pnl)||0; g.r+=Number(t.rr)||0;
    if((Number(t.pnl)||0)>0)g.wins++; else if((Number(t.pnl)||0)<0)g.losses++;
  }));
  return Object.values(sessions).map(g=>({...g,winRate:g.trades?Math.round(g.wins/g.trades*100):0,avgR:g.trades?(g.r/g.trades).toFixed(2):'—'}));
}
function saveSessionView(id){
  const el=$(`[data-session-note="${id}"]`); if(!el)return;
  STATE.sessionNotes[id]=String(el.value||'').trim();
  const status=$(`[data-session-note-status="${id}"]`);
  if(status) status.textContent='Saving…';
  saveUserData('Session note', ['sessionNotes']).then(ok=>{
    const st=$(`[data-session-note-status="${id}"]`);
    if(!st) return;
    st.textContent = ok ? '✓ Saved' : '⚠ Not saved — try again';
    st.classList.remove('tc-flash'); void st.offsetWidth; st.classList.add('tc-flash');
    if(ok) setTimeout(()=>{ if(st) st.textContent=''; },1800);
  });
}
function renderDailySessionAnalysis(){
  const date=defaultAnalysisDate(), a=dailyAnalysis(date);
  const best=a.hourRows[0], worst=[...a.hourRows].sort((x,y)=>x.pnl-y.pnl)[0];
  const allSessions=sessionGroupsForTrades(STATE.trades);
  const hourRows=a.hourRows.map(g=>`<div class="analysis-row"><div><strong>${String(g.hour).padStart(2,'0')}:00</strong><span>${g.trades} trades • ${g.wins}W / ${g.losses}L</span></div><strong class="mono ${g.pnl>=0?'positive':'negative'}">${money(g.pnl)}</strong></div>`).join('');
  const sessionRows=sessionGroupsForTrades(a.trades).map(g=>{
    const all=allSessions.find(x=>x.id===g.id)||g;
    const note=STATE.sessionNotes[g.id]||'';
    return `<div class="session-analysis-card ${g.trades?'has-data':''} ${all.pnl<0?'session-negative':''}">
      <div class="session-analysis-head"><div><strong>${g.emoji} ${g.name}</strong><span>${g.utc}</span></div><strong class="mono ${g.pnl>=0?'positive':'negative'}">${money(g.pnl)}</strong></div>
      <div class="session-analysis-stats"><span>${g.trades} trades</span><span>${g.wins}W / ${g.losses}L</span><span>${g.winRate}% win</span><span>Avg R ${g.avgR}</span></div>
      <div class="session-alltime"><span>Journal total</span><strong class="${all.pnl>=0?'positive':'negative'}">${money(all.pnl)}</strong><span>${all.trades} trades • ${all.winRate}% win • Avg R ${all.avgR}</span></div>
      <div class="session-view-box"><div class="session-view-head"><div><span class="uppercase-label">MY SESSION VIEW</span><strong>✍️ What do I notice?</strong></div><span class="session-note-status" data-session-note-status="${g.id}"></span></div><textarea data-session-note="${g.id}" placeholder="Example: New York mein volatility zyada hoti hai...">${esc(note)}</textarea><button type="button" class="btn-secondary session-save-btn" data-action="save-session-note" data-session="${g.id}">💾 Save My View</button></div>
    </div>`;
  }).join('');
  return `<section class="daily-session-analysis">
    <div class="analysis-hero-row"><div><span class="uppercase-label">TRADING INTELLIGENCE</span><h2 class="section-title">📊 Daily & Session Analysis</h2><p class="card-sub">Apne data se dekho — kis din, kis hour aur kis global session mein aapka execution kaisa raha.</p></div><div class="analysis-date-control"><label>ANALYSIS DATE</label><input type="date" id="analysis-date-filter" value="${esc(date)}" aria-label="Analysis date"></div></div>
    <div class="grid-4 analysis-kpis"><div><span class="uppercase-label">TRADES</span><strong>${a.trades.length}</strong><small>Selected day</small></div><div><span class="uppercase-label">WINNING</span><strong>${a.wins.length}</strong><small>${a.trades.length?Math.round(a.wins.length/a.trades.length*100):0}% win rate</small></div><div><span class="uppercase-label">LOSING</span><strong>${a.losses.length}</strong><small>Selected day</small></div><div><span class="uppercase-label">NET P&amp;L</span><strong class="${a.pnl>=0?'positive':'negative'}">${money(a.pnl)}</strong><small>Avg R ${a.avgR.toFixed(2)}</small></div></div>
    <div class="analysis-highlight-grid"><div class="card analysis-highlight"><span>🟢 Best trading hour</span><strong>${best?String(best.hour).padStart(2,'0')+':00 — '+money(best.pnl):'—'}</strong><small>${best?best.trades+' trades':''}</small></div><div class="card analysis-highlight"><span>🔴 Weakest trading hour</span><strong>${worst?String(worst.hour).padStart(2,'0')+':00 — '+money(worst.pnl):'—'}</strong><small>${worst?worst.trades+' trades':''}</small></div><div class="card analysis-highlight"><span>⏱️ Time captured</span><strong>${a.timed.length}/${a.trades.length}</strong><small>${a.untimed?'Older trades need Trade Date & Time.':'All trades timed.'}</small></div></div>
    <div class="analysis-section-title"><span class="uppercase-label">SESSION PERFORMANCE</span><h3 class="section-title">🌍 Where does your edge show up?</h3><p class="card-sub">Top numbers selected day ke hain; “Journal total” aapke complete trade history ka data hai. Overlapping sessions mein trade dono sessions mein count hota hai.</p></div>
    <div class="session-analysis-grid session-analysis-grid-premium">${sessionRows}</div>
    <div class="analysis-columns analysis-bottom-grid"><div class="card"><div class="dashboard-section-head"><div><span class="uppercase-label">TIME OF DAY</span><h3 class="section-title">Hourly Performance</h3></div></div>${hourRows||'<p class="empty-msg">Is date par timed trades nahi hain.</p>'}</div><div class="card session-coach-card"><span class="uppercase-label">YOUR SESSION PLAYBOOK</span><h3 class="section-title">🧠 Build your own session map</h3><p class="card-sub">Stats ko apne observations ke saath pair karo. Example: “London structured lagta hai”, “New York volatile hai”.</p><div class="session-coach-points"><span>📌 Observe</span><span>📊 Compare</span><span>✍️ Record</span><span>🔁 Review</span></div></div></div>
  </section>`;
}
function renderAnalysisTab(){
  return `<div class="analysis-page">${renderDailySessionAnalysis()}</div>`;
}
/* ---------------- Risk Center ---------------- */
function riskSaveSettings(){ try { localStorage.setItem('tc_risk_settings', JSON.stringify(STATE.riskSettings)); } catch (_) {} }
function riskNum(id, fallback=0){ const v=Number($(id)?.value); return Number.isFinite(v)?v:fallback; }
function currentRiskStats(){
  const today=localDateKey(new Date());
  const weekStart=new Date(); weekStart.setHours(0,0,0,0); weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
  const weekKey=localDateKey(weekStart);
  const trades=STATE.trades||[];
  const localDate=t=>tradeLocalDate(t);
  const todayTrades=trades.filter(t=>localDate(t)===today);
  const weekTrades=trades.filter(t=>localDate(t)>=weekKey && localDate(t)<=today);
  const pnl=arr=>arr.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const todayPnl=pnl(todayTrades), weekPnl=pnl(weekTrades);
  const dailyLimit=Number(STATE.riskSettings.account||0)*Number(STATE.riskSettings.dailyLossPct||0)/100;
  const weeklyLimit=Number(STATE.riskSettings.account||0)*Number(STATE.riskSettings.weeklyLossPct||0)/100;
  let streak=0;
  for(const t of [...trades].sort((a,b)=>tradeSortTime(b)-tradeSortTime(a))){ const x=Number(t.pnl)||0; if(x<0) streak++; else if(x>0) break; }
  return {todayTrades,weekTrades,todayPnl,weekPnl,dailyLimit,weeklyLimit,streak};
}
function renderRiskCenter(){
  const r=STATE.riskSettings, s=currentRiskStats();
  const riskUsed=Math.max(0,-s.todayPnl), dailyPct=s.dailyLimit?Math.min(100,riskUsed/s.dailyLimit*100):0;
  const weeklyUsed=Math.max(0,-s.weekPnl), weeklyPct=s.weeklyLimit?Math.min(100,weeklyUsed/s.weeklyLimit*100):0;
  return `<div class="risk-page">
    <div class="risk-hero card"><div><span class="uppercase-label">RISK & MONEY MANAGEMENT</span><h2 class="section-title">🛡️ Risk Center</h2><p class="card-sub">Trade se pehle risk calculate karo, daily limits dekho aur position size discipline ke saath set karo.</p></div><div class="risk-status-pill ${s.streak>=Number(r.maxLossStreak||3)?'danger':s.todayPnl<0?'warn':'safe'}">${s.streak>=Number(r.maxLossStreak||3)?'🛑 STOP RULE':'🟢 RISK CONTROLLED'}</div></div>

    <div class="risk-dashboard-grid">
      <div class="risk-limit-card card"><div class="risk-card-head"><div><span class="uppercase-label">TODAY'S RISK</span><strong>${money(s.todayPnl)}</strong></div><span>${Math.round(dailyPct)}%</span></div><div class="risk-progress"><i style="width:${dailyPct}%"></i></div><small>Loss budget: ${money(-s.dailyLimit)} · Remaining: ${money(Math.max(0,s.dailyLimit-riskUsed))}</small></div>
      <div class="risk-limit-card card"><div class="risk-card-head"><div><span class="uppercase-label">WEEKLY RISK</span><strong>${money(s.weekPnl)}</strong></div><span>${Math.round(weeklyPct)}%</span></div><div class="risk-progress"><i style="width:${weeklyPct}%"></i></div><small>Weekly budget: ${money(-s.weeklyLimit)} · ${s.weekTrades.length} trades</small></div>
      <div class="risk-limit-card card"><div class="risk-card-head"><div><span class="uppercase-label">LOSS STREAK</span><strong>${s.streak}</strong></div><span>Max ${r.maxLossStreak}</span></div><div class="risk-streak-dots">${Array.from({length:Math.max(3,Number(r.maxLossStreak)||3)},(_,i)=>`<b class="${i<s.streak?'hit':''}"></b>`).join('')}</div><small>${s.streak>=Number(r.maxLossStreak||3)?'Configured stop rule reached.':'Consecutive losses before cooldown.'}</small></div>
    </div>

    <div class="risk-main-grid">
      <section class="card risk-calculator-card"><div class="risk-section-head"><div><span class="uppercase-label">POSITION SIZING</span><h3 class="section-title">🎯 Can I Take This Trade?</h3><p class="card-sub">Entry, stop aur target se size + risk automatically calculate hoga.</p></div><span class="risk-live">LIVE</span></div>
        <div class="risk-input-grid"><div><label>Account Balance</label><input type="number" id="risk-account-calc" value="${r.account}" min="0" step="any"></div><div><label>Risk %</label><input type="number" id="risk-pct-calc" value="${r.riskPct}" min="0.01" max="100" step="0.1"></div><div><label>Entry</label><input type="number" id="risk-entry" placeholder="e.g. 2500" step="any"></div><div><label>Stop Loss</label><input type="number" id="risk-sl" placeholder="e.g. 2480" step="any"></div><div><label>Target</label><input type="number" id="risk-target" placeholder="e.g. 2540" step="any"></div><div><label>Point/Unit Value</label><input type="number" id="risk-point-value" value="1" min="0.000001" step="any"><small>${esc(currencySymbol())} per 1 price move</small></div></div>
        <div class="risk-result-grid"><div><span>Max Risk</span><strong id="risk-max-loss">—</strong></div><div><span>Risk / Unit</span><strong id="risk-per-unit">—</strong></div><div><span>Position Size</span><strong id="risk-position-size">—</strong></div><div><span>Potential Profit</span><strong id="risk-profit">—</strong></div><div><span>R : R</span><strong id="risk-rr">—</strong></div></div><div id="risk-calc-message" class="risk-calc-message">Entry + SL + Target bharo — calculator ready hai.</div></section>

      <section class="card risk-rules-card"><div class="risk-section-head"><div><span class="uppercase-label">YOUR RULES</span><h3 class="section-title">⚙️ Money Management</h3><p class="card-sub">Ye limits device par automatically remember hongi.</p></div></div>
        <div class="risk-settings-grid"><label>Default Account <input type="number" id="risk-setting-account" value="${r.account}" min="0" step="any"></label><label>Risk / Trade % <input type="number" id="risk-setting-risk" value="${r.riskPct}" min="0.01" step="0.1"></label><label>Max Daily Loss % <input type="number" id="risk-setting-daily" value="${r.dailyLossPct}" min="0.1" step="0.1"></label><label>Max Weekly Loss % <input type="number" id="risk-setting-weekly" value="${r.weeklyLossPct}" min="0.1" step="0.1"></label><label>Max Trades / Day <input type="number" id="risk-setting-trades" value="${r.maxTrades}" min="1" step="1"></label><label>Max Loss Streak <input type="number" id="risk-setting-streak" value="${r.maxLossStreak}" min="1" step="1"></label><label>Minimum R:R <input type="number" id="risk-setting-rr" value="${r.minRR}" min="0.1" step="0.1"></label><label>Currency <select id="risk-setting-currency">${['₹','$','€','£','¥'].map(c=>`<option value="${c}" ${currencySymbol()===c?'selected':''}>${c}</option>`).join('')}</select></label></div>
        <div class="risk-rule-summary"><div>Risk / trade <strong>${money(Number(r.account)*Number(r.riskPct)/100)}</strong></div><div>Daily stop <strong>${money(-Number(r.account)*Number(r.dailyLossPct)/100)}</strong></div><div>Weekly stop <strong>${money(-Number(r.account)*Number(r.weeklyLossPct)/100)}</strong></div></div>
      </section>
    </div>

    <section class="card risk-checklist-card"><div class="risk-section-head"><div><span class="uppercase-label">PRE-TRADE GATE</span><h3 class="section-title">🚦 Before You Click Buy / Sell</h3><p class="card-sub">Aapke current rules ke against quick safety check.</p></div></div><div class="risk-gate-grid">
      <div class="risk-gate-item ${s.todayTrades.length>=Number(r.maxTrades)?'bad':'good'}"><span>${s.todayTrades.length>=Number(r.maxTrades)?'🔴':'🟢'}</span><div><strong>Daily trade count</strong><small>${s.todayTrades.length} / ${r.maxTrades} used</small></div></div>
      <div class="risk-gate-item ${s.streak>=Number(r.maxLossStreak)?'bad':'good'}"><span>${s.streak>=Number(r.maxLossStreak)?'🔴':'🟢'}</span><div><strong>Loss streak</strong><small>${s.streak} / ${r.maxLossStreak}</small></div></div>
      <div class="risk-gate-item ${s.dailyLimit>0&&riskUsed>=s.dailyLimit?'bad':'good'}"><span>${s.dailyLimit>0&&riskUsed>=s.dailyLimit?'🔴':'🟢'}</span><div><strong>Daily loss budget</strong><small>${money(-riskUsed)} / ${money(-s.dailyLimit)}</small></div></div>
      <div class="risk-gate-item warn" id="risk-gate-sl"><span>🟡</span><div><strong>Stop Loss</strong><small>Calculator mein SL define karo</small></div></div>
    </div></section>

    <section class="card r-multiple-card"><div class="risk-section-head"><div><span class="uppercase-label">PERFORMANCE IN R</span><h3 class="section-title">📈 Think in R, Not Just Rupees</h3><p class="card-sub">1R = aapka planned risk. Isse strategy ka real performance samajhna easy hota hai.</p></div></div><div class="r-metrics"><div><span>1R</span><strong>${money(Number(r.account)*Number(r.riskPct)/100)}</strong><small>Planned loss</small></div><div><span>2R</span><strong>${money(Number(r.account)*Number(r.riskPct)*2/100)}</strong><small>2R winner</small></div><div><span>3R</span><strong>${money(Number(r.account)*Number(r.riskPct)*3/100)}</strong><small>3R winner</small></div><div><span>−3R</span><strong>${money(-Number(r.account)*Number(r.riskPct)*3/100)}</strong><small>3 losses worth</small></div></div></section>
  </div>`;
}
function updateRiskCalculator(){
  const account=riskNum('#risk-account-calc',Number(STATE.riskSettings.account)||0), pct=riskNum('#risk-pct-calc',Number(STATE.riskSettings.riskPct)||1), entry=riskNum('#risk-entry',NaN), sl=riskNum('#risk-sl',NaN), target=riskNum('#risk-target',NaN), pv=riskNum('#risk-point-value',1)||1;
  const valid=v=>Number.isFinite(v)&&v>0;
  const hasEntry=valid(entry), hasSL=valid(sl), hasTarget=valid(target);
  const maxRisk=account*pct/100;
  const riskPerUnit=(hasEntry&&hasSL)?Math.abs(entry-sl)*pv:NaN;
  const rawSize=riskPerUnit>0?maxRisk/riskPerUnit:NaN;
  const size=Number.isFinite(rawSize)?Math.floor(rawSize):NaN; // whole units/lots only — never round risk UP
  const actualRisk=Number.isFinite(size)?size*riskPerUnit:NaN;
  const direction=(hasEntry&&hasSL&&entry!==sl)?(entry>sl?'LONG':'SHORT'):null;
  const wrongSide=!!(direction&&hasTarget&&((direction==='LONG'&&target<=entry)||(direction==='SHORT'&&target>=entry)));
  const reward=(hasTarget&&hasEntry&&!wrongSide)?Math.abs(target-entry)*pv:NaN;
  const profit=Number.isFinite(reward)&&Number.isFinite(size)?reward*size:NaN;
  const rr=(Number.isFinite(reward)&&riskPerUnit>0)?reward/riskPerUnit:NaN;
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  set('#risk-max-loss',Number.isFinite(maxRisk)?money(-maxRisk):'—'); set('#risk-per-unit',Number.isFinite(riskPerUnit)?money(-riskPerUnit):'—'); set('#risk-position-size',Number.isFinite(size)?String(size):'—'); set('#risk-profit',Number.isFinite(profit)?money(profit):'—'); set('#risk-rr',Number.isFinite(rr)?`1 : ${rr.toFixed(2)}`:'—');
  const gate=$('#risk-gate-sl'); if(gate){ const ok=hasEntry&&hasSL&&entry!==sl; gate.className='risk-gate-item '+(ok?'good':'warn'); gate.querySelector('span').textContent=ok?'🟢':'🟡'; gate.querySelector('small').textContent=ok?`${direction} · SL ${sl} defined`:'Calculator mein SL define karo'; }
  const msg=$('#risk-calc-message'); if(!msg) return; msg.className='risk-calc-message';
  if(!hasEntry||!hasSL||entry===sl){ msg.textContent='Entry + SL + Target bharo — calculator ready hai.'; return; }
  if(wrongSide){ msg.classList.add('warn'); msg.textContent=`⚠️ Target galat side par hai — ${direction} trade (SL ${direction==='LONG'?'neeche':'upar'}) mein target entry ke ${direction==='LONG'?'upar':'neeche'} hona chahiye.`; return; }
  if(Number.isFinite(size)&&size<1){ msg.classList.add('warn'); msg.textContent=`⚠️ Itne risk mein 1 unit bhi nahi aata — SL bahut door hai ya risk % kam hai (1 unit ka risk ${money(-riskPerUnit)}).`; return; }
  if(!hasTarget){ msg.textContent=`Position size ${size} — actual risk ${money(-actualRisk)}. Target bharo R:R check karne ke liye.`; return; }
  if(Number.isFinite(rr) && rr<Number(STATE.riskSettings.minRR||2)){ msg.classList.add('warn'); msg.textContent=`⚠️ R:R ${rr.toFixed(2)} hai — aapka minimum rule 1:${STATE.riskSettings.minRR} hai.`; return; }
  msg.classList.add('good'); msg.textContent=`🟢 Within calculator rules — position size ${size}, actual risk ${money(-actualRisk)} (max ${money(-maxRisk)}).`;
}
function bindRiskSettings(){
  const map={ '#risk-setting-account':'account','#risk-setting-risk':'riskPct','#risk-setting-daily':'dailyLossPct','#risk-setting-weekly':'weeklyLossPct','#risk-setting-trades':'maxTrades','#risk-setting-streak':'maxLossStreak','#risk-setting-rr':'minRR' };
  Object.entries(map).forEach(([sel,key])=>{const el=$(sel);if(el)el.addEventListener('input',()=>{const v=Number(el.value);if(Number.isFinite(v)&&v>0){STATE.riskSettings[key]=v;riskSaveSettings();}});});
  $('#risk-setting-currency')?.addEventListener('change',e=>{ STATE.riskSettings.currency=e.target.value; riskSaveSettings(); render(); });
  ['#risk-account-calc','#risk-pct-calc','#risk-entry','#risk-sl','#risk-target','#risk-point-value'].forEach(sel=>$(sel)?.addEventListener('input',updateRiskCalculator));
}

function filteredHistoryTrades(){
  return STATE.trades.filter(t =>
    (STATE.historyStrategyFilter==='ALL' || tradeStrategyName(t)===STATE.historyStrategyFilter) &&
    (STATE.historyMistakeFilter==='ALL' || (t.mistake || 'none')===STATE.historyMistakeFilter) &&
    (!STATE.historyDateFilter || tradeLocalDate(t)===STATE.historyDateFilter) &&
    (!STATE.historySearch || [t.symbol,t.notes,t.exitReason,tradeStrategyName(t),emotionText(t),mistakeLabel(t.mistake||'none')].join(' ').toLowerCase().includes(STATE.historySearch.toLowerCase()))
  ).sort((a,b)=>tradeSortTime(b)-tradeSortTime(a));
}
function strategyPerformance(){
  const groups = {};
  STATE.trades.forEach(t => {
    const name = tradeStrategyName(t);
    if (!groups[name]) groups[name] = {name, trades:0, wins:0, pnl:0, r:0, losses:0, followed:0};
    const g=groups[name]; g.trades++; g.pnl += Number(t.pnl)||0; g.r += Number(t.rr)||0;
    if ((Number(t.pnl)||0)>0) g.wins++; else if ((Number(t.pnl)||0)<0) g.losses++;
    if (t.followedPlan) g.followed++;
  });
  return Object.values(groups).map(g=>({...g, winRate:g.trades?Math.round(g.wins/g.trades*100):0, avgR:g.trades?(g.r/g.trades).toFixed(2):'0.00', discipline:g.trades?Math.round(g.followed/g.trades*100):0})).sort((a,b)=>b.pnl-a.pnl);
}
function formatTradeTime(t){
  const raw=tradeDateTimeRaw(t); if(!raw) return '';
  const d=new Date(raw); if(Number.isNaN(d.getTime())) return String(raw);
  return hasTradeTime(t)
    ? d.toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})
    : d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
function tradeTimeInputValue(t){
  const raw=String(tradeDateTimeRaw(t)||'');
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw+'T09:15';
  const d=new Date(raw); return Number.isNaN(d.getTime()) ? '' : localDateTimeInputValue(d);
}
function isOpenTrade(t){ return t.exitPrice===null || t.exitPrice===undefined || t.exitPrice===''; }
function mistakeLabel(id){ return MISTAKE_OPTIONS.find(x=>x[0]===id)?.[1] || id || 'No mistake'; }
function plannedVsActual(t){
  const pe = t.plannedEntry ?? t.entryPrice;
  const ps = t.plannedSL ?? t.stopLoss;
  const pt = t.plannedTP ?? t.takeProfit;
  const pr = t.plannedRR ?? null;
  return {pe,ps,pt,pr};
}
function strategyPastExecutions(strategyName){
  const matches = STATE.trades.filter(t => tradeStrategyName(t) === strategyName);
  return {
    winning: matches.filter(t => (Number(t.pnl)||0) > 0),
    losing: matches.filter(t => (Number(t.pnl)||0) < 0)
  };
}

/* ---------------- computed stats ---------------- */
function computeStats(){
  const trades = STATE.trades;
  if (!trades.length) return { totalTrades:0, winRate:0, disciplineScore:100, level:1, setupPnL:0, tukkaPnL:0, deskPnL:0, mobilePnL:0, setupCount:0, tukkaCount:0, deskCount:0, mobileCount:0 };
  const wins = trades.filter(t=>t.pnl>0);
  const setupTrades = trades.filter(t=>t.isSetupTrade);
  const tukkaTrades = trades.filter(t=>!t.isSetupTrade);
  const deskTrades = trades.filter(t=>t.location==='Desk' && t.device==='Laptop');
  const mobileTrades = trades.filter(t=>t.location!=='Desk' || t.device==='Mobile');
  const followedCount = trades.filter(t=>t.followedPlan).length;
  const totalXP = trades.reduce((a,t)=>a+(t.xpEarned||50),0) + 200;
  return {
    totalTrades: trades.length,
    winRate: Math.round((wins.length/trades.length)*100),
    disciplineScore: Math.round((followedCount/trades.length)*100),
    level: Math.floor(totalXP/350)+1,
    setupPnL: setupTrades.reduce((a,t)=>a+t.pnl,0), tukkaPnL: tukkaTrades.reduce((a,t)=>a+t.pnl,0),
    deskPnL: deskTrades.reduce((a,t)=>a+t.pnl,0), mobilePnL: mobileTrades.reduce((a,t)=>a+t.pnl,0),
    setupCount: setupTrades.length, tukkaCount: tukkaTrades.length, deskCount: deskTrades.length, mobileCount: mobileTrades.length
  };
}
function computeBattery(){
  const m = findMindset(STATE.selectedMindsetId);
  const energyBonus = (STATE.energyLevel-50)*0.2;
  const noisePenalty = STATE.noiseLevel*0.25;
  return Math.min(100, Math.max(5, Math.round(m.battery + energyBonus - noisePenalty)));
}
function computeTrafficLight(score){
  if (score>=70) return {cls:'green', title:'🟢 GREEN LIGHT — Full Focus Cleared', msg:'Mindset balanced hai! Pre-flight rules verify karke trades execute karo.'};
  if (score>=40) return {cls:'yellow', title:'🟡 YELLOW CAUTION — Partial Focus Detected', msg:'Mind fully aligned nahi hai. Risk 50% reduce drop karke trade karo!'};
  return {cls:'red', title:'🔴 RED STOP LIGHT — Tilt / High Risk', msg:'STOP! Revenge or emotional state active. Close charts and take a break!'};
}

/* ---------------- header ---------------- */
function renderHeader(){
  const s = computeStats();
  $('#stat-level').textContent = `Lvl ${s.level}`;
  $('#stat-discipline').textContent = `${s.disciplineScore}% Rules`;
  $('#user-name').textContent = STATE.user.name || STATE.user.email;
}

/* ---------------- tab nav ---------------- */
const TABS = [
  {id:'copilot', label:'⚡ Live Execution Co-Pilot'},
  {id:'log', label:'📝 Log Trade & Chart Screenshot'},
  {id:'notes', label:'🧾 Notes & Learnings'},
  {id:'history', label:'📜 Trade History Log'},
  {id:'analysis', label:'📊 Daily & Session Analysis'},
  {id:'risk', label:'🛡️ Risk Center'}
];
function renderTabNav(){
  $('#tab-nav').innerHTML = TABS.map(t =>
    `<button class="tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  try { placeTabIndicator(); } catch (e) { console.warn('indicator skipped', e); }
  const mobileIcons = {copilot:'⚡',log:'➕',notes:'🧠',history:'📜',analysis:'📊',risk:'🛡️'};
  const mobileLabels = {copilot:'Co-Pilot',log:'Log Trade',notes:'Notes',history:'History',analysis:'Analysis',risk:'Risk'};
  const mobile = $('#mobile-tab-nav');
  if (mobile) mobile.innerHTML = TABS.map(t =>
    `<button class="mobile-tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}"><span class="mobile-tab-icon">${mobileIcons[t.id]}</span><span>${mobileLabels[t.id]}</span></button>`
  ).join('');
}

/* ---------------- Co-Pilot tab ---------------- */
function renderCopilotTab(){
  const trades = [...STATE.trades].sort((a,b)=>tradeSortTime(a)-tradeSortTime(b));
  const total = trades.length;
  const wins = trades.filter(t => Number(t.pnl||0) > 0).length;
  const losses = trades.filter(t => Number(t.pnl||0) < 0).length;
  const pnl = trades.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const avgR = total ? trades.reduce((a,t)=>a+(Number(t.rr)||0),0)/total : 0;
  const followed = trades.filter(t=>t.followedPlan).length;
  const ruleRate = total ? Math.round(followed/total*100) : 0;
  const avgQuality = total ? trades.reduce((a,t)=>a+(Number(t.quality)||0),0)/total : 0;
  const best = total ? Math.max(...trades.map(t=>Number(t.pnl)||0)) : 0;
  const worst = total ? Math.min(...trades.map(t=>Number(t.pnl)||0)) : 0;
  const recent = [...trades].reverse().slice(0,6);
  const risk = currentRiskStats();
  const budgetUsedPct = risk.dailyLimit>0 ? Math.min(100, Math.max(0,-risk.todayPnl)/risk.dailyLimit*100) : 0;
  const hour = new Date().getHours();
  const firstName = String(STATE.user?.name || '').trim().split(/\s+/)[0] || 'Trader';
  const heroGreeting = `${hour<12?'Good morning':hour<17?'Good afternoon':'Good evening'}, ${firstName}`;
  const perf = strategyPerformance().slice(0,6);
  const mistakes = {};
  trades.forEach(t => { const k=t.mistake||'none'; mistakes[k]=(mistakes[k]||0)+1; });
  const topMistakes = Object.entries(mistakes).filter(([k])=>k!=='none').sort((a,b)=>b[1]-a[1]).slice(0,4);
  let running=0;
  const curve = trades.map(t=>{ running += Number(t.pnl)||0; return running; });
  const curveMin = curve.length ? Math.min(0,...curve) : 0;
  const curveMax = curve.length ? Math.max(0,...curve) : 1;
  const curveRange = Math.max(1, curveMax-curveMin);
  const curveSvg = curve.length >= 1 ? (()=>{
    const w=700,h=190,pad=18;
    const pts=curve.map((v,i)=>{
      const x=pad+(curve.length===1?(w-2*pad)/2:i*(w-2*pad)/Math.max(1,curve.length-1));
      const y=h-pad-((v-curveMin)/curveRange)*(h-2*pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const zeroY=h-pad-((0-curveMin)/curveRange)*(h-2*pad);
    const ptList=pts.split(' '), first=ptList[0].split(','), last=ptList[ptList.length-1].split(',');
    const area=`${first[0]},${zeroY.toFixed(1)} ${pts} ${last[0]},${zeroY.toFixed(1)}`;
    return `<svg class="equity-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Equity curve, current ${esc(money(curve[curve.length-1]))}"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2D5287" stop-opacity=".22"/><stop offset="1" stop-color="#2D5287" stop-opacity="0"/></linearGradient></defs><line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${w-pad}" y2="${zeroY.toFixed(1)}" class="equity-zero"></line><polygon points="${area}" class="equity-area"></polygon><polyline points="${pts}" class="equity-line" fill="none" pathLength="1"></polyline><circle cx="${last[0]}" cy="${last[1]}" r="9" class="equity-dot-ring"></circle><circle cx="${last[0]}" cy="${last[1]}" r="6" class="equity-dot"></circle></svg>`;
  })() : '<div class="dashboard-empty-chart">Save a few trades to see your equity curve.</div>';

  return `
  <section class="dashboard-hero dashboard-hero-ink">
    <div class="hero-copy">
      <span class="hero-greeting">${esc(heroGreeting)}</span>
      <h2 class="hero-title">Your trading, in numbers.</h2>
      <p>Yahan sirf woh data hai jo tumhari trading improve karne mein directly help karega.</p>
    </div>
    <div class="hero-today">
      <span>Aaj ka P&amp;L</span>
      <strong class="${risk.todayPnl>=0?'positive':'negative'}">${money(risk.todayPnl)}</strong>
      <small>${risk.todayTrades.length} trade${risk.todayTrades.length===1?'':'s'} aaj · loss budget ${risk.dailyLimit>0?`${Math.round(budgetUsedPct)}% used`:'set nahi hai'}</small>
      ${risk.dailyLimit>0?`<div class="hero-budget" aria-hidden="true"><i class="${budgetUsedPct>=75?'hot':''}" style="width:${Math.max(2,budgetUsedPct)}%"></i></div>`:''}
    </div>
    <button class="btn-cta" data-action="set-tab" data-tab="log">＋ Log New Trade</button>
  </section>

  <div class="dashboard-kpis">
    <div class="card dashboard-kpi"><span class="uppercase-label">Total Trades</span><strong>${total}</strong><small>${wins} wins · ${losses} losses</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Net P&amp;L</span><strong class="${pnl>=0?'positive':'negative'}">${money(pnl)}</strong><small>All recorded trades</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Win Rate</span><strong>${total?Math.round(wins/total*100):0}%</strong><small>${wins} profitable trades</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Average R</span><strong>${avgR.toFixed(2)}R</strong><small>Per trade</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Rule Following</span><strong>${ruleRate}%</strong><small>${followed}/${total||0} trades followed plan</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Avg Quality</span><strong>${avgQuality.toFixed(1)}/5</strong><small>Self-rated execution</small></div>
  </div>

  ${renderSetupPlaybook()}

  <div class="grid-2 dashboard-main-grid">
    <div class="card">
      <div class="dashboard-section-head"><div><span class="uppercase-label">PERFORMANCE</span><h3 class="section-title">Equity Curve</h3></div><span class="dashboard-stat-note">Best ${money(best)} · Worst ${money(worst)}</span></div>
      ${curveSvg}
      <div class="equity-footer"><span>Start ${currencySymbol()}0</span><strong class="${pnl>=0?'positive':'negative'}">Current ${money(pnl)}</strong></div>
    </div>

    <div class="card">
      <div class="dashboard-section-head"><div><span class="uppercase-label">STRATEGIES</span><h3 class="section-title">Strategy Performance</h3></div><button class="btn-secondary btn-small" data-action="set-tab" data-tab="history">View History</button></div>
      ${perf.length ? `<div class="dashboard-table">${perf.map(g=>`<div class="dashboard-table-row"><div><strong>${esc(g.name)}</strong><small>${g.trades} trades · ${g.discipline}% rules</small></div><span>${g.winRate}% WR</span><strong class="${g.pnl>=0?'positive':'negative'}">${money(g.pnl)}</strong></div>`).join('')}</div>` : '<div class="dashboard-empty">Abhi strategy-wise data nahi hai. Notes → ADD STRATEGY se strategy banao, phir trade log mein select karo.</div>'}
    </div>
  </div>

  <div class="grid-2 dashboard-main-grid">
    <div class="card">
      <div class="dashboard-section-head"><div><span class="uppercase-label">EXECUTION QUALITY</span><h3 class="section-title">Mistakes to Avoid</h3></div><button class="btn-secondary btn-small" data-action="set-tab" data-tab="history">Review History</button></div>
      ${topMistakes.length ? `<div class="mistake-bars">${topMistakes.map(([k,n])=>{const pct=Math.round(n/Math.max(1,total)*100); return `<div class="mistake-bar-row"><div><span>${esc(mistakeLabel(k))}</span><strong>${n}</strong></div><div class="mistake-track"><span style="width:${pct}%"></span></div></div>`}).join('')}</div>` : '<div class="dashboard-empty">No repeated mistake pattern yet. Keep logging honestly.</div>'}
      <div class="dashboard-mini-stats"><div><span>Best Trade</span><strong class="positive">${money(best)}</strong></div><div><span>Worst Trade</span><strong class="negative">${money(worst)}</strong></div></div>
    </div>

    <div class="card">
      <div class="dashboard-section-head"><div><span class="uppercase-label">TRADE OUTCOMES</span><h3 class="section-title">Winning & Losing Trades</h3></div><button class="btn-secondary btn-small" data-action="set-tab" data-tab="history">Open History</button></div>
      <div class="dashboard-outcome-grid">
        <div class="dashboard-outcome-card winning"><span>🏆 Winning Trades</span><strong>${wins}</strong><small>${total ? Math.round(wins/total*100) : 0}% of all trades</small></div>
        <div class="dashboard-outcome-card losing"><span>📉 Losing Trades</span><strong>${losses}</strong><small>${total ? Math.round(losses/total*100) : 0}% of all trades</small></div>
      </div>
      <div class="dashboard-winloss-list">
        <div><span class="uppercase-label">RECENT WINS</span>${trades.filter(t=>Number(t.pnl)>0).slice(-3).reverse().map(t=>`<div class="dashboard-mini-trade"><strong>${esc(t.symbol||'—')}</strong><span class="positive">${money(Number(t.pnl)||0)}</span></div>`).join('') || '<div class="dashboard-empty">No winning trades yet.</div>'}</div>
        <div><span class="uppercase-label">RECENT LOSSES</span>${trades.filter(t=>Number(t.pnl)<0).slice(-3).reverse().map(t=>`<div class="dashboard-mini-trade"><strong>${esc(t.symbol||'—')}</strong><span class="negative">${money(Number(t.pnl)||0)}</span></div>`).join('') || '<div class="dashboard-empty">No losing trades yet.</div>'}</div>
      </div>
      ${recent.length ? `<div class="recent-trades" style="margin-top:.75rem;">${recent.slice(0,4).map(t=>`<div class="recent-trade-row"><div><strong>${esc(t.symbol||'—')}</strong><small>${esc(t.type||'—')} · ${esc(emotionText(t))}</small></div><span class="recent-trade-result ${Number(t.pnl)>=0?'positive':'negative'}">${money(Number(t.pnl)||0)}</span></div>`).join('')}</div>` : '<div class="dashboard-empty">No trades yet. Your first logged trade will appear here.</div>'}
    </div>
  </div>

  <div class="card dashboard-insight">
    <div><span class="uppercase-label">JOURNAL INSIGHT</span><h3 class="section-title">What should you improve?</h3></div>
    <p>${!total ? 'Start by logging your trades. After 10–20 trades, this dashboard will reveal your real patterns.' : ruleRate < 70 ? `Your rule-following is ${ruleRate}%. Review the trades where you broke your plan before taking the next setup.` : avgR < 0 ? 'Your average R is negative. Review your losing trades and compare planned vs actual entries, exits and stop-losses.' : `Your current journal shows ${wins} wins from ${total} trades with ${ruleRate}% rule-following. Keep focusing on repeatable execution rather than individual outcomes.`}</p>
  </div>`;
}

/* ---------------- Log Trade tab ---------------- */
function computeLogPreview(){
  const entry = parseFloat($('#log-entry')?.value)||0, exit = parseFloat($('#log-exit')?.value)||0;
  const qty = parseFloat($('#log-qty')?.value)||0, sl = parseFloat($('#log-sl')?.value)||0;
  const type = $('#log-type')?.value || 'LONG';
  if (!entry || !exit || !qty) return { pnl:0, rr:0, xp: STATE.logFormIsSetup?100:20 };
  let pnl = type==='LONG' ? (exit-entry)*qty : (entry-exit)*qty;
  let rr = 0;
  if (sl && entry!==sl) { rr = Math.abs(exit-entry)/Math.abs(entry-sl); if (pnl<0) rr = -rr; }
  let xp = STATE.logFormIsSetup ? 100 : 20;
  if (STATE.logFormLocation==='Desk' && STATE.logFormDevice==='Laptop') xp += 20;
  if ((STATE.logFormImages||[]).length || STATE.logFormBeforeImage || STATE.logFormAfterImage || STATE.logFormImage) xp += 30;
  return { pnl: Math.round(pnl*100)/100, rr: Math.round(rr*100)/100, xp };
}
function updateLogPreview(){
  const p = computeLogPreview();
  const badge = $('#log-xp-badge');
  if (badge) badge.textContent = `+${p.xp} XP`;
}
function currentLogImages(){
  const arr = Array.isArray(STATE.logFormImages) ? STATE.logFormImages.filter(Boolean) : [];
  [STATE.logFormBeforeImage, STATE.logFormAfterImage, STATE.logFormImage].filter(Boolean).forEach(x=>{ if(!arr.includes(x)) arr.push(x); });
  return arr;
}
function localDateTimeInputValue(d=new Date()){ const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function captureLogDraft(){
  const get = id => $('#'+id)?.value ?? '';
  return {
    symbol:(get('log-symbol') === 'OTHER' ? get('log-custom-symbol') : get('log-symbol')), symbolChoice:get('log-symbol'), customSymbol:get('log-custom-symbol'), type:get('log-type') || 'LONG', qty:get('log-qty'), entry:get('log-entry'), exit:get('log-exit'), sl:get('log-sl'),
    strategy:get('log-strategy-select'), plannedEntry:get('log-planned-entry'), plannedSL:get('log-planned-sl'), plannedTP:get('log-planned-tp'),
    imageUrl:get('log-image-url'), mistake:get('log-mistake'), quality:get('log-quality'), tradeDateTime:get('log-trade-datetime'), exitReason:get('log-exit-reason'), notes:get('log-notes'),
    location:get('log-location-select'), customEmotion:get('log-custom-emotion'), emotions:[...STATE.logEmotions]
  };
}
function restoreLogDraft(draft){
  if(!draft) return;
  const set=(id,val)=>{ const el=$('#'+id); if(el && val!==undefined && val!==null) el.value=val; };
  set('log-symbol',draft.symbolChoice || draft.symbol || 'XAUUSD'); set('log-custom-symbol',draft.customSymbol || (draft.symbolChoice==='OTHER' ? draft.symbol : '')); set('log-type',draft.type); set('log-qty',draft.qty); set('log-entry',draft.entry); set('log-exit',draft.exit); set('log-sl',draft.sl);
  set('log-strategy-select',draft.strategy); set('log-planned-entry',draft.plannedEntry); set('log-planned-sl',draft.plannedSL); set('log-planned-tp',draft.plannedTP);
  set('log-image-url',draft.imageUrl); set('log-mistake',draft.mistake); set('log-quality',draft.quality); set('log-trade-datetime',draft.tradeDateTime || localDateTimeInputValue()); set('log-exit-reason',draft.exitReason); set('log-notes',draft.notes); set('log-location-select',draft.location); set('log-custom-emotion',draft.customEmotion);
  if (Array.isArray(draft.emotions)) STATE.logEmotions = [...draft.emotions];
}
function renderLogImagePreview(){
  const box = $('#log-image-preview');
  if (!box) return;
  const images = currentLogImages();
  box.innerHTML = images.length ? `<div class="multi-image-grid">${images.map((src,i)=>`<div class="multi-image-item"><img src="${esc(imgUrl(src))}" data-action="view-image" data-src="${esc(src)}"><button type="button" data-action="remove-log-image-index" data-index="${i}">×</button><span>Image ${i+1}</span></div>`).join('')}</div><div class="image-count">📸 ${images.length} image${images.length===1?'':'s'} attached</div>` : '<div class="shot-empty">No images added yet</div>';
}
function insertImagesIntoActiveNote(srcs){
  const note=STATE.notes.find(n=>n.id===STATE.activeNoteId); if(!note||!srcs.length) return;
  note.blocks=normalizeNoteBlocks(note);
  let at = Number.isInteger(STATE.noteInsertIndex) ? Math.min(STATE.noteInsertIndex + 1, note.blocks.length) : note.blocks.length;
  srcs.forEach(src=>{
    note.blocks.splice(at, 0, {type:'image', src});
    at += 1;
    if (note.blocks[at]?.type !== 'text') note.blocks.splice(at, 0, {type:'text', text:'', html:''});
    at += 1;
  });
  note.image=note.blocks.find(b=>b.type==='image')?.src || null;
  note.updatedAt=new Date().toISOString();
  STATE.noteInsertIndex = Math.max(0, at-1);
  renderTabOnly();
  scheduleNoteAutoSave(note.id);
  setTimeout(() => { const fields = $$(`[data-live-note-text="${note.id}"]`); fields[Math.min(at-1, fields.length-1)]?.focus(); }, 30);
}
function addLogImages(images){
  const arr=currentLogImages();
  images.filter(Boolean).forEach(src=>{ if(!arr.includes(src) && arr.length < 8) arr.push(src); });
  STATE.logFormImages=arr;
  STATE.logFormBeforeImage=arr[0]||''; STATE.logFormAfterImage=arr[1]||'';
  renderLogImagePreview(); updateLogPreview();
}
function renderLogTab(){
  const strategyOptions = allStrategies().map(p => `<option value="${esc(p.id)}" ${STATE.selectedPlaybookId===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
  return `
  <div class="card log-trade-card">
    <div class="log-head">
      <div>
        <span class="uppercase-label" style="color:var(--indigo); margin-bottom:.15rem;">FAST JOURNAL</span>
        <h2 class="section-title">➕ Log Trade</h2>
        <p class="card-sub">Bas jo important hai woh bharo. Baaki optional hai.</p>
      </div>
      <span class="xp-badge" id="log-xp-badge">+100 XP</span>
    </div>

    <form id="log-form">
      <div class="log-step">
        <div class="log-step-title"><span>1</span><strong>Trade basics</strong></div>
        <div class="field grid-3 log-basic-grid">
          <div><label>Symbol</label><input type="text" id="log-symbol" value="BTC/USDT" placeholder="XAUUSD, NIFTY..."></div>
          <div><label>Direction</label><select id="log-type"><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></div>
          <div><label>Quantity</label><input type="number" step="any" id="log-qty" placeholder="1"></div>
        </div>
        <div class="field grid-3 log-price-grid">
          <div><label>Entry <span class="optional-label">optional</span></label><input type="number" step="any" id="log-entry" placeholder="Entry"></div>
          <div><label>Exit <span class="optional-label">optional</span></label><input type="number" step="any" id="log-exit" placeholder="Exit"></div>
          <div><label>SL <span class="optional-label">optional</span></label><input type="number" step="any" id="log-sl" placeholder="Stop loss"></div>
        </div>
        <div class="field grid-3 fast-journal-time-fields">
          <div><label>Trade Date &amp; Time <span class="optional-label">used for session analysis</span></label><input type="datetime-local" id="log-trade-datetime" value="${esc(localDateTimeInputValue())}"></div>
          <div><label>Exit Reason <span class="optional-label">optional</span></label><input type="text" id="log-exit-reason" placeholder="Target, SL, manual, time, news..."></div>
          <div><label>Quick Note <span class="optional-label">optional</span></label><textarea id="log-notes" rows="2" placeholder="Kya sahi hua? Kya improve karna hai?"></textarea></div>
        </div>

        <div class="fast-journal-emotion">
          <div class="log-emotion-head"><div><div class="log-emotion-title">🧠 Emotion <span>* Required · Multiple allowed</span></div><div class="log-emotion-sub">Ek trade mein multiple emotions select kar sakte ho.</div></div>${STATE.logEmotions.length ? `<span class="emotion-selected-badge">✓ ${esc(STATE.logEmotions.join(' · '))}</span>` : '<span class="emotion-selected-badge empty">Select emotion(s)</span>'}</div>
          <div class="emotion-pills">${[['Calm','😌'],['Confident','💪'],['Neutral','😐'],['Anxious','😰'],['FOMO','🔥'],['Revenge / Tilt','😡'],['Overexcited','🚀'],['Tired','😴']].map(([name,emoji]) => `<button type="button" class="emotion-pill ${STATE.logEmotions.includes(name)?'selected':''}" data-action="set-log-emotion" data-value="${esc(name)}">${emoji} ${esc(name)}</button>`).join('')}</div>
          <div class="custom-emotion-row"><label for="log-custom-emotion">Custom emotion <span>optional</span></label><input type="text" id="log-custom-emotion" value="${esc(STATE.logCustomEmotion)}" placeholder="e.g. bored, impatient..." maxlength="40"><button type="button" aria-label="Add custom emotion" title="Add custom emotion" class="use-custom-emotion ${STATE.logCustomEmotion && STATE.logEmotions.includes(STATE.logCustomEmotion)?'active':''}" data-action="use-custom-emotion">＋</button></div>
        </div>

        <div class="fast-journal-screenshots"><div class="fast-shot-head"><div><strong>📸 Before & After</strong><span>Optional — chart screenshots</span></div></div><div class="before-after-grid">
          <label class="shot-upload-card ${STATE.logFormBeforeImage?'has-image':''}"><div class="shot-label">BEFORE ENTRY</div>${STATE.logFormBeforeImage ? `<img src="${esc(imgUrl(STATE.logFormBeforeImage))}" alt="Before entry">` : `<div class="shot-placeholder">＋<small>Upload before entry</small></div>`}<input type="file" id="log-before-image-file" accept="image/*" style="display:none;"></label>
          <label class="shot-upload-card ${STATE.logFormAfterImage?'has-image':''}"><div class="shot-label">AFTER EXIT</div>${STATE.logFormAfterImage ? `<img src="${esc(imgUrl(STATE.logFormAfterImage))}" alt="After exit">` : `<div class="shot-placeholder">＋<small>Upload after exit</small></div>`}<input type="file" id="log-after-image-file" accept="image/*" style="display:none;"></label>
        </div><div class="image-url-add-row fast-extra-image"><input type="url" id="log-image-url" placeholder="🔗 TradingView / image link paste karo…"><button type="button" class="btn-secondary" data-action="add-log-image-url">+ Add</button></div><div id="log-image-preview"></div></div>
      </div>

      <div class="log-step">
        <div class="log-step-title"><span>2</span><strong>Was this a setup?</strong></div>
        <div class="toggle-group log-setup-toggle">
          <button type="button" class="toggle-btn ${STATE.logFormIsSetup?'active-green':''}" data-action="set-log-setup" data-value="true">🎯 Yes, setup trade</button>
          <button type="button" class="toggle-btn ${!STATE.logFormIsSetup?'active-red':''}" data-action="set-log-setup" data-value="false">⚡ Quick trade</button>
        </div>
        ${STATE.logFormIsSetup ? `<div class="field strategy-select-field log-strategy-mini">
          <label class="log-strategy-label">🎯 Strategy <button type="button" class="pb-link" data-action="open-strategy-manager" ${allStrategies().length?'':'data-new="1"'}>${allStrategies().length?'⚙️ Manage':'＋ Add strategy'}</button></label>
          <select id="log-strategy-select" ${allStrategies().length ? '' : 'disabled'}>${allStrategies().length ? strategyOptions : '<option>No strategy yet</option>'}</select>
        </div>` : ''}
      </div>

      <details class="log-advanced">
        <summary>🎯 Planned Trade <span>Optional — fill only if you had a pre-trade plan</span></summary>
        <div class="log-advanced-body">
          <div class="field grid-3">
            <div><label>Planned Entry</label><input type="number" step="any" id="log-planned-entry" placeholder="Optional"></div>
            <div><label>Planned SL</label><input type="number" step="any" id="log-planned-sl" placeholder="Optional"></div>
            <div><label>Planned Target</label><input type="number" step="any" id="log-planned-tp" placeholder="Optional"></div>
          </div>
          <p class="card-sub">Blank chhodoge to actual Entry/SL ko planned maana jayega.</p>
        </div>
      </details>

      <details class="log-advanced">
        <summary>📝 Review <span>Mistake, quality &amp; notes</span></summary>
        <div class="log-advanced-body">
          <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
            <div><label>Mistake Tag</label><select id="log-mistake">${MISTAKE_OPTIONS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></div>
            <div><label>Trade Quality</label><select id="log-quality"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Good</option><option value="3" selected>★★★ Average</option><option value="2">★★ Poor</option><option value="1">★ Rule Break</option></select></div>
          </div>
        </div>
      </details>

      <details class="log-advanced">
        <summary>⚙️ More details <span>Device &amp; location</span></summary>
        <div class="log-advanced-body">
          <div class="field grid-3" style="grid-template-columns:1fr 1fr; margin-bottom:0;">
            <div><label>Device</label><div class="toggle-group"><button type="button" class="toggle-btn ${STATE.logFormDevice==='Laptop'?'active-indigo':''}" data-action="set-log-device" data-value="Laptop">💻 Laptop</button><button type="button" class="toggle-btn ${STATE.logFormDevice==='Mobile'?'active-red':''}" data-action="set-log-device" data-value="Mobile">📱 Mobile</button></div></div>
            <div><label>Location</label><select id="log-location-select"><option value="Desk" ${STATE.logFormLocation==='Desk'?'selected':''}>🖥️ Trading Desk</option><option value="Couch / Bed" ${STATE.logFormLocation==='Couch / Bed'?'selected':''}>🛋️ Couch / Bed</option><option value="Random / On the Go" ${STATE.logFormLocation==='Random / On the Go'?'selected':''}>🚗 On the Go</option></select></div>
          </div>
        </div>
      </details>

      <div class="log-save-row">
        <span class="log-save-hint">⚡ 20 sec journal</span>
        <button type="submit" class="btn-primary">Save Trade</button>
      </div>
    </form>
  </div>`;
}
/* ---------------- Notes tab ---------------- */
function renderNoteImagePreview(){
  const box = $('#note-image-preview');
  if (!box) return;
  box.innerHTML = STATE.noteFormImage ? `
    <div class="image-preview-row">
      <div style="display:flex; align-items:center; gap:.6rem;"><img src="${esc(imgUrl(STATE.noteFormImage))}"><span style="font-size:.7rem; color:var(--emerald); font-weight:700;">✅ Attached</span></div>
      <button type="button" data-action="remove-note-image" style="background:var(--rose-light); color:var(--rose); border:none; border-radius:.7rem; padding:.35rem .6rem; cursor:pointer;">🗑️</button>
    </div>` : '';
}
function renderStrategyBuilder(){
  return `
    <div class="card strategy-builder-card" style="border:1px solid #c7d2fe; background:linear-gradient(135deg,#eef2ff,#ffffff); margin-bottom:1rem;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:.75rem; flex-wrap:wrap;">
        <div>
          <span class="uppercase-label" style="color:var(--indigo); margin-bottom:.15rem;">🧠 Prepare Strategy According To You</span>
          <h3 class="section-title" style="margin:.1rem 0 .2rem;">➕ Add Strategy</h3>
          <p class="card-sub">Apni strategy ko rules ke saath save karo. Ye Trade Log ke Select Strategy dropdown mein bhi aa jayegi.</p>
        </div>
        <button type="button" class="btn-primary" data-action="toggle-strategy-builder" id="add-strategy-btn">＋ ADD STRATEGY</button>
      </div>
      <div id="strategy-builder-form" style="display:none; margin-top:1rem; padding-top:1rem; border-top:1px solid #dbeafe;">
        <div class="field">
          <label>Strategy Name *</label>
          <input type="text" id="strategy-name" placeholder="e.g. My Opening Range Strategy" maxlength="80">
        </div>
        <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
          <div><label>Entry Criteria</label><textarea id="strategy-entry" rows="3" placeholder="Entry ke liye mandatory conditions..."></textarea></div>
          <div><label>Exit / Invalidation</label><textarea id="strategy-exit" rows="3" placeholder="Target, SL aur invalidation rules..."></textarea></div>
        </div>
        <div class="field">
          <label>Mandatory Rules</label>
          <textarea id="strategy-rules" rows="4" placeholder="Har rule ko new line mein likhein...\nHTF bias aligned hona chahiye\nRisk 1% se zyada nahi\nDisplacement confirmation required"></textarea>
        </div>
        <div style="display:flex; gap:.5rem; justify-content:flex-end; flex-wrap:wrap;">
          <button type="button" class="toggle-btn" data-action="toggle-strategy-builder">Cancel</button>
          <button type="button" class="btn-primary" data-action="save-strategy">💾 Save Strategy</button>
        </div>
      </div>
    </div>`;
}

function renderNotesTab(){
  const notes = STATE.notes || [];
  const noteMatchesFilter = (n) => {
    if (STATE.noteConceptFilter === 'ALL') return true;
    if (STATE.noteConceptFilter === '__custom__') return !!(n.customConcept || n.concept === 'Custom');
    return (n.concept || 'General') === STATE.noteConceptFilter;
  };
  const filteredNotes = notes.filter(noteMatchesFilter);
  if (!filteredNotes.some(n => n.id === STATE.activeNoteId)) STATE.activeNoteId = filteredNotes[0]?.id || null;
  const active = filteredNotes.find(n => n.id === STATE.activeNoteId) || null;
  const noteTabs = [
    {value:'ALL', label:'All'},
    ...NOTE_CONCEPTS.map(c => ({value:c, label:c})),
    {value:'__custom__', label:'Custom'}
  ];

  const renderReading = () => active ? `
    <article class="note-reading-paper note-live-editor samsung-note-editor">
      <div class="note-reading-topline samsung-note-topline">
        <div class="note-live-title-wrap">
          <div class="note-reading-meta">${esc(active.customConcept || active.concept || 'General')}${active.strategy ? ` <span>•</span> ${esc(active.strategy)}` : ''}</div>
          <input class="note-live-title" data-note-editor-title="${active.id}" value="${esc(active.title || active.symbol || 'Untitled Note')}" placeholder="Note title…">
          <div class="note-reading-date">${new Date(active.date || Date.now()).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}</div>
        </div>
        <div class="note-live-actions">
          <span class="note-save-status" data-note-save-status>✓ Saved</span>
          <button type="button" class="note-plus-btn" data-action="toggle-note-plus" title="Add to note">＋</button>
          <button type="button" class="item-delete note-reading-delete" data-action="delete-note" data-id="${active.id}" title="Delete note">🗑️</button>
        </div>
      </div>

      <div class="note-plus-menu" id="note-plus-menu" style="display:none">
        <button type="button" class="btn-secondary" data-action="add-live-text-block">＋ Text</button>
        <button type="button" class="btn-secondary" data-action="trigger-live-image">🖼️ Images</button>
        <input type="file" id="live-note-image-file" accept="image/*" multiple hidden>
        <div class="note-link-row"><input type="url" id="live-note-image-link" placeholder="🔗 TradingView / image link paste karo…" enterkeyhint="done"><button type="button" class="btn-primary btn-small" data-action="add-live-image-link">Add</button></div>
      </div>

      <div class="samsung-note-meta-row">
        <label class="samsung-note-concept"><span>CONCEPT</span><select data-note-editor-concept="${active.id}">${NOTE_CONCEPTS.map(c=>`<option value="${esc(c)}" ${(active.concept||'General')===c && !active.customConcept?'selected':''}>${esc(c)}</option>`).join('')}<option value="__custom__" ${active.customConcept?'selected':''}>Custom</option></select></label>
        <label class="samsung-note-strategy"><span>STRATEGY</span><select data-note-editor-strategy="${active.id}">${noteStrategyOptions(active.strategy)}</select></label>
      </div>

      <div class="samsung-note-page">
        ${normalizeNoteBlocks(active).map((b,i)=> b.type==='image' ? `
          <div class="note-live-block image samsung-note-image-block">
            <div class="note-live-image-wrap">
              <img src="${esc(imgUrl(b.src))}" data-action="open-note-block-annotator" data-note-id="${active.id}" data-index="${i}" alt="Note image">
              <button type="button" class="note-block-remove-floating" data-action="remove-live-note-block" data-note-id="${active.id}" data-index="${i}" title="Remove image">×</button>
              <button type="button" class="note-draw-floating" data-action="open-note-block-annotator" data-note-id="${active.id}" data-index="${i}">✍️ Draw</button>
            </div>
          </div>` : `
          <div class="note-live-block text samsung-note-text-block">
            <div class="note-text-toolbar" role="toolbar" aria-label="Text formatting">
              <button type="button" class="note-format-btn" data-note-format="bold" title="Bold"><strong>B</strong></button>
              <select class="note-font-size" data-note-font-size aria-label="Text size"><option value="14px">14</option><option value="16px" selected>16</option><option value="18px">18</option><option value="22px">22</option><option value="28px">28</option></select>
              <button type="button" class="note-format-btn note-highlight-btn" data-note-format="highlight" title="Highlight selected text">🖍️</button>
              <button type="button" class="note-format-btn" data-note-format="clear-format" title="Clear formatting">Tx</button>
            </div>
            <div class="note-live-editor-text" contenteditable="true" spellcheck="true" data-live-note-text="${active.id}" data-index="${i}" data-placeholder="Write something…">${b.html||''}</div>
            <button type="button" class="note-text-remove" data-action="remove-live-note-block" data-note-id="${active.id}" data-index="${i}" title="Remove text">×</button>
          </div>`).join('')}
        ${!normalizeNoteBlocks(active).length ? `<div class="samsung-note-empty-page">Yahan seedha likhna shuru karein, ya <strong>＋</strong> se image/text add karein.</div>` : ''}
      </div>

      <div class="samsung-note-bottom-add">
        <button type="button" class="samsung-add-button" data-action="toggle-note-plus">＋ Add</button>
        <span>Changes automatically save hote hain</span>
      </div>
    </article>` : `
    <div class="note-reading-empty samsung-note-empty">
      <div class="note-reading-empty-icon">📝</div>
      <h3>Open a note</h3>
      <p>Left side se note select karein, ya neeche <strong>＋ New Note</strong> se naya notebook page banayein.</p>
    </div>`;

  return `
  <div class="notes-workspace samsung-notes-workspace">
    <div class="notes-library-header">
      <div>
        <span class="uppercase-label">LEARNING LIBRARY</span>
        <h2 class="section-title">📝 Notes</h2>
        <p class="card-sub">Ek clean notebook — text, screenshots aur drawings ek hi page par.</p>
      </div>
      <button type="button" class="btn-primary" data-action="create-note">＋ New Note</button>
    </div>

    <div class="notes-concept-tabs samsung-concept-tabs">
      ${noteTabs.map(t=>`<button type="button" class="note-concept-tab ${STATE.noteConceptFilter===t.value?'active':''}" data-action="filter-note-concept" data-concept="${esc(t.value)}">${esc(t.label)} <span>${notes.filter(n=>t.value==='ALL'?true:t.value==='__custom__'?(n.customConcept||n.concept==='Custom'):(n.concept||'General')===t.value).length}</span></button>`).join('')}
    </div>

    <div class="notes-samsung-layout">
      <aside class="notes-list-panel card">
        <div class="notes-list-head"><strong>${filteredNotes.length} note${filteredNotes.length===1?'':'s'}</strong><span>Auto-saved</span></div>
        <div class="notes-list-items">
          ${filteredNotes.length ? filteredNotes.map(n=>{
            const blocks=normalizeNoteBlocks(n), preview=(blocks.find(b=>b.type==='text')?.text || n.learning || n.analysis || 'No text yet').trim();
            const imageCount=blocks.filter(b=>b.type==='image').length;
            return `<button type="button" class="note-list-item ${STATE.activeNoteId===n.id?'active':''}" data-action="select-note" data-id="${n.id}">
              <span class="note-list-title">${esc(n.title || n.symbol || 'Untitled Note')}</span>
              <span class="note-list-preview">${esc(preview.slice(0,110))}</span>
              <span class="note-list-meta">${esc(n.customConcept || n.concept || 'General')}${imageCount?` · 🖼️ ${imageCount}`:''} · ${new Date(n.updatedAt || n.date || Date.now()).toLocaleDateString(undefined,{day:'numeric',month:'short'})}</span>
            </button>`;
          }).join('') : `<div class="notes-list-empty">No notes in this concept.<br><button type="button" class="btn-secondary" data-action="create-note" style="margin-top:.7rem">＋ Create Note</button></div>`}
        </div>
      </aside>
      <section class="note-reading-panel">${renderReading()}</section>
    </div>
  </div>`;
}

function tradeImages(t){
  const imgs = Array.isArray(t.images) && t.images.length ? t.images : [t.beforeImage, t.afterImage, t.image].filter(Boolean);
  return [...new Set(imgs.filter(Boolean))];
}
function historyViewButton(id, icon, label){
  return `<button type="button" class="history-view-btn ${STATE.historyView===id?'active':''}" data-action="history-view" data-view="${id}">${icon}<span>${label}</span></button>`;
}
function renderTradeView(t, mode){
  const pv=plannedVsActual(t), imgs=tradeImages(t);
  const pnl=Number(t.pnl)||0, rr=t.rr ?? '—', open=isOpenTrade(t);
  const resultClass=open?'':(pnl>=0?'positive':'negative');
  const resultHtml=open?`<div class="history-detail-result open-trade">Open<small>no exit yet</small></div>`:`<div class="history-detail-result ${resultClass}">${money(pnl)}<small>${esc(String(rr))} R</small></div>`;
  const when=esc(formatTradeTime(t));
  const strategy=esc(tradeStrategyName(t));
  const meta=`${esc(t.symbol||'—')} • ${esc(t.type||'—')}`;
  const chips=`<div class="history-chips"><span class="journal-chip">🧠 ${esc(emotionText(t))}</span><span class="journal-chip ${t.mistake&&t.mistake!=='none'?'chip-warn':''}">📝 ${esc(mistakeLabel(t.mistake||'none'))}</span><span class="journal-chip">⭐ ${t.quality||3}/5</span>${t.exitReason?`<span class="journal-chip">🚪 ${esc(t.exitReason)}</span>`:''}</div>`;
  const quickNote = t.notes ? `<p class="history-quick-note" title="${esc(t.notes)}"><span>Note</span>${esc(t.notes)}</p>` : '';
  const actions=`<div class="trade-actions"><button type="button" class="btn-secondary trade-edit-btn" data-action="edit-trade" data-id="${esc(t.id)}">✏️ Edit</button><button type="button" class="btn-danger trade-delete-btn" data-action="delete-trade" data-id="${esc(t.id)}" title="Delete trade">🗑️ Delete</button></div>`;
  const shots = imgs.length ? `<div class="history-images">${imgs.map((src,i)=>`<div class="history-image"><img src="${esc(imgUrl(src))}" data-action="view-image" data-trade-id="${esc(t.id)}" data-src="${esc(src)}" loading="lazy"><span>${i===0?'Before':i===1?'After':`Image ${i+1}`}</span></div>`).join('')}</div>` : `<div class="history-no-images">🖼 No screenshots</div>`;
  if(mode==='list') return `<div class="history-list-row"><div class="history-list-main"><div class="history-symbol">${meta}</div><span class="history-date">${when} · ${strategy}</span>${t.notes?`<span class="history-list-note">📝 ${esc(t.notes)}</span>`:''}</div><div class="history-list-stat">${pv.pe??'—'} → ${t.exitPrice??'—'}</div><div class="history-list-stat">${esc(emotionText(t))}</div><div class="history-list-stat ${resultClass} mono">${open?'Open':money(pnl)}</div><div>${actions}</div></div>`;
  if(mode==='detailed') return `<article class="history-detail-card"><div class="history-detail-head"><div><span class="history-kicker">TRADE JOURNAL</span><h3>${meta}</h3><p>${when} · ${strategy}${t.isSetupTrade===false?'':` · ${t.followedPlan?'✅ Plan followed':'⚠️ Plan broken'}`}</p></div>${resultHtml}${actions}</div>${chips}<div class="history-detail-grid"><div><span>PLANNED</span><strong>Entry ${pv.pe??'—'} • SL ${pv.ps??'—'} • Target ${pv.pt??'—'} • R:R ${pv.prr??'—'}</strong></div><div><span>ACTUAL</span><strong>Entry ${t.entryPrice??'—'} • SL ${t.stopLoss??'—'} • Exit ${t.exitPrice??'—'}</strong></div><div><span>EXIT REASON</span><strong>${esc(t.exitReason||'—')}</strong></div><div><span>LOT SIZE</span><strong>${esc(t.quantity??'—')}</strong></div><div><span>WHERE</span><strong>${esc([t.device,t.location].filter(Boolean).join(' @ ')||'—')}</strong></div></div><p class="history-note">${t.notes?esc(t.notes):'<em>Koi note nahi — Edit se add karo.</em>'}</p>${shots}</article>`;
  if(mode==='gallery') return `<article class="history-gallery-card"><div class="history-gallery-head"><div><h3>${meta}</h3><p>${when} · ${strategy}</p></div>${resultHtml}${actions}</div>${shots}<div class="history-gallery-meta">${chips}${quickNote}</div></article>`;
  return `<article class="history-grid-card"><div class="history-grid-media">${imgs[0]?`<img src="${esc(imgUrl(imgs[0]))}" data-action="view-image" data-trade-id="${esc(t.id)}" data-src="${esc(imgs[0])}" loading="lazy">`:`<div class="history-grid-placeholder">📈</div>`}<span class="${t.type==='LONG'?'badge-long':'badge-short'}">${esc(t.type||'—')}</span></div><div class="history-grid-body"><div class="history-grid-top"><div><h3>${esc(t.symbol||'—')}</h3><p>${strategy}</p><p class="history-when">${when}</p></div>${resultHtml}</div>${chips}${quickNote}<div class="history-mini-stats"><span>Entry <b>${t.entryPrice??'—'}</b></span><span>Exit <b>${t.exitPrice??'—'}</b></span><span>SL <b>${t.stopLoss??'—'}</b></span><span>Lot Size <b>${t.quantity??'—'}</b></span></div><div class="history-card-actions">${actions}</div></div></article>`;
}
function renderHistoryTab(){
  const all = STATE.trades;
  const s = computeStats();
  const realityBlock = `
    <section class="history-reality">
      <div class="history-heading"><div><span class="uppercase-label">REALITY CHECK</span><h2 class="section-title">Trading Reality</h2><p class="card-sub">Rules-based trades aur random trades ka actual result yahin compare karo.</p></div></div>
      <div class="grid-3 history-reality-grid">
        <div class="stat-card green"><span class="reality-label">🎯 Rules Se Kamaya</span><p class="stat-value" style="color:var(--emerald);">${money(s.setupPnL)}</p><p class="card-sub">${s.setupCount} setup trades</p></div>
        <div class="stat-card red"><span class="reality-label">🎲 Bina Setup</span><p class="stat-value" style="color:var(--rose);">${money(s.tukkaPnL)}</p><p class="card-sub">${s.tukkaCount} random trades</p></div>
        <div class="stat-card"><span class="reality-label">📊 Net Reality</span><p class="stat-value ${s.setupPnL+s.tukkaPnL>=0?'positive':'negative'}">${money(s.setupPnL+s.tukkaPnL)}</p><p class="card-sub">All logged trades</p></div>
      </div>
      <div class="card history-device-card">
        <div class="dashboard-section-head"><div><span class="uppercase-label">DEVICE IMPACT</span><h3 class="section-title">Where did you trade?</h3></div></div>
        <div class="history-device-grid">
          <div class="history-device-item"><div><strong>🖥️ Laptop @ Trading Desk</strong><p class="card-sub">${s.deskCount} trades</p></div><strong class="mono ${s.deskPnL>=0?'positive':'negative'}">${money(s.deskPnL)}</strong></div>
          <div class="history-device-item"><div><strong>📱 Mobile @ Couch / Random</strong><p class="card-sub">${s.mobileCount} trades</p></div><strong class="mono ${s.mobilePnL>=0?'positive':'negative'}">${money(s.mobilePnL)}</strong></div>
        </div>
      </div>
    </section>`;
  if (!all.length) return realityBlock + `<p class="empty-msg">Abhi koi trade log nahi hai. "Log Trade" tab se apna pehla trade add karo.</p>`;
  const trades = filteredHistoryTrades();
  const perf = strategyPerformance();
  const strategyNames = [...new Set(all.map(tradeStrategyName))];
  const totalPnl = trades.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const wins = trades.filter(t=>(Number(t.pnl)||0)>0).length;
  const mode=STATE.historyView;
  return `${realityBlock}
  <div class="card journal-summary-card">
    <div class="history-heading"><div><h2 class="section-title">📜 Trade History</h2><p class="card-sub">Apne trades ko jis tarah dekhna ho, wahi view choose karo.</p></div><div class="mono history-total ${totalPnl>=0?'positive':'negative'}">${money(totalPnl)}</div></div>
    <div class="grid-3 journal-kpis"><div><span class="uppercase-label">Trades</span><strong>${trades.length}</strong></div><div><span class="uppercase-label">Win Rate</span><strong>${trades.length?Math.round(wins/trades.length*100):0}%</strong></div><div><span class="uppercase-label">Avg Quality</span><strong>${trades.length?(trades.reduce((a,t)=>a+(Number(t.quality)||3),0)/trades.length).toFixed(1):'—'}/5</strong></div></div>
  </div>
  <div class="card history-toolbar"><div class="history-toolbar-title"><strong>View</strong><span>${mode==='grid'?'Compact cards':mode==='list'?'Quick rows':mode==='detailed'?'Full journal':'Screenshot focused'}</span></div><div class="history-view-switcher">${historyViewButton('grid','▦','Grid')}${historyViewButton('list','☰','List')}${historyViewButton('detailed','📖','Detailed')}${historyViewButton('gallery','🖼','Gallery')}</div></div>
  <div class="card history-filters"><div class="history-search"><input type="search" id="history-search" value="${esc(STATE.historySearch||'')}" placeholder="🔍 Search symbol, note, exit reason, emotion…" aria-label="Search trades"></div><div class="history-filter-grid"><div><label>Strategy Filter</label><select id="history-strategy-filter"><option value="ALL">All Strategies</option>${strategyNames.map(n=>`<option value="${esc(n)}" ${STATE.historyStrategyFilter===n?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div><label>Mistake Filter</label><select id="history-mistake-filter"><option value="ALL">All Mistakes</option>${MISTAKE_OPTIONS.map(x=>`<option value="${x[0]}" ${STATE.historyMistakeFilter===x[0]?'selected':''}>${x[1]}</option>`).join('')}</select></div><div><label>📅 Trade Date</label><input type="date" id="history-date-filter" value="${esc(STATE.historyDateFilter||'')}" aria-label="Select trade date"></div><div class="history-date-actions"><label>&nbsp;</label><button type="button" class="btn-secondary" data-action="clear-history-date" ${STATE.historyDateFilter?'':'disabled'}>Clear Date</button></div></div>${STATE.historyDateFilter?`<div class="history-date-active">📅 Showing trades for <strong>${esc(STATE.historyDateFilter)}</strong></div>`:''}</div>
  <div class="history-results ${mode}-view">${trades.length ? (mode==='list' ? `<div class="history-list-head"><span>Trade</span><span>Entry → Exit</span><span>Emotion</span><span>P&amp;L</span><span></span></div>${trades.map(t=>renderTradeView(t,mode)).join('')}` : trades.map(t=>renderTradeView(t,mode)).join('')) : '<p class="empty-msg">Is filter ke liye koi trade nahi mila.</p>'}</div>
  ${STATE.editingTradeId ? renderEditTradeModal(STATE.editingTradeId) : ''}`;
}

function toDateTimeLocalValue(raw){ if(!raw) return localDateTimeInputValue(); const d=new Date(raw); if(Number.isNaN(d.getTime())) return String(raw).slice(0,16); return localDateTimeInputValue(d); }
const NO_SETUP_STRATEGY='Bina Setup (Tukke Baazi)';
function editStrategyOptions(t){
  const names=[...new Set([...STATE.customStrategies.map(x=>normalizeCustomStrategy(x).name).filter(Boolean), NO_SETUP_STRATEGY, t.strategy].filter(Boolean))];
  return names.map(n=>`<option value="${esc(n)}" ${n===t.strategy?'selected':''}>${esc(n)}</option>`).join('');
}
function renderEditTradeModal(id){
  const t=STATE.trades.find(x=>x.id===id); if(!t) return '';
  const imgs=Array.isArray(t.images)&&t.images.length ? t.images : [t.beforeImage,t.afterImage,t.image].filter(Boolean);
  const presets=['Calm','Confident','Neutral','Anxious','FOMO','Revenge / Tilt','Overexcited','Tired'];
  return `<div class="edit-overlay"><div class="edit-modal">
    <div class="edit-modal-head"><div><span class="uppercase-label">UPDATE TRADE</span><h2 class="section-title">✏️ Edit ${esc(t.symbol)}</h2><p class="card-sub">Jo field change karna hai karo, phir Update Trade.</p></div><button type="button" class="modal-x" data-action="cancel-edit-trade">×</button></div>
    <div class="field grid-3"><div><label>Symbol</label><input id="edit-symbol" value="${esc(t.symbol)}"></div><div><label>Direction</label><select id="edit-type"><option ${t.type==='LONG'?'selected':''}>LONG</option><option ${t.type==='SHORT'?'selected':''}>SHORT</option></select></div><div><label>Quantity</label><input type="number" step="any" id="edit-qty" value="${t.quantity??''}"></div></div>
    <div class="field grid-3"><div><label>Entry</label><input type="number" step="any" id="edit-entry" value="${t.entryPrice??''}"></div><div><label>Exit</label><input type="number" step="any" id="edit-exit" value="${t.exitPrice??''}"></div><div><label>SL</label><input type="number" step="any" id="edit-sl" value="${t.stopLoss??''}"></div></div>
    <div class="field grid-3"><div><label>Trade date &amp; time</label><input type="datetime-local" id="edit-trade-datetime" value="${esc(tradeTimeInputValue(t))}"></div><div><label>Strategy</label><select id="edit-strategy">${editStrategyOptions(t)}</select></div><div><label>Mistake</label><select id="edit-mistake">${MISTAKE_OPTIONS.map(x=>`<option value="${x[0]}" ${(t.mistake||'none')===x[0]?'selected':''}>${esc(x[1])}</option>`).join('')}</select></div></div>
    <div class="field grid-2"><div><label>Execution quality</label><select id="edit-quality">${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(t.quality||3)===n?'selected':''}>${'⭐'.repeat(n)} ${n}/5</option>`).join('')}</select></div><div><label>Quick note</label><textarea id="edit-notes" rows="2" placeholder="Kya sahi hua? Kya improve karna hai?">${esc(t.notes||'')}</textarea></div></div>
    <div class="field"><label>Emotion(s)</label><div class="emotion-pills edit-emotions">${presets.map(x=>`<button type="button" class="emotion-pill ${(tradeEmotions(t).includes(x))?'selected':''}" data-action="toggle-edit-emotion" data-value="${esc(x)}">${esc(x)}</button>`).join('')}</div><input type="text" id="edit-custom-emotion" value="${esc(tradeEmotions(t).filter(x=>!presets.includes(x)).join(', '))}" placeholder="Custom emotions, comma separated"></div>
    <div class="field grid-2"><div><label>Exit Reason</label><input id="edit-exit-reason" value="${esc(t.exitReason||'')}" placeholder="Target / SL / manual / time..."></div><div><label>Images</label><div class="edit-images-list" id="edit-images-list">${imgs.map((src,i)=>`<div class="edit-image-item"><img src="${esc(imgUrl(src))}" data-src="${esc(src)}"><button type="button" data-action="remove-edit-image" data-index="${i}">×</button></div>`).join('')}<label class="edit-add-image">+ Add<input type="file" id="edit-multi-image-file" accept="image/*" multiple style="display:none"></label></div></div></div>
    <div class="edit-modal-actions"><button type="button" class="btn-secondary" data-action="cancel-edit-trade">Cancel</button><button type="button" class="btn-primary" data-action="update-trade" data-id="${esc(id)}">💾 Update Trade</button></div>
  </div></div>`;
}


/* ---------------- dashboard: setup playbook ----------------
   One compact view per strategy: its rules, its numbers, the mistakes that
   cost money in it, linked notes and the latest trades. */
function loadDashStrategy(){ try { return localStorage.getItem('tc_dash_strategy') || ''; } catch (_) { return ''; } }
function saveDashStrategy(v){ try { localStorage.setItem('tc_dash_strategy', v); } catch (_) {} }
const sameName=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
function playbookStrategyNames(){
  const counts={};
  STATE.trades.forEach(t=>{ const n=tradeStrategyName(t); counts[n]=(counts[n]||0)+1; });
  const saved=allStrategies().map(x=>x.name).filter(Boolean);
  const fromTrades=Object.keys(counts).filter(n=>!saved.some(x=>sameName(x,n)));
  return { names:[...saved, ...fromTrades], counts };
}
function currentDashStrategy(){
  const { names, counts } = playbookStrategyNames();
  if (!names.length) return '';
  if (STATE.dashStrategy && names.some(n=>sameName(n,STATE.dashStrategy))) return names.find(n=>sameName(n,STATE.dashStrategy));
  return [...names].sort((a,b)=>(counts[b]||0)-(counts[a]||0))[0];
}
const normKey=v=>String(v||'').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g,'');
// A note belongs to a setup if its Strategy/concept names it (spacing, case and
// punctuation ignored, "ORB" also matches "ORB Breakout"), or its title names it.
function noteMatchesStrategy(n, name){
  const key=normKey(name); if(!key) return false;
  const fieldHit=[n.strategy,n.concept,n.customConcept].some(v=>{ const k=normKey(v); return k && (k===key || (k.length>=3 && (key.startsWith(k)||k.startsWith(key)))); });
  if (fieldHit) return true;
  return key.length>=4 && normKey(n.title).includes(key);
}
function notePreviewText(n){
  const blocks=normalizeNoteBlocks(n);
  const txt=blocks.filter(b=>b.type==='text').map(b=>b.text || noteTextFromHtml(b.html||'')).join(' ').trim();
  return (txt || n.learning || n.analysis || n.entryCriteria || '').replace(/\s+/g,' ').trim();
}
function setupPlaybookData(name){
  const trades=STATE.trades.filter(t=>sameName(tradeStrategyName(t),name)).sort((a,b)=>tradeSortTime(b)-tradeSortTime(a));
  const closed=trades.filter(t=>!isOpenTrade(t));
  const wins=closed.filter(t=>(Number(t.pnl)||0)>0), losses=closed.filter(t=>(Number(t.pnl)||0)<0);
  const pnl=closed.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const avgR=closed.length?closed.reduce((a,t)=>a+(Number(t.rr)||0),0)/closed.length:0;
  const followed=closed.filter(t=>t.followedPlan), broken=closed.filter(t=>!t.followedPlan);
  const sum=list=>list.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const mistakes={};
  closed.filter(t=>t.mistake&&t.mistake!=='none').forEach(t=>{ const m=mistakes[t.mistake]||(mistakes[t.mistake]={id:t.mistake,count:0,pnl:0}); m.count++; m.pnl+=Number(t.pnl)||0; });
  const mistakeList=Object.values(mistakes).sort((a,b)=>a.pnl-b.pnl||b.count-a.count);
  const sessions=sessionGroupsForTrades(closed).filter(g=>g.trades>0).sort((a,b)=>b.pnl-a.pnl);
  const strategy=allStrategies().find(x=>sameName(x.name,name)) || null;
  const notes=STATE.notes.filter(n=>noteMatchesStrategy(n,name)).sort((a,b)=>new Date(b.updatedAt||b.date||0)-new Date(a.updatedAt||a.date||0));
  const tradeNotes=trades.filter(t=>t.notes).slice(0,3);
  return { name, strategy, trades, closed, wins, losses, pnl, avgR, followed, broken, followedPnl:sum(followed), brokenPnl:sum(broken), mistakeList, sessions, notes, tradeNotes,
    winRate: closed.length?Math.round(wins.length/closed.length*100):0, ruleRate: closed.length?Math.round(followed.length/closed.length*100):0 };
}
function noteStrategyOptions(current){
  const names=allStrategies().map(x=>x.name).filter(Boolean);
  const cur=String(current||'').trim();
  const extra=cur && !names.some(n=>sameName(n,cur)) ? `<option value="${esc(cur)}" selected>${esc(cur)} (not saved)</option>` : '';
  return `<option value="">— Strategy chuno —</option>${extra}${names.map(n=>`<option value="${esc(n)}" ${sameName(n,cur)?'selected':''}>${esc(n)}</option>`).join('')}<option value="__new__">＋ Nayi strategy banao…</option>`;
}
function linkableNotesSelect(d, name){
  const others=STATE.notes.filter(n=>!d.notes.includes(n));
  if(!others.length) return '';
  return `<label class="pb-link-note"><span class="sr-only">Link an existing note</span><select data-link-note-to="${esc(name)}"><option value="">🔗 Purana note is setup se jodo…</option>${others.slice(0,60).map(n=>`<option value="${esc(n.id)}">${esc((n.title||n.symbol||'Untitled').slice(0,60))}${n.strategy?` (abhi: ${esc(n.strategy)})`:''}</option>`).join('')}</select></label>`;
}
function renderSetupPlaybook(){
  const { names, counts } = playbookStrategyNames();
  if (!names.length) return `<section class="card setup-playbook" id="setup-playbook"><div class="playbook-head"><div><h3 class="section-title">Setup Playbook</h3><p class="card-sub">Pehle ek strategy banao. Phir yahan uske rules, numbers, mistakes aur notes ek jagah dikhenge.</p></div><button class="btn-primary btn-small" data-action="open-strategy-manager" data-new="1">＋ Add strategy</button></div></section>`;
  const name=currentDashStrategy();
  const d=setupPlaybookData(name);
  const st=d.strategy || {entryCriteria:'',exitCriteria:'',rules:[]};
  const rules=(Array.isArray(st.rules)&&st.rules.length?st.rules:(st.mandatoryRules||[])).filter(Boolean);
  const editing=STATE.dashEditStrategy===name && !!d.strategy;
  const best=d.sessions[0], worst=d.sessions.length>1?d.sessions[d.sessions.length-1]:null;
  const cls=v=>v>=0?'positive':'negative';
  const options=names.map(n=>`<option value="${esc(n)}" ${sameName(n,name)?'selected':''}>${esc(n)}${counts[n]?` · ${counts[n]} trade${counts[n]===1?'':'s'}`:' · no trades yet'}</option>`).join('');

  const rulesCol = editing ? `
    <div class="pb-col pb-rules">
      <h4>Rules</h4>
      <label class="pb-edit-label">Entry criteria<textarea id="pb-entry" rows="3">${esc(st.entryCriteria||'')}</textarea></label>
      <label class="pb-edit-label">Exit / invalidation<textarea id="pb-exit" rows="3">${esc(st.exitCriteria||'')}</textarea></label>
      <label class="pb-edit-label">Mandatory rules <small>(har rule nayi line mein)</small><textarea id="pb-rules" rows="4">${esc(rules.join('\n'))}</textarea></label>
      <div class="pb-edit-actions"><button type="button" class="btn-secondary btn-small" data-action="cancel-setup-criteria">Cancel</button><button type="button" class="btn-primary btn-small" data-action="save-setup-criteria" data-name="${esc(name)}">Save rules</button></div>
    </div>` : `
    <div class="pb-col pb-rules">
      <div class="pb-col-head"><h4>Rules</h4>${d.strategy?`<button type="button" class="pb-link" data-action="edit-setup-criteria" data-name="${esc(name)}">✏️ Edit</button>`:''}</div>
      <div class="pb-criteria"><span>Entry</span><p>${st.entryCriteria?esc(st.entryCriteria):'<em>Entry criteria add nahi kiya.</em>'}</p></div>
      <div class="pb-criteria"><span>Exit / invalidation</span><p>${st.exitCriteria?esc(st.exitCriteria):'<em>Exit criteria add nahi kiya.</em>'}</p></div>
      ${rules.length?`<ul class="pb-rule-list">${rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:`<p class="pb-empty">${d.strategy?'Koi mandatory rule nahi. ✏️ Edit se add karo.':'Yeh strategy sirf trades mein hai, saved playbook nahi.'}</p>`}
    </div>`;

  const mistakesCol = `
    <div class="pb-col pb-mistakes">
      <h4>Mistakes in this setup</h4>
      ${d.mistakeList.length ? `<ul class="pb-mistake-list">${d.mistakeList.map(m=>`<li><span>${esc(mistakeLabel(m.id))} <small>×${m.count}</small></span><strong class="${cls(m.pnl)}">${money(m.pnl)}</strong></li>`).join('')}</ul>` : `<p class="pb-empty">${d.closed.length?'Is setup mein abhi tak koi mistake log nahi hui. 👏':'Trades aane par yahan dikhega.'}</p>`}
      ${d.closed.length ? `<div class="pb-split">
        <div><span>Rules follow kiye</span><strong class="${cls(d.followedPnl)}">${money(d.followedPnl)}</strong><small>${d.followed.length} trade${d.followed.length===1?'':'s'}</small></div>
        <div><span>Rules tode</span><strong class="${cls(d.brokenPnl)}">${money(d.brokenPnl)}</strong><small>${d.broken.length} trade${d.broken.length===1?'':'s'}</small></div>
      </div>` : ''}
    </div>`;

  const notesCol = `
    <div class="pb-col pb-notes">
      <div class="pb-col-head"><h4>Notes</h4><button type="button" class="pb-link" data-action="create-note-for-setup" data-name="${esc(name)}">＋ Note</button></div>
      ${linkableNotesSelect(d, name)}
      ${d.notes.length ? `<ul class="pb-note-list">${d.notes.slice(0,4).map(n=>`<li><button type="button" data-action="open-note-from-dash" data-id="${esc(n.id)}"><strong>${esc(n.title||n.symbol||'Untitled note')}</strong><span>${esc(notePreviewText(n).slice(0,120)||'Khali note')}</span></button></li>`).join('')}</ul>` : `<p class="pb-empty">Is setup se linked koi note nahi. Note mein Strategy field mein "${esc(name)}" likho, woh yahan aa jayega.</p>`}
      ${d.tradeNotes.length ? `<div class="pb-trade-notes"><span>Trade notes</span>${d.tradeNotes.map(t=>`<p><b>${esc(t.symbol||'')}</b> <small>${esc(formatTradeTime(t))}</small><br>${esc(t.notes)}</p>`).join('')}</div>` : ''}
    </div>`;

  const recent = d.trades.slice(0,5);
  return `<section class="card setup-playbook" id="setup-playbook">
    <div class="playbook-head">
      <div><h3 class="section-title">Setup Playbook</h3><p class="card-sub">Strategy chuno — uske rules, numbers, mistakes aur notes ek jagah.</p></div>
      <div class="playbook-controls"><label class="playbook-select"><span class="sr-only">Select strategy</span><select id="dash-strategy-select">${options}</select></label><button type="button" class="btn-secondary btn-small" data-action="open-strategy-manager">⚙️ Manage strategies</button></div>
    </div>
    <div class="pb-stats">
      <div><span>Trades</span><strong>${d.closed.length}${d.trades.length>d.closed.length?`<small> +${d.trades.length-d.closed.length} open</small>`:''}</strong></div>
      <div><span>Win rate</span><strong>${d.winRate}%</strong></div>
      <div><span>Net P&amp;L</span><strong class="${cls(d.pnl)}">${money(d.pnl)}</strong></div>
      <div><span>Avg R</span><strong>${d.avgR.toFixed(2)}R</strong></div>
      <div><span>Rules followed</span><strong>${d.ruleRate}%</strong></div>
      <div><span>Best session</span><strong>${best?`${best.emoji} ${esc(best.name)}`:'—'}</strong>${best?`<small class="${cls(best.pnl)}">${money(best.pnl)}${worst&&worst.pnl<0?` · worst ${esc(worst.name)}`:''}</small>`:''}</div>
    </div>
    <div class="pb-grid">${rulesCol}${mistakesCol}${notesCol}</div>
    <div class="pb-recent">
      <div class="pb-col-head"><h4>Latest trades</h4>${d.trades.length?`<button type="button" class="pb-link" data-action="open-setup-history" data-name="${esc(name)}">Sab dekho →</button>`:''}</div>
      ${recent.length ? `<div class="pb-recent-list">${recent.map(t=>{const open=isOpenTrade(t), v=Number(t.pnl)||0; return `<div class="pb-trade"><div><strong>${esc(t.symbol||'—')}</strong> <span class="pb-dir ${t.type==='SHORT'?'short':'long'}">${esc(t.type||'')}</span><small>${esc(formatTradeTime(t))}</small>${t.mistake&&t.mistake!=='none'?`<span class="journal-chip chip-warn">${esc(mistakeLabel(t.mistake))}</span>`:''}</div><b class="${open?'':cls(v)}">${open?'Open':money(v)}</b></div>`;}).join('')}</div>` : `<p class="pb-empty">Is strategy se abhi koi trade log nahi hua.</p>`}
    </div>
  </section>`;
}
function rerenderSetupPlaybook(){
  const el=$('#setup-playbook'); if(!el) return;
  el.outerHTML=renderSetupPlaybook();
  const fresh=$('#setup-playbook');
  if(fresh && !REDUCED_MOTION){ fresh.classList.add('pb-swap'); }
}


/* ---------------- strategy manager ---------------- */
function strategyUsage(name){
  return { trades: STATE.trades.filter(t=>sameName(t.strategy,name)).length, notes: STATE.notes.filter(n=>noteMatchesStrategy(n,name)).length, exactNotes: STATE.notes.filter(n=>sameName(n.strategy,name)).length };
}
function openStrategyManager(editId=null){
  STATE.strategyManager={ open:true, editingId:editId };
  renderStrategyManager();
}
function closeStrategyManager(){ STATE.pendingNoteStrategyFor=null; STATE.strategyManager={open:false,editingId:null}; const host=$('#strategy-manager-host'); if(host) host.innerHTML=''; }
function renderStrategyManager(){
  let host=$('#strategy-manager-host');
  if(!host){ host=document.createElement('div'); host.id='strategy-manager-host'; document.body.appendChild(host); }
  const sm=STATE.strategyManager||{}; if(!sm.open){ host.innerHTML=''; return; }
  const list=allStrategies();
  const editing = sm.editingId==='new' ? {id:'',name:'',entryCriteria:'',exitCriteria:'',rules:[]} : (sm.editingId ? list.find(x=>x.id===sm.editingId) : null);
  const rules = editing ? ((Array.isArray(editing.rules)&&editing.rules.length?editing.rules:(editing.mandatoryRules||[]))) : [];
  const form = editing ? `
    <div class="sm-form">
      <h3>${sm.editingId==='new'?'New strategy':`Edit: ${esc(editing.name)}`}</h3>
      <div class="field"><label>Strategy name</label><input id="sm-name" maxlength="80" value="${esc(editing.name)}" placeholder="e.g. ORB Breakout"></div>
      <div class="field grid-2"><div><label>Entry criteria</label><textarea id="sm-entry" rows="3" placeholder="Entry ke liye mandatory conditions…">${esc(editing.entryCriteria||'')}</textarea></div><div><label>Exit / invalidation</label><textarea id="sm-exit" rows="3" placeholder="Target, SL aur invalidation rules…">${esc(editing.exitCriteria||'')}</textarea></div></div>
      <div class="field"><label>Mandatory rules <span class="optional-label">har rule nayi line mein</span></label><textarea id="sm-rules" rows="4" placeholder="HTF bias aligned\nRisk 1% se zyada nahi">${esc(rules.join('\n'))}</textarea></div>
      <p class="sm-error" id="sm-error" role="alert"></p>
      <div class="sm-form-actions"><button type="button" class="btn-secondary" data-action="sm-cancel">Cancel</button><button type="button" class="btn-primary" data-action="sm-save">${sm.editingId==='new'?'Add strategy':'Save changes'}</button></div>
    </div>` : '';
  host.innerHTML = `<div class="edit-overlay sm-overlay" data-action="sm-backdrop"><div class="edit-modal sm-modal" role="dialog" aria-modal="true" aria-labelledby="sm-title">
    <div class="edit-modal-head"><div><h2 class="section-title" id="sm-title">Manage strategies</h2><p class="card-sub">Yahan banai strategies Trade Log, History filters aur Setup Playbook — sab jagah dikhti hain.</p></div><button type="button" class="modal-x" data-action="close-strategy-manager" aria-label="Close">×</button></div>
    ${form}
    <div class="sm-list-head"><strong>${list.length} strateg${list.length===1?'y':'ies'}</strong>${editing?'':`<button type="button" class="btn-primary btn-small" data-action="sm-new">＋ New strategy</button>`}</div>
    ${list.length ? `<ul class="sm-list">${list.map(x=>{ const u=strategyUsage(x.name); const r=(x.rules&&x.rules.length?x.rules:(x.mandatoryRules||[])).length; return `<li class="${sm.editingId===x.id?'is-editing':''}"><div><strong>${esc(x.name)}</strong><small>${u.trades} trade${u.trades===1?'':'s'} · ${u.notes} note${u.notes===1?'':'s'} · ${r} rule${r===1?'':'s'}${x.entryCriteria?'':' · entry criteria missing'}</small></div><div class="sm-row-actions"><button type="button" class="btn-secondary btn-small" data-action="sm-edit" data-id="${esc(x.id)}">✏️ Edit</button><button type="button" class="btn-danger btn-small" data-action="sm-delete" data-id="${esc(x.id)}">Delete</button></div></li>`; }).join('')}</ul>` : `<p class="pb-empty">Abhi koi strategy nahi. ＋ New strategy se pehli banao.</p>`}
  </div></div>`;
  if(editing) setTimeout(()=>$('#sm-name')?.focus(),30);
}
async function saveStrategyFromManager(){
  const sm=STATE.strategyManager; const err=$('#sm-error');
  const name=($('#sm-name')?.value||'').trim().replace(/\s+/g,' ');
  const entryCriteria=($('#sm-entry')?.value||'').trim(), exitCriteria=($('#sm-exit')?.value||'').trim();
  const rules=($('#sm-rules')?.value||'').split('\n').map(x=>x.trim()).filter(Boolean);
  if(!name){ if(err) err.textContent='Strategy ka naam likho.'; return; }
  const list=allStrategies();
  const idx = sm.editingId==='new' ? -1 : STATE.customStrategies.findIndex(x=>normalizeCustomStrategy(x).id===sm.editingId);
  const old = idx>=0 ? normalizeCustomStrategy(STATE.customStrategies[idx]) : null;
  if(list.some(x=>sameName(x.name,name) && (!old || x.id!==old.id))){ if(err) err.textContent=`"${name}" naam ki strategy pehle se hai.`; return; }
  const parts=['customStrategies'];
  if(old && !sameName(old.name,name)){
    const u=strategyUsage(old.name);
    if((u.trades||u.exactNotes) && !confirm(`"${old.name}" ka naam "${name}" karne par ${u.trades} trades aur ${u.exactNotes} notes bhi naye naam par update honge. Continue?`)) return;
    STATE.trades.forEach(t=>{ if(sameName(t.strategy,old.name)) t.strategy=name; });
    STATE.notes.forEach(n=>{ if(sameName(n.strategy,old.name)) n.strategy=name; });
    if(u.trades) parts.push('trades'); if(u.exactNotes) parts.push('notes');
    if(sameName(STATE.dashStrategy,old.name)){ STATE.dashStrategy=name; saveDashStrategy(name); }
    if(sameName(STATE.historyStrategyFilter,old.name)) STATE.historyStrategyFilter=name;
  }
  const record={ ...(old||{}), id: old?.id || `custom-${Date.now()}`, name, entryCriteria, exitCriteria, rules, mandatoryRules:rules,
    commonTraps: old?.commonTraps||[], winningExamples: old?.winningExamples||[], losingExamples: old?.losingExamples||[] };
  if(idx>=0) STATE.customStrategies[idx]=record; else STATE.customStrategies.push(record);
  if(sm.editingId==='new' && STATE.activeTab==='copilot'){ STATE.dashStrategy=name; saveDashStrategy(name); }
  const linkNote = sm.editingId==='new' && STATE.pendingNoteStrategyFor ? STATE.notes.find(n=>n.id===STATE.pendingNoteStrategyFor) : null;
  STATE.pendingNoteStrategyFor=null;
  if(linkNote){ linkNote.strategy=name; linkNote.updatedAt=new Date().toISOString(); if(!parts.includes('notes')) parts.push('notes');
    STATE.strategyManager={open:false,editingId:null}; renderStrategyManager(); renderTabOnly(); saveUserData('Strategy', parts); return; }
  STATE.strategyManager={open:true, editingId:null};
  renderStrategyManager(); renderTabOnly();
  saveUserData('Strategy', parts);
}
function deleteStrategyFromManager(id){
  const idx=STATE.customStrategies.findIndex(x=>normalizeCustomStrategy(x).id===id); if(idx<0) return;
  const st=normalizeCustomStrategy(STATE.customStrategies[idx]); const u=strategyUsage(st.name);
  if(!confirm(`"${st.name}" delete karein?${u.trades?`\n\nIske ${u.trades} trades delete NAHI honge — woh History aur Playbook mein isi naam se dikhte rahenge.`:''}`)) return;
  STATE.customStrategies.splice(idx,1);
  if(STATE.selectedPlaybookId===st.id) STATE.selectedPlaybookId=allStrategies()[0]?.id||'';
  STATE.strategyManager={open:true, editingId:null};
  renderStrategyManager(); renderTabOnly();
  saveUserData('Strategy', ['customStrategies']);
}

/* ---------------- main render ---------------- */
function render(){
  renderHeader();
  renderTabNav();
  const content = $('#tab-content');
  if (STATE.activeTab==='copilot') content.innerHTML = renderCopilotTab();
  else if (STATE.activeTab==='log') { content.innerHTML = renderLogTab(); renderLogImagePreview(); updateLogPreview(); }
  else if (STATE.activeTab==='notes') { content.innerHTML = renderNotesTab(); renderNoteImagePreview(); renderNoteBlocksEditor(); }
  else if (STATE.activeTab==='history') content.innerHTML = renderHistoryTab();
  else if (STATE.activeTab==='analysis') content.innerHTML = renderAnalysisTab();
  else if (STATE.activeTab==='risk') { content.innerHTML = renderRiskCenter(); bindRiskSettings(); updateRiskCalculator(); }
  afterTabRender();
}
function renderTabOnly(){ // re-render just the active tab (after in-tab interactions)
  const content = $('#tab-content');
  if (STATE.activeTab==='copilot') content.innerHTML = renderCopilotTab();
  else if (STATE.activeTab==='log') { content.innerHTML = renderLogTab(); renderLogImagePreview(); updateLogPreview(); }
  else if (STATE.activeTab==='notes') { content.innerHTML = renderNotesTab(); renderNoteImagePreview(); renderNoteBlocksEditor(); }
  else if (STATE.activeTab==='history') content.innerHTML = renderHistoryTab();
  else if (STATE.activeTab==='analysis') content.innerHTML = renderAnalysisTab();
  else if (STATE.activeTab==='risk') { content.innerHTML = renderRiskCenter(); bindRiskSettings(); updateRiskCalculator(); }
  renderTabNav();
  afterTabRender();
}

/* ---------------- event delegation ---------------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action==='set-tab') { STATE.activeTab = btn.dataset.tab; render(); }
  else if (action==='select-mindset') { STATE.selectedMindsetId = btn.dataset.id; renderTabOnly(); }
  else if (action==='toggle-rule') { const i=btn.dataset.idx; STATE.checkedRules[i]=!STATE.checkedRules[i]; renderTabOnly(); }
  else if (action==='set-inspection') { STATE.inspectionTab = btn.dataset.value; renderTabOnly(); }
  else if (action==='save-session-note') {
    saveSessionView(btn.dataset.session);
  }
  else if (action==='clear-history-date') {
    STATE.historyDateFilter='';
    renderTabOnly();
  }
  else if (action==='history-view') {
    const view = btn.dataset.view;
    if (['grid','list','detailed','gallery'].includes(view)) {
      STATE.historyView = view;
      localStorage.setItem('tc_history_view', view);
      renderTabOnly();
    }
  }
  else if (action==='record-state') { alert(`Mindset saved: ${findMindset(STATE.selectedMindsetId).name} (+20 XP)`); }
  else if (action==='set-log-setup') { const draft=captureLogDraft(); STATE.logFormIsSetup = btn.dataset.value==='true'; renderTabOnly(); restoreLogDraft(draft); updateLogPreview(); }
  else if (action==='set-log-emotion') {
    const value = btn.dataset.value;
    STATE.logEmotions = STATE.logEmotions.includes(value)
      ? STATE.logEmotions.filter(x => x !== value)
      : [...STATE.logEmotions, value];
    // Do not re-render the whole form here. Re-rendering was restoring the
    // previous draft and made multi-select appear to lose selections.
    STATE.logCustomEmotion = '';
    btn.classList.toggle('selected', STATE.logEmotions.includes(value));
    const badge = document.querySelector('.emotion-selected-badge');
    if (badge) {
      badge.textContent = STATE.logEmotions.length ? `✓ ${STATE.logEmotions.join(' · ')}` : 'Select emotion(s)';
      badge.classList.toggle('empty', !STATE.logEmotions.length);
    }
  }
  else if (action==='toggle-edit-emotion') { btn.classList.toggle('selected'); }
  else if (action==='use-custom-emotion') {
    const draft=captureLogDraft();
    const v = $('#log-custom-emotion')?.value.trim();
    if (v) {
      STATE.logEmotions = STATE.logEmotions.includes(v) ? STATE.logEmotions : [...STATE.logEmotions, v];
      STATE.logCustomEmotion = v;
      renderTabOnly();
      restoreLogDraft(draft);
      const input = $('#log-custom-emotion');
      if (input) input.focus();
    }
  }
  else if (action==='set-log-device') { const draft=captureLogDraft(); STATE.logFormDevice = btn.dataset.value; renderTabOnly(); restoreLogDraft(draft); }
  else if (action==='remove-log-image') { STATE.logFormImage=''; STATE.logFormBeforeImage=''; STATE.logFormAfterImage=''; STATE.logFormImages=[]; renderLogImagePreview(); updateLogPreview(); }
  else if (action==='remove-log-image-index') { const i=Number(btn.dataset.index); const arr=currentLogImages(); arr.splice(i,1); STATE.logFormImages=arr; STATE.logFormBeforeImage=arr[0]||''; STATE.logFormAfterImage=arr[1]||''; renderLogImagePreview(); updateLogPreview(); }
  else if (action==='add-log-image-url') { runImageLink('#log-image-url', btn, src=>addLogImages([src])); }
  else if (action==='edit-trade') { STATE.editingTradeId=btn.dataset.id; render(); }
  else if (action==='delete-trade') { await deleteTrade(btn.dataset.id); }
  else if (action==='cancel-edit-trade') { STATE.editingTradeId=null; render(); }
  else if (action==='update-trade') { await updateExistingTrade(btn.dataset.id); }
  else if (action==='remove-edit-image') { const item=btn.closest('.edit-image-item'); item?.remove(); }
  else if (action==='remove-note-image') { STATE.noteFormImage=''; renderNoteImagePreview(); }
  else if (action==='add-note-text-block') { STATE.noteFormBlocks.push({type:'text',text:''}); renderNoteBlocksEditor(); setTimeout(()=>$$('[data-note-block-text]').at(-1)?.focus(),0); }
  else if (action==='remove-note-block') { const i=Number(btn.dataset.index); STATE.noteFormBlocks.splice(i,1); renderNoteBlocksEditor(); }
  else if (action==='add-note-image-url') { runImageLink('#note-image-url', btn, src=>{ STATE.noteFormBlocks.push({type:'image',src}); renderNoteBlocksEditor(); }); }
  else if (action==='open-note-block-annotator') { const noteId=btn.dataset.noteId || null; const index=Number(btn.dataset.index); const src=noteId ? (STATE.notes.find(n=>n.id===noteId)?.blocks?.[index]?.src || '') : (STATE.noteFormBlocks[index]?.src || ''); if(src) openAnnotator(src,noteId,index); }
  else if (action==='view-image') { openAnnotator(btn.dataset.src || '', null, null, { tradeId: btn.dataset.tradeId || null }); }
  else if (action==='toggle-strategy-builder') {
    const form = $('#strategy-builder-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  }
  else if (action==='save-strategy') {
    const name = $('#strategy-name')?.value.trim();
    const entryCriteria = $('#strategy-entry')?.value.trim() || '';
    const exitCriteria = $('#strategy-exit')?.value.trim() || '';
    const rules = ($('#strategy-rules')?.value || '').split('\n').map(x=>x.trim()).filter(Boolean);
    if (!name) { alert('Please enter a strategy name.'); return; }
    const existing = STATE.customStrategies.find(s => normalizeCustomStrategy(s).name.toLowerCase() === name.toLowerCase());
    if (existing) { alert('Ye strategy already exist karti hai.'); return; }
    const strategy = {
      id:`custom-${Date.now()}`,
      name,
      entryCriteria,
      exitCriteria,
      rules,
      mandatoryRules: rules,
      commonTraps: [],
      winningExamples: [],
      losingExamples: [],
      winRate: 0,
      avgRR: '—'
    };
    STATE.customStrategies.push(strategy);
    STATE.noteFormStrategy = name;
    STATE.selectedPlaybookId = strategy.id;
    renderTabOnly();
    saveUserData('Strategy', ['customStrategies']);
  }
  else if (action==='add-custom-strategy') {
    const val = $('#note-custom-strategy-input').value.trim();
    if (!val) return;
    const strategy = { id:`custom-${Date.now()}`, name:val, entryCriteria:'', exitCriteria:'', rules:[], mandatoryRules:[], commonTraps:[], winningExamples:[], losingExamples:[], winRate:0, avgRR:'—' };
    if (!STATE.customStrategies.some(s=>normalizeCustomStrategy(s).name===val)) STATE.customStrategies.push(strategy);
    STATE.noteFormStrategy = val;
    STATE.selectedPlaybookId = strategy.id;
    renderTabOnly();
    saveUserData('Strategy', ['customStrategies']);
  }
  else if (action==='create-note') {
    const id = `n-${Date.now()}`;
    const note = { id, title:'Untitled Note', symbol:'General', concept:STATE.noteConceptFilter==='ALL'||STATE.noteConceptFilter==='__custom__'?'General':STATE.noteConceptFilter, customConcept:'', strategy:'', blocks:[{type:'text',text:''}], image:null, entryCriteria:'', exitCriteria:'', analysis:'', learning:'', date:new Date().toISOString(), updatedAt:new Date().toISOString() };
    STATE.notes.unshift(note);
    STATE.activeNoteId=id;
    STATE.noteConceptFilter='ALL';
    renderTabOnly();                       // show the new note immediately
    setTimeout(()=>document.querySelector(`[data-note-editor-title=\"${id}\"]`)?.focus(),30);
    autoSaveNote(id);                      // save in background (shows Saving… / ✓ Saved, retries on failure)
  }
  else if (action==='toggle-note-plus') {
    const menu = $('#note-plus-menu');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  }
  else if (action==='add-live-text-block') {
    const note = STATE.notes.find(n => n.id === STATE.activeNoteId);
    if (!note) return;
    note.blocks = normalizeNoteBlocks(note);
    const at = Number.isInteger(STATE.noteInsertIndex) ? Math.min(STATE.noteInsertIndex + 1, note.blocks.length) : note.blocks.length;
    note.blocks.splice(at, 0, {type:'text', text:'', html:''});
    STATE.noteInsertIndex = at;
    const menu = $('#note-plus-menu'); if (menu) menu.style.display='none';
    renderTabOnly();
    scheduleNoteAutoSave(note.id);
    setTimeout(() => { const fields = $$(`[data-live-note-text=\"${note.id}\"]`); fields[at]?.focus(); }, 30);
  }
  else if (action==='add-live-image-link') {
    runImageLink('#live-note-image-link', btn, src=>insertImagesIntoActiveNote([src]));
  }
  else if (action==='trigger-live-image') {
    $('#live-note-image-file')?.click();
  }
  else if (action==='remove-live-note-block') {
    const note = STATE.notes.find(n => n.id === btn.dataset.noteId);
    const i = Number(btn.dataset.index);
    if (!note) return;
    note.blocks = normalizeNoteBlocks(note);
    note.blocks.splice(i,1);
    note.image = note.blocks.find(b=>b.type==='image')?.src || null;
    STATE.noteInsertIndex = Math.max(0, Math.min(i-1, note.blocks.length-1));
    renderTabOnly();
    scheduleNoteAutoSave(note.id);
  }
  else if (action==='filter-note-concept') {
    STATE.noteConceptFilter = btn.dataset.concept || 'ALL';
    STATE.activeNoteId = null;
    STATE.editingNoteId = null;
    renderTabOnly();
  }
  else if (action==='retry-broken-image') { const box=btn.closest('.img-broken'); if(box){ const src=box.dataset.src.split('?')[0]; IMG_STATUS_CACHE.delete(src); IMG_RETRIED.add(src); const img=BROKEN_ORIGINALS.get(box)||document.createElement('img'); img.dataset.brokenHandled=''; img.style.visibility=''; img.src=src+(src.startsWith('data:')?'':(src.includes('?')?'&':'?')+'r='+Date.now()); box.replaceWith(img); } }
  else if (action==='check-all-images') { checkAllImages(); }
  else if (action==='open-strategy-manager') { openStrategyManager(btn.dataset.new ? 'new' : (btn.dataset.id || null)); }
  else if (action==='close-strategy-manager') { closeStrategyManager(); }
  else if (action==='sm-backdrop') { if (e.target===btn) closeStrategyManager(); }
  else if (action==='sm-new') { STATE.strategyManager.editingId='new'; renderStrategyManager(); }
  else if (action==='sm-edit') { STATE.strategyManager.editingId=btn.dataset.id; renderStrategyManager(); }
  else if (action==='sm-cancel') { STATE.strategyManager.editingId=null; renderStrategyManager(); }
  else if (action==='sm-save') { saveStrategyFromManager(); }
  else if (action==='sm-delete') { deleteStrategyFromManager(btn.dataset.id); }
  else if (action==='edit-setup-criteria') { STATE.dashEditStrategy=btn.dataset.name; rerenderSetupPlaybook(); setTimeout(()=>$('#pb-entry')?.focus(),30); }
  else if (action==='cancel-setup-criteria') { STATE.dashEditStrategy=null; rerenderSetupPlaybook(); }
  else if (action==='save-setup-criteria') {
    const name=btn.dataset.name;
    const idx=STATE.customStrategies.findIndex(x=>sameName(normalizeCustomStrategy(x).name,name));
    if (idx<0) return;
    const base=normalizeCustomStrategy(STATE.customStrategies[idx]);
    const rules=($('#pb-rules')?.value||'').split('\n').map(x=>x.trim()).filter(Boolean);
    STATE.customStrategies[idx]={...base, entryCriteria:($('#pb-entry')?.value||'').trim(), exitCriteria:($('#pb-exit')?.value||'').trim(), rules, mandatoryRules:rules};
    STATE.dashEditStrategy=null; rerenderSetupPlaybook();
    saveUserData('Strategy', ['customStrategies']);
  }
  else if (action==='open-note-from-dash') { STATE.activeNoteId=btn.dataset.id; STATE.noteConceptFilter='ALL'; STATE.editingNoteId=null; STATE.activeTab='notes'; render(); window.scrollTo({top:0,behavior:REDUCED_MOTION?'auto':'smooth'}); }
  else if (action==='create-note-for-setup') {
    const id=`n-${Date.now()}`, now=new Date().toISOString();
    STATE.notes.unshift({ id, title:`${btn.dataset.name} — note`, symbol:'General', concept:'General', customConcept:'', strategy:btn.dataset.name, blocks:[{type:'text',text:''}], image:null, entryCriteria:'', exitCriteria:'', analysis:'', learning:'', date:now, updatedAt:now });
    STATE.activeNoteId=id; STATE.noteConceptFilter='ALL'; STATE.activeTab='notes'; render();
    autoSaveNote(id);
  }
  else if (action==='open-setup-history') { STATE.historyStrategyFilter=btn.dataset.name; STATE.historyMistakeFilter='ALL'; STATE.historyDateFilter=''; STATE.historySearch=''; STATE.activeTab='history'; render(); window.scrollTo({top:0,behavior:REDUCED_MOTION?'auto':'smooth'}); }
  else if (action==='select-note') {
    STATE.activeNoteId = btn.dataset.id;
    STATE.editingNoteId = null;
    render();
  }
  else if (action==='edit-note') {
    const note = STATE.notes.find(n => n.id === btn.dataset.id);
    if (!note) return;
    STATE.activeNoteId = note.id;
    STATE.editingNoteId = note.id;
    STATE.noteFormStrategy = note.strategy || '';
    STATE.noteFormConcept = note.customConcept ? '__custom__' : (note.concept || 'General');
    STATE.noteFormCustomConcept = note.customConcept || '';
    STATE.noteFormImage = note.image || '';
    STATE.noteFormBlocks = normalizeNoteBlocks(note);
    render();
    document.querySelector('#notes-form')?.scrollIntoView({behavior:'smooth', block:'start'});
  }
  else if (action==='cancel-edit-note') {
    STATE.editingNoteId = null;
    STATE.noteFormImage = '';
    STATE.noteFormBlocks = [];
    STATE.noteFormConcept = 'General';
    STATE.noteFormCustomConcept = '';
    renderTabOnly();
  }
  else if (action==='delete-note') {
    STATE.notes = STATE.notes.filter(n => n.id !== btn.dataset.id);
    if (STATE.activeNoteId === btn.dataset.id) STATE.activeNoteId = STATE.notes[0]?.id || null;
    renderTabOnly();
    saveUserData('Note', ['notes']);
  }
});

$('#modal-close').addEventListener('click', closeAnnotator);
$('#annotator-fullscreen')?.addEventListener('click', toggleAnnotatorFullscreen);
$('#image-modal').addEventListener('click', (e) => { if (e.target.id==='image-modal') closeAnnotator(); });
$('#annotator-pen')?.addEventListener('click', () => setAnnotatorMode('pen'));
$('#annotator-eraser')?.addEventListener('click', () => setAnnotatorMode('eraser'));
$('#annotator-color')?.addEventListener('input', e => { STATE.annotator.color=e.target.value; setAnnotatorMode('pen'); });
$('#annotator-size')?.addEventListener('input', e => STATE.annotator.size=Number(e.target.value));
$('#annotator-pressure')?.addEventListener('change', e => STATE.annotator.pressure=!!e.target.checked);
$('#annotator-undo')?.addEventListener('click', undoAnnotator);
$('#annotator-redo')?.addEventListener('click', redoAnnotator);
$('#annotator-clear')?.addEventListener('click', clearAnnotator);
$('#annotator-save')?.addEventListener('click', saveAnnotatedImage);
$('#annotator-canvas')?.addEventListener('pointerdown', startAnnotator);
$('#annotator-canvas')?.addEventListener('pointermove', moveAnnotator);
$('#annotator-canvas')?.addEventListener('pointerup', endAnnotator);
$('#annotator-canvas')?.addEventListener('pointercancel', endAnnotator);
$('#annotator-canvas')?.addEventListener('pointerleave', e => { if(STATE.annotator.drawing) moveAnnotator(e); });
window.addEventListener('resize', () => { if ($('#image-modal')?.style.display==='flex') setupAnnotatorCanvas(); });

document.addEventListener('focusin', (e) => {
  if (e.target.matches('[data-live-note-text]')) { STATE.noteInsertIndex=Number(e.target.dataset.index); noteSelectionStore(e.target); autoGrowNoteEditor(e.target); }
});

// Custom emotion is a text field inside the trade form. Enter should add the
// emotion, not submit/save the entire trade. The explicit ＋ button does the
// same thing for mouse/touch users.
document.addEventListener('keydown', (e) => {
  if (e.key==='Enter' && ['live-note-image-link','log-image-url','note-image-url'].includes(e.target.id)) {
    e.preventDefault();
    const act={'live-note-image-link':'add-live-image-link','log-image-url':'add-log-image-url','note-image-url':'add-note-image-url'}[e.target.id];
    document.querySelector(`[data-action="${act}"]`)?.click(); return;
  }
  if (e.key==='Escape' && STATE.strategyManager?.open) { closeStrategyManager(); return; }
  if (e.target?.id === 'log-custom-emotion' && e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    document.querySelector('[data-action="use-custom-emotion"]')?.click();
  }
});

function noteSelectionStore(el){ if(!el||!el.isContentEditable)return; const sel=window.getSelection(); if(sel&&sel.rangeCount){const r=sel.getRangeAt(0);if(el.contains(r.commonAncestorContainer))el._savedRange=r.cloneRange();} }
function noteRestoreSelection(el){if(!el?._savedRange)return false;const sel=window.getSelection();sel.removeAllRanges();sel.addRange(el._savedRange);return true;}
function autoGrowNoteEditor(el){if(!el)return;el.style.height='auto';el.style.height=Math.max(34,el.scrollHeight)+'px';}
function applyNoteFormat(el,type,value){if(!el)return;el.focus();noteRestoreSelection(el);if(type==='bold')document.execCommand('bold',false,null);else if(type==='highlight'){try{document.execCommand('hiliteColor',false,'#fff59d');}catch(_){document.execCommand('backColor',false,'#fff59d');}}else if(type==='clear-format')document.execCommand('removeFormat',false,null);else if(type==='font-size'){document.execCommand('fontSize',false,'7');el.querySelectorAll('font[size="7"]').forEach(f=>{const span=document.createElement('span');span.style.fontSize=String(value||'16px');span.innerHTML=f.innerHTML;f.replaceWith(span);});}noteSelectionStore(el);el.dispatchEvent(new Event('input',{bubbles:true}));}
document.addEventListener('mousedown',e=>{const btn=e.target.closest('[data-note-format],[data-note-font-size]');if(!btn)return;const el=btn.closest('.samsung-note-text-block')?.querySelector('[data-live-note-text]');if(el)noteSelectionStore(el);if(btn.tagName==='BUTTON')e.preventDefault();});
document.addEventListener('click',e=>{const btn=e.target.closest('[data-note-format]');if(!btn)return;const el=btn.closest('.samsung-note-text-block')?.querySelector('[data-live-note-text]');if(el)applyNoteFormat(el,btn.dataset.noteFormat);});
document.addEventListener('change',e=>{if(!e.target.matches('[data-note-font-size]'))return;const el=e.target.closest('.samsung-note-text-block')?.querySelector('[data-live-note-text]');if(el)applyNoteFormat(el,'font-size',e.target.value);});
document.addEventListener('keyup',e=>{if(e.target.matches('[data-live-note-text]'))noteSelectionStore(e.target);});
document.addEventListener('mouseup',e=>{if(e.target.matches('[data-live-note-text]'))noteSelectionStore(e.target);});

document.addEventListener('input', (e) => {
  if (e.target.id==='energy-slider') { STATE.energyLevel = Number(e.target.value); $('#energy-val').textContent = STATE.energyLevel+'%'; refreshBatteryOnly(); }
  else if (e.target.id==='noise-slider') { STATE.noiseLevel = Number(e.target.value); $('#noise-val').textContent = STATE.noiseLevel+'%'; refreshBatteryOnly(); }
  else if (['log-entry','log-exit','log-qty','log-sl','log-type'].includes(e.target.id)) { updateLogPreview(); }
  else if (e.target.id==='log-before-image-url') { STATE.logFormBeforeImage = e.target.value; renderLogImagePreview(); updateLogPreview(); }
  else if (e.target.id==='log-after-image-url') { STATE.logFormAfterImage = e.target.value; renderLogImagePreview(); updateLogPreview(); }
  else if (e.target.id==='log-custom-emotion') { STATE.logCustomEmotion = e.target.value; }
  else if (e.target.id==='note-image-url') { /* added via action button */ }
  else if (e.target.id==='note-custom-concept') { STATE.noteFormCustomConcept = e.target.value; }
  else if (e.target.matches('[data-note-editor-title]')) { const note=STATE.notes.find(n=>n.id===e.target.dataset.noteEditorTitle); if(note){ note.title=e.target.value; note.symbol=e.target.value; scheduleNoteAutoSave(note.id); } }
  else if (e.target.matches('[data-live-note-text]')) {
    const note=STATE.notes.find(n=>n.id===e.target.dataset.liveNoteText); const i=Number(e.target.dataset.index);
    if(note){ note.blocks=normalizeNoteBlocks(note); if(note.blocks[i]){ note.blocks[i].html=sanitizeNoteHtml(e.target.innerHTML); note.blocks[i].text=noteTextFromHtml(note.blocks[i].html); } scheduleNoteAutoSave(note.id); autoGrowNoteEditor(e.target); }
  }
  else if (e.target.matches('[data-note-editor-entry]')) updateActiveNoteField(e.target.dataset.noteEditorEntry,'entryCriteria',e.target.value);
  else if (e.target.matches('[data-note-editor-exit]')) updateActiveNoteField(e.target.dataset.noteEditorExit,'exitCriteria',e.target.value);
  else if (e.target.matches('[data-note-editor-analysis]')) updateActiveNoteField(e.target.dataset.noteEditorAnalysis,'analysis',e.target.value);
  else if (e.target.matches('[data-note-editor-learning]')) updateActiveNoteField(e.target.dataset.noteEditorLearning,'learning',e.target.value);
  else if (e.target.matches('[data-note-editor-strategy]') && e.target.value==='__new__') {
    const noteId=e.target.dataset.noteEditorStrategy, note=STATE.notes.find(n=>n.id===noteId);
    e.target.value=note?.strategy||'';            // don't store the "new" placeholder
    STATE.pendingNoteStrategyFor=noteId;          // link the new strategy to this note once saved
    openStrategyManager('new');
  }
  else if (e.target.matches('[data-note-editor-strategy]')) updateActiveNoteField(e.target.dataset.noteEditorStrategy,'strategy',e.target.value);
  else if (e.target.matches('[data-note-block-text]')) { const i=Number(e.target.dataset.noteBlockText); if(STATE.noteFormBlocks[i]) STATE.noteFormBlocks[i].text=e.target.value; }
});

function refreshBatteryOnly(){
  const score = computeBattery();
  const tl = computeTrafficLight(score);
  const barColor = score>=70 ? '#059669' : score>=40 ? '#d97706' : '#e11d48';
  const bannerColors = { green:['#ecfdf5','#a7f3d0','#065f46'], yellow:['#fffbeb','#fde68a','#78350f'], red:['#fff1f2','#fecdd3','#881337'] }[tl.cls];
  $('#battery-bar').style.width = score+'%'; $('#battery-bar').style.background = barColor;
  $('#battery-percent').textContent = score+'%'; $('#battery-percent').style.color = barColor;
  const banner = $('#traffic-banner');
  banner.style.background = bannerColors[0]; banner.style.borderColor = bannerColors[1]; banner.style.color = bannerColors[2];
  $('#traffic-title').textContent = tl.title; $('#traffic-msg').textContent = '— '+tl.msg;
}

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-link-note-to]')) {
    const note=STATE.notes.find(n=>n.id===e.target.value); if(!note) return;
    note.strategy=e.target.dataset.linkNoteTo; note.updatedAt=new Date().toISOString();
    rerenderSetupPlaybook(); saveUserData('Note', ['notes']); return;
  }
  if (e.target.id==='dash-strategy-select') { STATE.dashStrategy=e.target.value; STATE.dashEditStrategy=null; saveDashStrategy(e.target.value); rerenderSetupPlaybook(); return; }
  if (e.target.id==='playbook-select') { STATE.selectedPlaybookId = e.target.value; STATE.checkedRules = {}; renderTabOnly(); }
  else if (e.target.id==='log-strategy-select') { STATE.selectedPlaybookId = e.target.value; STATE.checkedRules = {}; updateLogPreview(); }
  else if (e.target.id==='log-location-select') { STATE.logFormLocation = e.target.value; updateLogPreview(); }
  else if (e.target.id==='history-strategy-filter') { STATE.historyStrategyFilter = e.target.value; renderTabOnly(); }
  else if (e.target.id==='history-mistake-filter') { STATE.historyMistakeFilter = e.target.value; renderTabOnly(); }
  else if (e.target.id==='history-date-filter') { STATE.historyDateFilter = e.target.value || ''; renderTabOnly(); }
  else if (e.target.id==='analysis-date-filter') { STATE.analysisDateFilter = e.target.value || ''; renderTabOnly(); }
  else if (e.target.id==='note-strategy-select') {
    const row = $('#note-custom-strategy-row');
    if (e.target.value==='__custom__') { row.style.display='flex'; }
    else { row.style.display='none'; STATE.noteFormStrategy = e.target.value; }
  }
  else if (e.target.id==='note-concept-select') {
    STATE.noteFormConcept = e.target.value;
    const row = $('#note-custom-concept-row');
    if (row) row.style.display = e.target.value==='__custom__' ? 'block' : 'none';
  }
  else if (e.target.matches('[data-note-editor-concept]')) {
    const note = STATE.notes.find(n=>n.id===e.target.dataset.noteEditorConcept);
    if(note){
      if(e.target.value==='__custom__'){
        const custom = prompt('Custom concept ka naam?');
        if(custom && custom.trim()){ note.concept='Custom'; note.customConcept=custom.trim(); }
        else { renderTabOnly(); return; }
      } else { note.concept=e.target.value; note.customConcept=''; }
      renderTabOnly();
      scheduleNoteAutoSave(note.id);
    }
  }
  else if (e.target.id==='live-note-image-file') {
    const files=[...e.target.files]; const note=STATE.notes.find(n=>n.id===STATE.activeNoteId);
    if(!files.length || !note) return;
    Promise.all(files.map(readAndCompressImage)).then(srcs=>insertImagesIntoActiveNote(srcs)).catch(err=>alert(err.message||'Image upload failed.'));
    e.target.value='';
  }
  else if (e.target.id==='log-multi-image-file') {
    const files=[...e.target.files]; if(!files.length) return;
    Promise.all(files.map(readAndCompressImage)).then(loaded=>addLogImages(loaded)).catch(err=>alert(err.message || 'Image upload failed.'));
    e.target.value='';
  }
  else if (e.target.id==='log-before-image-file' || e.target.id==='log-after-image-file') {
    const file = e.target.files[0]; if (!file) return;
    readAndCompressImage(file).then(src => {
      if (e.target.id==='log-before-image-file') STATE.logFormBeforeImage = src;
      else STATE.logFormAfterImage = src;
      const extras=(STATE.logFormImages||[]).slice(2);
      STATE.logFormImages=[STATE.logFormBeforeImage,STATE.logFormAfterImage,...extras].filter(Boolean);
      renderLogImagePreview(); updateLogPreview();
    }).catch(err=>alert(err.message || 'Image upload failed.'));
    e.target.value='';
  }
  else if (e.target.id==='edit-multi-image-file') {
    const files=[...e.target.files]; if(!files.length) return;
    Promise.all(files.map(readAndCompressImage)).then(loaded=>{
      const box=$('#edit-images-list');
      loaded.forEach(src=>{ const wrap=document.createElement('div'); wrap.className='edit-image-item'; wrap.innerHTML=`<img src="${esc(imgUrl(src))}" data-src="${esc(src)}"><button type="button" data-action="remove-edit-image">×</button>`; box?.insertBefore(wrap, box.querySelector('.edit-add-image')); });
    }).catch(err=>alert(err.message || 'Image upload failed.'));
    e.target.value='';
  }
  else if (e.target.id==='note-block-image-file') {
    const files=[...e.target.files]; if(!files.length) return;
    Promise.all(files.map(readAndCompressImage)).then(srcs=>{ srcs.forEach(src=>STATE.noteFormBlocks.push({type:'image',src})); renderNoteBlocksEditor(); }).catch(err=>alert(err.message||'Image upload failed.'));
    e.target.value='';
  }
});

function setAnnotatorMode(mode){
  STATE.annotator.mode=mode;
  $('#annotator-pen')?.classList.toggle('active', mode==='pen');
  $('#annotator-eraser')?.classList.toggle('active', mode==='eraser');
}
const plainSrc=v=>String(v||'').split('?')[0];
function openAnnotator(src,noteId=null,blockIndex=null,opts={}){
  const modal=$('#image-modal'), img=$('#modal-image'), canvas=$('#annotator-canvas');
  if(!modal||!img||!canvas) return;
  let baseSrc=src||''; let strokes=[];
  const tradeId=opts.tradeId||null;
  const block = noteId ? (STATE.notes.find(n=>n.id===noteId)?.blocks?.[blockIndex]) : (Number.isInteger(blockIndex) ? STATE.noteFormBlocks?.[blockIndex] : null);
  if(block?.type==='image'){
    baseSrc=block.baseSrc || block.src || baseSrc;
    strokes=Array.isArray(block.drawingStrokes)?structuredClone(block.drawingStrokes):[];
  }
  if(tradeId){
    const t=STATE.trades.find(x=>x.id===tradeId);
    const d=(t?.imageDrawings||[]).find(x=>plainSrc(x.src)===plainSrc(src));
    if(d){ baseSrc=d.baseSrc||src; strokes=Array.isArray(d.strokes)?structuredClone(d.strokes):[]; }
  }
  const canSave = !!(noteId || block || tradeId);
  $('#image-modal .annotator-card')?.classList.toggle('view-only', !canSave);
  const hint=$('#image-modal .annotator-hint'); if(hint) hint.textContent = canSave ? 'Pen se chart par draw karein · Eraser sirf drawing mitata hai, chart nahi' : 'Sirf dekhne ke liye — drawing History ya Notes se karein';
  STATE.annotator={src:src||baseSrc,baseSrc,noteId,blockIndex,tradeId,drawing:false,mode:'pen',color:$('#annotator-color')?.value||'#ef4444',size:Number($('#annotator-size')?.value)||4,pressure:!!$('#annotator-pressure')?.checked,strokes,history:[strokes.map(cloneStroke)],redo:[],activeStroke:null};
  setAnnotatorMode('pen');
  img.src=imgUrl(baseSrc); modal.style.display='flex';
  img.onload=()=>setupAnnotatorCanvas();
  if(img.complete) setupAnnotatorCanvas();
}
function cloneStroke(stroke){ return {mode:stroke.mode||'pen',color:stroke.color||'#ef4444',size:Number(stroke.size)||4,points:(stroke.points||[]).map(p=>({x:Number(p.x),y:Number(p.y),pressure:Number.isFinite(p.pressure)?p.pressure:0.5}))}; }
function setupAnnotatorCanvas(){
  const img=$('#modal-image'), canvas=$('#annotator-canvas'); if(!img||!canvas||!img.naturalWidth) return;
  const rect=img.getBoundingClientRect();
  canvas.width=img.naturalWidth; canvas.height=img.naturalHeight; canvas.style.width=rect.width+'px'; canvas.style.height=rect.height+'px';
  renderAnnotator();
}
function annotatorPoint(e){ const c=$('#annotator-canvas'),r=c.getBoundingClientRect(); return {x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height),pressure:Number.isFinite(e.pressure)&&e.pressure>0?e.pressure:.5}; }
function strokeWidth(stroke,p){ return Math.max(.75, stroke.size*(STATE.annotator.pressure ? (.55 + (p.pressure||.5)*.9) : 1)); }
function drawSmoothStroke(ctx,stroke){
  const pts=stroke.points||[]; if(!pts.length)return;
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.globalCompositeOperation=stroke.mode==='eraser'?'destination-out':'source-over'; ctx.strokeStyle=stroke.color||'#ef4444';
  if(pts.length===1){ctx.beginPath();ctx.arc(pts[0].x,pts[0].y,strokeWidth(stroke,pts[0])/2,0,Math.PI*2);ctx.fillStyle=stroke.color||'#ef4444'; if(stroke.mode==='eraser')ctx.globalCompositeOperation='destination-out';ctx.fill();ctx.restore();return;}
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const p=pts[i], n=pts[i+1]; ctx.lineWidth=strokeWidth(stroke,p); ctx.quadraticCurveTo(p.x,p.y,(p.x+n.x)/2,(p.y+n.y)/2); ctx.stroke(); ctx.beginPath(); ctx.moveTo((p.x+n.x)/2,(p.y+n.y)/2);
  }
  const last=pts[pts.length-1], prev=pts[pts.length-2]; ctx.lineWidth=strokeWidth(stroke,last); ctx.quadraticCurveTo(prev.x,prev.y,last.x,last.y); ctx.stroke(); ctx.restore();
}
function renderAnnotator(){
  const c=$('#annotator-canvas'); if(!c)return; const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); (STATE.annotator.strokes||[]).forEach(st=>drawSmoothStroke(ctx,st)); if(STATE.annotator.activeStroke) drawSmoothStroke(ctx,STATE.annotator.activeStroke);
}
function snapshotAnnotator(){ return (STATE.annotator.strokes||[]).map(cloneStroke); }
function startAnnotator(e){
  const c=$('#annotator-canvas'); if(!c||!STATE.annotator.baseSrc)return; e.preventDefault(); c.setPointerCapture?.(e.pointerId); STATE.annotator.drawing=true;
  const p=annotatorPoint(e); STATE.annotator.activeStroke={mode:STATE.annotator.mode,color:STATE.annotator.color,size:STATE.annotator.size,points:[p]}; renderAnnotator();
}
function moveAnnotator(e){
  if(!STATE.annotator.drawing||!STATE.annotator.activeStroke)return; e.preventDefault();
  const events=e.getCoalescedEvents?e.getCoalescedEvents():[e]; for(const ev of events){ const p=annotatorPoint(ev); const pts=STATE.annotator.activeStroke.points; const last=pts[pts.length-1]; if(!last||Math.hypot(p.x-last.x,p.y-last.y)>=.35)pts.push(p); }
  renderAnnotator();
}
function endAnnotator(){
  if(!STATE.annotator.drawing)return; STATE.annotator.drawing=false;
  if(STATE.annotator.activeStroke?.points?.length){ STATE.annotator.strokes.push(cloneStroke(STATE.annotator.activeStroke)); STATE.annotator.history.push(snapshotAnnotator()); STATE.annotator.redo=[]; if(STATE.annotator.history.length>80)STATE.annotator.history.shift(); }
  STATE.annotator.activeStroke=null; renderAnnotator();
}
function undoAnnotator(){
  if(STATE.annotator.drawing)return; const h=STATE.annotator.history; if(h.length<=1)return; const current=h.pop(); STATE.annotator.redo.push(current.map(cloneStroke)); STATE.annotator.strokes=h[h.length-1].map(cloneStroke); renderAnnotator();
}
function redoAnnotator(){
  if(STATE.annotator.drawing||!STATE.annotator.redo.length)return; const next=STATE.annotator.redo.pop(); STATE.annotator.strokes=next.map(cloneStroke); STATE.annotator.history.push(snapshotAnnotator()); if(STATE.annotator.history.length>80)STATE.annotator.history.shift(); renderAnnotator();
}
function clearAnnotator(){
  if(!STATE.annotator.strokes.length)return; STATE.annotator.redo.push(snapshotAnnotator()); STATE.annotator.strokes=[]; STATE.annotator.history.push([]); if(STATE.annotator.history.length>80)STATE.annotator.history.shift(); renderAnnotator();
}
// Drawing and erasing happen on their own transparent layer, which is then laid on
// top of the chart. (Before, the eraser cut holes into the chart itself, so erased
// areas came out as black/white patches after saving.)
function renderStrokeLayer(width, height, scale){
  const layer=document.createElement('canvas'); layer.width=width; layer.height=height;
  const lctx=layer.getContext('2d'); lctx.save(); lctx.scale(scale,scale);
  (STATE.annotator.strokes||[]).forEach(st=>drawSmoothStroke(lctx,st));
  lctx.restore();
  return layer;
}
function compositeAnnotatedImage(){
  const img=$('#modal-image'); if(!img||!img.naturalWidth)return Promise.resolve('');
  const max=1400, scale=Math.min(1, max/Math.max(img.naturalWidth,img.naturalHeight));
  const w=Math.max(1,Math.round(img.naturalWidth*scale)), h=Math.max(1,Math.round(img.naturalHeight*scale));
  const out=document.createElement('canvas'); out.width=w; out.height=h;
  const ctx=out.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
  ctx.drawImage(img,0,0,w,h);                       // 1) the untouched chart
  ctx.drawImage(renderStrokeLayer(w,h,scale),0,0);  // 2) pen strokes minus eraser strokes
  return Promise.resolve(preuploadImage(out.toDataURL('image/jpeg',.85)));
}
function saveTradeImageDrawing(newSrc){
  const a=STATE.annotator, t=STATE.trades.find(x=>x.id===a.tradeId); if(!t) return;
  const strokes=snapshotAnnotator();
  const finalSrc = strokes.length ? newSrc : a.baseSrc;          // all drawing erased -> back to the original chart
  const old=plainSrc(a.src);
  const swap=v=>plainSrc(v)===old ? finalSrc : v;
  if(Array.isArray(t.images)) t.images=t.images.map(swap);
  ['image','beforeImage','afterImage'].forEach(k=>{ if(t[k]) t[k]=swap(t[k]); });
  t.imageDrawings=(t.imageDrawings||[]).filter(d=>plainSrc(d.src)!==old);
  if(strokes.length) t.imageDrawings.push({src:finalSrc, baseSrc:a.baseSrc, strokes});
  t.updatedAt=new Date().toISOString();
  renderTabOnly();
  saveUserData('Trade', ['trades']);
}
async function saveAnnotatedImage(){
  const img=$('#modal-image'); if(!img||!img.naturalWidth)return;
  const src=await compositeAnnotatedImage();
  const payload={type:'image',src,baseSrc:STATE.annotator.baseSrc,drawingStrokes:snapshotAnnotator()};
  if(STATE.annotator.noteId){
    const note=STATE.notes.find(n=>n.id===STATE.annotator.noteId);
    if(note){ note.blocks=normalizeNoteBlocks(note); if(note.blocks[STATE.annotator.blockIndex])note.blocks[STATE.annotator.blockIndex]=payload; note.image=note.blocks.find(b=>b.type==='image')?.src||null; scheduleNoteAutoSave(note.id); renderTabOnly(); }
  } else if(Number.isInteger(STATE.annotator.blockIndex) && STATE.noteFormBlocks[STATE.annotator.blockIndex]) { STATE.noteFormBlocks[STATE.annotator.blockIndex]=payload; renderNoteBlocksEditor(); }
  else if(STATE.annotator.tradeId){ saveTradeImageDrawing(src); }
  closeAnnotator();
}
function isAnnotatorFullscreen(){ const card=$('#image-modal .annotator-card'); return !!card && (document.fullscreenElement===card || card.classList.contains('is-fullscreen')); }
async function toggleAnnotatorFullscreen(){
  const card=$('#image-modal .annotator-card'); if(!card) return;
  if (isAnnotatorFullscreen()) {
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) {} }
    card.classList.remove('is-fullscreen');
  } else if (card.requestFullscreen) {
    try { await card.requestFullscreen({ navigationUI: 'hide' }); } catch (_) { card.classList.add('is-fullscreen'); }
  } else {
    card.classList.add('is-fullscreen');                    // iPhone Safari: fill the screen with CSS
  }
  updateFullscreenButton(); setTimeout(setupAnnotatorCanvas, 60);
}
function updateFullscreenButton(){ const b=$('#annotator-fullscreen'); if(b){ const on=isAnnotatorFullscreen(); b.textContent = on ? '🗗 Exit full screen' : '⛶ Full screen'; b.setAttribute('aria-pressed', on?'true':'false'); } }
document.addEventListener('fullscreenchange', () => { if(!document.fullscreenElement) $('#image-modal .annotator-card')?.classList.remove('is-fullscreen'); updateFullscreenButton(); setTimeout(setupAnnotatorCanvas, 60); });
window.addEventListener('resize', () => { if($('#image-modal')?.style.display==='flex') setupAnnotatorCanvas(); });
function closeAnnotator(){ const modal=$('#image-modal'); if(document.fullscreenElement) document.exitFullscreen?.().catch(()=>{}); $('#image-modal .annotator-card')?.classList.remove('is-fullscreen'); updateFullscreenButton(); if(modal) modal.style.display='none'; const canvas=$('#annotator-canvas'); canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height); }

async function deleteTrade(id){
  const index = STATE.trades.findIndex(t => t.id === id);
  if (index < 0) return;
  const trade = STATE.trades[index];
  const label = `${trade.symbol || 'this trade'}${trade.pnl !== undefined ? ` (${money(Number(trade.pnl)||0)})` : ''}`;
  if (!confirm(`Delete ${label}?\n\nThis trade will be removed from your journal.`)) return;
  STATE.trades.splice(index, 1);
  const saved = await saveUserData('Trade', ['trades']);
  if (!saved) {
    STATE.trades.splice(index, 0, trade);
    return;
  }
  if (STATE.editingTradeId === id) STATE.editingTradeId = null;
  render();
}

async function updateExistingTrade(id){
  const t=STATE.trades.find(x=>x.id===id); if(!t) return;
  const symbol=$('#edit-symbol')?.value.trim() || t.symbol;
  const qty=parseFloat($('#edit-qty')?.value), entry=parseFloat($('#edit-entry')?.value), exit=parseFloat($('#edit-exit')?.value), sl=parseFloat($('#edit-sl')?.value);
  const type=$('#edit-type')?.value || t.type;
  const selectedEdit = [...document.querySelectorAll('[data-action="toggle-edit-emotion"].selected')].map(x=>x.dataset.value);
  const customEdit = $('#edit-custom-emotion')?.value.split(',').map(x=>x.trim()).filter(Boolean) || [];
  const emotions = [...new Set([...selectedEdit, ...customEdit])];
  const emotion = emotions.join(' · ') || t.emotion || ''; 
  const images=[...document.querySelectorAll('#edit-images-list img')].map(x=>x.dataset.src).filter(Boolean);
  const hasExit=Number.isFinite(exit), canPnl=Number.isFinite(entry)&&hasExit&&Number.isFinite(qty);
  // Exit cleared => trade is open again, so P&L/R go back to 0 instead of keeping the old result.
  const pnl=canPnl?Math.round((type==='LONG'?(exit-entry)*qty:(entry-exit)*qty)*100)/100:(hasExit?(t.pnl||0):0);
  const rr=(Number.isFinite(sl)&&Number.isFinite(entry)&&hasExit&&entry!==sl)?Math.round(((type==='LONG'?exit-entry:entry-exit)/Math.abs(entry-sl))*100)/100:(hasExit?(t.rr||0):0);
  const strategy=$('#edit-strategy')?.value || t.strategy;
  const isSetupTrade=strategy!==NO_SETUP_STRATEGY;
  const mistake=$('#edit-mistake')?.value || t.mistake || 'none';
  const quality=Number($('#edit-quality')?.value) || t.quality || 3;
  const notes=$('#edit-notes') ? $('#edit-notes').value.trim() : (t.notes||'');
  const snapshot = JSON.parse(JSON.stringify(t));
  Object.assign(t,{symbol:symbol.toUpperCase(),type,emotions,quantity:Number.isFinite(qty)?qty:t.quantity,entryPrice:Number.isFinite(entry)?entry:null,exitPrice:Number.isFinite(exit)?exit:null,stopLoss:Number.isFinite(sl)?sl:null,tradeDateTime:$('#edit-trade-datetime')?.value || t.tradeDateTime || t.date,emotion,exitReason:$('#edit-exit-reason')?.value.trim()||'',notes,strategy,isSetupTrade,mistake,quality,followedPlan:isSetupTrade&&mistake==='none',updatedAt:new Date().toISOString(),images,beforeImage:images[0]||null,afterImage:images[1]||null,image:images[0]||null,pnl,rr});
  const saved = await saveUserData('Trade', ['trades']);
  if (!saved) { Object.assign(t, snapshot); return; }
  STATE.editingTradeId=null; render();
}

document.addEventListener('input', (e) => {
  if (e.target.id !== 'history-search') return;
  STATE.historySearch = e.target.value;
  clearTimeout(STATE.historySearchTimer);
  STATE.historySearchTimer = setTimeout(() => {
    const pos = e.target.selectionStart;
    renderTabOnly();
    const box = $('#history-search');
    if (box) { box.focus(); try { box.setSelectionRange(pos, pos); } catch (_) {} }
  }, 200);
});

document.addEventListener('submit', async (e) => {
  if (e.target.id==='log-form') {
    e.preventDefault();
    const symbol = $('#log-symbol').value.trim();
    const entry = $('#log-entry').value, exit = $('#log-exit').value, qty = $('#log-qty').value;
    if (!symbol || !qty) { alert('Please fill out Trading Pair and Lot Size. Entry, Exit and SL are optional.'); return; }
    const customEmotion = $('#log-custom-emotion')?.value.trim() || '';
    const finalEmotions = [...new Set([...(STATE.logEmotions||[]), ...(customEmotion ? [customEmotion] : [])].filter(Boolean))];
    if (!finalEmotions.length) { alert('Please select an emotion or enter your custom emotion.'); return; }
    const p = computeLogPreview();
    const plannedEntry = parseFloat($('#log-planned-entry')?.value) || (entry ? parseFloat(entry) : null);
    const plannedSL = parseFloat($('#log-planned-sl')?.value) || ($('#log-sl').value ? parseFloat($('#log-sl').value) : null);
    const plannedTP = parseFloat($('#log-planned-tp')?.value) || null;
    const plannedRR = plannedSL && plannedEntry !== plannedSL && plannedTP ? Math.round((Math.abs(plannedTP-plannedEntry)/Math.abs(plannedEntry-plannedSL))*100)/100 : null;
    const selectedStrategy = findStrategy(STATE.selectedPlaybookId);
    const strategyName = STATE.logFormIsSetup ? (selectedStrategy.name || 'No Strategy') : 'Bina Setup (Tukke Baazi)';
    const mindset = findMindset(STATE.selectedMindsetId);
    const newTrade = {
      id:`t-${Date.now()}`, symbol: symbol.toUpperCase(), type: $('#log-type').value, isSetupTrade: STATE.logFormIsSetup,
      entryPrice: entry === '' ? null : parseFloat(entry), exitPrice: exit === '' ? null : parseFloat(exit), quantity: parseFloat(qty),
      stopLoss: $('#log-sl').value ? parseFloat($('#log-sl').value) : null, takeProfit: null,
      strategy: strategyName, emotions: finalEmotions, emotion: finalEmotions.join(' · '), emotionPreset: null, device: STATE.logFormDevice, location: STATE.logFormLocation,
      notes: ($('#log-notes')?.value || '').trim(), exitReason: $('#log-exit-reason')?.value.trim() || '', image: currentLogImages()[0] || null, beforeImage: currentLogImages()[0] || null, afterImage: currentLogImages()[1] || null, images: currentLogImages(),
      plannedEntry, plannedSL, plannedTP, plannedRR, mistake: $('#log-mistake').value, quality: Number($('#log-quality').value), followedPlan: STATE.logFormIsSetup && $('#log-mistake').value==='none',
      date: new Date().toISOString(), tradeDateTime: $('#log-trade-datetime')?.value || new Date().toISOString(), pnl: p.pnl, rr: p.rr, xpEarned: p.xp
    };
    STATE.trades.unshift(newTrade);
    const saved = await saveUserData('Trade', ['trades']);
    if (!saved) { STATE.trades = STATE.trades.filter(t => t.id !== newTrade.id); return; }
    STATE.logFormImage = ''; STATE.logFormBeforeImage = ''; STATE.logFormAfterImage = ''; STATE.logFormImages = []; STATE.logEmotions = []; STATE.logCustomEmotion = '';
    STATE.activeTab = 'history';
    render();
  }
  else if (e.target.id==='notes-form') {
    e.preventDefault();
    const analysis = $('#note-analysis').value.trim(), learning = $('#note-learning').value.trim();
    if (!analysis && !learning) { alert('Please add at least an analysis or a learning/summary!'); return; }
    const blocks = noteBlocksForForm();
    const notePayload = {
      symbol: $('#note-symbol').value.trim() || 'General', image: blocks.find(b=>b.type==='image')?.src || null,
      blocks, strategy: STATE.noteFormStrategy, concept: STATE.noteFormConcept === '__custom__' ? (STATE.noteFormCustomConcept.trim() || 'Custom') : STATE.noteFormConcept, customConcept: STATE.noteFormConcept === '__custom__' ? (STATE.noteFormCustomConcept.trim() || 'Custom') : '', entryCriteria: $('#note-entry').value.trim(), exitCriteria: $('#note-exit').value.trim(),
      analysis, learning
    };
    if (STATE.editingNoteId) {
      const idx = STATE.notes.findIndex(n => n.id === STATE.editingNoteId);
      if (idx >= 0) STATE.notes[idx] = {...STATE.notes[idx], ...notePayload, date: STATE.notes[idx].date || new Date().toISOString(), updatedAt: new Date().toISOString()};
      STATE.activeNoteId = STATE.editingNoteId;
    } else {
      STATE.notes.unshift({id:`n-${Date.now()}`, ...notePayload, date: new Date().toISOString()});
      STATE.activeNoteId = STATE.notes[0]?.id || null;
    }
    STATE.editingNoteId = null;
    STATE.noteFormImage = ''; STATE.noteFormBlocks = []; STATE.noteFormConcept = 'General'; STATE.noteFormCustomConcept = '';
    renderTabOnly();
    saveUserData('Note', ['notes']);
  }
});

/* ---------------- PWA install ---------------- */
let deferredInstallPrompt = null;
function isStandalone(){
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isMobile(){ return /android|iphone|ipad|ipod/i.test(navigator.userAgent) || window.innerWidth <= 700; }
function updateInstallButton(){
  const btn = $('#install-app-btn');
  if (!btn || isStandalone()) { if (btn) btn.style.display='none'; return; }
  if (deferredInstallPrompt || isMobile()) btn.style.display='inline-flex';
}
async function installPWA(){
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice.catch(()=>null);
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  const modal = $('#install-modal');
  const msg = $('#install-message');
  const confirm = $('#install-confirm-btn');
  if (isIOS()) {
    msg.textContent = 'Safari mein neeche Share button dabayein, phir “Add to Home Screen” select karein.';
    confirm.style.display='none';
  } else {
    msg.textContent = 'Browser menu se “Install Trader Co-Pilot” / “Add to Home Screen” choose karein. Chrome/Edge mein install icon address bar mein bhi aa sakta hai.';
    confirm.style.display='none';
  }
  modal.style.display='flex';
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});
$('#install-app-btn')?.addEventListener('click', installPWA);
$('#install-modal-close')?.addEventListener('click', () => $('#install-modal').style.display='none');
$('#install-modal')?.addEventListener('click', e => { if (e.target.id==='install-modal') e.currentTarget.style.display='none'; });
$('#install-confirm-btn')?.addEventListener('click', installPWA);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(err => console.warn('PWA registration failed', err)));
}
window.addEventListener('resize', updateInstallButton);
updateInstallButton();

/* ---------------- boot ---------------- */
init();
