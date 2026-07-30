# Serve Review Quarter-speed Design

**Status:** Approved by the user's explicit request on 2026-07-30

Every newly loaded serve-research video starts at 0.25× playback speed. The
player sets both `defaultPlaybackRate` and `playbackRate` after metadata loads,
before attempting follow-up autoplay. Native controls may change the rate
afterward. Autosave does not reapply or reset the rate because it does not
create a new media session.

Verification covers applying the playback defaults, existing stable-media
behavior, lint, and the production build.

