// @ts-nocheck
// A complete NFT-owned reference page, assembled from the current independent library segments.
import { readFileSync } from "node:fs";
import { compositionHtml } from "../composition.mjs";
import { MANIFEST_PATH, VERSION, sha256 } from "../segments.mjs";
import { GOOD_MIDI, SIMPLE_SETTINGS } from "./fixtures.mjs";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#222"/></svg>';
export const consumerPage = (midi = GOOD_MIDI, settings = SIMPLE_SETTINGS) => compositionHtml({
  mem: '"name":"Playback certification"', svg: SVG, midi, settings,
});
export const libraryRecord = (version = VERSION) => JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))[version];
export function libraryHash(record) {
  if (!record) throw Error("library version record is missing");
  return sha256(JSON.stringify(record));
}
