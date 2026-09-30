import {createHmac} from 'node:crypto';
import {OneOffEvent,type CalendarAdapter,type CalendarStatus} from '../../../packages/contracts/src/index.js';
import {digest} from '../../broker/src/permit.js';

export function stableIdentity(secret:Buffer,provider:'google'|'graph'|'caldav',connection:string,calendar:string,effectKey:string):string {
  if(secret.length<32)throw new Error('Gateway secret must be at least 256 bits');
  const raw=createHmac('sha256',secret).update(JSON.stringify([1,provider,connection,calendar,effectKey])).digest('hex');
  // Google client IDs accept lowercase base32hex. The hex alphabet is a subset.
  return provider==='google'?raw.slice(0,52):provider==='graph'?raw:`kethora-${raw.slice(0,52)}.ics`;
}
export function identicalEvent(expected:OneOffEvent,seen:OneOffEvent|null):boolean {return seen!==null&&digest(expected)===digest(seen);}

// Deliberately fixture-only. No production adapter can derive write support from this class.
export class FixtureCalendar implements CalendarAdapter {
  readonly providerClass='fixture/synthetic';readonly mode='simulated' as const;
  private events=new Map<string,OneOffEvent>();
  private modeNext:'success'|'response_lost'|'unreachable'='success';
  constructor(private readonly key:Buffer){}
  setNextResponse(mode:'success'|'response_lost'|'unreachable'):void {this.modeNext=mode;}
  async listCalendars():Promise<readonly {id:string;name:string}[]>{return [{id:'fixture-calendar',name:'Synthetic test calendar'}];}
  async probeCapabilities():Promise<{status:CalendarStatus;fixturePassed:boolean;livePassed:boolean;observedAt:string}>{return {status:'read_only',fixturePassed:true,livePassed:false,observedAt:new Date().toISOString()};}
  async prepareOneOffEvent(effectKey:string,event:OneOffEvent):Promise<{stableKey:string;payloadDigest:string;canonicalEvent:OneOffEvent}>{
    OneOffEvent.parse(event);return {stableKey:stableIdentity(this.key,'google',event.account_id,event.calendar_id,effectKey),payloadDigest:digest(event),canonicalEvent:event};
  }
  async create(stableKey:string,event:OneOffEvent):Promise<{providerRef?:string;ambiguous:boolean}>{
    OneOffEvent.parse(event);
    const mode=this.modeNext;this.modeNext='success';
    if(mode==='unreachable')return {ambiguous:true};
    const old=this.events.get(stableKey);if(old&&!identicalEvent(event,old))throw new Error('Stable identity collision');
    this.events.set(stableKey,event);
    if(mode==='response_lost')return {ambiguous:true};
    return {providerRef:stableKey,ambiguous:false};
  }
  async readByStableKey(key:string):Promise<OneOffEvent|null>{return this.events.get(key)??null;}
  async reconcile(key:string,event:OneOffEvent):Promise<'confirmed'|'uncertain'>{return identicalEvent(event,await this.readByStableKey(key))?'confirmed':'uncertain';}
  async disconnect():Promise<void>{this.events.clear();}
}
