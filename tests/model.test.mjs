import test from 'node:test';import assert from 'node:assert/strict';import {grouped,normalized,segmentDistance,snapshot} from '../src/model.js';
test('Grouping, normalized coordinates and hit detection',()=>{
 const a=[{id:1,page:3,created_at:'a'},{id:2,page:1,created_at:'b'},{id:3,page:1,created_at:'a'},{id:4,page:1,created_at:'c',deleted:true}];
 assert.deepEqual(grouped(a,1,false).map(x=>x.id),[3,2]);assert.deepEqual(grouped(a,1,true).map(x=>x.id),[3,2,1]);
 assert.deepEqual(normalized(150,250,{x:100,y:200,w:100,h:100}),[.5,.5]);assert.equal(segmentDistance(5,5,0,0,10,0),5);
});
