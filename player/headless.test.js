// @ts-nocheck
// Dynamic browser/engine mocks intentionally exercise values outside browser typings.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startPlayer } from "./player.js";
import { riff,smf } from "../scripts/data_cases.mjs";
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness({loading=false,missing=false,duplicate=false,namespaceURI="http://www.w3.org/1999/xhtml",tagName="SCRIPT",midi=riff({ppq:96,us:500000}),resume,constructError,playError,latency=0.02,baseLatency=0,nullStart=false,suspend}={}){
 const calls=[],timers=new Map(),intervals=new Map();let serial=0,domReady;
 const tags={"onchain-midi-settings":{tagName,namespaceURI,getAttribute:()=>"text/plain",textContent:"1,1,30,40,64,0,0"},"onchain-midi-data":{tagName,namespaceURI,getAttribute:()=>"text/plain",textContent:midi.toString("base64")}};
 const listeners=new Set();
 const ctx={currentTime:1,state:"suspended",outputLatency:latency,baseLatency,
 addEventListener(_,fn){listeners.add(fn);},change(state){this.state=state;for(const fn of listeners)fn();},
 resume(){calls.push("resume");return (resume?.promise||Promise.resolve()).then(()=>{this.change("running");});},
 suspend(){calls.push("suspend");return (suspend?.promise||Promise.resolve()).then(()=>{this.change("suspended");});}};
 const status={curTick:0,maxTick:384,startTime:null};
 const synth={getAudioContext:()=>ctx,resume:()=>ctx.resume(),getPlayStatus:()=>({...status}),prewarm(){calls.push("prewarm");},loadMIDI(){calls.push("load");},setLoop(){calls.push("loop");},setLoopEnd(){calls.push("end");},playMIDI(){calls.push("play");if(playError)throw Error(playError);status.startTime=nullStart?null:ctx.currentTime+0.1;},stopMIDI(){calls.push("stop");status.startTime=null;}};
 for(const name of ["setQuality","setMasterVol","setReverbLev","setVoices","setTimbre"])synth[name]=()=>{};
 const host={document:{readyState:loading?"loading":"complete",querySelectorAll(selector){const id=/id="([^"]+)"/.exec(selector)[1];return missing?[]:duplicate?[tags[id],tags[id]]:[tags[id]];},addEventListener(_,fn){domReady=fn;}},
 WebAudioTinySynth:function(){calls.push("new");if(constructError)throw Error(constructError);return synth;},
 setTimeout(fn,delay){assert.ok(delay<=2147483647);timers.set(++serial,{fn,at:ctx.currentTime+delay/1000});return serial;},clearTimeout(id){timers.delete(id);},
 setInterval(fn){intervals.set(++serial,fn);return serial;},clearInterval(id){intervals.delete(id);}};
 const api=startPlayer(host);
 return{api,host,calls,ctx,status,timers,intervals,parse(){host.document.readyState="complete";domReady();},poll(){for(const fn of intervals.values())fn();},fire(time){ctx.currentTime=time;for(const [id,t]of [...timers]){if(t.at<=time){timers.delete(id);t.fn();}}}};
}
test("ready creates no synth, audio, controls or UI; snapshot and six-member API",async()=>{const h=harness();await h.api.ready;assert.deepEqual(h.calls,[]);assert.deepEqual(Object.keys(h.api),["ready","play","pause","resume","stop","getPlayStatus","onPassStart","onStateChange"]);const a=h.api.getPlayStatus(),b=h.api.getPlayStatus();assert.notEqual(a,b);assert.equal(a.state,"stopped");assert.equal(a.audioTime,null);assert.equal(a.startTime,null);assert.equal(a.passSeconds,2);assert.equal(a.error,null);});
test("play before readiness rejects and never queues",async()=>{const h=harness({loading:true});assert.equal(h.api.getPlayStatus().state,"loading");await assert.rejects(h.api.play(),/await.*ready/);assert.deepEqual(h.calls,[]);h.parse();await h.api.ready;assert.deepEqual(h.calls,[]);});
for(const options of [{missing:true},{duplicate:true},{midi:Buffer.from("bad")}])test(`invalid initialization ${JSON.stringify(options)}`,async()=>{const h=harness(options);await assert.rejects(h.api.ready);await assert.rejects(h.api.play());assert.equal(h.api.getPlayStatus().state,"failed");assert.deepEqual(h.calls,[]);});
test("missing engine rejects readiness",async()=>{const h=harness({loading:true});delete h.host.WebAudioTinySynth;h.parse();await assert.rejects(h.api.ready,/TinySynth did not load/);});
test("gesture calls prewarm/resume synchronously; repeated pending starts share one promise",async()=>{const resume=deferred(),h=harness({resume});const p=h.api.play();assert.deepEqual(h.calls,["new","prewarm","resume"]);assert.equal(h.api.getPlayStatus().state,"starting");assert.equal(h.api.play(),p);resume.resolve();await p;assert.equal(h.api.getPlayStatus().state,"playing");await h.api.play();assert.equal(h.calls.filter(c=>c==="resume").length,1);assert.deepEqual(h.calls.slice(-4),["load","loop","end","play"]);});
test("stop rejects pending start immediately with AbortError; late resume cannot play; restart tick zero",async()=>{const resume=deferred(),h=harness({resume});const p=h.api.play(),aborted=assert.rejects(p,{name:"AbortError"});h.api.stop();h.api.stop();await aborted;assert.equal(h.api.getPlayStatus().state,"stopped");resume.resolve();await flush();assert.ok(!h.calls.includes("play"));await h.api.play();assert.equal(h.calls.filter(c=>c==="load").length,1);assert.equal(h.calls.filter(c=>c==="new").length,1);});
for(const options of [{constructError:"construct"},{playError:"play"}])test(`terminal failure ${JSON.stringify(options)}`,async()=>{const h=harness(options);await assert.rejects(h.api.play());const calls=h.calls.slice();h.api.stop();await assert.rejects(h.api.play());assert.deepEqual(h.calls,calls);assert.equal(h.api.getPlayStatus().state,"failed");});
test("resume failure is terminal even for media-like subscribers",async()=>{const resume=deferred(),h=harness({resume});h.api.onStateChange(s=>{if(s.state==="failed")h.api.play().catch(()=>{});});const p=h.api.play();resume.reject(Error("audio permission"));await assert.rejects(p,/audio permission/);await assert.rejects(h.api.play());assert.equal(h.calls.filter(c=>c==="resume").length,1);});
test("state transitions have fresh snapshots; throwing callbacks and idempotent unsubscribe are isolated",async()=>{const h=harness(),seen=[];const off=h.api.onStateChange(s=>seen.push(s));h.api.onStateChange(()=>{throw Error("subscriber");});await h.api.play();h.api.stop();assert.deepEqual(seen.map(s=>s.state),["starting","playing","stopped"]);assert.ok(seen[2].runId>seen[0].runId);off();off();await h.api.play();assert.equal(seen.length,3);h.api.stop();});
test("initial pass waits for audible boundary, event AudioContext seconds, stale timers after stop never fire",async()=>{const h=harness(),events=[];h.api.onPassStart(()=>{throw Error("ignored");});const off=h.api.onPassStart(e=>events.push(e));await h.api.play();assert.equal(events.length,0);h.fire(1.119);assert.equal(events.length,0);h.fire(1.12);assert.equal(events.length,1);assert.deepEqual(events[0],{runId:1,passIndex:0,initial:true,startTime:1.1,audibleTime:1.12,audioTime:1.12,outputLatency:.02,baseLatency:0,latencySeconds:.02});h.status.startTime=3.1;h.poll();const stale=[...h.timers.values()][0];h.api.stop();stale.fn();assert.equal(events.length,1);off();off();assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);});
test("initial event delivered even when timer is very late; subsequent >50ms late skipped",async()=>{const h=harness(),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.4);assert.equal(events.length,1);h.status.startTime=3.1;h.poll();h.fire(3.3);assert.equal(events.length,1);h.status.startTime=5.1;h.poll();h.fire(5.12);assert.equal(events.at(-1).passIndex,2);h.api.stop();});
test("short loops advance index over skipped passes",async()=>{const h=harness({midi:riff({ppq:96,us:15000})}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.12);h.status.startTime=1.4;h.ctx.currentTime=1.35;h.poll();h.fire(1.36);h.fire(1.42);assert.ok(events.at(-1).passIndex>=4);h.api.stop();});
test("long loops are left until schedulable without overflowing setTimeout",async()=>{const midi=smf({ppq:1,tracks:[[[0,0xff,0x51,3,255,255,255],[0,0x90,60,100],[200000,0x80,60,0],[0,0xff,0x2f,0]]]}),h=harness({midi}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.12);h.status.startTime=1.1+h.api.getPlayStatus().passSeconds;h.poll();assert.equal(h.timers.size,0);h.ctx.currentTime=h.status.startTime-.1;h.poll();assert.equal(h.timers.size,1);h.api.stop();});
test("tempo-only null start emits one immediate initial event and no fictitious repeats",async()=>{const midi=smf({ppq:96,tracks:[[[0,0xff,0x51,3,7,0xa1,0x20],[192,0xff,0x2f,0]]]}),h=harness({midi,nullStart:true}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();assert.equal(events.length,1);assert.equal(events[0].startTime,null);assert.equal(events[0].audibleTime,null);assert.equal(h.intervals.size,1);h.api.stop();});
for(const latency of [undefined,-1,NaN,Infinity])test(`output latency fallback ${latency}`,async()=>{const h=harness({latency});h.ctx.outputLatency=latency;await h.api.play();assert.equal(h.api.getPlayStatus().outputLatency,0);h.api.stop();});
test("reentrant stop queues captured state transitions in observer order",async()=>{
 const h=harness(),seen=[],late=[];let remove=()=>{},removedCalls=0;
 h.api.onStateChange(s=>{if(s.state==="starting"){h.api.stop();remove();h.api.onStateChange(s=>late.push(s.state));}});
 h.api.onStateChange(s=>{seen.push(s);s.state="failed";});
 remove=h.api.onStateChange(()=>removedCalls++);
 await assert.rejects(h.api.play(),{name:"AbortError"});
 assert.deepEqual(seen.map(s=>s.runId),[1,2]);
 assert.deepEqual(late,[]);assert.equal(removedCalls,0);assert.equal(h.api.getPlayStatus().state,"stopped");assert.deepEqual(h.calls,[]);
});
test("reentrant state stop delivers starting then stopped once per observer",async()=>{
 const h=harness(),seen=[];
 h.api.onStateChange(s=>{if(s.state==="starting")h.api.stop();});
 h.api.onStateChange(s=>seen.push(s.state));
 await assert.rejects(h.api.play(),{name:"AbortError"});assert.deepEqual(seen,["starting","stopped"]);
});
test("pass stop suppresses remaining callbacks from the stopped run",async()=>{
 const h=harness(),seen=[];h.api.onPassStart(()=>h.api.stop());h.api.onPassStart(e=>seen.push(e));
 await h.api.play();h.fire(1.12);assert.deepEqual(seen,[]);assert.equal(h.api.getPlayStatus().state,"stopped");
});
test("pass subscriptions removed during delivery are skipped and snapshots are isolated",async()=>{
 const h=harness(),seen=[];let remove=()=>{},removedCalls=0;
 h.api.onPassStart(e=>{e.passIndex=99;remove();});remove=h.api.onPassStart(()=>removedCalls++);
 h.api.onPassStart(e=>seen.push(e.passIndex));await h.api.play();h.fire(1.12);assert.deepEqual(seen,[0]);assert.equal(removedCalls,0);h.api.stop();
});
test("repeated pause/resume holds one score and voices, origin and run",async()=>{
 const h=harness(),states=[];h.api.onStateChange(s=>states.push(s.state));await h.api.play();h.fire(1.5);
 const before=h.api.getPlayStatus();
 for(let i=0;i<4;i++){await h.api.pause();assert.equal(h.ctx.state,"suspended");assert.equal(h.api.getPlayStatus().state,"paused");assert.equal(h.api.getPlayStatus().positionSeconds,before.positionSeconds);await h.api.resume();assert.equal(h.api.getPlayStatus().state,"playing");}
 assert.equal(h.calls.filter(c=>c==="load").length,1);assert.equal(h.calls.filter(c=>c==="play").length,1);assert.equal(h.calls.filter(c=>c==="prewarm").length,1);assert.equal(h.api.getPlayStatus().runId,before.runId);assert.equal(h.api.getPlayStatus().originTime,before.originTime);assert.ok(states.includes("paused"));h.api.stop();
});
test("pause during starting cancels start; late completion does not load or play",async()=>{
 const resume=deferred(),h=harness({resume});const start=h.api.play(),rejected=assert.rejects(start,{name:"AbortError"});await h.api.pause();await rejected;resume.resolve();await flush();assert.ok(!h.calls.includes("load"));assert.equal(h.api.getPlayStatus().state,"stopped");assert.equal(h.ctx.state,"suspended");
});
test("pending boundary is preserved over pause and uses updated latency on resume",async()=>{
 const h=harness({baseLatency:.03}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.13);await h.api.pause();h.fire(1.15);assert.equal(events.length,0);await h.api.resume();h.fire(1.151);assert.equal(events.length,1);assert.equal(events[0].latencySeconds,.05);assert.ok(Math.abs(events[0].audibleTime-1.15)<1e-9);h.api.stop();
});
test("external suspension freezes timing until public resume",async()=>{
 const h=harness();await h.api.play();h.ctx.change("interrupted");assert.equal(h.api.getPlayStatus().state,"paused");const calls=h.calls.slice();h.poll();assert.deepEqual(h.calls,calls);await h.api.play();assert.equal(h.api.getPlayStatus().state,"playing");assert.equal(h.calls.filter(c=>c==="load").length,1);h.api.stop();
});
test("latency is shared, sane and updates only at 2ms threshold",async()=>{
 const h=harness({baseLatency:.01}),changes=[];h.api.onStateChange(s=>changes.push(s));await h.api.play();const first=h.api.getPlayStatus();assert.equal(first.latencySeconds,.03);
 h.ctx.outputLatency=.021;h.poll();assert.equal(h.api.getPlayStatus().latencyRevision,first.latencyRevision);
 h.ctx.outputLatency=.023;h.poll();assert.equal(h.api.getPlayStatus().latencySeconds,.033);assert.equal(changes.at(-1).state,"playing");
 h.ctx.outputLatency=Infinity;h.ctx.baseLatency=5;h.poll();assert.equal(h.api.getPlayStatus().latencySeconds,0);h.api.stop();
});
test("stop cancels a pending resume and reentrant paused callbacks observe ordered states",async()=>{
 const h=harness(),states=[];await h.api.play();h.api.onStateChange(s=>{if(s.state==="paused")h.api.stop();});h.api.onStateChange(s=>states.push(s.state));await h.api.pause();assert.deepEqual(states,["paused","stopped"]);assert.equal(h.api.getPlayStatus().state,"stopped");
 const resume=deferred(),k=harness();await k.api.play();await k.api.pause();k.ctx.resume=()=>resume.promise;const pending=k.api.resume(),rejected=assert.rejects(pending,{name:"AbortError"});k.api.stop();await rejected;resume.resolve();await flush();assert.equal(k.api.getPlayStatus().state,"stopped");
});
test("reentrant resume waits for in-flight pause; double resumes share promise",async()=>{
 const suspend=deferred(),h=harness({suspend});await h.api.play();let resumed;h.api.onStateChange(s=>{if(s.state==="paused")resumed=h.api.resume();});const p=h.api.pause();assert.equal(h.api.resume(),resumed);assert.equal(h.calls.filter(c=>c==="resume").length,1);suspend.resolve();await p;await resumed;assert.equal(h.api.getPlayStatus().state,"playing");h.api.stop();
});
test('playing subscriber stop leaves no timing intervals',async()=>{const h=harness();h.api.onStateChange(s=>{if(s.state==='playing')h.api.stop();});await h.api.play();assert.equal(h.api.getPlayStatus().state,'stopped');assert.equal(h.intervals.size,0);assert.equal(h.timers.size,0);});
test('resume latency subscriber stop wins and settles pending resume',async()=>{const h=harness();await h.api.play();await h.api.pause();const revision=h.api.getPlayStatus().latencyRevision;h.ctx.outputLatency=.05;h.api.onStateChange(s=>{if(s.latencyRevision>revision)h.api.stop();});await assert.rejects(h.api.resume(),{name:'AbortError'});assert.equal(h.api.getPlayStatus().state,'stopped');assert.equal(h.api.getPlayStatus().originTime,null);assert.equal(h.calls.at(-1),'stop');assert.equal(h.intervals.size,0);});
test('active null-origin score pauses and resumes without reloading',async()=>{const h=harness({nullStart:true});await h.api.play();await h.api.pause();assert.equal(h.api.getPlayStatus().state,'paused');await h.api.resume();assert.equal(h.api.getPlayStatus().state,'playing');assert.equal(h.calls.filter(c=>c==='load').length,1);h.api.stop();});
test('new play waits for stale suspension from a stopped run',async()=>{const suspend=deferred(),h=harness({suspend});await h.api.play();const pause=h.api.pause();h.api.stop();const play=h.api.play();assert.equal(h.calls.filter(c=>c==='resume').length,1);suspend.resolve();await pause;await play;assert.equal(h.api.getPlayStatus().state,'playing');assert.equal(h.ctx.state,'running');h.api.stop();});
test('pause during pending resume cancels it and late running state cannot revive playback',async()=>{
 const h=harness(),resume=deferred();await h.api.play();await h.api.pause();h.ctx.resume=()=>resume.promise.then(()=>h.ctx.change('running'));
 const r=h.api.resume(),aborted=assert.rejects(r,{name:'AbortError'});await h.api.pause();await aborted;resume.resolve();await flush();assert.equal(h.api.getPlayStatus().state,'paused');assert.equal(h.ctx.state,'suspended');assert.equal(h.calls.filter(c=>c==='load').length,1);
 h.ctx.change('running');assert.equal(h.api.getPlayStatus().state,'playing','genuine external resume after cancellation settled remains observable');h.api.stop();
});

test("unique foreign-namespace or non-script data elements reject initialization",async()=>{
 for(const options of [{namespaceURI:"http://www.w3.org/2000/svg"},{tagName:"DIV"}]){
  const h=harness(options);await assert.rejects(h.api.ready,/expected one text\/plain/);assert.deepEqual(h.calls,[]);
 }
});

test('new pause cancels resume queued behind a still-pending suspension',async()=>{
 const suspend=deferred(),h=harness({suspend});await h.api.play();const p=h.api.pause(),r=h.api.resume(),aborted=assert.rejects(r,{name:'AbortError'});assert.equal(h.api.pause(),p);await aborted;suspend.resolve();await p;await flush();assert.equal(h.api.getPlayStatus().state,'paused');assert.equal(h.ctx.state,'suspended');assert.equal(h.calls.filter(c=>c==='resume').length,1);h.api.stop();
});
