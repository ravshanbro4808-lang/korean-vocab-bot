const express=require('express'),crypto=require('crypto'),fs=require('fs'),http=require('http');
const Database=require('better-sqlite3'),multer=require('multer'),{Telegraf,Markup}=require('telegraf'),{Server}=require('socket.io');
const {OAuth2Client}=require('google-auth-library');
const {BOT_TOKEN,WEBAPP_URL,ADMIN_IDS='',ADMIN_EMAILS='',GOOGLE_CLIENT_ID,SECRET='change-me',DEV,PORT=3000,TRANSLATE_URL,TRANSLATE_KEY,TRANSLATE_TARGET='uz',ANTHROPIC_API_KEY,FOX_MODEL='claude-haiku-5-5',GOOGLE_TRANSLATE_KEY,BOT_USERNAME='Koreys_lugat_2026_bot'}=process.env;
const DAY=864e5,PERMS=['dicts','import','tasks','payments','trials','users','plans','methods','admins'];
const DATA=process.env.DATA_DIR||'.';fs.mkdirSync(DATA+'/uploads',{recursive:true});fs.mkdirSync(DATA+'/audio',{recursive:true});
const db=new Database(DATA+'/data.db');
db.exec(`create table if not exists users(id integer primary key,name text,email text unique,is_admin int default 0,perms text default '',paid_until int default 0,trial text default 'none',created int);
create table if not exists dicts(id integer primary key autoincrement,name text,levels int default 1,sec int default 30,free int default 0);
create table if not exists words(id integer primary key autoincrement,dict_id int,level int,pos text,section int,ko text,uz text);
create table if not exists learned(user_id int,word_id int,primary key(user_id,word_id));
create table if not exists access(user_id int,dict_id int,primary key(user_id,dict_id));
create table if not exists tasks(id integer primary key autoincrement,dict_id int,level int,title text);
create table if not exists plans(id integer primary key autoincrement,months int,price int);
create table if not exists methods(id integer primary key autoincrement,name text,number text,holder text,on_ int default 1);
create table if not exists scores(user_id int,name text,week int,pts int default 0,primary key(user_id,week));
create table if not exists pays(id integer primary key autoincrement,user_id int,plan_id int,method_id int,file text,status text default 'pending',ts int);`);
for(const m0 of ['alter table words add column audio text','alter table access add column until int default 0','alter table plans add column dict_id int default 0',"alter table tasks add column pos text default ''",'alter table tasks add column section int default 0','alter table plans add column monthly int default 0','alter table pays add column months int default 0'])try{db.exec(m0)}catch{}
if(!one0('select 1 from methods'))for(const n of['Click','Payme','Karta'])db.prepare('insert into methods(name,number,holder) values(?,?,?)').run(n,'','');
function one0(s){return db.prepare(s).get()}
const q=(s,...a)=>db.prepare(s).all(...a),one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a);
const ownerIds=ADMIN_IDS.split(',').filter(Boolean).map(Number),ownerMail=ADMIN_EMAILS.toLowerCase().split(',').filter(Boolean);
const sign=id=>{const e=Date.now()+30*DAY,b=id+'.'+e;return b+'.'+crypto.createHmac('sha256',SECRET).update(b).digest('hex')};
const unsign=t=>{const [id,e,s]=String(t||'').split('.');return s&&+e>Date.now()&&crypto.createHmac('sha256',SECRET).update(id+'.'+e).digest('hex')===s?+id:null};
const fin=id=>{let u=one('select * from users where id=?',id);if(u&&(ownerIds.includes(u.id)||ownerMail.includes((u.email||'').toLowerCase()))&&u.is_admin!=2){run('update users set is_admin=2 where id=?',id);u=one('select * from users where id=?',id)}return u};
function auth({init,dev,token}){
  if(token){const id=unsign(token);return id?fin(id):null}
  let u;
  if(DEV&&dev)u={id:+dev,first_name:'Dev'+dev};
  else{try{const p=new URLSearchParams(init),h=p.get('hash');p.delete('hash');
    const s=[...p].map(([k,v])=>k+'='+v).sort().join('\n');
    const key=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    if(crypto.createHmac('sha256',key).update(s).digest('hex')!==h)return null;u=JSON.parse(p.get('user'))}catch{return null}}
  run('insert or ignore into users(id,name,created) values(?,?,?)',u.id,u.first_name,Date.now());return fin(u.id)}
const active=u=>u.is_admin||u.paid_until>Date.now();
const can=(u,d)=>active(u)||d.free||!!one('select 1 from access where user_id=? and dict_id=? and (until=0 or until>?)',u.id,d.id,Date.now());
const has=(u,p)=>u.is_admin==2||(u.is_admin==1&&u.perms.split(',').includes(p));
const wk=()=>Math.floor(Date.now()/(7*DAY));
const addScore=(id,name,p)=>{if(p>0)run('insert into scores(user_id,name,week,pts) values(?,?,?,?) on conflict(user_id,week) do update set pts=pts+excluded.pts',id,name,wk(),p)};
const app=express();app.use(express.json());app.get('/',(r,s)=>s.sendFile(__dirname+'/index.html'));app.use('/shots',express.static(DATA+'/uploads'));app.use('/audio',express.static(DATA+'/audio'));
const up=multer({dest:DATA+'/uploads/',limits:{fileSize:25*1024*1024}}),gc=GOOGLE_CLIENT_ID&&new OAuth2Client(GOOGLE_CLIENT_ID);
app.get('/config',(r,s)=>s.json({google:GOOGLE_CLIENT_ID||null,dev:!!DEV,bot:BOT_USERNAME,fox:!!ANTHROPIC_API_KEY}));
app.post('/auth/google',async(r,s)=>{try{const t=await gc.verifyIdToken({idToken:r.body.credential,audience:GOOGLE_CLIENT_ID}),p=t.getPayload();
  if(!p.email_verified)return s.status(401).json({e:'email'});const em=p.email.toLowerCase();
  let u=one('select * from users where email=?',em);
  if(!u){const i=run('insert into users(name,email,created) values(?,?,?)',p.name||em,em,Date.now());u=one('select * from users where id=?',i.lastInsertRowid)}
  else run('update users set name=? where id=?',p.name||u.name,u.id);
  s.json({token:sign(u.id)})}catch{s.status(401).json({e:'google'})}});
app.use('/api',(req,res,next)=>{const u=auth({init:req.get('x-init'),dev:req.get('x-dev'),token:(req.get('authorization')||'').slice(7)});if(!u)return res.status(401).json({e:'auth'});req.u=u;next()});
const adm=p=>(r,s,n)=>has(r.u,p)?n():s.status(403).json({e:'perm'});
app.get('/api/me',(r,s)=>s.json({id:r.u.id,name:r.u.name,email:r.u.email,is_admin:r.u.is_admin,perms:r.u.perms,paid_until:r.u.paid_until,trial:r.u.trial,active:active(r.u),PERMS}));
app.get('/api/stats',(r,s)=>s.json({learned:one('select count(*) n from learned where user_id=?',r.u.id).n,rank:(one('select pts from scores where user_id=? and week=?',r.u.id,wk())||{}).pts||0}));
app.post('/api/score',(r,s)=>{addScore(r.u.id,r.u.name,Math.min(+r.body.points||0,500));s.json({ok:1})});
app.get('/api/rating',(r,s)=>s.json(q('select name,pts from scores where week=? order by pts desc limit 20',wk())));
app.get('/api/plans',(r,s)=>s.json(q('select p.*,d.name dname from plans p left join dicts d on d.id=p.dict_id order by p.dict_id,p.months')));
app.get('/api/methods',(r,s)=>s.json(q('select * from methods where on_=1')));
app.get('/api/dicts',(r,s)=>s.json(q('select * from dicts').map(d=>({...d,ok:can(r.u,d)}))));
app.get('/api/tree/:id',(r,s)=>{const d=one('select * from dicts where id=?',r.params.id);
  if(!d||!can(r.u,d))return s.status(402).json({e:'pay'});
  s.json({d,rows:q('select level,pos,section,count(*) n from words where dict_id=? group by 1,2,3',d.id)})});
app.get('/api/words',(r,s)=>{const {dict,level,pos,section,mode}=r.query;
  const d=one('select * from dicts where id=?',dict);if(!d||!can(r.u,d))return s.status(402).json({e:'pay'});
  let sql='select w.*,(l.word_id is not null) learned from words w left join learned l on l.word_id=w.id and l.user_id=? where w.dict_id=?';
  const a=[r.u.id,dict];
  for(const [k,v] of [['level',level],['pos',pos],['section',section]])if(v){sql+=` and w.${k}=?`;a.push(v)}
  if(mode==='learned')sql+=' and l.word_id is not null';if(mode==='new')sql+=' and l.word_id is null';
  s.json(q(sql+' order by w.id',...a))});
app.post('/api/learned',(r,s)=>{r.body.on?run('insert or ignore into learned values(?,?)',r.u.id,r.body.id):run('delete from learned where user_id=? and word_id=?',r.u.id,r.body.id);s.json({ok:1})});
const GRAM={
 particle:[{q:"저___ 학생이에요.",h:"Men talabaman.",o:["는","를","가","에서"],a:"는"},{q:"책___ 읽어요.",h:"Kitob o'qiyman.",o:["를","을","이","는"],a:"을"},{q:"친구___ 와요.",h:"Do'st keladi.",o:["이","가","을","은"],a:"가"},{q:"학교___ 가요.",h:"Maktabga boraman.",o:["에","에서","를","도"],a:"에"},{q:"집___ 공부해요.",h:"Uyda o'qiyman.",o:["에","에서","를","가"],a:"에서"},{q:"물___ 마셔요.",h:"Suv ichaman.",o:["를","을","가","는"],a:"을"},{q:"커피___ 좋아해요.",h:"Kofeni yoqtiraman.",o:["을","를","이","은"],a:"를"},{q:"선생님___ 책이에요.",h:"O'qituvchining kitobi.",o:["의","에","를","도"],a:"의"}],
 verb:[{q:"어제 학교에 ___.",h:"Kecha maktabga bordim.",o:["가요","갔어요","갈 거예요","가고"],a:"갔어요"},{q:"지금 밥을 ___.",h:"Hozir ovqat yeyapman.",o:["먹었어요","먹어요","먹을 거예요","먹고"],a:"먹어요"},{q:"내일 친구를 ___.",h:"Ertaga do'stni uchrataman.",o:["만나요","만났어요","만날 거예요","만나고"],a:"만날 거예요"},{q:"어제 영화를 ___.",h:"Kecha kino ko'rdim.",o:["봐요","봤어요","볼 거예요","보고"],a:"봤어요"},{q:"매일 한국어를 ___.",h:"Har kuni koreys tilini o'rganaman.",o:["공부했어요","공부해요","공부할 거예요","공부하고"],a:"공부해요"},{q:"지난주에 친구가 ___.",h:"O'tgan hafta do'stim keldi.",o:["와요","왔어요","올 거예요","오고"],a:"왔어요"},{q:"다음 주에 여행을 ___.",h:"Kelasi hafta sayohatga boraman.",o:["가요","갔어요","갈 거예요","가고"],a:"갈 거예요"},{q:"지금 비가 ___.",h:"Hozir yomg'ir yog'yapti.",o:["왔어요","와요","올 거예요","오고"],a:"와요"}],
 noun:[{q:"학생 + ___ = talabalar",h:"Ko'plik qo'shimchasi",o:["들","의","도","에"],a:"들"},{q:"친구___ 선생님",h:"Do'stning o'qituvchisi",o:["의","를","도","에서"],a:"의"},{q:"나___ 좋아해요.",h:"Men ham yoqtiraman.",o:["도","들","의","에서"],a:"도"},{q:"물___ 마셔요.",h:"Faqat suv ichaman.",o:["만","들","의","에서"],a:"만"},{q:"9시___ 5시까지 일해요.",h:"9 dan 5 gacha ishlayman.",o:["부터","의","도","에서"],a:"부터"},{q:"친구___ 같이 가요.",h:"Do'st bilan birga boraman.",o:["하고","의","도","에서"],a:"하고"},{q:"버스___ 가요.",h:"Avtobusda boraman.",o:["로","으로","에서","를"],a:"로"},{q:"한국___ 왔어요.",h:"Koreyadan keldim.",o:["에서","에","를","도"],a:"에서"}]};
const SENT=[{ko:"저는 매일 한국어를 공부해요",uz:"Men har kuni koreys tilini o'rganaman"},{ko:"오늘 날씨가 정말 좋아요",uz:"Bugun ob-havo juda yaxshi"},{ko:"친구와 같이 학교에 가요",uz:"Do'stim bilan birga maktabga boraman"},{ko:"어제 우리는 영화를 봤어요",uz:"Kecha biz kino ko'rdik"},{ko:"내일 시장에서 과일을 살 거예요",uz:"Ertaga bozorda meva sotib olaman"},{ko:"저는 커피를 아주 좋아해요",uz:"Men kofeni juda yaxshi ko'raman"},{ko:"우리 집은 서울에 있어요",uz:"Uyimiz Seulda"},{ko:"주말에 가족과 여행을 갔어요",uz:"Dam olish kuni oila bilan sayohatga bordim"}];
app.get('/api/grammar',(r,s)=>{const t=r.query.type,n=Math.min(+r.query.n||8,12);
  if(t==='sent')return s.json(shuffle(SENT).slice(0,n));const a=GRAM[t];if(!a)return s.status(400).json({e:'bad'});
  s.json(shuffle(a).slice(0,n).map(g=>({q:g.q,h:g.h,o:shuffle(g.o),a:g.a})))});
const foxUse={},FOXSYS="Sen Kori — do'stona va bilimdon tulki yordamchisan 🦊. O'zbek tilida (lotin yozuvida) javob ber. Foydalanuvchi har qanday savol bersa (koreys tili, ta'lim, dasturlash, kundalik hayot va h.k.) to'liq, aniq va foydali javob ber: oddiy savolga qisqa, murakkabiga batafsilroq. Koreys so'zlarini hangul bilan yoz va o'qilishini lotinda qavs ichida ko'rsat. Mashq so'ralsa, bitta savol ber va javobni kut. Tibbiy, huquqiy yoki xavfli mavzularda ehtiyotkor bo'l.";
function fallbackFox(ms){
  const last=String(ms[ms.length-1].content).trim(),prev=ms.length>1?String(ms[ms.length-2].content):'';
  const qm=prev.match(/^🧠 «(.+?)» nima degani\?/);
  if(qm){const w=one('select * from words where ko=? limit 1',qm[1]);if(w){const first=w.uz.split(/[,;]/)[0].trim().toLowerCase(),ok=last.toLowerCase().includes(first);
    return {lite:1,reply:(ok?'Ajoyib! 🎉 ':'Deyarli! ')+'«'+w.ko+'» — '+w.uz+".\n\nYana mashq qilamizmi? «Meni sina» deb yozing."}}}
  if(/sina/i.test(last)){const w=one('select * from words order by random() limit 1');if(w)return {lite:1,reply:'🧠 «'+w.ko+'» nima degani?'}}
  let rows=[];const hang=last.match(/[가-힣]+/g);
  if(hang)for(const h of hang.slice(0,3))rows.push(...q('select ko,uz from words where ko like ? limit 3','%'+h+'%'));
  if(!rows.length){const t=last.replace(/[^\p{L}' ]/gu,'').trim().toLowerCase();if(t.length>=2)rows=q('select ko,uz from words where lower(uz) like ? limit 5','%'+t+'%')}
  if(rows.length)return {lite:1,reply:rows.slice(0,5).map(w=>'📖 '+w.ko+' — '+w.uz).join('\n')};
  return {lite:1,reply:"Men hozircha lug'atdagi so'zlarni topib bera olaman 🦊 Koreyscha yoki o'zbekcha so'z yozing (masalan: 학교 yoki maktab) yoki «Meni sina» deb yozing."}}
async function askFox(messages,words,voice){
  if(!ANTHROPIC_API_KEY)return messages.length?fallbackFox(messages):{e:'bad'};
  const ms=messages.slice(-12).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content).slice(0,1500)}));
  while(ms.length&&ms[0].role==='assistant')ms.shift();if(!ms.length)return {e:'bad'};
  const sys=FOXSYS+(words&&words.length?"\nHozir foydalanuvchi shu so'zlarni mashq qilmoqda: "+words.slice(0,20).map(w=>w.ko+' = '+w.uz).join('; ')+". Shu so'zlardan foydalanib qisqa savol-javob yoki dialog qil.":'')+(voice?"\nBu OVOZLI suhbat: javobing 1-3 qisqa og'zaki jumla bo'lsin; emoji, belgilar, ro'yxat va sarlavhalarsiz.":'');
  try{return {reply:await callClaude(ms,sys,voice?300:800)}}catch(e){return {e:'api',msg:String(e.message||e)}}}
const foxLimit=u=>(u.is_admin?1e9:active(u)?150:15);
app.post('/api/fox',async(r,s)=>{const k=r.u.id+':'+Math.floor(Date.now()/DAY);if((foxUse[k]||0)>=foxLimit(r.u))return s.json({e:'limit'});foxUse[k]=(foxUse[k]||0)+1;
  const ms=(r.body.messages||[]).filter(m=>m&&m.content);s.json(await askFox(ms,Array.isArray(r.body.words)?r.body.words:[],!!r.body.voice))});
const handoffs={};setInterval(()=>{const t=Date.now();for(const k in handoffs)if(t-handoffs[k].t>3e5)delete handoffs[k]},6e4).unref();
app.post('/api/handoff',(r,s)=>{const c=crypto.randomBytes(9).toString('hex');handoffs[c]={id:r.u.id,t:Date.now()};s.json({code:c})});
app.get('/auth/handoff',(r,s)=>{const h=handoffs[r.query.code];delete handoffs[r.query.code];if(!h||Date.now()-h.t>3e5)return s.status(401).json({e:'expired'});s.json({token:sign(h.id)})});
app.get('/api/tasks',(r,s)=>s.json(q('select t.*,d.name dname from tasks t join dicts d on d.id=t.dict_id')));
// bepul sinov (1 oy) so'rovi
app.post('/api/trial',(r,s)=>{if(r.u.trial!=='none')return s.json({trial:r.u.trial});run("update users set trial='pending' where id=?",r.u.id);s.json({trial:'pending'})});
// to'lov
app.post('/api/pay',up.single('shot'),(r,s)=>{const b=r.body,pl=one('select * from plans where id=?',b.plan_id);if(!r.file||!pl||!one('select 1 from methods where id=?',b.method_id))return s.status(400).json({e:'bad'});
  const m=pl.monthly?Math.max(1,Math.min(12,+b.months||1)):pl.months;
  run('insert into pays(user_id,plan_id,method_id,file,ts,months) values(?,?,?,?,?,?)',r.u.id,pl.id,b.method_id,r.file.filename,Date.now(),m);s.json({ok:1})});
app.get('/api/mypay',(r,s)=>s.json(q('select id,status,ts from pays where user_id=? order by id desc limit 5',r.u.id)));
// admin
app.post('/api/admin/dict',adm('dicts'),(r,s)=>{run('insert into dicts(name,levels,sec) values(?,?,?)',r.body.name,+r.body.levels||1,+r.body.sec||30);s.json({ok:1})});
app.post('/api/admin/dict/:id',adm('dicts'),(r,s)=>{const b=r.body;
  if('free'in b)run('update dicts set free=? where id=?',b.free?1:0,r.params.id);
  if(b.levels)run('update dicts set levels=? where id=?',+b.levels,r.params.id);
  if(b.name)run('update dicts set name=? where id=?',b.name,r.params.id);
  if(b.sec){run('update dicts set sec=? where id=?',+b.sec,r.params.id);resection(+r.params.id)}
  if(b.del){run('delete from words where dict_id=?',r.params.id);run('delete from dicts where id=?',r.params.id)}s.json({ok:1})});
let FOXM=FOX_MODEL;
async function callClaude(messages,system,max=500,model=FOXM){
  if(!ANTHROPIC_API_KEY)return null;
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(90000),headers:{'content-type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:max,system,messages})});
  const j=await r.json();
  if(!r.ok){if(r.status===404&&model!=='claude-sonnet-4-6'){const t=await callClaude(messages,system,max,'claude-sonnet-4-6');FOXM='claude-sonnet-4-6';return t}throw new Error((j.error&&j.error.message)||'api '+r.status)}
  return (j.content||[]).map(c=>c.text||'').join('').trim()}
async function tr(t){
  const tryit=async f=>{try{const v=await f();return v&&v!==t?v:''}catch{return ''}},sg=()=>AbortSignal.timeout(7000);
  let r='';
  if(TRANSLATE_URL)r=await tryit(async()=>{const x=await fetch(TRANSLATE_URL,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,api_key:TRANSLATE_KEY||undefined})});return (await x.json()).translatedText});
  if(!r&&GOOGLE_TRANSLATE_KEY)r=await tryit(async()=>{const x=await fetch('https://translation.googleapis.com/language/translate/v2?key='+GOOGLE_TRANSLATE_KEY,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,format:'text'})});return (await x.json()).data.translations[0].translatedText});
  if(!r)r=await tryit(async()=>{const x=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(t)+'&langpair=ko|'+TRANSLATE_TARGET,{signal:sg()});const j=await x.json();const v=j.responseData&&j.responseData.translatedText;return v&&!/MYMEMORY WARNING|QUERY LENGTH/i.test(v)?v:''});
  return r}
async function claudeTranslate(part){
  const txt=await callClaude([{role:'user',content:"Quyidagi koreys so'zlarini o'zbek tiliga (lotin yozuvi) tarjima qil va so'z turini aniqla (ot, fel, sifat, ravish yoki boshqa). FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\",\"pos\":\"ot|fel|sifat|ravish|boshqa\"}]\n\n"+part.map(x=>x.ko).join('\n')}],"Sen koreys-o'zbek lug'at tuzuvchisan. Tarjimalar qisqa, aniq va oddiy so'zlar bilan bo'lsin.",4000);
  const out={};try{JSON.parse(txt.match(/\[[\s\S]*\]/)[0]).forEach(o=>{if(o&&o.ko)out[o.ko]={uz:String(o.uz||'').trim(),pos:normPos(o.pos)}})}catch{}
  return out}
const POSMAP=[[/^(ot|otlar|noun|nouns|명사|isim)$/i,'ot'],[/^(fe['’‘`]?l|fe['’‘`]?llar|verb|verbs|동사)$/i,'fel'],[/^(sifat|sifatlar|adjective|adjectives|형용사)$/i,'sifat'],[/^(ravish|ravishlar|adverb|adverbs|부사)$/i,'ravish']];
const normPos=x=>{x=String(x||'').trim().replace(/[()\[\]{}.:]/g,'');for(const [re,p] of POSMAP)if(re.test(x))return p;return ''};
function parseText(txt,defPos,auto){
  const items=[],seen=new Set();let cur='';
  const hasK=x=>/[가-힣]/.test(x),lat=x=>/[A-Za-z]/.test(x)&&!hasK(x);
  const add=(ko,uz)=>{ko=ko.trim();uz=uz.trim();let p=cur,px=!!cur;
    const tg=uz.match(/\s*[(\[]\s*([^)\]]+?)\s*[)\]]\s*$/);if(tg&&normPos(tg[1])){p=normPos(tg[1]);px=true;uz=uz.slice(0,tg.index).trim()}
    const ps=uz.split(/\s*[,;|\t]\s*/);if(ps.length>1&&normPos(ps[ps.length-1])){p=normPos(ps.pop());px=true;uz=ps.join(', ')}
    if(ko&&uz&&!seen.has(ko)){seen.add(ko);items.push({ko,uz,pos:p||defPos,px})}};
  const lines=txt.split(/\r?\n/).map(l=>l.replace(/^\s*(\d+[.)]?|[•*·])\s+/,'').trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){const line=lines[i];
    const hd=normPos(line.replace(/^[^A-Za-z가-힣'’‘`]+|[^A-Za-z가-힣'’‘`]+$/g,''));if(hd&&line.length<30){cur=hd;continue}
    let m=line.match(/^([가-힣][^\-–—:=,;\t|]*?)\s*[\-–—:=]\s*(.+)$/)||line.match(/^([가-힣][^,;\t|]*?)\s*[,;\t|]\s*(.+)$/);
    if(m&&!hasK(m[2])){add(m[1],m[2]);continue}
    const rv=line.match(/^([A-Za-z'’‘ʻʼ][^가-힣]*?)\s*[\-–—:=\t,;|]\s*([가-힣].*)$/);if(rv&&!hasK(rv[1])){add(rv[2],rv[1]);continue}
    const pr=line.match(/^([가-힣][가-힣\s~]*?)\s*[(（]\s*([^가-힣()（）]+?)\s*[)）]\s*$/);if(pr&&!normPos(pr[2])){add(pr[1],pr[2]);continue}
    const sp=line.match(/^([가-힣][가-힣~\s]*?)\s+([A-Za-z'’‘ʻʼ].*)$/);if(sp&&!hasK(sp[2])){add(sp[1],sp[2]);continue}
    if(hasK(line)&&!/[A-Za-z]/.test(line)&&lines[i+1]&&lat(lines[i+1])&&!normPos(lines[i+1])){add(line,lines[i+1]);i++;continue}
    for(const w of line.match(/[가-힣]{1,12}/g)||[])if(!seen.has(w)){seen.add(w);items.push({ko:w,uz:'',pos:cur||defPos,px:!!cur})}
  }
  if(auto)for(const it of items)if(!it.px&&/다$/.test(it.ko))it.pos='fel';
  return items}
const VOCAB_PROMPT="Bu koreys tili darsligi yoki lug'ati sahifalari. O'rganiladigan so'zlarni (ot, fel, sifat, ravish) lug'at (asos) shaklida ajrat: fe'l va sifatlarni -다 shaklida yoz. Har biri uchun o'zbekcha (lotin yozuvi) qisqa tarjima ber; sahifada tarjima berilgan bo'lsa, shuni ishlat. Yuklamalar, qo'shimchalar, tuslangan shakllar, ismlar va takrorlarni qo'shma. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\",\"pos\":\"ot|fel|sifat|ravish\"}]";
async function aiChunk(content){
  const txt=await callClaude([{role:'user',content}],"Sen koreys-o'zbek lug'at tuzuvchisan.",4000);
  try{return JSON.parse(txt.match(/\[[\s\S]*\]/)[0]).filter(o=>o&&o.ko&&/[가-힣]/.test(o.ko)).map(o=>({ko:String(o.ko).trim(),uz:String(o.uz||'').trim(),pos:normPos(o.pos),px:!!normPos(o.pos),ai:true}))}catch{return []}}
async function aiVocab(chunks,job,label){
  const out=new Map();let i=0,done=0;
  const w=async()=>{while(i<chunks.length){const c=chunks[i++];let r=[];try{r=await aiChunk(c)}catch{}
    for(const o of r)if(!out.has(o.ko))out.set(o.ko,o);done++;if(job){job.stage=label+' ('+done+'/'+chunks.length+')';job.found=out.size}}};
  await Promise.all(Array.from({length:Math.min(5,chunks.length)},w));return [...out.values()]}
async function pdfParts(buf){
  try{const {PDFDocument}=require('pdf-lib');const src=await PDFDocument.load(buf,{ignoreEncryption:true}),n=Math.min(src.getPageCount(),200),out=[];
    for(let s=0;s<n;s+=10){const d=await PDFDocument.create(),idx=[];for(let i=s;i<Math.min(s+10,n);i++)idx.push(i);(await d.copyPages(src,idx)).forEach(p=>d.addPage(p));out.push(await d.saveAsBase64())}
    return out}catch{return buf.length<30e6?[buf.toString('base64')]:[]}}
async function extract(file,defPos,auto,job){
  const buf=fs.readFileSync(file.path);fs.unlinkSync(file.path);const nm=file.originalname.toLowerCase();let txt='',pdf=false;
  try{
    if(/\.pdf$/.test(nm)){pdf=true;txt=(await require('pdf-parse')(buf)).text||''}
    else if(/\.(xlsx|xls|ods)$/.test(nm)){const X=require('xlsx'),wb=X.read(buf);txt=wb.SheetNames.map(n=>X.utils.sheet_to_csv(wb.Sheets[n])).join('\n')}
    else if(/\.docx$/.test(nm))txt=(await require('mammoth').extractRawText({buffer:buf})).value;
    else if(/\.(html?|xml)$/.test(nm))txt=buf.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ');
    else txt=buf.toString('utf8').replace(/^\uFEFF/,'');
  }catch{if(!pdf)return null}
  const hang=(txt.match(/[가-힣]/g)||[]).length;
  if(pdf&&hang<60){
    if(!ANTHROPIC_API_KEY){if(job)job.note="Bu PDF rasmli (skan qilingan). Uni o'qish uchun ANTHROPIC_API_KEY kerak.";return []}
    if(job)job.stage="Skan PDF Claude bilan o'qilmoqda...";
    const parts=await pdfParts(buf);
    return (await aiVocab(parts.map(b=>[{type:'document',source:{type:'base64',media_type:'application/pdf',data:b}},{type:'text',text:VOCAB_PROMPT}]),job,"PDF o'qilmoqda")).map(x=>({...x,pos:x.pos||defPos}))}
  const items=parseText(txt,defPos,auto);
  if(ANTHROPIC_API_KEY&&items.length>3){
    const noUz=items.filter(i=>!i.uz).length,lang=txt.split(/\r?\n/).filter(l=>/[가-힣]/.test(l)).length,tpl=(txt.match(/[가-힣]+/g)||[]).length/Math.max(1,lang);
    if(noUz/items.length>0.6&&tpl>2.5){
      const parts=[];let c='';for(const l of txt.split(/\r?\n/)){if(c.length+l.length>6000){parts.push(c);c=''}c+=l+'\n'}if(c.trim())parts.push(c);
      const ai=await aiVocab(parts.slice(0,150).map(t=>[{type:'text',text:VOCAB_PROMPT+'\n\nMATN:\n'+t}]),job,"Matn o'qilmoqda");
      if(ai.length)return ai.map(x=>({...x,pos:x.pos||defPos}))}}
  return items}
async function addWords(job,d,items,levelOf,auto,retr){
  job.stage="Tekshirilmoqda...";
  const todo=items.slice(0,5000).filter(it=>!one('select 1 from words where dict_id=? and ko=?',d.id,it.ko));
  todo.forEach((it,i)=>it.idx=i);job.found=items.length;job.total=todo.length;job.done=0;
  const ins=db.prepare('insert into words(dict_id,level,pos,section,ko,uz) values(?,?,?,?,?,?)'),cnt={};
  const put=list=>{db.transaction(()=>{for(const it of list){const lv=levelOf(it.idx,todo.length),k=lv+'|'+it.pos;
    if(cnt[k]==null)cnt[k]=one('select count(*) n from words where dict_id=? and level=? and pos=?',d.id,lv,it.pos).n;
    ins.run(d.id,lv,it.pos,Math.floor(cnt[k]/d.sec)+1,it.ko,it.uz);cnt[k]++;
    job.perLevel[lv]=(job.perLevel[lv]||0)+1;job.perPos[it.pos]=(job.perPos[it.pos]||0)+1;job.added++}})()};
  const aiOn=!!ANTHROPIC_API_KEY,needAI=it=>!it.uz||(auto&&!it.px)||(retr&&!it.ai);
  const first=todo.filter(it=>it.uz&&!(aiOn&&needAI(it)));put(first);job.done=first.length;
  const fs0=new Set(first);let rest=todo.filter(it=>!fs0.has(it));
  if(aiOn&&rest.length){job.stage="Tarjima va tur aniqlash (Claude)...";
    const bs=[];for(let i=0;i<rest.length;i+=50)bs.push(rest.slice(i,i+50));let bi=0;
    const worker=async()=>{while(bi<bs.length){const b=bs[bi++];let o={};try{o=await claudeTranslate(b)}catch{}
      const ok=[];for(const it of b){const x=o[it.ko];if(x){if((!it.uz||retr)&&x.uz){it.uz=x.uz;job.translated++}if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}}if(it.uz)ok.push(it);else it.left=1}
      put(ok);job.done+=b.length}};
    await Promise.all(Array.from({length:Math.min(6,bs.length)},worker));rest=rest.filter(it=>it.left)}
  if(rest.length){job.stage="Tarjima (tarjima xizmati)...";const lim=rest.slice(0,600);let ri=0;
    const w2=async()=>{while(ri<lim.length){const it=lim[ri++];it.uz=await tr(it.ko);if(it.uz){job.translated++;put([it])}else job.skipped++;job.done++}};
    await Promise.all(Array.from({length:5},w2));job.skipped+=rest.length-lim.length}
  job.done=job.total;job.stage="Tayyor";return job}
const jobs={};
setInterval(()=>{const t=Date.now();for(const k in jobs)if(t-jobs[k].ts>36e5)delete jobs[k]},6e5).unref();
const newJob=()=>{const id=crypto.randomBytes(6).toString('hex');return jobs[id]={id,stage:"Fayl o'qilmoqda...",found:0,total:0,done:0,added:0,translated:0,skipped:0,perLevel:{},perPos:{},fin:false,err:null,ts:Date.now()}};
app.get('/api/admin/job/:id',adm('import'),(r,s)=>{const j=jobs[r.params.id];if(!j)return s.status(404).json({e:'yoq'});s.json(j)});
app.post('/api/admin/import',adm('import'),up.single('file'),(r,s)=>{
  const {dict_id,level=1,pos='ot'}=r.body,d=one('select * from dicts where id=?',dict_id);if(!d||!r.file)return s.status(400).json({e:'bad'});
  const job=newJob(),auto=r.body.auto==='1';s.json({job:job.id});
  (async()=>{try{const items=await extract(r.file,pos,auto,job);if(!items){job.err="Faylni o'qib bo'lmadi";return}await addWords(job,d,items,()=>+level,auto,r.body.retr==='1')}catch(e){job.err=String(e.message||e)}finally{job.fin=true}})()});
app.post('/api/admin/book',adm('import'),up.single('file'),(r,s)=>{
  const b=r.body,name=(b.name||'').trim(),pos=b.pos||'ot';let L=Math.max(1,Math.min(+b.levels||1,30));
  if(!name||!r.file)return s.status(400).json({e:'bad'});
  const cs=String(b.counts||'').split(/[,;\s]+/).map(Number).filter(n=>n>0);if(b.split==='custom'&&!cs.length)return s.status(400).json({e:'counts'});
  const job=newJob(),auto=b.auto==='1';s.json({job:job.id});
  (async()=>{try{const items=await extract(r.file,pos,auto,job);if(!items){job.err="Faylni o'qib bo'lmadi";return}
    let levelOf;
    if(b.split==='level'){const lv=Math.max(1,+b.level||1);L=Math.max(L,lv);levelOf=()=>lv}
    else if(b.split==='custom'){L=Math.max(L,cs.length);const cum=[];cs.reduce((a,n,i)=>(cum[i]=a+n),0);levelOf=i=>{const k=cum.findIndex(c=>i<c);return k<0?cs.length:k+1}}
    else levelOf=(i,n)=>Math.min(L,Math.floor(i*L/n)+1);
    const id=run('insert into dicts(name,levels,sec) values(?,?,?)',name,L,+b.sec||30).lastInsertRowid,d=one('select * from dicts where id=?',id);job.dict_id=id;
    await addWords(job,d,items,levelOf,auto,b.retr==='1')}catch(e){job.err=String(e.message||e)}finally{job.fin=true}})()});
app.get('/api/admin/status',adm('admins'),(r,s)=>s.json({key:!!ANTHROPIC_API_KEY,keyLen:(ANTHROPIC_API_KEY||'').length,model:FOXM,bot:!!BOT_TOKEN,webapp:WEBAPP_URL||'',data:DATA}));
app.post('/api/admin/claude-test',adm('admins'),async(r,s)=>{if(!ANTHROPIC_API_KEY)return s.json({ok:false,error:"ANTHROPIC_API_KEY serverda ko'rinmayapti. Railway → Variables'ga qo'shing va Deploy bosing. Ikkita loyiha bo'lsa, domen bog'langan loyihaga qo'shing."});
  try{const t=await callClaude([{role:'user',content:"Bir so'z bilan javob ber: tayyormisan?"}],"Qisqa javob ber.",50);s.json({ok:true,reply:t,model:FOXM})}catch(e){s.json({ok:false,error:String(e.message||e)})}});

function resection(id){const d=one('select * from dicts where id=?',id);if(!d)return;const rows=q('select id,level,pos from words where dict_id=? order by id',id),c={};const up=db.prepare('update words set section=? where id=?');db.transaction(()=>{for(const w of rows){const k=w.level+'|'+w.pos;c[k]=c[k]||0;up.run(Math.floor(c[k]/d.sec)+1,w.id);c[k]++}})()}
app.post('/api/admin/word/:id',adm('dicts'),(r,s)=>{const b=r.body,w=one('select * from words where id=?',r.params.id);if(!w)return s.status(400).json({e:'bad'});
  if(b.del){if(w.audio)try{fs.unlinkSync(DATA+'/audio/'+w.audio)}catch{}run('delete from learned where word_id=?',w.id);run('delete from words where id=?',w.id);return s.json({ok:1})}
  run('update words set ko=?,uz=?,pos=?,level=? where id=?',b.ko||w.ko,b.uz||w.uz,b.pos||w.pos,+b.level||w.level,w.id);if(b.pos||b.level)resection(w.dict_id);s.json({ok:1})});
app.post('/api/admin/word/:id/audio',adm('import'),up.single('audio'),(r,s)=>{const w=one('select * from words where id=?',r.params.id);if(!w||!r.file)return s.status(400).json({e:'bad'});
  const mt=r.file.mimetype||'',ext=mt.includes('ogg')?'ogg':/mp4|m4a|aac/.test(mt)?'mp4':/mpeg|mp3/.test(mt)?'mp3':mt.includes('wav')?'wav':'webm';
  const name='w'+w.id+'_'+Date.now()+'.'+ext;fs.renameSync(r.file.path,DATA+'/audio/'+name);
  if(w.audio)try{fs.unlinkSync(DATA+'/audio/'+w.audio)}catch{}
  run('update words set audio=? where id=?',name,w.id);s.json({ok:1,audio:name})});
app.post('/api/admin/task',adm('tasks'),(r,s)=>{run('insert into tasks(dict_id,level,title,pos,section) values(?,?,?,?,?)',r.body.dict_id,r.body.level,r.body.title,r.body.pos||'',+r.body.section||0);s.json({ok:1})});
app.post('/api/admin/task/:id/del',adm('tasks'),(r,s)=>{run('delete from tasks where id=?',r.params.id);s.json({ok:1})});
app.post('/api/admin/plan',adm('plans'),(r,s)=>{const b=r.body;b.del?run('delete from plans where id=?',b.del):run('insert into plans(months,price,dict_id,monthly) values(?,?,?,?)',+b.months||1,+b.price,+b.dict_id||0,b.monthly?1:0);s.json({ok:1})});
app.post('/api/admin/method',adm('methods'),(r,s)=>{const b=r.body;
  if(b.del)run('delete from methods where id=?',b.del);else if(b.id)run('update methods set name=?,number=?,holder=?,on_=? where id=?',b.name,b.number,b.holder,b.on?1:0,b.id);else run('insert into methods(name,number,holder) values(?,?,?)',b.name,b.number,b.holder);s.json({ok:1})});
app.get('/api/admin/methods',adm('methods'),(r,s)=>s.json(q('select * from methods')));
app.get('/api/admin/users',adm('users'),(r,s)=>s.json(q('select id,name,email,is_admin,perms,paid_until,trial,created from users order by created desc')));
app.post('/api/admin/user',adm('users'),(r,s)=>{const {id,months,grant,revoke}=r.body;
  if(months)run('update users set paid_until=max(paid_until,?)+? where id=?',Date.now(),months*30*DAY,id);
  if(grant)run('insert or ignore into access(user_id,dict_id) values(?,?)',id,grant);if(revoke)run('delete from access where user_id=? and dict_id=?',id,revoke);s.json({ok:1})});
app.post('/api/admin/admin',adm('admins'),(r,s)=>{const {id,email,admin,perms}=r.body;let u=id?one('select * from users where id=?',id):one('select * from users where email=?',(email||'').toLowerCase());
  if(!u&&email){run('insert into users(name,email,created) values(?,?,?)',email,email.toLowerCase(),Date.now());u=one('select * from users where email=?',email.toLowerCase())}
  if(!u||u.is_admin==2)return s.status(400).json({e:'bad'});
  if(admin!=null)run('update users set is_admin=? where id=?',admin?1:0,u.id);
  if(perms)run('update users set perms=? where id=?',perms.filter(p=>PERMS.includes(p)).join(','),u.id);s.json({ok:1})});
app.get('/api/admin/pending',adm('payments'),(r,s)=>s.json(q("select p.*,u.name,u.email,pl.months pm,pl.price,pl.monthly,dd.name dname,m.name mname from pays p join users u on u.id=p.user_id left join plans pl on pl.id=p.plan_id left join dicts dd on dd.id=pl.dict_id left join methods m on m.id=p.method_id where status='pending' order by p.id")));
app.get('/api/admin/trials',adm('trials'),(r,s)=>s.json(q("select id,name,email,created from users where trial='pending'")));
const tell=(id,t)=>bot&&bot.telegram.sendMessage(id,t).catch(()=>{});
app.post('/api/admin/trial/:id',adm('trials'),(r,s)=>{const ok=!!r.body.ok,id=r.params.id;
  if(ok)run("update users set trial='accepted',paid_until=max(paid_until,?)+? where id=?",Date.now(),30*DAY,id);else run("update users set trial='rejected' where id=?",id);
  tell(id,ok?"✅ So'rov qabul qilindi: 1 oy bepul foydalanasiz!":"❌ Bepul sinov so'rovi rad etildi.");s.json({ok:1})});
app.post('/api/admin/pay/:id',adm('payments'),(r,s)=>{const p=one('select * from pays where id=?',r.params.id),pl=one('select * from plans where id=?',p.plan_id),ok=!!r.body.ok;
  run('update pays set status=? where id=?',ok?'accepted':'rejected',p.id);
  if(ok&&pl){if(pl.dict_id){const a=one('select until from access where user_id=? and dict_id=?',p.user_id,pl.dict_id);
    if(!a)run('insert into access(user_id,dict_id,until) values(?,?,?)',p.user_id,pl.dict_id,Date.now()+(p.months||pl.months)*30*DAY);
    else if(a.until!==0)run('update access set until=? where user_id=? and dict_id=?',Math.max(a.until,Date.now())+(p.months||pl.months)*30*DAY,p.user_id,pl.dict_id)}
  else run('update users set paid_until=max(paid_until,?)+? where id=?',Date.now(),(p.months||pl.months)*30*DAY,p.user_id)}
  tell(p.user_id,ok?"✅ To'lov qabul qilindi. Obuna faollashtirildi!":"❌ To'lov rad etildi. Qayta yuboring.");s.json({ok:1})});
// xonalar
const server=http.createServer(app),io=new Server(server),rooms={};
const shuffle=a=>a.map(x=>[Math.random(),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
function buildQs(mode,w,n){
  if(GRAM[mode])return shuffle(GRAM[mode]).slice(0,n).map(g=>({kind:'g',p:g.q,h:g.h,opts:shuffle(g.o),ans:g.a}));
  return shuffle(w).slice(0,n).map(x=>({kind:mode,p:x.ko,audio:x.audio||'',opts:shuffle([x.uz,...shuffle(w.filter(y=>y.id!==x.id)).slice(0,3).map(y=>y.uz)]),ans:x.uz}))}
const roomView=r=>({code:r.code,host:r.host,meta:r.meta,players:Object.entries(r.players).map(([id,p])=>({id:+id,name:p.name,score:p.score,i:p.i,done:p.done}))});
function endRoom(r){if(r.over)return;r.over=true;clearTimeout(r.timer);
  const list=Object.entries(r.players).map(([id,p])=>({id:+id,name:p.name,score:p.score,fin:p.fin||9e15})).sort((a,b)=>b.score-a.score||a.fin-b.fin);
  list.forEach(p=>addScore(p.id,p.name,Math.round(p.score/2)));
  io.to(r.code).emit('end',{players:list.map(({id,name,score})=>({id,name,score})),meta:r.meta});delete rooms[r.code]}
io.on('connection',sock=>{
  const u=auth(sock.handshake.auth);if(!u)return sock.disconnect();
  sock.on('create',({dict,level,mode,n,sec},cb)=>{
    n=Math.max(3,Math.min(+n||10,30));sec=Math.max(5,Math.min(+sec||15,60));mode=mode||'speed';
    let w=[],book='Grammatika',lv=0;
    if(!GRAM[mode]){const d=one('select * from dicts where id=?',dict);if(!d||!can(u,d))return cb({e:"Bu kitob sizga ochiq emas"});book=d.name;lv=+level||0;
      w=q('select * from words where dict_id=?'+(lv?' and level=?':''),...(lv?[dict,lv]:[dict]));if(w.length<4)return cb({e:"Kamida 4 ta so'z kerak"})}
    const qs=buildQs(mode,w,n);let code;do code=String(Math.floor(100000+Math.random()*900000));while(rooms[code]);
    rooms[code]={code,host:u.id,qs,sec,meta:{book,level:lv,n:qs.length,sec,mode},started:false,players:{}};cb({code})});
  sock.on('join',(code,cb)=>{code=String(code||'').trim();const r=rooms[code];if(!r)return cb({e:'Xona topilmadi'});if(r.started)return cb({e:"O'yin boshlangan"});
    r.players[u.id]={name:u.name,score:0,i:0,done:false};sock.join(code);sock.data.code=code;cb({ok:1});io.to(code).emit('room',roomView(r))});
  sock.on('start',()=>{const r=rooms[sock.data.code];if(!r||r.host!==u.id||r.started)return;
    if(Object.keys(r.players).length<2)return sock.emit('err',"Kamida 2 o'yinchi kerak");
    r.started=true;const now=Date.now();Object.values(r.players).forEach(p=>p.t0=now);
    r.timer=setTimeout(()=>endRoom(r),(r.qs.length*r.sec+25)*1000);
    io.to(r.code).emit('start',{qs:r.qs.map(({kind,p,h,opts,audio})=>({kind,p,h,opts,audio})),meta:r.meta})});
  sock.on('answer',({i,c},cb)=>{const r=rooms[sock.data.code],p=r&&r.players[u.id];if(!r||!p||p.done||i!==p.i)return;
    const qn=r.qs[i],now=Date.now(),el=(now-p.t0)/1000,ok=c!=null&&c===qn.ans&&el<=r.sec+1.5;
    if(ok)p.score+=10+Math.max(0,Math.round((r.sec-el)/r.sec*5));
    p.t0=now;p.i++;if(p.i>=r.qs.length){p.done=true;p.fin=now}
    if(typeof cb==='function')cb({ok,ans:qn.ans});io.to(r.code).emit('room',roomView(r));
    if(Object.values(r.players).every(x=>x.done))endRoom(r)});
  sock.on('disconnect',()=>{const r=rooms[sock.data.code];if(!r||r.over)return;delete r.players[u.id];
    if(!Object.keys(r.players).length){clearTimeout(r.timer);delete rooms[r.code];return}
    if(r.host===u.id)r.host=+Object.keys(r.players)[0];
    if(r.started&&Object.values(r.players).every(x=>x.done))endRoom(r);else io.to(r.code).emit('room',roomView(r))})});
let bot;const hist={};
if(BOT_TOKEN){bot=new Telegraf(BOT_TOKEN);
  const open=Markup.button.webApp("📚 Ilovani ochish",WEBAPP_URL);
  bot.start(c=>c.reply("Assalomu alaykum, "+c.from.first_name+"! 🦊\nMen Kori — koreys tili yordamchingizman.\nSizga qanday yordam bera olaman?",Markup.inlineKeyboard([[open],[Markup.button.callback("💬 Savol berish",'ask'),Markup.button.callback("ℹ️ Nimalar qila olaman?",'help')]])));
  bot.action('ask',c=>{c.answerCbQuery().catch(()=>{});c.reply("Savolingizni yozing, men javob beraman 🦊\n(masalan: «고맙습니다» nima degani?)")});
  bot.action('help',c=>{c.answerCbQuery().catch(()=>{});c.reply("Men:\n• so'z va grammatikani tushuntiraman\n• misollar keltiraman\n• mashq va suhbat qilaman\n\nIlovada kartochka, o'yinlar va mashqlar ham bor 👇",Markup.inlineKeyboard([open]))});
  bot.on('text',async c=>{const t=c.message.text;if(t.startsWith('/'))return;const id=c.from.id;
    run('insert or ignore into users(id,name,created) values(?,?,?)',id,c.from.first_name,Date.now());const u=fin(id);
    const k=id+':'+Math.floor(Date.now()/DAY);if((foxUse[k]||0)>=foxLimit(u))return c.reply("Bugungi bepul savollar tugadi 🦊 Obuna bo'lsangiz ko'proq yozishingiz mumkin.");
    foxUse[k]=(foxUse[k]||0)+1;const h=hist[id]=hist[id]||[];h.push({role:'user',content:t});c.sendChatAction('typing').catch(()=>{});
    const r=await askFox(h,[]);
    if(r.reply){h.push({role:'assistant',content:r.reply});if(h.length>12)h.splice(0,h.length-12);c.reply(r.reply)}
    else{h.pop();c.reply(r.e==='nokey'?"Men hozircha javob bera olmayman. Ilovani oching 👇":"Xatolik yuz berdi, birozdan keyin urinib ko'ring.",Markup.inlineKeyboard([open]))}});
  bot.launch().catch(console.error);
  bot.telegram.setChatMenuButton({menuButton:{type:'web_app',text:'Ochish',web_app:{url:WEBAPP_URL}}}).catch(()=>{})}
server.listen(PORT,()=>console.log('http://localhost:'+PORT));
