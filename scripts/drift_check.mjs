#!/usr/bin/env node
// Long-session transport/art acceptance. The NFT monitor observes drift without correcting it.
// Browser/null-sink estimates do not establish physical synchronization; hardware is issue #52.
import { parseArgs } from "node:util";
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  minutes:{type:"string",default:"10"},every:{type:"string",default:"10"},
  "drift-info":{type:"boolean",default:false}
}});
const minutes=Number(values.minutes),every=Number(values.every);
if(!(minutes>0&&minutes<=60&&every>0)||positionals.length>1)throw Error("usage: drift_check.mjs [--minutes 10] [--every 10] [--drift-info] [out_dir]");
process.env.SYNC_SECONDS=String(minutes*60);
process.env.SYNC_SAMPLE_SECONDS=String(every);
if(positionals[0])process.env.SYNC_RESULTS=positionals[0];
// The monitor samples each frame; --every records checkpoints. Drift is always informational.
await import("./sync_check.mjs");
