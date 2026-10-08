// @ts-nocheck
// Dynamic browser/engine mocks intentionally exercise values outside browser typings.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startPlayer } from "./player.js";
import { riff,smf } from "../scripts/data_cases.mjs";
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness({loading=false,missing=false,duplicate=false,namespaceURI="http://www.w3.org/1999/xhtml",tagName="SCRIPT",midi=riff({ppq:96,us:500000}),resume,constructError,playError,latency=0.02,nullStart=false}={}){
 const calls=[],timers=new Map(),intervals=new Map();let serial=0,domReady;
 const tags={"onchain-midi-settings":{tagName,namespaceURI,getAttribute:()=>"text/plain",textContent:"1,1,30,40,64,0,0"},"onchain-midi-data":{tagName,namespaceURI,getAttribute:()=>"text/plain",textContent:midi.toString("base64")}};
 const ctx={currentTime:1,outputLatency:latency,resume(){calls.push("resume");return resume?.promise||Promise.resolve();}};
 const status={curTick:0,maxTick:384,startTime:null};
 const synth={getAudioContext:()=>ctx,getPlayStatus:()=>({...status}),prewarm(){calls.push("prewarm");},loadMIDI(){calls.push("load");},setLoop(){calls.push("loop");},setLoopEnd(){calls.push("end");},playMIDI(){calls.push("play");if(playError)throw Error(playError);status.startTime=nullStart?null:ctx.currentTime+0.1;},stopMIDI(){calls.push("stop");status.startTime=null;}};
 for(const name of ["setQuality","setMasterVol","setReverbLev","setVoices","setTimbre"])synth[name]=()=>{};
 const host={document:{readyState:loading?"loading":"complete",querySelectorAll(selector){const id=/id="([^"]+)"/.exec(selector)[1];return missing?[]:duplicate?[tags[id],tags[id]]:[tags[id]];},addEventListener(_,fn){domReady=fn;}},
 WebAudioTinySynth:function(){calls.push("new");if(constructError)throw Error(constructError);return synth;},
 setTimeout(fn,delay){assert.ok(delay<=2147483647);timers.set(++serial,{fn,at:ctx.currentTime+delay/1000});return serial;},clearTimeout(id){timers.delete(id);},
 setInterval(fn){intervals.set(++serial,fn);return serial;},clearInterval(id){intervals.delete(id);}};
 const api=startPlayer(host);
 return{api,host,calls,ctx,status,timers,intervals,parse(){host.document.readyState="complete";domReady();},poll(){for(const fn of intervals.values())fn();},fire(time){ctx.currentTime=time;for(const [id,t]of [...timers]){if(t.at<=time){timers.delete(id);t.fn();}}}};
}
test("ready creates no synth, audio, controls or UI; snapshot and six-member API",async()=>{const h=harness();await h.api.ready;assert.deepEqual(h.calls,[]);assert.deepEqual(Object.keys(h.api),["ready","play","stop","getPlayStatus","onPassStart","onStateChange"]);const a=h.api.getPlayStatus(),b=h.api.getPlayStatus();assert.notEqual(a,b);assert.equal(a.state,"stopped");assert.equal(a.audioTime,null);assert.equal(a.startTime,null);assert.equal(a.passSeconds,2);assert.equal(a.error,null);});
test("play before readiness rejects and never queues",async()=>{const h=harness({loading:true});assert.equal(h.api.getPlayStatus().state,"loading");await assert.rejects(h.api.play(),/await.*ready/);assert.deepEqual(h.calls,[]);h.parse();await h.api.ready;assert.deepEqual(h.calls,[]);});
for(const options of [{missing:true},{duplicate:true},{midi:Buffer.from("bad")}])test(`invalid initialization ${JSON.stringify(options)}`,async()=>{const h=harness(options);await assert.rejects(h.api.ready);await assert.rejects(h.api.play());assert.equal(h.api.getPlayStatus().state,"failed");assert.deepEqual(h.calls,[]);});
test("missing engine rejects readiness",async()=>{const h=harness({loading:true});delete h.host.WebAudioTinySynth;h.parse();await assert.rejects(h.api.ready,/TinySynth did not load/);});
test("gesture calls prewarm/resume synchronously; repeated pending starts share one promise",async()=>{const resume=deferred(),h=harness({resume});const p=h.api.play();assert.deepEqual(h.calls,["new","prewarm","resume"]);assert.equal(h.api.getPlayStatus().state,"starting");assert.equal(h.api.play(),p);resume.resolve();await p;assert.equal(h.api.getPlayStatus().state,"playing");await h.api.play();assert.equal(h.calls.filter(c=>c==="resume").length,1);assert.deepEqual(h.calls.slice(-4),["load","loop","end","play"]);});
test("stop rejects pending start immediately with AbortError; late resume cannot play; restart tick zero",async()=>{const resume=deferred(),h=harness({resume});const p=h.api.play(),aborted=assert.rejects(p,{name:"AbortError"});h.api.stop();h.api.stop();await aborted;assert.equal(h.api.getPlayStatus().state,"stopped");resume.resolve();await flush();assert.ok(!h.calls.includes("play"));await h.api.play();assert.equal(h.calls.filter(c=>c==="load").length,1);assert.equal(h.calls.filter(c=>c==="new").length,1);});
for(const options of [{constructError:"construct"},{playError:"play"}])test(`terminal failure ${JSON.stringify(options)}`,async()=>{const h=harness(options);await assert.rejects(h.api.play());const calls=h.calls.slice();h.api.stop();await assert.rejects(h.api.play());assert.deepEqual(h.calls,calls);assert.equal(h.api.getPlayStatus().state,"failed");});
test("resume failure is terminal even for media-like subscribers",async()=>{const resume=deferred(),h=harness({resume});h.api.onStateChange(s=>{if(s.state==="failed")h.api.play().catch(()=>{});});const p=h.api.play();resume.reject(Error("audio permission"));await assert.rejects(p,/audio permission/);await assert.rejects(h.api.play());assert.equal(h.calls.filter(c=>c==="resume").length,1);});
test("state transitions have fresh snapshots; throwing callbacks and idempotent unsubscribe are isolated",async()=>{const h=harness(),seen=[];const off=h.api.onStateChange(s=>seen.push(s));h.api.onStateChange(()=>{throw Error("subscriber");});await h.api.play();h.api.stop();assert.deepEqual(seen.map(s=>s.state),["starting","playing","stopped"]);assert.ok(seen[2].runId>seen[0].runId);off();off();await h.api.play();assert.equal(seen.length,3);h.api.stop();});
test("initial pass waits for audible boundary, event AudioContext seconds, stale timers after stop never fire",async()=>{const h=harness(),events=[];h.api.onPassStart(()=>{throw Error("ignored");});const off=h.api.onPassStart(e=>events.push(e));await h.api.play();assert.equal(events.length,0);h.fire(1.119);assert.equal(events.length,0);h.fire(1.12);assert.equal(events.length,1);assert.deepEqual(events[0],{runId:1,passIndex:0,initial:true,startTime:1.1,audibleTime:1.12,audioTime:1.12,outputLatency:.02});h.status.startTime=3.1;h.poll();const stale=[...h.timers.values()][0];h.api.stop();stale.fn();assert.equal(events.length,1);off();off();assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);});
test("initial event delivered even when timer is very late; subsequent >50ms late skipped",async()=>{const h=harness(),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.4);assert.equal(events.length,1);h.status.startTime=3.1;h.poll();h.fire(3.3);assert.equal(events.length,1);h.status.startTime=5.1;h.poll();h.fire(5.12);assert.equal(events.at(-1).passIndex,2);h.api.stop();});
test("short loops advance index over skipped passes",async()=>{const h=harness({midi:riff({ppq:96,us:15000})}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.12);h.status.startTime=1.4;h.ctx.currentTime=1.35;h.poll();h.fire(1.36);h.fire(1.42);assert.ok(events.at(-1).passIndex>=4);h.api.stop();});
test("long loops are left until schedulable without overflowing setTimeout",async()=>{const midi=smf({ppq:1,tracks:[[[0,0xff,0x51,3,255,255,255],[0,0x90,60,100],[200000,0x80,60,0],[0,0xff,0x2f,0]]]}),h=harness({midi}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();h.fire(1.12);h.status.startTime=1.1+h.api.getPlayStatus().passSeconds;h.poll();assert.equal(h.timers.size,0);h.ctx.currentTime=h.status.startTime-.1;h.poll();assert.equal(h.timers.size,1);h.api.stop();});
test("tempo-only null start emits one immediate initial event and no fictitious repeats",async()=>{const midi=smf({ppq:96,tracks:[[[0,0xff,0x51,3,7,0xa1,0x20],[192,0xff,0x2f,0]]]}),h=harness({midi,nullStart:true}),events=[];h.api.onPassStart(e=>events.push(e));await h.api.play();assert.equal(events.length,1);assert.equal(events[0].startTime,null);assert.equal(events[0].audibleTime,null);assert.equal(h.intervals.size,0);h.api.stop();});
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

test("unique foreign-namespace or non-script data elements reject initialization",async()=>{
 for(const options of [{namespaceURI:"http://www.w3.org/2000/svg"},{tagName:"DIV"}]){
  const h=harness(options);await assert.rejects(h.api.ready,/expected one text\/plain/);assert.deepEqual(h.calls,[]);
 }
});
