import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkSchedule} from './schedule_observations.mjs';
const observations = () => ({origin: 1, period: 2,
  sends: [[0x90,72,96,1,.9],[0xc0,0,undefined,1.5,1.3],[0x90,72,96,3,2.8],[0x90,72,96,5,4.8]],
  passes: [{passIndex:0,startTime:1},{passIndex:1,startTime:3}]});
test('actual scheduled openings match origin/grid and captured API passes despite later engine lookahead',()=>{
 const result=checkSchedule(observations());assert.equal(result.observed_passes,3);assert.equal(result.late,0);
});
test('a uniformly shifted actual engine grid fails even when API arithmetic remains self-consistent',()=>{
 const o=observations();for(const send of o.sends)send[3]+=.001;
 assert.throws(()=>checkSchedule(o),/engine pass grid error/);
});
test('missing/duplicate engine openings and mismatched API pass announcements fail',()=>{
 const missing=observations();missing.sends.splice(2,1);assert.throws(()=>checkSchedule(missing),/engine pass grid error/);
 const duplicate=observations();duplicate.sends.splice(2,0,[0x90,72,96,1,.9]);assert.throws(()=>checkSchedule(duplicate),/engine pass grid error/);
 const mismatch=observations();mismatch.passes[1].startTime+=.001;assert.throws(()=>checkSchedule(mismatch),/disagrees/);
});
test('a late non-opening message fails independently of valid pass timing',()=>{
 const o=observations();o.sends[1][4]=1.501;assert.throws(()=>checkSchedule(o),/scheduled behind currentTime/);
});
