const express=require('express'),crypto=require('crypto'),fs=require('fs'),http=require('http');
const Database=require('better-sqlite3'),multer=require('multer'),{Telegraf,Markup}=require('telegraf'),{Server}=require('socket.io');
const {OAuth2Client}=require('google-auth-library');
const {BOT_TOKEN,WEBAPP_URL,ADMIN_IDS='',ADMIN_EMAILS='',GOOGLE_CLIENT_ID,SECRET='change-me',DEV,PORT=3000,TRANSLATE_URL,TRANSLATE_KEY,TRANSLATE_TARGET='uz'}=process.env;
const DAY=864e5,PERMS=['dicts','import','tasks','payments','trials','users','plans','methods','admins'];
const DATA=process.env.DATA_DIR||'.';fs.mkdirSync(DATA+'/uploads',{recursive:true});
const db=new Database(DATA+'/data.db');
db.exec(`create table if not exists users(id integer primary key,name text,email text unique,is_admin int default 0,perms text default '',paid_until int default 0,trial text default 'none',created int);
create table if not exists dicts(id integer primary key autoincrement,name text,levels int default 1,sec int default 30,free int default 0);
create table if not exists words(id integer primary key autoincrement,dict_id int,level int,pos text,section int,ko text,uz text);
create table if not exists learned(user_id int,word_id int,primary key(user_id,word_id));
create table if not exists access(user_id int,dict_id int,primary key(user_id,dict_id));
create table if not exists tasks(id integer primary key autoincrement,dict_id int,level int,title text);
create table if not exists plans(id integer primary key autoincrement,months int,price int);
create table if not exists methods(id integer primary key autoincrement,name text,number text,holder text,on_ int default 1);
create table if not exists pays(id integer primary key autoincrement,user_id int,plan_id int,method_id int,file text,status text default 'pending',ts int);`);
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
const can=(u,d)=>active(u)||d.free||!!one('select 1 from access where user_id=? and dict_id=?',u.id,d.id);
const has=(u,p)=>u.is_admin==2||(u.is_admin==1&&u.perms.split(',').includes(p));
const app=express();app.use(express.json());app.get('/',(r,s)=>s.sendFile(__dirname+'/index.html'));app.use('/shots',express.static(DATA+'/uploads'));
const up=multer({dest:DATA+'/uploads/'}),gc=GOOGLE_CLIENT_ID&&new OAuth2Client(GOOGLE_CLIENT_ID);
app.get('/config',(r,s)=>s.json({google:GOOGLE_CLIENT_ID||null,dev:!!DEV}));
app.post('/auth/google',async(r,s)=>{try{const t=await gc.verifyIdToken({idToken:r.body.credential,audience:GOOGLE_CLIENT_ID}),p=t.getPayload();
  if(!p.email_verified)return s.status(401).json({e:'email'});const em=p.email.toLowerCase();
  let u=one('select * from users where email=?',em);
  if(!u){const i=run('insert into users(name,email,created) values(?,?,?)',p.name||em,em,Date.now());u=one('select * from users where id=?',i.lastInsertRowid)}
  else run('update users set name=? where id=?',p.name||u.name,u.id);
  s.json({token:sign(u.id)})}catch{s.status(401).json({e:'google'})}});
app.use('/api',(req,res,next)=>{const u=auth({init:req.get('x-init'),dev:req.get('x-dev'),token:(req.get('authorization')||'').slice(7)});if(!u)return res.status(401).json({e:'auth'});req.u=u;next()});
const adm=p=>(r,s,n)=>has(r.u,p)?n():s.status(403).json({e:'perm'});
app.get('/api/me',(r,s)=>s.json({id:r.u.id,name:r.u.name,email:r.u.email,is_admin:r.u.is_admin,perms:r.u.perms,paid_until:r.u.paid_until,trial:r.u.trial,active:active(r.u),PERMS}));
app.get('/api/plans',(r,s)=>s.json(q('select * from plans order by months')));
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
app.get('/api/tasks',(r,s)=>s.json(q('select t.*,d.name dname from tasks t join dicts d on d.id=t.dict_id')));
// bepul sinov (1 oy) so'rovi
app.post('/api/trial',(r,s)=>{if(r.u.trial!=='none')return s.json({trial:r.u.trial});run("update users set trial='pending' where id=?",r.u.id);s.json({trial:'pending'})});
// to'lov
app.post('/api/pay',up.single('shot'),(r,s)=>{const b=r.body;if(!r.file||!one('select 1 from plans where id=?',b.plan_id)||!one('select 1 from methods where id=?',b.method_id))return s.status(400).json({e:'bad'});
  run('insert into pays(user_id,plan_id,method_id,file,ts) values(?,?,?,?,?)',r.u.id,b.plan_id,b.method_id,r.file.filename,Date.now());s.json({ok:1})});
app.get('/api/mypay',(r,s)=>s.json(q('select id,status,ts from pays where user_id=? order by id desc limit 5',r.u.id)));
// admin
app.post('/api/admin/dict',adm('dicts'),(r,s)=>{run('insert into dicts(name,levels,sec) values(?,?,?)',r.body.name,+r.body.levels||1,+r.body.sec||30);s.json({ok:1})});
app.post('/api/admin/dict/:id',adm('dicts'),(r,s)=>{const b=r.body;
  if('free'in b)run('update dicts set free=? where id=?',b.free?1:0,r.params.id);
  if(b.levels)run('update dicts set levels=? where id=?',+b.levels,r.params.id);
  if(b.del){run('delete from words where dict_id=?',r.params.id);run('delete from dicts where id=?',r.params.id)}s.json({ok:1})});
async function tr(t){if(!TRANSLATE_URL)return '';try{const x=await fetch(TRANSLATE_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:t,source:'ko',target:TRANSLATE_TARGET,api_key:TRANSLATE_KEY||undefined})});return (await x.json()).translatedText||''}catch{return ''}}
app.post('/api/admin/import',adm('import'),up.single('file'),async(r,s)=>{
  const {dict_id,level=1,pos='ot'}=r.body,d=one('select * from dicts where id=?',dict_id);if(!d||!r.file)return s.status(400).json({e:'bad'});
  let txt;const buf=fs.readFileSync(r.file.path);fs.unlinkSync(r.file.path);
  if(/\.pdf$/i.test(r.file.originalname)){try{txt=(await require('pdf-parse')(buf)).text}catch{return s.status(400).json({e:'pdf'})}}else txt=buf.toString('utf8').replace(/^\uFEFF/,'');
  const items=[],seen=new Set();
  for(const line of txt.split(/\r?\n/)){const c=line.split(/[,;\t|]|\s[-–—]\s/).map(x=>x.trim());
    if(c.length>=2&&/[가-힣]/.test(c[0])&&c[1]&&!/[가-힣]/.test(c[1])){if(!seen.has(c[0])){seen.add(c[0]);items.push({ko:c[0],uz:c[1],pos:c[2]||pos})}}
    else for(const w of line.match(/[가-힣]{1,12}/g)||[])if(!seen.has(w)){seen.add(w);items.push({ko:w,uz:'',pos})}}
  let n=0,t=0,skip=0;const ins=db.prepare('insert into words(dict_id,level,pos,section,ko,uz) values(?,?,?,?,?,?)');
  for(const it of items.slice(0,3000)){
    if(one('select 1 from words where dict_id=? and ko=?',d.id,it.ko))continue;
    if(!it.uz){it.uz=await tr(it.ko);if(it.uz)t++}
    if(!it.uz){skip++;continue}
    const cnt=one('select count(*) n from words where dict_id=? and level=? and pos=?',d.id,level,it.pos).n;
    ins.run(d.id,+level,it.pos,Math.floor(cnt/d.sec)+1,it.ko,it.uz);n++}
  s.json({added:n,translated:t,skipped:skip})});
app.post('/api/admin/task',adm('tasks'),(r,s)=>{run('insert into tasks(dict_id,level,title) values(?,?,?)',r.body.dict_id,r.body.level,r.body.title);s.json({ok:1})});
app.post('/api/admin/task/:id/del',adm('tasks'),(r,s)=>{run('delete from tasks where id=?',r.params.id);s.json({ok:1})});
app.post('/api/admin/plan',adm('plans'),(r,s)=>{const b=r.body;b.del?run('delete from plans where id=?',b.del):run('insert into plans(months,price) values(?,?)',+b.months,+b.price);s.json({ok:1})});
app.post('/api/admin/method',adm('methods'),(r,s)=>{const b=r.body;
  if(b.id)run('update methods set name=?,number=?,holder=?,on_=? where id=?',b.name,b.number,b.holder,b.on?1:0,b.id);else run('insert into methods(name,number,holder) values(?,?,?)',b.name,b.number,b.holder);s.json({ok:1})});
app.get('/api/admin/methods',adm('methods'),(r,s)=>s.json(q('select * from methods')));
app.get('/api/admin/users',adm('users'),(r,s)=>s.json(q('select id,name,email,is_admin,perms,paid_until,trial,created from users order by created desc')));
app.post('/api/admin/user',adm('users'),(r,s)=>{const {id,months,grant,revoke}=r.body;
  if(months)run('update users set paid_until=max(paid_until,?)+? where id=?',Date.now(),months*30*DAY,id);
  if(grant)run('insert or ignore into access values(?,?)',id,grant);if(revoke)run('delete from access where user_id=? and dict_id=?',id,revoke);s.json({ok:1})});
app.post('/api/admin/admin',adm('admins'),(r,s)=>{const {id,email,admin,perms}=r.body;let u=id?one('select * from users where id=?',id):one('select * from users where email=?',(email||'').toLowerCase());
  if(!u&&email){run('insert into users(name,email,created) values(?,?,?)',email,email.toLowerCase(),Date.now());u=one('select * from users where email=?',email.toLowerCase())}
  if(!u||u.is_admin==2)return s.status(400).json({e:'bad'});
  if(admin!=null)run('update users set is_admin=? where id=?',admin?1:0,u.id);
  if(perms)run('update users set perms=? where id=?',perms.filter(p=>PERMS.includes(p)).join(','),u.id);s.json({ok:1})});
app.get('/api/admin/pending',adm('payments'),(r,s)=>s.json(q("select p.*,u.name,u.email,pl.months,pl.price,m.name mname from pays p join users u on u.id=p.user_id left join plans pl on pl.id=p.plan_id left join methods m on m.id=p.method_id where status='pending' order by p.id")));
app.get('/api/admin/trials',adm('trials'),(r,s)=>s.json(q("select id,name,email,created from users where trial='pending'")));
const tell=(id,t)=>bot&&bot.telegram.sendMessage(id,t).catch(()=>{});
app.post('/api/admin/trial/:id',adm('trials'),(r,s)=>{const ok=!!r.body.ok,id=r.params.id;
  if(ok)run("update users set trial='accepted',paid_until=max(paid_until,?)+? where id=?",Date.now(),30*DAY,id);else run("update users set trial='rejected' where id=?",id);
  tell(id,ok?"✅ So'rov qabul qilindi: 1 oy bepul foydalanasiz!":"❌ Bepul sinov so'rovi rad etildi.");s.json({ok:1})});
app.post('/api/admin/pay/:id',adm('payments'),(r,s)=>{const p=one('select * from pays where id=?',r.params.id),pl=one('select * from plans where id=?',p.plan_id),ok=!!r.body.ok;
  run('update pays set status=? where id=?',ok?'accepted':'rejected',p.id);
  if(ok&&pl)run('update users set paid_until=max(paid_until,?)+? where id=?',Date.now(),pl.months*30*DAY,p.user_id);
  tell(p.user_id,ok?"✅ To'lov qabul qilindi. Obuna faollashtirildi!":"❌ To'lov rad etildi. Qayta yuboring.");s.json({ok:1})});
// xonalar
const server=http.createServer(app),io=new Server(server),rooms={};
const shuffle=a=>a.map(x=>[Math.random(),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
io.on('connection',sock=>{
  const u=auth(sock.handshake.auth);if(!u)return sock.disconnect();
  const view=r=>({code:r.code,host:r.host,players:Object.values(r.players).map(p=>({name:p.name,score:p.score,done:p.done}))});
  sock.on('create',({dict,level},cb)=>{const d=one('select * from dicts where id=?',dict);if(!d||!can(u,d))return cb({e:'pay'});
    const w=q('select * from words where dict_id=?'+(level?' and level=?':''),...(level?[dict,level]:[dict]));
    if(w.length<4)return cb({e:"Kamida 4 ta so'z kerak"});
    let code;do code=String(Math.floor(1000+Math.random()*9000));while(rooms[code]);
    const qs=shuffle(w).slice(0,10).map(x=>({ko:x.ko,ans:x.uz,opts:shuffle([x.uz,...shuffle(w.filter(y=>y.id!==x.id)).slice(0,3).map(y=>y.uz)])}));
    rooms[code]={code,host:u.id,qs,started:false,players:{}};cb({code})});
  sock.on('join',(code,cb)=>{const r=rooms[code];if(!r)return cb({e:'Xona topilmadi'});if(r.started)return cb({e:'Boshlangan'});
    r.players[u.id]={name:u.name,score:0,i:0,done:false};sock.join(code);sock.data.code=code;cb({ok:1});io.to(code).emit('room',view(r))});
  sock.on('start',()=>{const r=rooms[sock.data.code];if(!r||r.host!==u.id)return;
    if(Object.keys(r.players).length<2)return sock.emit('err',"Kamida 2 o'yinchi kerak");
    r.started=true;io.to(r.code).emit('start',r.qs.map(x=>({ko:x.ko,opts:x.opts})))});
  sock.on('answer',({i,c})=>{const r=rooms[sock.data.code],p=r&&r.players[u.id];if(!p||p.done||i!==p.i)return;
    if(r.qs[i].ans===c)p.score++;p.i++;if(p.i>=r.qs.length)p.done=true;
    io.to(r.code).emit('room',view(r));
    if(Object.values(r.players).every(x=>x.done)){io.to(r.code).emit('end',view(r));delete rooms[r.code]}});
});
let bot;
if(BOT_TOKEN){bot=new Telegraf(BOT_TOKEN);
  bot.start(c=>c.reply("🇰🇷 Koreys tili lug'at botiga xush kelibsiz!",Markup.inlineKeyboard([Markup.button.webApp("📚 Ochish",WEBAPP_URL)])));
  bot.launch().catch(console.error)}
server.listen(PORT,()=>console.log('http://localhost:'+PORT));
