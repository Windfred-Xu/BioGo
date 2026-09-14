/* 奇偶围棋 rules, shared by human play, AI and replay. No DOM dependencies. */
(function(root){
'use strict';
const N=6,other=c=>c==='black'?'white':'black',key=(r,c)=>r*6+c,xy=i=>[Math.floor(i/6),i%6];
const around=i=>{const [r,c]=xy(i);return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([a,b])=>a>=0&&a<6&&b>=0&&b<6).map(([a,b])=>key(a,b));};
const adj=Array.from({length:36},(_,i)=>around(i)),copy=x=>JSON.parse(JSON.stringify(x));
function hash(s){return s.board.map(x=>x?x.color[0]:'.').join('')+'|'+s.turn+'|'+s.locks.black.join(',')+'|'+s.locks.white.join(',');}
function initial(seed=Date.now()>>>0){const s={board:Array(36).fill(null),turn:'black',locks:{black:[],white:[]},seed:seed||1,passes:0,ply:0,last:null,over:false,winner:null,reason:'',seen:[]};s.seen=[hash(s)];return s;}
function group(b,i){if(!b[i])return [];const set=new Set([i]),q=[i];for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(b[j]?.color===b[i].color&&!set.has(j)){set.add(j);q.push(j);}return q;}
function libs(b,g){return [...new Set(g.flatMap(i=>adj[i].filter(j=>!b[j])))];}
function random(s){let x=s.seed|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.seed=x>>>0;return s.seed/4294967296;}
function score(s){const a={black:0,white:0,neutral:0,owners:Array(36).fill(null),stones:{black:0,white:0},territory:{black:0,white:0}};const vis=new Set();for(let i=0;i<36;i++){if(s.board[i]){const c=s.board[i].color;a[c]++;a.stones[c]++;a.owners[i]=c;continue;}if(vis.has(i))continue;const q=[i],edges=new Set();vis.add(i);for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(s.board[j])edges.add(s.board[j].color);else if(!vis.has(j)){vis.add(j);q.push(j);}if(edges.size===1){const c=[...edges][0];a[c]+=q.length;a.territory[c]+=q.length;q.forEach(j=>a.owners[j]=c);}else a.neutral+=q.length;}return a;}
function basic(s,i,color=s.turn){if(s.over||!Number.isInteger(i)||i<0||i>=36)return false;if(s.board[i]||s.locks[color].includes(i))return false;const b=s.board.slice();b[i]={color};return libs(b,group(b,i)).length>0||adj[i].some(j=>b[j]?.color===other(color)&&libs(b,group(b,j)).length===0);}
function finish(s,reason,winner){const a=score(s);s.over=true;s.reason=reason;s.winner=winner||(a.black===a.white?'draw':a.black>a.white?'black':'white');return s;}
function play(source,i,{checkEnd=true}={}){
 if(!basic(source,i))return {error:source.locks[source.turn]?.includes(i)?'该颜色曾在这里被提子，不能回填。':'此处已有棋子或落子后无气。'};
 const s=copy(source),color=s.turn,victim=other(color);s.board[i]={color,migrated:false};const captured=[],vis=new Set();
 for(const j of adj[i])if(s.board[j]?.color===victim&&!vis.has(j)){const g=group(s.board,j);g.forEach(k=>vis.add(k));if(!libs(s.board,g).length)captured.push(...g);}
 captured.forEach(j=>s.board[j]=null);
 const pool=[...new Set(s.board.flatMap((p,j)=>p?.color===color?adj[j].filter(k=>!s.board[k]):[]))].filter(j=>!captured.includes(j));
 s.locks[victim]=[...new Set([...s.locks[victim],...captured])].sort((a,b)=>a-b);
 const destinations=[];const distance=j=>Math.min(...captured.map(k=>Math.abs(xy(j)[0]-xy(k)[0])+Math.abs(xy(j)[1]-xy(k)[1])));
 // Choose nearest surviving destination afresh for every stone; already migrated stones participate too.
 for(let n=0;n<captured.length;n++){
  const candidates=pool.filter(j=>!s.board[j]).filter(j=>{s.board[j]={color:victim,migrated:true};const good=[...destinations,j].every(k=>libs(s.board,group(s.board,k)).length>0);s.board[j]=null;return good;});
  if(!candidates.length)break;
  const min=Math.min(...candidates.map(distance)),ties=candidates.filter(j=>distance(j)===min),dest=ties[Math.floor(random(s)*ties.length)];
  s.board[dest]={color:victim,migrated:true};destinations.push(dest);
 }
 s.turn=victim;s.passes=0;s.ply++;s.last=i;
 const h=hash(s);if(s.seen.includes(h))return {error:'此手会重现历史局面。'};s.seen.push(h);
 const event={color,point:i,captured:captured.length,destinations,removed:captured.length-destinations.length};
 if(checkEnd)adjudicate(s);return {state:s,event};
}
function legal(s,color=s.turn){const t=color===s.turn?s:{...s,turn:color};return Array.from({length:36},(_,i)=>i).filter(i=>basic(t,i)&&!play(t,i,{checkEnd:false}).error);}
function adjudicate(s){if(s.board.every(Boolean))return finish(s,'棋盘已满');const a=score(s);for(const color of ['black','white'])if(a.stones[color]>0&&!a.stones[other(color)]&&!s.board.some((p,i)=>!p&&basic(s,i,other(color))))return finish(s,'一方已无棋子且无法重新落子');if(a.stones.black&&a.stones.white&&a.neutral===0){
 // All empty regions must also resist legal invasion. Area sum alone would end after the first stone.
 const invadable=s.board.some((p,i)=>!p&&basic(s,i,other(a.owners[i])));
 const regions=new Map();let rid=0;for(let i=0;i<36;i++)if(!s.board[i]&&!regions.has(i)){const q=[i];regions.set(i,rid);for(let n=0;n<q.length;n++)for(const j of adj[q[n]])if(!s.board[j]&&!regions.has(j)){regions.set(j,rid);q.push(j);}rid++;}
 const stable=s.board.every((p,i)=>!p||new Set(libs(s.board,group(s.board,i)).filter(j=>a.owners[j]===p.color).map(j=>regions.get(j))).size>=2);
 if(!invadable||stable)return finish(s,'全盘归属已确定，各棋块均有独立围空或对方无法侵入');
 }if(!Array.from({length:36},(_,i)=>i).some(i=>basic(s,i,'black')||basic(s,i,'white')))return finish(s,'双方均无合法落子');return s;}
function pass(source){if(source.over)return {error:'对局已结束'};const s=copy(source),event={color:s.turn,point:null,captured:0,destinations:[],removed:0};s.turn=other(s.turn);s.ply++;s.last=null;s.passes++;if(s.passes>=2)finish(s,'双方连续停一手');return {state:s,event};}
function evaluate(s,color){if(s.over)return s.winner==='draw'?0:s.winner===color?100000:-100000;const a=score(s),op=other(color);let v=(a.stones[color]-a.stones[op])*35+(a.territory[color]-a.territory[op])*4;const seen=new Set();for(let i=0;i<36;i++)if(s.board[i]&&!seen.has(i)){const g=group(s.board,i),l=libs(s.board,g).length;g.forEach(j=>seen.add(j));v+=(s.board[i].color===color?1:-1)*(Math.min(l,5)*4-(l===1?g.length*30:0));}return v+(s.locks[op].length-s.locks[color].length)*2;}
function choose(s,level=4,budget){const deadline=Date.now()+(budget||[0,10,50,100,220,450,900][level]),color=s.turn;let nodes=0;
 const rank=t=>legal(t).map(i=>({i,r:play(t,i,{checkEnd:false})})).sort((a,b)=>evaluate(b.r.state,t.turn)-evaluate(a.r.state,t.turn));
 const choices=rank(s);if(!choices.length)return {point:null,nodes};if(level===1)return {point:choices[Math.floor(Math.random()*choices.length)].i,nodes};
 const search=(t,d,alpha,beta)=>{nodes++;if(Date.now()>deadline)throw new Error('budget');if(!d||t.over)return evaluate(t,color);const candidates=rank(t).slice(0,level<4?6:10);if(!candidates.length)return evaluate(t,color);const max=t.turn===color;let v=max?-Infinity:Infinity;for(const m of candidates){const n=search(m.r.state,d-1,alpha,beta);v=max?Math.max(v,n):Math.min(v,n);if(max)alpha=Math.max(alpha,v);else beta=Math.min(beta,v);if(beta<=alpha)break;}return v;};
 let best=choices[0].i,depthDone=1;
 for(let depth=2;depth<=Math.min(level,5);depth++){let b=best,val=-Infinity;try{for(const m of choices){const v=search(m.r.state,depth-1,-Infinity,Infinity);if(v>val){val=v;b=m.i;}}best=b;depthDone=depth;}catch{break;}}
 return {point:best,nodes,depth:depthDone};
}
function valid(s){return s&&Array.isArray(s.board)&&s.board.length===36&&s.board.every(p=>p===null||(p&&['black','white'].includes(p.color)&&typeof p.migrated==='boolean'))&&['black','white'].includes(s.turn)&&['black','white'].every(c=>Array.isArray(s.locks?.[c])&&s.locks[c].every(i=>Number.isInteger(i)&&i>=0&&i<36))&&Array.isArray(s.seen)&&s.seen.every(x=>typeof x==='string')&&Number.isFinite(s.seed)&&Number.isInteger(s.ply)&&s.ply>=0&&typeof s.over==='boolean';}
const api={initial,play,pass,legal,basic,score,group,libs,adj,other,copy,hash,finish,adjudicate,evaluate,choose,valid,coord:i=>String.fromCharCode(65+i%6)+(6-Math.floor(i/6))};
if(typeof module!=='undefined')module.exports=api;root.ParityEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
