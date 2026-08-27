import { SOURCES } from './data/sources.js';

const DB_NAME='pet-grooming-cram-db';
const DB_VERSION=1;
const STORE_Q='questions';
const STORE_P='progress';
const STORE_M='meta';
const LETTERS=['A','B','C','D'];
const APP_VERSION='v4';
const BUNDLED_PROF_URL='./data/professional-13900.json';
const SECTION_NAMES=Object.fromEntries(SOURCES.professional.sections.map(([code,name])=>[code,name]));
const COMMON_NAMES=Object.fromEntries(SOURCES.common.map(x=>[x.code,x.label]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const dayMs=86400000;
const fmtDate=(d)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric'}).format(new Date(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const shuffle=(arr)=>{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const sample=(arr,n)=>shuffle(arr).slice(0,Math.min(n,arr.length));
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let db;
let deferredInstall;
let state={view:'home',questions:[],progress:new Map(),meta:{},session:null,historyMode:false};

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE_Q))d.createObjectStore(STORE_Q,{keyPath:'id'});if(!d.objectStoreNames.contains(STORE_P))d.createObjectStore(STORE_P,{keyPath:'id'});if(!d.objectStoreNames.contains(STORE_M))d.createObjectStore(STORE_M,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store);}
function getAll(store){return new Promise((resolve,reject)=>{const r=tx(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
function put(store,obj){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').put(obj);r.onsuccess=()=>resolve(obj);r.onerror=()=>reject(r.error);});}
function del(store,key){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
async function bulkPut(store,items){if(!items.length)return;return new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');const s=t.objectStore(store);for(const x of items)s.put(x);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
async function clearStore(store){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').clear();r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
async function setMeta(key,value){state.meta[key]=value;await put(STORE_M,{key,value});}
function getMeta(key,fallback=null){return state.meta[key] ?? fallback;}

function defaultProgress(id){return {id,attempts:0,correct:0,wrong:0,streak:0,level:0,lastAt:null,nextDue:null,lastAnswer:null,guessed:0,starred:false,history:[]};}
function getProgress(id){return state.progress.get(id)||defaultProgress(id);}
async function saveProgress(p){state.progress.set(p.id,p);await put(STORE_P,p);}

function toast(msg){const el=document.querySelector('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2500);}
function pct(n,d){return d?Math.round(n/d*100):0;}

function normalizeText(s){return String(s||'').replace(/Page\s*\d+\s*of\s*\d+/gi,' ').replace(/\s+/g,' ').replace(/\s+([，。！？；：])/g,'$1').trim();}

async function loadPdfJs(){
  if(window.__pdfjs)return window.__pdfjs;
  const mod=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  window.__pdfjs=mod;return mod;
}
async function pdfToText(buffer,onProgress=()=>{}){
  const pdfjs=await loadPdfJs();
  const doc=await pdfjs.getDocument({data:buffer}).promise;
  let out='';
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p);const c=await page.getTextContent();
    out+=' '+c.items.map(i=>i.str).join(' ')+' ';
    onProgress(p,doc.numPages);
  }
  return normalizeText(out);
}
function parseProfessionalText(raw){
  // PDF.js 對少數題目的括號、句點會拆成不同文字節點；解析時必須容許空格、全形符號與頁尾黏連。
  const text=normalizeText(raw)
    .replace(/13900\s*寵物美容\s*丙級/g,' 13900 寵物美容 丙級 ')
    .replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[．]/g,'.');
  const marker='(\\d{1,3})\\s*\\.\\s*\\(\\s*([1-4])\\s*\\)';
  const headerRe=new RegExp(`13900\\s*寵物美容\\s*丙級\\s*工作項目\\s*(0[1-6])\\s*[：:]\\s*([\\s\\S]*?)(?=\\s+${marker})`,'g');
  const headers=[];let m;
  while((m=headerRe.exec(text)))headers.push({code:m[1],name:normalizeText(m[2]),start:m.index,bodyStart:headerRe.lastIndex});
  const questions=[];
  for(let h=0;h<headers.length;h++){
    const sec=headers[h];const end=h+1<headers.length?headers[h+1].start:text.length;const body=text.slice(sec.bodyStart,end);
    // 先找每一題的起點，再依下一題起點切內容，比單一大型 regex 對 PDF 斷頁更穩。
    const startRe=/(?:^|\s)(\d{1,3})\s*\.\s*\(\s*([1-4])\s*\)/g;
    const starts=[];let sm;
    while((sm=startRe.exec(body)))starts.push({number:Number(sm[1]),answer:Number(sm[2]),start:sm.index,contentStart:startRe.lastIndex});
    const expected=Number((SOURCES.professional.sections.find(x=>x[0]===sec.code)||[])[2]||0);
    for(let i=0;i<starts.length;i++){
      const cur=starts[i];
      // 題號超出該工作項目範圍通常是頁碼/內文數字被誤判，直接略過。
      if(!cur.number || (expected && cur.number>expected)) continue;
      const next=i+1<starts.length?starts[i+1].start:body.length;
      const content=body.slice(cur.contentStart,next);
      const parts=content.split(/[①②③④]/);
      let prompt=normalizeText(parts.shift());let options=parts.slice(0,4).map(normalizeText);
      if(options.length<4){options=[...options,...Array(4-options.length).fill('〔圖示／原題選項〕')];}
      if(prompt){questions.push({id:`13900-${sec.code}-${String(cur.number).padStart(3,'0')}`,subjectCode:'13900',kind:'professional',section:sec.code,sectionName:SECTION_NAMES[sec.code]||sec.name,number:cur.number,prompt,options,answer:cur.answer,source:'13900-public-pdf',active:true,imageLikely:options.some(x=>x==='〔圖示／原題選項〕')});}
    }
  }
  return dedupeQuestions(questions);
}

function professionalDiagnostics(qs){
  const parts=[];
  for(const [code,,expected] of SOURCES.professional.sections){
    const nums=new Set(qs.filter(q=>q.section===code).map(q=>q.number));
    const missing=[];for(let n=1;n<=expected;n++)if(!nums.has(n))missing.push(n);
    parts.push(`${code}:${nums.size}/${expected}${missing.length?`（缺 ${missing.join('、')}）`:''}`);
  }
  return parts.join('；');
}
function parseCommonText(raw,source){
  const text=normalizeText(raw);const qRe=/(\d{1,3})\.\s*\(([1-4])\)\s*([\s\S]*?)(?=\s+\d{1,3}\.\s*\([1-4]\)|$)/g;const arr=[];let q;
  while((q=qRe.exec(text))){
    const number=Number(q[1]),answer=Number(q[2]);const parts=q[3].split(/[①②③④]/);const prompt=normalizeText(parts.shift());let options=parts.slice(0,4).map(normalizeText);
    if(options.length<4) continue;
    if(prompt)arr.push({id:`${source.code}-01-${String(number).padStart(3,'0')}`,subjectCode:source.code,kind:'common',section:'01',sectionName:source.label,number,prompt,options,answer,source:`github-${source.version}`,active:true});
  }
  return dedupeQuestions(arr);
}
function dedupeQuestions(arr){const m=new Map();for(const q of arr)m.set(q.id,q);return [...m.values()].sort((a,b)=>a.id.localeCompare(b.id));}

async function fetchBuffer(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.arrayBuffer();}
async function fetchProfessionalBuffer(){
  const url=SOURCES.professional.publicPdf;
  try{return await fetchBuffer(url);}catch(e){
    const proxy=`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    return fetchBuffer(proxy);
  }
}
async function loadBundledProfessional(status=()=>{}){
  status('載入內建 13900 專業題庫…');
  const r=await fetch(BUNDLED_PROF_URL,{cache:'no-store'});
  if(!r.ok)throw new Error(`內建題庫 HTTP ${r.status}`);
  const data=await r.json();
  const qs=Array.isArray(data?.questions)?data.questions:[];
  if(qs.length!==SOURCES.professional.expected)throw new Error(`內建題庫只有 ${qs.length}/${SOURCES.professional.expected} 題`);
  for(const [code,,expected] of SOURCES.professional.sections){
    const sec=qs.filter(q=>q.section===code);
    const nums=new Set(sec.map(q=>Number(q.number)));
    if(sec.length!==expected||nums.size!==expected)throw new Error(`內建題庫工作項目 ${code} 不完整：${sec.length}/${expected}`);
    for(let n=1;n<=expected;n++)if(!nums.has(n))throw new Error(`內建題庫工作項目 ${code} 缺第 ${n} 題`);
  }
  const bad=qs.find(q=>!q.id||!q.prompt||!Array.isArray(q.options)||q.options.length!==4||!q.options.every(Boolean)||![1,2,3,4].includes(Number(q.answer)));
  if(bad)throw new Error(`內建題庫格式異常：${bad.id||'未知題號'}`);
  await replaceQuestionKind('professional',qs);
  await setMeta('professionalSync',{at:new Date().toISOString(),count:qs.length,source:'bundled-pdf-verified',version:data.sourceFile||'題庫.pdf'});
  status(`專業題庫已修復：${qs.length}/647`);
  return qs;
}
async function importProfessionalBuffer(buffer,status){
  status('正在解析專業題庫 PDF…');
  const text=await pdfToText(buffer,(p,n)=>status(`解析專業題庫：${p}/${n} 頁`));
  const qs=parseProfessionalText(text);
  const counts=Object.fromEntries(SOURCES.professional.sections.map(([c])=>[c,qs.filter(q=>q.section===c).length]));
  if(qs.length!==SOURCES.professional.expected) throw new Error(`解析到 ${qs.length}/${SOURCES.professional.expected} 題。${professionalDiagnostics(qs)}。請勿使用不完整題庫；此版本會阻止殘缺題庫覆蓋原資料。`);
  await replaceQuestionKind('professional',qs);
  await setMeta('professionalSync',{at:new Date().toISOString(),count:qs.length,counts,source:'13900-public-pdf'});
  return qs;
}
async function syncOneCommon(src,status){
  status(`下載 ${src.label}…`);const buf=await fetchBuffer(src.url);const text=await pdfToText(buf,(p,n)=>status(`${src.label}：${p}/${n} 頁`));const qs=parseCommonText(text,src);
  if(qs.length<80)throw new Error(`${src.label} 只解析到 ${qs.length} 題`);
  const existing=state.questions.filter(q=>q.kind!=='common'||q.subjectCode!==src.code);
  state.questions=[...existing,...qs];
  const old=(await getAll(STORE_Q)).filter(q=>q.kind==='common'&&q.subjectCode===src.code);for(const q of old)await del(STORE_Q,q.id);
  await bulkPut(STORE_Q,qs);await setMeta(`commonSync:${src.code}`,{at:new Date().toISOString(),count:qs.length,version:src.version});return qs;
}
async function replaceQuestionKind(kind,qs){
  const all=await getAll(STORE_Q);const old=all.filter(q=>q.kind===kind);for(const q of old)await del(STORE_Q,q.id);await bulkPut(STORE_Q,qs);state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);
}

function bankInfo(){
  const p=state.questions.filter(q=>q.kind==='professional');const common=state.questions.filter(q=>q.kind==='common');
  const byCommon=Object.fromEntries(SOURCES.common.map(s=>[s.code,common.filter(q=>q.subjectCode===s.code).length]));
  return {professional:p.length,common:common.length,byCommon,readyProfessional:p.length>=647,readyCommon:SOURCES.common.every(s=>(byCommon[s.code]||0)>=90)};
}
function attempts(){return [...state.progress.values()].reduce((s,p)=>s+p.attempts,0);}
function answeredUnique(){return [...state.progress.values()].filter(p=>p.attempts>0).length;}
function overallCorrect(){let a=0,c=0;for(const p of state.progress.values()){a+=p.attempts;c+=p.correct;}return {a,c,rate:pct(c,a)};}
function dueQuestions(){const now=Date.now();return state.questions.filter(q=>{const p=getProgress(q.id);return p.nextDue&&new Date(p.nextDue).getTime()<=now;});}
function wrongQuestions(){return state.questions.filter(q=>getProgress(q.id).wrong>0&&getProgress(q.id).level<5);}
function unseen(kind){return state.questions.filter(q=>(!kind||q.kind===kind)&&getProgress(q.id).attempts===0);}
function streakDays(){
  const dates=new Set([...state.progress.values()].flatMap(p=>(p.history||[]).map(h=>h.date)).filter(Boolean));let d=new Date(`${today()}T12:00:00+08:00`),n=0;
  while(true){const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(d);if(!dates.has(key))break;n++;d=new Date(d.getTime()-dayMs);}return n;
}
function categoryStats(){
  const cats={};for(const q of state.questions){const key=q.kind==='professional'?q.sectionName:q.sectionName;cats[key]??={name:key,attempts:0,correct:0,wrong:0,total:0,seen:0};cats[key].total++;const p=getProgress(q.id);cats[key].attempts+=p.attempts;cats[key].correct+=p.correct;cats[key].wrong+=p.wrong;if(p.attempts)cats[key].seen++;}
  return Object.values(cats).map(x=>({...x,rate:pct(x.correct,x.attempts)})).sort((a,b)=>(a.attempts? a.rate:101)-(b.attempts?b.rate:101));
}
function todaysHistory(){return [...state.progress.values()].flatMap(p=>(p.history||[]).filter(h=>h.date===today()).map(h=>({...h,id:p.id})));}
function todaysSummary(){const h=todaysHistory();return {count:h.length,correct:h.filter(x=>x.correct).length,wrong:h.filter(x=>!x.correct).length,rate:pct(h.filter(x=>x.correct).length,h.length)};}

function dailyPlan(){
  const newPro=Number(getMeta('dailyProfessional',50));const newCommon=Number(getMeta('dailyCommon',10));const due=dueQuestions();
  const proPool=unseen('professional');const comPool=unseen('common');
  return {proTarget:newPro,commonTarget:newCommon,dueCount:due.length,proRemaining:Math.min(newPro,proPool.length),commonRemaining:Math.min(newCommon,comPool.length)};
}
function buildDailySession(){
  const plan=dailyPlan();const due=sample(dueQuestions(),Math.min(30,dueQuestions().length));
  const pro=sample(unseen('professional').filter(q=>!due.some(d=>d.id===q.id)),plan.proTarget);
  const com=sample(unseen('common').filter(q=>!due.some(d=>d.id===q.id)),plan.commonTarget);
  return [...due,...pro,...com];
}

async function recordAnswer(q,chosen,guessed=false){
  const trackId=q.originId||q.id;
  const p={...getProgress(trackId)};const correct=chosen===q.answer;p.attempts++;p.lastAnswer=chosen;p.lastAt=new Date().toISOString();p.history=[...(p.history||[]),{date:today(),at:p.lastAt,chosen,answer:q.answer,correct,guessed}].slice(-60);
  if(correct){p.correct++;p.streak=(p.streak||0)+1;if(guessed)p.guessed=(p.guessed||0)+1;const maxLevel=guessed?Math.min(p.level,2):Math.min(5,(p.level||0)+1);p.level=maxLevel;const intervals=guessed?[1,1,2,3,5,7]:[1,3,7,14,30,60];p.nextDue=new Date(Date.now()+intervals[p.level||0]*dayMs).toISOString();}
  else{p.wrong++;p.streak=0;p.level=0;p.nextDue=new Date(Date.now()+dayMs).toISOString();}
  await saveProgress(p);return correct;
}

function renderHome(){
  const v=document.querySelector('#view-home');const b=bankInfo();const daily=todaysSummary();const plan=dailyPlan();const oc=overallCorrect();const cats=categoryStats().filter(x=>x.attempts>=3);const weak=cats[0];
  const ready=b.readyProfessional;
  v.innerHTML=`
    <div class="hero">
      <div class="eyebrow" style="color:#ded9ff">TODAY'S CLASS</div>
      <h2>${daily.count?`今天已完成 ${daily.count} 題`:'今天的作業還沒寫'}</h2>
      <p>${daily.count?`今日正確率 ${daily.rate}%${daily.wrong?`，錯 ${daily.wrong} 題等你檢討`: '，目前全對！'}`:'每天把新題吃掉，再把昨天錯的追回來。'}</p>
      <div class="metrics"><div class="metric"><b>${streakDays()}</b><small>連續天數</small></div><div class="metric"><b>${answeredUnique()}</b><small>已碰過題目</small></div><div class="metric"><b>${oc.rate}%</b><small>累積正確率</small></div></div>
    </div>
    ${!ready?`<div class="banner"><b>先完成題庫同步</b><br><span class="small-text">目前專業題 ${b.professional}/647、共同題 ${b.common}。同步完整後才會開啟正式每日作業與模擬考。</span><div style="margin-top:10px"><button id="openSync" class="primary small">同步題庫</button></div></div>`:''}
    <div class="section-title"><h2>今天作業</h2><span class="pill">每日自動排課</span></div>
    <div class="card">
      <div class="task"><div><b>專業新題</b><span class="muted small-text">647 題作業池</span></div><span class="pill ${unseen('professional').length?'':'good'}">${Math.min(plan.proTarget,unseen('professional').length)} 題</span></div>
      <div class="task"><div><b>共同科目</b><span class="muted small-text">職安／倫理／環保／節能</span></div><span class="pill">${Math.min(plan.commonTarget,unseen('common').length)} 題</span></div>
      <div class="task"><div><b>到期複習</b><span class="muted small-text">答錯、猜對、間隔複習</span></div><span class="pill ${plan.dueCount?'bad':'good'}">${plan.dueCount} 題</span></div>
      <button id="startDaily" class="primary wide" style="margin-top:14px" ${!ready?'disabled':''}>開始今天的作業</button>
    </div>
    <div class="grid2">
      <div class="card"><h3>647 題進度</h3><p class="muted small-text">專業題已做 ${state.questions.filter(q=>q.kind==='professional'&&getProgress(q.id).attempts>0).length} / ${b.professional||647}</p><div class="progress"><i style="width:${pct(state.questions.filter(q=>q.kind==='professional'&&getProgress(q.id).attempts>0).length,b.professional||647)}%"></i></div></div>
      <div class="card"><h3>老師提醒</h3><p class="muted small-text">${weak?`目前最需要加強：<b>${esc(weak.name)}</b>（${weak.rate}%）`:'先把題庫同步並開始作答，我才有足夠資料抓你的弱點。'}</p></div>
    </div>
    <div class="section-title"><h2>快速入口</h2></div>
    <div class="grid2"><button id="goReview" class="secondary">今日錯題檢討 (${todaysSummary().wrong})</button><button id="goHistory" class="ghost">歷屆試題</button></div>
    <div class="section-title"><h2>題庫狀態</h2><button id="settingsBtn" class="ghost small">設定</button></div>
    <div class="card"><div class="task"><div><b>專業 13900</b><span class="muted small-text">6 個工作項目</span></div><span class="pill ${b.professional>=647?'good':'warn'}">${b.professional}/647</span></div>${SOURCES.common.map(s=>`<div class="task"><div><b>${s.label}</b><span class="muted small-text">${s.code} · ${s.version}</span></div><span class="pill ${(b.byCommon[s.code]||0)>=90?'good':'warn'}">${b.byCommon[s.code]||0}</span></div>`).join('')}</div>`;
  v.querySelector('#openSync')?.addEventListener('click',()=>openSyncDialog());
  v.querySelector('#startDaily')?.addEventListener('click',()=>startQuiz(buildDailySession(),'daily','今天作業'));
  v.querySelector('#goReview').addEventListener('click',()=>navigate('review'));
  v.querySelector('#goHistory').addEventListener('click',()=>renderHistory(true));
  v.querySelector('#settingsBtn').addEventListener('click',()=>renderSettings(true));
}

function renderStudy(){
  const v=document.querySelector('#view-study');const b=bankInfo();
  v.innerHTML=`<div class="section-title"><h2>自由刷題</h2><span class="pill">${b.professional+b.common} 題已載入</span></div>
  <div class="card"><h3>專業科目</h3><p class="muted small-text">可以只刷某個工作項目；系統仍會記錄錯題與熟練度。</p><div class="stack">${SOURCES.professional.sections.map(([code,name,count])=>{const qs=state.questions.filter(q=>q.kind==='professional'&&q.section===code);const seen=qs.filter(q=>getProgress(q.id).attempts).length;return `<button class="categoryBtn ghost" data-kind="professional" data-code="${code}"><b>${code} ${esc(name)}</b><br><span class="small-text muted">${seen}/${qs.length||count} 已做</span></button>`}).join('')}</div></div>
  <div class="card"><h3>共同科目</h3><div class="stack">${SOURCES.common.map(s=>{const qs=state.questions.filter(q=>q.subjectCode===s.code);return `<button class="categoryBtn ghost" data-kind="common" data-code="${s.code}">${esc(s.label)} <span class="small-text muted">${qs.length} 題</span></button>`}).join('')}</div></div>
  <div class="card"><h3>特殊練習</h3><div class="grid2"><button id="unseenBtn" class="secondary">只做沒看過的</button><button id="randomBtn" class="secondary">隨機 30 題</button><button id="starBtn" class="ghost">收藏題</button><button id="searchBtn" class="ghost">搜尋題目</button></div><div id="searchBox" style="display:none;margin-top:12px"><input id="searchInput" placeholder="輸入犬種、疾病、法規…" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px"><div id="searchResults"></div></div></div>`;
  v.querySelectorAll('.categoryBtn').forEach(btn=>btn.addEventListener('click',()=>{const kind=btn.dataset.kind,code=btn.dataset.code;const pool=kind==='professional'?state.questions.filter(q=>q.kind==='professional'&&q.section===code):state.questions.filter(q=>q.subjectCode===code);startQuiz(sample(pool,30),'practice',btn.textContent.trim());}));
  v.querySelector('#unseenBtn').onclick=()=>startQuiz(sample(unseen(),30),'practice','未作答練習');
  v.querySelector('#randomBtn').onclick=()=>startQuiz(sample(state.questions,30),'practice','隨機 30 題');
  v.querySelector('#starBtn').onclick=()=>startQuiz(state.questions.filter(q=>getProgress(q.id).starred),'practice','收藏題');
  v.querySelector('#searchBtn').onclick=()=>{const box=v.querySelector('#searchBox');box.style.display=box.style.display==='none'?'block':'none';};
  v.querySelector('#searchInput').oninput=(e)=>{const s=e.target.value.trim().toLowerCase();const r=v.querySelector('#searchResults');if(s.length<2){r.innerHTML='';return;}const hits=state.questions.filter(q=>(q.prompt+' '+q.options.join(' ')).toLowerCase().includes(s)).slice(0,30);r.innerHTML=hits.map(q=>`<button class="searchHit ghost wide" data-id="${q.id}" style="margin-top:8px;text-align:left">${esc(q.prompt.slice(0,70))}</button>`).join('');r.querySelectorAll('.searchHit').forEach(b=>b.onclick=()=>startQuiz([state.questions.find(q=>q.id===b.dataset.id)],'practice','搜尋結果'));};
}

function renderReview(){
  const v=document.querySelector('#view-review');const todayWrongIds=[...new Set(todaysHistory().filter(x=>!x.correct).map(x=>x.id))];const todayWrong=state.questions.filter(q=>todayWrongIds.includes(q.id));const due=dueQuestions();const wrong=wrongQuestions();
  v.innerHTML=`<div class="section-title"><h2>錯題與檢討</h2><span class="pill bad">${wrong.length} 題待克服</span></div>
  <div class="card"><h3>今天的錯題</h3><p class="muted">${todayWrong.length?`今天有 ${todayWrong.length} 題答錯。當天再做一次，記憶最有效。`:'今天目前沒有錯題。'}</p><button id="todayReview" class="primary wide" ${!todayWrong.length?'disabled':''}>開始今日檢討 (${todayWrong.length})</button></div>
  <div class="card"><h3>到期複習</h3><p class="muted">包含曾答錯、標記「猜的」，以及依間隔複習排到今天的題目。</p><button id="dueReview" class="secondary wide" ${!due.length?'disabled':''}>複習到期題 (${due.length})</button></div>
  <div class="card"><h3>重點錯題</h3>${wrong.length?wrong.slice(0,12).map(q=>{const p=getProgress(q.id);return `<div class="task"><div><b>${esc(q.prompt.slice(0,54))}${q.prompt.length>54?'…':''}</b><span class="muted small-text">錯 ${p.wrong} 次 · ${esc(q.sectionName)}</span></div><span class="pill bad">Lv.${p.level}</span></div>`}).join(''):'<div class="empty">還沒有累積錯題</div>'}<button id="allWrong" class="ghost wide" ${!wrong.length?'disabled':''}>只刷所有錯題</button></div>`;
  v.querySelector('#todayReview').onclick=()=>startQuiz(todayWrong,'review','今日錯題檢討');
  v.querySelector('#dueReview').onclick=()=>startQuiz(due,'review','到期複習');
  v.querySelector('#allWrong').onclick=()=>startQuiz(sample(wrong,50),'review','錯題加強');
}

function renderExam(){
  const v=document.querySelector('#view-exam');const b=bankInfo();const past=getMeta('mockResults',[]);const ready=b.readyProfessional&&b.readyCommon;
  v.innerHTML=`<div class="section-title"><h2>正式模擬考</h2><span class="pill">80 題 · 100 分鐘</span></div>
  <div class="card"><h3>照丙級結構出題</h3><p class="muted">專業科目 64 題＋共同科目 16 題（四科各 4 題）。每題 1.25 分，60 分及格。模考交卷前不顯示答案。</p>${!ready?'<div class="banner">共同科目尚未完整同步，正式模考暫時鎖定。</div>':''}<button id="mockBtn" class="primary wide" ${!ready?'disabled':''}>開始 100 分鐘模擬考</button></div>
  <div class="card"><h3>歷次成績</h3>${past.length?past.slice().reverse().slice(0,8).map(r=>`<div class="task"><div><b>${r.score} 分 ${r.score>=60?'及格':'未及格'}</b><span class="muted small-text">${fmtDate(r.at)} · ${r.correct}/80 題</span></div><span class="pill ${r.score>=60?'good':'bad'}">${r.score>=60?'PASS':'RETRY'}</span></div>`).join(''):'<div class="empty">還沒有模擬考紀錄</div>'}</div><button id="historyFromExam" class="ghost wide">看歷屆試題</button>`;
  v.querySelector('#mockBtn').onclick=()=>startMockExam();v.querySelector('#historyFromExam').onclick=()=>renderHistory(true);
}
function buildMock(){const pro=sample(state.questions.filter(q=>q.kind==='professional'),64);let com=[];for(const s of SOURCES.common)com.push(...sample(state.questions.filter(q=>q.subjectCode===s.code),4));return shuffle([...pro,...com]);}
function startMockExam(){const qs=buildMock();startQuiz(qs,'mock','正式模擬考',{seconds:100*60,noFeedback:true});}

function historyMetaKey(id){return `historyPaper:${id}`;}
function compactMatchText(s){return String(s||'').toLowerCase().replace(/page\s*\d+\s*of\s*\d+/g,'').replace(/[\s_＿，。！？、；：:「」『』（）()【】\[\]〈〉《》．·‧,.;!?"'`~～\-—]/g,'');}
function diceSimilarity(a,b){a=compactMatchText(a);b=compactMatchText(b);if(!a||!b)return 0;if(a===b)return 1;if(a.length<2||b.length<2)return a===b?1:0;const grams=new Map();for(let i=0;i<a.length-1;i++){const g=a.slice(i,i+2);grams.set(g,(grams.get(g)||0)+1);}let hits=0;for(let i=0;i<b.length-1;i++){const g=b.slice(i,i+2),n=grams.get(g)||0;if(n){hits++;grams.set(g,n-1);}}return 2*hits/((a.length-1)+(b.length-1));}
async function fetchTextWithFallback(url){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}catch(e){const proxy=`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;const r=await fetch(proxy,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}}
function parseHistoricalHtml(html,src){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const candidates=[...doc.querySelectorAll('a')].map(a=>normalizeText(a.textContent)).filter(t=>/^\d{1,2}\.\s*/.test(t)&&/\(A\)/.test(t)&&/\(B\)/.test(t)&&/\(C\)/.test(t)&&/\(D\)/.test(t));
  const found=new Map();
  for(const line of candidates){const m=line.match(/^(\d{1,2})\.\s*([\s\S]*?)\s*\(A\)\s*([\s\S]*?)\s*\(B\)\s*([\s\S]*?)\s*\(C\)\s*([\s\S]*?)\s*\(D\)\s*([\s\S]*?)$/);if(!m)continue;const n=Number(m[1]);const options=m.slice(3,7).map(normalizeText);if(!n||options.some(x=>!x))continue;found.set(n,{id:`history-${src.id}-${String(n).padStart(3,'0')}`,kind:'history',subjectCode:'13900',section:src.id,sectionName:src.label,number:n,prompt:normalizeText(m[2]),options,answer:null,originId:null,source:`history-${src.id}`,active:true});}
  return [...found.values()].sort((a,b)=>a.number-b.number);
}
function resolveHistoricalAnswers(items){
  const bank=state.questions.filter(q=>q.kind==='professional'||q.kind==='common');
  return items.map(h=>{let best=null,bestScore=0;const hp=compactMatchText(h.prompt);for(const q of bank){const qp=compactMatchText(q.prompt);let score=hp===qp?1:(hp.includes(qp)||qp.includes(hp)?0.94:diceSimilarity(h.prompt,q.prompt));if(score>bestScore){best=q;bestScore=score;if(score===1)break;}}if(!best||bestScore<0.72)return {...h,matchScore:bestScore};const correctText=best.options[best.answer-1];let oi=-1,os=0;h.options.forEach((o,i)=>{const s=compactMatchText(o)===compactMatchText(correctText)?1:diceSimilarity(o,correctText);if(s>os){os=s;oi=i;}});if(oi<0||os<0.58)return {...h,originId:best.id,matchedSection:best.sectionName,matchScore:bestScore,optionMatchScore:os};return {...h,answer:oi+1,originId:best.id,matchedSection:best.sectionName,matchScore:bestScore,optionMatchScore:os};});
}
async function syncHistoryPaper(src,button){
  if(button)button.disabled=true;
  try{toast(`正在整理 ${src.label}…`);const html=await fetchTextWithFallback(src.url);let qs=parseHistoricalHtml(html,src);if(qs.length<70)throw new Error(`只辨識到 ${qs.length} 題`);qs=resolveHistoricalAnswers(qs);const resolved=qs.filter(q=>q.answer&&q.originId).length;const paper={id:src.id,label:src.label,at:new Date().toISOString(),count:qs.length,resolved,questions:qs};await setMeta(historyMetaKey(src.id),paper);toast(`${src.label}：${qs.length} 題，答案配對 ${resolved} 題`);renderHistory();}catch(e){console.error(e);toast(`${src.label} 同步失敗：${e.message}`);}finally{if(button)button.disabled=false;}
}
function startHistoricalPaper(src){const paper=getMeta(historyMetaKey(src.id));if(!paper?.questions?.length){toast('請先同步這份歷屆考卷');return;}const unresolved=paper.questions.filter(q=>!q.answer||!q.originId).length;if(unresolved){toast(`尚有 ${unresolved} 題無法可靠配對答案，先不要計分`);return;}startQuiz(paper.questions,'history',src.label,{noFeedback:false});}
function renderHistory(navigateNow=false){
  if(navigateNow){state.view='history';document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelector('#view-history').classList.add('active');document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));}
  const v=document.querySelector('#view-history');v.innerHTML=`<div class="section-title"><h2>歷屆真題</h2><span class="pill">保留原始順序</span></div><div class="banner"><b>歷屆考卷跟每日題庫分開。</b><br><span class="small-text">先同步公開考卷，再用已載入的 13900／共同科目題庫比對正確答案。只有可靠配對完成的考卷才會開放本機計分；答錯仍回流原本的錯題本。</span></div>${SOURCES.history.map(h=>{const p=getMeta(historyMetaKey(h.id));const ready=p?.count>=70&&p?.resolved===p?.count;const last=getMeta('historyResults',[]).filter(r=>r.paperId===h.id).slice(-1)[0];return `<div class="card"><div class="history-card"><div><h3>${h.label}</h3><span class="muted small-text">13900 · ${p?.count||h.count} 題${p?` · 答案配對 ${p.resolved}/${p.count}`:' · 尚未同步'}${last?` · 上次 ${last.score} 分`:''}</span></div><span class="pill ${ready?'good':p?'warn':''}">${ready?'可作答':p?'需核對':'未載入'}</span></div><div class="grid2" style="margin-top:12px"><button class="syncHistory secondary" data-id="${h.id}">${p?'重新同步':'同步考卷'}</button><button class="startHistory primary" data-id="${h.id}" ${!ready?'disabled':''}>開始歷屆考</button></div><div style="margin-top:10px"><a class="mini-link" href="${h.url}" target="_blank" rel="noreferrer">查看公開原始考卷</a></div></div>`}).join('')}<div class="card"><h3>為什麼要先配對答案？</h3><p class="muted">歷屆公開頁面的選項順序可能和題庫不同，所以系統不是只比 A/B/C/D，而是比對「題目＋正確選項文字」。這樣才能讓歷屆錯題安全地回到同一題的學習紀錄。</p></div><button id="backHome" class="ghost wide">回今日首頁</button>`;
  v.querySelectorAll('.syncHistory').forEach(btn=>btn.onclick=()=>{const src=SOURCES.history.find(x=>x.id===btn.dataset.id);if(src)syncHistoryPaper(src,btn);});
  v.querySelectorAll('.startHistory').forEach(btn=>btn.onclick=()=>{const src=SOURCES.history.find(x=>x.id===btn.dataset.id);if(src)startHistoricalPaper(src);});
  v.querySelector('#backHome').onclick=()=>navigate('home');
}

function renderStats(){
  const v=document.querySelector('#view-stats');const o=overallCorrect(),todayS=todaysSummary(),cats=categoryStats();const b=bankInfo();
  v.innerHTML=`<div class="section-title"><h2>學習報告</h2><span class="pill">老師模式</span></div><div class="grid3"><div class="card"><h3>${attempts()}</h3><span class="muted small-text">累積作答</span></div><div class="card"><h3>${o.rate}%</h3><span class="muted small-text">總正確率</span></div><div class="card"><h3>${wrongQuestions().length}</h3><span class="muted small-text">待克服錯題</span></div></div><div class="card"><h3>各科弱點</h3>${cats.map(c=>`<div class="stat-row"><span>${esc(c.name)}</span><div class="progress"><i style="width:${c.attempts?c.rate:0}%"></i></div><b>${c.attempts?c.rate+'%':'—'}</b></div>`).join('')}</div><div class="card"><h3>題庫覆蓋率</h3><div class="task"><div><b>專業題</b><span class="muted small-text">做過至少 1 次</span></div><span>${state.questions.filter(q=>q.kind==='professional'&&getProgress(q.id).attempts).length}/${b.professional}</span></div><div class="task"><div><b>共同題</b><span class="muted small-text">做過至少 1 次</span></div><span>${state.questions.filter(q=>q.kind==='common'&&getProgress(q.id).attempts).length}/${b.common}</span></div></div><div class="card"><h3>今天</h3><p class="muted">${todayS.count} 題 · 答對 ${todayS.correct} · 答錯 ${todayS.wrong} · ${todayS.rate}%</p></div>`;
}

function renderSettings(navigateNow=false){
  if(navigateNow){state.view='settings';document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelector('#view-settings').classList.add('active');document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));}
  const v=document.querySelector('#view-settings');v.innerHTML=`<div class="section-title"><h2>設定</h2></div><div class="card"><div class="setting-row"><div><b>每日專業新題</b><div class="muted small-text">預設 50 題</div></div><input id="dailyPro" type="number" min="5" max="100" value="${getMeta('dailyProfessional',50)}"></div><div class="setting-row"><div><b>每日共同科目</b><div class="muted small-text">預設 10 題</div></div><input id="dailyCom" type="number" min="0" max="40" value="${getMeta('dailyCommon',10)}"></div></div><div class="card"><h3>題庫</h3><button id="syncSettings" class="primary wide">同步／更新題庫</button></div><div class="card"><h3>備份學習紀錄</h3><p class="muted small-text">可匯出 JSON。換手機或清除瀏覽器資料前先備份。</p><div class="grid2"><button id="exportBtn" class="secondary">匯出備份</button><button id="importBackupBtn" class="ghost">匯入備份</button></div><input id="backupFile" type="file" accept="application/json" hidden></div><div class="card"><h3>危險區</h3><button id="resetBtn" class="danger wide">清除所有學習紀錄</button></div><button id="settingsHome" class="ghost wide">回今日首頁</button>`;
  v.querySelector('#dailyPro').onchange=e=>setMeta('dailyProfessional',clamp(Number(e.target.value)||50,5,100));v.querySelector('#dailyCom').onchange=e=>setMeta('dailyCommon',clamp(Number(e.target.value)||10,0,40));v.querySelector('#syncSettings').onclick=openSyncDialog;v.querySelector('#settingsHome').onclick=()=>navigate('home');v.querySelector('#exportBtn').onclick=exportBackup;v.querySelector('#importBackupBtn').onclick=()=>v.querySelector('#backupFile').click();v.querySelector('#backupFile').onchange=importBackup;v.querySelector('#resetBtn').onclick=()=>confirmAction('清除所有學習紀錄？','錯題、作答紀錄、熟練度與模考成績都會歸零，但題庫會保留。',async()=>{await clearStore(STORE_P);state.progress.clear();await setMeta('mockResults',[]);toast('學習紀錄已清除');renderSettings();});
}

function navigate(view){state.view=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='home')renderHome();if(view==='study')renderStudy();if(view==='review')renderReview();if(view==='exam')renderExam();if(view==='stats')renderStats();window.scrollTo(0,0);}

function startQuiz(questions,mode='practice',title='刷題',opts={}){
  if(!questions?.length){toast('目前沒有符合條件的題目');return;}
  state.session={questions:[...questions],index:0,mode,title,answers:[],selected:null,answered:false,guessed:false,startedAt:Date.now(),seconds:opts.seconds||null,noFeedback:!!opts.noFeedback,timer:null};
  state.view='study';document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-study'));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view==='study'));renderQuiz();
}
function renderQuiz(){
  const s=state.session;if(!s)return renderStudy();if(s.index>=s.questions.length)return finishQuiz();const q=s.questions[s.index];const p=getProgress(q.originId||q.id);const v=document.querySelector('#view-study');
  const timeHtml=s.seconds!=null?`<span id="timer" class="pill warn">${formatTime(Math.max(0,s.seconds-Math.floor((Date.now()-s.startedAt)/1000)))}</span>`:`<span class="pill">${s.index+1}/${s.questions.length}</span>`;
  v.innerHTML=`<div class="question-head"><div><div class="eyebrow">${esc(s.title)}</div><div class="question-no">${esc(q.sectionName)} · 第 ${q.number} 題</div></div>${timeHtml}</div><div class="progress" style="margin:12px 0 18px"><i style="width:${pct(s.index,s.questions.length)}%"></i></div><div class="card"><div class="row" style="justify-content:space-between"><span class="pill ${p.wrong?'bad':''}">${p.attempts?`做過 ${p.attempts} 次 · 錯 ${p.wrong}`:'第一次出現'}</span><button id="starQuestion" class="ghost small">${p.starred?'★ 已收藏':'☆ 收藏'}</button></div><div class="question-text">${esc(q.prompt)}</div>${q.image?`<figure class="question-figure"><img src="${esc(q.image)}" alt="${esc(q.imageAlt||'原題圖示')}" loading="eager"></figure>`:(q.imageLikely?'<div class="banner">這題可能含原題圖示；若選項顯示不完整，請回題庫 PDF 對照。</div>':'')}<div class="options">${q.options.map((o,i)=>`<button class="option" data-answer="${i+1}"><span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span></button>`).join('')}</div><div id="feedback"></div><div class="quiz-actions"><button id="guessBtn" class="ghost" ${s.noFeedback?'hidden':''}>這題我是猜的</button><button id="nextBtn" class="primary" disabled>${s.index===s.questions.length-1?'完成':'下一題'}</button></div></div><button id="quitQuiz" class="ghost wide">先離開</button>`;
  const options=[...v.querySelectorAll('.option')];options.forEach(btn=>btn.onclick=()=>selectAnswer(Number(btn.dataset.answer)));
  v.querySelector('#guessBtn')?.addEventListener('click',()=>{s.guessed=!s.guessed;v.querySelector('#guessBtn').textContent=s.guessed?'✓ 已標記：我是猜的':'這題我是猜的';});
  v.querySelector('#nextBtn').onclick=()=>advanceQuiz();v.querySelector('#quitQuiz').onclick=()=>{if(s.mode==='mock')confirmAction('離開模擬考？','目前進度不會計入模考成績。',()=>{clearQuizTimer();state.session=null;navigate('exam');});else{clearQuizTimer();state.session=null;navigate('home');}};
  v.querySelector('#starQuestion').onclick=async()=>{const pid=q.originId||q.id;const pp={...getProgress(pid),starred:!getProgress(pid).starred};await saveProgress(pp);v.querySelector('#starQuestion').textContent=pp.starred?'★ 已收藏':'☆ 收藏';};
  if(s.seconds!=null){clearQuizTimer();s.timer=setInterval(()=>{const rem=s.seconds-Math.floor((Date.now()-s.startedAt)/1000);const el=document.querySelector('#timer');if(el)el.textContent=formatTime(Math.max(0,rem));if(rem<=0){clearQuizTimer();toast('時間到，自動交卷');finishQuiz(true);}},1000);}
}
async function selectAnswer(n){const s=state.session;if(!s||s.answered)return;s.selected=n;s.answered=true;const q=s.questions[s.index];const correct=n===q.answer;s.answers.push({id:q.id,chosen:n,answer:q.answer,correct,guessed:s.guessed});
  if(s.mode!=='mock')await recordAnswer(q,n,s.guessed);
  const v=document.querySelector('#view-study');v.querySelectorAll('.option').forEach(btn=>{const x=Number(btn.dataset.answer);btn.disabled=true;if(!s.noFeedback){if(x===q.answer)btn.classList.add('correct');if(x===n&&!correct)btn.classList.add('wrong');}});v.querySelector('#nextBtn').disabled=false;
  if(!s.noFeedback){const fb=v.querySelector('#feedback');fb.className=`feedback ${correct?'correct':'wrong'}`;fb.innerHTML=correct?`<b>答對。</b>${s.guessed?' 但你標記為「猜的」，明天還會再出。':''}`:`<b>答錯。</b> 正確答案是 ${LETTERS[q.answer-1]}。這題已排進錯題複習。`;}
}
function advanceQuiz(){const s=state.session;if(!s?.answered)return;s.index++;s.selected=null;s.answered=false;s.guessed=false;renderQuiz();}
async function finishQuiz(force=false){const s=state.session;if(!s)return;clearQuizTimer();if(s.mode==='history'){
    const correct=s.answers.filter(a=>a.correct).length;const total=s.questions.length;const score=Number((correct*1.25).toFixed(2));const results=getMeta('historyResults',[]);const paperId=s.questions[0]?.section||'';results.push({at:new Date().toISOString(),paperId,label:s.title,score,correct,total});await setMeta('historyResults',results.slice(-40));
    const byCat={};for(const a of s.answers){const q=s.questions.find(q=>q.id===a.id);if(!q)continue;const name=q.matchedSection||'未分類';byCat[name]??={n:0,c:0};byCat[name].n++;if(a.correct)byCat[name].c++;}
    const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">PAST EXAM RESULT</div><h2>${score} 分 · ${score>=60?'及格':'未及格'}</h2><p>${esc(s.title)} · 答對 ${correct}/${total} 題</p></div><div class="card"><h3>這份考卷的弱點</h3>${Object.entries(byCat).map(([name,x])=>`<div class="stat-row"><span>${esc(name)}</span><div class="progress"><i style="width:${pct(x.c,x.n)}%"></i></div><b>${pct(x.c,x.n)}%</b></div>`).join('')}</div><div class="grid2"><button id="reviewHistory" class="secondary" ${correct===total?'disabled':''}>重做本次錯題</button><button id="backHistory" class="primary">回歷屆試題</button></div>`;
    v.querySelector('#reviewHistory').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id);const retry=s.questions.filter(q=>ids.includes(q.id));state.session=null;startQuiz(retry,'review',`${s.title} 錯題`);};v.querySelector('#backHistory').onclick=()=>{state.session=null;renderHistory(true);};return;
  }
  if(s.mode==='mock'){
    for(const a of s.answers){const q=state.questions.find(q=>q.id===a.id);if(q)await recordAnswer(q,a.chosen,false);}
    const correct=s.answers.filter(a=>a.correct).length;const score=Number((correct*1.25).toFixed(2));const results=getMeta('mockResults',[]);results.push({at:new Date().toISOString(),score,correct,total:80});await setMeta('mockResults',results.slice(-30));
    const byCat={};for(const a of s.answers){const q=state.questions.find(q=>q.id===a.id);if(!q)continue;byCat[q.sectionName]??={n:0,c:0};byCat[q.sectionName].n++;if(a.correct)byCat[q.sectionName].c++;}
    const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">MOCK RESULT</div><h2>${score} 分 · ${score>=60?'及格':'未及格'}</h2><p>答對 ${correct}/80 題${force?'（時間到）':''}</p></div><div class="card"><h3>科目表現</h3>${Object.entries(byCat).map(([name,x])=>`<div class="stat-row"><span>${esc(name)}</span><div class="progress"><i style="width:${pct(x.c,x.n)}%"></i></div><b>${pct(x.c,x.n)}%</b></div>`).join('')}</div><div class="grid2"><button id="reviewMock" class="secondary">複習本次錯題</button><button id="backExam" class="primary">回模考首頁</button></div>`;v.querySelector('#reviewMock').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id);state.session=null;startQuiz(state.questions.filter(q=>ids.includes(q.id)),'review','模考錯題');};v.querySelector('#backExam').onclick=()=>{state.session=null;navigate('exam');};return;
  }
  const c=s.answers.filter(a=>a.correct).length,w=s.answers.length-c;const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">CLASS COMPLETE</div><h2>${s.answers.length} 題完成</h2><p>答對 ${c} · 答錯 ${w} · 正確率 ${pct(c,s.answers.length)}%</p></div><div class="card"><h3>老師判定</h3><p class="muted">${w===0?'這輪全對，可以繼續推進新題。':`錯的 ${w} 題已自動加入複習排程。今天如果還有精神，建議立刻再做一次錯題。`}</p></div><div class="grid2"><button id="reviewSession" class="secondary" ${!w?'disabled':''}>馬上重做錯題</button><button id="finishHome" class="primary">回今日首頁</button></div>`;v.querySelector('#reviewSession').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id);const retry=s.questions.filter(q=>ids.includes(q.id));state.session=null;startQuiz(retry,'review','本輪錯題');};v.querySelector('#finishHome').onclick=()=>{state.session=null;navigate('home');};
}
function clearQuizTimer(){if(state.session?.timer){clearInterval(state.session.timer);state.session.timer=null;}}
function formatTime(sec){const m=Math.floor(sec/60),s=sec%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}

function openSyncDialog(){renderSyncStatus();document.querySelector('#syncDialog').showModal();}
function syncMsg(msg){document.querySelector('#syncStatus').innerHTML=`<div class="banner">${esc(msg)}</div>`;}
function renderSyncStatus(){const b=bankInfo();document.querySelector('#syncStatus').innerHTML=`<div class="sync-line"><span>專業題庫</span><b>${b.professional}/647</b></div>${SOURCES.common.map(s=>`<div class="sync-line"><span>${esc(s.label)}</span><b>${b.byCommon[s.code]||0}/${s.expected}</b></div>`).join('')}`;}
async function autoSync(){const btn=document.querySelector('#autoSyncBtn');btn.disabled=true;try{await loadBundledProfessional(syncMsg);await loadPdfJs();for(const src of SOURCES.common)await syncOneCommon(src,syncMsg);state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);syncMsg(`同步完成：專業 ${bankInfo().professional}/647，共同 ${bankInfo().common} 題。`);renderSyncStatus();toast('完整題庫同步完成');renderHome();}catch(e){console.error(e);syncMsg(`同步沒有完成：${e.message}。專業題可按「修復內建 647 題」，共同科目可再單獨同步。`);}finally{btn.disabled=false;}}
async function repairProfessional(){const btn=document.querySelector('#repairProfessionalBtn');if(btn)btn.disabled=true;try{const qs=await loadBundledProfessional(syncMsg);state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);renderSyncStatus();syncMsg(`專業題庫已修復 ${qs.length}/647 題。原本的作答與錯題紀錄會保留。`);toast('專業 647 題已修復');renderHome();}catch(e){console.error(e);syncMsg(`專業題庫修復失敗：${e.message}`);}finally{if(btn)btn.disabled=false;}}
async function syncCommon(){const btn=document.querySelector('#syncCommonBtn');btn.disabled=true;try{await loadPdfJs();for(const src of SOURCES.common)await syncOneCommon(src,syncMsg);state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);renderSyncStatus();toast('共同科目更新完成');}catch(e){syncMsg(`共同科目同步失敗：${e.message}`);}finally{btn.disabled=false;}}
async function importProfessionalFile(file){if(!file)return;try{await loadPdfJs();const buf=await file.arrayBuffer();const qs=await importProfessionalBuffer(buf,syncMsg);state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);renderSyncStatus();syncMsg(`專業題庫已匯入 ${qs.length} 題。`);toast('專業題庫匯入完成');renderHome();}catch(e){syncMsg(`匯入失敗：${e.message}`);}}

async function exportBackup(){const data={version:1,exportedAt:new Date().toISOString(),progress:[...state.progress.values()],meta:state.meta};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`寵物美容丙級_學習備份_${today()}.json`;a.click();URL.revokeObjectURL(a.href);}
async function importBackup(e){const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.progress))throw new Error('格式不正確');await bulkPut(STORE_P,data.progress);for(const p of data.progress)state.progress.set(p.id,p);if(data.meta)for(const [k,v] of Object.entries(data.meta))await setMeta(k,v);toast('學習紀錄已還原');renderSettings();}catch(err){toast('備份檔無法匯入');}}
function confirmAction(title,text,fn){const d=document.querySelector('#confirmDialog');d.querySelector('#confirmTitle').textContent=title;d.querySelector('#confirmText').textContent=text;const ok=d.querySelector('#confirmOk');ok.onclick=()=>setTimeout(fn,0);d.showModal();}

async function init(){
  db=await openDB();state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);state.progress=new Map((await getAll(STORE_P)).map(p=>[p.id,p]));state.meta=Object.fromEntries((await getAll(STORE_M)).map(x=>[x.key,x.value]));
  // v4 專業題庫直接隨 App 附帶；若舊版曾只匯入 642 題，啟動時自動補成完整 647 題。
  if(state.questions.filter(q=>q.kind==='professional').length!==SOURCES.professional.expected){
    try{await loadBundledProfessional(()=>{});state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);}catch(e){console.warn('bundled professional bank load failed',e);}
  }
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
  document.querySelector('#autoSyncBtn').onclick=autoSync;document.querySelector('#repairProfessionalBtn')?.addEventListener('click',repairProfessional);document.querySelector('#syncCommonBtn').onclick=syncCommon;document.querySelector('#importProfessionalBtn').onclick=()=>document.querySelector('#professionalFile').click();document.querySelector('#professionalFile').onchange=e=>importProfessionalFile(e.target.files?.[0]);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const btn=document.querySelector('#installBtn');btn.hidden=false;btn.onclick=async()=>{deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;btn.hidden=true;};});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
  renderHome();
}
init().catch(e=>{console.error(e);document.querySelector('#view-home').innerHTML=`<div class="banner bad"><b>App 啟動失敗</b><br>${esc(e.message)}</div>`;});
