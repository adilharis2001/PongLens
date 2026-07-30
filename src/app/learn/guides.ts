/**
 * The Learn hub's content. Every guide is plain data: the index and article
 * pages render from here, and search walks the same text.
 *
 * Screenshots come from public/showcase (scripts/demos/shots.mjs) and
 * public/learn (scripts/demos/learn_shots.mjs). Re-run those scripts after
 * the product UI changes.
 *
 * Copy rules: lead with the task, use the labels shown in the product, and
 * explain what happens after each important action. Keep sentences short,
 * complete, and factual.
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
  /** A short, ordered path for completing the task. */
  steps?: string[];
  paragraphs?: string[];
  bullets?: string[];
  /** A quiet callout for a limitation or easily missed behavior. */
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
    summary:
      "Choose a video, set up processing, and know what happens next.",
    group: "Get started",
    related: ["upload-from-youtube", "match-viewer"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Upload from Home or Matches.",
          "Choose an MP4 or MOV file up to 2 GB. The upload starts as soon as you select it.",
          "While it uploads, add any match details you want and choose which player you are in the video.",
          "Leave Break it into points on. Choose whether you also want Placement maps, then set Cut strictness.",
          "Stay on the page until you see “Done. Processing starts now.” You can leave after that.",
        ],
        images: [
          {
            src: "/showcase/upload-d.jpg",
            alt: "The Upload page with the Choose a video control",
            kind: "d",
          },
          {
            src: "/showcase/upload-m.jpg",
            alt: "The Upload page on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Record a clear video",
        paragraphs: [
          "Place the camera diagonally behind one player and raise it a little above head height. Keep the whole table in view, including both ends, without either player blocking it.",
          "Record with your phone sideways. Vertical video still works, but PongLens has less of the table to work with.",
          "On the Upload page, open How to record to see the recommended position.",
        ],
      },
      {
        heading: "Choose what PongLens creates",
        bullets: [
          "Break it into points removes the time between rallies and creates one clip for each point. Keep this on if you want to score, tag, or review individual points.",
          "Placement maps asks PongLens to track where the ball lands. It adds processing time and works best with a clear view of the full table.",
          "Cut strictness controls how much footage stays around each rally. Tight keeps the least, Loose keeps the most, and Normal is a good starting point.",
          "Which player are you? uses a frame from your video. Choose the player at the top or bottom so names, scoring, and maps face the right way.",
          "Opponent, club or location, and match type are optional. They make the match easier to recognize later.",
        ],
        tip: "Processing choices lock after PongLens starts working on the video. Match details such as the opponent and location can still be edited.",
      },
      {
        heading: "If the video is stored in the cloud",
        paragraphs: [
          "An iPhone may need to download the original from iCloud before PongLens can upload it. During that time, the photo picker can look stuck. Keep the screen on and stay on Wi-Fi until the PongLens progress bar begins to move.",
        ],
        tip: "Google Photos can behave the same way on Android. If the picker does not finish, download the video to the phone first, then choose it again in PongLens.",
      },
      {
        heading: "Resume an interrupted upload",
        paragraphs: [
          "Return to Upload and choose the same file. PongLens continues from the uploaded parts instead of starting over. The saved upload is available for up to six days.",
          "Choose Start over only if you want to discard the interrupted upload.",
        ],
      },
      {
        heading: "After the upload",
        paragraphs: [
          "The match appears on Home and in Matches with a processing status. Most videos finish in under 30 minutes. PongLens emails you when the match is ready.",
        ],
      },
    ],
  },
  {
    slug: "upload-from-youtube",
    title: "Import a video from YouTube",
    summary:
      "Bring in a public or unlisted video without downloading it first.",
    group: "Get started",
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
          {
            src: "/learn/youtube-d.jpg",
            alt: "The Import from YouTube form",
            kind: "d",
          },
          {
            src: "/learn/youtube-m.jpg",
            alt: "The YouTube link field and Import button on a phone",
            kind: "m",
            phoneTwin: true,
          },
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

  // ----------------------------------------------------- Review and score
  {
    slug: "match-viewer",
    title: "Watch the full match",
    summary:
      "Use the full-screen player, jump between points, and change speed.",
    group: "Review and score",
    related: ["keep-score", "score-points"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and select Full video.",
          "Tap or click the video to pause. Select it again to continue.",
          "Use the left and right arrows to move one point at a time.",
          "Use the timeline to scrub to another moment, or open the point grid to jump to a specific point.",
          "Select the X when you are finished.",
        ],
        images: [
          {
            src: "/learn/player-d.jpg",
            alt: "The full match player with review controls visible",
            kind: "d",
          },
          {
            src: "/learn/player-m.jpg",
            alt: "The full match player on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Faster ways to review",
        bullets: [
          "Double-tap the right half of the video to go to the next point. Double-tap the left half to go back.",
          "Press and hold the right half to play at 2x until you let go.",
          "Press and hold the left half to play at 0.25x until you let go.",
          "Use the speed control beside the timeline when you want a speed to stay selected.",
        ],
      },
      {
        heading: "Review a point without leaving the video",
        bullets: [
          "Select the star to save the point currently on screen.",
          "Open the point grid to jump directly to any point in the match.",
          "Select the note icon to write or record a note about the point on screen.",
          "If a point already has notes, the newest note appears over the video. Select it to open the full thread.",
        ],
      },
      {
        heading: "What the score on the video means",
        paragraphs: [
          "After you score at least one point, the player shows the score from that moment in the match. It does not reveal the winner of the point you are about to watch.",
          "Select Keep score when you want the video to pause after each rally and wait for your answer.",
        ],
      },
    ],
  },
  {
    slug: "score-points",
    title: "Score and review individual points",
    summary:
      "Record the result quickly, then add detail only where it helps.",
    group: "Review and score",
    related: ["keep-score", "tags", "match-analysis"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and choose a point from the Points list.",
          "Under Who served?, confirm or correct the server.",
          "Under Who won this point?, choose Me or Them. Use Skip when the rally should not count.",
          "For more detail, open Analysis and answer only the questions that are useful.",
          "Use the arrows on the clip to move to the previous or next point.",
        ],
        images: [
          {
            src: "/showcase/viewer-d.jpg",
            alt: "A point open beside the point list on desktop",
            kind: "d",
          },
          {
            src: "/showcase/viewer-m.jpg",
            alt: "An individual point open on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Scoring can be one tap",
        paragraphs: [
          "Once you set who served first, PongLens follows the serve rotation through the match. You usually only need to choose who won. If the server shown on one point is wrong, correct it there and the later rotation updates from that point.",
          "The scorecard and game dividers update as you score. Use End game on a point when the real game ended somewhere the automatic score did not expect.",
        ],
      },
      {
        heading: "Add analysis when it tells you something",
        paragraphs: [
          "Select Analysis after choosing a winner. PongLens first asks how the point ended. It then shows only the follow-up questions that fit that ending.",
        ],
        bullets: [
          "How it ended records the type of winner, miss, or other ending.",
          "Placement records where the deciding ball went when that answer is meaningful.",
          "Serve records spin and length for points that turned on the serve.",
          "Why I lost records your own reason for a lost point.",
        ],
        tip: "Analysis is optional. A winner is enough to build the score. The extra answers are what fill the Serve, Mistakes, Placement, and Tactics views.",
      },
      {
        heading: "Save the points you want to revisit",
        bullets: [
          "Select the star on the clip to add the point to your starred collection.",
          "Select the tag icon to apply one of your labels or create a new one.",
          "Select Share to make a public link to this point.",
          "Write a note, record a voice note, or choose Draw on this frame to attach a marked-up image.",
        ],
        images: [
          {
            src: "/showcase/notes-m.jpg",
            alt: "A point note with a marked-up video frame",
            kind: "m",
          },
        ],
      },
      {
        heading: "Fix a point that was cut incorrectly",
        bullets: [
          "Edit clip moves the start or end by one second at a time. Play to the start of a second rally and choose Split at this moment if two rallies were joined in one clip.",
          "In match opens the full video at this point.",
          "Remove hides footage that is not a real point, such as warm-up or dead space.",
        ],
        tip: "After a timing edit or split, the point can briefly say Updating clip while PongLens creates the corrected clip.",
      },
    ],
  },
  {
    slug: "keep-score",
    title: "Keep score while the video plays",
    summary:
      "Score the match in one pass, fix bad cuts, and review anything missed.",
    group: "Review and score",
    related: ["match-viewer", "score-points", "match-analysis"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match, go to Tools, and choose Keep score.",
          "If asked, confirm the player names and who served first.",
          "Watch the rally. PongLens pauses after an unscored point.",
          "Choose the large button for the player who won. PongLens records the point and continues to the next rally.",
          "At the end, choose Review if any points are still unscored, then choose Done.",
        ],
        images: [
          {
            src: "/showcase/score-d.jpg",
            alt: "Keep Score with the video and scoring controls",
            kind: "d",
          },
          {
            src: "/showcase/score-m.jpg",
            alt: "Keep Score controls on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "What happens after each rally",
        paragraphs: [
          "PongLens pauses near the end of an unscored rally so the deciding shot is still visible. Choose a winner and playback moves to the next point. If you choose a winner before the rally ends, playback can continue without pausing.",
          "Choose Replay when you want to watch the paused rally again. A plain tap on the paused video continues without scoring it; the final review will bring that point back.",
        ],
      },
      {
        heading: "Use the smaller controls when the footage needs help",
        bullets: [
          "Undo reverses your most recent scoring or editing action.",
          "The speed control sets a playback speed that stays selected.",
          "Star saves the point without interrupting playback.",
          "Replay starts the current rally again.",
          "The note icon opens notes for the point on screen.",
          "The open-point icon leaves Keep Score and opens the full point details.",
          "Skip marks a let or another rally that should not count in the score.",
          "Delete removes warm-up, dead space, or a false point.",
          "Modify can split one fused point into two or three, or join it with the next one or two points.",
        ],
        tip: "Joining points cannot be undone from the Modify screen. Check the selected points and winner before you confirm it.",
      },
      {
        heading: "Correct a game boundary",
        paragraphs: [
          "PongLens works out game endings from the score. When a game summary appears too early, choose Didn’t end? and keep scoring.",
          "If the game ended earlier than the score suggests, pause on its last point and choose End game. After extending a game, choose Game ended here? when you reach the real last point.",
        ],
      },
      {
        heading: "Zoom and keyboard shortcuts",
        bullets: [
          "Pinch the video to zoom from 1x to 4x. Drag with one finger while zoomed, and choose the 1x badge to reset.",
          "On a keyboard, Space plays or pauses. Left Arrow gives the point to you; Right Arrow gives it to your opponent.",
          "U undoes, K skips, and S stars the current point. L also works as a skip shortcut.",
        ],
      },
      {
        heading: "Finish the match",
        paragraphs: [
          "When the video ends, PongLens shows the games and point scores it could build. If anything is unscored, choose Review to work through those clips one at a time.",
          "A skipped point is already resolved and will not appear in the unscored review.",
        ],
      },
    ],
  },
  {
    slug: "tags",
    title: "Organize points with tags",
    summary:
      "Create your own labels, find related points, and build collections.",
    group: "Review and score",
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
          {
            src: "/learn/tagpicker-m.jpg",
            alt: "The tag picker with recent and suggested labels",
            kind: "m",
          },
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

  // -------------------------------------------------------------- Your game
  {
    slug: "match-analysis",
    title: "Understand match analysis",
    summary:
      "See what your scoring says and what the camera mapped in one match.",
    group: "Your game",
    related: ["score-points", "keep-score", "stats-over-time"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match and choose Match analysis in Tools.",
          "Score the points to fill the Overview card and the match score.",
          "Answer Analysis questions on useful points to fill Serve, Mistakes, and Placement.",
          "Scroll to Where the ball landed to see camera-mapped serves and rallies.",
          "Use the view and game filters to compare your serves, their serves, and rally landings.",
        ],
        images: [
          {
            src: "/showcase/stats-d.jpg",
            alt: "Match analysis cards built from scored points",
            kind: "d",
          },
          {
            src: "/showcase/stats-m.jpg",
            alt: "Match analysis cards on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "What the analysis cards use",
        bullets: [
          "Overview uses confirmed winners, game boundaries, and the serve rotation. It includes serve and receive win rates, pressure points, runs, and the score.",
          "Serve uses the spin and length you record in a point’s Analysis.",
          "Mistakes uses how your lost points ended and any reasons you chose under Why I lost.",
          "Placement uses your answer about where the deciding ball went.",
        ],
        tip: "Set who served first if serve and receive stats are missing. Score every point if you want a complete result.",
      },
      {
        heading: "What “Where the ball landed” uses",
        paragraphs: [
          "This map is different from the Placement card. It comes from the video, not from an answer you entered. PongLens maps serves and rally landings when Placement maps was turned on for the upload.",
          "Set Your side so PongLens knows which end of the video is yours. The map then keeps you at the bottom even when players switch ends between games.",
        ],
        images: [
          {
            src: "/showcase/placement-d.jpg",
            alt: "The camera-mapped Where the ball landed view",
            kind: "d",
          },
          {
            src: "/showcase/placement-m.jpg",
            alt: "Serve landing map on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
        tip: "The map can be incomplete or slightly off when the table is small, blocked, or filmed at a difficult angle. PongLens shows how many points it could map.",
      },
    ],
  },
  {
    slug: "stats-over-time",
    title: "See your stats across matches",
    summary:
      "Track results and tactical patterns from all the matches you score.",
    group: "Your game",
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
          {
            src: "/learn/mystats-d.jpg",
            alt: "The My stats view across scored matches",
            kind: "d",
          },
          {
            src: "/learn/mystats-m.jpg",
            alt: "My stats and Tactics tabs on a phone",
            kind: "m",
            phoneTwin: true,
          },
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
    summary:
      "Save match notes, lessons, practice reflections, and current cues.",
    group: "Your game",
    related: ["score-points", "tags", "for-coaches"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Journal and choose New.",
          "Choose Practice for your own work or Lesson for something a coach gave you.",
          "Write, paste, or dictate the entry.",
          "Add tags and decide whether to keep Condense and summarize selected.",
          "Choose Save entry.",
        ],
        images: [
          {
            src: "/showcase/journal-d.jpg",
            alt: "The Journal with search, tags, cues, and entries",
            kind: "d",
          },
          {
            src: "/showcase/journal-m.jpg",
            alt: "The Journal on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Choose Practice or Lesson",
        bullets: [
          "Practice is for drills, reflections, match-day thoughts, or anything you want to remember from your own training.",
          "Lesson is for notes or a transcript from a coaching session.",
          "The microphone turns your speech into editable text. It does not attach an audio recording to the journal entry.",
        ],
      },
      {
        heading: "Condense a long entry",
        paragraphs: [
          "Condense and summarize is selected by default. For a long entry, PongLens turns the text into grouped takeaways while keeping the original transcript available.",
          "Clear the checkbox when you want the entry saved exactly as written without a summary.",
        ],
        images: [
          {
            src: "/showcase/journal-feed-m.jpg",
            alt: "Lesson takeaways in the Journal feed",
            kind: "m",
          },
        ],
      },
      {
        heading: "Keep your current cues in Working on",
        paragraphs: [
          "Working on is the short list at the top of the Journal. Add up to five cues you want to remember during practice or matches. You can type a cue or dictate it.",
          "Select the circle beside a cue when it becomes a habit. The cue moves to History instead of being deleted. Choose Restore if you need it again.",
          "A summarized lesson has a plus button beside each takeaway. Use it to add that takeaway directly to Working on.",
        ],
      },
      {
        heading: "Find everything again",
        bullets: [
          "Notes written on matches and points appear in the Journal automatically.",
          "Search looks across notes, lessons, practice entries, and tags.",
          "The All, Matches, Lessons, and Practice tabs narrow the feed.",
          "Selecting a tag shows related points and entries. Tagged points can be exported across matches as one video.",
        ],
      },
    ],
  },

  // ------------------------------------------------------ Share and export
  {
    slug: "export",
    title: "Export and download video",
    summary:
      "Save the full match, starred points, tag collections, or raw upload.",
    group: "Share and export",
    related: ["tags", "share-a-link"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match, go to Tools, and choose Export.",
          "Choose whether rendered videos should Include score.",
          "Choose the full match, starred points, a tag collection, or the raw match.",
          "Choose Create when PongLens needs to render a new video. Choose the download icon for a file that is ready immediately.",
          "When rendering finishes, choose Save. On supported phones, PongLens opens the system share sheet.",
        ],
        images: [
          {
            src: "/learn/export-d.jpg",
            alt: "The Export sheet with score and video choices",
            kind: "d",
          },
          {
            src: "/learn/export-m.jpg",
            alt: "The Export sheet on a phone",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "Choose what to export",
        bullets: [
          "Full match is the cut video with the time between points removed. With Include score off, it downloads immediately. With Include score on, PongLens renders the running scoreboard into the video.",
          "Starred points combines your starred rallies in match order.",
          "Each tag row combines the points with that tag in match order.",
          "Raw match is the original, uncut file. The original upload is available for 30 days after upload.",
        ],
        tip: "The download button on the Full video card is a shortcut to the playtime video without a scoreboard.",
      },
      {
        heading: "When PongLens needs to render",
        paragraphs: [
          "Videos with a scoreboard, starred collections, and tag collections take time to prepare. You can leave the page while PongLens renders them. PongLens sends an email when a video is ready, and ready exports also appear on Home.",
          "If you later change the score, stars, or tags, return to Export and create an updated video.",
        ],
      },
    ],
  },
  {
    slug: "share-a-link",
    title: "Share a public link",
    summary:
      "Let anyone with the link watch a match, point, or collection.",
    group: "Share and export",
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
          {
            src: "/showcase/share-d.jpg",
            alt: "The Share sheet with public link choices",
            kind: "d",
          },
          {
            src: "/showcase/share-m.jpg",
            alt: "Public sharing choices on a phone",
            kind: "m",
            phoneTwin: true,
          },
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
    summary:
      "Give one coach private access to one match or all your matches.",
    group: "Share and export",
    related: ["share-a-link", "for-coaches"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a match, go to Tools, and choose Coach.",
          "Choose This match or All my matches.",
          "Choose Create invite link.",
          "Copy the link, share it from your device, or let your coach scan the QR code.",
          "Your coach opens the link and signs in. Their access is added automatically.",
        ],
        images: [
          {
            src: "/learn/coachinvite-m.jpg",
            alt: "The coach invite sheet with match access choices",
            kind: "m",
          },
        ],
      },
      {
        heading: "Choose the right access",
        bullets: [
          "This match gives the coach access only to the match you have open.",
          "All my matches gives access to every current match and any match you upload later.",
          "A coach can watch the shared footage, download the cut video, and add notes. They cannot score, edit clips, share links, or change your match.",
        ],
      },
      {
        heading: "Manage coaches and unused invites",
        paragraphs: [
          "Open Account and find Coaches. An accepted coach shows the matches they can watch. Expand the row to remove one match or remove the coach completely.",
          "An invite that has not been accepted appears as waiting. You can copy it again or revoke it.",
        ],
        tip: "Each invite can be accepted by one coach account. If the link was used by the wrong person or revoked, create a fresh invite.",
      },
    ],
  },

  // ------------------------------------------------------------ For coaches
  {
    slug: "for-coaches",
    title: "Review a player’s match",
    summary:
      "Accept coach access, watch the footage, and leave feedback in context.",
    group: "For coaches",
    related: ["invite-a-coach", "match-viewer", "journal"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open the invite link from your player.",
          "Sign in to PongLens if asked. The invite is accepted automatically.",
          "A one-match invite opens that match. For all-match access, open Shared with me on Home.",
          "Open a point and add feedback in Notes.",
          "Use Overall notes on the match page for feedback that is not about one point.",
        ],
        images: [
          {
            src: "/showcase/coach-d.jpg",
            alt: "A player match opened with coach access",
            kind: "d",
          },
          {
            src: "/showcase/coach-m.jpg",
            alt: "Coach notes on an individual point",
            kind: "m",
            phoneTwin: true,
          },
        ],
      },
      {
        heading: "What coach access includes",
        paragraphs: [
          "You can watch the full cut video, open every point, follow the player’s saved score, read notes on each rally, and download the playtime video.",
          "Scoring, clip editing, public links, rendered exports, and match details remain under the player’s control.",
        ],
      },
      {
        heading: "Leave feedback on the exact point",
        paragraphs: [
          "Open a point and write in Notes. Your feedback stays attached to that rally, with your name, so the player sees it beside the footage.",
          "Use the microphone to record a voice note. PongLens keeps the audio with the point.",
        ],
      },
      {
        heading: "Draw on a frame",
        steps: [
          "Pause the point on the moment you want to explain.",
          "Choose Draw on this frame.",
          "Use the pen or arrow, then save the drawing.",
          "Write or record the note and send it. The marked frame is attached to the note.",
        ],
        images: [
          {
            src: "/showcase/notes-m.jpg",
            alt: "A coach note with a marked-up video frame",
            kind: "m",
          },
        ],
      },
      {
        heading: "Use Overall notes for the match",
        paragraphs: [
          "Overall notes are for themes that apply across several points, such as serve selection or movement between strokes.",
          "The player receives a notification for your note. Point notes and overall notes also appear in the player’s Journal.",
        ],
      },
    ],
  },
];

export function guideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

/** Flat searchable text per guide, for the index's filter. */
export function guideSearchText(guide: Guide): string {
  const parts: string[] = [guide.title, guide.summary];
  for (const section of guide.sections) {
    if (section.heading) parts.push(section.heading);
    if (section.steps) parts.push(...section.steps);
    if (section.paragraphs) parts.push(...section.paragraphs);
    if (section.bullets) parts.push(...section.bullets);
    if (section.tip) parts.push(section.tip);
  }
  return parts.join(" ").toLowerCase();
}

/** The first sentence-sized snippet containing the query. */
export function guideSnippet(guide: Guide, query: string): string | null {
  const q = query.toLowerCase();
  const texts: string[] = [];
  for (const section of guide.sections) {
    if (section.heading) texts.push(section.heading);
    if (section.steps) texts.push(...section.steps);
    if (section.paragraphs) texts.push(...section.paragraphs);
    if (section.bullets) texts.push(...section.bullets);
    if (section.tip) texts.push(section.tip);
  }
  for (const candidate of texts) {
    const index = candidate.toLowerCase().indexOf(q);
    if (index === -1) continue;
    if (candidate.length <= 150) return candidate;
    const start = Math.max(0, index - 40);
    const cut = candidate.slice(start, start + 150);
    return `${start > 0 ? "…" : ""}${cut}…`;
  }
  return null;
}
