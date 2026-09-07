import { betaInvitationEmail } from "../../src/lib/email/catalog.ts";
import { renderEmail } from "../../src/lib/email/render.ts";

const url = "https://testflight.apple.com/join/H9XdnySg";
export const betaInvitationPreviews = [
  { id: "player", role: "player", interests: ["iphone_recording", "point_review", "match_progress", "lesson_audio"] },
  { id: "coach", role: "coach", interests: ["coach_students", "coach_lesson_recording", "coach_shared_journal", "coach_review_orders"] },
  { id: "both", role: "both", interests: ["video_library", "placement_maps", "coach_profile", "coach_match_feedback"] },
].map(({id, ...preferences}) => ({id, ...renderEmail(betaInvitationEmail(url, preferences))}));
