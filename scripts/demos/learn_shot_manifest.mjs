export const REQUIRED_LEARN_SHOT_STATES = [
  "audience-switch",
  "player-highlights",
  "original-video",
  "missed-rally-restoration",
  "placement-retry",
  "placement-current",
  "journal-current",
  "journal-ask",
  "journal-recollect",
  "coach-direct-share",
  "coach-public-entry-link",
  "coach-point-feedback",
  "coach-overall-feedback",
];

const pair = (stem, guide = true) => ({
  desktop: { shot: `${stem}-d`, ...(guide ? { guideImage: `/learn/${stem}-d.jpg` } : {}) },
  mobile: { shot: `${stem}-m`, ...(guide ? { guideImage: `/learn/${stem}-m.jpg` } : {}) },
});

export const learnShotManifest = [
  { state: "audience-switch", status: "captured", reason: "Approved dual-role coach account; switching is not performed.", variants: pair("audience-switch") },
  { state: "player-highlights", status: "captured", reason: "Approved player match; the chooser is opened without exporting.", variants: pair("highlights") },
  { state: "original-video", status: "staging-required", reason: "No approved ready match retains raw_path for Original.", variants: pair("original", false) },
  { state: "missed-rally-restoration", status: "staging-required", reason: "No approved retained Original has a genuine source-time gap eligible for Add a missing rally.", variants: pair("restore-rally", false) },
  { state: "placement-retry", status: "staging-required", reason: "No approved match currently has an unused retry_available grant.", variants: pair("placement-retry", false) },
  { state: "placement-current", status: "staging-required", reason: "The approved player's current aggregate is honest but empty; a populated current map needs an approved staged match.", variants: pair("placement-current", false) },
  { state: "journal-current", status: "captured", reason: "Approved player Journal in its current search-and-discovery state.", variants: pair("journal-current") },
  { state: "journal-ask", status: "captured", reason: "Approved player Journal with a local draft query; Ask is not submitted.", variants: pair("journal-ask") },
  { state: "journal-recollect", status: "captured", reason: "Approved player Journal; existing topics are opened read-only.", variants: pair("journal-recollect") },
  { state: "coach-direct-share", status: "staging-required", reason: "No approved connected student has an unshared lesson entry; the only unshared entry belongs to an offline student.", variants: pair("coach-direct-share", false) },
  { state: "coach-public-entry-link", status: "staging-required", reason: "No approved coach entry has an active public link; opening the entry share sheet would mint one.", variants: pair("coach-public-entry-link", false) },
  { state: "coach-point-feedback", status: "captured", reason: "Approved connected student's already-shared match; no feedback is entered.", variants: pair("coach-point-feedback") },
  { state: "coach-overall-feedback", status: "captured", reason: "Approved connected student's already-shared match; no feedback is entered.", variants: pair("coach-overall-feedback") },
];
