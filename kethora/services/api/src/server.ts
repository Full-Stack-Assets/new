import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {LocalStore,HttpError,hash,now} from './local-store.js';
import {LocalWorker} from './local-worker.js';
import {modelRoute} from '../../model/src/nvidia.js';
const assets=resolve(process.cwd(),'apps/web/public');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const text=(v:unknown,max=12000):string=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new HttpError(422,'invalid_input',`Enter text between 1 and ${max} characters.`);return v.trim();};
const revision=(v:unknown):number=>{if(!Number.isSafeInteger(v)||Number(v)<1)throw new HttpError(422,'invalid_revision','A current revision is required.');return Number(v);};
const terminal=new Set(['partial','completed','failed','cancelled','expired']);
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new HttpError(413,'too_large','Local uploads are limited to 2 MB.');chunks.push(chunk as Buffer);}try{const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error();return parsed as Record<string,unknown>;}catch{throw new HttpError(400,'invalid_json','Send a JSON object.');}}
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export function createKethoraServer(options:{dbPath?:string;worker?:boolean}={}){
 const store=new LocalStore(options.dbPath??process.env.KETHORA_LOCAL_DB??'data/local.sqlite');const worker=new LocalWorker(store);
 function createTask(input:Record<string,unknown>){
  const request=text(input.text),thread=store.require('threads',text(input.thread_id,100)),mode=input.mode==='nvidia'?'nvidia':'local';
  if(mode==='nvidia'&&(!modelRoute().configured||!store.require('settings','profile').model_consent))throw new HttpError(409,'model_unavailable','Configure the NVIDIA model and consent in Settings first.');
  if(store.all('tasks').filter(t=>!terminal.has(String(t.state))&&t.state!=='paused').length>=2)throw new HttpError(429,'active_task_limit','Two tasks are active. Pause or finish one before starting another.');
  const sourceIds=Array.isArray(input.source_ids)?input.source_ids:[];if(sourceIds.length>10)throw new HttpError(422,'source_limit','At most ten files may be attached.');for(const id of sourceIds)store.require('sources',text(id,100));
  const task=store.create('tasks',{title:request.split('\n')[0]!.slice(0,90),request,thread_id:thread.id,state:'queued',mode,model_id:mode==='nvidia'?modelRoute().model:null,source_ids:sourceIds,turns_used:0,correction:null,limitations:[],wait:null});
  store.create('messages',{thread_id:thread.id,role:'user',content:request,task_id:task.id});
  store.create('messages',{thread_id:thread.id,role:'assistant',content:mode==='local'?'I’m preparing a local preview. It will stay saved when you close this page. No AI provider or external service is being called.':'I’m preparing an AI draft using your consented NVIDIA model. I’ll save the draft and its limitations; no external actions will be taken.',task_id:task.id});
  store.event(task.id,'task.received','Request and task ID committed to the local SQLite store.');return {task_id:task.id,command_id:input.command_id,event_cursor:store.activity(task.id).length};
 }
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const url=new URL(req.url??'/','http://localhost'),parts=url.pathname.split('/').filter(Boolean),method=req.method??'GET';
  try{
   if(url.pathname==='/health'){json(res,200,{status:'ok',edition:'local',storage:'sqlite',production_ready:false});return;}
   if(parts[0]==='v1'){
    const origin=req.headers.origin,host=req.headers.host;
    if(!host||!['localhost','127.0.0.1'].includes(new URL(`http://${host}`).hostname))throw new HttpError(403,'host_denied','The local edition only accepts a localhost origin.');if(origin&&origin!==`http://${host}`&&origin!==`https://${host}`)throw new HttpError(403,'origin_denied','Use the trusted application origin.');
    if(!['GET','HEAD'].includes(method)&&req.headers['x-kethora-client']!=='trusted-ui')throw new HttpError(403,'csrf_denied','A trusted client header is required.');
    if(url.pathname==='/v1/session'&&method==='POST'){store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());const token=randomBytes(32).toString('base64url');store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),Date.now()+7*86400000);res.setHeader('Set-Cookie',`kethora_local=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);json(res,200,{mode:'local',identity:'local workspace',production_auth:false});return;}
    const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('kethora_local='))?.slice(14);
    const session=token?store.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(hash(token)) as {expires_at:number}|undefined:undefined;
    if(!session||session.expires_at<Date.now())throw new HttpError(401,'session_required','Open a local workspace session first.');
    const kind=parts[1]??'',id=parts[2],action=parts[3];
    if(kind==='session'&&method==='DELETE'){store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token!));res.setHeader('Set-Cookie','kethora_local=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{revoked:true});return;}
    if(kind==='bootstrap'&&method==='GET'){json(res,200,{mode:'local',model:modelRoute(),settings:store.require('settings','profile'),threads:store.all('threads'),tasks:store.all('tasks'),messages:store.all('messages').reverse(),artifacts:store.all('artifacts').map(({content,versions,pdf_base64,...r})=>r),goals:store.all('goals'),feed:store.all('feed'),files:store.all('files'),sources:store.all('sources').map(({content,...r})=>r),inbox:store.all('inbox'),activity:store.activity()});return;}
    if(kind==='commands'&&method==='POST'){const input=await body(req);json(res,201,store.command(text(input.command_id,100),input,()=>createTask(input)));return;}
    if(kind==='tasks'&&id&&method==='POST'){
     const input=await body(req);const result=store.command(text(input.command_id,100),{id,action,...input},()=>{
      const task=store.require('tasks',id);if(task.revision!==revision(input.revision))throw new HttpError(409,'revision_conflict','The task changed. Reload before issuing a control.');let fields:Record<string,unknown>;
      if(action==='pause'&&!terminal.has(String(task.state))&&task.state!=='paused')fields={state:'paused',wait:null,draft:null};
      else if(action==='resume'&&['paused','waiting','failed'].includes(String(task.state)))fields={state:'queued',wait:null,draft:null};
      else if(action==='cancel'&&!terminal.has(String(task.state)))fields={state:'cancelled',wait:null,draft:null};
      else if(action==='revise'&&task.state!=='cancelled'){
       fields={correction:text(input.text),state:'queued',draft:null,wait:null};const a=store.all('artifacts').find(a=>a.task_id===id);if(a)store.update('artifacts',a.id,a.revision,{status:'stale',versions:(a.versions as Record<string,unknown>[]).map(v=>({...v,stale:true}))});store.create('messages',{thread_id:task.thread_id,role:'user',content:fields.correction,task_id:id});
      }else throw new HttpError(409,'invalid_transition','This task control is unavailable in its current state.');
      if(fields.state==='queued'&&store.all('tasks').filter(t=>t.id!==id&&!terminal.has(String(t.state))&&t.state!=='paused').length>=2)throw new HttpError(429,'active_task_limit','Two other tasks are active. Pause one before resuming or revising.');
      const updated=store.update('tasks',id,task.revision,fields);store.event(id,`task.${action}`,action==='revise'?`Revision ${updated.revision}: ${fields.correction}`:`Task ${action} committed. No external effects are connected.`);return updated;
     });json(res,200,result);return;
    }
    if(kind==='threads'&&method==='POST'){const input=await body(req);json(res,201,store.create('threads',{title:text(input.title,100),kind:'side',context_id:typeof input.context_id==='string'?input.context_id:null}));return;}
    if(kind==='sources'&&method==='POST'){const input=await body(req);const title=text(input.title,180);if(!/\.(txt|md|csv)$/i.test(title))throw new HttpError(422,'unsupported_format','Local mode supports text, Markdown, and CSV. PDF extraction is not configured.');const content=text(input.content,1500000);json(res,201,store.create('sources',{title,content,hash:hash(content),bytes:Buffer.byteLength(content)}));return;}
    if(kind==='goals'&&method==='POST'){const input=await body(req);const milestones=Array.isArray(input.milestones)?input.milestones.slice(0,20).map(m=>({id:randomUUID(),title:text(m,200),done:false})):[];json(res,201,store.create('goals',{title:text(input.title,180),description:typeof input.description==='string'?input.description.slice(0,3000):'',category:text(input.category??'Personal',60),milestones,status:'active'}));return;}
    if(kind==='goals'&&id&&method==='PATCH'){const input=await body(req);json(res,200,store.transaction(()=>{const goal=store.require('goals',id);const milestones=(goal.milestones as Record<string,unknown>[]).map(m=>m.id===input.milestone_id?{...m,done:input.done===true}:m);return store.update('goals',id,revision(input.revision),{milestones,status:input.status==='paused'?'paused':input.status==='active'?'active':goal.status});}));return;}
    if(kind==='feed'&&id&&method==='PATCH'){const input=await body(req);json(res,200,store.update('feed',id,revision(input.revision),{reaction:input.reaction==='like'?'like':null}));return;}
    if(kind==='inbox'&&id&&method==='PATCH'){const input=await body(req);json(res,200,store.update('inbox',id,revision(input.revision),{read:true}));return;}
    if(kind==='settings'&&method==='PATCH'){
     const input=await body(req),fields:Record<string,unknown>={};if(input.name!==undefined)fields.name=text(input.name,60);if(input.feed_instructions!==undefined)fields.feed_instructions=text(input.feed_instructions,3000);
     if(input.appearance!==undefined&&['dark','light','system'].includes(String(input.appearance)))fields.appearance=input.appearance;
     if(input.timezone!==undefined){try{new Intl.DateTimeFormat('en',{timeZone:String(input.timezone)});}catch{throw new HttpError(422,'invalid_timezone','Choose a valid IANA time zone.');}fields.timezone=input.timezone;}
     for(const key of ['model_consent','notifications'])if(typeof input[key]==='boolean')fields[key]=input[key];if(fields.model_consent===true&&!modelRoute().configured)throw new HttpError(409,'model_unavailable','Set NVIDIA_API_KEY and NVIDIA_MODEL on the server before consenting.');json(res,200,store.update('settings','profile',revision(input.revision),fields));return;
    }
    if(kind==='files'&&id&&method==='PATCH'){
     const input=await body(req);json(res,200,store.transaction(()=>{const file=store.require('files',id),content=text(input.content,40000),title=text(input.title??file.title,180);if(title.includes('/')||title.includes('\\')||title.includes('..'))throw new HttpError(422,'invalid_filename','Use a simple file name.');
      for(const a of store.all('artifacts'))if((a.memory_refs as {id:string}[]|undefined)?.some(ref=>ref.id===id))store.update('artifacts',a.id,a.revision,{status:'stale',versions:(a.versions as Record<string,unknown>[]).map(v=>({...v,stale:true}))});
      for(const task of store.all('tasks'))if(['running','verifying'].includes(String(task.state))&&task.mode==='nvidia'){store.update('tasks',task.id,task.revision,{state:'queued',draft:null});store.event(task.id,'context.invalidated','Memory changed. Rebuilding scoped context.');}
      return store.update('files',id,revision(input.revision),{title,content,versions:[...(file.versions as unknown[]),{revision:file.revision+1,content,created_at:now()}]});}));return;
    }
    if(kind==='artifacts'&&id&&action==='download'&&method==='GET'){
     const artifact=store.require('artifacts',id),requested=url.searchParams.get('version'),version=requested?(artifact.versions as Record<string,unknown>[]).find(v=>String(v.version)===requested):undefined;if(requested&&!version)throw new HttpError(404,'not_found','That version does not exist.');
     if(url.searchParams.get('format')==='pdf'){const bytes=Buffer.from(String(version?.pdf_base64??artifact.pdf_base64),'base64');res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store','Content-Disposition':'attachment; filename="kethora-draft.pdf"'});res.end(bytes);return;}
     res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`attachment; filename="${String(artifact.title).replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,100)||'kethora-draft'}.md"`});res.end(String(version?.content??artifact.content));return;
    }
    if(kind==='activity'&&method==='GET'){json(res,200,{items:store.activity(url.searchParams.get('task_id')??undefined)});return;}
    if(kind==='export'&&method==='GET'){const snapshot:Record<string,unknown>={format:'kethora-local-export-v1',importable:false,exported_at:now(),limitations:['Local SQLite edition only; not a production export.']};for(const k of ['settings','tasks','threads','messages','artifacts','goals','feed','files','sources','inbox'])snapshot[k]=store.all(k);snapshot.activity=store.activity();res.setHeader('Content-Disposition','attachment; filename="kethora-export.json"');json(res,200,snapshot);return;}
    if(kind==='reset'&&method==='POST'){
     const input=await body(req);if(input.confirmation!=='RESET')throw new HttpError(422,'confirmation_required','Type RESET to delete this local workspace.');const receipt=store.transaction(()=>{const records=store.db.prepare('SELECT id FROM records').all() as {id:string}[];for(const r of records)store.db.prepare('INSERT OR REPLACE INTO tombstones VALUES(?,?)').run(r.id,now());store.db.exec('DELETE FROM records; DELETE FROM commands; DELETE FROM events; DELETE FROM sessions;');return {id:randomUUID(),deleted_at:now(),records_deleted:records.length,active_retrieval:'removed',limitations:['SQLite WAL and free pages may retain bytes; no secure byte-erasure or backup deletion claim.','Downloaded/exported copies are outside this workspace.'],mode:'local'};});store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');store.initialize();json(res,200,receipt);return;
    }
    if(['tasks','threads','messages','artifacts','goals','feed','files','sources','inbox'].includes(kind)&&method==='GET'){json(res,200,id?store.require(kind,id):{items:store.all(kind)});return;}
    if(['goals','artifacts','sources','files'].includes(kind)&&id&&method==='DELETE'){
     const input=await body(req);json(res,200,store.transaction(()=>{const row=store.require(kind,id);if(row.revision!==revision(input.revision))throw new HttpError(409,'revision_conflict','Reload before deleting.');const affected:string[]=[];
      if(kind==='sources'){
       for(const a of store.all('artifacts'))if((a.source_ids as string[]).includes(id)){affected.push(a.id);store.remove('artifacts',a.id);}
       for(const t of store.all('tasks'))if((t.source_ids as string[]).includes(id)){store.update('tasks',t.id,t.revision,{state:'cancelled',draft:null,artifact_id:null,source_ids:(t.source_ids as string[]).filter(x=>x!==id)});store.event(t.id,'source.deleted','Source and derived artifacts removed; task cancelled.');}
       for(const f of store.all('feed'))if((f.source_ids as string[]).includes(id))store.remove('feed',f.id);
       for(const m of store.all('messages'))if(affected.includes(String(m.artifact_id)))store.remove('messages',m.id);
      }
      if(kind==='artifacts'){for(const t of store.all('tasks'))if(t.artifact_id===id){store.update('tasks',t.id,t.revision,{artifact_id:null,limitations:[...(t.limitations as string[]??[]),'Saved artifact deleted by the user.']});store.event(t.id,'artifact.deleted','Saved artifact and its linked Feed preview removed by the user.');}for(const f of store.all('feed'))if(f.artifact_id===id)store.remove('feed',f.id);}
      if(kind==='files')for(const a of store.all('artifacts'))if((a.memory_refs as {id:string}[]|undefined)?.some(ref=>ref.id===id))store.update('artifacts',a.id,a.revision,{status:'stale',versions:(a.versions as Record<string,unknown>[]).map(v=>({...v,stale:true}))});
      if(kind==='files')for(const t of store.all('tasks'))if(t.mode==='nvidia'&&['running','verifying'].includes(String(t.state))){store.update('tasks',t.id,t.revision,{state:'queued',draft:null});store.event(t.id,'context.invalidated','Memory deleted; rebuilding context.');}
      store.remove(kind,id);return {deleted:true,affected_artifacts:affected,active_retrieval:'removed',limitations:['Local record removal; downloaded copies and secure disk erasure are outside this receipt.']};}));return;
    }
    if(['connections','approvals','monitors'].includes(kind))throw new HttpError(503,'feature_unavailable','Production identity, broker, and connector tests are required. No external write is enabled.');throw new HttpError(404,'not_found','Unknown API route.');
   }
   if(method!=='GET'&&method!=='HEAD'){res.writeHead(405);res.end();return;}
   let pathname:string;try{pathname=decodeURIComponent(url.pathname);}catch{throw new HttpError(400,'invalid_path','Invalid URL.');}const path=resolve(assets,'.'+pathname);if(!path.startsWith(assets+'/')&&path!==assets)throw new HttpError(403,'path_denied','Invalid asset path.');const target=extname(path)?path:join(assets,'index.html');
   try{const bytes=await readFile(target);res.writeHead(200,{'Content-Type':mime[extname(target)]??'application/octet-stream'});res.end(method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end('Not found');}
  }catch(error){const e=error instanceof HttpError?error:new HttpError(500,'internal_error','The request could not be committed. Try again.');json(res,e.status,{code:e.code,message:e.message,request_id:randomUUID()});}
 });
 const timer=options.worker===false?undefined:setInterval(()=>void worker.tick(),600);server.on('close',()=>{if(timer)clearInterval(timer);worker.stop();store.close();});return {server,store,worker};
}
if(process.argv[1]?.endsWith('/server.js')||process.argv[1]?.endsWith('/server.ts')){const {server}=createKethoraServer();const port=Number(process.env.PORT??8787);server.listen(port,'127.0.0.1',()=>process.stdout.write(`Kethora local edition: http://127.0.0.1:${port}\nProduction gates remain unclaimed.\n`));for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>process.exit(0)));}
