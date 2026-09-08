# Lesson Recap Cloud Fallback Design

## Outcome

Lesson recaps run on the Mac Studio by default. Modal may process a lesson only when the lesson cloud switch is explicitly enabled and either:

- the Mac lesson worker has not reported for 15 minutes and the oldest queued lesson has waited at least 30 minutes; or
- the oldest queued lesson has waited at least 3 hours, which is the overload threshold.

The cloud switch remains disabled during this change, and the deployed Modal apps remain stopped so they incur no recurring compute cost. A database claim must enforce the rule even if a caller bypasses the dispatcher.

## Dispatch and cost

The scheduled Modal function is a small dispatcher: 0.125 CPU, 128 MiB memory, a five-minute period, and a two-second scale-down window. It asks one aggregate database RPC whether cloud work is allowed. It does not load media tools, report a worker heartbeat, claim a lesson, or process media.

Only an affirmative dispatch decision launches the existing 4-CPU, 8-GiB lesson worker. The expensive worker has no schedule, rechecks the database rule when it claims, and remains limited to one container and one input.

## Release and safety

The dispatcher is sealed in the same immutable lesson release as the Mac and cloud processing code. The database requires the requested release to be the enabled lesson release. Existing leases, deletion locks, bounded lease recovery, source retention, and publication behavior remain unchanged.

Cloud processing stays off until the same sealed release is installed on the Mac and Modal and the operator deliberately enables it.

## Operations surface

The Processing page reads the lesson cloud switch. While it is disabled, the cloud lesson row says `Off` even if historical cloud heartbeats exist. It no longer describes an every-minute cloud poll or count ephemeral containers.

## Verification

Automated checks cover disabled cloud, healthy Mac with a fresh queue, Mac outage with a 30-minute wait, a three-hour overload, dispatcher refusal, dispatcher launch, release sealing, and the Processing page's disabled state. Deployment verification checks that production cloud processing remains disabled and that no expensive scheduled lesson function exists. No upload is processed as part of this change.
