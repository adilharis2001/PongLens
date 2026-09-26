// The ".js" is for node --test: Next has no exports map, so bare Node ESM
// cannot resolve "next/server" and the pure age helpers below could not
// be tested. Bundler and TypeScript resolve both spellings the same way.
import { NextResponse } from "next/server.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consent, age and permission checks shared by the routes and the pages.
 * Spec: docs/superpowers/specs/2026-09-14-minors-consent-and-flags-design.md
 *
 * Three facts live on player_profiles and one in player_birthdates:
 *
 *   terms_accepted_at    the "Agree and continue" tap on the first onboarding
 *                        screen. Existing rows were backfilled ('legacy').
 *   ai_features_enabled  the AI features sheet. null = never asked (or not
 *                        asked since its wording last changed), false =
 *                        switched off in Account. Since 2026-09-26 it also
 *                        covers the frame checks on every match, so
 *                        recording and uploading need it.
 *   upload_confirmed_at  the old first-upload checkbox. No longer asked or
 *                        checked (2026-09-26): its promise is in the Terms.
 *                        Kept as the record of who ticked it.
 *   birth_year/month     owner-only table; used once, for the age check.
 *
 * Routes call the require* helpers at the top and return the response they
 * hand back. Clients treat the 403 body as "show the sheet, then retry".
 */

export const MINIMUM_AGE = 13;
export const MINIMUM_AGE_EEA = 16;

/** EEA member states (EU 27 plus Iceland, Liechtenstein, Norway). The UK is
 *  13, so it is deliberately not here. */
export const EEA_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO",
]);

export function minimumAgeForCountry(country: string | null | undefined): number {
  const code = (country ?? "").trim().toUpperCase();
  return EEA_COUNTRIES.has(code) ? MINIMUM_AGE_EEA : MINIMUM_AGE;
}

/** Whole years lived, counting a birthday as the first of its month. A player
 *  born in September 2013 is 13 from 1 September 2026. */
export function ageInYears(
  birthYear: number,
  birthMonth: number,
  now: Date = new Date(),
): number {
  let years = now.getUTCFullYear() - birthYear;
  if (now.getUTCMonth() + 1 < birthMonth) years -= 1;
  return years;
}

export function isUnderAge(
  birthYear: number,
  birthMonth: number,
  country: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return ageInYears(birthYear, birthMonth, now) < minimumAgeForCountry(country);
}

export type ConsentState = {
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  aiFeaturesEnabled: boolean | null;
  uploadConfirmedAt: string | null;
};

export async function readConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConsentState> {
  const { data } = await supabase
    .from("player_profiles")
    .select("terms_accepted_at, terms_version, ai_features_enabled, upload_confirmed_at")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    termsAcceptedAt: data?.terms_accepted_at ?? null,
    termsVersion: data?.terms_version ?? null,
    aiFeaturesEnabled: data?.ai_features_enabled ?? null,
    uploadConfirmedAt: data?.upload_confirmed_at ?? null,
  };
}

export type ConsentRequirement = "terms" | "ai_consent";

function denied(reason: ConsentRequirement) {
  return NextResponse.json({ error: `${reason}_required` }, { status: 403 });
}

/** The terms must be accepted before the account does anything that
 *  creates content. Backfilled rows pass. */
export async function requireTerms(supabase: SupabaseClient, userId: string) {
  const state = await readConsent(supabase, userId);
  return state.termsAcceptedAt ? null : denied("terms");
}

/** Anything that sends the user's content to OpenAI or Deepgram, which
 *  includes starting an upload: every uploaded match has frames checked
 *  by OpenAI. A null (never asked) and a false (switched off) both stop
 *  here. */
export async function requireAiConsent(supabase: SupabaseClient, userId: string) {
  const state = await readConsent(supabase, userId);
  return state.aiFeaturesEnabled === true ? null : denied("ai_consent");
}

/** Starting an upload (the two upload routes' create step): the terms,
 *  which carry the promise that the uploader has the right to upload the
 *  video, and the AI features permission. The later steps of an upload
 *  already under way check only the terms, so switching the permission
 *  off does not strand a video half sent. */
export async function requireUploadConsent(
  supabase: SupabaseClient,
  userId: string,
) {
  const state = await readConsent(supabase, userId);
  if (!state.termsAcceptedAt) return denied("terms");
  return state.aiFeaturesEnabled === true ? null : denied("ai_consent");
}
