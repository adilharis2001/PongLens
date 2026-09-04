import type { Guide } from "./catalogTypes.ts";

export const PLAYER_GROUPS = [
  "Get started",
  "Review and score",
  "Your game",
  "Share and export",
] as const;

export const playerGuides: Guide[] = [
  {
    slug: "upload-a-video",
    title: "Upload a match video",
    summary: "Choose a video, set up processing, and know what happens next.",
    group: "Get started",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["upload-from-youtube", "record-a-match", "match-viewer"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Upload from Home or Matches.",
          "Choose a video up to 45 minutes long, then add the opponent, location, session type, and which side of the video is yours.",
          "Choose whether PongLens should break the video into points and generate placement maps.",
          "Keep the page open until the upload finishes. You can leave once processing starts.",
          "Return when PongLens tells you the match is ready.",
        ],
        images: [
          { src: "/showcase/upload-d.jpg", alt: "The Upload page with the video chooser and match details", kind: "d" },
          { src: "/showcase/upload-m.jpg", alt: "The Upload page on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Record a clear video",
        paragraphs: [
          "Open How to record before your first match. Put the camera to the side of the table, around head height, with the full table and both players in view. Record sideways when you can.",
          "Choose the side you do not serve from so neither player blocks the camera as the point begins.",
        ],
      },
      {
        heading: "Choose what PongLens creates",
        bullets: [
          "Break it into points removes the time between rallies and creates the clips used for scoring, tags, and point-by-point review.",
          "Placement maps asks PongLens to follow the ball. It works best when the full table is clear in the frame.",
          "Opponent, location, session type, and your side make the match easier to recognize and keep the score facing the right way.",
        ],
        tip: "Processing choices lock when processing begins. You can still edit the match details later.",
      },
      {
        heading: "On iPhone",
        paragraphs: [
          "Choose Record a match when you want to film in PongLens, or choose a video that is already in Photos. The recording route shows the camera-alignment guide before you start.",
          "A video stored in iCloud may download before the PongLens progress bar moves. Keep the screen on and stay connected until the upload begins.",
        ],
        visibility: { audiences: ["player"], platforms: ["ios"] },
      },
      {
        heading: "After the upload",
        paragraphs: [
          "The match appears on Home and in Matches while PongLens processes it. You can use the rest of PongLens after the upload completes, and PongLens lets you know when the match is ready.",
        ],
      },
    ],
  },
  {
    slug: "upload-from-youtube",
    title: "Import a video from YouTube",
    summary: "Bring in a public or unlisted video without downloading it first.",
    group: "Get started",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["upload-a-video", "match-viewer"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Upload and scroll to Import from YouTube.",
          "Paste a link to one public or unlisted YouTube video.",
          "Choose Import.",
          "Add match details and choose the processing options while PongLens fetches the video.",
          "When the page says “We’re fetching it,” you can leave. PongLens emails you when the match is ready.",
        ],
        images: [
          { src: "/learn/youtube-d.jpg", alt: "The Import from YouTube form", kind: "d" },
          { src: "/learn/youtube-m.jpg", alt: "The YouTube link field and Import button on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Which links work",
        bullets: [
          "The video must be public or unlisted. Private and unavailable videos cannot be imported.",
          "The video can be up to 45 minutes long.",
          "Use your own footage, or footage you have permission to use.",
          "Paste a link to the video itself, not a channel or playlist page.",
        ],
      },
      {
        heading: "Set up the match while it downloads",
        paragraphs: [
          "The form has the same choices as a file upload: opponent, location, match type, Break it into points, Placement maps, and Cut strictness.",
          "Processing choices stay editable while the YouTube video downloads. They lock when PongLens begins processing. The opponent, location, and match type remain editable.",
        ],
        tip: "A YouTube import does not need this page to stay open. Once the import is queued, you can close it or use another part of PongLens.",
      },
    ],
  },
  {
    slug: "record-a-match",
    title: "Record a match",
    summary: "Film a match or practice on iPhone and hand it straight to upload.",
    group: "Get started",
    visibility: { audiences: ["player"], platforms: ["ios"] },
    related: ["upload-a-video"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Choose Record a match and select Match or Practice.",
          "Set the phone sideways and align the table with the camera guide.",
          "Start recording, optionally speak each game score, and pause when play stops.",
          "Resume for the next game, then choose Finish when the session is over.",
          "Review the handoff details and upload the recording to PongLens.",
        ],
      },
      {
        heading: "Choose Match or Practice",
        paragraphs: [
          "Use Match for a scored contest and Practice for drills or an informal session. The choice becomes the session type in the upload details and can be edited before processing starts.",
        ],
      },
      {
        heading: "Align the camera",
        paragraphs: [
          "Mount the phone sideways at about head height. Follow the on-screen outline so the whole table stays visible and neither player blocks it at the start of a rally.",
        ],
      },
      {
        heading: "Scores, pauses, and upload",
        paragraphs: [
          "You can say the game score during a break so it is easier to find later. Spoken scores are optional and do not replace scoring the points in PongLens.",
          "Pause when play stops and resume when it restarts. Finish closes the recording and takes you to the upload handoff, where you confirm the match and processing details.",
        ],
      },
    ],
  },
  {
    slug: "match-viewer",
    title: "Watch the full match",
    summary: "Use the full-screen player, jump between points, and change speed.",
    group: "Review and score",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["score-keeper", "score-points"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and choose Full video.",
          "Tap or click the video to pause, then use the timeline or point grid to move through the match.",
          "Use the left and right controls to move one point at a time.",
          "Open Original when you want to watch the upload exactly as you sent it.",
        ],
        images: [
          { src: "/learn/player-d.jpg", alt: "The full match player with review controls visible", kind: "d" },
          { src: "/learn/player-m.jpg", alt: "The full match player on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Faster ways to review",
        bullets: [
          "Double-tap the right side to go to the next point and the left side to go back.",
          "Double-tap the middle to replay the point you are on.",
          "Hold the right side for double speed and the left side for quarter speed.",
          "Pinch to zoom, then drag to move around the frame.",
        ],
      },
      {
        heading: "Review without closing the player",
        bullets: [
          "Open the point grid to jump directly to another rally.",
          "Star the current point, share it, or leave a note from the player.",
          "Choose Original if the cut left out footage or you want to see the breaks between rallies.",
        ],
      },
    ],
  },
  {
    slug: "score-points",
    title: "Score and review individual points",
    summary: "Record the result, add useful detail, and correct the point clips.",
    group: "Review and score",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["score-keeper", "tags", "match-analysis"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and choose a rally from Points.",
          "Confirm who served, then choose who won the point.",
          "Open Analysis when you want to record how the point ended, the serve, placement, or why you lost.",
          "Add a note, tag, star, or drawing when the rally is worth revisiting.",
        ],
        images: [
          { src: "/showcase/viewer-d.jpg", alt: "A point open beside the point list on desktop", kind: "d" },
          { src: "/showcase/viewer-m.jpg", alt: "An individual point open on a phone", kind: "m", phoneTwin: true },
          { src: "/showcase/notes-m.jpg", alt: "A point note with a marked-up video frame", kind: "m" },
        ],
      },
      {
        heading: "Scoring can be one tap",
        paragraphs: [
          "Once the first server is set, PongLens follows the serve rotation. Choosing a winner is enough to build the score; the Analysis answers fill the deeper match views and statistics.",
        ],
      },
      {
        heading: "Fix the footage for a point",
        bullets: [
          "Adjust the start or end when a rally begins too early or finishes too late.",
          "Split a clip when two rallies were joined together.",
          "Join neighboring clips when one rally was cut into separate pieces.",
          "Remove warm-up, dead space, or footage that is not a point.",
          "Open the original match and put back a missed rally when the cut left it out.",
        ],
        tip: "A corrected clip can briefly show an updating state while PongLens prepares it.",
      },
    ],
  },
  {
    slug: "score-keeper",
    title: "Score a match with Score Keeper",
    summary: "Score the match in one pass and correct cuts or game boundaries as you go.",
    group: "Review and score",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["match-viewer", "score-points", "match-analysis"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match, go to Tools, and choose Score Keeper.",
          "Confirm the player names and first server when asked.",
          "Watch each rally, then choose the player who won it.",
          "Review unresolved points at the end and choose Done.",
        ],
        images: [
          { src: "/showcase/score-d.jpg", alt: "Score Keeper with the video and scoring controls", kind: "d" },
          { src: "/showcase/score-m.jpg", alt: "Score Keeper controls on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Follow the score and server",
        paragraphs: [
          "Score Keeper plays one point at a time and waits for your answer. The lit ball shows who is serving; change it when the rotation needs correcting.",
          "A divider marks each game. Choose Game didn't end when a divider is wrong, or Game ended on the real final point when the automatic score missed the boundary.",
        ],
      },
      {
        heading: "Use the correction controls",
        bullets: [
          "Undo reverses the most recent scoring or editing action.",
          "Replay shows the current rally again, while Skip resolves a let that should not count.",
          "Remove clears warm-up or dead space.",
          "Modify lets you adjust, split, or join clips that contain the wrong footage.",
          "Analysis, Note, Tag, and Star add detail without leaving the scoring flow.",
        ],
      },
    ],
  },
  {
    slug: "tags",
    title: "Organize points with tags",
    summary: "Create your own labels, find related points, and build collections.",
    group: "Review and score",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["score-points", "export", "share-a-link"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a point and select the tag icon on the video.",
          "Choose a recent tag, choose a suggested starter, or type a new label.",
          "To make a new label, choose Create followed by the label name.",
          "Select an active tag again to remove it from the point.",
          "Choose Done when the point has the tags you want.",
        ],
        images: [
          { src: "/learn/tagpicker-m.jpg", alt: "The tag picker with recent and suggested labels", kind: "m" },
        ],
      },
      {
        heading: "Use labels that help you make a decision",
        paragraphs: [
          "A useful tag describes something you will want to find again, such as forehand error, short receive, or backhand down the line. Keep labels short and use the same wording each time.",
          "Recent tags appear first, so repeating a label on another point takes two selections: open the picker, then choose the tag.",
        ],
      },
      {
        heading: "What tags create",
        bullets: [
          "Tagged points are marked in the match timeline and can be found with the point filters.",
          "The match Export sheet can turn one tag from that match into a single video.",
          "The match Share sheet can create a public link for one tag. The link updates when you add or remove that tag in the same match.",
          "The Journal combines the same tag across points and journal entries. From there, you can export tagged points from all matches as one video.",
        ],
        tip: "The dashed starter tags are suggestions, not saved labels. Choosing one creates it and applies it to the current point.",
      },
    ],
  },
  {
    slug: "match-analysis",
    title: "Understand match analysis",
    summary: "See what your scoring says and what the camera mapped in one match.",
    group: "Your game",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["score-points", "score-keeper", "stats"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and choose Match analysis in Tools.",
          "Score the points to fill the result, score, serve, receive, and momentum views.",
          "Answer the optional Analysis questions to fill Serve, Mistakes, and Placement.",
          "Open Where the ball landed for the placement maps made from the footage.",
        ],
        images: [
          { src: "/showcase/stats-d.jpg", alt: "Match analysis cards built from scored points", kind: "d" },
          { src: "/showcase/stats-m.jpg", alt: "Match analysis cards on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Know where each result comes from",
        bullets: [
          "Overview uses confirmed winners, game boundaries, and the serve rotation.",
          "Serve, Mistakes, and Placement use the answers you chose while scoring.",
          "Where the ball landed uses tracking created from the video. Serve placement shows the landing of the serve, while rally views show later landings PongLens could follow.",
          "A coach can read the player's score, analysis, and maps but cannot change them.",
        ],
      },
      {
        heading: "Generate or retry placement",
        paragraphs: [
          "Placement is prepared after the initial match processing when it was selected during upload. If it was not selected, request it from Tools while the original video is still available.",
          "A processing state means PongLens is still preparing the maps. Retry starts another attempt after a failed result. Unavailable means the original or a usable camera view is not available for a new attempt.",
        ],
        tip: "Placement is still in beta. Mark a result that looks wrong so it stops counting in the map.",
      },
    ],
  },
  {
    slug: "stats",
    title: "See your stats across matches",
    summary: "Track results and tactical patterns from all the matches you score.",
    group: "Your game",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["match-analysis", "score-points", "journal"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Account and choose My stats.",
          "Use My stats for results, win rates, pressure points, and recent matches.",
          "Choose Tactics for serve, mistake, and placement patterns.",
          "Open any result to return to that match.",
          "Keep scoring matches and adding Analysis answers to make each view more complete.",
        ],
        images: [
          { src: "/learn/mystats-d.jpg", alt: "The My stats view across scored matches", kind: "d" },
          { src: "/learn/mystats-m.jpg", alt: "My stats and Tactics tabs on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "My stats",
        paragraphs: [
          "My stats combines the points you have scored across matches. It shows match and game records, point win rate, serve and receive results, pressure points, bounce-back rate, and your best run.",
          "The Results and Opponents sections use fully scored matches. A partly scored match can contribute point statistics without appearing as a finished result.",
        ],
        tip: "Serve and receive numbers need a known first server in each match. Set it from the match page when those numbers are missing.",
      },
      {
        heading: "Tactics",
        paragraphs: [
          "Tactics uses the optional answers you add to individual points. It does not guess why a point was won or lost.",
        ],
        bullets: [
          "My serves and Against their serves use the spin and length you recorded.",
          "Mistakes uses point endings and your Why I lost answers.",
          "Placement uses the forehand, middle, or backhand destination recorded in Analysis.",
        ],
        tip: "Counts beside the bars show the sample size. A clear pattern across several described points is more useful than one isolated result.",
      },
    ],
  },
  {
    slug: "journal",
    title: "Keep a training journal",
    summary: "Save match notes, lessons, practice reflections, and current cues.",
    group: "Your game",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["score-points", "tags", "invite-a-coach"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Journal and choose New.",
          "Write, paste, or dictate an entry, then add a photo or scan pages from a paper notebook.",
          "Add tags and choose whether Improve with AI should prepare the notes.",
          "Review the original words and edit the prepared notes before saving.",
        ],
        images: [
          { src: "/learn/journal-current-d.jpg", alt: "The current Journal with search and discovery tools", kind: "d" },
          { src: "/learn/journal-current-m.jpg", alt: "The current Journal on a phone", kind: "m", phoneTwin: true },
          { src: "/showcase/journal-feed-m.jpg", alt: "Match and lesson notes together in the Journal", kind: "m" },
        ],
      },
      {
        heading: "Bring every kind of note together",
        bullets: [
          "Match and point notes appear beside your own practice and lesson entries.",
          "Entries a coach shares with you arrive in Journal and remain connected to the coach's copy.",
          "A public entry link lets someone read that one entry without opening the rest of your Journal.",
          "Photos and scanned notebook pages stay with the entry they came from.",
        ],
      },
      {
        heading: "Improve and revisit your notes",
        paragraphs: [
          "Improve with AI prepares rough notes as clear points while keeping the original text. You can correct the prepared notes directly afterwards.",
          "Ask your journal answers from your own entries and match record. Search finds saved words, and Recollect brings older advice back when it becomes useful again.",
        ],
        images: [
          { src: "/learn/journal-ask-d.jpg", alt: "A journal question ready for Ask your journal", kind: "d" },
          { src: "/learn/journal-ask-m.jpg", alt: "A journal question ready for Ask your journal on a phone", kind: "m", phoneTwin: true },
          { src: "/learn/journal-recollect-d.jpg", alt: "Recollect topics grouped from lesson and practice entries", kind: "d" },
          { src: "/learn/journal-recollect-m.jpg", alt: "Recollect topics on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Keep current cues in Working on",
        paragraphs: [
          "Add the cues you want in view before training or a match. Tick one off when it becomes a habit; its history remains available if you need to restore it.",
        ],
      },
    ],
  },
  {
    slug: "create-share-highlights",
    title: "Create and share highlights",
    summary: "Watch, download, and share automatic or hand-picked rally collections.",
    group: "Share and export",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["export", "share-a-link", "tags"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and choose Highlights.",
          "Watch the automatic short or long highlight before sharing it.",
          "Choose Download or Share for the version you want.",
          "Star individual rallies to build your all-starred collection across matches.",
        ],
        images: [
          { src: "/learn/highlights-d.jpg", alt: "The short and long automatic highlight choices", kind: "d" },
          { src: "/learn/highlights-m.jpg", alt: "The Highlights chooser on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Automatic and starred highlights",
        paragraphs: [
          "PongLens prepares a short highlight and a longer highlight from the strongest rallies in the match. Watch either version before downloading or sharing it.",
          "Stars are your own selection. Open the all-starred collection when you want one place for saved rallies from different matches.",
        ],
      },
      {
        heading: "Instagram Story and Reel",
        paragraphs: [
          "On iPhone, choose Share and select Instagram Story or Reel. PongLens hands the prepared highlight to Instagram in the format for the destination you chose; review it there before posting.",
        ],
        visibility: { audiences: ["player"], platforms: ["ios"] },
      },
    ],
  },
  {
    slug: "export",
    title: "Export and download video",
    summary: "Save highlights, the cut match, selected rallies, or the original upload.",
    group: "Share and export",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["create-share-highlights", "tags", "share-a-link"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match, go to Tools, and choose Export.",
          "Choose the full cut match, starred points, a tag collection, or the original video.",
          "Turn on Include score when you want a running scoreboard in the rendered video.",
          "Create the export when rendering is needed, then download or share it when it is ready.",
        ],
        images: [
          { src: "/learn/export-d.jpg", alt: "The match Export sheet with video choices", kind: "d" },
          { src: "/learn/export-m.jpg", alt: "Export choices on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Choose the right video",
        bullets: [
          "Highlights are the automatic short and long edits PongLens makes from the best rallies.",
          "Starred points and tagged exports use the rallies you selected yourself.",
          "Full match is the cut video with the time between rallies removed.",
          "Original video is the upload exactly as you sent it.",
        ],
      },
      {
        heading: "Rendering and availability",
        paragraphs: [
          "A scoreboard, starred collection, or tag collection may need time to render. You can leave and return after PongLens says it is ready.",
          "The original upload remains available from the match while you keep that match in your library.",
        ],
      },
    ],
  },
  {
    slug: "share-a-link",
    title: "Share a public link",
    summary: "Let anyone with the link watch a match, point, or collection.",
    group: "Share and export",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["invite-a-coach", "export", "tags"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match, go to Tools, and choose Share.",
          "Choose This match, Starred points, or one of the listed tags.",
          "Enter a clear title for the link, or keep the suggested title.",
          "Choose Share, then copy the link, use your device’s share menu, or show the QR code.",
          "To share one point, open that point and choose Share.",
        ],
        images: [
          { src: "/showcase/share-d.jpg", alt: "The public-link share sheet on desktop", kind: "d" },
          { src: "/showcase/share-m.jpg", alt: "Public-link sharing options on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Choose what the link shows",
        bullets: [
          "This match shows the full cut video.",
          "This point shows only the point you opened.",
          "Starred points shows the current starred collection.",
          "A tag link shows the points with that tag in the current match.",
        ],
        tip: "Starred and tag links stay live. If you later add or remove a star or tag in the same match, people opening the link see the updated collection.",
      },
      {
        heading: "Know who can open it",
        paragraphs: [
          "A public link does not require a PongLens account. Anyone who receives it can watch, and someone can forward it to another person.",
          "Use a coach invite instead when access should be tied to one coach’s account.",
        ],
      },
      {
        heading: "Copy or revoke old links",
        paragraphs: [
          "Open Account and find Public links. Choose Manage to copy or revoke one link. Choose Revoke all when you need to disable every active public link.",
        ],
      },
    ],
  },
  {
    slug: "invite-a-coach",
    title: "Invite a coach",
    summary: "Connect a coach and decide which matches that coach can open.",
    group: "Share and export",
    visibility: { audiences: ["player"], platforms: ["web", "ios"] },
    related: ["share-a-link", "journal"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Coaching, choose Add a coach, and create an invite link.",
          "Choose whether this coach can see all matches or only matches you share.",
          "Send the link. The connection is added when the coach signs in and accepts it.",
          "Open the coach later to change that coach's match access or remove the connection.",
        ],
        images: [
          { src: "/learn/coachinvite-m.jpg", alt: "The coach connection and match-access sheet", kind: "m" },
        ],
      },
      {
        heading: "Choose access for each coach",
        bullets: [
          "All matches includes current matches and matches you add later.",
          "Only matches I share starts with no match access. Share or remove individual matches from the coach's row.",
          "Each coach has a separate access setting, so changing one coach does not affect another.",
        ],
      },
      {
        heading: "Receive coaching in context",
        paragraphs: [
          "Written notes, voice notes, and drawings from a coach stay on the match and point they describe. They also appear in Coaching and Journal.",
          "Lesson entries a coach shares with you arrive in Coaching and Journal. The coach can update or stop sharing the entry later.",
        ],
        tip: "A coach can review shared scores, clips, analysis, and maps but cannot change your match.",
      },
    ],
  },
];
