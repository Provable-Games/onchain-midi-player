#!/usr/bin/env node
// Marketplace-style sandbox frames, strict CSP, offline and blocked-blob policy fallback.
import assert from "node:assert/strict";
import { compositionHtml } from "./composition.mjs";
import { tokenParts } from "../examples/beast_consumer/scripts/reference.mjs";
import { openBrowser,composed,waitReady } from "./browser_harness.mjs";
import { fixtureCase } from "./fixture_pages.mjs";
// The notes page: isolated art whose marked frame the notes fragment draws behind (the cut-out copy is a data: image too).
const NOTES_ART="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 250 350'><rect width='250' height='350' fill='#1e1e22'/><rect data-notes-bg='' x='15' y='58' width='220' height='144' rx='8' fill='#000'/><rect x='95' y='100' width='60' height='60' fill='#c00'/></svg>";
const run=await openBrowser();
try{for(const art of ["isolated","trusted-font","notes"])for(const media of ["blob:","'none'",null])for(const kind of ["srcdoc","data"]){const o=await run.page();try{
 const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"+(media?`; media-src ${media}`:"");
 const source=art==='trusted-font'?compositionHtml(tokenParts(4),{trustedArt:true,fixture:true,dependent:true})
   :art==='notes'?composed({...fixtureCase("beast_140bpm"),svg:NOTES_ART},{fixture:true,dependent:true,notes:true}):composed();
 const html=source.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+csp.replaceAll('"','&quot;')+'">');
 await o.page.goto('data:text/html,<html><body></body></html>');
 await o.page.evaluate(({html,kind})=>{const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.style.cssText='width:450px;height:450px';if(kind==='srcdoc')f.srcdoc=html;else f.src='data:text/html;base64,'+btoa(unescape(encodeURIComponent(html)));document.body.append(f);},{html,kind});
 await o.page.waitForFunction(()=>document.querySelector('iframe'));
 const frame=o.page.frames().find(f=>f!==o.page.mainFrame());await waitReady(frame);
 if(art==='trusted-font'){
   const font=await frame.evaluate(async()=>{const faces=await document.fonts.load('16px VT323');return{loaded:faces.length>0&&faces.every(f=>f.status==='loaded'),violations:window.__check.violations.filter(v=>v.directive==='font-src')};});
   assert.equal(font.loaded,true,'trusted inline data font loads under the recommended CSP');assert.deepEqual(font.violations,[]);
 }
 // The notes under the host's CSP: the canvas behind the art, which shows the cut-out copy once decoded.
 if(art==='notes')await frame.waitForFunction(()=>document.querySelectorAll('canvas').length===1&&document.querySelector('canvas').nextElementSibling===document.getElementById('beast-art')&&document.getElementById('beast-art').src.startsWith('data:image/svg+xml,'));
 await frame.locator('#play').click();await frame.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==='playing');
 await new Promise(resolve=>setTimeout(resolve,120));
 const blocked=media!=="blob:";
 const info=await frame.evaluate(()=>({violations:window.__check.violations,paused:window.__check.media?.paused,handlers:Object.keys(window.__check.handlers)}));
 if(blocked)assert.ok(info.violations.every(v=>v.directive==='media-src'&&v.uri==='blob'));
 else{assert.deepEqual(info.violations,[]);assert.equal(info.paused,false);assert.deepEqual(info.handlers.sort(),['pause','play','stop']);}
 await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await frame.evaluate(()=>window.OnchainMidiPlayer.getPlayStatus().state),blocked?'paused':'playing');
 await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});window.OnchainMidiPlayer.stop();});
 const errors=await o.errors();if(!blocked)assert.deepEqual(errors,[]);else assert.ok(errors.every(e=>/blob:|media|Content Security Policy|violat|NotSupportedError/i.test(e)),JSON.stringify(errors));
 assert.deepEqual(o.requests,[]);console.log(`PASS sandbox ${kind}, ${art}, media-src ${media||'omitted'}: ordinary audio and background policy`);
 }finally{await o.context.close();}}}finally{await run.browser.close();}
