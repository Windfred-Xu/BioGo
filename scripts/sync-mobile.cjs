/* Build the static Capacitor web bundle from the browser game sources. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'www');
const copy=(from,to=from)=>{
 const source=path.join(root,from),destination=path.join(out,to),stat=fs.statSync(source);
 if(stat.isFile()){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);return;}
 fs.mkdirSync(destination,{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true}))copy(path.join(from,entry.name),path.join(to,entry.name));
};
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
copy('biogo.html','index.html');
['parity-app.js','parity-engine.js','parity-features.js','parity-baseline.css','baseline-modules.js','lan-transport.js','bio-ui.js','bio-bgm.js','bio-design.css','LICENSE-Chemiss.txt'].forEach(file=>copy(file));
copy('vendor');
copy('bgm');
console.log('Mobile bundle ready: www');
