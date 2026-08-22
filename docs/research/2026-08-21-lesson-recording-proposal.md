# Recording a lesson: proposal

Written 2026-08-21. Nothing built yet. This is the plan to build against.

The job: a player puts their phone near the table, their coach talks for
one to two hours, and afterwards they have lesson notes in their journal
without touching another app.

## Two facts that decide the design

Everything below follows from these, so they come first.

**AVAudioRecorder stops recording at around 90 minutes in the background,
silently.** No error, no notification. A 90-minute lesson is the middle of
our range, not the edge of it. That alone disqualifies the obvious choice.

**AVAudioRecorder also loses everything recorded before an interruption.**
The documented behaviour is that after a phone call the recorder resumes
fine and saves only what came after. An hour of coaching, gone, with the
UI showing success.

So the simple API is out. We use `AVAudioEngine` with a tap, which is more
work and has its own trap: recreating the engine during interruption
recovery crashes. The fix is to reuse the same engine instance and
reconnect the graph rather than build a new one.

## What the reference apps do

**Granola** captures audio, transcribes it, and then deletes the raw audio
— nothing is stored remotely. Recording is started manually, never
automatically. Their product insight is that the notes you get are the
model's summary merged with what you typed yourself.

**Apple** ships `SpeechAnalyzer` in iOS 26 for exactly this shape of
problem: lectures and meetings, on-device, no session length limit. It is
what Notes and Voice Memos use. Critically it transcribes **files** as
well as live microphone input, via `analyzeSequence(from:)`.

That last detail is the one that shapes our pipeline.

## The architecture

**Record into segments, not one file.** A rolling five-minute AAC mono
segment at ~32 kbps, so a two-hour lesson is roughly 24 files totalling
~30 MB. Segments are written to `Documents`, never `tmp`.

Why segments:

- A crash, a kill, or a battery death costs one segment, not the lesson.
- Each segment can be transcribed the moment it closes, so at the end you
  are one segment behind rather than two hours behind.
- They are the natural unit for the upload fallback too.

**Transcribe per segment, not live.** When a segment closes, hand it to
`SpeechAnalyzer` as a file. This decouples the fragile part (two hours of
capture) from the expensive part (transcription): a transcription failure
is retryable from the file without asking anyone to redo a lesson, and the
neural engine runs in bursts rather than for two hours straight.

**Two tiers meeting at the segment:**

| Tier | Devices | How |
| --- | --- | --- |
| On-device | iPhone 12 and later | `SpeechAnalyzer` on each closed segment. Free, private, works offline. |
| Server | iPhone 11, SE 2, or any on-device failure | Segment uploads to R2 through the existing background queue, Deepgram transcribes. |

The tiers converge on one string per segment. Everything downstream —
joining the segments, distilling with `gpt-5.6-luna`, writing the journal
entry, Recollect — is identical and knows nothing about which tier ran.
One seam, not two pipelines.

The server tier is not a concession to old phones. It is the retry path
you need anyway: the locale asset may not have downloaded, the language
may be unsupported, on-device can fail mid-lesson. Once it exists, serving
four old device models with it costs nothing.

**Distil with map-reduce.** A two-hour transcript is roughly four times
the largest thing measured in the 2026-08-21 bake-off. Distil each
10-15 minute window with the existing `/api/lesson` prompt as the map
step, then merge into the existing `{title, themes[{name, points[]}]}`
shape. Coaches repeat themselves across a session, so the merge is doing
real work. This has to run in the worker, not in a request — it will
exceed the 60-second route limit.

**Never POST the audio through a Next route.** Vercel caps function
request bodies at 4.5 MB. Presigned PUT to R2, the same pattern as the
QA attachment fix.

## What we keep

Follow Granola: **delete the audio once the transcript exists.** Journal
entries already keep only text. Keep segments locally until the notes are
saved, then remove them. If someone later asks to keep recordings, that is
an additive change, and it is a much easier conversation than explaining
why we kept two hours of their coach's voice by default.

The privacy line "your coach's voice never leaves your phone" is true only
on the on-device tier. It must not appear on the server tier.

## The UI

**Before starting.** One card with the placement instruction, plus a check
on free space and battery — two hours is a real ask of both.

**While recording.** Almost nothing: large monospaced elapsed time, a live
input level so they can see it is hearing the coach, and Stop. Pause as a
secondary control, because lessons have breaks. No scrolling transcript;
watching speech-to-text errors go by invites reading them instead of
playing.

**The screen will be locked for most of it**, so this needs a Live
Activity with elapsed time and a stop control, and the `audio` background
mode, which is not currently in `Info.plist`.

**After stopping**, reuse the skeleton loading state. On-device it is
seconds, because most segments are already done. On the server tier it is
the match-processing pattern: leave, get notified.

**Then land in the existing composer**, prefilled, so they can edit before
saving. That reuses everything already built.

Copy, in house style:

- "Put your phone near the net, screen down. Start when the lesson starts."
- "Recording. You can lock your phone."
- "Writing up your lesson."

## Build order

1. Recording screen, background audio mode, Live Activity, segmented
   capture with interruption handling. Both tiers need this and it is the
   part with the real hazards.
2. Server tier. Mostly wired already, and it is the path that cannot be
   skipped. Ship to everyone.
3. On-device tier as the fast path, after measuring battery across a real
   two-hour lesson on an iPhone 12 — the oldest capable device, not a
   17 Pro.
4. Map-reduce distillation.

## Risks and open questions

- **Battery and thermals** over two hours. Measure before promising.
- **Check `isAvailable` and `supportedLocales` at runtime**, never infer
  from device model, and fall back silently rather than erroring.
- **Locale assets download on first use.** Do it before the lesson, not at
  the moment someone taps record in a club.
- **Vocabulary.** "Chiquita", "banana flick", "long pip" are exactly what
  general models mangle. Deepgram takes keyword boosting; SpeechTranscriber
  takes contextual strings. Use both.
- **Metering.** Is the server tier charged against processing minutes or
  absorbed? Recommend absorbing and watching: it is a shrinking set of
  devices, and charging people for owning an older phone buys support
  conversations we do not want.

## Sources

- [SpeechAnalyzer / SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)
- [WWDC25: Bring advanced speech-to-text to your app](https://developer.apple.com/videos/play/wwdc2025/277/)
- [AVAudioRecorder stops after ~90 minutes in background](https://developer.apple.com/forums/thread/691589)
- [AVAudioRecorder loses audio recorded before an interruption](https://developer.apple.com/forums/thread/781778)
- [AVAudioEngine interruption-recovery crash and the reuse fix](https://github.com/software-mansion/react-native-audio-api/issues/1013)
- [Granola: how transcription works](https://docs.granola.ai/help-center/taking-notes/transcription)
- [Granola: local-first vs cloud](https://www.granola.ai/blog/local-first-ai-notetaker-vs-cloud)
