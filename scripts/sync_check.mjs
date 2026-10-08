#!/usr/bin/env node
// Three-browser acceptance for trusted SVG / transport synchronization on a null audio device.
// Observable timing is a browser estimate; physical route/display acceptance remains issue #52.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openBrowser, composed, dataUrl, waitReady } from './browser_harness.mjs';
import { fixtureCase } from './fixture_pages.mjs';
const seconds = Number(process.env.SYNC_SECONDS || 60);
assert.ok(seconds >= 5 && seconds <= 3600);
const run = await openBrowser(), o = await run.page();
try {
 const c = fixtureCase('beast_140bpm');
 const probe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="black"/><rect width="10" height="80" fill="white"><animate attributeName="x" from="0" to="390" dur="${c.midi_loop_seconds}s" repeatCount="indefinite"/></rect><svg x="0" y="100" width="400" height="80" viewBox="0 0 400 80"><rect width="10" height="80" fill="red"><animate attributeName="x" from="0" to="390" dur="${c.midi_loop_seconds}s" repeatCount="indefinite"/></rect></svg></svg>`;
 await o.context.addInitScript(() => {
   window.__seeks = [];
   const set = SVGSVGElement.prototype.setCurrentTime;
   SVGSVGElement.prototype.setCurrentTime = function(t) { window.__seeks.push({ at: performance.now(), value: t }); return set.call(this, t); };
 });
 await o.page.goto(dataUrl(composed({...c,svg:probe},{fixture:true,dependent:true,trustedArt:true})));
 await waitReady(o.page);
 const info = () => o.page.evaluate(() => {
   const root = document.getElementById('beast-art'), svgs = [root,...root.querySelectorAll('svg')];
   return {status:OnchainMidiPlayer.getPlayStatus(),timelines:svgs.map(s=>({time:s.getCurrentTime(),paused:s.animationsPaused()})),monitor:window.OnchainArtMonitor,seeks:window.__seeks.length,calls:window.__check.calls,passes:window.__check.passes,media:window.__check.media?.paused};
 });
 const cold = await info(); assert.equal(cold.calls.length,0); assert.ok(cold.timelines.every(s=>s.paused&&s.time===0));
 await o.page.click('#play');
 await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
 await o.page.waitForFunction(()=>document.getElementById('beast-art').animationsPaused()===false);
 const initial = await info(); assert.equal(initial.timelines.length,2);assert.ok(initial.timelines.every(s=>!s.paused));assert.ok(Math.abs(initial.monitor.initialAlignment)<.005);
 for(let i=0;i<3;i++) {
   await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==='suspended');
   const paused = await info();await o.page.waitForTimeout(350);const held=await info();
   assert.equal(held.status.state,'paused');assert.equal(held.status.audioTime,paused.status.audioTime);assert.deepEqual(held.timelines,paused.timelines);assert.ok(held.timelines.every(s=>s.paused));assert.equal(held.media,true);
   await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
   const resumed = await info();assert.equal(resumed.status.originTime,initial.status.originTime);assert.equal(resumed.status.runId,initial.status.runId);assert.ok(resumed.timelines.every(s=>!s.paused));
 }
 // External context suspension remains held despite an eligible explicit MIDI send and scheduler ticks.
 await o.page.evaluate(async()=>{await window.__check.synth.getAudioContext().suspend();window.__check.synth.send([0x90,60,1]);});
 await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='paused');const external=await info();await o.page.waitForTimeout(350);
 const externalHeld=await info();assert.equal(externalHeld.status.audioState,'suspended');assert.equal(externalHeld.status.audioTime,external.status.audioTime);assert.deepEqual(externalHeld.timelines,external.timelines);
 await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
 // All consumers see one latency estimate. 1ms noise is ignored, 30ms route change resynchronizes.
 await o.page.evaluate(()=>{const ctx=window.__check.synth.getAudioContext();window.__oldLatency=OnchainMidiPlayer.getPlayStatus().latencySeconds;Object.defineProperty(ctx,'outputLatency',{configurable:true,value:.2,writable:true});Object.defineProperty(ctx,'baseLatency',{configurable:true,value:.01,writable:true});});
 await o.page.waitForFunction(()=>Math.abs(OnchainMidiPlayer.getPlayStatus().latencySeconds-.21)<1e-8);
 const latency = await info(); const revision=latency.status.latencyRevision;
 await o.page.evaluate(()=>window.__check.synth.getAudioContext().outputLatency=.201);await o.page.waitForTimeout(300);assert.equal((await info()).status.latencyRevision,revision);
 await o.page.evaluate(()=>window.__check.synth.getAudioContext().outputLatency=.231);await o.page.waitForFunction(r=>OnchainMidiPlayer.getPlayStatus().latencyRevision>r,revision);
 const changed=await info();assert.ok(changed.monitor.latencyEvents.length>=2);assert.ok(Math.abs(changed.status.latencySeconds-.241)<1e-8);
 // Media handlers and the actual background element retain pause/resume semantics.
 await o.page.evaluate(()=>window.__check.handlers.pause?.());await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='paused');
 await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
 await o.page.waitForFunction(()=>window.__check.media?.paused===false);await o.page.evaluate(()=>window.__check.media.pause());await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='paused');
 await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
 // Long run: no continuous seek path. Native SVG timelines run between explicit pass events.
 const start=await info();await o.page.waitForTimeout(seconds*1000);const end=await info();
 assert.equal(end.status.state,'playing');assert.equal(end.calls.filter(s=>s==='loadMIDI').length,1);assert.equal(end.calls.filter(s=>s==='playMIDI').length,1);assert.equal(end.calls.filter(s=>s==='prewarm').length,initial.calls.filter(s=>s==='prewarm').length);
 const passCount=end.passes.length-start.passes.length;
 assert.ok(passCount>=Math.floor(seconds/c.midi_loop_seconds)-1);
 assert.equal(end.seeks-start.seeks,passCount*2,'only two SVG seeks per announced pass during steady latency');
 for(const event of end.passes) if(event.audibleTime!==null)assert.ok(Math.abs(event.audibleTime-event.startTime-event.latencySeconds)<1e-9);
 const result={engine:run.engine,seconds,initial_alignment_ms:initial.monitor.initialAlignment*1000,max_drift_ms:end.monitor.maxDrift*1000,current_drift_ms:end.monitor.currentDrift*1000,latency_events:end.monitor.latencyEvents,steady_passes:passCount,steady_svg_seeks:end.seeks-start.seeks,physical_audio_verified:false};
 assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);
 await o.page.evaluate(()=>OnchainMidiPlayer.stop());const stopped=await info();assert.equal(stopped.status.state,'stopped');assert.ok(stopped.timelines.every(s=>s.paused&&s.time===0));
 if(process.env.SYNC_RESULTS){mkdirSync(process.env.SYNC_RESULTS,{recursive:true});writeFileSync(`${process.env.SYNC_RESULTS}/sync-${run.engine}.json`,JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(JSON.stringify(await o.page.evaluate(()=>({state:OnchainMidiPlayer.getPlayStatus(),states:window.__check.states,calls:window.__check.calls,media:window.__check.media?.paused})),null,2));throw error;} finally { await o.context.close(); await run.browser.close(); }
