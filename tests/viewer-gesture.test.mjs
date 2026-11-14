import polygonClipping from 'polygon-clipping';
import {rectangularRegion} from '../src/work-regions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../src/model.js';
import {emojiSymbols} from '../src/ship-model.js';

const source=(await readFile('src/viewer.js','utf8'))
 .replace(/^import .*;\n/gm,'')
 .replace(/^pdfjs\.GlobalWorkerOptions.*\n/m,'')
 .replace(/^const vendor=.*\n/m,'')
 .replace(/^export /gm,'');
const Viewer=vm.runInNewContext(source+'\nViewer',{...model,emojiSymbols,polygonClipping,rectangularRegion,Path2D:class {}});

test('The first tap after repeated pinches still opens both overlapping notes',()=>{
 const v=Object.create(Viewer.prototype);
 const hits=[];
 Object.assign(v,{
  pointers:new Map(),pdfPage:{getViewport:()=>({width:1000,height:500})},
  zoom:1,panX:0,panY:0,pageNumber:1,draw(){},
  container:{clientWidth:1000,clientHeight:500,setPointerCapture(){},
   getBoundingClientRect:()=>({left:20,top:30,width:1600,height:800})},
  callbacks:{edit:items=>hits.push(Array.from(items,a=>a.id).sort())},
  marks:[{id:1,page:1,kind:'note',x:.5,y:.5},{id:2,page:1,kind:'note',x:.52,y:.5}]
 });
 const event=(pointerId,x,y,isPrimary=false)=>({
  pointerId,isPrimary,clientX:x*1.6+20,clientY:y*1.6+30,pointerType:'touch',preventDefault(){}
 });
 const tap=()=>{
  const e=event(3,500,250,true);
  v.down(e);
  v.up(e);
 };
 tap();
 for(const ending of ['complete','dropped','canceled']){
  v.down(event(1,400,250,true));
  v.down(event(2,600,250));
  v.move(event(1,300,250,true));
  v.move(event(2,700,250));
  assert.equal(v.zoom,2);
  v.move(event(1,450,250,true));
  v.move(event(2,550,250));
  assert.equal(v.zoom,1);
  v.move(event(1,400,250,true));
  v.move(event(2,600,250));
  assert.equal(v.zoom,1);
  assert.ok(Math.abs(v.panX)<1e-9);
  if(ending==='complete')v.up(event(2,600,250));
  if(ending==='canceled')v.cancelPointer(event(2,600,250));
  v.up(event(1,400,250,true));
  tap();
 }
 assert.deepEqual(hits,[[1,2],[1,2],[1,2],[1,2]]);
});

test('Nearby icons remain in the chooser after zooming out to a panned overview',()=>{
 const v=Object.create(Viewer.prototype);
 Object.assign(v,{
  container:{clientWidth:560,clientHeight:480},
  pdfPage:{getViewport:()=>({width:2200,height:480})},
  zoom:1.15,panX:140,panY:-100,pageNumber:1,
  marks:[12,9,8,10,17].map((number,i)=>({
   id:number,number,page:1,kind:'note',shape:'triangle',projected:true,
   x:.47+[0,.003,-.038,-.046,.22][i],y:.64+ [0,-.026,-.026,-.026,0][i]
  }))
 });
 const tap=()=>{
  const rect=v.rect();
  // The lower-right edge of note 12 is farther from the neighboring icons.
  return Array.from(v.hit(rect.x+.47*rect.w+15,rect.y+.64*rect.h-9),note=>note.id).sort((a,b)=>a-b);
 };
 assert.deepEqual(tap(),[8,9,10,12]);
 v.zoom=12;
 assert.deepEqual(tap(),[12]);
 v.zoom=1.15;
 v.panX=310;
 v.panY=-140;
 assert.deepEqual(tap(),[8,9,10,12]);
});

test('Highlight selection keeps a fixed margin from the visible stroke across zoom levels',()=>{
 const v=Object.create(Viewer.prototype);
 Object.assign(v,{
  pageNumber:1,zoom:1,
  rect(){return {x:0,y:0,w:1000*this.zoom,h:500*this.zoom,scale:this.zoom};},
  marks:[{id:1,page:1,kind:'note',x:.8,y:.8,width:20,strokes:[[[.1,.1],[.3,.1]],[[.1,.6],[.3,.6]]]}]
 });
 for(const zoom of [.5,1,3,.5]){
  v.zoom=zoom;
  for(const y of [50,300]){
   assert.equal(v.hit(200*zoom,y*zoom+10*zoom+24).length,1);
   assert.equal(v.hit(200*zoom,y*zoom+10*zoom+26).length,0);
  }
 }
});

test('Clicking inside a unioned area includes its work and any nearby icon only once',()=>{
 const v=Object.create(Viewer.prototype);
 Object.assign(v,{pageNumber:1,rect:()=>({x:0,y:0,w:1000,h:500,scale:1}),marks:[
  {id:1,page:1,kind:'note',shape:'circle',x:.8,y:.8,regions:[[[.1,.1],[.4,.1],[.4,.4],[.1,.4]],[[.3,.2],[.5,.2],[.5,.5],[.3,.5]]]},
  {id:2,page:1,kind:'note',shape:'circle',x:.25,y:.25},
  {id:3,page:1,kind:'note',shape:'circle',x:.295,y:.25}
 ]});
 assert.deepEqual(Array.from(v.hit(250,125),n=>n.id).sort(),[1,2]);
 assert.deepEqual(Array.from(v.hit(450,220),n=>n.id),[1]);
});

test('An emoji glyph edge hit and a filled area open the same chooser on every input type',()=>{
 const v=Object.create(Viewer.prototype);
 const metrics={width:29,actualBoundingBoxLeft:14,actualBoundingBoxRight:14,actualBoundingBoxAscent:17,actualBoundingBoxDescent:12};
 Object.assign(v,{pageNumber:1,rect:()=>({x:0,y:0,w:1000,h:500,scale:1}),overlay:{getContext:()=>({save(){},restore(){},measureText:()=>metrics})},marks:[
  {id:1,page:1,kind:'note',shape:'flame',x:.5,y:.5},
  {id:2,page:1,kind:'note',shape:'circle',x:.8,y:.8,regions:[[[.45,.38],[.56,.38],[.56,.45],[.45,.45]]]}
 ]});
 assert.deepEqual(Array.from(v.hit(523,216),n=>n.id).sort(),[1,2]);
});

test('Overlaid flames remain separately selectable when emoji ink metrics are too small',()=>{
 const v=Object.create(Viewer.prototype);
 Object.assign(v,{
  pageNumber:1,zoom:1,panX:0,
  rect(){return {x:this.panX,y:0,w:1000*this.zoom,h:500*this.zoom,scale:this.zoom};},
  overlay:{getContext:()=>({save(){},restore(){},measureText:()=>({
   width:17,actualBoundingBoxLeft:4,actualBoundingBoxRight:4,
   actualBoundingBoxAscent:4,actualBoundingBoxDescent:4
  })})},
  marks:[
   {id:11,page:1,kind:'note',shape:'flame',number:11,x:.5,y:.5,projected:true},
   {id:12,page:1,kind:'note',shape:'flame',number:12,x:.503,y:.477,projected:true},
   {id:8,page:1,kind:'note',shape:'flame',number:8,x:.455,y:.52,projected:true}
  ]
 });
 const hit=()=>{
  const rect=v.rect();
  return Array.from(v.hit(rect.x+.503*rect.w+18,.477*rect.h-23-11.5),n=>n.id).sort((a,b)=>a-b);
 };
 assert.deepEqual(hit(),[11,12]);
 v.zoom=4;
 assert.deepEqual(hit(),[12]);
 v.zoom=1;
 v.panX=-130;
 assert.deepEqual(hit(),[11,12]);
});
