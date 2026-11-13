import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {getSession} from './api.js';
export function watchChanges(onChange){
 let socket,stopped=false,retry,heartbeat,ref=0,lastToken,awaiting=false;
 const topic='realtime:sharework';
 function send(event,payload={},channel=topic){if(socket?.readyState===1)socket.send(JSON.stringify({topic:channel,event,payload,ref:String(++ref)}));}
 function connect(){
  if(stopped||!getSession()?.access_token)return;
  lastToken=getSession().access_token;
  socket=new WebSocket(SUPABASE_URL.replace('https:','wss:')+'/realtime/v1/websocket?apikey='+encodeURIComponent(SUPABASE_KEY)+'&vsn=1.0.0');
  socket.onopen=()=>{
   awaiting=false;
   send('phx_join',{config:{broadcast:{self:false,ack:false},presence:{enabled:false},postgres_changes:['sw_projects','sw_documents','sw_annotations','sw_profiles'].map(table=>({event:'*',schema:'public',table}))},access_token:lastToken});
   heartbeat=setInterval(()=>{
    if(awaiting){socket.close();return;}
    const token=getSession()?.access_token;if(!token){socket.close();return;}
    if(token!==lastToken){lastToken=token;send('access_token',{access_token:token});}
    awaiting=true;send('heartbeat',{},'phoenix');
   },25000);
  };
  socket.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}
   if(message.topic==='phoenix'&&message.event==='phx_reply')awaiting=false;
   if(message.event==='postgres_changes')onChange();
   if(message.event==='phx_reply'&&message.topic===topic){if(message.payload?.status==='ok')onChange();else socket.close();}
   if(message.event==='phx_error'||message.event==='phx_close')socket.close();
  };
  socket.onerror=()=>socket.close();
  socket.onclose=()=>{clearInterval(heartbeat);if(!stopped)retry=setTimeout(connect,4000);};
 }
 connect();return ()=>{stopped=true;clearTimeout(retry);clearInterval(heartbeat);socket?.close();};
}
