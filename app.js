const SOURCES = {
  professional: {
    code: '13900',
    label: '寵物美容 丙級',
    expected: 647,
    publicPdf: 'https://onlinetest.tw/btest/collection/13900/139003A13.pdf',
    mirrorVersion: '109.12.14',
    sections: [
      ['01','寵物美容基本常識',115],
      ['02','寵物相關法規認識',47],
      ['03','寵物保健衛生',147],
      ['04','寵物行為認知',36],
      ['05','寵物美容工作環境使用與維護',101],
      ['06','寵物美容之基本技能',201]
    ]
  },
  common: [
    {code:'90006',label:'職業安全衛生',expected:100,url:'https://raw.githubusercontent.com/JaredSong/levelup-tw/main/source/900060A18.pdf',version:'A18'},
    {code:'90007',label:'工作倫理與職業道德',expected:100,url:'https://raw.githubusercontent.com/JaredSong/levelup-tw/main/source/900070A17.pdf',version:'A17'},
    {code:'90008',label:'環境保護',expected:100,url:'https://raw.githubusercontent.com/JaredSong/levelup-tw/main/source/900080A16.pdf',version:'A16'},
    {code:'90009',label:'節能減碳',expected:100,url:'https://raw.githubusercontent.com/JaredSong/levelup-tw/main/source/900090A11-latest.pdf',version:'A11-latest'}
  ],
  history: [
    {id:'113-3',year:'113',round:'第 3 梯',count:80,label:'113 年第 3 梯次',url:'https://yamol.tw/exam-113%E5%B9%B4%2B%2B1133%2B%E5%85%A8%E5%9C%8B%E6%8A%80%E8%A1%93%E5%A3%AB%E6%8A%80%E8%83%BD%E6%AA%A2%E5%AE%9A%E5%AD%B8%E7%A7%91_%E4%B8%99%E7%B4%9A%EF%BC%9A13900%2B%E5%AF%B5%E7%89%A9%E7%BE%8E%E5%AE%B91313-131369.htm'},
    {id:'110-3',year:'110',round:'第 3 梯',count:80,label:'110 年第 3 梯次',url:'https://yamol.tw/exam-110%E5%B9%B4%2B%2B1103%2B%E5%85%A8%E5%9C%8B%E6%8A%80%E8%A1%93%E5%A3%AB%E6%8A%80%E8%83%BD%E6%AA%A2%E5%AE%9A%E5%AD%B8%E7%A7%91_%E4%B8%99%E7%B4%9A%EF%BC%9A13900%E5%AF%B5%E7%89%A9%E7%BE%8E%E5%AE%B910502-105020.htm'}
  ]
};


const DB_NAME='pet-grooming-cram-db';
const DB_VERSION=2;
const STORE_Q='questions';
const STORE_P='progress';
const STORE_M='meta';
const STORE_B='snapshots';
const LETTERS=['A','B','C','D'];
const APP_VERSION='v13.0';
const BUNDLED_PROF_URL='./data/professional-13900.json';
const FIRSTAID_URL='./data/firstaid-practice.json';
const DEFAULT_EXCLUDED_IDS=["13900-06-011", "13900-06-012", "13900-06-014", "13900-06-015", "13900-06-018", "13900-06-019", "13900-06-020", "13900-06-021", "13900-06-022", "13900-06-023", "13900-06-025", "13900-06-026", "13900-06-027", "13900-06-028", "13900-06-029", "13900-06-030", "13900-06-031", "13900-06-032", "13900-06-033", "13900-06-034", "13900-06-035", "13900-06-036", "13900-06-037", "13900-06-038", "13900-06-039", "13900-06-040", "13900-06-041", "13900-06-042"];
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

function excludedIdSet(){return new Set((getMeta('excludedQuestionIds',[])||[]).map(String));}
function isExcluded(id){return excludedIdSet().has(String(id));}
function activeQuestions(list){const ex=excludedIdSet();return (list||[]).filter(q=>q.active!==false&&!ex.has(String(q.id)));}
async function reloadQuestions(){state.questions=activeQuestions(await getAll(STORE_Q));return state.questions;}
async function migrateExclusions(){
  const keys=['excludedQuestionIds','deletedQuestionIds','removedQuestionIds','excludedQuestions'];const ids=new Set(DEFAULT_EXCLUDED_IDS);
  for(const k of keys){const v=getMeta(k,[]);if(Array.isArray(v))for(const x of v){if(typeof x==='string')ids.add(x);else if(x?.id)ids.add(String(x.id));}}
  for(const q of await getAll(STORE_Q))if(q.active===false)ids.add(String(q.id));
  await setMeta('excludedQuestionIds',[...ids].sort());
}
function excludedCount(kind){const ex=excludedIdSet();if(kind==='professional')return [...ex].filter(id=>id.startsWith('13900-')).length;if(kind==='firstaid')return [...ex].filter(id=>id.startsWith('FIRSTAID-')).length;return 0;}
function customExcludedIds(){const locked=new Set(DEFAULT_EXCLUDED_IDS);return [...excludedIdSet()].filter(id=>!locked.has(id));}


function defaultProgress(id){return {id,attempts:0,correct:0,wrong:0,unknown:0,streak:0,level:0,lastAt:null,nextDue:null,lastAnswer:null,guessed:0,starred:false,needsHelp:false,history:[]};}
function exposureCount(p){return (p.attempts||0)+(p.unknown||0);}
function getProgress(id){return state.progress.get(id)||defaultProgress(id);}
async function saveProgress(p){state.progress.set(p.id,p);await put(STORE_P,p);queueAutoSnapshot('作答更新');}


function backupPayload(){
  return {version:3,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),progress:[...state.progress.values()],meta:{...state.meta}};
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
    await reloadQuestions();
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

async function loadBundledFirstAid(status=()=>{}){
  status('載入寵物急救練習題庫…');
  const r=await fetch(FIRSTAID_URL,{cache:'no-store'});if(!r.ok)throw new Error(`急救題庫 HTTP ${r.status}`);
  const data=await r.json(),qs=Array.isArray(data?.questions)?data.questions:[];
  if(qs.length!==80)throw new Error(`急救題庫只有 ${qs.length}/80 題`);
  const bad=qs.find(q=>!q.id||!q.prompt||!Array.isArray(q.options)||q.options.length!==4||!q.options.every(Boolean)||![1,2,3,4].includes(Number(q.answer)));
  if(bad)throw new Error(`急救題庫格式異常：${bad.id||'未知題號'}`);
  await replaceQuestionKind('firstaid',qs);
  await setMeta('firstAidBank',{at:new Date().toISOString(),count:qs.length,version:data.version||APP_VERSION,nonOfficial:true});
  status(`寵物急救練習題庫已載入：${qs.length} 題`);return qs;
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
  // 用同一個 IndexedDB transaction 完成刪除＋寫入，避免手機逐題開 transaction 卡住首頁。
  const all=await getAll(STORE_Q);const old=all.filter(q=>q.kind===kind);
  await new Promise((resolve,reject)=>{
    const t=db.transaction(STORE_Q,'readwrite');const store=t.objectStore(STORE_Q);
    for(const q of old)store.delete(q.id);
    for(const q of qs)store.put(q);
    t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('題庫更新中止'));
  });
  await reloadQuestions();
}


function bankInfo(){
  const p=state.questions.filter(q=>q.kind==='professional'),fa=state.questions.filter(q=>q.kind==='firstaid'),common=state.questions.filter(q=>q.kind==='common');
  const byCommon=Object.fromEntries(SOURCES.common.map(s=>[s.code,common.filter(q=>q.subjectCode===s.code).length]));
  const ep=excludedCount('professional'),ef=excludedCount('firstaid');
  return {professional:p.length,firstaid:fa.length,common:common.length,byCommon,excludedProfessional:ep,excludedFirstAid:ef,readyProfessional:p.length+ep>=647,readyFirstAid:fa.length+ef>=80,readyCommon:SOURCES.common.every(s=>(byCommon[s.code]||0)>=90)};
}
function attempts(kind=null){return [...state.progress.values()].reduce((sum,p)=>{const q=state.questions.find(x=>x.id===p.id);return sum+(!kind||q?.kind===kind?(p.attempts||0):0);},0);}
function exposureCount(p){return (p.attempts||0)+(p.unknown||0);}
function answeredUnique(kind=null){return state.questions.filter(q=>(!kind||q.kind===kind)&&exposureCount(getProgress(q.id))>0).length;}
function overallCorrect(kind=null){let a=0,c=0;for(const q of state.questions){if(kind&&q.kind!==kind)continue;const p=getProgress(q.id);a+=p.attempts||0;c+=p.correct||0;}return {a,c,rate:pct(c,a)};}
function latestHistory(p){return (p.history||[]).slice(-1)[0]||null;}
function pendingReview(kind=null){return state.questions.filter(q=>{if(kind&&q.kind!==kind)return false;const h=latestHistory(getProgress(q.id));return !!h&&(h.unknown||!h.correct);});}
function wrongEver(kind=null){return state.questions.filter(q=>(!kind||q.kind===kind)&&((getProgress(q.id).wrong||0)+(getProgress(q.id).unknown||0)>0));}
function unseen(kind){return state.questions.filter(q=>(!kind||q.kind===kind)&&exposureCount(getProgress(q.id))===0);}
function streakDays(){
  const dates=new Set([...state.progress.values()].flatMap(p=>(p.history||[]).map(h=>h.date)).filter(Boolean));let d=new Date(`${today()}T12:00:00+08:00`),n=0;
  while(true){const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(d);if(!dates.has(key))break;n++;d=new Date(d.getTime()-dayMs);}return n;
}
function categoryStats(kind=null){
  const cats={};for(const q of state.questions){if(kind&&q.kind!==kind)continue;const key=q.sectionName;cats[key]??={name:key,kind:q.kind,attempts:0,correct:0,wrong:0,unknown:0,total:0,seen:0};cats[key].total++;const p=getProgress(q.id);cats[key].attempts+=p.attempts||0;cats[key].correct+=p.correct||0;cats[key].wrong+=p.wrong||0;cats[key].unknown+=p.unknown||0;if(exposureCount(p))cats[key].seen++;}
  return Object.values(cats).map(x=>({...x,rate:pct(x.correct,x.attempts)})).sort((a,b)=>(a.attempts?a.rate:101)-(b.attempts?b.rate:101));
}
function todaysHistory(kind=null){return [...state.progress.values()].flatMap(p=>(p.history||[]).filter(h=>h.date===today()).map(h=>({...h,id:p.id}))).filter(h=>{if(!kind)return true;const q=state.questions.find(x=>x.id===h.id);return q?.kind===kind;});}
function todaysSummary(kind=null){
  const h=todaysHistory(kind),answered=h.filter(x=>!x.unknown),correct=answered.filter(x=>x.correct),wrong=answered.filter(x=>!x.correct);
  return {count:h.length,answered:answered.length,correct:correct.length,wrong:wrong.length,unknown:h.filter(x=>x.unknown).length,rate:pct(correct.length,answered.length)};
}
function dailyMode(kind){return kind==='firstaid'?'daily-firstaid':'daily-professional';}
function dailyAnsweredToday(kind){return todaysHistory(kind).filter(h=>h.mode===dailyMode(kind)).length;}
function cycleKey(kind){return `cycleDeck:${kind}`;}
function poolForKind(kind){return state.questions.filter(q=>q.kind===kind);}
async function ensureCycle(kind,{renewIfComplete=false}={}){
  const ids=poolForKind(kind).map(q=>q.id),idSet=new Set(ids);let d=getMeta(cycleKey(kind),null),changed=false;
  if(!d||!Array.isArray(d.remaining)||!Array.isArray(d.seen)){d={cycle:1,remaining:shuffle(ids),seen:[],startedAt:new Date().toISOString()};changed=true;}
  d={...d,remaining:d.remaining.filter(id=>idSet.has(id)),seen:d.seen.filter(id=>idSet.has(id))};
  const known=new Set([...d.remaining,...d.seen]);const added=ids.filter(id=>!known.has(id));if(added.length){d.remaining.push(...shuffle(added));changed=true;}
  if(renewIfComplete&&d.remaining.length===0&&ids.length){d={cycle:(d.cycle||1)+1,remaining:shuffle(ids),seen:[],startedAt:new Date().toISOString()};changed=true;}
  if(changed)await setMeta(cycleKey(kind),d);return d;
}
function cycleInfo(kind){const d=getMeta(cycleKey(kind),null),total=poolForKind(kind).length;if(!d)return {cycle:1,remaining:total,seen:0,total,complete:false};const rem=(d.remaining||[]).filter(id=>poolForKind(kind).some(q=>q.id===id)).length;return {cycle:d.cycle||1,remaining:rem,seen:Math.max(0,total-rem),total,complete:total>0&&rem===0};}
async function consumeCycle(kind,id){const d=await ensureCycle(kind);if(!d)return;const before=d.remaining.length;d.remaining=d.remaining.filter(x=>x!==id);if(!d.seen.includes(id))d.seen.push(id);if(d.remaining.length!==before)await setMeta(cycleKey(kind),d);}
async function startDailyKind(kind){
  const target=kind==='firstaid'?Number(getMeta('dailyFirstAid',20)):Number(getMeta('dailyProfessional',50)),done=dailyAnsweredToday(kind);if(done>=target){toast('今天這份作業已完成');return;}
  const d=await ensureCycle(kind,{renewIfComplete:true}),need=Math.max(0,target-done),ids=d.remaining.slice(0,Math.min(need,d.remaining.length)),map=new Map(poolForKind(kind).map(q=>[q.id,q])),qs=ids.map(id=>map.get(id)).filter(Boolean);
  if(!qs.length){toast('目前沒有可出的題目');return;}startQuiz(qs,dailyMode(kind),kind==='firstaid'?'寵物急救每日作業':'寵物美容丙級每日作業');
}
async function recordAnswer(q,chosen,opts={}){
  const unknown=!!opts.unknown,trackId=q.originId||q.id,mode=opts.mode||state.session?.mode||'practice';
  const old=getProgress(trackId),p={...old,history:[...(old.history||[])]},now=new Date().toISOString();p.lastAt=now;p.lastAnswer=unknown?null:chosen;
  if(unknown){p.unknown=(p.unknown||0)+1;p.streak=0;p.needsReview=true;p.history.push({date:today(),at:now,chosen:null,answer:q.answer,correct:false,unknown:true,mode});}
  else{const correct=chosen===q.answer;p.attempts=(p.attempts||0)+1;p.history.push({date:today(),at:now,chosen,answer:q.answer,correct,unknown:false,mode});if(correct){p.correct=(p.correct||0)+1;p.streak=(p.streak||0)+1;p.needsReview=false;}else{p.wrong=(p.wrong||0)+1;p.streak=0;p.needsReview=true;}}
  p.history=p.history.slice(-160);await saveProgress(p);
  if(mode==='daily-professional')await consumeCycle('professional',trackId);if(mode==='daily-firstaid')await consumeCycle('firstaid',trackId);
  return {correct:!unknown&&chosen===q.answer,unknown};
}
function planFor(kind){const target=kind==='firstaid'?Number(getMeta('dailyFirstAid',20)):Number(getMeta('dailyProfessional',50)),done=dailyAnsweredToday(kind),cycle=cycleInfo(kind);return {target,done,remainingToday:Math.max(0,target-done),cycle};}

function renderHome(){
  const v=document.querySelector('#view-home'),b=bankInfo(),pro=planFor('professional'),fa=planFor('firstaid'),proToday=todaysSummary('professional'),faToday=todaysSummary('firstaid'),proWrong=pendingReview('professional').length,faWrong=pendingReview('firstaid').length,oc=overallCorrect();
  v.innerHTML=`
    <div class="hero"><div class="eyebrow" style="color:#ded9ff">TODAY</div><h2>今天要刷哪一套？</h2><p>美容丙級和寵物急救完全分開；答錯或按「不知道」的題目會留下來給你複習。</p><div class="metrics"><div class="metric"><b>${streakDays()}</b><small>連續天數</small></div><div class="metric"><b>${answeredUnique()}</b><small>已做過題目</small></div><div class="metric"><b>${oc.rate}%</b><small>作答正確率</small></div></div></div>
    ${!b.readyProfessional||!b.readyFirstAid?`<div class="banner"><b>題庫正在修復。</b><br><span class="small-text">美容 ${b.professional}+排除 ${b.excludedProfessional}/647；急救 ${b.firstaid}+排除 ${b.excludedFirstAid}/80。</span></div>`:''}
    <div class="section-title"><h2>兩份每日作業</h2><span class="pill">互不混題</span></div>
    <div class="card"><div class="task"><div><b>寵物美容丙級</b><span class="muted small-text">今日 ${pro.done}/${pro.target} · 第 ${pro.cycle.cycle} 輪 · 本輪剩 ${pro.cycle.remaining}/${pro.cycle.total}</span></div><span class="pill ${proWrong?'bad':'good'}">待複習 ${proWrong}</span></div><div class="progress"><i style="width:${pct(pro.cycle.seen,pro.cycle.total)}%"></i></div><p class="muted small-text">原始 647 題；已永久排除 ${b.excludedProfessional} 題。整輪尚未刷完前，不會重複出已做過的題目。</p><button id="startProDaily" class="primary wide" ${!b.readyProfessional||pro.done>=pro.target?'disabled':''}>${pro.done>=pro.target?'今天已完成':'開始／繼續美容作業'}</button></div>
    <div class="card"><div class="task"><div><b>寵物急救</b><span class="muted small-text">今日 ${fa.done}/${fa.target} · 第 ${fa.cycle.cycle} 輪 · 本輪剩 ${fa.cycle.remaining}/${fa.cycle.total}</span></div><span class="pill ${faWrong?'bad':'good'}">待複習 ${faWrong}</span></div><div class="progress"><i style="width:${pct(fa.cycle.seen,fa.cycle.total)}%"></i></div><p class="muted small-text">80 題自建學科練習題，與美容丙級完全分開，不會混進 647 題。</p><button id="startFaDaily" class="secondary wide" ${!b.readyFirstAid||fa.done>=fa.target?'disabled':''}>${fa.done>=fa.target?'今天已完成':'開始／繼續急救作業'}</button></div>
    <div class="grid2"><div class="card"><h3>今天美容</h3><p class="muted small-text">答對 ${proToday.correct} · 答錯 ${proToday.wrong} · 不知道 ${proToday.unknown}</p></div><div class="card"><h3>今天急救</h3><p class="muted small-text">答對 ${faToday.correct} · 答錯 ${faToday.wrong} · 不知道 ${faToday.unknown}</p></div></div>
    <div class="section-title"><h2>快速入口</h2></div><div class="grid2"><button id="goReview" class="secondary">錯題複習 (${proWrong+faWrong})</button><button id="goHistory" class="ghost">歷屆試題</button></div>
    <div class="section-title"><h2>題庫狀態</h2><button id="settingsBtn" class="ghost small">設定</button></div><div class="card"><div class="task"><div><b>13900 專業</b><span class="muted small-text">有效 ${b.professional} · 排除 ${b.excludedProfessional}</span></div><span class="pill ${b.readyProfessional?'good':'warn'}">647</span></div><div class="task"><div><b>寵物急救</b><span class="muted small-text">自建練習題 · 非官方考古題</span></div><span class="pill ${b.readyFirstAid?'good':'warn'}">${b.firstaid}/80</span></div><div class="task"><div><b>共同科目</b><span class="muted small-text">只供自由刷題與丙級模考，不混入美容每日 647 題</span></div><span class="pill ${b.readyCommon?'good':'warn'}">${b.common}/400</span></div></div>`;
  v.querySelector('#startProDaily')?.addEventListener('click',()=>startDailyKind('professional'));v.querySelector('#startFaDaily')?.addEventListener('click',()=>startDailyKind('firstaid'));v.querySelector('#goReview').onclick=()=>navigate('review');v.querySelector('#goHistory').onclick=()=>renderHistory(true);v.querySelector('#settingsBtn').onclick=()=>renderSettings(true);
}

function renderStudy(){
  const v=document.querySelector('#view-study'),b=bankInfo();
  v.innerHTML=`<div class="section-title"><h2>自由刷題</h2><span class="pill">選哪套就只出哪套</span></div>
  <div class="card"><h3>寵物美容丙級</h3><p class="muted small-text">文字選項會隨機換位置，避免背 A/B/C/D。</p><div class="stack">${SOURCES.professional.sections.map(([code,name,count])=>{const qs=state.questions.filter(q=>q.kind==='professional'&&q.section===code);return `<button class="categoryBtn ghost" data-kind="professional" data-code="${code}"><b>${code} ${esc(name)}</b><br><span class="small-text muted">${qs.length}/${count} 題</span></button>`}).join('')}</div><button id="proRandom" class="secondary wide" style="margin-top:12px">美容隨機 30 題</button></div>
  <div class="card"><h3>寵物急救</h3><p class="muted small-text">自建練習題，不與美容題混合。</p><div class="stack">${[...new Map(state.questions.filter(q=>q.kind==='firstaid').map(q=>[q.section,q.sectionName])).entries()].map(([code,name])=>`<button class="categoryBtn ghost" data-kind="firstaid" data-code="${code}">${esc(name)} <span class="small-text muted">${state.questions.filter(q=>q.kind==='firstaid'&&q.section===code).length} 題</span></button>`).join('')}</div><button id="faRandom" class="secondary wide" style="margin-top:12px">急救隨機 20 題</button></div>
  <div class="card"><h3>共同科目</h3><div class="stack">${SOURCES.common.map(s=>`<button class="categoryBtn ghost" data-kind="common" data-code="${s.code}">${esc(s.label)} <span class="small-text muted">${state.questions.filter(q=>q.subjectCode===s.code).length} 題</span></button>`).join('')}</div></div>
  <div class="card"><h3>其他</h3><div class="grid2"><button id="starBtn" class="ghost">收藏題</button><button id="searchBtn" class="ghost">搜尋題目</button></div><div id="searchBox" style="display:none;margin-top:12px"><input id="searchInput" placeholder="輸入題目關鍵字…" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px"><div id="searchResults"></div></div></div>`;
  v.querySelectorAll('.categoryBtn').forEach(btn=>btn.addEventListener('click',()=>{const kind=btn.dataset.kind,code=btn.dataset.code;let pool=[];if(kind==='professional')pool=state.questions.filter(q=>q.kind==='professional'&&q.section===code);else if(kind==='firstaid')pool=state.questions.filter(q=>q.kind==='firstaid'&&q.section===code);else pool=state.questions.filter(q=>q.subjectCode===code);startQuiz(sample(pool,30),'practice',btn.textContent.trim());}));
  v.querySelector('#proRandom').onclick=()=>startQuiz(sample(poolForKind('professional'),30),'practice','美容隨機 30 題');v.querySelector('#faRandom').onclick=()=>startQuiz(sample(poolForKind('firstaid'),20),'practice','急救隨機 20 題');v.querySelector('#starBtn').onclick=()=>startQuiz(state.questions.filter(q=>getProgress(q.id).starred),'practice','收藏題');
  v.querySelector('#searchBtn').onclick=()=>{const box=v.querySelector('#searchBox');box.style.display=box.style.display==='none'?'block':'none';};v.querySelector('#searchInput').oninput=e=>{const x=e.target.value.trim().toLowerCase(),r=v.querySelector('#searchResults');if(x.length<2){r.innerHTML='';return;}const hits=state.questions.filter(q=>(q.prompt+' '+q.options.join(' ')).toLowerCase().includes(x)).slice(0,30);r.innerHTML=hits.map(q=>`<button class="searchHit ghost wide" data-id="${q.id}" style="margin-top:8px;text-align:left">${esc(q.prompt.slice(0,70))}</button>`).join('');r.querySelectorAll('.searchHit').forEach(btn=>btn.onclick=()=>startQuiz([state.questions.find(q=>q.id===btn.dataset.id)],'practice','搜尋結果'));};
}

function renderReview(){
  const v=document.querySelector('#view-review'),pro=pendingReview('professional'),fa=pendingReview('firstaid'),common=pendingReview('common'),ever=wrongEver();
  const block=(title,arr,id)=>`<div class="card"><div class="task"><div><b>${title}</b><span class="muted small-text">最近一次仍答錯或按「不知道」</span></div><span class="pill ${arr.length?'bad':'good'}">${arr.length} 題</span></div><button id="${id}" class="${arr.length?'secondary':'ghost'} wide" ${!arr.length?'disabled':''}>開始複習</button></div>`;
  v.innerHTML=`<div class="section-title"><h2>錯題複習</h2><span class="pill bad">待複習 ${pro.length+fa.length+common.length}</span></div>${block('寵物美容丙級',pro,'reviewPro')}${block('寵物急救',fa,'reviewFa')}${block('共同科目',common,'reviewCommon')}<div class="card"><h3>錯題紀錄</h3><p class="muted small-text">曾經答錯或按「不知道」就會保留在紀錄裡；之後答對會離開「待複習」，但歷史不會消失。</p>${ever.length?ever.slice(0,14).map(q=>{const p=getProgress(q.id);return `<div class="task"><div><b>${esc(q.prompt.slice(0,52))}${q.prompt.length>52?'…':''}</b><span class="muted small-text">${esc(q.sectionName)} · 錯 ${p.wrong||0} · 不知道 ${p.unknown||0}</span></div></div>`}).join(''):'<div class="empty">目前沒有錯題</div>'}</div>`;
  v.querySelector('#reviewPro').onclick=()=>startQuiz(pro,'review','美容待複習');v.querySelector('#reviewFa').onclick=()=>startQuiz(fa,'review','急救待複習');v.querySelector('#reviewCommon').onclick=()=>startQuiz(common,'review','共同科目待複習');
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
  const v=document.querySelector('#view-stats'),b=bankInfo(),pro=overallCorrect('professional'),fa=overallCorrect('firstaid'),proPending=pendingReview('professional').length,faPending=pendingReview('firstaid').length;
  const rows=(kind)=>categoryStats(kind).map(c=>`<div class="stat-row"><span>${esc(c.name)}</span><div class="progress"><i style="width:${c.attempts?c.rate:0}%"></i></div><b>${c.attempts?c.rate+'%':'—'}</b></div>`).join('');
  v.innerHTML=`<div class="section-title"><h2>學習紀錄</h2><span class="pill">錯題優先</span></div><div class="grid2"><div class="card"><h3>美容 ${pro.rate}%</h3><span class="muted small-text">已做 ${answeredUnique('professional')}/${b.professional} · 待複習 ${proPending}</span></div><div class="card"><h3>急救 ${fa.rate}%</h3><span class="muted small-text">已做 ${answeredUnique('firstaid')}/${b.firstaid} · 待複習 ${faPending}</span></div></div><div class="card"><h3>美容各項目</h3>${rows('professional')}</div><div class="card"><h3>急救各主題</h3>${rows('firstaid')}</div><div class="card"><h3>永久排除</h3><p class="muted small-text">美容 ${b.excludedProfessional} 題 · 急救 ${b.excludedFirstAid} 題。排除後不會再被題庫更新補回每日作業。</p></div>`;
}

function renderSettings(navigateNow=false){
  if(navigateNow){state.view='settings';document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelector('#view-settings').classList.add('active');document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));}
  const last=getMeta('lastAutoBackupAt',null),persist=getMeta('storagePersistent',false),ex=(getMeta('excludedQuestionIds',[])||[]),customEx=customExcludedIds();const lastText=last?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(last)):'尚未建立';
  const v=document.querySelector('#view-settings');v.innerHTML=`<div class="section-title"><h2>設定</h2><span class="pill">${APP_VERSION}</span></div><div class="card"><div class="setting-row"><div><b>每日美容題數</b><div class="muted small-text">從本輪尚未出現的題目依隨機牌組往下刷</div></div><input id="dailyPro" type="number" min="5" max="100" value="${getMeta('dailyProfessional',50)}"></div><div class="setting-row"><div><b>每日急救題數</b><div class="muted small-text">與美容作業完全分開</div></div><input id="dailyFa" type="number" min="5" max="80" value="${getMeta('dailyFirstAid',20)}"></div></div><div class="card"><h3>刷題規則</h3><p class="muted small-text">美容原始 647 題會先扣除固定不考題，再把有效題目整輪刷完才開始重複；被永久排除的不考題不會再出現。文字選項會隨機換位置，避免只背 A/B/C/D。系統主要保留答錯與「不知道」的紀錄，供後續複習。</p></div><div class="card"><h3>永久排除題目</h3><p class="muted small-text">固定不考 ${DEFAULT_EXCLUDED_IDS.length} 題（13900-06：11、12、14、15、18–23、25–42）；另外自行排除 ${customEx.length} 題。題庫同步、App 更新與清除學習紀錄都不會把固定不考題加回來。</p><button id="restoreExcluded" class="ghost wide" ${!customEx.length?'disabled':''}>恢復自行排除題 (${customEx.length})</button></div><div class="card"><h3>自動保存與備份</h3><p><b>✓ 每一題作答後自動保存</b></p><div class="sync-line"><span>最近自動快照</span><b>${esc(lastText)}</b></div><div class="sync-line"><span>瀏覽器永久儲存</span><b>${persist?'已啟用':'未確認'}</b></div><div class="grid2" style="margin-top:12px"><button id="exportBtn" class="secondary">匯出備份</button><button id="importBackupBtn" class="ghost">匯入備份</button></div><input id="backupFile" type="file" accept="application/json" hidden></div><div class="card"><h3>題庫</h3><button id="syncSettings" class="primary wide">同步／更新題庫</button></div><div class="card"><h3>危險區</h3><button id="resetBtn" class="danger wide">清除學習紀錄（保留排除題）</button></div><button id="settingsHome" class="ghost wide">回今日首頁</button>`;
  v.querySelector('#dailyPro').onchange=async e=>{await setMeta('dailyProfessional',clamp(Number(e.target.value)||50,5,100));queueAutoSnapshot('設定更新');};v.querySelector('#dailyFa').onchange=async e=>{await setMeta('dailyFirstAid',clamp(Number(e.target.value)||20,5,80));queueAutoSnapshot('設定更新');};v.querySelector('#syncSettings').onclick=openSyncDialog;v.querySelector('#settingsHome').onclick=()=>navigate('home');v.querySelector('#exportBtn').onclick=exportBackup;v.querySelector('#importBackupBtn').onclick=()=>v.querySelector('#backupFile').click();v.querySelector('#backupFile').onchange=importBackup;
  v.querySelector('#restoreExcluded').onclick=()=>confirmAction('恢復自行排除題？','只會恢復你之後手動排除的題目；已確認不考的固定 28 題仍維持排除。',async()=>{await setMeta('excludedQuestionIds',[...DEFAULT_EXCLUDED_IDS]);await reloadQuestions();await ensureCycle('professional');await ensureCycle('firstaid');toast('已恢復自行排除題');renderSettings();});
  v.querySelector('#resetBtn').onclick=()=>confirmAction('清除學習紀錄？','作答、錯題與成績會歸零；永久排除清單會保留。',async()=>{await clearStore(STORE_P);state.progress.clear();await setMeta('mockResults',[]);await setMeta(cycleKey('professional'),null);await setMeta(cycleKey('firstaid'),null);await ensureCycle('professional');await ensureCycle('firstaid');await writeAutoSnapshot('清除後快照');toast('學習紀錄已清除');renderSettings();});
}

function navigate(view){state.view=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='home')renderHome();if(view==='study')renderStudy();if(view==='review')renderReview();if(view==='exam')renderExam();if(view==='stats')renderStats();window.scrollTo(0,0);}


function shuffleQuestionChoices(q){
  if(q.image||q.imageLikely||!Array.isArray(q.options)||q.options.length!==4)return {...q};
  const pairs=q.options.map((text,i)=>({text,correct:i+1===q.answer})),mixed=shuffle(pairs);return {...q,options:mixed.map(x=>x.text),answer:mixed.findIndex(x=>x.correct)+1};
}
function prepareQuizQuestions(questions,mode){if(mode==='history'||mode==='mock')return questions.map(q=>({...q}));return questions.map(shuffleQuestionChoices);}
function startQuiz(questions,mode='practice',title='刷題',opts={}){
  if(!questions?.length){toast('目前沒有符合條件的題目');return;}state.session={questions:prepareQuizQuestions(questions,mode),index:0,mode,title,answers:[],selected:null,answered:false,unknown:false,startedAt:Date.now(),seconds:opts.seconds||null,noFeedback:!!opts.noFeedback,timer:null};state.view='study';document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-study'));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view==='study'));renderQuiz();
}
function renderQuiz(){
  const s=state.session;if(!s)return renderStudy();if(s.index>=s.questions.length)return finishQuiz();const q=s.questions[s.index],p=getProgress(q.originId||q.id),v=document.querySelector('#view-study'),timeHtml=s.seconds!=null?`<span id="timer" class="pill warn">${formatTime(Math.max(0,s.seconds-Math.floor((Date.now()-s.startedAt)/1000)))}</span>`:`<span class="pill">${s.index+1}/${s.questions.length}</span>`,canExclude=!['mock','history'].includes(s.mode)&&!q.originId;
  v.innerHTML=`<div class="question-head"><div><div class="eyebrow">${esc(s.title)}</div><div class="question-no">${esc(q.sectionName)} · 第 ${q.number} 題</div></div>${timeHtml}</div><div class="progress" style="margin:12px 0 18px"><i style="width:${pct(s.index,s.questions.length)}%"></i></div><div class="card"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="pill ${(p.wrong||p.unknown)?'bad':''}">${exposureCount(p)?`做過 ${exposureCount(p)} 次 · 錯 ${p.wrong||0} · 不知道 ${p.unknown||0}`:'第一次出現'}</span><div class="row" style="gap:6px"><button id="starQuestion" class="ghost small">${p.starred?'★ 已收藏':'☆ 收藏'}</button>${canExclude?'<button id="excludeQuestion" class="ghost small">永久排除</button>':''}</div></div><div class="question-text">${esc(q.prompt)}</div>${q.image?`<figure class="question-figure"><img src="${esc(q.image)}" alt="${esc(q.imageAlt||'原題圖示')}" loading="eager"></figure>`:(q.imageLikely?'<div class="banner">這題含原題圖示；請以原題圖片為準。</div>':'')}<div class="options">${q.options.map((o,i)=>`<button class="option" data-answer="${i+1}"><span class="letter">${LETTERS[i]}</span><span>${esc(o)}</span></button>`).join('')}</div><div id="feedback"></div>${s.noFeedback?'':`<div class="learning-actions"><button id="unknownBtn" class="secondary">不知道，直接看答案</button></div>`}<div class="quiz-actions"><button id="nextBtn" class="primary" disabled>${s.index===s.questions.length-1?'完成':'下一題'}</button></div></div><button id="quitQuiz" class="ghost wide">先離開</button>`;
  v.querySelectorAll('.option').forEach(btn=>btn.onclick=()=>selectAnswer(Number(btn.dataset.answer)));v.querySelector('#unknownBtn')?.addEventListener('click',revealUnknown);v.querySelector('#nextBtn').onclick=advanceQuiz;v.querySelector('#quitQuiz').onclick=()=>{if(s.mode==='mock')confirmAction('離開模擬考？','目前進度不會計入模考成績。',()=>{clearQuizTimer();state.session=null;navigate('exam');});else{clearQuizTimer();state.session=null;navigate('home');}};
  v.querySelector('#starQuestion').onclick=async()=>{const pid=q.originId||q.id,pp={...getProgress(pid),starred:!getProgress(pid).starred};await saveProgress(pp);v.querySelector('#starQuestion').textContent=pp.starred?'★ 已收藏':'☆ 收藏';};v.querySelector('#excludeQuestion')?.addEventListener('click',()=>excludeCurrentQuestion(q));
  if(s.seconds!=null){clearQuizTimer();s.timer=setInterval(()=>{const rem=s.seconds-Math.floor((Date.now()-s.startedAt)/1000),el=document.querySelector('#timer');if(el)el.textContent=formatTime(Math.max(0,rem));if(rem<=0){clearQuizTimer();toast('時間到，自動交卷');finishQuiz(true);}},1000);}
}
async function excludeCurrentQuestion(q){
  confirmAction('永久排除這題？','排除後，每日作業、自由刷題、錯題複習、模考與題庫更新都不會再出現；只能到設定恢復。',async()=>{const ids=new Set(getMeta('excludedQuestionIds',[])||[]);ids.add(q.id);await setMeta('excludedQuestionIds',[...ids].sort());await reloadQuestions();for(const kind of ['professional','firstaid'])await ensureCycle(kind);const s=state.session;if(s){s.questions.splice(s.index,1);s.answered=false;s.selected=null;s.unknown=false;}toast('已永久排除這題');if(!state.session?.questions.length){state.session=null;navigate('home');}else renderQuiz();});
}
function setAnsweredUI(q,{correct=false,unknown=false}){
  const s=state.session,v=document.querySelector('#view-study');v.querySelectorAll('.option').forEach(btn=>{const x=Number(btn.dataset.answer);btn.disabled=true;if(!s.noFeedback){if(x===q.answer)btn.classList.add('correct');if(!unknown&&x===s.selected&&!correct)btn.classList.add('wrong');}});v.querySelector('#nextBtn').disabled=false;const u=v.querySelector('#unknownBtn');if(u)u.hidden=true;if(!s.noFeedback){const answerText=q.options[q.answer-1]||'';const fb=v.querySelector('#feedback');fb.className=`feedback ${unknown?'learn':(correct?'correct':'wrong')}`;fb.innerHTML=correct?`<b>答對。</b> 正確答案：${LETTERS[q.answer-1]}　${esc(answerText)}`:`<b>${unknown?'不知道':'答錯'}。</b> 正確答案：${LETTERS[q.answer-1]}　${esc(answerText)}<div class="small-text" style="margin-top:8px">已記入待複習。</div>`;}
}
async function selectAnswer(n){const s=state.session;if(!s||s.answered)return;s.selected=n;s.answered=true;const q=s.questions[s.index],correct=n===q.answer;s.answers.push({id:q.id,chosen:n,answer:q.answer,correct,unknown:false});if(s.mode!=='mock'&&s.mode!=='history')await recordAnswer(q,n,{unknown:false,mode:s.mode});setAnsweredUI(q,{correct,unknown:false});}
async function revealUnknown(){const s=state.session;if(!s||s.answered||s.noFeedback)return;const q=s.questions[s.index];s.answered=true;s.unknown=true;s.selected=null;s.answers.push({id:q.id,chosen:null,answer:q.answer,correct:false,unknown:true});await recordAnswer(q,null,{unknown:true,mode:s.mode});setAnsweredUI(q,{correct:false,unknown:true});}
function advanceQuiz(){const s=state.session;if(!s?.answered)return;s.index++;s.selected=null;s.answered=false;s.unknown=false;renderQuiz();}

async function finishQuiz(force=false){
  const s=state.session;if(!s)return;clearQuizTimer();
  if(s.mode==='history'){
    for(const a of s.answers){const q=s.questions.find(x=>x.id===a.id);if(q?.originId)await recordAnswer(q,a.chosen,{unknown:false,mode:'history'});}
    const correct=s.answers.filter(a=>a.correct).length,total=s.questions.length,score=Number((correct*1.25).toFixed(2)),results=getMeta('historyResults',[]),paperId=s.questions[0]?.section||'';results.push({at:new Date().toISOString(),paperId,label:s.title,score,correct,total});await setMeta('historyResults',results.slice(-40));
    const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">PAST EXAM RESULT</div><h2>${score} 分 · ${score>=60?'及格':'未及格'}</h2><p>${esc(s.title)} · 答對 ${correct}/${total} 題</p></div><div class="grid2"><button id="reviewHistory" class="secondary" ${correct===total?'disabled':''}>重做本次錯題</button><button id="backHistory" class="primary">回歷屆試題</button></div>`;v.querySelector('#reviewHistory').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id),retry=s.questions.filter(q=>ids.includes(q.id));state.session=null;startQuiz(retry,'review',`${s.title} 錯題`);};v.querySelector('#backHistory').onclick=()=>{state.session=null;renderHistory(true);};return;
  }
  if(s.mode==='mock'){
    for(const a of s.answers){const q=state.questions.find(q=>q.id===a.id);if(q)await recordAnswer(q,a.chosen,{unknown:false,mode:'mock'});}const correct=s.answers.filter(a=>a.correct).length,score=Number((correct*1.25).toFixed(2)),results=getMeta('mockResults',[]);results.push({at:new Date().toISOString(),score,correct,total:80});await setMeta('mockResults',results.slice(-30));const v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">MOCK RESULT</div><h2>${score} 分 · ${score>=60?'及格':'未及格'}</h2><p>答對 ${correct}/80 題${force?'（時間到）':''}</p></div><div class="grid2"><button id="reviewMock" class="secondary">複習本次錯題</button><button id="backExam" class="primary">回模考首頁</button></div>`;v.querySelector('#reviewMock').onclick=()=>{const ids=s.answers.filter(a=>!a.correct).map(a=>a.id);state.session=null;startQuiz(state.questions.filter(q=>ids.includes(q.id)),'review','模考錯題');};v.querySelector('#backExam').onclick=()=>{state.session=null;navigate('exam');};return;
  }
  const c=s.answers.filter(a=>a.correct).length,u=s.answers.filter(a=>a.unknown).length,w=s.answers.filter(a=>!a.correct&&!a.unknown).length,reviewIds=[...new Set(s.answers.filter(a=>a.unknown||!a.correct).map(a=>a.id))],v=document.querySelector('#view-study');v.innerHTML=`<div class="hero"><div class="eyebrow" style="color:#ded9ff">DONE</div><h2>${s.answers.length} 題完成</h2><p>答對 ${c} · 答錯 ${w}${u?` · 不知道 ${u}`:''}</p></div><div class="card"><h3>本輪錯題</h3><p class="muted">${reviewIds.length?`有 ${reviewIds.length} 題已記入待複習。`:'這輪沒有待複習題。'}</p></div><div class="grid2"><button id="reviewSession" class="secondary" ${!reviewIds.length?'disabled':''}>馬上重做 (${reviewIds.length})</button><button id="finishHome" class="primary">回今日首頁</button></div>`;v.querySelector('#reviewSession').onclick=()=>{const retry=s.questions.filter(q=>reviewIds.includes(q.id));state.session=null;startQuiz(retry,'review','本輪錯題');};v.querySelector('#finishHome').onclick=()=>{state.session=null;navigate('home');};
}

function clearQuizTimer(){if(state.session?.timer){clearInterval(state.session.timer);state.session.timer=null;}}
function formatTime(sec){const m=Math.floor(sec/60),s=sec%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}

function openSyncDialog(){renderSyncStatus();document.querySelector('#syncDialog').showModal();}
function syncMsg(msg){document.querySelector('#syncStatus').innerHTML=`<div class="banner">${esc(msg)}</div>`;}
function renderSyncStatus(){const b=bankInfo();document.querySelector('#syncStatus').innerHTML=`<div class="sync-line"><span>專業題庫</span><b>${b.professional}+排除 ${b.excludedProfessional}/647</b></div><div class="sync-line"><span>寵物急救練習</span><b>${b.firstaid}+排除 ${b.excludedFirstAid}/80</b></div>${SOURCES.common.map(s=>`<div class="sync-line"><span>${esc(s.label)}</span><b>${b.byCommon[s.code]||0}/${s.expected}</b></div>`).join('')}`;}
async function autoSync(){const btn=document.querySelector('#autoSyncBtn');btn.disabled=true;try{await loadBundledProfessional(syncMsg);await loadBundledFirstAid(syncMsg);await loadPdfJs();for(const src of SOURCES.common)await syncOneCommon(src,syncMsg);await reloadQuestions();await ensureCycle('professional');await ensureCycle('firstaid');syncMsg(`同步完成：美容 647 題、急救 80 題、共同 ${bankInfo().common} 題。永久排除清單已保留。`);renderSyncStatus();toast('題庫同步完成');renderHome();}catch(e){console.error(e);syncMsg(`同步沒有完成：${e.message}`);}finally{btn.disabled=false;}}
async function repairProfessional(){const btn=document.querySelector('#repairProfessionalBtn');if(btn)btn.disabled=true;try{const qs=await loadBundledProfessional(syncMsg);await reloadQuestions();await ensureCycle('professional');renderSyncStatus();syncMsg(`專業題庫已修復 ${qs.length}/647 題；永久排除題不會復活，作答與錯題紀錄保留。`);toast('專業 647 題已修復');renderHome();}catch(e){console.error(e);syncMsg(`專業題庫修復失敗：${e.message}`);}finally{if(btn)btn.disabled=false;}}
async function syncCommon(){const btn=document.querySelector('#syncCommonBtn');btn.disabled=true;try{await loadPdfJs();for(const src of SOURCES.common)await syncOneCommon(src,syncMsg);await reloadQuestions();renderSyncStatus();toast('共同科目更新完成');}catch(e){syncMsg(`共同科目同步失敗：${e.message}`);}finally{btn.disabled=false;}}
async function importProfessionalFile(file){if(!file)return;try{await loadPdfJs();const buf=await file.arrayBuffer();const qs=await importProfessionalBuffer(buf,syncMsg);await reloadQuestions();await ensureCycle('professional');renderSyncStatus();syncMsg(`專業題庫已匯入 ${qs.length} 題；永久排除清單已保留。`);toast('專業題庫匯入完成');renderHome();}catch(e){syncMsg(`匯入失敗：${e.message}`);}}

async function exportBackup(){const data=backupPayload();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`寵物美容與急救_學習備份_${today()}.json`;a.click();URL.revokeObjectURL(a.href);}
async function importBackup(e){const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.progress))throw new Error('格式不正確');await bulkPut(STORE_P,data.progress);for(const p of data.progress)state.progress.set(p.id,p);if(data.meta)for(const [k,v] of Object.entries(data.meta))await setMeta(k,v);await migrateExclusions();await reloadQuestions();await ensureCycle('professional');await ensureCycle('firstaid');await writeAutoSnapshot('匯入備份');toast('學習紀錄已還原');renderSettings();}catch(err){console.error(err);toast('備份檔無法匯入');}}
function confirmAction(title,text,fn){const d=document.querySelector('#confirmDialog');d.querySelector('#confirmTitle').textContent=title;d.querySelector('#confirmText').textContent=text;const ok=d.querySelector('#confirmOk');ok.onclick=()=>setTimeout(fn,0);d.showModal();}


function bindAppEvents(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
  document.querySelector('#autoSyncBtn').onclick=autoSync;
  document.querySelector('#repairProfessionalBtn')?.addEventListener('click',repairProfessional);
  document.querySelector('#syncCommonBtn').onclick=syncCommon;
  document.querySelector('#importProfessionalBtn').onclick=()=>document.querySelector('#professionalFile').click();
  document.querySelector('#professionalFile').onchange=e=>importProfessionalFile(e.target.files?.[0]);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const btn=document.querySelector('#installBtn');btn.hidden=false;btn.onclick=async()=>{deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;btn.hidden=true;};});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')writeAutoSnapshot('離開 App');});
  window.addEventListener('pagehide',()=>writeAutoSnapshot('關閉頁面'));
}

async function refreshBundledBanksInBackground(){
  try{
    const proCount=state.questions.filter(q=>q.kind==='professional').length+excludedCount('professional');
    const faCount=state.questions.filter(q=>q.kind==='firstaid').length+excludedCount('firstaid');
    if(proCount<SOURCES.professional.expected||getMeta('bundledProfessionalVersion')!==APP_VERSION){
      await loadBundledProfessional(()=>{});await setMeta('bundledProfessionalVersion',APP_VERSION);
    }
    if(faCount<80||getMeta('bundledFirstAidVersion')!==APP_VERSION){
      await loadBundledFirstAid(()=>{});await setMeta('bundledFirstAidVersion',APP_VERSION);
    }
    await reloadQuestions();await ensureCycle('professional');await ensureCycle('firstaid');renderHome();
  }catch(e){
    console.warn('bundled bank load failed',e);
    toast(`題庫背景載入失敗：${e.message}`);
    renderHome();
  }
}

async function init(){
  // 先顯示可操作的首頁，再初始化 IndexedDB；任何儲存/題庫問題都不能讓主畫面變成空白。
  renderHomeSafe('正在載入學習資料…');
  try{
    db=await openDB();
    state.progress=new Map((await getAll(STORE_P)).map(p=>[p.id,p]));
    state.meta=Object.fromEntries((await getAll(STORE_M)).map(x=>[x.key,x.value]));
    await migrateExclusions();
    await reloadQuestions();
    await ensureCycle('professional');
    await ensureCycle('firstaid');
    bindAppEvents();
    renderHomeSafe();
    refreshBundledBanksInBackground();
    ensurePersistentStorage().catch(e=>console.warn('persistent storage failed',e));
    writeAutoSnapshot('啟動 App').catch(e=>console.warn('startup snapshot failed',e));
    setTimeout(()=>autoSyncCommonInBackground(),1200);
  }catch(e){
    console.error('App initialization failed',e);
    renderHomeSafe(`資料初始化遇到問題：${e?.message||e}`);
  }
}

function renderHomeSafe(message=''){
  const v=document.querySelector('#view-home');
  if(!v)return;
  try{
    renderHome();
    if(message){
      const note=document.createElement('div');
      note.className='banner';
      note.innerHTML=`<b>${esc(message)}</b><br><span class="small-text">如果題庫還在載入，請稍候；你也可以到「設定 → 同步／更新題庫」手動修復。</span>`;
      v.prepend(note);
    }
  }catch(e){
    console.error('Home render failed',e);
    v.innerHTML=`<div class="banner bad"><b>首頁載入失敗</b><br><span class="small-text">${esc(e?.message||e)}</span></div><div class="card"><h3>先不要刪除學習資料</h3><p class="muted small-text">你的作答紀錄仍保留在手機本機。請先重新整理 App；若仍空白，再用「設定」中的備份／修復功能處理。</p></div>`;
  }
}

// HTML 本身先顯示載入訊息；即使 IndexedDB 啟動失敗，也不再留下整片空白。
const homeBoot=document.querySelector('#view-home');
if(homeBoot)homeBoot.innerHTML='<div class="card"><h3>正在開啟題庫…</h3><p class="muted small-text">先載入你的刷題紀錄，題庫更新會在背景進行。</p></div>';
init().catch(e=>{console.error(e);const home=document.querySelector('#view-home');if(home)home.innerHTML=`<div class="banner bad"><b>App 啟動失敗</b><br>${esc(e?.message||e)}</div>`;});
