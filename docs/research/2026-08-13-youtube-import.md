# YouTube import — what broke, what shipped, and whether to keep it

2026-08-13. Written after an import failed and the failure turned out to
be worth understanding properly.

## What broke

An import died with `unable to download video data: HTTP Error 403:
Forbidden`. Diagnosis, in order:

- **Not the IP, not the account.** The webpage and player API both loaded;
  format selection worked.
- **Not a stale yt-dlp.** 2026.07.04 was the current release.
- **Not the video being unlisted.** Audio-only (9.5 MB) downloaded fine.
- **Not a hard byte cap.** The 720p rendition (70 MB) completed at
  191 MB/s.
- 1080p failed three times in a row at the same ~10 MB offset, with and
  without `--http-chunk-size`, while alternative player clients
  (tv / ios / web_safari) no longer offer 1080p at all.
- **An hour later 1080p downloaded in full (141 MB).**

So it is **intermittent refusal**, most likely rate limiting — the larger
rendition is simply exposed to it for longer. An earlier draft of this
note called it 1080p-specific gating; that was wrong and the code comment
was corrected.

## What shipped

`51053fa2` — a height ladder in `worker/worker.py`. The download walks
**1080 → 720 → 480**, retrying only on a cut-off stream
(`_stream_refused`); private, age-restricted and members-only videos still
fail immediately with their existing message. Each attempt clears the
previous one's partial files. Seven tests in
`worker/tests/test_youtube_height_ladder.py`; verified end to end against
the video that failed.

This keeps the feature alive. It is a stay of execution, not a fix.

## Whether to keep the feature at all

Researched 2026-08-13. Not legal advice.

**Legal and allowed are different questions, and only one is in our
favour.** If the user filmed and uploaded the match they own the
copyright, so no rights-holder is harmed — there is no infringement
claim. But YouTube's [Terms of Service](https://www.youtube.com/t/terms)
(eff. 2023-12-15) bar downloading "any Content" and bar automated access,
and their definition of Content **explicitly includes material "provided
by you"**. No owner carve-out; the older "as permitted by applicable law"
exception is gone from the current US text. The Data API has no download
endpoint. So: not infringement, plainly a **contract breach**. The
template is *hiQ v. LinkedIn* — no hacking-law violation, still a $500k
judgment for breaching terms.

Risks, ranked by expected harm rather than by how alarming they sound:

| risk | likelihood | cost |
|---|---|---|
| Silent breakage (PO tokens, bot checks, format gating) | already happening | paid imports fail, support load |
| Permanent maintenance treadmill on YouTube's schedule | certain | unscheduled on-call, forever, for 23 imports |
| **Worse CV accuracy than the source file** | high | we ingest a lossy re-encode of the file already on the user's phone, then ask a tracker to find a 40mm ball in it |
| **The public repo advertises the yt-dlp path** | certain | free discovery for anyone looking |
| C&D or host-level IP ban | low | feature dies overnight |
| DMCA §1201 circumvention | low, and **not cured by user ownership** | *Yout* pending in the 2nd Circuit; recent rulings trend against |
| YouTube suing us | very low | no precedent against a product processing users' own footage |

The two nobody asked about — quality and repo visibility — outrank most of
the ones that prompted the question.

**Scale does not change the legal position.** The breach is identical at 3
users and at 100. What changes is failure volume (linear) and blocking
(superlinear — it is per-IP, so users share one reputation). C&D
thresholds are Vanced/Invidious-level visibility, which 100 users does not
approach. Reliability and quality are the reasons to act, not scale.

## Recommendation

**Change the feature.** Not urgent, not ignorable.

1. Remove the YouTube URL field from the import flow. Hudl, Veo,
   SwingVision and CoachNow all require direct upload; Coach's Eye shipped
   YouTube import and removed it.
2. Replace with "paste a direct MP4 / Drive / Dropbox link" — same
   ergonomics, no hostile terms. Needs an SSRF allowlist.
3. Tell the three affected users: YouTube Studio only returns 720p/360p,
   so their original phone file is strictly better input.
4. **Do not** add cookies or a burner Google account. That trades a quiet
   contract question for an account ban, and for a bad-faith posture if it
   ever matters.

Usage at the time of writing: 23 imports, 3 users, 20 succeeded.
