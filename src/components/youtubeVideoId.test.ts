import assert from "node:assert/strict";
import test from "node:test";

import { youtubeThumbnail, youtubeVideoId } from "../lib/youtube.ts";

/**
 * The import form asks which end you played from over YouTube's still of
 * the video, so a link that validates but yields no id would silently drop
 * the question — which is the gap this exists to close.
 */
test("every accepted link shape yields the video id", () => {
  const id = "VCKbGJqMuV0";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=90s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `youtube.com/watch?v=${id}`,
    `  https://www.youtube.com/watch?v=${id}  `,
  ]) {
    assert.equal(youtubeVideoId(url), id, url);
  }
});

test("anything else yields null rather than a bad thumbnail", () => {
  for (const url of [
    "",
    "not a url",
    "https://vimeo.com/12345678901",
    // The reason id-parsing and link-validation are ONE function: parsed
    // loosely, this shape lifts an id off any host at all.
    "https://vimeo.com/embed/VCKbGJqMuV0",
    "https://evil.example.com/embed/VCKbGJqMuV0",
    "https://www.youtube.com/watch?v=tooshort",
    "https://www.youtube.com/feed/subscriptions",
  ]) {
    assert.equal(youtubeVideoId(url), null, url);
  }
});

test("the thumbnail is hqdefault, which always exists", () => {
  assert.equal(
    youtubeThumbnail("https://youtu.be/VCKbGJqMuV0"),
    "https://img.youtube.com/vi/VCKbGJqMuV0/hqdefault.jpg"
  );
  assert.equal(youtubeThumbnail("https://vimeo.com/12345678901"), null);
});
