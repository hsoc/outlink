import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { lockedPackages, parseNoticeTexts, validateInventory, packageKey, webUrl } from './licenses/catalog.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const json = async p => JSON.parse(await fs.readFile(p,'utf8'));
const lock = await json('package-lock.json');
let inventory = await json('licenses/third-party/common/npm-inventory.json');
const texts = parseNoticeTexts(await fs.readFile('licenses/third-party/common/npm-notices.txt','utf8'));
if (process.argv.includes('--refresh')) {
  const { refreshInventory } = await import('./licenses/refresh.mjs');
  inventory = await refreshInventory(process.cwd(), lock, inventory, texts);
}
validateInventory(lock, inventory, texts);
const documents = new Map();
function document(title,text) { const id=hash(text); documents.set(id,text); return {title,id}; }
const entries=inventory.packages.map(pkg=>({ id:hash(`npm:${packageKey(pkg)}`).slice(0,24),name:pkg.name,version:pkg.version,
  license:pkg.license,repository:webUrl(pkg.repository),documents:pkg.licenseFiles.map(f=>document(f.source,texts.get(f.sha256))) }));
for (const entry of await json('licenses/third-party/catalog-supplements.json')) {
  // The historical source snapshots remain in Git; only retained mobile extras ship.
  if (!['outlink','solar-icons','firebase-messaging'].includes(entry.id)) continue;
  const {files,...metadata}=entry;
  entries.push({...metadata,documents:await Promise.all(files.map(async p=>document(p,await fs.readFile(p,'utf8'))))});
}
// Preserve complete reviewed mobile framework notices, even when conservative.
entries.push({ id:'mobile-frameworks',name:'Mobile native frameworks',license:'Bundled notices',documents:[document('Mobile frameworks',await fs.readFile('licenses/third-party/common/mobile-native.txt','utf8'))] });
entries.sort((a,b)=>a.name.localeCompare(b.name));
const outputs=new Map();
outputs.set('src/generated/licenses/catalog.json',JSON.stringify(entries)+'\n');
outputs.set('src/generated/licenses/assets.ts',`// Generated; original license texts are bundled assets.\n/* eslint-disable @typescript-eslint/no-require-imports */\nexport const noticeAssets: Readonly<Record<string, () => number>> = {\n${[...documents.keys()].map(id=>`  '${id}': () => require('../../../assets/licenses/${id}.txt'),`).join('\n')}\n};\n`);
for(const [id,text]of documents) outputs.set(`assets/licenses/${id}.txt`,text);
const check=process.argv.includes('--check');
for(const [path,content]of outputs) {
  if(check) { if(await fs.readFile(path,'utf8').catch(()=>null)!==content)throw new Error(`Stale notice: ${path}`); }
  else { await fs.mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});await fs.writeFile(path,content); }
}
console.log(`${check?'Verified':'Generated'} ${entries.length} mobile notices; original source snapshots preserved.`);
