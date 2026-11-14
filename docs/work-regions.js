export function rectangularRegion([ax,ay],[bx,by]){
 return [[ax,ay],[bx,ay],[bx,by],[ax,by]];
}

export function finishRegion(points){
 const ring=points.filter(([x,y],i)=>!i||Math.hypot(x-points[i-1][0],y-points[i-1][1])>1e-6);
 if(ring.length<3)return null;
 const origin=ring[0],end=ring.find(([x,y])=>Math.hypot(x-origin[0],y-origin[1])>1e-6);
 if(!end||!ring.some(([x,y])=>Math.abs((end[0]-origin[0])*(y-origin[1])-(end[1]-origin[1])*(x-origin[0]))>1e-9))return null;
 return ring;
}

export function legacyRegions(strokes,width,pageWidth,pageHeight){
 return strokes.flatMap(stroke=>{
  const xs=stroke.map(point=>point[0]),ys=stroke.map(point=>point[1]);
  return [rectangularRegion(
   [Math.max(0,Math.min(...xs)-width/pageWidth/2),Math.max(0,Math.min(...ys)-width/pageHeight/2)],
   [Math.min(1,Math.max(...xs)+width/pageWidth/2),Math.min(1,Math.max(...ys)+width/pageHeight/2)]
  )];
 });
}
