const {chromium}=require('C:/Users/SB/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(__dirname+'/index.html').href);await page.waitForFunction(()=>window.ParityApp&&window.BioUI);
 await page.evaluate(()=>{ParityApp.action(20);const r=ParityApp.record();r.events[0].details=['提子返还 1 VP；A5 孢子复苏；A6 变为永久死点。'.repeat(6)];ParityApp.importRecord(r);document.getElementById('btnRules').click();document.getElementById('btnReview').click();});
 assert.equal(await page.locator('.modal-overlay.active').count(),0);
 for(const [width,height]of [[2181,1069],[1440,900],[1024,768],[768,700],[390,844]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(350);
  const sizes=await page.evaluate(()=>{const rect=q=>{const e=document.querySelector(q),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height,client:e.clientWidth,scroll:e.scrollWidth};};return {container:rect('.review-container'),main:rect('.review-main'),side:rect('.review-side-col'),board:rect('#reviewBoard'),info:rect('#reviewMoveInfo')};});
  assert.ok(sizes.side.right<=sizes.container.right+1,JSON.stringify(sizes));assert.ok(sizes.side.left>=sizes.container.left-1);assert.ok(sizes.main.scroll<=sizes.main.client+1);assert.ok(sizes.info.scroll<=sizes.info.client+1);assert.ok(Math.abs(sizes.board.width-sizes.board.height)<1);
  if(width===1440||width===390)await page.screenshot({path:__dirname+'/review-fixed-'+width+'.png'});
  console.log(width+'px: columns contained, long text wraps, board square');
 }
 await page.setViewportSize({width:1440,height:900});await page.locator('#reviewModeSearch').click();await page.waitForFunction(()=>document.getElementById('parityAnalysis').textContent.includes('节点'));assert.doesNotMatch(await page.locator('#parityAnalysis').innerText(),/NaN|undefined/);await page.locator('#reviewBtnFirst').click();assert.match(await page.locator('#reviewMoveNotation').innerText(),/初始局面/);assert.equal(errors.length,0,errors.join('\n'));
 console.log('Review layout and search regression passed');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
