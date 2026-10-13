#!/usr/bin/env node
// Offline composed-provider/API/NFT visual smoke and timing checks, in each browser engine.
import assert from "node:assert/strict";
import { openBrowser,composed,dataUrl,waitReady,withoutBlock } from "./browser_harness.mjs";
import { tokenParts } from "../examples/beast_consumer/scripts/reference.mjs";
import { compositionHtml } from "./composition.mjs";
import { FIXTURES,fixtureCase } from "./fixture_pages.mjs";
import { fixedFragment,alignedFragment,b64 } from "./segments.mjs";
import { gzipFragment,gzipSource } from "./build_segments.mjs";
import { splitPage } from "../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs";
import { scriptBlocks } from "./html_blocks.mjs";
import { verifyLibraries } from "./verify_engine.mjs";
const run=await openBrowser(),measurements=[];
try {
 for(const c of [...FIXTURES.valid,{...tokenParts(4),name:"full_warlock",members:tokenParts(4).mem}]){const o=await run.page();try{await o.page.goto(dataUrl(composed(c)));await waitReady(o.page);
 const ready=await o.page.evaluate(()=>({created:window.__check.created,fixture:document.getElementById("play").dataset.fixture,dependent:document.getElementById("play").dataset.dependent,state:window.OnchainMidiPlayer.getPlayStatus(),ms:window.__check.uiReadyAt-window.__check.startedAt}));
 assert.equal(ready.created,0);assert.equal(ready.fixture,"fixture:ready");assert.equal(ready.dependent,"fixture:dependent");assert.equal(ready.state.state,"stopped");
 await o.page.click("#play");await o.page.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==="playing");
 await o.page.waitForFunction(()=>window.__check.passes.length>0,{timeout:10000});
 // Isolated art restarts at each pass: a fresh copy with a distinct data URL replaces the image once decoded.
 await o.page.waitForFunction(()=>/^data:image\/svg\+xml;r=\d+;base64,/.test(document.getElementById("beast-art")?.src),{timeout:10000});
 const played=await o.page.evaluate(()=>({passes:window.__check.passes,calls:window.__check.calls,art:document.getElementById("beast-art")?.src,images:document.querySelectorAll("img#beast-art").length,media:window.__check.media?.paused,status:window.OnchainMidiPlayer.getPlayStatus(),firstPlay:window.__check.playingAt-window.__check.gestureAt,anchor:document.getElementById("play").getBoundingClientRect().toJSON(),artwork:navigator.mediaSession?.metadata?.artwork}));
 assert.ok(played.calls.indexOf("prewarm")<played.calls.indexOf("resume"));assert.equal(played.passes[0].initial,true);
 assert.ok(played.passes[0].audioTime >= played.passes[0].audibleTime-.02);assert.ok(/^data:image\/svg\+xml;r=\d+;base64,/.test(played.art));assert.equal(played.images,1);assert.equal(played.media,false);
 if(c.name==="full_warlock"){assert.ok(played.anchor.width>=16&&played.anchor.width<=128);await o.page.waitForFunction(()=>navigator.mediaSession.metadata?.artwork.length===2);}
 await o.page.click("#play");await o.page.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==="paused");
 const stopped=await o.page.evaluate(()=>({count:window.__check.passes.length,media:window.__check.media.paused,states:window.__check.states.map(s=>s.state).filter((state,i,list)=>i===0||state!==list[i-1]),violations:window.__check.violations}));
 assert.equal(stopped.media,true);assert.deepEqual(stopped.states,["starting","playing","paused"]);assert.deepEqual(stopped.violations,[]);
 assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);measurements.push({case:c.name,startup_ms:ready.ms,first_play_ms:played.firstPlay});
 console.log(`PASS ${c.name}: independent/dependent providers, lazy audio, pass event and NFT controls`);
 }finally{await o.context.close();}}
 // HTML5 parser agreement on the two reproduced context bugs, using real provider fragments.
 for(const mode of ["normal","svg","plaintext"]){const o=await run.page();try{
   const prefix=mode==="svg"?"<svg/>":mode==="plaintext"?"<plaintext>":"";
   const html="<!doctype html><body>"+prefix+fixedFragment("gunzip")+fixedFragment("player")+fixtureCase("beast_140bpm").d;
   await o.page.goto(dataUrl(html));
   const ids=await o.page.evaluate(()=>[...document.querySelectorAll("script")].filter(s=>s.namespaceURI==="http://www.w3.org/1999/xhtml").map(s=>s.id));
   assert.deepEqual(scriptBlocks(html).map(s=>s.attrs.id),ids);
   if(mode==="plaintext"){assert.deepEqual(ids,[]);assert.throws(()=>verifyLibraries(html),/found 0/);}
   else{verifyLibraries(html);await o.page.evaluate(async()=>{await OnchainLibraries.ready;await OnchainMidiPlayer.ready;});}
   assert.deepEqual(await o.errors(),[]);console.log(`PASS HTML5 extraction/browser agreement ${mode}`);
 }finally{await o.context.close();}}
 // SVG gzip decoys are inert; HTML libraries inside foreignObject remain loader candidates.
 {const o=await run.page();try{
   const extra=alignedFragment(gzipFragment('foreign-object-library',gzipSource('window.ForeignObjectRuns=(window.ForeignObjectRuns||0)+1')));
   const html=composed().replace('</body>','<svg>'+fixedFragment('player')+'<foreignObject>'+extra+'</foreignObject></svg></body>');
   verifyLibraries(html);await o.page.goto(dataUrl(html));await waitReady(o.page);
   assert.equal(await o.page.evaluate(()=>window.ForeignObjectRuns),1);
   assert.equal(await o.page.evaluate(()=>window.DependentFixture),'fixture:dependent');
   assert.deepEqual(await o.errors(),[]);console.log('PASS SVG gzip decoy ignored; foreignObject HTML library executes once');
 }finally{await o.context.close();}}
 // Data-ID collisions fail offchain and at runtime; template contents do not enter the document.
 for(const decoy of ['<div id="onchain-midi-data"></div>','<svg><g id="onchain-midi-data"/></svg>','<template><div id="onchain-midi-data"></div></template>']){
   const o=await run.page();try{const html=composed().replace('</body>',decoy+'</body>');
     if(decoy.startsWith('<template>'))splitPage(Buffer.from(html));else assert.throws(()=>splitPage(Buffer.from(html)),/found 2/);
     await o.page.goto(dataUrl(html));
     const result=await o.page.evaluate(async()=>{await OnchainLibraries.ready;try{await OnchainMidiPlayer.ready;return 'ready';}catch(e){return e.message;}});
     if(decoy.startsWith('<template>'))assert.equal(result,'ready');else assert.match(result,/onchain-midi-data.*found 2/);
     assert.equal(await o.page.evaluate(()=>window.__check.created),0);
     console.log('PASS document data-ID selection '+(decoy.startsWith('<template>')?'inert template':'collision'));
   }finally{await o.context.close();}
 }
 // A unique SVG script is not a player data block, matching the offchain extractor.
 {const o=await run.page();try{let html=composed();const block=scriptBlocks(html).find(b=>b.attrs.id==='onchain-midi-data');
   html=html.slice(0,block.start)+'<svg>'+block.html+'</svg>'+html.slice(block.end);
   assert.throws(()=>splitPage(Buffer.from(html)),/complete HTML text\/plain script/);
   await o.page.goto(dataUrl(html));const result=await o.page.evaluate(async()=>{await OnchainLibraries.ready;try{await OnchainMidiPlayer.ready;return 'ready';}catch(e){return e.message;}});
   assert.match(result,/onchain-midi-data.*found 1/);assert.equal(await o.page.evaluate(()=>window.__check.created),0);
   console.log('PASS unique SVG data rejected by extractor and player');
 }finally{await o.context.close();}}
 // The NFT-owned button follows a supplied SVG anchor, including object-fit scaling.
 {const o=await run.page();try{await o.page.setViewportSize({width:500,height:700});const c=fixtureCase("beast_140bpm"),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" data-play-anchor="235 202 32"><rect width="250" height="350" fill="black"/></svg>';await o.page.goto(dataUrl(composed({...c,svg})));await waitReady(o.page);const box=await o.page.locator('#play').boundingBox();
   // The shipped stylesheet fixes the diameter at 16 px (--play-min = --play-max); the anchor's inset still scales (6 units at scale 2: 12 px).
   assert.deepEqual(box,{x:470-12-16,y:404-12-16,width:16,height:16});
   // --play-target keeps a 44 px touch target around it: a tap 10 px outside the drawn button still reaches it.
   assert.equal(await o.page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.id,[box.x-10,box.y+8]),"play");
   // The size is a page setting: wider limits give the art's own diameter (32 units at scale 2: 64 px) with no code change.
   await o.page.addStyleTag({content:":root{--play-min:44px;--play-max:128px}"});await o.page.evaluate(()=>window.dispatchEvent(new Event("resize")));
   assert.deepEqual(await o.page.locator('#play').boundingBox(),{x:394,y:328,width:64,height:64});
   assert.deepEqual(await o.errors(),[]);console.log("PASS NFT button anchor, stylesheet size settings and touch target");}finally{await o.context.close();}}
 // A changed consumer head and isolated script-like art are accepted by the real HTML parser.
 {const c=fixtureCase("beast_140bpm"),svg=c.svg.replace('</svg>','<script>window.artInjection=true</script><desc><![CDATA[</SCRIPT>]]></desc></svg>');
 const o=await run.page();try{await o.page.goto(dataUrl(composed({...c,svg})));await waitReady(o.page);assert.equal(await o.page.evaluate(()=>window.artInjection),undefined);assert.equal(await o.page.locator('#beast-art').count(),1);assert.deepEqual(await o.errors(),[]);}finally{await o.context.close();}}
 for(const name of ["player"]){const o=await run.page();try{await o.page.goto(dataUrl(withoutBlock(composed(),name)));await o.page.waitForFunction(()=>!document.getElementById("error").hidden);assert.equal(await o.page.locator('#beast-art').count(),1);assert.ok(await o.page.locator('#play').isDisabled());assert.equal(await o.page.evaluate(()=>window.__check.created),0);}finally{await o.context.close();}console.log(`PASS missing ${name}: art stays visible`);}
 // Trusted inline art keeps animating on its own clocks when MIDI readiness fails.
 {const o=await run.page();try{
   const c=fixtureCase('beast_140bpm'),svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"><animate attributeName="x" from="0" to="10" dur="1s" repeatCount="indefinite"/></rect><svg><rect width="10" height="10"><animate attributeName="x" from="0" to="10" dur="1s" repeatCount="indefinite"/></rect></svg></svg>';
   await o.page.goto(dataUrl(withoutBlock(composed({...c,svg},{fixture:true,dependent:true,trustedArt:true}),'player')));
   await o.page.waitForFunction(()=>!document.getElementById('error').hidden);
   assert.ok(await o.page.locator('#play').isDisabled());
   const paused=await o.page.evaluate(()=>{const root=document.getElementById('beast-art');return[root,...root.querySelectorAll('svg')].map(s=>s.animationsPaused());});
   assert.deepEqual(paused,[false,false]);assert.equal(await o.page.evaluate(()=>window.__check.created),0);
   assert.deepEqual(await o.errors(),[]);console.log('PASS missing player: trusted outer/nested SVG animations keep running');
 }finally{await o.context.close();}}
 // Public engine resume rejection is a terminal player failure, with independently running art.
 {const o=await run.page();try{
   const c=fixtureCase('beast_140bpm'),svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"><animate attributeName="x" from="0" to="10" dur="1s" repeatCount="indefinite"/></rect><svg><rect width="10" height="10"><animate attributeName="x" from="0" to="10" dur="1s" repeatCount="indefinite"/></rect></svg></svg>';
   await o.page.goto(dataUrl(composed({...c,svg},{fixture:true,dependent:true,trustedArt:true})));await waitReady(o.page);
   // Synced at the initial pass, then paused: frozen where the audio stopped.
   await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing'&&window.__check.passes.length>0);
   await o.page.click('#play');await o.page.waitForFunction(()=>{const root=document.getElementById('beast-art');return OnchainMidiPlayer.getPlayStatus().state==='paused'&&[root,...root.querySelectorAll('svg')].every(s=>s.animationsPaused());});
   await o.page.evaluate(()=>{window.__check.synth.resume=()=>Promise.reject(Error('fixture resume failure'));});
   await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='failed'&&!document.getElementById('error').hidden);
   assert.ok(await o.page.locator('#play').isDisabled());assert.match(await o.page.locator('#error').textContent(),/fixture resume failure/);
   const timelines=()=>o.page.evaluate(()=>{const root=document.getElementById('beast-art');return[root,...root.querySelectorAll('svg')].map(s=>({paused:s.animationsPaused(),time:s.getCurrentTime()}));});
   const before=await timelines();assert.ok(before.every(s=>!s.paused));await o.page.waitForTimeout(300);
   const after=await timelines();assert.ok(after.every((s,i)=>!s.paused&&s.time>before[i].time+.05));
   assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),'failed');
   assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);console.log('PASS terminal resume failure: disabled controls/error and independently running outer/nested SVG');
 }finally{await o.context.close();}}
 // Synchronous library failure does not prevent an independent later provider from executing.
 {const o=await run.page();try{const bad=alignedFragment(gzipFragment('broken-library',gzipSource('throw Error("fixture evaluation failure")'))),html=composed().replace(fixedFragment('player'),fixedFragment('player')+bad);
 await o.page.goto(dataUrl(html));const result=await o.page.evaluate(async()=>{try{await window.OnchainLibraries.ready;return "resolved";}catch(e){return e.message;}});assert.match(result,/broken-library/);assert.equal(await o.page.evaluate(()=>window.DependentFixture),'fixture:dependent');
 await o.page.waitForFunction(()=>!document.getElementById("error").hidden);
 assert.ok(await o.page.locator('#play').isDisabled());
 assert.equal(await o.page.evaluate(async()=>{await OnchainMidiPlayer.ready;return OnchainMidiPlayer.getPlayStatus().state;}),'stopped');
 assert.equal(await o.page.evaluate(()=>window.__check.created),0);
 console.log('PASS reference NFT requires whole-composition readiness after independent failure');
 }finally{await o.context.close();}}
 // An NFT can deliberately recover MIDI-only controls after an unrelated library failure.
 {const o=await run.page();try{const bad=alignedFragment(gzipFragment('broken-library',gzipSource('throw Error("fixture evaluation failure")')));
 const html='<!doctype html><html><head>'+fixedFragment('gunzip')+fixedFragment('player')+bad+'</head><body><button id="midi-only-play" disabled>Play MIDI</button>'+fixtureCase('beast_140bpm').d+'<script>(async()=>{try{await OnchainLibraries.ready;}catch(error){window.libraryFailure=error.message;}const player=window.OnchainMidiPlayer;if(!player)throw Error("MIDI library did not load");await player.ready;const button=document.getElementById("midi-only-play");button.onclick=()=>player.play().catch(console.error);button.disabled=false;})().catch(error=>{window.bootstrapFailure=error.message;});</script></body></html>';
 await o.page.goto(dataUrl(html));await o.page.waitForFunction(()=>!document.getElementById('midi-only-play').disabled);
 assert.match(await o.page.evaluate(()=>window.libraryFailure),/broken-library/);
 assert.equal(await o.page.evaluate(()=>window.bootstrapFailure),undefined);
 assert.equal(await o.page.evaluate(()=>window.__check.created),0);
 await o.page.click('#midi-only-play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
 await o.page.evaluate(()=>OnchainMidiPlayer.stop());assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),'stopped');
 assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);
 console.log('PASS explicit NFT MIDI-only recovery after independent failure');
 }finally{await o.context.close();}}
 // Real browser parsing/evaluation checks for the generic loader, including late installation.
 for(const mode of ["late","repeat","duplicate","corrupt"]){const o=await run.page();try{let html=composed();
   if(mode==="late"){
     const loader=fixedFragment("gunzip"),source=/<script[^>]*>([\s\S]*?)<\/script>/.exec(loader)[1];
     html=html.replace(loader,'<script>document.addEventListener("DOMContentLoaded",()=>{const s=document.createElement("script");s.id="onchain-gunzip";s.textContent='+JSON.stringify(source)+';document.head.append(s)});</script>');
     // The ordinary NFT bootstrap must await the loader's existence when choosing late installation.
     html=html.replace('await window.OnchainLibraries.ready','await new Promise(r=>document.addEventListener("DOMContentLoaded",r)),await window.OnchainLibraries.ready');
   }else if(mode==="repeat")html=html.replace(fixedFragment("player"),fixedFragment("gunzip")+fixedFragment("player"));
   else if(mode==="duplicate")html=html.replace(fixedFragment("player"),fixedFragment("player")+fixedFragment("player"));
   else {const engine=fixedFragment("player"),payload=/base64,([^" ]+)/.exec(engine)[1],gzip=Buffer.from(payload,"base64");gzip[gzip.length-8]^=1;html=html.replace(engine,engine.replace(payload,gzip.toString("base64")));}
   await o.page.goto(dataUrl(html));
   if(mode==="late"||mode==="repeat"){await waitReady(o.page);assert.equal(await o.page.evaluate(()=>window.DependentFixture),"fixture:dependent");assert.equal(await o.page.locator('script#onchain-midi-player').count(),1);assert.deepEqual(await o.errors(),[]);}
   else{const error=await o.page.evaluate(async()=>{try{await window.OnchainLibraries.ready;return"resolved";}catch(e){return e.message;}});assert.match(error,/onchain-midi-player/);assert.equal(await o.page.evaluate(()=>window.DependentFixture),mode==="duplicate"?undefined:"fixture:dependent");assert.equal(await o.page.evaluate(()=>window.__check.created),0);}
   assert.deepEqual(o.requests,[]);console.log(`PASS generic loader ${mode}`);
 }finally{await o.context.close();}}
 // A consumer with its own control and visual names only uses the six-method headless API.
 {const o=await run.page();try{const data=fixtureCase("beast_140bpm").d;
 const html='<!doctype html><html><head>'+fixedFragment("gunzip")+fixedFragment("player")+'</head><body><button id="transport" disabled>Sound</button><output id="pulse">0</output>'+data+'<script>(async()=>{await OnchainLibraries.ready;await OnchainMidiPlayer.ready;const a=OnchainMidiPlayer,b=document.getElementById("transport");let count=0;a.onPassStart(()=>document.getElementById("pulse").textContent=String(++count));a.onPassStart(()=>{throw Error("consumer subscriber")});b.onclick=()=>a.getPlayStatus().state==="playing"?a.stop():a.play();b.disabled=false;})();</script></body></html>';
 await o.page.goto(dataUrl(html));await o.page.waitForFunction(()=>!document.getElementById("transport").disabled);assert.equal(await o.page.evaluate(()=>window.__check.created),0);
 await o.page.click("#transport");await o.page.waitForFunction(()=>document.getElementById("pulse").textContent!=="0");assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),"playing");await o.page.click("#transport");assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),"stopped");assert.equal(await o.page.locator('#play,#beast-art,#settings,#midi,#art').count(),0);assert.deepEqual(await o.errors(),[]);assert.deepEqual(o.requests,[]);console.log("PASS independent NFT controls and visuals with headless API");
 }finally{await o.context.close();}}
 // Optional background/media APIs may fail without preventing ordinary Web Audio playback.
 {const o=await run.page();try{await o.context.addInitScript(()=>{URL.createObjectURL=()=>{throw Error("optional blob support")};window.MediaMetadata=function(){throw Error("optional media metadata")};});await o.page.goto(dataUrl(composed()));await waitReady(o.page);await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');await o.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await o.page.evaluate(()=>OnchainMidiPlayer.getPlayStatus().state),'paused');assert.deepEqual(await o.errors(),[]);assert.deepEqual(o.requests,[]);console.log("PASS optional NFT media failures preserve ordinary playback and hidden fallback");}finally{await o.context.close();}}
 console.log(JSON.stringify({engine:run.engine,measurements},null,2));
}finally{await run.browser.close();}
