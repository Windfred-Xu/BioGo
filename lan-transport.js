/* MQTT-compatible transport over the bundled HTTP/SSE LAN relay. */
window.ParityLAN={connect(){
 const callbacks={},id='lan_'+Math.random().toString(36).slice(2),client={connected:false};let source=null,room='',stopped=false;
 client.on=(name,fn)=>{callbacks[name]=fn;return client;};
 client.subscribe=(topic,cb)=>{room=topic;source=new EventSource('/room/events?room='+encodeURIComponent(room)+'&id='+id);source.onopen=()=>{client.connected=true;cb();};source.onmessage=e=>{try{const payload=JSON.parse(e.data);callbacks.message?.(room,{toString:()=>payload});}catch{}};source.onerror=()=>{if(stopped)return;client.connected=false;callbacks.error?.(new Error('局域网房间连接失败，请确认两台设备使用相同游戏地址且房间未满。'));};};
 client.publish=(topic,payload)=>fetch('/room/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:topic,id,payload})}).then(r=>{if(!r.ok)callbacks.error?.(new Error('房间发送失败'));}).catch(e=>callbacks.error?.(e));
 client.end=()=>{stopped=true;source?.close();client.connected=false;};
 setTimeout(()=>{if(!stopped)callbacks.connect?.();},10);return client;
}};
