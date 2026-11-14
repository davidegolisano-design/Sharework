export function planPdf(jpeg,width,height){
 const landscape=width>=height;
 const pageWidth=landscape?842:595,pageHeight=landscape?595:842;
 const scale=Math.min((pageWidth-30)/width,(pageHeight-30)/height);
 const w=width*scale,h=height*scale;
 const stream='q '+w+' 0 0 '+h+' '+(pageWidth-w)/2+' '+(pageHeight-h)/2+' cm /Plan Do Q';
 const encoder=new TextEncoder(),parts=[],offsets=[0];
 let length=0;
 function append(part){
  const bytes=typeof part==='string'?encoder.encode(part):part;
  parts.push(bytes);length+=bytes.length;
 }
 function object(...data){
  offsets.push(length);
  append(offsets.length-1+' 0 obj\n');
  for(const part of data)append(part);
  append('\nendobj\n');
 }
 append('%PDF-1.4\n');
 object('<< /Type /Catalog /Pages 2 0 R >>');
 object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 object('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pageWidth+' '+pageHeight+'] /Resources << /XObject << /Plan 4 0 R >> >> /Contents 5 0 R >>');
 object('<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+
  ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n',jpeg,'\nendstream');
 object('<< /Length '+encoder.encode(stream).length+' >>\nstream\n'+stream+'\nendstream');
 const xref=length;
 append('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
 for(const offset of offsets.slice(1))append(String(offset).padStart(10,'0')+' 00000 n \n');
 append('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return new Blob(parts,{type:'application/pdf'});
}

export async function printPlan({page,rect,width,height,drawOverlay,title,tr}){
 const snapshot=document.createElement('canvas');
 const ratio=Math.min(3600/Math.max(width,height),3);
 snapshot.width=Math.max(1,Math.round(width*ratio));
 snapshot.height=Math.max(1,Math.round(height*ratio));
 const ctx=snapshot.getContext('2d',{alpha:false});
 await page.render({
  canvasContext:ctx,viewport:page.getViewport({scale:rect.scale}),
  transform:[ratio,0,0,ratio,rect.x*ratio,rect.y*ratio],background:'#fff'
 }).promise;
 ctx.setTransform(ratio,0,0,ratio,0,0);
 ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
 drawOverlay(ctx,rect);
 ctx.restore();
 const jpeg=await new Promise((resolve,reject)=>snapshot.toBlob(blob=>blob?resolve(blob):reject(Error(tr('Impossibile aprire il salvataggio PDF.'))),'image/jpeg',.92));
 const pdf=planPdf(new Uint8Array(await jpeg.arrayBuffer()),snapshot.width,snapshot.height);
 const name=title.replace(/[\\/:*?"<>|]/g,'-').slice(0,150)+'.pdf';
 if(navigator.userAgent.includes('ShareworkAndroid/11')){
  const data=await new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(reader.result.split(',')[1]);
   reader.onerror=()=>reject(reader.error);
   reader.readAsDataURL(pdf);
  });
  if(prompt('sharework:save-pdf',JSON.stringify({name,data}))!=='OK')throw Error(tr('Impossibile aprire il salvataggio PDF.'));
  return;
 }
 const url=URL.createObjectURL(pdf);
 const link=document.createElement('a');
 link.href=url;link.download=name;
 document.body.append(link);
 link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
