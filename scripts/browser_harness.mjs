// @ts-check
import { launchBrowser,collectErrors } from "./browsers.mjs";
import { tokenPage,fixtureCase } from "./fixture_pages.mjs";
import { compositionHtml } from "./composition.mjs";
import { HTML_PREFIX,b64,fixedFragment } from "./segments.mjs";
export function instrument() {
 const s={synth:null,created:0,passes:[],states:[],media:null,handlers:{},violations:[],readyAt:null,uiReadyAt:null,gestureAt:null,playingAt:null,startedAt:performance.now(),calls:[]};window.__check=s;
 let Real;
 function Wrapped(options){s.created++;const synth=new Real(options);s.synth=synth;
 for(const name of ["prewarm","resume","playMIDI","stopMIDI","loadMIDI"]){const fn=synth[name];synth[name]=(...args)=>{s.calls.push(name);if(name==="playMIDI")s.engineStartedAt=performance.now();return fn.apply(synth,args);};}
 const ctx=synth.getAudioContext(),resume=ctx.resume.bind(ctx);ctx.resume=()=>{s.calls.push("context.resume");return resume();};return synth;}
 Object.defineProperty(window,"WebAudioTinySynth",{configurable:true,get:()=>Real&&Wrapped,set:value=>{Real=value;}});
 const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){s.media=this;return play.call(this);};
 if(window.MediaSession){const action=MediaSession.prototype.setActionHandler;MediaSession.prototype.setActionHandler=function(a,h){s.handlers[a]=h;return action.call(this,a,h);};}
 new MutationObserver(()=>{if(document.getElementById("play")?.disabled===false)s.uiReadyAt??=performance.now();}).observe(document,{subtree:true,attributes:true,attributeFilter:["disabled"]});
 document.addEventListener("click",()=>{s.gestureAt??=performance.now();},{capture:true});
 document.addEventListener("securitypolicyviolation",e=>s.violations.push({directive:e.violatedDirective,uri:e.blockedURI}));
 document.addEventListener("DOMContentLoaded",()=>window.OnchainLibraries?.ready.then(()=>window.OnchainMidiPlayer.ready).then(()=>{
   s.readyAt=performance.now();window.OnchainMidiPlayer.onPassStart(e=>s.passes.push(e));window.OnchainMidiPlayer.onStateChange(e=>{s.states.push(e);if(e.state==="playing")s.playingAt??=performance.now();});
 }).catch(()=>{}));
}
export async function openBrowser() {
 const {browser,engine}=await launchBrowser();return{browser,engine,async page(){const context=await browser.newContext();const page=await context.newPage();await context.addInitScript(instrument);const requests=[];
 await context.route("**/*",route=>{const url=route.request().url();if(/^(data:|blob:)/.test(url))return route.continue();requests.push(url);return route.abort();});
 return{context,page,requests,errors:collectErrors(page)};}};
}
export const dataUrl=html=>HTML_PREFIX+b64(html);
export const composed=(c=fixtureCase("beast_140bpm"),options={fixture:true,dependent:true})=>compositionHtml({mem:c.members,svg:c.svg,d:c.d},options);
export function withoutBlock(html,name){return html.replace(fixedFragment(name),"");}
export async function waitReady(page){await page.waitForFunction(()=>window.OnchainMidiPlayer?.getPlayStatus().state==="stopped");await page.waitForFunction(()=>!document.getElementById("play")?.disabled);}
