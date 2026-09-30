import PDFDocument from 'pdfkit';
import {createHash} from 'node:crypto';
export async function draftPDF(input:{title:string;content:string;taskId:string;revision:number;mode:string}):Promise<{base64:string;hash:string;bytes:number}>{
 const doc=new PDFDocument({size:'A4',margin:54,tagged:true,pdfVersion:'1.7',lang:'en-US',displayTitle:true,info:{Title:input.title,Author:'Kethora local workspace',Creator:'Kethora draft generator',Subject:`Unverified ${input.mode==='nvidia'?'AI-generated':'deterministic fixture'} draft; task ${input.taskId}; revision ${input.revision}`,Keywords:'Kethora, draft, unverified, AI provenance'}});
 const chunks:Buffer[]=[];
 const completed=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));});
 const root=doc.struct('Document');doc.addStructure(root);
 root.add(doc.struct('P',{},()=>{doc.font('Helvetica').fontSize(9).fillColor('#675d50').text('KETHORA  /  UNVERIFIED DRAFT');doc.moveDown(1.2);}));
 root.add(doc.struct('P',{},()=>{doc.fontSize(9).fillColor('#675d50').text('Draft only. Content has not been independently fact-verified. No external action is claimed.');doc.moveDown(1.8);}));
 for(const line of input.content.split('\n')){
  if(!line.trim()){doc.moveDown(0.45);continue;}
  const match=line.match(/^(#{1,3}) (.+)$/);const tag=match?`H${match[1]!.length}`:'P';
  root.add(doc.struct(tag,{},()=>{
   doc.font(match?'Helvetica-Bold':'Helvetica').fontSize(match?(match[1]!.length===1?23:match[1]!.length===2?15:12):10).fillColor('#20251d');
   doc.text(match?match[2]!:line.replace(/^> /,''),{lineGap:4});doc.moveDown(match?0.8:0.35);
  }));
 }
 root.add(doc.struct('P',{},()=>{doc.moveDown(1);doc.font('Helvetica').fontSize(8).fillColor('#676d62').text(`Task ${input.taskId} | Revision ${input.revision} | ${input.mode} mode`);}));
 doc.end();const bytes=await completed;
 if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!bytes.subarray(-64).toString().includes('%%EOF'))throw Error('PDF opening signature check failed');
 return {base64:bytes.toString('base64'),hash:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
