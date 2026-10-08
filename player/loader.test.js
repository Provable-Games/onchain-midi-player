// @ts-nocheck
// Dynamic browser/engine mocks intentionally exercise values outside browser typings.
import assert from "node:assert/strict";
import vm from "node:vm";
import { test } from "node:test";
import { gunzipScripts } from "./gunzip.js";
import { gzipSource } from "../scripts/build_segments.mjs";
import { b64 } from "../scripts/segments.mjs";
function harness(definitions,{loading=true}={}){
 const handlers=new Set();let ready;
 const host={atob,btoa,TextDecoder,Error,AggregateError,order:[],document:{readyState:loading?"loading":"complete",addEventListener(_,fn){ready=fn;},querySelectorAll(){return tags;},createElement(){return{};}},addEventListener(_,fn){handlers.add(fn);},removeEventListener(_,fn){handlers.delete(fn);}};
 host.window=host;vm.createContext(host);
 const tags=definitions.map(([id,source,uri,namespaceURI="http://www.w3.org/1999/xhtml"])=>({namespaceURI,getAttribute(name){return name==="id"?id:name==="src"?uri??`data:application/gzip;base64,${b64(gzipSource(source))}`:null;},replaceWith(script){try{vm.runInContext(script.textContent,host);host.order.push(script.id);}catch(e){for(const fn of handlers)fn({error:e,message:e.message,preventDefault(){}});}}}));
 return{host,parse(){host.document.readyState="complete";ready();}};
}
test("promise defined before payload parsing; independent/dependent libraries execute in document order once",async()=>{const h=harness([["first","window.First = 3"],["independent","window.Independent = 8"],["dependent","window.Result = window.First + window.Independent"]]);const p=gunzipScripts(h.host);assert.equal(h.host.OnchainLibraries.ready,p);assert.deepEqual(h.host.order,[]);assert.equal(gunzipScripts(h.host),p);h.parse();await p;assert.deepEqual(h.host.order,["first","independent","dependent"]);assert.equal(h.host.Result,11);await gunzipScripts(h.host);assert.equal(h.host.order.length,3);});
test("loader after DOMContentLoaded initializes immediately",async()=>{const h=harness([["a","window.OK=true"]],{loading:false});await gunzipScripts(h.host);assert.equal(h.host.OK,true);});
test("duplicate IDs reject before any block executes",async()=>{const h=harness([["a","window.A=1"],["a","window.B=1"]],{loading:false});await assert.rejects(gunzipScripts(h.host),/library a.*duplicate/);assert.deepEqual(h.host.order,[]);});
for(const bad of ["data:text/javascript;base64,AAAA","data:application/gzip;base64,!", "data:application/gzip;base64,AB==","data:application/gzip;base64,AAAA"])
 test(`strict gzip URI failure ${bad}`,async()=>{const h=harness([["damaged","",bad],["ok","window.OK=1"]],{loading:false});await assert.rejects(gunzipScripts(h.host),/library damaged/);assert.equal(h.host.OK,1);});
test("synchronous runtime and syntax errors identify affected blocks and allow later independent blocks",async()=>{const h=harness([["thrower","throw Error('failed')"],["syntax","const = ;"],["ok","window.OK=1"]],{loading:false});await assert.rejects(gunzipScripts(h.host),/thrower.*syntax/);assert.equal(h.host.OK,1);});
test("invalid UTF8 fails even if gzip CRC is valid",async()=>{const uri=`data:application/gzip;base64,${b64(gzipSource(Uint8Array.from([255,254])))}`,h=harness([["utf8","",uri]],{loading:false});await assert.rejects(gunzipScripts(h.host),/library utf8/);});
test("ready covers synchronous initialization, not a library's asynchronous work",async()=>{const h=harness([["async","window.Delayed=Promise.resolve().then(()=>window.Done=1)"]],{loading:false});h.host.Promise=Promise;await gunzipScripts(h.host);assert.ok(h.host.Delayed);await h.host.Delayed;assert.equal(h.host.Done,1);});

test("foreign-namespace gzip scripts do not execute or conflict with HTML libraries",async()=>{const h=harness([["a","throw Error('SVG decoy')",undefined,"http://www.w3.org/2000/svg"],["a","window.A=1"]],{loading:false});await gunzipScripts(h.host);assert.equal(h.host.A,1);assert.deepEqual(h.host.order,["a"]);});
