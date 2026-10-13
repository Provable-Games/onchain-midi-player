// @ts-nocheck
import assert from "node:assert/strict";
import {describe,test} from "node:test";
import {playAnchor,silentWav,mountArtSync,REFERENCE_DISPLAY_LEAD_SECONDS} from "../ui.js";
import {startPlayer} from "../../../player/player.js";
import {riff} from "../../../scripts/data_cases.mjs";
describe("the play button's anchor on the art (playAnchor)", () => {
  const full = (/** @type {number} */ w, /** @type {number} */ h) => ({ left: 0, top: 0, width: w, height: h });
  const card = (/** @type {string} */ attrs) => `<svg xmlns='http://www.w3.org/2000/svg' ${attrs}><rect/></svg>`;
  const BEAST = "viewBox='0 0 250 350' data-play-anchor='235 202 32'";
  // The button's bottom-right corner is max(S / 8, 6) units, at the art's scale, inside the anchor (6 units for S = 32).
  test("a viewport the art fills exactly: the art's scale 1 makes 32 units 32 px, raised to the 44 px minimum", () => {
    assert.deepEqual(playAnchor(card(BEAST), full(250, 350), 250, 350), { left: 185, top: 152, size: 44 });
  });
  test("the diameter is S times the art's scale, between 44 and 128 px, and the offset follows it", () => {
    assert.deepEqual(playAnchor(card(BEAST), full(500, 700), 500, 700), { left: 394, top: 328, size: 64 }); // scale 2, inset 12
    assert.deepEqual(playAnchor(card(BEAST), full(750, 1050), 750, 1050), { left: 591, top: 492, size: 96 }); // scale 3, inset 18
    assert.deepEqual(playAnchor(card(BEAST), full(1000, 1400), 1000, 1400), { left: 788, top: 656, size: 128 }); // scale 4: exactly 128, inset 24
    assert.deepEqual(playAnchor(card(BEAST), full(1250, 1750), 1250, 1750), { left: 1017, top: 852, size: 128 }); // scale 5: 160 clamped to 128, inset 30
  });
  test("a landscape viewport letterboxes the art left and right (object-fit: contain)", () => {
    // 700 x 350: scale 1, the art is centred: offset (700 - 250) / 2 = 225.
    assert.deepEqual(playAnchor(card(BEAST), full(700, 350), 700, 350), { left: 410, top: 152, size: 44 });
  });
  test("a wide, short viewport shrinks the art, and the button stops at 44 px", () => {
    // 700 x 175: scale 0.5 (20 px of 40 units), the art is 125 wide, offset 287.5; the anchor is at (405, 101), the inset 3.
    assert.deepEqual(playAnchor(card(BEAST), full(700, 175), 700, 175), { left: 358, top: 54, size: 44 });
  });
  test("without S: 48 px, the corner 6 px inside", () => {
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 202'"), full(250, 350), 250, 350), { left: 235 - 6 - 48, top: 202 - 6 - 48, size: 48 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 202'"), full(500, 700), 500, 700), { left: 470 - 6 - 48, top: 404 - 6 - 48, size: 48 }, "not scaled");
  });
  test("no viewBox: width and height (with px), and a viewBox with an origin", () => {
    const want = { left: 185, top: 152, size: 44 };
    assert.deepEqual(playAnchor(card("width='250' height='350' data-play-anchor='235 202 32'"), full(250, 350), 250, 350), want);
    assert.deepEqual(playAnchor(card("width='250px' height='350px' data-play-anchor='235 202 32'"), full(250, 350), 250, 350), want);
    assert.deepEqual(playAnchor(card("viewBox='-10 -20 250 350' data-play-anchor='225 182 40'"), full(250, 350), 250, 350), want);
  });
  test("the button stays on screen: anchors at the art's corners, and a button larger than the viewport", () => {
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='0 0 10'"), full(100, 100), 100, 100), { left: 0, top: 0, size: 44 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='100 100 10'"), full(100, 100), 100, 100), { left: 50, top: 50, size: 44 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='100 100 1000'"), full(100, 100), 100, 100), { left: 0, top: 0, size: 128 });
  });
  for (const [label, attrs] of /** @type {Array<[string, string]>} */ ([
    ["no attribute", "viewBox='0 0 250 350'"],
    ["one number", "viewBox='0 0 250 350' data-play-anchor='235'"],
    ["four numbers", "viewBox='0 0 250 350' data-play-anchor='235 202 32 1'"],
    ["a zero diameter", "viewBox='0 0 250 350' data-play-anchor='235 202 0'"],
    ["a negative diameter", "viewBox='0 0 250 350' data-play-anchor='235 202 -40'"],
    ["a diameter that is not a number", "viewBox='0 0 250 350' data-play-anchor='235 202 big'"],
    ["text", "viewBox='0 0 250 350' data-play-anchor='right bottom'"],
    ["units", "viewBox='0 0 250 350' data-play-anchor='235px 202px'"],
    ["out of range (past the art)", "viewBox='0 0 250 350' data-play-anchor='235 400 40'"],
    ["out of range (negative)", "viewBox='0 0 250 350' data-play-anchor='-1 194'"],
    ["not a number (NaN)", "viewBox='0 0 250 350' data-play-anchor='NaN 194'"],
    ["no size at all", "data-play-anchor='235 202'"],
    ["a percentage size", "width='100%' height='100%' data-play-anchor='1 1'"],
    ["a malformed viewBox", "viewBox='0 0 250' data-play-anchor='235 202'"],
    ["an empty viewBox", "viewBox='0 0 0 0' data-play-anchor='0 0'"],
  ])) {
    test(`falls back to the corner: ${label}`, () => {
      assert.equal(playAnchor(card(attrs), full(250, 350), 250, 350), null);
    });
  }
  test("the art's own box, not the viewport: a 75% display, centred or offset, lands on the frame's corner", () => {
    // A 250 x 350 viewport with the img at 75%, centred: box (31.25, 43.75) 187.5 x 262.5, scale 0.75 (24 px: 44, inset 4.5).
    assert.deepEqual(playAnchor(card(BEAST), { left: 31.25, top: 43.75, width: 187.5, height: 262.5 }, 250, 350), { left: 159, top: 147, size: 44 });
    // The same art in a wider box inside a bigger viewport: contain inside the box, centred in it.
    assert.deepEqual(playAnchor(card(BEAST), { left: 100, top: 20, width: 500, height: 350 }, 800, 600), { left: 410, top: 172, size: 44 });
    // A box that is half off screen is clamped to the viewport.
    assert.deepEqual(playAnchor(card(BEAST), { left: 200, top: 0, width: 250, height: 350 }, 250, 350), { left: 206, top: 152, size: 44 });
  });
  test("only the root tag counts, and an attribute whose name ends the same does not", () => {
    assert.equal(playAnchor("<svg viewBox='0 0 250 350'><g data-play-anchor='235 202 32'/></svg>", full(250, 350), 250, 350), null);
    assert.equal(playAnchor("<svg viewBox='0 0 250 350' x-data-play-anchor='235 202 32'/>", full(250, 350), 250, 350), null);
    assert.equal(playAnchor("not svg", full(250, 350), 250, 350), null);
    assert.equal(playAnchor(card(BEAST), full(0, 0), 0, 0), null);
  });

});
test("NFT media session owns a six-second silent PCM carrier",()=>{
 const b=Buffer.from(silentWav());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(4),b.length-8);assert.equal(b.readUInt32LE(24),8000);assert.equal(b.readUInt32LE(40),48000);assert.ok(b.subarray(44).every(x=>x===128));
});
// @ts-nocheck
function artHarness(before = () => {}){
 let status={runId:0,state:'stopped',audioState:null,positionSeconds:null,originTime:null,startTime:null,audioTime:null,passSeconds:2,latencySeconds:.03,latencyRevision:0};
 const states=new Set(),passes=new Set(),frames=new Map(),seeks=[],calls=[],notes=[];let seq=0;
 const host={requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame(id){frames.delete(id);}};
 function svg(name){let time=0,paused=false;return{pauseAnimations(){paused=true;calls.push(name+':pause');},unpauseAnimations(){paused=false;calls.push(name+':run');},animationsPaused(){return paused;},setCurrentTime(t){seeks.push([name,t]);time=t;},getCurrentTime(){return time;},advance(t){time+=t;}};}
 const nested=svg('nested'),root=svg('outer');root.querySelectorAll=()=>[nested];
 const player={getPlayStatus:()=>({...status}),onStateChange(fn){states.add(fn);return()=>states.delete(fn);},onPassStart(fn){passes.add(fn);return()=>passes.delete(fn);}};
 const note={play(){notes.push('play');},pause(){notes.push('pause');},stop(){notes.push('stop');}};
 // Match the API: capture both snapshots and listeners, then drain nested notifications in order.
 const queue=[];let notifying=false;
 const set=next=>{Object.assign(status,next);queue.push({snapshot:{...status},listeners:[...states]});if(notifying)return;notifying=true;try{while(queue.length){const event=queue.shift();for(const fn of event.listeners)if(states.has(fn))fn({...event.snapshot});}}finally{notifying=false;}};
 before(player,set);
 const sync=mountArtSync(root,player,{host,notes:note});
 return{sync,status,seeks,calls,notes,root,nested,get frameCount(){return frames.size;},set,frame(){const fs=[...frames.values()];frames.clear();for(const fn of fs)fn();},pass(){for(const fn of passes)fn();}};
}
test('trusted outer AND nested SVG hold zero until estimated audible start, then resume at shared position',()=>{
 const h=artHarness();assert.ok(h.calls.includes('nested:pause'));
 h.set({state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1.02,positionSeconds:0});h.frame();assert.ok(!h.calls.includes('outer:run'));assert.ok(!h.notes.includes('play'));
 h.set({audioTime:1.04,positionSeconds:.01});h.frame();assert.ok(h.calls.includes('nested:run'));assert.ok(Math.abs(h.seeks.at(-1)[1]-.027)<1e-9);assert.ok(Math.abs(h.sync.clock()-.027)<1e-9);
 h.set({state:'paused',audioState:'suspended'});assert.equal(h.calls.at(-1),'nested:pause');assert.equal(h.notes.at(-1),'pause');
 h.set({state:'playing',audioState:'running',positionSeconds:.4});assert.equal(h.seeks.at(-1)[1],.41700000000000004);assert.equal(h.calls.at(-1),'nested:run');h.sync.dispose();
});
test('drift is read-only between start/resume/pass/latency synchronization points',()=>{
 const h=artHarness();h.set({state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1.1,positionSeconds:.07});h.frame();const count=h.seeks.length;
 for(let i=0;i<50;i++){h.status.positionSeconds+=.02;h.root.advance(.021);h.nested.advance(.021);h.frame();}
 assert.equal(h.seeks.length,count);assert.ok(h.sync.getMonitor().maxDrift>.049);assert.ok(Object.isFrozen(h.sync.getMonitor()));
 h.pass();assert.equal(h.seeks.length,count+2);
 h.set({latencyRevision:2,latencySeconds:.06,positionSeconds:.4});assert.equal(h.seeks.length,count+4);assert.equal(h.sync.getMonitor().latencyEvents.at(-1).latencySeconds,.06);
 h.set({state:'paused',audioState:'interrupted'});const last=h.seeks.length;h.frame();assert.equal(h.seeks.length,last);h.sync.dispose();
});

test('an earlier stopped subscriber replaying resets every new run until audible start',()=>{
 let replay=false;
 const h=artHarness((player,set)=>player.onStateChange(s=>{
   if(replay&&s.state==='stopped')set({runId:3,state:'starting',originTime:null});
 }));
 h.set({runId:1,state:'playing',audioState:'running',originTime:1,audioTime:1.1,positionSeconds:.07});h.frame();
 assert.equal(h.calls.at(-1),'nested:run');
 replay=true;h.set({runId:2,state:'stopped',originTime:null,positionSeconds:null});
 assert.equal(h.calls.at(-1),'nested:pause');assert.equal(h.seeks.at(-1)[1],0);
 h.set({state:'playing',originTime:1.2,audioTime:1.1,positionSeconds:0});h.frame();
 assert.equal(h.calls.at(-1),'nested:pause');assert.equal(h.seeks.at(-1)[1],0);
 h.set({audioTime:1.24,positionSeconds:.01});h.frame();assert.equal(h.calls.at(-1),'nested:run');
 h.set({state:'paused',audioState:'suspended'});h.set({state:'playing',audioState:'running',positionSeconds:.4});
 assert.equal(h.seeks.at(-1)[1],.41700000000000004,'same-run resume retains phase');h.sync.dispose();
});

for(const stage of ['starting','playing','paused'])test(`terminal audio failure during ${stage} releases trusted art and stops synchronization`,()=>{
 const h=artHarness();
 h.set({runId:1,state:stage==='starting'?'starting':'playing',audioState:stage==='starting'?'suspended':'running',originTime:stage==='starting'?null:1,audioTime:1.1,positionSeconds:stage==='starting'?null:.07});
 if(stage!=='starting')h.frame();
 if(stage==='paused')h.set({state:'paused',audioState:'suspended'});
 h.set({state:'failed',audioState:'closed'});
 assert.equal(h.root.animationsPaused(),false);assert.equal(h.nested.animationsPaused(),false);
 assert.equal(h.frameCount,0);assert.equal(h.notes.at(-1),'pause');
 const count=h.seeks.length;h.frame();h.pass();assert.equal(h.seeks.length,count,'failed audio no longer seeks art');
 h.sync.dispose();
});

// A pause announces 'paused' while the AudioContext is still running: suspend() completes later and
// sends no notification. The art runs on while the sound is audible, then freezes where it stopped.
const LEAD=REFERENCE_DISPLAY_LEAD_SECONDS;
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message??''} ${actual} != ${expected}`);
const startArt=h=>{h.set({runId:1,state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1.1,positionSeconds:.07});h.frame();assert.equal(h.root.animationsPaused(),false);};
const frozenAt=(h,position)=>{for(const svg of [h.root,h.nested]){assert.equal(svg.animationsPaused(),true);near(svg.getCurrentTime(),(position+LEAD)%2);}};
test('a pending suspend keeps running art running, then freezes first and seeks to the held position',()=>{
 const h=artHarness();startArt(h);
 const order=[];for(const svg of [h.root,h.nested]){const set=svg.setCurrentTime;svg.setCurrentTime=t=>{order.push(svg.animationsPaused());set(t);};}
 h.set({state:'paused',positionSeconds:1.9});const seeks=h.seeks.length;
 assert.equal(h.root.animationsPaused(),false);assert.equal(h.nested.animationsPaused(),false);assert.equal(h.notes.at(-1),'play');assert.equal(h.frameCount,1);
 h.status.positionSeconds=1.95;h.root.advance(.05);h.nested.advance(.05);h.frame();
 assert.equal(h.root.animationsPaused(),false);assert.equal(h.frameCount,1);assert.equal(h.seeks.length,seeks,'no seek while audible');
 Object.assign(h.status,{audioState:'suspended',positionSeconds:2.03});h.frame(); // Suspended without a notification.
 frozenAt(h,2.03);assert.deepEqual(order,[true,true],'frozen before the seek');assert.equal(h.notes.at(-1),'pause');assert.equal(h.frameCount,0);
 h.frame();h.pass();assert.equal(h.seeks.length,seeks+2,'one seek per timeline');
 h.set({state:'playing',audioState:'running'});assert.equal(h.seeks.length,seeks+4);near(h.root.getCurrentTime(),(2.03+LEAD)%2);near(h.nested.getCurrentTime(),(2.03+LEAD)%2);
 assert.equal(h.root.animationsPaused(),false);assert.equal(h.notes.at(-1),'play');h.sync.dispose();
});
test('a pause before the art has started holds it at exactly zero, without the display lead',()=>{
 for(const external of [false,true]){
  const h=artHarness();h.set({runId:1,state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1,positionSeconds:0});h.frame();
  if(external)h.set({state:'paused',audioState:'suspended'});
  else{h.set({state:'paused'});h.frame();Object.assign(h.status,{audioState:'suspended'});h.frame();}
  for(const svg of [h.root,h.nested]){assert.equal(svg.animationsPaused(),true);assert.equal(svg.getCurrentTime(),0);}
  assert.ok(h.seeks.every(([,t])=>t===0),'never seeks to the lead');assert.ok(!h.notes.includes('play'));assert.equal(h.frameCount,0);
  h.set({state:'playing',audioState:'running',audioTime:1.01});h.frame();assert.equal(h.root.animationsPaused(),true,'still waits for audible start');
  h.set({audioTime:1.04,positionSeconds:.01});h.frame();assert.equal(h.root.animationsPaused(),false);h.sync.dispose();
 }
});
test('the zero hold runs on through a pending suspend: tick zero becoming audible in it starts the art',()=>{
 const h=artHarness();h.set({runId:1,state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1,positionSeconds:0});h.frame();
 h.set({state:'paused'});Object.assign(h.status,{audioTime:1.04,positionSeconds:.01});h.frame();assert.equal(h.root.animationsPaused(),false,'audible');near(h.seeks.at(-1)[1],.027);
 Object.assign(h.status,{audioState:'suspended',positionSeconds:.05});h.frame();frozenAt(h,.05);h.sync.dispose();
});
test('a resume in progress (paused, audio running) keeps frozen art frozen until playing, then seeks',()=>{
 const h=artHarness();startArt(h);
 h.set({state:'paused'});Object.assign(h.status,{audioState:'suspended',positionSeconds:.5});h.frame();frozenAt(h,.5);const seeks=h.seeks.length;
 Object.assign(h.status,{audioState:'running'});h.frame();
 h.set({latencyRevision:1,latencySeconds:.05}); // The resume's latency refresh, still paused.
 frozenAt(h,.5);assert.equal(h.seeks.length,seeks);assert.equal(h.frameCount,0);assert.equal(h.notes.at(-1),'pause');h.frame();frozenAt(h,.5);
 h.set({state:'playing'});assert.equal(h.seeks.length,seeks+2);near(h.seeks.at(-1)[1],.517);assert.equal(h.root.animationsPaused(),false);assert.equal(h.notes.at(-1),'play');assert.equal(h.frameCount,1);
 h.set({latencyRevision:2,latencySeconds:.06});assert.equal(h.seeks.length,seeks+4,'one latency seek, no stale resynchronization');h.sync.dispose();
});
test('an external suspension freezes at the held position, from a notification or from the frame loop',()=>{
 const a=artHarness();startArt(a);a.set({state:'paused',audioState:'suspended',positionSeconds:.8});frozenAt(a,.8);assert.equal(a.frameCount,0);
 a.set({latencyRevision:1,latencySeconds:.06});frozenAt(a,.8);a.sync.dispose();
 const b=artHarness();startArt(b);Object.assign(b.status,{audioState:'interrupted',positionSeconds:.9});b.frame();frozenAt(b,.9); // Before the player's notification.
 b.set({state:'paused'});frozenAt(b,.9);assert.equal(b.notes.at(-1),'pause');b.sync.dispose();
});
test('pause, then resume before the frame loop sees the suspension: one seek, one frame loop',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',positionSeconds:.6});const seeks=h.seeks.length,notes=h.notes.length;
 h.root.advance(.3);h.nested.advance(.3); // The art ran on while the audio was held.
 h.set({state:'playing',positionSeconds:.65});assert.equal(h.seeks.length,seeks+2);near(h.root.getCurrentTime(),.667);near(h.nested.getCurrentTime(),.667);
 assert.equal(h.root.animationsPaused(),false);assert.equal(h.frameCount,1);assert.equal(h.notes.length,notes,'notes never paused');
 h.set({latencyRevision:1,latencySeconds:.05});assert.equal(h.seeks.length,seeks+4,'later latency changes seek as before');h.sync.dispose();
});
test('stop, replay and failure during a pending suspend keep their behaviour',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',positionSeconds:.6});
 h.set({runId:2,state:'stopped',audioState:'running',originTime:null,positionSeconds:null});
 for(const svg of [h.root,h.nested]){assert.equal(svg.animationsPaused(),true);assert.equal(svg.getCurrentTime(),0);}assert.equal(h.notes.at(-1),'stop');assert.equal(h.frameCount,0);
 h.set({runId:3,state:'playing',originTime:2,audioTime:2,positionSeconds:0});h.frame();assert.equal(h.root.animationsPaused(),true,'a new run holds zero');
 h.set({audioTime:2.04,positionSeconds:.01});h.frame();assert.equal(h.root.animationsPaused(),false);
 h.set({state:'paused'});assert.equal(h.root.animationsPaused(),false);
 h.set({state:'failed',audioState:'closed'});assert.equal(h.root.animationsPaused(),false);assert.equal(h.nested.animationsPaused(),false);assert.equal(h.frameCount,0);assert.equal(h.notes.at(-1),'pause');
 const count=h.seeks.length;h.frame();h.pass();assert.equal(h.seeks.length,count);h.sync.dispose();
});

// The real player with a mock AudioContext (player/headless.test.js). SVG timelines run on the
// document clock, the audio clock advances only while the context runs.
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function playerArt(){
 let wall=0,suspendGate=null,resumeGate=null,serial=0;const listeners=new Set(),frames=new Map();
 const ctx={currentTime:1,state:'suspended',outputLatency:.02,baseLatency:0,addEventListener(_,fn){listeners.add(fn);},change(state){this.state=state;for(const fn of listeners)fn();},
  resume(){return (resumeGate?.promise??Promise.resolve()).then(()=>this.change('running'));},suspend(){return (suspendGate?.promise??Promise.resolve()).then(()=>this.change('suspended'));}};
 const status={curTick:0,maxTick:384,startTime:null};
 const synth={getAudioContext:()=>ctx,resume:()=>ctx.resume(),getPlayStatus:()=>({...status}),prewarm(){},loadMIDI(){},setLoop(){},setLoopEnd(){},playMIDI(){status.startTime=ctx.currentTime+.1;},stopMIDI(){status.startTime=null;}};
 for(const name of ['setQuality','setMasterVol','setReverbLev','setVoices','setTimbre'])synth[name]=()=>{};
 const tag=textContent=>({tagName:'SCRIPT',namespaceURI:'http://www.w3.org/1999/xhtml',getAttribute:()=>'text/plain',textContent});
 const tags={'onchain-midi-settings':tag('1,1,30,40,64,0,0'),'onchain-midi-data':tag(riff({ppq:96,us:500000}).toString('base64'))};
 const host={document:{readyState:'complete',querySelectorAll:selector=>[tags[/id="([^"]+)"/.exec(selector)[1]]]},WebAudioTinySynth:function(){return synth;},
  setTimeout:()=>++serial,clearTimeout(){},setInterval:()=>++serial,clearInterval(){},
  requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);}};
 const api=startPlayer(host);
 const svg=()=>{let paused=false,base=0,at=0;return{pauseAnimations(){if(!paused)base+=wall-at;paused=true;},unpauseAnimations(){if(paused)at=wall;paused=false;},animationsPaused:()=>paused,setCurrentTime(t){base=t;at=wall;},getCurrentTime:()=>paused?base:base+wall-at};};
 const nested=svg(),root=Object.assign(svg(),{querySelectorAll:()=>[nested]});
 const sync=mountArtSync(root,api,{host});
 return{api,ctx,root,nested,sync,elapse(dt){wall+=dt;if(ctx.state==='running')ctx.currentTime+=dt;},
  frame(){const fs=[...frames.values()];frames.clear();for(const fn of fs)fn();},
  gate(kind){const d=deferred();if(kind==='suspend')suspendGate=d;else resumeGate=d;return d;}};
}
const atPlayer=(h,message)=>{const s=h.api.getPlayStatus();for(const svg of [h.root,h.nested])near(svg.getCurrentTime(),(s.positionSeconds+LEAD)%s.passSeconds,message);return s;};
test('real player: a pending suspend runs the art on, then freezes it where getPlayStatus() holds the audio',async()=>{
 const h=playerArt();await h.api.play();h.elapse(.2);h.frame();assert.equal(h.root.animationsPaused(),false);
 h.elapse(1.8);h.frame();atPlayer(h,'playing');
 const suspend=h.gate('suspend'),seen=[];h.api.onStateChange(s=>seen.push(s));
 const p=h.api.pause();assert.deepEqual(seen.map(s=>[s.state,s.audioState]),[['paused','running']]);
 h.elapse(.1);h.frame();assert.equal(h.root.animationsPaused(),false);atPlayer(h,'still audible');
 h.elapse(.05);suspend.resolve();await p;assert.equal(h.ctx.state,'suspended');assert.equal(seen.length,1,'no notification');
 h.elapse(.2);h.frame(); // The first frame after the suspend.
 const s=atPlayer(h,'held');near(s.positionSeconds,2.03);near(h.root.getCurrentTime(),.047);assert.equal(h.root.animationsPaused(),true);assert.equal(h.nested.animationsPaused(),true);
 near(h.sync.clock(),s.positionSeconds+LEAD);h.elapse(.5);h.frame();atPlayer(h,'stays held');
 await h.api.resume();assert.equal(h.api.getPlayStatus().state,'playing');atPlayer(h,'resumed');assert.equal(h.root.animationsPaused(),false);
 h.elapse(.1);h.frame();atPlayer(h,'runs with the audio');h.api.stop();
});
test('real player: pause, then resume before the suspend completes, realigns on playing',async()=>{
 const h=playerArt();await h.api.play();h.elapse(.2);h.frame();h.elapse(.3);h.frame();
 const suspend=h.gate('suspend'),resume=h.gate('resume');
 const p=h.api.pause();h.elapse(.15);const r=h.api.resume();
 suspend.resolve();await p;h.elapse(.2); // Held with no frame: only the document clock moves.
 resume.resolve();await r;assert.equal(h.api.getPlayStatus().state,'playing');
 const s=atPlayer(h,'resumed');near(s.positionSeconds,.53);assert.equal(h.root.animationsPaused(),false);
 h.elapse(.1);h.frame();atPlayer(h,'runs with the audio');h.api.stop();
 for(const svg of [h.root,h.nested]){assert.equal(svg.animationsPaused(),true);assert.equal(svg.getCurrentTime(),0);}
});
