#!/usr/bin/env node
// Marketplace-style sandbox frames, strict CSP, offline and blocked-blob policy fallback.
import assert from "node:assert/strict";
import { openBrowser,composed,waitReady } from "./browser_harness.mjs";
const run=await openBrowser();
try{for(const media of ["blob:","'none'",null])for(const kind of ["srcdoc","data"]){const o=await run.page();try{
 const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"+(media?`; media-src ${media}`:"");
 const html=composed().replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+csp.replaceAll('"','&quot;')+'">');
 await o.page.goto('data:text/html,<html><body></body></html>');
 await o.page.evaluate(({html,kind})=>{const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.style.cssText='width:450px;height:450px';if(kind==='srcdoc')f.srcdoc=html;else f.src='data:text/html;base64,'+btoa(unescape(encodeURIComponent(html)));document.body.append(f);},{html,kind});
 await o.page.waitForFunction(()=>document.querySelector('iframe'));
 const frame=o.page.frames().find(f=>f!==o.page.mainFrame());await waitReady(frame);await frame.locator('#play').click();await frame.waitForFunction(()=>window.OnchainMidiPlayer.getPlayStatus().state==='playing');
 await new Promise(resolve=>setTimeout(resolve,120));
 const blocked=media!=="blob:";
 const info=await frame.evaluate(()=>({violations:window.__check.violations,paused:window.__check.media?.paused,handlers:Object.keys(window.__check.handlers)}));
 if(blocked)assert.ok(info.violations.every(v=>v.directive==='media-src'&&v.uri==='blob'));
 else{assert.deepEqual(info.violations,[]);assert.equal(info.paused,false);assert.deepEqual(info.handlers.sort(),['pause','play','stop']);}
 await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await frame.evaluate(()=>window.OnchainMidiPlayer.getPlayStatus().state),blocked?'stopped':'playing');
 await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});window.OnchainMidiPlayer.stop();});
 const errors=await o.errors();if(!blocked)assert.deepEqual(errors,[]);else assert.ok(errors.every(e=>/blob:|media|Content Security Policy|violat|NotSupportedError/i.test(e)),JSON.stringify(errors));
 assert.deepEqual(o.requests,[]);console.log(`PASS sandbox ${kind}, media-src ${media||'omitted'}: ordinary audio and background policy`);
 }finally{await o.context.close();}}}finally{await run.browser.close();}
