import {workStates,workState,localDateTime} from './work-schedule.js';
import {tr, locale, setLanguage, registerStatic, translateStatic} from './locale.js';
import {projectCover} from './cards.js';
import {watchChanges} from './realtime.js';
import * as api from './api.js';
import {Viewer,loadPdf,marker,drawLaser} from './viewer.js';
import {snapshot,grouped,clamp,annotationStrokes,normalizeSearch,searchRanges} from './model.js';
import {filterNotes,noteShapes,noteCategory,geometricSymbols,workCategories,setWorkCatalog,categoryLabel,projectMarks,shipPageOrder,emojiSymbols,longitudinalScale,mapDeckView,deckReferences,frameAt,workFrameRange,placeLaser,laserOnPage} from './ship-model.js';
import {finishRegion,legacyRegions} from './work-regions.js';
import {editShipPlan} from './ship-editor.js';
const $=id=>document.getElementById(id),screens=['auth','waiting','projects','documents','workspace','ship-setup'];
let stopRealtime=null,refreshTimer,realtimeConnected=false,lastSafetyCheck=0,annotationRevision=0;
const pendingSync=new Set();
const idleLimit=30*60*1000,idleKey='sharework.lastActivity';
let idleTimer;
let user,profile,projects=[],project,projectLevel,activeDocument,annotations=[],pdf,authMode='login',dialogClose=null,dialogOpen=false,polling=false,epoch=0;
let all=localStorage.getItem('sw.all')==='true',panelWidth=Number(localStorage.getItem('sw.panelWidth'))||290,panelHidden=false,undo=[],redo=[],loading=false;
const roles = {super_admin:'Super admin', admin:'Admin', member:'Utente', viewer:'Visualizzatore'};
const canManage = () => profile?.approved && ['super_admin','admin'].includes(profile.role);
const canExportWorks = () => Boolean(profile?.approved && ['member','admin','super_admin'].includes(profile.role));
const canWrite = () => profile?.approved && projectLevel==='edit';
const canConfigure = () => profile?.approved && profile.role==='super_admin';
const plan = () => activeDocument?.ship_plan;
const isOverview = () => plan()?.overview.page === viewer.pageNumber;
const canPlace = () => canWrite() && Boolean(plan()?.decks.some(deck=>deck.page===viewer.pageNumber));
const pageName = n => plan()?.overview.page===n ? 'General Overview' : plan()?.decks.find(deck=>deck.page===n)?.name || tr('Pagina')+' '+n;
const phoneLayout=matchMedia('(max-width:960px), (orientation:landscape) and (max-height:550px)');
const filterIds = ['notes-query','notes-page','notes-kind','notes-author','notes-day','notes-work-status','notes-category'];
const stateLabels=new Map(workStates);
const categoryText=category=>category.icon+' '+(category.custom?category.label:categoryLabel(category.key,tr));
let catalogRevision=0;
async function refreshWorkCatalog(){
 const revision=++catalogRevision,account=user?.id;
 const rows=await api.table('sw_work_categories','select=id,name,sw_work_emoji(id,glyph,name)&sw_work_emoji.order=name.asc');
 if(revision===catalogRevision&&account===user?.id)setWorkCatalog(rows);
}
let scheduleTimer;
let finishPick = null;
let areaSession = null;
let laser = null;
const viewer=new Viewer($('viewport'),$('pdf-canvas'),$('marks-canvas'),{create:a=>makeAnnotation(a).catch(report),edit:(items,event)=>openMarkers(items,event).catch(report),error:report,laser:setLaserPoint,stroke:addAreaStroke,vertex:addAreaVertex});
const setupViewer=new Viewer($('setup-viewport'),$('setup-pdf'),$('setup-marks'),{error:report});
let setupPdf,closeSetup,setupLoading=false;
$('setup-back').onclick=()=>{if(!$('setup-save').disabled||setupLoading)showProjectSettings(project).catch(report);};

async function clearShipSetup(){
 closeSetup?.();
 closeSetup=null;
 const doc=setupPdf;
 setupPdf=null;
 await doc?.destroy();
}

async function startShipSetup(doc,previousPlan){
 if(!canConfigure()||setupLoading||doc.page_count<2)return;

 setupLoading=true;
 const token=++epoch;
 screen('ship-setup');
 $('setup-doc-title').textContent=doc.title;
 $('setup-controls').replaceChildren();
 $('setup-save').disabled=true;
 $('setup-hint').textContent=tr('Caricamento…');
 try{
  const blob=await api.pdfDownload(doc.file_path);
  const rendered=await loadPdf(new Uint8Array(await blob.arrayBuffer()));
  if(token!==epoch){await rendered.destroy();return;}
  setupPdf=rendered;
  closeSetup=editShipPlan({
   doc,pdf:rendered,viewer:setupViewer,controls:$('setup-controls'),sheetLabel:$('setup-sheet'),
   hint:$('setup-hint'),saveButton:$('setup-save'),field,btn,text,report,
   async save(shipPlan){
    await api.rpc('sw_publish_ship_plan',{target:doc.id,previous:previousPlan,configuration:shipPlan});
    await enterProject(project);
    toast(tr('Piani nave salvati.'));
   }
  });
  $('setup-save').disabled=false;
 }catch(error){
  if(token===epoch){await showProjectSettings(project);report(error);}
 }finally{setupLoading=false;}
}
try{Object.assign(viewer.settings,JSON.parse(localStorage.getItem('sw.tools')||'{}'));}catch{}
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
function highlightMatch(element,value,query){
 const ranges=searchRanges(value,query);
 const parts=[];
 let start=0;
 for(const [from,to] of ranges){
  parts.push(value.slice(start,from),text('mark',value.slice(from,to),'search-match'));
  start=to;
 }
 element.replaceChildren(...parts,value.slice(start));
 return element;
}
function btn(label,action,cls){const b=text('button',label,cls);b.type='button';b.onclick=()=>Promise.resolve().then(action).catch(report);return b;}
function report(e){toast(tr(e?.message||String(e)));}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function screen(name){screens.forEach(id=>$(id).hidden=id!==name);}
function status(value){$('sync-state').textContent=value;}
function date(value){return new Date(value).toLocaleString(locale(),{dateStyle:'short',timeStyle:'short'});}
function mode(value){if(phoneLayout.matches)$('mobile-tools').open=false;viewer.mode=canPlace()&&!finishPick&&viewer.mode!==value?value:null;$('note-tool').classList.toggle('active',viewer.mode==='note');}
const appDialog=$('dialog');
let dialogPress=null, planActivation=null, openingMarker=false;
function modal(title,onClose=null){
 if(appDialog.open)throw Error(tr('Chiudi prima la finestra aperta.'));
 dialogPress=null;
 dialogOpen=true;dialogClose=onClose;
 $('dialog-title').textContent=title;
 $('dialog-body').replaceChildren();
 $('dialog-body').classList.remove('annotation-choices');
 $('dialog-footer').replaceChildren();
 appDialog.showModal();
 return $('dialog-body');
}
async function closeModal(){
 if(dialogClose&&await dialogClose()===false)return;
 dialogClose=null;dialogOpen=false;dialogPress=null;
 appDialog.close();scheduleRefresh();
}

// A compatibility click from the plan can be delivered after pointerup has
// opened the dialog. Only a new press inside it may activate a pointer control.
appDialog.addEventListener('pointerdown',event=>{
 dialogPress={button:event.target.closest('button'),id:event.pointerId};
},true);
appDialog.addEventListener('pointercancel',()=>{dialogPress=null;},true);
appDialog.addEventListener('click',event=>{
 const button=event.target.closest('button');
 const fromPointer=event.detail>0||Boolean(event.pointerType);
 const insideFreshPress=button===dialogPress?.button
  &&(!event.pointerType||event.pointerId===dialogPress.id);
 dialogPress=null;
 if(!button||!fromPointer)return;
 const repeatedPlanTap=planActivation&&performance.now()-planActivation.time<360
  &&Math.hypot(event.clientX-planActivation.x,event.clientY-planActivation.y)<24;
 if(insideFreshPress&&!repeatedPlanTap)return;
 event.preventDefault();
 event.stopImmediatePropagation();
},true);
$('dialog-close').onclick=()=>closeModal().catch(report);
appDialog.addEventListener('cancel',e=>{e.preventDefault();closeModal().catch(report);});
$('dialog-form').onsubmit=e=>e.preventDefault();
function field(parent,title,{value='',type='text',multiline=false,min,max,step}={}){const label=text('label',title),input=document.createElement(multiline?'textarea':'input');if(!multiline)input.type=type;input.value=value;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;label.append(input);parent.append(label);return input;}
function setAuthMode(value){authMode=value;$('name-field').hidden=value!=='signup';$('full-name').required=value==='signup';$('signup-hint').hidden=value!=='signup';$('password').autocomplete=value==='signup'?'new-password':'current-password';$('auth-title').textContent=tr(value==='signup'?'Crea il tuo account':'Accedi al tuo spazio');$('auth-submit').textContent=tr(value==='signup'?'Registrati →':'Accedi →');$('login-tab').classList.toggle('selected',value==='login');$('signup-tab').classList.toggle('selected',value==='signup');$('auth-error').textContent='';}
$('login-tab').onclick=()=>setAuthMode('login');$('signup-tab').onclick=()=>setAuthMode('signup');
$('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';try{if(authMode==='signup'){await api.signUp($('email').value.trim(),$('password').value,$('full-name').value.trim());if(!api.getSession()){$('auth-error').textContent=tr('Cerca l’email di conferma da Sharework Registration. Controlla anche la posta indesiderata. Dopo la conferma, accedi per verificare l’approvazione.');$('password').value='';return;}}else await api.signIn($('email').value.trim(),$('password').value);$('password').value='';startIdleSession();await restore();}catch(e){$('auth-error').textContent=tr(e.message);}finally{$('auth-submit').disabled=false;}};
$('reset-password').onclick=async()=>{const email=$('email').value.trim();if(!email||!$('email').checkValidity()){toast(tr('Inserisci la tua email.'));return;}try{await api.request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:{email},anonymous:true});$('auth-error').textContent=tr('Se l’account esiste, riceverai il link di recupero da Sharework Registration. Controlla anche la posta indesiderata.');}catch(e){report(e);}};
async function restore(){
 if(!api.getSession()){stopRealtime?.();stopRealtime=null;screen('auth');return;}
 const token=epoch;
 try{
  const current=await api.request('/auth/v1/user');
  if(token!==epoch)return;
  const rows=await api.table('sw_profiles','id=eq.'+current.id+'&select=*');
  if(token!==epoch)return;
  user=current;
  profile=rows[0];
  stopRealtime?.();realtimeConnected=false;
  stopRealtime=watchChanges(onRealtimeChange,connected=>{realtimeConnected=connected;if(!connected)queueRefresh();});
  if(!profile)throw Error(tr('Profilo non disponibile. La configurazione del database deve essere completata.'));
  if(!profile.approved){screen('waiting');return;}
  document.querySelectorAll('.user-name').forEach(el=>el.textContent=profile.full_name);applyRole();
  await refreshWorkCatalog().catch(report);
  if(token===epoch)await showProjects();
 }catch(e){if(api.getSession()){screen('auth');$('auth-error').textContent=tr(e.message);}}
}

async function logout({idle=false,signedOutElsewhere=false}={}){
 let revocation;
 if(signedOutElsewhere)api.setSession(null);
 else if(idle)revocation=api.signOut({idle:true}).catch(()=>{});
 else{
  cancelPick();
  if(dialogOpen&&!await tryClose())return;
  await api.signOut().catch(report);
 }
 stopRealtime?.();stopRealtime=null;realtimeConnected=false;
 clearTimeout(idleTimer);clearTimeout(refreshTimer);refreshTimer=null;pendingSync.clear();
 epoch++;
 dismissNoteSession();
 const setupClosed=clearShipSetup(), oldPdf=pdf;
 pdf=null;project=null;projectLevel=null;activeDocument=null;profile=user=null;
 annotations=[];projects=[];undo=[];redo=[];
 viewer.clear();
 catalogRevision++;setWorkCatalog([]);
 setAuthMode('login');
 if(idle)$('auth-error').textContent=tr('Sessione terminata per inattività. Accedi di nuovo.');
 screen('auth');
 await Promise.all([setupClosed,oldPdf?.destroy(),revocation]);
}

function checkInactivity(){
 clearTimeout(idleTimer);
 if(!api.getSession())return false;
 const now=Date.now();
 const last=Number(localStorage.getItem(idleKey))||now;
 if(!localStorage.getItem(idleKey))localStorage.setItem(idleKey,String(last));
 const remaining=idleLimit-Math.max(0,now-last);
 if(remaining<=0){void logout({idle:true}).catch(report);return false;}
 idleTimer=setTimeout(checkInactivity,remaining);
 return true;
}

function startIdleSession(){
 localStorage.setItem(idleKey,String(Date.now()));
 checkInactivity();
}

function recordActivity(event){
 if(!event.isTrusted||document.hidden||!api.getSession())return;
 if(event.type==='pointermove'&&!event.buttons)return;
 const now=Date.now(),last=Number(localStorage.getItem(idleKey));
 if(now-last>=idleLimit&&last){checkInactivity();return;}
 if(now-last>=1000)localStorage.setItem(idleKey,String(now));
}

for(const type of ['pointerdown','pointermove','keydown','wheel','input','scroll']){
 window.addEventListener(type,recordActivity,{capture:true,passive:true});
}
window.addEventListener('storage',event=>{
 if(event.key===idleKey)checkInactivity();
 if(event.key===api.SESSION&&!event.newValue&&api.getSession()){
  const idle=Date.now()-Number(localStorage.getItem(idleKey))>=idleLimit;
  void logout({idle,signedOutElsewhere:true}).catch(report);
 }
});
window.addEventListener('pageshow',checkInactivity);

async function tryClose(){await closeModal();return !dialogOpen;}
document.querySelectorAll('.logout').forEach(b=>b.onclick=()=>logout().catch(report));$('check-approval').onclick=()=>restore().catch(report);
async function showProjects(){
 const token=++epoch;
 await clearShipSetup();
 if(token!==epoch)return;
 project=null;projectLevel=null;activeDocument=null;viewer.clear();
 await pdf?.destroy();
 if(token!==epoch)return;
 pdf=null;undo=[];redo=[];screen('projects');
 $('project-list').replaceChildren(text('div',tr('Caricamento…'),'empty'));
 const rows=await api.table('sw_projects','select=*&order=created_at.desc');
 if(token!==epoch)return;
 projects=rows;renderProjects();
}
function projectPeriod(p){
 if(!p.start_date||!p.end_date)return tr('Periodo da definire');
 const format=value=>new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
 return format(p.start_date)+' – '+format(p.end_date);
}

function renderProjects(){
 const q=$('search').value.toLowerCase(), list=projects.filter(p=>p.title.toLowerCase().includes(q));
 $('project-count').textContent=list.length+' '+tr(list.length===1?'progetto':'progetti');
 $('project-list').replaceChildren();
 for(const p of list){
  const card=btn('',()=>enterProject(p),'project-card');
  const tile=text('div','','document-item');
  const cover=text('div','','cover');
  if(p.cover_image){
   const image=new Image();
   image.alt='';
   image.src=p.cover_image;
   cover.append(image);
  }else cover.append(text('span',tr('Nessuna copertina')));
  card.append(cover,text('h3',p.title),text('p',projectPeriod(p)));
  tile.append(card);
  if(canManage())tile.append(btn(tr('Gestisci progetto'),()=>showProjectSettings(p)));
  $('project-list').append(tile);
 }
 if(!list.length)$('project-list').append(text('div',tr('Nessun progetto'),'empty'));
}
$('search').oninput=renderProjects;
$('back-projects').onclick=()=>{if(!areaSession)showProjects().catch(report);};
$('documents-back').onclick=()=>showProjects().catch(report);
$('new-project').onclick=()=>projectEditor();
$('edit-project').onclick=()=>projectEditor(project);

function projectEditor(existing=null){
 if(existing?!canManage():!canConfigure())return;
 const box=modal(tr(existing?'Modifica progetto':'Nuovo progetto'));
 const title=field(box,tr('Nome progetto'),{value:existing?.title||''});
 title.maxLength=180;
 const start=field(box,tr('Inizio'),{type:'date',value:existing?.start_date||''});
 const end=field(box,tr('Fine'),{type:'date',value:existing?.end_date||''});
 const file=field(box,tr('Immagine di copertina'),{type:'file'});
 file.accept='image/jpeg,image/png,image/webp';
 const remove=existing?.cover_image?field(box,tr('Rimuovi copertina'),{type:'checkbox'}):null;
 const submit=btn(tr(existing?'Salva progetto':'Crea progetto'),async()=>{
  if(existing?!canManage():!canConfigure())return;
  if(!title.value.trim())throw Error(tr('Inserisci il nome del progetto.'));
  if(!start.value||!end.value||end.value<start.value)throw Error(tr('Indica un periodo valido.'));
  submit.disabled=true;
  dialogClose=()=>false;
  try{
   const cover=file.files[0]?await projectCover(file.files[0]):remove?.checked?null:existing?.cover_image||null;
   const [updated]=await api.table('sw_projects',existing?'id=eq.'+existing.id:'',{
    method:existing?'PATCH':'POST',body:{title:title.value.trim(),start_date:start.value,end_date:end.value,cover_image:cover}
   });
   if(!updated)throw Error(tr('Progetto non salvato.'));
   dialogClose=null;
   await closeModal();
   await showProjectSettings(updated);
  }finally{submit.disabled=false;dialogClose=null;}
 },'primary');
 $('dialog-footer').append(submit);
}
async function enterProject(p){
 const token=++epoch;
 cancelPick();
 $('mobile-tools').open=!phoneLayout.matches;
 await clearShipSetup();
 const [level,rows]=await Promise.all([
  api.rpc('sw_project_level',{target:p.id}),
  api.table('sw_documents','project_id=eq.'+p.id+'&ship_plan=not.is.null&select=*')
 ]);
 if(token!==epoch)return;
 if(!level){await showProjects();throw Error(tr('Accesso al progetto revocato.'));}
 project=p;projectLevel=level;
 if(rows[0])return openDocument(rows[0]);
 if(canManage())return showProjectSettings(p);
 await showProjects();
 toast(tr('Piano nave in preparazione.'));
}

async function showProjectSettings(p){
 if(!canManage())return showProjects();
 cancelPick();
 const token=++epoch;
 await clearShipSetup();
 activeDocument=null;
 project=p;
 projectLevel=null;
 viewer.clear();
 await pdf?.destroy();
 pdf=null;
 if(token!==epoch)return;
 screen('documents');
 $('documents-title').textContent=p.title;
 $('project-plan').replaceChildren(text('p',tr('Caricamento…')));
 const rows=await api.table('sw_documents','project_id=eq.'+p.id+'&select=*&order=created_at.desc');
 if(token!==epoch)return;
 const current=rows.find(doc=>doc.ship_plan);
 const box=$('project-plan');
 box.replaceChildren(text('h2',tr('Piano nave')),text('p',current?.title||tr('Piano nave in preparazione.')));
 if(current)box.append(btn(tr('Apri piano nave'),()=>enterProject(p)));
 if(canConfigure()){
  if(current)box.append(btn(tr('Configura piano nave'),()=>startShipSetup(current,current.id)));
  box.append(btn(tr(current?'Sostituisci piano nave':'Carica piano nave'),()=>uploadShipPlan(current?.id||null),'primary'));
  box.append(btn(tr('Elimina progetto'),()=>confirmProjectRemoval(p),'danger'));
  for(const draft of rows.filter(doc=>!doc.ship_plan&&doc.page_count>1)){
   box.append(btn(tr('Configura PDF già caricato')+' · '+draft.title,()=>startShipSetup(draft,current?.id||null)));
  }
 }
}

function confirmProjectRemoval(p){
 if(!canConfigure())return;
 const box=modal(tr('Elimina progetto'));
 box.append(text('strong',p.title),text('p',tr('Il progetto verrà rimosso dall’elenco e i suoi accessi saranno disattivati.')));
 const remove=btn(tr('Conferma eliminazione'),async()=>{
  if(!canConfigure()||remove.disabled)return;
  remove.disabled=true;
  dialogClose=()=>false;
  try{
   await api.rpc('sw_remove_project',{target:p.id});
   dialogClose=null;
   await closeModal();
   await showProjects();
  }finally{dialogClose=null;remove.disabled=false;}
 },'danger');
 $('dialog-footer').append(btn(tr('Annulla selezione'),closeModal),remove);
}
$('project-access').onclick=()=>manageProjectAccess().catch(report);
async function manageProjectAccess(){
 if(!canManage()||!project)return;
 const projectId=project.id;
 const box=modal(tr('Accessi al progetto'));
 const container=text('div','');
 box.append(container);
 const [people,access]=await Promise.all([
  api.table('sw_profiles','approved=eq.true&role=in.(member,viewer)&select=id,full_name&order=full_name'),
  api.table('sw_project_access','project_id=eq.'+projectId)
 ]);
 if(!dialogOpen||!container.isConnected)return;
 const levels=new Map(access.map(row=>[row.user_id,row.access_level]));
 if(!people.length){container.append(text('p',tr('Nessun utente approvato da assegnare.')));return;}
 const search=peopleSearch(container);
 for(const person of people){
  const row=text('label','','access-row'),name=text('span',person.full_name);
  const select=document.createElement('select');
  select.append(...[['','Nessun accesso'],['view','Sola lettura'],['edit','Modifica note']].map(([key,label])=>new Option(tr(label),key)));
  select.value=levels.get(person.id)||'';
  select.onchange=async()=>{
   const previous=levels.get(person.id)||'';
   const level=select.value;
   select.disabled=true;
   try{
    if(level)await api.table('sw_project_access','on_conflict=project_id,user_id',{
     method:'POST',body:{project_id:projectId,user_id:person.id,access_level:level},
     headers:{Prefer:'resolution=merge-duplicates,return=minimal'}
    });
    else await api.table('sw_project_access','project_id=eq.'+projectId+'&user_id=eq.'+person.id,{method:'DELETE'});
    levels.set(person.id,level);
    toast(tr('Salvato'));
   }catch(error){select.value=previous;report(error);}
   finally{select.disabled=false;}
  };
  row.append(name,select);search.append(person.full_name,row,name);
 }
 search.update();
}

function uploadShipPlan(previous){
 if(!canConfigure())return;
 const box=modal(tr(previous?'Sostituisci piano nave':'Carica piano nave'));
 if(previous)box.append(text('p',tr('Le note restano associate alla tavola originale. Il nuovo piano parte senza annotazioni.')));
 const file=field(box,tr('PDF · massimo 50 MB'),{type:'file'});
 file.accept='.pdf,application/pdf';
 const submit=btn(tr('Carica e configura'),async()=>{
  const chosen=file.files[0];
  if(!chosen)throw Error(tr('Seleziona un PDF.'));
  if(chosen.size>50000000)throw Error(tr('Il PDF supera 50 MB.'));
  submit.disabled=true;dialogClose=()=>false;
  let path,uploaded=false;
  try{
   const parsed=await loadPdf(new Uint8Array(await chosen.arrayBuffer()));
   const count=parsed.numPages;
   await parsed.destroy();
   if(count<2)throw Error(tr('Il piano nave deve contenere almeno due pagine.'));
   path=user.id+'/'+crypto.randomUUID()+'.pdf';
   await api.pdfUpload(path,chosen);
   uploaded=true;
   const [doc]=await api.table('sw_documents','',{method:'POST',body:{
    project_id:project.id,title:chosen.name.replace(/\.pdf$/i,'').slice(0,180),
    file_name:chosen.name,file_path:path,page_count:count
   }});
   uploaded=false;dialogClose=null;
   await closeModal();
   await startShipSetup(doc,previous);
  }catch(error){if(uploaded)try{await api.pdfCleanup(path);}catch{}throw error;}
  finally{submit.disabled=false;dialogClose=null;}
 },'primary');
 $('dialog-footer').append(submit);
}

async function openDocument(p){laser=null;const token=++epoch;loading=true;activeDocument=p;annotations=[];undo=[];redo=[];viewer.clear();screen('workspace');$('document-title').textContent=p.title;status(tr('Apertura…'));applyPanel();try{const [blob,rows]=await Promise.all([api.pdfDownload(p.file_path),api.table('sw_annotations','document_id=eq.'+p.id+'&select=*&order=created_at.asc')]);if(token!==epoch)return;await pdf?.destroy();pdf=await loadPdf(new Uint8Array(await blob.arrayBuffer()));if(token!==epoch){await pdf.destroy();return;}annotations=rows;await viewer.open(pdf,plan()?.overview.page||1);
for(const id of filterIds) $(id).value='';
if(phoneLayout.matches){panelHidden=true;applyPanel();}
if(isOverview())viewer.centerView(.5,.5,{visibleWidth:visiblePlanWidth(),fitHeight:true});
refreshList();status('');}finally{loading=false;}}
function refreshLaser(draw=true){
 const ship=plan();
 viewer.laser=ship&&laser?laserOnPage(ship,viewer.pageNumber,laser):null;
 $('laser-view').setAttribute('aria-pressed',String(Boolean(laser)));
 $('viewport').classList.toggle('laser-active',Boolean(viewer.laser));
 if(draw)viewer.draw(false);
}

function setLaserPoint(point){
 if(!laser||!plan()||loading||finishPick)return;
 laser=placeLaser(plan(),viewer.pageNumber,point,laser);
 refreshLaser();
}

$('laser-view').onclick=()=>{
 if(!plan()||loading||finishPick||areaSession)return;
 if(laser)laser=null;
 else{
  const view=viewer.viewCenter(visiblePlanWidth());
  if(!view)return;
  mode(null);
  laser=placeLaser(plan(),viewer.pageNumber,[clamp(view.x,0,1),clamp(view.y,0,1)]);
 }
 refreshLaser();
};
function visiblePlanWidth(){
 const viewport=$('viewport').getBoundingClientRect();
 const panel=$('notes-panel').getBoundingClientRect();
 return Math.max(1,$('notes-panel').hidden?viewport.width:Math.min(viewport.width,panel.left-viewport.left));
}

async function page(n,{keepPosition=false}={}){
 if(areaSession||finishPick||loading||!pdf||n<1||n>pdf.numPages||n===viewer.pageNumber)return;
 loading=true;
 try{
  const ship=plan();
  const overview=ship?.overview;
  const sheets=ship?[overview,...ship.decks]:[];
  const source=sheets.find(sheet=>sheet.page===viewer.pageNumber);
  const target=sheets.find(sheet=>sheet.page===n);
  const view=keepPosition&&source&&target?viewer.viewCenter(visiblePlanWidth()):null;
  const mapped=view?mapDeckView(source,target,view):null;
  mode(null);
  await viewer.page(n);
  if(viewer.pageNumber!==n)return;
  const visibleWidth=visiblePlanWidth();
  if(mapped){
   const width=mapped.pixelsPerMeter/Math.abs(longitudinalScale(target));
   viewer.centerView(mapped.x,view.y,{visibleWidth,width});
  }else if(target&&target===overview){
   viewer.centerView(.5,.5,{visibleWidth,fitHeight:true});
  }
  refreshList();
 }finally{loading=false;}
}
function applyRole(){
 $('export-works').hidden=!canExportWorks();
 $('users-button').hidden=profile?.role!=='super_admin';
 $('categories-button').hidden=!canConfigure();
 $('new-project').hidden=!canConfigure();
 $('edit-project').hidden=$('project-access').hidden=!canManage();
}

function selectOptions(select,options){
 const value=select.value;
 if(select.options.length===options.length && options.every(([key,label],i)=>select.options[i].value===String(key) && select.options[i].textContent===label)) return;
 select.replaceChildren(...options.map(([key,label])=>new Option(label,key)));
 if(options.some(([key])=>String(key)===value)) select.value=value;
}

function updatePages(){
 const current=viewer.pageNumber;
 $('laser-view').hidden=!plan();
 const busy=Boolean(finishPick||areaSession);
 $('laser-view').disabled=busy;
 const writable=canWrite();
 for(const el of document.querySelectorAll('#toolbar .tool-group,#undo,#redo'))el.hidden=!writable;
 $('undo').disabled=!writable||busy||!undo.length;
 $('redo').disabled=!writable||busy||!redo.length;

 for(const id of ['note-tool','note-settings']) $(id).disabled=!canPlace()||busy;
 if(!canPlace()||finishPick) mode(null);
 $('ship-pages').hidden=!plan();
 $('ship-pages').disabled=busy;
 $('back-projects').disabled=Boolean(areaSession);
 if(plan()){
  selectOptions($('ship-pages'),[plan().overview.page,...plan().decks.map(deck=>deck.page)].map(n=>[n,pageName(n)]));
  $('ship-pages').value=current;
 }
}
$('ship-pages').onchange=()=>page(Number($('ship-pages').value),{keepPosition:true}).catch(report).finally(()=>{$('ship-pages').value=viewer.pageNumber;});

function stopArea(){
 areaSession=null;
 viewer.areaDraft=null;
 viewer.stroke=null;
 if(viewer.mode==='area')viewer.mode=null;
 $('area-banner').hidden=true;
}

function cancelPick(){
 stopArea();
 finishPick=null;
 viewer.pick=null;
 viewer.guides=[];
 $('pick-banner').hidden=true;
 scheduleRefresh();
}
async function pickNotePoint(target,label,onPick){
 await page(target);
 if(viewer.pageNumber!==target) throw Error(tr('Impossibile aprire la pagina da calibrare.'));
 mode(null);
 finishPick=(point)=>{
  cancelPick();
  refreshList();
  if(onPick) Promise.resolve().then(()=>onPick(point)).catch(report);
 };
 viewer.pick=point=>finishPick?.(point);
 $('pick-label').textContent=label+ ' · '+tr('Pagina')+' '+target+' · '+tr('tocca il disegno');
 $('pick-banner').hidden=false;
 viewer.draw(false);
 updatePages();
}
$('pick-cancel').onclick=()=>finishPick?.(null);
$('note-tool').onclick=()=>mode('note');
function panelMaxWidth(){
 const available=$('workspace-body').clientWidth;
 return Math.max(160,phoneLayout.matches?Math.floor(available*.86):available-180);
}
function applyPanel(){const width=clamp(panelWidth,160,panelMaxWidth());$('notes-panel').hidden=panelHidden;$('notes-panel').style.width=width+'px';$('workspace-body').style.setProperty('--notes-width',width+'px');$('divider').classList.toggle('notes-closed',panelHidden);$('divider').tabIndex=panelHidden?-1:0;$('panel-toggle').setAttribute('aria-expanded',String(!panelHidden));$('mobile-notes').setAttribute('aria-expanded',String(!panelHidden));$('panel-toggle').textContent=panelHidden?'◂':'▸';}
function toggleNotes(){panelHidden=!panelHidden;applyPanel();}
$('panel-toggle').onclick=$('mobile-notes').onclick=$('notes-close').onclick=toggleNotes;
phoneLayout.addEventListener('change',()=>{panelHidden=phoneLayout.matches;$('mobile-tools').open=!phoneLayout.matches;applyPanel();});
$('mobile-tools').open=!phoneLayout.matches;
$('workspace-body').addEventListener('pointerdown',e=>{if(e.target.closest('#viewport'))$('mobile-tools').open=!phoneLayout.matches;});
$('print-view').onclick=()=>{
 if(!activeDocument||loading||areaSession||!viewer.pdfPage||!plan())return;
 const configuration=plan(), current=viewer.pageNumber, sourcePdf=pdf;
 const box=modal(tr('Stampa PDF'));
 const choices=text('div','','print-options');
 const message=text('p','','muted');
 message.setAttribute('role','status');
 const deckSelect=document.createElement('select');
 const deckLabel=text('label',tr('Ponte da stampare'));
 deckLabel.append(deckSelect);
 selectOptions(deckSelect,configuration.decks.map(deck=>[deck.page,deck.name]));
 if(current!==configuration.overview.page)deckSelect.value=current;
 deckLabel.hidden=current!==configuration.overview.page;
 const button=$('print-view');
 function option(label,getPage,partial=false){
  const choice=btn(tr(label),async()=>{
   const target=getPage();
   if(!target||pdf!==sourcePdf||loading)return;
   const filtered=visiblePlanNotes();
   const marks=marksForPage(configuration,filtered,target);
   const laserMark=laser&&laserOnPage(configuration,target,laser);
   const title=[project.title,pageName(target)].join(' · ');
   const width=visiblePlanWidth(),height=viewer.container.clientHeight;
   const currentRect=viewer.rect();
   button.disabled=true;
   for(const item of choices.querySelectorAll('button'))item.disabled=true;
   message.textContent=tr('Preparazione PDF…');
   try{
    const [{printPlan},printPage]=await Promise.all([import('./plan-print.js'),sourcePdf.getPage(target)]);
    const base=printPage.getViewport({scale:1});
    const scale=1200/Math.max(base.width,base.height);
    const full={x:0,y:0,w:base.width*scale,h:base.height*scale,scale};
    const crop=partial&&target===current;
    await printPlan({
     page:printPage,rect:crop?currentRect:full,width:crop?width:full.w,height:crop?height:full.h,title,tr,
     drawOverlay(ctx,rect){
      viewer.drawMarks(ctx,rect,marks);
      if(laserMark)drawLaser(ctx,rect,laserMark);
     }
    });
    if(appDialog.open&&box.contains(choices))await closeModal();
   }catch(error){message.textContent=tr(error.message);}
   finally{
    button.disabled=false;
    for(const item of choices.querySelectorAll('button'))item.disabled=false;
   }
  });
  choices.append(choice);
  return choice;
 }
 option('Vista corrente',()=>current,true);
 option('Tutto il ponte',()=>current===configuration.overview.page?Number(deckSelect.value):current)
  .disabled=!configuration.decks.length;
 option('Tutta la General Overview',()=>configuration.overview.page);
 box.append(deckLabel,choices,message);
};
$('export-works').onclick=async()=>{
 if(!activeDocument||!project||!canExportWorks())return;
 const button=$('export-works');
 const works=annotations, configuration=plan(), title=project.title;
 const name=page=>configuration?.decks.find(deck=>deck.page===page)?.name||tr('Pagina')+' '+page;
 button.disabled=true;
 try{
  const {exportWorks}=await import('./work-export.js');
  if(canExportWorks()&&!$('workspace').hidden)await exportWorks(works,configuration,title,name,tr,locale());
 }catch(error){report(error);}
 finally{button.disabled=false;}
};
$('mobile-tools').addEventListener('click',e=>{if(phoneLayout.matches&&e.target.closest('button'))$('mobile-tools').open=false;});
const divider=$('divider');
let resizeStart;
function resizeNotes(width){
 panelWidth=clamp(width,160,panelMaxWidth());
 applyPanel();
}
divider.onpointerdown=e=>{
 if(e.target.closest('button')||panelHidden||!e.isPrimary||e.button!==0)return;
 e.preventDefault();
 divider.setPointerCapture(e.pointerId);
 resizeStart={id:e.pointerId,x:e.clientX,width:$('notes-panel').getBoundingClientRect().width};
};
divider.onpointermove=e=>{
 if(resizeStart?.id===e.pointerId)resizeNotes(resizeStart.width+resizeStart.x-e.clientX);
};
divider.onpointerup=divider.onpointercancel=divider.onlostpointercapture=e=>{
 if(resizeStart?.id!==e.pointerId)return;
 resizeStart=null;
 localStorage.setItem('sw.panelWidth',panelWidth);
};
divider.onkeydown=e=>{
 if(panelHidden||e.target!==divider||!['ArrowLeft','ArrowRight'].includes(e.key))return;
 e.preventDefault();
 resizeNotes($('notes-panel').offsetWidth+(e.key==='ArrowLeft'?16:-16));
 localStorage.setItem('sw.panelWidth',panelWidth);
};
window.addEventListener('resize',applyPanel);
function updateToolbarToggle(){
 const expanded=!$('toolbar').hidden;
 const label=tr(expanded?'Minimizza barra strumenti':'Espandi barra strumenti');
 const toggle=$('toolbar-toggle');
 toggle.setAttribute('aria-expanded',String(expanded));
 toggle.setAttribute('aria-label',label);
 toggle.title=label;
 toggle.textContent=expanded?'⌃':'⌄';
}
$('toolbar-toggle').onclick=()=>{$('toolbar').hidden=!$('toolbar').hidden;updateToolbarToggle();};
$('notes-scope').onchange=()=>{
 all=$('notes-scope').value==='all';
 localStorage.setItem('sw.all',all);
 refreshList();
};
function badge(a){
 const canvas=document.createElement('canvas');
 canvas.className='badge';
 canvas.width=canvas.height=70;
 const ctx=canvas.getContext('2d');
 ctx.scale(2,2);
 marker(ctx,17.5,17.5,a.color,a.shape,a.number,12);
 return canvas;
}

for(const id of filterIds) $(id).oninput=refreshList;
$('notes-reset').onclick=()=>{
 all=false;localStorage.setItem('sw.all',all);
 for(const id of filterIds) $(id).value='';
 refreshList();
};

function visiblePlanNotes(now=Date.now()){
 const [query,page,kind,author,day,status,category]=filterIds.map(id=>$(id).value);
 return filterNotes(annotations,{query,page,kind,category,author,day,status,now})
  .map(note=>({...note,effectiveStatus:workState(note,now)}));
}

function marksForPage(ship,filtered,page,references){
 const visible=filtered.filter(note=>note.effectiveStatus!=='completed');
 const local=visible.filter(note=>note.page===page);
 if(ship?.overview.page===page)return [...local,...projectMarks(ship,visible)];
 const projected=references||(ship?deckReferences(ship,filtered,page):[]);
 return [...local,...projected.filter(note=>note.effectiveStatus!=='completed')];
}

function refreshList(){
 clearTimeout(scheduleTimer);
 if(!activeDocument||!pdf||$('workspace').hidden) return;
 const overview=isOverview();
 const order=shipPageOrder(plan(),pdf.numPages);
 selectOptions($('notes-page'),[['',tr('Tutte')],...order.map(n=>[n,pageName(n)])]);
 selectOptions($('notes-kind'),[['',tr('Tutti')],...noteShapes.map(([key,label,custom])=>[key,(emojiSymbols[key]||geometricSymbols[key])+' '+(custom?label:tr(label))]),['highlight',tr('Evidenziazione')]]);
 const authors=new Map(annotations.filter(a=>!a.deleted).map(a=>[a.created_by,a.author_name]));
 selectOptions($('notes-author'),[['',tr('Tutti')],...[...authors].sort((a,b)=>a[1].localeCompare(b[1],locale()))]);
 selectOptions($('notes-work-status'),[['',tr('Tutti')],...workStates.map(([key,label])=>[key,tr(label)])]);
 const custom=new Map(annotations.filter(note=>!note.deleted).map(noteCategory).filter(category=>category?.custom)
  .map(category=>[category.key,category.icon+' '+category.label]));
 selectOptions($('notes-category'),[['',tr('Tutti')],...workCategories.map(([key,icon])=>[key,icon+' '+categoryLabel(key,tr)]),...custom]);
 const [query,pageFilter,kind,author,day,statusFilter,categoryFilter]=filterIds.map(id=>$(id).value);
 const search=normalizeSearch(query).trim();
 const now=Date.now();
 const filtering=Boolean(search||pageFilter||kind||author||day||statusFilter||categoryFilter);
 $('workspace-body').classList.toggle('filters-active',filtering);
 $('viewport').querySelector('.filtered-plan-label').hidden=!filtering;
 let boundary=Infinity;
 for(const note of annotations){
  if(note.deleted||note.work_status)continue;
  for(const value of [note.work_start,note.work_end]){
   const time=Date.parse(value);
   if(time>now)boundary=Math.min(boundary,time);
  }
 }
 if(Number.isFinite(boundary))scheduleTimer=setTimeout(refreshList,Math.min(boundary-now+10,2147483647));
 const filtered=visiblePlanNotes(now);
 const references=!overview&&plan()?deckReferences(plan(),filtered,viewer.pageNumber):[];
 const marks=marksForPage(plan(),filtered,viewer.pageNumber,references);
 refreshLaser(false);
 viewer.setMarks(marks);
 const showAll=all||!!pageFilter;
 const list=overview?grouped(filtered,viewer.pageNumber,true)
  :grouped(showAll?filtered:[...filtered,...references],viewer.pageNumber,showAll);
 if(plan())list.sort((a,b)=>order.indexOf(a.page)-order.indexOf(b.page));
 selectOptions($('notes-scope'),[['current',tr(overview?'Overview':'Ponte attuale')],['all',tr('Tutte')]]);
 $('notes-scope').value=all?'all':'current';
 $('notes-list').replaceChildren();
 const referenceOrigins=new Map(references.length?annotations.map(note=>[note.id,note]):[]);
 let previous=-1;
 for(const a of list){
  if((showAll||overview)&&a.page!==previous){
   $('notes-list').append(text('div',pageName(a.page),'page-group'));
   previous=a.page;
  }
  const row=text('div','','annotation'),open=btn('',()=>openListedNote(a),'annotation-open');
  row.classList.toggle('annotation-completed',a.effectiveStatus==='completed');
  const title=a.title||(a.kind==='note'?tr('Nota')+' '+a.number:tr('Evidenziazione'));
  open.append(highlightMatch(text('span','','annotation-title'),title,search));
  open.append(text('span',tr(stateLabels.get(a.effectiveStatus)),'work-badge work-'+a.effectiveStatus));
  const category=noteCategory(a);
  if(category)open.append(text('span',categoryText(category),'annotation-author'));
  if(a.title&&a.number!=null&&search&&String(a.number).includes(search)){
   const number=text('span','','annotation-number');
   number.append('#',highlightMatch(text('span',''),String(a.number),search));
   open.append(number);
  }
  if(a.description){
   const description=text('span','','annotation-description');
   const [match]=searchRanges(a.description,search);
   const offset=Math.max(0,(match?.[0]??0)-25);
   const preview=(offset?'…':'')+a.description.slice(offset);
   open.append(highlightMatch(description,preview,search));
  }
  const authorLine=highlightMatch(text('span','','annotation-author'),a.author_name,search);
  authorLine.append(' · '+date(a.created_at));
  open.append(authorLine);
  const origin=a.deckReference?(referenceOrigins.get(a.id)||a):a;
  const sheet=plan()?.decks.find(deck=>deck.page===origin.page);
  const frame=frameAt(sheet,origin.x);
  const [start,end]=workFrameRange(sheet,origin);
  const frameNumber=new Intl.NumberFormat(locale(),{maximumFractionDigits:2});
  const range=start==null?'':(' · '+frameNumber.format(start)+'–'+frameNumber.format(end));
  if(frame!=null)open.append(text('span',tr('Ordinata')+' '+frameNumber.format(frame)+range,'annotation-author'));
  const b=badge(a);
  b.classList.toggle('work-muted',['pending','paused'].includes(a.effectiveStatus));
  b.onclick=()=>openListedNote(a).catch(report);
  row.append(b,open);
  if(canWrite())row.append(btn('⋮',()=>annotationMenu(annotations.find(note=>note.id===a.id)||a),'more'));
  $('notes-list').append(row);
 }
 if(!list.length)$('notes-list').append(text('div',tr('Nessuna annotazione'),'empty'));
 updatePages();
}
function merge(a){
 annotationRevision++;
 const i=annotations.findIndex(x=>x.id===a.id);
 if(i<0)annotations.push(a);else annotations[i]=a;
 refreshList();
}
async function patch(a,values){if(!canWrite())throw Error(tr('Accesso in sola lettura.'));const rows=await api.table('sw_annotations','id=eq.'+a.id+'&version=eq.'+a.version,{method:'PATCH',body:values});if(!rows?.length)throw Error(tr('Questa annotazione è stata modificata da un altro utente. Le tue modifiche non sono state sovrascritte: copia il testo e riapri la nota aggiornata.'));merge(rows[0]);return rows[0];}
function record(before,after){if(before&&JSON.stringify(snapshot(before))===JSON.stringify(snapshot(after)))return;undo.push({id:after.id,before:before?snapshot(before):{...snapshot(after),deleted:true},after:snapshot(after),expected:after.version});if(undo.length>40)undo.shift();redo=[];updatePages();}
async function makeAnnotation(values){if(loading||dialogOpen||finishPick||!project||!canPlace())return;loading=true;try{const [a]=await api.table('sw_annotations','',{method:'POST',body:{...values,project_id:project.id,document_id:activeDocument.id,page:viewer.pageNumber,title:tr(values.kind==='note'?'Nota':'Evidenziazione'),description:''}});merge(a);await openAnnotation(a,null);}finally{loading=false;}}
async function openListedNote(note){
 if(dialogOpen||finishPick||loading||areaSession)return;
 await goToNote(note);
 await openAnnotation(note);
}

function annotationHeading(annotation){
 const type=tr(annotation.kind==='note'?'Nota':'Evidenziazione');
 return annotation.number==null?type:type+' '+annotation.number;
}

async function openMarkers(hits,event){
 if(dialogOpen||finishPick||loading||areaSession||openingMarker)return;
 const byId=new Map(annotations.filter(item=>!item.deleted).map(item=>[item.id,item]));
 const items=[...new Set(hits.map(item=>item.id))].map(id=>byId.get(id)).filter(Boolean);
 if(!items.length)return;
 planActivation=event.pointerType==='touch'?{time:performance.now(),x:event.clientX,y:event.clientY}:null;
 if(items.length===1){
  openingMarker=true;
  try{await openMarker(items[0]);}finally{openingMarker=false;}
  return;
 }
 const box=modal(tr('Elementi in questa zona'));
 box.classList.add('annotation-choices');
 for(const item of items){
  const choice=btn('',async()=>{
   if(openingMarker)return;
   openingMarker=true;
   try{await closeModal();if(!dialogOpen)await openMarker(item);}
   finally{openingMarker=false;}
  },'annotation-choice');
  const info=text('span',annotationHeading(item)+(item.title?' · '+item.title:''));
  info.append(text('small',pageName(item.page)+' · '+item.author_name));
  choice.append(badge(item),info);
  box.append(choice);
 }
 $('dialog-footer').append(btn(tr('Chiudi'),closeModal));
}

async function openMarker(annotation){
 if(!isOverview())await goToNote(annotation);
 await openAnnotation(annotation);
}

async function goToNote(note){
 if(dialogOpen||finishPick||loading||areaSession)return;
 await page(note.page);
 if(viewer.pageNumber!==note.page)return;
 const [points]=note.regions?.length?[]:annotationStrokes(note);
 const target=points?.length?points[Math.floor(points.length/2)]:[note.x,note.y];
 viewer.focus(...target,visiblePlanWidth());
}
async function openAnnotation(initial,before=initial){
 if(dialogOpen||finishPick||areaSession)return;
 let current=annotations.find(a=>a.id===initial.id);
 if(!current||current.deleted)return;
 if(before)before=current;
 if(!isOverview()&&current.page!==viewer.pageNumber){
  await page(current.page);
  if(current.page!==viewer.pageNumber)return;
 }
 const heading=annotationHeading(current);
 const author=current.author_name+' · '+date(current.created_at);
 if(!canWrite()){
  const box=modal(heading);
  box.append(text('div',author,'author-detail'));
  if(current.title)box.append(text('h3',current.title,'note-reading-title'));
  if(current.description)box.append(text('p',current.description,'note-reading-description'));
  box.append(text('p',tr(stateLabels.get(workState(current)))));
  for(const [label,value] of [['Inizio previsto',current.work_start],['Fine prevista',current.work_end]]){
   if(value)box.append(text('p',tr(label)+' · '+date(value)));
  }
  addNoteNavigation(current);
  return;
 }
 let timer,chain=Promise.resolve(),failed=false,deleting=false;
 const box=modal(heading,async()=>{
  if(deleting)return false;
  clearTimeout(timer);
  await flush();
  if(failed)return false;
  record(before,current);
  return true;
 });
 box.append(text('div',author,'author-detail'));
 const title=field(box,tr('Titolo'),{value:current.title}),description=field(box,tr('Descrizione'),{value:current.description,multiline:true});
 title.maxLength=250;
 description.maxLength=20000;
 const initialStart=current.work_start,initialEnd=current.work_end;
 const scheduling=text('div','','work-scheduling');
 box.append(scheduling);
 function selectWork(label,choices,value){
  const wrapper=text('label',tr(label)),select=document.createElement('select');
  selectOptions(select,choices.map(([key,title])=>[key,tr(title)]));
  select.value=value||'';
  wrapper.append(select);scheduling.append(wrapper);
  return select;
 }
 const workStatus=selectWork('Stato',[['','Automatico da orario'],...workStates],current.work_status);
 const workStart=field(scheduling,tr('Inizio previsto'),{type:'datetime-local',value:localDateTime(current.work_start)});
 const workEnd=field(scheduling,tr('Fine prevista'),{type:'datetime-local',value:localDateTime(current.work_end)});
 const effective=text('p','','work-schedule-state');
 scheduling.append(effective);
 function scheduleValues(){
  return {work_status:workStatus.value||null,
   work_start:workStart.value?workStart.value===localDateTime(initialStart)&&initialStart ? initialStart:new Date(workStart.value).toISOString():null,
   work_end:workEnd.value?workEnd.value===localDateTime(initialEnd)&&initialEnd ? initialEnd:new Date(workEnd.value).toISOString():null};
 }
 const showState=()=>{effective.textContent=tr('Stato')+' · '+tr(stateLabels.get(workState(scheduleValues())));};
 showState();
 function flush(){
  const values={title:title.value,description:description.value,...scheduleValues()};
  chain=chain.then(async()=>{
   if(!box.contains(title))return;
   if(values.work_start&&values.work_end&&values.work_start>=values.work_end){
    failed=true;toast(tr('La fine deve essere successiva all’inizio.'));return;
   }
   if(Object.entries(values).every(([key,value])=>(key==='work_start'||key==='work_end')
    ?Date.parse(value)===Date.parse(current[key])||value==null&&current[key]==null
    :value===current[key])){failed=false;return;}
   status(tr('Salvataggio…'));
   try{current=await patch(current,values);failed=false;status(tr('Salvato'));}
   catch(e){failed=true;status(tr('Non salvato'));report(e);}
  });
  return chain;
 }
 for(const el of [title,description,workStatus,workStart,workEnd])el.oninput=()=>{
   showState();clearTimeout(timer);timer=setTimeout(flush,500);
 };
 $('dialog-footer').append(btn(tr('Aspetto'),async()=>{
  await closeModal();
  if(!dialogOpen)await toolSettings(current);
 }));
 if(current.kind==='note'){
  $('dialog-footer').append(btn(tr(current.regions?.length||current.strokes?.length?'Modifica area':'Evidenzia area'),async()=>{
   await closeModal();
   if(!dialogOpen)await startArea(current);
  }));
 }
 if(current.kind==='note'&&current.page===viewer.pageNumber&&canPlace()){
  $('dialog-footer').append(btn(tr('Sposta punto'),async()=>{
   await closeModal();
   if(dialogOpen)return;
   await pickNotePoint(current.page,tr('Nuova posizione della nota'),async point=>{
    if(!point)return;
    const after=await patch(current,{x:point[0],y:point[1]});
    record(current,after);
   });
  }));
 }
 $('dialog-footer').append(deleteAnnotationButton(async remove=>{
  deleting=true;
  title.disabled=description.disabled=true;
  clearTimeout(timer);
  try{
   await flush();
   if(failed||!box.contains(title))return;
   await remove(current, before);
  }finally{
   deleting=false;
   title.disabled=description.disabled=false;
  }
 }));
 addNoteNavigation(current);
}
async function startArea(note){
 await page(note.page);
 if(viewer.pageNumber!==note.page||!canPlace())return;
 mode(null);
 refreshLaser();
 const rect=viewer.rect();
 const regions=structuredClone(note.regions?.length?note.regions:
  legacyRegions(annotationStrokes(note),note.width,rect.w/rect.scale,rect.h/rect.scale));
 const ordered=[...(plan()?.decks||[])].sort((a,b)=>a.base-b.base);
 const index=ordered.findIndex(deck=>deck.page===note.page);
 const choices=decks=>[[0,tr('Nessuno')],...decks.map((deck,i)=>[i+1,deck.name])];
 selectOptions($('area-above'),choices(ordered.slice(0,index).reverse()));
 selectOptions($('area-below'),choices(ordered.slice(index+1)));
 $('area-above').value=String(Math.min(note.decks_above||0,index));
 $('area-below').value=String(Math.min(note.decks_below||0,ordered.length-index-1));
 $('area-tool').value='rectangle';
 areaSession={note,regions,vertices:[],tool:'rectangle',color:note.color};
 viewer.areaDraft=areaSession;
 areaSession.id=note.id;
 viewer.mode='area';
 $('area-banner').hidden=false;
 updateAreaControls();
 updatePages();
}

function updateAreaControls(){
 if(!areaSession)return;
 const {regions,vertices,tool,saving}=areaSession;
 $('area-count').textContent=tr('Forme')+' · '+regions.length;
 $('area-undo').disabled=Boolean(saving)||!(regions.length||vertices.length);
 $('area-clear').disabled=$('area-undo').disabled;
 $('area-finish').hidden=tool!=='polygon';
 $('area-finish').disabled=Boolean(saving)||vertices.length<3;
 for(const id of ['area-save','area-cancel','area-pan','area-color','area-tool','area-above','area-below'])$(id).disabled=Boolean(saving);
 $('area-color').value=areaSession.color;
 $('area-pan').setAttribute('aria-pressed',String(viewer.mode!=='area'));
 viewer.draw(false);
}

function addAreaStroke(points){
 if(!areaSession||areaSession.saving)return false;
 const region=finishRegion(points);
 if(!region)return false;
 const {regions}=areaSession;
 if(regions.length>=100||regions.reduce((count,ring)=>count+ring.length,0)+region.length>20000){
  toast(tr('Limite di forme raggiunto.'));
  return false;
 }
 areaSession.regions=[...regions,region];
 updateAreaControls();
 return true;
}

function addAreaVertex(point){
 if(!areaSession||areaSession.saving||areaSession.vertices.length>=2000)return;
 areaSession.vertices.push(point);
 updateAreaControls();
}

$('area-finish').onclick=()=>{
 if(!areaSession)return;
 if(!addAreaStroke(areaSession.vertices)){toast(tr('Punti del poligono non validi.'));return;}
 areaSession.vertices.length=0;
 updateAreaControls();
};
$('area-pan').onclick=()=>{
 if(!areaSession)return;
 viewer.mode=viewer.mode==='area'?null:'area';
 updateAreaControls();
};
$('area-tool').onchange=()=>{
 if(!areaSession)return;
 if(areaSession.vertices.length){$('area-tool').value=areaSession.tool;toast(tr('Chiudi il poligono o rimuovi i punti.'));return;}
 areaSession.tool=$('area-tool').value;
 viewer.mode='area';
 updateAreaControls();
};
$('area-color').oninput=()=>{if(areaSession){areaSession.color=$('area-color').value;updateAreaControls();}};
$('area-undo').onclick=()=>{
 if(!areaSession)return;
 if(areaSession.vertices.length)areaSession.vertices.pop();else areaSession.regions=areaSession.regions.slice(0,-1);
 updateAreaControls();
};
$('area-clear').onclick=()=>{if(areaSession){areaSession.regions=[];areaSession.vertices=[];updateAreaControls();}};
$('area-cancel').onclick=()=>{
 const note=areaSession?.note;
 stopArea();
 refreshList();
 if(note)openAnnotation(note).catch(report);
};
$('area-save').onclick=async()=>{
 const session=areaSession;
 if(!session||session.saving)return;
 if(session.vertices.length){toast(tr('Chiudi il poligono o rimuovi i punti.'));return;}
 session.saving=true;
 viewer.mode=null;
 updateAreaControls();
 try{
  const {note,regions,color}=session;
  const fields={regions,strokes:[],color,decks_above:regions.length?Number($('area-above').value):0,
   decks_below:regions.length?Number($('area-below').value):0};
  const after=await patch(note,fields);
  if(areaSession!==session)return;
  stopArea();
  record(note,after);
  refreshList();
  await openAnnotation(after);
 }catch(error){
  if(areaSession===session){session.saving=false;viewer.mode='area';updateAreaControls();}
  report(error);
 }
};
function addNoteNavigation(note){
 $('dialog-footer').append(btn(tr('Vai al punto'),async()=>{
  await closeModal();
  if(!dialogOpen)await goToNote(annotations.find(item=>item.id===note.id)||note);
 }));
 $('dialog-footer').append(btn(tr('Chiudi'),closeModal));
}
function deleteAnnotationButton(action){
 const group=text('div','','delete-annotation');
 const button=btn(tr('Elimina'),()=>{
  if(!canWrite())return;
  confirmation.hidden=false;
  button.hidden=true;
  cancel.focus();
 },'danger');
 const confirmation=text('div','','delete-confirmation');
 confirmation.hidden=true;
 confirmation.append(text('p',tr('Eliminare questa annotazione?')));
 const cancel=btn(tr('Annulla eliminazione'),()=>{
  confirmation.hidden=true;
  button.hidden=false;
  button.focus();
 });
 const remove=btn(tr('Conferma eliminazione'),async()=>{
  if(remove.disabled||!canWrite())return;
  remove.disabled=cancel.disabled=true;
  try{await action(removeAnnotation);}
  finally{remove.disabled=cancel.disabled=false;}
 },'danger');
 confirmation.append(cancel,remove);
 group.append(button,confirmation);
 return group;
}

async function removeAnnotation(annotation,before=annotation){
 const deleted=await patch(annotation,{deleted:true});
 record(before,annotation);
 record(annotation,deleted);
 dialogClose=null;
 await closeModal();
}

async function annotationMenu(annotation){
 if(!canWrite()||finishPick||areaSession)return;
 const box=modal(annotationHeading(annotation));
 box.append(btn(tr('Impostazioni aspetto'),async()=>{
  await closeModal();
  if(!dialogOpen)await toolSettings(annotation);
 }));
 box.append(deleteAnnotationButton(remove=>remove(annotation)));
}
async function toolSettings(existing=null){
 if(!canWrite()||finishPick||areaSession||(!existing&&!canPlace()))return;
 const choice=structuredClone(existing||viewer.settings.note);
 const hasRegion=Boolean(existing?.regions?.length);
 const hasArea=hasRegion||Boolean(existing&&annotationStrokes(existing).length);
 const box=modal(tr(existing?.kind==='highlight'?'Impostazioni evidenziatore':'Impostazioni nota'));
 const canvas=document.createElement('canvas');
 canvas.className='settings-preview';canvas.width=430;canvas.height=65;
 box.append(canvas);
 const color=field(box,tr('Colore'),{type:'color',value:choice.color});
 const customCategory=field(box,tr('Nome categoria'),{value:choice.custom_category||''});
 customCategory.maxLength=60;
 const categoryHint=text('p','','work-schedule-state');
 box.append(categoryHint);
 const options=text('div','','symbol-picker');

 function preview(){
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,430,65);
  if(hasRegion){
   viewer.drawRegions(ctx,{x:40,y:14,w:350,h:36},[[[0,0],[1,0],[1,1],[0,1]]],choice.color,false);
  }else if(hasArea){
   ctx.strokeStyle=choice.color;ctx.globalAlpha=choice.opacity/100;
   ctx.lineWidth=choice.width;ctx.lineCap='round';
   ctx.beginPath();ctx.moveTo(40,32);ctx.lineTo(390,32);ctx.stroke();
   ctx.globalAlpha=1;
  }
  marker(ctx,215,32,choice.color,choice.shape,existing?.number||1);
 }

 function updateSymbol(){
  customCategory.parentElement.hidden=!geometricSymbols[choice.shape];
  const category=noteCategory({...choice,custom_category:customCategory.value});
  categoryHint.textContent=category?categoryText(category):'';
  color.parentElement.hidden=!hasArea&&Boolean(emojiSymbols[choice.shape]);
  for(const button of options.children){
   const selected=button.dataset.symbol===choice.shape;
   button.classList.toggle('selected',selected);
   button.setAttribute('aria-pressed',String(selected));
  }
  preview();
 }

 customCategory.oninput=updateSymbol;
 color.oninput=()=>{choice.color=color.value;preview();};
 for(const [shape,label,custom] of noteShapes){
  const displayLabel=custom?label:tr(label);
  const button=btn('',()=>{choice.shape=shape;updateSymbol();},'symbol-choice');
  button.dataset.symbol=shape;
  button.title=displayLabel;
  button.setAttribute('aria-label',displayLabel);
  const icon=document.createElement('canvas');
  icon.width=icon.height=68;
  const ctx=icon.getContext('2d');ctx.scale(2,2);
  marker(ctx,17,17,'#2f529e',shape,null,11);
  button.append(icon,text('span',displayLabel));
  options.append(button);
 }
 box.append(options);
 if(hasArea&&!hasRegion){
  const width=field(box,tr('Spessore')+': '+choice.width,{type:'range',value:choice.width,min:2,max:60,step:1});
  width.oninput=()=>{
   choice.width=Number(width.value);
   width.parentElement.firstChild.textContent=tr('Spessore')+': '+choice.width;
   preview();
  };
  const alpha=field(box,tr('Trasparenza')+': '+(100-choice.opacity)+'%',{type:'range',value:100-choice.opacity,min:0,max:100,step:1});
  alpha.oninput=()=>{
   choice.opacity=100-Number(alpha.value);
   alpha.parentElement.firstChild.textContent=tr('Trasparenza')+': '+alpha.value+'%';
   preview();
  };
 }
 updateSymbol();
 $('dialog-footer').append(btn(tr('Applica'),async()=>{
  const changes={shape:choice.shape,custom_category:geometricSymbols[choice.shape]?customCategory.value.trim()||null:null};
  if(hasArea||!emojiSymbols[choice.shape])changes.color=choice.color;
  if(hasArea&&!hasRegion){changes.width=choice.width;changes.opacity=choice.opacity;}
  if(existing){
   const after=await patch(existing,changes);
   record(existing,after);
  }else{
   Object.assign(viewer.settings.note,changes);
   localStorage.setItem('sw.tools',JSON.stringify(viewer.settings));
  }
  await closeModal();
 },'primary'));
}
$('note-settings').onclick=()=>toolSettings().catch(report);
async function travel(isRedo){if(!canWrite()||finishPick||areaSession)return;const from=isRedo?redo:undo,to=isRedo?undo:redo,item=from.at(-1);if(!item||loading)return;const current=annotations.find(a=>a.id===item.id);if(!current||current.version!==item.expected)throw Error(tr('Annotazione aggiornata da un altro utente: impossibile annullare senza sovrascriverla.'));const result=await patch(current,isRedo?item.after:item.before);from.pop();to.push({...item,expected:result.version});const previous=from.findLast(entry=>entry.id===item.id);if(previous&&JSON.stringify(snapshot(result))===JSON.stringify(isRedo?previous.before:previous.after))previous.expected=result.version;updatePages();}
$('undo').onclick=()=>travel(false).catch(report);$('redo').onclick=()=>travel(true).catch(report);
function peopleSearch(box,{includeEmail=false}={}){
 const search=document.createElement('input');
 search.type='search';
 search.className='people-search';
 search.placeholder=tr(includeEmail?'Cerca per nome o email…':'Cerca utenti per nome…');
 search.setAttribute('aria-label',search.placeholder);
 const list=text('div','','people-list');
 const empty=text('p',tr('Nessun utente trovato.'),'people-empty');
 const entries=[];
 function update(){
  const query=normalizeSearch(search.value).trim();
  let matches=0;
  for(const {name,key,row,label,email,emailLabel} of entries){
   row.hidden=!key.includes(query)&&!normalizeSearch(email).includes(query);
   if(row.hidden)continue;
   highlightMatch(label,name,query);
   if(emailLabel)highlightMatch(emailLabel,email,query);
   matches++;
  }
  empty.hidden=matches>0;
 }
 search.addEventListener('input',update);
 box.append(search,list,empty);
 return {
  append(name,row,label,email='',emailLabel=null){entries.push({name,key:normalizeSearch(name),row,label,email,emailLabel});list.append(row);},
  update,
  get query(){return search.value;},
  set query(value){search.value=value;update();}
 };
}

$('categories-button').onclick=()=>manageWorkCatalog().catch(report);
async function manageWorkCatalog(){
 if(!canConfigure())return;
 await refreshWorkCatalog();
 if(!canConfigure())return;
 const box=modal(tr('Categorie ed emoji'));
 const tabs=text('div','','tabs');
 const names=text('section'),emoji=text('section');
 const feedback=text('p','','muted catalog-status');
 feedback.setAttribute('role','status');
 const selectTab=showEmoji=>{
  names.hidden=showEmoji;emoji.hidden=!showEmoji;feedback.textContent='';
  namesTab.classList.toggle('selected',!showEmoji);
  emojiTab.classList.toggle('selected',showEmoji);
  namesTab.setAttribute('aria-pressed',String(!showEmoji));
  emojiTab.setAttribute('aria-pressed',String(showEmoji));
 };
 const namesTab=btn(tr('Categorie'),()=>selectTab(false));
 const emojiTab=btn(tr('Aggiungi emoji'),()=>selectTab(true));
 tabs.append(namesTab,emojiTab);
 box.append(tabs,feedback,names,emoji);
 const categorySelect=document.createElement('select');
 const categoryField=text('label',tr('Categoria'));
 categoryField.append(categorySelect);
 const updateOptions=()=>selectOptions(categorySelect,workCategories.map(([id,icon])=>[id,icon+' '+categoryLabel(id,tr)]));
 async function save(button,operation,onSave){
  if(!canConfigure()||button.disabled)return;
  button.disabled=true;
  try{
   await operation();
   await refreshWorkCatalog();
   if(box.contains(button)){
    onSave();
    feedback.textContent=tr('Modifiche salvate.');
   }
  }catch(error){feedback.textContent=tr(error.message);}
  finally{button.disabled=false;}
 }
 for(const [id,icon] of workCategories){
  const row=text('div','','catalog-row');
  const name=field(row,icon+' '+tr('Nome categoria'),{value:categoryLabel(id,tr)});
  name.maxLength=60;
  const button=btn(tr('Salva'),()=>save(button,async()=>{
   const value=name.value.trim();
   if(!value)throw Error(tr('Inserisci un nome.'));
   if(value===categoryLabel(id,tr))return;
   const rows=await api.table('sw_work_categories','id=eq.'+id,{method:'PATCH',body:{name:value}});
   if(!rows.length)throw Error(tr('Operazione non riuscita'));
  },()=>{name.value=categoryLabel(id,tr);updateOptions();}));
  name.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();button.click();}};
  row.append(button);names.append(row);
 }
 const glyph=field(emoji,tr('Emoji'));
 glyph.maxLength=48;
 const name=field(emoji,tr('Nome emoji'));
 name.maxLength=60;
 updateOptions();
 const added=text('div','','catalog-emoji-list');
 function renderAdded(){
  added.replaceChildren(...noteShapes.filter(entry=>entry[2]).map(([id,label])=>text('span',emojiSymbols[id]+' '+label)));
 }
 renderAdded();
 const add=btn(tr('Aggiungi emoji'),()=>save(add,async()=>{
  const value=glyph.value.trim(), label=name.value.trim();
  const pictograph=/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
  if(!pictograph.test(value)||[...new Intl.Segmenter().segment(value)].length!==1)throw Error(tr('Inserisci una sola emoji.'));
  const identity=value.replaceAll('\ufe0f','');
  if(Object.values(emojiSymbols).some(emoji=>emoji.replaceAll('\ufe0f','')===identity))throw Error(tr('Questa emoji è già disponibile.'));
  if(!label)throw Error(tr('Inserisci un nome.'));
  await api.table('sw_work_emoji','',{method:'POST',body:{category_id:categorySelect.value,glyph:value,name:label}});
 },()=>{glyph.value='';name.value='';renderAdded();}),'primary');
 emoji.append(categoryField,add,added);
 selectTab(false);
}

$('users-button').onclick=()=>manageUsers().catch(report);
async function manageUsers(query=''){
 if(!profile?.approved||profile.role!=='super_admin')return;
 const box=modal(tr('Utenti'));
 const container=text('div','');
 box.append(container);
 const rows=await api.rpc('sw_manage_users_list',{});
 if(!container.isConnected||!dialogOpen)return;
 const search=peopleSearch(container,{includeEmail:true});
 for(const p of rows){
  const row=text('div','','user-row'),summary=text('span',''),name=text('strong',p.full_name);
  summary.append(name,text('small',tr(roles[p.role])+' · '+(tr(p.approved?'Abilitato':'In attesa'))));
  const email=p.email?text('small',p.email,'user-email'):null;
  if(email)summary.append(email);
  row.append(summary);
  const actions=text('div','','user-actions');
  actions.append(btn(tr('Cambia nome'),async()=>{
   await closeModal();
   if(!dialogOpen)await renameUser(p,search.query);
  }));
  if(p.id!==user.id){
   const role=document.createElement('select');
   role.setAttribute('aria-label',tr('Ruolo di')+' '+p.full_name);
   role.append(...Object.entries(roles).map(([key,label])=>new Option(tr(label),key)));
   role.value=p.role;
   role.onchange=async()=>{
    const newRole=role.value;
    if(!confirm(tr('Assegnare il ruolo')+' '+tr(roles[newRole])+' '+tr('a')+' '+p.full_name+'?')){role.value=p.role;return;}
    role.disabled=true;
    try{await api.rpc('sw_set_role',{target:p.id,new_role:newRole});await closeModal();await manageUsers(search.query);}
    catch(e){role.value=p.role;report(e);}finally{role.disabled=false;}
   };
   actions.append(role,btn(tr(p.approved?'Disabilita':'Approva'),async()=>{
    await api.rpc('sw_set_approval',{target:p.id,allow_access:!p.approved});
    await closeModal();
    await manageUsers(search.query);
   },p.approved?'':'primary'));
  }
  row.append(actions);
  search.append(p.full_name,row,name,p.email||'',email);
 }
 search.query=query;
}
async function renameUser(person,query){
 if(!profile?.approved||profile.role!=='super_admin')return;
 const box=modal(tr('Cambia nome'));
 const name=field(box,tr('Nome e cognome'),{value:person.full_name});
 name.minLength=2;name.maxLength=120;name.required=true;
 const save=btn(tr('Salva'),async()=>{
  if(save.disabled)return;
  const fullName=name.value.trim();
  if(fullName.length<2||fullName.length>120){
   toast(tr('Inserisci un nome da 2 a 120 caratteri.'));
   return;
  }
  save.disabled=name.disabled=true;
  dialogClose=()=>false;
  try{
   await api.rpc('sw_rename_user',{target:person.id,new_full_name:fullName});
   if(person.id===user?.id&&profile){
    profile={...profile,full_name:fullName};
    document.querySelectorAll('.user-name').forEach(el=>el.textContent=fullName);
   }
   if(!box.contains(name))return;
   dialogClose=null;
   await closeModal();
   toast(tr('Salvato'));
   const nextQuery=normalizeSearch(person.full_name).includes(normalizeSearch(query).trim())&&
    !normalizeSearch(fullName).includes(normalizeSearch(query).trim())?fullName:query;
   await manageUsers(nextQuery);
  }finally{
   if(box.contains(name))dialogClose=null;
   save.disabled=name.disabled=false;
  }
 },'primary');
 $('dialog-footer').append(btn(tr('Annulla selezione'),async()=>{await closeModal();if(!dialogOpen)await manageUsers(query);}),save);
 name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save.click();}});
 name.focus();
}
function dismissNoteSession(){
 cancelPick();
 dialogClose=null;
 dialogOpen=false;
 $('dialog').close();
 $('dialog-body').replaceChildren();
 $('dialog-footer').replaceChildren();
}
function scheduleRefresh(){
 if(refreshTimer||!pendingSync.size||document.hidden||!api.getSession())return;
 refreshTimer=setTimeout(()=>{
  refreshTimer=null;
  void syncVisible();
 },180);
}

function queueRefresh(scope='all'){
 pendingSync.add(typeof scope==='string'?scope:'all');
 scheduleRefresh();
}

function onRealtimeChange(change){
 if(!change?.table){queueRefresh();return;}
 const row=change.record||change.old_record||{};
 if(change.table==='sw_annotations'){
  if(activeDocument&&(!row.document_id||row.document_id===activeDocument.id))queueRefresh('annotations');
 }else if(change.table==='sw_profiles'){
  if(!row.id||row.id===user?.id)queueRefresh();
 }else if(change.table==='sw_documents'){
  if(activeDocument&&(!row.project_id||row.project_id===project?.id))queueRefresh();
 }else if(change.table==='sw_work_categories'||change.table==='sw_work_emoji'){
  queueRefresh('catalog');
 }else if(change.table==='sw_projects'&&!$('projects').hidden)queueRefresh();
}
async function syncVisible(){
 if(document.hidden||!api.getSession()||!user||!pendingSync.size||!checkInactivity())return;
 if(polling||loading||setupLoading){scheduleRefresh();return;}
 const busy=dialogOpen||finishPick||areaSession;
 const full=pendingSync.has('all');
 const catalog=pendingSync.has('catalog');
 const notes=pendingSync.has('annotations');
 if(busy&&!full)return;
 pendingSync.clear();
 polling=true;const token=epoch,revision=annotationRevision;
 try{
  if(catalog||full){
   await refreshWorkCatalog().catch(()=>{lastSafetyCheck=0;});
   if(token!==epoch)return;
   if(catalog&&!full)refreshList();
  }
  if(!full){
   if(!notes||!activeDocument)return;
   const id=activeDocument.id;
   const rows=await api.table('sw_annotations','document_id=eq.'+id+'&select=*&order=created_at.asc');
   if(token!==epoch)return;
   if(dialogOpen||finishPick||areaSession||revision!==annotationRevision){pendingSync.add('annotations');return;}
   annotations=rows;
   refreshList();
   status(tr('Sincronizzato'));
   return;
  }
  lastSafetyCheck=Date.now();
  const [mine]=await api.table('sw_profiles','id=eq.'+user.id+'&select=*');
  if(token!==epoch)return;
  const wasApproved=profile?.approved;profile=mine;applyRole();
  if(!mine?.approved){dismissNoteSession();epoch++;await clearShipSetup();project=null;projectLevel=null;activeDocument=null;annotations=[];projects=[];viewer.clear();await pdf?.destroy();pdf=null;screen('waiting');return;}
  if(!wasApproved){await restore();return;}
  if(activeDocument&&(dialogOpen||finishPick||areaSession)){
   pendingSync.add('annotations');
   const level=await api.rpc('sw_project_level',{target:project.id});
   if(token!==epoch)return;
   if(!level){dismissNoteSession();await showProjects();toast(tr('Accesso al progetto revocato.'));return;}
   if(level!==projectLevel){dismissNoteSession();projectLevel=level;refreshList();}
   return;
  }
  if(dialogOpen||finishPick||areaSession)return;
  if((!$('ship-setup').hidden&&!canConfigure())||(!$('documents').hidden&&!canManage())){await showProjects();return;}
  if(!$('projects').hidden){const rows=await api.table('sw_projects','select=*&order=created_at.desc');if(token===epoch&&!dialogOpen){projects=rows;renderProjects();}}
  else if(activeDocument){
   const id=activeDocument.id;
   const [level,[updated],rows]=await Promise.all([
    api.rpc('sw_project_level',{target:project.id}),
    api.table('sw_documents','id=eq.'+id+'&ship_plan=not.is.null&select=*'),
    api.table('sw_annotations','document_id=eq.'+id+'&select=*&order=created_at.asc')
   ]);
   if(token!==epoch)return;
   if(!level){await showProjects();toast(tr('Accesso al progetto revocato.'));return;}
   if(!updated){await enterProject(project);return;}
   if(!dialogOpen&&!finishPick&&!areaSession){projectLevel=level;activeDocument=updated;if(revision===annotationRevision)annotations=rows;else pendingSync.add('annotations');refreshList();status(tr('Sincronizzato'));}
   else pendingSync.add('annotations');
  }
 }catch(e){lastSafetyCheck=0;status(tr('Riconnessione…'));}finally{polling=false;if(!(dialogOpen||finishPick||areaSession)||pendingSync.has('all'))scheduleRefresh();}
}
setInterval(()=>{
 if(document.hidden||!api.getSession())return;
 if(!realtimeConnected||Date.now()-lastSafetyCheck>=60000)queueRefresh();
},15000+Math.floor(Math.random()*5000));
window.addEventListener('online',()=>{if(!document.hidden&&checkInactivity()){refreshList();queueRefresh();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&checkInactivity()){refreshList();queueRefresh();}});
window.addEventListener('offline',()=>toast(tr('Connessione assente. Le nuove modifiche richiedono Internet.')));
registerStatic();
translateStatic();
updateToolbarToggle();
$('language').value=locale().startsWith('en')?'en':'it';
$('language').onchange=()=>{
 setLanguage($('language').value);
 translateStatic();
 updateToolbarToggle();
 if(!$('auth').hidden&&!dialogOpen)setAuthMode(authMode);
 if(!$('projects').hidden)renderProjects();
 if(!$('documents').hidden)showProjectSettings(project).catch(report);
 if(!$('workspace').hidden){refreshList();status('');}
};
window.addEventListener('beforeunload',e=>{if(dialogOpen||areaSession){e.preventDefault();e.returnValue='';}});
try{const callback=api.authCallback();if(callback)startIdleSession();if(callback==='recovery'){screen('auth');const box=modal(tr('Nuova password')),password=field(box,tr('Password (almeno 10 caratteri)'),{type:'password'});$('dialog-footer').append(btn(tr('Aggiorna'),async()=>{if(password.value.length<10)throw Error(tr('Usa almeno 10 caratteri.'));await api.request('/auth/v1/user',{method:'PUT',body:{password:password.value}});await closeModal();await restore();},'primary'));}else if(checkInactivity()||!api.getSession())await restore();}catch(e){$('auth-error').textContent=tr(e.message);}
