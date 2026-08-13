import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CHANNEL_LABEL,
  EMPTY_FILTER,
  STAGES,
  channelHref,
  channelsFor,
  filterCoaches,
  formatFollowers,
  initialFor,
  profileHref,
  stageLabel,
  summarise,
  type OutreachCoach,
} from "./outreachModel.ts";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const coach = (over: Partial<OutreachCoach> = {}): OutreachCoach => ({
  id: over.id ?? "1",
  handle: "mhtabletennis",
  full_name: "Matt Hetherington",
  bio: "Table tennis coach",
  followers: 112897,
  language: "en",
  country: "GB",
  english: true,
  profile_url: null,
  avatar_url: null,
  fit_note: "coach in name and bio",
  discovered_via: "table tennis coach",
  stage: "found",
  notes: null,
  outreach_channels: [{ kind: "instagram", value: "mhtabletennis", source: "profile" }],
  ...over,
});

test("every channel opens where a person actually is", () => {
  assert.equal(channelHref("instagram", "coachx"), "https://ig.me/m/coachx");
  assert.equal(channelHref("email", "a@b.com"), "mailto:a@b.com");
  assert.equal(
    channelHref("whatsapp", "+55 85 99792-8282"),
    "https://wa.me/5585997928282",
  );
  assert.equal(channelHref("telegram", "@vihllusha"), "https://t.me/vihllusha");
  assert.equal(channelHref("phone", "+441234"), "tel:+441234");
  assert.equal(channelHref("website", "coachbashir.com.ng"), "https://coachbashir.com.ng");
  assert.equal(channelHref("website", "https://x.com/a"), "https://x.com/a");
});

test("the profile link falls back to the handle", () => {
  assert.equal(
    profileHref({ handle: "coachx", profile_url: null }),
    "https://www.instagram.com/coachx",
  );
  assert.equal(
    profileHref({ handle: "coachx", profile_url: "https://instagram.com/coachx" }),
    "https://instagram.com/coachx",
  );
});

test("channels are ordered by usefulness and shown once per kind", () => {
  const c = coach({
    outreach_channels: [
      { kind: "youtube", value: "https://youtube.com/x", source: "profile" },
      { kind: "website", value: "https://a.com", source: "profile" },
      { kind: "website", value: "https://b.com", source: "bio_link" },
      { kind: "email", value: "a@b.com", source: "bio_link" },
      { kind: "instagram", value: "coachx", source: "profile" },
    ],
  });
  // Instagram is the card's own Message button, never a secondary pill.
  assert.deepEqual(
    channelsFor(c).map((x) => x.kind),
    ["email", "website", "youtube"],
  );
  assert.equal(channelsFor(c)[1].value, "https://a.com");
});

test("every channel kind has a label", () => {
  for (const kind of Object.keys(CHANNEL_LABEL)) {
    assert.ok(CHANNEL_LABEL[kind as keyof typeof CHANNEL_LABEL].length > 0);
  }
});

test("the avatar letter never splits a character in half", () => {
  assert.equal(initialFor({ full_name: "Matt Hetherington", handle: "mh" }), "M");
  // The name that broke hydration: a bat is a surrogate pair, and charAt(0)
  // returned half of one.
  assert.equal(
    initialFor({ full_name: "🏓 coach ahmed helmy 🏓", handle: "helmy" }),
    "C",
  );
  assert.equal(initialFor({ full_name: null, handle: "coach088" }), "C");
  assert.equal(initialFor({ full_name: "🏓🏓", handle: "🏓" }), "?");
  for (const name of ["🏓 coach", "增田 雄太", "Тренер", null]) {
    const initial = initialFor({ full_name: name, handle: "x" });
    assert.equal([...initial].length, 1, `${name} produced ${initial.length} units`);
  }
});

test("follower counts read the way a person says them", () => {
  assert.equal(formatFollowers(999), "999");
  assert.equal(formatFollowers(1200), "1.2k");
  assert.equal(formatFollowers(112897), "112.9k");
  assert.equal(formatFollowers(1_500_000), "1.5m");
});

test("stages run from found to a resting place", () => {
  assert.equal(STAGES[0].value, "found");
  assert.equal(stageLabel("do_not_contact"), "Do not contact");
  assert.deepEqual(
    STAGES.filter((s) => s.done).map((s) => s.value),
    ["signed_up", "not_a_fit", "no_reply", "do_not_contact"],
  );
  assert.equal(new Set(STAGES.map((s) => s.value)).size, STAGES.length);
});

test("the filters narrow on stage, language, email and free text", () => {
  const all = [
    coach({ id: "1", handle: "english_no_email" }),
    coach({
      id: "2",
      handle: "english_with_email",
      outreach_channels: [{ kind: "email", value: "a@b.com", source: "bio_link" }],
    }),
    coach({ id: "3", handle: "german", english: false, language: "de", stage: "contacted" }),
    coach({ id: "4", handle: "closed", stage: "not_a_fit" }),
  ];

  assert.equal(filterCoaches(all, EMPTY_FILTER).length, 4);
  assert.deepEqual(
    filterCoaches(all, { ...EMPTY_FILTER, englishOnly: true }).map((c) => c.id),
    ["1", "2", "4"],
  );
  assert.deepEqual(
    filterCoaches(all, { ...EMPTY_FILTER, withEmailOnly: true }).map((c) => c.id),
    ["2"],
  );
  assert.deepEqual(
    filterCoaches(all, { ...EMPTY_FILTER, stage: "contacted" }).map((c) => c.id),
    ["3"],
  );
  // "Still open" hides the ones that have come to rest.
  assert.deepEqual(
    filterCoaches(all, { ...EMPTY_FILTER, stage: "live" }).map((c) => c.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    filterCoaches(all, { ...EMPTY_FILTER, query: "GERMAN" }).map((c) => c.id),
    ["3"],
  );
});

test("the summary counts what the header claims", () => {
  const s = summarise([
    coach({ id: "1" }),
    coach({
      id: "2",
      outreach_channels: [{ kind: "email", value: "a@b.com", source: "bio_link" }],
    }),
    coach({ id: "3", english: false, stage: "replied" }),
    coach({ id: "4", stage: "signed_up" }),
  ]);
  assert.deepEqual(s, {
    total: 4,
    english: 3,
    withEmail: 1,
    contacted: 2,
    replied: 2,
  });
});

test("the pipeline page runs the marketing gate and reads channels with coaches", () => {
  const page = read("./page.tsx");
  assert.match(page, /requireMarketing\("\/marketing\/coach-outreach"\)/);
  assert.match(page, /outreach_coaches/);
  assert.match(page, /outreach_channels \(kind, value, source\)/);
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
});

test("the page sends nothing, it only records what was sent by hand", () => {
  const list = read("./OutreachList.tsx");
  assert.match(list, /from\("outreach_coaches"\)\s*\.update\(\{ stage \}\)/);
  assert.doesNotMatch(list, /fetch\(|sendEmail|resend|jmap/i);
  // Instagram is the one channel every coach has, so it leads.
  assert.match(list, /channelHref\("instagram", coach\.handle\)/);
  assert.match(list, />\s*Message\s*</);
});
