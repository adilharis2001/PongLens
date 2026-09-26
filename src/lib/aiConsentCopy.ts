/**
 * The AI features sheet's two paragraphs, shown on the web
 * (src/components/AiConsentSheet.tsx) and, word for word, on the iPhone
 * (ios/.../Components/AiConsentSheet.swift). aiConsentCopy.test.ts fails
 * when the two drift apart.
 *
 * Since 2026-09-26 the sheet also covers the frame checks OpenAI runs on
 * every match, so recording and uploading need it. A change here that
 * asks for something new also needs a fresh answer from everyone who
 * allowed the old wording: bump app_config.ai_consent_version and clear
 * ai_features_enabled on rows stamped with an older one (see migration
 * 20260926200000).
 */
export const AI_CONSENT_COPY = [
  "PongLens sends some of your content to two companies so they can do their job. OpenAI checks still frames from each match you record or upload, to confirm it is table tennis and to find the table. It also reads notes, photos and lesson transcripts to write summaries, answer questions in Ask and tidy rough entries. Deepgram turns voice notes into text. Neither company may use your content to train its models.",
  "Recording and uploading matches need this. You can switch it off any time in Account.",
] as const;
