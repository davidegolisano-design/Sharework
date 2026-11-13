import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
test('Realtime authenticated subscription, event delivery, token rotation and stop',async()=>{
 let session={access_token:'first'},interval,timeout,updates=0;const instances=[];
 class Socket{constructor(){this.readyState=1;this.sent=[];instances.push(this);}send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}}
 const ctx=vm.createContext({WebSocket:Socket,SUPABASE_URL:'https://example.test',SUPABASE_KEY:'public',getSession:()=>session,setInterval:fn=>(interval=fn,1),clearInterval:()=>{},setTimeout:fn=>(timeout=fn,1),clearTimeout:()=>{},encodeURIComponent});
 const source=(await readFile('src/realtime.js','utf8')).replace(/^import .*;\n/gm,'').replace('export function','function');vm.runInContext(source,ctx);
 const stop=ctx.watchChanges(()=>updates++),socket=instances[0];socket.onopen();
 assert.equal(socket.sent[0].payload.access_token,'first');assert.equal(socket.sent[0].payload.config.postgres_changes.length,4);
 socket.onmessage({data:JSON.stringify({event:'postgres_changes',payload:{}})});assert.equal(updates,1);
 session={access_token:'renewed'};interval();assert.equal(socket.sent.at(-2).event,'access_token');assert.equal(socket.sent.at(-2).payload.access_token,'renewed');
 socket.onmessage({data:JSON.stringify({event:'phx_reply',topic:'phoenix'})});interval();assert.equal(socket.readyState,1);
 stop();assert.equal(socket.readyState,3);assert.equal(timeout,undefined);
});
test('PWA assets resolve under GitHub repository path',async()=>{
 const manifest=JSON.parse(await readFile('src/manifest.webmanifest','utf8'));
 const base='https://example.test/Sharework/';assert.equal(new URL(manifest.start_url,base).pathname,'/Sharework/');
 for(const icon of manifest.icons){const b=await readFile('src/'+icon.src);assert.equal(b.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
});
