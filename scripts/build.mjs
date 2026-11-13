import {mkdir,cp,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
await mkdir('dist',{recursive:true});await cp('src','dist',{recursive:true});
// Give the entry points and every local dependency the same release URL.
const modules=(await readdir('src')).filter(file=>file.endsWith('.js')).sort();
const files=await Promise.all([...modules,'index.html','offline.html'].map(async file=>[file,await readFile(path.join('src',file),'utf8')]));
const release=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,12);
const localModule=/(["'])(\.\/[\w-]+\.js)\1/g;
for(const [file,source] of files){
 if(file==='sw.js')continue;
 const versioned=source.replace(localModule,(match,quote,url)=>modules.includes(url.slice(2))&&url!=='./sw.js'?quote+url+'?v='+release+quote:match);
 await writeFile(path.join('dist',file),versioned);
}
const pdf=path.dirname(require.resolve('pdfjs-dist/package.json'));
await mkdir('dist/vendor',{recursive:true});
for(const name of ['build/pdf.mjs','build/pdf.worker.mjs','cmaps','standard_fonts','wasm','iccs','LICENSE'])await cp(path.join(pdf,name),path.join('dist/vendor',name),{recursive:true});
console.log('Sharework build ready: dist');
