# Rally prediction review

Apply the frozen September 23 sequence last-bounce choices and hybrid winner scores to all 479 research points as a separate immutable suggestion run. Preserve every human answer and the previous suggestion run. Keep research-only predictions separate from match scores.

Use the shipped PointEndingReview card, BounceDetails and amber SuggestionHint treatment as the visual reference (render and source inspected). Add a compact experiment section inside the existing point card, a jump to the candidate, explicit confirmation or keeping the current mark, and a next-unreviewed filter. Record run-specific review provenance in the existing revisioned label. Unknown choices remain unknown. Inferred candidates identify a frame and only create a user bounce after explicit confirmation.

Winner confidence is the frozen hybrid model score and its whole-recording-selected cutoff, not calibrated accuracy. Sequence agreement is the weighted support for the candidate among retained histories, not a correctness probability. Preserve the prior baseline winner separately when it is the combined decision source; never attach the hybrid confidence to a baseline decision.

Verify payload mapping and clock offsets, frozen prediction parity, explicit saves and corrections, old-client preservation, label/history digests before/after insert, research tests, full build and rendered desktop/393x660 mobile states. Prepare screenshots for user review before UI publication, per root visual gate. Worker and native iOS are unaffected.
