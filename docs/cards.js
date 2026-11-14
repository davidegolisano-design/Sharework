import {tr} from './locale.js?v=34426cf9c301';

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
