export type BetaRole = "player" | "coach" | "both";

export type BetaAnswers = {
  formVersion: 2;
  role: BetaRole;
  interests: string[];
  feedback: string[];
};

type QuestionnaireOption = Readonly<{
  value: string;
  label: string;
}>;

export const PLAYER_INTERESTS: readonly QuestionnaireOption[] = [
  { value: "iphone_recording", label: "Recording matches on my iPhone" },
  { value: "video_library", label: "Keeping my table tennis videos in one dedicated library" },
  { value: "point_review", label: "Watching every point without the breaks between rallies" },
  { value: "match_progress", label: "Tracking my match results, statistics and progress over time" },
  { value: "placement_maps", label: "Understanding my placement patterns with ball placement maps" },
  { value: "professional_review", label: "Getting a professional coach to review my match" },
  { value: "friends_family_sharing", label: "Sharing my matches with friends and family" },
  { value: "coach_sharing", label: "Sharing my matches with my coach" },
  { value: "highlight_export", label: "Exporting points and highlights for social media" },
  { value: "lesson_audio", label: "Recording audio of my lessons to revisit my coach’s advice" },
  { value: "training_journal", label: "Keeping a training journal of notes from matches and lessons" },
  { value: "journal_questions", label: "Searching and asking questions about my journal" },
];

export const COACH_INTERESTS: readonly QuestionnaireOption[] = [
  { value: "coach_students", label: "Keeping my students and their coaching history in one place" },
  { value: "coach_lesson_recording", label: "Recording lessons as audio or video" },
  { value: "coach_shared_journal", label: "Sharing lesson notes and training journals with students" },
  { value: "coach_match_feedback", label: "Reviewing my students’ matches and giving feedback on specific points" },
  { value: "coach_profile", label: "Building a coach profile players can find and share" },
  { value: "coach_review_orders", label: "Receiving and managing paid match review requests" },
];

export const FEEDBACK_OPTIONS: readonly QuestionnaireOption[] = [
  { value: "email", label: "Email" },
  { value: "audio_call", label: "Audio call" },
  { value: "video_call", label: "Video call" },
  { value: "not_now", label: "Not right now" },
];

const BOTH_INTERESTS = [...PLAYER_INTERESTS, ...COACH_INTERESTS];

export function optionsForRole(
  role: BetaRole,
): readonly QuestionnaireOption[] {
  if (role === "player") return PLAYER_INTERESTS;
  if (role === "coach") return COACH_INTERESTS;
  return BOTH_INTERESTS;
}

function isUniqueStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string")
    && new Set(value).size === value.length;
}

export function parseBetaAnswers(value: unknown): BetaAnswers | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (candidate.formVersion !== 2) return null;
  if (candidate.role !== "player" && candidate.role !== "coach" && candidate.role !== "both") return null;
  if (!isUniqueStringArray(candidate.interests) || candidate.interests.length === 0) return null;
  if (!isUniqueStringArray(candidate.feedback)) return null;

  const allowedInterests = new Set(
    optionsForRole(candidate.role).map((option) => option.value),
  );
  if (candidate.interests.some((interest) => !allowedInterests.has(interest))) return null;

  const allowedFeedback = new Set(
    FEEDBACK_OPTIONS.map((option) => option.value),
  );
  if (candidate.feedback.some((choice) => !allowedFeedback.has(choice))) return null;
  if (candidate.feedback.includes("not_now") && candidate.feedback.length !== 1) return null;

  return {
    formVersion: 2,
    role: candidate.role,
    interests: [...candidate.interests],
    feedback: [...candidate.feedback],
  };
}
