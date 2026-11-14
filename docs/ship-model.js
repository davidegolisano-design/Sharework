import {annotationStrokes} from './model.js?v=bfb6ea092bba';
export const emojiSymbols = {flame:'🔥',warning:'⚠️',electric:'⚡',tool:'🔧'};
export const noteShapes = [
  ['circle', 'Punto'], ['square', 'Quadrato'], ['diamond', 'Rombo'], ['triangle', 'Triangolo'],
  ['flame', 'Fiamma'], ['warning', 'Attenzione'], ['electric', 'Elettrico'], ['tool', 'Attrezzatura']
];

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

export function projectMarks(plan, annotations) {
  const {overview, decks} = plan;
  const byPage = new Map(decks.map(deck => [deck.page, deck]));
  const projected = [];
  for (const annotation of annotations) {
    const deck = byPage.get(annotation.page);
    if (!deck) continue;
    const strokes=annotationStrokes(annotation);
    const ranges=[];
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
    projected.push({...annotation,page:overview.page,x,y:deck.base,points:[],strokes:ranges,projected:true});
  }
  return projected;
}

export function filterNotes(annotations, {query, page, kind, author, day}) {
  const search = query.trim().toLocaleLowerCase('it');
  return annotations.filter(a => {
    const localDay = day ? new Date(a.created_at).toLocaleDateString('sv-SE') : '';
    return !a.deleted && (!page || a.page === Number(page)) &&
      (!kind || kind === (annotationStrokes(a).length ? 'highlight' : a.shape)) &&
      (!author || a.created_by === author) && (!day || day === localDay) &&
      (!search || [a.title,a.description,a.number,a.author_name].some(value => String(value ?? '').toLocaleLowerCase('it').includes(search)));
  });
}
