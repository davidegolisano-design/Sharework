import {tr} from './locale.js';
import {pdfDownload} from './api.js';
import {loadPdf} from './viewer.js';

export async function projectCover(file) {
 if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 20000000) {
  throw Error(tr('Scegli un’immagine JPG, PNG o WebP fino a 20 MB.'));
 }
 const image = await createImageBitmap(file);
 try {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1,640/Math.max(image.width,image.height));
  canvas.width = Math.max(1,Math.round(image.width*scale));
  canvas.height = Math.max(1,Math.round(image.height*scale));
  const ctx = canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='white';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
  for (const quality of [.82,.65,.48,.3]) {
   const cover=canvas.toDataURL('image/jpeg',quality);
   if(cover.length<=145000)return cover;
  }
  throw Error(tr('L’immagine di copertina è troppo grande.'));
 } finally {image.close();}
}

const thumbnails=new Map();
const pending=new Map();
let worker=Promise.resolve(), generation=0;
const observer=new IntersectionObserver(entries=>{
 for(const entry of entries) {
  if(!entry.isIntersecting)continue;
  observer.unobserve(entry.target);
  const image=entry.target;
  const path=image.dataset.path;
  if(!pending.has(path)){
   const expected=generation;
   const job=worker.then(async()=>{
    if(expected!==generation || !document.querySelector('#document-grid img[data-path="'+CSS.escape(path)+'"]'))return;
    const blob=await pdfDownload(path);
    const pdf=await loadPdf(new Uint8Array(await blob.arrayBuffer()));
    try{
     const page=await pdf.getPage(1);
     const full=page.getViewport({scale:1});
     const viewport=page.getViewport({scale:Math.min(520/full.width,320/full.height)});
     const canvas=document.createElement('canvas');
     canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
     if(expected!==generation)return;
     const data=canvas.toDataURL('image/jpeg',.78);
     if(thumbnails.size>=60)thumbnails.delete(thumbnails.keys().next().value);
     thumbnails.set(path,data);
     return data;
    }finally{await pdf.destroy();}
   });
   pending.set(path,job);
   worker=job.catch(()=>{});
   job.finally(()=>{if(pending.get(path)===job)pending.delete(path);}).catch(()=>{});
  }
  pending.get(path).then(src=>{if(src&&image.isConnected)image.src=src;}).catch(()=>{});
 }
},{rootMargin:'150px'});

export function documentThumbnail(path) {
 const image=new Image();
 image.alt='';
 image.dataset.path=path;
 const cached=thumbnails.get(path);
 if(cached)image.src=cached;
 else observer.observe(image);
 return image;
}

export function resetThumbnails(clear=false) {
 observer.disconnect();
 if(clear){generation++;thumbnails.clear();pending.clear();}
}
