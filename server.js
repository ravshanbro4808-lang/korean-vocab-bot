const express=require('express'),crypto=require('crypto'),fs=require('fs'),http=require('http');
const Database=require('better-sqlite3'),multer=require('multer'),{Telegraf,Markup}=require('telegraf'),{Server}=require('socket.io');
const {OAuth2Client}=require('google-auth-library');
const {BOT_TOKEN,WEBAPP_URL,ADMIN_IDS='',ADMIN_EMAILS='',GOOGLE_CLIENT_ID,SECRET='change-me',DEV,PORT=3000,TRANSLATE_URL,TRANSLATE_KEY,TRANSLATE_TARGET='uz',ANTHROPIC_API_KEY,GEMINI_API_KEY,GEMINI_MODEL='gemini-3.8-flash',FOX_MODEL='claude-haiku-5-5',GOOGLE_TRANSLATE_KEY,BOT_USERNAME='Koreys_lugat_2026_bot'}=process.env;
let THINK=process.env.GEMINI_THINKING||'low';const FALLBACKS=(process.env.GEMINI_FALLBACK_MODEL||'gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map(x=>x.trim()).filter(Boolean),GEMINI_FALLBACK=FALLBACKS[0],BUSY=/quota|429|exceed|demand|overload|unavailable|timeout|aborted|fetch failed|not found|no longer available|404|rate/i;
const FASTM=(process.env.GEMINI_FAST_MODEL||'gemini-3.5-flash-lite').split(',').map(x=>x.trim()).filter(Boolean),down={};
const markDown=(m,e)=>{const t=String(e&&(e.message||e));down[m]=Date.now()+(/404|not found|no longer/i.test(t)?864e5:/quota|exceed|429/i.test(t)?20*60000:60000)};
const chainFor=(first,fast)=>{const all=[...new Set([...(fast?FASTM:[]),first,...FALLBACKS])].filter(Boolean),ok=all.filter(m=>!(down[m]>Date.now()));return ok.length?ok:[first]};
const friendlyErr=m=>{m=String(m||'');return /quota|exceed|429|rate/i.test(m)?"Gemini kunlik limiti tugadi (bepul tarif). Birozdan keyin urinib ko'ring yoki Google AI Studio'da billing ulang.":/demand|overload|unavailable|503/i.test(m)?"Gemini hozir band. Birozdan keyin urinib ko'ring.":/timeout|aborted|fetch failed/i.test(m)?"Gemini javob bermadi. Qayta urinib ko'ring.":m.slice(0,160)};const USE_GEMINI=!!GEMINI_API_KEY,AI_KEY=GEMINI_API_KEY||ANTHROPIC_API_KEY;
const addM=(ts,n)=>{const d=new Date(ts);d.setMonth(d.getMonth()+n);return d.getTime()};const DAY=864e5,PERMS=['topik','dicts','import','tasks','payments','trials','users','plans','methods','admins'];
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
db.exec(`create table if not exists lvnames(dict_id int,level int,name text,primary key(dict_id,level));
create table if not exists poss(key text primary key,name text,ko text default '',ord int default 0);`);
if(!db.prepare('select 1 from poss').get()){const ip=db.prepare('insert into poss(key,name,ko,ord) values(?,?,?,?)');[['ot','Ot','명사'],['fel',"Fe'l (harakat)",'동사'],['sifat','Sifat (holat)','형용사'],['ravish','Ravish','부사'],['olmosh','Olmosh','대명사'],['son','Son','수사'],['yordamchi',"Ko'makchi / yordamchi",'조사']].forEach((p,i)=>ip.run(p[0],p[1],p[2],i))}
if(!one0('select 1 from methods'))for(const n of['Click','Payme','Karta'])db.prepare('insert into methods(name,number,holder) values(?,?,?)').run(n,'','');
function one0(s){return db.prepare(s).get()}
let possC=0,possL=[];const getPoss=()=>{if(Date.now()>possC){possL=db.prepare('select * from poss order by ord,rowid').all();possC=Date.now()+3000}return possL};
const DEFLV=["Boshlang'ich","O'rta","Yuqori"];
const lvList=d=>{const m={};db.prepare('select level,name from lvnames where dict_id=?').all(d.id).forEach(r=>m[r.level]=r.name);return Array.from({length:d.levels||1},(_,i)=>({level:i+1,name:m[i+1]||DEFLV[i]||(i+1)+'-daraja'}))};
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
app.get('/config',(r,s)=>s.json({google:GOOGLE_CLIENT_ID||null,dev:!!DEV,bot:BOT_USERNAME,fox:!!AI_KEY,voice:USE_GEMINI}));
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
  s.json({d,levels:lvList(d),rows:q('select level,pos,section,count(*) n from words where dict_id=? group by 1,2,3',d.id)})});
app.get('/api/poss',(r,s)=>s.json(getPoss()));
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
async function askFox(messages,words){
  if(!AI_KEY)return messages.length?fallbackFox(messages):{e:'bad'};
  const ms=messages.slice(-8).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content).slice(0,1500)}));
  while(ms.length&&ms[0].role==='assistant')ms.shift();if(!ms.length)return {e:'bad'};
  const sys=FOXSYS+(words&&words.length?"\nHozir foydalanuvchi shu so'zlarni mashq qilmoqda: "+words.slice(0,20).map(w=>w.ko+' = '+w.uz).join('; ')+". Shu so'zlardan foydalanib qisqa savol-javob yoki dialog qil.":'');
  try{return {reply:await callClaude(ms,sys,800)}}catch(e){return {e:'api',msg:friendlyErr(e.message||e)}}}
const LIM={chat:[15,150],voice:[5,150]};// [bepul, obunachi] kuniga
const foxLimit=(u,t='chat')=>u.is_admin?1e9:LIM[t][active(u)?1:0];
const foxKey=(u,t)=>u.id+':'+t+':'+Math.floor(Date.now()/DAY);
const foxLeft=(u,t)=>u.is_admin?null:Math.max(0,foxLimit(u,t)-(foxUse[foxKey(u,t)]||0));
const TTSM=process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-lite-tts',VOICE=process.env.GEMINI_VOICE||'Kore';
function wavWrap(pcm,rate){rate=rate||24000;const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm])}
async function geminiTTS(text,mdl){
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(mdl||TTSM)+':generateContent',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:VOICE}}}}})});
  const j=await r.json();if(!r.ok)throw new Error((j.error&&j.error.message)||('HTTP '+r.status));
  const p=((j.candidates||[])[0]?.content?.parts||[]).find(x=>x.inlineData&&x.inlineData.data);if(!p)throw new Error('audio yoq');
  let b=Buffer.from(p.inlineData.data,'base64');
  if(b.slice(0,4).toString()!=='RIFF'){const m=String(p.inlineData.mimeType||'').match(/rate=(\d+)/);b=wavWrap(b,m?+m[1]:24000)}
  return b.toString('base64')}
async function geminiTTSany(text){let le;for(const m of [...new Set([TTSM,'gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts'])]){try{return await geminiTTS(text,m)}catch(e){le=e;if(!/404|not found|no longer|unsupported|invalid/i.test(String(e.message)))throw e}}throw le}
let gemTtsOff=0;
async function wordAudio(ko){if(USE_GEMINI&&Date.now()>gemTtsOff){try{return {b:Buffer.from(await geminiTTSany(ko),'base64'),ext:'wav'}}catch(e){if(/quota|exceed|429|demand|404|not found/i.test(String(e.message)))gemTtsOff=Date.now()+30*60000}}
  const r=await fetch('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ko&q='+encodeURIComponent(ko),{headers:{'user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('tts '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length<500)throw new Error('tts bosh');return {b,ext:'mp3'}}
const PENDING="⏳ tarjima kutilmoqda";let trBusy=0;
async function trFill(){if(trBusy)return;trBusy=1;try{const rows=q("select id,ko from words where uz=? limit 40",PENDING);if(!rows.length)return;let o={};if(AI_KEY){try{o=await claudeTranslate(rows.map(x=>({ko:x.ko})))}catch{}}
  let tc=0;for(const w of rows){let uz=o[w.ko]&&o[w.ko].uz;if(!uz&&tc<12&&!AI_KEY){tc++;uz=await tr(w.ko)}if(uz)run('update words set uz=? where id=? and uz=?',uz,w.id,PENDING)}}catch{}finally{trBusy=0}}
setInterval(trFill,60000).unref();setTimeout(trFill,20000).unref();
setInterval(()=>{if(ttsQ.length<10){ttsEnqueue(q("select id from words where audio is null or audio='' limit 40").map(x=>x.id).filter(id=>(ttsTry[id]||0)<8))}},120000).unref();
const ttsQ=[],ttsTry={};let ttsRun=0,ttsPause=0;
function ttsEnqueue(ids){for(const id of ids)if(!ttsQ.includes(id))ttsQ.push(id);ttsPump()}
async function ttsPump(){
  if(ttsRun>=3||Date.now()<ttsPause)return;const id=ttsQ.shift();if(!id)return;ttsRun++;
  try{const w=one('select ko,audio from words where id=?',id);if(w&&w.ko&&!w.audio){const a=await wordAudio(w.ko);const name='w'+id+'_'+Date.now()+'.'+a.ext;fs.writeFileSync(DATA+'/audio/'+name,a.b);run("update words set audio=? where id=? and (audio is null or audio='')",name,id)}}
  catch(e){ttsTry[id]=(ttsTry[id]||0)+1;if(ttsTry[id]<8){ttsQ.push(id);const d=/quota|429|demand|503|exceed/i.test(String(e.message))?20000:5000;ttsPause=Date.now()+d;setTimeout(ttsPump,d+100)}}
  finally{ttsRun--;setTimeout(ttsPump,250)}
  ttsPump()}
app.post('/api/admin/autovoice',adm('import'),(r,s)=>{const d=+r.body.dict_id;const ids=(d?q('select id from words where dict_id=? and (audio is null or audio=\'\')',d):q("select id from words where audio is null or audio=''")).map(x=>x.id);ttsEnqueue(ids);s.json({ok:1,n:ids.length})});
const ttsBusy=new Map();
app.post('/api/word-voice/:id',async(r,s)=>{const w=one('select id,ko,audio from words where id=?',r.params.id);if(!w)return s.json({e:'yoq'});if(w.audio)return s.json({audio:w.audio});
  try{let p=ttsBusy.get(w.id);if(!p){p=(async()=>{const a=await wordAudio(w.ko);const name='w'+w.id+'_'+Date.now()+'.'+a.ext;fs.writeFileSync(DATA+'/audio/'+name,a.b);run("update words set audio=? where id=? and (audio is null or audio='')",name,w.id);return one('select audio from words where id=?',w.id).audio})();ttsBusy.set(w.id,p);p.finally(()=>ttsBusy.delete(w.id)).catch(()=>{})}
    s.json({audio:await p})}catch(e){s.json({e:'tts'})}});
app.post('/api/fox-tts',async(r,s)=>{if(!USE_GEMINI)return s.json({e:'tts'});const k=foxKey(r.u,'tts'),cap=r.u.is_admin?1e9:active(r.u)?400:60;
  if((foxUse[k]||0)>=cap)return s.json({e:'tts'});const t=String(r.body.text||'').replace(/[*_#`]/g,'').trim().slice(0,600);if(!t)return s.json({e:'tts'});
  foxUse[k]=(foxUse[k]||0)+1;try{s.json({a:await geminiTTSany(t)})}catch(e){foxUse[k]--;s.json({e:'tts',msg:String(e.message||e).slice(0,200)})}});
app.post('/api/fox',async(r,s)=>{const k=foxKey(r.u,'chat');if((foxUse[k]||0)>=foxLimit(r.u,'chat'))return s.json({e:'limit',left:0});foxUse[k]=(foxUse[k]||0)+1;
  const ms=(r.body.messages||[]).filter(m=>m&&m.content);const o=await askFox(ms,Array.isArray(r.body.words)?r.body.words:[]);if(o.e==='api')foxUse[k]--;o.left=foxLeft(r.u,'chat');s.json(o)});
const VOICESYS="\nFoydalanuvchi ovozli xabar yubordi (o'zbek yoki koreys tilida). Avval u nima deganini aniq yozib ol, keyin unga javob ber. FAQAT JSON qaytar: {\"heard\":\"foydalanuvchi aytgan gap (o'z tilida)\",\"reply\":\"javobing\"}. Javob ovoz bilan o'qiladi: 1-3 qisqa gap yoz, *, #, emoji ishlatma, koreys so'zining lotincha o'qilishini qavs ichida yozma. Agar hech narsa eshitilmasa yoki faqat shovqin bo'lsa, heard ni bo'sh qoldir.";
app.post('/api/fox-voice',up.single('audio'),async(r,s)=>{
  let buf=null;try{if(r.file){buf=fs.readFileSync(r.file.path);fs.unlinkSync(r.file.path)}}catch{}
  if(!buf||!USE_GEMINI)return s.json({e:'bad'});
  const k=foxKey(r.u,'voice');if((foxUse[k]||0)>=foxLimit(r.u,'voice'))return s.json({e:'limit',left:0});foxUse[k]=(foxUse[k]||0)+1;
  let ms=[],ws=[];try{ms=JSON.parse(r.body.messages||'[]');ws=JSON.parse(r.body.words||'[]')}catch{}
  const sys=FOXSYS+(ws.length?"\nHozir foydalanuvchi shu so'zlarni mashq qilmoqda: "+ws.slice(0,20).map(w=>w.ko+' = '+w.uz).join('; ')+".":'')+VOICESYS;
  try{const t=await geminiVoice(ms,sys,buf);let o={};try{o=JSON.parse(t)}catch{try{o=JSON.parse(t.match(/\{[\s\S]*\}/)[0])}catch{}}
    const heard=String(o.heard||'').trim(),reply=String(o.reply||'').trim();
    if(!heard||!reply){foxUse[k]--;return s.json({e:'nohear'})}
    s.json({heard,reply,left:foxLeft(r.u,'voice')})}catch(e){foxUse[k]--;s.json({e:'api',msg:friendlyErr(e.message||e)})}});
app.get('/api/tasks',(r,s)=>s.json(q('select t.*,d.name dname from tasks t join dicts d on d.id=t.dict_id')));
// bepul sinov (1 oy) so'rovi
app.post('/api/trial',(r,s)=>{if(r.u.trial!=='none')return s.json({trial:r.u.trial});run("update users set trial='pending' where id=?",r.u.id);s.json({trial:'pending'})});
// to'lov
app.post('/api/pay',up.single('shot'),(r,s)=>{const b=r.body,pl=one('select * from plans where id=?',b.plan_id);if(!r.file||!pl||!one('select 1 from methods where id=?',b.method_id))return s.status(400).json({e:'bad'});
  const m=pl.monthly?Math.max(1,Math.min(12,+b.months||1)):pl.months;
  run('insert into pays(user_id,plan_id,method_id,file,ts,months) values(?,?,?,?,?,?)',r.u.id,pl.id,b.method_id,r.file.filename,Date.now(),m);s.json({ok:1})});
app.get('/api/mypay',(r,s)=>s.json(q('select id,status,ts from pays where user_id=? order by id desc limit 5',r.u.id)));
// admin
// ---- darajalar (nomi bilan) va so'z turkumlarini boshqarish
function relevel(id,from,to){db.prepare('update words set level=? where dict_id=? and level=?').run(to,id,from)}
app.post('/api/admin/level',adm('dicts'),(r,s)=>{const b=r.body,id=+b.dict_id,d=one('select * from dicts where id=?',id);if(!d)return s.status(400).json({e:'bad'});
  const name=String(b.name||'').trim();
  db.transaction(()=>{
    if(b.add){const n=d.levels+1;run('update dicts set levels=? where id=?',n,id);if(name)run('insert or replace into lvnames values(?,?,?)',id,n,name)}
    else if(b.del){const L=+b.del;if(d.levels<=1||L<1||L>d.levels)throw new Error('bad');
      const mv=Math.min(Math.max(+b.move_to||(L>1?L-1:2),1),d.levels);
      if(mv!==L)relevel(id,L,mv);
      for(let k=L+1;k<=d.levels;k++){run('update words set level=? where dict_id=? and level=?',k-1,id,k)}
      const nm=db.prepare('select level,name from lvnames where dict_id=?').all(id);run('delete from lvnames where dict_id=?',id);
      for(const x of nm){if(x.level===L)continue;run('insert into lvnames values(?,?,?)',id,x.level>L?x.level-1:x.level,x.name)}
      run('update dicts set levels=? where id=?',d.levels-1,id);
      run('delete from tasks where dict_id=? and level=?',id,L);run('update tasks set level=level-1 where dict_id=? and level>?',id,L)}
    else if(+b.level){const L=+b.level;if(L<1||L>d.levels)throw new Error('bad');if(name)run('insert or replace into lvnames values(?,?,?)',id,L,name);else run('delete from lvnames where dict_id=? and level=?',id,L)}
  })();
  if(b.del)resection(id);s.json({ok:1,levels:lvList(one('select * from dicts where id=?',id))})});
app.post('/api/admin/words-level',adm('dicts'),(r,s)=>{const b=r.body,id=+b.dict_id,d=one('select * from dicts where id=?',id),to=+b.to_level;if(!d||!(to>=1&&to<=d.levels))return s.status(400).json({e:'bad'});
  let n=0;
  if(Array.isArray(b.ids)&&b.ids.length){const u=db.prepare('update words set level=? where id=? and dict_id=?');db.transaction(()=>{for(const w of b.ids)n+=u.run(to,+w,id).changes})()}
  else{let sql='update words set level=? where dict_id=?';const a=[to,id];for(const k of ['level','pos','section'])if(b['from_'+k]){sql+=` and ${k}=?`;a.push(b['from_'+k])}n=run(sql,...a).changes}
  resection(id);s.json({ok:1,n})});
app.post('/api/admin/pos',adm('dicts'),(r,s)=>{const b=r.body,name=String(b.name||'').trim(),ko=String(b.ko||'').trim();
  if(b.del){const k=String(b.del);if(one('select 1 from words where pos=? limit 1',k))return s.status(400).json({e:"Bu turkumda so'zlar bor. Avval so'zlarni boshqa turkumga o'tkazing."});run('delete from poss where key=?',k)}
  else if(b.key){if(!name)return s.status(400).json({e:'bad'});run('update poss set name=?,ko=? where key=?',name,ko,String(b.key))}
  else{if(!name)return s.status(400).json({e:'bad'});let k=name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'t'+Date.now();if(/^\d/.test(k))k='k'+k;while(one('select 1 from poss where key=?',k))k+='_';
    run('insert into poss(key,name,ko,ord) values(?,?,?,?)',k,name,ko,(one('select coalesce(max(ord),0)+1 n from poss').n))}
  possC=0;s.json({ok:1,poss:getPoss()})});
app.post('/api/admin/tts-test',adm('admins'),async(r,s)=>{if(!USE_GEMINI)return s.json({ok:false,error:"GEMINI_API_KEY yo'q — ovozli javob brauzer ovozi bilan ishlaydi."});
  try{const a=await geminiTTSany("안녕하세요. Salom!");s.json({ok:true,a,model:TTSM})}catch(e){s.json({ok:false,error:friendlyErr(e.message||e)})}});
app.post('/api/admin/dict',adm('dicts'),(r,s)=>{run('insert into dicts(name,levels,sec) values(?,?,?)',r.body.name,+r.body.levels||1,+r.body.sec||30);s.json({ok:1})});
app.post('/api/admin/dict/:id',adm('dicts'),(r,s)=>{const b=r.body;
  if('free'in b)run('update dicts set free=? where id=?',b.free?1:0,r.params.id);
  if(b.levels)run('update dicts set levels=? where id=?',+b.levels,r.params.id);
  if(b.name)run('update dicts set name=? where id=?',b.name,r.params.id);
  if(b.sec){run('update dicts set sec=? where id=?',+b.sec,r.params.id);resection(+r.params.id)}
  if(b.del){run('delete from words where dict_id=?',r.params.id);run('delete from dicts where id=?',r.params.id)}s.json({ok:1})});
let FOXM=USE_GEMINI?GEMINI_MODEL:FOX_MODEL;
async function callGemini(messages,system,max,model,n=0){let le;for(const m of (n>=2?[model]:chainFor(model,max<=1000))){try{return await callGemini0(messages,system,max,m,2)}catch(e){le=e;if(!BUSY.test(String(e&&(e.message||e.name))))throw e;markDown(m,e)}}throw le}
async function callGemini0(messages,system,max,model,n=0){
  const body={systemInstruction:{parts:[{text:system||''}]},contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:String(m.content)}]})),generationConfig:{maxOutputTokens:max}};
  if(/gemini-3/i.test(model)){const fast=max<=1000;body.generationConfig.thinkingConfig={thinkingLevel:fast?THINK:'low'};body.generationConfig.maxOutputTokens=max+(fast?400:1500)}
  else if(/gemini-2\.5-flash/i.test(model))body.generationConfig.thinkingConfig={thinkingBudget:0};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',signal:AbortSignal.timeout(max<=1000?15000:90000),headers:{'content-type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){if(/thinking level/i.test((j.error&&j.error.message)||'')&&THINK!=='low'){THINK='low';return callGemini(messages,system,max,model)}const em0=(j.error&&j.error.message)||'';if(n===0&&r.status===503){await new Promise(z=>setTimeout(z,1500));return callGemini0(messages,system,max,model,1)}if(r.status===404&&n<2&&model!=='gemini-3.8-flash'){const t=await callGemini(messages,system,max,'gemini-3.8-flash');FOXM='gemini-3.8-flash';return t}throw new Error((j.error&&j.error.message)||'api '+r.status)}
  const c=j.candidates&&j.candidates[0];
  if(!c||!c.content){throw new Error((j.promptFeedback&&j.promptFeedback.blockReason)?'Gemini javobni blokladi: '+j.promptFeedback.blockReason:'Gemini bo\'sh javob qaytardi')}
  return (c.content.parts||[]).map(x=>x.text||'').join('').trim()}
async function callAnthropic(messages,system,max,model){
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(90000),headers:{'content-type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:max,system,messages})});
  const j=await r.json();
  if(!r.ok){if(r.status===404&&model!=='claude-sonnet-4-6'){const t=await callAnthropic(messages,system,max,'claude-sonnet-4-6');FOXM='claude-sonnet-4-6';return t}throw new Error((j.error&&j.error.message)||'api '+r.status)}
  return (j.content||[]).map(c=>c.text||'').join('').trim()}
async function callClaude(messages,system,max=500,model=FOXM){
  if(!AI_KEY)return null;
  return USE_GEMINI?callGemini(messages,system,max,model):callAnthropic(messages,system,max,model)}
const wp=()=>WPROMPT.replace("ot|fel|sifat|ravish|boshqa",posKeys());
const WPROMPT="Bu fayldan koreys tilidagi barcha so'z va iboralarni lug'at yozuvi sifatida ajratib ol. Tarjima faylning o'zida bo'lsa (so'z yonida, keyingi qatorda, jadval ustunida, qavs ichida; o'zbekcha, ruscha yoki inglizcha, qayerda yozilgan bo'lmasin) shuni o'zbek tiliga (lotin yozuvi) o'tkazib ol; fayl ichida tarjima bo'lmasa, o'zing o'zbek tiliga tarjima qil. Fe'llarni lug'at shaklida (-다) yoz. To'liq gaplarni emas, alohida so'zlarni ol, takrorlama. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\",\"pos\":\"ot|fel|sifat|ravish|boshqa\"}]";
function parseWords(t){const out=[],add=o=>{if(o&&o.ko&&/[가-힣]/.test(o.ko)&&o.uz)out.push({ko:String(o.ko).trim(),uz:String(o.uz).trim(),pos:normPos(o.pos)})};t=String(t||'');
  try{JSON.parse(t.match(/\[[\s\S]*\]/)[0]).forEach(add);return out}catch{}
  for(const m of t.match(/\{[^{}]*\}/g)||[])try{add(JSON.parse(m))}catch{}return out}
function gcfg(model,max,fast){const c={maxOutputTokens:max};if(/gemini-3/i.test(model)){c.thinkingConfig={thinkingLevel:fast?THINK:'low'};c.maxOutputTokens=max+(fast?400:1500)}else if(/gemini-2\.5-flash/i.test(model))c.thinkingConfig={thinkingBudget:0};return c}
async function geminiRaw(contents,system,cfg,n=0,mdl){const base=mdl||FOXM;let le;for(const m of (n>=2?[base]:chainFor(base,(cfg.maxOutputTokens||0)<=1500))){const c2=Object.assign({},cfg);if(m!==base)c2.thinkingConfig=/gemini-3/i.test(m)?{thinkingLevel:'low'}:{thinkingBudget:0};
  try{return await geminiRaw0(contents,system,c2,2,m)}catch(e){le=e;if(!BUSY.test(String(e&&(e.message||e.name))))throw e;markDown(m,e)}}throw le}
async function geminiRaw0(contents,system,cfg,n=0,mdl){
  const body={contents,generationConfig:cfg};if(system)body.systemInstruction={parts:[{text:system}]};
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(mdl||FOXM)+':generateContent',{method:'POST',signal:AbortSignal.timeout(cfg.maxOutputTokens<=1500?30000:120000),headers:{'content-type':'application/json','x-goog-api-key':GEMINI_API_KEY},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const em=(j.error&&j.error.message)||'api '+r.status;if(/thinking level/i.test(em)&&cfg.thinkingConfig&&cfg.thinkingConfig.thinkingLevel!=='low'){THINK='low';cfg.thinkingConfig.thinkingLevel='low';return geminiRaw(contents,system,cfg)}if(n===0&&r.status===503){await new Promise(z=>setTimeout(z,1500));return geminiRaw0(contents,system,cfg,1,mdl)}throw new Error(em)}
  const c=j.candidates&&j.candidates[0];const t=c&&c.content?(c.content.parts||[]).map(x=>x.text||'').join('').trim():'';
  if(!t)throw new Error("Gemini bo'sh javob qaytardi");return t}
const geminiFile=(buf,mime,prompt,max)=>geminiRaw([{role:'user',parts:[{inlineData:{mimeType:mime,data:buf.toString('base64')}},{text:prompt}]}],'',gcfg(FOXM,max));
async function geminiVoice(hist,system,audio){
  const cs=[];for(const m of (hist||[]).slice(-10)){const role=m.role==='assistant'?'model':'user',text=String(m.content||'').slice(0,1500);if(!text)continue;
    if(cs.length&&cs[cs.length-1].role===role)cs[cs.length-1].parts[0].text+='\n'+text;else cs.push({role,parts:[{text}]})}
  while(cs.length&&cs[0].role==='model')cs.shift();
  const au={inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}};
  if(cs.length&&cs[cs.length-1].role==='user')cs[cs.length-1].parts.push(au);else cs.push({role:'user',parts:[au]});
  const cfg=gcfg(FOXM,700,1);cfg.responseMimeType='application/json';
  return geminiRaw(cs,system,cfg)}
async function aiWords(items,txt,vis,defPos,auto,job){
  const kL=txt.split(/\n/).filter(l=>/[가-힣]/.test(l)).length,good=items.filter(i=>i.uz).length;
  if(job)job.expected=kL;
  if(!AI_KEY||(!vis&&(kL===0||good>=kL*.6))){if(!AI_KEY&&vis&&vis.partial&&job)job.warn.push((vis.pageList||[]).length+" ta sahifada matn topilmadi (skan/rasm bo'lishi mumkin): sahifalar "+(vis.pageList||[]).slice(0,30).join(', ')+". Ularni o'qish uchun GEMINI_API_KEY kerak.");return (vis&&!vis.partial)?null:items}
  let got=[],failed=0;
  try{
    if(vis){if(!USE_GEMINI){if(job)job.aiErr="GEMINI_API_KEY topilmadi";return vis.partial?items:null}if(job)job.stage="AI fayldan so'zlarni qidiryapti...";
      const rgs=[];
      if(vis.pageList&&vis.pageList.length){for(let i=0;i<vis.pageList.length;i+=8)rgs.push(vis.pageList.slice(i,i+8))}
      else if(vis.mime==='application/pdf'&&vis.pages>8){for(let p=1;p<=vis.pages;p+=8){const g=[];for(let k=p;k<p+8&&k<=vis.pages;k++)g.push(k);rgs.push(g)}}else rgs.push(null);
      let ri=0,dn=0,lastE='';const wv=async()=>{while(ri<rgs.length){const rg=rgs[ri++],pr=wp()+(rg?"\n\nFAQAT PDFning quyidagi sahifalaridagi so'zlarni ol (sahifa raqamlari): "+rg.join(', ')+". Har bir sahifani to'liq o'qi, hech bir so'zni tashlab ketma.":"");let okc=0;
        for(let a=0;a<3&&!okc;a++){try{const w=parseWords(await geminiFile(vis.buf,vis.mime,pr,30000));got.push(...w);okc=1}catch(e){lastE=friendlyErr(e&&e.message||e);await new Promise(z=>setTimeout(z,2000))}}
        if(!okc){failed++;if(job)job.failedPages.push(...(rg||[]))}
        dn++;if(job)job.stage="AI fayldan so'zlarni qidiryapti ("+dn+"/"+rgs.length+")..."}};
      await Promise.all(Array.from({length:Math.min(4,rgs.length)},wv));if(!got.length&&job)job.aiErr=lastE||"AI fayldan so'z topa olmadi"}
    else{const cs=[];for(let i=0;i<txt.length&&i<600000;i+=3500){let e=Math.min(txt.length,i+3500);const nl=txt.indexOf('\n',e);if(nl>0&&nl-e<400)e=nl;cs.push(txt.slice(i,e));i=e-3500}
      if(txt.length>600000&&job)job.warn.push("Fayl juda katta: faqat dastlabki 600 000 belgi qayta ishlandi.");
      let ci=0,dn=0;const bad=[];
      const w=async()=>{while(ci<cs.length){const c=cs[ci++];if(/[가-힣]/.test(c)){let okc=0;for(let a=0;a<2&&!okc;a++){try{got.push(...parseWords(await callClaude([{role:'user',content:wp()+"\n\n"+c}],"Sen koreys-o'zbek lug'at tuzuvchisan.",8000)));okc=1}catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e);await new Promise(z=>setTimeout(z,1500))}}if(!okc){failed++;bad.push(c)}}dn++;if(job)job.stage="AI fayldan so'zlarni qidiryapti ("+dn+"/"+cs.length+")..."}};
      await Promise.all(Array.from({length:Math.min(8,cs.length)},w));if(failed&&job)job.warn.push(failed+" ta matn bo'lagi AI tomonidan o'qilmadi; ular oddiy usulda ajratildi (tarjimasi/turi to'liq bo'lmasligi mumkin).")}
  }catch(e){if(job)job.aiErr=friendlyErr(e&&e.message||e)}
  if(failed&&job&&vis)job.warn.push(failed+" ta sahifa guruhi o'qilmadi: "+[...new Set(job.failedPages)].sort((a,b)=>a-b).join(', ')+" sahifalar.");
  if(!got.length)return (vis&&!vis.partial)?null:items;
  const seen=new Set(),out=[];
  for(const g of got)if(!seen.has(g.ko)){seen.add(g.ko);out.push({ko:g.ko,uz:g.uz,pos:(auto&&g.pos)||defPos,px:!!(auto&&g.pos)})}
  for(const it of items)if(!seen.has(it.ko)&&(it.uz||failed||vis)){seen.add(it.ko);out.push(it)}
  return out}
async function tr(t){
  const tryit=async f=>{try{const v=await f();return v&&v!==t?v:''}catch{return ''}},sg=()=>AbortSignal.timeout(7000);
  let r='';
  if(TRANSLATE_URL)r=await tryit(async()=>{const x=await fetch(TRANSLATE_URL,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,api_key:TRANSLATE_KEY||undefined})});return (await x.json()).translatedText});
  if(!r&&GOOGLE_TRANSLATE_KEY)r=await tryit(async()=>{const x=await fetch('https://translation.googleapis.com/language/translate/v2?key='+GOOGLE_TRANSLATE_KEY,{method:'POST',signal:sg(),headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,format:'text'})});return (await x.json()).data.translations[0].translatedText});
  if(!r)r=await tryit(async()=>{const x=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(t)+'&langpair=ko|'+TRANSLATE_TARGET,{signal:sg()});const j=await x.json();const v=j.responseData&&j.responseData.translatedText;return v&&!/MYMEMORY WARNING|QUERY LENGTH/i.test(v)?v:''});
  return r}
async function claudeTranslate(part){
  const txt=await callClaude([{role:'user',content:"Quyidagi koreys so'zlarini o'zbek tiliga (lotin yozuvi) tarjima qil va so'z turini aniqla (ot, fel=harakat 동사, sifat=holat 형용사, ravish, olmosh, son, yordamchi yoki boshqa; sifat va fe'lni aralashtirma). Har bir so'zning eng keng tarqalgan ma'nosini 1-3 ta qisqa o'zbekcha ekvivalent bilan ber (vergul bilan). Fe'llarni bosh shaklda (-moq) yoz. Ruscha yoki inglizcha so'z ishlatma. Ma'nosiga ishonching komil bo'lmasa, uz ni bo'sh qoldir, taxmin qilma. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\",\"pos\":\""+posKeys()+"\"}]\n\n"+part.map(x=>x.ko).join('\n')}],"Sen tajribali koreys-o'zbek lug'at tuzuvchisan. Tarjimalar aniq, qisqa va to'g'ri o'zbek tilida bo'lsin.",4000);
  const out={};try{JSON.parse(txt.match(/\[[\s\S]*\]/)[0]).forEach(o=>{if(o&&o.ko)out[o.ko]={uz:String(o.uz||'').trim(),pos:normPos(o.pos)}})}catch{}
  return out}
const POSMAP=[[/^(ot|otlar|noun|nouns|명사|isim)$/i,'ot'],[/^(fe['’‘`]?l|fe['’‘`]?llar|verb|verbs|동사)$/i,'fel'],[/^(sifat|sifatlar|adjective|adjectives|형용사)$/i,'sifat'],[/^(ravish|ravishlar|adverb|adverbs|부사)$/i,'ravish']];
POSMAP.push([/^(olmosh|olmoshlar|pronoun|pronouns|대명사)$/i,'olmosh'],[/^(son|sonlar|numeral|numerals|number|수사)$/i,'son'],[/^(ko['’‘`]?makchi|yordamchi|particle|particles|조사)$/i,'yordamchi']);
const normPos=x=>{x=String(x||'').trim().replace(/[()\[\]{}.:]/g,'');if(!x)return '';const ps=getPoss(),has0=k=>ps.some(p=>p.key===k);
  for(const [re,p] of POSMAP)if(re.test(x)&&has0(p))return p;
  const l=x.toLowerCase();for(const p of ps)if(l===p.key||l===String(p.name).toLowerCase()||(p.ko&&x===p.ko))return p.key;return ''};
const posKeys=()=>getPoss().map(p=>p.key).join('|')+'|boshqa';
async function extract(file,defPos,auto,job){
  const buf=fs.readFileSync(file.path);fs.unlinkSync(file.path);const nm=file.originalname.toLowerCase();let txt='',visual=null,pages=0,vpl=null;const emptyP=[];
  try{
    if(/\.pdf$/.test(nm)){try{const pg=[],pr0=await require('pdf-parse')(buf,{pagerender:p=>p.getTextContent().then(tc=>{let t='',ly=null;for(const it of tc.items){if(ly!==null&&Math.abs(it.transform[5]-ly)>2)t+='\n';t+=it.str;ly=it.transform[5]}pg.push(t);return t})});
      pages=pr0.numpages||pg.length;txt=pg.length?pg.join('\n'):(pr0.text||'');if(job){job.pages=pages}
      pg.forEach((t,i)=>{if(t.replace(/\s/g,'').length<15)emptyP.push(i+1)});if(job)job.emptyPages=emptyP.slice()}catch{txt=''}
      if((txt.replace(/\s/g,'').length<40||!/[가-힣]/.test(txt))&&buf.length<15e6)visual='application/pdf';
      else if(emptyP.length&&buf.length<15e6){visual='application/pdf';vpl=emptyP.slice()}}
    else if(/\.(xlsx|xls|ods)$/.test(nm)){const X=require('xlsx'),wb=X.read(buf);txt=wb.SheetNames.map(n=>X.utils.sheet_to_csv(wb.Sheets[n])).join('\n')}
    else if(/\.docx$/.test(nm))txt=(await require('mammoth').extractRawText({buffer:buf})).value;
    else if(/\.(html?|xml)$/.test(nm))txt=buf.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ');
    else if(/\.(pptx|odt|odp|epub)$/.test(nm)){const z=await require('jszip').loadAsync(buf);let o='';for(const n of Object.keys(z.files).sort()){if(!z.files[n].dir&&/^ppt\/slides\/slide\d+\.xml$|^content\.xml$|\.x?html?$/.test(n))o+=(await z.files[n].async('string')).replace(/<\/(a:p|text:p|text:h|p|div|h\d|li|tr)>|<br\s*\/?>/gi,'\n').replace(/<\/(td|th|a:tc|table:table-cell)>/gi,'\t').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")+'\n'}txt=o}
    else if(/\.rtf$/.test(nm)){const dc=new TextDecoder('euc-kr');txt=buf.toString('latin1').replace(/(?:\\'[0-9a-f]{2})+/gi,m=>dc.decode(Buffer.from(m.replace(/\\'/g,''),'hex'))).replace(/\\u(-?\d+)\??/g,(m,n)=>String.fromCharCode(n<0?+n+65536:+n)).replace(/\\pard?\b/g,'\n').replace(/\\[a-z]+-?\d* ?|[{}]/gi,'')}
    else if(/\.doc$/.test(nm)){txt=(buf.toString('utf16le').match(/[\u0009\u000d\u0020-\u007e\u00a0-\u052f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u2018-\u201f\u2013\u2014]{2,}/g)||[]).map(x=>x.replace(/\r/g,'\n')).join('\n')}
    else if(/\.(png|jpe?g|webp|heic|heif)$/.test(nm)){if(buf.length<15e6)visual='image/'+(/jpe?g$/.test(nm)?'jpeg':nm.split('.').pop())}
    else{let t=buf.toString('utf8');if(buf[0]===0xFF&&buf[1]===0xFE)t=buf.toString('utf16le');else if((t.match(/\uFFFD/g)||[]).length>3){try{t=new TextDecoder('euc-kr').decode(buf)}catch{}}txt=t.replace(/^\uFEFF/,'')}
  }catch{return null}
  const items=[],seen=new Set();let cur='';
  const hasK=x=>/[가-힣]/.test(x),lat=x=>/\p{L}/u.test(x)&&!hasK(x);
  const add=(ko,uz)=>{ko=ko.trim();uz=uz.trim();let p=cur,px=!!cur;
    const tg=uz.match(/\s*[(\[]\s*([^)\]]+?)\s*[)\]]\s*$/);if(tg&&normPos(tg[1])){p=normPos(tg[1]);px=true;uz=uz.slice(0,tg.index).trim()}
    uz=uz.replace(/^["“”«»]+|["“”«»]+$/g,'').trim();
    const ps=uz.split(/\s*[,;|\t]\s*/);if(ps.length>1&&normPos(ps[ps.length-1])){p=normPos(ps.pop());px=true;uz=ps.join(', ')}
    if(ko&&uz&&!seen.has(ko)){seen.add(ko);items.push({ko,uz,pos:p||defPos,px})}};
  const isTab=/\.(xlsx|xls|ods|csv|tsv)$/.test(nm);
  const csvSplit=(l,c)=>{const o=[];let b='',q=0;for(let i=0;i<l.length;i++){const ch=l[i];if(ch==='"'){if(q&&l[i+1]==='"'){b+='"';i++}else q=!q}else if(!q&&(ch==='\t'||ch===';'||ch==='|'||(c&&ch===','))){o.push(b);b=''}else b+=ch}o.push(b);return o.map(x=>x.trim())};
  const lines=txt.split(/\r?\n/).map(l=>l.replace(/^\s*(\d+[.)]?|[•*·])\s+/,'').trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){const line=lines[i];
    const hd=normPos(line.replace(/^[^A-Za-z가-힣'’‘`]+|[^A-Za-z가-힣'’‘`]+$/g,''));if(hd&&line.length<30){cur=hd;continue}
    if(/[\t;|]/.test(line)||(isTab&&line.includes(','))){const cells=csvSplit(line,isTab),ki=cells.findIndex(c=>hasK(c));
      if(cells.length>=2&&ki>=0){const rest=cells.filter((c,j)=>j!==ki&&c&&!hasK(c)&&/\p{L}/u.test(c)&&!normPos(c)),ps=cells.map(c=>normPos(c)).find(Boolean);
        if(rest.length){const keep=cur;if(ps)cur=ps;add(cells[ki],rest[0]);cur=keep;continue}}}
    let m=line.match(/^([가-힣][^\-–—:=,;\t|]*?)\s*[\-–—:=]\s*(.+)$/)||line.match(/^([가-힣][^,;\t|]*?)\s*[,;\t|]\s*(.+)$/);
    if(m&&!hasK(m[2])){add(m[1],m[2]);continue}
    const rv=line.match(/^([\p{L}'’‘ʻʼ][^가-힣]*?)\s*[\-–—:=\t,;|]\s*([가-힣].*)$/u);if(rv&&!hasK(rv[1])){add(rv[2],rv[1]);continue}
    const pr=line.match(/^([가-힣][가-힣\s~]*?)\s*[(（]\s*([^가-힣()（）]+?)\s*[)）]\s*$/);if(pr&&!normPos(pr[2])){add(pr[1],pr[2]);continue}
    const sp=line.match(/^([가-힣][가-힣~\s]*?)\s+([\p{L}'’‘ʻʼ].*)$/u);if(sp&&!hasK(sp[2])){add(sp[1],sp[2]);continue}
    if(hasK(line)&&!/[A-Za-z\u0400-\u04FF]/.test(line)&&lines[i+1]&&lat(lines[i+1])&&!normPos(lines[i+1])){add(line,lines[i+1]);i++;continue}
    for(const w of line.match(/[가-힣]{1,20}/g)||[])if(!seen.has(w)){seen.add(w);items.push({ko:w,uz:'',pos:cur||defPos,px:!!cur})}
  }
  if(auto)for(const it of items)if(!it.px&&/다$/.test(it.ko))it.pos='fel';
  return await aiWords(items,txt,visual&&{buf,mime:visual,pages,pageList:vpl,partial:!!vpl},defPos,auto,job)}
async function addWords(job,d,items,levelOf,auto){
  job.stage="Tekshirilmoqda...";
  const todo=items.slice(0,20000).filter(it=>!one('select 1 from words where dict_id=? and ko=?',d.id,it.ko));
  job.dups=Math.max(0,Math.min(items.length,20000)-todo.length);todo.forEach((it,i)=>it.idx=i);job.found=items.length;job.total=todo.length;job.done=0;
  const ins=db.prepare('insert into words(dict_id,level,pos,section,ko,uz) values(?,?,?,?,?,?)'),cnt={};
  const put=list=>{db.transaction(()=>{for(const it of list){const lv=levelOf(it.idx,todo.length),k=lv+'|'+it.pos;
    if(cnt[k]==null)cnt[k]=one('select count(*) n from words where dict_id=? and level=? and pos=?',d.id,lv,it.pos).n;
    const rr=ins.run(d.id,lv,it.pos,Math.floor(cnt[k]/d.sec)+1,it.ko,it.uz);(job.ids=job.ids||[]).push(rr.lastInsertRowid);cnt[k]++;
    job.perLevel[lv]=(job.perLevel[lv]||0)+1;job.perPos[it.pos]=(job.perPos[it.pos]||0)+1;job.added++}})()};
  const aiOn=!!AI_KEY,needAI=it=>!it.uz||(auto&&!it.px);
  const first=todo.filter(it=>it.uz&&!(aiOn&&needAI(it)));put(first);job.done=first.length;
  const fs0=new Set(first);let rest=todo.filter(it=>!fs0.has(it));
  if(aiOn&&rest.length){job.stage="Tarjima va tur aniqlash (AI)...";
    const bs=[];for(let i=0;i<rest.length;i+=80)bs.push(rest.slice(i,i+80));let bi=0;
    const worker=async()=>{while(bi<bs.length){const b=bs[bi++];let o={};try{o=await claudeTranslate(b)}catch{}
      const ok=[];for(const it of b){const x=o[it.ko];if(x){if(!it.uz&&x.uz){it.uz=x.uz;job.translated++}if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}}if(it.uz)ok.push(it);else it.left=1}
      put(ok);job.done+=b.length}};
    await Promise.all(Array.from({length:Math.min(8,bs.length)},worker));rest=rest.filter(it=>it.left)}
  if(aiOn&&rest.length){job.stage="Tarjima (qayta urinish)...";const bs2=[];for(let i=0;i<rest.length;i+=20)bs2.push(rest.slice(i,i+20));let bj=0;
    const w3=async()=>{while(bj<bs2.length){const b=bs2[bj++];let o={};for(let a=0;a<3&&!Object.keys(o).length;a++){try{o=await claudeTranslate(b)}catch{await new Promise(z=>setTimeout(z,1500))}}
      const ok=[];for(const it of b){const x=o[it.ko];if(x&&x.uz){it.uz=x.uz;job.translated++;if(auto&&!it.px&&x.pos){it.pos=x.pos;it.px=true}it.left=0;ok.push(it)}}put(ok)}};
    await Promise.all(Array.from({length:Math.min(4,bs2.length)},w3));rest=rest.filter(it=>it.left)}
  if(!aiOn&&rest.length){job.stage="Tarjima (tarjima xizmati)...";const lim=rest.slice(0,3000);let ri=0;
    const w2=async()=>{while(ri<lim.length){const it=lim[ri++];it.uz=await tr(it.ko);if(it.uz){job.translated++;put([it])}job.done++}};
    await Promise.all(Array.from({length:8},w2));rest=rest.filter(it=>!it.uz)}
  if(rest.length){for(const it of rest)it.uz=PENDING;put(rest);job.pending=rest.length;setTimeout(trFill,5000)}
  if(job.ids&&job.ids.length)ttsEnqueue(job.ids);
  if(job.expected&&job.found<job.expected*.5)job.warn.push("Faylda ~"+job.expected+" ta koreyscha qator bor, lekin faqat "+job.found+" ta so'z ajratildi. Fayl to'liq o'qilmagan bo'lishi mumkin — tekshirib ko'ring.");
  if(job.pending)job.warn.push(job.pending+" ta so'z tarjimasi kutilmoqda (fonda tarjima qilinadi).");
  job.incomplete=job.warn.some(w=>/o'qilmadi|to'liq o'qilmagan|topilmadi/.test(w));
  job.done=job.total;job.stage="Tayyor (ovozlar fonda avtomatik qo'shilmoqda)";return job}
const jobs={};
setInterval(()=>{const t=Date.now();for(const k in jobs)if(t-jobs[k].ts>36e5)delete jobs[k]},6e5).unref();
const newJob=()=>{const id=crypto.randomBytes(6).toString('hex');return jobs[id]={id,stage:"Fayl o'qilmoqda...",found:0,total:0,done:0,added:0,translated:0,skipped:0,perLevel:{},perPos:{},warn:[],failedPages:[],expected:0,dups:0,pages:0,emptyPages:[],fin:false,err:null,ts:Date.now()}};
app.get('/api/admin/job/:id',adm('import'),(r,s)=>{const j=jobs[r.params.id];if(!j)return s.status(404).json({e:'yoq'});s.json(j)});
app.post('/api/admin/import',adm('import'),up.single('file'),(r,s)=>{
  const {dict_id,level=1,pos='ot'}=r.body,d=one('select * from dicts where id=?',dict_id);if(!d||!r.file)return s.status(400).json({e:'bad'});
  const job=newJob(),auto=r.body.auto==='1';s.json({job:job.id});
  (async()=>{try{const items=await extract(r.file,pos,auto,job);if(!items){job.err=job.aiErr?("Gemini javob bermadi: "+job.aiErr+" — birozdan keyin qayta urinib ko'ring."):"Faylni o'qib bo'lmadi (.doc bo'lsa, .docx yoki PDF qilib saqlang; rasm/skan faqat Gemini bilan o'qiladi)";return}await addWords(job,d,items,()=>+level,auto)}catch(e){job.err=String(e.message||e)}finally{job.fin=true}})()});
app.post('/api/admin/book',adm('import'),up.single('file'),(r,s)=>{
  const b=r.body,name=(b.name||'').trim(),pos=b.pos||'ot';let L=Math.max(1,Math.min(+b.levels||1,30));
  if(!name||!r.file)return s.status(400).json({e:'bad'});
  const cs=String(b.counts||'').split(/[,;\s]+/).map(Number).filter(n=>n>0);if(b.split==='custom'&&!cs.length)return s.status(400).json({e:'counts'});
  const job=newJob(),auto=b.auto==='1';s.json({job:job.id});
  (async()=>{try{const items=await extract(r.file,pos,auto,job);if(!items){job.err=job.aiErr?("Gemini javob bermadi: "+job.aiErr+" — birozdan keyin qayta urinib ko'ring."):"Faylni o'qib bo'lmadi (.doc bo'lsa, .docx yoki PDF qilib saqlang; rasm/skan faqat Gemini bilan o'qiladi)";return}
    let levelOf;
    if(b.split==='level'){const lv=Math.max(1,+b.level||1);L=Math.max(L,lv);levelOf=()=>lv}
    else if(b.split==='custom'){L=Math.max(L,cs.length);const cum=[];cs.reduce((a,n,i)=>(cum[i]=a+n),0);levelOf=i=>{const k=cum.findIndex(c=>i<c);return k<0?cs.length:k+1}}
    else levelOf=(i,n)=>Math.min(L,Math.floor(i*L/n)+1);
    const id=run('insert into dicts(name,levels,sec) values(?,?,?)',name,L,+b.sec||30).lastInsertRowid,d=one('select * from dicts where id=?',id);job.dict_id=id;
    await addWords(job,d,items,levelOf,auto)}catch(e){job.err=String(e.message||e)}finally{job.fin=true}})()});
app.get('/api/admin/status',adm('admins'),(r,s)=>s.json({key:!!AI_KEY,keyLen:(AI_KEY||'').length,provider:USE_GEMINI?'Gemini':'Claude',model:FOXM,bot:!!BOT_TOKEN,webapp:WEBAPP_URL||'',data:DATA}));
app.post('/api/admin/claude-test',adm('admins'),async(r,s)=>{if(!AI_KEY)return s.json({ok:false,error:"GEMINI_API_KEY serverda ko'rinmayapti. Railway → Variables'ga qo'shing va Deploy bosing. Ikkita loyiha bo'lsa, domen bog'langan loyihaga qo'shing."});
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
// ================= TOPIK: testlar va so'zlar (oddiy lug'atdan alohida) =================
db.exec(`create table if not exists topik_exams(id integer primary key autoincrement,no int,level int,type text default '',title text default '',src text default '',free int default 1,ts int);
create table if not exists topik_secs(exam_id int,sec text,minutes int,audio text default '',primary key(exam_id,sec));
create table if not exists topik_q(id integer primary key autoincrement,exam_id int,sec text,n int,text text default '',img text default '',audio text default '',opts text default '[]',ans int default 0,pts real default 0);
create table if not exists topik_res(id integer primary key autoincrement,user_id int,exam_id int,exam_no int,level int,type text default '',sec text,correct int default 0,wrong int default 0,blank int default 0,scores text default '{}',total real default 0,max real default 0,grade text default '',final int default 0,used int default 0,writing text default '',wscore real,detail text default '[]',ts int);
create table if not exists topik_words(id integer primary key autoincrement,ko text,uz text,exam_no int default 0,level int default 1,sec text default '',type text default '',audio text default '',src text default '',ts int);
create table if not exists topik_learned(user_id int,word_id int,primary key(user_id,word_id));`);
const TSECS={1:['듣기','읽기'],2:['듣기','쓰기','읽기']},TMIN={1:{'듣기':40,'읽기':60},2:{'듣기':60,'쓰기':50,'읽기':70}};
const TSECN=x=>{x=String(x||'').trim().toLowerCase();return /^(듣기|listening|tinglash|tinglab)/.test(x)?'듣기':/^(읽기|reading|o['’`]?qish|o['’`]?qib)/.test(x)?'읽기':/^(쓰기|writing|yozish)/.test(x)?'쓰기':''};
const tOk=(u,e)=>!!e.free||active(u);
const tUrl=f=>f?'/audio/'+f:'';
function tGrade(level,total){
  if(+level===1)return total>=140?'2-daraja (2급)':total>=80?'1-daraja (1급)':"Daraja berilmadi (80 balldan past)";
  return total>=230?'6-daraja (6급)':total>=190?'5-daraja (5급)':total>=150?'4-daraja (4급)':total>=120?'3-daraja (3급)':"Daraja berilmadi (120 balldan past)"}
const tSecQs=(eid,sec)=>q('select * from topik_q where exam_id=? and sec=? order by n,id',eid,sec);
function tScore(qs,ans){ // 0..100, rasmiy: har bir savol balli (yig'indisi 100); ball berilmagan bo'lsa teng taqsimlanadi
  const tot=qs.reduce((a,x)=>a+(x.pts>0?x.pts:0),0),allp=qs.length&&qs.every(x=>x.pts>0);let got=0,c=0,w=0,b=0;const det=[];
  for(const x of qs){const ch=+ans[x.id]||0,ok=ch&&ch===x.ans;if(!ch)b++;else if(ok)c++;else w++;
    const p=allp?x.pts/tot*100:(qs.length?100/qs.length:0);if(ok)got+=p;
    det.push({id:x.id,n:x.n,sec:x.sec,text:x.text,img:tUrl(x.img),audio:tUrl(x.audio),opts:JSON.parse(x.opts||'[]'),ans:x.ans,choice:ch,ok:!!ok,pts:+p.toFixed(2)})}
  return {score:+got.toFixed(1),correct:c,wrong:w,blank:b,det}}
function tPub(e,u){return {id:e.id,no:e.no,level:e.level,type:e.type,title:e.title,free:e.free,ok:tOk(u,e),secs:q('select sec,minutes,audio from topik_secs where exam_id=?',e.id).map(s=>({sec:s.sec,minutes:s.minutes,audio:!!s.audio,n:one('select count(*) n from topik_q where exam_id=? and sec=?',e.id,s.sec).n})).sort((a,b)=>TSECS[e.level].indexOf(a.sec)-TSECS[e.level].indexOf(b.sec))}}
app.get('/api/topik/exams',(r,s)=>s.json(q('select * from topik_exams order by level,no desc,type').map(e=>tPub(e,r.u))));
app.get('/api/topik/exam/:id',(r,s)=>{const e=one('select * from topik_exams where id=?',r.params.id);if(!e)return s.status(404).json({e:'yoq'});if(!tOk(r.u,e))return s.status(402).json({e:'pay'});
  const want=String(r.query.sec||'all'),order=TSECS[e.level].filter(x=>want==='all'||x===want);
  const secs=order.map(sec=>{const sr=one('select * from topik_secs where exam_id=? and sec=?',e.id,sec);if(!sr)return null;const qs=tSecQs(e.id,sec);if(!qs.length)return null;
    return {sec,minutes:sr.minutes,audio:tUrl(sr.audio),qs:qs.map(x=>({id:x.id,n:x.n,text:x.text,img:tUrl(x.img),audio:tUrl(x.audio),opts:JSON.parse(x.opts||'[]')}))}}).filter(Boolean);
  s.json({exam:{id:e.id,no:e.no,level:e.level,type:e.type,title:e.title},secs})});
app.post('/api/topik/submit',(r,s)=>{const b=r.body||{},e=one('select * from topik_exams where id=?',+b.exam_id);if(!e)return s.status(404).json({e:'yoq'});if(!tOk(r.u,e))return s.status(402).json({e:'pay'});
  const want=String(b.sec||'all'),order=TSECS[e.level].filter(x=>want==='all'||x===want);const ans=b.answers||{},wr=b.writing||{};
  const scores={},det=[];let C=0,W=0,B=0,wtext='',hasW=false,hasAuto=false;
  for(const sec of order){const qs=tSecQs(e.id,sec);if(!qs.length)continue;
    if(sec==='쓰기'){hasW=true;scores[sec]=null;wtext=qs.map(x=>`[${x.n}] `+String(wr[x.id]||'').slice(0,4000)).join('\n\n');continue}
    hasAuto=true;const o=tScore(qs,ans);scores[sec]=o.score;C+=o.correct;W+=o.wrong;B+=o.blank;det.push(...o.det)}
  if(!hasAuto&&!hasW)return s.status(400).json({e:"Bu bo'limda savol yo'q"});
  const autoSecs=Object.keys(scores).filter(k=>scores[k]!==null),part=autoSecs.reduce((a,k)=>a+scores[k],0);
  const full=want==='all',needW=hasW,final=needW?0:1;
  const max=order.filter(x=>tSecQs(e.id,x).length).length*100;
  const grade=full&&order.every(x=>tSecQs(e.id,x).length)&&!needW?tGrade(e.level,part):'';
  const id=db.prepare('insert into topik_res(user_id,exam_id,exam_no,level,type,sec,correct,wrong,blank,scores,total,max,grade,final,used,writing,detail,ts) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(r.u.id,e.id,e.no,e.level,e.type,want==='all'?'all':want,C,W,B,JSON.stringify(scores),+part.toFixed(1),max,grade,final,Math.max(0,+b.used||0),wtext,JSON.stringify(det),Date.now()).lastInsertRowid;
  addScore(r.u.id,r.u.name,Math.min(Math.round(part/10),30));
  s.json(tRes(one('select * from topik_res where id=?',id)))});
function tRes(x){const sc=JSON.parse(x.scores||'{}'),w=!!x.writing;
  return {id:x.id,exam_id:x.exam_id,no:x.exam_no,level:x.level,type:x.type,sec:x.sec,correct:x.correct,wrong:x.wrong,blank:x.blank,scores:sc,total:x.total,max:x.max,grade:x.grade,final:!!x.final,used:x.used,ts:x.ts,
    writing:w,wscore:x.wscore,pending_writing:w&&x.wscore==null,detail:JSON.parse(x.detail||'[]')}}
app.get('/api/topik/results',(r,s)=>s.json(q('select * from topik_res where user_id=? order by id desc limit 200',r.u.id).map(x=>{const o=tRes(x);delete o.detail;return o})));
app.get('/api/topik/result/:id',(r,s)=>{const x=one('select * from topik_res where id=? and user_id=?',r.params.id,r.u.id);if(!x)return s.status(404).json({e:'yoq'});s.json(tRes(x))});
// --- so'zlar (alohida jadval)
app.get('/api/topik/filters',(r,s)=>s.json({rows:q("select level,exam_no no,sec,count(*) n from topik_words group by 1,2,3 order by level,no desc,sec")}));
app.get('/api/topik/words',(r,s)=>{const {level,no,sec,mode}=r.query;let sql='select w.*,(select 1 from topik_learned l where l.user_id=? and l.word_id=w.id) learned from topik_words w where 1=1';const a=[r.u.id];
  if(+level){sql+=' and level=?';a.push(+level)}if(+no>0){sql+=' and exam_no=?';a.push(+no)}if(sec){sql+=' and sec=?';a.push(sec)}
  sql+=' order by exam_no desc,level,sec,id';let rows=q(sql,...a).map(x=>({id:x.id,ko:x.ko,uz:x.uz,no:x.exam_no,level:x.level,sec:x.sec,type:x.type,audio:x.audio||null,learned:x.learned?1:0,tp:1}));
  if(mode==='learned')rows=rows.filter(x=>x.learned);else if(mode==='new')rows=rows.filter(x=>!x.learned);s.json(rows)});
app.post('/api/topik/learned',(r,s)=>{const id=+r.body.id;if(!one('select 1 from topik_words where id=?',id))return s.status(404).json({e:'yoq'});
  r.body.on?run('insert or ignore into topik_learned values(?,?)',r.u.id,id):run('delete from topik_learned where user_id=? and word_id=?',r.u.id,id);s.json({ok:1})});
// --- admin: testlar
const tFile=(f,pre)=>{const mt=f.mimetype||'',nm=(f.originalname||'').toLowerCase();const ext=(nm.match(/\.([a-z0-9]{2,4})$/)||[])[1]||(mt.includes('png')?'png':mt.includes('jpeg')?'jpg':mt.includes('mpeg')?'mp3':mt.includes('wav')?'wav':mt.includes('mp4')||mt.includes('m4a')?'m4a':mt.includes('ogg')?'ogg':'bin');
  if(!/^(png|jpg|jpeg|webp|gif|mp3|wav|m4a|ogg|aac|mp4|webm)$/.test(ext)){try{fs.unlinkSync(f.path)}catch{}return null}
  const name=pre+'_'+Date.now()+'_'+crypto.randomBytes(2).toString('hex')+'.'+ext;fs.renameSync(f.path,DATA+'/audio/'+name);return name};
const tDel=f=>{if(f)try{fs.unlinkSync(DATA+'/audio/'+f)}catch{}};
app.get('/api/admin/topik/exams',adm('topik'),(r,s)=>s.json(q('select * from topik_exams order by level,no desc,type').map(e=>({...tPub(e,r.u),src:e.src}))));
app.post('/api/admin/topik/exam',adm('topik'),(r,s)=>{const b=r.body;
  if(b.del){const e=one('select * from topik_exams where id=?',+b.del);if(!e)return s.json({ok:1});
    for(const x of q('select img,audio from topik_q where exam_id=?',e.id)){tDel(x.img);tDel(x.audio)}for(const x of q('select audio from topik_secs where exam_id=?',e.id))tDel(x.audio);
    run('delete from topik_q where exam_id=?',e.id);run('delete from topik_secs where exam_id=?',e.id);run('delete from topik_exams where id=?',e.id);return s.json({ok:1})}
  const level=+b.level===2?2:1,type=['PBT','IBT'].includes(String(b.type||'').toUpperCase())?String(b.type).toUpperCase():'';
  if(b.id){const e=one('select * from topik_exams where id=?',+b.id);if(!e)return s.status(404).json({e:'yoq'});
    run('update topik_exams set title=?,src=?,free=? where id=?',String(b.title??e.title).slice(0,200),String(b.src??e.src).slice(0,500),'free'in b?(b.free?1:0):e.free,e.id);
    if(b.minutes&&typeof b.minutes==='object')for(const sec of TSECS[e.level]){const m=+b.minutes[sec];if(m>0)run('insert into topik_secs(exam_id,sec,minutes) values(?,?,?) on conflict(exam_id,sec) do update set minutes=?',e.id,sec,m,m)}
    return s.json({ok:1})}
  const no=+b.no;if(!(no>0))return s.status(400).json({e:"Imtihon raqamini yozing (masalan 91)"});
  if(one('select 1 from topik_exams where no=? and level=? and type=?',no,level,type))return s.status(400).json({e:"Bu imtihon allaqachon qo'shilgan"});
  const id=run('insert into topik_exams(no,level,type,title,src,free,ts) values(?,?,?,?,?,?,?)',no,level,type,String(b.title||'').slice(0,200),String(b.src||'').slice(0,500),b.free===0||b.free===false?0:1,Date.now()).lastInsertRowid;
  for(const sec of TSECS[level]){const m=+(b.minutes&&b.minutes[sec])||TMIN[level][sec];run('insert into topik_secs(exam_id,sec,minutes) values(?,?,?)',id,sec,m)}
  s.json({ok:1,id})});
app.get('/api/admin/topik/exam/:id',adm('topik'),(r,s)=>{const e=one('select * from topik_exams where id=?',r.params.id);if(!e)return s.status(404).json({e:'yoq'});
  s.json({exam:e,secs:q('select * from topik_secs where exam_id=?',e.id).map(x=>({...x,audio:tUrl(x.audio)})),qs:q('select * from topik_q where exam_id=? order by sec,n,id',e.id).map(x=>({...x,opts:JSON.parse(x.opts||'[]'),img:tUrl(x.img),audio:tUrl(x.audio)}))})});
function tParse(text){text=String(text||'').trim();if(!text)return [];
  if(/^[\[{]/.test(text)){const j=JSON.parse(text);return Array.isArray(j)?j:(j.questions||[])}
  return text.split(/\r?\n/).filter(l=>l.trim()&&!/^\s*#/.test(l)).map(l=>{const c=l.split(l.includes('\t')?'\t':'|').map(x=>x.trim());return {sec:c[0],n:c[1],text:c[2],opts:c.slice(3,8).filter((x,i)=>i<4&&x!==''&&x!==undefined),ans:c[7],pts:c[8]}})}
app.post('/api/admin/topik/q-import',adm('topik'),(r,s)=>{const b=r.body,e=one('select * from topik_exams where id=?',+b.exam_id);if(!e)return s.status(404).json({e:'yoq'});
  let rows;try{rows=tParse(b.data)}catch(x){return s.status(400).json({e:"Format xato: "+x.message})}if(!rows.length)return s.status(400).json({e:"Savol topilmadi"});
  if(b.replace)for(const x of q('select img,audio from topik_q where exam_id=?',e.id)){tDel(x.img);tDel(x.audio)}
  if(b.replace)run('delete from topik_q where exam_id=?',e.id);
  let added=0,upd=0;const errors=[];
  db.transaction(()=>{rows.forEach((x,i)=>{const sec=TSECN(x.sec),n=+x.n;const where='#'+(i+1)+': ';
    if(!sec||!TSECS[e.level].includes(sec)){errors.push(where+`bo'lim noto'g'ri («${x.sec}»). TOPIK ${e.level==1?'I':'II'} uchun: ${TSECS[e.level].join(', ')}`);return}
    if(!(n>0)){errors.push(where+"savol raqami (n) noto'g'ri");return}
    let opts=Array.isArray(x.opts)?x.opts.map(v=>String(v??'').trim()):[];opts=opts.filter(v=>v!=='').slice(0,5);let ans=+x.ans||0;
    if(sec==='쓰기'){opts=[];ans=0;if(!String(x.text||'').trim()){errors.push(where+"yozish savoli matni yo'q");return}}
    else{if(opts.length<2){errors.push(where+"variantlar kamida 2 ta bo'lsin");return}if(!(ans>=1&&ans<=opts.length)){errors.push(where+`to'g'ri javob (ans) 1..${opts.length} bo'lishi kerak`);return}}
    const pts=Math.max(0,+x.pts||0),ex=one('select id from topik_q where exam_id=? and sec=? and n=?',e.id,sec,n);
    if(ex){run('update topik_q set text=?,opts=?,ans=?,pts=? where id=?',String(x.text||''),JSON.stringify(opts),ans,pts,ex.id);upd++}
    else{run('insert into topik_q(exam_id,sec,n,text,opts,ans,pts) values(?,?,?,?,?,?,?)',e.id,sec,n,String(x.text||''),JSON.stringify(opts),ans,pts);added++}})})();
  s.json({ok:1,added,updated:upd,errors:errors.slice(0,30),errorCount:errors.length})});
app.post('/api/admin/topik/q',adm('topik'),(r,s)=>{const b=r.body;
  if(b.del){const x=one('select * from topik_q where id=?',+b.del);if(x){tDel(x.img);tDel(x.audio);run('delete from topik_q where id=?',x.id)}return s.json({ok:1})}
  const x=one('select * from topik_q where id=?',+b.id);if(!x)return s.status(404).json({e:'yoq'});
  const opts='opts'in b?b.opts.map(v=>String(v).trim()).filter(Boolean).slice(0,5):JSON.parse(x.opts||'[]'),ans='ans'in b?+b.ans:x.ans;
  if(x.sec!=='쓰기'&&!(ans>=1&&ans<=opts.length))return s.status(400).json({e:"To'g'ri javob variantlar oralig'ida bo'lsin"});
  run('update topik_q set text=?,opts=?,ans=?,pts=? where id=?',String(b.text??x.text),JSON.stringify(opts),x.sec==='쓰기'?0:ans,'pts'in b?Math.max(0,+b.pts||0):x.pts,x.id);s.json({ok:1})});
app.post('/api/admin/topik/q/:id/media',adm('topik'),up.single('file'),(r,s)=>{const x=one('select * from topik_q where id=?',r.params.id);if(!x||!r.file)return s.status(400).json({e:'bad'});
  const kind=r.body.kind==='audio'?'audio':'img',name=tFile(r.file,'tq'+x.id);if(!name)return s.status(400).json({e:"Fayl turi qo'llab-quvvatlanmaydi"});
  const isA=/\.(mp3|wav|m4a|ogg|aac|mp4|webm)$/.test(name);if(kind==='audio'&&!isA||kind==='img'&&isA){tDel(name);return s.status(400).json({e:kind==='audio'?'Audio fayl tanlang':'Rasm tanlang'})}
  tDel(x[kind]);run(`update topik_q set ${kind}=? where id=?`,name,x.id);s.json({ok:1,url:tUrl(name)})});
app.post('/api/admin/topik/sec-audio',adm('topik'),up.single('file'),(r,s)=>{const eid=+r.body.exam_id,sec=TSECN(r.body.sec),sr=one('select * from topik_secs where exam_id=? and sec=?',eid,sec);if(!sr)return s.status(400).json({e:'bad'});
  if(r.body.del){tDel(sr.audio);run("update topik_secs set audio='' where exam_id=? and sec=?",eid,sec);return s.json({ok:1})}
  if(!r.file)return s.status(400).json({e:'Fayl yo\'q'});const name=tFile(r.file,'ts'+eid);if(!name||!/\.(mp3|wav|m4a|ogg|aac|mp4|webm)$/.test(name)){if(name)tDel(name);return s.status(400).json({e:'Audio fayl tanlang (mp3, m4a, wav, ogg)'})}
  tDel(sr.audio);run('update topik_secs set audio=? where exam_id=? and sec=?',name,eid,sec);s.json({ok:1,url:tUrl(name)})});
app.get('/api/admin/topik/writing',adm('topik'),(r,s)=>s.json(q("select r.id,r.exam_no,r.level,r.type,r.writing,r.ts,u.name from topik_res r left join users u on u.id=r.user_id where r.writing!='' and r.wscore is null order by r.id desc limit 50")));
app.post('/api/admin/topik/grade',adm('topik'),(r,s)=>{const x=one('select * from topik_res where id=?',+r.body.id),sc=+r.body.score;if(!x||!(sc>=0&&sc<=100))return s.status(400).json({e:"Ball 0 dan 100 gacha bo'lsin"});
  const scores=JSON.parse(x.scores||'{}');scores['쓰기']=sc;const total=Object.values(scores).reduce((a,v)=>a+(+v||0),0),e=one('select * from topik_exams where id=?',x.exam_id);
  const grade=x.sec==='all'?tGrade(x.level,total):'';run('update topik_res set wscore=?,scores=?,total=?,grade=?,final=1 where id=?',sc,JSON.stringify(scores),total,grade,x.id);s.json({ok:1})});
// --- admin: so'zlar
async function tTrMany(kos){const out={};if(!kos.length)return out;
  if(AI_KEY){for(let i=0;i<kos.length;i+=40){try{const o=await claudeTranslate(kos.slice(i,i+40).map(ko=>({ko})));for(const k in o)if(o[k].uz)out[k]=o[k].uz}catch{}}}
  for(const ko of kos)if(!out[ko]){const v=await tr(ko);if(v)out[ko]=v}
  return out}
function tWordIns(ko,uz,no,level,sec,type,src){ko=String(ko||'').trim();uz=String(uz||'').trim();if(!ko||!uz||!/[가-힣]/.test(ko))return 0;
  if(one('select 1 from topik_words where ko=? and exam_no=? and level=? and sec=?',ko,no,level,sec))return 2;
  run('insert into topik_words(ko,uz,exam_no,level,sec,type,src,ts) values(?,?,?,?,?,?,?,?)',ko,uz,no,level,sec,type,src||'',Date.now());return 1}
app.post('/api/admin/topik/words-import',adm('topik'),async(r,s)=>{const b=r.body,no=+b.exam_no||0,level=+b.level===2?2:1,sec=TSECN(b.sec),type=['PBT','IBT'].includes(String(b.type||'').toUpperCase())?String(b.type).toUpperCase():'';
  if(!no)return s.status(400).json({e:"Imtihon raqamini yozing"});if(!sec)return s.status(400).json({e:"Bo'limni tanlang (듣기/읽기/쓰기)"});if(sec==='쓰기'&&level===1)return s.status(400).json({e:"TOPIK I da 쓰기 bo'limi yo'q"});
  const items=[];String(b.text||'').split(/\r?\n/).forEach(l=>{l=l.trim();if(!l||/^#/.test(l))return;const m=l.match(/^([가-힣~()\s\/]+?)\s*(?:[\t|;=:]|\s[-–—]\s|,)\s*(.+)$/);const m2=m?null:l.match(/^([가-힣~()\/]+(?:\s[가-힣~()\/]+)*)\s+([A-Za-z'’ʻ‘].*)$/);if(m)items.push({ko:m[1].trim(),uz:m[2].trim()});else if(m2)items.push({ko:m2[1].trim(),uz:m2[2].trim()});else if(/[가-힣]/.test(l)&&!/[A-Za-z']{2,}/.test(l))items.push({ko:l,uz:''})});
  if(!items.length)return s.status(400).json({e:"So'z topilmadi. Format: «학교 - maktab» (har qatorda bittadan) yoki faqat koreyscha so'z"});
  const need=items.filter(x=>!x.uz).map(x=>x.ko);let trm={};if(need.length)trm=await tTrMany([...new Set(need)]);
  let added=0,dup=0,noTr=[];for(const it of items){const uz=it.uz||trm[it.ko]||'';if(!uz){noTr.push(it.ko);continue}const rr=tWordIns(it.ko,uz,no,level,sec,type,it.uz?'admin':'auto');if(rr===1)added++;else if(rr===2)dup++}
  s.json({ok:1,added,dups:dup,noTranslation:noTr.slice(0,50),noTranslationCount:noTr.length})});
app.post('/api/admin/topik/extract-words',adm('topik'),async(r,s)=>{const e=one('select * from topik_exams where id=?',+r.body.exam_id);if(!e)return s.status(404).json({e:'yoq'});
  if(!AI_KEY)return s.status(400).json({e:"AI kaliti (GEMINI_API_KEY) yo'q — so'zlarni qo'lda yoki ro'yxat orqali kiriting."});
  let added=0,dups=0,secsDone=[];
  for(const sec of TSECS[e.level]){const qs=tSecQs(e.id,sec);if(!qs.length)continue;
    const txt=qs.map(x=>[x.text,...JSON.parse(x.opts||'[]')].filter(Boolean).join(' ')).join('\n').slice(0,14000);if(!/[가-힣]/.test(txt))continue;
    try{const out=await callClaude([{role:'user',content:"Quyida TOPIK imtihoni savollari matni. Undagi muhim koreys lug'at so'zlarini (ot, fe'l, sifat va h.k.) lug'at (bosh) shaklida ajrat — fe'l va sifatlarni -다 shaklida. Juda oddiy qo'shimcha/yuklamalarni (은/는, 이/가 va h.k.) kiritma. Har birining o'zbekcha (lotin) tarjimasini 1-3 qisqa ekvivalent bilan ber. Ma'nosiga ishonching komil bo'lmasa so'zni tashlab ket. FAQAT JSON massiv qaytar: [{\"ko\":\"...\",\"uz\":\"...\"}]\n\n"+txt}],"Sen tajribali koreys-o'zbek lug'at tuzuvchisan.",6000);
      const arr=JSON.parse(out.match(/\[[\s\S]*\]/)[0]);for(const o of arr){const rr=tWordIns(o.ko,o.uz,e.no,e.level,sec,e.type,'ai');if(rr===1)added++;else if(rr===2)dups++}secsDone.push(sec)}catch{}}
  s.json({ok:1,added,dups,secs:secsDone})});
app.get('/api/admin/topik/words',adm('topik'),(r,s)=>{const {level,no,sec}=r.query;let sql='select * from topik_words where 1=1';const a=[];if(+level){sql+=' and level=?';a.push(+level)}if(+no){sql+=' and exam_no=?';a.push(+no)}if(sec){sql+=' and sec=?';a.push(sec)}
  sql+=' order by exam_no desc,level,sec,id limit 300';s.json(q(sql,...a).map(x=>({...x,audio:x.audio||null})))});
app.post('/api/admin/topik/word',adm('topik'),(r,s)=>{const b=r.body,w=one('select * from topik_words where id=?',+b.id);if(!w)return s.status(404).json({e:'yoq'});
  if(b.del){tDel(w.audio);run('delete from topik_learned where word_id=?',w.id);run('delete from topik_words where id=?',w.id);return s.json({ok:1})}
  run('update topik_words set ko=?,uz=?,exam_no=?,level=?,sec=? where id=?',String(b.ko||w.ko).trim(),String(b.uz||w.uz).trim(),'exam_no'in b?+b.exam_no||0:w.exam_no,+b.level===2?2:+b.level===1?1:w.level,'sec'in b?TSECN(b.sec)||w.sec:w.sec,w.id);s.json({ok:1})});
app.post('/api/admin/topik/word/:id/audio',adm('topik'),up.single('audio'),(r,s)=>{const w=one('select * from topik_words where id=?',r.params.id);if(!w||!r.file)return s.status(400).json({e:'bad'});
  const name=tFile(r.file,'tw'+w.id);if(!name||!/\.(mp3|wav|m4a|ogg|aac|mp4|webm)$/.test(name)){if(name)tDel(name);return s.status(400).json({e:'Audio fayl tanlang'})}
  tDel(w.audio);run('update topik_words set audio=? where id=?',name,w.id);s.json({ok:1,audio:name})});
app.post('/api/admin/task',adm('tasks'),(r,s)=>{run('insert into tasks(dict_id,level,title,pos,section) values(?,?,?,?,?)',r.body.dict_id,r.body.level,r.body.title,r.body.pos||'',+r.body.section||0);s.json({ok:1})});
app.post('/api/admin/task/:id/del',adm('tasks'),(r,s)=>{run('delete from tasks where id=?',r.params.id);s.json({ok:1})});
app.post('/api/admin/plan',adm('plans'),(r,s)=>{const b=r.body;b.del?run('delete from plans where id=?',b.del):run('insert into plans(months,price,dict_id,monthly) values(?,?,?,?)',+b.months||1,+b.price,+b.dict_id||0,b.monthly?1:0);s.json({ok:1})});
app.post('/api/admin/method',adm('methods'),(r,s)=>{const b=r.body;
  if(b.del)run('delete from methods where id=?',b.del);else if(b.id)run('update methods set name=?,number=?,holder=?,on_=? where id=?',b.name,b.number,b.holder,b.on?1:0,b.id);else run('insert into methods(name,number,holder) values(?,?,?)',b.name,b.number,b.holder);s.json({ok:1})});
app.get('/api/admin/methods',adm('methods'),(r,s)=>s.json(q('select * from methods')));
app.get('/api/admin/users',adm('users'),(r,s)=>s.json(q('select id,name,email,is_admin,perms,paid_until,trial,created from users order by created desc')));
app.post('/api/admin/user',adm('users'),(r,s)=>{const {id,months,grant,revoke}=r.body;
  if(+months){const u0=one('select paid_until from users where id=?',id);run('update users set paid_until=? where id=?',addM(Math.max(u0?u0.paid_until:0,Date.now()),Math.round(+months)),id)}
  if(r.body.cancel)run('update users set paid_until=0 where id=?',id);
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
  const mo=Math.max(1,Math.min(36,Math.round(+r.body.months||p.months||(pl&&pl.months)||1)));let end=0;
  run('update pays set status=?,months=? where id=?',ok?'accepted':'rejected',mo,p.id);
  if(ok&&pl){if(pl.dict_id){const a=one('select until from access where user_id=? and dict_id=?',p.user_id,pl.dict_id);
    if(!a){end=addM(Date.now(),mo);run('insert into access(user_id,dict_id,until) values(?,?,?)',p.user_id,pl.dict_id,end)}
    else if(a.until!==0){end=addM(Math.max(a.until,Date.now()),mo);run('update access set until=? where user_id=? and dict_id=?',end,p.user_id,pl.dict_id)}}
  else{const u0=one('select paid_until from users where id=?',p.user_id);end=addM(Math.max(u0?u0.paid_until:0,Date.now()),mo);run('update users set paid_until=? where id=?',end,p.user_id)}}
  tell(p.user_id,ok?"✅ To'lov qabul qilindi. Obuna "+mo+" oyga faollashtirildi"+(end?" ("+new Date(end).toLocaleDateString('ru-RU')+" gacha)":"")+"!":"❌ To'lov rad etildi. Qayta yuboring.");s.json({ok:1})});
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
    const k=id+':chat:'+Math.floor(Date.now()/DAY);if((foxUse[k]||0)>=foxLimit(u,'chat'))return c.reply("Bugungi bepul savollar tugadi 🦊 Obuna bo'lsangiz ko'proq yozishingiz mumkin.");
    foxUse[k]=(foxUse[k]||0)+1;const h=hist[id]=hist[id]||[];h.push({role:'user',content:t});c.sendChatAction('typing').catch(()=>{});
    const r=await askFox(h,[]);
    if(r.reply){h.push({role:'assistant',content:r.reply});if(h.length>12)h.splice(0,h.length-12);c.reply(r.reply)}
    else{h.pop();c.reply(r.e==='nokey'?"Men hozircha javob bera olmayman. Ilovani oching 👇":"Xatolik yuz berdi, birozdan keyin urinib ko'ring.",Markup.inlineKeyboard([open]))}});
  bot.launch().catch(console.error);
  bot.telegram.setChatMenuButton({menuButton:{type:'web_app',text:'Ochish',web_app:{url:WEBAPP_URL}}}).catch(()=>{})}
server.listen(PORT,()=>console.log('http://localhost:'+PORT));
