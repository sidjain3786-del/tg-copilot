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
  trades: [], notes: [], customStrategies: [],
  activeTab: 'copilot',
  selectedPlaybookId: '',
  checkedRules: {},
  inspectionTab: 'winning',
  energyLevel: 85, noiseLevel: 15,
  selectedMindsetId: MINDSET_ARCHETYPES[0].id,
  logFormIsSetup: true, logFormDevice: 'Laptop', logFormLocation: 'Desk', logFormImage: '', logFormBeforeImage: '', logFormAfterImage: '', logFormImages: [],
  logEmotions: [], logCustomEmotion: '', editingTradeId: null,
  noteFormStrategy: '', noteFormConcept: 'General', noteFormCustomConcept: '', noteFormImage: '', noteFormBlocks: [], activeNoteId: null, editingNoteId: null, noteConceptFilter: 'ALL',
  annotator: {src:'', noteId:null, blockIndex:null, drawing:false, mode:'pen', color:'#ef4444', size:4, history:[]},
  noteAutoSaveTimer: null, noteAutoSaveBusy: false, noteInsertIndex: null,
  historyStrategyFilter: 'ALL', historyMistakeFilter: 'ALL', historyView: localStorage.getItem('tc_history_view') || 'grid'
};

/* ---------------- utils ---------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function money(n){ return n>=0 ? `+$${n}` : `-$${Math.abs(n)}`; }
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
function normalizeNoteBlocks(note){
  let raw = Array.isArray(note?.blocks) ? note.blocks : [];
  let blocks = raw.filter(b => b && (b.type==='image' || b.type==='text')).map(b =>
    b.type==='image' ? {type:'image', src:b.src||''} : {type:'text', text:String(b.text||'')}
  ).filter(b => b.type==='image' ? !!b.src : true);
  if (!blocks.length && note?.image) blocks.push({type:'image', src:note.image});
  if (!blocks.length) return [{type:'text', text:''}];
  const out=[];
  blocks.forEach((b, i) => {
    out.push(b);
    if (b.type==='image' && blocks[i+1]?.type !== 'text') out.push({type:'text', text:''});
  });
  if (out[out.length-1]?.type !== 'text') out.push({type:'text', text:''});
  return out;
}
function noteBlocksForForm(){ return (STATE.noteFormBlocks||[]).filter(b => b && (b.type==='image' ? !!b.src : !!String(b.text||'').trim())); }
function renderNoteBlocksEditor(){
  const blocks=STATE.noteFormBlocks||[];
  const box=$('#note-blocks-editor'); if(!box) return;
  box.innerHTML=blocks.length ? blocks.map((b,i)=> b.type==='image' ? `<div class=\"note-block-editor image\"><img src=\"${esc(b.src)}\" data-action=\"open-note-block-annotator\" data-index=\"${i}\"><div class=\"note-block-actions\"><button type=\"button\" class=\"btn-secondary\" data-action=\"open-note-block-annotator\" data-index=\"${i}\">✍️ Draw</button><button type=\"button\" class=\"item-delete\" data-action=\"remove-note-block\" data-index=\"${i}\">🗑️</button></div></div>` : `<div class=\"note-block-editor text\"><textarea data-note-block-text=\"${i}\" rows=\"3\" placeholder=\"Image ke neeche kya likhna hai?\">${esc(b.text)}</textarea><button type=\"button\" class=\"item-delete\" data-action=\"remove-note-block\" data-index=\"${i}\">🗑️</button></div>`).join('') : `<div class=\"notes-blocks-empty\">Abhi koi screenshot/text block nahi hai. Neeche se image ya text add karein.</div>`;
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
  await api('/api/logout', 'POST');
  STATE.user = null; STATE.trades = []; STATE.notes = []; STATE.customStrategies = [];
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
  if (STATE.customStrategies.length) {
    if (!STATE.selectedPlaybookId || !allStrategies().some(s => s.id === STATE.selectedPlaybookId)) STATE.selectedPlaybookId = allStrategies()[0].id;
    if (!STATE.noteFormStrategy || !allStrategies().some(s => s.name === STATE.noteFormStrategy)) STATE.noteFormStrategy = allStrategies()[0].name;
  } else {
    STATE.selectedPlaybookId = '';
    STATE.noteFormStrategy = '';
  }
}

async function saveUserData(){
  const payload = { trades: STATE.trades, notes: STATE.notes, customStrategies: STATE.customStrategies };
  try {
    await api('/api/data', 'POST', payload);
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    alert(`Trade save nahi hua. ${e.message || 'Please try again.'}`);
    return false;
  }
}

async function autoSaveNote(noteId){
  const note = STATE.notes.find(n => n.id === noteId);
  const status = document.querySelector('[data-note-save-status]');
  if (!note) return;
  if (status) status.textContent = 'Saving…';
  STATE.noteAutoSaveBusy = true;
  try {
    const ok = await api('/api/data', 'POST', { trades: STATE.trades, notes: STATE.notes, customStrategies: STATE.customStrategies });
    if (ok) {
      note.updatedAt = new Date().toISOString();
      if (status) status.textContent = '✓ Saved';
    }
  } catch (e) {
    console.error('Note auto-save failed:', e);
    if (status) status.textContent = '⚠ Save failed — retrying…';
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
        resolve(canvas.toDataURL('image/jpeg', 0.68));
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
function filteredHistoryTrades(){
  return STATE.trades.filter(t =>
    (STATE.historyStrategyFilter==='ALL' || tradeStrategyName(t)===STATE.historyStrategyFilter) &&
    (STATE.historyMistakeFilter==='ALL' || (t.mistake || 'none')===STATE.historyMistakeFilter)
  );
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
  {id:'history', label:'📜 Trade History Log'}
];
function renderTabNav(){
  $('#tab-nav').innerHTML = TABS.map(t =>
    `<button class="tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  const mobileIcons = {copilot:'⚡',log:'➕',notes:'🧠',history:'📜'};
  const mobileLabels = {copilot:'Co-Pilot',log:'Log Trade',notes:'Notes',history:'History'};
  const mobile = $('#mobile-tab-nav');
  if (mobile) mobile.innerHTML = TABS.map(t =>
    `<button class="mobile-tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}"><span class="mobile-tab-icon">${mobileIcons[t.id]}</span><span>${mobileLabels[t.id]}</span></button>`
  ).join('');
}

/* ---------------- Co-Pilot tab ---------------- */
function renderCopilotTab(){
  const trades = [...STATE.trades].sort((a,b)=>new Date(a.createdAt||a.date||0)-new Date(b.createdAt||b.date||0));
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
    return `<svg class="equity-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Equity curve"><line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${w-pad}" y2="${zeroY.toFixed(1)}" class="equity-zero"></line><polyline points="${pts}" class="equity-line" fill="none"></polyline></svg>`;
  })() : '<div class="dashboard-empty-chart">Save a few trades to see your equity curve.</div>';

  return `
  <section class="dashboard-hero card">
    <div>
      <span class="uppercase-label" style="color:var(--indigo);">TRADING JOURNAL DASHBOARD</span>
      <h2 class="section-title" style="font-size:1.35rem;margin:.2rem 0 .35rem;">Your trading, in numbers.</h2>
      <p class="card-sub">Yahan sirf woh data hai jo tumhari trading improve karne mein directly help karega.</p>
    </div>
    <button class="btn-primary" data-action="set-tab" data-tab="log">＋ Log New Trade</button>
  </section>

  <div class="dashboard-kpis">
    <div class="card dashboard-kpi"><span class="uppercase-label">Total Trades</span><strong>${total}</strong><small>${wins} wins · ${losses} losses</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Net P&amp;L</span><strong class="${pnl>=0?'positive':'negative'}">${money(pnl)}</strong><small>All recorded trades</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Win Rate</span><strong>${total?Math.round(wins/total*100):0}%</strong><small>${wins} profitable trades</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Average R</span><strong>${avgR.toFixed(2)}R</strong><small>Per trade</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Rule Following</span><strong>${ruleRate}%</strong><small>${followed}/${total||0} trades followed plan</small></div>
    <div class="card dashboard-kpi"><span class="uppercase-label">Avg Quality</span><strong>${avgQuality.toFixed(1)}/5</strong><small>Self-rated execution</small></div>
  </div>

  <div class="grid-2 dashboard-main-grid">
    <div class="card">
      <div class="dashboard-section-head"><div><span class="uppercase-label">PERFORMANCE</span><h3 class="section-title">Equity Curve</h3></div><span class="dashboard-stat-note">Best ${money(best)} · Worst ${money(worst)}</span></div>
      ${curveSvg}
      <div class="equity-footer"><span>Start $0</span><strong class="${pnl>=0?'positive':'negative'}">Current ${money(pnl)}</strong></div>
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
function captureLogDraft(){
  const get = id => $('#'+id)?.value ?? '';
  return {
    symbol:(get('log-symbol') === 'OTHER' ? get('log-custom-symbol') : get('log-symbol')), symbolChoice:get('log-symbol'), customSymbol:get('log-custom-symbol'), type:get('log-type') || 'LONG', qty:get('log-qty'), entry:get('log-entry'), exit:get('log-exit'), sl:get('log-sl'),
    strategy:get('log-strategy-select'), plannedEntry:get('log-planned-entry'), plannedSL:get('log-planned-sl'), plannedTP:get('log-planned-tp'),
    imageUrl:get('log-image-url'), mistake:get('log-mistake'), quality:get('log-quality'), exitReason:get('log-exit-reason'), notes:get('log-notes'),
    location:get('log-location-select'), customEmotion:get('log-custom-emotion'), emotions:[...STATE.logEmotions]
  };
}
function restoreLogDraft(draft){
  if(!draft) return;
  const set=(id,val)=>{ const el=$('#'+id); if(el && val!==undefined && val!==null) el.value=val; };
  set('log-symbol',draft.symbolChoice || draft.symbol || 'XAUUSD'); set('log-custom-symbol',draft.customSymbol || (draft.symbolChoice==='OTHER' ? draft.symbol : '')); set('log-type',draft.type); set('log-qty',draft.qty); set('log-entry',draft.entry); set('log-exit',draft.exit); set('log-sl',draft.sl);
  set('log-strategy-select',draft.strategy); set('log-planned-entry',draft.plannedEntry); set('log-planned-sl',draft.plannedSL); set('log-planned-tp',draft.plannedTP);
  set('log-image-url',draft.imageUrl); set('log-mistake',draft.mistake); set('log-quality',draft.quality); set('log-exit-reason',draft.exitReason); set('log-notes',draft.notes); set('log-location-select',draft.location); set('log-custom-emotion',draft.customEmotion);
  if (Array.isArray(draft.emotions)) STATE.logEmotions = [...draft.emotions];
}
function renderLogImagePreview(){
  const box = $('#log-image-preview');
  if (!box) return;
  const images = currentLogImages();
  box.innerHTML = images.length ? `<div class="multi-image-grid">${images.map((src,i)=>`<div class="multi-image-item"><img src="${esc(src)}" data-action="view-image" data-src="${esc(src)}"><button type="button" data-action="remove-log-image-index" data-index="${i}">×</button><span>Image ${i+1}</span></div>`).join('')}</div><div class="image-count">📸 ${images.length} image${images.length===1?'':'s'} attached</div>` : '<div class="shot-empty">No images added yet</div>';
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
        <div class="field grid-2 fast-journal-top-fields">
          <div><label>Exit Reason <span class="optional-label">optional</span></label><input type="text" id="log-exit-reason" placeholder="Target, SL, manual, time, news..."></div>
          <div><label>Quick Note <span class="optional-label">optional</span></label><input type="text" id="log-notes" placeholder="Kya sahi hua? Kya improve karna hai?"></div>
        </div>

        <div class="fast-journal-emotion">
          <div class="log-emotion-head"><div><div class="log-emotion-title">🧠 Emotion <span>* Required · Multiple allowed</span></div><div class="log-emotion-sub">Ek trade mein multiple emotions select kar sakte ho.</div></div>${STATE.logEmotions.length ? `<span class="emotion-selected-badge">✓ ${esc(STATE.logEmotions.join(' · '))}</span>` : '<span class="emotion-selected-badge empty">Select emotion(s)</span>'}</div>
          <div class="emotion-pills">${[['Calm','😌'],['Confident','💪'],['Neutral','😐'],['Anxious','😰'],['FOMO','🔥'],['Revenge / Tilt','😡'],['Overexcited','🚀'],['Tired','😴']].map(([name,emoji]) => `<button type="button" class="emotion-pill ${STATE.logEmotions.includes(name)?'selected':''}" data-action="set-log-emotion" data-value="${esc(name)}">${emoji} ${esc(name)}</button>`).join('')}</div>
          <div class="custom-emotion-row"><label for="log-custom-emotion">Custom emotion <span>optional</span></label><input type="text" id="log-custom-emotion" value="${esc(STATE.logCustomEmotion)}" placeholder="e.g. bored, impatient..." maxlength="40">${STATE.logCustomEmotion ? `<button type="button" class="use-custom-emotion ${STATE.logEmotions.includes(STATE.logCustomEmotion)?'active':''}" data-action="use-custom-emotion">Use Custom</button>` : ''}</div>
        </div>

        <div class="fast-journal-screenshots"><div class="fast-shot-head"><div><strong>📸 Before & After</strong><span>Optional — chart screenshots</span></div></div><div class="before-after-grid">
          <label class="shot-upload-card ${STATE.logFormBeforeImage?'has-image':''}"><div class="shot-label">BEFORE ENTRY</div>${STATE.logFormBeforeImage ? `<img src="${esc(STATE.logFormBeforeImage)}" alt="Before entry">` : `<div class="shot-placeholder">＋<small>Upload before entry</small></div>`}<input type="file" id="log-before-image-file" accept="image/*" style="display:none;"></label>
          <label class="shot-upload-card ${STATE.logFormAfterImage?'has-image':''}"><div class="shot-label">AFTER EXIT</div>${STATE.logFormAfterImage ? `<img src="${esc(STATE.logFormAfterImage)}" alt="After exit">` : `<div class="shot-placeholder">＋<small>Upload after exit</small></div>`}<input type="file" id="log-after-image-file" accept="image/*" style="display:none;"></label>
        </div><div class="image-url-add-row fast-extra-image"><input type="url" id="log-image-url" placeholder="Optional: paste another image URL..."><button type="button" class="btn-secondary" data-action="add-log-image-url">+ Add</button></div><div id="log-image-preview"></div></div>
      </div>

      <div class="log-step">
        <div class="log-step-title"><span>2</span><strong>Was this a setup?</strong></div>
        <div class="toggle-group log-setup-toggle">
          <button type="button" class="toggle-btn ${STATE.logFormIsSetup?'active-green':''}" data-action="set-log-setup" data-value="true">🎯 Yes, setup trade</button>
          <button type="button" class="toggle-btn ${!STATE.logFormIsSetup?'active-red':''}" data-action="set-log-setup" data-value="false">⚡ Quick trade</button>
        </div>
        ${STATE.logFormIsSetup ? `<div class="field strategy-select-field log-strategy-mini">
          <label>🎯 Strategy</label>
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
      <div style="display:flex; align-items:center; gap:.6rem;"><img src="${STATE.noteFormImage}"><span style="font-size:.7rem; color:var(--emerald); font-weight:700;">✅ Attached</span></div>
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
      </div>

      <div class="samsung-note-meta-row">
        <label class="samsung-note-concept"><span>CONCEPT</span><select data-note-editor-concept="${active.id}">${NOTE_CONCEPTS.map(c=>`<option value="${esc(c)}" ${(active.concept||'General')===c && !active.customConcept?'selected':''}>${esc(c)}</option>`).join('')}<option value="__custom__" ${active.customConcept?'selected':''}>Custom</option></select></label>
        <label class="samsung-note-strategy"><span>STRATEGY</span><input data-note-editor-strategy="${active.id}" value="${esc(active.strategy||'')}" placeholder="Optional"></label>
      </div>

      <div class="samsung-note-page">
        ${normalizeNoteBlocks(active).map((b,i)=> b.type==='image' ? `
          <div class="note-live-block image samsung-note-image-block">
            <div class="note-live-image-wrap">
              <img src="${esc(b.src)}" data-action="open-note-block-annotator" data-note-id="${active.id}" data-index="${i}" alt="Note image">
              <button type="button" class="note-block-remove-floating" data-action="remove-live-note-block" data-note-id="${active.id}" data-index="${i}" title="Remove image">×</button>
              <button type="button" class="note-draw-floating" data-action="open-note-block-annotator" data-note-id="${active.id}" data-index="${i}">✍️ Draw</button>
            </div>
          </div>` : `
          <div class="note-live-block text samsung-note-text-block">
            <textarea data-live-note-text="${active.id}" data-index="${i}" placeholder="Write something…">${esc(b.text)}</textarea>
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
  <div class="card history-filters"><div class="history-filter-grid"><div><label>Strategy Filter</label><select id="history-strategy-filter"><option value="ALL">All Strategies</option>${strategyNames.map(n=>`<option value="${esc(n)}" ${STATE.historyStrategyFilter===n?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div><label>Mistake Filter</label><select id="history-mistake-filter"><option value="ALL">All Mistakes</option>${MISTAKE_OPTIONS.map(x=>`<option value="${x[0]}" ${STATE.historyMistakeFilter===x[0]?'selected':''}>${x[1]}</option>`).join('')}</select></div></div></div>
  <div class="history-results ${mode}-view">${trades.length ? (mode==='list' ? `<div class="history-list-head"><span>Trade</span><span>Entry → Exit</span><span>Emotion</span><span>P&amp;L</span><span></span></div>${trades.map(t=>renderTradeView(t,mode)).join('')}` : trades.map(t=>renderTradeView(t,mode)).join('')) : '<p class="empty-msg">Is filter ke liye koi trade nahi mila.</p>'}</div>
  ${STATE.editingTradeId ? renderEditTradeModal(STATE.editingTradeId) : ''}`;
}

function renderEditTradeModal(id){
  const t=STATE.trades.find(x=>x.id===id); if(!t) return '';
  const imgs=Array.isArray(t.images)&&t.images.length ? t.images : [t.beforeImage,t.afterImage,t.image].filter(Boolean);
  const presets=['Calm','Confident','Neutral','Anxious','FOMO','Revenge / Tilt','Overexcited','Tired'];
  return `<div class="edit-overlay"><div class="edit-modal">
    <div class="edit-modal-head"><div><span class="uppercase-label">UPDATE TRADE</span><h2 class="section-title">✏️ Edit ${esc(t.symbol)}</h2><p class="card-sub">Jo field change karna hai karo, phir Update Trade.</p></div><button type="button" class="modal-x" data-action="cancel-edit-trade">×</button></div>
    <div class="field grid-3"><div><label>Symbol</label><input id="edit-symbol" value="${esc(t.symbol)}"></div><div><label>Direction</label><select id="edit-type"><option ${t.type==='LONG'?'selected':''}>LONG</option><option ${t.type==='SHORT'?'selected':''}>SHORT</option></select></div><div><label>Quantity</label><input type="number" step="any" id="edit-qty" value="${t.quantity??''}"></div></div>
    <div class="field grid-3"><div><label>Entry</label><input type="number" step="any" id="edit-entry" value="${t.entryPrice??''}"></div><div><label>Exit</label><input type="number" step="any" id="edit-exit" value="${t.exitPrice??''}"></div><div><label>SL</label><input type="number" step="any" id="edit-sl" value="${t.stopLoss??''}"></div></div>
    <div class="field"><label>Emotion(s)</label><div class="emotion-pills edit-emotions">${presets.map(x=>`<button type="button" class="emotion-pill ${(tradeEmotions(t).includes(x))?'selected':''}" data-action="toggle-edit-emotion" data-value="${esc(x)}">${esc(x)}</button>`).join('')}</div><input type="text" id="edit-custom-emotion" value="${esc(tradeEmotions(t).filter(x=>!presets.includes(x)).join(', '))}" placeholder="Custom emotions, comma separated"></div>
    <div class="field grid-2"><div><label>Exit Reason</label><input id="edit-exit-reason" value="${esc(t.exitReason||'')}" placeholder="Target / SL / manual / time..."></div><div><label>Images</label><div class="edit-images-list" id="edit-images-list">${imgs.map((src,i)=>`<div class="edit-image-item"><img src="${esc(src)}" data-src="${esc(src)}"><button type="button" data-action="remove-edit-image" data-index="${i}">×</button></div>`).join('')}<label class="edit-add-image">+ Add<input type="file" id="edit-multi-image-file" accept="image/*" multiple style="display:none"></label></div></div></div>
    <div class="edit-modal-actions"><button type="button" class="btn-secondary" data-action="cancel-edit-trade">Cancel</button><button type="button" class="btn-primary" data-action="update-trade" data-id="${esc(id)}">💾 Update Trade</button></div>
  </div></div>`;
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
}
function renderTabOnly(){ // re-render just the active tab (after in-tab interactions)
  const content = $('#tab-content');
  if (STATE.activeTab==='copilot') content.innerHTML = renderCopilotTab();
  else if (STATE.activeTab==='log') { content.innerHTML = renderLogTab(); renderLogImagePreview(); updateLogPreview(); }
  else if (STATE.activeTab==='notes') { content.innerHTML = renderNotesTab(); renderNoteImagePreview(); renderNoteBlocksEditor(); }
  else if (STATE.activeTab==='history') content.innerHTML = renderHistoryTab();
  renderTabNav();
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
  else if (action==='use-custom-emotion') { const draft=captureLogDraft(); const v = $('#log-custom-emotion')?.value.trim(); if (v) { STATE.logEmotions = STATE.logEmotions.filter(x=>x!==STATE.logCustomEmotion); STATE.logEmotions.push(v); STATE.logCustomEmotion = v; renderTabOnly(); restoreLogDraft(draft); } }
  else if (action==='set-log-device') { const draft=captureLogDraft(); STATE.logFormDevice = btn.dataset.value; renderTabOnly(); restoreLogDraft(draft); }
  else if (action==='remove-log-image') { STATE.logFormImage=''; STATE.logFormBeforeImage=''; STATE.logFormAfterImage=''; STATE.logFormImages=[]; renderLogImagePreview(); updateLogPreview(); }
  else if (action==='remove-log-image-index') { const i=Number(btn.dataset.index); const arr=currentLogImages(); arr.splice(i,1); STATE.logFormImages=arr; STATE.logFormBeforeImage=arr[0]||''; STATE.logFormAfterImage=arr[1]||''; renderLogImagePreview(); updateLogPreview(); }
  else if (action==='add-log-image-url') { const v=$('#log-image-url')?.value.trim(); if(v){ addLogImages([v]); $('#log-image-url').value=''; } }
  else if (action==='edit-trade') { STATE.editingTradeId=btn.dataset.id; render(); }
  else if (action==='delete-trade') { await deleteTrade(btn.dataset.id); }
  else if (action==='cancel-edit-trade') { STATE.editingTradeId=null; render(); }
  else if (action==='update-trade') { await updateExistingTrade(btn.dataset.id); }
  else if (action==='remove-edit-image') { const item=btn.closest('.edit-image-item'); item?.remove(); }
  else if (action==='remove-note-image') { STATE.noteFormImage=''; renderNoteImagePreview(); }
  else if (action==='add-note-text-block') { STATE.noteFormBlocks.push({type:'text',text:''}); renderNoteBlocksEditor(); setTimeout(()=>$$('[data-note-block-text]').at(-1)?.focus(),0); }
  else if (action==='remove-note-block') { const i=Number(btn.dataset.index); STATE.noteFormBlocks.splice(i,1); renderNoteBlocksEditor(); }
  else if (action==='add-note-image-url') { const v=$('#note-image-url')?.value.trim(); if(v){ STATE.noteFormBlocks.push({type:'image',src:v}); $('#note-image-url').value=''; renderNoteBlocksEditor(); } }
  else if (action==='open-note-block-annotator') { const noteId=btn.dataset.noteId || null; const index=Number(btn.dataset.index); const src=noteId ? (STATE.notes.find(n=>n.id===noteId)?.blocks?.[index]?.src || '') : (STATE.noteFormBlocks[index]?.src || ''); if(src) openAnnotator(src,noteId,index); }
  else if (action==='view-image') { openAnnotator(btn.dataset.src || '', null, null); }
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
    await saveUserData();
    renderTabOnly();
  }
  else if (action==='add-custom-strategy') {
    const val = $('#note-custom-strategy-input').value.trim();
    if (!val) return;
    const strategy = { id:`custom-${Date.now()}`, name:val, entryCriteria:'', exitCriteria:'', rules:[], mandatoryRules:[], commonTraps:[], winningExamples:[], losingExamples:[], winRate:0, avgRR:'—' };
    if (!STATE.customStrategies.some(s=>normalizeCustomStrategy(s).name===val)) STATE.customStrategies.push(strategy);
    STATE.noteFormStrategy = val;
    STATE.selectedPlaybookId = strategy.id;
    await saveUserData();
    renderTabOnly();
  }
  else if (action==='create-note') {
    const id = `n-${Date.now()}`;
    const note = { id, title:'Untitled Note', symbol:'General', concept:STATE.noteConceptFilter==='ALL'||STATE.noteConceptFilter==='__custom__'?'General':STATE.noteConceptFilter, customConcept:'', strategy:'', blocks:[{type:'text',text:''}], image:null, entryCriteria:'', exitCriteria:'', analysis:'', learning:'', date:new Date().toISOString(), updatedAt:new Date().toISOString() };
    STATE.notes.unshift(note);
    STATE.activeNoteId=id;
    STATE.noteConceptFilter='ALL';
    await saveUserData();
    renderTabOnly();
    setTimeout(()=>document.querySelector(`[data-note-editor-title=\"${id}\"]`)?.focus(),30);
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
    note.blocks.splice(at, 0, {type:'text', text:''});
    STATE.noteInsertIndex = at;
    const menu = $('#note-plus-menu'); if (menu) menu.style.display='none';
    renderTabOnly();
    scheduleNoteAutoSave(note.id);
    setTimeout(() => { const fields = $$(`[data-live-note-text=\"${note.id}\"]`); fields[at]?.focus(); }, 30);
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
    saveUserData();
    renderTabOnly();
  }
});

$('#modal-close').addEventListener('click', closeAnnotator);
$('#image-modal').addEventListener('click', (e) => { if (e.target.id==='image-modal') closeAnnotator(); });
$('#annotator-pen')?.addEventListener('click', () => { STATE.annotator.mode='pen'; $('#annotator-pen').classList.add('active'); $('#annotator-eraser')?.classList.remove('active'); });
$('#annotator-eraser')?.addEventListener('click', () => { STATE.annotator.mode='eraser'; $('#annotator-eraser').classList.add('active'); $('#annotator-pen')?.classList.remove('active'); });
$('#annotator-color')?.addEventListener('input', e => { STATE.annotator.color=e.target.value; STATE.annotator.mode='pen'; $('#annotator-pen')?.classList.add('active'); $('#annotator-eraser')?.classList.remove('active'); });
$('#annotator-size')?.addEventListener('input', e => STATE.annotator.size=Number(e.target.value));
$('#annotator-undo')?.addEventListener('click', undoAnnotator);
$('#annotator-clear')?.addEventListener('click', clearAnnotator);
$('#annotator-save')?.addEventListener('click', saveAnnotatedImage);
$('#annotator-canvas')?.addEventListener('pointerdown', startAnnotator);
$('#annotator-canvas')?.addEventListener('pointermove', moveAnnotator);
$('#annotator-canvas')?.addEventListener('pointerup', endAnnotator);
$('#annotator-canvas')?.addEventListener('pointercancel', endAnnotator);
window.addEventListener('resize', () => { if ($('#image-modal')?.style.display==='flex') setupAnnotatorCanvas(); });

document.addEventListener('focusin', (e) => {
  if (e.target.matches('[data-live-note-text]')) STATE.noteInsertIndex = Number(e.target.dataset.index);
});

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
    const note = STATE.notes.find(n=>n.id===e.target.dataset.liveNoteText); const i=Number(e.target.dataset.index);
    if(note){ note.blocks=normalizeNoteBlocks(note); if(note.blocks[i]) note.blocks[i].text=e.target.value; scheduleNoteAutoSave(note.id); }
  }
  else if (e.target.matches('[data-note-editor-entry]')) updateActiveNoteField(e.target.dataset.noteEditorEntry,'entryCriteria',e.target.value);
  else if (e.target.matches('[data-note-editor-exit]')) updateActiveNoteField(e.target.dataset.noteEditorExit,'exitCriteria',e.target.value);
  else if (e.target.matches('[data-note-editor-analysis]')) updateActiveNoteField(e.target.dataset.noteEditorAnalysis,'analysis',e.target.value);
  else if (e.target.matches('[data-note-editor-learning]')) updateActiveNoteField(e.target.dataset.noteEditorLearning,'learning',e.target.value);
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
  if (e.target.id==='playbook-select') { STATE.selectedPlaybookId = e.target.value; STATE.checkedRules = {}; renderTabOnly(); }
  else if (e.target.id==='log-strategy-select') { STATE.selectedPlaybookId = e.target.value; STATE.checkedRules = {}; updateLogPreview(); }
  else if (e.target.id==='log-location-select') { STATE.logFormLocation = e.target.value; updateLogPreview(); }
  else if (e.target.id==='history-strategy-filter') { STATE.historyStrategyFilter = e.target.value; renderTabOnly(); }
  else if (e.target.id==='history-mistake-filter') { STATE.historyMistakeFilter = e.target.value; renderTabOnly(); }
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
    Promise.all(files.map(readAndCompressImage)).then(srcs=>{
      note.blocks=normalizeNoteBlocks(note);
      let at = Number.isInteger(STATE.noteInsertIndex) ? Math.min(STATE.noteInsertIndex + 1, note.blocks.length) : note.blocks.length;
      srcs.forEach(src=>{
        note.blocks.splice(at, 0, {type:'image', src});
        at += 1;
        if (note.blocks[at]?.type !== 'text') note.blocks.splice(at, 0, {type:'text', text:''});
        at += 1;
      });
      note.image=note.blocks.find(b=>b.type==='image')?.src || null;
      STATE.noteInsertIndex = Math.max(0, at-1);
      renderTabOnly();
      scheduleNoteAutoSave(note.id);
      setTimeout(() => { const fields = $$(`[data-live-note-text=\"${note.id}\"]`); fields[Math.min(at-1, fields.length-1)]?.focus(); }, 30);
    }).catch(err=>alert(err.message||'Image upload failed.'));
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
      loaded.forEach(src=>{ const wrap=document.createElement('div'); wrap.className='edit-image-item'; wrap.innerHTML=`<img src="${src}" data-src="${src}"><button type="button" data-action="remove-edit-image">×</button>`; box?.insertBefore(wrap, box.querySelector('.edit-add-image')); });
    }).catch(err=>alert(err.message || 'Image upload failed.'));
    e.target.value='';
  }
  else if (e.target.id==='note-block-image-file') {
    const files=[...e.target.files]; if(!files.length) return;
    Promise.all(files.map(readAndCompressImage)).then(srcs=>{ srcs.forEach(src=>STATE.noteFormBlocks.push({type:'image',src})); renderNoteBlocksEditor(); }).catch(err=>alert(err.message||'Image upload failed.'));
    e.target.value='';
  }
});

function openAnnotator(src,noteId=null,blockIndex=null){
  const modal=$('#image-modal'); const img=$('#modal-image'); const canvas=$('#annotator-canvas'); if(!modal||!img||!canvas) return;
  STATE.annotator={src,noteId,blockIndex,drawing:false,mode:'pen',color:$('#annotator-color')?.value||'#ef4444',size:Number($('#annotator-size')?.value)||4,history:[]};
  img.src=src; modal.style.display='flex';
  img.onload=()=>setupAnnotatorCanvas();
  if(img.complete) setupAnnotatorCanvas();
}
function setupAnnotatorCanvas(){
  const img=$('#modal-image'), canvas=$('#annotator-canvas'); if(!img||!canvas||!img.naturalWidth) return;
  const rect=img.getBoundingClientRect(); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight; canvas.style.width=rect.width+'px'; canvas.style.height=rect.height+'px';
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); STATE.annotator.history=[ctx.getImageData(0,0,canvas.width,canvas.height)];
}
function annotatorPoint(e){ const c=$('#annotator-canvas'), r=c.getBoundingClientRect(); return {x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)}; }
function startAnnotator(e){ const c=$('#annotator-canvas'); if(!c||!STATE.annotator.src) return; e.preventDefault(); STATE.annotator.drawing=true; c.setPointerCapture?.(e.pointerId); const p=annotatorPoint(e),ctx=c.getContext('2d'); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=STATE.annotator.size; ctx.strokeStyle=STATE.annotator.color; ctx.globalCompositeOperation=STATE.annotator.mode==='eraser'?'destination-out':'source-over'; ctx.lineTo(p.x+.1,p.y+.1); ctx.stroke(); }
function moveAnnotator(e){ if(!STATE.annotator.drawing) return; e.preventDefault(); const c=$('#annotator-canvas'),ctx=c.getContext('2d'),p=annotatorPoint(e); ctx.lineTo(p.x,p.y); ctx.stroke(); }
function endAnnotator(){ if(!STATE.annotator.drawing) return; STATE.annotator.drawing=false; const c=$('#annotator-canvas'),ctx=c.getContext('2d'); STATE.annotator.history.push(ctx.getImageData(0,0,c.width,c.height)); if(STATE.annotator.history.length>30) STATE.annotator.history.shift(); }
function undoAnnotator(){ const c=$('#annotator-canvas'),ctx=c?.getContext('2d'); if(!c||STATE.annotator.history.length<2) return; STATE.annotator.history.pop(); ctx.putImageData(STATE.annotator.history.at(-1),0,0); }
function clearAnnotator(){ const c=$('#annotator-canvas'),ctx=c?.getContext('2d'); if(!c) return; ctx.clearRect(0,0,c.width,c.height); STATE.annotator.history=[ctx.getImageData(0,0,c.width,c.height)]; }
function saveAnnotatedImage(){ const img=$('#modal-image'),overlay=$('#annotator-canvas'); if(!img||!overlay||!img.naturalWidth) return; const out=document.createElement('canvas'); out.width=img.naturalWidth; out.height=img.naturalHeight; const ctx=out.getContext('2d'); ctx.drawImage(img,0,0,out.width,out.height); ctx.drawImage(overlay,0,0); const src=out.toDataURL('image/jpeg',.82);
  if(STATE.annotator.noteId){ const note=STATE.notes.find(n=>n.id===STATE.annotator.noteId); if(note){ note.blocks=normalizeNoteBlocks(note); if(note.blocks[STATE.annotator.blockIndex]) note.blocks[STATE.annotator.blockIndex]={type:'image',src}; note.image=note.blocks.find(b=>b.type==='image')?.src||null; saveUserData(); renderTabOnly(); } }
  else if(STATE.annotator.blockIndex!==null && STATE.noteFormBlocks[STATE.annotator.blockIndex]) { STATE.noteFormBlocks[STATE.annotator.blockIndex].src=src; renderNoteBlocksEditor(); }
  closeAnnotator();
}
function closeAnnotator(){ const modal=$('#image-modal'); if(modal) modal.style.display='none'; const canvas=$('#annotator-canvas'); canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height); }

async function deleteTrade(id){
  const index = STATE.trades.findIndex(t => t.id === id);
  if (index < 0) return;
  const trade = STATE.trades[index];
  const label = `${trade.symbol || 'this trade'}${trade.pnl !== undefined ? ` (${money(Number(trade.pnl)||0)})` : ''}`;
  if (!confirm(`Delete ${label}?\n\nThis trade will be removed from your journal.`)) return;
  STATE.trades.splice(index, 1);
  const saved = await saveUserData();
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
  const pnl=(entry&&exit&&qty)?Math.round((type==='LONG'?(exit-entry)*qty:(entry-exit)*qty)*100)/100:(t.pnl||0);
  const rr=(sl&&entry&&exit&&entry!==sl)?Math.round(((type==='LONG'?exit-entry:entry-exit)/Math.abs(entry-sl))*100)/100:(t.rr||0);
  const snapshot = JSON.parse(JSON.stringify(t));
  Object.assign(t,{symbol:symbol.toUpperCase(),type,emotions,quantity:Number.isFinite(qty)?qty:t.quantity,entryPrice:Number.isFinite(entry)?entry:null,exitPrice:Number.isFinite(exit)?exit:null,stopLoss:Number.isFinite(sl)?sl:null,emotion,exitReason:$('#edit-exit-reason')?.value.trim()||'',images,beforeImage:images[0]||null,afterImage:images[1]||null,image:images[0]||null,pnl,rr});
  const saved = await saveUserData();
  if (!saved) { Object.assign(t, snapshot); return; }
  STATE.editingTradeId=null; render();
}

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
      notes: $('#log-notes')?.value || '', exitReason: $('#log-exit-reason')?.value.trim() || '', image: currentLogImages()[0] || null, beforeImage: currentLogImages()[0] || null, afterImage: currentLogImages()[1] || null, images: currentLogImages(),
      plannedEntry, plannedSL, plannedTP, plannedRR, mistake: $('#log-mistake').value, quality: Number($('#log-quality').value), followedPlan: STATE.logFormIsSetup && $('#log-mistake').value==='none',
      date: new Date().toISOString(), pnl: p.pnl, rr: p.rr, xpEarned: p.xp
    };
    STATE.trades.unshift(newTrade);
    const saved = await saveUserData();
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
    await saveUserData();
    renderTabOnly();
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
