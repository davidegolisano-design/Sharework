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

// Each part is a segment with a radius in screen pixels. A marker is a segment
// whose endpoints coincide. Bounds reject distant pairs before checking strokes.
export function touchPart(ax,ay,bx,by,radius){
 return {ax,ay,bx,by,radius,left:Math.min(ax,bx)-radius,right:Math.max(ax,bx)+radius,
  top:Math.min(ay,by)-radius,bottom:Math.max(ay,by)+radius};
}

function boundsTouch(a,b){
 return a.right>=b.left&&b.right>=a.left&&a.bottom>=b.top&&b.bottom>=a.top;
}

function partsTouch(a,b){
 if(!boundsTouch(a,b))return false;
 const radius=a.radius+b.radius;
 if(segmentDistance(a.ax,a.ay,b.ax,b.ay,b.bx,b.by)<=radius||
    segmentDistance(a.bx,a.by,b.ax,b.ay,b.bx,b.by)<=radius||
    segmentDistance(b.ax,b.ay,a.ax,a.ay,a.bx,a.by)<=radius||
    segmentDistance(b.bx,b.by,a.ax,a.ay,a.bx,a.by)<=radius)return true;
 // Interior crossings can be farther than the radius from all four endpoints.
 const side=(segment,x,y)=>(segment.bx-segment.ax)*(y-segment.ay)-(segment.by-segment.ay)*(x-segment.ax);
 return side(a,b.ax,b.ay)*side(a,b.bx,b.by)<0&&side(b,a.ax,a.ay)*side(b,a.bx,a.by)<0;
}

export function touchSelection(candidates,x,y){
 const distance=part=>segmentDistance(x,y,part.ax,part.ay,part.bx,part.by)-part.radius;
 const items=candidates.map(item=>{
  const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
  for(const part of item.parts){
   bounds.left=Math.min(bounds.left,part.left);
   bounds.top=Math.min(bounds.top,part.top);
   bounds.right=Math.max(bounds.right,part.right);
   bounds.bottom=Math.max(bounds.bottom,part.bottom);
  }
  return {item,bounds};
 });
 const point={left:x,right:x,top:y,bottom:y};
 const seeds=items.filter(({bounds})=>boundsTouch(bounds,point)).map(entry=>({
  entry,distance:entry.item.parts.reduce((min,part)=>Math.min(min,distance(part)),Infinity)
 })).filter(hit=>hit.distance<=0).sort((a,b)=>a.distance-b.distance);
 const selected=new Set(seeds.map(hit=>hit.entry));
 for(const current of selected){
  for(const entry of items){
   if(selected.has(entry)||!boundsTouch(current.bounds,entry.bounds))continue;
   if(current.item.parts.some(a=>entry.item.parts.some(b=>partsTouch(a,b))))selected.add(entry);
  }
 }
 return [...selected].map(({item})=>item);
}
