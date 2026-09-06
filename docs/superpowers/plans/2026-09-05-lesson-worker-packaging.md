# Bounded lesson worker packaging implementation

Authorized scope: build one immutable lesson-only bundle; stage a separate Mac
venv/config/disabled plist; explicit activation later; optional thin Modal
wrapper; never alter match worker or start processing during implementation.

1. Add failing tests for source tampering, default-disabled isolated service,
   and private runtime credential handling.
2. Implement content-addressed payload build/verify, pinned dependency runtime,
   executable/dependency verification, and isolated launcher.
3. Add optional Modal adapter using the same payload and lock, no deployment.
4. Test an actual temporary staged installation and no-network --check;
   document exact operational commands and limitations.
5. Commit only packaging, lock, tests and runbook. Parent owns final source
   release, deployment permission and activation.
