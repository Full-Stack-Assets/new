import {LocalStore,now,hash,type Row} from './local-store.js';
import {draftPDF} from '../../artifact/src/pdf.js';
import {modelRoute,nvidiaDraft,type Draft} from '../../model/src/nvidia.js';

const list=(value:unknown):string[]=>Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'):[];
export class LocalWorker {
  private busy=new Set<string>();
  private stopped=false;
  constructor(private store:LocalStore){}
  stop(){this.stopped=true;}
  async tick(){if(this.stopped)return;const jobs:Promise<void>[]=[];for(const t of this.store.all('tasks'))if(['queued','planning','running','verifying'].includes(String(t.state))&&!this.busy.has(t.id)){this.busy.add(t.id);jobs.push(this.advance(t).catch(()=>{
    if(this.stopped)return;
    const current=this.store.get('tasks',t.id);if(current&&current.revision===t.revision)this.store.transaction(()=>{this.store.put('tasks',{...current,state:'failed',updated_at:now()});this.store.event(t.id,'task.failed','The local worker could not commit a result. Retry from task controls.');});
  }).finally(()=>this.busy.delete(t.id)));}await Promise.all(jobs);}
  private async advance(task:Row){
    if(task.state==='queued'||task.state==='planning'){
      this.store.transaction(()=>{this.store.put('tasks',{...task,state:task.state==='queued'?'planning':'running',updated_at:now()});this.store.event(task.id,task.state==='queued'?'task.planning':'task.running',task.state==='queued'?'Task admitted. Preparing scoped context.':'Preparing a saved draft from the supplied material.');});return;
    }
    if(task.state==='verifying'){
      if(task.mode==='nvidia'&&!this.store.require('settings','profile').model_consent){this.wait(task,'provider','Consent was revoked; re-consent before resuming.');return;}
      await this.publish(task);return;
    }
    const sources=list(task.source_ids).map(id=>this.store.get('sources',id)).filter((x):x is Row=>!!x);
    let draft:Draft;
    if(task.mode==='nvidia'){
      const settings=this.store.require('settings','profile');
      if(task.model_id!==modelRoute().model){this.wait(task,'provider','Restore the original task model route. No silent substitution is allowed.');return;}
      if(!settings.model_consent||!modelRoute().configured){this.wait(task,'provider','Enable and consent to the named NVIDIA model route.');return;}
      if(Number(task.turns_used)>=12){this.wait(task,'budget','Start a successor task with a narrower scope.');return;}
      const thread=this.store.get('threads',String(task.thread_id));
      const card=thread?.context_id?this.store.get('feed',String(thread.context_id)):undefined;
      const linked=card?.artifact_id?this.store.get('artifacts',String(card.artifact_id)):undefined;
      const memoryFiles=this.store.all('files');
      task={...task,memory_refs:memoryFiles.map(f=>({id:f.id,revision:f.revision}))};
      const memory=memoryFiles.map(f=>`${f.title}\n${f.content}`).join('\n');
      const sourceText=sources.map(s=>`Source ${s.id}, SHA256 ${s.hash}\n${s.content}`).join('\n')+(linked?`\nDiscussion context (unverified saved draft): ${linked.content}`:'');
      if(memory.length>16000||sourceText.length>40000){this.wait(task,'input',`Context exceeds local route limits. Reduce memory or source text before resuming. No model call occurred. Sources: ${sources.map(s=>s.title).join(', ')||'none'}; memory files: ${memoryFiles.map(f=>f.title).join(', ')}.`);return;}
      const input={request:String(task.request),correction:String(task.correction??''),memory,sources:sourceText};
      let used=Number(task.turns_used)+1;
      this.store.put('tasks',{...task,turns_used:used});
      try{draft=await nvidiaDraft(input);}catch(error){
        if(error instanceof SyntaxError||String(error).includes('Invalid model output')){
          if(this.stopped)return;
          const latest=this.store.get('tasks',task.id);
          if(!latest||latest.revision!==task.revision||latest.state!=='running')return;
          if(used>=12){this.wait({...task,turns_used:used},'budget','No model turns remain for schema repair.');return;}
          this.store.put('tasks',{...task,turns_used:++used});
          try{draft=await nvidiaDraft(input,true);}catch{this.wait({...task,turns_used:used},'provider','Review the model route after its one counted schema repair.');return;}
        }else{this.wait({...task,turns_used:used},'provider','The original NVIDIA route must become healthy. Resume explicitly.');return;}
      }
      task={...task,turns_used:used};
    }else{
      const excerpt=sources.map(s=>`### ${s.title}\n\n> ${String(s.content).slice(0,1800).replace(/\n/g,'\n> ')}\n\nSource ID: ${s.id}\nSHA-256: ${s.hash}\nExcerpt coverage: first ${Math.min(String(s.content).length,1800)} of ${String(s.content).length} characters${String(s.content).length>1800?' (remaining content omitted)':''}`).join('\n\n');
      draft={title:String(task.title),markdown:`# ${task.title}\n\n## Your requested outcome\n\n${task.request}\n\n${task.correction?`## Revision instructions\n\n${task.correction}\n\n`:''}${excerpt?`## Supplied source excerpts\n\n${excerpt}\n\n`:''}## Working outline\n\n- Clarify the desired result and acceptance conditions.\n- Review the supplied material and identify missing evidence.\n- Compare the options against your constraints.\n- Review this draft before making a decision.\n\n## What remains\n\nThis is a deterministic local preview, not an AI-generated research brief. ${sources.length?'Excerpts are copied from your uploaded files; factual support has not been judged.':'No source material has been provided.'} No websites were fetched and no external actions were taken.`,limitations:['Local deterministic fixture; no model inference.','Factual support has not been independently evaluated.','No calendar or other external write was attempted.']};
    }
    if(this.stopped)return;
    const current=this.store.get('tasks',task.id);
    if(!current||current.revision!==task.revision||current.state!=='running')return;
    // Context changes during inference invalidate the response rather than publishing it.
    if(task.mode==='nvidia'&&!this.store.require('settings','profile').model_consent){this.wait(current,'provider','Consent was revoked; re-consent before resuming.');return;}
    this.store.transaction(()=>{this.store.put('tasks',{...current,turns_used:task.turns_used,memory_refs:task.memory_refs??[],draft,state:'verifying',updated_at:now()});this.store.event(task.id,'artifact.checking','Checking that the saved Markdown is nonempty and recording its content hash. Factual support is unverified.');});
  }
  private wait(task:Row,reason:string,condition:string){if(this.stopped)return;const current=this.store.get('tasks',task.id);if(!current||current.revision!==task.revision||!['running','verifying'].includes(String(current.state)))return;this.store.transaction(()=>{this.store.put('tasks',{...current,turns_used:task.turns_used,state:'waiting',wait:{reason,responsible_party:reason==='provider'?'provider':'user',resume_condition:condition,since:now(),updated_at:now()},updated_at:now()});this.store.event(task.id,`waiting.${reason}`,condition);});}
  private async publish(task:Row){
    const draft=task.draft as Draft|undefined;if(!draft?.markdown)throw Error('No draft');
    const pdf=await draftPDF({title:draft.title,content:draft.markdown,taskId:task.id,revision:task.revision,mode:String(task.mode)});
    if(this.stopped)return;const current=this.store.get('tasks',task.id);if(!current||current.revision!==task.revision||current.state!=='verifying')return;
    if(task.mode==='nvidia'&&!this.store.require('settings','profile').model_consent){this.wait(task,'provider','Consent was revoked before publication.');return;}
    this.store.transaction(()=>{
      const previous=this.store.all('artifacts').find(a=>a.task_id===task.id);
      const version={version:previous?Number(previous.version)+1:1,content:draft.markdown,hash:hash(draft.markdown),created_at:now(),task_revision:task.revision,stale:false,pdf_base64:pdf.base64,pdf_hash:pdf.hash,pdf_bytes:pdf.bytes};
      const artifact=previous?this.store.update('artifacts',previous.id,previous.revision,{title:draft.title,content:draft.markdown,pdf_base64:pdf.base64,pdf_hash:pdf.hash,pdf_bytes:pdf.bytes,hash:version.hash,version:version.version,versions:[...(previous.versions as unknown[]),version],status:'unverified_draft',source_ids:task.source_ids??[],memory_refs:task.memory_refs??[]}):this.store.create('artifacts',{title:draft.title,task_id:task.id,content:draft.markdown,pdf_base64:pdf.base64,pdf_hash:pdf.hash,pdf_bytes:pdf.bytes,hash:version.hash,version:1,versions:[version],status:'unverified_draft',format:'markdown',source_ids:task.source_ids??[],memory_refs:task.memory_refs??[]});
      this.store.put('tasks',{...task,state:'partial',artifact_id:artifact.id,draft:null,limitations:draft.limitations,updated_at:now()});
      this.store.create('messages',{thread_id:task.thread_id,role:'assistant',content:`I saved “${draft.title}” to your Library. ${task.mode==='local'?'This is a local preview.':'This is an AI draft.'} Its factual claims still need review.`,task_id:task.id,artifact_id:artifact.id});
      this.store.event(task.id,'artifact.saved',`Markdown v${version.version} saved; SHA-256 ${version.hash}. Draft only, not verified completion.`);
      if(this.store.require('settings','profile').notifications)this.store.create('inbox',{title:'Your draft is ready',task_id:task.id,read:false});
      this.store.create('feed',{title:draft.title,summary:'A new draft is ready to review. Open its sources and limitations before using it.',artifact_id:artifact.id,task_id:task.id,status:'unverified_draft',instruction_revision:this.store.require('settings','profile').revision,source_ids:task.source_ids??[],reaction:null});
    });
  }
}
