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
  { state: "original-video", status: "captured", reason: "Approved demo match with its known source temporarily retained; the takeover is opened without changing playback data.", variants: pair("original") },
  { state: "missed-rally-restoration", status: "captured", reason: "Approved demo source with a genuine pre-first-rally gap; the restoration sheet is opened without adding a card.", variants: pair("restore-rally") },
  { state: "placement-retry", status: "captured", reason: "Approved demo match temporarily given one unused retry; the confirmation sheet is opened without requesting processing.", variants: pair("placement-retry") },
  { state: "placement-current", status: "captured", reason: "Approved demo match temporarily given three trusted serve observations; current landing and heat maps are shown read-only.", variants: pair("placement-current") },
  { state: "journal-current", status: "captured", reason: "Approved player Journal in its current search-and-discovery state.", variants: pair("journal-current") },
  { state: "journal-ask", status: "captured", reason: "Approved player Journal with a local draft query; Ask is not submitted.", variants: pair("journal-ask") },
  { state: "journal-recollect", status: "captured", reason: "Approved player Journal; existing topics are opened read-only.", variants: pair("journal-recollect") },
  { state: "coach-direct-share", status: "captured", reason: "Disposable demo lesson entry for an approved connected student; the live Share with control is shown without sending it.", variants: pair("coach-direct-share") },
  { state: "coach-public-entry-link", status: "captured", reason: "Disposable active link for an approved offline-student entry; Account management is opened without copying or distributing it.", variants: pair("coach-public-entry-link") },
  { state: "coach-point-feedback", status: "captured", reason: "Approved connected student's already-shared match; no feedback is entered.", variants: pair("coach-point-feedback") },
  { state: "coach-overall-feedback", status: "captured", reason: "Approved connected student's already-shared match; no feedback is entered.", variants: pair("coach-overall-feedback") },
];
