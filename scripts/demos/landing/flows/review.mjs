/**
 * The paid review the video shows, staged for the shoot and removed after.
 *
 * The review beat opens /orders/<id> on the demo account. That order used to
 * be a row someone had made by hand months earlier, which meant the beat was
 * one data cleanup away from filming a 404 — and then it was: a sweep of the
 * dummy data took every review_order with it, and the cut shipped with "This
 * page is off the table" on screen under the line about getting your match
 * professionally reviewed.
 *
 * So the order is not a fixture any more, it is part of the capture. The
 * driver calls `stage` before recording and `cleanup` in its `finally`, the
 * same bracket guard.mjs puts around the score taps. Nothing survives the
 * run, and nothing has to survive it.
 *
 * The coach is invented. Everyone else with a storefront on this database is
 * a real person, and this is a public video.
 */

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

/** The demo account, and the match the review is about. */
const STUDENT = "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4";
const MATCH = "efff9208-abf2-4a20-a498-18cc5a5130b3";
/** An existing throwaway auth user, so no account has to be created. */
const COACH = "f15e9358-a722-4d07-9a0d-3379c696497a";

/** Fixed ids, so a cleanup deletes exactly what a staging made. */
export const REVIEW_ORDER = "87cde138-bd5f-4d12-ae14-27fd3611ce64";
const OFFERING = "9f2c4d10-0000-4a00-8000-000000000101";
const FINDINGS = [
  "9f2c4d10-0000-4a00-8000-000000000201",
  "9f2c4d10-0000-4a00-8000-000000000202",
];

const SECTIONS = [
  { key: "summary", label: "Summary" },
  { key: "costing_points", label: "What is costing you points" },
  { key: "practice_plan", label: "Practice plan" },
];

const rest = async (key, url, init = {}) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${url}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  // `return=minimal` answers 201 with an empty body, so status alone is not
  // enough to decide whether there is any JSON to read.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const upsert = (key, table, body, onConflict) =>
  rest(key, `${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      Prefer: `resolution=merge-duplicates,return=minimal`,
    },
  });

const ago = (days) =>
  new Date(Date.now() - days * 86400000).toISOString();

export async function stage(key) {
  // Points for the "Watch these points" chips, read rather than hardcoded:
  // a finding pointing at a deleted point is a chip that goes nowhere.
  const points = await rest(
    key,
    `points?match_id=eq.${MATCH}&deleted=is.false&select=id,idx&order=idx&offset=22&limit=4`
  );
  if (points.length < 4) throw new Error("not enough points to link findings to");

  await upsert(
    key,
    "coach_profiles",
    {
      user_id: COACH,
      handle: "danhollis",
      display_name: "Dan Hollis",
      headline: "National league coach",
      bio: "Twenty years in the national leagues, and a decade coaching players who work full time and train twice a week. Most of what I look for is patterns you cannot see from inside the match.",
      credentials: ["National league player", "Level 2 coach"],
      charges_enabled: true,
      payouts_enabled: true,
      accepting_orders: true,
      published: true,
    },
    "user_id"
  );

  await upsert(
    key,
    "offerings",
    {
      id: OFFERING,
      coach_id: COACH,
      template_key: "full_match",
      title: "Full match review",
      description:
        "A game by game read of one scored match, with the points that decided it and something to take into the next two weeks of training.",
      includes: [
        "Every game reviewed",
        "What is costing you points",
        "Selected points to rewatch",
        "A practice plan",
        "One round of follow up questions",
      ],
      price_cents: 5000,
      turnaround_days: 5,
      followup_rounds: 1,
      review_sections: SECTIONS,
      active: true,
    },
    "id"
  );

  await upsert(
    key,
    "review_orders",
    {
      id: REVIEW_ORDER,
      offering_id: OFFERING,
      coach_id: COACH,
      student_id: STUDENT,
      match_id: MATCH,
      status: "completed",
      // fee_cents + coach_share_cents must equal price_cents.
      price_cents: 5000,
      fee_mode: "percent",
      fee_cents: 750,
      coach_share_cents: 4250,
      turnaround_days: 5,
      followup_rounds: 1,
      review_sections: SECTIONS,
      intake_answers: [
        {
          id: "focus",
          label: "Anything you want me to look at?",
          answer:
            "I keep losing the close games. Not sure if it is nerves or something I am actually doing.",
        },
      ],
      promised_by: ago(2),
      paid_at: ago(7),
      submitted_at: ago(7),
      accepted_at: ago(6),
      delivered_at: ago(3),
      completed_at: ago(2),
      created_at: ago(7),
    },
    "id"
  );

  await upsert(
    key,
    "review_documents",
    {
      order_id: REVIEW_ORDER,
      status: "delivered",
      sections: [
        {
          key: "summary",
          label: "Summary",
          body: "You won the rallies you started with spin and lost the ones you started flat. The match turned on four deuce points, and three of them ended the same way: a flat backhand open into the pips, a dead ball back, and a rushed third ball.\n\nGame two is the one to keep. You were 6-3 down, went back to the heavy backhand serve, and took six of the next eight.",
        },
        {
          key: "costing_points",
          label: "What is costing you points",
          body: "Flat openings against the pips, and it is worse the closer the game gets. At 8-8 in games two and four you opened flat both times and lost the point inside three balls.\n\nThe second thing is smaller but it is free: you are stepping around before the ball has bounced on your side. When the serve comes long you are already committed and the backhand has nowhere to go.",
        },
        {
          key: "practice_plan",
          label: "Practice plan",
          body: "Two weeks. Fifteen minutes a session of slow, high spin backhand openings against a blocker. Count ten in a row on the table before you raise the pace.\n\nThen five minutes of serve and third ball where you are not allowed to step around at all. It will feel slow. That is the point.",
        },
      ],
    },
    "order_id"
  );

  await upsert(
    key,
    "review_findings",
    [
      {
        id: FINDINGS[0],
        order_id: REVIEW_ORDER,
        title: "Backhand opens too flat at deuce",
        body: "Both of these are 8-8. Same shot, same result: the ball sits up, comes back dead, and you have to invent something on the third ball.",
        sort: 0,
      },
      {
        id: FINDINGS[1],
        order_id: REVIEW_ORDER,
        title: "The serve that turned game two",
        body: "Heavy backhand serve into the elbow. You went back to it at 6-3 down and it won you four points in eight. Worth being your first choice when you are behind, not your last.",
        sort: 1,
      },
    ],
    "id"
  );

  await upsert(
    key,
    "review_finding_points",
    [
      { finding_id: FINDINGS[0], point_id: points[0].id },
      { finding_id: FINDINGS[0], point_id: points[2].id },
      { finding_id: FINDINGS[1], point_id: points[1].id },
      { finding_id: FINDINGS[1], point_id: points[3].id },
    ],
    "finding_id,point_id"
  );
}

export async function cleanup(key) {
  const ids = `in.(${FINDINGS.join(",")})`;
  await rest(key, `review_finding_points?finding_id=${ids}`, { method: "DELETE" });
  await rest(key, `review_findings?id=${ids}`, { method: "DELETE" });
  await rest(key, `review_documents?order_id=eq.${REVIEW_ORDER}`, { method: "DELETE" });
  await rest(key, `review_messages?order_id=eq.${REVIEW_ORDER}`, { method: "DELETE" });
  await rest(key, `review_orders?id=eq.${REVIEW_ORDER}`, { method: "DELETE" });
  await rest(key, `offerings?id=eq.${OFFERING}`, { method: "DELETE" });
  await rest(key, `coach_profiles?user_id=eq.${COACH}`, { method: "DELETE" });
}
