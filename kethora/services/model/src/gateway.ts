export interface InferRequest {contextManifestRef:string;route:string;outputSchemaId:string;maxUnits:number;deadline:number;}
export interface InferResult {modelId:string;outputRef:string;schemaValid:boolean;usageUnits:number;costCents:number;simulated:boolean;}
export interface Processor {infer(request:InferRequest,repair:boolean):Promise<InferResult>;}
export type Budget = {turnsUsed:number;workReservedCents:number;workSpentCents:number;ceilingCents:number};
export type InferenceOutcome = {kind:'result';result:InferResult;budget:Budget}|{kind:'waiting';reason:'provider'|'budget'|'input';responsibleParty:'provider'|'user';resumeCondition:string;budget:Budget};
export async function inferWithOneRepair(request:InferRequest,processor:Processor,budget:Budget,allowedModelId:string,costReserveCents:number):Promise<InferenceOutcome>{
  if(!Number.isSafeInteger(costReserveCents)||costReserveCents<=0||Object.values(budget).some(x=>!Number.isSafeInteger(x)||x<0))throw new Error('Invalid cost accounting input');
  let b={...budget};
  if(b.turnsUsed>=12||b.workSpentCents+b.workReservedCents+costReserveCents>b.ceilingCents)return {kind:'waiting',reason:'budget',responsibleParty:'user',resumeCondition:'Raise task budget or reduce scope',budget:b};
  for(let repair=0;repair<2;repair++){
    if(b.turnsUsed>=12)return {kind:'waiting',reason:'budget',responsibleParty:'user',resumeCondition:'No model turns remain',budget:b};
    b={...b,turnsUsed:b.turnsUsed+1,workReservedCents:b.workReservedCents+costReserveCents};
    let result:InferResult;
    try {result=await processor.infer(request,repair===1);}catch {
      return {kind:'waiting',reason:'provider',responsibleParty:'provider',resumeCondition:'Named route becomes healthy',budget:{...b,workReservedCents:b.workReservedCents-costReserveCents}};
    }
    if(!Number.isSafeInteger(result.costCents)||result.costCents<0)throw new Error('Invalid measured processor charge');
    b={...b,workReservedCents:b.workReservedCents-costReserveCents,workSpentCents:b.workSpentCents+result.costCents};
    if(b.workSpentCents+b.workReservedCents>b.ceilingCents)return {kind:'waiting',reason:'budget',responsibleParty:'user',resumeCondition:'Measured route charge exceeded reserved budget; inspect cost and scope',budget:b};
    if(result.modelId!==allowedModelId)return {kind:'waiting',reason:'provider',responsibleParty:'provider',resumeCondition:'Original consented model route restored',budget:b};
    if(result.schemaValid)return {kind:'result',result,budget:b};
  }
  return {kind:'waiting',reason:'input',responsibleParty:'user',resumeCondition:'Review invalid structured output after one repair',budget:b};
}
