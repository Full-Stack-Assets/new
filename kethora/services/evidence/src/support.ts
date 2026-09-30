import {createHash} from 'node:crypto';
import {Locator,SupportJudgment,type SupportJudgment as Judgment} from '../../../packages/contracts/src/index.js';
export function hashText(text:string):string{return createHash('sha256').update(text).digest('hex');}
export function locatorResolves(locator:unknown,source:{versionId:string;text:string;fileHash?:string;coverage:'complete'|'unknown';deleted:boolean}):boolean {
  const r=Locator.safeParse(locator);if(!r.success||source.deleted||source.coverage!=='complete'||r.data.source_version_id!==source.versionId)return false;
  if(r.data.kind==='pdf'&&source.fileHash!==r.data.file_hash)return false;
  if(hashText(r.data.quote)!==r.data.quote_hash)return false;
  if(r.data.kind==='web')return source.text.includes(r.data.quote);
  const lines=source.text.split('\n');if(r.data.kind==='text')return lines[r.data.line-1]?.slice(r.data.start,r.data.end)===r.data.quote;
  return source.text.includes(r.data.quote); // PDF page-range indexing is a separately gated format check.
}
export function canMarkVerified(input:{judgments:readonly unknown[];materialClaimIds:readonly string[];currentRevision:number;sourceVersions:Map<string,{versionId:string;text:string;contentHash:string;fileHash?:string;coverage:'complete'|'unknown';deleted:boolean}>;artifactOpens:boolean;calibrationPassed:boolean;judgeModelId:string;generatorModelId:string}):boolean {
  const {judgments,materialClaimIds,currentRevision,sourceVersions,artifactOpens,calibrationPassed,judgeModelId,generatorModelId}=input;
  if(!artifactOpens||!calibrationPassed||!materialClaimIds.length||judgeModelId===generatorModelId)return false;
  const adjudicated=judgments.map(x=>SupportJudgment.safeParse(x));
  if(adjudicated.some(r=>!r.success))return false;
  const actual=adjudicated.map(r=>r.data!.claim_id);
  if(new Set(actual).size!==actual.length||new Set(materialClaimIds).size!==materialClaimIds.length||actual.length!==materialClaimIds.length||actual.some(id=>!materialClaimIds.includes(id)))return false;
  return judgments.every(x=>{
    const r=SupportJudgment.safeParse(x);if(!r.success)return false;
    const j:Judgment=r.data;const source=sourceVersions.get(j.source_version_id);
    return !j.is_simulated&&j.judge_model_id===judgeModelId&&j.label==='supported'&&j.task_revision===currentRevision&&!!source&&source.contentHash===j.source_hash&&locatorResolves(j.locator,source);
  });
}
