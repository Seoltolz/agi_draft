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
  const selected=new Set();
  const deckGrid=h('div',{class:'grid decks'},
    DECKS.map(d=>{
      const card=h('div',{class:'deck-card', onclick:()=>{
        if (selected.has(d.id)) selected.delete(d.id); else selected.add(d.id);
        card.classList.toggle('selected');
      }},
        h('div',{}, h('strong',{}, d.name)),
        h('div',{}, h('small',{}, d.description||'')),
        h('div',{style:'margin-top:6px'}, h('small',{}, `직업 ${d.occupations} · 설비 ${d.minorImprovements}`)),
      );
      return card;
    })
  );
  const createBtn=h('button',{onclick:()=>{
    const name=nameInput.value.trim();
    if (!name) return showError('닉네임을 입력하세요.');
    if (selected.size===0) return showError('덱을 1개 이상 선택.');
    store.set('name', name);
    socket.emit('createRoom', {name, deckIds:[...selected], cardsPerHand:Number(cphInput.value)||7}, r=>{
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
      ),
      h('h3',{}, '덱 선택 (여러 개 조합 가능)'),
      deckGrid,
      h('div',{class:'hint', style:'margin-top:6px'}, `총 카드 (선택된 덱) 여러 개 선택하면 풀이 커집니다. 한손 7장 × 4인 = 필요 28장. 부족시 방 시작 실패.`),
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
        h('li',{}, '직업 라운드 끝나면 자동 부속설비 라운드.'),
        h('li',{}, '드래프트 종료 → 서로 서로에게 별점 + MVP/dud 카드 투표.'),
        h('li',{}, `투표 결과는 카드 티어/통계 페이지로 누적.`),
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

socket.on('state', view=>{
  STATE=view;
  if (!location.hash.startsWith('#/room/')) return;
  const roomHash=`#/room/${view.room.id}`;
  if (location.hash!==roomHash) location.hash=roomHash;
  drawRoom(view);
});

function cardEl(c, opts={}){
  const {clickable=false, onClick=null, disabled=false} = opts;
  const abil = c.ability ? h('div',{class:'ability'}, c.ability) : h('div',{class:'ability hint'}, '(능력 미입력)');
  const meta = [];
  if (c.cost && c.cost !== '-') meta.push('💰 '+c.cost);
  if (c.vp && c.vp !== '-') meta.push('★ '+c.vp+'점');
  if (c.condition && c.condition !== '-') meta.push('조건: '+c.condition);
  const metaEl = meta.length ? h('div',{class:'meta'}, meta.join(' · ')) : null;
  const img = c.imageUrl
    ? h('div',{class:'imgwrap'},
        h('img',{src:c.imageUrl, loading:'lazy', onerror:e=>e.target.style.display='none'}),
        h('button',{class:'zoom', onclick:e=>{ e.stopPropagation(); openModal(h('div',{},
          h('h3',{}, `${c.name} (${c.code})`),
          h('img',{src:c.imageUrl}),
          c.ability?h('p',{}, c.ability):null,
        )); }}, '확대'))
    : null;
  return h('div',{
    class:'mini-card'+(disabled?' disabled':''),
    onclick: clickable && !disabled && onClick ? onClick : null,
    title: `${c.name} (${c.code})${c.ability?'\n'+c.ability:''}`,
  }, img,
     h('div',{class:'code'}, `${c.code} · `, h('span',{class:'deck-tag'}, c.deckId||''),
       c.nameEn?h('span',{class:'en'}, ' · '+c.nameEn):null),
     h('div',{class:'name'}, c.name),
     metaEl,
     abil,
  );
}

function drawRoom(view){
  const {room, me, others, log, voting}=view;
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
    app.append(h('div',{class:'card-panel'},
      h('h3',{},
        h('span',{class:'phase-tag'+(room.phase==='minors'?' min':'')}, phaseLabel),
        `라운드 ${room.round} / ${room.cardsPerHand}`,
        h('span',{class:'round-badge'}, me.hasPickedThisRound?'픽 완료':'대기 중'),
      ),
      h('div',{class:'hint'}, '내 손에서 1장 클릭해 픽. 모두 픽하면 자동 진행.'),
      h('h3',{}, `내 손 (${me.hand.length}장)`),
      h('div',{class:'grid cards'},
        (me.hand||[]).map(c => cardEl(c, {clickable:true, disabled:me.hasPickedThisRound,
          onClick:()=>socket.emit('pickCard',{cardCode:c.code}, r=>{ if(r?.error) showError(r.error); })}))),
      h('h3',{}, '내 픽'),
      h('div',{class:'picked-list'},
        (me.picked||[]).map(c=>h('span',{class:'pick-pill '+(c.phase==='occupations'?'occ':'min'),
          onclick:()=>openModal(h('div',{}, h('h3',{}, `${c.name} (${c.code})`),
            c.imageUrl?h('img',{src:c.imageUrl}):null,
            h('p',{}, c.ability||'(능력 미입력)')))}, c.name))),
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
  const submit = ()=>{
    socket.emit('vote', {
      playerScores:scores, mvpCards:[...mvpSet], dudCards:[...dudSet]
    }, r=>{ if (r?.error) showError(r.error); else alert('투표 제출됨. 다른 사람 다 하면 자동 마감.'); });
  };
  const panel = h('div',{class:'card-panel'},
    h('h2',{}, '드래프트 종료 → 투표'),
    h('div',{class:'hint'}, '각 상대 플레이어의 빌드에 1~5점을 매기고, MVP 카드/dud 카드에 클릭해 표시. 모두 제출하면 자동 마감 · 호스트는 즉시 마감 가능.'),
    room.players.filter(p=>me && p.id!==me.id).map(p=>{
      const other = (others||[]).find(o=>o.id===p.id);
      const picks = other ? other.picked||[] : [];
      return h('div',{style:'margin-bottom:14px;border:1px solid var(--border);border-radius:8px;padding:10px;background:#fff'},
        h('div',{style:'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap'},
          h('strong',{}, p.name),
          h('div',{class:'rate'},
            [1,2,3,4,5].map(n=>h('button',{class:scores[p.id]===n?'on':'', onclick:()=>{ scores[p.id]=n; drawRoom(STATE); }}, n+'★'))
          )
        ),
        h('div',{style:'margin-top:6px'}, h('span',{class:'hint'}, 'MVP는 골드, dud는 빨강. 다시 누르면 해제.')),
        h('div',{class:'picked-list', style:'margin-top:6px'},
          picks.map(c=>{
            const isMvp=mvpSet.has(c.code), isDud=dudSet.has(c.code);
            return h('span',{
              class:'pick-pill '+(c.phase==='occupations'?'occ':'min')+(isMvp?' mvp':'')+(isDud?' dud':''),
              onclick:e=>{
                if (e.shiftKey){
                  if (dudSet.has(c.code)) dudSet.delete(c.code); else { dudSet.add(c.code); mvpSet.delete(c.code); }
                } else {
                  if (mvpSet.has(c.code)) mvpSet.delete(c.code); else { mvpSet.add(c.code); dudSet.delete(c.code); }
                }
                drawRoom(STATE);
              }, title:'클릭=MVP, Shift+클릭=dud'
            }, c.name);
          })
        )
      );
    }),
    h('div',{style:'margin-top:10px'},
      h('button',{onclick:submit}, '내 투표 제출'),
      room.hostId===me?.id ? h('button',{class:'secondary', style:'margin-left:8px', onclick:()=>socket.emit('closeVoting',{},r=>{})}, '호스트: 지금 마감') : null,
    )
  );
  app.append(panel);
}

function renderResults(room, me, others){
  const tally = STATE?.voting?.results || null;
  app.append(h('div',{class:'card-panel'},
    h('h2',{}, '결과'),
    h('div',{class:'hint'}, '카드 티어/통계 페이지에서 누적 결과를 볼 수 있음.'),
    h('div',{style:'margin-top:8px'},
      h('a',{href:'#/stats'}, '티어/통계 →'),
      ' · ',
      h('a',{href:'#/history'}, '기록 →'),
    ),
    h('h3',{}, '플레이어별 픽'),
    room.players.map(p=>{
      const player = (others||[]).find(o=>o.id===p.id) || (me && me.id===p.id?me:null);
      const picks = player ? (player.picked||[]) : [];
      return h('div',{style:'margin-bottom:10px'},
        h('div',{}, h('strong',{}, p.name)),
        h('div',{class:'picked-list'},
          picks.map(c=>h('span',{class:'pick-pill '+(c.phase==='occupations'?'occ':'min')}, c.name))
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
    return h('div',{class:'card-edit-row'},
      h('span',{class:'code'}, c.code),
      nameI, abI, imI, img);
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
