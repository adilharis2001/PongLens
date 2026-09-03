import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { linkify, hasLink } from "./linkify.ts";

/**
 * The link rule is a pure function with a written specification behind it,
 * so it gets the specification's own awkward cases rather than a couple of
 * happy ones. The fixture is shared with the Swift port
 * (ios/Tests/LinkifyTests.swift) so a change on one platform that is not
 * made on the other fails here or there.
 */

interface Case {
  why: string;
  text: string;
  links: { text: string; href: string }[];
}

const cases: Case[] = JSON.parse(
  readFileSync(
    new URL("../../ios/Tests/fixtures/linkify-cases.json", import.meta.url),
    "utf8",
  ),
).cases;

test("every shared case resolves the same way on the web", () => {
  for (const c of cases) {
    const found = linkify(c.text)
      .filter((s) => s.kind === "link")
      .map((s) => ({ text: s.text, href: (s as { href: string }).href }));
    assert.deepEqual(found, c.links, `${c.why}: ${JSON.stringify(c.text)}`);
    assert.equal(hasLink(c.text), c.links.length > 0, c.why);
  }
});

test("the text is preserved exactly, whatever the split", () => {
  for (const c of cases) {
    assert.equal(
      linkify(c.text)
        .map((s) => s.text)
        .join(""),
      c.text,
      c.why,
    );
  }
});

test("only http, https and mailto are ever produced", () => {
  const scary =
    "try javascript:alert(1) data:text/html,x vbscript:x file:///etc/passwd";
  assert.deepEqual(linkify(scary), [{ kind: "text", text: scary }]);
  for (const c of cases) {
    for (const s of linkify(c.text)) {
      if (s.kind !== "link") continue;
      assert.match(s.href, /^(https?:\/\/|mailto:)/);
    }
  }
});

test("plain text comes back as one segment", () => {
  assert.deepEqual(linkify("no links here"), [
    { kind: "text", text: "no links here" },
  ]);
  assert.deepEqual(linkify(""), []);
});
