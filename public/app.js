// Agricola Draft — client (v0.2)
const socket = io();
const app = document.getElementById('app');

const store = {
  get(k){ try{return JSON.parse(localStorage.getItem(k))}catch{return null} },
  set(k,v){ localStorage.setItem(k, JSON.stringify(v)) },
  del(k){ localStorage.removeItem(k) },
};
let STATE=null, DECKS=[], ERROR='';

async function loadDecks(){ const r=await fetch('/api/decks'); DECKS=await r.json(); }

// ---------- Icon substitution ----------
// Replace <TOKEN> tags in ability text with emoji icons + Korean label.
const ICONS = {
  FOOD:      { e: '🍞', ko: '음식' },
  GRAIN:     { e: '🌾', ko: '곡식' },
  WOOD:      { e: '🪵', ko: '나무' },
  CLAY:      { e: '🧱', ko: '흙' },
  STONE:     { e: '🪨', ko: '돌' },
  REED:      { e: '🎋', ko: '갈대' },
  SHEEP:     { e: '🐑', ko: '양' },
  CATTLE:    { e: '🐄', ko: '소' },
  PIG:       { e: '🐖', ko: '멧돼지' },
  VEGETABLE: { e: '🥕', ko: '채소' },
  VEG:       { e: '🥕', ko: '채소' },
  SCORE:     { e: '⭐', ko: '승점' },
  ARROW:     { e: '➡️', ko: '' },
  BAKE:      { e: '🥐', ko: '빵굽기' },
  STABLE:    { e: '🏚️', ko: '외양간' },
  FENCE:     { e: '🚧', ko: '울타리' },
  BEGGING:   { e: '🥺', ko: '구걸' },
  FIELD:     { e: '🟫', ko: '밭' },
};
function iconize(text){
  if (!text) return '';
  return String(text).replace(/<([A-Z_]+)>/g, (_, tok)=>{
    const it = ICONS[tok];
    if (!it) return `<${tok}>`;
    return `[${it.e}${it.ko?' '+it.ko:''}]`;
  });
}

function h(tag, attrs={}, ...children){
  const el=document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (k==='class') el.className=v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v===false||v==null) {}
    else el.setAttribute(k, v===true?'':v);
  }
  for (const c of children.flat()){
    if (c==null||c===false) continue;
    el.appendChild(typeof c==='string'?document.createTextNode(c):c);
  }
  return el;
}
function showError(msg){
  ERROR=msg;
  const errBox=document.querySelector('.error');
  if (errBox) errBox.textContent=msg;
  else { app.prepend(h('div',{class:'error'}, msg)); }
}
function openModal(node){
  const back=h('div',{class:'modal-backdrop', onclick:e=>{ if(e.target===back) document.body.removeChild(back); }},
    h('div',{class:'modal'},
      h('button',{class:'close', onclick:()=>document.body.removeChild(back)}, '×'),
      node
    )
  );
  document.body.appendChild(back);
}

function route(){
  const hash=location.hash||'#/'; ERROR='';
  if (hash.startsWith('#/history/')) return renderHistoryDetail(hash.slice('#/history/'.length));
  if (hash.startsWith('#/history')) return renderHistoryList();
  if (hash.startsWith('#/players')) return renderPlayers();
  if (hash.startsWith('#/decks-tier')) return renderDeckTier();
  if (hash.startsWith('#/stats')) return renderStats();
  if (hash.startsWith('#/admin/')) return renderAdminDeck(hash.slice('#/admin/'.length));
  if (hash.startsWith('#/admin')) return renderAdminHome();
  if (hash.startsWith('#/room/')) return renderRoom(hash.slice('#/room/'.length));
  return renderLobby();
}
window.addEventListener('hashchange', route);

// ---------- Lobby ----------
async function renderLobby(){
  await loadDecks();
  app.innerHTML='';
  const savedName=store.get('name')||'';
  const savedRoom=store.get('lastRoom');
  const nameInput=h('input',{value:savedName, placeholder:'닉네임', oninput:e=>store.set('name',e.target.value)});
  const cphInput=h('input',{type:'number', value:'7', min:'3', max:'10', style:'width:70px'});
  // Turn time limit dropdown
  const turnSel = h('select',{style:'width:auto'},
    h('option',{value:'0'}, '무제한'),
    h('option',{value:'5'}, '5초'),
    h('option',{value:'10'}, '10초'),
    h('option',{value:'15'}, '15초'),
    h('option',{value:'20', selected:''}, '20초'),
    h('option',{value:'30'}, '30초'),
    h('option',{value:'60'}, '1분'),
  );
  // Default select A~E
  const defaultSel = new Set(['a','b','c','d','e']);
  const selected = new Set([...defaultSel].filter(id => DECKS.some(d=>d.id===id)));
  const deckCards = [];
  const deckGrid=h('div',{class:'grid decks'},
    DECKS.map(d=>{
      const isSel = selected.has(d.id);
      const card=h('div',{class:'deck-card'+(isSel?' selected':''), onclick:()=>{
        if (selected.has(d.id)) selected.delete(d.id); else selected.add(d.id);
        card.classList.toggle('selected');
      }},
        h('div',{}, h('strong',{}, d.name)),
        h('div',{}, h('small',{}, d.description||'')),
        h('div',{style:'margin-top:6px'}, h('small',{}, `직업 ${d.occupations} · 설비 ${d.minorImprovements}`)),
      );
      deckCards.push({d, el:card});
      return card;
    })
  );
  const selectAllBtn = h('button',{class:'secondary small', onclick:()=>{
    for (const {d, el} of deckCards){ selected.add(d.id); el.classList.add('selected'); }
  }}, '전체 선택');
  const clearAllBtn = h('button',{class:'secondary small', onclick:()=>{
    selected.clear(); for (const {el} of deckCards) el.classList.remove('selected');
  }}, '전체 해제');
  const createBtn=h('button',{onclick:()=>{
    const name=nameInput.value.trim();
    if (!name) return showError('닉네임을 입력하세요.');
    if (selected.size===0) return showError('덱을 1개 이상 선택.');
    store.set('name', name);
    socket.emit('createRoom', {
      name, deckIds:[...selected],
      cardsPerHand:Number(cphInput.value)||7,
      turnLimitSec: Number(turnSel.value)||0,
    }, r=>{
      if (r?.error) return showError(r.error);
      store.set('lastRoom', {roomId:r.roomId, playerId:r.playerId});
      location.hash=`#/room/${r.roomId}`;
    });
  }}, '방 만들기');
  const roomIdInput=h('input',{placeholder:'방 코드 (예: ABC123)', style:'text-transform:uppercase'});
  const joinBtn=h('button',{class:'secondary', onclick:()=>{
    const name=nameInput.value.trim();
    const roomId=roomIdInput.value.trim().toUpperCase();
    if (!name) return showError('닉네임 입력.');
    if (!roomId) return showError('방 코드 입력.');
    store.set('name', name);
    socket.emit('joinRoom', {roomId, name}, r=>{
      if (r?.error) return showError(r.error);
      store.set('lastRoom', {roomId:r.roomId, playerId:r.playerId});
      location.hash=`#/room/${r.roomId}`;
    });
  }}, '참가');
  const rejoin=savedRoom ? h('button',{class:'secondary', onclick:()=>{
    socket.emit('joinRoom', {roomId:savedRoom.roomId, name: nameInput.value.trim()||savedName, playerId:savedRoom.playerId}, r=>{
      if (r?.error){ store.del('lastRoom'); return showError(r.error); }
      location.hash=`#/room/${r.roomId}`;
    });
  }}, `이전 방 (${savedRoom.roomId}) 재접속`) : null;
  app.append(
    h('div',{class:'card-panel'},
      h('h2',{}, '방 만들기 / 참가'),
      h('div',{class:'row'},
        h('div',{style:'flex:1;min-width:180px'}, h('label',{},'닉네임'), nameInput),
        h('div',{}, h('label',{},'한손 카드 수'), cphInput),
        h('div',{}, h('label',{},'한 턴 시간 제한'), turnSel),
      ),
      h('div',{class:'row',style:'align-items:center;margin-top:8px'},
        h('h3',{style:'margin:0'}, '덱 선택'),
        selectAllBtn, clearAllBtn,
        h('span',{class:'hint'}, `기본: A · B · C · D · E`),
      ),
      deckGrid,
      h('div',{class:'hint', style:'margin-top:6px'}, `한손 7장 × 4인 = 필요 28장. 부족시 방 시작 실패.`),
      h('div',{class:'row', style:'margin-top:12px'},
        createBtn,
        h('div',{style:'flex:1'}),
        h('div',{style:'flex:1;min-width:160px'}, h('label',{},'참가할 방 코드'), roomIdInput),
        joinBtn,
      ),
      rejoin?h('div',{style:'margin-top:10px'}, rejoin):null,
    ),
    h('div',{class:'card-panel'},
      h('h2',{}, '진행 방식'),
      h('ul',{},
        h('li',{}, '2~4명 실시간. 방 코드 / 초대 링크 공유.'),
        h('li',{}, '선택 덱들의 직업 카드 셔플 → 각자 N장 배분 → 1픽 → 손 옆으로 전달.'),
        h('li',{}, '드래프트 종료까지 다른 플레이어의 픽 내용은 비공개.'),
        h('li',{}, '한 턴 시간 제한 설정 시 시간 만료되면 랜덤 카드 자동 선택.'),
        h('li',{}, '직업 라운드 끝나면 자동 부속설비 라운드.'),
        h('li',{}, '드래프트 종료 → 서로 서로에게 별점 + MVP/dud 카드 투표.'),
        h('li',{}, `투표 결과는 카드 티어/통계 · 플레이어/덱 티어보드로 누적.`),
      ),
    )
  );
  if (ERROR) showError(ERROR);
}

// ---------- Room ----------
function renderRoom(roomId){
  const saved=store.get('lastRoom');
  if (!saved || saved.roomId!==roomId){
    const name=(store.get('name')||'').trim();
    if (!name){ location.hash='#/'; return; }
    socket.emit('joinRoom', {roomId, name}, r=>{
      if (r?.error){ showError(r.error); location.hash='#/'; return; }
      store.set('lastRoom', {roomId:r.roomId, playerId:r.playerId});
    });
  } else {
    socket.emit('joinRoom', {roomId, name:store.get('name')||'', playerId:saved.playerId}, r=>{
      if (r?.error){ showError(r.error); store.del('lastRoom'); location.hash='#/'; }
    });
  }
  app.innerHTML='';
  app.append(h('div',{class:'card-panel'}, h('div',{class:'hint'}, '방 접속 중…')));
}

// Countdown timer helper
let _countdownHandle = null;
function startCountdown(deadline, el){
  if (_countdownHandle) clearInterval(_countdownHandle);
  function tick(){
    const rem = Math.max(0, Math.round((deadline - Date.now())/1000));
    if (!el.isConnected){ clearInterval(_countdownHandle); return; }
    el.textContent = `⏱ ${rem}초`;
    el.classList.toggle('warn', rem <= 5 && rem > 0);
    el.classList.toggle('crit', rem <= 2);
    if (rem <= 0){ clearInterval(_countdownHandle); }
  }
  tick();
  _countdownHandle = setInterval(tick, 250);
}

socket.on('state', view=>{
  STATE=view;
  if (!location.hash.startsWith('#/room/')) return;
  const roomHash=`#/room/${view.room.id}`;
  if (location.hash!==roomHash) location.hash=roomHash;
  drawRoom(view);
});

function cardEl(c, opts={}){
  const {clickable=false, onClick=null, disabled=false} = opts;
  const abilText = iconize(c.ability);
  const abil = c.ability
    ? h('div',{class:'ability'}, abilText)
    : h('div',{class:'ability hint'}, '(능력 미입력)');
  const meta = [];
  if (c.cost && c.cost !== '-') meta.push('💰 '+iconize(c.cost));
  if (c.vp && c.vp !== '-') meta.push('★ '+c.vp+'점');
  if (c.condition && c.condition !== '-') meta.push('조건: '+iconize(c.condition));
  const metaEl = meta.length ? h('div',{class:'meta'}, meta.join(' · ')) : null;
  const img = c.imageUrl
    ? h('div',{class:'imgwrap'},
        h('img',{src:c.imageUrl, loading:'lazy', onerror:e=>e.target.style.display='none'}),
        h('button',{class:'zoom', onclick:e=>{ e.stopPropagation(); openModal(h('div',{},
          h('h3',{}, `${c.name} (${c.code})`),
          h('img',{src:c.imageUrl}),
          c.ability?h('p',{}, iconize(c.ability)):null,
        )); }}, '확대'))
    : null;
  return h('div',{
    class:'mini-card'+(disabled?' disabled':''),
    onclick: clickable && !disabled && onClick ? onClick : null,
    title: `${c.name} (${c.code})${c.ability?'\n'+abilText:''}`,
  }, img,
     h('div',{class:'code'}, `${c.code} · `, h('span',{class:'deck-tag'}, c.deckId||''),
       c.nameEn?h('span',{class:'en'}, ' · '+c.nameEn):null),
     h('div',{class:'name'}, c.name),
     metaEl,
     abil,
  );
}

function drawRoom(view){
  const {room, me, others, log, voting, votingProgress}=view;
  const isHost = me && room.hostId===me.id;
  app.innerHTML='';
  const roomHeader=h('div',{class:'card-panel'},
    h('div',{style:'display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center'},
      h('div',{},
        h('h2',{style:'margin:0'}, `방 코드: ${room.id}`),
        h('div',{class:'hint'}, `상태: ${room.status} · 덱: ${room.decks.map(d=>d.name).join(', ')} · 한손 ${room.cardsPerHand}장`),
      ),
      h('div',{class:'actions'},
        h('button',{class:'secondary copy-btn', onclick:()=>{
          const url=location.origin+'/#/room/'+room.id;
          navigator.clipboard.writeText(url).then(()=>alert('링크 복사: '+url));
        }}, '초대 링크 복사'),
        h('button',{class:'secondary', onclick:()=>{ socket.emit('leaveRoom'); store.del('lastRoom'); location.hash='#/'; }}, '나가기'),
      )
    ),
    h('div',{class:'players'},
      room.players.map(p=>h('div',{class:'player-chip'+(me&&p.id===me.id?' me':'')},
        p.name+(room.hostId===p.id?' 👑':''),
        p.pickedCount>0?h('span',{class:'picked-dot'}, ` · ${p.pickedCount}픽`):null,
      ))
    ),
  );
  app.append(roomHeader);

  if (room.status==='lobby'){
    app.append(h('div',{class:'card-panel'},
      h('h3',{}, '대기 중'),
      h('div',{class:'hint'}, '친구에게 초대 링크나 방 코드를 공유해 참가하게 하세요. 2~4명 필요.'),
      h('div',{style:'margin-top:10px'},
        isHost?h('button',{disabled:room.players.length<2, onclick:()=>socket.emit('startDraft',{}, r=>{ if(r?.error) showError(r.error); })}, '드래프트 시작')
              :h('span',{class:'hint'}, '호스트가 시작을 누르면 진행됨.'),
      ),
    ));
    return;
  }

  if (room.status==='drafting' && me){
    const phaseLabel = room.phase==='occupations' ? '직업 (Occupations)' : '부속설비 (Minor Improvements)';
    // Turn timer display
    let timerEl = null;
    if (room.turnDeadline){
      timerEl = h('span',{class:'turn-timer', id:'turn-timer'}, '');
      startCountdown(room.turnDeadline, timerEl);
    } else if (room.turnLimitSec) {
      timerEl = h('span',{class:'turn-timer'}, `⏱ ${room.turnLimitSec}초 제한`);
    }
    const undoBtn = me.hasPickedThisRound && me.lastPickCode ? h('button',{class:'secondary small', onclick:()=>{
      socket.emit('undoPick', {}, r=>{ if (r?.error) showError(r.error); });
    }}, '↶ 방금 픽 취소') : null;
    app.append(h('div',{class:'card-panel'},
      h('h3',{},
        h('span',{class:'phase-tag'+(room.phase==='minors'?' min':'')}, phaseLabel),
        `라운드 ${room.round} / ${room.cardsPerHand}`,
        h('span',{class:'round-badge'}, me.hasPickedThisRound?'픽 완료':'대기 중'),
        timerEl,
      ),
      h('div',{class:'hint'}, '내 손에서 1장 클릭해 픽. 모두 픽하면 자동 진행. 시간 초과 시 랜덤 자동 픽. 실수했으면 아래 취소 버튼.'),
      undoBtn ? h('div',{style:'margin:6px 0'}, undoBtn) : null,
      h('h3',{}, `내 손 (${me.hand.length}장)`),
      h('div',{class:'grid cards'},
        (me.hand||[]).map(c => cardEl(c, {clickable:true, disabled:me.hasPickedThisRound,
          onClick:()=>socket.emit('pickCard',{cardCode:c.code}, r=>{ if(r?.error) showError(r.error); })}))),
      h('h3',{}, `내 픽`),
      h('div',{class:'picked-list'},
        (me.picked||[]).map(c=>h('span',{class:'pick-pill '+(c.phase==='occupations'?'occ':'min'),
          onclick:()=>openModal(h('div',{}, h('h3',{}, `${c.name} (${c.code})`),
            c.imageUrl?h('img',{src:c.imageUrl}):null,
            h('p',{}, iconize(c.ability)||'(능력 미입력)')))}, c.name))),
    ));
    app.append(h('div',{class:'card-panel'},
      h('h3',{}, '다른 플레이어'),
      h('div',{class:'hint'}, '🔒 드래프트가 끝날 때까지 다른 사람이 무엇을 픽했는지 공개되지 않습니다.'),
      others.map(o=>h('div',{style:'margin-bottom:8px'},
        h('div',{}, h('strong',{}, o.name), ` · 손 ${o.handSize}장 · ${o.hasPickedThisRound?'✅ 픽 완료':'⏳ 선택 중'} · 픽 누적 ${o.pickedCount||0}장`),
      )),
    ));
  }

  if (room.status==='finished'){
    // Voting UI
    if (voting && voting.open && !voting.closed){
      renderVoting(room, me, others);
    } else {
      renderResults(room, me, others);
    }
  }

  // Log only visible after draft is finished
  if (room.status === 'finished') {
    app.append(h('div',{class:'card-panel'},
      h('h3',{}, '픽 로그 (드래프트 종료 · 전체 공개)'),
      h('div',{class:'log'},
        (log||[]).slice().reverse().map(l=>h('div',{class:'line'},
          `[${l.phase==='occupations'?'직업':'설비'} R${l.round}] `,
          h('strong',{}, l.playerName), ` → ${l.card.name} (${l.card.code}, ${l.card.deckId})`))
      )));
  }
}

function renderVoting(room, me, others){
  const myVotes = (me && me.myVotes) || {playerScores:{}, mvpCards:[], dudCards:[]};
  const scores = {...(myVotes.playerScores||{})};
  const mvpSet = new Set(myVotes.mvpCards||[]);
  const dudSet = new Set(myVotes.dudCards||[]);
  const targetsNeeded = room.players.length - 1;
  const savedLine = h('div',{class:'save-line'},'');
  function updateSaved(txt, cls){
    savedLine.textContent = txt;
    savedLine.className = 'save-line'+(cls?' '+cls:'');
  }
  function myProgress(){
    const done = Object.keys(scores).length;
    return `${done} / ${targetsNeeded}`;
  }
  const progressBadge = h('span',{class:'save-badge'}, '');
  function updateProgress(){
    const done = Object.keys(scores).length;
    progressBadge.textContent = `내 별점 진행: ${done}/${targetsNeeded}`;
    progressBadge.className = 'save-badge' + (done>=targetsNeeded ? ' ok':' pending');
  }
  const submit = ()=>{
    updateSaved('💾 저장 중...', '');
    socket.emit('vote', {
      playerScores:scores, mvpCards:[...mvpSet], dudCards:[...dudSet]
    }, r=>{
      if (r?.error){ updateSaved('❌ '+r.error, 'err'); showError(r.error); return; }
      updateSaved(`✅ 저장됨 — 별점 ${r.savedScores}건 / MVP ${r.savedMvp}건 / dud ${r.savedDud}건. 다른 사람도 마치면 자동 마감, 아니면 호스트가 지금 마감 눌러.`, 'ok');
    });
  };
  // Auto-save on any change (debounced)
  let autoT = null;
  function autoSave(){
    updateProgress();
    if (autoT) clearTimeout(autoT);
    autoT = setTimeout(submit, 500);
  }

  // Progress panel for ALL players
  const vp = STATE?.votingProgress || null;
  const progressRows = (vp?.players || []).map(pp => {
    const isMe = me && pp.id === me.id;
    return h('div',{class:'vote-prog-row'+(pp.submitted?' done':'')+(isMe?' me':'')},
      h('span',{class:'name'}, pp.name + (isMe?' (나)':'')),
      h('span',{class:'stat'}, `별점 ${pp.scoreCount}/${pp.targetsNeeded}`),
      h('span',{class:'stat'}, `MVP ${pp.mvpCount}`),
      h('span',{class:'stat'}, `dud ${pp.dudCount}`),
      h('span',{class:'st'}, pp.submitted ? '✅ 완료' : '⏳ 진행 중'),
    );
  });

  const panel = h('div',{class:'card-panel'},
    h('h2',{}, '드래프트 종료 → 투표'),
    h('div',{class:'hint'}, '각 상대에게 1~5★. 카드 클릭=MVP(골드) · Shift+클릭=dud(빨강). 변경사항은 0.5초 후 자동 저장됨.'),
    h('div',{style:'margin:6px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center'},
      progressBadge, savedLine,
      h('button',{onclick:submit}, '지금 저장'),
      (room.hostId===me?.id) ? h('button',{class:'danger', onclick:()=>{
        if (!confirm('지금 마감하면 미제출자의 별점은 계산에서 제외됩니다. 진행?')) return;
        socket.emit('closeVoting',{},r=>{ if(r?.error) showError(r.error); });
      }}, '🔒 호스트: 지금 마감') : null,
    ),
    h('div',{class:'vote-progress'},
      h('h3',{style:'margin:0 0 4px'}, '👥 전체 투표 진행'),
      progressRows.length ? progressRows : h('div',{class:'hint'}, '데이터 없음'),
    ),
    room.players.filter(p=>me && p.id!==me.id).map(p=>{
      const other = (others||[]).find(o=>o.id===p.id);
      const picks = other ? other.picked||[] : [];
      return h('div',{class:'vote-target'},
        h('div',{class:'vote-head'},
          h('strong',{}, p.name),
          h('div',{class:'rate'},
            [1,2,3,4,5].map(n=>h('button',{class:scores[p.id]===n?'on':'', onclick:()=>{
              if (scores[p.id]===n) delete scores[p.id]; else scores[p.id]=n;
              drawRoom(STATE); autoSave();
            }}, n+'★'))
          ),
          h('span',{class:'my-score-badge'}, scores[p.id]?`✓ ${scores[p.id]}★ 선택됨`:'별점 미선택'),
        ),
        h('div',{style:'margin-top:6px'}, h('span',{class:'hint'}, '클릭=MVP(골드) · Shift+클릭=dud(빨강). 다시 누르면 해제. 카드에 마우스 올리면 능력 텍스트.')),
        h('div',{class:'picked-list', style:'margin-top:6px'},
          picks.map(c=>{
            const isMvp=mvpSet.has(c.code), isDud=dudSet.has(c.code);
            const abilTxt = iconize(c.ability)||'(능력 미입력)';
            return h('span',{
              class:'pick-pill '+(c.phase==='occupations'?'occ':'min')+(isMvp?' mvp':'')+(isDud?' dud':''),
              title: `${c.name} (${c.code})\n${abilTxt}${c.cost&&c.cost!=='-'?'\n비용: '+c.cost:''}${c.vp&&c.vp!=='-'?'\n승점: '+c.vp:''}`,
              onclick:e=>{
                if (e.shiftKey){
                  if (dudSet.has(c.code)) dudSet.delete(c.code); else { dudSet.add(c.code); mvpSet.delete(c.code); }
                } else {
                  if (mvpSet.has(c.code)) mvpSet.delete(c.code); else { mvpSet.add(c.code); dudSet.delete(c.code); }
                }
                drawRoom(STATE); autoSave();
              },
            }, (isMvp?'👑 ':'')+(isDud?'💩 ':'')+c.name);
          })
        )
      );
    }),
    h('div',{style:'margin-top:12px;padding:10px;background:#f4ecd8;border-radius:6px'},
      h('strong',{}, '내 별점 진행: ', myProgress()),
      h('div',{class:'hint',style:'margin-top:4px'}, '별점을 모두 매기면 자동 마감 대상. 호스트는 언제든 강제 마감 가능.'),
    ),
  );
  app.append(panel);
  updateProgress();
}

// need `votingProgress` inside renderVoting — expose it via closure
let votingProgress = null;

function renderResults(room, me, others){
  const allPlayers = room.players.map(p => {
    if (me && p.id === me.id) return me;
    return (others||[]).find(o=>o.id===p.id);
  });
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '결과'),
    h('div',{class:'hint'}, '카드 티어/통계 · 플레이어 티어보드 · 덱 티어보드에서 누적 결과를 볼 수 있음.'),
    h('div',{style:'margin-top:8px;display:flex;gap:10px;flex-wrap:wrap'},
      h('a',{href:'#/players'}, '🏆 플레이어 티어 →'),
      h('a',{href:'#/decks-tier'}, '📚 덱 티어 →'),
      h('a',{href:'#/stats'}, '카드 티어/통계 →'),
      h('a',{href:'#/history'}, '기록 →'),
    ),
    h('h3',{}, '플레이어별 픽 & 초기 손패'),
    room.players.map(p=>{
      const player = allPlayers.find(x => x && x.id === p.id);
      const picks = player ? (player.picked||[]) : [];
      const initial = player ? player.initialHands : null;
      const showInitial = h('button',{class:'secondary small', onclick:()=>{
        if (!initial) { alert('초기 손패 데이터 없음.'); return; }
        openModal(h('div',{},
          h('h3',{}, `${p.name} 의 초기 손패 (드래프트 시작 시 배분)`),
          initial.occupations ? h('div',{},
            h('h4',{}, `직업 (${initial.occupations.length}장)`),
            h('div',{class:'grid cards'}, initial.occupations.map(c => cardEl({...c, deckId:c.deckId})))
          ) : null,
          initial.minors ? h('div',{},
            h('h4',{}, `부속설비 (${initial.minors.length}장)`),
            h('div',{class:'grid cards'}, initial.minors.map(c => cardEl({...c, deckId:c.deckId})))
          ) : null,
        ));
      }}, '🎴 초기 손패 보기');
      const showPicks = h('button',{class:'secondary small', onclick:()=>{
        openModal(h('div',{},
          h('h3',{}, `${p.name} 의 최종 픽 (${picks.length}장)`),
          h('div',{class:'grid cards'}, picks.map(c => cardEl(c))),
        ));
      }}, '🃏 픽 카드 상세');
      return h('div',{style:'margin-bottom:10px;padding:8px;background:#faf5e6;border-radius:6px'},
        h('div',{style:'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px'},
          h('div',{}, h('strong',{}, p.name), ` · 최종 ${picks.length}장`),
          h('div',{class:'actions'}, showPicks, showInitial),
        ),
        h('div',{class:'picked-list',style:'margin-top:6px'},
          picks.map(c=>h('span',{class:'pick-pill '+(c.phase==='occupations'?'occ':'min'),
            title: `${c.name} (${c.code})\n${iconize(c.ability)||'(능력 미입력)'}`}, c.name))
        )
      );
    })
  ));
}

// ---------- History ----------
async function renderHistoryList(){
  app.innerHTML='';
  const r=await fetch('/api/history'); const items=await r.json();
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '드래프트 기록'),
    items.length===0 ? h('div',{class:'hint'}, '기록 없음.') :
    h('table',{},
      h('thead',{}, h('tr',{}, h('th',{},'종료'), h('th',{},'방'), h('th',{},'덱'), h('th',{},'플레이어'), h('th',{},''))),
      h('tbody',{}, items.map(it=>h('tr',{},
        h('td',{}, new Date(it.finishedAt).toLocaleString('ko-KR')),
        h('td',{}, it.id),
        h('td',{}, (it.deckNames||[]).join(', ')),
        h('td',{}, (it.players||[]).join(', ')),
        h('td',{}, h('a',{href:`#/history/${it.file}`}, '열기 →')),
      )))
    )
  ));
}

async function renderHistoryDetail(file){
  app.innerHTML='';
  const r=await fetch('/api/history/'+file);
  if (!r.ok){ app.append(h('div',{class:'error'}, '없음.')); return; }
  const j=await r.json();
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, `기록: ${j.id}`),
    h('div',{class:'hint'}, `${new Date(j.finishedAt).toLocaleString('ko-KR')} · ${j.deckNames.join(', ')}`),
    j.voteTally ? h('div',{},
      h('h3',{}, '투표 결과 (평균 점수)'),
      h('table',{},
        h('thead',{}, h('tr',{}, h('th',{},'플레이어'), h('th',{},'평균'), h('th',{},'투표 수'))),
        h('tbody',{}, j.players.map(p=>{
          const t=j.voteTally[p.id]||{};
          return h('tr',{}, h('td',{}, p.name), h('td',{}, String(t.avg||0)), h('td',{}, String(t.count||0)));
        })),
      )
    ) : null,
    h('h3',{}, '플레이어별 픽'),
    j.players.map(p=>h('div',{style:'margin-bottom:10px'},
      h('div',{}, h('strong',{}, p.name)),
      h('div',{class:'picked-list'},
        p.picks.map(c=>h('span',{class:'pick-pill '+(c.phase==='occupations'?'occ':'min')},
          `${c.phase==='occupations'?'직':'설'} R${c.round} · ${c.name}`
        ))
      )
    )),
    h('h3',{}, '전체 로그'),
    h('div',{class:'log'},
      j.log.map(l=>h('div',{class:'line'},
        `[${l.phase==='occupations'?'직업':'설비'} R${l.round}] `,
        h('strong',{}, l.playerName), ` → ${l.card.name} (${l.card.code}, ${l.card.deckId})`))
    ),
    h('div',{style:'margin-top:10px'}, h('a',{href:'#/history'}, '← 기록 목록'))
  ));
}

// ---------- Stats / Tier ----------
async function renderStats(){
  app.innerHTML='';
  const r=await fetch('/api/stats'); const rows=await r.json();
  // Assign tier: top 10% = S, next 20% = A, mid 40% = B, next 20% = C, bottom 10% = D
  const withPickData = rows.filter(r=>r.seen>0);
  const N=withPickData.length;
  function tier(idx){
    if (idx < N*0.10) return 'S';
    if (idx < N*0.30) return 'A';
    if (idx < N*0.70) return 'B';
    if (idx < N*0.90) return 'C';
    return 'D';
  }
  // rows already sorted by score desc from server
  withPickData.forEach((r,i)=>{ r.tier=tier(i); r.pickRate = r.seen>0 ? (r.picked/r.seen) : 0; });
  const search=h('input',{placeholder:'카드 이름/코드 검색', oninput:e=>{
    const q=e.target.value.toLowerCase();
    for (const tr of document.querySelectorAll('table.stats tbody tr')){
      tr.style.display = tr.dataset.q.includes(q) ? '' : 'none';
    }
  }});
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '카드 티어 · 드래프트 통계'),
    h('div',{class:'hint'}, `총 ${withPickData.length}장 · 티어는 종료 후 투표 결과가 누적되며 갱신됨. 점수 = (별점-3) × 0.5 + MVP + dud.`),
    h('div',{style:'margin:10px 0'}, search),
    h('table',{class:'stats'},
      h('thead',{}, h('tr',{},
        h('th',{},'티어'), h('th',{},'코드'), h('th',{},'이름'), h('th',{},'덱'), h('th',{},'종류'),
        h('th',{},'등장'), h('th',{},'픽'), h('th',{},'픽률'), h('th',{},'MVP-dud'), h('th',{},'점수')
      )),
      h('tbody',{}, withPickData.map(r=>h('tr',{class:'tier-'+r.tier, 'data-q':`${r.code} ${r.name}`.toLowerCase()},
        h('td',{}, r.tier),
        h('td',{style:'font-family:monospace;font-size:12px'}, r.code),
        h('td',{}, r.name),
        h('td',{}, r.deckId),
        h('td',{}, r.kind==='occupations'?'직업':'설비'),
        h('td',{}, String(r.seen||0)),
        h('td',{}, String(r.picked||0)),
        h('td',{}, ((r.pickRate||0)*100).toFixed(0)+'%'),
        h('td',{}, String(r.votes||0)),
        h('td',{}, (r.score||0).toFixed(1))
      )))
    )
  ));
}

// ---------- Admin ----------
async function renderAdminHome(){
  await loadDecks();
  app.innerHTML='';
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '카드 관리 홈'),
    h('div',{class:'hint'}, '카드 능력 텍스트와 이미지 URL을 여기서 편집합니다. 서버 파일(data/decks/*.json)에 즉시 저장되어 다른 모든 접속자에게 반영.'),
    h('h3',{}, '덱 목록'),
    h('table',{},
      h('thead',{}, h('tr',{}, h('th',{},'덱'), h('th',{},'설명'), h('th',{},'직업'), h('th',{},'설비'), h('th',{},''))),
      h('tbody',{}, DECKS.map(d=>h('tr',{},
        h('td',{}, d.name),
        h('td',{}, d.description||''),
        h('td',{}, String(d.occupations)),
        h('td',{}, String(d.minorImprovements)),
        h('td',{}, h('a',{href:`#/admin/${d.id}`}, '편집 →'))
      )))
    ),
    h('h3',{}, '📥 CSV 일괄 임포트'),
    h('div',{class:'hint'}, '헤더 필수: code,name,ability,imageUrl,deckId,kind. 매칭되는 코드는 UPDATE, 없으면 (deckId+kind+name 있을 때) ADD.'),
    h('div',{class:'hint', style:'margin-top:6px'}, '📋 아래 템플릿을 다운로드해서 imageUrl 컬럼에만 URL 넣고 다시 붙여넣으면 됩니다. 각 카드에 BGG/Google 이미지 검색 링크가 미리 들어있음.'),
    h('div',{class:'tpl-links'},
      h('a',{href:'/templates/all_cards_image_template.csv', download:''}, '📄 전체 888장 템플릿'),
      h('a',{href:'/templates/deck_a_image_template.csv', download:''}, 'A덱 (180장)'),
      h('a',{href:'/templates/deck_b_image_template.csv', download:''}, 'B덱 (180장)'),
      h('a',{href:'/templates/deck_c_image_template.csv', download:''}, 'C덱 (180장)'),
      h('a',{href:'/templates/deck_d_image_template.csv', download:''}, 'D덱 (180장)'),
      h('a',{href:'/templates/deck_e_image_template.csv', download:''}, 'E덱 (168장)'),
    ),
    (()=>{
      const ta=h('textarea',{placeholder:'code,name,ability,imageUrl,deckId,kind\nE13,Axe,나무 자원 획득 시 보너스,https://...,e,minorImprovements'});
      const status=h('div',{class:'hint'});
      const btn=h('button',{onclick:async()=>{
        const r=await fetch('/api/import/csv', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({csv:ta.value})});
        const j=await r.json();
        status.textContent = j.error ? ('오류: '+j.error) : `업데이트 ${j.changed}건 · 추가 ${j.added}건`;
      }}, '임포트 실행');
      return h('div',{}, ta, h('div',{style:'margin-top:6px'}, btn, ' ', status));
    })()
  ));
}

async function renderAdminDeck(deckId){
  const r=await fetch('/api/decks/'+deckId);
  if (!r.ok){ app.innerHTML=''; app.append(h('div',{class:'error'}, '덱 없음.')); return; }
  const deck=await r.json();
  app.innerHTML='';
  const changed=new Map();
  function mark(code, field, val){
    const cur=changed.get(code)||{code};
    cur[field]=val;
    changed.set(code, cur);
    saveBtn.disabled = changed.size===0;
    saveBtn.textContent = changed.size ? `${changed.size}개 수정 저장` : '변경사항 없음';
  }
  function rowFor(c){
    const nameI=h('input',{value:c.name, oninput:e=>mark(c.code,'name',e.target.value)});
    const abI=h('input',{value:c.ability||'', placeholder:'능력 (한 줄)', oninput:e=>mark(c.code,'ability',e.target.value)});
    const imI=h('input',{value:c.imageUrl||'', placeholder:'이미지 URL', oninput:e=>{
      mark(c.code,'imageUrl',e.target.value);
      img.src=e.target.value; img.style.display=e.target.value?'':'none';
    }});
    const img=h('img',{class:'mini', src:c.imageUrl||'', style:c.imageUrl?'':'display:none', onerror:e=>e.target.style.display='none'});
    const q = encodeURIComponent(`agricola ${c.nameEn||c.name}`);
    const bgg = h('a',{href:`https://www.google.com/search?tbm=isch&q=${q}`, target:'_blank', class:'bgg-link', title:'구글 이미지 검색'}, '🔍');
    return h('div',{class:'card-edit-row'},
      h('span',{class:'code'}, c.code),
      nameI, abI, imI, img, bgg);
  }
  const occRows = deck.occupations.map(rowFor);
  const minRows = deck.minorImprovements.map(rowFor);
  const saveBtn = h('button',{disabled:true, onclick:async()=>{
    const body={cards:[...changed.values()]};
    const rr=await fetch('/api/decks/'+deckId+'/patch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await rr.json();
    if (j.error) return showError(j.error);
    alert(`저장 완료: ${j.changed}개`);
    changed.clear(); saveBtn.disabled=true; saveBtn.textContent='변경사항 없음';
  }}, '변경사항 없음');
  const exportBtn=h('button',{class:'secondary', onclick:()=>{
    const rows=[['code','name','ability','imageUrl','deckId','kind']];
    for (const c of deck.occupations) rows.push([c.code,c.name,c.ability||'',c.imageUrl||'',deck.id,'occupations']);
    for (const c of deck.minorImprovements) rows.push([c.code,c.name,c.ability||'',c.imageUrl||'',deck.id,'minorImprovements']);
    const csv=rows.map(r=>r.map(x=>{
      const s=String(x==null?'':x);
      return /[,"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    }).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${deck.id}.csv`; a.click();
  }}, 'CSV 내보내기');
  app.append(h('div',{class:'card-panel'},
    h('div',{style:'display:flex;justify-content:space-between;align-items:center'},
      h('h2',{}, `카드 편집 · ${deck.name}`),
      h('div',{class:'actions'}, exportBtn, saveBtn, h('a',{href:'#/admin', class:'secondary', style:'padding:8px 12px;background:#eadfc4;text-decoration:none;color:var(--ink);border-radius:6px'}, '← 덱 목록'))
    ),
    h('div',{class:'hint'}, '컬럼: 코드 · 이름 · 능력 · 이미지URL. 변경 후 상단 "저장" 클릭.'),
    h('h3',{}, `직업 (${deck.occupations.length}장)`),
    occRows.length ? h('div',{}, occRows) : h('div',{class:'hint'}, '이 덱에 직업 카드 없음.'),
    h('h3',{}, `부속설비 (${deck.minorImprovements.length}장)`),
    minRows.length ? h('div',{}, minRows) : h('div',{class:'hint'}, '이 덱에 설비 카드 없음.'),
  ));
}

// ---------- Player Tier Board ----------
async function renderPlayers(){
  app.innerHTML='';
  const r=await fetch('/api/players'); const rows=await r.json();
  const N = rows.length;
  function tier(idx){
    if (idx < N*0.10) return 'S';
    if (idx < N*0.30) return 'A';
    if (idx < N*0.70) return 'B';
    if (idx < N*0.90) return 'C';
    return 'D';
  }
  rows.forEach((r,i)=>{ r.tier=tier(i); });
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '🏆 플레이어 티어보드'),
    h('div',{class:'hint'}, `총 ${N}명 · 종료된 드래프트에서 받은 평균 별점 + MVP - dud + 승리 횟수를 종합한 점수 기준. 점수 = 평균별점×2 + MVP×0.5 - dud×0.5 + 승리×1.`),
    N===0 ? h('div',{class:'hint', style:'margin-top:12px'}, '아직 완료된 드래프트가 없음. 방을 만들어 드래프트+투표를 마치면 이 표에 누적됨.') :
    h('table',{class:'stats'},
      h('thead',{}, h('tr',{},
        h('th',{},'티어'), h('th',{},'순위'), h('th',{},'닉네임'),
        h('th',{},'드래프트'), h('th',{},'평균★'), h('th',{},'MVP'), h('th',{},'dud'),
        h('th',{},'승리'), h('th',{},'종합점수')
      )),
      h('tbody',{}, rows.map((p,i)=>h('tr',{class:'tier-'+p.tier},
        h('td',{}, p.tier),
        h('td',{}, String(i+1)),
        h('td',{}, h('strong',{}, p.name)),
        h('td',{}, String(p.drafts||0)),
        h('td',{}, (p.avgRating||0).toFixed(2)+'★'),
        h('td',{}, String(p.mvpCount||0)),
        h('td',{}, String(p.dudCount||0)),
        h('td',{}, String(p.wins||0)),
        h('td',{}, (p.score||0).toFixed(2))
      )))
    )
  ));
}

// ---------- Deck Tier Board ----------
async function renderDeckTier(){
  app.innerHTML='';
  const r=await fetch('/api/deck-stats'); const rows=await r.json();
  const N = rows.length;
  function tier(idx){
    if (N<=2) return idx===0?'S':'B';
    if (idx < N*0.15) return 'S';
    if (idx < N*0.40) return 'A';
    if (idx < N*0.70) return 'B';
    if (idx < N*0.90) return 'C';
    return 'D';
  }
  rows.forEach((r,i)=>{ r.tier=tier(i); });
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '📚 덱 티어보드'),
    h('div',{class:'hint'}, '덱별 카드들의 평균 점수 · 픽률로 정렬. 어느 확장 덱이 가장 강력한지 누적 데이터 기반 판정.'),
    N===0 ? h('div',{class:'hint',style:'margin-top:12px'}, '아직 데이터 없음. 드래프트+투표를 마치면 카드에 점수가 매겨지고 덱 랭킹이 잡힘.') :
    h('table',{class:'stats'},
      h('thead',{}, h('tr',{},
        h('th',{},'티어'), h('th',{},'순위'), h('th',{},'덱'),
        h('th',{},'카드 수'), h('th',{},'총 등장'), h('th',{},'총 픽'),
        h('th',{},'픽률'), h('th',{},'MVP-dud'), h('th',{},'평균 카드 점수')
      )),
      h('tbody',{}, rows.map((d,i)=>h('tr',{class:'tier-'+d.tier},
        h('td',{}, d.tier),
        h('td',{}, String(i+1)),
        h('td',{}, h('strong',{}, d.deckName)),
        h('td',{}, String(d.cards||0)),
        h('td',{}, String(d.seen||0)),
        h('td',{}, String(d.picked||0)),
        h('td',{}, ((d.pickRate||0)*100).toFixed(0)+'%'),
        h('td',{}, String(d.mvpNet||0)),
        h('td',{}, (d.avgCardScore||0).toFixed(2))
      )))
    )
  ));
}

route();
