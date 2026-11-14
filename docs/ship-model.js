import {workState} from './work-schedule.js?v=2a96e4f38bd2';
import {annotationStrokes,normalizeSearch} from './model.js?v=2a96e4f38bd2';
export const geometricSymbols={circle:'●',square:'■',diamond:'◆',triangle:'▲'};
const defaultCategories=[
 ['circle','●','Punto'],['square','■','Quadrato'],['diamond','◆','Rombo'],['triangle','▲','Triangolo'],
 ['scaffolding','🪜','Ponteggio'],['hot_work','🔥','Lavoro a caldo'],['lifting','🏗️','Sollevamento'],
 ['mechanical','⚙️','Meccanica'],['pipework','🚰','Tubisteria'],['electrical','⚡','Elettrico'],
 ['cleaning','🧹','Pulizia'],['testing','🧪','Prove'],['painting','🖌️','Pittura'],
 ['inspection','🔍','Ispezione'],['safety','⛑️','Sicurezza']
];
export const workCategories=[...defaultCategories];
const categoriesById=new Map(defaultCategories.map(entry=>[entry[0],entry]));
const shapeCategories={
 scaffolding:'scaffolding',flame:'hot_work',welding:'hot_work',lifting:'lifting',
 mechanical:'mechanical',tool:'mechanical',drilling:'mechanical',pipes:'pipework',electric:'electrical',
 cleaning:'cleaning',testing:'testing',painting:'painting',inspection:'inspection',measurement:'inspection',
 ppe:'safety',fire_watch:'safety',warning:'safety'
};
export function noteCategory(note){
 const icon=geometricSymbols[note.shape];
 const label=note.custom_category?.trim();
 if(icon&&label)return {key:'custom:'+normalizeSearch(label),icon,label,custom:true};
 const category=categoriesById.get(icon?note.shape:shapeCategories[note.shape]);
 return category?{key:category[0],icon:category[1],label:category[2],renamed:category[3]}:null;
}

const workSymbols = [
  ['scaffolding','🪜','Ponteggio'], ['flame','🔥','Fiamma'], ['warning','⚠️','Attenzione'], ['electric','⚡','Elettrico'], ['tool','🔧','Attrezzatura'],
  ['welding','🧑‍🏭','Saldatura'], ['pipes','🚰','Tubazioni'], ['lifting','🏗️','Sollevamento'],
  ['painting','🖌️','Pittura'], ['inspection','🔍','Ispezione'], ['ppe','⛑️','Sicurezza'],
  ['cleaning','🧹','Pulizia'], ['fire_watch','🧯','Antincendio'], ['mechanical','⚙️','Meccanica'],
  ['drilling','🛠️','Foratura e montaggio'], ['measurement','📏','Misurazione'], ['testing','🧪','Prove']
];
export const emojiSymbols = Object.fromEntries(workSymbols.map(([key,emoji])=>[key,emoji]));
export const noteShapes = [
  ['circle', 'Punto'], ['square', 'Quadrato'], ['diamond', 'Rombo'], ['triangle', 'Triangolo'],
  ...workSymbols.map(([key,,label])=>[key,label])
];

const defaultShapes=noteShapes.slice();
const primarySymbols=new Map(defaultCategories.flatMap(([id,icon])=>{
 const symbol=workSymbols.find(([shape,glyph])=>shapeCategories[shape]===id&&glyph===icon);
 return symbol?[[id,symbol[0]]]:[];
}));
const archivedCategories=new Set();
export function isArchivedSymbol(shape){
 return archivedCategories.has(shapeCategories[shape]);
}
export function setWorkCatalog(rows){
 for(const [id] of noteShapes.slice(defaultShapes.length)){
  delete emojiSymbols[id];
  delete shapeCategories[id];
 }
 for(const [shape,glyph] of workSymbols)emojiSymbols[shape]=glyph;
 categoriesById.clear();
 archivedCategories.clear();
 const byId=new Map(rows.map(row=>[row.id,row]));
 const entries=[
  ...defaultCategories,
  ...rows.filter(row=>row.glyph&&row.id.startsWith('emoji_')).map(({id,glyph,name})=>[id,glyph,name])
 ];
 const active=[],extra=[];
 for(const [id,defaultIcon,defaultLabel] of entries){
  const row=byId.get(id),icon=row?.glyph||defaultIcon,label=row?.name||defaultLabel;
  categoriesById.set(id,[id,icon,label,Boolean(row?.name)]);
  if(row?.archived)archivedCategories.add(id);
  else active.push([id,icon,label]);
  const primary=primarySymbols.get(id);
  if(primary)emojiSymbols[primary]=icon;
  if(id.startsWith('emoji_')){
   emojiSymbols[id]=icon;
   shapeCategories[id]=id;
   extra.push([id,label,true]);
  }
  for(const emoji of row?.sw_work_emoji||[]){
   emojiSymbols[emoji.id]=emoji.glyph;
   shapeCategories[emoji.id]=id;
   extra.push([emoji.id,emoji.name,true]);
  }
 }
 workCategories.splice(0,workCategories.length,...active);
 const builtIn=defaultShapes.map(entry=>{
  const [shape]=entry;
  const id=geometricSymbols[shape]?shape:shapeCategories[shape];
  const name=byId.get(id)?.name;
  return name&&(shape===id||shape===primarySymbols.get(id))?[shape,name,true]:entry;
 });
 noteShapes.splice(0,noteShapes.length,...builtIn,...extra);
}
export function categoryLabel(id,tr){
 const entry=categoriesById.get(id);
 return entry[3]?entry[2]:tr(entry[2]);
}

export function shipPageOrder(plan, count) {
  if (!plan) return Array.from({length:count}, (_, i) => i + 1);
  const configured = [plan.overview.page, ...plan.decks.map(deck => deck.page)];
  return [...configured, ...shipPageOrder(null, count).filter(page => !configured.includes(page))];
}

// Signed distance from the common frame, independent of the PDF scale or direction.
export function longitudinalScale(sheet) {
  return (sheet.x1 - sheet.x0) / (Math.sign(sheet.frame1 - sheet.frame0) * sheet.meters);
}

export function mapDeckView(source, target, view) {
  const from = longitudinalScale(source);
  const to = longitudinalScale(target);
  return {
    x: target.x0 + (view.x - source.x0) / from * to,
    pixelsPerMeter: view.width * Math.abs(from)
  };
}

export function placeLaser(plan, page, point, previous = null) {
  const overview = plan.overview;
  const sheet = page === overview.page ? overview : plan.decks.find(deck => deck.page === page);
  if (!sheet) return null;
  return {
    x: mapDeckView(sheet, overview, {x:point[0],width:1}).x,
    y: sheet === overview ? previous?.y ?? .5 : point[1]
  };
}

export function laserOnPage(plan, page, laser) {
  const overview = plan.overview;
  if (page === overview.page) return {...laser, vertical:true};
  const deck = plan.decks.find(sheet => sheet.page === page);
  if (!deck) return null;
  const {x} = mapDeckView(overview, deck, {x:laser.x,width:1});
  return {x,y:laser.y,vertical:false};
}

export function frameAt(sheet,x){
 if(!sheet||!Number.isFinite(x)||sheet.x0===sheet.x1)return null;
 const frame=sheet.frame0+(x-sheet.x0)*(sheet.frame1-sheet.frame0)/(sheet.x1-sheet.x0);
 return Number.isFinite(frame)?Math.round(frame*100)/100:null;
}

export function workDecks(plan,annotation){
 const decks=[...(plan?.decks||[])].sort((a,b)=>a.base-b.base);
 const index=decks.findIndex(deck=>deck.page===annotation.page);
 return index<0?[]:decks.slice(Math.max(0,index-(annotation.decks_above||0)),index+1+(annotation.decks_below||0));
}

export function workFrameRange(sheet,annotation){
 const points=[...(annotation.regions||[]),...annotationStrokes(annotation)].flat();
 let start=Infinity,end=-Infinity;
 for(const [x] of points){
  const frame=frameAt(sheet,x);
  if(frame!=null){start=Math.min(start,frame);end=Math.max(end,frame);}
 }
 return Number.isFinite(start)?[start,end]:[null,null];
}

export function deckReferences(plan,annotations,page){
 const target=plan.decks.find(deck=>deck.page===page);
 if(!target)return [];
 return annotations.flatMap(annotation=>{
  if(annotation.page===page||!workDecks(plan,annotation).includes(target))return [];
  const origin=plan.decks.find(deck=>deck.page===annotation.page);
  const {x}=mapDeckView(origin,target,{x:annotation.x,width:1});
  return x>=0&&x<=1?[{...annotation,page,x,y:.5,kind:'note',points:[],strokes:[],regions:[],deckReference:true}]:[];
 });
}

export function projectMarks(plan, annotations) {
  const {overview, decks} = plan;
  const byPage = new Map(decks.map(deck => [deck.page, deck]));
  const projected = [];
  const ordered=[...decks].sort((a,b)=>a.base-b.base);
  const deckTop=deck=>ordered[ordered.indexOf(deck)-1]?.base ?? overview.top;
  for (const annotation of annotations) {
    const deck = byPage.get(annotation.page);
    if (!deck) continue;
    const strokes=annotationStrokes(annotation);
    const ranges=[];
    const regions=[];
    const involved=workDecks(plan,annotation);
    const top=deckTop(involved[0]),bottom=involved.at(-1).base;
    for(const ring of annotation.regions||[]){
      const xs=ring.map(([x])=>mapDeckView(deck,overview,{x,width:1}).x);
      const left=Math.max(0,Math.min(...xs)),right=Math.min(1,Math.max(...xs));
      if(left>=right)continue;
      const upper=Number.isFinite(top)&&top<bottom?top:Math.max(0,bottom-.012);
      regions.push([[left,upper],[right,upper],[right,bottom],[left,bottom]]);
    }
    for (const stroke of strokes) {
      let left = Infinity, right = -Infinity;
      for (const [sourceX] of stroke) {
        const {x} = mapDeckView(deck, overview, {x:sourceX,width:1});
        left = Math.min(left,x);
        right = Math.max(right,x);
      }
      if (!Number.isFinite(left) || !Number.isFinite(right) || right < 0 || left > 1) continue;
      ranges.push([[Math.max(0,left),deck.base],[Math.min(1,right),deck.base]]);
    }
    if (strokes.length && !ranges.length) continue;
    let {x} = mapDeckView(deck, overview, {x:annotation.x,width:1});
    if (!Number.isFinite(x) || x < 0 || x > 1) {
      if (!ranges.length) continue;
      x=(ranges[0][0][0]+ranges[0][1][0])/2;
    }
    const ceiling=deckTop(deck);
    const centered=regions.length&&Number.isFinite(ceiling)&&ceiling<deck.base;
    projected.push({...annotation,page:overview.page,x,y:centered?(ceiling+deck.base)/2:deck.base,
      points:[],strokes:ranges,regions,projected:true,centered});
  }
  return projected;
}

export function filterNotes(annotations, {query, page, kind, category, author, day, status, now}) {
  const search = normalizeSearch(query).trim();
  return annotations.filter(a => {
    const localDay = day ? new Date(a.created_at).toLocaleDateString('sv-SE') : '';
    return !a.deleted && (!page || a.page === Number(page)) &&
      (!kind || kind===a.shape || (kind==='highlight'&&(annotationStrokes(a).length||a.regions?.length))) &&
      (!status || workState(a,now) === status) &&
      (!category || noteCategory(a)?.key===category) && (!author || a.created_by === author) && (!day || day === localDay) &&
      (!search || [a.title,a.description,a.number,a.author_name].some(value => normalizeSearch(value).includes(search)));
  });
}
