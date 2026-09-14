# Scorekeeper release checks

Use the new TestFlight build identified in the release message, and reload www.ponglens.com on desktop and mobile before testing. Use a spare match or record the original scores so you can undo your test changes. The two live-playback checks are the outstanding native acceptance tests; the automation could not keep the app continuously active.

| Check | What to do | Expected result |
| --- | --- | --- |
| Current interface | Open the scorekeeper on your phone and the website. | The serve toggle remains present. Existing Add controls and layout have not been redesigned. |
| Live first score at1× | Choose an unanswered rally long enough to watch for a few seconds. Replay from its beginning at1×, keep the app on screen, and tap the winner while the picture is still moving, before the automatic pause. Then view that rally in ordinary Watch. | The winner saves. Ordinary Watch uses the live-tap ending with its normal short buffer. Keep score may still play the whole card; that is intentional. |
| Live first score at2× | Use a different unanswered rally. Select2× first, close the speed control, replay from the beginning, and score while the picture is moving. Check it in ordinary Watch. | Same result as1×; playing faster must not lose the ending. |
| Paused first score | On another unanswered rally, pause manually midway and then choose the winner. | The winner saves, but ordinary Watch must not acquire a new ending at the paused position. It retains the existing ending/fallback. |
| Correct a winner | Return to a scored rally, replay or scrub to a clearly different position, and change the winner. | The score changes, but ordinary Watch ends at the same place as before the correction. The correction must not trim to the new playhead. |
| Clear and Undo | On a scored rally, tap its selected winner again to clear it; then press Undo once. | The score and prior ending return together. Ordinary Undo can replay the restored rally. |
| Skip and Undo | Skip a scored rally, then press Undo once. | The rally is counted again with its prior winner and ending. |
| Undo after leaving playback | Make a score change, tap Undo, then immediately open Gestures or close the player. | The restoration may finish, but must not restart playback behind the sheet or reopen the closed player. |

If a check fails, send the platform/build, match and rally number, what you pressed, and what happened. A short screen recording is useful, especially for the1× and2× checks. Do not treat the intentional whole-card scorekeeper playback as a failure of ordinary Watch trimming.
