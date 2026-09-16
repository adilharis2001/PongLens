# Storage counts everything: build 205

Released September 14, 2026 from `38713d41` on main, which carries the
storage accounting work in `e9b660a0`, its two corrections in `653e32a1`,
and the zero-row change in the build commit itself.

- Everything an account stores now counts toward its allowance: match
  videos and cut versions, lesson videos and recaps, point clips, reels,
  voice notes, sketches, photos and a coach's review files. Feedback
  screenshots and QA attachments are the platform's and stay out.
- Allowances: 25 GB for every ordinary account, 100 GB for accounts tagged
  team or test in the admin players list, the owner's grant unchanged. The
  tag moves the allowance when it changes.
- The buckets are measured every night by the web app's scheduled job and
  written per account; used space is that measurement plus whatever was
  booked since. The admin storage page shows measured against the running
  tally for every account, with a Measure now button.
- Every upload route checks the allowance before accepting a file and
  refuses with the sentence both apps already recover from. Coach photo,
  offering image, review attachments and review voice notes now book their
  bytes. Review attachments are deleted through the route from both apps,
  so the file goes with the row.
- iOS: the Account page says everything counts and shows last night's
  breakdown by kind, leaving out kinds that would read 0.0 GB; a storage
  line sits beside the lesson video import; review attachment removal goes
  through the route.
- Web: the same Account section and breakdown, a storage line beside the
  lesson video import, the Terms updated, and the admin storage page.
- Match deletion removes every reel cut from the match (starred, full,
  per-tag, highlights and vertical share renders); it named two before and
  left 23 highlight reels (2.9 GB) behind, which were removed by hand.
- Incident: the first version of the new allowance function failed on every
  call for about 25 minutes on September 14 (an ambiguous column name inside
  the function), which refused uploads with "could not check your storage
  allowance" until migration `20260914233000` corrected it.
- Verified: full Next.js production build on the shipped tree; the storage
  inventory, cost and review unit tests; the iOS Debug build for the
  simulator; the allowance function called as a real user and from inside
  the live Account page; two production measurements (17,517 then 17,686
  files, 310 then 309 GB, nobody over their limit).

Archive: `/tmp/PongLens-storage-1.0-205.xcarchive`.
Build log: `/tmp/ponglens-storage-205-archive.log`.
Upload log: `/tmp/ponglens-storage-205-export.log`.

Not verified: the rendered Account screen on a phone or in a browser with a
fresh sign-in, Apple's processing of build 205, and TestFlight review.
