import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {getSession} from './api.js';
export function watchChanges(onChange,onConnection=()=>{}){
 let socket,stopped=false,retry,heartbeat,ref=0,lastToken,awaiting=false,failures=0,joinTimer;
 const topic='realtime:sharework';
 function send(event,payload={},channel=topic){
  const messageRef=String(++ref);
  if(socket?.readyState===1)socket.send(JSON.stringify({topic:channel,event,payload,ref:messageRef}));
  return messageRef;
 }
 function connect(){
  if(stopped||!getSession()?.access_token)return;
  lastToken=getSession().access_token;
  socket=new WebSocket(SUPABASE_URL.replace('https:','wss:')+'/realtime/v1/websocket?apikey='+encodeURIComponent(SUPABASE_KEY)+'&vsn=1.0.0');
  let joinRef;
  socket.onopen=()=>{
   awaiting=false;
   joinRef=send('phx_join',{config:{broadcast:{self:false,ack:false},presence:{enabled:false},postgres_changes:['sw_projects','sw_documents','sw_annotations','sw_profiles'].map(table=>({event:'*',schema:'public',table}))},access_token:lastToken});
   joinTimer=setTimeout(()=>socket.close(),12000);
   heartbeat=setInterval(()=>{
    if(awaiting){socket.close();return;}
    const token=getSession()?.access_token;if(!token){socket.close();return;}
    if(token!==lastToken){lastToken=token;send('access_token',{access_token:token});}
    awaiting=true;send('heartbeat',{},'phoenix');
   },25000);
  };
  socket.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}
   if(message.topic==='phoenix'&&message.event==='phx_reply')awaiting=false;
   if(message.event==='postgres_changes')onChange(message.payload?.data);
   if(message.event==='phx_reply'&&message.topic===topic&&message.ref===joinRef){
    clearTimeout(joinTimer);
    if(message.payload?.status==='ok'){failures=0;onConnection(true);onChange();}
    else socket.close();
   }
   if(message.event==='phx_error'||message.event==='phx_close')socket.close();
  };
  socket.onerror=()=>socket.close();
  socket.onclose=()=>{
   clearTimeout(joinTimer);
   clearInterval(heartbeat);
   if(stopped)return;
   onConnection(false);
   const delay=Math.min(60000,4000*2**Math.min(failures++,4));
   retry=setTimeout(connect,delay*(.8+Math.random()*.4));
  };
 }
 connect();return ()=>{stopped=true;clearTimeout(retry);clearTimeout(joinTimer);clearInterval(heartbeat);socket?.close();};
}
