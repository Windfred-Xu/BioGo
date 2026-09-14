/* Optional LAN room relay and static game server. No dependencies. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const base=__dirname,rooms=new Map(),port=Number(process.env.PARITY_PORT)||8766;
const allowed=new Set(['index.html','bio-ui.js','bio-design.css','bio-features.js','bio-engine.js','Chemiss-UI-基线.html','parity-app.js','baseline-modules.js','parity-features.js','parity-engine.js','parity-baseline.css','lan-transport.js','vendor/mqtt.min.js']);
const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_/-]{1,80}$/.test(s);
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/room/events'){
  const room=u.searchParams.get('room'),id=u.searchParams.get('id');if(!valid(room)||!valid(id)){res.writeHead(400);res.end();return;}
  const peers=rooms.get(room)||new Map();if(peers.size>=2&&!peers.has(id)){res.writeHead(409);res.end('Room full');return;}
  peers.get(id)?.end();res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');peers.set(id,res);rooms.set(room,peers);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
  req.on('close',()=>{clearInterval(heartbeat);if(peers.get(id)===res)peers.delete(id);if(!peers.size)rooms.delete(room);});return;
 }
 if(u.pathname==='/room/send'&&req.method==='POST'){
  let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>10*1024*1024){res.writeHead(413);res.end();req.destroy();}else body+=chunk;});req.on('end',()=>{try{const {room,id,payload}=JSON.parse(body);const peers=rooms.get(room);if(!peers?.has(id)||typeof payload!=='string'){res.writeHead(403);res.end();return;}JSON.parse(payload);for(const [p,out]of peers)if(p!==id)out.write('data: '+JSON.stringify(payload)+'\n\n');res.writeHead(204);res.end();}catch{res.writeHead(400);res.end();}});return;
 }
 const file=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
 fs.readFile(path.join(base,file),(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});res.end(data);});
});
server.listen(port,'0.0.0.0',()=>{console.log('生物棋：http://localhost:'+port);for(const list of Object.values(require('node:os').networkInterfaces()))for(const n of list)if(n.family==='IPv4'&&!n.internal)console.log('同一局域网的其他设备打开：http://'+n.address+':'+port);});
