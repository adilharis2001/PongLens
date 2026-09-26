/**
 * The AI features sheet's two paragraphs, shown on the web
 * (src/components/AiConsentSheet.tsx) and, word for word, on the iPhone
 * (ios/.../Components/AiConsentSheet.swift). aiConsentCopy.test.ts fails
 * when the two drift apart.
 *
 * Adil's wording, 2026-09-26: say why data is shared before what each
 * company does with it, and describe what happens rather than naming
 * features ("answer your questions", not "Ask"), because a new player
 * does not know the feature names yet. Since 2026-09-26 the sheet also
 * covers the frame checks OpenAI runs on every match, so recording and uploading need it. A change here that
 * asks for something new also needs a fresh answer from everyone who
 * allowed the old wording: bump app_config.ai_consent_version and clear
 * ai_features_enabled on rows stamped with an older one (see migration
 * 20260926200000).
 */
export const AI_CONSENT_COPY = [
  "PongLens shares some of your data with two companies that help run the app. OpenAI looks at still frames from each match you record or upload, to confirm it is table tennis and to find the table. It also reads your notes, photos and lesson recordings to write summaries, answer your questions and tidy up what you write. Deepgram turns your voice notes into text.",
  "Neither company may train its models on your data. Recording and uploading matches need this. You can switch it off any time in Account.",
] as const;
