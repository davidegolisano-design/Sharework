import {watchChanges} from './realtime.js';
import * as api from './api.js';
import {Viewer,loadPdf,marker} from './viewer.js';
import {snapshot,grouped,clamp} from './model.js';
import {filterNotes,noteShapes,projectMarks,shipPageOrder} from './ship-model.js';
import {editShipPlan} from './ship-editor.js';
const $=id=>document.getElementById(id),screens=['auth','waiting','projects','documents','workspace'];
let stopRealtime=null,refreshTimer;
let user,profile,projects=[],project,documents=[],activeDocument,annotations=[],pdf,authMode='login',dialogClose=null,dialogOpen=false,polling=false,epoch=0;
let all=localStorage.getItem('sw.all')==='true',panelWidth=Number(localStorage.getItem('sw.panelWidth'))||290,panelHidden=false,undo=[],redo=[],loading=false;
const roles = {super_admin:'Super admin', admin:'Admin', member:'Utente', viewer:'Visualizzatore'};
const canWrite = () => profile?.approved && ['super_admin','admin','member'].includes(profile.role);
const canConfigure = () => profile?.approved && ['super_admin','admin'].includes(profile.role);
const plan = () => activeDocument?.ship_plan;
const isOverview = () => plan()?.overview.page === viewer.pageNumber;
const canPlace = () => canWrite() && (!plan() || plan().decks.some(deck=>deck.page===viewer.pageNumber));
const pageName = n => plan()?.overview.page===n ? 'General Overview' : plan()?.decks.find(deck=>deck.page===n)?.name || 'Pagina '+n;
const filterIds = ['notes-query','notes-page','notes-kind','notes-author','notes-day'];
let finishPick = null;
const viewer=new Viewer($('viewport'),$('pdf-canvas'),$('marks-canvas'),{create:a=>makeAnnotation(a).catch(report),edit:a=>openAnnotation(a).catch(report),error:report});
try{Object.assign(viewer.settings,JSON.parse(localStorage.getItem('sw.tools')||'{}'));}catch{}
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
function btn(label,action,cls){const b=text('button',label,cls);b.type='button';b.onclick=()=>Promise.resolve().then(action).catch(report);return b;}
function report(e){toast(e?.message||String(e));}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function screen(name){screens.forEach(id=>$(id).hidden=id!==name);}
function status(value){$('sync-state').textContent=value;}
function date(value){return new Date(value).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'});}
function mode(value){viewer.mode=canPlace()&&!finishPick&&viewer.mode!==value?value:null;$('note-tool').classList.toggle('active',viewer.mode==='note');$('highlight-tool').classList.toggle('active',viewer.mode==='highlight');}
function modal(title,onClose=null){if($('dialog').open)throw Error('Chiudi prima la finestra aperta.');dialogOpen=true;dialogClose=onClose;$('dialog-title').textContent=title;$('dialog-body').replaceChildren();$('dialog-footer').replaceChildren();$('dialog').showModal();return $('dialog-body');}
async function closeModal(){if(dialogClose&&await dialogClose()===false)return;dialogClose=null;dialogOpen=false;$('dialog').close();queueRefresh();}
$('dialog-close').onclick=()=>closeModal().catch(report);$('dialog').addEventListener('cancel',e=>{e.preventDefault();closeModal().catch(report);});$('dialog-form').onsubmit=e=>e.preventDefault();
function field(parent,title,{value='',type='text',multiline=false,min,max,step}={}){const label=text('label',title),input=document.createElement(multiline?'textarea':'input');if(!multiline)input.type=type;input.value=value;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;label.append(input);parent.append(label);return input;}
function setAuthMode(value){authMode=value;$('name-field').hidden=value!=='signup';$('full-name').required=value==='signup';$('signup-hint').hidden=value!=='signup';$('password').autocomplete=value==='signup'?'new-password':'current-password';$('auth-title').textContent=value==='signup'?'Crea il tuo account':'Accedi al tuo spazio';$('auth-submit').textContent=value==='signup'?'Registrati →':'Accedi →';$('login-tab').classList.toggle('selected',value==='login');$('signup-tab').classList.toggle('selected',value==='signup');$('auth-error').textContent='';}
$('login-tab').onclick=()=>setAuthMode('login');$('signup-tab').onclick=()=>setAuthMode('signup');
$('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';try{if(authMode==='signup'){await api.signUp($('email').value.trim(),$('password').value,$('full-name').value.trim());if(!api.getSession()){$('auth-error').textContent='Controlla la tua email per confermare la registrazione. Poi accedi per verificare l’approvazione.';$('password').value='';return;}}else await api.signIn($('email').value.trim(),$('password').value);$('password').value='';await restore();}catch(e){$('auth-error').textContent=e.message;}finally{$('auth-submit').disabled=false;}};
$('reset-password').onclick=async()=>{const email=$('email').value.trim();if(!email||!$('email').checkValidity()){toast('Inserisci la tua email.');return;}try{await api.request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:{email},anonymous:true});toast('Se l’account esiste, riceverai il link per reimpostare la password.');}catch(e){report(e);}};
async function restore(){if(!api.getSession()){stopRealtime?.();stopRealtime=null;screen('auth');return;}try{user=await api.request('/auth/v1/user');const rows=await api.table('sw_profiles','id=eq.'+user.id+'&select=*');profile=rows[0];stopRealtime?.();stopRealtime=watchChanges(queueRefresh);if(!profile)throw Error('Profilo non disponibile. La configurazione del database deve essere completata.');if(!profile.approved){screen('waiting');return;}document.querySelectorAll('.user-name').forEach(el=>el.textContent=profile.full_name);applyRole();await showProjects();}catch(e){screen('auth');$('auth-error').textContent=e.message;}}
async function logout(){cancelPick();if(dialogOpen&&!await tryClose())return;stopRealtime?.();stopRealtime=null;epoch++;project=null;activeDocument=null;viewer.clear();await pdf?.destroy();pdf=null;await api.signOut();profile=user=null;annotations=[];projects=[];screen('auth');}
async function tryClose(){await closeModal();return !dialogOpen;}
document.querySelectorAll('.logout').forEach(b=>b.onclick=()=>logout().catch(report));$('check-approval').onclick=()=>restore().catch(report);
async function showProjects(){epoch++;project=null;activeDocument=null;viewer.clear();await pdf?.destroy();pdf=null;undo=[];redo=[];screen('projects');$('project-list').replaceChildren(text('div','Caricamento…','empty'));projects=await api.table('sw_projects','select=*&order=created_at.desc');renderProjects();}
function renderProjects(){const q=$('search').value.toLowerCase(),list=projects.filter(p=>p.title.toLowerCase().includes(q));$('project-count').textContent=list.length+' progetti';$('project-list').replaceChildren();for(const p of list){const card=btn('',()=>showDocuments(p),'project-card');const cover=text('div','','cover');cover.append(text('span','PDF','pdf-icon'),text('span','Progetto condiviso'));card.append(cover,text('h3',p.title),text('p',new Date(p.created_at).toLocaleDateString('it-IT')));$('project-list').append(card);}if(!list.length)$('project-list').append(text('div','Nessun progetto','empty'));}
$('search').oninput=renderProjects;$('back-projects').onclick=()=>showDocuments(project).catch(report);$('documents-back').onclick=()=>showProjects().catch(report);
$('new-project').onclick=()=>{if(!canWrite())return;const box=modal('Nuovo progetto'),title=field(box,'Nome progetto');$('dialog-footer').append(btn('Crea progetto',async()=>{if(!title.value.trim())throw Error('Inserisci il nome del progetto.');const [p]=await api.table('sw_projects','',{method:'POST',body:{title:title.value.trim()}});await closeModal();await showDocuments(p);},'primary'));};
async function showDocuments(p){cancelPick();epoch++;activeDocument=null;viewer.clear();await pdf?.destroy();pdf=null;project=p;undo=[];redo=[];screen('documents');$('documents-title').textContent=p.title;$('document-grid').replaceChildren(text('div','Caricamento…','empty'));documents=await api.table('sw_documents','project_id=eq.'+p.id+'&select=*&order=created_at.desc');renderDocuments();}
function renderDocuments(){$('document-grid').replaceChildren();for(const d of documents){const card=btn('',()=>openDocument(d),'project-card'),cover=text('div','','cover');cover.append(text('span','PDF','pdf-icon'),text('span',(d.ship_plan?'Piani nave · ':'')+d.page_count+' pagine'));card.append(cover,text('h3',d.title),text('p',d.file_name));$('document-grid').append(card);}if(!documents.length)$('document-grid').append(text('div','Nessun documento','empty'));}
$('add-document').onclick=()=>{if(!canWrite())return;const box=modal('Aggiungi documento'),title=field(box,'Titolo documento'),file=field(box,'PDF · massimo 50 MB',{type:'file'});file.accept='.pdf,application/pdf';file.onchange=()=>{if(!title.value&&file.files[0])title.value=file.files[0].name.replace(/\.pdf$/i,'');};const submit=btn('Importa PDF',async()=>{const chosen=file.files[0];if(!title.value.trim()||!chosen)throw Error('Inserisci il titolo e scegli un PDF.');if(chosen.size>50000000)throw Error('Il PDF supera 50 MB.');submit.disabled=true;dialogClose=()=>false;let path,uploaded=false;try{const doc=await loadPdf(new Uint8Array(await chosen.arrayBuffer()));const count=doc.numPages;await doc.destroy();path=user.id+'/'+crypto.randomUUID()+'.pdf';await api.pdfUpload(path,chosen);uploaded=true;const [d]=await api.table('sw_documents','',{method:'POST',body:{project_id:project.id,title:title.value.trim(),file_name:chosen.name,file_path:path,page_count:count}});uploaded=false;dialogClose=null;await closeModal();await openDocument(d);}catch(e){if(uploaded)try{await api.pdfCleanup(path);}catch{}throw e;}finally{submit.disabled=false;dialogClose=null;}},'primary');$('dialog-footer').append(submit);};

async function openDocument(p){const token=++epoch;loading=true;activeDocument=p;annotations=[];undo=[];redo=[];viewer.clear();screen('workspace');$('document-title').textContent=p.title;status('Apertura…');applyPanel();try{const [blob,rows]=await Promise.all([api.pdfDownload(p.file_path),api.table('sw_annotations','document_id=eq.'+p.id+'&select=*&order=created_at.asc')]);if(token!==epoch)return;await pdf?.destroy();pdf=await loadPdf(new Uint8Array(await blob.arrayBuffer()));if(token!==epoch){await pdf.destroy();return;}annotations=rows;await viewer.open(pdf,plan()?.overview.page||1);
for(const id of filterIds) $(id).value='';
if(matchMedia('(max-height:550px) and (max-width:1000px) and (orientation:landscape)').matches){panelHidden=true;applyPanel();}
refreshList();status('');}finally{loading=false;}}
async function page(n){if(finishPick||loading||!pdf||n<1||n>pdf.numPages||n===viewer.pageNumber)return;loading=true;try{mode(null);await viewer.page(n);refreshList();}finally{loading=false;}}
function applyRole(){
 $('users-button').hidden=profile?.role!=='super_admin';
 $('new-project').hidden=$('add-document').hidden=!canWrite();
}

function selectOptions(select,options){
 const value=select.value;
 if(select.options.length===options.length && options.every(([key,label],i)=>select.options[i].value===String(key) && select.options[i].textContent===label)) return;
 select.replaceChildren(...options.map(([key,label])=>new Option(label,key)));
 if(options.some(([key])=>String(key)===value)) select.value=value;
}

function updatePages(){
 const current=viewer.pageNumber;
 $('page-label').textContent=current+' / '+(pdf?.numPages||1);
 $('undo').disabled=!canWrite()||!!finishPick||!undo.length;
 $('redo').disabled=!canWrite()||!!finishPick||!redo.length;
 $('ship-settings').hidden=!canConfigure()||!pdf||pdf.numPages<2;
 for(const id of ['note-tool','note-settings','highlight-tool','highlight-settings']) $(id).disabled=!canPlace()||!!finishPick;
 if(!canPlace()||finishPick) mode(null);
 $('ship-pages').hidden=!plan();
 $('ship-pages').disabled=!!finishPick;
 if(plan()){
  selectOptions($('ship-pages'),shipPageOrder(plan(),pdf.numPages).map(n=>[n,pageName(n)]));
  $('ship-pages').value=current;
 }
}
function advancePage(delta){
 const order=shipPageOrder(plan(),pdf?.numPages||0);
 return page(order[order.indexOf(viewer.pageNumber)+delta]||0);
}
$('ship-pages').onchange=()=>page(Number($('ship-pages').value)).catch(report);

function cancelPick(){
 finishPick=null;
 viewer.pick=null;
 viewer.guide=null;
 $('pick-banner').hidden=true;
}
async function pickPlanPoint(target,label,existing,axis,onPick){
 await page(target);
 if(viewer.pageNumber!==target) throw Error('Impossibile aprire la pagina da calibrare.');
 mode(null);
 finishPick=(point)=>{
  cancelPick();
  refreshList();
  if(onPick) Promise.resolve().then(()=>onPick(point)).catch(report);
 };
 viewer.pick=point=>finishPick?.(point);
 viewer.guide=Number.isFinite(existing)?[existing,axis]:null;
 $('pick-label').textContent=label+' · pagina '+target+' · tocca il disegno';
 $('pick-banner').hidden=false;
 viewer.draw(false);
 updatePages();
}
$('pick-cancel').onclick=()=>finishPick?.(null);
$('ship-settings').onclick=()=>{
 if(!canConfigure()||!pdf||loading||finishPick) return;
 const document=activeDocument;
 editShipPlan({
  document,currentPage:viewer.pageNumber,modal,closeModal,footer:$('dialog-footer'),field,btn,text,pick:pickPlanPoint,
  async save(shipPlan){
   const [updated]=await api.table('sw_documents','id=eq.'+document.id,{method:'PATCH',body:{ship_plan:shipPlan}});
   if(!updated) throw Error('Configurazione non salvata.');
   activeDocument=updated;
   await closeModal();
   if(shipPlan) await page(shipPlan.overview.page);
   refreshList();
   toast(shipPlan?'Piani nave salvati.':'Visualizzazione PDF standard ripristinata.');
  }
 });
};
function pagePicker(){if(!pdf||loading||finishPick)return;const box=modal('Vai alla pagina'),number=field(box,'Pagina / '+pdf.numPages,{type:'number',value:viewer.pageNumber,min:1,max:pdf.numPages,step:1}),range=field(box,'',{type:'range',value:viewer.pageNumber,min:1,max:pdf.numPages,step:1});range.oninput=()=>number.value=range.value;number.oninput=()=>range.value=number.value;$('dialog-footer').append(btn('Vai',async()=>{const n=Number(number.value);if(!Number.isInteger(n)||n<1||n>pdf.numPages)throw Error('Numero pagina non valido.');await closeModal();await page(n);},'primary'));}
for(const [id,delta] of [['prev',-1],['next',1]]){let timer,long=false;$(id).onpointerdown=()=>{long=false;timer=setTimeout(()=>{long=true;pagePicker();},550);};$(id).onpointerup=$(id).onpointerleave=$(id).onpointercancel=()=>clearTimeout(timer);$(id).onclick=()=>{if(!long)advancePage(delta).catch(report);};$(id).oncontextmenu=e=>e.preventDefault();}
$('page-label').onclick=pagePicker;$('fit').onclick=()=>viewer.fit();$('note-tool').onclick=()=>mode('note');$('highlight-tool').onclick=()=>mode('highlight');
function applyPanel(){const available=$('workspace-body').clientWidth;const width=clamp(panelWidth,160,Math.max(160,available-180));$('notes-panel').hidden=panelHidden;$('notes-panel').style.width=width+'px';$('workspace-body').style.setProperty('--notes-width',width+'px');$('panel-toggle').setAttribute('aria-expanded',String(!panelHidden));$('panel-toggle').textContent=panelHidden?'◂':'▸';}
$('panel-toggle').onclick=()=>{panelHidden=!panelHidden;applyPanel();};let resizeStart;
$('divider').onpointerdown=e=>{if(e.target===$('panel-toggle')||panelHidden)return;e.preventDefault();$('divider').setPointerCapture(e.pointerId);resizeStart={x:e.clientX,width:$('notes-panel').offsetWidth};};$('divider').onpointermove=e=>{if(resizeStart){panelWidth=clamp(resizeStart.width+resizeStart.x-e.clientX,160,Math.max(160,$('workspace-body').clientWidth-180));applyPanel();}};$('divider').onpointerup=$('divider').onpointercancel=()=>{if(resizeStart)localStorage.setItem('sw.panelWidth',panelWidth);resizeStart=null;};$('divider').onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();panelWidth+=e.key==='ArrowLeft'?15:-15;applyPanel();localStorage.setItem('sw.panelWidth',panelWidth);}};
window.addEventListener('resize',applyPanel);$('toolbar-toggle').onclick=()=>{$('toolbar').hidden=!$('toolbar').hidden;$('toolbar-toggle').textContent=$('toolbar').hidden?'▾':'▴';};
function setFilter(value){all=value;localStorage.setItem('sw.all',all);refreshList();}$('filter-page').onclick=()=>setFilter(false);$('filter-all').onclick=()=>setFilter(true);
function badge(a){const c=document.createElement('canvas');c.className='badge';c.width=c.height=70;const ctx=c.getContext('2d');ctx.scale(2,2);if(a.kind==='note')marker(ctx,17.5,17.5,a.color,a.shape,a.number,12);else{ctx.strokeStyle=a.color;ctx.globalAlpha=a.opacity/100;ctx.lineWidth=10;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(6,17);ctx.lineTo(29,17);ctx.stroke();}return c;}
for(const id of filterIds) $(id).oninput=refreshList;
$('notes-reset').onclick=()=>{
 for(const id of filterIds) $(id).value='';
 refreshList();
};

function refreshList(){
 if(!activeDocument||!pdf) return;
 const overview=isOverview();
 const order=shipPageOrder(plan(),pdf.numPages);
 selectOptions($('notes-page'),[['','Tutte'],...order.map(n=>[n,pageName(n)])]);
 selectOptions($('notes-kind'),[['','Tutti'],...noteShapes,['highlight','Evidenziazione']]);
 const authors=new Map(annotations.filter(a=>!a.deleted).map(a=>[a.created_by,a.author_name]));
 selectOptions($('notes-author'),[['','Tutti'],...[...authors].sort((a,b)=>a[1].localeCompare(b[1],'it'))]);
 const [query,pageFilter,kind,author,day]=filterIds.map(id=>$(id).value);
 const filtered=filterNotes(annotations,{query,page:pageFilter,kind,author,day});
 const projected=overview?projectMarks(plan(),filtered):[];
 const marks=overview?[...filtered.filter(a=>a.page===viewer.pageNumber),...projected]:filtered;
 viewer.setMarks(marks);
 const projectedIds=new Set(projected.map(a=>a.id));
 const showAll=all||!!pageFilter;
 const list=overview&&!showAll
  ? grouped(filtered.filter(a=>projectedIds.has(a.id)||a.page===viewer.pageNumber),viewer.pageNumber,true)
  : grouped(filtered,viewer.pageNumber,showAll);
 if(plan())list.sort((a,b)=>order.indexOf(a.page)-order.indexOf(b.page));
 $('filter-page').textContent=overview?'Overview':'Pagina';
 $('filter-page').classList.toggle('selected',!showAll);
 $('filter-all').classList.toggle('selected',showAll);
 $('notes-list').replaceChildren();
 let previous=-1;
 for(const a of list){
  if((showAll||overview)&&a.page!==previous){
   $('notes-list').append(text('div',pageName(a.page),'page-group'));
   previous=a.page;
  }
  const row=text('div','','annotation'),open=btn('',()=>openAnnotation(a),'annotation-open');
  open.append(text('span',a.title||(a.kind==='note'?'Nota '+a.number:'Evidenziazione'),'annotation-title'));
  if(a.description)open.append(text('span',a.description,'annotation-description'));
  open.append(text('span',a.author_name+' · '+date(a.created_at),'annotation-author'));
  const b=badge(a);
  b.onclick=()=>openAnnotation(a).catch(report);
  row.append(b,open);
  if(canWrite())row.append(btn('⋮',()=>annotationMenu(a),'more'));
  $('notes-list').append(row);
 }
 if(!list.length)$('notes-list').append(text('div','Nessuna annotazione','empty'));
 updatePages();
}
function merge(a){
 const i=annotations.findIndex(x=>x.id===a.id);
 if(i<0)annotations.push(a);else annotations[i]=a;
 refreshList();
}
async function patch(a,values){if(!canWrite())throw Error('Accesso in sola lettura.');const rows=await api.table('sw_annotations','id=eq.'+a.id+'&version=eq.'+a.version,{method:'PATCH',body:values});if(!rows?.length)throw Error('Questa annotazione è stata modificata da un altro utente. Le tue modifiche non sono state sovrascritte: copia il testo e riapri la nota aggiornata.');merge(rows[0]);return rows[0];}
function record(before,after){if(before&&JSON.stringify(snapshot(before))===JSON.stringify(snapshot(after)))return;undo.push({id:after.id,before:before?snapshot(before):{...snapshot(after),deleted:true},after:snapshot(after),expected:after.version});if(undo.length>40)undo.shift();redo=[];updatePages();}
async function makeAnnotation(values){if(loading||dialogOpen||finishPick||!project||!canPlace())return;loading=true;try{const [a]=await api.table('sw_annotations','',{method:'POST',body:{...values,project_id:project.id,document_id:activeDocument.id,page:viewer.pageNumber,title:values.kind==='note'?'Nota':'Evidenziazione',description:''}});merge(a);await openAnnotation(a,null);}finally{loading=false;}}
async function openAnnotation(initial,before=initial){
 if(dialogOpen||finishPick)return;
 let current=annotations.find(a=>a.id===initial.id);
 if(!current||current.deleted)return;
 if(before)before=current;
 if(!isOverview()&&current.page!==viewer.pageNumber){
  await page(current.page);
  if(current.page!==viewer.pageNumber)return;
 }
 const writable=canWrite();
 let timer,chain=Promise.resolve(),failed=false;
 const box=modal(current.kind==='note'?'Nota '+current.number:'Evidenziazione',writable?async()=>{
  clearTimeout(timer);
  await flush();
  if(failed)return false;
  record(before,current);
  return true;
 }:null);
 box.append(text('div',current.author_name+' · '+date(current.created_at),'author-detail'));
 const title=field(box,'Titolo',{value:current.title}),description=field(box,'Descrizione',{value:current.description,multiline:true});
 title.maxLength=250;
 description.maxLength=20000;
 title.readOnly=description.readOnly=!writable;
 function flush(){
  const values={title:title.value,description:description.value};
  chain=chain.then(async()=>{
   if(values.title===current.title&&values.description===current.description){failed=false;return;}
   status('Salvataggio…');
   try{current=await patch(current,values);failed=false;status('Salvato');}
   catch(e){failed=true;status('Non salvato');report(e);}
  });
  return chain;
 }
 if(writable){
  for(const el of [title,description])el.oninput=()=>{clearTimeout(timer);timer=setTimeout(flush,500);};
  $('dialog-footer').append(btn('Aspetto',async()=>{
   await closeModal();
   if(!dialogOpen)await toolSettings(current.kind,current);
  }));
 }
 if(writable&&current.kind==='note'&&current.page===viewer.pageNumber&&canPlace()){
  $('dialog-footer').append(btn('Sposta punto',async()=>{
   await closeModal();
   if(dialogOpen)return;
   await pickPlanPoint(current.page,'Nuova posizione della nota',null,0,async point=>{
    if(!point)return;
    const after=await patch(current,{x:point[0],y:point[1]});
    record(current,after);
   });
  }));
 }
 if(current.page!==viewer.pageNumber)$('dialog-footer').append(btn('Apri '+pageName(current.page),async()=>{
  await closeModal();
  if(!dialogOpen)await page(current.page);
 }));
 $('dialog-footer').append(btn('Chiudi',closeModal));
}
async function annotationMenu(a){if(!canWrite()||finishPick)return;const box=modal(a.kind==='note'?'Nota '+a.number:'Evidenziazione');box.append(btn('Impostazioni aspetto',async()=>{await closeModal();await toolSettings(a.kind,a);}));box.append(btn('Elimina',async()=>{if(!confirm('Eliminare questa annotazione?'))return;const next=await patch(a,{deleted:true});record(a,next);await closeModal();}));}
async function toolSettings(kind,existing=null){if(!canWrite()||finishPick||(!existing&&!canPlace()))return;const initial=existing?structuredClone(existing):structuredClone(viewer.settings[kind]);let choice={...initial},current=existing;const box=modal(kind==='note'?'Impostazioni nota':'Impostazioni evidenziatore');const canvas=document.createElement('canvas');canvas.className='settings-preview';canvas.width=430;canvas.height=65;box.append(canvas);const preview=()=>{const c=canvas.getContext('2d');c.clearRect(0,0,430,65);if(kind==='note')marker(c,215,32,choice.color,choice.shape,existing?.number||1);else{c.strokeStyle=choice.color;c.globalAlpha=choice.opacity/100;c.lineWidth=choice.width;c.lineCap='round';c.beginPath();c.moveTo(40,32);c.lineTo(390,32);c.stroke();c.globalAlpha=1;}};const color=field(box,'Colore',{type:'color',value:choice.color});color.oninput=()=>{choice.color=color.value;preview();};if(kind==='note'){const label=text('label','Forma'),select=document.createElement('select');for(const [v,t] of noteShapes){const option=text('option',t);option.value=v;select.append(option);}select.value=choice.shape;select.onchange=()=>{choice.shape=select.value;preview();};label.append(select);box.append(label);}else{const width=field(box,'Spessore: '+choice.width,{type:'range',value:choice.width,min:2,max:60,step:1});width.oninput=()=>{choice.width=Number(width.value);width.parentElement.firstChild.textContent='Spessore: '+choice.width;preview();};const alpha=field(box,'Trasparenza: '+(100-choice.opacity)+'%',{type:'range',value:100-choice.opacity,min:0,max:100,step:1});alpha.oninput=()=>{choice.opacity=100-Number(alpha.value);alpha.parentElement.firstChild.textContent='Trasparenza: '+alpha.value+'%';preview();};}preview();$('dialog-footer').append(btn('Applica',async()=>{const changes=kind==='note'?{color:choice.color,shape:choice.shape}:{color:choice.color,width:choice.width,opacity:choice.opacity};if(existing){const after=await patch(current,changes);record(existing,after);}else{viewer.settings[kind]={...viewer.settings[kind],...changes};localStorage.setItem('sw.tools',JSON.stringify(viewer.settings));}await closeModal();},'primary'));}
$('note-settings').onclick=()=>toolSettings('note').catch(report);$('highlight-settings').onclick=()=>toolSettings('highlight').catch(report);
async function travel(isRedo){if(!canWrite()||finishPick)return;const from=isRedo?redo:undo,to=isRedo?undo:redo,item=from.at(-1);if(!item||loading)return;const current=annotations.find(a=>a.id===item.id);if(!current||current.version!==item.expected)throw Error('Annotazione aggiornata da un altro utente: impossibile annullare senza sovrascriverla.');const result=await patch(current,isRedo?item.after:item.before);from.pop();to.push({...item,expected:result.version});const previous=from.findLast(entry=>entry.id===item.id);if(previous&&JSON.stringify(snapshot(result))===JSON.stringify(isRedo?previous.before:previous.after))previous.expected=result.version;updatePages();}
$('undo').onclick=()=>travel(false).catch(report);$('redo').onclick=()=>travel(true).catch(report);
$('users-button').onclick=()=>manageUsers().catch(report);
async function manageUsers(){
 if(profile?.role!=='super_admin')return;
 const box=modal('Utenti');
 const rows=await api.table('sw_profiles','select=*&order=created_at.desc');
 if(!box.isConnected||!dialogOpen)return;
 for(const p of rows){
  const row=text('div','','user-row'),name=text('span',p.full_name);
  name.append(text('small',roles[p.role]+' · '+(p.approved?'Abilitato':'In attesa')));
  row.append(name);
  if(p.id!==user.id){
   const role=document.createElement('select');
   role.setAttribute('aria-label','Ruolo di '+p.full_name);
   role.append(...Object.entries(roles).map(([key,label])=>new Option(label,key)));
   role.value=p.role;
   role.onchange=async()=>{
    const newRole=role.value;
    if(!confirm('Assegnare il ruolo '+roles[newRole]+' a '+p.full_name+'?')){role.value=p.role;return;}
    role.disabled=true;
    try{await api.rpc('sw_set_role',{target:p.id,new_role:newRole});await closeModal();await manageUsers();}
    catch(e){role.value=p.role;report(e);}finally{role.disabled=false;}
   };
   row.append(role,btn(p.approved?'Disabilita':'Approva',async()=>{
    await api.rpc('sw_set_approval',{target:p.id,allow_access:!p.approved});
    await closeModal();
    await manageUsers();
   },p.approved?'':'primary'));
  }
  box.append(row);
 }
}
function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(syncVisible,180);}
async function syncVisible(){
 if(polling||loading||dialogOpen||finishPick||document.hidden||!api.getSession()||!user)return;
 polling=true;const token=epoch;
 try{
  const [mine]=await api.table('sw_profiles','id=eq.'+user.id+'&select=*');
  if(token!==epoch)return;
  const wasApproved=profile?.approved;profile=mine;applyRole();
  if(!mine?.approved){epoch++;project=null;activeDocument=null;annotations=[];projects=[];documents=[];viewer.clear();await pdf?.destroy();pdf=null;screen('waiting');return;}
  if(!wasApproved){await restore();return;}
  if(!$('projects').hidden){const rows=await api.table('sw_projects','select=*&order=created_at.desc');if(token===epoch){projects=rows;renderProjects();}}
  else if(!$('documents').hidden&&project){const rows=await api.table('sw_documents','project_id=eq.'+project.id+'&select=*&order=created_at.desc');if(token===epoch){documents=rows;renderDocuments();}}
  else if(activeDocument){
   const id=activeDocument.id;
   const [[updated],rows]=await Promise.all([
    api.table('sw_documents','id=eq.'+id+'&select=*'),
    api.table('sw_annotations','document_id=eq.'+id+'&select=*&order=created_at.asc')
   ]);
   if(token===epoch&&updated&&!dialogOpen&&!finishPick){activeDocument=updated;annotations=rows;refreshList();status('Sincronizzato');}
  }
 }catch(e){status('Riconnessione…');}finally{polling=false;}
}
setInterval(syncVisible,10000);
window.addEventListener('online',queueRefresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueRefresh();});
window.addEventListener('offline',()=>toast('Connessione assente. Le nuove modifiche richiedono Internet.'));
window.addEventListener('beforeunload',e=>{if(dialogOpen){e.preventDefault();e.returnValue='';}});
try{const callback=api.authCallback();if(callback==='recovery'){screen('auth');const box=modal('Nuova password'),password=field(box,'Password (almeno 10 caratteri)',{type:'password'});$('dialog-footer').append(btn('Aggiorna',async()=>{if(password.value.length<10)throw Error('Usa almeno 10 caratteri.');await api.request('/auth/v1/user',{method:'PUT',body:{password:password.value}});await closeModal();await restore();},'primary'));}else await restore();}catch(e){$('auth-error').textContent=e.message;}
