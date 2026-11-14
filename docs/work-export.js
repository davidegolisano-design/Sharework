import {workState,workStates} from './work-schedule.js?v=d910adbc61f2';
import writeExcelFile from './vendor/workbook.js';
import {frameAt,workDecks,workFrameRange,noteShapes,noteCategory,categoryLabel,symbolLabel} from './ship-model.js?v=d910adbc61f2';

export async function exportWorks(annotations,plan,name,pageName,tr,locale){
 const headers=['Numero','Titolo','Descrizione','Ponte di origine','Ponti coinvolti','Frame del simbolo','Frame iniziale','Frame finale','Autore','Data','Simbolo','Categoria','Stato','Inizio previsto','Fine prevista'];
 const states=new Map(workStates),symbols=new Map(noteShapes.map(entry=>[entry[0],symbolLabel(entry,tr,locale)])),now=Date.now();
 const deckOrder=new Map((plan?.decks||[]).map((deck,i)=>[deck.page,i]));
 const rows=annotations.filter(note=>!note.deleted).sort((a,b)=>(deckOrder.get(a.page)??a.page)-(deckOrder.get(b.page)??b.page)||a.number-b.number).map(note=>{
  const sheet=plan?.decks.find(deck=>deck.page===note.page);
  const [start,end]=workFrameRange(sheet,note);
  const category=noteCategory(note);
  return [note.number,note.title,note.description,pageName(note.page),
   workDecks(plan,note).map(deck=>deck.name).join(', ')||pageName(note.page),
   frameAt(sheet,note.x),start,end,note.author_name,
   new Date(note.created_at).toLocaleString(locale),symbols.get(note.shape)||(note.shape==='highlight'?tr('Evidenziazione'):note.shape),category?category.icon+' '+(category.custom?category.label:categoryLabel(category.key,tr,locale)):'',tr(states.get(workState(note,now))),
   ...[note.work_start,note.work_end].map(value=>value?new Date(value).toLocaleString(locale):'')];
 });
 const workbook=writeExcelFile([headers.map(label=>({value:tr(label),fontWeight:'bold'})),...rows],{
  sheet:tr('Lavori'),columns:[10,28,44,20,32,17,17,17,22,22,20,23,18,22,22].map(width=>({width}))
 });
 const fileName=(name||tr('Lavori')).replace(/[\\/:*?"<>|]/g,'-')+' - '+tr('Lavori')+'.xlsx';
 if(navigator.userAgent.includes('ShareworkAndroid/')){
  const blob=await workbook.toBlob();
  const data=await new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(reader.result.split(',')[1]);
   reader.onerror=()=>reject(reader.error);
   reader.readAsDataURL(blob);
  });
  if(prompt('sharework:save-xlsx',JSON.stringify({name:fileName,data}))!=='OK'){
   throw Error(tr('Impossibile aprire il salvataggio Excel.'));
  }
 }else await workbook.toFile(fileName);
}
