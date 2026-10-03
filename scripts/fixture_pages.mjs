// @ts-check
// The pages the browser checks load: each page fixture's token_uri (tests/fixtures/page.json),
// rebuilt in the Beasts layout and checked against the length and SHA-256 that snforge pins the
// class's output to (`*_html_and_token_uri_match_the_digests` in tests/page_fixtures.cairo), then
// decoded as a marketplace decodes it. A check that loads `tokenPage(c).url` therefore loads the
// class's output for that case, byte for byte. Node built-ins only.

import { readFileSync } from "node:fs";
import { decodeTokenUri, pageHtml, sha256, spliceTokenUri } from "./page.mjs";

/** tests/fixtures/page.json: the page golden fixtures. */
export const FIXTURES = JSON.parse(readFileSync(new URL("../tests/fixtures/page.json", import.meta.url), "utf8"));

/**
 * The valid fixture case named `name`.
 * @param {string} name
 * @returns {any}
 */
export function fixtureCase(name) {
  const c = FIXTURES.valid.find((/** @type {any} */ v) => v.name === name);
  if (!c) throw new Error(`no page fixture case ${name}`);
  return c;
}

/**
 * A fixture case's token_uri and its decoded animation_url, after checking both against the
 * digests the class's output is pinned to. Throws if either differs.
 * @param {any} c a valid case of tests/fixtures/page.json
 * @param {string} [page] PAGE (default: the built tests/fixtures/page.html)
 * @returns {{uri: string, url: string, html: string}} the token_uri, the animation_url (a
 *   `data:text/html;base64,` URI) and the HTML it decodes to (PAGE ++ D ++ SVG)
 */
export function tokenPage(c, page = pageHtml()) {
  // The fixtures' layout: no word-alignment spaces (scripts/gen_page_fixtures.mjs).
  const uri = spliceTokenUri({ mem: c.members, svg: c.svg, pageHtml: page, d: c.d });
  if (uri.length !== c.token_uri.len || sha256(uri) !== c.token_uri.sha256) {
    throw new Error(`${c.name}: token_uri (${uri.length} chars, sha256 ${sha256(uri)}) is not the class's (${c.token_uri.len}, ${c.token_uri.sha256})`);
  }
  const { json, html, htmlBytes } = decodeTokenUri(uri);
  if (htmlBytes.length !== c.animation_html.len || sha256(htmlBytes) !== c.animation_html.sha256) {
    throw new Error(`${c.name}: decoded animation_url is not the class's`);
  }
  return { uri, url: json.animation_url, html };
}
