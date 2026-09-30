export type AgentMachine={agentId:string;vmId:string;identity:string;imageDigest:string;networkIdentity:string;phase:'running'|'suspended'|'snapshotted'|'terminated';auditRef?:string};
export interface AgentVMProvider {
  provision(spec:{agentId:string;signedBaseImageDigest:string;egressAllowlist:string[];cpuLimit:number;memoryMiB:number;costCeilingCents:number}):Promise<AgentMachine>;
  snapshotAndShipAudit(vmId:string):Promise<{snapshotRef:string;auditRef:string}>;
  suspend(vmId:string):Promise<void>;
  terminate(vmId:string,auditRef:string):Promise<void>;
}
export function validateAgentMachine(machine:AgentMachine,otherMachines:readonly AgentMachine[],routeCheck:{noPeerVmRoute:boolean;brokerGatewayOnly:boolean;ambientCredentials:false;imageSignatureVerified:boolean}):void {
  if(otherMachines.some(m=>m.vmId===machine.vmId||m.networkIdentity===machine.networkIdentity))throw new Error('Agent VM identity reused');
  if(!routeCheck.noPeerVmRoute||!routeCheck.brokerGatewayOnly||routeCheck.ambientCredentials!==false||!routeCheck.imageSignatureVerified)throw new Error('Agent VM isolation not proved');
}
export class UnconfiguredAgentVM implements AgentVMProvider {
  async provision():Promise<never>{throw new Error('D-09 VM provider and isolation test S09 are required');}
  async snapshotAndShipAudit():Promise<never>{throw new Error('VM audit shipment unavailable');}
  async suspend():Promise<never>{throw new Error('VM provider unavailable');}
  async terminate():Promise<never>{throw new Error('VM provider unavailable');}
}
