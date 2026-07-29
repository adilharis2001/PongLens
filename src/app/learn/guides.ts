/**
 * The Learn hub's content. Every guide is plain data: the index and the
 * article pages render from here, and search walks the same text, so a
 * guide edited in this file is updated everywhere at once.
 *
 * Screenshots come from the same generated sets the showcase uses:
 * public/showcase/* (scripts/demos/shots.mjs) plus public/learn/*
 * (scripts/demos/learn_shots.mjs), both captured against the staged demo
 * account. Re-run those scripts after UI changes and the guides update
 * themselves.
 *
 * Copy rules (same as everywhere): simple and direct, no hype. The
 * processing is "PongLens" doing something, described plainly.
 */

export interface GuideImage {
  /** Path under public/, e.g. "/showcase/upload-d.jpg". */
  src: string;
  alt: string;
  /** m = phone capture, d = desktop capture. */
  kind: "m" | "d";
  /** Repeats the section's desktop shot, so it only shows on phones. */
  phoneTwin?: boolean;
}

export interface GuideSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  /** A quiet callout for the gotcha worth knowing. */
  tip?: string;
  images?: GuideImage[];
}

export interface Guide {
  slug: string;
  title: string;
  /** One line under the title, and the index card's description. */
  summary: string;
  group: string;
  sections: GuideSection[];
  /** Slugs of guides worth reading next. */
  related?: string[];
}

export const GROUPS = [
  "Get started",
  "Review and score",
  "Your game",
  "Share and export",
  "For coaches",
] as const;

export const guides: Guide[] = [
  // ---------------------------------------------------------- Get started
  {
    slug: "upload-a-video",
    title: "Upload a match video",
    summary: "Get a match from your phone or laptop into PongLens.",
    group: "Get started",
    related: ["upload-from-youtube", "match-viewer"],
    sections: [
      {
        paragraphs: [
          "Tap the Upload button on Home or Matches. It opens the upload page, where you pick a video file or paste a YouTube link instead.",
          "PongLens takes .mp4 and .mov files up to 2 GB. 1080p is plenty; a higher resolution mostly makes the upload slower.",
          "The upload starts the moment you choose the file. Fill in the details while it runs.",
        ],
        images: [
          { src: "/showcase/upload-d.jpg", alt: "The upload page on desktop", kind: "d" },
          {
            src: "/showcase/upload-m.jpg",
            alt: "The upload page on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Film it so it processes well",
        paragraphs: [
          "Put the camera behind one end of the table, a little above head height, with the whole table in frame. The upload page has a short guide with a diagram under How to record.",
        ],
      },
      {
        heading: "Pick your options",
        bullets: [
          "Opponent, venue and match type are optional. They name the match in your library.",
          "Points is on by default: PongLens removes the dead time and cuts the video into one clip per point.",
          "Placement also tracks where the ball lands, so the match gets placement maps.",
          "Strictness sets how aggressively dead time gets trimmed. Normal suits most matches; Loose keeps more footage around each point.",
          "Your side records which end you played from, so scoring and maps know which player is you.",
        ],
      },
      {
        heading: "Uploading from an iPhone",
        paragraphs: [
          "If a video lives in iCloud (Photos set to Optimize iPhone Storage), your phone has to download the original before the upload can start. That wait happens inside the photo picker and can take a few minutes for a long match. Keep the screen on and stay on Wi-Fi; once the upload itself starts you will see the progress bar move.",
        ],
        tip: "Android does the same when a video is backed up in Google Photos but no longer on the device. If the picker hangs, open the video in Google Photos, download it to the device, then upload.",
      },
      {
        heading: "While it uploads",
        paragraphs: [
          "Stay on the page until the upload finishes. If the connection drops, come back to the upload page: an interrupted upload resumes where it left off for up to six days.",
        ],
      },
      {
        heading: "Processing",
        paragraphs: [
          "When the upload completes, the match appears in your library as processing. Most videos finish in under 30 minutes, and you get an email when the match is ready to review.",
        ],
      },
    ],
  },
  {
    slug: "upload-from-youtube",
    title: "Import from YouTube",
    summary: "Paste a link instead of uploading a file.",
    group: "Get started",
    related: ["upload-a-video"],
    sections: [
      {
        paragraphs: [
          "On the upload page, paste a public or unlisted YouTube link and tap Import. PongLens fetches the video and runs the same processing a file upload gets.",
          "After you import, one form collects the opponent, match type and processing options. You can keep changing the processing options while the video downloads; they lock once processing is underway. Opponent and match type stay editable.",
        ],
        images: [
          { src: "/learn/youtube-d.jpg", alt: "YouTube import on desktop", kind: "d" },
          {
            src: "/learn/youtube-m.jpg",
            alt: "YouTube import on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
        tip: "Public and unlisted links work, up to 45 minutes. Private videos will not import, and it must be your footage or footage you have the rights to.",
      },
      {
        paragraphs: [
          "Good for matches someone else filmed, league recordings, or footage already on your channel.",
        ],
      },
    ],
  },

  // ----------------------------------------------------- Review and score
  {
    slug: "match-viewer",
    title: "Watch your match",
    summary: "The full screen viewer, and the speed tricks worth knowing.",
    group: "Review and score",
    related: ["keep-score", "score-points"],
    sections: [
      {
        paragraphs: [
          "Open a match and tap play on the video card. The viewer takes over the whole screen and plays the cut video: your match with the dead time between points removed.",
        ],
        images: [
          { src: "/learn/player-d.jpg", alt: "The match viewer on desktop", kind: "d" },
          {
            src: "/learn/player-m.jpg",
            alt: "The match viewer on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Gestures",
        bullets: [
          "Tap the video to pause or resume, and to show or hide the controls.",
          "Double tap the right half to jump to the next point, the left half to jump back a point.",
          "Press and hold the right half to run at 2x while you hold.",
          "Press and hold the left half to slow to 0.25x, for reading a serve or a contact point.",
          "Let go of a hold and playback returns to normal speed.",
          "The speed pill sets a lasting speed if you want the whole match faster.",
        ],
      },
      {
        heading: "Watch and Score",
        paragraphs: [
          "The viewer has two modes. Watch is just watching. Score adds the pad for recording who won each point while the video plays; the Keep score guide covers it.",
          "Once the match is scored, the running score sits over the video, game by game, the way a broadcast shows it.",
        ],
      },
    ],
  },
  {
    slug: "score-points",
    title: "Score a match point by point",
    summary: "Open any point, answer two taps, go as deep as you want.",
    group: "Review and score",
    related: ["keep-score", "tags", "stats-and-placement"],
    sections: [
      {
        paragraphs: [
          "Every processed match becomes a list of points. Tap one and it opens: the clip on top, the questions below. On a phone the point fills the screen; on a laptop it sits in a panel next to the list.",
        ],
        images: [
          { src: "/showcase/viewer-d.jpg", alt: "A point open on desktop", kind: "d" },
          {
            src: "/showcase/viewer-m.jpg",
            alt: "A point open on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "The two questions",
        paragraphs: [
          "Who served, and who won. Two taps and the point is scored; the match scorecard builds itself from there, game by game.",
        ],
      },
      {
        heading: "Go deeper when a point deserves it",
        bullets: [
          "How the point ended: a winner or an error, and what kind.",
          "Where the deciding ball landed on the table.",
          "The serve: spin and length.",
          "Why the point was lost, from a short list of reasons.",
        ],
        paragraphs: [
          "All of it is optional. Score 150 points with two taps each, or dissect one point completely. The deeper answers feed your placement patterns and tactics.",
        ],
      },
      {
        heading: "Everything else on a point",
        bullets: [
          "Star the points you want to find again. Starred points become their own export and share link.",
          "Tag it with your own labels. The Tag your points guide covers collections.",
          "Write a note, record a voice note, or draw on a frame. Notes stay on the point.",
          "Edit clip fixes a clip that starts late or ends early. Split cuts two rallies that were fused into one point. Remove deletes footage that is not a point.",
          "In match jumps to that moment in the full video.",
        ],
        images: [
          {
            src: "/showcase/notes-m.jpg",
            alt: "A point's notes with an annotated frame",
            kind: "m",
          },
        ],
      },
    ],
  },
  {
    slug: "keep-score",
    title: "Keep score while you watch",
    summary: "Score the whole match in one pass with the video playing.",
    group: "Review and score",
    related: ["match-viewer", "score-points"],
    sections: [
      {
        paragraphs: [
          "Open the match, then Tools, then Keep score. The viewer starts in score mode with the pad on screen.",
          "The video pauses on its own at the end of each rally. Tap who won, Me or Them, and it plays on into the next point. That is the whole loop: watch, tap, watch.",
        ],
        images: [
          { src: "/showcase/score-d.jpg", alt: "Score mode on desktop", kind: "d" },
          {
            src: "/showcase/score-m.jpg",
            alt: "The score pad on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "The rest of the pad",
        bullets: [
          "Skip marks a rally you cannot call, like a let or an interrupted point.",
          "Delete throws away footage that is not a point at all.",
          "Split, the scissors, cuts the current point in two at the playhead, for when two rallies got fused into one clip.",
          "Undo takes back the last call.",
          "The serve dot and the star are optional extras; neither interrupts the flow.",
        ],
      },
      {
        heading: "Games and the finish",
        paragraphs: [
          "PongLens works out where games end from the score, and asks right on the pad when it is not sure.",
          "At the end, a review pass surfaces anything left unscored, so the scorecard comes out complete.",
        ],
        tip: "Camera far away? Pinch to zoom, up to 4x. While zoomed, one finger pans, and the 1x pill puts the full frame back.",
      },
    ],
  },
  {
    slug: "tags",
    title: "Tag your points",
    summary: "Your own labels, on any point, that turn into collections.",
    group: "Review and score",
    related: ["score-points", "export"],
    sections: [
      {
        paragraphs: [
          "Tags are short labels in your own words: forehand error, serve fault, that cross-court pattern you keep falling for. Open a point and tap the tag icon. Recent tags come first, typing filters, and Create adds a new one.",
          "Tagging the same thing across a match takes two taps per point: open the picker, tap the chip.",
        ],
        images: [
          {
            src: "/learn/tagpicker-m.jpg",
            alt: "The tag picker on a point",
            kind: "m",
          },
        ],
      },
      {
        heading: "What tags unlock",
        bullets: [
          "Tagged points show a small tag mark on the timeline, so patterns stand out while you scroll.",
          "Every tag with clips becomes its own export: all the points with that label, rendered as one video.",
          "Tag collections can be shared as a link too.",
        ],
        tip: "The greyed suggestions in the picker are starters. A tag only becomes part of your vocabulary once you first use it.",
      },
    ],
  },

  // -------------------------------------------------------------- Your game
  {
    slug: "stats-and-placement",
    title: "Stats and placement maps",
    summary:
      "What scoring builds: match analysis, table maps, and your game over time.",
    group: "Your game",
    related: ["score-points", "keep-score"],
    sections: [
      {
        heading: "Each match",
        paragraphs: [
          "Score the points and the match page fills in below the timeline: point differential, serve and receive win rates, pressure points, momentum. It all comes from your scoring; nothing needs extra work.",
        ],
        images: [
          { src: "/showcase/stats-d.jpg", alt: "Match analysis on desktop", kind: "d" },
          {
            src: "/showcase/stats-m.jpg",
            alt: "Match analysis cards on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Placement maps",
        paragraphs: [
          "With the Placement option on at upload, PongLens tracks where the ball lands and draws the match's serve and rally maps: your serves, their serves, and rallies, on one table.",
          "The where answers you give while scoring feed the placement patterns in your stats, so the two build on each other.",
        ],
        images: [
          { src: "/showcase/placement-d.jpg", alt: "The placement map on desktop", kind: "d" },
          {
            src: "/showcase/placement-m.jpg",
            alt: "Serve placement on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Across every match",
        paragraphs: [
          "My stats, on the Account page, aggregates every match you have scored: how you serve, how you receive, what wins you points. The Tactics tab shows the patterns in how points are won and lost.",
          "It starts building after your first scored matches and sharpens the more you score.",
        ],
        images: [
          { src: "/learn/mystats-d.jpg", alt: "My stats on desktop", kind: "d" },
          {
            src: "/learn/mystats-m.jpg",
            alt: "My stats on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
    ],
  },

  {
    slug: "journal",
    title: "Keep a journal",
    summary:
      "Notes, lessons, practice entries, and what you're working on, in one feed.",
    group: "Your game",
    related: ["score-points", "for-coaches"],
    sections: [
      {
        paragraphs: [
          "The Journal tab is your training diary, and most of it writes itself: every note you or your coach leaves on a match collects here, newest first, next to the entries you add by hand.",
        ],
        images: [
          { src: "/showcase/journal-d.jpg", alt: "The journal on desktop", kind: "d" },
          {
            src: "/showcase/journal-m.jpg",
            alt: "The journal on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Working on",
        paragraphs: [
          "The pinned card at the top holds the three to five cues you are actively fixing, the same list a paper journal keeps on its first page. Type a cue or dictate it.",
          "Tick a cue when it becomes habit. It moves to History instead of being deleted, and anything that creeps back in can be restored with a tap. Your active cues also show on Home.",
        ],
      },
      {
        heading: "Lessons and practice",
        paragraphs: [
          "Add entry opens the composer. Practice is for your own drills and reflections. Lesson is for what a coach gave you: paste or dictate the whole thing and PongLens breaks it into short takeaways, so the lesson survives as a list you can actually reread.",
          "Any takeaway is one tap from becoming a Working on cue, which is how a lesson turns into practice.",
        ],
        images: [
          {
            src: "/showcase/journal-feed-m.jpg",
            alt: "Journal entries on a phone",
            kind: "m",
          },
        ],
        tip: "Voice works everywhere here: cues and entries take dictation the same way notes do.",
      },
    ],
  },

  // ------------------------------------------------------ Share and export
  {
    slug: "export",
    title: "Export and download",
    summary:
      "The full match, your starred points, tag collections, or the raw file.",
    group: "Share and export",
    related: ["tags", "share"],
    sections: [
      {
        paragraphs: [
          "Open the match, then Tools, then Export. One sheet lists everything you can take with you:",
        ],
        bullets: [
          "Full match: the cut video, every point back to back. Include score burns the scoreboard into the rendered video.",
          "Starred points: your starred rallies as one reel.",
          "Tags: one row per tag, that collection rendered as its own video.",
          "Raw match: the original file you uploaded, kept for 7 days after upload.",
        ],
        images: [
          { src: "/learn/export-d.jpg", alt: "The export sheet on desktop", kind: "d" },
          {
            src: "/learn/export-m.jpg",
            alt: "The export sheet on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        paragraphs: [
          "Plain downloads start right away. Rendered exports take a few minutes; you get an email when one is ready, and ready exports also show up on Home.",
          "On a phone, a finished export hands the file to the share sheet, so it goes straight to another app.",
        ],
      },
    ],
  },
  {
    slug: "share",
    title: "Share your match",
    summary: "Public links for anyone, a private invite for your coach.",
    group: "Share and export",
    related: ["export", "for-coaches"],
    sections: [
      {
        heading: "Share a link",
        paragraphs: [
          "Share on the match page creates a public link: the whole match, a single point, your starred points, or a tag collection. Anyone with the link can watch, no account needed.",
          "Your links are listed on the Account page, where any of them can be revoked.",
        ],
        images: [
          { src: "/showcase/share-d.jpg", alt: "The share sheet on desktop", kind: "d" },
          {
            src: "/showcase/share-m.jpg",
            alt: "The share sheet on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Invite your coach",
        paragraphs: [
          "Tools, then Coach, creates a private invite instead. Your coach opens the link and signs in, and your matches appear in their PongLens. Scope the invite to this match or to all your matches, and share it as a link or let them scan the QR code off your screen.",
          "Coaches you have added are managed on the Account page: one row per coach, with what they can see, more matches to share, or Remove coach.",
        ],
        images: [
          {
            src: "/learn/coachinvite-m.jpg",
            alt: "The coach invite sheet",
            kind: "m",
          },
        ],
        tip: "A public link shows the match to anyone who has it. The coach invite is tied to your coach's account. For anything you would not post publicly, invite the coach.",
      },
    ],
  },

  // ------------------------------------------------------------ For coaches
  {
    slug: "for-coaches",
    title: "For coaches",
    summary: "Watching a player's matches, and leaving feedback where it lands.",
    group: "For coaches",
    related: ["share", "score-points"],
    sections: [
      {
        heading: "Getting access",
        paragraphs: [
          "Your player sends an invite link or shows you a QR code. Open it and sign in; their shared matches appear on your Home under their name.",
          "You see the match the way they do: every point cut into a clip, the scoring, the analysis and maps. Their scoring and tools stay theirs; you can watch everything and download the video.",
        ],
        images: [
          { src: "/showcase/coach-d.jpg", alt: "A coached match on desktop", kind: "d" },
          {
            src: "/showcase/coach-m.jpg",
            alt: "Coach notes on a point",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Notes on points",
        paragraphs: [
          "Open any point and write a note. Notes live on the point, not in a chat: your player sees the note exactly where it applies, marked with your name. Voice notes work too, straight from the note box.",
          "Notes from you and notes from the player sit in one thread per point, so nobody says the same thing twice.",
        ],
      },
      {
        heading: "Draw on a frame",
        paragraphs: [
          "Pause the clip on the moment that matters and choose Draw on this frame. Pen or arrow, two ink colors, undo. Save, and the drawing attaches to your note as an image.",
        ],
        images: [
          {
            src: "/showcase/notes-m.jpg",
            alt: "A note with an annotated frame",
            kind: "m",
          },
        ],
      },
      {
        heading: "The whole match",
        paragraphs: [
          "The match page also has an overall notes thread, for feedback that is not about one point.",
          "Every note you leave notifies the player, and your notes appear in their journal feed with your name on them.",
        ],
      },
    ],
  },
];

export function guideBySlug(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}

/** Flat searchable text per guide, for the index's filter. */
export function guideSearchText(g: Guide): string {
  const parts: string[] = [g.title, g.summary];
  for (const s of g.sections) {
    if (s.heading) parts.push(s.heading);
    if (s.paragraphs) parts.push(...s.paragraphs);
    if (s.bullets) parts.push(...s.bullets);
    if (s.tip) parts.push(s.tip);
  }
  return parts.join(" ").toLowerCase();
}

/** The first sentence-ish snippet containing the query, for search results. */
export function guideSnippet(g: Guide, query: string): string | null {
  const q = query.toLowerCase();
  const texts: string[] = [];
  for (const s of g.sections) {
    if (s.heading) texts.push(s.heading);
    if (s.paragraphs) texts.push(...s.paragraphs);
    if (s.bullets) texts.push(...s.bullets);
    if (s.tip) texts.push(s.tip);
  }
  for (const t of texts) {
    const i = t.toLowerCase().indexOf(q);
    if (i === -1) continue;
    if (t.length <= 150) return t;
    const start = Math.max(0, i - 40);
    const cut = t.slice(start, start + 150);
    return `${start > 0 ? "…" : ""}${cut}…`;
  }
  return null;
}
