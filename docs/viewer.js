import * as pdfjs from './vendor/build/pdf.mjs';
import {normalized,segmentDistance,contrast,clamp,annotationStrokes,expandOverlappingMarkers} from './model.js?v=17d96b2f795f';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/build/pdf.worker.mjs',import.meta.url).href;
const vendor=new URL('./vendor/',import.meta.url).href;
export async function loadPdf(data){return pdfjs.getDocument({data,cMapUrl:vendor+'cmaps/',cMapPacked:true,standardFontDataUrl:vendor+'standard_fonts/',wasmUrl:vendor+'wasm/',iccUrl:vendor+'iccs/',isEvalSupported:false}).promise;}
import {emojiSymbols} from './ship-model.js?v=17d96b2f795f';
const highlightPath=new Path2D('M 5 16 L 15 4 L 21 9 L 11 21 H 3 Z');
const markerRadius=14;
// Use the part of the viewport covered by the sheet, including height-fitted overviews.
function selectionPadding(rect,viewportWidth,viewportHeight){
 const magnification=Math.min(rect.w/viewportWidth,rect.h/viewportHeight);
 return clamp(64/Math.sqrt(magnification),28,76);
}
const projectedOffset=markerRadius+5;

export function marker(ctx,x,y,color,shape,number,r=markerRadius){
 ctx.save();
 if(emojiSymbols[shape]){
  ctx.font=`${r*1.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#202020';
  ctx.fillText(emojiSymbols[shape],x,y);
  if(number!=null)numberBadge(ctx,x+r*.65,y+r*.45+6.5,number);
  ctx.restore();
  return;
 }
 ctx.beginPath();
 if(shape==='square')ctx.rect(x-r,y-r,r*2,r*2);
 else if(shape==='diamond'){ctx.moveTo(x,y-r*1.3);ctx.lineTo(x+r*1.3,y);ctx.lineTo(x,y+r*1.3);ctx.lineTo(x-r*1.3,y);ctx.closePath();}
 else if(shape==='triangle'){ctx.moveTo(x,y-r*1.3);ctx.lineTo(x+r*1.2,y+r);ctx.lineTo(x-r*1.2,y+r);ctx.closePath();}
 else ctx.arc(x,y,r,0,Math.PI*2);
 ctx.strokeStyle='white';ctx.lineWidth=4;ctx.stroke();ctx.fillStyle=color;ctx.fill();
 ctx.fillStyle=contrast(color);
 if(shape==='highlight'){
  const size=r*1.4;
  ctx.translate(x-size/2,y-size/2);ctx.scale(size/24,size/24);
  ctx.fill(highlightPath);
 }else if(number){
  ctx.font='700 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(number,x,y+(shape==='triangle'?2:0),r*1.4);
 }
 ctx.restore();
}

export function numberBadge(ctx,x,y,number){
 if(number==null)return;
 ctx.save();
 const label=String(number);
 ctx.font='700 10px system-ui';
 const width=Math.max(14,ctx.measureText(label).width+6);
 ctx.beginPath();
 ctx.roundRect(x-width/2,y-6.5,width,13,5);
 ctx.fillStyle='#183a79';
 ctx.fill();
 ctx.strokeStyle='white';
 ctx.lineWidth=1.5;
 ctx.stroke();
 ctx.fillStyle='white';
 ctx.textAlign='center';
 ctx.textBaseline='middle';
 ctx.fillText(label,x,y);
 ctx.restore();
}

function highlightGeometry(annotation,rect,points){
 const width=annotation.width*(annotation.projected?Math.min(rect.scale,1):rect.scale);
 const offset=annotation.projected?width/2+4:0;
 const pixels=points.map(([x,y])=>[rect.x+x*rect.w,rect.y+y*rect.h-offset]);
 return {width,pixels};
}

function markPosition(annotation,rect){
 if(annotation.kind==='note')return [rect.x+annotation.x*rect.w,markerY(annotation,rect)];
 const stroke=annotationStrokes(annotation)[0];
 if(!stroke)return [rect.x+annotation.x*rect.w,markerY(annotation,rect)];
 const {width,pixels}=highlightGeometry(annotation,rect,stroke);
 const [x,y]=pixels[Math.floor((pixels.length-1)/2)];
 return [annotation.projected?(pixels[0][0]+pixels.at(-1)[0])/2:x,y-Math.min(13,width/2)-8];
}

function markerBounds(annotation,rect){
 const [x,y]=markPosition(annotation,rect);
 const radius=markerRadius*1.3+2;
 const bounds={left:x-radius,right:x+radius,top:y-radius,bottom:y+radius};
 if(emojiSymbols[annotation.shape]&&annotation.number!=null){
  const badgeHalfWidth=Math.max(7,String(annotation.number).length*4+3)+1;
  bounds.right=Math.max(bounds.right,x+markerRadius*.65+badgeHalfWidth);
  bounds.bottom=Math.max(bounds.bottom,y+markerRadius*.45+14);
 }
 return bounds;
}

function markerY(annotation,rect){
 const clearance=annotation.projected ? projectedOffset+(annotation.shape==='diamond'?markerRadius*.3:0)+(emojiSymbols[annotation.shape]?4:0) : 0;
 return rect.y+annotation.y*rect.h-clearance;
}

function drawLaser(ctx, rect, laser) {
 if(!Number.isFinite(laser.x)||laser.x<0||laser.x>1)return;
 const x=rect.x+laser.x*rect.w;
 const y=rect.y+laser.y*rect.h;
 ctx.save();
 ctx.strokeStyle='#124115';
 ctx.fillStyle='#5dff00';
 ctx.beginPath();
 if(laser.vertical){
  ctx.moveTo(x,rect.y);
  ctx.lineTo(x,rect.y+rect.h);
  ctx.lineWidth=4;
  ctx.stroke();
  ctx.strokeStyle='#5dff00';
  ctx.lineWidth=2;
  ctx.stroke();
 }else{
  ctx.arc(x,y,6,0,Math.PI*2);
  ctx.fill();
  ctx.lineWidth=2;
  ctx.stroke();
 }
 ctx.restore();
}

export class Viewer{
 constructor(container,canvas,overlay,callbacks){Object.assign(this,{container,canvas,overlay,callbacks,zoom:1,panX:0,panY:0,mode:null,marks:[],pageNumber:1,pointers:new Map(),settings:{note:{color:'#ef5350',shape:'circle'},highlight:{color:'#e9b824',width:18,opacity:35}},revision:0});this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(container);window.addEventListener('blur',()=>this.resetGesture());container.addEventListener('pointerdown',e=>this.down(e));container.addEventListener('pointermove',e=>this.move(e));container.addEventListener('pointerup',e=>this.up(e));container.addEventListener('pointercancel',e=>this.cancelPointer(e));container.addEventListener('lostpointercapture',e=>this.cancelPointer(e));container.addEventListener('wheel',e=>{e.preventDefault();const p=this.local(e);this.zoomAt(Math.exp(-e.deltaY*.002),p.x,p.y);},{passive:false});}
 local(e){
  const bounds=this.container.getBoundingClientRect();
  return {
   x:(e.clientX-bounds.left)*this.container.clientWidth/bounds.width,
   y:(e.clientY-bounds.top)*this.container.clientHeight/bounds.height
  };
 }
 async open(pdf,page=1){this.clear();this.pdf=pdf;await this.page(page);}
 clear(){this.pageRequest=(this.pageRequest||0)+1;this.revision++;clearTimeout(this.timer);this.task?.cancel();this.pdf=null;this.pdfPage=null;this.detail=null;this.marks=[];this.areaDraft=null;this.laser=null;this.pick=null;this.guides=[];this.mode=null;this.resetGesture(false);this.draw();}
 async page(n){if(!this.pdf)return;const request=this.pageRequest=(this.pageRequest||0)+1;this.revision++;this.task?.cancel();clearTimeout(this.timer);const p=await this.pdf.getPage(n);if(request!==this.pageRequest)return;this.task?.cancel();this.resetGesture(false);this.pdfPage=p;this.pageNumber=n;this.zoom=1;this.minZoom=1;this.panX=this.panY=0;this.detail=null;this.draw();}
 rect(){if(!this.pdfPage)return null;const v=this.pdfPage.getViewport({scale:1}),w=this.container.clientWidth,h=this.container.clientHeight;const scale=Math.max(.0001,Math.min((w-24)/v.width,(h-24)/v.height))*this.zoom;return {x:(w-v.width*scale)/2+this.panX,y:(h-v.height*scale)/2+this.panY,w:v.width*scale,h:v.height*scale,scale};}
 viewCenter(visibleWidth=this.container.clientWidth){
  const rect=this.rect();
  if(!rect)return null;
  return {
   x:(visibleWidth/2-rect.x)/rect.w,
   y:(this.container.clientHeight/2-rect.y)/rect.h,
   width:rect.w
  };
 }
 centerView(x,y,{visibleWidth=this.container.clientWidth,width,fitHeight=false}={}){
  if(!this.pdfPage)return;
  const baseWidth=this.rect().w/this.zoom;
  if(fitHeight){
   const page=this.pdfPage.getViewport({scale:1});
   width=Math.max(1,this.container.clientHeight-24)*page.width/page.height;
  }
  if(Number.isFinite(width)&&width>0){this.zoom=width/baseWidth;this.minZoom=Math.min(1,this.zoom);}
  this.panX=this.panY=0;
  const rect=this.rect();
  this.panX=visibleWidth/2-(rect.x+x*rect.w);
  this.panY=this.container.clientHeight/2-(rect.y+y*rect.h);
  this.draw();
 }
 focus(x,y,visibleWidth=this.container.clientWidth){
  if(!this.pdfPage)return;
  this.zoom=Math.max(this.zoom,5);
  this.centerView(x,y,{visibleWidth});
 }
 fit(){this.zoom=1;this.minZoom=1;this.panX=this.panY=0;this.draw();}
 zoomAt(f,x,y){const r=this.rect();if(!r)return;const next=Math.max(this.minZoom??1,this.zoom*f);if(!Number.isFinite(next))return;const ratio=next/this.zoom;this.panX=(this.panX+this.container.clientWidth/2-x)*ratio+x-this.container.clientWidth/2;this.panY=(this.panY+this.container.clientHeight/2-y)*ratio+y-this.container.clientHeight/2;this.zoom=next;this.draw();}
 setMarks(marks){this.marks=marks;this.draw(false);}
 draw(render=true){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.ratio=Math.min(devicePixelRatio||1,Math.sqrt(10000000/(w*h)));for(const c of [this.canvas,this.overlay]){if(c.width!==Math.round(w*this.ratio)||c.height!==Math.round(h*this.ratio)){c.width=Math.round(w*this.ratio);c.height=Math.round(h*this.ratio);}}
 const ctx=this.canvas.getContext('2d');ctx.setTransform(this.ratio,0,0,this.ratio,0,0);ctx.clearRect(0,0,w,h);const ov=this.overlay.getContext('2d');ov.setTransform(this.ratio,0,0,this.ratio,0,0);ov.clearRect(0,0,w,h);const r=this.rect();if(!r)return;ctx.fillStyle='white';ctx.fillRect(r.x,r.y,r.w,r.h);if(this.detail){const d=this.detail,k=r.scale/d.rect.scale;ctx.drawImage(d.canvas,(r.x-d.rect.x*k),(r.y-d.rect.y*k),d.w*k,d.h*k);}
 ov.save();ov.beginPath();ov.rect(r.x,r.y,r.w,r.h);ov.clip();
 const marks=this.marks.filter(a=>a.page===this.pageNumber&&!a.deleted);
 for(const a of marks){
  if(a.id===this.areaDraft?.id)continue;
  for(const stroke of annotationStrokes(a)){
   const {width,pixels}=highlightGeometry(a,r,stroke);
   this.strokeLine(ov,pixels,a.color,width,a.opacity);
  }
 }
 for(const a of marks){
  if(a.id===this.areaDraft?.id)continue;
  const [x,y]=markPosition(a,r);
  marker(ov,x,y,a.color,a.shape,a.number);
 }
 if(this.areaDraft){
  const {strokes,color,width,opacity}=this.areaDraft;
  for(const stroke of this.stroke?[...strokes,this.stroke]:strokes){
   this.strokeLine(ov,stroke.map(([x,y])=>[r.x+x*r.w,r.y+y*r.h]),color,width*r.scale,opacity);
  }
 }

 if(this.laser)drawLaser(ov,r,this.laser);
 for(const {value,axis,label,color} of this.guides||[]){
  ov.strokeStyle=color;ov.fillStyle=color;ov.lineWidth=2;ov.setLineDash([7,5]);ov.beginPath();
  const x=r.x+value*r.w,y=r.y+value*r.h;
  if(axis){ov.moveTo(r.x,y);ov.lineTo(r.x+r.w,y);}
  else{ov.moveTo(x,r.y);ov.lineTo(x,r.y+r.h);}
  ov.stroke();
  ov.font='700 13px system-ui';
  const tx=axis?Math.max(4,r.x+6):x+5,ty=axis?y-6:Math.max(16,r.y+17);
  ov.lineWidth=4;ov.strokeStyle='white';ov.strokeText(label,tx,ty);ov.fillText(label,tx,ty);
 }
 ov.restore();if(render){this.revision++;clearTimeout(this.timer);this.timer=setTimeout(()=>this.renderDetail(),100);}}
 strokeLine(ctx,points,color,width,opacity){
  if(!points.length)return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for(const point of points)ctx.lineTo(...point);
  if(points.length===1)ctx.lineTo(...points[0]);
  ctx.strokeStyle=color;
  ctx.globalAlpha=opacity/100;
  ctx.lineWidth=width;
  ctx.lineCap=ctx.lineJoin='round';
  ctx.stroke();
  ctx.restore();
 }
 async renderDetail(){const p=this.pdfPage,r=this.rect(),rev=this.revision;if(!p||!r)return;this.task?.cancel();const w=this.container.clientWidth,h=this.container.clientHeight,out=document.createElement('canvas');out.width=this.canvas.width;out.height=this.canvas.height;const ratio=this.ratio;try{const ctx=out.getContext('2d');this.task=p.render({canvasContext:ctx,viewport:p.getViewport({scale:r.scale}),transform:[ratio,0,0,ratio,r.x*ratio,r.y*ratio],background:'rgba(0,0,0,0)'});await this.task.promise;if(rev!==this.revision)return;this.detail={canvas:out,rect:r,w,h};this.draw(false);}catch(e){if(e.name!=='RenderingCancelledException')this.callbacks.error(e);}}
 resetGesture(redraw=true){
  this.pointers.clear();
  this.pinch=null;
  this.stroke=null;
  this.moved=this.multi=false;
  if(redraw)this.draw(false);
 }

 beginPinch(){
  const midpoint=this.pinchState();
  this.pinch=midpoint&&{...midpoint,zoom:this.zoom,panX:this.panX,panY:this.panY};
 }

 pinchState(){
  const [first,second]=this.pointers.values();
  if(!second)return null;
  return {
   distance:Math.hypot(first.x-second.x,first.y-second.y),
   x:(first.x+second.x)/2,
   y:(first.y+second.y)/2
  };
 }

 down(e){
  if(!this.pdfPage)return;
  e.preventDefault();
  // A primary contact starts a new touch stream, even if a WebView lost an
  // up/cancel event from the previous pinch.
  if(e.isPrimary&&this.pointers.size)this.resetGesture();
  this.container.setPointerCapture(e.pointerId);
  const point=this.local(e);
  this.pointers.set(e.pointerId,point);
  if(this.pointers.size>1){
   this.multi=true;
   this.stroke=null;
   if(this.pointers.size===2)this.beginPinch();
   return;
  }
  this.start=this.last=point;
  this.moved=this.multi=false;
  this.pinch=null;
  this.stroke=this.mode==='area'&&this.onSheet(point)?[normalized(point.x,point.y,this.rect())]:null;
 }

 onSheet({x,y}){
  const rect=this.rect();
  return rect&&x>=rect.x&&x<=rect.x+rect.w&&y>=rect.y&&y<=rect.y+rect.h;
 }

 move(e){
  if(!this.pointers.has(e.pointerId))return;
  const point=this.local(e);
  this.pointers.set(e.pointerId,point);
  if(this.pointers.size>=2){
   const next=this.pinchState(),start=this.pinch;
   if(!start?.distance){
    this.beginPinch();
   }else if(next.distance>0){
    // Derive the transform from the start of the gesture, including at the zoom limit.
    const zoom=Math.max(this.minZoom??1,start.zoom*next.distance/start.distance);
    const ratio=zoom/start.zoom;
    const centerX=this.container.clientWidth/2,centerY=this.container.clientHeight/2;
    this.panX=(start.panX+centerX-start.x)*ratio+next.x-centerX;
    this.panY=(start.panY+centerY-start.y)*ratio+next.y-centerY;
    this.zoom=zoom;
    this.draw();
   }
   return;
  }
  this.moved||=Math.hypot(point.x-this.start.x,point.y-this.start.y)>(this.areaDraft||e.pointerType!=='touch'?3:12);
  if(this.stroke){
   if(this.stroke.length<20000)this.stroke.push(normalized(point.x,point.y,this.rect()));
   this.draw(false);
  }else if((!this.mode||this.multi)&&this.moved){
   this.panX+=point.x-this.last.x;
   this.panY+=point.y-this.last.y;
   this.draw();
  }
  if(this.moved||this.stroke)this.last=point;
 }

 releasePointer(id){
  if(!this.pointers.delete(id))return false;
  this.beginPinch();
  if(this.pointers.size)this.start=this.last=this.pointers.values().next().value;
  return true;
 }

 cancelPointer(e){
  if(!this.pointers.has(e.pointerId))return;
  this.resetGesture();
 }

 up(e){
  if(!this.releasePointer(e.pointerId)||this.pointers.size)return;
  const stroke=this.stroke;
  this.stroke=null;
  if(this.multi||this.moved){
   if(!this.multi&&stroke)this.callbacks.stroke?.(stroke);
   this.draw(false);
   return;
  }
  if(this.areaDraft){this.draw(false);return;}
  const point=this.local(e);
  const inside=this.onSheet(point);
  if(this.pick||this.laser){
   if(inside){
    const position=normalized(point.x,point.y,this.rect());
    if(this.pick)this.pick(position);
    else this.callbacks.laser?.(position);
   }
   return;
  }
  const hits=this.hit(point.x,point.y,e.pointerType);
  if(hits.length){this.callbacks.edit(hits);return;}
  if(this.mode==='note'&&inside){
   const [x,y]=normalized(point.x,point.y,this.rect());
   this.callbacks.create({kind:'note',x,y,...this.settings.note,points:[],width:18,opacity:100});
  }
 }
 hit(x,y,pointerType){
  const rect=this.rect();
  if(!rect)return [];
  const padding=selectionPadding(rect,this.container.clientWidth,this.container.clientHeight);
  const touchAllowance=pointerType==='touch'?12:0;
  const candidates=[];
  for(const a of this.marks){
   if(a.page!==this.pageNumber||a.deleted)continue;
   const bounds=markerBounds(a,rect);
   let distance=Math.hypot(x-clamp(x,bounds.left,bounds.right),y-clamp(y,bounds.top,bounds.bottom));
   for(const stroke of annotationStrokes(a)){
    const {width,pixels}=highlightGeometry(a,rect,stroke);
    let strokeDistance=Math.hypot(x-pixels[0][0],y-pixels[0][1]);
    for(let i=1;i<pixels.length;i++){
     strokeDistance=Math.min(strokeDistance,segmentDistance(x,y,...pixels[i-1],...pixels[i]));
    }
    distance=Math.min(distance,strokeDistance-width/2);
   }
   candidates.push({annotation:a,distance,bounds});
  }
  // Include neighbors around a directly hit mark without changing the zoom.
  const direct=candidates.some(item=>item.distance<=touchAllowance);
  const radius=padding+touchAllowance+(direct?Math.min(32,padding/2):0);
  return expandOverlappingMarkers(candidates,radius)
   .sort((a,b)=>a.distance-b.distance).map(item=>item.annotation);
 }
}
