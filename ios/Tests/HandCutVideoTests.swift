import Foundation

/// Hand cut on iPhone (spec 2026-09-24): the segment plan arithmetic the
/// encoder runs on, the rollout gates, and the index of videos the phone
/// keeps. Pure Foundation, so it runs here without a simulator. What it
/// cannot cover (the encoder itself, Photos, background tasks) needs a
/// real iPhone.
func runHandCutChecks() {
    print("\n— hand cut on iPhone: plan, gates, kept videos —")

    // MARK: Synthetic plan: 20 s on, 20 s off

    eq(HandCutPlan.alternating(duration: 100),
       [TimeWindow(start: 0, end: 20), TimeWindow(start: 40, end: 60), TimeWindow(start: 80, end: 100)],
       "100 s keeps three whole pieces")
    eq(HandCutPlan.alternating(duration: 95),
       [TimeWindow(start: 0, end: 20), TimeWindow(start: 40, end: 60), TimeWindow(start: 80, end: 95)],
       "a short last piece is kept to the end of the video")
    eq(HandCutPlan.alternating(duration: 40.5),
       [TimeWindow(start: 0, end: 20)],
       "a last piece under a second is dropped, not encoded as a sliver")
    eq(HandCutPlan.alternating(duration: 41),
       [TimeWindow(start: 0, end: 20), TimeWindow(start: 40, end: 41)],
       "a last piece of exactly a second is kept")
    eq(HandCutPlan.alternating(duration: 12),
       [TimeWindow(start: 0, end: 12)],
       "a video shorter than one piece is one piece")
    eq(HandCutPlan.alternating(duration: 0), [], "an empty video has no plan")
    eq(HandCutPlan.alternating(duration: .nan), [], "an unreadable length has no plan")
    let fortyFive = HandCutPlan.alternating(duration: 45 * 60)
    eq(fortyFive.count, 68, "a 45-minute match is 68 pieces")
    near(HandCutPlan.cutDuration(for: fortyFive), 1360, "and keeps 22:40")

    // MARK: Normalising a plan before the composition sees it

    eq(HandCutPlan.normalized(
        [TimeWindow(start: 50, end: 70), TimeWindow(start: -3, end: 10), TimeWindow(start: 8, end: 20)],
        duration: 60),
       [TimeWindow(start: 0, end: 20), TimeWindow(start: 50, end: 60)],
       "sorted, clamped to the file, overlaps merged")
    eq(HandCutPlan.normalized(
        [TimeWindow(start: 0, end: 10), TimeWindow(start: 10, end: 20)], duration: 60),
       [TimeWindow(start: 0, end: 20)],
       "touching pieces become one: no second of the video is inserted twice")
    eq(HandCutPlan.normalized([TimeWindow(start: 70, end: 80), TimeWindow(start: 5, end: 5)], duration: 60),
       [], "pieces past the end or empty are dropped")

    // MARK: Where each piece starts on the cut's clock

    let plan = HandCutPlan.alternating(duration: 95)
    let starts = HandCutPlan.cutStarts(for: plan)
    eq(starts.count, 3, "one start per piece")
    near(starts[0], 0, "first piece starts the cut")
    near(starts[1], 20, "second starts where the first ends")
    near(starts[2], 40, "third after both")
    near(HandCutPlan.cutDuration(for: plan), 55, "cut length is the kept total")
    eq(HandCutPlan.cutStarts(for: []), [], "no pieces, no starts")

    // MARK: Keyframes: 60 frames, the duration consistent with it

    near(HandCutPlan.keyframeSeconds(fps: 30), 2, "60 frames at 30 fps is 2 s")
    near(HandCutPlan.keyframeSeconds(fps: 60), 1, "60 frames at 60 fps is 1 s")
    near(HandCutPlan.keyframeSeconds(fps: 29.97), 60 / 29.97, "NTSC rate kept exact")
    near(HandCutPlan.keyframeSeconds(fps: 0), 2, "no frame rate reads as 30")

    // MARK: Clip size: 720 wide as displayed, height even

    let landscape = HandCutPlan.clipEncodedSize(naturalWidth: 1920, naturalHeight: 1080, rotated: false)
    eq([landscape.width, landscape.height], [720, 406], "1080p landscape is 720x406 (405 rounded to even)")
    let fourK = HandCutPlan.clipEncodedSize(naturalWidth: 3840, naturalHeight: 2160, rotated: false)
    eq([fourK.width, fourK.height], [720, 406], "4K the same")
    let portrait = HandCutPlan.clipEncodedSize(naturalWidth: 1920, naturalHeight: 1080, rotated: true)
    eq([portrait.width, portrait.height], [1280, 720],
       "a quarter-turned file encodes 1280x720 on its side, shown 720 wide")
    let fourThree = HandCutPlan.clipEncodedSize(naturalWidth: 1440, naturalHeight: 1080, rotated: false)
    eq([fourThree.width, fourThree.height], [720, 540], "4:3 keeps its aspect")
    check(HandCutPlan.clipEncodedSize(naturalWidth: 1000, naturalHeight: 333, rotated: false).height % 2 == 0,
          "an odd height is rounded to even")

    // MARK: Bitrate from bits per pixel

    eq(HandCutPlan.bitrate(width: 1920, height: 1080, fps: 60), 12_441_600, "1080p60 at 0.1 bpp")
    eq(HandCutPlan.bitrate(width: 1920, height: 1080, fps: 30), 6_220_800, "1080p30 at 0.1 bpp")
    eq(HandCutPlan.bitrate(width: 10, height: 10, fps: 30), 500_000, "never below half a megabit")

    // MARK: Rollout gates

    check(!DeviceVideoGate.recordingsToPhotos(configValue: nil, handCut: true), "unreadable config is off")
    check(!DeviceVideoGate.recordingsToPhotos(configValue: "off", handCut: true), "off is off, even for admins")
    check(DeviceVideoGate.recordingsToPhotos(configValue: "admins", handCut: true), "admins: a hand-cut account saves")
    check(!DeviceVideoGate.recordingsToPhotos(configValue: "admins", handCut: false), "admins: everyone else does not")
    check(DeviceVideoGate.recordingsToPhotos(configValue: "on", handCut: false), "on: everyone saves")
    check(DeviceVideoGate.recordingsToPhotos(configValue: "\"on\"", handCut: false), "a JSON-quoted value reads the same")
    check(!DeviceVideoGate.recordingsToPhotos(configValue: "yes", handCut: true), "an unknown word is off")
    check(DeviceVideoGate.keepsWorkingCopy(handCut: true, processingRequested: false),
          "hand-cut account, no automatic processing: keep")
    check(!DeviceVideoGate.keepsWorkingCopy(handCut: true, processingRequested: true),
          "automatic processing asked for: nothing to mark, delete as today")
    check(!DeviceVideoGate.keepsWorkingCopy(handCut: false, processingRequested: false),
          "everyone else: delete as today")

    // MARK: The kept-video index

    let owner = UUID()
    let other = UUID()
    let m1 = UUID(), m2 = UUID(), m3 = UUID(), m4 = UUID()
    let t0 = Date(timeIntervalSince1970: 1_790_000_000)
    func entry(_ id: UUID, _ who: UUID, _ name: String, _ offset: Double) -> LocalVideoEntry {
        LocalVideoEntry(matchId: id, ownerId: who, fileName: name, bytes: 1_000,
                        createdAt: t0.addingTimeInterval(offset), title: nil, detail: nil)
    }
    var index = LocalVideoIndex()
    eq(index.upsert(entry(m1, owner, "a.mov", 0)), nil, "first copy of a match replaces nothing")
    index.upsert(entry(m2, owner, "b.mp4", 10))
    index.upsert(entry(m3, other, "c.mov", 20))
    eq(index.upsert(entry(m1, owner, "a2.mov", 30)), "a.mov",
       "a second copy of the same match hands back the old file to delete")
    eq(index.entries.count, 3, "still one entry per match")
    eq(index.entries(owner: owner).map(\.matchId), [m1, m2], "one account's copies, newest first")
    eq(index.entries(owner: other).map(\.matchId), [m3], "another account's copies stay theirs")

    // Round trip through the file format.
    let decoded = LocalVideoIndex.decode(try? index.encoded())
    eq(decoded, index, "the index survives a write and a read")
    eq(LocalVideoIndex.decode(Data("not json".utf8)), LocalVideoIndex(), "a damaged index reads as empty")
    eq(LocalVideoIndex.decode(nil), LocalVideoIndex(), "a missing index reads as empty")

    // Files and entries that disagree.
    eq(index.orphans(in: ["a2.mov", "b.mp4", "c.mov", "stray.mov", "index.json", ".DS_Store"]),
       ["stray.mov"], "only a file nothing points at is an orphan")
    eq(index.missingFiles(present: ["a2.mov", "c.mov"]), [m2], "an entry whose file is gone is noticed")

    index.setTitle("vs Julian", detail: "Sep 24, 2026 · Match", for: m1)
    eq(index.entry(for: m1)?.title, "vs Julian", "titles catch up from the server")
    eq(index.remove(matchId: m2)?.fileName, "b.mp4", "removing hands back the file to delete")
    eq(index.remove(matchId: m2), nil, "removing twice is harmless")

    // MARK: Reconciling with the server

    let mine = [entry(m1, owner, "a.mov", 0), entry(m2, owner, "b.mov", 1),
                entry(m3, owner, "c.mov", 2), entry(m4, other, "d.mov", 3)]
    let doomed = LocalVideoReconcile.doomed(
        entries: mine, owner: owner,
        rows: [m1: "uploaded", m2: "ready", m4: "ready"], now: t0, marked: [:], inUse: [])
    eq(Set(doomed), Set([m2, m3]),
       "ready goes, a match the owner cannot find goes, uploaded stays, another account's is never touched")
    eq(LocalVideoReconcile.doomed(entries: mine, owner: owner,
                                  rows: [m1: "processing", m2: "failed", m3: "uploaded"],
                                  now: t0, marked: [:], inUse: []),
       [], "processing and failed keep their copy")

    // MARK: Fourteen days (post-rollout audit P)

    let day = 86_400.0
    let fortnight = t0.addingTimeInterval(14 * day)
    let waiting: [UUID: String] = [m1: "uploaded", m2: "uploaded", m3: "failed"]
    let kept = [entry(m1, owner, "a.mov", 0), entry(m2, owner, "b.mov", 0), entry(m3, owner, "c.mov", 0)]
    eq(LocalVideoReconcile.doomed(entries: kept, owner: owner, rows: waiting,
                                  now: t0.addingTimeInterval(14 * day - 1),
                                  marked: [m1: false, m2: false, m3: false], inUse: []),
       [], "a second short of 14 days, nothing goes")
    eq(Set(LocalVideoReconcile.doomed(entries: kept, owner: owner, rows: waiting, now: fortnight,
                                      marked: [m1: false, m2: false, m3: false], inUse: [])),
       Set([m1, m2, m3]), "14 days after keeping, nobody marking: the copies go")
    eq(LocalVideoReconcile.doomed(entries: kept, owner: owner, rows: waiting, now: fortnight,
                                  marked: [m1: true, m2: false, m3: true], inUse: []),
       [m2], "marking started keeps a copy however old")
    eq(LocalVideoReconcile.doomed(entries: kept, owner: owner, rows: waiting, now: fortnight,
                                  marked: [m2: false], inUse: []),
       [m2], "a copy whose marking was not read counts as marked and stays")
    eq(LocalVideoReconcile.doomed(entries: kept, owner: owner, rows: waiting, now: fortnight,
                                  marked: [m1: false, m2: false, m3: false], inUse: [m1, m3]),
       [m2], "never while a phone cut reads it or the marker has it open")
    eq(LocalVideoReconcile.doomed(entries: kept, owner: owner, rows: [m1: "ready"], now: t0,
                                  marked: [:], inUse: [m1, m2]),
       [m3], "in use outranks a ready or missing match too")
    eq(LocalVideoReconcile.doomed(entries: [entry(m4, other, "d.mov", 0)], owner: owner,
                                  rows: [m4: "uploaded"], now: fortnight, marked: [m4: false], inUse: []),
       [], "another account's old copy is still never touched")
    check(LocalVideoReconcile.expired(entry(m1, owner, "a.mov", 0), now: fortnight),
          "14 days to the second is expired")
    check(!LocalVideoReconcile.expired(entry(m1, owner, "a.mov", 0), now: t0.addingTimeInterval(13 * day)),
          "13 days is not")

    // The reads folded into one answer. Any mark or job is marked; nothing
    // found only when every read answered; a failed read is marked.
    check(!LocalVideoReconcile.marked(serverMarks: 0, phoneMarks: 0, handCutJob: false),
          "no draft marks, no phone marks, no job: not marked")
    check(LocalVideoReconcile.marked(serverMarks: 1, phoneMarks: 0, handCutJob: false), "a server mark")
    check(LocalVideoReconcile.marked(serverMarks: 0, phoneMarks: 3, handCutJob: false), "a mark in the phone's copy")
    check(LocalVideoReconcile.marked(serverMarks: 0, phoneMarks: 0, handCutJob: true), "a hand-cut job")
    check(LocalVideoReconcile.marked(serverMarks: nil, phoneMarks: 0, handCutJob: false),
          "the draft read failed: marked")
    check(LocalVideoReconcile.marked(serverMarks: 0, phoneMarks: nil, handCutJob: false),
          "the phone's copy could not be read: marked")
    check(LocalVideoReconcile.marked(serverMarks: 0, phoneMarks: 0, handCutJob: nil),
          "the job read failed: marked")
    check(LocalVideoReconcile.marked(serverMarks: nil, phoneMarks: 2, handCutJob: nil),
          "a mark found beside a failed read: marked")
}
