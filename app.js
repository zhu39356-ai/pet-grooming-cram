import { SOURCES } from './data/sources.js';

const DB_NAME='pet-grooming-cram-db';
const DB_VERSION=2;
const STORE_Q='questions';
const STORE_P='progress';
const STORE_M='meta';
const STORE_B='snapshots';
const LETTERS=['A','B','C','D'];
const APP_VERSION='v7';
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
let snapshotTimer=null;
let snapshotRunning=false;
let state={view:'home',questions:[],progress:new Map(),meta:{},session:null,historyMode:false};

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE_Q))d.createObjectStore(STORE_Q,{keyPath:'id'});if(!d.objectStoreNames.contains(STORE_P))d.createObjectStore(STORE_P,{keyPath:'id'});if(!d.objectStoreNames.contains(STORE_M))d.createObjectStore(STORE_M,{keyPath:'key'});if(!d.objectStoreNames.contains(STORE_B))d.createObjectStore(STORE_B,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store);}
function getAll(store){return new Promise((resolve,reject)=>{const r=tx(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
function put(store,obj){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').put(obj);r.onsuccess=()=>resolve(obj);r.onerror=()=>reject(r.error);});}
function del(store,key){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
async function bulkPut(store,items){if(!items.length)return;return new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');const s=t.objectStore(store);for(const x of items)s.put(x);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
async function clearStore(store){return new Promise((resolve,reject)=>{const r=tx(store,'readwrite').clear();r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
async function setMeta(key,value){state.meta[key]=value;await put(STORE_M,{key,value});}
function getMeta(key,fallback=null){return state.meta[key] ?? fallback;}

function defaultProgress(id){return {id,attempts:0,correct:0,wrong:0,unknown:0,streak:0,level:0,lastAt:null,nextDue:null,lastAnswer:null,guessed:0,starred:false,needsHelp:false,history:[]};}
function exposureCount(p){return (p.attempts||0)+(p.unknown||0);}
function getProgress(id){return state.progress.get(id)||defaultProgress(id);}
async function saveProgress(p){state.progress.set(p.id,p);await put(STORE_P,p);queueAutoSnapshot('作答更新');}


function backupPayload(){
  return {version:2,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),progress:[...state.progress.values()],meta:{...state.meta}};
}
async function writeAutoSnapshot(reason='自動保存'){
  if(!db||snapshotRunning)return;
  snapshotRunning=true;
  try{
    const createdAt=new Date().toISOString(),payload=backupPayload();
    await put(STORE_B,{id:'latest',createdAt,date:today(),reason,payload});
    await put(STORE_B,{id:`day-${today()}`,createdAt,date:today(),reason,payload});
    const all=await getAll(STORE_B);
    const days=all.filter(x=>String(x.id).startsWith('day-')).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    for(const old of days.slice(7))await del(STORE_B,old.id);
    state.meta.lastAutoBackupAt=createdAt;
    await put(STORE_M,{key:'lastAutoBackupAt',value:createdAt});
  }catch(e){console.warn('auto snapshot failed',e);}finally{snapshotRunning=false;}
}
function queueAutoSnapshot(reason='自動保存'){
  clearTimeout(snapshotTimer);snapshotTimer=setTimeout(()=>writeAutoSnapshot(reason),250);
}
async function ensurePersistentStorage(){
  let supported=!!navigator.storage?.persist,granted=false;
  try{if(supported){granted=await navigator.storage.persisted();if(!granted)granted=await navigator.storage.persist();}}catch(e){console.warn('persistent storage request failed',e);}
  state.meta.storagePersistent=!!granted;
  await put(STORE_M,{key:'storagePersistent',value:!!granted});
  return {supported,granted};
}
async function autoSyncCommonInBackground(){
  const b=bankInfo();if(b.readyCommon||!navigator.onLine)return;
  try{
    await loadPdfJs();
    for(const src of SOURCES.common){if((bankInfo().byCommon[src.code]||0)<90)await syncOneCommon(src,()=>{});}
    state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);
    renderHome();queueAutoSnapshot('共同科目首次同步');
  }catch(e){console.warn('background common sync failed',e);}
}

function toast(msg){const el=document.querySelector('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2500);}
function pct(n,d){return d?Math.round(n/d*100):0;}

function normalizeText(s){let x=String(s||'').replace(/Page\s*\d+\s*of\s*\d+/gi,' ').replace(/\s+/g,' ').replace(/\s+([，。！？；：])/g,'$1').trim();let prev='';while(prev!==x){prev=x;x=x.replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g,'$1$2');}return x;}

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
function attempts(){return [...state.progress.values()].reduce((sum,p)=>sum+(p.attempts||0),0);}
function exposures(){return [...state.progress.values()].reduce((sum,p)=>sum+exposureCount(p),0);}
function answeredUnique(){return [...state.progress.values()].filter(p=>exposureCount(p)>0).length;}
function overallCorrect(){let a=0,c=0;for(const p of state.progress.values()){a+=p.attempts||0;c+=p.correct||0;}return {a,c,rate:pct(c,a)};}
function dueQuestions(){const now=Date.now();return state.questions.filter(q=>{const p=getProgress(q.id);return p.nextDue&&new Date(p.nextDue).getTime()<=now;});}
function wrongQuestions(){return state.questions.filter(q=>(getProgress(q.id).wrong||0)>0&&getProgress(q.id).level<5);}
function unseen(kind){return state.questions.filter(q=>(!kind||q.kind===kind)&&exposureCount(getProgress(q.id))===0);}
function streakDays(){
  const dates=new Set([...state.progress.values()].flatMap(p=>(p.history||[]).map(h=>h.date)).filter(Boolean));let d=new Date(`${today()}T12:00:00+08:00`),n=0;
  while(true){const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(d);if(!dates.has(key))break;n++;d=new Date(d.getTime()-dayMs);}return n;
}
function categoryStats(){
  const cats={};for(const q of state.questions){const key=q.sectionName;cats[key]??={name:key,attempts:0,correct:0,wrong:0,unknown:0,total:0,seen:0};cats[key].total++;const p=getProgress(q.id);cats[key].attempts+=p.attempts||0;cats[key].correct+=p.correct||0;cats[key].wrong+=p.wrong||0;cats[key].unknown+=p.unknown||0;if(exposureCount(p))cats[key].seen++;}
  return Object.values(cats).map(x=>({...x,rate:pct(x.correct,x.attempts)})).sort((a,b)=>(a.attempts? a.rate:101)-(b.attempts?b.rate:101));
}
function todaysHistory(){return [...state.progress.values()].flatMap(p=>(p.history||[]).filter(h=>h.date===today()).map(h=>({...h,id:p.id})));}
function todaysSummary(){
  const h=todaysHistory(), answered=h.filter(x=>!x.unknown), correct=answered.filter(x=>x.correct), wrong=answered.filter(x=>!x.correct);
  return {count:h.length,answered:answered.length,correct:correct.length,wrong:wrong.length,unknown:h.filter(x=>x.unknown).length,guessed:h.filter(x=>x.guessed&&x.correct).length,rate:pct(correct.length,answered.length)};
}
function latestTodayEventById(){
  const m=new Map();for(const h of todaysHistory())m.set(h.id,h);return m;
}
function todaysReviewQuestions(){
  const latest=latestTodayEventById();return state.questions.filter(q=>{const h=latest.get(q.id);return !!h&&(h.unknown||!h.correct||h.guessed);});
}
function todaysReviewSummary(){
  const latest=latestTodayEventById();let wrong=0,guessed=0,unknown=0;for(const h of latest.values()){if(h.unknown)unknown++;else if(!h.correct)wrong++;else if(h.guessed)guessed++;}return {wrong,guessed,unknown,total:wrong+guessed+unknown};
}
function firstSeenTodayCount(kind){
  return state.questions.filter(q=>{if(kind&&q.kind!==kind)return false;const p=getProgress(q.id),h=p.history||[];return h.length>0&&h[0].date===today();}).length;
}
function dailyPlan(){
  const proTarget=Number(getMeta('dailyProfessional',50)),commonTarget=Number(getMeta('dailyCommon',10)),due=dueQuestions();
  const proDone=firstSeenTodayCount('professional'),commonDone=firstSeenTodayCount('common');
  const proRemaining=Math.min(Math.max(0,proTarget-proDone),unseen('professional').length);
  const commonRemaining=Math.min(Math.max(0,commonTarget-commonDone),unseen('common').length);
  return {proTarget,commonTarget,proDone,commonDone,proRemaining,commonRemaining,dueCount:due.length,reviewCount:todaysReviewQuestions().length};
}
function buildDailySession(){
  const plan=dailyPlan();const due=sample(dueQuestions(),Math.min(30,dueQuestions().length));
  const pro=sample(unseen('professional').filter(q=>!due.some(d=>d.id===q.id)),plan.proRemaining);
  const com=sample(unseen('common').filter(q=>!due.some(d=>d.id===q.id)),plan.commonRemaining);
  return [...due,...pro,...com];
}

async function recordAnswer(q,chosen,opts={}){
  const guessed=!!opts.guessed,unknown=!!opts.unknown,trackId=q.originId||q.id;
  const old=getProgress(trackId),p={...old,history:[...(old.history||[])]};const firstExposure=exposureCount(old)===0;const prevToday=(old.history||[]).slice(-1)[0];const hadFlagToday=!!prevToday&&prevToday.date===today()&&(prevToday.unknown||!prevToday.correct||prevToday.guessed);const now=new Date().toISOString();
  p.lastAt=now;p.lastAnswer=unknown?null:chosen;
  if(unknown){
    p.unknown=(p.unknown||0)+1;p.streak=0;p.level=0;p.nextDue=new Date(Date.now()+dayMs).toISOString();
    p.history.push({date:today(),at:now,chosen:null,answer:q.answer,correct:false,guessed:false,unknown:true,firstTime:firstExposure});
    p.history=p.history.slice(-80);await saveProgress(p);return {correct:false,unknown:true,firstExposure};
  }
  const correct=chosen===q.answer;p.attempts=(p.attempts||0)+1;
  p.history.push({date:today(),at:now,chosen,answer:q.answer,correct,guessed,unknown:false,firstTime:firstExposure});p.history=p.history.slice(-80);
  if(correct){
    p.correct=(p.correct||0)+1;p.streak=(p.streak||0)+1;
    if(guessed)p.guessed=(p.guessed||0)+1;
    if(firstExposure||guessed||hadFlagToday){p.level=Math.min(p.level||0,1);p.nextDue=new Date(Date.now()+dayMs).toISOString();}
    else{p.level=Math.min(5,(p.level||0)+1);const intervals=[1,3,7,14,30,60];p.nextDue=new Date(Date.now()+intervals[p.level]*dayMs).toISOString();}
  }else{p.wrong=(p.wrong||0)+1;p.streak=0;p.level=0;p.nextDue=new Date(Date.now()+dayMs).toISOString();}
  await saveProgress(p);return {correct,unknown:false,firstExposure};
}
async function markLatestAnswerGuessed(q){
  const trackId=q.originId||q.id,p={...getProgress(trackId),history:[...(getProgress(trackId).history||[])]};const i=p.history.length-1;if(i<0)return;
  const h={...p.history[i]};if(h.date!==today()||h.unknown||!h.correct||h.guessed)return;
  h.guessed=true;p.history[i]=h;p.guessed=(p.guessed||0)+1;p.level=Math.min(p.level||0,1);p.nextDue=new Date(Date.now()+dayMs).toISOString();await saveProgress(p);
}

function renderHome(){
  const v=document.querySelector('#view-home'),b=bankInfo(),daily=todaysSummary(),plan=dailyPlan(),review=todaysReviewSummary(),oc=overallCorrect(),cats=categoryStats().filter(x=>x.attempts>=3),weak=cats[0];
  const ready=b.readyProfessional&&b.readyCommon;const dailyRemaining=plan.proRemaining+plan.commonRemaining+plan.dueCount;
  const todayDesc=daily.count?`今天碰過 ${daily.count} 次：答對 ${daily.correct}、答錯 ${daily.wrong}${daily.unknown?`、不知道 ${daily.unknown}`:''}${daily.guessed?`、猜對 ${daily.guessed}`:''}`:'第一次看題也算學習；不知道就直接看答案與講解。';
  const startLabel=dailyRemaining?'繼續今天的作業':(review.total?'開始今日檢討':'今天的新題已完成');
  v.innerHTML=`
    <div class="hero">
      <div class="eyebrow" style="color:#ded9ff">TODAY'S CLASS · 初學模式</div>
      <h2>${daily.count?`今天已學習 ${daily.count} 題次`:'今天的作業還沒寫'}</h2>
      <p>${todayDesc}</p>
      <div class="metrics"><div class="metric"><b>${streakDays()}</b><small>連續天數</small></div><div class="metric"><b>${answeredUnique()}</b><small>已看過題目</small></div><div class="metric"><b>${oc.rate}%</b><small>實際作答正確率</small></div></div>
    </div>
    ${!ready?`<div class="banner"><b>先完成完整題庫</b><br><span class="small-text">專業 ${b.professional}/647、共同 ${b.common}/400。手機第一次使用也要把共同科目同步一次。</span><div style="margin-top:10px"><button id="openSync" class="primary small">同步題庫</button></div></div>`:''}
    <div class="section-title"><h2>今天作業</h2><span class="pill">每天自動排課</span></div>
    <div class="card">
      <div class="task"><div><b>專業新題</b><span class="muted small-text">今日已完成 ${plan.proDone}/${plan.proTarget}</span></div><span class="pill ${plan.proRemaining?'':'good'}">剩 ${plan.proRemaining} 題</span></div>
      <div class="task"><div><b>共同科目</b><span class="muted small-text">今日已完成 ${plan.commonDone}/${plan.commonTarget}</span></div><span class="pill ${plan.commonRemaining?'':'good'}">剩 ${plan.commonRemaining} 題</span></div>
      <div class="task"><div><b>今日檢討</b><span class="muted small-text">答錯 ${review.wrong}／猜對 ${review.guessed}／不知道 ${review.unknown}</span></div><span class="pill ${review.total?'bad':'good'}">${review.total} 題</span></div>
      <div class="task"><div><b>到期複習</b><span class="muted small-text">以前學過、今天輪到再考</span></div><span class="pill ${plan.dueCount?'warn':'good'}">${plan.dueCount} 題</span></div>
      <button id="startDaily" class="primary wide" style="margin-top:14px" ${!ready||(!dailyRemaining&&!review.total)?'disabled':''}>${startLabel}</button>
    </div>
    <div class="grid2">
      <div class="card"><h3>647 題進度</h3><p class="muted small-text">專業題已看過 ${state.questions.filter(q=>q.kind==='professional'&&exposureCount(getProgress(q.id))>0).length} / ${b.professional||647}</p><div class="progress"><i style="width:${pct(state.questions.filter(q=>q.kind==='professional'&&exposureCount(getProgress(q.id))>0).length,b.professional||647)}%"></i></div></div>
      <div class="card"><h3>老師提醒</h3><p class="muted small-text">${weak?`目前作答最需要加強：<b>${esc(weak.name)}</b>（${weak.rate}%）`:'你現在是從題目開始學，第一次不會很正常；重點是看完講解後，隔天能不能答回來。'}</p></div>
    </div>
    <div class="section-title"><h2>快速入口</h2></div>
    <div class="grid2"><button id="goReview" class="secondary">今日檢討 (${review.total})</button><button id="goHistory" class="ghost">歷屆試題</button></div>
    <div class="section-title"><h2>題庫狀態</h2><button id="settingsBtn" class="ghost small">設定</button></div>
    <div class="card"><div class="task"><div><b>專業 13900</b><span class="muted small-text">6 個工作項目</span></div><span class="pill ${b.professional>=647?'good':'warn'}">${b.professional}/647</span></div>${SOURCES.common.map(s=>`<div class="task"><div><b>${s.label}</b><span class="muted small-text">${s.code} · ${s.version}</span></div><span class="pill ${(b.byCommon[s.code]||0)>=90?'good':'warn'}">${b.byCommon[s.code]||0}/${s.expected}</span></div>`).join('')}</div>`;
  v.querySelector('#openSync')?.addEventListener('click',()=>openSyncDialog());
  v.querySelector('#startDaily')?.addEventListener('click',()=>{const qs=buildDailySession();if(qs.length)startQuiz(qs,'daily','今天作業');else startQuiz(todaysReviewQuestions(),'review','今日檢討');});
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
  const v=document.querySelector('#view-review'),todayReview=todaysReviewQuestions(),todayInfo=todaysReviewSummary(),due=dueQuestions(),wrong=wrongQuestions(),help=state.questions.filter(q=>getProgress(q.id).needsHelp);
  v.innerHTML=`<div class="section-title"><h2>檢討與複習</h2><span class="pill bad">今日 ${todayInfo.total} 題</span></div>
  <div class="card"><h3>今天一定要再看</h3><p class="muted">答錯 ${todayInfo.wrong} 題、猜對 ${todayInfo.guessed} 題、完全不知道 ${todayInfo.unknown} 題。只要你後面再「確定答對」一次，就會從今日檢討移除。</p><button id="todayReview" class="primary wide" ${!todayReview.length?'disabled':''}>開始今日檢討 (${todayReview.length})</button></div>
  <div class="card"><h3>老師待講題</h3><p class="muted">如果 App 裡的講解你看完還是不懂，就標記起來。之後可以只刷這些題，也方便我們逐題補成更完整的講解。</p><button id="helpReview" class="secondary wide" ${!help.length?'disabled':''}>複習還不懂的題 (${help.length})</button></div>
  <div class="card"><h3>到期複習</h3><p class="muted">這是以前學過、按照間隔複習排到今天的題目，和「今天剛錯」是兩回事。</p><button id="dueReview" class="secondary wide" ${!due.length?'disabled':''}>複習到期題 (${due.length})</button></div>
  <div class="card"><h3>重點錯題</h3>${wrong.length?wrong.slice(0,12).map(q=>{const p=getProgress(q.id);return `<div class="task"><div><b>${esc(q.prompt.slice(0,54))}${q.prompt.length>54?'…':''}</b><span class="muted small-text">錯 ${p.wrong||0} 次 · ${esc(q.sectionName)}</span></div><span class="pill bad">Lv.${p.level||0}</span></div>`}).join(''):'<div class="empty">還沒有累積錯題</div>'}<button id="allWrong" class="ghost wide" ${!wrong.length?'disabled':''}>只刷所有錯題</button></div>`;
  v.querySelector('#todayReview').onclick=()=>startQuiz(todayReview,'review','今日檢討');
  v.querySelector('#helpReview').onclick=()=>startQuiz(help,'review','老師待講題');
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
  const v=document.querySelector('#view-stats'),o=overallCorrect(),todayS=todaysSummary(),cats=categoryStats(),b=bankInfo(),help=state.questions.filter(q=>getProgress(q.id).needsHelp).length;
  v.innerHTML=`<div class="section-title"><h2>學習報告</h2><span class="pill">老師模式</span></div><div class="grid3"><div class="card"><h3>${answeredUnique()}</h3><span class="muted small-text">已看過題目</span></div><div class="card"><h3>${o.rate}%</h3><span class="muted small-text">實際作答正確率</span></div><div class="card"><h3>${todaysReviewQuestions().length}</h3><span class="muted small-text">今日待檢討</span></div></div><div class="card"><h3>各科弱點</h3>${cats.map(c=>`<div class="stat-row"><span>${esc(c.name)}</span><div class="progress"><i style="width:${c.attempts?c.rate:0}%"></i></div><b>${c.attempts?c.rate+'%':'—'}</b></div>`).join('')}</div><div class="card"><h3>題庫覆蓋率</h3><div class="task"><div><b>專業題</b><span class="muted small-text">看過至少 1 次</span></div><span>${state.questions.filter(q=>q.kind==='professional'&&exposureCount(getProgress(q.id))>0).length}/${b.professional}</span></div><div class="task"><div><b>共同題</b><span class="muted small-text">看過至少 1 次</span></div><span>${state.questions.filter(q=>q.kind==='common'&&exposureCount(getProgress(q.id))>0).length}/${b.common}</span></div><div class="task"><div><b>老師待講題</b><span class="muted small-text">講解看完仍不懂</span></div><span>${help}</span></div></div><div class="card"><h3>今天</h3><p class="muted">碰過 ${todayS.count} 題次 · 答對 ${todayS.correct} · 答錯 ${todayS.wrong}${todayS.unknown?` · 不知道 ${todayS.unknown}`:''}${todayS.guessed?` · 猜對 ${todayS.guessed}`:''} · 作答正確率 ${todayS.rate}%</p></div>`;
}

function renderSettings(navigateNow=false){
  if(navigateNow){state.view='settings';document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelector('#view-settings').classList.add('active');document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));}
  const last=getMeta('lastAutoBackupAt',null),persist=getMeta('storagePersistent',false);
  const lastText=last?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(last)):'尚未建立';
  const v=document.querySelector('#view-settings');v.innerHTML=`<div class="section-title"><h2>設定</h2><span class="pill">${APP_VERSION}</span></div><div class="card"><div class="setting-row"><div><b>每日專業新題</b><div class="muted small-text">預設 50 題；中途離開會從剩餘題數接著算</div></div><input id="dailyPro" type="number" min="5" max="100" value="${getMeta('dailyProfessional',50)}"></div><div class="setting-row"><div><b>每日共同科目</b><div class="muted small-text">預設 10 題</div></div><input id="dailyCom" type="number" min="0" max="40" value="${getMeta('dailyCommon',10)}"></div></div><div class="card"><h3>目前採用：初學模式</h3><p class="muted small-text">第一次看到的題目，即使靠常識答對，隔天仍會再確認一次；答錯、猜對、或按「完全不知道」都會進今日檢討。一般刷題會打亂文字選項，避免只背 A/B/C/D。</p></div><div class="card"><h3>自動保存與備份</h3><p><b>✓ 每一題作答後自動保存</b></p><p class="muted small-text">錯題、猜題、不知道、熟練度、收藏、老師待講題與成績都會立即寫進本機；另保留最近 7 天的自動快照。</p><div class="sync-line"><span>最近自動快照</span><b>${esc(lastText)}</b></div><div class="sync-line"><span>瀏覽器永久儲存</span><b>${persist?'已啟用':'未確認'}</b></div><p class="muted small-text">正常關閉 App、重新開機或離線都不會掉紀錄。只有你主動「清除網站資料／瀏覽器資料」時，本機資料仍可能被刪除；下方手動匯出可作異機救援備份。</p></div><div class="card"><h3>題庫</h3><button id="syncSettings" class="primary wide">同步／更新題庫</button></div><div class="card"><h3>救援備份</h3><p class="muted small-text">平常不用按。只有要清瀏覽器、換手機或想多留一份檔案時再匯出 JSON。</p><div class="grid2"><button id="exportBtn" class="secondary">匯出一份備份</button><button id="importBackupBtn" class="ghost">匯入備份</button></div><input id="backupFile" type="file" accept="application/json" hidden></div><div class="card"><h3>危險區</h3><button id="resetBtn" class="danger wide">清除所有學習紀錄</button></div><button id="settingsHome" class="ghost wide">回今日首頁</button>`;
  v.querySelector('#dailyPro').onchange=async e=>{await setMeta('dailyProfessional',clamp(Number(e.target.value)||50,5,100));queueAutoSnapshot('設定更新');};v.querySelector('#dailyCom').onchange=async e=>{await setMeta('dailyCommon',clamp(Number(e.target.value)||10,0,40));queueAutoSnapshot('設定更新');};v.querySelector('#syncSettings').onclick=openSyncDialog;v.querySelector('#settingsHome').onclick=()=>navigate('home');v.querySelector('#exportBtn').onclick=exportBackup;v.querySelector('#importBackupBtn').onclick=()=>v.querySelector('#backupFile').click();v.querySelector('#backupFile').onchange=importBackup;v.querySelector('#resetBtn').onclick=()=>confirmAction('清除所有學習紀錄？','錯題、作答紀錄、熟練度與模考成績都會歸零，但題庫會保留。',async()=>{await clearStore(STORE_P);state.progress.clear();await setMeta('mockResults',[]);await writeAutoSnapshot('清除後快照');toast('學習紀錄已清除');renderSettings();});
}

function navigate(view){state.view=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='home')renderHome();if(view==='study')renderStudy();if(view==='review')renderReview();if(view==='exam')renderExam();if(view==='stats')renderStats();window.scrollTo(0,0);}

const CURATED_TEACHER_NOTES={
  '13900-06-050':{
    lessonType:'理解題',
    detailLevel:'完整解析',
    concept:'美容前溝通要處理「會影響這次美容安全、造型與照護」的資訊。',
    why:'犬隻的胖瘦、毛髮狀況與牙齒狀況，都可能影響美容時的操作或需要提醒飼主；血統本身不會改變這一次要怎麼洗、吹、剪或做安全評估，所以「犬隻的血統問題」是不恰當的重點。',
    memory:'美容前先想「體況、毛髮、健康」；血統不是當次美容操作重點。',
    choiceNotes:{
      '犬隻的胖瘦':'犬隻的胖瘦：要看。過胖、過瘦或年老都可能影響站立、耐受度與美容安全。',
      '毛髮的保養':'毛髮的保養：要看。毛況、打結與皮膚狀況直接影響洗護與修剪。',
      '牙齒的保健':'牙齒的保健：可以觀察並提醒飼主，屬於健康照護資訊。',
      '犬隻的血統問題':'犬隻的血統問題：不是這次美容操作必須處理的重點，所以是答案。'
    }
  },
  '13900-04-032':{
    lessonType:'記憶＋理解題',
    detailLevel:'完整解析',
    concept:'幼貓早期接觸人、環境與同伴的經驗，會影響後續的社會行為。',
    why:'題庫把貓咪的「社會化時期」定在 30～60 天，也就是約 1～2 個月大。這是很早期的成長階段，因此 7～9 個月或 12 個月以上都太晚；0～14 天則仍屬非常早的初生階段。',
    memory:'貓社會化＝約 1～2 個月＝30～60 天。',
    choiceNotes:{
      '0 天～14 天':'0～14 天：太早，仍是非常早期的初生階段。',
      '30 天～60 天':'30～60 天：題庫指定的社會化時期，約 1～2 個月。',
      '7 個月～9 個月':'7～9 個月：已遠超過題庫所指的早期社會化階段。',
      '12 個月以上':'12 個月以上：更不是幼貓早期社會化階段。'
    }
  },
  '13900-03-092':{
    lessonType:'理解題',
    detailLevel:'完整解析',
    concept:'辨認犬隻「呼吸系統」與其他器官系統。',
    why:'咽喉、氣管、肺臟都和空氣進出及氣體交換有關，屬於呼吸系統；脾臟不是呼吸器官，主要與免疫及血液相關，所以「脾臟」是這題要找的例外。',
    memory:'呼吸路線抓「咽喉 → 氣管 → 肺」；脾臟不在空氣路線上。',
    choiceNotes:{
      '脾臟':'脾臟：不是呼吸系統，主要和免疫、血液功能相關，所以是答案。',
      '咽喉':'咽喉：空氣進入呼吸道會經過的部位，屬呼吸系統相關構造。',
      '氣管':'氣管：把空氣送往肺部，屬呼吸系統。',
      '肺臟':'肺臟：進行氣體交換的主要器官，屬呼吸系統。'
    }
  },
  '13900-03-093':{
    lessonType:'理解題',
    detailLevel:'完整解析',
    concept:'辨認犬隻「消化系統」與「泌尿系統」。',
    why:'胃、小腸、大腸都在食物的消化與吸收路徑上，屬於消化系統；腎臟的主要工作是過濾血液、形成尿液，屬於泌尿系統，因此「腎臟」不是犬隻的消化系統。',
    memory:'食物路線：胃 → 小腸 → 大腸；腎臟走的是「尿液路線」，不在食物路線上。',
    choiceNotes:{
      '胃':'胃：消化系統。負責儲存、攪拌食物並進行初步消化。',
      '小腸':'小腸：消化系統。是主要消化與吸收營養的部位。',
      '大腸':'大腸：消化系統。主要吸收水分並形成糞便。',
      '腎臟':'腎臟：泌尿系統。過濾血液並形成尿液，所以是本題答案。'
    }
  }
};
function teacherTags(q){
  const text=`${q.prompt} ${q.options.join(' ')}`;const tags=[];
  if(/何者為非|何者非|錯誤|不正確|不恰當|不是|非屬|不得|無需|不會|不可|不可能/.test(q.prompt))tags.push('反向題');
  if(/\d|幾|多久|多少|公分|公尺|英吋|℃|天|月|年|顆|碼|分鐘|小時|%/.test(text))tags.push('數字題');
  if(/原產地|犬種|貓種|毛質|體型|步態|胸型|耳型|尾型/.test(text))tags.push('犬貓特徵');
  if(/法|辦法|規定|主管機關|許可|登記|依法/.test(text)||q.section==='02')tags.push('法規');
  if(/疾病|病毒|細菌|寄生蟲|維生素|體溫|傳染|症狀|牙齒|骨|營養/.test(text)||q.section==='03')tags.push('保健衛生');
  if(/行為|社會化|攻擊|發情|情緒|壓力/.test(text)||q.section==='04')tags.push('行為');
  if(/剪|梳|電剪|工具|美容桌|烘|吹|消毒|清潔/.test(text)||q.section==='05'||q.section==='06')tags.push('美容操作');
  return [...new Set(tags)].slice(0,4);
}
function teacherNote(q){
  const answerText=q.options[q.answer-1]||'',curated=CURATED_TEACHER_NOTES[q.originId||q.id],tags=teacherTags(q),negative=/何者為非|何者非|錯誤|不正確|不恰當|不是|非屬|不得|無需|不會|不可|不可能/.test(q.prompt);
  if(curated){
    const key=x=>String(x||'').replace(/[。．，、；：!?！？\s]+$/g,'').trim();
    const choices=q.options.map(o=>curated.choiceNotes?.[key(o)]||`${key(o)}：這個選項的逐項說明尚未建立。`);
    return {...curated,tags,answerText,choices};
  }
  let lessonType='記憶題',detailLevel='基礎講解',concept='',why='',memory='',choices=[];
  if(/原產地/.test(q.prompt)){
    concept='犬種／動物與原產地的固定配對。';
    why=`這類題沒有太多可以靠邏輯推導的理由，考的是題庫中的固定配對：本題要記「${answerText}」。`;
    memory=`把題幹中的品種名稱和「${answerText}」綁成一組記憶卡，不要只背答案字母。`;
    detailLevel='記憶提示';
  }else if(tags.includes('數字題')){
    concept='固定數字、時間、尺寸或範圍的題庫記憶。';
    why=`題庫指定答案為「${answerText}」。數字題多半不能只靠常識推，重點是把題幹關鍵詞和正確數字綁在一起，之後靠間隔複習記牢。`;
    memory=`先記「${q.prompt.replace(/[？?].*$/,'').slice(0,34)} → ${answerText}」。`;
    detailLevel='記憶提示';
  }else if(tags.includes('法規')){
    concept='法規條文中的主管機關、資格、程序、期限或禁止事項。';
    why=`這題的考試標答是「${answerText}」。法規題不能用「我覺得應該」來推，應以這一版題庫的法定用語與標答為準。`;
    memory='法規題先抓四件事：誰、做什麼、多久、具備什麼資格。';
    detailLevel='題庫法規提示';
  }else if(tags.includes('美容操作')){
    lessonType='理解＋記憶題';
    concept='美容工具、操作順序、安全或清潔原則。';
    why=`本題題庫答案是「${answerText}」。這類題要把「題幹情境 → 正確工具／動作」連在一起；若涉及安全，通常優先考避免受傷、降低刺激、保持清潔與正確操作順序。`;
    memory=`把「題幹情境 → ${answerText}」當成操作口訣。`;
  }else if(tags.includes('保健衛生')){
    lessonType='理解＋記憶題';
    concept='寵物保健、生理構造、疾病、營養或衛生知識。';
    why=`本題題庫答案是「${answerText}」。這一題目前尚未內建足夠的逐項醫理說明；先把標答和題幹關鍵詞配對，若你不能說出「為什麼」，請直接標記給老師，不把泛用文字當成完整理解。`;
    memory=`先抓生理／疾病／症狀關鍵詞，再記「${answerText}」。`;
    detailLevel='待補完整詳解';
  }else if(tags.includes('行為')){
    lessonType='理解＋記憶題';
    concept='由年齡、動作、情境判讀寵物行為。';
    why=`題庫答案是「${answerText}」。行為題應把題幹中的年齡、動作、環境或刺激和行為意義連起來；這題目前先提供題庫標答，若原因看不懂請標記給老師。`;
    memory=`把情境關鍵詞和「${answerText}」成對記。`;
    detailLevel='基礎講解';
  }else if(negative){
    concept='反向題：找「不符合／錯誤／不是」的唯一例外。';
    why=`題庫答案是「${answerText}」。但只知道它是「例外」還不等於理解；這題目前沒有足夠的逐項知識說明，所以不再用「其他選項都符合」當作老師講解。`;
    memory='先圈住題幹的「不／非／錯誤」，再確認你能說出答案為何是例外。';
    detailLevel='待補完整詳解';
  }else{
    concept='題庫中的固定知識配對。';
    why=`題庫答案為「${answerText}」。這題目前以記住「題幹關鍵詞 → 正確答案內容」為主；如果你無法解釋原因，請標記給老師，之後補成逐項詳解。`;
    memory=`記答案內容「${answerText}」，不要只記 A/B/C/D。`;
    detailLevel='記憶提示';
  }
  return {lessonType,detailLevel,concept,why,memory,tags,answerText,choices};
}
function teacherHtml(q,firstExposure=false,unknown=false,guessed=false){
  const n=teacherNote(q);
  const tags=[n.lessonType,n.detailLevel,...n.tags].filter(Boolean);
  const tagHtml=tags.length?`<div class="teacher-tags">${tags.map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</div>`:'';
  const status=unknown?'你這次選「不知道」，這題會列入今日檢討並在明天再出。':guessed?'雖然答對，但你標記為猜的，所以不算真正掌握，明天會再考。':firstExposure?'這是第一次看到；即使答對，初學模式仍會在明天安排一次確認。':'答對後會依熟練度拉長下次複習間隔。';
  const reverse=n.tags.includes('反向題')?'<div class="reverse-tip"><b>先注意：</b>這題問的是「不／非／錯誤」的那一個，別把正確敘述反而選下去。</div>':'';
  const concept=n.concept?`<div class="concept-tip"><b>這題在學什麼：</b>${esc(n.concept)}</div>`:'';
  const choices=n.choices?.length?`<div class="choice-breakdown"><b>四個選項逐一看：</b>${n.choices.map((x,i)=>`<div class="choice-line"><span>${LETTERS[i]}</span><p>${esc(x)}</p></div>`).join('')}</div>`:'';
  const incomplete=n.detailLevel==='待補完整詳解'?'<div class="teacher-warning">這題目前只有題庫標答與基礎提示，還不能算「完整學會」。如果你看完仍說不出原因，請按下面標記給老師。</div>':'';
  return `<div class="teacher-card"><div class="teacher-title">老師講解</div>${tagHtml}${reverse}${concept}<p><b>正確答案：${LETTERS[q.answer-1]}　${esc(n.answerText)}</b></p><p><b>為什麼：</b>${esc(n.why)}</p>${choices}<div class="memory-tip"><b>怎麼記：</b>${esc(n.memory)}</div>${incomplete}<p class="teacher-status">${esc(status)}</p><small>「正確答案」來自題庫；講解與記憶提示是理解用整理，不是官方題解。</small><div class="teacher-help-row"><button id="needHelpBtn" class="ghost small">${getProgress(q.originId||q.id).needsHelp?'✓ 已標記：還不懂':'講解還是不懂，標記給老師'}</button></div></div>`;
}

async function wireTeacherAction(q){
  const btn=document.querySelector('#needHelpBtn');if(!btn)return;btn.onclick=async()=>{const pid=q.originId||q.id,p={...getProgress(pid),needsHelp:!getProgress(pid).needsHelp};await saveProgress(p);btn.textContent=p.needsHelp?'✓ 已標記：還不懂':'講解還是不懂，標記給老師';};
}

function shuffleQuestionChoices(q){
  if(q.image||q.imageLikely||!Array.isArray(q.options)||q.options.length!==4)return {...q};
  const pairs=q.options.map((text,i)=>({text,correct:i+1===q.answer}));const mixed=shuffle(pairs);return {...q,options:mixed.map(x=>x.text),answer:mixed.findIndex(x=>x.correct)+1};
}
function prepareQuizQuestions(questions,mode){
  if(mode==='history'||mode==='mock')return questions.map(q=>({...q}));
  return questions.map(shuffleQuestionChoices);
}

function startQuiz(questions,mode='practice',title='刷題',opts={}){
  if(!questions?.length){toast('目前沒有符合條件的題目');return;}
  state.session={questions:prepareQuizQuestions(questions,mode),index:0,mode,title,answers:[],selected:null,answered:false,guessed:false,unknown:false,firstExposure:false,startedAt:Date.now(),seconds:opts.seconds||null,noFeedback:!!opts.noFeedback,timer:null};
  state.view='study';document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-study'));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view==='study'));renderQuiz();
}
function renderQuiz(){
  const s=state.session;if(!s)return renderStudy();if(s.index>=s.questions.length)return finishQuiz();const q=s.questions[s.index],p=getProgress(q.originId||q.id),v=document.querySelector('#view-study');
  const timeHtml=s.seconds!=null?`<span id="timer" class="pill warn">${formatTime(Math.max(0,s.seconds-Math.floor((Date.now()-s.startedAt)/1000)))}</span>`:`<span class="pill">${s.index+1}/${s.questions.length}</span>`;
  const seen=exposureCount(p)>0;
  v.innerHTML=`<div class="question-head"><div><div class="eyebrow">${esc(s.title)}</div><div class="question-no">${esc(q.sectionName)} · 第 ${q.number} 題</div></div>${timeHtml}</div><div class="progress" style="margin:12px 0 18px"><i style="width:${pct(s.index,s.questions.length)}%"></i></div><div class="card"><div class="row" style="justify-content:space-between"><span class="pill ${(p.wrong||p.unknown)?'bad':''}">${seen?`看過 ${exposureCount(p)} 次 · 錯 ${p.wrong||0} · 不知道 ${p.unknown||0}`:'第一次出現'}</span><button id="starQuestion" class="ghost small">${p.starred?'★ 已收藏':'☆ 收藏'}</button></div><div class="question-text">${esc(q.prompt)}</div>${q.image?`<figure class="question-figure"><img src="${esc(q.image)}" alt="${esc(q.imageAlt||'原題圖示')}" loading="eager"></figure>`:(q.imageLikely?'<div class="banner">這題含原題圖示；請以題目圖片為準。</div>':'')}<div class="options">${q.options.map((o,i)=>`<button class="option" data-answer="${i+1}"><span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span></button>`).join('')}</div><div id="feedback"></div>${s.noFeedback?'':`<div class="learning-actions"><button id="unknownBtn" class="secondary">完全不知道，直接學這題</button><button id="guessBtn" class="ghost">不確定／這題我是猜的</button></div>`}<div class="quiz-actions"><button id="nextBtn" class="primary" disabled>${s.index===s.questions.length-1?'完成':'下一題'}</button></div></div><button id="quitQuiz" class="ghost wide">先離開</button>`;
  [...v.querySelectorAll('.option')].forEach(btn=>btn.onclick=()=>selectAnswer(Number(btn.dataset.answer)));
  v.querySelector('#unknownBtn')?.addEventListener('click',()=>revealUnknown());
  v.querySelector('#guessBtn')?.addEventListener('click',()=>toggleGuess());
  v.querySelector('#nextBtn').onclick=()=>advanceQuiz();v.querySelector('#quitQuiz').onclick=()=>{if(s.mode==='mock')confirmAction('離開模擬考？','目前進度不會計入模考成績。',()=>{clearQuizTimer();state.session=null;navigate('exam');});else{clearQuizTimer();state.session=null;navigate('home');}};
  v.querySelector('#starQuestion').onclick=async()=>{const pid=q.originId||q.id,pp={...getProgress(pid),starred:!getProgress(pid).starred};await saveProgress(pp);v.querySelector('#starQuestion').textContent=pp.starred?'★ 已收藏':'☆ 收藏';};
  if(s.seconds!=null){clearQuizTimer();s.timer=setInterval(()=>{const rem=s.seconds-Math.floor((Date.now()-s.startedAt)/1000),el=document.querySelector('#timer');if(el)el.textContent=formatTime(Math.max(0,rem));if(rem<=0){clearQuizTimer();toast('時間到，自動交卷');finishQuiz(true);}},1000);}
}
function setAnsweredUI(q,{correct=false,unknown=false,firstExposure=false}){
  const s=state.session,v=document.querySelector('#view-study');v.querySelectorAll('.option').forEach(btn=>{const x=Number(btn.dataset.answer);btn.disabled=true;if(!s.noFeedback){if(x===q.answer)btn.classList.add('correct');if(!unknown&&x===s.selected&&!correct)btn.classList.add('wrong');}});v.querySelector('#nextBtn').disabled=false;
  const u=v.querySelector('#unknownBtn');if(u)u.hidden=true;const g=v.querySelector('#guessBtn');if(g){if(unknown||!correct)g.hidden=true;else{g.hidden=false;g.textContent=s.guessed?'✓ 已標記：我是猜的':'這題其實是猜的';}}
  if(!s.noFeedback){const fb=v.querySelector('#feedback');fb.className=`feedback ${unknown?'learn':(correct?'correct':'wrong')}`;const lead=unknown?`<b>先學這題。</b> 正確答案是 ${LETTERS[q.answer-1]}。`:correct?`<b>答對。</b>${s.guessed?' 但這題是猜的，所以仍要複習。':''}`:`<b>答錯。</b> 正確答案是 ${LETTERS[q.answer-1]}。`;
    fb.innerHTML=`${lead}${teacherHtml(q,firstExposure,unknown,s.guessed)}`;wireTeacherAction(q);
  }
}
async function selectAnswer(n){
  const s=state.session;if(!s||s.answered)return;s.selected=n;s.answered=true;const q=s.questions[s.index],firstExposure=exposureCount(getProgress(q.originId||q.id))===0,correct=n===q.answer;s.firstExposure=firstExposure;
  s.answers.push({id:q.id,chosen:n,answer:q.answer,correct,guessed:s.guessed,unknown:false});
  if(s.mode!=='mock')await recordAnswer(q,n,{guessed:s.guessed,unknown:false});
  setAnsweredUI(q,{correct,unknown:false,firstExposure});
}
async function revealUnknown(){
  const s=state.session;if(!s||s.answered||s.noFeedback)return;const q=s.questions[s.index],firstExposure=exposureCount(getProgress(q.originId||q.id))===0;s.answered=true;s.unknown=true;s.selected=null;s.firstExposure=firstExposure;s.guessed=false;
  s.answers.push({id:q.id,chosen:null,answer:q.answer,correct:false,guessed:false,unknown:true});await recordAnswer(q,null,{unknown:true});setAnsweredUI(q,{correct:false,unknown:true,firstExposure});
}
async function toggleGuess(){
  const s=state.session;if(!s||s.noFeedback)return;const v=document.querySelector('#view-study'),g=v.querySelector('#guessBtn');
  if(!s.answered){s.guessed=!s.guessed;if(g)g.textContent=s.guessed?'✓ 已先標記：我是猜的':'不確定／這題我是猜的';return;}
  const last=s.answers[s.answers.length-1];if(!last||last.unknown||!last.correct||last.guessed)return;s.guessed=true;last.guessed=true;const q=s.questions[s.index];await markLatestAnswerGuessed(q);if(g)g.textContent='✓ 已標記：我是猜的';const fb=v.querySelector('#feedback');if(fb){fb.innerHTML=`<b>答對。</b> 但這題是猜的，所以仍要複習。${teacherHtml(q,s.firstExposure,false,true)}`;wireTeacherAction(q);}
}
function advanceQuiz(){const s=state.session;if(!s?.answered)return;s.index++;s.selected=null;s.answered=false;s.guessed=false;s.unknown=false;s.firstExposure=false;renderQuiz();}

async function finishQuiz(force=false){const s=state.session;if(!s)return;clearQuizTimer();if(s.mode==='history'){
    const correct=s.answers.filter(a=>a.correct).length;const total=s.questions.length;const score=Number((correct*1.25).toFixed(2));const results=getMeta('historyResults',[]);const paperId=s.questions[0]?.section||'';results.push({at:new Date().toISOString(),paperId,label:s.title,score,correct,total});await setMeta('historyResults',results.slice(-40));
    const byCat={};for(const a of s.answers){const q=s.questions.find(q=>q.id===a.id);if(!q)continue;const name=q.matchedSection||'未分類';byCat[name]??={n:0,c:0};byCat[name].n++;if(a.correct)byCat[name].c++;}
    const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">PAST EXAM RESULT</div><h2>${score} 分 · ${score>=60?'及格':'未及格'}</h2><p>${esc(s.title)} · 答對 ${correct}/${total} 題</p></div><div class="card"><h3>這份考卷的弱點</h3>${Object.entries(byCat).map(([name,x])=>`<div class="stat-row"><span>${esc(name)}</span><div class="progress"><i style="width:${pct(x.c,x.n)}%"></i></div><b>${pct(x.c,x.n)}%</b></div>`).join('')}</div><div class="grid2"><button id="reviewHistory" class="secondary" ${correct===total?'disabled':''}>重做本次錯題</button><button id="backHistory" class="primary">回歷屆試題</button></div>`;
    v.querySelector('#reviewHistory').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id);const retry=s.questions.filter(q=>ids.includes(q.id));state.session=null;startQuiz(retry,'review',`${s.title} 錯題`);};v.querySelector('#backHistory').onclick=()=>{state.session=null;renderHistory(true);};return;
  }
  if(s.mode==='mock'){
    for(const a of s.answers){const q=state.questions.find(q=>q.id===a.id);if(q)await recordAnswer(q,a.chosen,{guessed:false,unknown:false});}
    const correct=s.answers.filter(a=>a.correct).length;const score=Number((correct*1.25).toFixed(2));const results=getMeta('mockResults',[]);results.push({at:new Date().toISOString(),score,correct,total:80});await setMeta('mockResults',results.slice(-30));
    const byCat={};for(const a of s.answers){const q=state.questions.find(q=>q.id===a.id);if(!q)continue;byCat[q.sectionName]??={n:0,c:0};byCat[q.sectionName].n++;if(a.correct)byCat[q.sectionName].c++;}
    const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">MOCK RESULT</div><h2>${score} 分 · ${score>=60?'及格':'未及格'}</h2><p>答對 ${correct}/80 題${force?'（時間到）':''}</p></div><div class="card"><h3>科目表現</h3>${Object.entries(byCat).map(([name,x])=>`<div class="stat-row"><span>${esc(name)}</span><div class="progress"><i style="width:${pct(x.c,x.n)}%"></i></div><b>${pct(x.c,x.n)}%</b></div>`).join('')}</div><div class="grid2"><button id="reviewMock" class="secondary">複習本次錯題</button><button id="backExam" class="primary">回模考首頁</button></div>`;v.querySelector('#reviewMock').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id);state.session=null;startQuiz(state.questions.filter(q=>ids.includes(q.id)),'review','模考錯題');};v.querySelector('#backExam').onclick=()=>{state.session=null;navigate('exam');};return;
  }
  const c=s.answers.filter(a=>a.correct).length,u=s.answers.filter(a=>a.unknown).length,w=s.answers.filter(a=>!a.correct&&!a.unknown).length,g=s.answers.filter(a=>a.correct&&a.guessed).length,answered=c+w;const reviewIds=[...new Set(s.answers.filter(a=>a.unknown||!a.correct||a.guessed).map(a=>a.id))];const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">CLASS COMPLETE</div><h2>${s.answers.length} 題學習完成</h2><p>答對 ${c} · 答錯 ${w}${u?` · 不知道 ${u}`:''}${g?` · 猜對 ${g}`:''}${answered?` · 作答正確率 ${pct(c,answered)}%`:''}</p></div><div class="card"><h3>老師判定</h3><p class="muted">${reviewIds.length?`這輪有 ${reviewIds.length} 題還沒真正掌握，已排進今日檢討。先看懂講解，再重做一次，比一直往後衝新題有效。`:'這輪每題都確定答對，可以繼續推進新題。'}</p></div><div class="grid2"><button id="reviewSession" class="secondary" ${!reviewIds.length?'disabled':''}>馬上檢討本輪 (${reviewIds.length})</button><button id="finishHome" class="primary">回今日首頁</button></div>`;v.querySelector('#reviewSession').onclick=()=>{const retry=s.questions.filter(q=>reviewIds.includes(q.id));state.session=null;startQuiz(retry,'review','本輪檢討');};v.querySelector('#finishHome').onclick=()=>{state.session=null;navigate('home');};
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

async function exportBackup(){const data=backupPayload();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`寵物美容丙級_學習備份_${today()}.json`;a.click();URL.revokeObjectURL(a.href);}
async function importBackup(e){const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.progress))throw new Error('格式不正確');await bulkPut(STORE_P,data.progress);for(const p of data.progress)state.progress.set(p.id,p);if(data.meta)for(const [k,v] of Object.entries(data.meta))await setMeta(k,v);await writeAutoSnapshot('匯入備份');toast('學習紀錄已還原');renderSettings();}catch(err){toast('備份檔無法匯入');}}
function confirmAction(title,text,fn){const d=document.querySelector('#confirmDialog');d.querySelector('#confirmTitle').textContent=title;d.querySelector('#confirmText').textContent=text;const ok=d.querySelector('#confirmOk');ok.onclick=()=>setTimeout(fn,0);d.showModal();}

async function init(){
  db=await openDB();state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);state.progress=new Map((await getAll(STORE_P)).map(p=>[p.id,p]));state.meta=Object.fromEntries((await getAll(STORE_M)).map(x=>[x.key,x.value]));
  // v7 重新套用內建 647 題；程式更新不會清除作答／錯題紀錄。
  if(state.questions.filter(q=>q.kind==='professional').length!==SOURCES.professional.expected||getMeta('bundledProfessionalVersion')!==APP_VERSION){
    try{await loadBundledProfessional(()=>{});await setMeta('bundledProfessionalVersion',APP_VERSION);state.questions=(await getAll(STORE_Q)).filter(q=>q.active!==false);}catch(e){console.warn('bundled professional bank load failed',e);}
  }
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
  document.querySelector('#autoSyncBtn').onclick=autoSync;document.querySelector('#repairProfessionalBtn')?.addEventListener('click',repairProfessional);document.querySelector('#syncCommonBtn').onclick=syncCommon;document.querySelector('#importProfessionalBtn').onclick=()=>document.querySelector('#professionalFile').click();document.querySelector('#professionalFile').onchange=e=>importProfessionalFile(e.target.files?.[0]);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const btn=document.querySelector('#installBtn');btn.hidden=false;btn.onclick=async()=>{deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;btn.hidden=true;};});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
  await ensurePersistentStorage();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')writeAutoSnapshot('離開 App');});
  window.addEventListener('pagehide',()=>writeAutoSnapshot('關閉頁面'));
  await writeAutoSnapshot('啟動 App');
  renderHome();
  setTimeout(()=>autoSyncCommonInBackground(),700);
}
init().catch(e=>{console.error(e);document.querySelector('#view-home').innerHTML=`<div class="banner bad"><b>App 啟動失敗</b><br>${esc(e.message)}</div>`;});
