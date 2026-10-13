// @ts-nocheck
import assert from "node:assert/strict";
import {describe,test} from "node:test";
import {playAnchor,silentWav,monitorArtSync} from "../ui.js";
import {REFERENCE_DISPLAY_LEAD_SECONDS,syncSvgToMusic,restartImgOnPass} from "../art_sync.js";
import {startPlayer} from "../../../player/player.js";
import {mount as mountNotes} from "../../../player/notes.js";
import {riff,smf} from "../../../scripts/data_cases.mjs";
// Most cases use a 44 px floor; the shipped stylesheet's limits (--play-min 34px, --play-max 128px) have their own case.
const S44 = { min: 44, max: 128 };
describe("the play button's anchor on the art (playAnchor)", () => {
  const full = (/** @type {number} */ w, /** @type {number} */ h) => ({ left: 0, top: 0, width: w, height: h });
  const card = (/** @type {string} */ attrs) => `<svg xmlns='http://www.w3.org/2000/svg' ${attrs}><rect/></svg>`;
  const BEAST = "viewBox='0 0 250 350' data-play-anchor='235 202 32'";
  // The button's bottom-right corner is max(S / 8, 6) units, at the art's scale, inside the anchor (6 units for S = 32).
  test("a viewport the art fills exactly: the art's scale 1 makes 32 units 32 px, raised to the 44 px minimum", () => {
    assert.deepEqual(playAnchor(card(BEAST), full(250, 350), 250, 350, S44), { left: 185, top: 152, size: 44 });
  });
  test("the diameter is S times the art's scale, between 44 and 128 px, and the offset follows it", () => {
    assert.deepEqual(playAnchor(card(BEAST), full(500, 700), 500, 700, S44), { left: 394, top: 328, size: 64 }); // scale 2, inset 12
    assert.deepEqual(playAnchor(card(BEAST), full(750, 1050), 750, 1050, S44), { left: 591, top: 492, size: 96 }); // scale 3, inset 18
    assert.deepEqual(playAnchor(card(BEAST), full(1000, 1400), 1000, 1400, S44), { left: 788, top: 656, size: 128 }); // scale 4: exactly 128, inset 24
    assert.deepEqual(playAnchor(card(BEAST), full(1250, 1750), 1250, 1750, S44), { left: 1017, top: 852, size: 128 }); // scale 5: 160 clamped to 128, inset 30
  });
  test("the diameter's limits are the page's settings (the stylesheet's --play-min and --play-max)", () => {
    // scale 1: 32 units are 32 px; the inset stays max(S / 8, 6) units
    assert.deepEqual(playAnchor(card(BEAST), full(250, 350), 250, 350, { min: 34, max: 128 }), { left: 235 - 6 - 34, top: 202 - 6 - 34, size: 34 });
    assert.deepEqual(playAnchor(card(BEAST), full(250, 350), 250, 350, { min: 24, max: 28 }), { left: 235 - 6 - 28, top: 202 - 6 - 28, size: 28 });
  });
  test("a landscape viewport letterboxes the art left and right (object-fit: contain)", () => {
    // 700 x 350: scale 1, the art is centred: offset (700 - 250) / 2 = 225.
    assert.deepEqual(playAnchor(card(BEAST), full(700, 350), 700, 350, S44), { left: 410, top: 152, size: 44 });
  });
  test("a wide, short viewport shrinks the art, and the button stops at 44 px", () => {
    // 700 x 175: scale 0.5 (20 px of 40 units), the art is 125 wide, offset 287.5; the anchor is at (405, 101), the inset 3.
    assert.deepEqual(playAnchor(card(BEAST), full(700, 175), 700, 175, S44), { left: 358, top: 54, size: 44 });
  });
  test("without S: 48 px, the corner 6 px inside", () => {
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 202'"), full(250, 350), 250, 350, S44), { left: 235 - 6 - 48, top: 202 - 6 - 48, size: 48 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 202'"), full(500, 700), 500, 700, S44), { left: 470 - 6 - 48, top: 404 - 6 - 48, size: 48 }, "not scaled");
  });
  test("no viewBox: width and height (with px), and a viewBox with an origin", () => {
    const want = { left: 185, top: 152, size: 44 };
    assert.deepEqual(playAnchor(card("width='250' height='350' data-play-anchor='235 202 32'"), full(250, 350), 250, 350, S44), want);
    assert.deepEqual(playAnchor(card("width='250px' height='350px' data-play-anchor='235 202 32'"), full(250, 350), 250, 350, S44), want);
    assert.deepEqual(playAnchor(card("viewBox='-10 -20 250 350' data-play-anchor='225 182 40'"), full(250, 350), 250, 350, S44), want);
  });
  test("the button stays on screen: anchors at the art's corners, and a button larger than the viewport", () => {
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='0 0 10'"), full(100, 100), 100, 100, S44), { left: 0, top: 0, size: 44 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='100 100 10'"), full(100, 100), 100, 100, S44), { left: 50, top: 50, size: 44 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='100 100 1000'"), full(100, 100), 100, 100, S44), { left: 0, top: 0, size: 128 });
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
      assert.equal(playAnchor(card(attrs), full(250, 350), 250, 350, S44), null);
    });
  }
  test("the art's own box, not the viewport: a 75% display, centred or offset, lands on the frame's corner", () => {
    // A 250 x 350 viewport with the img at 75%, centred: box (31.25, 43.75) 187.5 x 262.5, scale 0.75 (24 px: 44, inset 4.5).
    assert.deepEqual(playAnchor(card(BEAST), { left: 31.25, top: 43.75, width: 187.5, height: 262.5 }, 250, 350, S44), { left: 159, top: 147, size: 44 });
    // The same art in a wider box inside a bigger viewport: contain inside the box, centred in it.
    assert.deepEqual(playAnchor(card(BEAST), { left: 100, top: 20, width: 500, height: 350 }, 800, 600, S44), { left: 410, top: 172, size: 44 });
    // A box that is half off screen is clamped to the viewport.
    assert.deepEqual(playAnchor(card(BEAST), { left: 200, top: 0, width: 250, height: 350 }, 250, 350, S44), { left: 206, top: 152, size: 44 });
  });
  test("top-right: the point is the button's top-right corner; it grows down and left from it", () => {
    // The Beasts frame's top-right corner (235, 58), S 20: inset 6 units, 44 px at scale 1.
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 58 20 top-right'"), full(250, 350), 250, 350, S44), { left: 235 - 6 - 44, top: 58 + 6, size: 44 });
    // Scale 4: 80 px, inset 24.
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 58 20 top-right'"), full(1000, 1400), 1000, 1400, S44), { left: 940 - 24 - 80, top: 232 + 24, size: 80 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235,58,top-right'"), full(250, 350), 250, 350, S44), { left: 235 - 6 - 48, top: 58 + 6, size: 48 });
    assert.equal(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 58 20 top-left'"), full(250, 350), 250, 350, S44), null, "no other keyword");
  });
  test("only the root tag counts, and an attribute whose name ends the same does not", () => {
    assert.equal(playAnchor("<svg viewBox='0 0 250 350'><g data-play-anchor='235 202 32'/></svg>", full(250, 350), 250, 350, S44), null);
    assert.equal(playAnchor("<svg viewBox='0 0 250 350' x-data-play-anchor='235 202 32'/>", full(250, 350), 250, 350, S44), null);
    assert.equal(playAnchor("not svg", full(250, 350), 250, 350, S44), null);
    assert.equal(playAnchor(card(BEAST), full(0, 0), 0, 0, S44), null);
  });

});
test("NFT media session owns a six-second silent PCM carrier",()=>{
 const b=Buffer.from(silentWav());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(4),b.length-8);assert.equal(b.readUInt32LE(24),8000);assert.equal(b.readUInt32LE(40),48000);assert.ok(b.subarray(44).every(x=>x===128));
});
// Art synced to the music (art_sync.js). The fake player below drives each moment of the method
// directly; the real-player harness further down runs the same rows through startPlayer().
const LEAD=REFERENCE_DISPLAY_LEAD_SECONDS;
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message??''} ${actual} != ${expected}`);
function artHarness(before = () => {}){
 let status={runId:0,state:'stopped',audioState:null,positionSeconds:null,originTime:null,startTime:null,audioTime:null,passSeconds:2,latencySeconds:.03,latencyRevision:0};
 const states=new Set(),passes=new Set(),frames=new Map(),seeks=[],calls=[],notes=[];let seq=0;const announced=new Set();
 const host={requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame(id){frames.delete(id);}};
 // A timeline runs on the page clock (elapse) unless paused.
 function svg(name){let time=0,paused=false;return{pauseAnimations(){paused=true;calls.push(name+':pause');},unpauseAnimations(){paused=false;calls.push(name+':run');},animationsPaused(){return paused;},setCurrentTime(t){seeks.push([name,t]);calls.push(name+':seek');time=t;},getCurrentTime(){return time;},advance(t){time+=t;},elapse(t){if(!paused)time+=t;}};}
 const nested=svg('nested'),root=svg('outer');root.querySelectorAll=()=>[nested];
 const player={getPlayStatus:()=>({...status}),onStateChange(fn){states.add(fn);return()=>states.delete(fn);},onPassStart(fn){passes.add(fn);return()=>passes.delete(fn);}};
 const note={play(){notes.push('play');},pause(){notes.push('pause');},stop(){notes.push('stop');}};
 // Match the API: capture both snapshots and listeners, then drain nested notifications in order.
 const queue=[];let notifying=false;
 const set=next=>{Object.assign(status,next);queue.push({snapshot:{...status},listeners:[...states]});if(notifying)return;notifying=true;try{while(queue.length){const event=queue.shift();for(const fn of event.listeners)if(states.has(fn))fn({...event.snapshot});}}finally{notifying=false;}};
 before(player,set);
 const sync=syncSvgToMusic(root,player,{host,notes:note});
 return{sync,player,host,status,seeks,calls,notes,root,nested,get frameCount(){return frames.size;},set,
  frame(){const fs=[...frames.values()];frames.clear();for(const fn of fs)fn();},
  elapse(t){root.elapse(t);nested.elapse(t);},
  // The player announces a pass only while playing and audible; the first of a run is the initial one.
  pass(event={}){const initial=!announced.has(status.runId);announced.add(status.runId);for(const fn of [...passes])fn({runId:status.runId,passIndex:initial?0:1,initial,startTime:status.startTime,audibleTime:null,...event});}};
}
const free=(h,message)=>{for(const svg of [h.root,h.nested])assert.equal(svg.animationsPaused(),false,message);};
const frozenAt=(h,position)=>{for(const svg of [h.root,h.nested]){assert.equal(svg.animationsPaused(),true);near(svg.getCurrentTime(),(position+LEAD)%2);}};
const playing={runId:1,state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1.1,positionSeconds:.07,latencyRevision:1};
// Synced: playing, then the initial pass event.
const startArt=(h,status=playing)=>{h.set(status);h.pass();free(h);};

test('before the music is audible the art animates freely: no pause, seek, frame loop or notes',()=>{
 const h=artHarness();free(h,'from page load');h.elapse(.5);near(h.root.getCurrentTime(),.5);
 h.set({runId:1,state:'starting',audioState:'suspended',latencyRevision:1});assert.equal(h.sync.clock(),null,'no audible position yet');
 h.set({state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1.01,positionSeconds:0});
 h.set({latencyRevision:2,latencySeconds:.05});h.frame();
 assert.deepEqual(h.seeks,[]);assert.ok(!h.calls.some(c=>c.endsWith(':pause')));assert.equal(h.frameCount,0);assert.deepEqual(h.notes,[]);
 h.elapse(.1);free(h);near(h.root.getCurrentTime(),.6);h.sync.dispose();
});
test('the initial pass event seeks every timeline to the music, then unpauses it and starts the notes',()=>{
 const h=artHarness();h.set({runId:1,state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1.02,positionSeconds:0,latencyRevision:1});h.elapse(.8);
 Object.assign(h.status,{audioTime:1.04,positionSeconds:.01});h.pass();
 assert.deepEqual(h.calls,['outer:seek','nested:seek','outer:run','nested:run'],'seek first, then unpause');
 for(const [,t] of h.seeks)near(t,.01+LEAD);near(h.sync.clock(),.01+LEAD);assert.deepEqual(h.notes,['play']);assert.equal(h.frameCount,0,'no frame loop while playing');
 h.sync.dispose();
});
test('each later pass seeks every timeline once; between passes the art runs on its own clock',()=>{
 const h=artHarness();startArt(h);const count=h.seeks.length;
 for(let i=0;i<50;i++){h.status.positionSeconds+=.02;h.elapse(.021);h.frame();}
 assert.equal(h.seeks.length,count,'no seeks between passes');assert.equal(h.frameCount,0);
 Object.assign(h.status,{positionSeconds:2.001});h.pass();assert.equal(h.seeks.length,count+2);
 for(const svg of [h.root,h.nested])near(svg.getCurrentTime(),(2.001+LEAD)%2);
 // Wrapped to one pass: the art loops with the music.
 Object.assign(h.status,{positionSeconds:4.5});h.pass();near(h.root.getCurrentTime(),.5+LEAD);h.sync.dispose();
});
test('a latency change seeks while synced, playing and running, and only then',()=>{
 const h=artHarness();h.set({...playing,audioTime:1.01,positionSeconds:0});h.set({latencyRevision:2,latencySeconds:.05});assert.deepEqual(h.seeks,[],'not before the music is audible');
 Object.assign(h.status,{audioTime:1.1,positionSeconds:.07});h.pass();const count=h.seeks.length;
 h.set({latencyRevision:3,latencySeconds:.06,positionSeconds:.4});assert.equal(h.seeks.length,count+2);near(h.root.getCurrentTime(),.4+LEAD);
 h.set({latencyRevision:3,positionSeconds:.45});assert.equal(h.seeks.length,count+2,'the same revision does not seek');
 h.set({state:'paused',audioState:'suspended',positionSeconds:.5});assert.equal(h.seeks.length,count+4,'the freeze');
 h.set({latencyRevision:4,latencySeconds:.07});assert.equal(h.seeks.length,count+4,'not while suspended');frozenAt(h,.5);
 h.set({state:'playing',audioState:'running'});assert.equal(h.seeks.length,count+6,'one seek on resume, with the new latency');h.sync.dispose();
});

// A pause announces 'paused' while the AudioContext is still running: suspend() completes later and
// sends no notification. The art runs on while the sound is audible, then freezes where it stopped.
test('a pending suspend keeps running art running, then freezes first and seeks to the held position',()=>{
 const h=artHarness();startArt(h);
 const order=[];for(const svg of [h.root,h.nested]){const set=svg.setCurrentTime;svg.setCurrentTime=t=>{order.push(svg.animationsPaused());set(t);};}
 h.set({state:'paused',positionSeconds:1.9});const seeks=h.seeks.length;
 free(h);assert.equal(h.notes.at(-1),'play');assert.equal(h.frameCount,1,'a frame loop only while the suspend is pending');
 h.set({state:'paused',latencyRevision:2,latencySeconds:.05});assert.equal(h.frameCount,1,'one frame loop');assert.equal(h.seeks.length,seeks+2,'running art realigns on a latency change, also while still audible');order.length=0;
 h.status.positionSeconds=1.95;h.elapse(.05);h.frame();
 free(h);assert.equal(h.frameCount,1);assert.equal(h.seeks.length,seeks+2,'no other seek while audible');
 Object.assign(h.status,{audioState:'suspended',positionSeconds:2.03});h.frame(); // Suspended without a notification.
 frozenAt(h,2.03);assert.deepEqual(order,[true,true],'frozen before the seek');assert.equal(h.notes.at(-1),'pause');assert.equal(h.frameCount,0);
 h.frame();assert.equal(h.seeks.length,seeks+4,'one seek per timeline');
 h.set({state:'playing',audioState:'running'});assert.equal(h.seeks.length,seeks+6);near(h.root.getCurrentTime(),(2.03+LEAD)%2);near(h.nested.getCurrentTime(),(2.03+LEAD)%2);
 free(h);assert.equal(h.notes.at(-1),'play');h.sync.dispose();
});
test('a resume in progress (paused, audio running) runs frozen art, aligned, as soon as the audio clock runs',()=>{
 const h=artHarness();startArt(h);
 h.set({state:'paused'});Object.assign(h.status,{audioState:'suspended',positionSeconds:.5});h.frame();frozenAt(h,.5);const seeks=h.seeks.length;
 // The engine resumed the AudioContext; the player says paused until its resume settles.
 Object.assign(h.status,{audioState:'running',positionSeconds:.51});h.set({latencyRevision:2,latencySeconds:.05}); // The resume's latency refresh.
 free(h);assert.equal(h.seeks.length,seeks+2,'aligned once');near(h.seeks.at(-1)[1],.51+LEAD);assert.equal(h.notes.at(-1),'play');assert.equal(h.frameCount,1,'watching for a suspend while paused');
 h.set({state:'playing',positionSeconds:.52});assert.equal(h.seeks.length,seeks+4,'playing realigns once');free(h);assert.equal(h.frameCount,0);
 h.set({latencyRevision:3,latencySeconds:.06});assert.equal(h.seeks.length,seeks+6,'one latency seek');h.sync.dispose();
});
test('an external suspension freezes at the held position; latency updates while suspended do not move it',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',audioState:'suspended',positionSeconds:.8});frozenAt(h,.8);assert.equal(h.frameCount,0);assert.equal(h.notes.at(-1),'pause');
 h.set({latencyRevision:2,latencySeconds:.06});frozenAt(h,.8);
 h.set({audioState:'interrupted'});frozenAt(h,.8);assert.equal(h.notes.filter(n=>n==='pause').length,1,'frozen once');h.sync.dispose();
});
test('resume seeks to the music, then unpauses',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',audioState:'suspended',positionSeconds:.8});h.calls.length=0;h.elapse(1);frozenAt(h,.8);
 h.set({state:'playing',audioState:'running',positionSeconds:.81});
 assert.deepEqual(h.calls,['outer:seek','nested:seek','outer:run','nested:run']);near(h.root.getCurrentTime(),.81+LEAD);assert.equal(h.notes.at(-1),'play');h.sync.dispose();
});
test('pause, then resume before the frame loop sees the suspension: one seek, the loop ends',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',positionSeconds:.6});const seeks=h.seeks.length,notes=h.notes.length;
 h.elapse(.3); // The art ran on while the audio was held.
 h.set({state:'playing',positionSeconds:.65});assert.equal(h.seeks.length,seeks+2);near(h.root.getCurrentTime(),.667);near(h.nested.getCurrentTime(),.667);
 free(h);assert.equal(h.frameCount,0);assert.equal(h.notes.length,notes,'notes never paused');
 h.set({latencyRevision:2,latencySeconds:.05});assert.equal(h.seeks.length,seeks+4,'later latency changes seek as before');h.sync.dispose();
});
test('pause and resume before the music is audible leave the art free; the initial pass after resume syncs it',()=>{
 for(const external of [false,true]){
  const h=artHarness();h.set({runId:1,state:'playing',audioState:'running',originTime:1,startTime:1,audioTime:1,positionSeconds:0,latencyRevision:1});
  if(external)h.set({state:'paused',audioState:'suspended'});
  else{h.set({state:'paused'});h.frame();Object.assign(h.status,{audioState:'suspended'});h.frame();}
  h.elapse(.4);free(h,'paused before audible');assert.deepEqual(h.seeks,[]);assert.deepEqual(h.notes,[]);assert.equal(h.frameCount,0);
  h.set({latencyRevision:2,latencySeconds:.05});h.set({state:'playing',audioState:'running',audioTime:1.01});assert.deepEqual(h.seeks,[]);free(h);
  Object.assign(h.status,{audioTime:1.07,positionSeconds:.01});h.pass();
  for(const [,t] of h.seeks)near(t,.01+LEAD);assert.equal(h.seeks.length,2);free(h);assert.deepEqual(h.notes,['play']);
  h.set({state:'paused',audioState:'suspended',positionSeconds:.2});frozenAt(h,.2);h.sync.dispose();
 }
});
test('stop, replay and failure release the art: it animates freely from where it is, until the next run is audible',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',positionSeconds:.6});
 const count=h.seeks.length;h.set({runId:2,state:'stopped',audioState:'running',originTime:null,positionSeconds:null});
 free(h,'stop');assert.equal(h.seeks.length,count,'never rewound');assert.equal(h.notes.at(-1),'stop');assert.equal(h.frameCount,0);
 const at=h.root.getCurrentTime();h.elapse(.25);near(h.root.getCurrentTime(),at+.25,'still animating');
 h.set({runId:3,state:'starting',audioState:'suspended'});h.set({state:'playing',audioState:'running',originTime:2,audioTime:2,positionSeconds:0,latencyRevision:3});
 h.set({state:'paused'});h.frame();h.set({state:'playing'});
 free(h,'a new run is free until audible');assert.equal(h.seeks.length,count);assert.equal(h.frameCount,0);
 Object.assign(h.status,{audioTime:2.04,positionSeconds:.01});h.pass();assert.equal(h.seeks.length,count+2);near(h.root.getCurrentTime(),.027);
 h.set({state:'paused'});free(h);assert.equal(h.frameCount,1);
 h.set({state:'failed',audioState:'closed'});free(h,'failure');assert.equal(h.frameCount,0);assert.equal(h.notes.at(-1),'pause');
 h.frame();h.set({latencyRevision:4});assert.equal(h.seeks.length,count+2,'failed audio no longer seeks art');h.sync.dispose();
});
test('a new run without a stop (an earlier subscriber replaying) also releases the art until its initial pass',()=>{
 let replay=false;
 const h=artHarness((player,set)=>player.onStateChange(s=>{
   if(replay&&s.state==='stopped')set({runId:3,state:'starting',originTime:null});
 }));
 startArt(h);
 replay=true;const count=h.seeks.length;h.set({runId:2,state:'stopped',originTime:null,positionSeconds:null});
 free(h);assert.equal(h.seeks.length,count,'no rewind');assert.equal(h.notes.at(-1),'stop');
 h.set({state:'playing',originTime:1.2,audioTime:1.1,positionSeconds:0});free(h);assert.equal(h.seeks.length,count);
 Object.assign(h.status,{audioTime:1.24,positionSeconds:.01});h.pass();near(h.seeks.at(-1)[1],.027);
 h.set({state:'paused',audioState:'suspended',positionSeconds:.38});h.set({state:'playing',audioState:'running',positionSeconds:.4});
 near(h.seeks.at(-1)[1],.417,'same-run resume retains phase');h.sync.dispose();
});
test('a snapshot only triggers an update: the art ends where getPlayStatus() says, whatever earlier subscribers did',()=>{
 // Earlier subscribers pause on a latency update, then resume at once (only a fake player can): the
 // helper is notified three times, each time of what getPlayStatus() says by then.
 let step=0;
 const h=artHarness((player,set)=>player.onStateChange(s=>{
   if(step===1&&s.state==='playing'){step=2;set({state:'paused',audioState:'suspended'});}
   else if(step===2&&s.state==='paused'){step=3;set({state:'playing',audioState:'running'});}
 }));
 startArt(h);
 step=1;h.set({latencyRevision:2,latencySeconds:.06,positionSeconds:.4});assert.equal(step,3);
 free(h);near(h.root.getCurrentTime(),.4+LEAD,'aligned to the fresh status');assert.equal(h.notes.at(-1),'play');assert.equal(h.frameCount,0);
 const seeks=h.seeks.length;h.set({positionSeconds:.45});assert.equal(h.seeks.length,seeks,'the latency change is applied once');h.sync.dispose();
});
for(const stage of ['starting','playing','paused'])test(`terminal audio failure during ${stage} releases trusted art and stops synchronization`,()=>{
 const h=artHarness();
 h.set({runId:1,state:stage==='starting'?'starting':'playing',audioState:stage==='starting'?'suspended':'running',originTime:stage==='starting'?null:1,audioTime:1.1,positionSeconds:stage==='starting'?null:.07});
 if(stage!=='starting')h.pass();
 if(stage==='paused')h.set({state:'paused',audioState:'suspended'});
 h.set({state:'failed',audioState:'closed'});
 free(h);assert.equal(h.frameCount,0);assert.deepEqual(h.notes,stage==='starting'?[]:['play',...(stage==='paused'?['pause']:[]),'pause']);
 const count=h.seeks.length;h.frame();h.set({latencyRevision:5});assert.equal(h.seeks.length,count,'failed audio no longer seeks art');
 h.sync.dispose();
});
test('a tempo-only score (no start time): its immediate initial event syncs the art at zero',()=>{
 const h=artHarness();h.set({runId:1,state:'playing',audioState:'running',originTime:null,startTime:null,audioTime:1,positionSeconds:null,latencyRevision:1});h.elapse(.3);
 h.pass({startTime:null,audibleTime:null});
 assert.deepEqual(h.seeks,[['outer',0],['nested',0]],'zero, without the lead');free(h);assert.equal(h.sync.clock(),null);assert.deepEqual(h.notes,['play']);
 h.set({state:'paused',audioState:'suspended'});for(const svg of [h.root,h.nested]){assert.equal(svg.animationsPaused(),true);assert.equal(svg.getCurrentTime(),0);}
 assert.ok(h.seeks.every(([,t])=>Number.isFinite(t)));h.sync.dispose();
});
test('dispose() stops following the music: the art runs freely, the frame loop and subscriptions end',()=>{
 const h=artHarness();startArt(h);h.set({state:'paused',positionSeconds:.3});assert.equal(h.frameCount,1);
 h.sync.dispose();free(h);assert.equal(h.frameCount,0);assert.equal(h.notes.at(-1),'stop');
 const count=h.seeks.length,notes=h.notes.length;h.set({state:'paused',audioState:'suspended'});h.set({state:'playing',audioState:'running',latencyRevision:7});h.pass();
 assert.equal(h.seeks.length,count);assert.equal(h.notes.length,notes);free(h);
 const idle=artHarness();idle.sync.dispose();free(idle);assert.deepEqual(idle.notes,[],'never synced: notes untouched');
});
test('the monitor only reads: drift each frame while synced and playing, the initial alignment, latency records',()=>{
 const h=artHarness(),monitor=monitorArtSync(h.root,h.player,{host:h.host});
 assert.deepEqual(monitor(),{currentDrift:0,maxDrift:0,initialAlignment:null,latencyEvents:[]});
 h.set({...playing});assert.equal(h.frameCount,0,'not before the initial pass');assert.equal(monitor().latencyEvents.length,1,'play start is a latency revision');
 h.pass();assert.equal(monitor().initialAlignment,0,'measured right after the initial seek');assert.equal(h.frameCount,1);const count=h.seeks.length;
 for(let i=0;i<50;i++){h.status.positionSeconds+=.02;h.elapse(.021);h.frame();}
 assert.equal(h.seeks.length,count,'never seeks');near(monitor().currentDrift,.05);assert.ok(monitor().maxDrift>.049);assert.ok(Object.isFrozen(monitor()));assert.ok(Object.isFrozen(monitor().latencyEvents[0]));
 h.pass();h.frame();assert.equal(monitor().initialAlignment,0);near(monitor().currentDrift,0,'a pass seek realigns');
 h.set({latencyRevision:2,latencySeconds:.06,positionSeconds:1.5});assert.deepEqual(monitor().latencyEvents.at(-1),{audioTime:1.1,latencySeconds:.06,revision:2});
 h.set({state:'paused',audioState:'suspended'});h.frame();assert.equal(h.frameCount,0,'no sampling while paused');
 h.set({state:'playing',audioState:'running'});assert.equal(h.frameCount,1,'sampling again on resume');h.sync.dispose();
});

// The real player with a mock AudioContext (player/headless.test.js). SVG timelines run on the
// document clock; the audio clock advances only while the context runs. Timers fire on time, and
// the engine announces each pass's start time 0.1 s ahead, so pass events come from the player.
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function playerArt({nullStart=false,before=()=>{},notes=null}={}){
 let wall=0,suspendGate=null,resumeGate=null,serial=0;const listeners=new Set(),frames=new Map(),timers=new Map(),intervals=new Map();
 const ctx={currentTime:1,state:'suspended',outputLatency:.02,baseLatency:0,addEventListener(_,fn){listeners.add(fn);},change(state){this.state=state;for(const fn of listeners)fn();},
  resume(){return (resumeGate?.promise??Promise.resolve()).then(()=>this.change('running'));},suspend(){return (suspendGate?.promise??Promise.resolve()).then(()=>this.change('suspended'));}};
 const status={curTick:0,maxTick:384,startTime:null};
 const synth={getAudioContext:()=>ctx,resume:()=>ctx.resume(),getPlayStatus:()=>({...status}),prewarm(){},loadMIDI(){},setLoop(){},setLoopEnd(){},playMIDI(){status.startTime=nullStart?null:ctx.currentTime+.1;},stopMIDI(){status.startTime=null;}};
 for(const name of ['setQuality','setMasterVol','setReverbLev','setVoices','setTimbre'])synth[name]=()=>{};
 const tag=textContent=>({tagName:'SCRIPT',namespaceURI:'http://www.w3.org/1999/xhtml',getAttribute:()=>'text/plain',textContent});
 const midi=nullStart?smf({ppq:96,tracks:[[[0,0xff,0x51,3,7,0xa1,0x20],[192,0xff,0x2f,0]]]}):riff({ppq:96,us:500000});
 const tags={'onchain-midi-settings':tag('1,1,30,40,64,0,0'),'onchain-midi-data':tag(midi.toString('base64'))};
 const host={document:{readyState:'complete',querySelectorAll:selector=>[tags[/id="([^"]+)"/.exec(selector)[1]]]},WebAudioTinySynth:function(){return synth;},
  setTimeout(fn,ms){timers.set(++serial,{fn,at:wall+ms/1000});return serial;},clearTimeout(id){timers.delete(id);},setInterval(fn){intervals.set(++serial,fn);return serial;},clearInterval(id){intervals.delete(id);},
  requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);}};
 const api=startPlayer(host),passes=[],log=[];api.onPassStart(e=>passes.push(e));
 let seeks=0;
 // Each timeline logs what the helper does to it: pause, run (unpause) and seek:<time>.
 const svg=()=>{let paused=false,base=0,at=0;return{pauseAnimations(){log.push('pause');if(!paused)base+=wall-at;paused=true;},unpauseAnimations(){log.push('run');if(paused)at=wall;paused=false;},animationsPaused:()=>paused,setCurrentTime(t){log.push('seek:'+t);seeks++;base=t;at=wall;},getCurrentTime:()=>paused?base:base+wall-at,shift(dt){base+=dt;}};};
 const nested=svg(),root=Object.assign(svg(),{querySelectorAll:()=>[nested]});
 before(api); // A subscriber registered before the helper: it is notified first.
 const sync=syncSvgToMusic(root,api,{host,notes});
 const engine=()=>{const origin=api.getPlayStatus().originTime;if(origin!==null&&status.startTime!==null)status.startTime=origin+Math.max(0,Math.floor((ctx.currentTime+.1-origin)/2))*2;};
 const due=()=>[...timers].find(([,t])=>t.at<=wall+1e-9);
 return{api,ctx,root,nested,sync,passes,log,get seeks(){return seeks;},
  elapse(dt){for(let left=dt;left>1e-12;){const step=Math.min(.01,left);left-=step;wall+=step;if(ctx.state==='running')ctx.currentTime+=step;engine();for(const fn of [...intervals.values()])fn();for(let t=due();t;t=due()){timers.delete(t[0]);t[1].fn();}}},
  frame(){const fs=[...frames.values()];frames.clear();for(const fn of fs)fn();},
  gate(kind){const d=deferred();if(kind==='suspend')suspendGate=d;else resumeGate=d;return d;}};
}
const atPlayer=(h,message)=>{const s=h.api.getPlayStatus();for(const svg of [h.root,h.nested])near(svg.getCurrentTime(),(s.positionSeconds+LEAD)%s.passSeconds,message);return s;};
const runsFree=(h,message)=>{const before=h.root.getCurrentTime();h.elapse(.05);for(const svg of [h.root,h.nested])assert.equal(svg.animationsPaused(),false,message);near(h.root.getCurrentTime(),before+.05,message);};
test('real player: the art runs freely before play and through a pause before audible, then syncs at the initial pass',async()=>{
 const h=playerArt();h.elapse(.5);runsFree(h,'from page load');near(h.root.getCurrentTime(),.55);
 await h.api.play();h.elapse(.05);runsFree(h,'starting, not yet audible');assert.equal(h.seeks,0);
 await h.api.pause();assert.equal(h.ctx.state,'suspended');h.elapse(.3);h.frame();runsFree(h,'paused before audible');
 await h.api.resume();h.elapse(.01);assert.equal(h.passes.length,0);assert.equal(h.seeks,0);
 h.elapse(.02);assert.equal(h.passes.length,1,'the initial pass is still delivered after resume');assert.equal(h.passes[0].initial,true);
 assert.equal(h.seeks,2);atPlayer(h,'synced');assert.equal(h.root.animationsPaused(),false);
 h.elapse(.5);atPlayer(h,'runs with the audio');h.api.stop();
});
test('real player: each audible pass seeks the art back to the music; stop releases it where it is',async()=>{
 const h=playerArt();await h.api.play();h.elapse(.2);atPlayer(h,'initial pass');
 h.root.shift(.03);h.nested.shift(-.02); // Page clock drift between passes.
 h.elapse(1.8);assert.equal(h.passes.length,1);assert.equal(h.seeks,2);
 h.elapse(.2);assert.equal(h.passes.length,2);assert.equal(h.passes[1].passIndex,1);assert.equal(h.seeks,4,'two seeks per pass');atPlayer(h,'realigned at the pass');
 const before=h.root.getCurrentTime();h.api.stop();assert.equal(h.root.getCurrentTime(),before,'no rewind');runsFree(h,'stopped');
 await h.api.play();h.elapse(.05);runsFree(h,'a new run, not yet audible');assert.equal(h.seeks,4);h.elapse(.1);assert.equal(h.seeks,6);atPlayer(h,'new run synced');h.api.stop();
});
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
 h.elapse(.1);h.frame();atPlayer(h,'runs with the audio');
 const before=h.root.getCurrentTime();h.api.stop();assert.equal(h.root.getCurrentTime(),before,'no rewind');runsFree(h,'stopped');
});
test('real player: a tempo-only score (null start time) syncs the art at zero on its immediate initial event',async()=>{
 const h=playerArt({nullStart:true});h.elapse(.4);
 await h.api.play();assert.equal(h.passes.length,1);assert.equal(h.passes[0].startTime,null);assert.equal(h.passes[0].audibleTime,null);
 assert.equal(h.seeks,2);assert.equal(h.root.getCurrentTime(),0);assert.equal(h.sync.clock(),null);runsFree(h,'synced at zero');
 await h.api.pause();h.frame();assert.equal(h.root.animationsPaused(),true);assert.ok(Number.isFinite(h.root.getCurrentTime()));
 await h.api.resume();runsFree(h,'resumed');h.api.stop();runsFree(h,'stopped');
});

// State notifications are captured snapshots, delivered in order. A subscriber notified before the
// helper may move the player on (stop, pause, play) while the older snapshot is still on its way.
test('real player: an earlier subscriber stopping on a latency notification does not rewind the art',async()=>{
 let armed=false;
 const h=playerArt({before:api=>api.onStateChange(s=>{if(armed&&s.state==='playing'){armed=false;api.stop();}})});
 await h.api.play();h.elapse(.2);atPlayer(h,'synced');h.elapse(1.5);
 const before=h.root.getCurrentTime(),seen=h.log.length;
 armed=true;h.ctx.outputLatency=.05;h.elapse(.01); // The latency poll's "playing" notification.
 assert.equal(h.api.getPlayStatus().state,'stopped');
 assert.deepEqual(h.log.slice(seen),['run','run'],'released: no seek, so no rewind to 0');
 near(h.root.getCurrentTime(),before+.01,'no rewind');runsFree(h,'released after stop');
});
test('real player: an earlier subscriber replaying (stop, then play) releases the art until the new run is audible',async()=>{
 let armed=false,replay=null;
 const h=playerArt({before:api=>api.onStateChange(s=>{if(armed&&s.state==='playing'){armed=false;api.stop();replay=api.play();}})});
 await h.api.play();h.elapse(.2);h.elapse(1.5);
 const before=h.root.getCurrentTime(),seen=h.log.length;
 armed=true;h.ctx.outputLatency=.05;h.elapse(.01);
 assert.equal(h.api.getPlayStatus().state,'starting');assert.deepEqual(h.log.slice(seen),['run','run'],'released by the new run, not rewound');
 near(h.root.getCurrentTime(),before+.01,'no rewind');
 await replay;assert.equal(h.api.getPlayStatus().state,'playing');h.elapse(.05);runsFree(h,'the new run is not yet audible');assert.deepEqual(h.log.slice(seen),['run','run']);
 h.elapse(.1);assert.equal(h.passes.at(-1).initial,true);atPlayer(h,'synced at the new run\'s initial pass');h.api.stop();
});
test('real player: an earlier subscriber pausing again on resume: the art ends frozen where the audio stopped',async()=>{
 let armed=false,pausing=null;
 const h=playerArt({before:api=>api.onStateChange(s=>{if(armed&&s.state==='playing'){armed=false;pausing=api.pause();}})});
 await h.api.play();h.elapse(.2);h.elapse(.5);
 await h.api.pause();h.frame();assert.equal(h.root.animationsPaused(),true);const held=h.root.getCurrentTime();
 armed=true;await h.api.resume();await pausing;assert.equal(h.api.getPlayStatus().state,'paused');
 h.elapse(.2);h.frame();
 for(const svg of [h.root,h.nested])assert.equal(svg.animationsPaused(),true);atPlayer(h,'frozen where the audio stopped');near(h.root.getCurrentTime(),held,'no audio ran in between');
 await h.api.resume();atPlayer(h,'a later resume seeks to the music');assert.equal(h.root.animationsPaused(),false);h.api.stop();
});

// Isolated art: an <img> restarted at each pass. A fake document is enough: the helper only creates,
// loads and replaces images.
const svgUrl=(bytes,type='image/svg+xml')=>`data:${type};base64,`+Buffer.from(bytes).toString('base64');
const UTF8_ART=svgUrl("<svg xmlns='http://www.w3.org/2000/svg'><title>é</title></svg>");
function imgHarness(src=UTF8_ART){
 const status={runId:1,state:'playing'},passes=new Set(),page=[],created=[],swaps=[];
 const player={getPlayStatus:()=>({...status}),onPassStart(fn){passes.add(fn);return()=>passes.delete(fn);},onStateChange(){return()=>{};}};
 const doc={createElement(tag){assert.equal(tag,'img');const el=image();created.push(el);return el;}};
 function image(attributes=[]){return{attributes,ownerDocument:doc,onload:null,src:'',setAttribute(name,value){this.attributes=[...this.attributes.filter(a=>a.name!==name),{name,value}];},
  replaceWith(other){const i=page.indexOf(this);if(i>=0)page[i]=other;},load(){this.onload?.();}};}
 const first=Object.assign(image([{name:'id',value:'beast-art'},{name:'alt',value:''},{name:'src',value:src}]),{src});page.push(first);
 let art=first;
 // As startUi: the button's placement follows each new image.
 const dispose=restartImgOnPass(first,player,{onSwap:img=>{assert.equal(page[0],img,'shown before onSwap');art=img;swaps.push(img);}});
 return{status,page,created,swaps,first,dispose,get art(){return art;},get subscribers(){return passes.size;},pass(){for(const fn of [...passes])fn({runId:status.runId});}};
}
const restartUrl=(n,src=UTF8_ART)=>src.replace(';base64,',`;r=${n};base64,`);
test('<img> art: each pass decodes a fresh copy with a distinct data URL and swaps it in once loaded',()=>{
 const h=imgHarness();
 h.pass();assert.equal(h.created.length,1);const [a]=h.created;
 assert.equal(a.src,restartUrl(1),'its own URL, with r=1');assert.deepEqual(a.attributes,[{name:'id',value:'beast-art'},{name:'alt',value:''}],'its id and alt, not its old src');
 assert.equal(h.page[0],h.first,'shown only once decoded');
 a.load();assert.equal(h.page[0],a);assert.deepEqual(h.swaps,[a]);
 h.pass();const b=h.created[1];assert.equal(b.src,restartUrl(2),'from the original URL, not the shown restart');b.load();assert.equal(h.page[0],b,'replaces the current image');assert.deepEqual(h.swaps,[a,b]);
});
test('<img> art: a restart keeps the original bytes of art that is not UTF-8',()=>{
 // ISO-8859-1 "café": byte e9 is not valid UTF-8. Decoding it to text and re-encoding gives ef bf bd.
 const latin1=Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"><text>caf\xe9</text></svg>','latin1');
 const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>é</text></svg>','utf16le')]);
 for(const bytes of [latin1,utf16]){
  const h=imgHarness(svgUrl(bytes));h.pass();const src=h.created[0].src;
  assert.equal(src,restartUrl(1,svgUrl(bytes)));assert.deepEqual(Buffer.from(src.slice(src.indexOf(',')+1),'base64'),bytes,'byte for byte');
 }
});
test('<img> art: a restart keeps the media type, its parameters and the payload, and only adds r=<n>',()=>{
 const payload=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
 for(const [src,restart] of [
  [`data:image/svg+xml;charset=utf-8;base64,${payload}`,`data:image/svg+xml;charset=utf-8;r=1;base64,${payload}`],
  [`data:image/svg+xml;BASE64,${payload}`,`data:image/svg+xml;r=1;BASE64,${payload}`],
  ['data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctext%3Ea,b%3C/text%3E%3C/svg%3E','data:image/svg+xml;r=1,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctext%3Ea,b%3C/text%3E%3C/svg%3E'],
  [`data:image/png;base64,${payload}`,`data:image/png;r=1;base64,${payload}`],
 ]){const h=imgHarness(src);h.pass();assert.equal(h.created[0].src,restart,src);h.created[0].load();assert.equal(h.page[0],h.created[0]);}
});
test('<img> art from any other URL is never restarted',()=>{
 for(const src of ['https://example.com/art.svg','blob:https://example.com/0b1c','']){
  const h=imgHarness(src);assert.equal(h.subscribers,0,'not subscribed');h.pass();assert.equal(h.created.length,0);assert.equal(h.page[0],h.first);h.dispose();
 }
});
test('<img> art: a restart that decodes after a newer one is already shown is dropped',()=>{
 const h=imgHarness();h.pass();h.pass();const [a,b]=h.created;
 b.load();assert.equal(h.page[0],b);a.load();assert.equal(h.page[0],b,'out of order');assert.deepEqual(h.swaps,[b]);
 h.pass();h.created[2].load();assert.equal(h.page[0],h.created[2]);
});
test('<img> art: a stop or replay cancels restarts still decoding',()=>{
 const h=imgHarness();h.pass();h.status.runId=2;h.created[0].load();assert.equal(h.page[0],h.first,'stale run');assert.deepEqual(h.swaps,[]);
 h.status.runId=3;h.pass();h.created[1].load();assert.equal(h.page[0],h.created[1],'the new run restarts');
});
test('<img> art: the play button placement follows each swapped image; dispose ends restarts',()=>{
 const h=imgHarness();h.pass();h.created[0].load();assert.equal(h.art,h.created[0]);h.pass();h.created[1].load();assert.equal(h.art,h.created[1]);assert.equal(h.art,h.page[0]);
 h.pass();h.dispose();h.created[2].load();assert.equal(h.page[0],h.created[1],'a decode finishing after dispose');h.pass();assert.equal(h.created.length,3);
});
// Pass events stop reaching later listeners once an earlier one pauses: the initial one can be lost.
test('real player: an earlier pass listener pausing on the initial event still lets the art follow the music',async()=>{
 let pausing=null;
 const h=playerArt({before:api=>api.onPassStart(e=>{if(e.initial&&!pausing)pausing=api.pause();})});
 const suspend=h.gate('suspend');await h.api.play();h.elapse(.2);
 assert.equal(h.passes.length,1);assert.equal(h.api.getPlayStatus().state,'paused');assert.equal(h.ctx.state,'running');
 atPlayer(h,'aligned at the pause, without the initial event');h.elapse(.05);h.frame();atPlayer(h,'runs on while still audible');assert.equal(h.root.animationsPaused(),false);
 suspend.resolve();await pausing;h.elapse(.2);h.frame();
 atPlayer(h,'frozen where the audio stopped');assert.equal(h.root.animationsPaused(),true);assert.equal(h.nested.animationsPaused(),true);
 await h.api.resume();atPlayer(h,'resumed in step');assert.equal(h.root.animationsPaused(),false);
 h.elapse(.3);h.frame();atPlayer(h,'runs with the audio');
 const before=h.root.getCurrentTime();h.api.stop();assert.equal(h.root.getCurrentTime(),before,'no rewind');runsFree(h,'released');
});
test('real player: a helper mounted while the music is audible follows it at once; before audible it waits',async()=>{
 const h=playerArt();await h.api.play();h.elapse(.02); // Started, not yet audible.
 const timeline=()=>{const log=[];let t=5;return{log,pauseAnimations(){log.push('pause');},unpauseAnimations(){log.push('run');},setCurrentTime(v){log.push('seek');t=v;},getCurrentTime:()=>t,querySelectorAll:()=>[]};};
 const host={requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
 const early=timeline(),first=syncSvgToMusic(early,h.api,{host});await Promise.resolve();assert.deepEqual(early.log,[],'not audible yet: left free');first.dispose();
 h.elapse(.6);const late=timeline(),second=syncSvgToMusic(late,h.api,{host});assert.deepEqual(late.log,[],'first look after returning');await Promise.resolve();
 const s=h.api.getPlayStatus();assert.deepEqual(late.log,['seek','run']);near(late.getCurrentTime(),(s.positionSeconds+LEAD)%s.passSeconds,'aligned at mount');
 second.dispose();h.api.stop();
});
test('notes start when following begins during a pending suspend, even if the music resumes before a frame',()=>{
 const h=artHarness();
 // Audible and pausing, its suspend still pending, with no pass event seen (an earlier pass listener paused).
 h.set({runId:1,state:'paused',audioState:'running',originTime:1,startTime:1,audioTime:1.1,positionSeconds:.07,latencyRevision:1});
 free(h);near(h.root.getCurrentTime(),.07+LEAD,'aligned');assert.deepEqual(h.notes,['play'],'the music is audible: notes play');assert.equal(h.frameCount,1);
 h.set({state:'playing',positionSeconds:.08});free(h);assert.equal(h.notes.at(-1),'play','still playing after the resume');assert.equal(h.frameCount,0);
 near(h.root.getCurrentTime(),.08+LEAD);h.sync.dispose();assert.equal(h.notes.at(-1),'stop');
});
test('real player: a pause requested before audible whose suspend completes after it: the art aligns, then freezes where the audio stopped',async()=>{
 const notes=[];const h=playerArt({notes:{play(){notes.push('play');},pause(){notes.push('pause');},stop(){notes.push('stop');}}});
 await h.api.play();h.elapse(.05);runsFree(h,'not yet audible');
 const suspend=h.gate('suspend'),p=h.api.pause();h.frame();runsFree(h,'paused before audible, still free');assert.deepEqual(notes,[]);
 h.elapse(.1);h.frame(); // The audio clock runs on past tick zero's audible start before the suspend completes.
 atPlayer(h,'aligned once audible');assert.equal(h.root.animationsPaused(),false);assert.deepEqual(notes,['play']);
 suspend.resolve();await p;h.elapse(.2);h.frame();
 atPlayer(h,'frozen where the audio stopped');assert.equal(h.root.animationsPaused(),true);assert.equal(h.nested.animationsPaused(),true);assert.deepEqual(notes,['play','pause']);
 await h.api.resume();atPlayer(h,'resumed in step');assert.equal(h.root.animationsPaused(),false);assert.equal(notes.at(-1),'play');
 h.api.stop();runsFree(h,'released');assert.equal(notes.at(-1),'stop');
});
test('real player: a pause whose suspend completes before audible leaves the art free',async()=>{
 const h=playerArt();await h.api.play();h.elapse(.02);
 const suspend=h.gate('suspend'),p=h.api.pause();h.elapse(.02);h.frame();suspend.resolve();await p;h.elapse(.3);h.frame();
 runsFree(h,'never audible');assert.equal(h.seeks,0);
 await h.api.resume();h.elapse(.2);assert.equal(h.passes.at(-1).initial,true);atPlayer(h,'synced at the initial pass after resume');h.api.stop();
});
// The art is a function of getPlayStatus(): random transport, timing and meddling subscribers must
// never leave it, or the notes, anywhere else once a frame has run.
test('real player, randomized: the art and notes always match what getPlayStatus() implies',async()=>{
 const rng=seed=>()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 const wrap=(d,p)=>d-Math.round(d/p)*p;
 let checks=0;
 for(let seed=1;seed<=150;seed++){
  const r=rng(seed),notes=[],gates=[],trail=[],heard={},positioned={};
  const pauseOnPass=r()<.3,meddle=r()<.3;
  const h=playerArt({notes:{play(){notes.push('play');},pause(){notes.push('pause');},stop(){notes.push('stop');}},before:api=>{
   if(pauseOnPass)api.onPassStart(()=>{if(r()<.4)api.pause().catch(()=>{});});
   if(meddle)api.onStateChange(s=>{const x=r();if(s.state==='playing'&&x<.1)api.pause().catch(()=>{});else if(s.state==='playing'&&x<.14)api.stop();});
  }});
  for(let step=0;step<40;step++){
   const x=r(),now=h.api.getPlayStatus();
   if(x<.2){trail.push('play');h.api.play().catch(()=>{});}
   else if(x<.35){trail.push('pause');h.api.pause().catch(()=>{});}
   else if(x<.47){trail.push('resume');h.api.resume().catch(()=>{});}
   else if(x<.52){trail.push('stop');h.api.stop();}
   else if(x<.57){trail.push('hold suspend');gates.push(h.gate('suspend'));}
   else if(x<.61){trail.push('hold resume');gates.push(h.gate('resume'));}
   else if(x<.69){trail.push('release');for(const g of gates.splice(0))g.resolve();}
   else if(x<.76&&(now.state==='playing'||now.state==='paused')&&now.audioState==='running'){
    // While the audio runs (a change while suspended has its own regression: the player re-anchors its
    // held position with the new latency when a resume it cancels re-suspends, without notifying). Any
    // change before the music is heard; after it, none that pushes the position below zero, which the
    // player clamps (the documented transient where the art leads until the next pass).
    const cap=heard[now.runId]&&now.originTime!==null&&now.audioTime!==null?now.audioTime-now.originTime-.003:.26;
    trail.push('latency');h.ctx.outputLatency=Math.max(.01,Math.min(.01+r()*.25,cap));h.elapse(.26);}
   else{const dt=[.004,.03,.2,1.1][Math.floor(r()*4)];trail.push('elapse '+dt);h.elapse(dt);}
   await settle();h.frame();await settle();
   const s=h.api.getPlayStatus(),where=`seed ${seed}: ${trail.join(', ')} -> ${s.state}/${s.audioState}`;
   for(const p of h.passes)heard[p.runId]=true;
   // Heard as the player reports it: a pass event or a position past zero (live, or held while suspended).
   const running=s.audioState==='running',at=!running||s.originTime===null||s.audioTime===null?null:s.audioTime-(s.originTime+s.latencySeconds);
   const live=s.state==='playing'||s.state==='paused';
   if(live&&(s.positionSeconds??0)>0)heard[s.runId]=positioned[s.runId]=true;
   // The initial pass fires up to 1 ms early: a pause inside it (an earlier listener) can leave the run
   // suspended at position 0 with that event never delivered to the helper. Free or frozen at zero are both right.
   if(live&&!running&&(s.positionSeconds??0)===0&&heard[s.runId]&&!positioned[s.runId])continue;
   if(live&&at!==null&&at>-.0025&&at<=0&&!heard[s.runId])continue; // Inside the player's early-dispatch window.
   checks++;
   if(!(live&&heard[s.runId])){
    for(const svg of [h.root,h.nested])assert.equal(svg.animationsPaused(),false,'free: '+where);
    assert.notEqual(notes.at(-1),'play','notes not playing: '+where);
   }else{
    const frozen=s.audioState!=='running',expected=((s.positionSeconds??0)+LEAD)%s.passSeconds;
    for(const svg of [h.root,h.nested]){
     assert.equal(svg.animationsPaused(),frozen,(frozen?'frozen: ':'running: ')+where);
     // Within 2.1 ms: following can start up to 2 ms before the audible start (the initial pass's early
     // dispatch), so the art may lead by that much until the next seek.
     assert.ok(Math.abs(wrap(svg.getCurrentTime()-expected,s.passSeconds))<.0021,`aligned: ${where}: art ${svg.getCurrentTime()} expected ${expected}`);
    }
    assert.equal(notes.at(-1),frozen?'pause':'play','notes: '+where);
   }
  }
  for(const g of gates)g.resolve();h.api.stop();await settle();
 }
 assert.ok(checks>4000,`checked ${checks} states`);
});
test('real player: a latency drop during a pause before anything was heard leaves the art free',async()=>{
 const h=playerArt();h.ctx.outputLatency=.2;await h.api.play();h.elapse(.2); // Audible start 1.3; the clock is at 1.2.
 assert.equal(h.passes.length,0);await h.api.pause();h.elapse(.05);h.frame();
 const s=h.api.getPlayStatus();assert.equal(s.audioState,'suspended');assert.equal(s.positionSeconds,0);const seen=h.log.length;
 h.ctx.outputLatency=.03;h.elapse(.3);h.frame(); // By the new estimate tick zero "was" audible at 1.13: it was not heard.
 assert.ok(Math.abs(h.api.getPlayStatus().latencySeconds-.03)<1e-9,'the new latency is published while paused');
 assert.deepEqual(h.log.slice(seen),[],'no freeze, no seek');runsFree(h,'still free');
 await h.api.resume();h.elapse(.01);assert.equal(h.passes.at(-1)?.initial,true);atPlayer(h,'synced once the music is heard');h.api.stop();
});
test('real player and notes.js: following that starts frozen (mounted while paused) shows the notes at the held position',async()=>{
 const h=playerArt();await h.api.play();h.elapse(.6);await h.api.pause();h.elapse(.1);h.frame();
 const s=h.api.getPlayStatus();assert.equal(s.audioState,'suspended');assert.ok(s.positionSeconds>0);
 const recorder=()=>{const ops=[];return{ops,g:new Proxy({},{get:(_,k)=>(...args)=>{ops.push([k,...args]);},set:(_,k,v)=>{ops.push(['=',k,v]);return true;}})};};
 const canvas=g=>({style:{},width:0,height:0,hidden:false,isConnected:true,getContext:()=>g});
 const midi=riff({ppq:96,us:500000}),host={requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
 const saved=[globalThis.requestAnimationFrame,globalThis.cancelAnimationFrame];globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 try{
  // Wired as documented: the notes are created first and read the helper's returned clock().
  const a=recorder();let sync=null;const notes=mountNotes(canvas(a.g),{midi,clock:()=>sync.clock()});a.ops.length=0;
  const art={pauseAnimations(){},unpauseAnimations(){},setCurrentTime(){},getCurrentTime:()=>0,querySelectorAll:()=>[]};
  sync=syncSvgToMusic(art,h.api,{host,notes});await Promise.resolve();
  const b=recorder(),reference=mountNotes(canvas(b.g),{midi,clock:()=>sync.clock()});b.ops.length=0;reference.play();reference.pause();
  assert.ok(a.ops.length>0);assert.deepEqual(a.ops,b.ops,'drawn exactly as notes played, then paused, at the held position');
  sync.dispose();
 }finally{[globalThis.requestAnimationFrame,globalThis.cancelAnimationFrame]=saved;}
 h.api.stop();
});
