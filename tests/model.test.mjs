import test from 'node:test';import assert from 'node:assert/strict';import {grouped,normalized,segmentDistance,snapshot} from '../src/model.js';
test('Grouping, normalized coordinates and hit detection',()=>{
 const a=[{id:1,page:3,created_at:'a'},{id:2,page:1,created_at:'b'},{id:3,page:1,created_at:'a'},{id:4,page:1,created_at:'c',deleted:true}];
 assert.deepEqual(grouped(a,1,false).map(x=>x.id),[3,2]);assert.deepEqual(grouped(a,1,true).map(x=>x.id),[3,2,1]);
 assert.deepEqual(normalized(150,250,{x:100,y:200,w:100,h:100}),[.5,.5]);assert.equal(segmentDistance(5,5,0,0,10,0),5);
});


import {filterNotes,projectMarks,shipPageOrder} from '../src/ship-model.js';

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
