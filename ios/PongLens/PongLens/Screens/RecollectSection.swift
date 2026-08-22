import SwiftUI

/// The journal's Recollect section: topics the account holds points for,
/// longest-unopened first, each opening into a handful of points. A port
/// of the web journal's Recollect module, one state for one.
struct RecollectSection: View {
    let journal: JournalStore
    /// Brings the journal to the entry a revealed point came from.
    var onOpenSource: (RecollectSource) -> Void

    @State private var store = RecollectStore()
    @State private var attempt = 0

    var body: some View {
        Group {
            if store.failed {
                errorCard
            } else if let view = store.view {
                content(view)
            } else {
                skeleton
            }
        }
        .task(id: attempt) { await store.load() }
    }

    // MARK: - States

    private var skeleton: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .fill(PL.surface)
                    .frame(height: 80)
                    .opacity(0.6)
            }
        }
    }

    private var errorCard: some View {
        VStack(spacing: 12) {
            Text("Recollect couldn't load.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            Button("Try again") { attempt += 1 }
                .buttonStyle(PLSecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 24)
    }

    @ViewBuilder
    private func content(_ view: RecollectViewState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if !view.noticeSeen {
                notice
            }
            if view.topics.isEmpty {
                emptyCard(processing: view.processing)
            } else {
                ForEach(view.topics) { topic in
                    topicCard(topic)
                }
            }
        }
    }

    private var notice: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("Recollect groups what your lessons and practice notes covered by topic, so you can come back to it. You can turn it off in Account.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .lineSpacing(3)
            Button("Got it") {
                Task { await store.acknowledge() }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(PL.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(PL.cyan, in: Capsule())
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(PL.cyan.opacity(0.06), in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.cyan.opacity(0.25), lineWidth: 1)
        )
    }

    private func emptyCard(processing: Bool) -> some View {
        VStack(spacing: 10) {
            if processing {
                ProgressView()
                    .tint(PL.cyan)
                Text("Sorting your notes into topics…")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.text300)
            } else {
                Text("No topics yet")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.text300)
                Text("Save a lesson or a practice note and what it covered shows up here, grouped by topic.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 32)
    }

    // MARK: - Topics

    private func topicCard(_ topic: RecollectTopicRow) -> some View {
        let points = store.opened[topic.id]
        let isBusy = store.busy.contains(topic.id)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                Task { await store.openTopic(topic) }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(topic.label)
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(PL.text100)
                        Text(topicMeta(topic))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    Spacer()
                    if points == nil {
                        HStack(spacing: 6) {
                            Text(isBusy ? "Opening…" : "Reveal")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PL.text500)
                    }
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isBusy || points != nil)

            if let points {
                Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                if points.isEmpty {
                    Text("Nothing left under this topic.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                        .padding(16)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(points.enumerated()), id: \.element.id) { index, point in
                            if index > 0 {
                                Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                            }
                            pointRow(point, topic: topic)
                        }
                        if topic.pointCount > points.count {
                            Text("\(topic.pointCount - points.count) more under this topic, next time.")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                                .padding(.bottom, 12)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
            if let topicNote = store.note[topic.id] {
                Text(topicNote)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
            }
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private func pointRow(_ point: RecollectRevealedPoint, topic: RecollectTopicRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(point.text)
                .font(.system(size: 16))
                .foregroundStyle(PL.text100)
                .lineSpacing(4)

            // The source gets its own line: sharing a row with two pill
            // buttons cut most lesson titles off mid-word on the web.
            Button {
                onOpenSource(point.source)
            } label: {
                Text(sourceTitle(point.source))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                if point.inWorkingOn {
                    Text("Working On")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(PL.text400)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                } else {
                    Button {
                        Task {
                            await store.addToWorkingOn(
                                topicId: topic.id, pointId: point.id, journal: journal
                            )
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "plus")
                                .font(.system(size: 11, weight: .bold))
                            Text("Add")
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.text200)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(store.busy.contains(point.id))
                }

                Button("Not useful") {
                    Task { await store.dismiss(topicId: topic.id, pointId: point.id) }
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(PL.text400)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                .buttonStyle(.plain)
                .disabled(store.busy.contains(point.id))

                Spacer(minLength: 0)
            }
            .padding(.top, 2)

            if let pointNote = store.note[point.id] {
                Text(pointNote)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.vertical, 14)
    }

    // MARK: - Labels

    /// "11 points from 3 entries · last opened Jul 20"
    private func topicMeta(_ topic: RecollectTopicRow) -> String {
        let points = "\(topic.pointCount) point\(topic.pointCount == 1 ? "" : "s")"
        let sources = "\(topic.lessonCount) \(topic.lessonCount == 1 ? "entry" : "entries")"
        let opened = topic.lastReviewedAt.map { "last opened \(monthDay($0))" } ?? "not opened yet"
        return "\(points) from \(sources) · \(opened)"
    }

    private func sourceTitle(_ source: RecollectSource) -> String {
        if let title = source.title, !title.isEmpty { return title }
        let kind = source.kind == "practice" ? "Practice" : "Lesson"
        return "\(kind) · \(monthDay(source.createdAt))"
    }

    /// "Aug 9" — no year. These labels sit in truncating rows, and a date
    /// cut off mid-year reads as broken.
    private func monthDay(_ iso: String) -> String {
        guard let date = PGDate.parse(iso) else { return "" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}
