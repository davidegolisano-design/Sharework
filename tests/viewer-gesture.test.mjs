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
const Viewer=vm.runInNewContext(source+'\nViewer',{...model,emojiSymbols,Path2D:class {}});

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
  zoom:4,panX:140,panY:-100,pageNumber:1,
  marks:[12,9,8,10,17].map((number,i)=>({
   id:number,number,page:1,kind:'note',shape:'triangle',projected:true,
   x:.47+[0,.003,-.038,-.046,.22][i],y:.64+ [0,-.026,-.026,-.026,0][i]
  }))
 });
 const tap=()=>{
  const rect=v.rect();
  // The lower-right edge of note 12 is farther from the neighboring icons.
  return Array.from(v.hit(rect.x+.47*rect.w+15,rect.y+.64*rect.h-9,'mouse'),note=>note.id).sort((a,b)=>a-b);
 };
 assert.deepEqual(tap(),[8,9,10,12]);
 v.zoom=12;
 assert.deepEqual(tap(),[9,12]);
 v.zoom=4;
 v.panX=310;
 v.panY=-140;
 assert.deepEqual(tap(),[8,9,10,12]);
});
