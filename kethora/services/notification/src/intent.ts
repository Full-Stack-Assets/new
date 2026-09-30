import {createHash} from 'node:crypto';
export type Channel='inbox'|'email'|'push';
export type NotificationState='queued'|'provider_accepted'|'delivery_failed'|'device_displayed';
export function intentKey(tenantId:string,sourceEventId:string,recipientId:string,channel:Channel):string {
  return createHash('sha256').update(JSON.stringify([1,tenantId,sourceEventId,recipientId,channel])).digest('hex');
}
export function observation(current:NotificationState,next:NotificationState,deviceAcknowledged=false):NotificationState {
  if(next==='device_displayed'&&!deviceAcknowledged)throw new Error('No device-display proof');
  if(current===next)return current;
  if(current==='queued'&&['provider_accepted','delivery_failed'].includes(next))return next;
  if(current==='provider_accepted'&&['delivery_failed','device_displayed'].includes(next))return next;
  if(current==='delivery_failed'&&next==='provider_accepted')return next;
  throw new Error('Unsupported delivery observation');
}
