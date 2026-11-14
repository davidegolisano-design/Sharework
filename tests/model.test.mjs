import test from 'node:test';import assert from 'node:assert/strict';import {grouped,normalized,segmentDistance,snapshot,touchSelection} from '../src/model.js';
test('Grouping, normalized coordinates and hit detection',()=>{
 const a=[{id:1,page:3,created_at:'a'},{id:2,page:1,created_at:'b'},{id:3,page:1,created_at:'a'},{id:4,page:1,created_at:'c',deleted:true}];
 assert.deepEqual(grouped(a,1,false).map(x=>x.id),[3,2]);assert.deepEqual(grouped(a,1,true).map(x=>x.id),[3,2,1]);
 assert.deepEqual(normalized(150,250,{x:100,y:200,w:100,h:100}),[.5,.5]);assert.equal(segmentDistance(5,5,0,0,10,0),5);
});


import {filterNotes,projectMarks,shipPageOrder,mapDeckView,longitudinalScale,placeLaser,laserOnPage,frameAt,deckReferences,workFrameRange} from '../src/ship-model.js';

test('Ship plans project a shared frame across scales and orientations',()=>{
 const overview={page:1,frame0:0,frame1:74,x0:.2,x1:.6,meters:51.06};
 const deck={page:3,frame0:0,frame1:37,x0:.75,x1:.25,meters:25.53,base:.45,name:'Ponte 2'};
 const plan={overview,decks:[deck]};
 const note={id:'a',page:3,kind:'note',x:.5,y:.8,shape:'flame',title:'Taglio',created_by:'one'};
 const [projected]=projectMarks(plan,[note]);
 assert.ok(Math.abs(projected.x-.3)<1e-9);
 assert.equal(projected.y,deck.base);
 assert.equal(projected.page,overview.page);
 assert.equal(note.page,deck.page);
 assert.equal(projected.projected,true);
 assert.deepEqual(shipPageOrder(plan,4),[1,3,2,4]);
 assert.deepEqual(filterNotes([note],{query:'TAGLIO',page:'3',kind:'flame',author:'one',day:''}),[note]);
 assert.deepEqual(filterNotes([note],{query:'TAGLIO',page:'1',kind:'flame',author:'one',day:''}),[]);
});

test('Deck switching preserves frame and screen scale across different page layouts',()=>{
 const aft={x0:.2,x1:.6,frame0:0,frame1:74,meters:51.06};
 const reversed={x0:.75,x1:.25,frame0:0,frame1:37,meters:25.53};
 const from={x:.3,width:2400};
 const next=mapDeckView(aft,reversed,from);
 assert.ok(Math.abs(next.x-.5)<1e-9);
 const width=next.pixelsPerMeter/Math.abs(longitudinalScale(reversed));
 assert.ok(Math.abs(width-960)<1e-9);
 const back=mapDeckView(reversed,aft,{x:next.x,width});
 assert.ok(Math.abs(back.x-from.x)<1e-9);
 assert.ok(Math.abs(back.pixelsPerMeter-next.pixelsPerMeter)<1e-9);
});

test('Laser follows the same ordinate across the overview and calibrated decks',()=>{
 const overview={page:1,x0:.2,x1:.6,frame0:0,frame1:74,meters:51.06};
 const deck={page:2,x0:.75,x1:.25,frame0:0,frame1:37,meters:25.53};
 const plan={overview,decks:[deck]};
 const laser=placeLaser(plan,2,[.5,.7]);
 assert.ok(Math.abs(laser.x-.3)<1e-9);
 assert.deepEqual(laserOnPage(plan,1,laser),{...laser,vertical:true});
 const marker=laserOnPage(plan,2,laser);
 assert.ok(Math.abs(marker.x-.5)<1e-9);
 assert.equal(marker.y,.7);
 assert.equal(marker.vertical,false);
 assert.equal(placeLaser(plan,1,[.5,.25],laser).y,.7);
 assert.equal(placeLaser(plan,1,[.5,.25]).y,.5);
 assert.equal(laserOnPage(plan,3,laser),null);
});

test('Overview highlights span their occupied frames even on reversed plans',()=>{
 const overview={page:1,x0:.2,x1:.6,frame0:0,frame1:74,meters:51.06};
 const deck={page:2,x0:.75,x1:.25,frame0:0,frame1:37,meters:25.53,base:.45};
 const [mark]=projectMarks({overview,decks:[deck]},[{page:2,kind:'highlight',number:18,points:[[.75,.3],[.25,.6],[.5,.1]]}]);
 assert.equal(mark.number,18);
 assert.equal(mark.kind,'highlight');
 assert.deepEqual(mark.strokes[0].map(([x,y])=>[Math.round(x*100),y]),[[20,.45],[40,.45]]);
});

test('A multi-stroke note projects separate intervals under one note identity',()=>{
 const overview={page:1,x0:.1,x1:.9,frame0:0,frame1:80,meters:80};
 const deck={...overview,page:2,base:.4};
 const note={id:'shared',page:2,kind:'note',number:3,shape:'circle',points:[],
  strokes:[[[.1,.5],[.2,.5]],[[.7,.3],[.8,.4]]]};
 const marks=projectMarks({overview,decks:[deck]},[note]);
 const [mark]=marks;
 assert.equal(marks.length,1);
 assert.deepEqual([mark.id,mark.kind,mark.shape,mark.number],['shared','note','circle',3]);
 assert.ok(mark.strokes[0][1][0]<mark.strokes[1][0][0]);
});

test('Tap selects only work directly reached by the fixed circle',()=>{
 const marker=(id,x)=>({id,distance:tapX=>Math.abs(tapX-x)-14});
 const items=[marker(1,0),marker(2,38),marker(3,76)];
 assert.deepEqual(touchSelection(items,0,0).map(item=>item.id),[1,2]);
 assert.deepEqual(touchSelection(items,40,0).map(item=>item.id),[2,3]);
 assert.deepEqual(touchSelection(items,-40,0),[]);
});

test('Areas span the requested decks and keep one icon centered on the origin deck',()=>{
 const calibration={frame0:0,frame1:74,x0:.2,x1:.6,meters:51.06};
 const plan={overview:{...calibration,page:1,top:.1},decks:[
  {...calibration,page:4,base:.3,name:'Top'},
  {...calibration,page:3,base:.5,name:'Middle'},
  {...calibration,page:2,base:.7,name:'Bottom'}
 ]};
 const note={id:1,page:3,x:.4,y:.45,decks_above:1,decks_below:1,
  regions:[[[.3,.1],[.5,.1],[.5,.2],[.3,.2]]]};
 const [projected]=projectMarks(plan,[note]);
 assert.equal(projected.y,.4);
 assert.equal(projected.regions[0][0][1],.1);
 assert.equal(projected.regions[0][2][1],.7);
 const [reference]=deckReferences(plan,[note],2);
 assert.equal(reference.id,1);
 assert.deepEqual(reference.regions,[]);
 assert.deepEqual(workFrameRange(plan.decks[1],note),[18.5,55.5]);
 assert.equal(frameAt({...calibration,x0:.6,x1:.2},.4),37);
});
