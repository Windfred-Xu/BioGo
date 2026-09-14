/* Make the generated Android project self-contained before copying it to an ASCII-only build path. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'node_modules','@capacitor','android','capacitor');
const target=path.join(root,'android','capacitor-android');
function copyTree(from,to){
  const stat=fs.statSync(from);
  if(stat.isFile()){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);return;}
  fs.mkdirSync(to,{recursive:true});
  for(const entry of fs.readdirSync(from,{withFileTypes:true})) copyTree(path.join(from,entry.name),path.join(to,entry.name));
}
if(!fs.existsSync(source)) throw new Error(`Capacitor Android library is missing: ${source}`);
fs.rmSync(target,{recursive:true,force:true});
copyTree(source,target);
fs.writeFileSync(path.join(root,'android','capacitor.settings.gradle'),[
  '// Generated for portable Android builds. The Capacitor library is bundled with this Android project.',
  "include ':capacitor-android'",
  "project(':capacitor-android').projectDir = new File('./capacitor-android')",
  ''
].join('\n'));
console.log('Portable Capacitor Android library ready.');
