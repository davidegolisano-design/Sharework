export const editable=['title','description','color','shape','opacity','width','x','y','points','deleted'];
export function snapshot(a){return Object.fromEntries(editable.map(k=>[k,structuredClone(a[k])]));}
export function grouped(items,page,all){return items.filter(a=>!a.deleted&&(all||a.page===page)).sort((a,b)=>a.page-b.page||a.created_at.localeCompare(b.created_at));}
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function normalized(x,y,rect){return [clamp((x-rect.x)/rect.w,0,1),clamp((y-rect.y)/rect.h,0,1)];}
export function segmentDistance(x,y,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l?clamp(((x-ax)*dx+(y-ay)*dy)/l,0,1):0;return Math.hypot(x-ax-t*dx,y-ay-t*dy);}
export function contrast(hex){const n=parseInt(hex.slice(1),16);return (((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114)>150?'#152f3b':'white';}
