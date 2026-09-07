import { PLAYER_INTERESTS, COACH_INTERESTS } from "../iosBeta/questionnaire.ts";
import type { EmailBlock } from "./message.ts";

export type BetaInvitationPreferences = { role?: string | null; interests?: readonly string[] | null };

const COPY: Record<string, string> = {
  iphone_recording: "Record a match on your iPhone.",
  video_library: "Keep your table tennis videos in one dedicated library.",
  point_review: "Watch every point without the breaks between rallies.",
  match_progress: "Track your match results, statistics and progress over time.",
  placement_maps: "Explore your placement patterns on the map.",
  professional_review: "Get a professional coach to review your match.",
  friends_family_sharing: "Share your matches with friends and family.",
  coach_sharing: "Share a match with your coach for feedback.",
  highlight_export: "Export points and highlights for social media.",
  lesson_audio: "Record a lesson and revisit your coach’s advice.",
  training_journal: "Keep notes from your matches and lessons in a training journal.",
  journal_questions: "Search your journal and ask questions about your notes.",
  coach_students: "Keep your students and coaching history together.",
  coach_lesson_recording: "Record your lessons as audio or video.",
  coach_shared_journal: "Share lesson notes and training journals with your students.",
  coach_match_feedback: "Review a student’s match and leave feedback on specific points.",
  coach_profile: "Create a coach profile players can find and share.",
  coach_review_orders: "Set up paid match reviews and manage incoming requests.",
};

export function betaFeatureBlocks(preferences: BetaInvitationPreferences = {}): EmailBlock[] {
  const role = preferences.role;
  const player = role !== "coach";
  const coach = role === "coach" || role === "both";
  const groups = [
    ...(player ? [{ options: PLAYER_INTERESTS, heading: "Try these player features" }] : []),
    ...(coach ? [{ options: COACH_INTERESTS, heading: "Try these coach features" }] : []),
  ];
  const selected = new Set(preferences.interests ?? []);
  const blocks: EmailBlock[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    const values = group.options.filter(o => selected.has(o.value) && COPY[o.value]).map(o => o.value);
    if (!values.length) continue;
    values.forEach(value => used.add(value));
    blocks.push({ type: "bullets", heading: role === "both" ? group.heading : "Try the features you selected", items: values.map(value => COPY[value]) });
  }
  // A few additional ideas, not another full catalog. Interleave roles so
  // people who play and coach can discover a feature from either side.
  const starters = role === "coach"
    ? ["coach_students", "coach_shared_journal", "coach_match_feedback"]
    : role === "both"
      ? ["point_review", "coach_students", "training_journal", "coach_shared_journal"]
      : ["iphone_recording", "point_review", "training_journal", "match_progress"];
  const candidates = [...new Set([...starters, ...groups.flatMap(group => group.options.map(o => o.value))])];
  const extras = candidates.filter(value => !used.has(value) && COPY[value]).slice(0, 3);
  if (extras.length) blocks.push({ type: "bullets", heading: used.size ? "You can also try" : "Start with these features", items: extras.map(value => COPY[value]) });
  return blocks;
}
