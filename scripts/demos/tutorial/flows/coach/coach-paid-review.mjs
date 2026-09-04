import { account, coachGuard, REVIEW_ORDER_ID, makeRun } from "./shared.mjs";

export { account };
// Enter through a read-only coach route so capture can install the request
// guard before Orders mounts. Both Orders and the coach Home run a sweep on
// mount; that housekeeping can complete orders, release payouts, and send
// queued email, none of which belongs in a tutorial capture.
export const entry = "/coaching/students";
export const guard = coachGuard([
  "coach_profiles",
  "offerings",
  "review_orders",
  "review_findings",
  "review_attachments",
]);

export async function prepare(page) {
  await page.route("**/api/reviews/transition", async (route) => {
    const request = route.request();
    let action = null;
    if (request.method() === "POST") {
      try {
        action = request.postDataJSON()?.action ?? null;
      } catch {
        // A malformed/non-JSON transition is not the automatic sweep. Let
        // the shipping endpoint handle it normally instead of broadening
        // this narrowly scoped capture guard.
      }
    }
    if (action === "sweep") {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

export const scenes = [
  { beat: "reviews", route: "/coaching/orders", waitFor: { text: "Orders", tag: "h1" }, target: { text: "Orders", tag: "h1" }, label: "Optional paid reviews on web" },
  { beat: "offering", target: { text: "Offerings", tag: "a" }, label: "Your page and offerings" },
  { beat: "order-request", target: { text: "Your move", tag: "h2" }, label: "The player's request" },
  { beat: "accept", target: { text: "New order", tag: "p" }, label: "You choose when to accept" },
  { beat: "findings", route: `/coaching/orders/${REVIEW_ORDER_ID}`, waitFor: { text: "The points", tag: "h2" }, target: { text: "The points", tag: "h2" }, label: "Findings tied to rallies" },
  { beat: "deliverables", target: { text: "Your write-up", tag: "h2" }, label: "Write-up and attachments" },
  { beat: "deliver", target: { text: "Deliver the review", tag: "button" }, label: "Deliver through PongLens" },
  { beat: "payment", route: "/coaching/orders", waitFor: { text: "Payouts", tag: "h2" }, target: { text: "Payouts", tag: "h2" }, label: "Payment and payout status" },
];

export const run = makeRun(scenes);
export const flow = run;
