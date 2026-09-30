import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';

export type Row = {id:string; revision:number; created_at:string; updated_at:string; [key:string]:unknown};
export class HttpError extends Error {constructor(public status:number, public code:string, message:string){super(message);}}
export const now=()=>new Date().toISOString();
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
// The local edition deliberately uses a separate SQLite store. This is not the
// production PostgreSQL/Temporal implementation and must never promote a gate.
export class LocalStore {
  db:DatabaseSync;
  constructor(path:string){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY,deleted_at TEXT NOT NULL);`);
    this.initialize();
  }
  initialize(){
    if(!this.get('settings','profile')){
      this.put('settings',{id:'profile',name:'Kethora',timezone:'UTC',appearance:'dark',notifications:true,training:false,model_consent:false,feed_instructions:'Focus on my goals, completed work, and things that need my attention. Keep it concise.',revision:1,created_at:now(),updated_at:now()});
      this.create('threads',{title:'Main chat',kind:'main'});
      for(const [title,content,description] of [
        ['IDENTITY.md','# Identity\n\nName: Kethora\nRole: Personal AI assistant\n\nBe clear about what is known and ask before consequential actions.','Your assistant’s editable identity. This content does not grant permissions.'],
        ['MEMORY.md','# Memory\n\nAdd preferences you want Kethora to use in future tasks.','Editable context for future model calls. Changes do not rewrite past results.'],
        ['SOUL.md','# Working style\n\nBe thoughtful, practical, and concise. State uncertainty clearly.','Communication preferences, never executable policy.'],
        ['USER.md','# About you\n\nNo personal details have been saved yet.','Context you choose to share with your assistant.']
      ])this.create('files',{title,content,description,folder:'memory',versions:[{revision:1,content,created_at:now()}]});
    }
  }
  transaction<T>(work:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  get(kind:string,id:string):Row|undefined {const r=this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined;return r?JSON.parse(r.body) as Row:undefined;}
  require(kind:string,id:string):Row{const r=this.get(kind,id);if(!r)throw new HttpError(404,'not_found','This item could not be found.');return r;}
  all(kind:string):Row[]{return (this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as {body:string}[]).map(r=>JSON.parse(r.body) as Row);}
  put(kind:string,row:Row):Row{this.db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,row.id,JSON.stringify(row));return row;}
  create(kind:string,fields:Record<string,unknown>):Row{return this.put(kind,{...fields,id:randomUUID(),revision:1,created_at:now(),updated_at:now()});}
  update(kind:string,id:string,revision:number,fields:Record<string,unknown>):Row{
    const r=this.require(kind,id);if(r.revision!==revision)throw new HttpError(409,'revision_conflict','This item changed on another device. Reload before saving.');
    return this.put(kind,{...r,...fields,id,revision:r.revision+1,updated_at:now()});
  }
  remove(kind:string,id:string){this.require(kind,id);this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);this.db.prepare('INSERT OR REPLACE INTO tombstones VALUES(?,?)').run(id,now());}
  event(taskId:string,type:string,detail:string){const body={id:randomUUID(),task_id:taskId,type,detail,created_at:now(),mode:'local'};this.db.prepare('INSERT INTO events(task_id,body) VALUES(?,?)').run(taskId,JSON.stringify(body));return body;}
  activity(taskId?:string){const rows=(taskId?this.db.prepare('SELECT seq,body FROM events WHERE task_id=? ORDER BY seq').all(taskId):this.db.prepare('SELECT seq,body FROM events ORDER BY seq DESC LIMIT 100').all()) as {seq:number;body:string}[];return rows.map(r=>({...JSON.parse(r.body),position:r.seq}));}
  command(id:string,payload:unknown,work:()=>unknown):unknown{
    const digest=hash(JSON.stringify(payload));return this.transaction(()=>{
      const prior=this.db.prepare('SELECT digest,result FROM commands WHERE id=?').get(id) as {digest:string;result:string}|undefined;
      if(prior){if(prior.digest!==digest)throw new HttpError(409,'idempotency_conflict','This request ID was already used with different content.');return JSON.parse(prior.result);}
      const result=work();this.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(id,digest,JSON.stringify(result));return result;
    });
  }
  close(){this.db.close();}
}
