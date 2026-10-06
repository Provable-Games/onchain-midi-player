#!/usr/bin/env node
// Offline composed-provider/API/NFT visual smoke and timing checks, in each browser engine.
import assert from "node:assert/strict";
import { openBrowser,composed,dataUrl,waitReady,withoutBlock } from "./browser_harness.mjs";
import { tokenParts } from "../examples/beast_consumer/scripts/reference.mjs";
import { compositionHtml } from "./composition.mjs";
import { FIXTURES,fixtureCase } from "./fixture_pages.mjs";
import { fixedFragment,alignedFragment,b64 } from "./segments.mjs";
import { gzipFragment,gzipSource } from "./build_segments.mjs";
const run=await openBrowser(),measurements=[];
try {
 for(const c of [...FIXTURES.valid,{...tokenParts(4),name:"full_warlock",members:tokenParts(4).mem}]){const o=await run.page();try{await o.page.goto(dataUrl(composed(c)));await waitReady(o.page);
 const ready=await o.page.evaluate(()=>({created:window.__check.created,fixture:document.getElementById("play").dataset.fixture,dependent:document.getElementById("play").dataset.dependent,state:window.OnchainMidiPlayer.getPlayStatus(),ms:window.__check.uiReadyAt-window.__check.startedAt}));
 assert.equal(ready.created,0);assert.equal(ready.fixture,"fixture:ready");assert.equal(ready.dependent,"fixture:dependent");assert.equal(ready.state.state,"stopped");
 await o.page.click("#play");await o.page.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==="playing");
 await o.page.waitForFunction(()=>window.__check.passes.length>0,{timeout:10000});
 const played=await o.page.evaluate(()=>({passes:window.__check.passes,calls:window.__check.calls,art:document.getElementById("beast-art")?.src,media:window.__check.media?.paused,status:window.OnchainMidiPlayer.getPlayStatus(),firstPlay:window.__check.playingAt-window.__check.gestureAt,anchor:document.getElementById("play").getBoundingClientRect().toJSON(),artwork:navigator.mediaSession?.metadata?.artwork}));
 assert.ok(played.calls.indexOf("prewarm")<played.calls.indexOf("resume"));assert.equal(played.passes[0].initial,true);
 assert.ok(played.passes[0].audioTime >= played.passes[0].audibleTime-.02);assert.ok(/^data:image\/svg\+xml;(?:r=\d+;)?base64,/.test(played.art));assert.equal(played.media,false);
 if(c.name==="full_warlock"){assert.ok(played.anchor.width>=44&&played.anchor.width<=128);await o.page.waitForFunction(()=>navigator.mediaSession.metadata?.artwork.length===2);}
 await o.page.click("#play");await o.page.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==="stopped");
 const stopped=await o.page.evaluate(()=>({count:window.__check.passes.length,media:window.__check.media.paused,states:window.__check.states.map(s=>s.state),violations:window.__check.violations}));
 assert.equal(stopped.media,true);assert.deepEqual(stopped.states,["starting","playing","stopped"]);assert.deepEqual(stopped.violations,[]);
 assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);measurements.push({case:c.name,startup_ms:ready.ms,first_play_ms:played.firstPlay});
 console.log(`PASS ${c.name}: independent/dependent providers, lazy audio, pass event and NFT controls`);
 }finally{await o.context.close();}}
 // The NFT-owned button follows a supplied SVG anchor, including object-fit scaling.
 {const o=await run.page();try{await o.page.setViewportSize({width:500,height:700});const c=fixtureCase("beast_140bpm"),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" data-play-anchor="235 202 32"><rect width="250" height="350" fill="black"/></svg>';await o.page.goto(dataUrl(composed({...c,svg})));await waitReady(o.page);const box=await o.page.locator('#play').boundingBox();assert.deepEqual(box,{x:394,y:328,width:64,height:64});assert.deepEqual(await o.errors(),[]);console.log("PASS NFT button anchor and scaled touch target");}finally{await o.context.close();}}
 // A changed consumer head and isolated script-like art are accepted by the real HTML parser.
 {const c=fixtureCase("beast_140bpm"),svg=c.svg.replace('</svg>','<script>window.artInjection=true</script><desc><![CDATA[</SCRIPT>]]></desc></svg>');
 const o=await run.page();try{await o.page.goto(dataUrl(composed({...c,svg})));await waitReady(o.page);assert.equal(await o.page.evaluate(()=>window.artInjection),undefined);assert.equal(await o.page.locator('#beast-art').count(),1);assert.deepEqual(await o.errors(),[]);}finally{await o.context.close();}}
 for(const name of ["engine","player"]){const o=await run.page();try{await o.page.goto(dataUrl(withoutBlock(composed(),name)));await o.page.waitForFunction(()=>!document.getElementById("error").hidden);assert.equal(await o.page.locator('#beast-art').count(),1);assert.ok(await o.page.locator('#play').isDisabled());assert.equal(await o.page.evaluate(()=>window.__check.created),0);}finally{await o.context.close();}console.log(`PASS missing ${name}: art stays visible`);}
 // Synchronous library failure does not prevent an independent later provider from executing.
 {const o=await run.page();try{const bad=alignedFragment(gzipFragment('broken-library',gzipSource('throw Error("fixture evaluation failure")'))),html=composed().replace(fixedFragment('engine'),fixedFragment('engine')+bad);
 await o.page.goto(dataUrl(html));const result=await o.page.evaluate(async()=>{try{await window.OnchainLibraries.ready;return "resolved";}catch(e){return e.message;}});assert.match(result,/broken-library/);assert.equal(await o.page.evaluate(()=>window.DependentFixture),'fixture:dependent');}finally{await o.context.close();}}
 // Real browser parsing/evaluation checks for the generic loader, including late installation.
 for(const mode of ["late","repeat","duplicate","corrupt"]){const o=await run.page();try{let html=composed();
   if(mode==="late"){
     const loader=fixedFragment("gunzip"),source=/<script[^>]*>([\s\S]*?)<\/script>/.exec(loader)[1];
     html=html.replace(loader,'<script>document.addEventListener("DOMContentLoaded",()=>{const s=document.createElement("script");s.id="onchain-gunzip";s.textContent='+JSON.stringify(source)+';document.head.append(s)});</script>');
     // The ordinary NFT bootstrap must await the loader's existence when choosing late installation.
     html=html.replace('await window.OnchainLibraries.ready','await new Promise(r=>document.addEventListener("DOMContentLoaded",r)),await window.OnchainLibraries.ready');
   }else if(mode==="repeat")html=html.replace(fixedFragment("engine"),fixedFragment("gunzip")+fixedFragment("engine"));
   else if(mode==="duplicate")html=html.replace(fixedFragment("engine"),fixedFragment("engine")+fixedFragment("engine"));
   else {const engine=fixedFragment("engine"),payload=/base64,([^" ]+)/.exec(engine)[1],gzip=Buffer.from(payload,"base64");gzip[gzip.length-8]^=1;html=html.replace(engine,engine.replace(payload,gzip.toString("base64")));}
   await o.page.goto(dataUrl(html));
   if(mode==="late"||mode==="repeat"){await waitReady(o.page);assert.equal(await o.page.evaluate(()=>window.DependentFixture),"fixture:dependent");assert.equal(await o.page.locator('script#onchain-midi-engine').count(),1);assert.deepEqual(await o.errors(),[]);}
   else{const error=await o.page.evaluate(async()=>{try{await window.OnchainLibraries.ready;return"resolved";}catch(e){return e.message;}});assert.match(error,/onchain-midi-engine/);assert.equal(await o.page.evaluate(()=>window.DependentFixture),mode==="duplicate"?undefined:"fixture:dependent");assert.equal(await o.page.evaluate(()=>window.__check.created),0);}
   assert.deepEqual(o.requests,[]);console.log(`PASS generic loader ${mode}`);
 }finally{await o.context.close();}}
 // A consumer with its own control and visual names only uses the six-method headless API.
 {const o=await run.page();try{const data=fixtureCase("beast_140bpm").d;
 const html='<!doctype html><html><head>'+fixedFragment("gunzip")+fixedFragment("engine")+fixedFragment("player")+'</head><body><button id="transport" disabled>Sound</button><output id="pulse">0</output>'+data+'<script>(async()=>{await OnchainLibraries.ready;await OnchainMidiPlayer.ready;const a=OnchainMidiPlayer,b=document.getElementById("transport");let count=0;a.onPassStart(()=>document.getElementById("pulse").textContent=String(++count));a.onPassStart(()=>{throw Error("consumer subscriber")});b.onclick=()=>a.getPlayStatus().state==="playing"?a.stop():a.play();b.disabled=false;})();</script></body></html>';
 await o.page.goto(dataUrl(html));await o.page.waitForFunction(()=>!document.getElementById("transport").disabled);assert.equal(await o.page.evaluate(()=>window.__check.created),0);
 await o.page.click("#transport");await o.page.waitForFunction(()=>document.getElementById("pulse").textContent!=="0");assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),"playing");await o.page.click("#transport");assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),"stopped");assert.equal(await o.page.locator('#play,#beast-art,#settings,#midi,#art').count(),0);assert.deepEqual(await o.errors(),[]);assert.deepEqual(o.requests,[]);console.log("PASS independent NFT controls and visuals with headless API");
 }finally{await o.context.close();}}
 // Optional background/media APIs may fail without preventing ordinary Web Audio playback.
 {const o=await run.page();try{await o.context.addInitScript(()=>{URL.createObjectURL=()=>{throw Error("optional blob support")};window.MediaMetadata=function(){throw Error("optional media metadata")};});await o.page.goto(dataUrl(composed()));await waitReady(o.page);await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');await o.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),'stopped');assert.deepEqual(await o.errors(),[]);assert.deepEqual(o.requests,[]);console.log("PASS optional NFT media failures preserve ordinary playback and hidden fallback");}finally{await o.context.close();}}
 console.log(JSON.stringify({engine:run.engine,measurements},null,2));
}finally{await run.browser.close();}
