#!/usr/bin/env node
// Offline composed-provider/API/NFT visual smoke and timing checks, in each browser engine.
import assert from "node:assert/strict";
import { openBrowser,composed,dataUrl,waitReady,withoutBlock } from "./browser_harness.mjs";
import { mkdirSync,writeFileSync } from "node:fs";
import { tokenParts,animationHtml } from "../examples/beast_consumer/scripts/reference.mjs";
import { compositionHtml,ownedFragment } from "./composition.mjs";
import { decodePng } from "./png.mjs";
import { FIXTURES,fixtureCase } from "./fixture_pages.mjs";
import { fixedFragment,alignedFragment,b64 } from "./segments.mjs";
import { gzipFragment,gzipSource } from "./build_segments.mjs";
import { splitPage } from "../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs";
import { scriptBlocks } from "./html_blocks.mjs";
import { verifyLibraries } from "./verify_engine.mjs";
const run=await openBrowser(),measurements=[];
// Screenshots of the notes checks go to the directory given, if any (CI uploads it when a check fails).
const shots=process.argv[2];if(shots)mkdirSync(shots,{recursive:true});
try {
 for(const c of [...FIXTURES.valid,{...tokenParts(4),name:"full_warlock",members:tokenParts(4).mem}]){const o=await run.page();try{await o.page.goto(dataUrl(composed(c)));await waitReady(o.page);
 const ready=await o.page.evaluate(()=>({created:window.__check.created,fixture:document.getElementById("play").dataset.fixture,dependent:document.getElementById("play").dataset.dependent,state:window.OnchainMidiPlayer.getPlayStatus(),ms:window.__check.uiReadyAt-window.__check.startedAt}));
 assert.equal(ready.created,0);assert.equal(ready.fixture,"fixture:ready");assert.equal(ready.dependent,"fixture:dependent");assert.equal(ready.state.state,"stopped");
 await o.page.click("#play");await o.page.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==="playing");
 await o.page.waitForFunction(()=>window.__check.passes.length>0,{timeout:10000});
 // Isolated art restarts at each pass: a fresh copy with a distinct data URL replaces the image once decoded.
 await o.page.waitForFunction(()=>/^data:image\/svg\+xml;r=\d+;base64,/.test(document.getElementById("beast-art")?.src),{timeout:10000});
 const played=await o.page.evaluate(()=>({passes:window.__check.passes,calls:window.__check.calls,art:document.getElementById("beast-art")?.src,images:document.querySelectorAll("img#beast-art").length,media:window.__check.media?.paused,status:window.OnchainMidiPlayer.getPlayStatus(),firstPlay:window.__check.playingAt-window.__check.gestureAt,position:window.__check.positions.at(-1),anchor:document.getElementById("play").getBoundingClientRect().toJSON(),artwork:navigator.mediaSession?.metadata?.artwork}));
 assert.ok(played.calls.indexOf("prewarm")<played.calls.indexOf("resume"));assert.equal(played.passes[0].initial,true);
 assert.ok(played.passes[0].audioTime >= played.passes[0].audibleTime-.02);assert.ok(/^data:image\/svg\+xml;r=\d+;base64,/.test(played.art));assert.equal(played.images,1);assert.equal(played.media,false);
 // The media session's position is the pass (the notification's track length), not the silent carrier's 6 s.
 assert.equal(played.position.duration,played.status.passSeconds);assert.ok(played.position.position>=0&&played.position.position<played.position.duration,JSON.stringify(played.position));
 // Without the notes fragment the page has no notes: no canvas, the art restarted as it was.
 assert.equal(await o.page.locator("canvas").count(),0);
 // No reference art carries a data-play-anchor: the stylesheet's corner button takes the 48 px default between the settings' limits.
 assert.equal(played.anchor.width,48);assert.equal(played.anchor.height,48);
 if(c.name==="full_warlock"){await o.page.waitForFunction(()=>navigator.mediaSession.metadata?.artwork.length===2);}
 await o.page.click("#play");await o.page.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==="paused");
 const stopped=await o.page.evaluate(()=>({position:window.__check.positions.at(-1),count:window.__check.passes.length,media:window.__check.media.paused,states:window.__check.states.map(s=>s.state).filter((state,i,list)=>i===0||state!==list[i-1]),violations:window.__check.violations}));
 assert.equal(stopped.media,true);assert.equal(stopped.position?.duration,played.status.passSeconds,"pause keeps the position state");assert.deepEqual(stopped.states,["starting","playing","paused"]);assert.deepEqual(stopped.violations,[]);
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
   // The shipped limits (16-128 px) keep the art's own diameter: 32 units at scale 2 are 64 px, the inset 6 units (12 px).
   assert.deepEqual(box,{x:394,y:328,width:64,height:64});
   // The size is a page setting: equal limits fix it with no code change, and --play-target keeps a 44 px
   // touch target around the smaller button (a tap 10 px outside the drawn circle still reaches it).
   await o.page.addStyleTag({content:":root{--play-min:16px;--play-max:16px}"});await o.page.evaluate(()=>window.dispatchEvent(new Event("resize")));
   const fixed=await o.page.locator('#play').boundingBox();assert.deepEqual(fixed,{x:470-12-16,y:404-12-16,width:16,height:16});
   assert.equal(await o.page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.id,[fixed.x-10,fixed.y+8]),"play");
   // An anchor without S takes the 48 px default between the same limits, at the unscaled 6 px inset.
   await o.page.goto(dataUrl(composed({...c,svg:svg.replace('data-play-anchor="235 202 32"','data-play-anchor="235 202"')})));await waitReady(o.page);
   assert.deepEqual(await o.page.locator('#play').boundingBox(),{x:470-6-48,y:404-6-48,width:48,height:48});
   assert.deepEqual(await o.errors(),[]);console.log("PASS NFT button anchor, stylesheet size settings and touch target");}finally{await o.context.close();}}
 // Optional notes behind the art: the NFT-owned notes fragment (player/notes.js) and the footer's
 // startNotes. The card's marked frame, (15, 58) 220 x 144, is wider than its "sprite" (red, 60 x 60),
 // so the notes show around it: on a canvas just behind the art, over the frame, which is cut out of
 // the page's copy of the art only. At 500 x 700 the card is drawn at scale 2.
 {const c=fixtureCase("beast_140bpm");
  const card=marked=>"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 250 350'><rect width='250' height='350' fill='#1e1e22'/><rect"+(marked?" data-notes-bg=''":"")+
    " x='15' y='58' width='220' height='144' rx='8' fill='#000'/><rect x='95' y='100' width='60' height='60' fill='#c00'/></svg>";
  // Ready, and the notes settled: an <img> shows the cut-out copy once it decodes, or keeps its own URL and loses the canvas.
  const page=async(html,options={})=>{const o=await run.page();if(options.reducedMotion)await o.page.emulateMedia({reducedMotion:"reduce"});
    await o.page.setViewportSize({width:500,height:700});await o.page.goto(dataUrl(html));await waitReady(o.page);
    await o.page.waitForFunction(()=>{const a=document.getElementById("beast-art");return !(a instanceof HTMLImageElement)||!/^data:image\/svg\+xml;base64,/.test(a.src)||!document.querySelector("canvas");});return o;};
  const notesPage=(marked,trustedArt,notes=true)=>composed({...c,svg:card(marked)},{fixture:true,dependent:true,trustedArt,notes});
  // Coloured pixels in the frame around the sprite (the notes; the frame itself is black), the sprite's and the card's colour.
  // Screenshot pixels: the frame and the sprite, each inset 4 px from its edges (the frame) or grown by 4 px (the sprite).
  const CARD={frame:[34,120,466,400],sprite:[186,196,314,324]},REFERENCE={frame:[126,134,374,382],sprite:[166,174,334,342]};
  const look=async(o,name,{frame:[x0,y0,x1,y1],sprite:[sx0,sy0,sx1,sy1]}=CARD)=>{const png=await o.page.screenshot();if(shots)writeFileSync(`${shots}/${name}-${run.engine}.png`,png);const img=decodePng(png);let notes=0;
    for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2)if(!(x>=sx0&&x<sx1&&y>=sy0&&y<sy1)&&Math.max(...img.pixel(x,y))>40)notes++;
    return{notes,sprite:img.pixel(250,260),card:img.pixel(20,600)};};
  const near=(rgb,want)=>rgb.every((v,i)=>Math.abs(v-want[i])<=4);
  const layout=o=>o.page.evaluate(()=>{const art=document.getElementById("beast-art"),canvas=document.querySelector("canvas"),src=art.getAttribute("src")||"";
    return{canvases:document.querySelectorAll("canvas").length,behind:!!canvas&&canvas.nextElementSibling===art,box:canvas&&(({x,y,width,height})=>({x,y,width,height}))(canvas.getBoundingClientRect()),
      inline:art instanceof SVGSVGElement,src:src.slice(0,src.indexOf(",")+1),cut:art instanceof SVGSVGElement?!!art.querySelector("mask#onchain-midi-notes"):/<mask[^>]*id="onchain-midi-notes"/.test(decodeURIComponent(src.split(",")[1]||""))};});
  const drawing=o=>o.page.evaluate(()=>document.querySelector("canvas").toDataURL());
  const frozen=async o=>{const a=await drawing(o);await o.page.waitForTimeout(300);return a===await drawing(o);};
  const playAndPass=async o=>{await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==="playing"&&window.__check.passes.length>0,{timeout:10000});};
  for(const trustedArt of [false,true]){const mode=trustedArt?"inline":"img",o=await page(notesPage(true,trustedArt));try{
    assert.deepEqual(await layout(o),{canvases:1,behind:true,box:{x:30,y:116,width:440,height:288},inline:trustedArt,src:trustedArt?"":"data:image/svg+xml,",cut:true});
    const idle=await look(o,`notes-${mode}-idle`);assert.ok(idle.notes>100,`notes drawn around the sprite: ${idle.notes}`);assert.ok(near(idle.sprite,[204,0,0]),"the sprite over them");assert.ok(near(idle.card,[30,30,34]),"the card unchanged");
    assert.ok(await frozen(o),"standing still before play");
    await playAndPass(o);
    if(!trustedArt)await o.page.waitForFunction(()=>/^data:image\/svg\+xml;r=\d+,/.test(document.getElementById("beast-art").src),{timeout:10000});
    const playing=await layout(o);assert.deepEqual([playing.canvases,playing.behind,playing.cut],[1,true,true],"a restarted <img> is the cut-out copy, still in front of the canvas");
    assert.ok(!(await frozen(o)),"scrolling with the music");assert.ok((await look(o,`notes-${mode}-playing`)).notes>100);
    // The notes pause in the first animation frame that sees the suspended audio: wait for two.
    await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==="suspended");
    await o.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.ok(await frozen(o),"paused with the music");
    await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==="playing"&&OnchainMidiPlayer.getPlayStatus().audioState==="running");
    assert.ok(!(await frozen(o)),"resumed");
    assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);console.log(`PASS notes behind ${mode} art: canvas behind it over the marked frame, standing still, playing, paused, resumed`);
  }finally{await o.context.close();}}
  // The reference consumer's own page: trusted art, its 128 x 128 frame (61, 65) around an opaque 80 x 80 sprite (85, 89).
  {const o=await page(animationHtml(1));try{
    assert.deepEqual(await layout(o),{canvases:1,behind:true,box:{x:122,y:130,width:256,height:256},inline:true,src:"",cut:true});
    const idle=await look(o,"notes-reference-idle",REFERENCE);assert.ok(idle.notes>100,`notes shown around the sprite: ${idle.notes}`);
    await playAndPass(o);assert.ok(!(await frozen(o)));assert.ok((await look(o,"notes-reference-playing",REFERENCE)).notes>100);
    assert.deepEqual(await o.errors(),[]);console.log("PASS reference consumer page: notes shown behind its art, around its sprite");
  }finally{await o.context.close();}}
  // A cut-out copy that fails to decode: the art keeps its own URL (never blank), the mounted notes are removed, playback as usual.
  {const broken=ownedFragment("notes")+"<script>{const N=window.OnchainMidiNotes;window.OnchainMidiNotes={mount:(c,o)=>(window.__notesMounted=1,N.mount(c,o)),cutout:()=>\"<svg xmlns='http://www.w3.org/2000/svg'><unclosed\"}}</script>";
   const o=await page(notesPage(true,false).replace(ownedFragment("notes"),broken));try{
    const at=await layout(o);assert.deepEqual([at.canvases,at.src,at.cut],[0,"data:image/svg+xml;base64,",false]);
    assert.equal(await o.page.evaluate(()=>window.__notesMounted),1,"mounted, then removed");
    const shot=await look(o,"notes-undecodable");assert.equal(shot.notes,0,"no notes");assert.ok(near(shot.sprite,[204,0,0]),"the art shown");assert.ok(near(shot.card,[30,30,34]));
    await playAndPass(o);await o.page.waitForFunction(()=>/^data:image\/svg\+xml;r=\d+;base64,/.test(document.getElementById("beast-art").src),{timeout:10000});
    assert.equal(await o.page.locator("canvas").count(),0);assert.ok(near((await look(o,"notes-undecodable-playing")).sprite,[204,0,0]),"restarted from the original");
    assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);console.log("PASS cut-out copy that fails to decode: the art as it was, no canvas, restarts from the original, ordinary playback");
  }finally{await o.context.close();}}
  // An isolated <img> freezes with the music: its GIF (red, then blue, 200 ms each) stands still from
  // a pause, on a still the page made of the frame it showed, and moves again after resume, from a
  // restart. With the notes, the still and the restart are of the cut-out copy. Headless Firefox 155
  // showed only the first frame of a GIF inside an SVG image (its own <img> animated): there the art does not move,
  // and only the still and the restart are checked.
  {const gif=Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,204,0,0,0,0,204,33,255,11,...Buffer.from("NETSCAPE2.0"),3,1,0,0,0,
     33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]).toString("base64");
   const gifCard=card(true).replace("<rect x='95' y='100' width='60' height='60' fill='#c00'/>",`<image x='95' y='100' width='60' height='60' style='image-rendering:pixelated' href='data:image/gif;base64,${gif}'/>`);
   // The sprite's colours seen over `ms` (screenshots of its centre), as "r,g,b" strings.
   const colours=async(o,ms)=>{const seen=new Set(),end=Date.now()+ms;while(Date.now()<end){seen.add(decodePng(await o.page.screenshot({clip:{x:240,y:250,width:20,height:20}})).pixel(10,10).join());await o.page.waitForTimeout(30);}return seen;};
   const art=o=>o.page.evaluate(()=>{const src=document.getElementById("beast-art").src,body=src.slice(src.indexOf(",")+1),svg=/;base64,/.test(src.slice(0,src.indexOf(",")+1))?atob(body):decodeURIComponent(body);
     return{restarted:/^data:image\/svg\+xml;r=\d+[;,]/.test(src),still:svg.includes("data:image/png;base64,")&&!svg.includes("data:image/gif"),cut:/<mask[^>]*id="onchain-midi-notes"/.test(svg)};});
   for(const notes of [false,true]){const o=await page(composed({...c,svg:gifCard},{fixture:true,dependent:true,notes}));try{
     const moves=(await colours(o,700)).size>=2;assert.ok(moves||run.engine==="firefox",`the GIF animates in the image (${run.engine})`);
     const moving=async message=>{if(moves)assert.ok((await colours(o,700)).size>=2,message);};
     await playAndPass(o);await o.page.waitForFunction(()=>/;r=\d+[;,]/.test(document.getElementById("beast-art").src),{timeout:10000});
     assert.deepEqual(await art(o),{restarted:true,still:false,cut:notes});await moving("animating while the music plays");
     await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==="suspended");
     await o.page.waitForFunction(()=>{const src=document.getElementById("beast-art").src;const i=src.indexOf(",");return /;base64,/.test(src.slice(0,i+1))&&atob(src.slice(i+1)).includes("data:image/png;base64,");},{timeout:10000});
     assert.deepEqual(await art(o),{restarted:true,still:true,cut:notes},"the still of the art shown");
     const held=await colours(o,800);assert.equal(held.size,1,`standing still while paused: ${[...held]}`);assert.ok(["204,0,0","0,0,204"].some(rgb=>held.has(rgb)),`a frame of the GIF: ${[...held]}`);
     if(notes)assert.ok(await frozen(o),"the notes paused with it");
     await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==="playing"&&OnchainMidiPlayer.getPlayStatus().audioState==="running");
     await o.page.waitForFunction(()=>{const src=document.getElementById("beast-art").src;const i=src.indexOf(",");const body=src.slice(i+1);return /;r=\d+/.test(src)&&!(/;base64,/.test(src.slice(0,i+1))?atob(body):decodeURIComponent(body)).includes("data:image/png;base64,");},{timeout:10000});
     assert.deepEqual(await art(o),{restarted:true,still:false,cut:notes});await moving("animating again after resume");
     assert.equal(await o.page.locator("img#beast-art").count(),1);assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);
     console.log(`PASS isolated GIF art ${notes?"with":"without"} notes: ${moves?"animating, ":"(no GIF animation inside SVG images in this engine) "}standing still on a still while paused, ${moves?"animating again":"restarted"} after resume`);
   }finally{await o.context.close();}}}
  // A pause noticed late still freezes the frame the audio stopped on: the AudioContext time since
  // the shown image started, recorded here when each image is swapped in. The suspend completes
  // 200 ms after the pause (nothing announces it) and animation frames are deferred 1.2 s, as on a
  // hidden page, so the page sees it about 1 s, 5 GIF frames, late: the page clock would pick the
  // other colour. Before the pause the latency estimate grows by 200 ms, one GIF frame, which moves
  // positionSeconds but not the image: a position-based frame would be the other colour too.
  // Visible, and hidden (the page pauses itself; the still is made once it is visible).
  {const gif=Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,204,0,0,0,0,204,33,255,11,...Buffer.from("NETSCAPE2.0"),3,1,0,0,0,
     33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]).toString("base64");
   const gifCard=card(true).replace("<rect x='95' y='100' width='60' height='60' fill='#c00'/>",`<image x='95' y='100' width='60' height='60' style='image-rendering:pixelated' href='data:image/gif;base64,${gif}'/>`);
   const isStill=()=>{const src=document.getElementById("beast-art").src,i=src.indexOf(",");return /;base64,/.test(src.slice(0,i+1))&&atob(src.slice(i+1)).includes("data:image/png;base64,");};
   for(const hidden of [false,true]){const o=await run.page();try{
     await o.context.addInitScript(hidden=>{
       window.__rafDelay=0;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=f=>raf(t=>setTimeout(()=>f(t),window.__rafDelay));
       Object.defineProperty(AudioContext.prototype,"outputLatency",{configurable:true,get:()=>window.__latency||0});
       const suspend=AudioContext.prototype.suspend;AudioContext.prototype.suspend=function(){return new Promise(r=>setTimeout(r,window.__rafDelay?200:0)).then(()=>suspend.call(this));};
       window.__swaps=[];new MutationObserver(()=>{const a=document.getElementById("beast-art");if(a&&a!==window.__art){window.__art=a;const i=a.src.indexOf(","),body=a.src.slice(i+1),still=/;base64,/.test(a.src.slice(0,i+1))&&atob(body).includes("data:image/png;base64,");
         window.__swaps.push({src:a.src.slice(0,40),still,pos:window.OnchainMidiPlayer?.getPlayStatus().audioTime??null});}}).observe(document,{subtree:true,childList:true});
       if(hidden)URL.createObjectURL=()=>{throw Error("no background element: a hidden page pauses");};
     },hidden);
     await o.page.setViewportSize({width:500,height:700});await o.page.goto(dataUrl(composed({...c,svg:gifCard},{fixture:true,dependent:true,notes:false})));await waitReady(o.page);
     await playAndPass(o);await o.page.waitForFunction(()=>window.__swaps.some(s=>/;r=\d+/.test(s.src)&&!s.still&&s.pos!==null),{timeout:10000});await o.page.waitForTimeout(450);
     await o.page.evaluate(()=>{window.__latency=.2;});await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().latencySeconds>=.19,{timeout:5000});
     await o.page.evaluate(()=>{window.__rafDelay=1200;});
     if(hidden)await o.page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));});
     else await o.page.click("#play");
     await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==="suspended");
     if(hidden){await o.page.waitForTimeout(1200);assert.equal(await o.page.evaluate(isStill),false,"no still while hidden");
       await o.page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));});}
     await o.page.waitForFunction(isStill,{timeout:10000});
     const at=await o.page.evaluate(()=>({swap:window.__swaps.filter(s=>/;r=\d+/.test(s.src)&&!s.still&&s.pos!==null).at(-1).pos,held:OnchainMidiPlayer.getPlayStatus().audioTime}));
     const ms=(at.held-at.swap)*1000%400,frame=Math.floor(ms/200),edge=Math.min(ms%200,200-ms%200)<25;
     const held=await (async()=>{const seen=new Set(),end=Date.now()+500;while(Date.now()<end){seen.add(decodePng(await o.page.screenshot({clip:{x:240,y:250,width:20,height:20}})).pixel(10,10).join());await o.page.waitForTimeout(30);}return seen;})();
     assert.equal(held.size,1,`standing still: ${[...held]}`);
     if(!edge)assert.ok(held.has(frame?"0,0,204":"204,0,0"),`the frame the audio stopped on (${Math.round(ms)} ms into the loop): ${[...held]}`);
     assert.deepEqual(o.requests,[]);if(!hidden)assert.deepEqual(await o.errors(),[]);
     console.log(`PASS isolated GIF art paused after a latency change while animation frames are deferred (${hidden?"hidden":"visible"} page): a still of the frame the audio stopped on`);
   }finally{await o.context.close();}}}
  // Reduced motion: the isolated GIF art stands still from the start, on a still, through play,
  // pause and resume, as the notes do.
  {const gif=Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,204,0,0,0,0,204,33,255,11,...Buffer.from("NETSCAPE2.0"),3,1,0,0,0,
     33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]).toString("base64");
   const gifCard=card(true).replace("<rect x='95' y='100' width='60' height='60' fill='#c00'/>",`<image x='95' y='100' width='60' height='60' style='image-rendering:pixelated' href='data:image/gif;base64,${gif}'/>`);
   const still=o=>o.page.evaluate(()=>{const src=document.getElementById("beast-art").src,i=src.indexOf(","),body=src.slice(i+1);return(/;base64,/.test(src.slice(0,i+1))?atob(body):decodeURIComponent(body)).includes("data:image/png;base64,");});
   const colours=async(o,ms)=>{const seen=new Set(),end=Date.now()+ms;while(Date.now()<end){seen.add(decodePng(await o.page.screenshot({clip:{x:240,y:250,width:20,height:20}})).pixel(10,10).join());await o.page.waitForTimeout(30);}return seen;};
   for(const notes of [false,true]){const o=await page(composed({...c,svg:gifCard},{fixture:true,dependent:true,notes}),{reducedMotion:true});try{
     await o.page.waitForFunction(()=>{const src=document.getElementById("beast-art").src,i=src.indexOf(",");return /;base64,/.test(src.slice(0,i+1))&&atob(src.slice(i+1)).includes("data:image/png;base64,");},{timeout:10000});
     const first=await colours(o,600);assert.deepEqual([...first],["204,0,0"],"the first frame, standing still");
     await playAndPass(o);assert.ok(await still(o),"still while playing");assert.deepEqual([...await colours(o,600)],["204,0,0"]);
     await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==="suspended");
     await o.page.click("#play");await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==="running");
     await o.page.waitForTimeout(300);assert.ok(await still(o),"still after resume");assert.deepEqual([...await colours(o,600)],["204,0,0"]);
     assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);
     console.log(`PASS isolated GIF art ${notes?"with":"without"} notes and prefers-reduced-motion: a still of its first frame through play, pause and resume`);
   }finally{await o.context.close();}}}
  // Reduced motion: the notes stand still while the music plays (notes.js).
  {const o=await page(notesPage(true,false),{reducedMotion:true});try{
    await playAndPass(o);assert.equal((await layout(o)).canvases,1);assert.ok(await frozen(o),"standing still");assert.deepEqual(await o.errors(),[]);console.log("PASS notes with prefers-reduced-motion: standing still while playing");
  }finally{await o.context.close();}}
  // No notes: the fragment absent, or the art without a marker. No canvas, the art as it is, ordinary playback.
  for(const [label,html,name] of [["fragment absent",notesPage(true,false,false),"notes-absent"],["marker missing",notesPage(false,false),"notes-unmarked"],
    ["notes script failing",notesPage(true,false).replace(ownedFragment("notes"),'<script>throw Error("notes fixture failure")</script>'),null],
    ["mount throwing",notesPage(true,false).replace(ownedFragment("notes"),'<script>window.OnchainMidiNotes={mount(){throw Error("mount failure")},cutout:s=>s.replace("<svg","<svg data-cut=\'\'")}</script>'),null]]){
    const o=await page(html);try{
      const at=await layout(o);assert.deepEqual([at.canvases,at.src,at.cut],[0,"data:image/svg+xml;base64,",false],label);
      if(name){const shot=await look(o,name);assert.equal(shot.notes,0,`${label}: the frame stays black`);}
      await playAndPass(o);assert.equal(await o.page.locator("canvas").count(),0);
      const errors=await o.errors();if(label==="notes script failing"){assert.equal(errors.length,1);assert.match(errors[0],/notes fixture failure/);}else assert.deepEqual(errors,[]);
      console.log(`PASS no notes (${label}): no canvas, the art unchanged, ordinary playback`);
    }finally{await o.context.close();}}
 }
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
