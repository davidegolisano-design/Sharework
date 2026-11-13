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

export function projectMarks(plan, annotations) {
  const {overview, decks} = plan;
  const byPage = new Map(decks.map(deck => [deck.page, deck]));
  const projected = [];
  for (const annotation of annotations) {
    const deck = byPage.get(annotation.page);
    if (!deck) continue;
    const sourceX = annotation.kind === 'highlight' && annotation.points.length
      ? annotation.points.reduce((total, point) => total + point[0], 0) / annotation.points.length
      : annotation.x;
    const {x} = mapDeckView(deck, overview, {x:sourceX,width:1});
    if (x < 0 || x > 1 || !Number.isFinite(x)) continue;
    projected.push({
      ...annotation, page:overview.page, x, y:deck.base, projected:true,
      kind:'note', shape:annotation.kind === 'highlight' ? 'highlight' : annotation.shape
    });
  }
  return projected;
}

export function filterNotes(annotations, {query, page, kind, author, day}) {
  const search = query.trim().toLocaleLowerCase('it');
  return annotations.filter(a => {
    const localDay = day ? new Date(a.created_at).toLocaleDateString('sv-SE') : '';
    return !a.deleted && (!page || a.page === Number(page)) &&
      (!kind || kind === (a.kind === 'highlight' ? 'highlight' : a.shape)) &&
      (!author || a.created_by === author) && (!day || day === localDay) &&
      (!search || [a.title,a.description,a.number,a.author_name].some(value => String(value ?? '').toLocaleLowerCase('it').includes(search)));
  });
}
