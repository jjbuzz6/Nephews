(() => {
  'use strict';

  const STORAGE_KEY = 'lineupLedger.v1';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const today = () => new Date().toISOString().slice(0,10);
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

  const defaultOutcomes = () => [
    {id:'1b', label:'1B', ab:1,h:1,b1:1,b2:0,b3:0,hr:0,bb:0,sf:0,visible:true,kind:'hit'},
    {id:'2b', label:'2B', ab:1,h:1,b1:0,b2:1,b3:0,hr:0,bb:0,sf:0,visible:true,kind:'hit'},
    {id:'3b', label:'3B', ab:1,h:1,b1:0,b2:0,b3:1,hr:0,bb:0,sf:0,visible:true,kind:'hit'},
    {id:'hr', label:'HR', ab:1,h:1,b1:0,b2:0,b3:0,hr:1,bb:0,sf:0,visible:true,kind:'hr'},
    {id:'bb', label:'BB', ab:0,h:0,b1:0,b2:0,b3:0,hr:0,bb:1,sf:0,visible:true,kind:'walk'},
    {id:'out', label:'OUT', ab:1,h:0,b1:0,b2:0,b3:0,hr:0,bb:0,sf:0,visible:true,kind:'out'},
    {id:'roe', label:'ROE', ab:1,h:0,b1:0,b2:0,b3:0,hr:0,bb:0,sf:0,visible:true,kind:'out'},
    {id:'sf', label:'SAC', ab:0,h:0,b1:0,b2:0,b3:0,hr:0,bb:0,sf:1,visible:true,kind:'out'}
  ];

  function freshState(){
    return {
      settings:{teamName:'My Team', innings:7, outcomes:defaultOutcomes()},
      roster:[],
      games:[]
    };
  }

  let state = load();
  let view = 'home';
  let modal = null;
  let pendingRbi = 0;
  let statsFilter = 'all';

  function load(){
    try{
      const x = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(!x) return freshState();
      x.settings ||= freshState().settings;
      x.settings.outcomes ||= defaultOutcomes();
      x.roster ||= [];
      x.games ||= [];
      return x;
    }catch(e){ return freshState(); }
  }
  function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function toast(msg){
    document.querySelector('.toast')?.remove();
    const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t);
    setTimeout(()=>t.remove(),2100);
  }
  const activeGame = () => state.games.find(g=>g.status==='active') || null;
  const getPlayer = id => state.roster.find(p=>p.id===id);
  const visibleOutcomes = () => state.settings.outcomes.filter(o=>o.visible);

  function resultDef(id){ return state.settings.outcomes.find(o=>o.id===id) || {id,label:id,ab:0,h:0,b1:0,b2:0,b3:0,hr:0,bb:0,sf:0,kind:'out'}; }

  function totalsForGame(g){
    return {us:(g.score.us||[]).reduce((a,b)=>a+num(b),0), them:(g.score.them||[]).reduce((a,b)=>a+num(b),0)};
  }

  function playerStats(playerId, games=state.games){
    const s={G:0,PA:0,AB:0,H:0,B1:0,B2:0,B3:0,HR:0,BB:0,SF:0,R:0,RBI:0};
    for(const g of games){
      const appeared = g.pas.some(pa=>pa.playerId===playerId) || (g.lineup||[]).includes(playerId) || num(g.runsByPlayer?.[playerId])>0;
      if(appeared) s.G++;
      s.R += num(g.runsByPlayer?.[playerId]);
      for(const pa of g.pas){
        if(pa.playerId!==playerId) continue;
        const d=resultDef(pa.resultId);
        s.PA++; s.AB+=num(d.ab); s.H+=num(d.h); s.B1+=num(d.b1); s.B2+=num(d.b2); s.B3+=num(d.b3); s.HR+=num(d.hr); s.BB+=num(d.bb); s.SF+=num(d.sf); s.RBI+=num(pa.rbi);
      }
    }
    s.AVG=s.AB ? s.H/s.AB : 0;
    s.OBP=(s.AB+s.BB+s.SF) ? (s.H+s.BB)/(s.AB+s.BB+s.SF) : 0;
    s.SLG=s.AB ? (s.B1+2*s.B2+3*s.B3+4*s.HR)/s.AB : 0;
    s.OPS=s.OBP+s.SLG;
    return s;
  }
  const pct = n => Number.isFinite(n) ? n.toFixed(3).replace(/^0/,'') : '.000';

  function render(){
    const app=document.getElementById('app');
    app.innerHTML=`
      <div class="app-shell">
        <header class="topbar"><div class="topbar-row"><div><div class="brand">Lineup <span>Ledger</span></div><div class="subtle">${esc(state.settings.teamName)} softball stats</div></div>${activeGame()?`<button class="btn small primary" onclick="LL.go('game')">Live Game</button>`:''}</div></header>
        <main class="page">${view==='home'?renderHome():view==='game'?renderGame():view==='roster'?renderRoster():view==='stats'?renderStats():renderSettings()}</main>
        ${renderNav()}
      </div>${modal?renderModal():''}`;
  }

  function renderNav(){
    const items=[['home','⌂','Home'],['game','◉','Game'],['roster','♟','Roster'],['stats','▥','Stats']];
    return `<nav class="bottom-nav">${items.map(([v,i,l])=>`<button class="nav-btn ${view===v?'active':''}" onclick="LL.go('${v}')"><span class="nav-icon">${i}</span>${l}</button>`).join('')}</nav>`;
  }

  function renderHome(){
    const g=activeGame();
    const completed=state.games.filter(x=>x.status==='completed').slice().reverse().slice(0,5);
    return `
      ${g?`<section class="card">
        <div class="row between"><div><div class="badge">LIVE</div><h2 style="margin-top:8px">vs ${esc(g.opponent||'Opponent')}</h2><div class="subtle">${esc(g.date)}</div></div><div style="text-align:right"><div class="score-total">${totalsForGame(g).us} – ${totalsForGame(g).them}</div><div class="subtle">${esc(state.settings.teamName)}</div></div></div>
        <button class="btn primary full" style="margin-top:14px" onclick="LL.go('game')">Continue Game</button>
      </section>`:`<section class="card"><h2>Ready for first pitch?</h2><p class="subtle">Create a game, load your active roster into the lineup, and start recording plate appearances with one tap.</p><button class="btn primary full" onclick="LL.openNewGame()">+ New Game</button></section>`}
      <section class="card">
        <div class="section-title"><h2>Quick Actions</h2><button class="btn small ghost" onclick="LL.go('settings')">Settings</button></div>
        <div class="grid2">
          <button class="btn" onclick="LL.openAddPlayer(false)">+ Add Player</button>
          <button class="btn" onclick="LL.openAddPlayer(true)">+ Add Fill-In</button>
          <button class="btn" onclick="LL.exportXlsx()">Export Excel</button>
          <button class="btn" onclick="LL.backup()">Backup Data</button>
        </div>
      </section>
      <section class="card"><div class="section-title"><h2>Recent Games</h2>${!g?`<button class="btn small primary" onclick="LL.openNewGame()">New</button>`:''}</div>
        ${completed.length?`<div class="list">${completed.map(x=>{const t=totalsForGame(x);return `<div class="list-row"><div class="avatar">${t.us>t.them?'W':t.us<t.them?'L':'T'}</div><div class="grow"><div class="player-name">vs ${esc(x.opponent||'Opponent')}</div><div class="player-meta">${esc(x.date)} • ${t.us}-${t.them}</div></div><button class="btn small" onclick="LL.viewGame('${x.id}')">View</button></div>`}).join('')}</div>`:`<div class="empty">No completed games yet.</div>`}
      </section>`;
  }

  function renderGame(){
    const g=activeGame();
    if(!g) return `<section class="card"><h2>No active game</h2><p class="subtle">Start a game and your active roster will be loaded into the lineup automatically.</p><button class="btn primary full" onclick="LL.openNewGame()">+ New Game</button></section>`;
    const lineup=g.lineup||[];
    const currentId=lineup.length ? lineup[g.battingIndex%lineup.length] : null;
    const current=getPlayer(currentId);
    const last=g.pas[g.pas.length-1];
    return `
      <section class="card">
        <div class="row between"><div><div class="badge">LIVE</div><h2 style="margin-top:8px">${esc(state.settings.teamName)} vs ${esc(g.opponent||'Opponent')}</h2><div class="subtle">${esc(g.date)}</div></div><button class="btn small" onclick="LL.openLineup()">Edit Lineup</button></div>
      </section>
      ${current?`<section class="current-batter"><div class="row between"><div><div class="slot">Up now • #${(g.battingIndex%lineup.length)+1}</div><div class="name">${esc(current.name)}</div><div class="subtle">${current.number?`#${esc(current.number)} • `:''}${current.fillIn?'Fill-in':'Roster player'}</div></div><div><div class="tiny" style="text-align:center;margin-bottom:4px">RBI</div><div class="stepper"><button onclick="LL.rbi(-1)">−</button><span>${pendingRbi}</span><button onclick="LL.rbi(1)">+</button></div></div></div></section>`:`<section class="card"><div class="empty">Your lineup is empty. Add players to begin.</div><button class="btn primary full" onclick="LL.openLineup()">Build Lineup</button></section>`}
      ${current?`<section class="card"><h3>Plate Appearance</h3><div class="quick-results">${visibleOutcomes().map(o=>`<button class="result ${esc(o.kind)}" onclick="LL.recordPA('${o.id}')">${esc(o.label)}</button>`).join('')}</div>${last?`<div class="row between" style="margin-top:12px"><div class="tiny">Last: ${esc(getPlayer(last.playerId)?.name||'Player')} — ${esc(resultDef(last.resultId).label)}${last.rbi?` • ${last.rbi} RBI`:''}</div><button class="btn small danger" onclick="LL.undoPA()">Undo</button></div>`:''}</section>`:''}
      <section class="card"><div class="section-title"><div><h2>Score</h2><div class="subtle">Inning ${num(g.currentInning)+1}</div></div><button class="btn small" onclick="LL.addInning()">+ Extra Inning</button></div><div class="grid3" style="margin-bottom:12px"><button class="btn primary" onclick="LL.scorePlus('us')">+1 ${esc(state.settings.teamName)}</button><button class="btn blue" onclick="LL.scorePlus('them')">+1 Opponent</button><button class="btn" onclick="LL.nextInning()">Next Inning →</button></div>${renderScoreboard(g)}</section>
      <section class="card"><div class="section-title"><h2>Lineup</h2><button class="btn small" onclick="LL.openLineup()">Adjust</button></div>${renderLiveLineup(g)}</section>
      <section class="card"><div class="grid2"><button class="btn" onclick="LL.openAddFillInToGame()">+ Fill-In Now</button><button class="btn danger" onclick="LL.finishGame()">Finish Game</button></div></section>`;
  }

  function renderScoreboard(g){
    const n=Math.max(g.score.us.length,g.score.them.length);
    const headers=Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join('');
    const row=(team,label)=>`<tr><th>${esc(label)}</th>${g.score[team].map((v,i)=>`<td><input inputmode="numeric" pattern="[0-9]*" class="score-input" value="${num(v)}" onchange="LL.score('${team}',${i},this.value)" /></td>`).join('')}<td class="score-total">${g.score[team].reduce((a,b)=>a+num(b),0)}</td></tr>`;
    return `<div class="score-wrap"><table class="score-table"><tr><th></th>${headers}<th>R</th></tr>${row('us',state.settings.teamName)}${row('them',g.opponent||'Opponent')}</table></div>`;
  }

  function renderLiveLineup(g){
    if(!g.lineup.length) return `<div class="empty">No players in lineup.</div>`;
    const cur=g.battingIndex%g.lineup.length;
    return `<div class="list">${g.lineup.map((id,i)=>{const p=getPlayer(id);const ps=playerGameStats(g,id);return `<div class="list-row" style="${i===cur?'border-color:#2d7564':''}"><div class="lineup-slot">${i+1}</div><div class="grow"><div class="player-name">${esc(p?.name||'Unknown')} ${p?.fillIn?'<span class="badge fill">Fill-In</span>':''}</div><div class="player-meta">${ps.H}-${ps.AB} • ${ps.RBI} RBI • ${num(g.runsByPlayer?.[id])} R</div></div><div class="row"><button class="btn small" onclick="LL.setBatter(${i})">Up</button><button class="btn small" onclick="LL.addRun('${id}')">+ Run</button></div></div>`}).join('')}</div>`;
  }

  function playerGameStats(g,id){
    const s={AB:0,H:0,RBI:0};
    g.pas.filter(pa=>pa.playerId===id).forEach(pa=>{const d=resultDef(pa.resultId);s.AB+=num(d.ab);s.H+=num(d.h);s.RBI+=num(pa.rbi)});
    return s;
  }

  function renderRoster(){
    const players=state.roster.slice().sort((a,b)=>(b.active-a.active)||(a.fillIn-b.fillIn)||a.name.localeCompare(b.name));
    return `<section class="card"><div class="section-title"><h2>Roster</h2><div class="row"><button class="btn small" onclick="LL.openAddPlayer(true)">+ Fill-In</button><button class="btn small primary" onclick="LL.openAddPlayer(false)">+ Player</button></div></div><div class="subtle" style="margin-bottom:12px">Players remain in career stats even if you make them inactive later.</div>${players.length?`<div class="list">${players.map(p=>`<div class="list-row"><div class="avatar">${esc((p.number||p.name?.[0]||'?').toString().slice(0,2))}</div><div class="grow"><div class="player-name">${esc(p.name)} ${p.fillIn?'<span class="badge fill">Fill-In</span>':''} ${!p.active?'<span class="badge gray">Inactive</span>':''}</div><div class="player-meta">${esc(p.positions||'No position')} • ${playerStats(p.id).PA} PA • ${pct(playerStats(p.id).AVG)} AVG</div></div><button class="btn small" onclick="LL.openEditPlayer('${p.id}')">Edit</button></div>`).join('')}</div>`:`<div class="empty">Add your regular roster once, then add fill-ins whenever they show up.</div>`}</section>`;
  }

  function renderStats(){
    let players=state.roster.filter(p=>statsFilter==='all'||(statsFilter==='regular'&&!p.fillIn)||(statsFilter==='fill'&&p.fillIn));
    const rows=players.map(p=>({p,s:playerStats(p.id)})).sort((a,b)=>b.s.PA-a.s.PA || b.s.OPS-a.s.OPS);
    const team=aggregateTeam(rows.map(x=>x.s));
    return `<section class="card"><div class="section-title"><h2>Career Stats</h2><button class="btn small primary" onclick="LL.exportXlsx()">Export .xlsx</button></div><div class="tabs"><button class="tab ${statsFilter==='all'?'active':''}" onclick="LL.filterStats('all')">All</button><button class="tab ${statsFilter==='regular'?'active':''}" onclick="LL.filterStats('regular')">Roster</button><button class="tab ${statsFilter==='fill'?'active':''}" onclick="LL.filterStats('fill')">Fill-Ins</button></div></section>
      <section class="card"><div class="grid3"><div class="metric"><div class="v">${state.games.filter(g=>g.status==='completed').length}</div><div class="k">Games</div></div><div class="metric"><div class="v">${pct(team.AVG)}</div><div class="k">Team AVG</div></div><div class="metric"><div class="v">${team.HR}</div><div class="k">Home Runs</div></div></div></section>
      <section class="card"><div class="table-wrap"><table class="stats-table"><thead><tr><th>Player</th><th>G</th><th>PA</th><th>AB</th><th>H</th><th>1B</th><th>2B</th><th>3B</th><th>HR</th><th>BB</th><th>R</th><th>RBI</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th></tr></thead><tbody>${rows.map(({p,s})=>`<tr><td>${esc(p.name)}${p.fillIn?' *':''}</td><td>${s.G}</td><td>${s.PA}</td><td>${s.AB}</td><td>${s.H}</td><td>${s.B1}</td><td>${s.B2}</td><td>${s.B3}</td><td>${s.HR}</td><td>${s.BB}</td><td>${s.R}</td><td>${s.RBI}</td><td>${pct(s.AVG)}</td><td>${pct(s.OBP)}</td><td>${pct(s.SLG)}</td><td>${pct(s.OPS)}</td></tr>`).join('')}</tbody></table></div><div class="tiny" style="margin-top:8px">* Fill-in player</div></section>`;
  }

  function aggregateTeam(stats){
    const s={AB:0,H:0,HR:0}; stats.forEach(x=>{s.AB+=x.AB;s.H+=x.H;s.HR+=x.HR}); s.AVG=s.AB?s.H/s.AB:0; return s;
  }

  function renderSettings(){
    return `<section class="card"><h2>Customization</h2><div class="grid2"><div><label class="field-label">Team name</label><input class="field" value="${esc(state.settings.teamName)}" onchange="LL.setting('teamName',this.value)" /></div><div><label class="field-label">Default innings</label><input class="field" type="number" min="1" max="20" value="${num(state.settings.innings)}" onchange="LL.setting('innings',this.value)" /></div></div></section>
      <section class="card"><div class="section-title"><h2>Result Buttons</h2><button class="btn small" onclick="LL.addCustomOutcome()">+ Custom</button></div><div class="subtle" style="margin-bottom:12px">Turn buttons on/off and reorder them to match how you score games.</div><div class="list">${state.settings.outcomes.map((o,i)=>`<div class="list-row"><div class="grow"><div class="player-name">${esc(o.label)}</div><div class="player-meta">${describeOutcome(o)}</div></div><button class="btn small ${o.visible?'primary':''}" onclick="LL.toggleOutcome('${o.id}')">${o.visible?'On':'Off'}</button><div class="drag-controls"><button class="btn small" onclick="LL.moveOutcome(${i},-1)">↑</button><button class="btn small" onclick="LL.moveOutcome(${i},1)">↓</button></div>${o.custom?`<button class="btn small danger" onclick="LL.deleteOutcome('${o.id}')">×</button>`:''}</div>`).join('')}</div></section>
      <section class="card"><h2>Data</h2><div class="grid2"><button class="btn" onclick="LL.exportXlsx()">Export Excel</button><button class="btn" onclick="LL.backup()">Backup JSON</button><label class="btn" style="text-align:center">Import Backup<input type="file" accept="application/json,.json" style="display:none" onchange="LL.importBackup(this.files[0])"></label><button class="btn danger" onclick="LL.resetAll()">Erase All Data</button></div><p class="tiny">Data lives on this device in your browser. Use Backup JSON before moving to a new phone or clearing browser data.</p></section>`;
  }

  function describeOutcome(o){
    if(o.h) return `Hit • ${o.b1?'single':o.b2?'double':o.b3?'triple':'home run'}`;
    if(o.bb) return 'Walk • no at-bat';
    if(o.sf) return 'Sacrifice • no at-bat';
    if(o.ab) return 'At-bat • no hit';
    return 'Plate appearance only';
  }

  function renderModal(){
    if(modal.type==='newGame') return modalShell('New Game',`<div><label class="field-label">Opponent</label><input id="ngOpp" class="field" placeholder="Opponent team" autofocus /></div><div style="margin-top:10px"><label class="field-label">Date</label><input id="ngDate" type="date" class="field" value="${today()}" /></div><div style="margin-top:10px"><label class="field-label">Innings</label><input id="ngInn" type="number" min="1" max="20" class="field" value="${num(state.settings.innings)}" /></div><button class="btn primary full" style="margin-top:14px" onclick="LL.createGame()">Start Game</button>`);
    if(modal.type==='player'){
      const p=modal.playerId?getPlayer(modal.playerId):null;
      return modalShell(p?'Edit Player':(modal.fillIn?'Add Fill-In':'Add Player'),`<div><label class="field-label">Name</label><input id="pName" class="field" value="${esc(p?.name||'')}" placeholder="Player name" autofocus /></div><div class="grid2" style="margin-top:10px"><div><label class="field-label">Jersey #</label><input id="pNum" class="field" value="${esc(p?.number||'')}" /></div><div><label class="field-label">Positions</label><input id="pPos" class="field" value="${esc(p?.positions||'')}" placeholder="SS, OF" /></div></div><div class="grid2" style="margin-top:10px"><label class="btn"><input id="pActive" type="checkbox" ${p?.active!==false?'checked':''} /> Active</label><label class="btn"><input id="pFill" type="checkbox" ${p?.fillIn||modal.fillIn?'checked':''} /> Fill-In</label></div><button class="btn primary full" style="margin-top:14px" onclick="LL.savePlayer('${p?.id||''}')">Save Player</button>${p?`<button class="btn danger full" style="margin-top:8px" onclick="LL.deletePlayer('${p.id}')">Delete Player</button>`:''}`);
    }
    if(modal.type==='lineup'){
      const g=activeGame();
      return modalShell('Adjust Lineup',`${g.lineup.length?`<div class="list">${g.lineup.map((id,i)=>`<div class="list-row"><div class="lineup-slot">${i+1}</div><select class="field lineup-select" onchange="LL.setLineupSlot(${i},this.value)">${state.roster.filter(p=>p.active||p.id===id).map(p=>`<option value="${p.id}" ${p.id===id?'selected':''}>${esc(p.name)}${p.fillIn?' (Fill-In)':''}</option>`).join('')}</select><div class="drag-controls"><button class="btn small" onclick="LL.moveLineup(${i},-1)">↑</button><button class="btn small" onclick="LL.moveLineup(${i},1)">↓</button></div><button class="btn small danger" onclick="LL.removeLineup(${i})">×</button></div>`).join('')}</div>`:`<div class="empty">No lineup yet.</div>`}<div class="grid2" style="margin-top:12px"><button class="btn" onclick="LL.addLineupSlot()">+ Roster Player</button><button class="btn" onclick="LL.openAddFillInToGame()">+ Fill-In</button></div><button class="btn primary full" style="margin-top:10px" onclick="LL.closeModal()">Done</button>`);
    }
    if(modal.type==='customOutcome') return modalShell('Custom Result',`<div><label class="field-label">Button label</label><input id="coLabel" class="field" placeholder="e.g. FC, HBP" autofocus /></div><div style="margin-top:10px"><label class="field-label">How should it count?</label><select id="coClass" class="field"><option value="about">At-bat, no hit</option><option value="walk">No at-bat, reaches base</option><option value="pa">Plate appearance only</option><option value="single">Hit / single</option></select></div><button class="btn primary full" style="margin-top:14px" onclick="LL.saveCustomOutcome()">Add Button</button>`);
    if(modal.type==='pastGame'){
      const g=state.games.find(x=>x.id===modal.gameId); if(!g) return '';
      const t=totalsForGame(g);
      return modalShell(`vs ${esc(g.opponent||'Opponent')}`,`<div class="grid3"><div class="metric"><div class="v">${t.us}</div><div class="k">${esc(state.settings.teamName)}</div></div><div class="metric"><div class="v">${t.them}</div><div class="k">Opponent</div></div><div class="metric"><div class="v">${g.pas.length}</div><div class="k">PA logged</div></div></div><div style="margin-top:14px">${renderScoreboardReadOnly(g)}</div><button class="btn danger full" style="margin-top:14px" onclick="LL.deleteGame('${g.id}')">Delete Game</button>`);
    }
    return '';
  }

  function modalShell(title,body){ return `<div class="modal-backdrop" onclick="if(event.target===this)LL.closeModal()"><div class="modal"><div class="row between"><h2 style="margin:0">${title}</h2><button class="btn small" onclick="LL.closeModal()">Close</button></div><hr/>${body}</div></div>`; }
  function renderScoreboardReadOnly(g){
    const n=Math.max(g.score.us.length,g.score.them.length); const heads=Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join('');
    const r=(team,label)=>`<tr><th>${esc(label)}</th>${g.score[team].map(v=>`<td>${num(v)}</td>`).join('')}<td class="score-total">${g.score[team].reduce((a,b)=>a+num(b),0)}</td></tr>`;
    return `<div class="score-wrap"><table class="score-table"><tr><th></th>${heads}<th>R</th></tr>${r('us',state.settings.teamName)}${r('them',g.opponent||'Opponent')}</table></div>`;
  }

  function createGame(){
    const opponent=document.getElementById('ngOpp').value.trim(); const date=document.getElementById('ngDate').value||today(); const innings=Math.max(1,num(document.getElementById('ngInn').value)||7);
    if(activeGame()){ toast('Finish the active game first'); return; }
    const lineup=state.roster.filter(p=>p.active&&!p.fillIn).map(p=>p.id);
    const g={id:uid(),date,opponent,status:'active',lineup,battingIndex:0,currentInning:0,pas:[],runsByPlayer:{},score:{us:Array(innings).fill(0),them:Array(innings).fill(0)},createdAt:new Date().toISOString()};
    state.games.push(g); save(); modal=null; pendingRbi=0; view='game'; render();
  }

  function savePlayer(id){
    const name=document.getElementById('pName').value.trim(); if(!name){toast('Player name is required');return;}
    const payload={name,number:document.getElementById('pNum').value.trim(),positions:document.getElementById('pPos').value.trim(),active:document.getElementById('pActive').checked,fillIn:document.getElementById('pFill').checked};
    if(id){Object.assign(getPlayer(id),payload);} else state.roster.push({id:uid(),...payload});
    save(); modal=null; render(); toast(id?'Player updated':'Player added');
  }

  function deletePlayer(id){
    const used=state.games.some(g=>g.pas.some(pa=>pa.playerId===id));
    if(used){toast('Player has stats — mark inactive instead');return;}
    if(!confirm('Delete this player?')) return;
    state.roster=state.roster.filter(p=>p.id!==id); state.games.forEach(g=>g.lineup=g.lineup.filter(x=>x!==id)); save(); modal=null; render();
  }

  function recordPA(resultId){
    const g=activeGame(); if(!g||!g.lineup.length) return;
    const playerId=g.lineup[g.battingIndex%g.lineup.length];
    g.pas.push({id:uid(),playerId,resultId,rbi:pendingRbi,inning:currentInning(g),ts:new Date().toISOString()});
    g.battingIndex=(g.battingIndex+1)%g.lineup.length; pendingRbi=0; save(); render();
  }
  function currentInning(g){ return Math.max(1, num(g.currentInning)+1); }
  function undoPA(){ const g=activeGame(); if(!g||!g.pas.length)return; g.pas.pop(); if(g.lineup.length)g.battingIndex=(g.battingIndex-1+g.lineup.length)%g.lineup.length; save(); render(); toast('Last PA removed'); }
  function addRun(id){ const g=activeGame(); if(!g)return; g.runsByPlayer[id]=num(g.runsByPlayer[id])+1; save(); render(); }
  function score(team,i,v){ const g=activeGame(); if(!g)return; g.score[team][i]=Math.max(0,num(v)); save(); render(); }
  function scorePlus(team){ const g=activeGame(); if(!g)return; g.currentInning=Math.max(0,num(g.currentInning)); while(g.currentInning>=g.score[team].length){g.score.us.push(0);g.score.them.push(0);} g.score[team][g.currentInning]=num(g.score[team][g.currentInning])+1; save();render(); }
  function nextInning(){ const g=activeGame(); if(!g)return; g.currentInning=Math.max(0,num(g.currentInning))+1; while(g.currentInning>=g.score.us.length){g.score.us.push(0);g.score.them.push(0);} save();render(); }
  function addInning(){ const g=activeGame(); if(!g)return; g.score.us.push(0);g.score.them.push(0);save();render(); }
  function finishGame(){ const g=activeGame(); if(!g)return; if(!confirm('Finish this game? You can still view it in history.'))return; g.status='completed';g.completedAt=new Date().toISOString();save();pendingRbi=0;view='home';render(); }

  function setLineupSlot(i,newId){
    const g=activeGame(); if(!g)return; const old=g.lineup[i]; const j=g.lineup.indexOf(newId);
    if(j>=0&&j!==i){g.lineup[j]=old;} g.lineup[i]=newId; save(); render();
  }
  function moveLineup(i,d){ const g=activeGame(); if(!g)return; const j=i+d;if(j<0||j>=g.lineup.length)return;[g.lineup[i],g.lineup[j]]=[g.lineup[j],g.lineup[i]];save();render(); }
  function removeLineup(i){ const g=activeGame(); if(!g)return; g.lineup.splice(i,1); if(g.lineup.length)g.battingIndex%=g.lineup.length; else g.battingIndex=0;save();render(); }
  function addLineupSlot(){
    const g=activeGame();if(!g)return; const unused=state.roster.find(p=>p.active&&!g.lineup.includes(p.id)); if(!unused){toast('No unused active players');return;} g.lineup.push(unused.id);save();render();
  }
  function openAddFillInToGame(){
    const name=prompt('Fill-in player name'); if(!name?.trim())return;
    const p={id:uid(),name:name.trim(),number:'',positions:'',active:true,fillIn:true}; state.roster.push(p); const g=activeGame(); if(g)g.lineup.push(p.id);save();modal=g?{type:'lineup'}:null;render();toast('Fill-in added');
  }

  // Minimal XLSX writer (ZIP container with uncompressed OOXML files)
  function exportXlsx(){
    const career=[['Player','Jersey','Fill-In','Active','G','PA','AB','H','1B','2B','3B','HR','BB','R','RBI','AVG','OBP','SLG','OPS']];
    state.roster.forEach(p=>{const s=playerStats(p.id);career.push([p.name,p.number,p.fillIn?'Yes':'No',p.active?'Yes':'No',s.G,s.PA,s.AB,s.H,s.B1,s.B2,s.B3,s.HR,s.BB,s.R,s.RBI,s.AVG,s.OBP,s.SLG,s.OPS]);});
    const roster=[['Player ID','Name','Jersey','Positions','Fill-In','Active'],...state.roster.map(p=>[p.id,p.name,p.number,p.positions,p.fillIn?'Yes':'No',p.active?'Yes':'No'])];
    const games=[['Game ID','Date','Opponent','Status',state.settings.teamName,'Opponent Runs','Result','Plate Appearances']];
    state.games.forEach(g=>{const t=totalsForGame(g);games.push([g.id,g.date,g.opponent,g.status,t.us,t.them,t.us>t.them?'W':t.us<t.them?'L':'T',g.pas.length]);});
    const pas=[['Game ID','Date','Opponent','Player','Result','RBI','Inning','Timestamp']];
    state.games.forEach(g=>g.pas.forEach(pa=>pas.push([g.id,g.date,g.opponent,getPlayer(pa.playerId)?.name||'Unknown',resultDef(pa.resultId).label,num(pa.rbi),num(pa.inning),pa.ts])));
    const sheets=[['Career Stats',career],['Roster',roster],['Games',games],['Plate Appearances',pas]];
    const blob=makeXlsx(sheets); download(blob,`softball-stats-${today()}.xlsx`); toast('Excel workbook exported');
  }

  function xmlEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
  function colName(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
  function sheetXml(rows){
    const body=rows.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>{const ref=`${colName(ci+1)}${ri+1}`; if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}"><v>${v}</v></c>`; return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;}).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }
  function makeXlsx(sheets){
    const files={};
    files['[Content_Types].xml']=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    files['_rels/.rels']=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    files['xl/workbook.xml']=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEsc(s[0].slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
    files['xl/_rels/workbook.xml.rels']=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`;
    sheets.forEach((s,i)=>files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(s[1]));
    return zipStore(files,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  const te=new TextEncoder();
  let crcTable=null;
  function crc32(bytes){
    if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}}
    let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0;
  }
  function u16(n){return [n&255,(n>>>8)&255]}
  function u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]}
  function zipStore(files,mime){
    const locals=[],centrals=[]; let offset=0;
    Object.entries(files).forEach(([name,content])=>{
      const nb=te.encode(name), data=te.encode(content), crc=crc32(data);
      const local=new Uint8Array([0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0),...nb,...data]);
      locals.push(local);
      const central=new Uint8Array([0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...nb]);
      centrals.push(central); offset+=local.length;
    });
    const csize=centrals.reduce((a,b)=>a+b.length,0), count=centrals.length;
    const end=new Uint8Array([0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(count),...u16(count),...u32(csize),...u32(offset),...u16(0)]);
    return new Blob([...locals,...centrals,end],{type:mime});
  }
  function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);}

  function backup(){download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),`softball-backup-${today()}.json`);toast('Backup downloaded');}
  function importBackup(file){if(!file)return;const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);if(!x.roster||!x.games||!x.settings)throw new Error();state=x;save();render();toast('Backup imported');}catch(e){alert('That backup file could not be read.');}};r.readAsText(file);}

  function resetAll(){if(!confirm('Erase ALL roster, games, and stats from this device?'))return;if(!confirm('This cannot be undone unless you made a backup. Continue?'))return;state=freshState();save();view='home';render();}

  window.LL={
    go(v){view=v==='game'&& !activeGame()?'game':v;modal=null;render();},
    openNewGame(){modal={type:'newGame'};render();}, createGame,
    openAddPlayer(fillIn){modal={type:'player',fillIn};render();}, openEditPlayer(id){modal={type:'player',playerId:id};render();},savePlayer,deletePlayer,
    openLineup(){if(activeGame()){modal={type:'lineup'};render();}},closeModal(){modal=null;render();},
    rbi(d){pendingRbi=Math.max(0,pendingRbi+d);render();},recordPA,undoPA,addRun,score,scorePlus,nextInning,addInning,finishGame,
    setLineupSlot,moveLineup,removeLineup,addLineupSlot,openAddFillInToGame,
    setBatter(i){const g=activeGame();if(!g||!g.lineup.length)return;g.battingIndex=Math.max(0,Math.min(i,g.lineup.length-1));save();render();},
    filterStats(f){statsFilter=f;render();},
    setting(k,v){state.settings[k]=k==='innings'?Math.max(1,num(v)):v;save();render();},
    toggleOutcome(id){const o=resultDef(id);o.visible=!o.visible;save();render();},
    moveOutcome(i,d){const j=i+d;if(j<0||j>=state.settings.outcomes.length)return;[state.settings.outcomes[i],state.settings.outcomes[j]]=[state.settings.outcomes[j],state.settings.outcomes[i]];save();render();},
    addCustomOutcome(){modal={type:'customOutcome'};render();},
    saveCustomOutcome(){const label=document.getElementById('coLabel').value.trim();const cls=document.getElementById('coClass').value;if(!label)return toast('Label required');const base={id:uid(),label,ab:0,h:0,b1:0,b2:0,b3:0,hr:0,bb:0,sf:0,visible:true,kind:'out',custom:true};if(cls==='about')base.ab=1;if(cls==='walk'){base.bb=1;base.kind='walk';}if(cls==='single'){base.ab=1;base.h=1;base.b1=1;base.kind='hit';}state.settings.outcomes.push(base);save();modal=null;render();},
    deleteOutcome(id){state.settings.outcomes=state.settings.outcomes.filter(o=>o.id!==id);save();render();},
    exportXlsx,backup,importBackup,resetAll,
    viewGame(id){modal={type:'pastGame',gameId:id};render();},
    deleteGame(id){if(!confirm('Delete this game and all stats recorded in it?'))return;state.games=state.games.filter(g=>g.id!==id);save();modal=null;render();}
  };

  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  render();
})();
