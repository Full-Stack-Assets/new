import {isIP} from 'node:net';

// Admission preflight only. The actual fetcher must also pin every DNS resolution at egress,
// validate redirects/subresources and enforce robots, rights and rate limits. None is enabled yet.
export function validateSourceUrl(raw:string):URL {
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw new Error('Only ordinary public HTTPS URLs admitted');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(isIP(host)||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.'))throw new Error('Literal or local host denied');
  if(url.href.length>2048)throw new Error('URL over limit');
  return url;
}
export type FetchDecision={eligible:boolean;reason?:'robots_disallow'|'paywall'|'source_rights'|'egress_unavailable'|'unsafe_url'};
export function admissionDecision(input:{url:string;robotsAllowed:boolean;paywalled:boolean;connectedGrant:boolean;rightsAllowed:boolean;egressPinningReady:boolean}):FetchDecision {
  try{validateSourceUrl(input.url);}catch{return {eligible:false,reason:'unsafe_url'};}
  if(!input.robotsAllowed)return {eligible:false,reason:'robots_disallow'};
  if(input.paywalled&&!input.connectedGrant)return {eligible:false,reason:'paywall'};
  if(!input.rightsAllowed)return {eligible:false,reason:'source_rights'};
  if(!input.egressPinningReady)return {eligible:false,reason:'egress_unavailable'};
  return {eligible:true};
}
