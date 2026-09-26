/**
 * The AI features sheet's two paragraphs, shown on the web
 * (src/components/AiConsentSheet.tsx) and, word for word, on the iPhone
 * (ios/.../Components/AiConsentSheet.swift). aiConsentCopy.test.ts fails
 * when the two drift apart.
 *
 * The short form Adil approved on 2026-09-15 (commit f6bc6d6b, which never
 * shipped on its own), with the match-frame sentence in front of it. Since
 * 2026-09-26 the sheet also covers the frame checks OpenAI runs on every
 * match, so recording and uploading need it. A change here that
 * asks for something new also needs a fresh answer from everyone who
 * allowed the old wording: bump app_config.ai_consent_version and clear
 * ai_features_enabled on rows stamped with an older one (see migration
 * 20260926200000).
 */
export const AI_CONSENT_COPY = [
  "OpenAI checks still frames from each match you record or upload, to confirm it is table tennis and to find the table. It also reads notes, photos and lesson recordings for summaries, Ask and Improve with AI. Deepgram turns voice notes into text. Neither may use your content to train its models.",
  "Recording and uploading matches need this. Switch it off any time in Account.",
] as const;
