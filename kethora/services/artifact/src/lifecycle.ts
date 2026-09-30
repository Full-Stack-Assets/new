export type ClaimEdge={claimId:string;sourceVersionId:string;artifactVersionId:string;stale:boolean};
export function invalidateLineage(edges:readonly ClaimEdge[],sourceId:string):ClaimEdge[] {
  return edges.map(e=>e.sourceVersionId===sourceId?{...e,stale:true}:e);
}
export function tombstoneDeadline(deletedAt:number,oldestRestorableBackupExpiry:number,safetyMarginDays=5):number {
  if(safetyMarginDays<5)throw new Error('Insufficient restore safety margin');
  return Math.max(deletedAt+35*86_400_000,oldestRestorableBackupExpiry+safetyMarginDays*86_400_000);
}
export function canActivateAfterRestore(restoredGeneration:number,currentDeletionGeneration:number,tombstonesReplayed:boolean):boolean {
  return tombstonesReplayed&&restoredGeneration>=currentDeletionGeneration;
}
