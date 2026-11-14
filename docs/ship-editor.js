import {tr} from './locale.js?v=0f9a44514d9c';

export function editShipPlan({doc,pdf,viewer,controls,sheetLabel,hint,saveButton,field,btn,text,save,report}) {
 const plan=structuredClone(doc.ship_plan)||{overview:{page:1,frame0:0,frame1:74,meters:51.06},decks:[]};
 let selected=plan.overview,picking=null,sequence=0,closed=false;
 const pageLabel=page=>tr('Pagina')+' '+page;
 const deckLabel=deck=>deck.name||pageLabel(deck.page);
 const frameLabel=frame=>tr('Ordinata')+' '+frame;

 function guides(){
  const current=viewer.pageNumber;
  const sheet=current===plan.overview.page?plan.overview:plan.decks.find(deck=>deck.page===current);
  const result=[];
  if(sheet)for(const [key,frame,color] of [['x0',sheet.frame0,'#007b83'],['x1',sheet.frame1,'#1459b8']]){
   if(Number.isFinite(sheet[key]))result.push({value:sheet[key],axis:0,label:frameLabel(frame),color});
  }
  if(current===plan.overview.page)for(const deck of plan.decks){
   if(Number.isFinite(deck.base))result.push({value:deck.base,axis:1,label:deckLabel(deck),color:deck===selected?'#a43421':'#7935a0'});
  }
  if(current===plan.overview.page&&Number.isFinite(plan.overview.top))result.push({value:plan.overview.top,axis:1,label:tr('Limite superiore del ponte più alto'),color:'#007b83'});
  viewer.guides=result;
  viewer.draw(false);
 }

 async function showPage(page,label){
  const token=++sequence;
  viewer.pick=null;
  if(viewer.pageNumber!==page || !viewer.pdfPage || viewer.pendingSetupPage) {
   viewer.pendingSetupPage=true;
   await viewer.page(page);
   if(closed||token!==sequence)return false;
   viewer.pendingSetupPage=false;
  }
  sheetLabel.textContent=label+' · '+pageLabel(page);
  guides();
  return true;
 }

 function select(sheet){
  selected=sheet;
  picking=null;
  render();
  return showPage(sheet.page,sheet===plan.overview?'General Overview':deckLabel(sheet));
 }

 async function pick(label,key,axis){
  const sheet=selected;
  picking=key;
  render();
  const page=axis?plan.overview.page:sheet.page;
  if(!await showPage(page,axis?'General Overview':sheet===plan.overview?'General Overview':deckLabel(sheet)))return;
  hint.textContent=tr('Tocca la tavola per posizionare il riferimento')+' · '+tr(label);
  viewer.pick=point=>{
   sheet[key]=point[axis];
   viewer.pick=null;
   picking=null;
   render();
   guides();
  };
 }

 const action=(label,fn,cls)=>btn(tr(label),fn,cls);
 function render(){
  if(closed)return;
  controls.replaceChildren();
  const nav=text('div','','setup-decks');
  for(const sheet of [plan.overview,...plan.decks]){
   const item=btn(sheet===plan.overview?'General Overview':deckLabel(sheet),()=>select(sheet),sheet===selected?'selected':'');
   item.setAttribute('aria-pressed',String(sheet===selected));
   nav.append(item);
  }
  controls.append(nav);
  const used=new Set([plan.overview.page,...plan.decks.map(deck=>deck.page)]);
  const next=Array.from({length:doc.page_count},(_,i)=>i+1).find(page=>!used.has(page));
  const add=action('Aggiungi ponte',()=>{
   const {frame0,frame1,meters}=plan.overview;
   const deck={page:next,name:'',frame0,frame1,meters};
   plan.decks.push(deck);
   return select(deck);
  });
  add.disabled=!next;
  controls.append(add);

  const isOverview=selected===plan.overview;
  const index=plan.decks.indexOf(selected);
  controls.append(text('h2',tr(isOverview?'Vista laterale':'Configura ponte')));
  const pageSelect=document.createElement('select');
  const pageField=text('label',tr('Pagina PDF'));
  pageSelect.append(...Array.from({length:doc.page_count},(_,i)=>i+1)
   .filter(page=>page===selected.page||!used.has(page)).map(page=>new Option(pageLabel(page),page)));
  pageSelect.value=selected.page;
  pageSelect.onchange=()=>{
   selected.page=Number(pageSelect.value);
   delete selected.x0;delete selected.x1;
   if(isOverview){delete plan.overview.top;for(const deck of plan.decks)delete deck.base;}
   select(selected).catch(report);
  };
  pageField.append(pageSelect);
  controls.append(pageField);
  if(!isOverview){
   const name=field(controls,tr('Nome ponte'),{value:selected.name});
   name.maxLength=80;
   name.oninput=()=>{selected.name=name.value;nav.children[index+1].textContent=deckLabel(selected);guides();};
  }
  const origin=field(controls,tr('Ordinata comune (es. 0)'),{value:plan.overview.frame0,type:'number',step:'any'});
  origin.disabled=!isOverview;
  origin.oninput=()=>{
   plan.overview.frame0=origin.valueAsNumber;
   for(const deck of plan.decks)deck.frame0=origin.valueAsNumber;
   guides();
  };
  const endpoint=field(controls,tr('Seconda ordinata'),{value:selected.frame1,type:'number',step:'any'});
  endpoint.oninput=()=>{selected.frame1=endpoint.valueAsNumber;guides();};
  const meters=field(controls,tr('Distanza tra ordinate (m)'),{value:selected.meters,type:'number',min:0,step:'any'});
  meters.oninput=()=>{selected.meters=meters.valueAsNumber;};
  const refs=[['Prima ordinata','x0',0],['Seconda ordinata','x1',0]];
  if(isOverview)refs.push(['Limite superiore del ponte più alto','top',1]);
  if(!isOverview)refs.push(['Base del ponte sulla laterale','base',1]);
  const references=text('div','','setup-reference');
  for(const [label,key,axis] of refs){
   references.append(action((Number.isFinite(selected[key])?'✓ ':'')+tr(label),()=>pick(label,key,axis),picking===key?'selected':''));
  }
  controls.append(references);
  if(!isOverview){
   const order=text('div','','ship-editor-tabs');
   for(const [label,delta] of [['↑ Alza nell’elenco',-1],['↓ Abbassa nell’elenco',1]]){
    const target=index+delta;
    const shift=action(label,()=>{
     [plan.decks[index],plan.decks[target]]=[plan.decks[target],plan.decks[index]];
     render();
    });
    shift.disabled=target<0||target>=plan.decks.length;
    order.append(shift);
   }
   order.append(action('Rimuovi ponte',()=>{
    plan.decks.splice(index,1);
    return select(plan.overview);
   }));
   controls.append(order);
  }
  hint.textContent=picking?tr('Tocca la tavola per posizionare il riferimento'):tr('Seleziona un riferimento da posizionare. Puoi ingrandire e spostare la tavola.');
 }

 saveButton.onclick=async()=>{
  try{
   if(!plan.decks.length)throw Error(tr('Aggiungi almeno un ponte.'));
   for(const sheet of [plan.overview,...plan.decks]){
    if(![sheet.x0,sheet.x1,sheet.frame0,sheet.frame1,sheet.meters].every(Number.isFinite)
       ||Math.abs(sheet.x1-sheet.x0)<.00001||sheet.frame0===sheet.frame1||sheet.meters<=0){
     throw Error(tr('Completa i riferimenti per')+' '+pageLabel(sheet.page)+'.');
    }
   }
   if(plan.decks.some(deck=>!deck.name.trim()||!Number.isFinite(deck.base)))throw Error(tr('Indica il nome e la linea di base per tutti i ponti.'));
   if(!Number.isFinite(plan.overview.top)||plan.overview.top>=Math.min(...plan.decks.map(deck=>deck.base)))throw Error(tr('Imposta il limite superiore sopra la base del ponte più alto.'));
   saveButton.disabled=true;
   await save(plan);
  }catch(error){report(error);}finally{saveButton.disabled=false;}
 };
 viewer.pdf=pdf;
 select(plan.overview).catch(report);
 return ()=>{
  closed=true;
  sequence++;
  viewer.clear();
  viewer.pendingSetupPage=false;
  saveButton.onclick=null;
 };
}
