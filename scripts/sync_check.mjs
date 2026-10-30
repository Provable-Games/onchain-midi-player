#!/usr/bin/env node
// Three-browser acceptance for trusted SVG / transport synchronization on a null audio device.
// Observable timing is a browser estimate; physical route/display acceptance remains issue #52.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openBrowser, composed, dataUrl, waitReady } from './browser_harness.mjs';
import { fixtureCase } from './fixture_pages.mjs';
import { checkSchedule } from './schedule_observations.mjs';
import { verifyLibraries } from './verify_engine.mjs';
import { REFERENCE_DISPLAY_LEAD_SECONDS, beatSeconds, frameUs, gifFrames } from '../examples/beast_consumer/art_sync.js';
import { tokenParts } from '../examples/beast_consumer/scripts/reference.mjs';
import { decodePng } from './png.mjs';
// A suspended timeline is seeked to exactly this value. 5 ms covers each engine's SMIL time
// representation (Firefox keeps whole milliseconds) and stays well under one 60 Hz frame (16.7 ms).
const HELD_TOLERANCE_SECONDS = 0.005;
// Coarse per-engine ceiling (ms) on the monitor's whole-session maximum drift, transport phases
// included. With light reads while the art is measured, six ten-minute research runs
// (research/drift-spikes) peaked at 26.0 ms (Chromium), 35.0-41.8 ms (Firefox) and 4.7-6.7 ms
// (WebKit), with no frame over 40 ms.
const MAX_DRIFT_LIMIT_MS = Object.freeze({ chromium: 40, firefox: 50, webkit: 15 });
const seconds = Number(process.env.SYNC_SECONDS || 60), SESSION_SECONDS = seconds;
// The retimed GIF's drift (gifArtSession, assertGif): within every run of at least 20 changes, the
// fitted line moves under GIF_DRIFT_LIMIT_MS, and no change is over 60 ms from it (screenshot
// timing). This GIF's loop (4 frames, 91 cs) holds the grid exactly, so what the line measures is
// the browser's image clock (the page's) against the audio clock and the fit's noise. Local
// one-minute runs: Chromium 5.4, 9.0 and 13.4 ms, WebKit 0.2 and -0.1 ms; headless Chromium's
// audio clock was measured 0.04% slower than its page clock, up to 22 ms over this 55 s pass,
// which the GIF cannot follow (each pass restart realigns it). The limit is a coarse ceiling, as
// for the SVG drift above, well under one 227.5 ms frame.
const GIF_DRIFT_LIMIT_MS = 30;
// The session lasts as long as the SVG one, up to GIF_SECONDS: two of the score's passes, since each
// run is measured on its own, so a long Drift workflow session stays within its job's time.
const GIF_SECONDS = 120;
const sampleSeconds = Number(process.env.SYNC_SAMPLE_SECONDS || 10);
assert.ok(sampleSeconds > 0 && Number.isFinite(sampleSeconds));
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
 const html=composed({...c,svg:probe},{fixture:true,dependent:true,trustedArt:true}), verified=verifyLibraries(html);
 await o.page.goto(dataUrl(html));
 await waitReady(o.page);
 // Small values only: copying the growing sends/passes/calls arrays out of the page blocks its main
 // thread (about 220 ms by minute 10) and corrupts the monitor's next frame sample. Counts are taken
 // in the page; the full arrays are fetched once, after the final monitor read.
 // getPlayStatus() reads the audio clock twice (audioTime, and again for positionSeconds), and Chromium's clock can
 // advance a render quantum between two reads in one task: take a status across which the clock stood still.
 const info = () => o.page.evaluate(() => {
   const root = document.getElementById('beast-art'), svgs = [root,...root.querySelectorAll('svg')], check = window.__check;
   const ctx = check.synth?.getAudioContext();let status, clock;
   do { clock = ctx?.currentTime; status = OnchainMidiPlayer.getPlayStatus(); } while (ctx && ctx.currentTime !== clock);
   return {status,timelines:svgs.map(s=>({time:s.getCurrentTime(),paused:s.animationsPaused()})),monitor:window.OnchainArtMonitor,seeks:window.__seeks.length,callCount:check.calls.length,prewarmCount:check.calls.filter(s=>s==='prewarm').length,passCount:check.passes.length,sendCount:check.sends.length,media:check.media?.paused};
 });
 // Paused art shows the audio's held position, where the suspend actually stopped it, plus the display lead.
 const heldAt = (sample, label) => {
   const { positionSeconds: position, passSeconds: pass } = sample.status, expected = (position + REFERENCE_DISPLAY_LEAD_SECONDS) % pass;
   for (const s of sample.timelines) {
     let d = s.time - expected; d -= Math.round(d / pass) * pass;
     assert.ok(s.paused && Math.abs(d) < HELD_TOLERANCE_SECONDS, `${label}: SVG time ${s.time} is ${(d * 1000).toFixed(3)} ms from the held position ${position} + display lead`);
   }
 };
 // Not synced (before play and after stop): every timeline runs freely on the page clock.
 const runningFreely = async (label) => {
   const a = await info(); await o.page.waitForTimeout(200); const b = await info();
   b.timelines.forEach((s,i)=>assert.ok(!a.timelines[i].paused&&!s.paused&&s.time>a.timelines[i].time+.1,`${label}: timeline ${i} runs freely (${a.timelines[i].time} -> ${s.time})`));
   return b;
 };
 const suspends = [];
 const cold = await runningFreely('before play'); assert.equal(cold.callCount,0); assert.equal(cold.seeks,0);
 await o.page.click('#play');
 await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
 // The initial pass event, when the music becomes audible, seeks every timeline; the monitor measures right after it.
 await o.page.waitForFunction(()=>window.__check.passes.length>0&&window.OnchainArtMonitor.initialAlignment!==null);
 const initial = await info(); assert.equal(initial.timelines.length,2);assert.ok(initial.timelines.every(s=>!s.paused));assert.ok(initial.seeks>=2);assert.ok(Math.abs(initial.monitor.initialAlignment)<.05);
 for(let i=0;i<3;i++) {
   const before=await o.page.evaluate(()=>window.__check.states.length);
   await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().audioState==='suspended');
   // The art runs on while the suspend is pending; the first frame after it freezes every timeline.
   await o.page.waitForFunction(()=>{const root=document.getElementById('beast-art');return [root,...root.querySelectorAll('svg')].every(s=>s.animationsPaused());});
   const paused = await info();heldAt(paused,`pause ${i}`);
   // The pause request's own notification carries the audio clock at the request; the held status, where it stopped.
   const request=await o.page.evaluate(n=>window.__check.states.slice(n).find(s=>s.state==='paused'),before);
   assert.ok(request,'pause notification');suspends.push({audio_ms:(paused.status.audioTime-request.audioTime)*1000,request_audio_state:request.audioState});
   if(i===0){
     await o.page.evaluate(()=>{const ctx=window.__check.synth.getAudioContext();Object.defineProperty(ctx,'outputLatency',{configurable:true,value:.05,writable:true});Object.defineProperty(ctx,'baseLatency',{configurable:true,value:.01,writable:true});});
     await o.page.waitForFunction(revision=>OnchainMidiPlayer.getPlayStatus().latencyRevision>revision,paused.status.latencyRevision);
     const metadata=await o.page.evaluate(()=>window.__check.states.at(-1));
     assert.equal(metadata.positionSeconds,paused.status.positionSeconds);assert.ok(Math.abs(metadata.latencySeconds-.06)<1e-9);
   }
   await o.page.waitForTimeout(350);const held=await info();heldAt(held,`held ${i}`);
   assert.equal(held.status.state,'paused');assert.equal(held.status.audioTime,paused.status.audioTime);assert.equal(held.status.positionSeconds,paused.status.positionSeconds);assert.deepEqual(held.timelines,paused.timelines);assert.ok(held.timelines.every(s=>s.paused));assert.equal(held.media,true);assert.equal(held.sendCount,paused.sendCount,'scheduler stays held during pause');
   await o.page.click('#play');await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='playing');
   const resumed = await info();assert.equal(resumed.status.originTime,initial.status.originTime);assert.equal(resumed.status.runId,initial.status.runId);assert.ok(resumed.timelines.every(s=>!s.paused));assert.ok(Math.abs(resumed.status.positionSeconds-Math.max(0,resumed.status.audioTime-resumed.status.originTime-resumed.status.latencySeconds))<1e-9);
 }
 // External context suspension remains held despite an eligible explicit MIDI send and scheduler ticks.
 await o.page.evaluate(async()=>{await window.__check.synth.getAudioContext().suspend();window.__check.synth.send([0x90,60,1]);});
 await o.page.waitForFunction(()=>OnchainMidiPlayer.getPlayStatus().state==='paused');const external=await info();heldAt(external,'external suspension');
 await o.page.evaluate(()=>{window.__check.synth.getAudioContext().outputLatency+=.03;});
 await o.page.waitForFunction(revision=>OnchainMidiPlayer.getPlayStatus().latencyRevision>revision,external.status.latencyRevision);
 assert.equal(await o.page.evaluate(()=>window.__check.states.at(-1).positionSeconds),external.status.positionSeconds);
 await o.page.waitForTimeout(350);
 const externalHeld=await info();assert.equal(externalHeld.status.audioState,'suspended');assert.equal(externalHeld.status.audioTime,external.status.audioTime);assert.equal(externalHeld.status.positionSeconds,external.status.positionSeconds);assert.deepEqual(externalHeld.timelines,external.timelines);assert.equal(externalHeld.sendCount,external.sendCount);
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
 const start=await info(), checkpoints=[];
 for(let elapsed=0;elapsed<seconds;){const step=Math.min(sampleSeconds,seconds-elapsed);await o.page.waitForTimeout(step*1000);elapsed+=step;const sample=await info();checkpoints.push({elapsed_seconds:elapsed,audioTime:sample.status.audioTime,current_drift_ms:sample.monitor.currentDrift*1000,max_drift_ms:sample.monitor.maxDrift*1000});}
 const end=await info();
 // The final monitor read is done; one heavy read of the full observation arrays (an atomic snapshot).
 const log=await o.page.evaluate(()=>({calls:window.__check.calls,passes:window.__check.passes,sends:window.__check.sends}));
 assert.equal(end.status.state,'playing');assert.equal(log.calls.filter(s=>s==='loadMIDI').length,1);assert.equal(log.calls.filter(s=>s==='playMIDI').length,1);assert.equal(log.calls.filter(s=>s==='prewarm').length,initial.prewarmCount);
 const passCount=end.passCount-start.passCount;
 // A pass dispatched over 50 ms late (a stalled timer on a loaded runner) is not announced, so allow
 // the retired drift check's 90%: a few skips per session, not a systematic loss.
 const expectedPasses=Math.floor(seconds/c.midi_loop_seconds);
 assert.ok(passCount>=Math.ceil(0.9*expectedPasses),`announced ${passCount} of ${expectedPasses} passes (at least 90%)`);
 assert.equal(end.seeks-start.seeks,passCount*2,'only two SVG seeks per announced pass during steady latency');
 // The one-bar fixture has a unique channel-1 note 72 at tick zero. Match actual engine
 // sends, never a live getPlayStatus().startTime that lookahead may have advanced.
 const schedule=checkSchedule({sends:log.sends,passes:log.passes,origin:initial.status.originTime,period:c.midi_loop_seconds});
 const maxDriftMs=end.monitor.maxDrift*1000, driftLimitMs=MAX_DRIFT_LIMIT_MS[run.engine], withinDriftLimit=maxDriftMs<driftLimitMs;
 const result={engine:run.engine,version:verified.version,player_source_sha256:verified.libraries.player.sha256,engine_sha256:verified.engine.sha256,seconds,schedule,checkpoints,initial_alignment_ms:initial.monitor.initialAlignment*1000,max_drift_ms:maxDriftMs,max_drift_limit_ms:driftLimitMs,max_drift_within_limit:withinDriftLimit,current_drift_ms:end.monitor.currentDrift*1000,latency_events:end.monitor.latencyEvents,steady_passes:passCount,steady_svg_seeks:end.seeks-start.seeks,pause_to_suspend_audio:suspends,physical_audio_verified:false};
 assert.deepEqual(o.requests,[]);assert.deepEqual(await o.errors(),[]);
 // Stop releases the art: it keeps animating from where it was, without a rewind.
 await o.page.evaluate(()=>OnchainMidiPlayer.stop());const stopped=await runningFreely('after stop');assert.equal(stopped.status.state,'stopped');
 if(process.env.SYNC_RESULTS){mkdirSync(process.env.SYNC_RESULTS,{recursive:true});writeFileSync(`${process.env.SYNC_RESULTS}/sync-${run.engine}.json`,JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result,null,2));
 console.log(`${run.engine}: audio clock / SVG estimated max drift ${(result.max_drift_ms).toFixed(3)} ms (limit ${driftLimitMs} ms, ${withinDriftLimit?'within':'EXCEEDED'}); ${passCount} passes, ${end.seeks-start.seeks} boundary SVG seeks; ${result.latency_events.length} latency records; engine grid error ${schedule.max_grid_error_seconds} s, late ${schedule.late}; pause request to completed suspend ${suspends.map(s=>s.audio_ms.toFixed(3)).join(', ')} ms on the audio clock; checks ${withinDriftLimit?'passed':'failed'}`);
 const gif = await gifArtSession(run);
 if(process.env.SYNC_RESULTS)writeFileSync(`${process.env.SYNC_RESULTS}/sync-gif-${run.engine}.json`,JSON.stringify(gif,null,2)+'\n');
 console.log(JSON.stringify(gif,null,2));
 // Asserted last, after the results are written, so a failing run keeps its measurements.
 assertGif(gif);
 assert.ok(withinDriftLimit,`${run.engine}: audio clock / SVG max drift ${maxDriftMs.toFixed(3)} ms is not below the ${driftLimitMs} ms ${run.engine} limit`);
} catch(error) {console.error(JSON.stringify(await o.page.evaluate(()=>({state:OnchainMidiPlayer.getPlayStatus(),states:window.__check.states,calls:window.__check.calls,media:window.__check.media?.paused})),null,2));throw error;} finally { await o.context.close(); await run.browser.close(); }

// Tempo-timed isolated GIF art over the session's length: a 2-frame GIF (red, blue; 200 ms each)
// in an <img>, on the Warlock reference's music (131.87 BPM, a 55.51 s pass), retimed by the
// footer to 227.5 ms a frame. Screenshots of the sprite, each between two reads of the audible
// position, find every colour change; each is compared with the beat grid (art time: the
// position plus the display lead). Within each run of the GIF (from one restart to the next: a
// pass), the drift is the change of that distance from start to end (a least-squares line), and
// the spread is its distance from that line. Headless Firefox shows no GIF animation inside an
// SVG image: there the session is skipped. Screenshot timing limits each change to about +/- 25 ms.
async function gifArtSession(run) {
  const seconds = Math.min(SESSION_SECONDS, GIF_SECONDS); // as long as the SVG session, up to two passes
  if (run.engine === 'firefox') return { engine: run.engine, skipped: 'no GIF animation inside an SVG image in headless Firefox' };
  const gif = Buffer.from([71,73,70,56,57,97,1,0,1,0,128,0,0,204,0,0,0,0,204,33,255,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0,
    33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,33,249,4,4,20,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,76,1,0,59]).toString('base64');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 250 350'><rect width='250' height='350' fill='#1e1e22'/><image x='95' y='100' width='60' height='60' style='image-rendering:pixelated' href='data:image/gif;base64,${gif}'/></svg>`;
  const parts = tokenParts(4), o = await run.page();
  try {
    await o.page.setViewportSize({ width: 500, height: 700 });
    await o.context.addInitScript(() => { window.__restarts = []; new MutationObserver(() => { const a = document.getElementById('beast-art'); if (a && a !== window.__art) { window.__art = a; window.__restarts.push(window.OnchainMidiPlayer?.getPlayStatus().positionSeconds ?? null); } }).observe(document, { subtree: true, childList: true }); });
    await o.page.goto(dataUrl(composed({ ...parts, members: parts.mem, svg }, { fixture: true, dependent: true })));
    await waitReady(o.page);
    await o.page.click('#play');
    await o.page.waitForFunction(() => /;r=\d+;/.test(document.getElementById('beast-art').src), null, { timeout: 15000 });
    const s = await o.page.evaluate(() => OnchainMidiPlayer.getPlayStatus()), beat = beatSeconds(s, new Uint8Array(parts.midi)), step = frameUs(Math.round(beat * 1e6)) / 1e6;
    const src = await o.page.evaluate(() => document.getElementById('beast-art').src), shown = Buffer.from(/data:image\/gif;base64,([A-Za-z0-9+/]+=*)/.exec(Buffer.from(src.split(',')[1], 'base64').toString('latin1'))[1], 'base64');
    const delays = gifFrames(new Uint8Array(shown)).frames.map((f) => f.delay);
    const position = () => o.page.evaluate(() => OnchainMidiPlayer.getPlayStatus().positionSeconds), samples = [], end = Date.now() + seconds * 1000;
    while (Date.now() < end) { const p0 = await position(); const colour = decodePng(await o.page.screenshot({ clip: { x: 240, y: 250, width: 20, height: 20 } })).pixel(10, 10).join(); samples.push({ p0, p1: await position(), colour }); }
    const restarts = (await o.page.evaluate(() => window.__restarts)).filter((p) => p !== null);
    const changes = samples.slice(1).flatMap((x, i) => { const a = samples[i]; if (x.colour === a.colour) return []; const t = (a.p0 + a.p1 + x.p0 + x.p1) / 4, art = t + REFERENCE_DISPLAY_LEAD_SECONDS; return [{ t, off: (art - Math.round(art / step) * step) * 1000 }]; });
    // Runs of the GIF between restarts (the first starts at the first restart shown).
    const runs = [];
    for (let i = 0; i < restarts.length; i++) { const from = restarts[i], to = restarts[i + 1] ?? Infinity, list = changes.filter((c) => c.t > from + 0.1 && c.t < to); if (list.length >= 20) runs.push(list); }
    const fit = (list) => { const mt = list.reduce((a, c) => a + c.t, 0) / list.length, mo = list.reduce((a, c) => a + c.off, 0) / list.length, slope = list.reduce((a, c) => a + (c.t - mt) * (c.off - mo), 0) / list.reduce((a, c) => a + (c.t - mt) ** 2, 0);
      return { changes: list.length, seconds: +(list.at(-1).t - list[0].t).toFixed(3), mean_offset_ms: +mo.toFixed(2), drift_ms: +(slope * (list.at(-1).t - list[0].t)).toFixed(2), spread_ms: +Math.max(...list.map((c) => Math.abs(c.off - mo - slope * (c.t - mt)))).toFixed(2) }; };
    const result = { engine: run.engine, seconds, beat_seconds: beat, step_ms: step * 1000, retimed_delays_ms: delays, samples: samples.length, restarts: restarts.length, runs: runs.map(fit) };
    result.max_drift_ms = Math.max(...result.runs.map((r) => Math.abs(r.drift_ms)));
    assert.deepEqual(o.requests, []); assert.deepEqual(await o.errors(), []);
    return result;
  } finally { await o.context.close(); }
}
function assertGif(gif) {
  if (gif.skipped) return console.log(`${gif.engine}: tempo-timed GIF art skipped (${gif.skipped})`);
  assert.ok(gif.runs.length >= 1, 'a run of the GIF long enough to measure');
  for (const r of gif.runs) { assert.ok(Math.abs(r.drift_ms) < GIF_DRIFT_LIMIT_MS, `GIF drift ${r.drift_ms} ms over ${r.seconds} s`); assert.ok(r.spread_ms < 60, `GIF changes spread ${r.spread_ms} ms`); }
  console.log(`${gif.engine}: tempo-timed GIF art (${gif.step_ms} ms frames, delays ${gif.retimed_delays_ms.join('/')} ms): ${gif.runs.map((r) => `${r.changes} changes over ${r.seconds} s, drift ${r.drift_ms} ms, ${r.mean_offset_ms} ms from the grid, spread ${r.spread_ms} ms`).join('; ')}`);
}
