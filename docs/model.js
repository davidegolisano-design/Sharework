export const editable=['title','description','color','shape','opacity','width','x','y','points','strokes','deleted'];
export function snapshot(a){return Object.fromEntries(editable.map(k=>[k,structuredClone(a[k])]));}
export function grouped(items,page,all){return items.filter(a=>!a.deleted&&(all||a.page===page)).sort((a,b)=>a.page-b.page||a.created_at.localeCompare(b.created_at));}
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function normalized(x,y,rect){return [clamp((x-rect.x)/rect.w,0,1),clamp((y-rect.y)/rect.h,0,1)];}
export function segmentDistance(x,y,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l?clamp(((x-ax)*dx+(y-ay)*dy)/l,0,1):0;return Math.hypot(x-ax-t*dx,y-ay-t*dy);}
export function contrast(hex){const n=parseInt(hex.slice(1),16);return (((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114)>150?'#152f3b':'white';}

export function annotationStrokes(annotation){
 if(annotation.strokes?.length)return annotation.strokes;
 if(annotation.kind==='highlight'&&annotation.points?.length)return [annotation.points];
 return [];
}

// Keep nearby choices relative to the symbol the user hit. The marker size
// is fixed on screen even when the PDF zoom changes.
export function expandOverlappingMarkers(candidates,radius,neighborGap=0){
 const queue=candidates.filter(item=>item.distance<=radius);
 const selected=new Set(queue);
 const anchor=queue.reduce((nearest,item)=>!nearest||item.distance<nearest.distance?item:nearest,null);
 if(anchor&&neighborGap>0){
  for(const item of candidates){
   if(selected.has(item)||!boundsNear(anchor.bounds,item.bounds,neighborGap))continue;
   selected.add(item);
   queue.push(item);
  }
 }
 for(let i=0;i<queue.length;i++){
  for(const item of candidates){
   if(selected.has(item)||!boundsNear(queue[i].bounds,item.bounds,0))continue;
   selected.add(item);
   queue.push(item);
  }
 }
 return queue;
}

function boundsNear(a,b,gap){
 const horizontal=Math.max(0,a.left-b.right,b.left-a.right);
 const vertical=Math.max(0,a.top-b.bottom,b.top-a.bottom);
 return Math.hypot(horizontal,vertical)<=gap;
}
