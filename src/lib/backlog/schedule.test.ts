import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDays,
  dateForWhen,
  daysBetween,
  endOfWeek,
  startOfWeek,
  timelineColumns,
  todayISO,
  whenLabel,
  WHEN_CHOICES,
} from "./schedule.ts";
import type { BacklogItem } from "./types.ts";

// 2026-02-11 is a Wednesday. Its week runs Mon 2026-02-09 → Sun 2026-02-15.
const WED = "2026-02-11";
const SUN = "2026-02-15";
const SAT = "2026-02-14";

function item(over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: Math.random().toString(36).slice(2),
    author_id: "u",
    title: "t",
    notes: "",
    tag: "",
    lane: "next",
    target_date: null,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    done_at: null,
    ...over,
  };
}

test("weeks start on Monday", () => {
  assert.equal(startOfWeek(WED), "2026-02-09");
  assert.equal(endOfWeek(WED), SUN);
  assert.equal(startOfWeek(SUN), "2026-02-09");
  assert.equal(endOfWeek(SUN), SUN);
});

test("day arithmetic crosses months and years", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-02-28", "2026-03-02"), 2);
});

// The bug this guards: a naive local-time parse shifts the day for anyone
// west of UTC across a daylight-saving boundary. US DST starts 2026-03-08.
test("day arithmetic survives a daylight-saving jump", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
});

test("todayISO reads the local calendar day, not UTC", () => {
  // 23:30 local on the 11th is the 12th in UTC. The chip must say the 11th.
  const late = new Date(2026, 1, 11, 23, 30);
  assert.equal(todayISO(late), "2026-02-11");
});

test("every when choice resolves to today or later", () => {
  for (const { key } of WHEN_CHOICES) {
    const resolved = dateForWhen(key, WED);
    if (key === "someday") {
      assert.equal(resolved, null);
      continue;
    }
    assert.ok(resolved !== null && resolved >= WED, key);
  }
});

test("relative choices land where they say", () => {
  assert.equal(dateForWhen("today", WED), WED);
  assert.equal(dateForWhen("tomorrow", WED), "2026-02-12");
  assert.equal(dateForWhen("this_week", WED), SUN);
  assert.equal(dateForWhen("next_week", WED), "2026-02-16");
  assert.equal(dateForWhen("two_weeks", WED), "2026-02-23");
  assert.equal(dateForWhen("further", WED), "2026-03-09");
});

// On the last day of the week "the end of this week" has already arrived;
// promising Sunday on Sunday would read as a date in the past by evening.
test("this week collapses to today on the last day of the week", () => {
  assert.equal(dateForWhen("this_week", SUN), SUN);
});

test("date chips read relative near the front, absolute further out", () => {
  assert.equal(whenLabel(null, WED), "Someday");
  assert.equal(whenLabel("2026-02-10", WED), "Overdue");
  assert.equal(whenLabel(WED, WED), "Today");
  assert.equal(whenLabel("2026-02-12", WED), "Tomorrow");
  assert.equal(whenLabel("2026-02-13", WED), "Friday");
  assert.equal(whenLabel("2026-02-18", WED), "Next week");
  assert.equal(whenLabel("2026-03-23", WED), "Mar 23");
});

test("timeline covers today and tomorrow even on the last day of a week", () => {
  const columns = timelineColumns([], SUN);
  const labels = columns.map((c) => c.label);
  assert.ok(labels.includes("Today"));
  assert.ok(labels.includes("Tomorrow"));
});

test("no date falls into two columns", () => {
  for (const today of [WED, SAT, SUN]) {
    const columns = timelineColumns([], today);
    for (let d = today, i = 0; i < 70; i++, d = addDays(d, 1)) {
      const hits = timelineColumns([item({ target_date: d })], today).filter(
        (c) => c.items.length > 0,
      );
      assert.equal(hits.length, 1, `${today} / ${d}`);
    }
    assert.ok(columns.length > 0);
  }
});

test("undated items land in Someday and nowhere else", () => {
  const columns = timelineColumns([item(), item()], WED);
  const someday = columns.find((c) => c.kind === "someday");
  assert.equal(someday?.items.length, 2);
  assert.equal(
    columns.filter((c) => c.kind !== "someday").every((c) => !c.items.length),
    true,
  );
});

test("the overdue column appears only when something is overdue", () => {
  assert.equal(
    timelineColumns([item({ target_date: WED })], WED).some(
      (c) => c.kind === "overdue",
    ),
    false,
  );
  const withLate = timelineColumns(
    [item({ target_date: "2026-02-02" })],
    WED,
  );
  const overdue = withLate.find((c) => c.kind === "overdue");
  assert.equal(overdue?.items.length, 1);
});

test("far-future work collapses into Later rather than scrolling forever", () => {
  const columns = timelineColumns([item({ target_date: "2027-06-01" })], WED);
  const beyond = columns.find((c) => c.kind === "beyond");
  assert.equal(beyond?.items.length, 1);
  assert.ok(columns.length <= 14);
});

test("items sort soonest first, newest first within a date", () => {
  const older = item({ created_at: "2026-01-01T00:00:00Z" });
  const newer = item({ created_at: "2026-02-01T00:00:00Z" });
  const columns = timelineColumns([older, newer], WED);
  const someday = columns.find((c) => c.kind === "someday");
  assert.deepEqual(
    someday?.items.map((i) => i.created_at),
    ["2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"],
  );
});
