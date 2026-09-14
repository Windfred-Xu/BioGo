/* Theme-aware BGM. Audio starts only after a user gesture, as required by browsers. */
(()=>{
'use strict';
const TRACKS={classic:'经典',dark:'暗夜',blue:'蓝白',marble:'云石',darkwood:'暗木',ocean:'海洋',forest:'森林',sunset:'日暮',bio:'生物棋'};
const names=Object.values(TRACKS),storage='bio_go_bgm';
const $=id=>document.getElementById(id);
let audio,select,volume,toggle,status,wantsPlay=false;
function read(){try{return JSON.parse(localStorage.getItem(storage)||'{}')}catch{return {}}}
function save(){try{localStorage.setItem(storage,JSON.stringify({track:select?.value||'auto',volume:+(volume?.value||32),wantsPlay}))}catch{}}
function themeTrack(preset){return TRACKS[preset]||TRACKS.bio}
function activeTheme(){return window.ParityTheme?.getActivePreset?.()||'bio'}
function selectedTrack(){return select?.value&&select.value!=='auto'?select.value:themeTrack(activeTheme())}
function src(name){return 'bgm/'+encodeURIComponent(name)+'.mp3'}
function describe(){const active=selectedTrack(),following=select?.value==='auto';status.textContent=(following?'跟随主题：':'手动曲目：')+active+(audio?.paused?' · 已暂停':' · 播放中');}
function setTrack(name,attemptPlay=false){if(!audio)return;const next=src(name);if(audio.dataset.track!==name){audio.dataset.track=name;audio.src=next;audio.load();}if(attemptPlay||wantsPlay)play();else describe();}
function play(){if(!audio)return;wantsPlay=true;audio.play().then(()=>{toggle.textContent='暂停音乐';describe();save();}).catch(()=>{toggle.textContent='播放音乐';status.textContent='点击“播放音乐”以开启背景音乐';save();});}
function pause(){if(!audio)return;wantsPlay=false;audio.pause();toggle.textContent='播放音乐';describe();save();}
function applyTheme(preset){if(!select||select.value!=='auto')return;setTrack(themeTrack(preset),wantsPlay);}
function init(){
 const host=$('themePresetChips')?.closest('.modal');if(!host)return;
 const saved=read();
 audio=document.createElement('audio');audio.id='bioBgm';audio.loop=true;audio.preload='metadata';audio.setAttribute('aria-label','背景音乐');
 host.insertBefore(audio,host.querySelector('#themeBtnSave')?.parentElement||null);
 const section=document.createElement('section');section.className='theme-section bio-bgm-section';section.innerHTML='<div class="theme-section-label">背景音乐</div><div class="bio-bgm-controls"><button type="button" id="bgmToggle" class="theme-btn">播放音乐</button><select id="bgmTrack" aria-label="背景音乐曲目"><option value="auto">跟随当前主题</option>'+names.map(n=>'<option value="'+n+'">'+n+'</option>').join('')+'</select></div><label class="bio-bgm-volume">音量 <input id="bgmVolume" type="range" min="0" max="100" value="32" aria-label="背景音乐音量"><output id="bgmVolumeValue">32%</output></label><small id="bgmStatus" class="bio-bgm-status">首次点击播放后即可持续播放</small>';
 host.insertBefore(section,host.querySelector('#themeBtnSave')?.parentElement||null);
 select=$('bgmTrack');volume=$('bgmVolume');toggle=$('bgmToggle');status=$('bgmStatus');
 select.value=names.includes(saved.track)?saved.track:'auto';volume.value=Number.isFinite(+saved.volume)?Math.max(0,Math.min(100,+saved.volume)):32;audio.volume=+volume.value/100;wantsPlay=saved.wantsPlay===true;$('bgmVolumeValue').textContent=volume.value+'%';
 setTrack(selectedTrack(),false);
 toggle.onclick=()=>audio.paused?play():pause();
 select.onchange=()=>{setTrack(selectedTrack(),true);save();};
 volume.oninput=()=>{audio.volume=+volume.value/100;$('bgmVolumeValue').textContent=volume.value+'%';save();};
 audio.addEventListener('play',()=>{toggle.textContent='暂停音乐';describe();});audio.addEventListener('pause',()=>{toggle.textContent='播放音乐';describe();});audio.addEventListener('error',()=>{toggle.textContent='播放音乐';status.textContent='音乐文件无法加载，请检查 bgm 目录';});
 $('themePresetChips').addEventListener('click',e=>{const chip=e.target.closest('.theme-preset-chip');if(chip)applyTheme(chip.dataset.preset);});
 window.BioBGM={play,pause,setTrack:name=>setTrack(name,true),getTrack:selectedTrack};
 }
 window.addEventListener('DOMContentLoaded',init);
})();
