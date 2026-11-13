import {tr, locale, setLanguage, registerStatic, translateStatic} from './locale.js';
import {projectCover} from './cards.js';
import {watchChanges} from './realtime.js';
import * as api from './api.js';
import {Viewer,loadPdf,marker} from './viewer.js';
import {snapshot,grouped,clamp,annotationStrokes} from './model.js';
import {filterNotes,noteShapes,projectMarks,shipPageOrder,emojiSymbols,longitudinalScale,mapDeckView,placeLaser,laserOnPage} from './ship-model.js';
import {editShipPlan} from './ship-editor.js';
const $=id=>document.getElementById(id),screens=['auth','waiting','projects','documents','workspace','ship-setup'];
let stopRealtime=null,refreshTimer;
let user,profile,projects=[],project,projectLevel,activeDocument,annotations=[],pdf,authMode='login',dialogClose=null,dialogOpen=false,polling=false,epoch=0;
let all=localStorage.getItem('sw.all')==='true',panelWidth=Number(localStorage.getItem('sw.panelWidth'))||290,panelHidden=false,undo=[],redo=[],loading=false;
const roles = {super_admin:'Super admin', admin:'Admin', member:'Utente', viewer:'Visualizzatore'};
const canManage = () => profile?.approved && ['super_admin','admin'].includes(profile.role);
const canWrite = () => profile?.approved && projectLevel==='edit';
const canConfigure = () => profile?.approved && profile.role==='super_admin';
const plan = () => activeDocument?.ship_plan;
const isOverview = () => plan()?.overview.page === viewer.pageNumber;
const canPlace = () => canWrite() && Boolean(plan()?.decks.some(deck=>deck.page===viewer.pageNumber));
const pageName = n => plan()?.overview.page===n ? 'General Overview' : plan()?.decks.find(deck=>deck.page===n)?.name || tr('Pagina')+' '+n;
const phoneLayout=matchMedia('(max-width:600px), (orientation:landscape) and (max-height:550px)');
const filterIds = ['notes-query','notes-page','notes-kind','notes-author','notes-day'];
let finishPick = null;
let areaSession = null;
let lastDeckView = null;
let laser = null;
const viewer=new Viewer($('viewport'),$('pdf-canvas'),$('marks-canvas'),{create:a=>makeAnnotation(a).catch(report),edit:items=>openMarkers(items).catch(report),error:report,laser:setLaserPoint,stroke:addAreaStroke});
const setupViewer=new Viewer($('setup-viewport'),$('setup-pdf'),$('setup-marks'),{error:report});
let setupPdf,closeSetup,setupLoading=false;
$('setup-fit').onclick=()=>setupViewer.fit();
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
function btn(label,action,cls){const b=text('button',label,cls);b.type='button';b.onclick=()=>Promise.resolve().then(action).catch(report);return b;}
function report(e){toast(tr(e?.message||String(e)));}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function screen(name){screens.forEach(id=>$(id).hidden=id!==name);}
function status(value){$('sync-state').textContent=value;}
function date(value){return new Date(value).toLocaleString(locale(),{dateStyle:'short',timeStyle:'short'});}
function mode(value){if(value&&laser){laser=null;refreshLaser();}if(phoneLayout.matches)$('mobile-tools').open=false;viewer.mode=canPlace()&&!finishPick&&viewer.mode!==value?value:null;$('note-tool').classList.toggle('active',viewer.mode==='note');}
function modal(title,onClose=null){if($('dialog').open)throw Error(tr('Chiudi prima la finestra aperta.'));dialogOpen=true;dialogClose=onClose;$('dialog-title').textContent=title;$('dialog-body').replaceChildren();$('dialog-footer').replaceChildren();$('dialog').showModal();return $('dialog-body');}
async function closeModal(){if(dialogClose&&await dialogClose()===false)return;dialogClose=null;dialogOpen=false;$('dialog').close();queueRefresh();}
$('dialog-close').onclick=()=>closeModal().catch(report);$('dialog').addEventListener('cancel',e=>{e.preventDefault();closeModal().catch(report);});$('dialog-form').onsubmit=e=>e.preventDefault();
function field(parent,title,{value='',type='text',multiline=false,min,max,step}={}){const label=text('label',title),input=document.createElement(multiline?'textarea':'input');if(!multiline)input.type=type;input.value=value;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;label.append(input);parent.append(label);return input;}
function setAuthMode(value){authMode=value;$('name-field').hidden=value!=='signup';$('full-name').required=value==='signup';$('signup-hint').hidden=value!=='signup';$('password').autocomplete=value==='signup'?'new-password':'current-password';$('auth-title').textContent=tr(value==='signup'?'Crea il tuo account':'Accedi al tuo spazio');$('auth-submit').textContent=tr(value==='signup'?'Registrati →':'Accedi →');$('login-tab').classList.toggle('selected',value==='login');$('signup-tab').classList.toggle('selected',value==='signup');$('auth-error').textContent='';}
$('login-tab').onclick=()=>setAuthMode('login');$('signup-tab').onclick=()=>setAuthMode('signup');
$('auth-form').onsubmit=async e=>{e.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';try{if(authMode==='signup'){await api.signUp($('email').value.trim(),$('password').value,$('full-name').value.trim());if(!api.getSession()){$('auth-error').textContent=tr('Controlla la tua email per confermare la registrazione. Poi accedi per verificare l’approvazione.');$('password').value='';return;}}else await api.signIn($('email').value.trim(),$('password').value);$('password').value='';await restore();}catch(e){$('auth-error').textContent=tr(e.message);}finally{$('auth-submit').disabled=false;}};
$('reset-password').onclick=async()=>{const email=$('email').value.trim();if(!email||!$('email').checkValidity()){toast(tr('Inserisci la tua email.'));return;}try{await api.request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:{email},anonymous:true});toast(tr('Se l’account esiste, riceverai il link per reimpostare la password.'));}catch(e){report(e);}};
async function restore(){if(!api.getSession()){stopRealtime?.();stopRealtime=null;screen('auth');return;}try{user=await api.request('/auth/v1/user');const rows=await api.table('sw_profiles','id=eq.'+user.id+'&select=*');profile=rows[0];stopRealtime?.();stopRealtime=watchChanges(queueRefresh);if(!profile)throw Error(tr('Profilo non disponibile. La configurazione del database deve essere completata.'));if(!profile.approved){screen('waiting');return;}document.querySelectorAll('.user-name').forEach(el=>el.textContent=profile.full_name);applyRole();await showProjects();}catch(e){screen('auth');$('auth-error').textContent=tr(e.message);}}
async function logout(){cancelPick();if(dialogOpen&&!await tryClose())return;stopRealtime?.();stopRealtime=null;epoch++;await clearShipSetup();project=null;projectLevel=null;activeDocument=null;viewer.clear();await pdf?.destroy();pdf=null;await api.signOut();profile=user=null;annotations=[];projects=[];screen('auth');}
async function tryClose(){await closeModal();return !dialogOpen;}
document.querySelectorAll('.logout').forEach(b=>b.onclick=()=>logout().catch(report));$('check-approval').onclick=()=>restore().catch(report);
async function showProjects(){epoch++;await clearShipSetup();project=null;projectLevel=null;activeDocument=null;viewer.clear();await pdf?.destroy();pdf=null;undo=[];redo=[];screen('projects');$('project-list').replaceChildren(text('div',tr('Caricamento…'),'empty'));projects=await api.table('sw_projects','select=*&order=created_at.desc');renderProjects();}
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
 if(!canManage())return;
 const box=modal(tr(existing?'Modifica progetto':'Nuovo progetto'));
 const title=field(box,tr('Nome progetto'),{value:existing?.title||''});
 title.maxLength=180;
 const start=field(box,tr('Inizio'),{type:'date',value:existing?.start_date||''});
 const end=field(box,tr('Fine'),{type:'date',value:existing?.end_date||''});
 const file=field(box,tr('Immagine di copertina'),{type:'file'});
 file.accept='image/jpeg,image/png,image/webp';
 const remove=existing?.cover_image?field(box,tr('Rimuovi copertina'),{type:'checkbox'}):null;
 const submit=btn(tr(existing?'Salva progetto':'Crea progetto'),async()=>{
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
  for(const draft of rows.filter(doc=>!doc.ship_plan&&doc.page_count>1)){
   box.append(btn(tr('Configura PDF già caricato')+' · '+draft.title,()=>startShipSetup(draft,current?.id||null)));
  }
 }
}

$('project-access').onclick=()=>manageProjectAccess().catch(report);
async function manageProjectAccess(){
 if(!canManage()||!project)return;
 const projectId=project.id;
 const box=modal(tr('Accessi al progetto'));
 const [people,access]=await Promise.all([
  api.table('sw_profiles','approved=eq.true&role=in.(member,viewer)&select=id,full_name&order=full_name'),
  api.table('sw_project_access','project_id=eq.'+projectId)
 ]);
 if(!dialogOpen||!box.isConnected)return;
 const levels=new Map(access.map(row=>[row.user_id,row.access_level]));
 if(!people.length)box.append(text('p',tr('Nessun utente approvato da assegnare.')));
 for(const person of people){
  const row=text('label',person.full_name,'access-row');
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
  row.append(select);box.append(row);
 }
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

async function openDocument(p){lastDeckView=null;laser=null;const token=++epoch;loading=true;activeDocument=p;annotations=[];undo=[];redo=[];viewer.clear();screen('workspace');$('document-title').textContent=p.title;status(tr('Apertura…'));applyPanel();try{const [blob,rows]=await Promise.all([api.pdfDownload(p.file_path),api.table('sw_annotations','document_id=eq.'+p.id+'&select=*&order=created_at.asc')]);if(token!==epoch)return;await pdf?.destroy();pdf=await loadPdf(new Uint8Array(await blob.arrayBuffer()));if(token!==epoch){await pdf.destroy();return;}annotations=rows;await viewer.open(pdf,plan()?.overview.page||1);
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
  if(mapped&&source!==overview)lastDeckView={y:view.y,pixelsPerMeter:mapped.pixelsPerMeter};
  mode(null);
  await viewer.page(n);
  if(viewer.pageNumber!==n)return;
  const visibleWidth=visiblePlanWidth();
  const beam=keepPosition&&laser&&target?laserOnPage(ship,n,laser):null;
  const beamVisible=beam?.x>=0&&beam?.x<=1;
  if(target&&target===overview){
   viewer.centerView(beamVisible?beam.x:mapped?clamp(mapped.x,0,1):.5,.5,{visibleWidth,fitHeight:true});
  }else if(mapped){
   const deckView=lastDeckView;
   const width=deckView?deckView.pixelsPerMeter/Math.abs(longitudinalScale(target)):undefined;
   viewer.centerView(beamVisible?beam.x:clamp(mapped.x,0,1),beamVisible?beam.y:clamp(deckView?.y??.5,0,1),{visibleWidth,width});
  }
  refreshList();
 }finally{loading=false;}
}
function applyRole(){
 $('users-button').hidden=profile?.role!=='super_admin';
 $('new-project').hidden=$('edit-project').hidden=$('project-access').hidden=!canManage();
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
 $('mobile-tools').hidden=!writable;
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
$('fit').onclick=()=>{
 if(!isOverview()){viewer.fit();return;}
 const visibleWidth=visiblePlanWidth();
 const view=viewer.viewCenter(visibleWidth);
 viewer.centerView(clamp(view?.x??.5,0,1),.5,{visibleWidth,fitHeight:true});
};$('note-tool').onclick=()=>mode('note');
function applyPanel(){const available=$('workspace-body').clientWidth;const width=clamp(panelWidth,160,Math.max(160,available-180));$('notes-panel').hidden=panelHidden;$('notes-panel').style.width=width+'px';$('workspace-body').style.setProperty('--notes-width',width+'px');$('panel-toggle').setAttribute('aria-expanded',String(!panelHidden));$('mobile-notes').setAttribute('aria-expanded',String(!panelHidden));$('panel-toggle').textContent=panelHidden?'◂':'▸';}
function toggleNotes(){panelHidden=!panelHidden;applyPanel();}
$('panel-toggle').onclick=$('mobile-notes').onclick=toggleNotes;
phoneLayout.addEventListener('change',()=>{panelHidden=phoneLayout.matches;$('mobile-tools').open=!phoneLayout.matches;applyPanel();});
$('mobile-tools').open=!phoneLayout.matches;
$('workspace-body').addEventListener('pointerdown',e=>{if(e.target.closest('#viewport'))$('mobile-tools').open=!phoneLayout.matches;});
$('mobile-tools').addEventListener('click',e=>{if(phoneLayout.matches&&e.target.closest('button'))$('mobile-tools').open=false;});
let resizeStart;
$('divider').onpointerdown=e=>{if(e.target===$('panel-toggle')||panelHidden)return;e.preventDefault();$('divider').setPointerCapture(e.pointerId);resizeStart={x:e.clientX,width:$('notes-panel').offsetWidth};};$('divider').onpointermove=e=>{if(resizeStart){panelWidth=clamp(resizeStart.width+resizeStart.x-e.clientX,160,Math.max(160,$('workspace-body').clientWidth-180));applyPanel();}};$('divider').onpointerup=$('divider').onpointercancel=()=>{if(resizeStart)localStorage.setItem('sw.panelWidth',panelWidth);resizeStart=null;};$('divider').onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();panelWidth+=e.key==='ArrowLeft'?15:-15;applyPanel();localStorage.setItem('sw.panelWidth',panelWidth);}};
window.addEventListener('resize',applyPanel);$('toolbar-toggle').onclick=()=>{$('toolbar').hidden=!$('toolbar').hidden;$('toolbar-toggle').textContent=$('toolbar').hidden?'▾':'▴';};
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

function refreshList(){
 if(!activeDocument||!pdf) return;
 const overview=isOverview();
 const order=shipPageOrder(plan(),pdf.numPages);
 selectOptions($('notes-page'),[['',tr('Tutte')],...order.map(n=>[n,pageName(n)])]);
 selectOptions($('notes-kind'),[['',tr('Tutti')],...noteShapes.map(([key,label])=>[key,emojiSymbols[key]||({circle:'●',square:'■',diamond:'◆',triangle:'▲'})[key]+' '+tr(label)]),['highlight',tr('Evidenziazione')]]);
 const authors=new Map(annotations.filter(a=>!a.deleted).map(a=>[a.created_by,a.author_name]));
 selectOptions($('notes-author'),[['',tr('Tutti')],...[...authors].sort((a,b)=>a[1].localeCompare(b[1],locale()))]);
 const [query,pageFilter,kind,author,day]=filterIds.map(id=>$(id).value);
 const filtered=filterNotes(annotations,{query,page:pageFilter,kind,author,day});
 const projected=overview?projectMarks(plan(),filtered):[];
 const marks=overview?[...filtered.filter(a=>a.page===viewer.pageNumber),...projected]:filtered;
 refreshLaser(false);
 viewer.setMarks(marks);
 const projectedIds=new Set(projected.map(a=>a.id));
 const showAll=all||!!pageFilter;
 const list=overview&&!showAll
  ? grouped(filtered.filter(a=>projectedIds.has(a.id)||a.page===viewer.pageNumber),viewer.pageNumber,true)
  : grouped(filtered,viewer.pageNumber,showAll);
 if(plan())list.sort((a,b)=>order.indexOf(a.page)-order.indexOf(b.page));
 selectOptions($('notes-scope'),[['current',tr(overview?'Overview':'Ponte attuale')],['all',tr('Tutte')]]);
 $('notes-scope').value=all?'all':'current';
 $('notes-list').replaceChildren();
 let previous=-1;
 for(const a of list){
  if((showAll||overview)&&a.page!==previous){
   $('notes-list').append(text('div',pageName(a.page),'page-group'));
   previous=a.page;
  }
  const row=text('div','','annotation'),open=btn('',()=>openListedNote(a),'annotation-open');
  open.append(text('span',a.title||(a.kind==='note'?tr('Nota')+' '+a.number:tr('Evidenziazione')),'annotation-title'));
  if(a.description)open.append(text('span',a.description,'annotation-description'));
  open.append(text('span',a.author_name+' · '+date(a.created_at),'annotation-author'));
  const b=badge(a);
  b.onclick=()=>openListedNote(a).catch(report);
  row.append(b,open);
  if(canWrite())row.append(btn('⋮',()=>annotationMenu(a),'more'));
  $('notes-list').append(row);
 }
 if(!list.length)$('notes-list').append(text('div',tr('Nessuna annotazione'),'empty'));
 updatePages();
}
function merge(a){
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
 if(!canWrite())await openAnnotation(note);
}

function annotationHeading(annotation){
 const type=tr(annotation.kind==='note'?'Nota':'Evidenziazione');
 return annotation.number==null?type:type+' '+annotation.number;
}

async function openMarkers(hits){
 if(dialogOpen||finishPick||loading||areaSession)return;
 const byId=new Map(annotations.filter(item=>!item.deleted).map(item=>[item.id,item]));
 const items=[...new Set(hits.map(item=>item.id))].map(id=>byId.get(id)).filter(Boolean);
 if(!items.length)return;
 if(items.length===1){await openMarker(items[0]);return;}
 const box=modal(tr('Elementi in questa zona'));
 for(const item of items){
  const choice=btn('',async()=>{
   await closeModal();
   await openMarker(item);
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
 const [points]=annotationStrokes(note);
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
 function flush(){
  const values={title:title.value,description:description.value};
  chain=chain.then(async()=>{
   if(!box.contains(title))return;
   if(values.title===current.title&&values.description===current.description){failed=false;return;}
   status(tr('Salvataggio…'));
   try{current=await patch(current,values);failed=false;status(tr('Salvato'));}
   catch(e){failed=true;status(tr('Non salvato'));report(e);}
  });
  return chain;
 }
 for(const el of [title,description])el.oninput=()=>{clearTimeout(timer);timer=setTimeout(flush,500);};
 $('dialog-footer').append(btn(tr('Aspetto'),async()=>{
  await closeModal();
  if(!dialogOpen)await toolSettings(current);
 }));
 if(current.kind==='note'){
  $('dialog-footer').append(btn(tr(current.strokes?.length?'Modifica area':'Evidenzia area'),async()=>{
   await closeModal();
   if(!dialogOpen)await startArea(current);
  }));
 }
 if(current.kind==='note'&&!current.strokes?.length&&current.page===viewer.pageNumber&&canPlace()){
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
 laser=null;
 refreshLaser();
 const strokes=structuredClone(note.strokes||[]);
 const style=strokes.length?note:viewer.settings.highlight;
 areaSession={note,strokes,color:strokes.length?note.color:style.color,width:style.width,opacity:strokes.length?note.opacity:style.opacity};
 viewer.areaDraft={...areaSession,id:note.id};
 viewer.mode='area';
 $('area-banner').hidden=false;
 updateAreaControls();
 updatePages();
}

function updateAreaControls(){
 if(!areaSession)return;
 const {strokes,saving}=areaSession;
 $('area-count').textContent=tr('Tratti')+': '+strokes.length;
 $('area-undo').disabled=Boolean(saving)||!strokes.length;
 $('area-clear').disabled=$('area-undo').disabled;
 for(const id of ['area-save','area-cancel','area-pan','area-color'])$(id).disabled=Boolean(saving);
 $('area-color').value=viewer.areaDraft.color;
 $('area-pan').setAttribute('aria-pressed',String(viewer.mode!=='area'));
 viewer.draw(false);
}

function addAreaStroke(points){
 if(!areaSession||areaSession.saving||points.length<2)return;
 const {strokes}=areaSession;
 if(strokes.length>=100||strokes.reduce((count,stroke)=>count+stroke.length,0)+points.length>20000){
  toast(tr('Limite di tratti raggiunto.'));
  return;
 }
 strokes.push(points);
 updateAreaControls();
}

$('area-pan').onclick=()=>{
 if(!areaSession)return;
 viewer.mode=viewer.mode==='area'?null:'area';
 updateAreaControls();
};
$('area-color').oninput=()=>{
 if(!areaSession)return;
 areaSession.color=viewer.areaDraft.color=$('area-color').value;
 viewer.draw(false);
};
$('area-undo').onclick=()=>{areaSession?.strokes.pop();updateAreaControls();};
$('area-clear').onclick=()=>{if(areaSession)areaSession.strokes.length=0;updateAreaControls();};
$('area-cancel').onclick=()=>{
 const note=areaSession?.note;
 stopArea();
 refreshList();
 if(note)openAnnotation(note).catch(report);
};
$('area-save').onclick=async()=>{
 const session=areaSession;
 if(!session||session.saving)return;
 session.saving=true;
 viewer.mode=null;
 updateAreaControls();
 try{
  const {note,strokes,color,width,opacity}=session;
  const fields=strokes.length?{strokes,color,width,opacity}:{strokes};
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
 const button=btn(tr('Elimina'),async()=>{
  if(button.disabled||!canWrite()||!confirm(tr('Eliminare questa annotazione?')))return;
  button.disabled=true;
  try{await action(removeAnnotation);}
  finally{button.disabled=false;}
 },'danger');
 return button;
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
 const hasArea=Boolean(existing&&annotationStrokes(existing).length);
 const box=modal(tr(existing?.kind==='highlight'?'Impostazioni evidenziatore':'Impostazioni nota'));
 const canvas=document.createElement('canvas');
 canvas.className='settings-preview';canvas.width=430;canvas.height=65;
 box.append(canvas);
 const color=field(box,tr('Colore'),{type:'color',value:choice.color});
 const options=text('div','','symbol-picker');

 function preview(){
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,430,65);
  if(hasArea){
   ctx.strokeStyle=choice.color;ctx.globalAlpha=choice.opacity/100;
   ctx.lineWidth=choice.width;ctx.lineCap='round';
   ctx.beginPath();ctx.moveTo(40,32);ctx.lineTo(390,32);ctx.stroke();
   ctx.globalAlpha=1;
  }
  marker(ctx,215,32,choice.color,choice.shape,existing?.number||1);
 }

 function updateSymbol(){
  color.parentElement.hidden=!hasArea&&Boolean(emojiSymbols[choice.shape]);
  for(const button of options.children){
   const selected=button.dataset.symbol===choice.shape;
   button.classList.toggle('selected',selected);
   button.setAttribute('aria-pressed',String(selected));
  }
  preview();
 }

 color.oninput=()=>{choice.color=color.value;preview();};
 for(const [shape,label] of noteShapes){
  const button=btn('',()=>{choice.shape=shape;updateSymbol();},'symbol-choice');
  button.dataset.symbol=shape;
  button.title=tr(label);
  button.setAttribute('aria-label',tr(label));
  const icon=document.createElement('canvas');
  icon.width=icon.height=68;
  const ctx=icon.getContext('2d');ctx.scale(2,2);
  marker(ctx,17,17,'#2f529e',shape,null,11);
  button.append(icon);
  options.append(button);
 }
 box.append(options);
 if(hasArea){
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
  const changes={shape:choice.shape};
  if(hasArea||!emojiSymbols[choice.shape])changes.color=choice.color;
  if(hasArea){changes.width=choice.width;changes.opacity=choice.opacity;}
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
$('users-button').onclick=()=>manageUsers().catch(report);
async function manageUsers(){
 if(profile?.role!=='super_admin')return;
 const box=modal(tr('Utenti'));
 const rows=await api.table('sw_profiles','select=*&order=created_at.desc');
 if(!box.isConnected||!dialogOpen)return;
 for(const p of rows){
  const row=text('div','','user-row'),name=text('span',p.full_name);
  name.append(text('small',tr(roles[p.role])+' · '+(tr(p.approved?'Abilitato':'In attesa'))));
  row.append(name);
  if(p.id!==user.id){
   const role=document.createElement('select');
   role.setAttribute('aria-label',tr('Ruolo di')+' '+p.full_name);
   role.append(...Object.entries(roles).map(([key,label])=>new Option(tr(label),key)));
   role.value=p.role;
   role.onchange=async()=>{
    const newRole=role.value;
    if(!confirm(tr('Assegnare il ruolo')+' '+tr(roles[newRole])+' '+tr('a')+' '+p.full_name+'?')){role.value=p.role;return;}
    role.disabled=true;
    try{await api.rpc('sw_set_role',{target:p.id,new_role:newRole});await closeModal();await manageUsers();}
    catch(e){role.value=p.role;report(e);}finally{role.disabled=false;}
   };
   row.append(role,btn(tr(p.approved?'Disabilita':'Approva'),async()=>{
    await api.rpc('sw_set_approval',{target:p.id,allow_access:!p.approved});
    await closeModal();
    await manageUsers();
   },p.approved?'':'primary'));
  }
  box.append(row);
 }
}
function dismissNoteSession(){
 cancelPick();
 dialogClose=null;
 dialogOpen=false;
 $('dialog').close();
 $('dialog-body').replaceChildren();
 $('dialog-footer').replaceChildren();
}
function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(syncVisible,180);}
async function syncVisible(){
 if(polling||loading||setupLoading||document.hidden||!api.getSession()||!user)return;
 polling=true;const token=epoch;
 try{
  const [mine]=await api.table('sw_profiles','id=eq.'+user.id+'&select=*');
  if(token!==epoch)return;
  const wasApproved=profile?.approved;profile=mine;applyRole();
  if(!mine?.approved){dismissNoteSession();epoch++;await clearShipSetup();project=null;projectLevel=null;activeDocument=null;annotations=[];projects=[];viewer.clear();await pdf?.destroy();pdf=null;screen('waiting');return;}
  if(!wasApproved){await restore();return;}
  if(activeDocument&&(dialogOpen||finishPick||areaSession)){
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
   if(!dialogOpen&&!finishPick){projectLevel=level;activeDocument=updated;annotations=rows;refreshList();status(tr('Sincronizzato'));}
  }
 }catch(e){status(tr('Riconnessione…'));}finally{polling=false;}
}
setInterval(syncVisible,10000);
window.addEventListener('online',queueRefresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueRefresh();});
window.addEventListener('offline',()=>toast(tr('Connessione assente. Le nuove modifiche richiedono Internet.')));
registerStatic();
translateStatic();
$('language').value=locale().startsWith('en')?'en':'it';
$('language').onchange=()=>{
 setLanguage($('language').value);
 translateStatic();
 if(!$('auth').hidden&&!dialogOpen)setAuthMode(authMode);
 if(!$('projects').hidden)renderProjects();
 if(!$('documents').hidden)showProjectSettings(project).catch(report);
 if(!$('workspace').hidden){refreshList();status('');}
};
window.addEventListener('beforeunload',e=>{if(dialogOpen||areaSession){e.preventDefault();e.returnValue='';}});
try{const callback=api.authCallback();if(callback==='recovery'){screen('auth');const box=modal(tr('Nuova password')),password=field(box,tr('Password (almeno 10 caratteri)'),{type:'password'});$('dialog-footer').append(btn(tr('Aggiorna'),async()=>{if(password.value.length<10)throw Error(tr('Usa almeno 10 caratteri.'));await api.request('/auth/v1/user',{method:'PUT',body:{password:password.value}});await closeModal();await restore();},'primary'));}else await restore();}catch(e){$('auth-error').textContent=tr(e.message);}
