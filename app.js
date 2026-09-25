/* ============================================================
   Trader Co-Pilot — vanilla JS (no framework)
   Talks to /api/* (Cloudflare Pages Functions + D1) for
   auth and per-user data storage.
   ============================================================ */

const DEFAULT_PLAYBOOK = [
  { id:'pb-1', name:'Asian High/Low Liquidity Sweep (AMD)', winRate:74, avgRR:'2.8R',
    mandatoryRules:['Asian High or Low must be clearly swept on 15m/5m timeframe','Market Structure Shift (MSS) with displacement post-sweep','Entry on Fair Value Gap (FVG) or Breaker Block return','Stop loss strictly above/below manipulation wick extreme'],
    commonTraps:['Entering BEFORE displacement candle closes (faking the sweep)','Trading into higher timeframe major opposition level','Taking trades right during high-impact CPI/FOMC news releases'],
    winningExamples:[{symbol:'BTC/USDT',pnl:1250,rr:'2.5R',note:'Clean Asia Low sweep + 5m displacement FVG entry during London open.'}],
    losingExamples:[{symbol:'NVDA',pnl:-350,rr:'-1.75R',note:'Entered early BEFORE liquidity sweep was complete!',ruleBroken:'RULE BROKEN: Faked displacement candle; entered before candle close.'}]
  },
  { id:'pb-2', name:'ICT Fair Value Gap (FVG) + Breaker', winRate:68, avgRR:'2.2R',
    mandatoryRules:['Clear 3-candle imbalance (FVG) present on 5m or 15m','Higher Timeframe (1H/4H) bias aligns with direction','Discount/Premium array check: Buy in Discount, Sell in Premium','Target opposing liquidity pool or unmitigated FVG'],
    commonTraps:['Entering an old, already mitigated FVG','Ignoring HTF trend and picking tops/bottoms blindly'],
    winningExamples:[{symbol:'ETH/USDT',pnl:420,rr:'2.8R',note:'Standard 15m FVG fill during NY Killzone with 4H bullish alignment.'}],
    losingExamples:[{symbol:'SOL/USDT',pnl:-210,rr:'-1.0R',note:'FVG was already mitigated twice on 15m chart.',ruleBroken:'RULE BROKEN: Entered an old, already mitigated FVG pool.'}]
  },
  { id:'pb-3', name:'Order Block (OB) Retest with Displacement', winRate:62, avgRR:'2.0R',
    mandatoryRules:['OB must create a strong Break of Structure (BOS)','FVG must be present right after the Order Block candle','Clean unmitigated level on 15m timeframe','Risk capped at 1% of total portfolio'],
    commonTraps:['Taking OB retests after the price has already lingered nearby too long'],
    winningExamples:[], losingExamples:[]
  }
];

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
  selectedPlaybookId: DEFAULT_PLAYBOOK[0].id,
  checkedRules: {},
  inspectionTab: 'winning',
  energyLevel: 85, noiseLevel: 15,
  selectedMindsetId: MINDSET_ARCHETYPES[0].id,
  logFormIsSetup: true, logFormDevice: 'Laptop', logFormLocation: 'Desk', logFormImage: '',
  noteFormStrategy: DEFAULT_PLAYBOOK[0].name, noteFormImage: ''
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
  return [...DEFAULT_PLAYBOOK, ...STATE.customStrategies.map(normalizeCustomStrategy)];
}
function findStrategy(id){ return allStrategies().find(p=>p.id===id) || DEFAULT_PLAYBOOK[0]; }
function findStrategyByName(name){ return allStrategies().find(p=>p.name===name) || DEFAULT_PLAYBOOK[0]; }
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
  STATE.customStrategies = (data.customStrategies || []).map(normalizeCustomStrategy);
}

async function saveUserData(){
  try {
    await api('/api/data', 'POST', { trades: STATE.trades, notes: STATE.notes, customStrategies: STATE.customStrategies });
  } catch (e) { console.error('Save failed:', e); }
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
          <select id="playbook-select" style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:.75rem; padding:.4rem .7rem; font-size:.7rem; font-weight:700; color:var(--indigo);">
            ${DEFAULT_PLAYBOOK.map(p => `<option value="${p.id}" ${p.id===STATE.selectedPlaybookId?'selected':''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <span class="uppercase-label">Pre-Flight Mandatory Rules</span>
        ${strategy.mandatoryRules.map((rule, idx) => `
          <div class="rule-item ${STATE.checkedRules[idx]?'checked':''}" data-action="toggle-rule" data-idx="${idx}">
            <div class="rule-check">${STATE.checkedRules[idx]?'✓':''}</div><span>${esc(rule)}</span>
          </div>`).join('')}
      </div>

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:.5rem;">
          <h3 class="section-title">👁️ Past Executions Inspection</h3>
          <div style="display:flex; gap:.35rem; background:var(--slate-100); padding:.25rem; border-radius:1rem;">
            <button data-action="set-inspection" data-value="winning" class="tab-btn ${STATE.inspectionTab==='winning'?'active':''}" style="${STATE.inspectionTab==='winning'?'background:var(--emerald);color:#fff;':''}">🟢 Winning</button>
            <button data-action="set-inspection" data-value="losing" class="tab-btn ${STATE.inspectionTab==='losing'?'active':''}" style="${STATE.inspectionTab==='losing'?'background:var(--rose);color:#fff;':''}">🔴 Losing</button>
          </div>
        </div>
        ${STATE.inspectionTab==='winning' ? (
          strategy.winningExamples.length===0 ? `<p class="empty-msg">No sample winning trades recorded yet for this setup.</p>` :
          strategy.winningExamples.map(ex => `
            <div class="example-row"><div style="display:flex; align-items:center; gap:.75rem;"><div><span style="font-weight:800; font-size:.75rem;">${esc(ex.symbol)}</span><p style="font-size:.72rem; color:var(--slate-600); margin:.2rem 0 0;">${esc(ex.note)}</p></div></div><span class="mono" style="color:var(--emerald); font-weight:800; font-size:.72rem;">+${ex.pnl} (${ex.rr})</span></div>`).join('')
        ) : (
          strategy.losingExamples.length===0 ? `<p class="empty-msg">No sample losing trades recorded yet for this setup.</p>` :
          strategy.losingExamples.map(ex => `
            <div class="example-row" style="flex-direction:column; align-items:flex-start; gap:.4rem;">
              <div style="display:flex; justify-content:space-between; width:100%;"><span style="font-weight:800; font-size:.75rem;">${esc(ex.symbol)}</span><span class="mono" style="color:var(--rose); font-weight:800; font-size:.72rem;">${ex.pnl} (${ex.rr})</span></div>
              <p style="font-size:.72rem; color:var(--slate-600); margin:0;">${esc(ex.note)}</p>
              ${ex.ruleBroken ? `<p style="font-size:.6rem; font-weight:700; color:#9f1239; background:var(--rose-light); padding:.3rem .6rem; border-radius:.75rem;">${esc(ex.ruleBroken)}</p>` : ''}
            </div>`).join('')
        )}
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
  if (STATE.logFormImage) xp += 30;
  return { pnl: Math.round(pnl*100)/100, rr: Math.round(rr*100)/100, xp };
}
function updateLogPreview(){
  const p = computeLogPreview();
  const badge = $('#log-xp-badge');
  if (badge) badge.textContent = `+${p.xp} XP`;
}
function renderLogImagePreview(){
  const box = $('#log-image-preview');
  if (!box) return;
  box.innerHTML = STATE.logFormImage ? `
    <div class="image-preview-row">
      <div style="display:flex; align-items:center; gap:.6rem;"><img src="${STATE.logFormImage}"><span style="font-size:.7rem; color:var(--emerald); font-weight:700;">✅ Screenshot Attached</span></div>
      <button type="button" data-action="remove-log-image" style="background:var(--rose-light); color:var(--rose); border:none; border-radius:.7rem; padding:.35rem .6rem; cursor:pointer;">🗑️</button>
    </div>` : '';
}
function renderLogTab(){
  const strategyOptions = allStrategies().map(p => `<option value="${esc(p.id)}" ${STATE.selectedPlaybookId===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
  return `
  <div class="card" style="max-width:42rem; margin:0 auto;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--slate-100); padding-bottom:.75rem; margin-bottom:1rem;">
      <h2 class="section-title">➕ Log Trade &amp; Chart Screenshot</h2>
      <span class="xp-badge" id="log-xp-badge">+100 XP</span>
    </div>
    <form id="log-form">
      <div class="field">
        <label>Trade Type</label>
        <div class="toggle-group">
          <button type="button" class="toggle-btn ${STATE.logFormIsSetup?'active-green':''}" data-action="set-log-setup" data-value="true">🎯 Setup Rule Trade</button>
          <button type="button" class="toggle-btn ${!STATE.logFormIsSetup?'active-red':''}" data-action="set-log-setup" data-value="false">🎲 Bina Setup (Tukke Baazi)</button>
        </div>
      </div>

      ${STATE.logFormIsSetup ? `<div class="field strategy-select-field" style="background:var(--indigo-light); border:1px solid #c7d2fe; border-radius:1rem; padding:.85rem;">
        <label style="display:flex; justify-content:space-between; color:var(--indigo);"><span>🎯 Select Strategy</span><span style="font-size:.6rem; text-transform:none;">Playbook + My Strategies</span></label>
        <select id="log-strategy-select">${strategyOptions}</select>
        <p class="card-sub" style="margin:.4rem 0 0;">Ye strategy aapke Trade History mein save hogi.</p>
      </div>` : ''}

      <div class="field" style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:.85rem;">
        <label style="display:flex; justify-content:space-between;"><span>📷 Attach Chart Screenshot</span><span style="color:var(--indigo);">+30 XP Bonus</span></label>
        <div class="grid-3" style="grid-template-columns:1fr 1fr;">
          <label class="upload-box"><span>⬆️</span><span style="font-size:.7rem; font-weight:700;">Upload Local File</span><input type="file" id="log-image-file" accept="image/*" style="display:none;"></label>
          <input type="url" id="log-image-url" placeholder="Or paste image URL...">
        </div>
        <div id="log-image-preview"></div>
      </div>

      <div class="field grid-3" style="grid-template-columns:1fr 1fr; background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:.85rem;">
        <div>
          <label>Device</label>
          <div class="toggle-group">
            <button type="button" class="toggle-btn ${STATE.logFormDevice==='Laptop'?'active-indigo':''}" data-action="set-log-device" data-value="Laptop">💻 Laptop</button>
            <button type="button" class="toggle-btn ${STATE.logFormDevice==='Mobile'?'active-red':''}" data-action="set-log-device" data-value="Mobile">📱 Mobile</button>
          </div>
        </div>
        <div>
          <label>Location</label>
          <select id="log-location-select">
            <option value="Desk" ${STATE.logFormLocation==='Desk'?'selected':''}>🖥️ Trading Desk</option>
            <option value="Couch / Bed" ${STATE.logFormLocation==='Couch / Bed'?'selected':''}>🛋️ Couch / Bed</option>
            <option value="Random / On the Go" ${STATE.logFormLocation==='Random / On the Go'?'selected':''}>🚗 Random / On the Go</option>
          </select>
        </div>
      </div>

      <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
        <div><label>Symbol</label><input type="text" id="log-symbol" value="BTC/USDT"></div>
        <div><label>Direction</label><select id="log-type"><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></div>
      </div>

      <div class="field grid-3" style="grid-template-columns:repeat(3,1fr);">
        <div><label>Entry ($)</label><input type="number" step="any" id="log-entry"></div>
        <div><label>Exit ($)</label><input type="number" step="any" id="log-exit"></div>
        <div><label>Quantity</label><input type="number" step="any" id="log-qty"></div>
      </div>
      <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
        <div><label>Stop Loss ($)</label><input type="number" step="any" id="log-sl"></div>
        <div><label>Take Profit ($)</label><input type="number" step="any" id="log-tp"></div>
      </div>

      <div class="field"><label>Notes &amp; Mistakes</label><textarea id="log-notes" rows="2" placeholder="Kyu kiya trade? Rules follow kiye ya jaldi baazi me button daba diya?"></textarea></div>

      <button type="submit" class="btn-primary btn-block">Save Trade Log</button>
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
          <input type="text" id="strategy-name" placeholder="e.g. Liquidity Sweep + FVG" maxlength="80">
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

  return `
  ${renderStrategyBuilder()}
  <div class="card" style="max-width:42rem; margin:0 auto;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--slate-100); padding-bottom:.75rem; margin-bottom:1rem;">
      <h2 class="section-title">🧾 Trade Notes &amp; Learnings</h2>
      <span class="xp-badge">+15 XP</span>
    </div>
    <form id="notes-form">
      <div class="field"><label>Symbol / Tag (optional)</label><input type="text" id="note-symbol" placeholder="e.g. BTC/USDT or 'Weekly Review'"></div>

      <div class="field">
        <label>Strategy</label>
        <select id="note-strategy-select">${strategyOptions}</select>
        <p class="card-sub" style="margin:.4rem 0 0;">New strategy banane ke liye upar <strong>ADD STRATEGY</strong> use karein.</p>
      </div>

      <div class="field grid-3" style="grid-template-columns:1fr 1fr;">
        <div><label>Entry Criteria</label><textarea id="note-entry" rows="3" placeholder="Kin conditions par entry loge?"></textarea></div>
        <div><label>Exit Criteria</label><textarea id="note-exit" rows="3" placeholder="Kab exit / target / SL hit consider karoge..."></textarea></div>
      </div>

      <div class="field" style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:1rem; padding:.85rem;">
        <label>📷 Attach Chart Screenshot (optional)</label>
        <div class="grid-3" style="grid-template-columns:1fr 1fr;">
          <label class="upload-box"><span>⬆️</span><span style="font-size:.7rem; font-weight:700;">Upload Local File</span><input type="file" id="note-image-file" accept="image/*" style="display:none;"></label>
          <input type="url" id="note-image-url" placeholder="Or paste image URL...">
        </div>
        <div id="note-image-preview"></div>
      </div>

      <div class="field"><label>Kya Samjha / Analysis</label><textarea id="note-analysis" rows="3" placeholder="Chart pe kya dikh raha tha? Setup kaisa tha?"></textarea></div>
      <div class="field"><label>Seekh / Learning Summary</label><textarea id="note-learning" rows="2" placeholder="Is analysis se kya seekh mili?"></textarea></div>

      <button type="submit" class="btn-primary btn-block">Save Note</button>
    </form>
  </div>

  <div class="cards-grid">
    ${STATE.notes.length===0 ? `<p class="empty-msg">Abhi tak koi note nahi hai. Upar wala form bharke apni pehli learning save karo!</p>` :
      STATE.notes.map(n => `
      <div class="item-card">
        ${n.image ? `<img class="item-thumb" src="${n.image}" data-action="view-image" data-src="${n.image}">` : ''}
        <div class="item-body">
          <div style="display:flex; justify-content:space-between;"><span class="item-tag">${esc(n.symbol)}</span><button class="item-delete" data-action="delete-note" data-id="${n.id}">🗑️</button></div>
          ${n.strategy ? `<span class="item-strategy">${esc(n.strategy)}</span>` : ''}
          ${(n.entryCriteria||n.exitCriteria) ? `<div class="item-criteria-grid">
            ${n.entryCriteria ? `<div class="item-criteria entry"><strong style="font-size:.6rem; text-transform:uppercase;">Entry</strong><p style="margin:.2rem 0 0;">${esc(n.entryCriteria)}</p></div>` : ''}
            ${n.exitCriteria ? `<div class="item-criteria exit"><strong style="font-size:.6rem; text-transform:uppercase;">Exit</strong><p style="margin:.2rem 0 0;">${esc(n.exitCriteria)}</p></div>` : ''}
          </div>` : ''}
          ${n.analysis ? `<p class="item-notes"><strong style="font-size:.6rem; color:var(--slate-400); text-transform:uppercase; display:block;">Analysis</strong>${esc(n.analysis)}</p>` : ''}
          ${n.learning ? `<div class="item-learning"><strong style="font-size:.6rem; text-transform:uppercase; display:block;">📚 Learning</strong>${esc(n.learning)}</div>` : ''}
          <div class="item-footer">${new Date(n.date).toLocaleDateString()}</div>
        </div>
      </div>`).join('')}
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
function renderHistoryTab(){
  if (!STATE.trades.length) return `<p class="empty-msg">Abhi koi trade log nahi hai. "Log Trade" tab se apna pehla trade add karo.</p>`;
  return `<div class="cards-grid">
    ${STATE.trades.map(t => `
      <div class="item-card">
        <div class="thumb-wrap">
          ${t.image ? `<img class="item-thumb" src="${t.image}" data-action="view-image" data-src="${t.image}">` : `<div class="item-thumb-placeholder">🖼️</div>`}
          <span class="${t.type==='LONG'?'badge-long':'badge-short'}">${t.type}</span>
        </div>
        <div class="item-body">
          <div style="display:flex; justify-content:space-between;">
            <div><span style="font-weight:800; font-size:.8rem;">${esc(t.symbol)}</span><span style="display:block; font-size:.6rem; color:var(--slate-500);">${esc(t.strategy)}</span></div>
            <div style="text-align:right;"><span class="mono" style="font-weight:800; display:block; color:${t.pnl>=0?'var(--emerald)':'var(--rose)'};">${money(t.pnl)}</span><span class="mono" style="font-size:.6rem; color:var(--slate-400);">${t.rr} R</span></div>
          </div>
          <p class="item-notes">${esc(t.notes)}</p>
          <div class="item-footer mono">
            <span>${t.device==='Laptop'?'💻':'📱'} ${esc(t.device)} • ${esc(t.location)}</span>
            <span style="color:var(--indigo); font-weight:700;">${esc(t.emotion)}</span>
          </div>
        </div>
      </div>`).join('')}
  </div>`;
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
  else if (action==='record-state') { alert(`Mindset saved: ${findMindset(STATE.selectedMindsetId).name} (+20 XP)`); }
  else if (action==='set-log-setup') { STATE.logFormIsSetup = btn.dataset.value==='true'; renderTabOnly(); }
  else if (action==='set-log-device') { STATE.logFormDevice = btn.dataset.value; renderTabOnly(); }
  else if (action==='remove-log-image') { STATE.logFormImage=''; renderLogImagePreview(); updateLogPreview(); }
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
    await saveUserData();
    renderTabOnly();
  }
  else if (action==='delete-note') {
    STATE.notes = STATE.notes.filter(n => n.id !== btn.dataset.id);
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
  else if (e.target.id==='log-image-url') { STATE.logFormImage = e.target.value; renderLogImagePreview(); updateLogPreview(); }
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
  else if (e.target.id==='note-strategy-select') {
    const row = $('#note-custom-strategy-row');
    if (e.target.value==='__custom__') { row.style.display='flex'; }
    else { row.style.display='none'; STATE.noteFormStrategy = e.target.value; }
  }
  else if (e.target.id==='log-image-file') {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => { STATE.logFormImage = reader.result; renderLogImagePreview(); updateLogPreview(); };
    reader.readAsDataURL(file);
  }
  else if (e.target.id==='note-image-file') {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => { STATE.noteFormImage = reader.result; renderNoteImagePreview(); };
    reader.readAsDataURL(file);
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id==='log-form') {
    e.preventDefault();
    const symbol = $('#log-symbol').value.trim();
    const entry = $('#log-entry').value, exit = $('#log-exit').value, qty = $('#log-qty').value;
    if (!symbol || !entry || !exit || !qty) { alert('Please fill out Symbol, Entry, Exit, and Quantity!'); return; }
    const p = computeLogPreview();
    const strategyName = STATE.logFormIsSetup ? findStrategy(STATE.selectedPlaybookId).name : 'Bina Setup (Tukke Baazi)';
    const mindset = findMindset(STATE.selectedMindsetId);
    STATE.trades.unshift({
      id:`t-${Date.now()}`, symbol: symbol.toUpperCase(), type: $('#log-type').value, isSetupTrade: STATE.logFormIsSetup,
      entryPrice: parseFloat(entry), exitPrice: parseFloat(exit), quantity: parseFloat(qty),
      stopLoss: $('#log-sl').value ? parseFloat($('#log-sl').value) : null, takeProfit: $('#log-tp').value ? parseFloat($('#log-tp').value) : null,
      strategy: strategyName, emotion: mindset.name, device: STATE.logFormDevice, location: STATE.logFormLocation,
      notes: $('#log-notes').value, image: STATE.logFormImage || null, followedPlan: STATE.logFormIsSetup,
      date: new Date().toISOString(), pnl: p.pnl, rr: p.rr, xpEarned: p.xp
    });
    STATE.logFormImage = '';
    await saveUserData();
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
