import {mkdir,cp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
await mkdir('dist',{recursive:true});await cp('src','dist',{recursive:true});
const pdf=path.dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir('dist/vendor',{recursive:true});
for(const name of ['build/pdf.mjs','build/pdf.worker.mjs','cmaps','standard_fonts','wasm','iccs','LICENSE'])await cp(path.join(pdf,name),path.join('dist/vendor',name),{recursive:true});
console.log('Sharework build ready: dist');
