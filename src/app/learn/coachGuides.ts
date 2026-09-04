import type { Guide } from "./catalogTypes.ts";

export const COACH_GROUPS = [
  "Get started",
  "Lesson entries",
  "Match feedback",
  "Paid reviews",
] as const;

export const coachGuides: Guide[] = [
  {
    slug: "coaching-workspace",
    title: "Use the coaching workspace",
    summary: "See students, recent entries, and shared matches in one place.",
    group: "Get started",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["add-connect-student", "keep-lesson-entries"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Coach Home to continue a recent entry or shared match.",
          "Open Students when you need the full roster.",
          "Choose a student to see their lesson entries and the matches they have shared.",
          "Use the switch at the top to move between Playing and Coaching when you use both workspaces.",
        ],
        images: [
          { src: "/showcase/coach-students-m.jpg", alt: "The complete Students roster in the coaching workspace", kind: "m" },
          { src: "/showcase/coach-student-t.jpg", alt: "A student page with lesson entries, shared matches, and roster controls", kind: "d" },
        ],
      },
      {
        heading: "Start in Coaching",
        paragraphs: [
          "Choose Coaching when PongLens asks how you use the product. If you already use PongLens as a player, switch into Coaching from the control at the top; your Playing workspace remains separate.",
        ],
        images: [
          { src: "/learn/audience-switch-d.jpg", alt: "Coach Learn with the Playing and Coaching library control", kind: "d" },
          { src: "/learn/audience-switch-m.jpg", alt: "The Coaching Learn library selected on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Know where to look",
        bullets: [
          "Coach Home brings recent students, lesson entries, and shared matches back into reach.",
          "Students is the complete roster, including students who have not connected an account.",
          "A student's page keeps your private lesson record beside the matches that student has chosen to share.",
        ],
      },
    ],
  },
  {
    slug: "add-connect-student",
    title: "Add and connect a student",
    summary: "Start a student record now and connect their account when they are ready.",
    group: "Get started",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["coaching-workspace", "keep-lesson-entries"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open Students, choose Add a student, and enter their name.",
          "Keep lesson entries on the new student even if they do not have a PongLens account.",
          "When they are ready, send the invite link from their student page.",
          "After they connect, confirm whether you can see all their matches or only matches they share.",
        ],
        images: [
          { src: "/showcase/coach-add-student-m.jpg", alt: "The Add a student sheet", kind: "m" },
          { src: "/showcase/coach-invite-m.jpg", alt: "A student invite with match-access choices", kind: "m" },
        ],
      },
      {
        heading: "Connect the student's account",
        paragraphs: [
          "The invite attaches the student's account to the name and history already on your roster. The student chooses All matches or Only matches I share; this controls only your access to their matches.",
          "Copy the current invite again when they need it. Reset the invite link if the old link reached the wrong person or should no longer work.",
        ],
      },
      {
        heading: "Keep the roster tidy",
        bullets: [
          "Rename a student when their roster name needs correcting.",
          "Merge a connected duplicate when the same person appears in two rows. Keep the connected account together with the lesson history you already entered.",
          "Remove a student from the active roster without deleting the historical entries you kept for them.",
        ],
      },
    ],
  },
  {
    slug: "keep-lesson-entries",
    title: "Keep lesson entries",
    summary: "Capture what happened in a lesson and shape it into useful next steps.",
    group: "Lesson entries",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["audio-record-lesson", "share-coach-entry"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a student and choose New entry.",
          "Type, paste, or dictate what you worked on.",
          "Add a photo or include a useful web link, then link the entry to a match when it refers to one.",
          "Choose Improve with AI, review the prepared notes, and save the entry.",
        ],
        images: [
          { src: "/showcase/coach-entry-compose-m.jpg", alt: "A new coach lesson entry with dictation, photo, and Improve with AI controls", kind: "m" },
        ],
      },
      {
        heading: "Prepare the lesson notes",
        paragraphs: [
          "Improve with AI turns rough notes into clear points without replacing the original words. Edit either the original text or the prepared notes before you save.",
          "Link the entry to one of the student's matches when the lesson refers to that footage. The relationship stays with the entry.",
        ],
      },
      {
        heading: "Update the record later",
        paragraphs: [
          "Open an entry to edit its words, prepared notes, attachments, link, or related match. Delete an entry when it should no longer be part of the student's coaching record.",
        ],
      },
    ],
  },
  {
    slug: "audio-record-lesson",
    title: "Record a lesson on iPhone",
    summary: "Capture lesson audio and review the resulting entry before saving it.",
    group: "Lesson entries",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["keep-lesson-entries", "share-coach-entry"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "On iPhone, choose Audio record a lesson and select the student.",
          "Put the phone near the table where it can hear the session, then start recording.",
          "Pause when the lesson stops and resume when it starts again.",
          "Choose Finish, then review the transcript and prepared notes.",
          "Correct the entry and save it under the student.",
        ],
        images: [
          { src: "/showcase/coach-record-m.jpg", alt: "The iPhone audio lesson recorder ready to start", kind: "m" },
        ],
      },
      {
        heading: "Place the phone for clear audio",
        paragraphs: [
          "Keep the iPhone close enough to hear both sides of the lesson without putting it in the playing area. Reduce music and other nearby noise when you can.",
        ],
      },
      {
        heading: "Pause, resume, and finish",
        paragraphs: [
          "Start the recording when the session begins. Pause during a break, then resume the same lesson afterwards. Finish closes the recording and prepares the transcript and main lesson points.",
        ],
      },
      {
        heading: "Review before saving",
        paragraphs: [
          "Read the transcript, then review the prepared notes. Correct names, terms, and lesson points while the session is fresh. Save only after the entry says what you want kept under the student.",
        ],
      },
    ],
  },
  {
    slug: "share-coach-entry",
    title: "Share an entry with a student",
    summary: "Send one lesson entry to a student's Journal or share that entry by link.",
    group: "Lesson entries",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["keep-lesson-entries", "audio-record-lesson"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open the finished lesson entry.",
          "For a connected student, choose Share with to send it into their Journal.",
          "For a student who is offline, create a public link to this individual entry.",
          "Return to the entry when you need to update it, stop sharing, reset the link, or revoke access.",
        ],
        images: [
          { src: "/showcase/coach-entry-shared-m.jpg", alt: "A shared lesson entry with Stop sharing, Edit, and Copy link controls", kind: "m" },
        ],
      },
      {
        heading: "Share with a connected student",
        paragraphs: [
          "Direct sharing places the entry in the connected student's Journal. If you edit the shared entry later, their version updates too. Stop sharing when it should no longer appear there.",
        ],
        images: [
          { src: "/learn/coach-direct-share-d.jpg", alt: "A connected student's lesson entry ready to share directly", kind: "d" },
          { src: "/learn/coach-direct-share-m.jpg", alt: "Share with student controls on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Share one entry by public link",
        paragraphs: [
          "A public link is useful when the student does not have an account. It opens only the individual entry and does not expose the rest of the student's coaching record.",
          "Copy the link again while it remains active. Reset it when you want a replacement, or revoke public access when nobody should be able to open it.",
        ],
        images: [
          { src: "/learn/coach-public-entry-link-d.jpg", alt: "An active public journal entry link in Account", kind: "d" },
          { src: "/learn/coach-public-entry-link-m.jpg", alt: "Public entry link management on a phone", kind: "m", phoneTwin: true },
        ],
      },
    ],
  },
  {
    slug: "review-student-match",
    title: "Review a student's match",
    summary: "Study a shared match without changing the player's work.",
    group: "Match feedback",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["leave-match-feedback", "coaching-workspace"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open a student and choose one of the matches they shared.",
          "Watch the cut match or open Original for the upload exactly as the player sent it.",
          "Move point by point and follow the score the player recorded.",
          "Open Match analysis and placement maps when you need the player's wider read of the match.",
        ],
        images: [
          { src: "/showcase/coach-shared-match-m.jpg", alt: "A connected student's shared match in the coaching roster", kind: "m" },
          { src: "/learn/coach-point-feedback-d.jpg", alt: "A coach reviewing a student's point and its feedback controls", kind: "d" },
          { src: "/learn/coach-point-feedback-m.jpg", alt: "A student's point with coach feedback controls on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Use the same evidence as the player",
        paragraphs: [
          "The cut removes the time between rallies, while Original keeps the complete upload. Open individual points to connect an observation to the exact rally.",
          "The score, match analysis, and placement maps reflect the player's scoring and processing choices.",
        ],
      },
      {
        heading: "Know the access boundary",
        paragraphs: [
          "The match remains the player's. A coach cannot change scores, clips, match details, analysis answers, or placement results. If the student changes your match access, the list on their page updates to match that choice.",
        ],
      },
    ],
  },
  {
    slug: "leave-match-feedback",
    title: "Leave feedback on a match",
    summary: "Put written, spoken, and drawn feedback beside the footage it explains.",
    group: "Match feedback",
    visibility: { audiences: ["coach"], platforms: ["web", "ios"] },
    related: ["review-student-match", "share-coach-entry"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open the point that shows what you want to explain.",
          "Write a point note or record a spoken note on that rally.",
          "Pause on a useful frame and draw on it when the picture helps.",
          "Use Overall notes for feedback that applies across the match.",
        ],
        images: [
          { src: "/learn/coach-point-feedback-d.jpg", alt: "Coach feedback controls tied to one point", kind: "d" },
          { src: "/learn/coach-point-feedback-m.jpg", alt: "Point feedback controls on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Keep feedback on the moment",
        paragraphs: [
          "A written or spoken point note stays tied to that rally. A drawing captures the paused frame and remains attached to the note, so the student can see the moment you meant.",
        ],
      },
      {
        heading: "Use Overall notes for larger themes",
        paragraphs: [
          "Overall notes are for ideas that span several points, such as serve selection or recovery position. The student receives your feedback with the match, and point notes and overall notes also reach their Journal.",
        ],
        images: [
          { src: "/learn/coach-overall-feedback-d.jpg", alt: "Overall notes below a student's match analysis", kind: "d" },
          { src: "/learn/coach-overall-feedback-m.jpg", alt: "The coach's Overall notes composer on a phone", kind: "m", phoneTwin: true },
        ],
      },
    ],
  },
  {
    slug: "setup-paid-reviews",
    title: "Set up paid match reviews",
    summary: "Publish an optional review offering with clear terms and availability.",
    group: "Paid reviews",
    visibility: { audiences: ["coach"], platforms: ["web"] },
    related: ["complete-paid-review"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open your Coach page and create an offering.",
          "Describe the review scope, set the price and turnaround, and list what the player receives.",
          "Set your availability and connect payments before publishing.",
          "Preview the offering, then make it available when the terms are accurate.",
        ],
        images: [
          { src: "/showcase/coach-offering-d.jpg", alt: "The coach offering editor with scope, price, and turnaround", kind: "d" },
          { src: "/showcase/coach-offering-m.jpg", alt: "Paid-review offering details on a phone", kind: "m", phoneTwin: true },
        ],
      },
      {
        heading: "Define the offering",
        paragraphs: [
          "Explain the matches you accept, the questions or information you need, the written sections and attachments you include, and the number of follow-ups. Set a price and turnaround that match that scope.",
        ],
      },
      {
        heading: "Control availability and payments",
        paragraphs: [
          "Pause availability when you cannot take another order. Keep the payment connection current so accepted and delivered orders can move through payout.",
        ],
        tip: "Paid match reviews are optional web functionality. You can use the coaching workspace without publishing an offering.",
      },
    ],
  },
  {
    slug: "complete-paid-review",
    title: "Complete a paid review",
    summary: "Accept an order, connect findings to rallies, and deliver the included work.",
    group: "Paid reviews",
    visibility: { audiences: ["coach"], platforms: ["web"] },
    related: ["setup-paid-reviews"],
    sections: [
      {
        heading: "Quick steps",
        steps: [
          "Open the order, read the student's brief, and accept it when the scope fits.",
          "Review the match point by point and tie each important finding to the rally that shows it.",
          "Write the included sections and add the attachments promised in the offering.",
          "Deliver the review, answer the included follow-up, and check the payout status on the order.",
        ],
        images: [
          { src: "/showcase/coach-order-m.jpg", alt: "A submitted paid-review order with the player's brief", kind: "m" },
        ],
      },
      {
        heading: "Accept with the brief in view",
        paragraphs: [
          "Read the student's questions, context, and submitted match before accepting. The order starts only after you accept it, so resolve a scope issue first.",
        ],
      },
      {
        heading: "Build and deliver the review",
        paragraphs: [
          "Move point by point and attach findings to the rallies that demonstrate them. Complete every written section and attachment included in your offering before delivery.",
          "After delivery, answer the follow-up included with the order. Payment and payout status remain visible on that order.",
        ],
        images: [
          { src: "/showcase/coach-points-d.jpg", alt: "A paid-review workspace with the student's rallies and findings", kind: "d" },
          { src: "/showcase/coach-writeup-m.jpg", alt: "The paid-review write-up sections on a phone", kind: "m", phoneTwin: true },
        ],
      },
    ],
  },
];
