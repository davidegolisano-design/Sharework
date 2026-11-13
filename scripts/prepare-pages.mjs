import {cp,mkdir,writeFile} from 'node:fs/promises';
await import('./build.mjs');
await mkdir('docs',{recursive:true});await cp('dist','docs',{recursive:true});
await writeFile('docs/.nojekyll','');
console.log('GitHub Pages ready: docs');
