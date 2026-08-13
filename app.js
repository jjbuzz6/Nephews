(() => {
  'use strict';

  const STORAGE_KEY = 'lineupLedger.v2';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (s = '') => String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const cap = s => `${String(s).charAt(0).toUpperCase()}${String(s).slice(1)}`;

  const defaultOutcomes = () => [
    { id: '1b', label: '1B', ab: 1, h: 1, b1: 1, b2: 0, b3: 0, hr: 0, bb: 0, sf: 0, visible: true, kind: 'hit' },
    { id: '2b', label: '2B', ab: 1, h: 1, b1: 0, b2: 1, b3: 0, hr: 0, bb: 0, sf: 0, visible: true, kind: 'hit' },
    { id: '3b', label: '3B', ab: 1, h: 1, b1: 0, b2: 0, b3: 1, hr: 0, bb: 0, sf: 0, visible: true, kind: 'hit' },
    { id: 'hr', label: 'HR', ab: 1, h: 1, b1: 0, b2: 0, b3: 0, hr: 1, bb: 0, sf: 0, visible: true, kind: 'hr' },
    { id: 'bb', label: 'BB', ab: 0, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 1, sf: 0, visible: true, kind: 'walk' },
    { id: 'out', label: 'OUT', ab: 1, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 0, sf: 0, visible: true, kind: 'out' },
    { id: 'roe', label: 'ROE', ab: 1, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 0, sf: 0, visible: true, kind: 'out' },
    { id: 'sf', label: 'SAC', ab: 0, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 0, sf: 1, visible: true, kind: 'out' }
  ];

  function freshState() {
    return {
      settings: { teamName: 'Nephews', innings: 7, outcomes: defaultOutcomes() },
      roster: [],
      games: []
    };
  }

  function normalizeState(raw) {
    const state = raw && typeof raw === 'object' ? raw : freshState();
    state.settings ||= {};
    if (!state.settings.teamName || state.settings.teamName === 'My Team') state.settings.teamName = 'Nephews';
    state.settings.innings = Math.max(1, num(state.settings.innings) || 7);
    state.settings.outcomes = Array.isArray(state.settings.outcomes) && state.settings.outcomes.length ? state.settings.outcomes : defaultOutcomes();
    state.roster = Array.isArray(state.roster) ? state.roster : [];
    state.games = Array.isArray(state.games) ? state.games : [];

    state.roster = state.roster.map(p => ({
      id: p.id || uid(),
      name: p.name || 'Unnamed Player',
      number: p.number || '',
      positions: p.positions || '',
      active: p.active !== false,
      fillIn: !!p.fillIn
    }));

    state.games = state.games.map(g => {
      const innings = Math.max(g?.score?.us?.length || 0, g?.score?.them?.length || 0, state.settings.innings, 1);
      const us = Array.from({ length: innings }, (_, i) => num(g?.score?.us?.[i]));
      const them = Array.from({ length: innings }, (_, i) => num(g?.score?.them?.[i]));
      return {
        id: g.id || uid(),
        date: g.date || today(),
        opponent: g.opponent || '',
        status: g.status || 'completed',
        lineup: Array.isArray(g.lineup) ? g.lineup.filter(Boolean) : [],
        battingIndex: Math.max(0, num(g.battingIndex)),
        currentInning: Math.max(0, num(g.currentInning)),
        pas: Array.isArray(g.pas) ? g.pas : [],
        runsByPlayer: g.runsByPlayer || {},
        score: { us, them },
        createdAt: g.createdAt || new Date().toISOString(),
        completedAt: g.completedAt || null,
        playerOfGameId: g.playerOfGameId || null,
        gameSummary: g.gameSummary || ''
      };
    });

    return state;
  }

  function load() {
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      if (local) return normalizeState(JSON.parse(local));
      const legacy = localStorage.getItem('lineupLedger.v1');
      if (legacy) return normalizeState(JSON.parse(legacy));
      return freshState();
    } catch (e) {
      return freshState();
    }
  }

  let state = load();
  let view = 'home';
  let modal = null;
  let pendingRbi = 0;
  let statsFilter = 'all';
  let statsSortKey = 'PA';
  let statsSortDir = 'desc';

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function toast(msg) {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2100);
  }

  const activeGame = () => state.games.find(g => g.status === 'active') || null;
  const getPlayer = id => state.roster.find(p => p.id === id);
  const visibleOutcomes = () => state.settings.outcomes.filter(o => o.visible);
  const resultDef = id => state.settings.outcomes.find(o => o.id === id) || { id, label: id, ab: 0, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 0, sf: 0, kind: 'out' };
  const teamName = () => state.settings.teamName || 'Nephews';
  const pct = n => Number.isFinite(n) ? n.toFixed(3).replace(/^0/, '') : '.000';

  function totalsForGame(g) {
    return {
      us: (g.score.us || []).reduce((a, b) => a + num(b), 0),
      them: (g.score.them || []).reduce((a, b) => a + num(b), 0)
    };
  }

  function playerStats(playerId, games = state.games) {
    const s = { G: 0, PA: 0, AB: 0, H: 0, B1: 0, B2: 0, B3: 0, HR: 0, BB: 0, SF: 0, R: 0, RBI: 0 };
    for (const g of games) {
      const appeared = g.pas.some(pa => pa.playerId === playerId) || (g.lineup || []).includes(playerId) || num(g.runsByPlayer?.[playerId]) > 0;
      if (appeared) s.G++;
      s.R += num(g.runsByPlayer?.[playerId]);
      for (const pa of g.pas) {
        if (pa.playerId !== playerId) continue;
        const d = resultDef(pa.resultId);
        s.PA++;
        s.AB += num(d.ab); s.H += num(d.h); s.B1 += num(d.b1); s.B2 += num(d.b2); s.B3 += num(d.b3); s.HR += num(d.hr); s.BB += num(d.bb); s.SF += num(d.sf); s.RBI += num(pa.rbi);
      }
    }
    s.AVG = s.AB ? s.H / s.AB : 0;
    s.OBP = (s.AB + s.BB + s.SF) ? (s.H + s.BB) / (s.AB + s.BB + s.SF) : 0;
    s.SLG = s.AB ? (s.B1 + 2 * s.B2 + 3 * s.B3 + 4 * s.HR) / s.AB : 0;
    s.OPS = s.OBP + s.SLG;
    return s;
  }

  function playerGameStats(g, id) {
    const s = { AB: 0, H: 0, RBI: 0 };
    g.pas.filter(pa => pa.playerId === id).forEach(pa => {
      const d = resultDef(pa.resultId);
      s.AB += num(d.ab); s.H += num(d.h); s.RBI += num(pa.rbi);
    });
    return s;
  }

  function aggregateTeam(statsRows) {
    const s = { AB: 0, H: 0, HR: 0 };
    statsRows.forEach(x => { s.AB += x.AB; s.H += x.H; s.HR += x.HR; });
    s.AVG = s.AB ? s.H / s.AB : 0;
    return s;
  }

  function gamePlayerLine(g, playerId) {
    const s = { PA: 0, AB: 0, H: 0, B1: 0, B2: 0, B3: 0, HR: 0, BB: 0, SF: 0, R: num(g.runsByPlayer?.[playerId]), RBI: 0, TB: 0, OUTS: 0 };
    g.pas.filter(pa => pa.playerId === playerId).forEach(pa => {
      const d = resultDef(pa.resultId);
      s.PA++;
      s.AB += num(d.ab); s.H += num(d.h); s.B1 += num(d.b1); s.B2 += num(d.b2); s.B3 += num(d.b3); s.HR += num(d.hr); s.BB += num(d.bb); s.SF += num(d.sf); s.RBI += num(pa.rbi);
      s.OUTS += num(d.ab) && !num(d.h) ? 1 : 0;
    });
    s.TB = s.B1 + (2 * s.B2) + (3 * s.B3) + (4 * s.HR);
    s.AVG = s.AB ? s.H / s.AB : 0;
    s.score = (s.TB * 1.6) + (s.H * 1.25) + (s.HR * 2.5) + (s.RBI * 2) + (s.R * 1.5) + (s.BB * .75) - (s.OUTS * .1);
    return s;
  }

  function gamePerformers(g) {
    const ids = [...new Set([...(g.lineup || []), ...g.pas.map(pa => pa.playerId), ...Object.keys(g.runsByPlayer || {})])];
    return ids.map(id => ({ p: getPlayer(id), s: gamePlayerLine(g, id) })).filter(x => x.p).sort((a, b) => b.s.score - a.s.score || b.s.H - a.s.H || b.s.RBI - a.s.RBI || a.p.name.localeCompare(b.p.name));
  }

  function choosePlayerOfGame(g) {
    const performers = gamePerformers(g);
    return performers[0]?.p?.id || (g.lineup || [])[0] || null;
  }

  function ordinal(n) {
    const v = n % 100;
    return `${n}${['th','st','nd','rd'][(v - 20) % 10] || ['th','st','nd','rd'][v] || 'th'}`;
  }

  function playerLineText(p, s) {
    const bits = [];
    if (s.AB) bits.push(`${s.H}-for-${s.AB}`);
    else if (s.PA) bits.push(`${s.PA} PA`);
    if (s.HR) bits.push(`${s.HR} HR`);
    if (s.B2) bits.push(`${s.B2} 2B`);
    if (s.B3) bits.push(`${s.B3} 3B`);
    if (s.RBI) bits.push(`${s.RBI} RBI`);
    if (s.R) bits.push(`${s.R} R`);
    if (s.BB) bits.push(`${s.BB} BB`);
    return bits.length ? `${p.name} (${bits.join(', ')})` : p.name;
  }

  function generateGameSummary(g) {
    const t = totalsForGame(g);
    const opponent = g.opponent || 'the opponent';
    const result = t.us > t.them ? 'win' : t.us < t.them ? 'loss' : 'tie';
    const margin = Math.abs(t.us - t.them);
    const performers = gamePerformers(g);
    const pogId = g.playerOfGameId || choosePlayerOfGame(g);
    const pog = performers.find(x => x.p.id === pogId) || performers[0];
    const totalHits = performers.reduce((a, x) => a + x.s.H, 0);
    const totalHR = performers.reduce((a, x) => a + x.s.HR, 0);
    const innings = g.score.us || [];
    let biggest = { runs: -1, inning: 1 };
    innings.forEach((runs, i) => { if (num(runs) > biggest.runs) biggest = { runs: num(runs), inning: i + 1 }; });

    let opener;
    if (result === 'win') opener = margin >= 7 ? `The Nephews powered past ${opponent}, ${t.us}-${t.them}, in a convincing team win.` : `The Nephews came away with a ${t.us}-${t.them} win over ${opponent}.`;
    else if (result === 'loss') opener = `The Nephews battled ${opponent} but finished on the wrong side of a ${t.us}-${t.them} final.`;
    else opener = `The Nephews and ${opponent} finished even at ${t.us}-${t.them}.`;

    const offense = totalHits || totalHR ? `The offense recorded ${totalHits} tracked hit${totalHits === 1 ? '' : 's'}${totalHR ? `, including ${totalHR} home run${totalHR === 1 ? '' : 's'}` : ''}.` : `The game was decided more by run production than by a large number of tracked hits.`;
    const inningNote = biggest.runs > 0 ? `The biggest inning came in the ${ordinal(biggest.inning)}, when the Nephews pushed across ${biggest.runs} run${biggest.runs === 1 ? '' : 's'}.` : '';
    const pogText = pog ? `${playerLineText(pog.p, pog.s)} earned Player of the Game honors as the top all-around contributor.` : '';
    const others = performers.filter(x => !pog || x.p.id !== pog.p.id).filter(x => x.s.H || x.s.RBI || x.s.R || x.s.BB).slice(0, 2);
    const support = others.length ? `Other standouts included ${others.map(x => playerLineText(x.p, x.s)).join(others.length === 2 ? ' and ' : '')}.` : '';
    const closer = result === 'win' ? `It was a strong all-around result for the Nephews, with the lineup finding enough production to finish the job.` : result === 'loss' ? `Even in the loss, there were individual performances to build on going into the next game.` : `The even result reflected a back-and-forth game with contributions throughout the lineup.`;

    return [opener, offense, inningNote, pogText, support, closer].filter(Boolean).join(' ');
  }

  function ensurePostgame(g) {
    if (!g.playerOfGameId) g.playerOfGameId = choosePlayerOfGame(g);
    if (!g.gameSummary) g.gameSummary = generateGameSummary(g);
    return g;
  }

  function render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="app-shell nephews-theme">
        <header class="topbar">
          <div class="topbar-row">
            <div>
              <div class="brand"><span class="brand-badge">N</span> The <span>Nephews</span></div>
              <div class="subtle">${esc(teamName())} softball tracker</div>
            </div>
            ${activeGame() ? `<button class="btn small primary" onclick="LL.go('game')">Live Game</button>` : ''}
          </div>
        </header>
        <main class="page">${view === 'home' ? renderHome() : view === 'game' ? renderGame() : view === 'roster' ? renderRoster() : view === 'stats' ? renderStats() : renderSettings()}</main>
        ${renderNav()}
      </div>
      ${modal ? renderModal() : ''}`;
  }

  function renderNav() {
    const items = [['home', '⌂', 'Home'], ['game', '◉', 'Game'], ['roster', '♟', 'Roster'], ['stats', '▥', 'Stats']];
    return `<nav class="bottom-nav">${items.map(([v, i, l]) => `<button class="nav-btn ${view === v ? 'active' : ''}" onclick="LL.go('${v}')"><span class="nav-icon">${i}</span>${l}</button>`).join('')}</nav>`;
  }

  function renderHome() {
    const g = activeGame();
    const completed = state.games.filter(x => x.status === 'completed').slice().reverse().slice(0, 5);
    const activeCount = state.roster.filter(p => p.active && !p.fillIn).length;
    return `
      <section class="card hero-card nephews-hero">
        <div class="hero-mark">⚾</div>
        <div>
          <div class="badge gray">THE NEPHEWS</div>
          <h2 style="margin-top:10px">Fast stat tracking for the Nephews</h2>
          <p class="subtle">Built for quick lineup changes, fill-ins, game-by-game scoring, and season stats on your phone.</p>
        </div>
      </section>
      ${g ? `<section class="card">
        <div class="row between"><div><div class="badge">LIVE</div><h2 style="margin-top:8px">vs ${esc(g.opponent || 'Opponent')}</h2><div class="subtle">${esc(g.date)}</div></div><div style="text-align:right"><div class="score-total">${totalsForGame(g).us} – ${totalsForGame(g).them}</div><div class="subtle">${esc(teamName())}</div></div></div>
        <button class="btn primary full" style="margin-top:14px" onclick="LL.go('game')">Continue Game</button>
      </section>` : `<section class="card"><h2>Ready for first pitch?</h2><p class="subtle">Start a new game and the app can pull in your active roster instantly.</p><button class="btn primary full" onclick="LL.openNewGame()">+ New Game</button></section>`}
      <section class="card">
        <div class="section-title"><h2>Quick Actions</h2><button class="btn small ghost" onclick="LL.go('settings')">Settings</button></div>
        <div class="grid2">
          <button class="btn" onclick="LL.openAddPlayer(false)">+ Add Player</button>
          <button class="btn" onclick="LL.openAddPlayer(true)">+ Add Fill-In</button>
          <button class="btn" onclick="LL.exportXlsx()">Export Excel</button>
          <button class="btn" onclick="LL.backup()">Backup Data</button>
        </div>
      </section>
      <section class="card">
        <div class="grid3">
          <div class="metric"><div class="v">${activeCount}</div><div class="k">Active</div></div>
          <div class="metric"><div class="v">${state.roster.filter(p => p.fillIn).length}</div><div class="k">Fill-Ins</div></div>
          <div class="metric"><div class="v">${state.games.filter(gm => gm.status === 'completed').length}</div><div class="k">Games</div></div>
        </div>
      </section>
      <section class="card"><div class="section-title"><h2>Recent Games</h2>${!g ? `<button class="btn small primary" onclick="LL.openNewGame()">New</button>` : ''}</div>
        ${completed.length ? `<div class="list">${completed.map(x => { ensurePostgame(x); const t = totalsForGame(x); const pog = getPlayer(x.playerOfGameId); return `<div class="list-row"><div class="avatar">${t.us > t.them ? 'W' : t.us < t.them ? 'L' : 'T'}</div><div class="grow"><div class="player-name">vs ${esc(x.opponent || 'Opponent')}</div><div class="player-meta">${esc(x.date)} • ${t.us}-${t.them}${pog ? ` • ⭐ ${esc(pog.name)}` : ''}</div></div><button class="btn small" onclick="LL.viewGame('${x.id}')">Recap</button></div>`; }).join('')}</div>` : `<div class="empty">No completed games yet.</div>`}
      </section>`;
  }

  function renderGame() {
    const g = activeGame();
    if (!g) return `<section class="card"><h2>No active game</h2><p class="subtle">Start a game and your active roster will be loaded into the lineup automatically.</p><button class="btn primary full" onclick="LL.openNewGame()">+ New Game</button></section>`;
    const lineup = g.lineup || [];
    const currentId = lineup.length ? lineup[g.battingIndex % lineup.length] : null;
    const current = getPlayer(currentId);
    const last = g.pas[g.pas.length - 1];
    return `
      <section class="card">
        <div class="row between"><div><div class="badge">LIVE</div><h2 style="margin-top:8px">${esc(teamName())} vs ${esc(g.opponent || 'Opponent')}</h2><div class="subtle">${esc(g.date)}</div></div><button class="btn small" onclick="LL.openLineup()">Edit Lineup</button></div>
      </section>
      ${current ? `<section class="current-batter"><div class="row between"><div><div class="slot">Up now • #${(g.battingIndex % lineup.length) + 1}</div><div class="name">${esc(current.name)}</div><div class="subtle">${current.number ? `#${esc(current.number)} • ` : ''}${current.fillIn ? 'Fill-in' : 'Roster player'}</div></div><div><div class="tiny" style="text-align:center;margin-bottom:4px">RBI</div><div class="stepper"><button onclick="LL.rbi(-1)">−</button><span>${pendingRbi}</span><button onclick="LL.rbi(1)">+</button></div></div></div></section>` : `<section class="card"><div class="empty">Your lineup is empty. Add players to begin.</div><button class="btn primary full" onclick="LL.openLineup()">Build Lineup</button></section>`}
      ${current ? `<section class="card"><h3>Plate Appearance</h3><div class="quick-results">${visibleOutcomes().map(o => `<button class="result ${esc(o.kind)}" onclick="LL.recordPA('${o.id}')">${esc(o.label)}</button>`).join('')}</div>${last ? `<div class="row between" style="margin-top:12px"><div class="tiny">Last: ${esc(getPlayer(last.playerId)?.name || 'Player')} — ${esc(resultDef(last.resultId).label)}${last.rbi ? ` • ${last.rbi} RBI` : ''}</div><button class="btn small danger" onclick="LL.undoPA()">Undo</button></div>` : ''}</section>` : ''}
      <section class="card"><div class="section-title"><div><h2>Score</h2><div class="subtle">Inning ${num(g.currentInning) + 1}</div></div><button class="btn small" onclick="LL.addInning()">+ Extra Inning</button></div><div class="grid3" style="margin-bottom:12px"><button class="btn primary" onclick="LL.scorePlus('us')">+1 ${esc(teamName())}</button><button class="btn blue" onclick="LL.scorePlus('them')">+1 Opponent</button><button class="btn" onclick="LL.nextInning()">Next Inning →</button></div>${renderScoreboard(g)}</section>
      <section class="card"><div class="section-title"><h2>Lineup</h2><button class="btn small" onclick="LL.openLineup()">Adjust</button></div>${renderLiveLineup(g)}</section>
      <section class="card"><div class="grid2"><button class="btn" onclick="LL.openAddFillInToGame()">+ Fill-In Now</button><button class="btn danger" onclick="LL.finishGame()">Finish Game</button></div></section>`;
  }

  function renderScoreboard(g) {
    const n = Math.max(g.score.us.length, g.score.them.length);
    const headers = Array.from({ length: n }, (_, i) => `<th class="${i === num(g.currentInning) ? 'inning-active' : ''}">${i + 1}</th>`).join('');
    const row = (team, label) => `<tr><th>${esc(label)}</th>${g.score[team].map((v, i) => `<td class="${i === num(g.currentInning) ? 'inning-active-cell' : ''}"><input inputmode="numeric" pattern="[0-9]*" class="score-input" value="${num(v)}" onchange="LL.score('${team}',${i},this.value)" /></td>`).join('')}<td class="score-total">${g.score[team].reduce((a, b) => a + num(b), 0)}</td></tr>`;
    return `<div class="score-wrap"><table class="score-table"><tr><th></th>${headers}<th>R</th></tr>${row('us', teamName())}${row('them', g.opponent || 'Opponent')}</table></div>`;
  }

  function renderLiveLineup(g) {
    if (!g.lineup.length) return `<div class="empty">No players in lineup.</div>`;
    const cur = g.battingIndex % g.lineup.length;
    return `<div class="list">${g.lineup.map((id, i) => {
      const p = getPlayer(id);
      const ps = playerGameStats(g, id);
      return `<div class="list-row ${i === cur ? 'lineup-current' : ''}"><div class="lineup-slot">${i + 1}</div><div class="grow"><div class="player-name">${esc(p?.name || 'Unknown')} ${p?.fillIn ? '<span class="badge fill">Fill-In</span>' : ''}</div><div class="player-meta">${ps.H}-${ps.AB} • ${ps.RBI} RBI • ${num(g.runsByPlayer?.[id])} R</div></div><button class="btn small blue" onclick="LL.setBatter(${i})">Up</button><button class="btn small" onclick="LL.addRun('${id}')">+ Run</button></div>`;
    }).join('')}</div>`;
  }

  function renderRoster() {
    const players = state.roster.slice().sort((a, b) => (b.active - a.active) || (a.fillIn - b.fillIn) || a.name.localeCompare(b.name));
    return `<section class="card"><div class="section-title"><h2>Roster</h2><div class="row"><button class="btn small" onclick="LL.openAddPlayer(true)">+ Fill-In</button><button class="btn small primary" onclick="LL.openAddPlayer(false)">+ Player</button></div></div><div class="subtle" style="margin-bottom:12px">Players stay in your career stats even if you later make them inactive.</div>${players.length ? `<div class="list">${players.map(p => `<div class="list-row"><div class="avatar">${esc((p.number || p.name || '?').toString().slice(0, 2).toUpperCase())}</div><div class="grow"><div class="player-name">${esc(p.name)} ${p.fillIn ? '<span class="badge fill">Fill-In</span>' : ''} ${!p.active ? '<span class="badge gray">Inactive</span>' : ''}</div><div class="player-meta">${p.number ? `#${esc(p.number)} • ` : ''}${esc(p.positions || 'No positions set')}</div></div><button class="btn small" onclick="LL.openEditPlayer('${p.id}')">Edit</button></div>`).join('')}</div>` : `<div class="empty">No players yet. Add your Nephews roster to get started.</div>`}</section>`;
  }

  function renderStats() {
    let players = state.roster.filter(p => statsFilter === 'all' || (statsFilter === 'regular' && !p.fillIn) || (statsFilter === 'fill' && p.fillIn));
    let rows = players.map(p => ({ p, s: playerStats(p.id) }));
    rows.sort((a, b) => compareStatRows(a, b));
    const team = aggregateTeam(rows.map(x => x.s));
    return `<section class="card"><div class="section-title"><h2>Career Stats</h2><button class="btn small primary" onclick="LL.exportXlsx()">Export .xlsx</button></div><div class="tabs"><button class="tab ${statsFilter === 'all' ? 'active' : ''}" onclick="LL.filterStats('all')">All</button><button class="tab ${statsFilter === 'regular' ? 'active' : ''}" onclick="LL.filterStats('regular')">Roster</button><button class="tab ${statsFilter === 'fill' ? 'active' : ''}" onclick="LL.filterStats('fill')">Fill-Ins</button></div><div class="subtle" style="margin-top:10px">Tap any column header to sort the stats table.</div></section>
      <section class="card"><div class="grid3"><div class="metric"><div class="v">${state.games.filter(g => g.status === 'completed').length}</div><div class="k">Games</div></div><div class="metric"><div class="v">${pct(team.AVG)}</div><div class="k">Team AVG</div></div><div class="metric"><div class="v">${team.HR}</div><div class="k">Home Runs</div></div></div></section>
      <section class="card"><div class="table-wrap"><table class="stats-table"><thead><tr>${sortableTh('Player', 'player', true)}${sortableTh('G', 'G')}${sortableTh('PA', 'PA')}${sortableTh('AB', 'AB')}${sortableTh('H', 'H')}${sortableTh('1B', 'B1')}${sortableTh('2B', 'B2')}${sortableTh('3B', 'B3')}${sortableTh('HR', 'HR')}${sortableTh('BB', 'BB')}${sortableTh('R', 'R')}${sortableTh('RBI', 'RBI')}${sortableTh('AVG', 'AVG')}${sortableTh('OBP', 'OBP')}${sortableTh('SLG', 'SLG')}${sortableTh('OPS', 'OPS')}</tr></thead><tbody>${rows.map(({ p, s }) => `<tr><td>${esc(p.name)}${p.fillIn ? ' *' : ''}</td><td>${s.G}</td><td>${s.PA}</td><td>${s.AB}</td><td>${s.H}</td><td>${s.B1}</td><td>${s.B2}</td><td>${s.B3}</td><td>${s.HR}</td><td>${s.BB}</td><td>${s.R}</td><td>${s.RBI}</td><td>${pct(s.AVG)}</td><td>${pct(s.OBP)}</td><td>${pct(s.SLG)}</td><td>${pct(s.OPS)}</td></tr>`).join('') || `<tr><td colspan="16" class="empty">No players match this filter.</td></tr>`}</tbody></table></div><div class="tiny" style="margin-top:10px">* Fill-in player</div></section>`;
  }

  function sortableTh(label, key, sticky = false) {
    return `<th class="sortable ${sticky ? 'sticky-first' : ''}" onclick="LL.sortStats('${key}')"><span>${label}</span><span class="sort-indicator">${statsSortKey === key ? (statsSortDir === 'asc' ? '▲' : '▼') : '↕'}</span></th>`;
  }

  function compareStatRows(a, b) {
    const dir = statsSortDir === 'asc' ? 1 : -1;
    let av, bv;
    if (statsSortKey === 'player') {
      av = a.p.name.toLowerCase();
      bv = b.p.name.toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    }
    av = a.s[statsSortKey];
    bv = b.s[statsSortKey];
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.p.name.localeCompare(b.p.name);
  }

  function renderSettings() {
    return `<section class="card"><h2>Customization</h2><div class="grid2"><div><label class="field-label">Team name</label><input class="field" value="${esc(teamName())}" onchange="LL.setting('teamName',this.value)" /></div><div><label class="field-label">Default innings</label><input class="field" type="number" min="1" max="20" value="${num(state.settings.innings)}" onchange="LL.setting('innings',this.value)" /></div></div><div class="tiny" style="margin-top:10px">This version uses a light blue Nephews theme by default.</div></section>
      <section class="card"><div class="section-title"><h2>Result Buttons</h2><button class="btn small" onclick="LL.addCustomOutcome()">+ Custom</button></div><div class="subtle" style="margin-bottom:12px">Turn buttons on/off and reorder them to match how you score games.</div><div class="list">${state.settings.outcomes.map((o, i) => `<div class="list-row"><div class="grow"><div class="player-name">${esc(o.label)}</div><div class="player-meta">${describeOutcome(o)}</div></div><button class="btn small ${o.visible ? 'blue' : ''}" onclick="LL.toggleOutcome('${o.id}')">${o.visible ? 'Shown' : 'Hidden'}</button><div class="drag-controls"><button class="btn small" onclick="LL.moveOutcome(${i},-1)">↑</button><button class="btn small" onclick="LL.moveOutcome(${i},1)">↓</button></div>${o.custom ? `<button class="btn small danger" onclick="LL.deleteOutcome('${o.id}')">Delete</button>` : ''}</div>`).join('')}</div></section>
      <section class="card"><h2>Data</h2><div class="grid2"><button class="btn" onclick="LL.exportXlsx()">Export Excel</button><button class="btn" onclick="LL.backup()">Backup JSON</button><label class="btn" style="text-align:center">Import Backup<input type="file" accept="application/json,.json" style="display:none" onchange="LL.importBackup(this.files[0])"></label><button class="btn danger" onclick="LL.resetAll()">Erase All Data</button></div><p class="tiny">Data lives on this device in your browser. Use Backup JSON regularly if you care about the stats.</p></section>`;
  }

  function describeOutcome(o) {
    if (o.h) return `Hit • ${o.b1 ? 'single' : o.b2 ? 'double' : o.b3 ? 'triple' : 'home run'}`;
    if (o.bb) return 'Walk • no at-bat';
    if (o.sf) return 'Sacrifice • no at-bat';
    if (o.ab) return 'At-bat • no hit';
    return 'Plate appearance only';
  }

  function renderModal() {
    if (modal.type === 'newGame') {
      return modalShell('New Game', `<div><label class="field-label">Opponent</label><input id="ngOpp" class="field" placeholder="Opponent team" autofocus /></div><div style="margin-top:10px"><label class="field-label">Date</label><input id="ngDate" type="date" class="field" value="${today()}" /></div><div style="margin-top:10px"><label class="field-label">Innings</label><input id="ngInn" type="number" min="1" max="20" class="field" value="${num(state.settings.innings)}" /></div><button class="btn primary full" style="margin-top:14px" onclick="LL.createGame()">Start Game</button>`);
    }

    if (modal.type === 'player') {
      const p = modal.playerId ? getPlayer(modal.playerId) : null;
      return modalShell(p ? 'Edit Player' : (modal.fillIn ? 'Add Fill-In' : 'Add Player'), `<div><label class="field-label">Name</label><input id="pName" class="field" value="${esc(p?.name || '')}" placeholder="Player name" autofocus /></div><div class="grid2" style="margin-top:10px"><div><label class="field-label">Jersey #</label><input id="pNum" class="field" value="${esc(p?.number || '')}" /></div><div><label class="field-label">Positions</label><input id="pPos" class="field" value="${esc(p?.positions || '')}" placeholder="e.g. SS, OF" /></div></div><div class="grid2" style="margin-top:10px"><label class="list-row"><input id="pActive" type="checkbox" ${p ? (p.active ? 'checked' : '') : 'checked'} /><div class="grow"><div class="player-name">Active roster player</div><div class="player-meta">Include this player when building a lineup.</div></div></label><label class="list-row"><input id="pFill" type="checkbox" ${(p ? p.fillIn : modal.fillIn) ? 'checked' : ''} /><div class="grow"><div class="player-name">Fill-In player</div><div class="player-meta">Tracks fill-ins separately in stats.</div></div></label></div><div class="grid2" style="margin-top:14px"><button class="btn primary" onclick="LL.savePlayer('${p?.id || ''}')">${p ? 'Save Changes' : 'Add Player'}</button>${p ? `<button class="btn danger" onclick="LL.deletePlayer('${p.id}')">Delete</button>` : `<button class="btn" onclick="LL.closeModal()">Cancel</button>`}</div>`);
    }

    if (modal.type === 'lineup') {
      const g = activeGame();
      if (!g) return '';
      const availableActive = state.roster.filter(p => p.active && !g.lineup.includes(p.id));
      return modalShell('Adjust Lineup', `
        <div class="section-title"><h3>Current batting order</h3><button class="btn small" onclick="LL.loadActiveRoster()">Load Active Roster</button></div>
        ${g.lineup.length ? `<div class="list">${g.lineup.map((id, i) => `<div class="list-row"><div class="lineup-slot">${i + 1}</div><select class="field lineup-select" onchange="LL.setLineupSlot(${i},this.value)">${state.roster.filter(p => p.active || p.id === id).map(p => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.name)}${p.fillIn ? ' (Fill-In)' : ''}</option>`).join('')}</select><div class="drag-controls"><button class="btn small" onclick="LL.moveLineup(${i},-1)">↑</button><button class="btn small" onclick="LL.moveLineup(${i},1)">↓</button></div><button class="btn small danger" onclick="LL.removeLineup(${i})">×</button></div>`).join('')}</div>` : `<div class="empty">No lineup yet.</div>`}
        <hr/>
        <div class="section-title"><h3>Add from active roster</h3><div class="tiny">Tap to add directly</div></div>
        ${availableActive.length ? `<div class="list">${availableActive.map(p => `<div class="list-row"><div class="avatar">${esc((p.number || p.name || '?').toString().slice(0, 2).toUpperCase())}</div><div class="grow"><div class="player-name">${esc(p.name)} ${p.fillIn ? '<span class="badge fill">Fill-In</span>' : ''}</div><div class="player-meta">${p.number ? `#${esc(p.number)} • ` : ''}${esc(p.positions || 'No positions set')}</div></div><button class="btn small primary" onclick="LL.addPlayerToLineup('${p.id}')">Add</button></div>`).join('')}</div>` : `<div class="empty">All active players are already in the lineup.</div>`}
        <div class="grid2" style="margin-top:12px"><button class="btn" onclick="LL.addLineupSlot()">+ Quick Add Next</button><button class="btn" onclick="LL.openAddFillInToGame()">+ Fill-In</button></div>
        <button class="btn primary full" style="margin-top:10px" onclick="LL.closeModal()">Done</button>`);
    }

    if (modal.type === 'customOutcome') {
      return modalShell('Custom Result', `<div><label class="field-label">Button label</label><input id="coLabel" class="field" placeholder="e.g. FC, HBP" autofocus /></div><div style="margin-top:10px"><label class="field-label">How should it count?</label><select id="coClass" class="field"><option value="about">At-bat, no hit</option><option value="walk">No at-bat, reaches base</option><option value="pa">Plate appearance only</option><option value="single">Hit / single</option></select></div><button class="btn primary full" style="margin-top:14px" onclick="LL.saveCustomOutcome()">Add Custom Result</button>`);
    }

    if (modal.type === 'pastGame') {
      const g = state.games.find(x => x.id === modal.gameId);
      if (!g) return '';
      ensurePostgame(g);
      const t = totalsForGame(g);
      const pog = getPlayer(g.playerOfGameId);
      const performers = gamePerformers(g);
      return modalShell(`vs ${esc(g.opponent || 'Opponent')}`, `<div class="grid3"><div class="metric"><div class="v">${t.us}</div><div class="k">${esc(teamName())}</div></div><div class="metric"><div class="v">${t.them}</div><div class="k">Opponent</div></div><div class="metric"><div class="v">${g.pas.length}</div><div class="k">PA logged</div></div></div>
        <section class="postgame-card"><div class="postgame-label">⭐ PLAYER OF THE GAME</div><div class="postgame-player">${esc(pog?.name || 'No player selected')}</div><div class="player-meta">Automatically selected from the game stats. You can change it below.</div><select class="field" style="margin-top:10px" onchange="LL.setPlayerOfGame('${g.id}',this.value)">${performers.map(x => `<option value="${x.p.id}" ${x.p.id === g.playerOfGameId ? 'selected' : ''}>${esc(playerLineText(x.p, x.s))}</option>`).join('')}</select></section>
        <section class="recap-card"><div class="section-title"><div><div class="postgame-label">GAME RECAP</div><h3 style="margin-top:5px">Nephews Postgame Writeup</h3></div><button class="btn small blue" onclick="LL.regenerateSummary('${g.id}')">Regenerate</button></div><p class="recap-text">${esc(g.gameSummary)}</p><button class="btn small" onclick="LL.copySummary('${g.id}')">Copy Recap</button></section>
        <div style="margin-top:14px">${renderScoreboardReadOnly(g)}</div><button class="btn danger full" style="margin-top:14px" onclick="LL.deleteGame('${g.id}')">Delete Game</button>`);
    }

    return '';
  }

  function modalShell(title, body) {
    return `<div class="modal-backdrop" onclick="if(event.target===this)LL.closeModal()"><div class="modal"><div class="row between"><h2 style="margin:0">${title}</h2><button class="btn small" onclick="LL.closeModal()">Close</button></div><hr/>${body}</div></div>`;
  }

  function renderScoreboardReadOnly(g) {
    const n = Math.max(g.score.us.length, g.score.them.length);
    const heads = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('');
    const r = (team, label) => `<tr><th>${esc(label)}</th>${g.score[team].map(v => `<td>${num(v)}</td>`).join('')}<td class="score-total">${g.score[team].reduce((a, b) => a + num(b), 0)}</td></tr>`;
    return `<div class="score-wrap"><table class="score-table"><tr><th></th>${heads}<th>R</th></tr>${r('us', teamName())}${r('them', g.opponent || 'Opponent')}</table></div>`;
  }

  function createGame() {
    const opponent = document.getElementById('ngOpp').value.trim();
    const date = document.getElementById('ngDate').value || today();
    const innings = Math.max(1, num(document.getElementById('ngInn').value) || 7);
    if (activeGame()) { toast('Finish the active game first'); return; }
    const lineup = state.roster.filter(p => p.active && !p.fillIn).map(p => p.id);
    const g = { id: uid(), date, opponent, status: 'active', lineup, battingIndex: 0, currentInning: 0, pas: [], runsByPlayer: {}, score: { us: Array(innings).fill(0), them: Array(innings).fill(0) }, createdAt: new Date().toISOString() };
    state.games.push(g);
    save(); modal = null; pendingRbi = 0; view = 'game'; render();
  }

  function savePlayer(id) {
    const name = document.getElementById('pName').value.trim();
    if (!name) { toast('Player name is required'); return; }
    const payload = { name, number: document.getElementById('pNum').value.trim(), positions: document.getElementById('pPos').value.trim(), active: document.getElementById('pActive').checked, fillIn: document.getElementById('pFill').checked };
    if (id) Object.assign(getPlayer(id), payload);
    else state.roster.push({ id: uid(), ...payload });
    save(); modal = null; render(); toast(id ? 'Player updated' : 'Player added');
  }

  function deletePlayer(id) {
    const used = state.games.some(g => g.pas.some(pa => pa.playerId === id));
    if (used) { toast('Player has stats — mark inactive instead'); return; }
    if (!confirm('Delete this player?')) return;
    state.roster = state.roster.filter(p => p.id !== id);
    state.games.forEach(g => g.lineup = g.lineup.filter(x => x !== id));
    save(); modal = null; render();
  }

  function recordPA(resultId) {
    const g = activeGame();
    if (!g || !g.lineup.length) return;
    const playerId = g.lineup[g.battingIndex % g.lineup.length];
    g.pas.push({ id: uid(), playerId, resultId, rbi: pendingRbi, inning: num(g.currentInning) + 1, ts: new Date().toISOString() });
    g.battingIndex = (g.battingIndex + 1) % g.lineup.length;
    pendingRbi = 0;
    save(); render();
  }

  function undoPA() {
    const g = activeGame();
    if (!g || !g.pas.length) return;
    g.pas.pop();
    if (g.lineup.length) g.battingIndex = (g.battingIndex - 1 + g.lineup.length) % g.lineup.length;
    save(); render(); toast('Last PA removed');
  }

  function addRun(id) {
    const g = activeGame(); if (!g) return;
    g.runsByPlayer[id] = num(g.runsByPlayer[id]) + 1;
    save(); render();
  }

  function score(team, i, v) {
    const g = activeGame(); if (!g) return;
    g.score[team][i] = Math.max(0, num(v));
    save(); render();
  }

  function scorePlus(team) {
    const g = activeGame(); if (!g) return;
    const inning = num(g.currentInning);
    while (g.score[team].length <= inning) { g.score.us.push(0); g.score.them.push(0); }
    g.score[team][inning] = num(g.score[team][inning]) + 1;
    save(); render();
  }

  function nextInning() {
    const g = activeGame(); if (!g) return;
    g.currentInning = num(g.currentInning) + 1;
    if (g.currentInning >= g.score.us.length) { g.score.us.push(0); g.score.them.push(0); }
    save(); render();
  }

  function addInning() {
    const g = activeGame(); if (!g) return;
    g.score.us.push(0); g.score.them.push(0);
    save(); render();
  }

  function finishGame() {
    const g = activeGame(); if (!g) return;
    if (!confirm('Finish this game and generate the postgame recap?')) return;
    g.status = 'completed'; g.completedAt = new Date().toISOString();
    g.playerOfGameId = choosePlayerOfGame(g);
    g.gameSummary = generateGameSummary(g);
    save(); pendingRbi = 0; view = 'home'; modal = { type: 'pastGame', gameId: g.id }; render();
  }

  function setPlayerOfGame(gameId, playerId) {
    const g = state.games.find(x => x.id === gameId); if (!g) return;
    g.playerOfGameId = playerId || choosePlayerOfGame(g);
    g.gameSummary = generateGameSummary(g);
    save(); render(); toast('Player of the Game updated');
  }

  function regenerateSummary(gameId) {
    const g = state.games.find(x => x.id === gameId); if (!g) return;
    if (!g.playerOfGameId) g.playerOfGameId = choosePlayerOfGame(g);
    g.gameSummary = generateGameSummary(g);
    save(); render(); toast('Game recap regenerated');
  }

  async function copySummary(gameId) {
    const g = state.games.find(x => x.id === gameId); if (!g) return;
    ensurePostgame(g);
    const t = totalsForGame(g);
    const pog = getPlayer(g.playerOfGameId);
    const text = `${teamName()} ${t.us}, ${g.opponent || 'Opponent'} ${t.them}\nPlayer of the Game: ${pog?.name || 'N/A'}\n\n${g.gameSummary}`;
    try { await navigator.clipboard.writeText(text); toast('Recap copied'); }
    catch (e) { prompt('Copy recap:', text); }
  }

  function setLineupSlot(i, newId) {
    const g = activeGame(); if (!g) return;
    const old = g.lineup[i];
    const j = g.lineup.indexOf(newId);
    if (j >= 0 && j !== i) g.lineup[j] = old;
    g.lineup[i] = newId;
    save(); render();
  }

  function moveLineup(i, d) {
    const g = activeGame(); if (!g) return;
    const j = i + d; if (j < 0 || j >= g.lineup.length) return;
    [g.lineup[i], g.lineup[j]] = [g.lineup[j], g.lineup[i]];
    if (g.battingIndex === i) g.battingIndex = j;
    else if (g.battingIndex === j) g.battingIndex = i;
    save(); render();
  }

  function removeLineup(i) {
    const g = activeGame(); if (!g) return;
    g.lineup.splice(i, 1);
    if (g.lineup.length) g.battingIndex %= g.lineup.length;
    else g.battingIndex = 0;
    save(); render();
  }

  function addLineupSlot() {
    const g = activeGame(); if (!g) return;
    const unused = state.roster.find(p => p.active && !g.lineup.includes(p.id));
    if (!unused) { toast('No unused active players'); return; }
    g.lineup.push(unused.id); save(); render();
  }

  function addPlayerToLineup(playerId) {
    const g = activeGame(); if (!g) return;
    if (g.lineup.includes(playerId)) { toast('Already in lineup'); return; }
    g.lineup.push(playerId); save(); render();
  }

  function loadActiveRoster() {
    const g = activeGame(); if (!g) return;
    g.lineup = state.roster.filter(p => p.active).map(p => p.id);
    g.battingIndex = 0;
    save(); render();
    toast('Active roster loaded');
  }

  function openAddFillInToGame() {
    const name = prompt('Fill-in player name');
    if (!name?.trim()) return;
    const p = { id: uid(), name: name.trim(), number: '', positions: '', active: true, fillIn: true };
    state.roster.push(p);
    const g = activeGame();
    if (g && !g.lineup.includes(p.id)) g.lineup.push(p.id);
    save(); modal = g ? { type: 'lineup' } : null; render(); toast('Fill-in added');
  }

  function exportXlsx() {
    const career = [['Player', 'Jersey', 'Fill-In', 'Active', 'G', 'PA', 'AB', 'H', '1B', '2B', '3B', 'HR', 'BB', 'R', 'RBI', 'AVG', 'OBP', 'SLG', 'OPS']];
    state.roster.forEach(p => { const s = playerStats(p.id); career.push([p.name, p.number, p.fillIn ? 'Yes' : 'No', p.active ? 'Yes' : 'No', s.G, s.PA, s.AB, s.H, s.B1, s.B2, s.B3, s.HR, s.BB, s.R, s.RBI, s.AVG, s.OBP, s.SLG, s.OPS]); });
    const roster = [['Player ID', 'Name', 'Jersey', 'Positions', 'Fill-In', 'Active'], ...state.roster.map(p => [p.id, p.name, p.number, p.positions, p.fillIn ? 'Yes' : 'No', p.active ? 'Yes' : 'No'])];
    const games = [['Game ID', 'Date', 'Opponent', 'Status', teamName(), 'Opponent Runs', 'Result', 'Plate Appearances', 'Player of the Game', 'Game Recap']];
    state.games.forEach(g => { if (g.status === 'completed') ensurePostgame(g); const t = totalsForGame(g); games.push([g.id, g.date, g.opponent, g.status, t.us, t.them, t.us > t.them ? 'W' : t.us < t.them ? 'L' : 'T', g.pas.length, getPlayer(g.playerOfGameId)?.name || '', g.gameSummary || '']); });
    const pas = [['Game ID', 'Date', 'Opponent', 'Player', 'Result', 'RBI', 'Inning', 'Timestamp']];
    state.games.forEach(g => g.pas.forEach(pa => pas.push([g.id, g.date, g.opponent, getPlayer(pa.playerId)?.name || 'Unknown', resultDef(pa.resultId).label, num(pa.rbi), num(pa.inning), pa.ts])));
    const sheets = [['Career Stats', career], ['Roster', roster], ['Games', games], ['Plate Appearances', pas]];
    const blob = makeXlsx(sheets);
    download(blob, `softball-stats-${today()}.xlsx`);
    toast('Excel workbook exported');
  }

  function xmlEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
  function colName(n) { let s = ''; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
  function sheetXml(rows) {
    const body = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => { const ref = `${colName(ci + 1)}${ri + 1}`; if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`; return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`; }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }
  function makeXlsx(sheets) {
    const files = {};
    files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s[0].slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
    files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
    sheets.forEach((s, i) => files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s[1]));
    return zipStore(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  const te = new TextEncoder();
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  function zipStore(files, mime) {
    const locals = [], centrals = []; let offset = 0;
    Object.entries(files).forEach(([name, content]) => {
      const nb = te.encode(name), data = te.encode(content), crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...nb, ...data]);
      locals.push(local);
      const central = new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nb]);
      centrals.push(central); offset += local.length;
    });
    const csize = centrals.reduce((a, b) => a + b.length, 0), count = centrals.length;
    const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(csize), ...u32(offset), ...u16(0)]);
    return new Blob([...locals, ...centrals, end], { type: mime });
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

  function backup() { download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `softball-backup-${today()}.json`); toast('Backup downloaded'); }
  function importBackup(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const x = normalizeState(JSON.parse(r.result));
        if (!x.roster || !x.games || !x.settings) throw new Error();
        state = x; save(); render(); toast('Backup imported');
      } catch (e) { alert('That backup file could not be read.'); }
    };
    r.readAsText(file);
  }

  function resetAll() {
    if (!confirm('Erase ALL roster, games, and stats from this device?')) return;
    if (!confirm('This cannot be undone unless you made a backup. Continue?')) return;
    state = freshState(); save(); view = 'home'; render();
  }

  window.LL = {
    go(v) { view = v === 'game' && !activeGame() ? 'game' : v; modal = null; render(); },
    openNewGame() { modal = { type: 'newGame' }; render(); }, createGame,
    openAddPlayer(fillIn) { modal = { type: 'player', fillIn }; render(); }, openEditPlayer(id) { modal = { type: 'player', playerId: id }; render(); }, savePlayer, deletePlayer,
    openLineup() { if (activeGame()) { modal = { type: 'lineup' }; render(); } }, closeModal() { modal = null; render(); },
    rbi(d) { pendingRbi = Math.max(0, pendingRbi + d); render(); }, recordPA, undoPA, addRun, score, scorePlus, nextInning, addInning, finishGame,
    setLineupSlot, moveLineup, removeLineup, addLineupSlot, addPlayerToLineup, loadActiveRoster, openAddFillInToGame,
    setBatter(i) { const g = activeGame(); if (!g || !g.lineup.length) return; g.battingIndex = Math.max(0, Math.min(i, g.lineup.length - 1)); save(); render(); },
    filterStats(f) { statsFilter = f; render(); },
    sortStats(key) { if (statsSortKey === key) statsSortDir = statsSortDir === 'asc' ? 'desc' : 'asc'; else { statsSortKey = key; statsSortDir = key === 'player' ? 'asc' : 'desc'; } render(); },
    setting(k, v) { state.settings[k] = k === 'innings' ? Math.max(1, num(v)) : (String(v).trim() || (k === 'teamName' ? 'Nephews' : v)); save(); render(); },
    toggleOutcome(id) { const o = resultDef(id); o.visible = !o.visible; save(); render(); },
    moveOutcome(i, d) { const j = i + d; if (j < 0 || j >= state.settings.outcomes.length) return; [state.settings.outcomes[i], state.settings.outcomes[j]] = [state.settings.outcomes[j], state.settings.outcomes[i]]; save(); render(); },
    addCustomOutcome() { modal = { type: 'customOutcome' }; render(); },
    saveCustomOutcome() {
      const label = document.getElementById('coLabel').value.trim();
      const cls = document.getElementById('coClass').value;
      if (!label) return toast('Label required');
      const base = { id: uid(), label, ab: 0, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 0, sf: 0, visible: true, kind: 'out', custom: true };
      if (cls === 'about') base.ab = 1;
      if (cls === 'walk') { base.bb = 1; base.kind = 'walk'; }
      if (cls === 'single') { base.ab = 1; base.h = 1; base.b1 = 1; base.kind = 'hit'; }
      state.settings.outcomes.push(base); save(); modal = null; render();
    },
    deleteOutcome(id) { state.settings.outcomes = state.settings.outcomes.filter(o => o.id !== id); save(); render(); },
    exportXlsx, backup, importBackup, resetAll, setPlayerOfGame, regenerateSummary, copySummary,
    viewGame(id) { const g = state.games.find(x => x.id === id); if (g) { ensurePostgame(g); save(); } modal = { type: 'pastGame', gameId: id }; render(); },
    deleteGame(id) { if (!confirm('Delete this game and all stats recorded in it?')) return; state.games = state.games.filter(g => g.id !== id); save(); modal = null; render(); }
  };

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  render();
})();
