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
  logEmotion: '', logCustomEmotion: '', logConfidence: 70, editingTradeId: null,
  noteFormStrategy: '', noteFormImage: '', activeNoteId: null,
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
  {id:'reality', label:'📊 Reality Check & Device Impact'},
  {id:'history', label:'📜 Trade History Log'}
];
function renderTabNav(){
  $('#tab-nav').innerHTML = TABS.map(t =>
    `<button class="tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}">${t.label}</button>`
  ).join('');
  const mobileIcons = {copilot:'⚡',log:'➕',notes:'🧠',reality:'📊',history:'📜'};
  const mobileLabels = {copilot:'Co-Pilot',log:'Log Trade',notes:'Notes',reality:'Reality',history:'History'};
  const mobile = $('#mobile-tab-nav');
  if (mobile) mobile.innerHTML = TABS.map(t =>
    `<button class="mobile-tab-btn ${STATE.activeTab===t.id?'active':''}" data-action="set-tab" data-tab="${t.id}"><span class="mobile-tab-icon">${mobileIcons[t.id]}</span><span>${mobileLabels[t.id]}</span></button>`
  ).join('');
}

/* ---------------- Co-Pilot tab ---------------- */
function renderCopilotTab(){
  const score = computeBattery();
  const tl = computeTrafficLight(score);
  const strategy = findStrategy(STATE.selectedPlaybookId);
  const learnings = STATE.notes.filter(n=>n.learning);

  const barColor = score>=70 ? '#059669' : score>=40 ? '#d97706' : '#e11d48';
  const bannerColors = { green:['#ecfdf5','#a7f3d0','#065f46'], yellow:['#fffbeb','#fde68a','#78350f'], red:['#fff1f2','#fecdd3','#881337'] }[tl.cls];

  return `
  <div class="card">
    <div class="battery-row">
      <div>
        <h2 class="section-title">🔋 Dimaag Ka Battery Gauge</h2>
        <p class="card-sub">Check mental readiness before opening live market charts.</p>
      </div>
      <div class="battery-readout">
        <div class="battery-bar-track"><div class="battery-bar-fill" id="battery-bar" style="width:${score}%; background:${barColor}"></div></div>
        <span class="mono" id="battery-percent" style="font-size:1.2rem; font-weight:800; color:${barColor}">${score}%</span>
      </div>
    </div>

    <div class="grid-3" style="margin-top:1.25rem;">
      <div style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:1rem; grid-column: span 1;">
        <span class="uppercase-label">Quick Readiness Sliders</span>
        <div class="slider-block">
          <label><span>Energy Level</span><span class="mono" id="energy-val">${STATE.energyLevel}%</span></label>
          <input type="range" min="10" max="100" value="${STATE.energyLevel}" id="energy-slider">
        </div>
        <div class="slider-block" style="margin-top:.6rem;">
          <label><span>Environment Chaos / Noise</span><span class="mono" id="noise-val">${STATE.noiseLevel}%</span></label>
          <input type="range" min="0" max="100" value="${STATE.noiseLevel}" id="noise-slider">
        </div>
      </div>
      <div style="grid-column: span 2;">
        <span class="uppercase-label">Abhi Kaisa Feel Ho Raha Hai?</span>
        <div class="mindset-grid">
          ${MINDSET_ARCHETYPES.map(m => `
            <div class="mindset-card ${STATE.selectedMindsetId===m.id?'selected':''}" data-action="select-mindset" data-id="${m.id}">
              <div style="display:flex; justify-content:space-between;"><span class="mindset-emoji">${m.emoji}</span><span class="mono" style="font-size:.6rem; font-weight:700;">${m.battery}%</span></div>
              <p class="mindset-name">${m.name}</p>
              <p class="mindset-desc">${m.desc}</p>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="traffic-banner" id="traffic-banner" style="background:${bannerColors[0]}; border-color:${bannerColors[1]}; color:${bannerColors[2]}">
      <div><strong id="traffic-title">${tl.title}</strong> <span style="font-size:.72rem;" id="traffic-msg">— ${tl.msg}</span></div>
      <button data-action="record-state" class="btn-primary" style="background:var(--slate-900); font-size:.6rem; padding:.45rem .8rem;">Record State</button>
    </div>
  </div>

  ${learnings.length ? `
  <div class="card">
    <h3 class="section-title">📚 Apki Learnings — Trade Se Pehle Yaad Rakho</h3>
    <p class="card-sub" style="margin-bottom:.75rem;">Apne Notes tab se saved seekh, taaki galti kum se kum ho.</p>
    <div class="grid-3">
      ${learnings.slice(0,6).map(n => `
        <div style="background:var(--indigo-light); border:1px solid #c7d2fe; border-radius:1rem; padding:.85rem;">
          <span style="font-size:.6rem; font-weight:700; color:var(--indigo); text-transform:uppercase;">${esc(n.symbol)}</span>
          <p style="font-size:.72rem; color:#3730a3; font-weight:600; margin:.25rem 0 0;">${esc(n.learning)}</p>
        </div>`).join('')}
    </div>
  </div>` : ''}

  <div class="grid-2">
    <div>
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:.75rem; border-bottom:1px solid var(--slate-100); flex-wrap:wrap; gap:.5rem;">
          <div><span class="uppercase-label" style="margin:0; color:var(--indigo);">Playbook Model</span><h3 style="margin:.1rem 0 0; font-size:.95rem; font-weight:800;">${esc(strategy.name)}</h3></div>
          <select id="playbook-select" ${allStrategies().length ? '' : 'disabled'} style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:.75rem; padding:.4rem .7rem; font-size:.7rem; font-weight:700; color:var(--indigo);">
            ${allStrategies().length ? allStrategies().map(p => `<option value="${esc(p.id)}" ${p.id===STATE.selectedPlaybookId?'selected':''}>${esc(p.name)}</option>`).join('') : '<option>No custom strategies yet</option>'}
          </select>
        </div>
        <span class="uppercase-label">Pre-Flight Mandatory Rules</span>
        ${strategy.mandatoryRules.length ? strategy.mandatoryRules.map((rule, idx) => `
          <div class="rule-item ${STATE.checkedRules[idx]?'checked':''}" data-action="toggle-rule" data-idx="${idx}">
            <div class="rule-check">${STATE.checkedRules[idx]?'✓':''}</div><span>${esc(rule)}</span>
          </div>`).join('') : `<div class="empty-msg">Apni custom strategy banane ke liye <strong>Notes → ADD STRATEGY</strong> par jaiye. Yahan koi built-in ICT/Order Block/FVG playbook nahi hai.</div>`}
      </div>

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:.5rem;">
          <h3 class="section-title">👁️ Past Executions Inspection</h3>
          <div style="display:flex; gap:.35rem; background:var(--slate-100); padding:.25rem; border-radius:1rem;">
            <button data-action="set-inspection" data-value="winning" class="tab-btn ${STATE.inspectionTab==='winning'?'active':''}" style="${STATE.inspectionTab==='winning'?'background:var(--emerald);color:#fff;':''}">🟢 Winning</button>
            <button data-action="set-inspection" data-value="losing" class="tab-btn ${STATE.inspectionTab==='losing'?'active':''}" style="${STATE.inspectionTab==='losing'?'background:var(--rose);color:#fff;':''}">🔴 Losing</button>
          </div>
        </div>
        ${(() => {
          const past = strategyPastExecutions(strategy.name);
          const list = STATE.inspectionTab==='winning' ? past.winning : past.losing;
          if (!list.length) return `<p class="empty-msg">Is strategy ke ${STATE.inspectionTab==='winning'?'winning':'losing'} past executions abhi nahi hain.</p>`;
          return list.slice(0, 8).map(t => `
            <div class="example-row">
              <div style="min-width:0;"><div style="display:flex;gap:.45rem;align-items:center;flex-wrap:wrap;"><span style="font-weight:800; font-size:.75rem;">${esc(t.symbol)}</span><span class="journal-chip">${esc(t.type)}</span><span class="journal-chip">⭐ ${t.quality||3}/5</span></div><p style="font-size:.66rem; color:var(--slate-500); margin:.25rem 0 0;">Entry ${t.entryPrice ?? '—'} • Exit ${t.exitPrice ?? '—'} • ${esc(mistakeLabel(t.mistake||'none'))}</p></div>
              <span class="mono" style="color:${Number(t.pnl)>=0?'var(--emerald)':'var(--rose)'}; font-weight:800; font-size:.72rem; white-space:nowrap;">${money(Number(t.pnl)||0)} (${t.rr ?? '—'}R)</span>
            </div>`).join('');
        })()}
      </div>
    </div>

    <div>
      <div class="card">
        <h3 class="section-title" style="color:var(--rose);">🛑 Personal Traps To Avoid</h3>
        ${strategy.commonTraps.map(t => `<div class="trap-item">• ${esc(t)}</div>`).join('')}
      </div>
      <div class="card">
        <h3 class="section-title">Setup Win Rate</h3>
        <div class="grid-3" style="grid-template-columns:1fr 1fr;">
          <div style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:.85rem;"><span class="uppercase-label" style="margin:0;">Win Rate</span><span class="mono" style="font-size:1.3rem; font-weight:800; color:var(--emerald);">${strategy.winRate}%</span></div>
          <div style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:.85rem;"><span class="uppercase-label" style="margin:0;">Avg R:R</span><span class="mono" style="font-size:1.3rem; font-weight:800; color:var(--indigo);">${strategy.avgRR}</span></div>
        </div>
      </div>
    </div>
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
    symbol:get('log-symbol'), type:get('log-type') || 'LONG', qty:get('log-qty'), entry:get('log-entry'), exit:get('log-exit'), sl:get('log-sl'),
    strategy:get('log-strategy-select'), plannedEntry:get('log-planned-entry'), plannedSL:get('log-planned-sl'), plannedTP:get('log-planned-tp'),
    imageUrl:get('log-image-url'), mistake:get('log-mistake'), quality:get('log-quality'), exitReason:get('log-exit-reason'), notes:get('log-notes'),
    location:get('log-location-select'), customEmotion:get('log-custom-emotion'), confidence:get('log-confidence') || String(STATE.logConfidence || 70)
  };
}
function restoreLogDraft(draft){
  if(!draft) return;
  const set=(id,val)=>{ const el=$('#'+id); if(el && val!==undefined && val!==null) el.value=val; };
  set('log-symbol',draft.symbol); set('log-type',draft.type); set('log-qty',draft.qty); set('log-entry',draft.entry); set('log-exit',draft.exit); set('log-sl',draft.sl);
  set('log-strategy-select',draft.strategy); set('log-planned-entry',draft.plannedEntry); set('log-planned-sl',draft.plannedSL); set('log-planned-tp',draft.plannedTP);
  set('log-image-url',draft.imageUrl); set('log-mistake',draft.mistake); set('log-quality',draft.quality); set('log-exit-reason',draft.exitReason); set('log-notes',draft.notes); set('log-location-select',draft.location); set('log-custom-emotion',draft.customEmotion);
  set('log-confidence',draft.confidence);
  STATE.logConfidence = Number(draft.confidence)||70;
  const cv=$('#log-confidence-val'); if(cv) cv.textContent=STATE.logConfidence+'/100';
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

      <div class="log-emotion-required">
        <div class="log-emotion-head">
          <div>
            <div class="log-emotion-title">🧠 How were you feeling? <span>* Required</span></div>
            <div class="log-emotion-sub">Ek emotion choose karo — trade ke waqt tumhari actual state.</div>
          </div>
          ${STATE.logEmotion ? `<span class="emotion-selected-badge">✓ ${esc(STATE.logEmotion)}</span>` : '<span class="emotion-selected-badge empty">Select one</span>'}
        </div>
        <div class="emotion-pills">
          ${[
            ['Calm','😌'],['Confident','💪'],['Neutral','😐'],['Anxious','😰'],
            ['FOMO','🔥'],['Revenge / Tilt','😡'],['Overexcited','🚀'],['Tired','😴']
          ].map(([name,emoji]) => `<button type="button" class="emotion-pill ${STATE.logEmotion===name?'selected':''}" data-action="set-log-emotion" data-value="${esc(name)}">${emoji} ${esc(name)}</button>`).join('')}
        </div>
        <div class="emotion-confidence-row">
          <div class="confidence-box">
            <div class="confidence-head"><label>Confidence <span>*</span></label><strong id="log-confidence-val">${STATE.logConfidence}/100</strong></div>
            <input type="range" id="log-confidence" min="1" max="100" value="${STATE.logConfidence}">
            <div class="confidence-scale"><span>1</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
          </div>
          <div class="custom-emotion-row">
            <label for="log-custom-emotion">Custom emotion <span>optional</span></label>
            <input type="text" id="log-custom-emotion" value="${esc(STATE.logCustomEmotion)}" placeholder="e.g. bored, impatient, stressed..." maxlength="40">
            ${STATE.logCustomEmotion ? `<button type="button" class="use-custom-emotion ${STATE.logEmotion===STATE.logCustomEmotion?'active':''}" data-action="use-custom-emotion">Use Custom</button>` : ''}
          </div>
        </div>
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
        <summary>📸 Screenshots &amp; Images <span>Optional — add as many as you want</span></summary>
        <div class="log-advanced-body">
          <label class="upload-box multi-upload-box"><span>📸</span><span>Add multiple screenshots / images</span><small>PNG, JPG, WebP • multiple files allowed</small><input type="file" id="log-multi-image-file" accept="image/*" multiple style="display:none;"></label>
          <div class="image-url-add-row"><input type="url" id="log-image-url" placeholder="Paste image URL..."><button type="button" class="btn-secondary" data-action="add-log-image-url">+ Add</button></div>
          <div id="log-image-preview"></div>
        </div>
      </details>

      <details class="log-advanced">
        <summary>📝 Review <span>Mistake, quality &amp; notes</span></summary>
        <div class="log-advanced-body">
          <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
            <div><label>Mistake Tag</label><select id="log-mistake">${MISTAKE_OPTIONS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></div>
            <div><label>Trade Quality</label><select id="log-quality"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Good</option><option value="3" selected>★★★ Average</option><option value="2">★★ Poor</option><option value="1">★ Rule Break</option></select></div>
          </div>
          <div class="field grid-2"><div><label>Exit Reason <span class="optional-label">optional</span></label><input type="text" id="log-exit-reason" placeholder="Target, SL, manual, time, news..."></div><div><label>Quick Note <span class="optional-label">optional</span></label><input type="text" id="log-notes" placeholder="Kya sahi hua? Kya improve karna hai?"></div></div>
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
  const strategyObjects = allStrategies();
  const strategyOptions = strategyObjects.map(p => `<option value="${esc(p.name)}" ${STATE.noteFormStrategy===p.name?'selected':''}>${esc(p.name)}</option>`).join('');
  const notes = STATE.notes || [];
  if (!STATE.activeNoteId || !notes.some(n => n.id === STATE.activeNoteId)) STATE.activeNoteId = notes[0]?.id || null;
  const active = notes.find(n => n.id === STATE.activeNoteId) || null;

  const renderReading = () => active ? `
    <article class="note-reading-paper">
      <div class="note-reading-topline">
        <div>
          <div class="note-reading-meta">${esc(active.symbol || 'General')}${active.strategy ? ` <span>•</span> ${esc(active.strategy)}` : ''}</div>
          <h2>${esc(active.title || active.symbol || 'Trading Note')}</h2>
          <div class="note-reading-date">${new Date(active.date).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}</div>
        </div>
        <button class="item-delete note-reading-delete" data-action="delete-note" data-id="${active.id}" title="Delete note">🗑️</button>
      </div>

      ${active.image ? `<figure class="note-reading-image"><img src="${active.image}" data-action="view-image" data-src="${active.image}"><figcaption>Chart attached to this note</figcaption></figure>` : ''}

      ${(active.entryCriteria||active.exitCriteria) ? `<div class="note-reading-rules">
        ${active.entryCriteria ? `<div><span>ENTRY CRITERIA</span><p>${esc(active.entryCriteria)}</p></div>` : ''}
        ${active.exitCriteria ? `<div><span>EXIT / INVALIDATION</span><p>${esc(active.exitCriteria)}</p></div>` : ''}
      </div>` : ''}

      ${active.analysis ? `<section class="note-reading-section"><div class="note-reading-label">MY ANALYSIS</div><p>${esc(active.analysis)}</p></section>` : ''}
      ${active.learning ? `<section class="note-reading-learning"><div class="note-reading-label">✦ WHAT I LEARNED</div><p>${esc(active.learning)}</p></section>` : ''}
    </article>` : `
    <div class="note-reading-empty">
      <div class="note-reading-empty-icon">📝</div>
      <h3>Your reading space</h3>
      <p>Save a note and it will appear here in a calm, distraction-free format.</p>
    </div>`;

  return `
  <div class="notes-workspace">
    ${renderStrategyBuilder()}

    <div class="notes-capture card">
      <div class="notes-capture-heading">
        <div>
          <span class="uppercase-label">WRITE &amp; REFLECT</span>
          <h2 class="section-title">📝 Capture a Trade Thought</h2>
          <p class="card-sub">Chart dekho, apni thinking likho, save karo. Padhne ka experience neeche alag rakha gaya hai.</p>
        </div>
        <span class="xp-badge">+15 XP</span>
      </div>
      <form id="notes-form">
        <div class="field"><label>Title / Symbol / Tag</label><input type="text" id="note-symbol" placeholder="e.g. XAUUSD — London Liquidity Review"></div>

        <div class="field">
          <label>Strategy</label>
          <select id="note-strategy-select" ${strategyObjects.length ? '' : 'disabled'}>${strategyObjects.length ? strategyOptions : '<option>No custom strategies yet</option>'}</select>
          <p class="card-sub" style="margin:.4rem 0 0;">New strategy banane ke liye upar <strong>ADD STRATEGY</strong> use karein.</p>
        </div>

        <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
          <div><label>Entry Criteria</label><textarea id="note-entry" rows="3" placeholder="Kin conditions par entry loge?"></textarea></div>
          <div><label>Exit Criteria</label><textarea id="note-exit" rows="3" placeholder="Kab exit / target / SL hit consider karoge..."></textarea></div>
        </div>

        <div class="field note-upload-field">
          <label>📷 Attach Chart Screenshot <span>(optional)</span></label>
          <div class="grid-3" style="grid-template-columns:1fr 1fr;">
            <label class="upload-box"><span>⬆️</span><span style="font-size:.7rem; font-weight:700;">Upload Local File</span><input type="file" id="note-image-file" accept="image/*" style="display:none;"></label>
            <input type="url" id="note-image-url" placeholder="Or paste image URL...">
          </div>
          <div id="note-image-preview"></div>
        </div>

        <div class="field"><label>Kya Samjha / Analysis</label><textarea id="note-analysis" rows="4" placeholder="Chart pe kya dikh raha tha? Setup kaisa tha? Aapne kya notice kiya?"></textarea></div>
        <div class="field"><label>Seekh / Learning Summary</label><textarea id="note-learning" rows="3" placeholder="Is trade / analysis se kya seekh mili? Agli baar kya repeat ya avoid karoge?"></textarea></div>

        <button type="submit" class="btn-primary btn-block">Save Note</button>
      </form>
    </div>

    <div class="notes-reading-header">
      <div>
        <span class="uppercase-label">YOUR JOURNAL</span>
        <h2 class="section-title">☕ Reading Room</h2>
        <p class="card-sub">Yahan saved notes ko bina clutter ke, araam se read aur reflect karein.</p>
      </div>
      <span class="notes-count">${notes.length} ${notes.length===1?'note':'notes'}</span>
    </div>

    <div class="notes-reading-layout">
      <aside class="notes-library">
        <div class="notes-library-title">Saved Notes</div>
        ${notes.length ? notes.map(n => `
          <button type="button" class="note-library-row ${n.id===STATE.activeNoteId?'active':''}" data-action="select-note" data-id="${n.id}">
            <span class="note-library-symbol">${esc(n.symbol || 'General')}</span>
            <span class="note-library-preview">${esc((n.learning || n.analysis || n.entryCriteria || 'No summary yet').replace(/\s+/g,' ').slice(0,90))}</span>
            <span class="note-library-date">${new Date(n.date).toLocaleDateString(undefined,{day:'2-digit',month:'short'})}</span>
          </button>`).join('') : `<div class="notes-library-empty">Abhi koi note saved nahi hai.</div>`}
      </aside>
      <main class="note-reading-panel">${renderReading()}</main>
    </div>
  </div>`;
}
/* ---------------- Reality tab ---------------- */
function renderRealityTab(){
  const s = computeStats();
  return `
  <div class="grid-3" style="grid-template-columns:1fr 1fr;">
    <div class="stat-card green"><span style="font-size:.7rem; font-weight:800; color:var(--emerald); text-transform:uppercase;">🎯 Rules Se Kamaya (Setup Trades)</span><p class="stat-value" style="color:var(--emerald);">${money(s.setupPnL)}</p><p class="card-sub">${s.setupCount} Setup Trades Logged</p></div>
    <div class="stat-card red"><span style="font-size:.7rem; font-weight:800; color:var(--rose); text-transform:uppercase;">🎲 Tukke Me Gavaya (Bina Setup)</span><p class="stat-value" style="color:var(--rose);">${money(s.tukkaPnL)}</p><p class="card-sub">${s.tukkaCount} Random Trades Logged</p></div>
  </div>
  <div class="card">
    <h3 class="section-title">💻 Device &amp; Location Impact Analytics</h3>
    <div class="grid-3" style="grid-template-columns:1fr 1fr;">
      <div style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:1rem;">
        <div style="display:flex; justify-content:space-between;"><span style="font-weight:700; font-size:.75rem;">🖥️ Laptop @ Trading Desk</span><span class="mono" style="font-weight:800; color:${s.deskPnL>=0?'var(--emerald)':'var(--rose)'};">${money(s.deskPnL)}</span></div>
        <p class="card-sub">${s.deskCount} trades logged at desk.</p>
      </div>
      <div style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:1rem;">
        <div style="display:flex; justify-content:space-between;"><span style="font-weight:700; font-size:.75rem;">📱 Mobile @ Couch / Random</span><span class="mono" style="font-weight:800; color:${s.mobilePnL>=0?'var(--emerald)':'var(--rose)'};">${money(s.mobilePnL)}</span></div>
        <p class="card-sub">${s.mobileCount} trades logged on mobile/couch.</p>
      </div>
    </div>
  </div>`;
}

/* ---------------- History tab ---------------- */
function tradeImages(t){
  const imgs = Array.isArray(t.images) && t.images.length ? t.images : [t.beforeImage, t.afterImage, t.image].filter(Boolean);
  return [...new Set(imgs.filter(Boolean))];
}
function historyViewButton(id, icon, label){
  return `<button type="button" class="history-view-btn ${STATE.historyView===id?'active':''}" data-action="history-view" data-view="${id}">${icon}<span>${label}</span></button>`;
}
function renderTradeView(t, mode){
  const pv=plannedVsActual(t), imgs=tradeImages(t);
  const pnl=Number(t.pnl)||0, rr=t.rr ?? '—';
  const resultClass=pnl>=0?'positive':'negative';
  const meta=`${esc(t.symbol||'—')} • ${esc(t.type||'—')}`;
  const chips=`<div class="history-chips"><span class="journal-chip">🧠 ${esc(t.emotion||'—')}</span><span class="journal-chip">🎯 ${Number(t.confidence)||0}/100</span><span class="journal-chip">📝 ${esc(mistakeLabel(t.mistake||'none'))}</span><span class="journal-chip">⭐ ${t.quality||3}/5</span></div>`;
  const actions=`<button type="button" class="btn-secondary trade-edit-btn" data-action="edit-trade" data-id="${esc(t.id)}">✏️ Edit</button>`;
  const shots = imgs.length ? `<div class="history-images">${imgs.map((src,i)=>`<div class="history-image"><img src="${esc(src)}" data-action="view-image" data-src="${esc(src)}"><span>${i===0?'Before':i===1?'After':`Image ${i+1}`}</span></div>`).join('')}</div>` : `<div class="history-no-images">🖼 No screenshots</div>`;
  if(mode==='list') return `<div class="history-list-row"><div class="history-list-main"><div class="history-symbol">${meta}</div><span class="history-date">${esc(t.date||t.createdAt||'')}</span></div><div class="history-list-stat">${pv.pe??'—'} → ${t.exitPrice??'—'}</div><div class="history-list-stat">${esc(t.emotion||'—')}</div><div class="history-list-stat ${resultClass} mono">${money(pnl)}</div><div>${actions}</div></div>`;
  if(mode==='detailed') return `<article class="history-detail-card"><div class="history-detail-head"><div><span class="history-kicker">TRADE JOURNAL</span><h3>${meta}</h3><p>${esc(t.date||t.createdAt||'')}</p></div><div class="history-detail-result ${resultClass}">${money(pnl)}<small>${esc(String(rr))} R</small></div>${actions}</div>${chips}<div class="history-detail-grid"><div><span>PLANNED</span><strong>Entry ${pv.pe??'—'} • SL ${pv.ps??'—'} • Target ${pv.pt??'—'} • R:R ${pv.prr??'—'}</strong></div><div><span>ACTUAL</span><strong>Entry ${t.entryPrice??'—'} • SL ${t.stopLoss??'—'} • Exit ${t.exitPrice??'—'}</strong></div><div><span>EXIT REASON</span><strong>${esc(t.exitReason||'—')}</strong></div><div><span>QUANTITY</span><strong>${esc(t.quantity??'—')}</strong></div></div><p class="history-note">${esc(t.notes||'No notes added.')}</p>${shots}</article>`;
  if(mode==='gallery') return `<article class="history-gallery-card"><div class="history-gallery-head"><div><h3>${meta}</h3><p>${esc(t.date||t.createdAt||'')}</p></div><div class="history-detail-result ${resultClass}">${money(pnl)}<small>${esc(String(rr))} R</small></div>${actions}</div>${shots}<div class="history-gallery-meta">${chips}</div></article>`;
  return `<article class="history-grid-card"><div class="history-grid-media">${imgs[0]?`<img src="${esc(imgs[0])}" data-action="view-image" data-src="${esc(imgs[0])}">`:`<div class="history-grid-placeholder">📈</div>`}<span class="${t.type==='LONG'?'badge-long':'badge-short'}">${esc(t.type||'—')}</span></div><div class="history-grid-body"><div class="history-grid-top"><div><h3>${esc(t.symbol||'—')}</h3><p>${esc(tradeStrategyName(t)||'No strategy')}</p></div><div class="history-detail-result ${resultClass}">${money(pnl)}<small>${esc(String(rr))} R</small></div></div>${chips}<div class="history-mini-stats"><span>Entry <b>${t.entryPrice??'—'}</b></span><span>Exit <b>${t.exitPrice??'—'}</b></span><span>Qty <b>${t.quantity??'—'}</b></span></div><div class="history-card-actions">${actions}</div></div></article>`;
}
function renderHistoryTab(){
  const all = STATE.trades;
  if (!all.length) return `<p class="empty-msg">Abhi koi trade log nahi hai. "Log Trade" tab se apna pehla trade add karo.</p>`;
  const trades = filteredHistoryTrades();
  const perf = strategyPerformance();
  const strategyNames = [...new Set(all.map(tradeStrategyName))];
  const totalPnl = trades.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const wins = trades.filter(t=>(Number(t.pnl)||0)>0).length;
  const mode=STATE.historyView;
  return `
  <div class="card journal-summary-card">
    <div class="history-heading"><div><h2 class="section-title">📊 Trade History</h2><p class="card-sub">Apne trades ko jis tarah dekhna ho, wahi view choose karo.</p></div><div class="mono history-total ${totalPnl>=0?'positive':'negative'}">${money(totalPnl)}</div></div>
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
    <div class="field grid-2"><div><label>Emotion</label><select id="edit-emotion">${presets.map(x=>`<option ${t.emotion===x?'selected':''}>${x}</option>`).join('')}<option ${!presets.includes(t.emotion)?'selected':''}>${esc(t.emotion||'Custom')}</option></select></div><div><label>Confidence</label><div class="edit-confidence"><input type="range" id="edit-confidence" min="1" max="100" value="${t.confidence||70}"><strong>${t.confidence||70}/100</strong></div></div></div>
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
  else if (STATE.activeTab==='notes') { content.innerHTML = renderNotesTab(); renderNoteImagePreview(); }
  else if (STATE.activeTab==='reality') content.innerHTML = renderRealityTab();
  else if (STATE.activeTab==='history') content.innerHTML = renderHistoryTab();
}
function renderTabOnly(){ // re-render just the active tab (after in-tab interactions)
  const content = $('#tab-content');
  if (STATE.activeTab==='copilot') content.innerHTML = renderCopilotTab();
  else if (STATE.activeTab==='log') { content.innerHTML = renderLogTab(); renderLogImagePreview(); updateLogPreview(); }
  else if (STATE.activeTab==='notes') { content.innerHTML = renderNotesTab(); renderNoteImagePreview(); }
  else if (STATE.activeTab==='reality') content.innerHTML = renderRealityTab();
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
  else if (action==='set-log-emotion') { const draft=captureLogDraft(); STATE.logEmotion = btn.dataset.value; STATE.logCustomEmotion = ''; renderTabOnly(); restoreLogDraft(draft); }
  else if (action==='use-custom-emotion') { const draft=captureLogDraft(); const v = $('#log-custom-emotion')?.value.trim(); if (v) { STATE.logEmotion = v; STATE.logCustomEmotion = v; renderTabOnly(); restoreLogDraft(draft); } }
  else if (action==='set-log-device') { const draft=captureLogDraft(); STATE.logFormDevice = btn.dataset.value; renderTabOnly(); restoreLogDraft(draft); }
  else if (action==='remove-log-image') { STATE.logFormImage=''; STATE.logFormBeforeImage=''; STATE.logFormAfterImage=''; STATE.logFormImages=[]; renderLogImagePreview(); updateLogPreview(); }
  else if (action==='remove-log-image-index') { const i=Number(btn.dataset.index); const arr=currentLogImages(); arr.splice(i,1); STATE.logFormImages=arr; STATE.logFormBeforeImage=arr[0]||''; STATE.logFormAfterImage=arr[1]||''; renderLogImagePreview(); updateLogPreview(); }
  else if (action==='add-log-image-url') { const v=$('#log-image-url')?.value.trim(); if(v){ addLogImages([v]); $('#log-image-url').value=''; } }
  else if (action==='edit-trade') { STATE.editingTradeId=btn.dataset.id; render(); }
  else if (action==='cancel-edit-trade') { STATE.editingTradeId=null; render(); }
  else if (action==='update-trade') { await updateExistingTrade(btn.dataset.id); }
  else if (action==='remove-edit-image') { const item=btn.closest('.edit-image-item'); item?.remove(); }
  else if (action==='remove-note-image') { STATE.noteFormImage=''; renderNoteImagePreview(); }
  else if (action==='view-image') { $('#modal-image').src = btn.dataset.src; $('#image-modal').style.display='flex'; }
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
  else if (action==='select-note') {
    STATE.activeNoteId = btn.dataset.id;
    render();
  }
  else if (action==='delete-note') {
    STATE.notes = STATE.notes.filter(n => n.id !== btn.dataset.id);
    if (STATE.activeNoteId === btn.dataset.id) STATE.activeNoteId = STATE.notes[0]?.id || null;
    saveUserData();
    renderTabOnly();
  }
});

$('#modal-close').addEventListener('click', () => $('#image-modal').style.display='none');
$('#image-modal').addEventListener('click', (e) => { if (e.target.id==='image-modal') $('#image-modal').style.display='none'; });

document.addEventListener('input', (e) => {
  if (e.target.id==='energy-slider') { STATE.energyLevel = Number(e.target.value); $('#energy-val').textContent = STATE.energyLevel+'%'; refreshBatteryOnly(); }
  else if (e.target.id==='noise-slider') { STATE.noiseLevel = Number(e.target.value); $('#noise-val').textContent = STATE.noiseLevel+'%'; refreshBatteryOnly(); }
  else if (['log-entry','log-exit','log-qty','log-sl','log-type'].includes(e.target.id)) { updateLogPreview(); }
  else if (e.target.id==='log-before-image-url') { STATE.logFormBeforeImage = e.target.value; renderLogImagePreview(); updateLogPreview(); }
  else if (e.target.id==='log-after-image-url') { STATE.logFormAfterImage = e.target.value; renderLogImagePreview(); updateLogPreview(); }
  else if (e.target.id==='log-custom-emotion') { STATE.logCustomEmotion = e.target.value; }
  else if (e.target.id==='log-confidence') { STATE.logConfidence = Number(e.target.value)||1; const v=$('#log-confidence-val'); if(v) v.textContent=STATE.logConfidence+'/100'; }
  else if (e.target.id==='edit-confidence') { const box=e.target.closest('.edit-confidence'); const v=box?.querySelector('strong'); if(v) v.textContent=Number(e.target.value)+'/100'; }
  else if (e.target.id==='note-image-url') { STATE.noteFormImage = e.target.value; renderNoteImagePreview(); }
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
  else if (e.target.id==='log-multi-image-file') {
    const files=[...e.target.files]; if(!files.length) return;
    Promise.all(files.map(readAndCompressImage)).then(loaded=>addLogImages(loaded)).catch(err=>alert(err.message || 'Image upload failed.'));
    e.target.value='';
  }
  else if (e.target.id==='log-before-image-file' || e.target.id==='log-after-image-file') {
    const file = e.target.files[0]; if (!file) return;
    readAndCompressImage(file).then(src => addLogImages([src])).catch(err=>alert(err.message || 'Image upload failed.'));
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
  else if (e.target.id==='note-image-file') {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => { STATE.noteFormImage = reader.result; renderNoteImagePreview(); };
    reader.readAsDataURL(file);
  }
});

async function updateExistingTrade(id){
  const t=STATE.trades.find(x=>x.id===id); if(!t) return;
  const symbol=$('#edit-symbol')?.value.trim() || t.symbol;
  const qty=parseFloat($('#edit-qty')?.value), entry=parseFloat($('#edit-entry')?.value), exit=parseFloat($('#edit-exit')?.value), sl=parseFloat($('#edit-sl')?.value);
  const type=$('#edit-type')?.value || t.type;
  const emotion=$('#edit-emotion')?.value || t.emotion;
  const confidence=Number($('#edit-confidence')?.value || t.confidence || 70);
  const images=[...document.querySelectorAll('#edit-images-list img')].map(x=>x.dataset.src).filter(Boolean);
  const pnl=(entry&&exit&&qty)?Math.round((type==='LONG'?(exit-entry)*qty:(entry-exit)*qty)*100)/100:(t.pnl||0);
  const rr=(sl&&entry&&exit&&entry!==sl)?Math.round(((type==='LONG'?exit-entry:entry-exit)/Math.abs(entry-sl))*100)/100:(t.rr||0);
  const snapshot = JSON.parse(JSON.stringify(t));
  Object.assign(t,{symbol:symbol.toUpperCase(),type,quantity:Number.isFinite(qty)?qty:t.quantity,entryPrice:Number.isFinite(entry)?entry:null,exitPrice:Number.isFinite(exit)?exit:null,stopLoss:Number.isFinite(sl)?sl:null,emotion,confidence,exitReason:$('#edit-exit-reason')?.value.trim()||'',images,beforeImage:images[0]||null,afterImage:images[1]||null,image:images[0]||null,pnl,rr});
  const saved = await saveUserData();
  if (!saved) { Object.assign(t, snapshot); return; }
  STATE.editingTradeId=null; render();
}

document.addEventListener('submit', async (e) => {
  if (e.target.id==='log-form') {
    e.preventDefault();
    const symbol = $('#log-symbol').value.trim();
    const entry = $('#log-entry').value, exit = $('#log-exit').value, qty = $('#log-qty').value;
    if (!symbol || !qty) { alert('Please fill out Symbol and Quantity. Entry, Exit and SL are optional.'); return; }
    const customEmotion = $('#log-custom-emotion')?.value.trim() || '';
    const finalEmotion = STATE.logEmotion || customEmotion;
    if (!finalEmotion) { alert('Please select an emotion or enter your custom emotion.'); return; }
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
      strategy: strategyName, emotion: finalEmotion, emotionPreset: MINDSET_ARCHETYPES.find(m=>m.name===finalEmotion)?.name || null, device: STATE.logFormDevice, location: STATE.logFormLocation,
      notes: $('#log-notes')?.value || '', exitReason: $('#log-exit-reason')?.value.trim() || '', image: currentLogImages()[0] || null, beforeImage: currentLogImages()[0] || null, afterImage: currentLogImages()[1] || null, images: currentLogImages(), confidence: Number(STATE.logConfidence)||70,
      plannedEntry, plannedSL, plannedTP, plannedRR, mistake: $('#log-mistake').value, quality: Number($('#log-quality').value), followedPlan: STATE.logFormIsSetup && $('#log-mistake').value==='none',
      date: new Date().toISOString(), pnl: p.pnl, rr: p.rr, xpEarned: p.xp
    };
    STATE.trades.unshift(newTrade);
    const saved = await saveUserData();
    if (!saved) { STATE.trades = STATE.trades.filter(t => t.id !== newTrade.id); return; }
    STATE.logFormImage = ''; STATE.logFormBeforeImage = ''; STATE.logFormAfterImage = ''; STATE.logFormImages = []; STATE.logEmotion = ''; STATE.logCustomEmotion = ''; STATE.logConfidence = 70;
    STATE.activeTab = 'history';
    render();
  }
  else if (e.target.id==='notes-form') {
    e.preventDefault();
    const analysis = $('#note-analysis').value.trim(), learning = $('#note-learning').value.trim();
    if (!analysis && !learning) { alert('Please add at least an analysis or a learning/summary!'); return; }
    STATE.notes.unshift({
      id:`n-${Date.now()}`, symbol: $('#note-symbol').value.trim() || 'General', image: STATE.noteFormImage || null,
      strategy: STATE.noteFormStrategy, entryCriteria: $('#note-entry').value.trim(), exitCriteria: $('#note-exit').value.trim(),
      analysis, learning, date: new Date().toISOString()
    });
    STATE.activeNoteId = STATE.notes[0]?.id || null;
    STATE.noteFormImage = '';
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
