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

test('Touch lift drift does not drop a second icon at the edge of the tap circle',()=>{
 const v=Object.create(Viewer.prototype);
 const selections=[];
 Object.assign(v,{
  pointers:new Map(),pdfPage:{},pageNumber:1,draw(){},
  rect:()=>({x:0,y:0,w:1000,h:500,scale:1}),
  container:{clientWidth:1000,clientHeight:500,setPointerCapture(){},
   getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500})},
  callbacks:{edit:items=>selections.push(Array.from(items,a=>a.id))},
  marks:[{id:1,page:1,kind:'note',x:.5,y:.5},{id:2,page:1,kind:'note',x:.54,y:.5}]
 });
 const event=(clientX)=>({pointerId:1,isPrimary:true,pointerType:'touch',clientX,clientY:250,preventDefault(){}});
 v.down(event(500));v.up(event(492));
 v.down(event(500));v.move(event(460));v.up(event(460));
 assert.deepEqual(selections,[[1,2]]);
});

test('Dialog guards block the plan tap and require a fresh button press while allowing keyboard',async()=>{
 const app=await readFile('src/app.js','utf8');
 const source=app.slice(app.indexOf("const appDialog=$('dialog');"),app.indexOf('function field('));
 const listeners={};
 const appDialog={addEventListener:(type,handler)=>{listeners[type]=handler;}};
 let now=100;
 const sandbox=vm.createContext({$:id=>id==='dialog'?appDialog:{},performance:{now:()=>now}});
 vm.runInContext(source,sandbox);
 const button={}, target={closest:()=>button};
 const click=(detail,pointerId=7,pointerType='touch')=>{
  let blocked=false;
  listeners.click({detail,pointerId,pointerType,target,clientX:180,clientY:420,
   preventDefault(){blocked=true;},stopImmediatePropagation(){}});
  return blocked;
 };
 vm.runInContext('planActivation={x:180,y:420,time:100}',sandbox);
 assert.equal(click(1),true);
 listeners.pointerdown({target,pointerId:7});
 assert.equal(click(1),true);
 now=500;
 listeners.pointerdown({target,pointerId:7});
 assert.equal(click(1,8),true);
 listeners.pointerdown({target,pointerId:7});
 assert.equal(click(1),false);
 assert.equal(click(0,-1,''),false);
});

test('Switching decks with the laser off center preserves view instead of following it',async()=>{
 const app=await readFile('src/app.js','utf8');
 const source=app.slice(app.indexOf('async function page('),app.indexOf('function applyRole('));
 const origin={page:2,x0:.2,x1:.6,frame0:0,frame1:74,meters:51.06};
 const target={...origin,page:3,x0:.8,x1:.6};
 const overview={...origin,page:1};
 const centers=[];
 const viewer={pageNumber:2,
  viewCenter:()=>({x:.4,y:.65,width:1000}),
  async page(n){this.pageNumber=n;},
  centerView:(x,y,options)=>centers.push([x,y,options.width])
 };
 const {mapDeckView,longitudinalScale,laserOnPage}=await import('../src/ship-model.js');
 const context={viewer,plan:()=>({overview,decks:[origin,target]}),visiblePlanWidth:()=>830,
  mapDeckView,longitudinalScale,laserOnPage,clamp:model.clamp,
  laser:{x:.28,y:.25},areaSession:null,finishPick:null,loading:false,pdf:{numPages:3},mode(){},refreshList(){}};
 const page=vm.runInNewContext(source+'\npage',context);
 await page(3,{keepPosition:true});
 assert.ok(Math.abs(centers[0][0]-.7)<1e-12);
 assert.equal(centers[0][1],.65);
 assert.ok(Math.abs(centers[0][2]-2000)<1e-9);
 assert.equal(context.laser.x,.28);
 assert.equal(context.laser.y,.25);
});

test('An active laser stays in place when adding a note and moves again in navigation mode',()=>{
 const viewer=Object.create(Viewer.prototype);
 const positions=[],notes=[];
 const laser={x:.3,y:.6};
 Object.assign(viewer,{
  pointers:new Map(),pdfPage:{},pageNumber:1,marks:[],laser,mode:'note',settings:{note:{shape:'circle'}},
  rect:()=>({x:0,y:0,w:800,h:400,scale:1}),
  container:{clientWidth:800,clientHeight:400,setPointerCapture(){},
   getBoundingClientRect:()=>({left:0,top:0,width:800,height:400})},
  callbacks:{create:note=>notes.push(note),laser:point=>positions.push(Array.from(point))}
 });
 const event={pointerId:1,isPrimary:true,pointerType:'touch',clientX:400,clientY:200,preventDefault(){}};
 viewer.down(event);viewer.up(event);
 assert.equal(notes.length,1);
 assert.equal(notes[0].x,.5);
 assert.equal(viewer.laser,laser);
 assert.deepEqual(positions,[]);
 viewer.mode=null;
 viewer.down(event);viewer.up(event);
 assert.deepEqual(positions,[[.5,.5]]);
});
