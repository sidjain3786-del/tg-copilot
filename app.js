const APP_VERSION = '26';   // shown in Admin → System check; bump on every release
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
function afterTabRender(){ try { if(LAST_RENDERED_TAB==='copilot' && STATE.activeTab!=='copilot') markQuoteSeen(); playTabEnter(); playDashboardIntro(); } catch (e) { console.warn('motion skipped', e); } }

/* ---------------- auth flow ---------------- */
let authMode = 'login';

function showLoading(){ $('#loading-screen').style.display='flex'; $('#auth-screen').style.display='none'; $('#app-screen').style.display='none'; }
function showAuth(){ $('#loading-screen').style.display='none'; $('#auth-screen').style.display='flex'; $('#app-screen').style.display='none'; }
// Deep links: /#blog opens the Blog, /#admin opens the Blog post editor (admins only).
function applyDeepLink(){
  const h=(location.hash||'').replace(/^#\/?/,'').toLowerCase();
  if(!h) return false;
  const tabs=TABS.map(t=>t.id);
  if(h==='admin' && isAdmin()){ STATE.activeTab='admin'; history.replaceState(null,'',location.pathname+location.search); return true; }
  if(h==='admin' || h==='blog/new'){
    STATE.activeTab='blog'; const b=blogState(); b.current=null;
    if(isAdmin()){ b.editing=newBlogDraft(); b.view='edit'; b.preview=false; b.dirty=false; }
    else { b.view='list'; setTimeout(()=>alert('Yeh admin link hai. Aapka email ADMIN_EMAILS mein nahi hai, isliye sirf Blog khula hai.'),300); }
  } else if(tabs.includes(h)) { if(TAB_FEATURE[h] && !featureVisible(TAB_FEATURE[h])) { history.replaceState(null,'',location.pathname+location.search); return false; } STATE.activeTab=h; if(h==='blog'){ const b=blogState(); b.view='list'; b.current=null; } }
  else return false;
  history.replaceState(null,'',location.pathname+location.search);   // clean URL after opening
  return true;
}
window.addEventListener('hashchange', ()=>{ if(STATE.user && applyDeepLink()) render(); });
function showApp(){
  applyDeepLink();
  if(STATE.activeTab==='admin' && !isAdmin()) STATE.activeTab='copilot';
  applyFeatureClasses();
  setTimeout(maybeShowPrivacyNotice, 1500);
  setTimeout(()=>{ if(STATE.user) loadBlog(); }, 800);
  if(STATE.user && !STATE.quotes?.loaded) loadQuotes();
  if(STATE.user && !STATE.ann?.loaded) loadAnnouncements();
  applyFeatureClasses();
  if(!PUSH.checked) checkPush(); $('#loading-screen').style.display='none'; $('#auth-screen').style.display='none'; $('#app-screen').style.display='block'; render(); }

function setAuthMode(mode){
  authMode = mode;
  $('#auth-name-field').style.display = mode==='signup' ? 'block' : 'none';
  $('#auth-subtitle').textContent = mode==='signup' ? 'Naya account banao' : 'Apne account mein login karo';
  $('#auth-submit').textContent = mode==='signup' ? 'Sign Up' : 'Login';
  const pn=$('#auth-privacy'); if(pn) pn.style.display = mode==='signup' ? 'block' : 'none';
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
  IMAGE_URL_CACHE.clear(); IMAGE_STORE_AVAILABLE = true; STATE.blog = null; STATE.admin = null; STATE.quotes = null; STATE.ann = null; STATE.features = {}; $('#privacy-notice')?.remove();
  STATE.user = null; STATE.trades = []; STATE.notes = []; STATE.customStrategies = []; STATE.sessionNotes = {};
  setAuthMode('login');
  showAuth();
});

async function loadUserData(){
  const [data] = await Promise.all([api('/api/data'), loadFeatures()]);
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
  {id:'risk', label:'🛡️ Risk Center'},
  {id:'blog', label:'📰 Blog'},
  {id:'admin', label:'🛠️ Admin'}
];
function visibleTabs(){ return TABS.filter(t=>(t.id!=='admin' || isAdmin()) && (!TAB_FEATURE[t.id] || featureVisible(TAB_FEATURE[t.id]))); }
function renderTabNav(){
  $('#tab-nav').innerHTML = visibleTabs().map(t =>
    `<button class="tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}">${t.label}${isAdmin()&&TAB_FEATURE[t.id]&&!featureOn(TAB_FEATURE[t.id])?'<span class="tab-off" title="Traders ke liye band">OFF</span>':''}${t.id==='blog'&&STATE.blog?.loaded&&blogUnreadCount()?`<span class="tab-dot" aria-label="${blogUnreadCount()} new posts">${blogUnreadCount()}</span>`:''}</button>`
  ).join('');
  try { placeTabIndicator(); } catch (e) { console.warn('indicator skipped', e); }
  const mobileIcons = {copilot:'⚡',log:'➕',notes:'🧠',history:'📜',analysis:'📊',risk:'🛡️',blog:'📰',admin:'🛠️'};
  const mobileLabels = {copilot:'Co-Pilot',log:'Log',notes:'Notes',history:'History',analysis:'Analysis',risk:'Risk',blog:'Blog',admin:'Admin'};
  const unread = STATE.blog?.loaded ? blogUnreadCount() : 0;
  const mobile = $('#mobile-tab-nav');
  if (mobile) mobile.style.gridTemplateColumns = `repeat(${visibleTabs().length}, 1fr)`;
  if (mobile) mobile.innerHTML = visibleTabs().map(t =>
    `<button class="mobile-tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}"><span class="mobile-tab-icon">${mobileIcons[t.id]}${t.id==='blog'&&unread?'<i class="tab-dot-mini" aria-hidden="true"></i>':''}</span><span>${mobileLabels[t.id]}</span></button>`
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
      <small>${risk.todayTrades.length} trade${risk.todayTrades.length===1?'':'s'} aaj${featureVisible('risk')?` · loss budget ${risk.dailyLimit>0?`${Math.round(budgetUsedPct)}% used`:'set nahi hai'}`:''}</small>
      ${featureVisible('risk') && risk.dailyLimit>0?`<div class="hero-budget" aria-hidden="true"><i class="${budgetUsedPct>=75?'hot':''}" style="width:${Math.max(2,budgetUsedPct)}%"></i></div>`:''}
    </div>
    <div class="hero-actions"><button class="btn-cta" data-action="set-tab" data-tab="log">＋ Log New Trade</button><button type="button" class="btn-hero-ghost" data-action="open-weekly-report">📄 Weekly report</button></div>
  </section>
  ${renderDashMessages()}

  <div class="dashboard-kpis">
    <div class="card dashboard-kpi"><span class="uppercase-label">Total Trades</span><strong>${total}</strong><small>${wins} wins · ${losses} losses</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Net P&amp;L</span><strong class="${pnl>=0?'positive':'negative'}">${money(pnl)}</strong><small>All recorded trades</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Win Rate</span><strong>${total?Math.round(wins/total*100):0}%</strong><small>${wins} profitable trades</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Average R</span><strong>${avgR.toFixed(2)}R</strong><small>Per trade</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Rule Following</span><strong>${ruleRate}%</strong><small>${followed}/${total||0} trades followed plan</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Avg Quality</span><strong>${avgQuality.toFixed(1)}/5</strong><small>Self-rated execution</small></div>
  </div>

  ${featureVisible('playbook') ? renderSetupPlaybook() : ''}

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
        <div class="field grid-2 fast-journal-time-fields">
          <div><label>Trade Date &amp; Time <span class="optional-label">used for session analysis</span></label><input type="datetime-local" id="log-trade-datetime" value="${esc(localDateTimeInputValue())}"></div>
          <div><label>Exit Reason <span class="optional-label">optional</span></label><input type="text" id="log-exit-reason" placeholder="Target, SL, manual, time, news..."></div>
        </div>
        <div class="field quick-note-field">
          <label for="log-notes">Quick Note <span class="optional-label">optional</span></label>
          <div class="quick-note-box">
            <textarea id="log-notes" rows="3" maxlength="1000" placeholder="Kya sahi hua? Kya improve karna hai? Trade ke time dimaag mein kya chal raha tha?"></textarea>
            <button type="button" class="voice-btn quick-note-mic" data-action="voice-type" data-voice-for="log-notes" title="Bolkar likho" aria-label="Voice typing" aria-pressed="false">🎤</button>
          </div>
          <small class="quick-note-hint">🎤 dabakar bol bhi sakte ho</small>
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
              <button type="button" class="note-format-btn voice-btn" data-action="voice-type" data-voice-for="${esc(active.id)}:${i}" title="Bolkar likho (voice typing)" aria-label="Voice typing" aria-pressed="false">🎤</button>
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
  <div class="card history-toolbar"><button type="button" class="btn-secondary btn-small history-report-btn" data-action="open-weekly-report">📄 Weekly report (PDF)</button><div class="history-toolbar-title"><strong>View</strong><span>${mode==='grid'?'Compact cards':mode==='list'?'Quick rows':mode==='detailed'?'Full journal':'Screenshot focused'}</span></div><div class="history-view-switcher">${historyViewButton('grid','▦','Grid')}${historyViewButton('list','☰','List')}${historyViewButton('detailed','📖','Detailed')}${historyViewButton('gallery','🖼','Gallery')}</div></div>
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
    <div class="field grid-2"><div><label>Execution quality</label><select id="edit-quality">${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(t.quality||3)===n?'selected':''}>${'⭐'.repeat(n)} ${n}/5</option>`).join('')}</select></div><div><label class="voice-label">Quick note<button type="button" class="voice-btn voice-btn-inline" data-action="voice-type" data-voice-for="edit-notes" title="Bolkar likho" aria-label="Voice typing" aria-pressed="false">🎤</button></label><textarea id="edit-notes" rows="2" placeholder="Kya sahi hua? Kya improve karna hai?">${esc(t.notes||'')}</textarea></div></div>
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



/* ---------------- weekly report (PDF download) ----------------
   Builds a Monday–Sunday report from the journal and downloads it as a PDF.
   jsPDF is bundled in /vendor and loaded only when a report is made. */
function weekStartOf(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtDay(d,opts){ return d.toLocaleDateString('en-IN',opts||{day:'numeric',month:'short'}); }
function weekLabel(start){ const end=addDays(start,6); return `${fmtDay(start)} – ${fmtDay(end,{day:'numeric',month:'short',year:'numeric'})}`; }
function tradesInWeek(start){
  const from=localDateKey(start), to=localDateKey(addDays(start,6));
  return STATE.trades.filter(t=>{ const k=tradeLocalDate(t); return k && k>=from && k<=to; }).sort((a,b)=>tradeSortTime(a)-tradeSortTime(b));
}
function weeklyReportData(start){
  const trades=tradesInWeek(start), closed=trades.filter(t=>!isOpenTrade(t));
  const pnlOf=t=>Number(t.pnl)||0, sum=l=>l.reduce((a,t)=>a+pnlOf(t),0);
  const wins=closed.filter(t=>pnlOf(t)>0), losses=closed.filter(t=>pnlOf(t)<0);
  const grossWin=sum(wins), grossLoss=Math.abs(sum(losses));
  const group=(keyFn)=>{ const m={}; closed.forEach(t=>{ const k=keyFn(t); if(!k) return; const g=m[k]||(m[k]={name:k,trades:0,wins:0,pnl:0,r:0}); g.trades++; if(pnlOf(t)>0) g.wins++; g.pnl+=pnlOf(t); g.r+=Number(t.rr)||0; }); return Object.values(m).map(g=>({...g,winRate:g.trades?Math.round(g.wins/g.trades*100):0,avgR:g.trades?g.r/g.trades:0})).sort((a,b)=>b.pnl-a.pnl); };
  const days=[...Array(7)].map((_,i)=>{ const d=addDays(start,i), key=localDateKey(d), list=closed.filter(t=>tradeLocalDate(t)===key); return {label:fmtDay(d,{weekday:'short',day:'numeric',month:'short'}), trades:list.length, wins:list.filter(t=>pnlOf(t)>0).length, pnl:sum(list)}; });
  let run=0; const curve=closed.map(t=>(run+=pnlOf(t)));
  const prev=tradesInWeek(addDays(start,-7)).filter(t=>!isOpenTrade(t));
  const followed=closed.filter(t=>t.followedPlan), broken=closed.filter(t=>!t.followedPlan);
  const sessions=sessionGroupsForTrades(closed).filter(g=>g.trades>0).sort((a,b)=>b.pnl-a.pnl);
  const best=[...closed].sort((a,b)=>pnlOf(b)-pnlOf(a))[0], worst=[...closed].sort((a,b)=>pnlOf(a)-pnlOf(b))[0];
  return {
    start, end:addDays(start,6), label:weekLabel(start), trades, closed, open:trades.length-closed.length,
    wins:wins.length, losses:losses.length, pnl:sum(closed), prevPnl:sum(prev), prevTrades:prev.length,
    winRate:closed.length?Math.round(wins.length/closed.length*100):0,
    avgR:closed.length?closed.reduce((a,t)=>a+(Number(t.rr)||0),0)/closed.length:0,
    profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),
    avgWin:wins.length?grossWin/wins.length:0, avgLoss:losses.length?-grossLoss/losses.length:0,
    ruleRate:closed.length?Math.round(followed.length/closed.length*100):0, followedPnl:sum(followed), brokenPnl:sum(broken), followedN:followed.length, brokenN:broken.length,
    quality:closed.length?closed.reduce((a,t)=>a+(Number(t.quality)||3),0)/closed.length:0,
    best, worst, days, curve, sessions,
    strategies:group(t=>tradeStrategyName(t)),
    mistakes:group(t=>t.mistake&&t.mistake!=='none'?mistakeLabel(t.mistake):null).sort((a,b)=>a.pnl-b.pnl),
    emotions:group(t=>emotionText(t)),
    notes:trades.filter(t=>t.notes)
  };
}
function openWeeklyReport(){ STATE.report={ open:true, start:weekStartOf(new Date()), screenshots:STATE.report?.screenshots ?? true, busy:false }; renderWeeklyReportModal(); }
function closeWeeklyReport(){ if(STATE.report) STATE.report.open=false; const h=$('#report-host'); if(h) h.innerHTML=''; }
function renderWeeklyReportModal(){
  let host=$('#report-host'); if(!host){ host=document.createElement('div'); host.id='report-host'; document.body.appendChild(host); }
  const r=STATE.report; if(!r?.open){ host.innerHTML=''; return; }
  const d=weeklyReportData(r.start), cur=weekStartOf(new Date()), isCurrent=r.start.getTime()===cur.getTime();
  const shots=d.trades.reduce((a,t)=>a+tradeImages(t).length,0);
  const delta=d.pnl-d.prevPnl;
  host.innerHTML=`<div class="edit-overlay sm-overlay" data-action="report-backdrop"><div class="edit-modal sm-modal report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
    <div class="edit-modal-head"><div><h2 class="section-title" id="report-title">📄 Weekly report</h2><p class="card-sub">Hafte ka poora hisaab ek PDF mein — download karke save ya share karo.</p></div><button type="button" class="modal-x" data-action="close-weekly-report" aria-label="Close">×</button></div>
    <div class="report-week-nav">
      <button type="button" class="btn-secondary btn-small" data-action="report-week" data-step="-1" aria-label="Previous week">‹ Pichhla</button>
      <div><strong>${esc(d.label)}</strong><small>${isCurrent?'Is hafte':'Mon – Sun'}</small></div>
      <button type="button" class="btn-secondary btn-small" data-action="report-week" data-step="1" ${isCurrent?'disabled':''} aria-label="Next week">Agla ›</button>
    </div>
    ${d.trades.length ? `<div class="report-summary">
      <div><span>Trades</span><strong>${d.closed.length}${d.open?`<small> +${d.open} open</small>`:''}</strong></div>
      <div><span>Win rate</span><strong>${d.winRate}%</strong></div>
      <div><span>Net P&amp;L</span><strong class="${d.pnl>=0?'positive':'negative'}">${money(d.pnl)}</strong></div>
      <div><span>vs last week</span><strong class="${delta>=0?'positive':'negative'}">${d.prevTrades?money(delta):'—'}</strong></div>
      <div><span>Avg R</span><strong>${d.avgR.toFixed(2)}R</strong></div>
      <div><span>Rules followed</span><strong>${d.ruleRate}%</strong></div>
    </div>
    <p class="report-includes">PDF mein: summary, din-wise P&amp;L, equity curve, strategy, mistakes ki keemat, emotions, sessions, poori trade list aur trade notes.</p>
    <label class="report-check"><input type="checkbox" id="report-screenshots" ${r.screenshots?'checked':''} ${shots?'':'disabled'}> Chart screenshots bhi daalo <small>(${shots} image${shots===1?'':'s'}${shots?' · PDF thodi badi hogi':''})</small></label>`
    : `<div class="report-empty">Is hafte koi trade log nahi hua. ‹ Pichhla dabake purana hafta chuno.</div>`}
    <p class="sm-error" id="report-status" role="status"></p>
    <div class="sm-form-actions"><button type="button" class="btn-secondary" data-action="close-weekly-report">Cancel</button><button type="button" class="btn-primary" data-action="download-weekly-report" ${d.trades.length&&!r.busy?'':'disabled'}>${r.busy?'PDF ban rahi hai…':'⬇️ Download PDF'}</button></div>
  </div></div>`;
}
let PDF_LIB_PROMISE=null;
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(new Error('PDF tool load nahi hua — internet check karke dobara try karo.')); document.head.appendChild(s); }); }
function loadPdfLib(){
  if(window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  if(!PDF_LIB_PROMISE) PDF_LIB_PROMISE=loadScript('/vendor/jspdf.umd.min.js').then(()=>loadScript('/vendor/jspdf.plugin.autotable.min.js')).then(()=>window.jspdf.jsPDF).catch(e=>{ PDF_LIB_PROMISE=null; throw e; });
  return PDF_LIB_PROMISE;
}
// Built-in PDF fonts can't draw ₹ or emoji, so text is made PDF-safe.
function pdfText(v){
  return String(v??'').replace(/₹/g,'Rs ').replace(/[–—]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/…/g,'...').replace(/•/g,'-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g,'').replace(/[ \t]{2,}/g,' ').trim();
}
function pdfMoney(n){ n=Number(n)||0; const sym=pdfText(currencySymbol())||'Rs'; return `${n>=0?'+':'-'}${sym}${sym.length>1&&!sym.endsWith(' ')?' ':''}${fmtAmount(n)}`; }
async function imageForPdf(src, maxW=1400){
  const res=await fetch(imgUrl(src),{credentials:'same-origin'}); if(!res.ok) throw new Error('img '+res.status);
  const bmp=await createImageBitmap(await res.blob());
  const scale=Math.min(1, maxW/bmp.width), c=document.createElement('canvas'); c.width=Math.round(bmp.width*scale); c.height=Math.round(bmp.height*scale);
  const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(bmp,0,0,c.width,c.height); bmp.close&&bmp.close();
  return { data:c.toDataURL('image/jpeg',.78), w:c.width, h:c.height };
}
async function buildWeeklyPdf(d, opts={}){
  const jsPDF=await loadPdfLib();
  const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
  const W=210, M=14, CW=W-2*M; const INK=[19,35,63], MUTED=[90,106,128], LINE=[226,231,238], GOLD=[233,161,0], GREEN=[11,154,106], RED=[224,65,63];
  const col=v=>v>=0?GREEN:RED;
  let y=0;
  const ensure=h=>{ if(y+h>282){ doc.addPage(); y=18; } };
  const heading=(txt,sub)=>{ ensure(16); doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text(pdfText(txt),M,y); if(sub){ doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(pdfText(sub),M,y+4.5); y+=4.5; } y+=4; };
  const table=(head,body,colStyles={},extra={})=>{ doc.autoTable({ startY:y, head:[head.map(pdfText)], body:body.map(r=>r.map(c=>typeof c==='object'&&c!==null?{...c,content:pdfText(c.content)}:pdfText(c))), margin:{left:M,right:M}, theme:'grid',
    styles:{font:'helvetica',fontSize:8,cellPadding:1.8,lineColor:LINE,lineWidth:.2,textColor:[15,27,45],overflow:'linebreak'}, headStyles:{fillColor:[237,242,248],textColor:INK,fontStyle:'bold'}, columnStyles:colStyles, ...extra });
    y=doc.lastAutoTable.finalY+8; };
  const pnlCell=v=>({content:pdfMoney(v), styles:{textColor:col(v),fontStyle:'bold',halign:'right'}});

  // header band
  doc.setFillColor(...INK); doc.rect(0,0,W,34,'F'); doc.setFillColor(...GOLD); doc.rect(0,34,W,1.2,'F');
  let TX=M;   // text starts after the logo
  try { const logo=await imageForPdf('/icon-maskable-192.png', 192); doc.addImage(logo.data,'JPEG',M,7,20,20); TX=M+25; } catch(_) {}
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text('Weekly Trading Report',TX,15);
  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(200,213,230);
  doc.text(pdfText(`${STATE.user?.name||'Trader'}  |  ${d.label}`),TX,23);
  doc.setFontSize(8); doc.text(pdfText(`Generated ${new Date().toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}  |  Trader Co-Pilot`),TX,29);
  y=44;

  // KPI boxes
  const pf=d.profitFactor===Infinity?'All wins':d.profitFactor.toFixed(2);
  const kpis=[['Net P&L',pdfMoney(d.pnl),col(d.pnl)],['Trades',`${d.closed.length}${d.open?` (+${d.open} open)`:''}`],['Win rate',`${d.winRate}%`],['Avg R',`${d.avgR.toFixed(2)}R`],
    ['Profit factor',pf],['Rules followed',`${d.ruleRate}%`],['Avg win / loss',`${pdfMoney(d.avgWin)} / ${pdfMoney(d.avgLoss)}`],['vs last week',d.prevTrades?pdfMoney(d.pnl-d.prevPnl):'-',d.prevTrades?col(d.pnl-d.prevPnl):null]];
  const bw=(CW-6)/4, bh=17;
  kpis.forEach(([label,val,c],i)=>{ const x=M+(i%4)*(bw+2), yy=y+Math.floor(i/4)*(bh+2);
    doc.setDrawColor(...LINE); doc.setFillColor(250,251,253); doc.roundedRect(x,yy,bw,bh,2,2,'FD');
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(pdfText(label).toUpperCase(),x+3,yy+5.5);
    doc.setFont('helvetica','bold'); doc.setFontSize(val.length>16?8.5:11.5); doc.setTextColor(...(c||INK)); doc.text(pdfText(val),x+3,yy+12.5); });
  y+=2*bh+2+9;

  // equity curve
  heading('Equity curve (this week)', 'Har closed trade ke baad cumulative P&L');
  const ch=42, cx=M, cy=y; doc.setDrawColor(...LINE); doc.setFillColor(250,251,253); doc.roundedRect(cx,cy,CW,ch,2,2,'FD');
  if(d.curve.length){ const pts=[0,...d.curve], mn=Math.min(...pts), mx=Math.max(...pts), rg=(mx-mn)||1, px=i=>cx+6+i*((CW-12)/Math.max(1,pts.length-1)), py=v=>cy+ch-6-((v-mn)/rg)*(ch-12);
    doc.setDrawColor(184,196,212); doc.setLineDashPattern([1,1],0); doc.line(cx+4,py(0),cx+CW-4,py(0)); doc.setLineDashPattern([],0);
    doc.setDrawColor(31,58,99); doc.setLineWidth(.7); for(let i=1;i<pts.length;i++) doc.line(px(i-1),py(pts[i-1]),px(i),py(pts[i]));
    doc.setFillColor(...GOLD); doc.circle(px(pts.length-1),py(pts.at(-1)),1.3,'F'); doc.setLineWidth(.2);
    doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(pdfText(`High ${pdfMoney(mx)}   Low ${pdfMoney(mn)}`),cx+CW-4,cy+5,{align:'right'}); }
  else { doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text('Koi closed trade nahi.',cx+4,cy+8); }
  y=cy+ch+9;

  heading('Day by day');
  table(['Day','Trades','Wins','Net P&L'], d.days.map(x=>[x.label,String(x.trades),String(x.wins),x.trades?pnlCell(x.pnl):{content:'-',styles:{halign:'right',textColor:MUTED}}]), {1:{halign:'center'},2:{halign:'center'},3:{halign:'right'}});
  heading('By strategy');
  table(['Strategy','Trades','Win rate','Avg R','Net P&L'], d.strategies.map(g=>[g.name,String(g.trades),`${g.winRate}%`,`${g.avgR.toFixed(2)}R`,pnlCell(g.pnl)]), {1:{halign:'center'},2:{halign:'center'},3:{halign:'center'},4:{halign:'right'}});
  heading('Discipline', 'Rules follow kiye vs rules tode');
  table(['','Trades','Net P&L'], [['Rules followed',String(d.followedN),pnlCell(d.followedPnl)],['Rules broken',String(d.brokenN),pnlCell(d.brokenPnl)]], {1:{halign:'center'},2:{halign:'right'}});
  if(d.mistakes.length){ heading('Mistakes and their cost'); table(['Mistake','Times','Net P&L'], d.mistakes.map(g=>[g.name,String(g.trades),pnlCell(g.pnl)]), {1:{halign:'center'},2:{halign:'right'}}); }
  heading('Emotions'); table(['Emotion','Trades','Win rate','Net P&L'], d.emotions.map(g=>[g.name,String(g.trades),`${g.winRate}%`,pnlCell(g.pnl)]), {1:{halign:'center'},2:{halign:'center'},3:{halign:'right'}});
  if(d.sessions.length){ heading('Sessions (UTC)'); table(['Session','Trades','Win rate','Net P&L'], d.sessions.map(g=>[g.name,String(g.trades),`${g.winRate??0}%`,pnlCell(g.pnl)]), {1:{halign:'center'},2:{halign:'center'},3:{halign:'right'}}); }
  if(d.best||d.worst){ heading('Best and worst trade'); table(['','Trade','When','P&L'], [d.best&&['Best',`${d.best.symbol||''} ${d.best.type||''} - ${tradeStrategyName(d.best)}`,formatTradeTime(d.best),pnlCell(Number(d.best.pnl)||0)], d.worst&&d.worst!==d.best&&['Worst',`${d.worst.symbol||''} ${d.worst.type||''} - ${tradeStrategyName(d.worst)}`,formatTradeTime(d.worst),pnlCell(Number(d.worst.pnl)||0)]].filter(Boolean), {3:{halign:'right'}}); }

  // trade log
  doc.addPage(); y=18;
  heading('All trades this week', `${d.trades.length} trade${d.trades.length===1?'':'s'}`);
  table(['When','Symbol','Side','Strategy','Entry','Exit','Qty','P&L','R','Mistake'],
    d.trades.map(t=>[formatTradeTime(t),t.symbol||'-',t.type||'-',tradeStrategyName(t),String(t.entryPrice??'-'),String(t.exitPrice??'-'),String(t.quantity??'-'),
      isOpenTrade(t)?{content:'Open',styles:{halign:'right',textColor:[201,138,0]}}:pnlCell(Number(t.pnl)||0), isOpenTrade(t)?'-':String(t.rr??'-'), t.mistake&&t.mistake!=='none'?mistakeLabel(t.mistake):'-']),
    {0:{cellWidth:27},1:{fontStyle:'bold'},7:{halign:'right'},8:{halign:'center'}}, {styles:{font:'helvetica',fontSize:7,cellPadding:1.5,lineColor:LINE,lineWidth:.2,textColor:[15,27,45]}});
  if(d.notes.length){ heading('Trade notes & lessons'); table(['Trade','Note'], d.notes.map(t=>[`${t.symbol||''}\n${formatTradeTime(t)}\n${isOpenTrade(t)?'Open':pdfMoney(Number(t.pnl)||0)}`, t.notes]), {0:{cellWidth:34,fontStyle:'bold'}}); }

  // screenshots
  if(opts.screenshots){
    const withImgs=d.trades.filter(t=>tradeImages(t).length);
    if(withImgs.length){ doc.addPage(); y=18; heading('Chart screenshots'); }
    let done=0; const total=withImgs.reduce((a,t)=>a+Math.min(2,tradeImages(t).length),0);
    for(const t of withImgs){
      const imgs=tradeImages(t).slice(0,2);
      ensure(70);   // keep the trade title on the same page as its first screenshot doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(pdfText(`${t.symbol||''} ${t.type||''}  |  ${formatTradeTime(t)}  |  ${isOpenTrade(t)?'Open':pdfMoney(Number(t.pnl)||0)}`),M,y); y+=4;
      for(const src of imgs){
        opts.onProgress && opts.onProgress(++done,total);
        try { const im=await imageForPdf(src); let w=CW, h=im.h*w/im.w; if(h>120){ h=120; w=im.w*h/im.h; } ensure(h+4); doc.addImage(im.data,'JPEG',M,y,w,h); y+=h+4; }
        catch(_) { ensure(8); doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text('(screenshot load nahi hua)',M,y+3); y+=7; }
      }
      y+=3;
    }
  }

  // footer
  const pages=doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(pdfText(`Trader Co-Pilot  |  ${d.label}`),M,292); doc.text(`Page ${i} of ${pages}`,W-M,292,{align:'right'}); }
  return doc;
}
async function downloadWeeklyReport(){
  const r=STATE.report; if(!r||r.busy) return;
  const d=weeklyReportData(r.start); if(!d.trades.length) return;
  r.screenshots=!!$('#report-screenshots')?.checked; r.busy=true; renderWeeklyReportModal();
  const status=()=>$('#report-status');
  try{
    const doc=await buildWeeklyPdf(d,{ screenshots:r.screenshots, onProgress:(i,n)=>{ const s=status(); if(s) s.textContent=`Screenshots jod rahe hain… ${i}/${n}`; } });
    const name=`Trading-Report_${localDateKey(d.start)}_to_${localDateKey(d.end)}.pdf`;
    const blob=doc.output('blob');
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    // iPhone home-screen apps ignore "download": open the PDF so it can be saved/shared from the viewer.
    if(window.navigator.standalone) window.open(url,'_blank');
    setTimeout(()=>URL.revokeObjectURL(url), 60000);
    r.busy=false; renderWeeklyReportModal(); const s=status(); if(s){ s.style.color='var(--profit)'; s.textContent=`✓ ${name} download ho gayi (${Math.max(1,Math.round(blob.size/1024))} KB).`; }
  }catch(e){
    console.error(e); r.busy=false; renderWeeklyReportModal(); const s=status(); if(s) s.textContent='⚠ '+(e.message||'PDF nahi ban payi. Dobara try karo.');
  }
}


/* ---------------- voice typing ----------------
   Like the keyboard mic: speak and the words are typed into the note.
   Uses the browser's speech recognition (Chrome / Edge / Android / Safari).
   Commands: "full stop" . | "comma" , | "question mark" ? | "new line" ↵ */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const VOICE = { rec:null, target:null, kind:null, lang:(()=>{ try { return localStorage.getItem('tc_voice_lang') || 'en-IN'; } catch(_) { return 'en-IN'; } })(), btn:null, wantStop:false, startedAt:0, typed:false };
const VOICE_COMMANDS = [
  [/\s*\b(full ?stop|period|purn ?viram)\b\s*/gi, '. '],
  [/\s*\b(comma|koma)\b\s*/gi, ', '],
  [/\s*\b(question mark|prashn ?chinh)\b\s*/gi, '? '],
  [/\s*\b(exclamation mark)\b\s*/gi, '! '],
  [/\s*\b(new ?line|next ?line|nayi line|agli line)\b\s*/gi, '\n']
];
function voiceCleanup(text, prevChar){
  let t=' '+text.trim()+' ';
  VOICE_COMMANDS.forEach(([re,rep])=>{ t=t.replace(re, rep); });
  t=t.replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/ +([.,?!])/g,'$1').replace(/[ \t]{2,}/g,' ').replace(/^ +/,'');
  const startSentence = !prevChar || /[.?!\n]\s*$/.test(prevChar);
  if(startSentence) t=t.replace(/^([a-z])/, c=>c.toUpperCase());
  t=t.replace(/([.?!]\s+|\n)([a-z])/g, (m,a,c)=>a+c.toUpperCase());
  const needSpace = prevChar && !/\s$/.test(prevChar) && !/^[\n.,?!]/.test(t);
  return (needSpace?' ':'') + t.replace(/[ \t]+$/,'');
}
function charBeforeCaret(el){
  if(el.tagName==='TEXTAREA'||el.tagName==='INPUT') return el.value.slice(0, el.selectionStart ?? el.value.length).slice(-2);
  const sel=window.getSelection(); if(!sel||!sel.rangeCount||!el.contains(sel.anchorNode)) return (el.innerText||'').slice(-2);
  const r=sel.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(sel.anchorNode, sel.anchorOffset); return r.toString().slice(-2);
}
function placeCaretAtEnd(el){ el.focus(); const r=document.createRange(); r.selectNodeContents(el); r.collapse(false); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); }
function voiceInsert(text){
  const el=VOICE.target; if(!el||!el.isConnected||!text) return;
  const prev=charBeforeCaret(el), out=voiceCleanup(text, prev); if(!out.trim() && out!=='\n') return;
  VOICE.typed=true;
  if(el.tagName==='TEXTAREA'||el.tagName==='INPUT'){
    const s=el.selectionStart ?? el.value.length, e2=el.selectionEnd ?? s;
    el.setRangeText(out, s, e2, 'end'); el.dispatchEvent(new Event('input',{bubbles:true})); return;
  }
  if(document.activeElement!==el){ if(el._savedRange){ el.focus(); const s=window.getSelection(); s.removeAllRanges(); s.addRange(el._savedRange); } else placeCaretAtEnd(el); }
  const parts=out.split('\n');
  parts.forEach((part,i)=>{
    if(i>0){ if(!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br>'); }
    if(part && !document.execCommand('insertText', false, part)){
      const sel=window.getSelection(), r=sel.getRangeAt(0); r.deleteContents(); r.insertNode(document.createTextNode(part)); r.collapse(false);
    }
  });
  noteSelectionStore(el);
  el.dispatchEvent(new Event('input',{bubbles:true}));
}
function voiceBubble(text, state){
  let b=$('#voice-bubble');
  if(!b){ b=document.createElement('div'); b.id='voice-bubble'; b.className='voice-bubble'; b.setAttribute('role','status'); b.innerHTML=`<span class="voice-dot" aria-hidden="true"></span><span class="voice-text"></span><button type="button" class="voice-lang" data-action="voice-lang" title="Bhasha badlo"></button><button type="button" class="voice-stop" data-action="voice-stop">Stop</button>`; document.body.appendChild(b); }
  b.querySelector('.voice-text').textContent=text;
  b.querySelector('.voice-lang').textContent = VOICE.lang==='hi-IN' ? 'हिंदी' : 'EN/Hinglish';
  b.dataset.state=state||'listening';
  b.hidden=false;
}
function hideVoiceBubble(){ const b=$('#voice-bubble'); if(b) b.hidden=true; }
function setVoiceButtons(on){ $$('[data-action="voice-type"]').forEach(x=>{ const mine = on && VOICE.target && x.dataset.voiceFor && (x.dataset.voiceFor===VOICE.target.id || x.dataset.voiceFor===`${VOICE.target.dataset.liveNoteText}:${VOICE.target.dataset.index}`); x.classList.toggle('is-listening', !!mine); x.setAttribute('aria-pressed', mine?'true':'false'); }); }
function stopVoice(){ VOICE.wantStop=true; try { VOICE.rec?.stop(); } catch(_) {} }
function voiceTargetFor(btn){
  const key=btn.dataset.voiceFor||'';
  if(key.includes(':')){ const [id,idx]=key.split(':'); return document.querySelector(`[data-live-note-text="${CSS.escape(id)}"][data-index="${CSS.escape(idx)}"]`); }
  return document.getElementById(key);
}
function startVoice(btn){
  if(!SpeechRec){ alert('🎤 Is browser mein voice typing nahi chalti.\n\nChrome (Android / laptop), Edge ya iPhone Safari use karo — ya keyboard ka 🎤 mic button dabao.'); return; }
  if(!window.isSecureContext){ alert('🎤 Voice typing ke liye site https par honi chahiye.'); return; }
  const target=voiceTargetFor(btn); if(!target) return;
  if(VOICE.rec){ const same=VOICE.target===target; stopVoice(); if(same) return; }
  VOICE.target=target; VOICE.wantStop=false; VOICE.typed=false; VOICE.startedAt=Date.now();
  if(target.isContentEditable && !target.contains(window.getSelection()?.anchorNode) && !target._savedRange) placeCaretAtEnd(target);
  const rec=new SpeechRec(); VOICE.rec=rec;
  rec.lang=VOICE.lang; rec.continuous=true; rec.interimResults=true; rec.maxAlternatives=1;
  rec.onstart=()=>{ setVoiceButtons(true); voiceBubble('Bolo… main likh raha hoon', 'listening'); };
  rec.onresult=(ev)=>{
    let interim='';
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const r=ev.results[i], txt=r[0]?.transcript||'';
      if(r.isFinal) voiceInsert(txt); else interim+=txt;
    }
    voiceBubble(interim ? interim : 'Bolo… main likh raha hoon', 'listening');
  };
  rec.onerror=(ev)=>{
    const msg = ev.error==='not-allowed'||ev.error==='service-not-allowed' ? 'Mic ki permission nahi mili. Browser settings mein is site ko Microphone allow karo.'
      : ev.error==='no-speech' ? 'Kuch sunai nahi diya. Mic ke paas bolke dobara try karo.'
      : ev.error==='network' ? 'Voice typing ke liye internet chahiye.'
      : ev.error==='audio-capture' ? 'Mic nahi mila. Koi aur app mic use to nahi kar raha?'
      : ev.error==='aborted' ? '' : `Voice typing ruk gayi (${ev.error}).`;
    if(msg){ voiceBubble(msg,'error'); VOICE.wantStop=true; setTimeout(()=>{ if(!VOICE.rec) hideVoiceBubble(); }, 3500); }
  };
  rec.onend=()=>{
    // Android Chrome stops after a pause; keep listening until the user taps Stop (max 5 min).
    if(!VOICE.wantStop && Date.now()-VOICE.startedAt < 5*60*1000 && VOICE.target?.isConnected){ try { rec.start(); return; } catch(_) {} }
    VOICE.rec=null; setVoiceButtons(false);
    const b=$('#voice-bubble'); if(b && b.dataset.state!=='error') hideVoiceBubble();
    VOICE.target=null;
  };
  try { rec.start(); } catch(e){ VOICE.rec=null; alert('🎤 Voice typing shuru nahi ho payi: '+(e.message||e)); }
}
function toggleVoiceLang(){
  VOICE.lang = VOICE.lang==='hi-IN' ? 'en-IN' : 'hi-IN';
  try { localStorage.setItem('tc_voice_lang', VOICE.lang); } catch(_) {}
  if(VOICE.rec && VOICE.target){ const t=VOICE.target, btn=$$('[data-action="voice-type"]').find(x=>voiceTargetFor(x)===t); stopVoice(); setTimeout(()=>{ if(btn) startVoice(btn); }, 350); }
  else voiceBubble(VOICE.lang==='hi-IN'?'Ab Hindi (देवनागरी) mein likhega':'Ab English / Hinglish mein likhega','listening');
}
// keep the caret in the note when the mic button is pressed
document.addEventListener('mousedown', e=>{ if(e.target.closest('[data-action="voice-type"],#voice-bubble button')) e.preventDefault(); });


/* ---------------- blog ----------------
   Admin (ADMIN_EMAILS) writes posts; every trader reads them in the app.
   Posts are blocks (paragraph, heading, image, quote, list, tip, divider) —
   inline **bold**, *italic* and [link](https://…) only, so posts can't carry code. */
const BLOG_BLOCKS = [
  ['p','¶ Paragraph'],['h2','H Heading'],['h3','h Sub-heading'],['img','🖼 Image'],['list','• List'],['quote','❝ Quote'],['callout','💡 Tip box'],['divider','— Divider']
];
function blogState(){ return STATE.blog || (STATE.blog = { posts:[], loaded:false, loading:false, hasMore:false, view:'list', current:null, editing:null, preview:false, tag:'ALL', search:'', dirty:false }); }
function isAdmin(){ return !!STATE.user?.isAdmin; }
function blogSeenAt(){ try { return localStorage.getItem('tc_blog_seen') || ''; } catch(_) { return ''; } }
function markBlogSeen(){ const top=blogState().posts.filter(p=>p.status==='published').map(p=>p.publishedAt).sort().pop(); if(top){ try { localStorage.setItem('tc_blog_seen', top); } catch(_) {} } }
function blogUnreadCount(){ const seen=blogSeenAt(); return blogState().posts.filter(p=>p.status==='published' && (!seen || p.publishedAt>seen)).length; }
function inlineMd(text){
  // escape first, then allow a tiny safe subset
  let h=esc(text);
  h=h.replace(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g,(m,t,u)=>`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${t}</a>`);
  h=h.replace(/\*\*([^*]{1,500})\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]{1,300})\*(?!\*)/g,'$1<em>$2</em>');
  return h.replace(/\n/g,'<br>');
}
function blogImgSrc(src){ return esc(src||''); }
function renderBlogBlocks(blocks){
  return (blocks||[]).map(b=>{
    if(b.type==='h2') return `<h2>${inlineMd(b.text)}</h2>`;
    if(b.type==='h3') return `<h3>${inlineMd(b.text)}</h3>`;
    if(b.type==='quote') return `<blockquote>${inlineMd(b.text)}</blockquote>`;
    if(b.type==='callout') return `<div class="blog-callout"><span aria-hidden="true">💡</span><div>${inlineMd(b.text)}</div></div>`;
    if(b.type==='list') return `<ul>${(b.items||[]).map(x=>`<li>${inlineMd(x)}</li>`).join('')}</ul>`;
    if(b.type==='divider') return `<hr>`;
    if(b.type==='img') return b.src?`<figure><img src="${blogImgSrc(b.src)}" alt="${esc(b.caption||'')}" loading="lazy" data-action="view-blog-image" data-src="${esc(b.src)}">${b.caption?`<figcaption>${esc(b.caption)}</figcaption>`:''}</figure>`:'';
    return `<p>${inlineMd(b.text)}</p>`;
  }).join('');
}
function fmtBlogDate(iso){ if(!iso) return ''; const d=new Date(iso); return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
async function loadBlog(force=false){
  const b=blogState(); if(b.loading || (b.loaded && !force)) return;
  b.loading=true;
  try { const d=await api(`/api/blog?limit=50${isAdmin()?'&all=1':''}`); b.posts=d.posts||[]; b.hasMore=!!d.hasMore; b.loaded=true; b.error=''; }
  catch(e){ b.error=e.message||'Blog load nahi hua.'; }
  finally { b.loading=false; }
  if(STATE.activeTab==='blog' && b.view==='list') { renderTabOnly(); markBlogSeen(); }
  else renderTabNav();
}
function blogTags(){ const s=new Set(); blogState().posts.forEach(p=>(p.tags||[]).forEach(t=>s.add(t))); return [...s].sort(); }
function renderBlogTab(){
  const b=blogState();
  if(b.view==='edit' && isAdmin()) return renderBlogEditor();
  if(b.view==='post' && b.current) return renderBlogPost(b.current);
  if(!b.loaded){ setTimeout(()=>loadBlog(),0); return `<section class="card blog-head"><h2 class="section-title">📰 Trader's Blog</h2><p class="card-sub">${b.error?esc(b.error):'Load ho raha hai…'}</p>${b.error?'<button class="btn-secondary btn-small" data-action="blog-reload">Dobara try karo</button>':''}</section>`; }
  const q=b.search.trim().toLowerCase();
  const list=b.posts.filter(p=>(b.tag==='ALL'||(p.tags||[]).includes(b.tag)) && (!q || [p.title,p.excerpt,(p.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));
  const seen=blogSeenAt(), tags=blogTags();
  const card=p=>`<article class="blog-card ${p.status==='draft'?'is-draft':''}" data-action="open-blog-post" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.title)}">
      ${p.cover?`<div class="blog-card-cover"><img src="${blogImgSrc(p.cover)}" alt="" loading="lazy"></div>`:`<div class="blog-card-cover blog-card-cover-empty" aria-hidden="true">📰</div>`}
      <div class="blog-card-body">
        <div class="blog-card-meta">${p.status==='draft'?'<span class="blog-badge draft">Draft</span>':''}${p.status==='published'&&(!seen||p.publishedAt>seen)?'<span class="blog-badge new">New</span>':''}<span>${fmtBlogDate(p.publishedAt||p.updatedAt)}</span><span>· ${p.readMinutes} min read</span></div>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.excerpt)}</p>
        ${(p.tags||[]).length?`<div class="blog-tags">${p.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div>`:''}
      </div>
    </article>`;
  return `<section class="blog-head card">
      <div><h2 class="section-title">📰 Trader's Blog</h2><p class="card-sub">Setups, psychology aur market lessons — padho, seekho, apply karo.</p></div>
      ${isAdmin()?`<button type="button" class="btn-primary" data-action="new-blog-post">＋ New post</button>`:''}
    </section>
    <div class="blog-filters">
      <input type="search" id="blog-search" value="${esc(b.search)}" placeholder="🔍 Blog mein search karo…" aria-label="Search blog">
      ${tags.length?`<div class="blog-tag-row"><button type="button" class="${b.tag==='ALL'?'active':''}" data-action="blog-tag" data-tag="ALL">All</button>${tags.map(t=>`<button type="button" class="${b.tag===t?'active':''}" data-action="blog-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>`:''}
    </div>
    ${list.length?`<div class="blog-grid">${list.map(card).join('')}</div>`:`<div class="card blog-empty">${b.posts.length?'Is search/tag mein koi post nahi.':(isAdmin()?'Abhi koi post nahi. ＋ New post se pehli post likho.':'Abhi koi post nahi aayi. Jaldi aayegi!')}</div>`}`;
}
function renderBlogPost(p){
  return `<article class="blog-post card">
    <div class="blog-post-top"><button type="button" class="btn-secondary btn-small" data-action="blog-back">‹ Sab posts</button>${isAdmin()?`<div class="blog-admin-actions"><span class="blog-badge ${p.status==='draft'?'draft':'live'}">${p.status==='draft'?'Draft':'Live'}</span><span class="blog-views">👁 ${p.views||0}</span><button type="button" class="btn-secondary btn-small" data-action="edit-blog-post" data-id="${esc(p.id)}">✏️ Edit</button></div>`:''}</div>
    ${p.cover?`<img class="blog-post-cover" src="${blogImgSrc(p.cover)}" alt="" data-action="view-blog-image" data-src="${esc(p.cover)}">`:''}
    <header><h1>${esc(p.title)}</h1><p class="blog-post-meta">${esc(p.authorName||'Admin')} · ${fmtBlogDate(p.publishedAt||p.updatedAt)} · ${p.readMinutes} min read</p>${(p.tags||[]).length?`<div class="blog-tags">${p.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div>`:''}</header>
    <div class="blog-body">${renderBlogBlocks(p.blocks)}</div>
    <div class="blog-post-end"><button type="button" class="btn-secondary" data-action="blog-back">‹ Aur posts padho</button></div>
  </article>`;
}
// Paste a whole post as simple text and turn it into blocks:
// # Title · Summary: … · Tags: a, b · ## Heading · ### Sub · > quote · - list · 💡 tip · --- · ![caption](https://img)
function parseBlogText(raw){
  const out={ title:'', excerpt:'', tags:'', blocks:[] };
  const lines=String(raw||'').replace(/\r/g,'').split('\n');
  let para=[], list=null;
  const flushPara=()=>{ if(para.length){ out.blocks.push({type:'p', text:para.join(' ').trim()}); para=[]; } };
  const flushList=()=>{ if(list){ out.blocks.push({type:'list', items:list}); list=null; } };
  const flush=()=>{ flushPara(); flushList(); };
  for(const rawLine of lines){
    const line=rawLine.trim();
    if(!line){ flush(); continue; }
    let m;
    if(!out.title && (m=/^#\s+(.+)/.exec(line))){ flush(); out.title=m[1].trim(); continue; }
    if((m=/^summary\s*:\s*(.+)/i.exec(line)) && !out.blocks.length){ flush(); out.excerpt=m[1].trim(); continue; }
    if((m=/^tags\s*:\s*(.+)/i.exec(line)) && !out.blocks.length){ flush(); out.tags=m[1].trim(); continue; }
    if((m=/^###\s+(.+)/.exec(line))){ flush(); out.blocks.push({type:'h3', text:m[1].trim()}); continue; }
    if((m=/^##?\s+(.+)/.exec(line))){ flush(); out.blocks.push({type:'h2', text:m[1].trim()}); continue; }
    if(/^(-{3,}|\*{3,}|_{3,})$/.test(line)){ flush(); out.blocks.push({type:'divider'}); continue; }
    if((m=/^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/.exec(line))){ flush(); out.blocks.push({type:'img', src:m[2], caption:m[1]}); continue; }
    if((m=/^>\s?(.*)/.exec(line))){ flush(); const last=out.blocks.at(-1); if(last&&last.type==='quote'&&last._open) last.text+=' '+m[1]; else out.blocks.push({type:'quote', text:m[1], _open:true}); continue; }
    if((m=/^(?:💡|(?:tip|note)\s*:)\s*(.+)/i.exec(line))){ flush(); out.blocks.push({type:'callout', text:m[1].trim()}); continue; }
    if((m=/^(?:[-*•]|\d+[.)])\s+(.+)/.exec(line))){ flushPara(); (list||(list=[])).push(m[1].trim()); continue; }
    flushList(); para.push(line);
  }
  flush();
  out.blocks.forEach(b=>delete b._open);
  return out;
}
function newBlogDraft(){ return { id:null, title:'', excerpt:'', cover:'', tags:'', status:'draft', blocks:[{type:'p',text:''}] }; }
function renderBlogEditor(){
  const b=blogState(), d=b.editing;
  const blockEditor=(blk,i)=>{
    const head=`<div class="be-head"><span>${esc((BLOG_BLOCKS.find(x=>x[0]===blk.type)||[0,blk.type])[1])}</span><div><button type="button" data-action="blog-block-move" data-index="${i}" data-dir="-1" aria-label="Move up" ${i===0?'disabled':''}>↑</button><button type="button" data-action="blog-block-move" data-index="${i}" data-dir="1" aria-label="Move down" ${i===d.blocks.length-1?'disabled':''}>↓</button><button type="button" data-action="blog-block-del" data-index="${i}" aria-label="Delete block">✕</button></div></div>`;
    if(blk.type==='divider') return `<div class="be-block">${head}<hr></div>`;
    if(blk.type==='img') return `<div class="be-block">${head}${blk.src?`<img class="be-img" src="${blogImgSrc(blk.src)}" alt="">`:''}<div class="be-img-actions"><button type="button" class="btn-secondary btn-small" data-action="blog-pick-image" data-target="block" data-index="${i}">📁 ${blk.src?'Badlo':'Upload'}</button><input type="url" placeholder="🔗 ya image / TradingView link…" data-blog-link="${i}"><button type="button" class="btn-secondary btn-small" data-action="blog-image-link" data-target="block" data-index="${i}">Add</button></div><input class="be-caption" data-block-index="${i}" data-block-field="caption" value="${esc(blk.caption||'')}" placeholder="Caption (optional)"></div>`;
    const ph={p:'Likhna shuru karo… (**bold**, *italic*, [link](https://…))',h2:'Heading',h3:'Sub-heading',quote:'Quote…',callout:'Tip / important baat…',list:'Har point nayi line mein'}[blk.type];
    const val=blk.type==='list'?(blk.items||[]).join('\n'):(blk.text||'');
    return `<div class="be-block be-${blk.type}">${head}<textarea data-block-index="${i}" data-block-field="${blk.type==='list'?'items':'text'}" rows="${blk.type==='h2'||blk.type==='h3'?1:blk.type==='p'?4:3}" placeholder="${esc(ph)}">${esc(val)}</textarea></div>`;
  };
  const preview={...d, tags:String(d.tags||'').split(',').map(x=>x.trim()).filter(Boolean), blocks:d.blocks.map(x=>x.type==='list'?{...x,items:(x.items||[]).filter(Boolean)}:x), authorName:STATE.user?.name, readMinutes:Math.max(1,Math.round(d.blocks.map(x=>x.text||(x.items||[]).join(' ')).join(' ').split(/\s+/).filter(Boolean).length/200)), publishedAt:new Date().toISOString()};
  return `<section class="card blog-editor">
    <div class="blog-post-top"><button type="button" class="btn-secondary btn-small" data-action="blog-editor-close">‹ Wapas</button>
      <div class="blog-admin-actions"><span class="blog-badge ${d.status==='published'?'live':'draft'}">${d.status==='published'?'Live':'Draft'}</span><button type="button" class="btn-secondary btn-small" data-action="blog-preview">${b.preview?'✏️ Edit':'👁 Preview'}</button></div></div>
    ${b.preview ? `<div class="blog-post blog-preview">${preview.cover?`<img class="blog-post-cover" src="${blogImgSrc(preview.cover)}" alt="">`:''}<header><h1>${esc(preview.title||'Untitled')}</h1><p class="blog-post-meta">${esc(preview.authorName||'')} · ${preview.readMinutes} min read</p></header><div class="blog-body">${renderBlogBlocks(preview.blocks)}</div></div>` : `
    <details class="be-import" ${d.blocks.length<=1&&!(d.blocks[0]?.text)&&!d.title?'open':''}>
      <summary>📋 Poora article paste karke format karo</summary>
      <p class="be-import-help">Word / Google Docs / ChatGPT se text paste karo. Format: <code># Title</code>, <code>Summary: …</code>, <code>Tags: a, b</code>, <code>## Heading</code>, <code>&gt; quote</code>, <code>- list</code>, <code>💡 tip</code>, <code>---</code>, <code>**bold**</code>. Saada text bhi chalega — har khaali line par naya paragraph.</p>
      <textarea id="blog-import-text" rows="6" placeholder="# Mera title&#10;Summary: …&#10;Tags: Psychology&#10;&#10;Pehla paragraph…"></textarea>
      <div class="be-img-actions"><button type="button" class="btn-primary btn-small" data-action="blog-import">Blocks banao</button><label class="btn-secondary btn-small be-import-file">📄 .txt / .md file<input type="file" id="blog-import-file" accept=".txt,.md,text/plain,text/markdown" hidden></label></div>
    </details>
    <input class="be-title" data-blog-field="title" value="${esc(d.title)}" placeholder="Post ka title…" maxlength="160">
    <div class="be-row"><label>Short summary <small>(list mein dikhega — khaali chhodo to pehla paragraph)</small><textarea data-blog-field="excerpt" rows="2" maxlength="400">${esc(d.excerpt)}</textarea></label></div>
    <div class="be-row be-row-2"><label>Tags <small>(comma se alag: Psychology, ORB)</small><input data-blog-field="tags" value="${esc(d.tags)}" placeholder="Psychology, Risk"></label>
      <div class="be-cover"><span>Cover image</span>${d.cover?`<img src="${blogImgSrc(d.cover)}" alt="">`:''}<div class="be-img-actions"><button type="button" class="btn-secondary btn-small" data-action="blog-pick-image" data-target="cover">📁 ${d.cover?'Badlo':'Upload'}</button>${d.cover?`<button type="button" class="btn-secondary btn-small" data-action="blog-cover-remove">Hatao</button>`:''}<input type="url" placeholder="🔗 image link…" data-blog-link="cover"><button type="button" class="btn-secondary btn-small" data-action="blog-image-link" data-target="cover">Add</button></div></div></div>
    <div class="be-blocks">${d.blocks.map(blockEditor).join('')}</div>
    <div class="be-add">${BLOG_BLOCKS.map(([t,l])=>`<button type="button" class="btn-secondary btn-small" data-action="blog-block-add" data-type="${t}">${l}</button>`).join('')}</div>
    <input type="file" id="blog-image-file" accept="image/*" hidden>`}
    <p class="sm-error" id="blog-status" role="status"></p>
    <div class="be-actions">
      ${d.id?`<button type="button" class="btn-danger btn-small" data-action="blog-delete">Delete</button>`:'<span></span>'}
      <div>${d.status==='published'?`<button type="button" class="btn-secondary" data-action="blog-save" data-status="draft">Unpublish</button><button type="button" class="btn-primary" data-action="blog-save" data-status="published">Update post</button>`:`<button type="button" class="btn-secondary" data-action="blog-save" data-status="draft">Save draft</button><button type="button" class="btn-primary" data-action="blog-save" data-status="published">🚀 Publish</button>`}</div>
    </div>
  </section>`;
}
async function openBlogPost(id){
  const b=blogState(); b.view='post'; b.current=b.posts.find(p=>p.id===id)||null;
  renderTabOnly(); window.scrollTo({top:0,behavior:REDUCED_MOTION?'auto':'smooth'});
  try { const d=await api(`/api/blog/${encodeURIComponent(id)}`); b.current=d.post; const i=b.posts.findIndex(p=>p.id===id); if(i>=0) b.posts[i]={...b.posts[i], views:d.post.views}; if(STATE.activeTab==='blog'&&b.view==='post') renderTabOnly(); }
  catch(e){ if(!b.current?.blocks){ b.view='list'; renderTabOnly(); alert(e.message||'Post load nahi hui.'); } }
}
async function editBlogPost(id){
  const b=blogState();
  let p=b.current?.id===id&&b.current.blocks?b.current:null;
  if(!p){ try { p=(await api(`/api/blog/${encodeURIComponent(id)}`)).post; } catch(e){ alert(e.message); return; } }
  b.editing={ id:p.id, title:p.title, excerpt:p.excerpt, cover:p.cover, tags:(p.tags||[]).join(', '), status:p.status, blocks:(p.blocks&&p.blocks.length?structuredClone(p.blocks):[{type:'p',text:''}]) };
  b.view='edit'; b.preview=false; b.dirty=false; renderTabOnly();
}
function leaveBlogEditor(){
  const b=blogState();
  if(b.dirty && !confirm('Save nahi kiya hua badlav chala jayega. Wapas jaayein?')) return false;
  b.editing=null; b.dirty=false; b.view=b.current?'post':'list'; return true;
}
async function blogUploadImage(payload){
  const res=await fetch('/api/blog/upload',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
  const d=await res.json().catch(()=>({})); if(!res.ok) throw new Error(d.error||'Image upload nahi hui.'); return d.url;
}
function setBlogImage(target, index, url){
  const d=blogState().editing; if(!d) return;
  if(target==='cover') d.cover=url; else if(d.blocks[index]) d.blocks[index].src=url;
  blogState().dirty=true; renderTabOnly();
}
function importBlogText(text){
  const b=blogState(), d=b.editing; if(!d) return;
  const r=parseBlogText(text);
  if(!r.blocks.length && !r.title){ alert('Kuch text paste karo.'); return; }
  const hasContent=d.blocks.some(x=>(x.text||'').trim()||(x.items||[]).some(Boolean)||x.src);
  if(hasContent && !confirm('Abhi ka content in naye blocks se badal jayega. Continue?')) return;
  if(r.title) d.title=r.title; if(r.excerpt) d.excerpt=r.excerpt; if(r.tags) d.tags=r.tags;
  d.blocks=r.blocks.length?r.blocks:[{type:'p',text:''}];
  b.dirty=true; renderTabOnly();
  const st=$('#blog-status'); if(st){ st.style.color='var(--profit)'; st.textContent=`✓ ${r.blocks.length} blocks ban gaye. 👁 Preview dekh lo, phir Publish.`; }
}
async function saveBlogPost(status){
  const b=blogState(), d=b.editing, st=$('#blog-status'); if(!d) return;
  if(!d.title.trim()){ if(st) st.textContent='Title likho.'; $('.be-title')?.focus(); return; }
  if(status==='published' && !d.blocks.some(x=>(x.text||'').trim()||(x.items||[]).some(Boolean)||x.src)){ if(st) st.textContent='Publish karne se pehle kuch content likho.'; return; }
  const body={ title:d.title, excerpt:d.excerpt, cover:d.cover, tags:d.tags, status, blocks:d.blocks.map(x=>x.type==='list'?{type:'list',items:(x.items||[]).map(s=>s.trim()).filter(Boolean)}:x) };
  $$('[data-action="blog-save"]').forEach(x=>x.disabled=true); if(st){ st.style.color=''; st.textContent='Save ho raha hai…'; }
  try{
    const res=d.id ? await api(`/api/blog/${encodeURIComponent(d.id)}`,'PUT',body) : await api('/api/blog','POST',body);
    const p=res.post; d.id=p.id; d.status=p.status; b.dirty=false;
    const i=b.posts.findIndex(x=>x.id===p.id); const summary={...p}; delete summary.blocks;
    if(i>=0) b.posts[i]=summary; else b.posts.unshift(summary);
    b.current=p;
    if(status==='published'){ b.editing=null; b.view='post'; renderTabOnly(); window.scrollTo({top:0}); }
    else { renderTabOnly(); const s2=$('#blog-status'); if(s2){ s2.style.color='var(--profit)'; s2.textContent='✓ Draft save ho gaya (readers ko nahi dikhega).'; } }
  }catch(e){ const s2=$('#blog-status'); if(s2){ s2.style.color=''; s2.textContent='⚠ '+(e.message||'Save nahi hua.'); } $$('[data-action="blog-save"]').forEach(x=>x.disabled=false); }
}
async function deleteBlogPost(){
  const b=blogState(), d=b.editing; if(!d?.id) return;
  if(!confirm(`"${d.title||'Yeh post'}" hamesha ke liye delete karein?`)) return;
  try { await api(`/api/blog/${encodeURIComponent(d.id)}`,'DELETE'); b.posts=b.posts.filter(p=>p.id!==d.id); b.editing=null; b.current=null; b.dirty=false; b.view='list'; renderTabOnly(); }
  catch(e){ alert(e.message||'Delete nahi hua.'); }
}
function handleBlogClick(action, btn, e){
  const b=blogState();
  if(action==='open-blog-post'){ openBlogPost(btn.dataset.id); return true; }
  if(action==='blog-back'){ b.view='list'; b.current=null; renderTabOnly(); markBlogSeen(); return true; }
  if(action==='blog-reload'){ b.error=''; loadBlog(true); return true; }
  if(action==='blog-tag'){ b.tag=btn.dataset.tag; renderTabOnly(); return true; }
  if(action==='new-blog-post'){ b.editing=newBlogDraft(); b.view='edit'; b.preview=false; b.dirty=false; b.current=null; renderTabOnly(); setTimeout(()=>$('.be-title')?.focus(),30); return true; }
  if(action==='edit-blog-post'){ editBlogPost(btn.dataset.id); return true; }
  if(action==='blog-editor-close'){ if(leaveBlogEditor()) renderTabOnly(); return true; }
  if(action==='blog-preview'){ b.preview=!b.preview; renderTabOnly(); return true; }
  if(action==='blog-block-add'){ const t=btn.dataset.type; b.editing.blocks.push(t==='list'?{type:'list',items:['']}:t==='img'?{type:'img',src:'',caption:''}:t==='divider'?{type:'divider'}:{type:t,text:''}); b.dirty=true; renderTabOnly(); setTimeout(()=>{ const els=$$('.be-blocks textarea'); els.at(-1)?.focus(); },30); return true; }
  if(action==='blog-block-del'){ b.editing.blocks.splice(Number(btn.dataset.index),1); if(!b.editing.blocks.length) b.editing.blocks.push({type:'p',text:''}); b.dirty=true; renderTabOnly(); return true; }
  if(action==='blog-block-move'){ const i=Number(btn.dataset.index), j=i+Number(btn.dataset.dir), arr=b.editing.blocks; if(j>=0&&j<arr.length){ [arr[i],arr[j]]=[arr[j],arr[i]]; b.dirty=true; renderTabOnly(); } return true; }
  if(action==='blog-pick-image'){ const f=$('#blog-image-file'); if(f){ f.dataset.target=btn.dataset.target; f.dataset.index=btn.dataset.index||''; f.click(); } return true; }
  if(action==='blog-image-link'){ const key=btn.dataset.target==='cover'?'cover':btn.dataset.index; const input=document.querySelector(`[data-blog-link="${key}"]`); const link=input?.value.trim(); if(!link){ input?.focus(); return true; } const label=btn.textContent; btn.disabled=true; btn.textContent='…'; blogUploadImage({url:link}).then(u=>setBlogImage(btn.dataset.target, Number(btn.dataset.index), u)).catch(err=>{ alert('🔗 '+err.message); btn.disabled=false; btn.textContent=label; }); return true; }
  if(action==='blog-cover-remove'){ b.editing.cover=''; b.dirty=true; renderTabOnly(); return true; }
  if(action==='blog-save'){ saveBlogPost(btn.dataset.status); return true; }
  if(action==='blog-import'){ importBlogText($('#blog-import-text')?.value||''); return true; }
  if(action==='blog-delete'){ deleteBlogPost(); return true; }
  if(action==='view-blog-image'){ openAnnotator(btn.dataset.src,null,null,{}); return true; }
  return false;
}
document.addEventListener('input', e=>{
  const b=STATE.blog; if(!b) return;
  if(e.target.id==='blog-search'){ b.search=e.target.value; clearTimeout(b.searchTimer); b.searchTimer=setTimeout(()=>{ const pos=e.target.selectionStart; renderTabOnly(); const s=$('#blog-search'); if(s){ s.focus(); try{s.setSelectionRange(pos,pos);}catch(_){} } },200); return; }
  if(!b.editing) return;
  if(e.target.dataset.blogField){ b.editing[e.target.dataset.blogField]=e.target.value; b.dirty=true; return; }
  if(e.target.dataset.blockIndex!==undefined && e.target.dataset.blockField){
    const blk=b.editing.blocks[Number(e.target.dataset.blockIndex)]; if(!blk) return;
    if(e.target.dataset.blockField==='items') blk.items=e.target.value.split('\n'); else blk[e.target.dataset.blockField]=e.target.value;
    b.dirty=true;
    if(e.target.tagName==='TEXTAREA'){ e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight+2,600)+'px'; }
  }
});
document.addEventListener('change', e=>{
  if(e.target.id==='blog-import-file' && e.target.files?.length){ e.target.files[0].text().then(t=>{ const ta=$('#blog-import-text'); if(ta) ta.value=t; importBlogText(t); }); e.target.value=''; return; }
  if(e.target.id!=='blog-image-file' || !e.target.files?.length) return;
  const f=e.target.files[0], target=e.target.dataset.target, index=Number(e.target.dataset.index);
  const st=$('#blog-status'); if(st){ st.style.color=''; st.textContent='Image upload ho rahi hai…'; }
  readAndCompressImage(f).then(dataUrl=>blogUploadImage({dataUrl})).then(u=>setBlogImage(target,index,u)).catch(err=>{ const s=$('#blog-status'); if(s) s.textContent='⚠ '+(err.message||'Upload nahi hua.'); });
  e.target.value='';
});
document.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.key===' ') && e.target.matches?.('.blog-card')){ e.preventDefault(); e.target.click(); } });
window.addEventListener('beforeunload', e=>{ if(STATE.blog?.dirty){ e.preventDefault(); e.returnValue=''; } });


/* ---------------- admin dashboard ----------------
   Mentors (ADMIN_EMAILS) see every trader's progress and journal, read-only.
   Traders are told about this at signup and with a one-time notice in the app. */
function adminState(){ return STATE.admin || (STATE.admin={ users:[], loaded:false, loading:false, error:'', filter:'all', sort:'active', search:'', view:'list', detail:null, detailTab:'trades', openNote:null, selected:new Set(), confirm:null }); }
function timeAgo(iso){
  if(!iso) return '—'; const d=new Date(iso); if(Number.isNaN(d.getTime())) return '—';
  const s=(Date.now()-d.getTime())/1000;
  if(s<60) return 'abhi'; if(s<3600) return `${Math.floor(s/60)} min pehle`; if(s<86400) return `${Math.floor(s/3600)} ghante pehle`;
  const days=Math.floor(s/86400); if(days<30) return `${days} din pehle`;
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
const DAY_MS=86400000;
function lastActive(u){ return [u.lastSeenAt,u.lastSaveAt].filter(Boolean).sort().pop()||null; }
function daysSince(iso){ return iso ? (Date.now()-new Date(iso).getTime())/DAY_MS : Infinity; }
async function loadAdminUsers(force=false){
  const a=adminState(); if(a.loading || (a.loaded&&!force)) return;
  a.loading=true; a.error='';
  try { const d=await api('/api/admin/users'); a.users=d.users||[]; a.loaded=true; a.generatedAt=d.generatedAt; const ids=new Set(a.users.map(u=>u.id)); [...a.selected].forEach(id=>{ if(!ids.has(id)) a.selected.delete(id); }); }
  catch(e){ a.error=e.message||'Load nahi hua.'; }
  finally { a.loading=false; }
  if(STATE.activeTab==='admin') renderTabOnly();
}
function traderStatus(u){
  if(u.isAdmin) return ['admin','Admin'];
  if(daysSince(u.createdAt)<=7 && !u.trades) return ['new','Naya'];
  const d=daysSince(lastActive(u));
  if(d<=1) return ['live','Aaj active']; if(d<=7) return ['ok','Active']; if(d<=30) return ['away','Gayab']; return ['gone','Inactive'];
}
const isEmptyAccount=u=>!u.isAdmin && !u.trades && !u.notes;
const canDelete=u=>!u.isAdmin && u.id!==STATE.user?.id;
function initials(u){ return esc(((u.name||u.email||'?').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2)||'?').toUpperCase()); }
function adminFilters(){ return [['all','Sab'],['empty','Khaali accounts'],['active7','Active (7 din)'],['inactive','7+ din se gayab'],['new','Naye (7 din)'],['lowrules','Rules < 60%'],['losing','Loss mein'],['notrades','0 trades']]; }
function adminFiltered(){
  const a=adminState(), q=a.search.trim().toLowerCase();
  let list=a.users.filter(u=>!q || `${u.name} ${u.email}`.toLowerCase().includes(q));
  const f=a.filter;
  if(f==='active7') list=list.filter(u=>daysSince(lastActive(u))<=7);
  if(f==='inactive') list=list.filter(u=>daysSince(lastActive(u))>7);
  if(f==='new') list=list.filter(u=>daysSince(u.createdAt)<=7);
  if(f==='lowrules') list=list.filter(u=>u.closed>0 && u.ruleRate<60);
  if(f==='losing') list=list.filter(u=>u.pnl<0);
  if(f==='notrades') list=list.filter(u=>!u.trades);
  if(f==='empty') list=list.filter(isEmptyAccount);
  const by={ active:(x,y)=>String(lastActive(y)||'').localeCompare(String(lastActive(x)||'')), trades:(x,y)=>y.trades-x.trades, trades7:(x,y)=>y.trades7-x.trades7, pnl:(x,y)=>y.pnl-x.pnl, rules:(x,y)=>x.ruleRate-y.ruleRate, win:(x,y)=>y.winRate-x.winRate, joined:(x,y)=>String(y.createdAt).localeCompare(String(x.createdAt)) }[a.sort];
  return by?list.sort(by):list;
}
function ruleTrend(u){
  if(u.ruleRate7===null || u.ruleRatePrev7===null) return '';
  const d=u.ruleRate7-u.ruleRatePrev7; if(Math.abs(d)<5) return '<span class="adm-trend flat" title="Pichhle hafte jaisa">→</span>';
  return d>0?`<span class="adm-trend up" title="Pichhle hafte se +${d}%">↑</span>`:`<span class="adm-trend down" title="Pichhle hafte se ${d}%">↓</span>`;
}
function renderAdminTab(){
  if(!isAdmin()) return `<section class="card"><p class="card-sub">Yeh section sirf admin ke liye hai.</p></section>`;
  const a=adminState();
  if(a.view==='user') return renderAdminUser();
  if(!a.loaded){ setTimeout(()=>loadAdminUsers(),0); return `<section class="card adm-head"><h2 class="section-title">🛠️ Admin</h2><p class="card-sub">${a.error?esc(a.error):'Traders ka data load ho raha hai…'}</p>${a.error?'<button class="btn-secondary btn-small" data-action="admin-reload">Dobara try karo</button>':''}</section>`; }
  const U=a.users.filter(u=>!u.isAdmin), all=a.users;
  const k=[
    ['👥 Total traders', U.length, ''],
    ['🟢 Aaj active', U.filter(u=>daysSince(lastActive(u))<=1).length, ''],
    ['📅 Active (7 din)', U.filter(u=>daysSince(lastActive(u))<=7).length, ''],
    ['✨ Naye (7 din)', U.filter(u=>daysSince(u.createdAt)<=7).length, ''],
    ['📈 Trades (7 din)', U.reduce((s,u)=>s+u.trades7,0), ''],
    ['😴 7+ din se gayab', U.filter(u=>daysSince(lastActive(u))>7).length, 'warn']
  ];
  const list=adminFiltered();
  const sel=a.selected;
  const row=u=>{ const la=lastActive(u), [st,stl]=traderStatus(u), deletable=canDelete(u);
    return `<tr data-action="admin-open-user" data-id="${esc(u.id)}" tabindex="0" class="${sel.has(u.id)?'is-selected':''}">
      <td class="adm-check">${deletable?`<input type="checkbox" data-action="admin-select" data-id="${esc(u.id)}" ${sel.has(u.id)?'checked':''} aria-label="Select ${esc(u.name||u.email)}">`:''}</td>
      <td><div class="adm-who"><span class="adm-ava" aria-hidden="true">${initials(u)}</span><div><strong>${esc(u.name||'—')}</strong><small>${esc(u.email)}</small></div></div></td>
      <td><span class="adm-pill ${st}">${stl}</span><small>${esc(timeAgo(la))}</small></td>
      <td class="num">${u.trades}<small>${u.trades7} is hafte</small></td>
      <td class="num ${u.pnl>=0?'positive':'negative'}">${u.closed?money(u.pnl):'—'}<small class="${u.pnl7>=0?'positive':'negative'}">${u.trades7?`${money(u.pnl7)} (7d)`:''}</small></td>
      <td class="num">${u.closed?u.winRate+'%':'—'}</td>
      <td class="num">${u.closed?`<span class="adm-bar" style="--v:${u.ruleRate}%"><i></i></span>${u.ruleRate}% ${ruleTrend(u)}`:'—'}</td>
      <td>${u.topMistake?`<span class="journal-chip chip-warn">${esc(mistakeLabel(u.topMistake.id))} ×${u.topMistake.count}</span>`:'<small>—</small>'}</td>
      <td class="num">${u.notes}</td>
    </tr>`; };
  const selectable=list.filter(canDelete), allSel=selectable.length>0 && selectable.every(u=>sel.has(u.id));
  const empties=a.users.filter(isEmptyAccount).filter(canDelete).length;
  return `<section class="card adm-head">
      ${a.toast?`<div class="adm-toast" role="status">${a.toast}</div>`:''}
      <div><h2 class="section-title">🛠️ Admin — traders ki progress</h2><p class="card-sub">Har trader ka journal (sirf padhne ke liye). Updated ${esc(timeAgo(a.generatedAt))}.</p></div>
      <div class="adm-head-actions"><button type="button" class="btn-secondary btn-small" data-action="admin-reload">↻ Refresh</button><button type="button" class="btn-secondary btn-small" data-action="admin-export">⬇️ CSV</button></div>
    </section>
    <div class="adm-kpis">${k.map(([l,v,c])=>`<div class="${c}"><span>${l}</span><strong>${v}</strong></div>`).join('')}</div>
    ${renderAdminBroadcast()}
    ${renderAdminFeaturesPanel()}
    ${renderAdminHealthPanel()}
    <section class="card adm-list">
      <div class="adm-tools">
        <input type="search" id="admin-search" value="${esc(a.search)}" placeholder="🔍 Naam ya email…" aria-label="Search traders">
        <label class="adm-sort"><span class="sr-only">Sort</span><select id="admin-sort">${[['active','Last active'],['trades7','Is hafte ke trades'],['trades','Total trades'],['pnl','Net P&L'],['win','Win rate'],['rules','Rules % (kam pehle)'],['joined','Naye pehle']].map(([v,l])=>`<option value="${v}" ${a.sort===v?'selected':''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="blog-tag-row adm-filters">${adminFilters().map(([v,l])=>`<button type="button" class="${a.filter===v?'active':''}" data-action="admin-filter" data-filter="${v}">${l}</button>`).join('')}</div>
      <p class="adm-count">${list.length} trader${list.length===1?'':'s'}</p>
      ${empties?`<div class="adm-cleanup"><span>🧹 <b>${empties}</b> khaali account${empties===1?'':'s'} (0 trades, 0 notes) — test / temporary ho sakte hain.</span><button type="button" class="btn-secondary btn-small" data-action="admin-select-empty">Sab select karo</button></div>`:''}
      ${list.length?`<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th class="adm-check">${selectable.length?`<input type="checkbox" data-action="admin-select-all" ${allSel?'checked':''} aria-label="Select all">`:''}</th><th>Trader</th><th>Status</th><th class="num">Trades</th><th class="num">Net P&amp;L</th><th class="num">Win</th><th class="num">Rules</th><th>Top mistake</th><th class="num">Notes</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`:`<p class="pb-empty">Is filter mein koi trader nahi.</p>`}
    </section>
    ${sel.size?`<div class="adm-bulkbar" role="region" aria-label="Selected traders"><span><b>${sel.size}</b> selected</span><button type="button" class="btn-secondary btn-small" data-action="admin-clear-selection">Hatao</button><button type="button" class="btn-danger" data-action="admin-delete-selected">🗑️ Delete ${sel.size}</button></div>`:''}
    ${renderAdminConfirm()}`;
}
function renderAdminConfirm(){
  const a=adminState(), c=a.confirm; if(!c) return '';
  const users=c.ids.map(id=>a.users.find(u=>u.id===id) || (a.detail?.user?.id===id?{...a.detail.user,...a.detail.stats}:null)).filter(Boolean);
  const trades=users.reduce((x,u)=>x+(u.trades||0),0), notes=users.reduce((x,u)=>x+(u.notes||0),0);
  const risky=trades>0||notes>0||users.length>1;
  return `<div class="edit-overlay sm-overlay" data-action="admin-confirm-backdrop"><div class="edit-modal sm-modal adm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="adm-confirm-title">
    <div class="adm-confirm-icon" aria-hidden="true">🗑️</div>
    <h2 id="adm-confirm-title">${users.length===1?`${esc(users[0].name||users[0].email)} ko delete karein?`:`${users.length} traders delete karein?`}</h2>
    <p class="card-sub">Account, saare trades, notes, playbook, activity aur chart images hamesha ke liye mit jaayenge. Yeh wapas nahi hoga.</p>
    <ul class="adm-confirm-list">${users.slice(0,6).map(u=>`<li><span class="adm-ava" aria-hidden="true">${initials(u)}</span><div><strong>${esc(u.name||'—')}</strong><small>${esc(u.email)} · ${u.trades||0} trades · ${u.notes||0} notes</small></div></li>`).join('')}${users.length>6?`<li class="more">+ ${users.length-6} aur</li>`:''}</ul>
    ${trades||notes?`<div class="adm-confirm-warn">⚠️ Inme <b>${trades}</b> trades aur <b>${notes}</b> notes hain — yeh asli traders ho sakte hain.</div>`:''}
    ${risky?`<label class="adm-confirm-type">Pakka karne ke liye <b>DELETE</b> likho<input id="adm-confirm-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DELETE"></label>`:''}
    <p class="sm-error" id="adm-confirm-status" role="status">${c.error?esc(c.error):''}</p>
    <div class="sm-form-actions"><button type="button" class="btn-secondary" data-action="admin-confirm-cancel" ${c.busy?'disabled':''}>Cancel</button><button type="button" class="btn-danger adm-confirm-go" data-action="admin-confirm-delete" ${risky||c.busy?'disabled':''}>${c.busy?'Delete ho raha hai…':`Haan, delete karo`}</button></div>
  </div></div>`;
}
async function runAdminDelete(){
  const a=adminState(), c=a.confirm; if(!c||c.busy) return;
  c.busy=true; c.error=''; renderTabOnly();
  try{
    const r = c.ids.length===1 ? await api(`/api/admin/users/${encodeURIComponent(c.ids[0])}`,'DELETE') : await api('/api/admin/users/delete','POST',{ids:c.ids});
    const deleted = c.ids.length===1 ? (r.ok?1:0) : r.deleted, failed = c.ids.length===1 ? (r.ok?[]:[r]) : (r.failed||[]);
    const gone=new Set(c.ids.filter(id=>!failed.some(f=>f.id===id)));
    a.users=a.users.filter(u=>!gone.has(u.id)); gone.forEach(id=>a.selected.delete(id));
    a.confirm=null; if(a.view==='user' && gone.has(a.detail?.user?.id)){ a.view='list'; a.detail=null; }
    a.toast=`✓ ${deleted} trader${deleted===1?'':'s'} delete ho gaye${failed.length?` · ${failed.length} nahi hue (${esc(failed[0].error||'')})`:''}`;
    renderTabOnly(); setTimeout(()=>{ a.toast=''; if(STATE.activeTab==='admin') renderTabOnly(); }, 4000);
  }catch(e){ c.busy=false; c.error=e.message||'Delete nahi hua.'; renderTabOnly(); }
}
async function openAdminUser(id){
  const a=adminState(); a.view='user'; a.detail={loading:true, id}; a.detailTab='trades'; a.openNote=null;
  renderTabOnly(); window.scrollTo({top:0,behavior:REDUCED_MOTION?'auto':'smooth'});
  try { const d=await api(`/api/admin/users/${encodeURIComponent(id)}`); a.detail=d; }
  catch(e){ a.detail={error:e.message||'Load nahi hua.', id}; }
  if(STATE.activeTab==='admin'&&a.view==='user') renderTabOnly();
}
function heatmap(trades){
  const today=new Date(); today.setHours(0,0,0,0);
  const start=addDays(weekStartOf(today),-7*11), counts={};
  trades.forEach(t=>{ const k=tradeLocalDate(t); if(k) counts[k]=(counts[k]||0)+1; });
  let cells='';
  for(let w=0;w<12;w++){ for(let d=0;d<7;d++){ const day=addDays(start,w*7+d), k=localDateKey(day), c=counts[k]||0, future=day>today;
    cells+=`<i class="lv${future?'x':Math.min(4,c)}" title="${esc(fmtDay(day,{weekday:'short',day:'numeric',month:'short'}))}: ${c} trade${c===1?'':'s'}" style="grid-column:${w+1};grid-row:${d+1}"></i>`; } }
  return `<div class="adm-heat" aria-label="Last 12 weeks trading activity">${cells}</div><div class="adm-heat-legend"><span>Kam</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>Zyada</span></div>`;
}
function miniCurve(trades){
  const closed=trades.filter(t=>!isOpenTrade(t)).sort((x,y)=>tradeSortTime(x)-tradeSortTime(y));
  if(closed.length<2) return '<p class="pb-empty">Curve ke liye kam se kam 2 closed trades chahiye.</p>';
  let run=0; const pts=[0,...closed.map(t=>(run+=Number(t.pnl)||0))]; const w=600,h=140,p=10, mn=Math.min(...pts), mx=Math.max(...pts), rg=(mx-mn)||1;
  const xy=pts.map((v,i)=>`${(p+i*(w-2*p)/(pts.length-1)).toFixed(1)},${(h-p-(v-mn)/rg*(h-2*p)).toFixed(1)}`).join(' '), zy=(h-p-(0-mn)/rg*(h-2*p)).toFixed(1);
  return `<svg class="adm-curve" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Equity curve"><line x1="${p}" y1="${zy}" x2="${w-p}" y2="${zy}" stroke="#B8C4D4" stroke-dasharray="4 4"/><polyline points="${xy}" fill="none" stroke="${run>=0?'#0B9A6A':'#E0413F'}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderAdminUser(){
  const a=adminState(), d=a.detail;
  const back=`<button type="button" class="btn-secondary btn-small" data-action="admin-back">‹ Sab traders</button>`;
  if(!d || d.loading) return `<section class="card">${back}<p class="card-sub" style="margin-top:1rem">Journal load ho raha hai…</p></section>`;
  if(d.error) return `<section class="card">${back}<p class="sm-error" style="margin-top:1rem">${esc(d.error)}</p></section>`;
  const u=d.user, s=d.stats, trades=[...d.trades].sort((x,y)=>tradeSortTime(y)-tradeSortTime(x));
  const closed=trades.filter(t=>!isOpenTrade(t));
  const group=key=>{ const m={}; closed.forEach(t=>{ const k=key(t); if(!k) return; const g=m[k]||(m[k]={k,n:0,w:0,p:0}); g.n++; if((Number(t.pnl)||0)>0) g.w++; g.p+=Number(t.pnl)||0; }); return Object.values(m); };
  const strategies=group(t=>t.strategy||'—').sort((x,y)=>y.p-x.p), mistakes=group(t=>t.mistake&&t.mistake!=='none'?mistakeLabel(t.mistake):null).sort((x,y)=>x.p-y.p), emotions=group(t=>emotionText(t)).sort((x,y)=>y.n-x.n);
  const tbl=(rows,cols)=>rows.length?`<table class="adm-mini"><tbody>${rows.map(cols).join('')}</tbody></table>`:'<p class="pb-empty">—</p>';
  const tradeRow=t=>{ const open=isOpenTrade(t), v=Number(t.pnl)||0, imgs=tradeImages(t);
    return `<div class="adm-trade"><div class="adm-trade-main"><strong>${esc(t.symbol||'—')}</strong> <span class="pb-dir ${t.type==='SHORT'?'short':'long'}">${esc(t.type||'')}</span><small>${esc(formatTradeTime(t))} · ${esc(tradeStrategyName(t))} · ${esc(emotionText(t))}</small>
      ${t.mistake&&t.mistake!=='none'?`<span class="journal-chip chip-warn">${esc(mistakeLabel(t.mistake))}</span>`:''}${t.notes?`<p class="history-quick-note"><span>Note</span>${esc(t.notes)}</p>`:''}
      ${imgs.length?`<div class="adm-thumbs">${imgs.slice(0,4).map(src=>`<img src="${esc(imgUrl(src))}" alt="Chart" loading="lazy" data-action="admin-view-image" data-src="${esc(src)}">`).join('')}</div>`:''}</div>
      <b class="${open?'':(v>=0?'positive':'negative')}">${open?'Open':money(v)}<small>${open?'':esc(String(t.rr??'—'))+' R'}</small></b></div>`; };
  const noteBody=n=>normalizeNoteBlocks(n).map(b=>b.type==='image'?(b.src?`<img src="${esc(imgUrl(b.src))}" alt="" loading="lazy" data-action="admin-view-image" data-src="${esc(b.src)}">`:''):`<div class="adm-note-text">${b.html?sanitizeNoteHtml(b.html):esc(b.text||'').replace(/\n/g,'<br>')}</div>`).join('');
  const notes=[...d.notes].sort((x,y)=>String(y.updatedAt||y.date||'').localeCompare(String(x.updatedAt||x.date||'')));
  return `<section class="card adm-user">
    <div class="blog-post-top">${back}<div class="blog-admin-actions"><span class="adm-readonly">👁 Sirf dekhne ke liye</span>${canDelete({...u,isAdmin:a.users.find(x=>x.id===u.id)?.isAdmin})?`<button type="button" class="btn-danger btn-small" data-action="admin-delete-one" data-id="${esc(u.id)}">🗑️ Delete trader</button>`:''}</div></div>
    <div class="adm-user-head"><div class="adm-avatar" aria-hidden="true">${esc((u.name||u.email||'?').trim()[0]?.toUpperCase()||'?')}</div><div><h2>${esc(u.name||'—')}</h2><p>${esc(u.email)} · joined ${esc(timeAgo(u.createdAt))} · last active ${esc(timeAgo([u.lastSeenAt,u.lastSaveAt].filter(Boolean).sort().pop()))} · ${u.visits} visits</p></div></div>
    <div class="pb-stats adm-stats">
      <div><span>Trades</span><strong>${s.closed}${s.open?`<small> +${s.open} open</small>`:''}</strong></div>
      <div><span>Net P&amp;L</span><strong class="${s.pnl>=0?'positive':'negative'}">${money(s.pnl)}</strong></div>
      <div><span>Win rate</span><strong>${s.winRate}%</strong></div>
      <div><span>Avg R</span><strong>${s.avgR}R</strong></div>
      <div><span>Rules followed</span><strong>${s.ruleRate}% ${ruleTrend(s)}</strong></div>
      <div><span>Is hafte</span><strong>${s.trades7} trades</strong><small class="${s.pnl7>=0?'positive':'negative'}">${s.trades7?money(s.pnl7):''}</small></div>
    </div>
    <div class="adm-grid">
      <div><h4>Equity curve</h4>${miniCurve(trades)}</div>
      <div><h4>Journaling activity (12 hafte)</h4>${heatmap(trades)}</div>
    </div>
    <div class="adm-grid adm-grid-3">
      <div><h4>Strategies</h4>${tbl(strategies,g=>`<tr><td>${esc(g.k)}</td><td>${g.n} · ${Math.round(g.w/g.n*100)}%</td><td class="${g.p>=0?'positive':'negative'}">${money(g.p)}</td></tr>`)}</div>
      <div><h4>Mistakes (kitne ki padi)</h4>${tbl(mistakes,g=>`<tr><td>${esc(g.k)}</td><td>×${g.n}</td><td class="${g.p>=0?'positive':'negative'}">${money(g.p)}</td></tr>`)}</div>
      <div><h4>Emotions</h4>${tbl(emotions,g=>`<tr><td>${esc(g.k)}</td><td>${g.n} · ${Math.round(g.w/g.n*100)}%</td><td class="${g.p>=0?'positive':'negative'}">${money(g.p)}</td></tr>`)}</div>
    </div>
    <div class="adm-tabs" role="tablist">
      <button type="button" role="tab" class="${a.detailTab==='trades'?'active':''}" data-action="admin-detail-tab" data-tab="trades">Trades (${trades.length})</button>
      <button type="button" role="tab" class="${a.detailTab==='notes'?'active':''}" data-action="admin-detail-tab" data-tab="notes">Notes (${notes.length})</button>
      <button type="button" role="tab" class="${a.detailTab==='strategies'?'active':''}" data-action="admin-detail-tab" data-tab="strategies">Playbook (${(d.customStrategies||[]).length})</button>
    </div>
    ${a.detailTab==='trades' ? (trades.length?`<div class="adm-trades">${trades.slice(0,a.tradeLimit||30).map(tradeRow).join('')}</div>${trades.length>(a.tradeLimit||30)?`<button type="button" class="btn-secondary btn-small adm-more" data-action="admin-more-trades">Aur dikhao (${trades.length-(a.tradeLimit||30)} baaki)</button>`:''}`:'<p class="pb-empty">Abhi koi trade nahi.</p>')
      : a.detailTab==='notes' ? (notes.length?`<div class="adm-notes">${notes.map(n=>`<div class="adm-note ${a.openNote===n.id?'open':''}"><button type="button" data-action="admin-toggle-note" data-id="${esc(n.id)}"><strong>${esc(n.title||'Untitled note')}</strong><small>${esc(n.concept||'')}${n.strategy?' · '+esc(n.strategy):''} · ${esc(timeAgo(n.updatedAt||n.date))}</small></button>${a.openNote===n.id?`<div class="adm-note-body">${noteBody(n)}</div>`:''}</div>`).join('')}</div>`:'<p class="pb-empty">Abhi koi note nahi.</p>')
      : ((d.customStrategies||[]).length?`<div class="adm-notes">${d.customStrategies.map(x=>normalizeCustomStrategy(x)).map(x=>`<div class="adm-note open"><div class="adm-note-body"><strong>${esc(x.name)}</strong>${x.entryCriteria?`<p><b>Entry:</b> ${esc(x.entryCriteria)}</p>`:''}${x.exitCriteria?`<p><b>Exit:</b> ${esc(x.exitCriteria)}</p>`:''}${(x.rules||[]).length?`<ul>${x.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}</div></div>`).join('')}</div>`:'<p class="pb-empty">Koi strategy save nahi.</p>')}
  </section>${renderAdminConfirm()}`;
}
function exportAdminCsv(){
  const rows=[['Name','Email','Joined','Last active','Trades','Trades (7d)','Closed','Net P&L','P&L (7d)','Win %','Avg R','Rules %','Top mistake','Notes','Visits']];
  adminFiltered().forEach(u=>rows.push([u.name,u.email,u.createdAt,lastActive(u)||'',u.trades,u.trades7,u.closed,u.pnl,u.pnl7,u.winRate,u.avgR,u.ruleRate,u.topMistake?mistakeLabel(u.topMistake.id):'',u.notes,u.visits]));
  const csv=rows.map(r=>r.map(v=>{ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }).join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); a.download=`traders-${localDateKey(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
function handleAdminClick(action, btn){
  const a=adminState();
  if(action==='admin-reload'){ a.loaded=false; a.error=''; renderTabOnly(); loadAdminUsers(true); return true; }
  if(action==='admin-filter'){ a.filter=btn.dataset.filter; renderTabOnly(); return true; }
  if(action==='admin-open-user'){ openAdminUser(btn.dataset.id); return true; }
  if(action==='admin-back'){ a.view='list'; a.detail=null; a.tradeLimit=30; renderTabOnly(); return true; }
  if(action==='admin-detail-tab'){ a.detailTab=btn.dataset.tab; renderTabOnly(); return true; }
  if(action==='admin-toggle-note'){ a.openNote=a.openNote===btn.dataset.id?null:btn.dataset.id; renderTabOnly(); return true; }
  if(action==='admin-more-trades'){ a.tradeLimit=(a.tradeLimit||30)+30; renderTabOnly(); return true; }
  if(action==='admin-view-image'){ openAnnotator(btn.dataset.src,null,null,{}); return true; }
  if(action==='admin-export'){ exportAdminCsv(); return true; }
  if(action==='admin-select'){ const id=btn.dataset.id; btn.checked?a.selected.add(id):a.selected.delete(id); renderTabOnly(); return true; }
  if(action==='admin-select-all'){ const ids=adminFiltered().filter(canDelete).map(u=>u.id); const all=ids.every(id=>a.selected.has(id)); ids.forEach(id=>all?a.selected.delete(id):a.selected.add(id)); renderTabOnly(); return true; }
  if(action==='admin-select-empty'){ a.users.filter(isEmptyAccount).filter(canDelete).forEach(u=>a.selected.add(u.id)); a.filter='empty'; renderTabOnly(); return true; }
  if(action==='admin-clear-selection'){ a.selected.clear(); renderTabOnly(); return true; }
  if(action==='admin-delete-selected'){ a.confirm={ids:[...a.selected]}; renderTabOnly(); setTimeout(()=>$('#adm-confirm-input')?.focus(),50); return true; }
  if(action==='admin-delete-one'){ a.confirm={ids:[btn.dataset.id]}; renderTabOnly(); setTimeout(()=>$('#adm-confirm-input')?.focus(),50); return true; }
  if(action==='admin-confirm-cancel'){ if(!a.confirm?.busy){ a.confirm=null; renderTabOnly(); } return true; }
  if(action==='admin-confirm-backdrop'){ return true; }
  if(action==='admin-confirm-delete'){ runAdminDelete(); return true; }
  return false;
}
document.addEventListener('input', e=>{ if(e.target.id==='adm-confirm-input'){ const b=$('.adm-confirm-go'); if(b && !adminState().confirm?.busy) b.disabled = e.target.value.trim().toUpperCase()!=='DELETE'; } });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && STATE.admin?.confirm && !STATE.admin.confirm.busy){ STATE.admin.confirm=null; renderTabOnly(); } });
document.addEventListener('input', e=>{ if(e.target.id!=='admin-search') return; const a=adminState(); a.search=e.target.value; clearTimeout(a.t); a.t=setTimeout(()=>{ const pos=e.target.selectionStart; renderTabOnly(); const s=$('#admin-search'); if(s){ s.focus(); try{s.setSelectionRange(pos,pos);}catch(_){} } },200); });
document.addEventListener('change', e=>{ if(e.target.id==='admin-sort'){ adminState().sort=e.target.value; renderTabOnly(); } });
document.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target.matches?.('tr[data-action="admin-open-user"]')) e.target.click(); });

/* one-time transparency notice for traders */
function maybeShowPrivacyNotice(){
  if(!STATE.user || isAdmin()) return;
  try { if(localStorage.getItem('tc_privacy_ack_'+STATE.user.id)) return; } catch(_) { return; }
  if($('#privacy-notice')) return;
  const n=document.createElement('div'); n.id='privacy-notice'; n.className='privacy-notice'; n.setAttribute('role','dialog'); n.setAttribute('aria-live','polite');
  n.innerHTML=`<strong>ℹ️ Aapka journal mentors ko dikhta hai</strong><p>Trading Gupshup ke mentors aapke trades, notes aur progress dekh sakte hain — taaki aapko sahi guidance de sakein. Aapka password kisi ko nahi dikhta.</p><button type="button" class="btn-primary btn-small" data-action="privacy-ack">Samajh gaya</button>`;
  document.body.appendChild(n);
}


/* ---------------- Quote of the Day + notifications ---------------- */
function quoteState(){ return STATE.quotes || (STATE.quotes={ today:null, recent:[], loaded:false, subscribers:0, posting:false, progress:'' }); }
async function loadQuotes(){
  const q=quoteState();
  try { const d=await api(`/api/quotes?limit=${isAdmin()?15:1}`); q.today=d.today; q.recent=d.recent||[]; q.subscribers=d.subscribers||0; q.loaded=true; }
  catch(_) { q.loaded=true; }
  if(STATE.activeTab==='copilot' || STATE.activeTab==='admin') rerenderQuoteCard();
}
function quoteSeen(){ try { return localStorage.getItem('tc_quote_seen')||''; } catch(_) { return ''; } }
function markQuoteSeen(){ const q=quoteState(); if(q.today){ try { localStorage.setItem('tc_quote_seen', q.today.id); } catch(_) {} } }
function quoteDateLabel(iso){ const d=new Date(iso); if(Number.isNaN(d.getTime())) return ''; const k=localDateKey(d), t=localDateKey(new Date()), y=localDateKey(addDays(new Date(),-1)); return k===t?'Aaj':k===y?'Kal':d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}); }
/* push support */
const PUSH = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, subscribed:false, checked:false, busy:false };
function urlB64ToUint8(b64){ const pad='='.repeat((4-b64.length%4)%4); const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function checkPush(){
  if(!PUSH.supported){ PUSH.checked=true; return; }
  try {
    const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription();
    PUSH.subscribed=!!sub && Notification.permission==='granted';
    if(PUSH.subscribed) api('/api/push','POST',{endpoint:sub.endpoint}).catch(()=>{});   // keep server copy fresh
  } catch(_) {}
  PUSH.checked=true; rerenderQuoteCard();
}
async function enablePush(){
  if(!PUSH.supported){
    alert((isIOS() || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1)) && !isStandalone() ? '🔔 iPhone par notification ke liye pehle app ko Home Screen par add karo:\nSafari → Share ⬆️ → "Add to Home Screen". Phir wahan se app kholkar 🔔 dabao.' : '🔔 Is browser mein notifications nahi chalti. Chrome ya Edge use karo.');
    return;
  }
  if(PUSH.busy) return; PUSH.busy=true; rerenderQuoteCard();
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){ alert('🔕 Notification ki permission nahi mili. Browser settings → Site settings → Notifications mein is site ko Allow karo.'); return; }
    const reg=await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/push');
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8(publicKey) });
    await api('/api/push','POST',{endpoint:sub.endpoint});
    PUSH.subscribed=true;
  }catch(e){ alert('🔔 Notification on nahi ho paye: '+(e.message||e)); }
  finally{ PUSH.busy=false; rerenderQuoteCard(); }
}
async function disablePush(){
  try{ const reg=await navigator.serviceWorker.ready, sub=await reg.pushManager.getSubscription(); if(sub){ await api('/api/push','DELETE',{endpoint:sub.endpoint}).catch(()=>{}); await sub.unsubscribe(); } }catch(_) {}
  PUSH.subscribed=false; rerenderQuoteCard();
}
function renderQuoteCard(){
  const q=quoteState(); if(!q.today) return '<div id="quote-card" hidden></div>';
  const t=q.today, isNew=quoteSeen()!==t.id;
  const share=encodeURIComponent(`“${t.text}”${t.author?' — '+t.author:''}\n\n— Trading Gupshup`);
  const bell = PUSH.subscribed ? `<button type="button" class="qotd-link" data-action="push-off" title="Notification band karo">🔔 On</button>`
    : `<button type="button" class="qotd-bell" data-action="push-on" ${PUSH.busy?'disabled':''}>${PUSH.busy?'…':'🔔 Roz notification pao'}</button>`;
  return `<section class="qotd" id="quote-card" aria-label="Quote of the Day">
    <div class="qotd-top"><span class="qotd-label">💬 Quote of the Day ${isNew?'<span class="blog-badge new">Naya</span>':''}</span><span class="qotd-date">${esc(quoteDateLabel(t.createdAt))}</span></div>
    <blockquote class="qotd-text">${esc(t.text)}</blockquote>
    ${t.author?`<p class="qotd-author">— ${esc(t.author)}</p>`:''}
    <div class="qotd-actions"><button type="button" class="qotd-link" data-action="quote-copy">📋 Copy</button><a class="qotd-link" href="https://wa.me/?text=${share}" target="_blank" rel="noopener">WhatsApp</a>${bell}</div>
  </section>`;
}
function rerenderQuoteCard(){
  const wrap=$('#dash-msgs'); if(wrap) wrap.outerHTML=renderDashMessages(); else { const el=$('#quote-card'); if(el) el.outerHTML=renderQuoteCard(); }
  const bc=$('#admin-broadcast'); if(bc) bc.outerHTML=renderAdminBroadcast();
}
function renderAdminQuotePanel(){
  const q=quoteState();
  if((STATE.broadcastMode||'quote')!=='quote') return '<div id="admin-quote" hidden></div>';
  return `<div class="adm-bc-body" id="admin-quote">
    <label class="adm-field"><span>Quote</span><textarea id="aq-text" rows="3" maxlength="500" placeholder="Aaj ka quote likho… e.g. Plan the trade, trade the plan.">${esc(q.draft||'')}</textarea></label>
    <label class="adm-field"><span>Kisne kaha <small>(optional)</small></span><input id="aq-author" maxlength="80" placeholder="e.g. Mark Douglas" value="${esc(q.draftAuthor||'')}"></label>
    <div class="adm-send-row"><label class="adm-notify"><input type="checkbox" id="aq-notify" checked><span>🔔 Sabko notification bhejo</span></label><button type="button" class="btn-primary" data-action="admin-post-quote" ${q.posting?'disabled':''}>${q.posting?'Post ho raha hai…':'💬 Quote post karo'}</button></div>
    ${q.progress?`<p class="adm-quote-progress" role="status">${q.progress}</p>`:''}
    ${q.recent.length?`<details class="adm-quote-history"><summary>Pichhle quotes (${q.recent.length})</summary><ul>${q.recent.map(x=>`<li><div><q>${esc(x.text)}</q>${x.author?` <small>— ${esc(x.author)}</small>`:''}<small>${esc(quoteDateLabel(x.createdAt))} · 🔔 ${x.notified||0} bheje</small></div><button type="button" class="be-del" data-action="admin-delete-quote" data-id="${esc(x.id)}" aria-label="Delete quote">✕</button></li>`).join('')}</ul></details>`:''}
  </div>`;
}
async function postQuote(){
  const q=quoteState(); if(q.posting) return;
  const text=($('#aq-text')?.value||'').trim(), author=($('#aq-author')?.value||'').trim(), notify=!!$('#aq-notify')?.checked;
  if(text.length<3){ $('#aq-text')?.focus(); return; }
  q.posting=true; q.progress='Quote save ho raha hai…'; q.draft=text; q.draftAuthor=author; rerenderQuoteCard();
  try{
    const r=await api('/api/quotes','POST',{text,author});
    q.today=r.quote; q.recent=[r.quote,...q.recent]; q.draft=''; q.draftAuthor='';
    if(notify && r.subscribers){
      let offset=0, sent=0, gone=0, failed=0, total=r.subscribers, guard=0;
      while(guard++<200){
        q.progress=`🔔 Notification bhej rahe hain… ${sent}/${total}`; rerenderQuoteCard();
        const b=await api('/api/quotes/notify','POST',{quoteId:r.quote.id, offset});
        sent+=b.sent; gone+=b.gone; failed+=b.failed; total=b.total+gone; offset=b.nextOffset;
        if(b.done) break;
      }
      r.quote.notified=sent;
      q.progress=`✓ Quote post ho gaya · 🔔 ${sent} device${sent===1?'':'s'} par notification gaya${gone?` · ${gone} purane device hata diye`:''}${failed?` · ${failed} fail`:''}`;
    } else q.progress = notify ? '✓ Quote post ho gaya. Abhi kisi ne notification on nahi kiya — sabko app mein dikhega.' : '✓ Quote post ho gaya (bina notification).';
  }catch(e){ q.progress='⚠ '+(e.message||'Post nahi hua.'); }
  finally{ q.posting=false; rerenderQuoteCard(); }
}
document.addEventListener('input', e=>{ const q=STATE.quotes; if(!q) return; if(e.target.id==='aq-text') q.draft=e.target.value; if(e.target.id==='aq-author') q.draftAuthor=e.target.value; });
function handleQuoteClick(action, btn){
  if(action==='push-on'){ enablePush(); return true; }
  if(action==='push-off'){ if(confirm('Quote of the Day notification is device par band karein?')) disablePush(); return true; }
  if(action==='quote-copy'){ const t=quoteState().today; if(t){ const txt=`“${t.text}”${t.author?' — '+t.author:''}`; (navigator.clipboard?.writeText(txt)||Promise.reject()).then(()=>{ btn.textContent='✓ Copied'; setTimeout(()=>{ if(btn.isConnected) btn.textContent='📋 Copy'; },1500); }).catch(()=>prompt('Copy karo:', txt)); markQuoteSeen(); } return true; }
  if(action==='admin-post-quote'){ postQuote(); return true; }
  if(action==='admin-delete-quote'){ if(!confirm('Yeh quote delete karein?')) return true; const id=btn.dataset.id; api(`/api/quotes/${encodeURIComponent(id)}`,'DELETE').then(()=>{ const q=quoteState(); q.recent=q.recent.filter(x=>x.id!==id); q.today=q.recent[0]||null; rerenderQuoteCard(); }).catch(e=>alert(e.message)); return true; }
  return false;
}


/* ---------------- feature switches (admin can turn features off for traders) ---------------- */
const FEATURES = [
  ['risk','🛡️ Risk Center','Risk Center tab aur dashboard ka loss-budget'],
  ['analysis','📊 Daily & Session Analysis','Analysis tab'],
  ['notes','🧠 Notes & Learnings','Notes tab'],
  ['history','📜 Trade History','History tab'],
  ['blog','📰 Blog','Blog tab'],
  ['playbook','🎯 Setup Playbook','Dashboard ka strategy card'],
  ['report','📄 Weekly report','PDF report buttons'],
  ['quote','💬 Quote of the Day','Dashboard ka quote card'],
  ['announcements','📢 Announcements','Dashboard ke announcements'],
  ['voice','🎤 Voice typing','Mic buttons']
];
const TAB_FEATURE = { risk:'risk', analysis:'analysis', notes:'notes', history:'history', blog:'blog' };
function featureOn(k){ return STATE.features?.[k] !== false; }
function featureVisible(k){ return isAdmin() || featureOn(k); }      // admins always see everything
function applyFeatureClasses(){
  const off = isAdmin() ? [] : FEATURES.map(f=>f[0]).filter(k=>!featureOn(k));
  FEATURES.forEach(([k])=>document.body.classList.toggle('feat-off-'+k, off.includes(k)));
  if (!isAdmin() && TAB_FEATURE[STATE.activeTab] && !featureOn(TAB_FEATURE[STATE.activeTab])) STATE.activeTab='copilot';
}
async function loadFeatures(){ try { const d=await api('/api/settings'); STATE.features=d.features||{}; } catch(_) { STATE.features=STATE.features||{}; } applyFeatureClasses(); }
function renderAdminFeaturesPanel(){
  return `<section class="card adm-features" id="admin-features">
    <div class="adm-quote-head"><h3 class="section-title">⚙️ Features on / off</h3><span class="adm-readonly">Traders ke liye · admin ko sab dikhta hai</span></div>
    <div class="adm-feature-grid">${FEATURES.map(([k,l,d])=>`<label class="adm-switch ${featureOn(k)?'on':''}"><input type="checkbox" data-feature="${k}" ${featureOn(k)?'checked':''}><span class="adm-switch-ui" aria-hidden="true"></span><span><b>${l}</b><small>${d}</small></span></label>`).join('')}</div>
    <p class="adm-quote-progress" id="adm-feature-status" role="status"></p>
  </section>`;
}
document.addEventListener('change', async e=>{
  const k=e.target.dataset?.feature; if(!k) return;
  const on=e.target.checked, st=$('#adm-feature-status'), label=(FEATURES.find(f=>f[0]===k)||[k,k])[1];
  e.target.closest('.adm-switch')?.classList.toggle('on', on);
  if(st) st.textContent='Save ho raha hai…';
  try { const d=await api('/api/settings','PUT',{features:{[k]:on}}); STATE.features=d.features; applyFeatureClasses(); renderTabNav(); if(st) st.textContent=`✓ ${label} ab traders ke liye ${on?'ON':'OFF'} hai.`; }
  catch(err){ e.target.checked=!on; e.target.closest('.adm-switch')?.classList.toggle('on', !on); if(st) st.textContent='⚠ '+(err.message||'Save nahi hua.'); }
});

/* ---------------- announcements ---------------- */
const ANN_CTA = { log:['📝 Abhi journal karo','set-tab','log'], notes:['🧠 Notes kholo','set-tab','notes'], history:['📜 History dekho','set-tab','history'], blog:['📰 Blog padho','set-tab','blog'], analysis:['📊 Analysis dekho','set-tab','analysis'], report:['📄 Weekly report','open-weekly-report',''] };
const ANN_TEMPLATES = [
  ['📝 Journaling reminder', {title:'Kya aapne aaj journal kiya? 📝', body:'Har trade ke baad sirf 30 second — entry, emotion aur mistake likho. Jo trader journal karta hai, wahi apni galti dobara nahi karta.', cta:'log', style:'important'}],
  ['🛡️ Risk reminder', {title:'Aaj ka loss limit yaad hai?', body:'Daily loss limit hit ho jaye to screen band. Kal market phir khulega — account bacha rahega to mauke bhi milenge.', cta:'', style:'important'}],
  ['📰 Naya blog', {title:'Naya blog aaya hai 📰', body:'Trading psychology par naya article — 5 minute nikal kar zaroor padho.', cta:'blog', style:'info'}],
  ['🎉 Celebration', {title:'Shabaash traders! 🎉', body:'Is hafte sabse zyada logon ne apne rules follow kiye. Discipline jaari rakho!', cta:'', style:'celebrate'}]
];
function annState(){ return STATE.ann || (STATE.ann={ list:[], all:[], loaded:false, posting:false, progress:'', draft:{title:'',body:'',cta:'log',style:'important',days:'1'} }); }
async function loadAnnouncements(){
  const a=annState();
  try { a.list=(await api('/api/announcements')).announcements||[]; if(isAdmin()) a.all=(await api('/api/announcements?all=1')).announcements||[]; a.loaded=true; } catch(_) { a.loaded=true; }
  rerenderAnnouncements();
}
function annDismissed(){ try { return JSON.parse(localStorage.getItem('tc_ann_dismissed')||'[]'); } catch(_) { return []; } }
function dismissAnn(id){ const d=annDismissed(); if(!d.includes(id)){ d.push(id); try { localStorage.setItem('tc_ann_dismissed', JSON.stringify(d.slice(-50))); } catch(_) {} } }
function visibleAnnouncements(){ const d=annDismissed(); return annState().list.filter(x=>!d.includes(x.id)).slice(0,2); }
function renderAnnouncementCards(){
  const list=visibleAnnouncements();
  if(!list.length) return '';
  return list.map(x=>{ const c=ANN_CTA[x.cta]; const icon=x.style==='celebrate'?'🎉':x.style==='important'?'📢':'ℹ️';
    return `<article class="ann ann-${esc(x.style)}" role="status">
      <div class="ann-top"><span class="ann-icon" aria-hidden="true">${icon}</span><span class="ann-label">Announcement · ${esc(quoteDateLabel(x.createdAt))}</span><button type="button" class="ann-x" data-action="ann-dismiss" data-id="${esc(x.id)}" aria-label="Hatao">×</button></div>
      <h3>${esc(x.title)}</h3>${x.body?`<p>${esc(x.body)}</p>`:''}
      ${c?`<button type="button" class="ann-cta" data-action="${c[1]}" ${c[2]?`data-tab="${c[2]}"`:''} data-ann-id="${esc(x.id)}">${c[0]} →</button>`:''}
    </article>`; }).join('');
}
function renderDashMessages(){
  const q=featureVisible('quote') ? renderQuoteCard() : '<div id="quote-card" hidden></div>';
  const a=featureVisible('announcements') ? renderAnnouncementCards() : '';
  const hasQ=!/id="quote-card" hidden/.test(q);
  return `<div class="dash-msgs ${hasQ&&a?'two':''}" id="dash-msgs">${q}${a?`<div class="ann-wrap">${a}</div>`:''}</div>`;
}
function rerenderAnnouncements(){
  const el=$('#dash-msgs'); if(el) el.outerHTML=renderDashMessages();
  const bc=$('#admin-broadcast'); if(bc) bc.outerHTML=renderAdminBroadcast();
}
function renderAdminBroadcast(){
  const mode=STATE.broadcastMode||'quote', n=quoteState().subscribers||0, live=annState().all.filter(x=>x.active&&(!x.expiresAt||new Date(x.expiresAt)>new Date())).length;
  return `<section class="card adm-broadcast" id="admin-broadcast">
    <div class="adm-bc-head"><div><h3 class="section-title">📣 Traders ko message bhejo</h3><p class="card-sub">Dashboard par dikhega · notification on ho to phone par bhi</p></div><span class="adm-readonly">🔔 ${n} device${n===1?'':'s'} par notification on</span></div>
    <div class="adm-seg" role="tablist" aria-label="Message type">
      <button type="button" role="tab" aria-selected="${mode==='quote'}" class="${mode==='quote'?'active':''}" data-action="bc-mode" data-mode="quote">💬 Quote of the Day</button>
      <button type="button" role="tab" aria-selected="${mode==='ann'}" class="${mode==='ann'?'active':''}" data-action="bc-mode" data-mode="ann">📢 Announcement${live?` <span class="adm-seg-count">${live} live</span>`:''}</button>
    </div>
    ${renderAdminQuotePanel()}${renderAdminAnnPanel()}
  </section>`;
}
function renderAdminAnnPanel(){
  const a=annState(), d=a.draft, q=quoteState();
  const opt=(v,l,cur)=>`<option value="${v}" ${String(cur)===String(v)?'selected':''}>${l}</option>`;
  if((STATE.broadcastMode||'quote')!=='ann') return '<div id="admin-ann" hidden></div>';
  return `<div class="adm-bc-body adm-ann" id="admin-ann">
    <span class="adm-field-label">Jaldi shuru karo — template chuno</span>
    <div class="adm-ann-templates">${ANN_TEMPLATES.map(([l],i)=>`<button type="button" class="qotd-link" data-action="ann-template" data-i="${i}">${l}</button>`).join('')}</div>
    <label class="adm-field"><span>Title</span><input id="an-title" maxlength="120" placeholder="e.g. Kya aapne aaj journal kiya? 📝" value="${esc(d.title)}"></label>
    <label class="adm-field"><span>Message <small>(optional)</small></span><textarea id="an-body" rows="3" maxlength="600" placeholder="Traders ko kya kehna hai…">${esc(d.body)}</textarea></label>
    <div class="adm-ann-row">
      <label>Button<select id="an-cta">${opt('','Koi button nahi',d.cta)}${Object.entries(ANN_CTA).map(([k,v])=>opt(k,v[0],d.cta)).join('')}</select></label>
      <label>Style<select id="an-style">${opt('important','📢 Important',d.style)}${opt('info','ℹ️ Info',d.style)}${opt('celebrate','🎉 Celebration',d.style)}</select></label>
      <label>Kitne din dikhe<select id="an-days">${opt('1','1 din',d.days)}${opt('3','3 din',d.days)}${opt('7','7 din',d.days)}${opt('0','Jab tak hatao nahi',d.days)}</select></label>
    </div>
    <div class="adm-send-row"><label class="adm-notify"><input type="checkbox" id="an-notify" checked><span>🔔 Sabko notification bhejo</span></label><button type="button" class="btn-primary" data-action="admin-post-ann" ${a.posting?'disabled':''}>${a.posting?'Bhej rahe hain…':'📢 Announce karo'}</button></div>
    ${a.progress?`<p class="adm-quote-progress" role="status">${a.progress}</p>`:''}
    ${a.all.length?`<details class="adm-quote-history" ${a.all.some(x=>x.active)?'open':''}><summary>Announcements (${a.all.length})</summary><ul>${a.all.map(x=>{ const live=x.active && (!x.expiresAt || new Date(x.expiresAt)>new Date()); return `<li><div><q>${esc(x.title)}</q><small>${live?'🟢 Live':'⚪ Khatam'} · ${esc(quoteDateLabel(x.createdAt))}${x.expiresAt?` · ${live?'khatam':'khatam hua'} ${esc(quoteDateLabel(x.expiresAt))}`:''} · 🔔 ${x.notified||0}</small></div><button type="button" class="be-del" data-action="admin-delete-ann" data-id="${esc(x.id)}" aria-label="Delete">✕</button></li>`; }).join('')}</ul></details>`:''}
  </div>`;
}
function readAnnDraft(){ const a=annState(); a.draft={ title:$('#an-title')?.value||'', body:$('#an-body')?.value||'', cta:$('#an-cta')?.value||'', style:$('#an-style')?.value||'info', days:$('#an-days')?.value||'1' }; return a.draft; }
async function sendPushBatches(kind, id, total, onProgress){
  let offset=0, sent=0, gone=0, failed=0, guard=0;
  while(guard++<200){ onProgress(sent,total); const b=await api('/api/quotes/notify','POST',{kind,id,offset}); sent+=b.sent; gone+=b.gone; failed+=b.failed; total=b.total+gone; offset=b.nextOffset; if(b.done) break; }
  return {sent,gone,failed};
}
async function postAnnouncement(){
  const a=annState(); if(a.posting) return;
  const d=readAnnDraft(), notify=!!$('#an-notify')?.checked;
  if(d.title.trim().length<2){ $('#an-title')?.focus(); return; }
  a.posting=true; a.progress='Announcement save ho raha hai…'; rerenderAnnouncements();
  try{
    const r=await api('/api/announcements','POST',{...d, days:Number(d.days)});
    a.list=[r.announcement,...a.list]; a.all=[r.announcement,...a.all]; a.draft={title:'',body:'',cta:'log',style:'important',days:'1'};
    if(notify && r.subscribers){
      const res=await sendPushBatches('announcement', r.announcement.id, r.subscribers, (s,t)=>{ a.progress=`🔔 Notification bhej rahe hain… ${s}/${t}`; rerenderAnnouncements(); });
      r.announcement.notified=res.sent;
      a.progress=`✓ Announcement live · 🔔 ${res.sent} device${res.sent===1?'':'s'} par gaya${res.gone?` · ${res.gone} purane device hataye`:''}${res.failed?` · ${res.failed} fail`:''}`;
    } else a.progress = notify ? '✓ Announcement live. Abhi kisi ne notification on nahi kiya — sabko app mein dikhega.' : '✓ Announcement live (bina notification).';
  }catch(e){ a.progress='⚠ '+(e.message||'Post nahi hua.'); }
  finally{ a.posting=false; rerenderAnnouncements(); }
}
function handleAnnClick(action, btn){
  const a=annState();
  if(action==='ann-dismiss'){ dismissAnn(btn.dataset.id); rerenderAnnouncements(); return true; }
  if(action==='ann-template'){ const t=ANN_TEMPLATES[Number(btn.dataset.i)]?.[1]; if(t){ a.draft={...a.draft,...t}; rerenderAnnouncements(); $('#an-title')?.focus(); } return true; }
  if(action==='admin-post-ann'){ postAnnouncement(); return true; }
  if(action==='admin-delete-ann'){ if(!confirm('Yeh announcement hata dein? Traders ko dikhna band ho jayega.')) return true; const id=btn.dataset.id; api(`/api/announcements/${encodeURIComponent(id)}`,'DELETE').then(()=>{ a.list=a.list.filter(x=>x.id!==id); a.all=a.all.filter(x=>x.id!==id); rerenderAnnouncements(); }).catch(e=>alert(e.message)); return true; }
  return false;
}
document.addEventListener('input', e=>{ if(['an-title','an-body'].includes(e.target.id)) readAnnDraft(); });
document.addEventListener('change', e=>{ if(['an-cta','an-style','an-days'].includes(e.target.id)) readAnnDraft(); });


/* ---------------- admin: system check (catches missing uploads / settings after a deploy) ---------------- */
const HEALTH_FILES = [
  ['/api/settings','functions/api/settings.js'], ['/api/quotes?limit=1','functions/api/quotes/index.js'], ['/api/announcements','functions/api/announcements/index.js'],
  ['/api/blog?limit=1','functions/api/blog/index.js'], ['/api/push','functions/api/push/index.js'], ['/api/notify/latest','functions/api/notify/latest.js'],
  ['/api/img-health','functions/api/img-health.js'], ['/api/admin/users','functions/api/admin/users/index.js']
];
const HEALTH_STATIC = [['/theme.css','theme.css','text/css'],['/vendor/jspdf.umd.min.js','vendor/jspdf.umd.min.js','javascript'],['/vendor/jspdf.plugin.autotable.min.js','vendor/jspdf.plugin.autotable.min.js','javascript'],['/icon.svg','icon.svg','svg'],['/badge-96.png','badge-96.png','image/png'],['/manifest.webmanifest','manifest.webmanifest','']];
async function runSystemCheck(){
  const box=$('#adm-health-results'); if(box) box.innerHTML='<p class="pb-empty">Check ho raha hai…</p>';
  const rows=[];
  try { const d=await api('/api/admin/health'); d.checks.forEach(c=>rows.push(c)); }
  catch(e){ rows.push({name:'Server checks',ok:false,detail:'functions/api/admin/health.js GitHub par nahi hai ya error: '+e.message}); }
  for (const [url,file] of HEALTH_FILES){
    try { const r=await fetch(url,{credentials:'same-origin',cache:'no-store'}); const type=r.headers.get('Content-Type')||''; const ok=type.includes('application/json');
      rows.push({name:`API ${url.split('?')[0]}`, ok, detail: ok?'OK':`JSON nahi aaya (${r.status}) — "${file}" GitHub par upload karo`}); }
    catch(_) { rows.push({name:`API ${url}`, ok:false, detail:'Network error'}); }
  }
  for (const [url,file,want] of HEALTH_STATIC){
    try { const r=await fetch(url,{cache:'no-store'}); const type=r.headers.get('Content-Type')||''; const ok=r.ok && (!want || type.includes(want));
      rows.push({name:`File ${file}`, ok, detail: ok?'OK':`Nahi mili — "${file}" GitHub par upload karo`}); }
    catch(_) { rows.push({name:`File ${file}`, ok:false, detail:'Network error'}); }
  }
  const bad=rows.filter(r=>!r.ok).length;
  if(box) box.innerHTML=`<p class="adm-health-sum ${bad?'bad':'good'}">${bad?`⚠️ ${bad} cheez${bad===1?'':'ein'} theek karni hai`:'✅ Sab kuch ready hai — launch kar sakte ho!'}</p><ul class="adm-health-list">${rows.map(r=>`<li class="${r.ok?'ok':'bad'}"><span>${r.ok?'✅':'❌'}</span><div><b>${esc(r.name)}</b><small>${esc(r.detail||'')}</small></div></li>`).join('')}</ul>`;
}
function renderAdminHealthPanel(){
  return `<section class="card adm-health" id="admin-health"><div class="adm-quote-head"><h3 class="section-title">🩺 System check <span class="adm-readonly">App version ${APP_VERSION}</span></h3><button type="button" class="btn-secondary btn-small" data-action="admin-health">Check karo</button></div><p class="card-sub">Har deploy ke baad ek baar chalao — GitHub par chhooti file, R2, admin emails sab check karta hai.</p><div id="adm-health-results"></div></section>`;
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
  else if (STATE.activeTab==='blog') { content.innerHTML = renderBlogTab(); if(blogState().view==='list'&&blogState().loaded) markBlogSeen(); }
  else if (STATE.activeTab==='admin') content.innerHTML = renderAdminTab();
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
  else if (STATE.activeTab==='blog') content.innerHTML = renderBlogTab();
  else if (STATE.activeTab==='admin') content.innerHTML = renderAdminTab();
  renderTabNav();
  afterTabRender();
}

/* ---------------- event delegation ---------------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action==='set-tab' && TAB_FEATURE[btn.dataset.tab] && !featureVisible(TAB_FEATURE[btn.dataset.tab])) { return; }
  if (action==='set-tab') { if (STATE.activeTab==='blog' && btn.dataset.tab!=='blog' && STATE.blog?.view==='edit' && !leaveBlogEditor()) return; if (btn.dataset.tab==='blog' && STATE.activeTab==='blog' && STATE.blog) { STATE.blog.view='list'; STATE.blog.current=null; } STATE.activeTab = btn.dataset.tab; render(); }
  else if (handleBlogClick(action, btn, e)) { /* blog */ }
  else if (handleAdminClick(action, btn)) { /* admin */ }
  else if (handleQuoteClick(action, btn)) { /* quotes */ }
  else if (handleAnnClick(action, btn)) { /* announcements */ }
  else if (action==='admin-health') { runSystemCheck(); }
  else if (action==='bc-mode') { STATE.broadcastMode=btn.dataset.mode; const bc=$('#admin-broadcast'); if(bc) bc.outerHTML=renderAdminBroadcast(); }
  else if (action==='privacy-ack') { try { localStorage.setItem('tc_privacy_ack_'+STATE.user.id, new Date().toISOString()); } catch(_) {} $('#privacy-notice')?.remove(); }
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
  else if (action==='voice-type') { startVoice(btn); }
  else if (action==='voice-stop') { stopVoice(); }
  else if (action==='voice-lang') { toggleVoiceLang(); }
  else if (action==='open-weekly-report') { openWeeklyReport(); }
  else if (action==='close-weekly-report') { closeWeeklyReport(); }
  else if (action==='report-backdrop') { if (e.target===btn) closeWeeklyReport(); }
  else if (action==='report-week') { if(STATE.report?.busy) return; STATE.report.screenshots=!!$('#report-screenshots')?.checked || (!$('#report-screenshots') && STATE.report.screenshots); STATE.report.start=addDays(STATE.report.start, 7*Number(btn.dataset.step)); renderWeeklyReportModal(); }
  else if (action==='download-weekly-report') { downloadWeeklyReport(); }
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
// Gestures are read on the whole stage, so a second finger counts even if it lands beside the picture.
const ANN_STAGE=$('#image-modal .annotator-stage');
ANN_STAGE?.addEventListener('pointerdown', startAnnotator);
ANN_STAGE?.addEventListener('pointermove', moveAnnotator);
ANN_STAGE?.addEventListener('pointerup', endAnnotator);
ANN_STAGE?.addEventListener('pointercancel', endAnnotator);
$('#annotator-move')?.addEventListener('click', () => setAnnotatorMode('move'));
$('#annotator-zoom-in')?.addEventListener('click', () => zoomAnnotatorBy(1.4));
$('#annotator-zoom-out')?.addEventListener('click', () => zoomAnnotatorBy(1/1.4));
$('#annotator-zoom-fit')?.addEventListener('click', resetAnnotatorView);
$('#image-modal .annotator-stage')?.addEventListener('wheel', e => {
  if($('#image-modal')?.style.display!=='flex') return;
  e.preventDefault();
  zoomAnnotatorAt(annView().scale*Math.exp(-e.deltaY*(e.ctrlKey?0.01:0.0025)), e.clientX, e.clientY);
}, { passive:false });
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
  if (e.key==='Escape' && STATE.report?.open && !STATE.report.busy) { closeWeeklyReport(); return; }
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
  $('#annotator-move')?.classList.toggle('active', mode==='move');
  $('#image-modal .annotator-card')?.classList.toggle('mode-move', mode==='move');
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
  STATE.annotator.view={scale:1,x:0,y:0}; ANN_POINTERS.clear(); ANN_GESTURE=null;
  setAnnotatorMode('pen');
  img.src=imgUrl(baseSrc); modal.style.display='flex';
  img.onload=()=>setupAnnotatorCanvas();
  if(img.complete) setupAnnotatorCanvas();
}
function cloneStroke(stroke){ return {mode:stroke.mode||'pen',color:stroke.color||'#ef4444',size:Number(stroke.size)>0?Number(stroke.size):4,points:(stroke.points||[]).map(p=>({x:Number(p.x),y:Number(p.y),pressure:Number.isFinite(p.pressure)?p.pressure:0.5}))}; }
// Fit the whole image inside the visible stage (both in the popup and in full screen),
// then lay the drawing canvas exactly over it.
function fitAnnotatorImage(){
  const img=$('#modal-image'), stage=$('#image-modal .annotator-stage'); if(!img||!stage||!img.naturalWidth) return;
  const cs=getComputedStyle(stage);
  const W=stage.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const H=stage.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(W<20||H<20) return;
  const fs=isAnnotatorFullscreen();
  const fit=Math.min(W/img.naturalWidth, H/img.naturalHeight, fs?4:1);
  img.style.maxWidth='none'; img.style.maxHeight='none';
  img.style.width=Math.max(1,Math.floor(img.naturalWidth*fit))+'px';
  img.style.height=Math.max(1,Math.floor(img.naturalHeight*fit))+'px';
}
function setupAnnotatorCanvas(){
  const img=$('#modal-image'), canvas=$('#annotator-canvas'); if(!img||!canvas||!img.naturalWidth) return;
  fitAnnotatorImage();
  canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
  canvas.style.width=img.offsetWidth+'px'; canvas.style.height=img.offsetHeight+'px';
  applyAnnotatorView();
  renderAnnotator();
}
/* ---- zoom & pan ----
   Two fingers: pinch to zoom + move. Mouse wheel / +/- buttons: zoom. ✋ Move tool (or one
   finger when only viewing, or a finger while an Apple Pencil is used): drag the picture.
   Pen strokes keep their real position at any zoom. */
const ANN_MIN_ZOOM=1, ANN_MAX_ZOOM=8;
function annView(){ return STATE.annotator.view || (STATE.annotator.view={scale:1,x:0,y:0}); }
function applyAnnotatorView(){
  const wrap=$('#image-modal .annotator-canvas-wrap'); if(!wrap) return;
  const v=annView(); clampAnnotatorView();
  wrap.style.transformOrigin='0 0';
  wrap.style.transform=`translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  const z=$('#annotator-zoom-level'); if(z) z.textContent=Math.round(v.scale*100)+'%';
  $('#image-modal .annotator-card')?.classList.toggle('is-zoomed', v.scale>1.01);
}
function clampAnnotatorView(){
  const v=annView(), wrap=$('#image-modal .annotator-canvas-wrap'); if(!wrap) return;
  v.scale=Math.min(ANN_MAX_ZOOM, Math.max(ANN_MIN_ZOOM, v.scale));
  if(v.scale<=1.001){ v.x=0; v.y=0; return; }
  // keep at least a quarter of the picture on screen
  const w=wrap.offsetWidth*v.scale, h=wrap.offsetHeight*v.scale, mx=w*0.75, my=h*0.75;
  v.x=Math.min(mx, Math.max(-mx, v.x)); v.y=Math.min(my, Math.max(-my, v.y));
}
function wrapLayoutOrigin(){ const wrap=$('#image-modal .annotator-canvas-wrap'), r=wrap.getBoundingClientRect(), v=annView(); return {L:r.left-v.x, T:r.top-v.y}; }
function zoomAnnotatorAt(newScale, cx, cy){
  const v=annView(), o=wrapLayoutOrigin();
  newScale=Math.min(ANN_MAX_ZOOM, Math.max(ANN_MIN_ZOOM, newScale));
  const px=(cx-o.L-v.x)/v.scale, py=(cy-o.T-v.y)/v.scale;   // image point under the focus
  v.x=cx-o.L-newScale*px; v.y=cy-o.T-newScale*py; v.scale=newScale;
  applyAnnotatorView();
}
function zoomAnnotatorBy(factor){ const st=$('#image-modal .annotator-stage').getBoundingClientRect(); zoomAnnotatorAt(annView().scale*factor, st.left+st.width/2, st.top+st.height/2); }
function resetAnnotatorView(){ STATE.annotator.view={scale:1,x:0,y:0}; applyAnnotatorView(); }
const ANN_POINTERS=new Map();
let ANN_GESTURE=null;      // {type:'pinch'|'pan', ...}
function annotatorCanDraw(){ return !$('#image-modal .annotator-card')?.classList.contains('view-only'); }
function pointerShouldPan(e){
  if(!annotatorCanDraw()) return true;
  if(STATE.annotator.mode==='move') return true;
  if(e.pointerType==='touch' && STATE.annotator.penSeen) return true;   // Apple Pencil draws, finger moves
  return false;
}
function startPinch(){
  const [a,b]=[...ANN_POINTERS.values()]; const v=annView(), o=wrapLayoutOrigin();
  const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
  ANN_GESTURE={type:'pinch', d0:Math.hypot(a.x-b.x,a.y-b.y)||1, s0:v.scale, px:(mx-o.L-v.x)/v.scale, py:(my-o.T-v.y)/v.scale};
}
function annotatorPoint(e){ const c=$('#annotator-canvas'),r=c.getBoundingClientRect(); return {x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height),pressure:Number.isFinite(e.pressure)&&e.pressure>0?e.pressure:.5}; }
function strokeWidth(stroke,p){ return Math.max(.35, stroke.size*(STATE.annotator.pressure ? (.55 + (p.pressure||.5)*.9) : 1)); }
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
  const c=$('#annotator-canvas'); if(!c||!STATE.annotator.baseSrc) return;
  if(e.target.closest && e.target.closest('button')) return;           // zoom buttons
  if(e.button>0) return;
  e.preventDefault(); try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
  if(e.pointerType==='pen') STATE.annotator.penSeen=true;
  ANN_POINTERS.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
  if(ANN_POINTERS.size>=2){
    // second finger: this is a zoom, not a drawing -> drop the half-started stroke
    STATE.annotator.drawing=false; STATE.annotator.activeStroke=null; renderAnnotator();
    startPinch(); return;
  }
  if(pointerShouldPan(e) || e.target!==c){ const v=annView(); ANN_GESTURE={type:'pan', sx:e.clientX, sy:e.clientY, x0:v.x, y0:v.y}; c.style.cursor='grabbing'; return; }
  STATE.annotator.drawing=true;
  // Size slider = thickness you see on screen, whatever the image size or zoom.
  const p=annotatorPoint(e), img=$('#modal-image');
  const screenPerImagePx=(img&&img.naturalWidth?img.offsetWidth/img.naturalWidth:1)*annView().scale;
  STATE.annotator.activeStroke={mode:STATE.annotator.mode,color:STATE.annotator.color,size:STATE.annotator.size/(screenPerImagePx||1),points:[p]};
  renderAnnotator();
}
function moveAnnotator(e){
  if(ANN_POINTERS.has(e.pointerId)) ANN_POINTERS.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
  if(ANN_GESTURE?.type==='pinch' && ANN_POINTERS.size>=2){
    e.preventDefault();
    const [a,b]=[...ANN_POINTERS.values()], g=ANN_GESTURE, v=annView(), o=wrapLayoutOrigin();
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2, s2=Math.min(ANN_MAX_ZOOM, Math.max(ANN_MIN_ZOOM, g.s0*Math.hypot(a.x-b.x,a.y-b.y)/g.d0));
    v.scale=s2; v.x=mx-o.L-s2*g.px; v.y=my-o.T-s2*g.py; applyAnnotatorView(); return;
  }
  if(ANN_GESTURE?.type==='pan'){ e.preventDefault(); const v=annView(), g=ANN_GESTURE; v.x=g.x0+(e.clientX-g.sx); v.y=g.y0+(e.clientY-g.sy); applyAnnotatorView(); return; }
  if(!STATE.annotator.drawing||!STATE.annotator.activeStroke) return;
  e.preventDefault();
  const co=e.getCoalescedEvents?e.getCoalescedEvents():null; const events=co&&co.length?co:[e];   // some browsers give an empty list
  for(const ev of events){ const p=annotatorPoint(ev); const pts=STATE.annotator.activeStroke.points; const last=pts[pts.length-1]; if(!last||Math.hypot(p.x-last.x,p.y-last.y)>=.35/annView().scale) pts.push(p); }
  renderAnnotator();
}
function endAnnotator(e){
  if(e && e.pointerId!==undefined) ANN_POINTERS.delete(e.pointerId);
  const c=$('#annotator-canvas'); if(c) c.style.cursor='';
  if(ANN_GESTURE){
    if(ANN_GESTURE.type==='pinch' && ANN_POINTERS.size===1){ const [p]=[...ANN_POINTERS.values()]; const v=annView(); ANN_GESTURE={type:'pan', sx:p.x, sy:p.y, x0:v.x, y0:v.y}; return; }
    if(ANN_POINTERS.size===0) ANN_GESTURE=null;
    return;
  }
  if(!STATE.annotator.drawing) return; STATE.annotator.drawing=false;
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
