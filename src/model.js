export const editable=['title','description','color','shape','opacity','width','x','y','points','strokes','regions','decks_above','decks_below','work_start','work_end','work_status','custom_category','deleted'];
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

export function pointInRing(x,y,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[i],[bx,by]=ring[j];
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
 }
 return inside;
}

export const clickRadius=25;

export function touchSelection(candidates,x,y){
 return candidates.map(item=>({item,distance:item.distance(x,y)}))
  .filter(hit=>hit.distance<=clickRadius).sort((a,b)=>a.distance-b.distance)
  .map(({item})=>item);
}

export const normalizeSearch=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();

export function searchRanges(value,query){
 if(!query)return [];
 const ranges=[],positions=[];
 let folded='',offset=0;
 for(const segment of value.matchAll(/\P{M}\p{M}*|\p{M}+/gu)){
  const original=segment[0],part=normalizeSearch(original);
  offset=segment.index+original.length;
  for(let index=0;index<part.length;index++)positions.push([segment.index,offset]);
  folded+=part;
 }
 for(let start=folded.indexOf(query);start>=0;start=folded.indexOf(query,start+query.length)){
  ranges.push([positions[start][0],positions[start+query.length-1][1]]);
 }
 return ranges;
}
