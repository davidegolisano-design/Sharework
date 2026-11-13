import {shipPageOrder} from './ship-model.js';

export function editShipPlan({document: pdf, currentPage, modal, closeModal, footer, field, btn, text, pick, save}) {
  let plan = structuredClone(pdf.ship_plan) || {
    overview: {page:currentPage, frame0:0, frame1:74, meters:51.06},
    decks: []
  };
  let selected = plan.overview;

  function show() {
    const box = modal('Configura Piani nave');
    const section = text('div', '', 'ship-editor-tabs');
    section.append(btn('General Overview', () => select(plan.overview)));
    for (const deck of plan.decks) section.append(btn(deck.name || 'Pagina ' + deck.page, () => select(deck)));
    box.append(section);
    const available = shipPageOrder(plan,pdf.page_count).filter(page => page !== plan.overview.page && !plan.decks.some(deck => deck.page === page));
    const add = btn('Aggiungi ponte', async () => {
      await closeModal();
      const page = available[0];
      const deck = {page, name:'Ponte pagina ' + page, frame0:plan.overview.frame0, frame1:plan.overview.frame1, meters:plan.overview.meters};
      plan.decks.push(deck);
      selected = deck;
      show();
    });
    add.disabled = !available.length;
    box.append(add);

    const editingOverview = selected === plan.overview;
    const selectedIndex = plan.decks.indexOf(selected);
    box.append(text('h3', editingOverview ? 'Vista laterale' : 'Configura ponte'));
    const controls = text('div','','ship-editor-grid');
    const pageField = field(controls, 'Pagina PDF', {type:'number', value:selected.page, min:1,max:pdf.page_count,step:1});
    pageField.onchange = () => {
      const page = Number(pageField.value);
      if (page !== selected.page) {
        selected.page = page;
        delete selected.x0;
        delete selected.x1;
        if (editingOverview) for (const deck of plan.decks) delete deck.base;
      }
    };
    if (!editingOverview) {
      const name = field(controls,'Nome ponte',{value:selected.name});
      name.maxLength=80;
      name.oninput=()=>{selected.name=name.value;};
    }
    const origin = field(controls,'Ordinata comune (es. 0)',{value:plan.overview.frame0,type:'number',step:'any'});
    origin.disabled = !editingOverview;
    origin.oninput = () => {
      const value = origin.valueAsNumber;
      plan.overview.frame0=value;
      for (const deck of plan.decks) deck.frame0=value;
    };
    const endpoint = field(controls,'Seconda ordinata',{value:selected.frame1,type:'number',step:'any'});
    endpoint.oninput=()=>{selected.frame1=endpoint.valueAsNumber;};
    const meters = field(controls,'Distanza tra ordinate (m)',{value:selected.meters,type:'number',min:0,step:'any'});
    meters.oninput=()=>{selected.meters=meters.valueAsNumber;};
    box.append(controls);

    const picks = text('div','','ship-editor-tabs');
    picks.append(reference('Prima ordinata',selected,'x0',()=>selected.page,0));
    picks.append(reference('Seconda ordinata',selected,'x1',()=>selected.page,0));
    if (!editingOverview) picks.append(reference('Base del ponte sulla laterale',selected,'base',()=>plan.overview.page,1));
    box.append(picks);
    if (!editingOverview) {
      const order = text('div','','ship-editor-tabs');
      for (const [label,delta] of [['↑ Alza nell’elenco',-1],['↓ Abbassa nell’elenco',1]]) {
        const shift = btn(label,async () => {
          await closeModal();
          plan.decks.splice(selectedIndex,1);
          plan.decks.splice(selectedIndex+delta,0,selected);
          show();
        });
        shift.disabled = selectedIndex+delta<0 || selectedIndex+delta>=plan.decks.length;
        order.append(shift);
      }
      order.append(btn('Rimuovi ponte',async () => {
        await closeModal();
        plan.decks.splice(selectedIndex,1);
        selected=plan.overview;
        show();
      }));
      box.append(order);
    }
    if (pdf.ship_plan) footer.append(btn('Torna a PDF standard', async () => {
      if (confirm('Rimuovere la configurazione Piani nave da questo PDF?')) await save(null);
    }));
    const submit = btn('Salva Piani nave', async () => {
      if (!plan.decks.length) throw Error('Aggiungi almeno un ponte.');
      const sheets = [plan.overview,...plan.decks];
      if (new Set(sheets.map(sheet=>sheet.page)).size!==sheets.length) throw Error('Assegna una pagina diversa a ogni tavola.');
      for (const sheet of sheets) {
        validPage(sheet.page);
        if (![sheet.x0,sheet.x1,sheet.frame0,sheet.frame1,sheet.meters].every(Number.isFinite) ||
            Math.abs(sheet.x1-sheet.x0)<0.00001 || sheet.frame0===sheet.frame1 || sheet.meters<=0) {
          throw Error('Completa i riferimenti nella pagina '+sheet.page+'.');
        }
      }
      if (plan.decks.some(deck=>!deck.name.trim() || !Number.isFinite(deck.base))) throw Error('Indica il nome e la linea di base per tutti i ponti.');
      submit.disabled=true;
      try { await save(plan); } finally {submit.disabled=false;}
    },'primary');
    footer.append(submit);
  }

  function validPage(page) {
    if (!Number.isInteger(page) || page<1 || page>pdf.page_count) throw Error('Numero pagina non valido.');
  }

  async function select(sheet) {
    await closeModal();
    selected=sheet;
    show();
  }

  function reference(label, sheet, key, getPage, axis) {
    return btn((Number.isFinite(sheet[key])?'✓ ':'')+label,async () => {
      const page=getPage();
      validPage(page);
      await closeModal();
      await pick(page,label,sheet[key],axis,point=>{
        if (point) sheet[key]=point[axis];
        show();
      });
    });
  }

  show();
}
