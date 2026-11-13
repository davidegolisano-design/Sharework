let installEvent;
const buttons=[];
const standalone=matchMedia('(display-mode: standalone)');
for(const parent of [document.querySelector('#auth-form'),...document.querySelectorAll('.project-header .header-actions')]){
 const button=document.createElement('button');button.type='button';button.textContent='Installa app';
 button.className='text-button';button.hidden=standalone.matches;
 button.onclick=async()=>{
  if(!installEvent){alert('Apri questo sito in Microsoft Edge o Google Chrome. Nel menu del browser scegli Installa Sharework / Installa sito come app.');return;}
  const event=installEvent;installEvent=null;await event.prompt();await event.userChoice;
 };
 parent.append(button);buttons.push(button);
}
addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;});
addEventListener('appinstalled',()=>{installEvent=null;for(const b of buttons)b.hidden=true;});
standalone.addEventListener('change',()=>{for(const b of buttons)b.hidden=standalone.matches;});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
