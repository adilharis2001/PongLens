import assert from "node:assert/strict";
import test from "node:test";
import { detectLanguage } from "./language.mjs";

// The exact strings the first version got wrong: its Portuguese matcher
// included the bare word "a", so ordinary English came back as pt and the
// page's English filter hid real English speakers.
test("English bios are English, including the ones that broke this before", () => {
  for (const bio of [
    "Table tennis coach and a former national player",
    "I run a club for juniors",
    "ITTF Level 3 Coach. Pro Table Tennis Tips",
    "Coaching players worldwide, ex-international player",
    "🏓 Table Tennis Coach & Mentor. Building champions for sport and life",
    "DM for Promotion & Paid Partnership",
  ]) {
    assert.equal(detectLanguage(bio), "en", bio);
  }
});

test("a marker is never a word English also uses", () => {
  // Each of these was a marker in the first version and is ordinary English.
  for (const bio of [
    "a coach",
    "per session bookings",
    "the con of playing defensive",
    "you die by the serve you live by",
    "reach me at coach@example.com",
    "e sports and table tennis",
  ]) {
    assert.equal(detectLanguage(bio), "en", bio);
  }
});

test("the sport named in a language outweighs stray words", () => {
  assert.equal(detectLanguage("Tischtennis Trainer in Salzburg"), "de");
  assert.equal(detectLanguage("Entraîneur de tennis de table à Paris"), "fr");
  assert.equal(detectLanguage("Entrenador de tenis de mesa"), "es");
  assert.equal(detectLanguage("Treinador de ténis de mesa"), "pt");
  assert.equal(detectLanguage("Allenatore di tennistavolo"), "it");
  assert.equal(detectLanguage("Trener tenisa stołowego"), "pl");
  assert.equal(detectLanguage("Masa tenisi antrenörü"), "tr");
  assert.equal(detectLanguage("Tafeltennis vereniging jeugd"), "nl");
});

test("a non-Latin script settles it on its own", () => {
  assert.equal(detectLanguage("ТРЕНЕР ПО НАСТОЛЬНОМУ ТЕННИСУ • МОСКВА"), "ru");
  assert.equal(detectLanguage("卓球コーチ"), "ja");
  assert.equal(detectLanguage("桌球教練"), "zh");
  assert.equal(detectLanguage("مدرب كرة الطاولة"), "ar");
  assert.equal(detectLanguage("סמי יצחק"), "he");
});

test("a bilingual bio follows the sport term, not the stray English", () => {
  assert.equal(
    detectLanguage("Tischtennis Trainer. Book a session with me today"),
    "de",
  );
});

test("empty text has no language rather than a wrong one", () => {
  assert.equal(detectLanguage(""), null);
  assert.equal(detectLanguage("   "), null);
  assert.equal(detectLanguage(null), null);
  assert.equal(detectLanguage("🏓🏓🏓"), null);
});
