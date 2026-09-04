import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { catalogChapters } from "./course-paths.mjs";

const tutorialRoot = fileURLToPath(new URL(".", import.meta.url));

const approvedNarration = {
  player: {
    home: [
      "PongLens takes a video of your match and turns it into something you can study.",
      "Here is a quick run through what it does.",
      "Home picks up wherever you left off, so a match you started scoring sits right at the top.",
      "Under that are your recent matches and how your game is going across all of them.",
      "Anything you have exported lands here too, ready to download or send on.",
      "And the short list of things you are working on stays in view before you play.",
    ],
    upload: [
      "Everything in PongLens starts with a match video.",
      "On iPhone, you can record in PongLens or choose a video you already have. On the web, choose a file or paste a YouTube link.",
      "How to record shows the camera position that gives PongLens the clearest view of the table.",
      "Videos can be up to 45 minutes long.",
      "Add who you played, where, what kind of session it was, and which side of the video is yours.",
      "Choose whether to break the video into points and generate placement maps.",
      "You can leave when the upload finishes. PongLens lets you know when the match is ready.",
    ],
    viewer: [
      "Your match comes back with the time between rallies removed.",
      "Double tap the right side to move forward one point, the left side to go back, or the middle to replay the point.",
      "Hold the right side for double speed and the left side for quarter speed.",
      "Pinch to zoom in on the table, then drag to move around.",
      "Open the point grid when you want to jump directly to another rally.",
      "Star a point, share it, or leave a note without closing the player.",
      "If the cut missed something, open Original to watch the video exactly as you uploaded it.",
    ],
    point: [
      "Open any point and you get that rally on its own.",
      "Choose who won it. That is enough to build the score.",
      "You can also record how the point ended, what happened on the serve, and what went wrong.",
      "Those answers fill the match analysis and your statistics.",
      "Notes, tags, stars and drawings stay attached to the exact rally.",
      "If the cut is wrong, you can adjust it, split joined rallies, remove dead space, or put back a rally PongLens missed.",
    ],
    keepscore: [
      "Score Keeper is built for scoring a whole match far faster than watching it back.",
      "It plays the match one point at a time and waits for you.",
      "Watch the rally, then choose who won it. The score keeps itself.",
      "The lit ball shows who is serving. Change it if the rotation needs correcting.",
      "Open Analysis when you want to record what happened.",
      "You can also add a note or tag without breaking your rhythm.",
      "Correct a game ending when the real match does not match the automatic score.",
      "Skip a let, remove dead space, or modify a clip that contains the wrong footage.",
      "Every point you score feeds the scorecard, analysis and statistics.",
    ],
    analysis: [
      "Once the points are scored, the match reads itself back to you.",
      "See how the match swung, how you performed serving and receiving, and what happened at the tight ends of games.",
      "The reasons you chose while scoring show what cost you points.",
      "Placement maps show where the camera could follow the ball.",
      "Move between your serves, their serves, individual landings and the heat map.",
      "If placement was not generated with the original processing, you can request it from Tools while the original video is still available.",
      "Placement is still in beta, so you can mark a result that looks wrong and it stops counting.",
    ],
    export: [
      "PongLens builds a short and a longer highlight from the best rallies in the match.",
      "Watch either one first, then download or share the version you want.",
      "Stars let you keep your own collection of rallies across matches.",
      "Tags gather points under the words you use, such as backhand receive or third-ball attack.",
      "You can export the full match, starred rallies, or every point carrying one tag.",
      "Turn on Include score when you want the running scoreboard added to the video.",
      "A public link lets someone watch a match, point or collection without making an account.",
      "The original upload remains available from the match while you keep it in your library.",
    ],
    coach: [
      "Invite a coach with one link and choose whether they see every match or only the matches you share.",
      "They open the same points, score and analysis that you do.",
      "They can leave written or spoken feedback on a point and draw directly on a frame.",
      "A coach can also keep lesson entries for you and share them when they are ready.",
      "Their point notes and shared lesson entries arrive in your Journal.",
      "Your coach cannot change your score, clips or match details.",
      "You remain in control of which matches they can open.",
    ],
    journal: [
      "Your Journal brings together match notes, practice entries, lessons and entries shared by your coach.",
      "Write, dictate, add a photo, or scan pages from a paper notebook.",
      "Improve with AI can turn rough notes into clear points, and you can edit those points directly afterwards.",
      "Search finds the words you saved, while Ask your journal answers from your own notes and match record.",
      "Tags connect related entries and rallies across different matches.",
      "Working on keeps your current cues visible until you tick them off.",
      "Recollect brings older advice back when it is useful again.",
    ],
  },
  coach: {
    "coach-start": [
      "PongLens gives every student one place for lesson entries, shared material and matches.",
      "Coaching Home shows the students and entries you have worked with recently.",
      "Students is your full roster, including people who do not have a PongLens account yet.",
      "New entry is where you write or record what happened in a lesson.",
      "If you also use PongLens as a player, the switch at the top moves between Playing and Coaching.",
    ],
    "coach-add-student": [
      "A student does not need a PongLens account before you add them.",
      "Open Students, choose Add a student, and enter their name.",
      "Their page starts with a private journal for your lesson entries.",
      "Once they connect, the matches they share appear on the same page.",
      "You can rename a student or remove them from your active list without losing the lesson history you already kept.",
    ],
    "coach-connect-account": [
      "When the student is ready, send the invite link from their page.",
      "The invite connects their account to the name and entries already on your roster.",
      "They choose whether you can see every match or only the matches they share individually.",
      "You see only the matches covered by that choice, not the rest of their account or private Journal.",
      "If the same student joined as a second row, merge the two and keep the name and history you already entered.",
    ],
    "coach-lesson-entry": [
      "Open a student and start a new lesson entry.",
      "Type, paste, or dictate what you worked on.",
      "Add a photo or include a useful link in the text.",
      "Improve with AI can prepare rough notes as clear points for you to review.",
      "You can edit the original words or correct the prepared notes directly.",
      "Link the entry to one of the student's matches when the lesson refers to it.",
      "The entry stays private until you decide to share it.",
    ],
    "coach-audio-lesson": [
      "On iPhone, choose Audio record a lesson and select the student.",
      "Put the phone near the table where it can hear both sides of the session.",
      "Start recording and leave it running while you coach.",
      "You can pause when the lesson stops and continue when it starts again.",
      "When you finish, PongLens prepares the transcript and the main lesson points.",
      "Review and edit them before the entry is saved under the student.",
    ],
    "coach-share-entry": [
      "A lesson entry stays in your private coaching record until you share it.",
      "For a connected student, Share with sends it directly to their Journal.",
      "If you edit the entry later, the version in their Journal updates too.",
      "You can stop sharing at any time.",
      "For someone without an account, copy a public link to that individual entry.",
      "The link does not expose the rest of the student's record.",
    ],
    "coach-review-match": [
      "Matches a student shares appear beside their lesson entries.",
      "Open one to watch the cut video or the original upload.",
      "Move through the match point by point and follow the score the student recorded.",
      "You can also read their match analysis and placement maps.",
      "The match remains theirs. You cannot change their score, clips or details.",
      "If they change your match access, the list updates to match their choice.",
    ],
    "coach-feedback": [
      "Open the point that shows what you want to explain.",
      "Write a note or record a voice note on that rally.",
      "Pause on a useful frame and draw directly onto it.",
      "Use Overall notes when the feedback applies across the whole match.",
      "The student receives your feedback in the match and in their Journal.",
      "Keeping the note beside the footage makes it clear which moment you meant.",
    ],
    "coach-paid-review": [
      "Paid match reviews are optional and are managed on the web.",
      "Build your coach page and create an offering with your own scope, price and turnaround.",
      "The player sends a match, their questions and the information you asked for.",
      "Nothing starts until you accept the order.",
      "Review the match point by point and connect findings to the rallies that demonstrate them.",
      "Add the written sections and attachments included in your offering.",
      "Deliver the finished review through PongLens and answer any included follow-up.",
      "Payment and payout status remain with the order.",
    ],
  },
};

async function readManifest(course, slug) {
  const manifestPath = path.join(tutorialRoot, "chapters", course, `${slug}.json`);
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

function assertNarrationLines(lines, label) {
  assert.ok(lines.length >= 5, `${label} line count`);
  for (const [index, line] of lines.entries()) {
    for (const field of ["id", "text", "beat"]) {
      assert.equal(typeof line[field], "string", `${label} line ${index + 1} ${field} type`);
      assert.ok(line[field].trim().length > 0, `${label} line ${index + 1} ${field} value`);
    }
  }

  const ids = lines.map(({ id }) => id);
  const beats = lines.map(({ beat }) => beat);
  assert.equal(new Set(ids).size, ids.length, `${label} duplicate line ids`);
  assert.equal(new Set(beats).size, beats.length, `${label} duplicate beats`);
  assert.deepEqual(
    ids,
    lines.map((_, index) => `l${index + 1}`),
    `${label} line ids must be sequential`,
  );
}

test("narration line metadata rejects duplicate and non-sequential identifiers", () => {
  const valid = [
    { id: "l1", text: "First", beat: "open" },
    { id: "l2", text: "Second", beat: "next" },
    { id: "l3", text: "Third", beat: "detail" },
    { id: "l4", text: "Fourth", beat: "review" },
    { id: "l5", text: "Fifth", beat: "finish" },
  ];

  assert.throws(
    () => assertNarrationLines(valid.with(1, { ...valid[1], id: "l1" }), "duplicate id"),
    /duplicate line ids/i,
  );
  assert.throws(
    () => assertNarrationLines(valid.with(1, { ...valid[1], beat: "open" }), "duplicate beat"),
    /duplicate beats/i,
  );
  assert.throws(
    () => assertNarrationLines(valid.with(1, { ...valid[1], id: "l6" }), "bad sequence"),
    /sequential/i,
  );
  assert.throws(
    () => assertNarrationLines(valid.with(1, { ...valid[1], text: " " }), "empty text"),
    /text value/i,
  );
});

for (const course of ["player", "coach"]) {
  test(`${course} narration matches the approved course and catalog`, async () => {
    const catalog = catalogChapters(course, "web");
    assert.equal(catalog.length, 9);

    for (const [index, chapter] of catalog.entries()) {
      const script = await readManifest(course, chapter.slug);
      assert.equal(script.chapter, chapter.slug, `${course}/${chapter.slug} chapter`);
      assert.equal(script.title, chapter.title, `${course}/${chapter.slug} title`);
      assert.equal(script.subtitle, `Chapter ${index + 1} of 9`, `${course}/${chapter.slug} subtitle`);
      assert.equal(script.voice, "sage", `${course}/${chapter.slug} voice`);
      assert.equal(script.speed, 1.3, `${course}/${chapter.slug} speed`);
      assert.match(script.instructions, /Warm and plain spoken/, `${course}/${chapter.slug} direction`);
      assertNarrationLines(script.lines, `${course}/${chapter.slug}`);
      assert.deepEqual(
        script.lines.map(({ text }) => text),
        approvedNarration[course][chapter.slug],
        `${course}/${chapter.slug} approved narration`,
      );
    }
  });
}

test("coach narration excludes unavailable recording claims", async () => {
  const forbidden = /coming soon|video lesson|video recording|record video/i;
  for (const chapter of catalogChapters("coach", "web")) {
    const manifest = await readManifest("coach", chapter.slug);
    assert.doesNotMatch(JSON.stringify(manifest), forbidden, `coach/${chapter.slug}`);
  }
});

test("paid reviews are web-only coach media", async () => {
  const paid = await readManifest("coach", "coach-paid-review");
  assert.deepEqual(paid.platforms, ["web"]);
  assert.equal(
    catalogChapters("coach", "ios").some(({ slug }) => slug === "coach-paid-review"),
    false,
  );
  await assert.rejects(readManifest("player", "coach-paid-review"), /ENOENT/);
});
