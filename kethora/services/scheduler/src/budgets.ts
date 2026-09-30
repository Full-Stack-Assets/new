export type EditionBudget={editionLimitCents:number;editionSpentCents:number;dailyLimitCents:number;dailySpentCents:number;plannedCardIds:readonly string[]};
export type EditionDecision={status:'complete'|'partial_budget';included:readonly string[];omitted:readonly string[];nextEligibleRefresh:string|null;editionSpentCents:number;dailySpentCents:number};
export function admitEdition(input:EditionBudget,perCardReserveCents:number,nextEligibleRefresh:string):EditionDecision {
  if(!Number.isInteger(perCardReserveCents)||perCardReserveCents<=0)throw new Error('A positive bounded reserve is required');
  if(new Set(input.plannedCardIds).size!==input.plannedCardIds.length)throw new Error('Duplicate card key');
  const editionLeft=Math.max(0,input.editionLimitCents-input.editionSpentCents);
  const dailyLeft=Math.max(0,input.dailyLimitCents-input.dailySpentCents);
  const count=Math.min(input.plannedCardIds.length,Math.floor(Math.min(editionLeft,dailyLeft)/perCardReserveCents));
  return {status:count===input.plannedCardIds.length?'complete':'partial_budget',included:input.plannedCardIds.slice(0,count),omitted:input.plannedCardIds.slice(count),nextEligibleRefresh:count===input.plannedCardIds.length?null:nextEligibleRefresh,editionSpentCents:input.editionSpentCents+count*perCardReserveCents,dailySpentCents:input.dailySpentCents+count*perCardReserveCents};
}
export function authorityNoticeAt(expiresAt:number):number{return expiresAt-7*24*60*60*1000;}
export function canMonitorWrite(expiresAt:number,now:number,freshAuthenticatedGrant:boolean):boolean{return freshAuthenticatedGrant&&now<expiresAt;}
