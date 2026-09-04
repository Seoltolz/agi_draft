// Parse compendium and build deck files. Bucket by letter prefix only.
// Card ability text is NOT copied from the source page; we fill short Korean
// mechanic summaries for well-known cards from a curated map below, leaving the
// rest with an empty `ability` field for admin bulk-edit in the app.
const https = require('https');
const fs = require('fs');
const path = require('path');

function fetch(url){
  return new Promise((res, rej)=>{
    https.get(url, r=>{
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d));
    }).on('error',rej);
  });
}

function bucket(code){
  const c = String(code).trim();
  if (/^\d+$/.test(c)) return 'wm';
  const letter = (c.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
  if ('AEIKGCZM'.includes(letter)) return letter.toLowerCase();
  return 'wm';
}

// Short Korean mechanic summaries WRITTEN FROM GAME KNOWLEDGE — not copied.
// These are broad mechanic tags; players see them as a hint, and can overwrite
// the full text in the admin page anytime.
const HINTS = require('./card_hints.json');

(async ()=>{
  const html = await fetch('https://alavigne.net/Gaming/Agricola/agricola-comp-v9.0.html');
  const impStart = html.indexOf('Improvements - Numerically');
  const impEnd = html.indexOf('Occupations - Numerically');
  const impBlock = html.slice(impStart, impEnd);
  const occBlock = html.slice(impEnd);

  function parse(block){
    const re = /<a\s+href="#[^"]+">\s*\(([^)]+)\)\s*([^<]+?)\s*<\/a>/g;
    const out = []; let m;
    while ((m = re.exec(block))){
      out.push({code: m[1].trim(), name: m[2].trim()});
    }
    return out;
  }
  const imp = parse(impBlock);
  const occ = parse(occBlock);
  console.error('improvements found:', imp.length, 'occupations found:', occ.length);

  const deckMeta = {
    a:  {name:'Base (A · 기본판)',       description:'Agricola 기본판 오리지널 카드 (A1~A10 개선물).'},
    e:  {name:'E-Deck (기본판 확장)',    description:'기본판 확장 E번 카드 (직업 + 부속설비).'},
    i:  {name:'I-Deck (기본판 확장)',    description:'기본판 확장 I번 카드 (직업 + 부속설비).'},
    k:  {name:'K-Deck (기본판 확장)',    description:'기본판 확장 K번 카드 (직업 + 부속설비).'},
    g:  {name:'G-Deck (Gamers Deck)',    description:'게이머스 덱 확장 (G번).'},
    c:  {name:'C-Deck (Complex Deck)',   description:'복잡 확장 (C번). 조합 카드.'},
    z:  {name:'Z-Deck (Z Deck)',         description:'Z번 미니 확장 (Z313~).'},
    m:  {name:'M-Deck (Farmers of the Moor)', description:'황무지 확장 (M번).'},
    wm: {name:'WM/기타 (Promo · World Championship)', description:'월드 챔피언십 및 프로모.'}
  };

  // Deterministic image URL scheme: friends fill via admin page or ini file later.
  // We leave imageUrl empty so nothing broken image-loads by default.
  function hint(code, name){
    return HINTS[code] || '';
  }

  const decks = {};
  function ensure(id){
    if (!decks[id]) decks[id] = { id, name: deckMeta[id]?.name||id, description: deckMeta[id]?.description||'', occupations:[], minorImprovements:[] };
    return decks[id];
  }
  for (const c of imp){
    const b = bucket(c.code);
    ensure(b).minorImprovements.push({code:c.code, name:c.name, ability: hint(c.code, c.name), imageUrl:''});
  }
  for (const c of occ){
    const b = bucket(c.code);
    ensure(b).occupations.push({code:c.code, name:c.name, ability: hint(c.code, c.name), imageUrl:''});
  }

  const outDir = path.join(__dirname, '..', 'data', 'decks');
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
  for (const [id, d] of Object.entries(decks)){
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(d, null, 2));
    console.error(`${id}.json: occ=${d.occupations.length}, min=${d.minorImprovements.length}`);
  }
})().catch(e=>{ console.error(e); process.exit(1); });
