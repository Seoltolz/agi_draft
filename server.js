// Agricola Draft-only Mini Game — server (v0.2)
// Node.js + Express + Socket.IO
// Adds: image/ability card metadata, admin edit endpoints, bulk import,
//       end-of-draft voting, tier scoring, pick-frequency stats.

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DECKS_DIR = path.join(DATA_DIR, 'decks');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const PLAYER_STATS_FILE = path.join(DATA_DIR, 'players.json');

for (const dir of [DATA_DIR, DECKS_DIR, HISTORY_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------- Deck loading ----------
function loadDecks() {
  const decks = {};
  const files = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, f), 'utf8'));
      // Normalize card shape (with extended fields)
      for (const kind of ['occupations','minorImprovements']){
        d[kind] = (d[kind]||[]).map(c => ({
          code: String(c.code),
          name: String(c.name||''),
          nameEn: String(c.nameEn||''),
          ability: String(c.ability||''),
          abilityEn: String(c.abilityEn||''),
          cost: String(c.cost||''),
          cost2: String(c.cost2||''),
          vp: String(c.vp||''),
          condition: String(c.condition||''),
          passing: String(c.passing||''),
          category: String(c.category||''),
          imageUrl: String(c.imageUrl||''),
        }));
      }
      decks[d.id] = d;
    } catch (e) { console.error('deck load fail', f, e.message); }
  }
  return decks;
}
let DECKS = loadDecks();
function reloadDecks() { DECKS = loadDecks(); }
function saveDeck(deck){
  fs.writeFileSync(path.join(DECKS_DIR, `${deck.id}.json`), JSON.stringify(deck, null, 2));
  reloadDecks();
}

// ---------- Stats (card tier / freq) ----------
function loadStats(){
  try { return JSON.parse(fs.readFileSync(STATS_FILE,'utf8')); }
  catch { return { cards: {} }; } // cards: { code: { name, deckId, kind, picked, seen, votes, score } }
}
function saveStats(s){ fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2)); }
let STATS = loadStats();

// ---------- Player stats (누적 티어 랭킹) ----------
function loadPlayerStats(){
  try { return JSON.parse(fs.readFileSync(PLAYER_STATS_FILE,'utf8')); }
  catch { return { players: {} }; }
  // players: { normalizedName: { name, drafts, ratingSum, ratingCount, mvpCount, dudCount, wins } }
}
function savePlayerStats(s){ fs.writeFileSync(PLAYER_STATS_FILE, JSON.stringify(s, null, 2)); }
let PLAYER_STATS = loadPlayerStats();
function normName(s){ return String(s||'').trim().toLowerCase(); }

// ---------- Utils ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Rooms ----------
const rooms = new Map();

function publicRoom(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    deckIds: room.deckIds,
    decks: room.deckIds.map(id => DECKS[id] ? { id, name: DECKS[id].name } : { id, name: id }),
    cardsPerHand: room.cardsPerHand,
    turnLimitSec: room.turnLimitSec || 0,
    turnDeadline: room.turnDeadline || null,
    players: room.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready, pickedCount: p.picked.length })),
    status: room.status,
    phase: room.phase,
    round: room.round,
    logCount: room.log.length,
  };
}

function playerView(room, playerId) {
  const me = room.players.find(p => p.id === playerId);
  const draftDone = room.status === 'finished';
  // Voting progress info (visible to all)
  let votingProgress = null;
  if (room.voting){
    const totalTargets = room.players.length - 1;
    const submitted = [];
    for (const p of room.players){
      const v = (room.votes||{})[p.id] || {};
      const scoreCount = Object.keys(v.playerScores||{}).length;
      submitted.push({
        id: p.id, name: p.name,
        submitted: scoreCount >= totalTargets && totalTargets > 0,
        scoreCount, targetsNeeded: totalTargets,
        mvpCount: (v.mvpCards||[]).length,
        dudCount: (v.dudCards||[]).length,
      });
    }
    votingProgress = { players: submitted, totalTargets };
  }
  return {
    room: publicRoom(room),
    me: me ? {
      id: me.id, name: me.name,
      hand: room.hands[me.id] || [],
      picked: me.picked,
      hasPickedThisRound: !!me.pickedThisRound,
      lastPickCode: me.lastPickCode || null,
      myVotes: room.votes ? (room.votes[me.id] || {}) : null,
      initialHands: draftDone ? (room.initialHands?.[me.id] || null) : null,
    } : null,
    others: room.players.map(p => p.id === playerId ? null : ({
      id: p.id, name: p.name,
      handSize: (room.hands[p.id] || []).length,
      picked: draftDone ? p.picked : [],
      pickedCount: p.picked.length,
      hasPickedThisRound: !!p.pickedThisRound,
      initialHands: draftDone ? (room.initialHands?.[p.id] || null) : null,
    })).filter(Boolean),
    log: draftDone ? room.log : [],
    voting: room.voting || null,
    votingProgress,
  };
}

function emitRoom(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', playerView(room, p.id));
  }
}

// ---------- Draft logic ----------
function buildPool(room, kind) {
  const all = [];
  for (const deckId of room.deckIds) {
    const d = DECKS[deckId]; if (!d) continue;
    for (const c of (d[kind] || [])) all.push({ ...c, deckId });
  }
  return shuffle(all);
}

function dealPhase(room, phase) {
  const kind = phase === 'occupations' ? 'occupations' : 'minorImprovements';
  const pool = buildPool(room, kind);
  const need = room.cardsPerHand * room.players.length;
  if (pool.length < need) {
    return { error: `${kind} 카드 부족: 필요 ${need}, 풀 ${pool.length}. 덱 선택을 늘리거나 한손 카드 수를 줄이세요.` };
  }
  room.hands = {};
  // Preserve initial hands per phase so we can show them after draft
  room.initialHands = room.initialHands || {};
  let idx = 0;
  for (const p of room.players) {
    const dealt = pool.slice(idx, idx + room.cardsPerHand);
    room.hands[p.id] = dealt.slice();
    room.initialHands[p.id] = room.initialHands[p.id] || {};
    room.initialHands[p.id][phase] = dealt.slice();
    idx += room.cardsPerHand;
    p.pickedThisRound = false;
  }
  // Record "seen" for stats
  for (const p of room.players) {
    for (const c of room.hands[p.id]) {
      const rec = STATS.cards[c.code] || { name:c.name, deckId:c.deckId, kind, picked:0, seen:0, votes:0, score:0 };
      rec.name = c.name; rec.deckId = c.deckId; rec.kind = kind;
      rec.seen = (rec.seen||0) + 1;
      STATS.cards[c.code] = rec;
    }
  }
  saveStats(STATS);
  room.phase = phase;
  room.round = 1;
  startTurnTimer(room);
  return { ok: true };
}

function startTurnTimer(room){
  clearTurnTimer(room);
  if (!room.turnLimitSec || room.turnLimitSec <= 0) { room.turnDeadline = null; return; }
  room.turnDeadline = Date.now() + room.turnLimitSec * 1000;
  room.turnTimer = setTimeout(()=>autoPickForPending(room), room.turnLimitSec * 1000 + 50);
}
function clearTurnTimer(room){
  if (room.turnTimer){ clearTimeout(room.turnTimer); room.turnTimer = null; }
  room.turnDeadline = null;
}

function autoPickForPending(room){
  if (!room || room.status !== 'drafting') return;
  let anyAuto = false;
  for (const p of room.players){
    if (p.pickedThisRound) continue;
    const hand = room.hands[p.id] || [];
    if (hand.length === 0) continue;
    // Auto-pick a random card
    const idx = Math.floor(Math.random() * hand.length);
    const [card] = hand.splice(idx, 1);
    p.picked.push({ ...card, phase: room.phase, round: room.round, auto: true });
    p.pickedThisRound = true;
    room.log.push({ phase:room.phase, round:room.round, playerId:p.id, playerName:p.name, card, auto:true, ts:Date.now() });
    anyAuto = true;
  }
  if (anyAuto){
    const anyLeft = room.players.some(pp => (room.hands[pp.id]||[]).length > 0);
    if (anyLeft) passHands(room);
    else { room.round += 1; endPhaseOrDraft(room); }
    if (room.status === 'drafting') startTurnTimer(room);
    emitRoom(room);
  }
}

function allPickedThisRound(room) {
  return room.players.every(p => p.pickedThisRound);
}

function passHands(room) {
  const n = room.players.length;
  // Consistent direction within a phase (real draft: pass one way per pack).
  // Occupations pack: pass to the LEFT (dir=+1). Minors pack: pass to the RIGHT (dir=-1).
  const dir = (room.phase === 'occupations') ? 1 : -1;
  const newHands = {};
  for (let i = 0; i < n; i++) {
    const from = room.players[i];
    const toIdx = ((i + dir) % n + n) % n;
    const to = room.players[toIdx];
    newHands[to.id] = room.hands[from.id];
  }
  room.hands = newHands;
  for (const p of room.players) p.pickedThisRound = false;
  room.round += 1;
}

function endPhaseOrDraft(room) {
  if (room.round > room.cardsPerHand) {
    if (room.phase === 'occupations') {
      const r = dealPhase(room, 'minors');
      if (r.error) { room.status='finished'; openVoting(room); finalizeHistory(room, r.error); return; }
      return;
    } else {
      room.status = 'finished';
      openVoting(room);
      finalizeHistory(room);
    }
  }
}

function openVoting(room){
  // Peer voting: each player rates every OTHER player's build 1..5 stars.
  // Also each player can up-vote / down-vote individual CARDS as MVP / DUD.
  room.voting = { open: true, closed: false };
  room.votes = {}; // { voterId: { playerScores:{targetId:1..5}, mvpCards:[code], dudCards:[code] } }
  for (const p of room.players) room.votes[p.id] = { playerScores:{}, mvpCards:[], dudCards:[] };
}

function tallyVotes(room){
  const totals = {};
  const counts = {};
  for (const voter of Object.values(room.votes||{})){
    for (const [target, score] of Object.entries(voter.playerScores||{})){
      totals[target] = (totals[target]||0) + Number(score);
      counts[target] = (counts[target]||0) + 1;
    }
  }
  const perPlayer = {};
  for (const p of room.players){
    perPlayer[p.id] = {
      total: totals[p.id]||0,
      count: counts[p.id]||0,
      avg: counts[p.id] ? +(totals[p.id]/counts[p.id]).toFixed(2) : 0,
    };
  }
  return perPlayer;
}

function applyVotesToStats(room){
  // Aggregate MVP/dud into STATS.cards
  const mvpTally = {}, dudTally = {};
  for (const voter of Object.values(room.votes||{})){
    for (const code of voter.mvpCards||[]) mvpTally[code] = (mvpTally[code]||0)+1;
    for (const code of voter.dudCards||[]) dudTally[code] = (dudTally[code]||0)-1;
  }
  const per = tallyVotes(room);
  // Map each picked card to its picker's avg rating (peer-rated build quality).
  // Card tier score is a weighted mix: base picks + (avg rating - 3) contributions + MVP/dud deltas.
  for (const p of room.players){
    const buildAvg = per[p.id]?.avg || 0;
    const rating = buildAvg > 0 ? (buildAvg - 3) : 0; // 3 = neutral
    for (const c of p.picked){
      const rec = STATS.cards[c.code];
      if (!rec) continue;
      rec.score = (rec.score||0) + rating * 0.5;
    }
  }
  for (const [code, v] of Object.entries(mvpTally)){
    const rec = STATS.cards[code]; if (rec) { rec.score = (rec.score||0) + v; rec.votes = (rec.votes||0) + v; }
  }
  for (const [code, v] of Object.entries(dudTally)){
    const rec = STATS.cards[code]; if (rec) { rec.score = (rec.score||0) + v; rec.votes = (rec.votes||0) + v; }
  }
  saveStats(STATS);
}

function finalizeHistory(room, note) {
  const rec = {
    id: room.id,
    finishedAt: new Date().toISOString(),
    deckIds: room.deckIds,
    deckNames: room.deckIds.map(id => DECKS[id]?.name || id),
    players: room.players.map(p => ({ id: p.id, name: p.name, picks: p.picked })),
    log: room.log,
    votes: room.votes || null,
    voteTally: room.voting ? tallyVotes(room) : null,
    note: note || null,
  };
  try {
    const file = path.join(HISTORY_DIR, `${room.id}-${Date.now()}.json`);
    room.historyFile = path.basename(file);
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  } catch (e) { console.error('save history', e.message); }
}

function finalizeVoting(room){
  if (!room.voting || room.voting.closed) return;
  room.voting.closed = true;
  applyVotesToStats(room);
  // Update pick counts on stats
  for (const p of room.players){
    for (const c of p.picked){
      const rec = STATS.cards[c.code];
      if (rec) { rec.picked = (rec.picked||0) + 1; rec.name = c.name; rec.deckId = c.deckId; }
    }
  }
  saveStats(STATS);

  // ---- Player tier accumulation ----
  const tally = tallyVotes(room);
  // MVP/dud count per PICKER (which player's cards got flagged)
  const pickerMvp = {}, pickerDud = {};
  for (const p of room.players){ pickerMvp[p.id]=0; pickerDud[p.id]=0; }
  for (const voter of Object.values(room.votes||{})){
    for (const code of voter.mvpCards||[]){
      const owner = room.players.find(p => p.picked.some(c=>c.code===code));
      if (owner) pickerMvp[owner.id] = (pickerMvp[owner.id]||0)+1;
    }
    for (const code of voter.dudCards||[]){
      const owner = room.players.find(p => p.picked.some(c=>c.code===code));
      if (owner) pickerDud[owner.id] = (pickerDud[owner.id]||0)+1;
    }
  }
  // Determine winner(s): highest avg rating
  const maxAvg = Math.max(0, ...room.players.map(p=>tally[p.id]?.avg||0));
  for (const p of room.players){
    const key = normName(p.name);
    if (!key) continue;
    const rec = PLAYER_STATS.players[key] || {
      name: p.name, drafts: 0, ratingSum: 0, ratingCount: 0,
      mvpCount: 0, dudCount: 0, wins: 0, lastPlayed: null,
    };
    rec.name = p.name;
    rec.drafts += 1;
    const t = tally[p.id] || {};
    rec.ratingSum += (t.total||0);
    rec.ratingCount += (t.count||0);
    rec.mvpCount += pickerMvp[p.id]||0;
    rec.dudCount += pickerDud[p.id]||0;
    if (maxAvg > 0 && (t.avg||0) >= maxAvg) rec.wins += 1;
    rec.lastPlayed = new Date().toISOString();
    PLAYER_STATS.players[key] = rec;
  }
  savePlayerStats(PLAYER_STATS);

  // Overwrite the history file with final tallies
  if (room.historyFile){
    try {
      const p = path.join(HISTORY_DIR, room.historyFile);
      const j = JSON.parse(fs.readFileSync(p,'utf8'));
      j.votes = room.votes;
      j.voteTally = tallyVotes(room);
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
    } catch(e){ console.error('update history', e.message); }
  }
}

// ---------- HTTP ----------
app.use(express.json({limit:'5mb'}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/decks', (req, res) => {
  reloadDecks();
  res.json(Object.values(DECKS).map(d => ({
    id: d.id, name: d.name, description: d.description || '',
    occupations: (d.occupations || []).length,
    minorImprovements: (d.minorImprovements || []).length,
  })));
});

app.get('/api/decks/:id', (req, res) => {
  reloadDecks();
  const d = DECKS[req.params.id];
  if (!d) return res.status(404).json({error:'not found'});
  res.json(d);
});

// Admin: bulk update deck cards (ability / imageUrl / name)
// Body: { cards: [{code, name?, ability?, imageUrl?}] }
app.post('/api/decks/:id/patch', (req, res) => {
  const d = DECKS[req.params.id];
  if (!d) return res.status(404).json({error:'deck not found'});
  const updates = req.body?.cards || [];
  const map = new Map(updates.map(u => [String(u.code), u]));
  let changed = 0;
  for (const kind of ['occupations','minorImprovements']){
    for (const c of d[kind]){
      const u = map.get(c.code);
      if (!u) continue;
      if (typeof u.name === 'string' && u.name.length) c.name = u.name;
      if (typeof u.ability === 'string') c.ability = u.ability;
      if (typeof u.imageUrl === 'string') c.imageUrl = u.imageUrl;
      changed++;
    }
  }
  saveDeck(d);
  res.json({ok:true, changed});
});

// Admin: import CSV (code,name,ability,imageUrl,kind,deckId)
// Body: { csv: "..." }  -- header row required, comma-separated with quotes.
function parseCSV(txt){
  const rows=[]; let i=0, cur='', row=[], q=false;
  while (i<txt.length){
    const ch=txt[i];
    if (q){
      if (ch=='"' && txt[i+1]=='"'){ cur+='"'; i+=2; continue; }
      if (ch=='"'){ q=false; i++; continue; }
      cur+=ch; i++; continue;
    }
    if (ch=='"'){ q=true; i++; continue; }
    if (ch==','){ row.push(cur); cur=''; i++; continue; }
    if (ch=='\n' || ch=='\r'){ if (cur.length||row.length){ row.push(cur); rows.push(row); } cur=''; row=[]; if (ch=='\r' && txt[i+1]=='\n') i++; i++; continue; }
    cur+=ch; i++;
  }
  if (cur.length||row.length){ row.push(cur); rows.push(row); }
  return rows;
}
app.post('/api/import/csv', (req, res) => {
  const csv = req.body?.csv || '';
  const rows = parseCSV(csv).filter(r => r.some(x=>x&&x.trim().length));
  if (rows.length < 2) return res.status(400).json({error:'CSV empty'});
  const head = rows[0].map(s=>s.trim().toLowerCase());
  const iCode = head.indexOf('code'), iName = head.indexOf('name'),
        iAbility = head.indexOf('ability'), iImg = head.indexOf('imageurl'),
        iDeck = head.indexOf('deckid'), iKind = head.indexOf('kind');
  if (iCode<0) return res.status(400).json({error:'CSV needs code column'});
  reloadDecks();
  // Build code -> {deckId,kind,card} index
  const idx = new Map();
  for (const d of Object.values(DECKS)){
    for (const kind of ['occupations','minorImprovements'])
      for (const c of d[kind]) idx.set(c.code, {deckId:d.id, kind, card:c});
  }
  let changed=0, added=0;
  for (let r=1;r<rows.length;r++){
    const row = rows[r];
    const code = (row[iCode]||'').trim(); if (!code) continue;
    const name = iName>=0 ? (row[iName]||'').trim() : '';
    const ability = iAbility>=0 ? (row[iAbility]||'') : '';
    const img = iImg>=0 ? (row[iImg]||'').trim() : '';
    const deckId = iDeck>=0 ? (row[iDeck]||'').trim() : '';
    const kind = iKind>=0 ? (row[iKind]||'').trim() : '';
    const hit = idx.get(code);
    if (hit){
      if (name) hit.card.name = name;
      if (typeof ability==='string') hit.card.ability = ability;
      if (typeof img==='string') hit.card.imageUrl = img;
      changed++;
    } else if (deckId && kind && name){
      const d = DECKS[deckId]; if (!d) continue;
      const list = kind==='occupations' ? d.occupations : d.minorImprovements;
      list.push({code, name, ability: ability||'', imageUrl: img||''});
      added++;
    }
  }
  for (const d of Object.values(DECKS)) saveDeck(d);
  res.json({ok:true, changed, added});
});

app.get('/api/history', (req, res) => {
  try {
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    const items = files.map(f => {
      const j = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
      return { file:f, id:j.id, finishedAt:j.finishedAt, deckNames:j.deckNames, players:j.players.map(p=>p.name), voteTally:j.voteTally||null };
    }).sort((a,b)=>(b.finishedAt||'').localeCompare(a.finishedAt||''));
    res.json(items);
  } catch (e) { res.status(500).json({error:e.message}); }
});

app.get('/api/history/:file', (req, res) => {
  const f = req.params.file;
  if (!/^[a-zA-Z0-9_\-]+\.json$/.test(f)) return res.status(400).json({error:'bad name'});
  const p = path.join(HISTORY_DIR, f);
  if (!fs.existsSync(p)) return res.status(404).json({error:'not found'});
  res.sendFile(p);
});

// CSV templates served statically
app.use('/templates', express.static(path.join(__dirname, 'templates')));

app.get('/api/stats', (req, res) => {
  const arr = Object.entries(STATS.cards).map(([code, v]) => ({ code, ...v }));
  arr.sort((a,b)=> (b.score||0) - (a.score||0));
  res.json(arr);
});

// Player leaderboard
app.get('/api/players', (req, res) => {
  const arr = Object.entries(PLAYER_STATS.players).map(([key, v]) => {
    const avg = v.ratingCount ? +(v.ratingSum/v.ratingCount).toFixed(2) : 0;
    const score = avg * 2 + (v.mvpCount||0) * 0.5 - (v.dudCount||0) * 0.5 + (v.wins||0) * 1;
    return { key, ...v, avgRating: avg, score: +score.toFixed(2) };
  });
  arr.sort((a,b)=> (b.score||0) - (a.score||0));
  res.json(arr);
});

// Deck-level tier: aggregate card stats per deck
app.get('/api/deck-stats', (req, res) => {
  const byDeck = {};
  for (const [code, v] of Object.entries(STATS.cards)){
    const did = v.deckId || 'wm';
    if (!byDeck[did]) byDeck[did] = { deckId: did, cards: 0, seen: 0, picked: 0, score: 0, mvpNet: 0 };
    byDeck[did].cards += 1;
    byDeck[did].seen += (v.seen||0);
    byDeck[did].picked += (v.picked||0);
    byDeck[did].score += (v.score||0);
    byDeck[did].mvpNet += (v.votes||0);
  }
  const arr = Object.values(byDeck).map(d => ({
    ...d,
    pickRate: d.seen ? +(d.picked/d.seen).toFixed(3) : 0,
    avgCardScore: d.cards ? +(d.score/d.cards).toFixed(3) : 0,
    deckName: DECKS[d.deckId]?.name || d.deckId,
  }));
  arr.sort((a,b)=> b.avgCardScore - a.avgCardScore);
  res.json(arr);
});

// ---------- Socket ----------
io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  socket.on('createRoom', ({ name, deckIds, cardsPerHand, turnLimitSec }, cb) => {
    try {
      if (!name || !name.trim()) return cb && cb({ error: '이름을 입력하세요.' });
      if (!Array.isArray(deckIds) || deckIds.length === 0) return cb && cb({ error: '덱을 1개 이상 선택하세요.' });
      for (const id of deckIds) if (!DECKS[id]) return cb && cb({ error: `알 수 없는 덱: ${id}` });
      const cph = Number(cardsPerHand) || 7;
      if (cph < 3 || cph > 10) return cb && cb({ error: '한손 카드 수는 3~10.' });
      const tls = Math.max(0, Math.min(600, Number(turnLimitSec)||0));
      const roomId = nanoid(6).toUpperCase();
      const playerId = nanoid(8);
      const room = {
        id: roomId, hostId: playerId, deckIds, cardsPerHand: cph,
        turnLimitSec: tls,
        players: [{ id: playerId, name: name.trim(), socketId: socket.id, ready:false, picked:[], pickedThisRound:false }],
        status:'lobby', phase:null, round:0, hands:{}, log:[],
      };
      rooms.set(roomId, room);
      currentRoomId = roomId; currentPlayerId = playerId;
      socket.join(roomId);
      cb && cb({ ok:true, roomId, playerId });
      emitRoom(room);
    } catch (e) { cb && cb({ error: e.message }); }
  });

  socket.on('joinRoom', ({ roomId, name, playerId }, cb) => {
    try {
      const room = rooms.get((roomId || '').toUpperCase());
      if (!room) return cb && cb({ error: '방을 찾을 수 없음.' });
      if (playerId){
        const existing = room.players.find(p => p.id === playerId);
        if (existing){
          existing.socketId = socket.id;
          if (name && name.trim()) existing.name = name.trim();
          currentRoomId = room.id; currentPlayerId = existing.id;
          socket.join(room.id);
          cb && cb({ ok:true, roomId:room.id, playerId:existing.id, reconnected:true });
          emitRoom(room); return;
        }
      }
      if (room.status !== 'lobby') return cb && cb({ error: '이미 진행 중 - 새 참가 불가.' });
      if (room.players.length >= 4) return cb && cb({ error: '방 가득 참 (최대 4인).' });
      if (!name || !name.trim()) return cb && cb({ error: '이름을 입력하세요.' });
      const newId = nanoid(8);
      room.players.push({ id:newId, name:name.trim(), socketId:socket.id, ready:false, picked:[], pickedThisRound:false });
      currentRoomId = room.id; currentPlayerId = newId;
      socket.join(room.id);
      cb && cb({ ok:true, roomId:room.id, playerId:newId });
      emitRoom(room);
    } catch (e) { cb && cb({ error: e.message }); }
  });

  socket.on('leaveRoom', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (room.status === 'lobby') {
      room.players = room.players.filter(p => p.id !== currentPlayerId);
      if (room.players.length === 0) rooms.delete(room.id);
      else { if (room.hostId===currentPlayerId) room.hostId = room.players[0].id; emitRoom(room); }
    }
    socket.leave(currentRoomId);
    currentRoomId=null; currentPlayerId=null;
  });

  socket.on('startDraft', (_, cb) => {
    if (!currentRoomId) return cb && cb({ error: '방 없음.' });
    const room = rooms.get(currentRoomId);
    if (!room) return cb && cb({ error: '방 없음.' });
    if (room.hostId !== currentPlayerId) return cb && cb({ error: '호스트만 시작.' });
    if (room.players.length < 2) return cb && cb({ error: '최소 2인.' });
    if (room.players.length > 4) return cb && cb({ error: '최대 4인.' });
    room.players = shuffle(room.players);
    const r = dealPhase(room, 'occupations');
    if (r.error) return cb && cb({ error: r.error });
    room.status = 'drafting';
    emitRoom(room);
    cb && cb({ ok:true });
  });

  socket.on('pickCard', ({ cardCode }, cb) => {
    if (!currentRoomId) return cb && cb({ error:'방 없음.' });
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'drafting') return cb && cb({ error:'드래프트 중 아님.' });
    const me = room.players.find(p => p.id === currentPlayerId);
    if (!me) return cb && cb({ error:'플레이어 없음.' });
    if (me.pickedThisRound) return cb && cb({ error:'이미 픽함. 취소 후 다시 선택.' });
    const hand = room.hands[me.id] || [];
    const idx = hand.findIndex(c => c.code === cardCode);
    if (idx < 0) return cb && cb({ error:'내 손에 없는 카드.' });
    const [card] = hand.splice(idx, 1);
    me.picked.push({ ...card, phase: room.phase, round: room.round });
    me.pickedThisRound = true;
    // Store what we picked THIS round, so we can undo it
    me.lastPickCode = card.code;
    room.log.push({ phase:room.phase, round:room.round, playerId:me.id, playerName:me.name, card, ts:Date.now() });
    cb && cb({ ok:true });
    if (allPickedThisRound(room)){
      const anyLeft = room.players.some(p => (room.hands[p.id]||[]).length > 0);
      if (anyLeft) passHands(room);
      else { room.round += 1; endPhaseOrDraft(room); }
      if (room.status === 'drafting') startTurnTimer(room);
      else clearTurnTimer(room);
      // After all picked, no more undo possible from previous round
      for (const p of room.players) p.lastPickCode = null;
    }
    emitRoom(room);
  });

  // Undo the current-round pick as long as NOT everyone has picked yet.
  socket.on('undoPick', (_, cb) => {
    if (!currentRoomId) return cb && cb({ error:'방 없음.' });
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'drafting') return cb && cb({ error:'드래프트 중 아님.' });
    const me = room.players.find(p => p.id === currentPlayerId);
    if (!me) return cb && cb({ error:'플레이어 없음.' });
    if (!me.pickedThisRound || !me.lastPickCode) return cb && cb({ error:'취소할 픽이 없음.' });
    // If everyone else finished picking, we're just waiting for hands to pass — too late.
    // But since server processes picks serially, if this player is last, the pass already ran and their pickedThisRound was reset.
    // So we can safely allow undo while pickedThisRound is still true and hands weren't rotated.
    const picked = me.picked;
    const lastIdx = picked.length - 1;
    if (lastIdx < 0 || picked[lastIdx].code !== me.lastPickCode) return cb && cb({ error:'취소할 픽 위치 불일치.' });
    const [card] = picked.splice(lastIdx, 1);
    // Return card to hand
    room.hands[me.id] = room.hands[me.id] || [];
    room.hands[me.id].push({ code: card.code, name: card.name, nameEn: card.nameEn||'', ability: card.ability||'', abilityEn: card.abilityEn||'', cost: card.cost||'', cost2: card.cost2||'', vp: card.vp||'', condition: card.condition||'', passing: card.passing||'', category: card.category||'', imageUrl: card.imageUrl||'', deckId: card.deckId });
    me.pickedThisRound = false;
    me.lastPickCode = null;
    // Remove the last log entry for this player+card in current phase/round
    for (let i = room.log.length-1; i >= 0; i--){
      const l = room.log[i];
      if (l.playerId === me.id && l.card.code === card.code && l.phase === room.phase && l.round === room.round){
        room.log.splice(i, 1); break;
      }
    }
    cb && cb({ ok:true });
    emitRoom(room);
  });

  socket.on('rename', ({ name }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId); if (!room) return;
    const me = room.players.find(p => p.id === currentPlayerId); if (!me) return;
    if (name && name.trim()) me.name = name.trim();
    emitRoom(room);
  });

  socket.on('vote', ({ playerScores, mvpCards, dudCards }, cb) => {
    if (!currentRoomId) return cb && cb({error:'방 없음.'});
    const room = rooms.get(currentRoomId); if (!room || !room.voting?.open) return cb && cb({error:'투표 중 아님.'});
    const me = room.players.find(p => p.id === currentPlayerId); if (!me) return cb && cb({error:'플레이어 없음.'});
    const v = room.votes[me.id] = { playerScores:{}, mvpCards:[], dudCards:[], submittedAt: Date.now() };
    for (const [tid, sc] of Object.entries(playerScores||{})){
      if (tid === me.id) continue;
      const n = Math.round(Number(sc));
      if (n>=1 && n<=5 && room.players.find(p=>p.id===tid)) v.playerScores[tid] = n;
    }
    v.mvpCards = (mvpCards||[]).filter(c=>typeof c==='string').slice(0,10);
    v.dudCards = (dudCards||[]).filter(c=>typeof c==='string').slice(0,10);
    cb && cb({ok:true, savedScores: Object.keys(v.playerScores).length, savedMvp: v.mvpCards.length, savedDud: v.dudCards.length});
    // Auto-close only if EVERYONE submitted full ratings
    const need = room.players.length - 1;
    const allDone = room.players.every(p => Object.keys(room.votes[p.id]?.playerScores||{}).length >= need);
    if (allDone && need > 0) finalizeVoting(room);
    emitRoom(room);
  });

  socket.on('closeVoting', (_, cb) => {
    if (!currentRoomId) return cb && cb({error:'방 없음.'});
    const room = rooms.get(currentRoomId); if (!room) return cb && cb({error:'방 없음.'});
    if (room.hostId !== currentPlayerId) return cb && cb({error:'호스트만 마감.'});
    finalizeVoting(room);
    cb && cb({ok:true});
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId); if (!room) return;
    const me = room.players.find(p => p.id === currentPlayerId);
    if (me) me.socketId = null;
    if (room.status === 'lobby' && room.players.every(p => !p.socketId)) {
      setTimeout(()=>{ const r=rooms.get(room.id); if (r && r.status==='lobby' && r.players.every(p=>!p.socketId)) rooms.delete(r.id); }, 5*60*1000);
    }
    emitRoom(room);
  });
});

server.listen(PORT, () => { console.log(`Agri-Draft server on :${PORT}`); });
