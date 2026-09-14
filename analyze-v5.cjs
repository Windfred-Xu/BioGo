const fs=require('node:fs'),crypto=require('node:crypto'),E=require('./bio-engine');
const data=require('./balance-v5-results/summary.json');
for(const [f,h]of Object.entries(data.hashes))if(crypto.createHash('sha256').update(fs.readFileSync(__dirname+'/'+f)).digest('hex')!==h)throw Error('Source changed: '+f);
let seed=7123;function rng(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
function ci(values){const boot=[];for(let n=0;n<10000;n++){let v=0;for(let j=0;j<values.length;j++)v+=values[Math.floor(rng()*values.length)];boot.push(v/values.length);}boot.sort((a,b)=>a-b);return [boot[250],boot[9749]].map(x=>+(100*x).toFixed(1));}
const out={n:data.results.length,failed:data.results.filter(r=>r.status!=='completed'),pairs:[],blackWins:0,whiteWins:0,draws:0,zeroLiberties:0};
for(const g of data.summary){const rows=data.results.filter(r=>g.pair.includes(r.black)&&g.pair.includes(r.white)),seeds=[...new Set(rows.map(r=>r.seed))];if(rows.length!==100||seeds.length!==50||g.byBlack.some(x=>x.n!==50))throw Error('Sample size');const score=r=>r.winner==='draw'?.5:r[r.winner]===g.pair[0]?1:0;
 const clustered=seeds.map(s=>{const x=rows.filter(r=>r.seed===s);if(x.length!==2||x[0].black===x[1].black)throw Error('unpaired');return (score(x[0])+score(x[1]))/2;});
 const side=seeds.map(s=>rows.filter(r=>r.seed===s).reduce((a,r)=>a+(r.winner==='draw'?.5:r.winner==='black'?1:0),0)/2);
 const metrics={thirdRemovals:{},cleanupStones:0,migrations:{},averagePly:rows.reduce((a,r)=>a+r.ply,0)/rows.length};
 for(const r of rows){out[r.winner==='draw'?'draws':r.winner==='black'?'blackWins':'whiteWins']++;const game=JSON.parse(fs.readFileSync(__dirname+'/balance-v5-results/game-'+String(r.id).padStart(3,'0')+'.json'));const s=game.finalState;for(let i=0;i<36;i++)if(s.board[i]&&s.board[i].kind!=='spore'&&!E.libs(s.board,E.group(s.board,i)).length)out.zeroLiberties++;
 for(const a of game.actions){for(const d of a.event.details||[]){const m=d.match(/(virus|bacteria|fungi)第3次/);if(m)metrics.thirdRemovals[m[1]]=(metrics.thirdRemovals[m[1]]||0)+1;const c=d.match(/清理 (\d+) 枚/);if(c)metrics.cleanupStones+=+c[1];}if(a.event.destinations.length){const f=a.event.kind==='migration'?r[a.event.color]:r[a.event.color==='black'?'white':'black'];metrics.migrations[f]=(metrics.migrations[f]||0)+a.event.destinations.length;}}}
 out.pairs.push({...g,scoreA:rows.reduce((a,r)=>a+score(r),0),pairedScore95:ci(clustered),blackScore:100*side.reduce((a,b)=>a+b,0)/50,pairedBlack95:ci(side),metrics});}
console.log(JSON.stringify(out,null,2));
