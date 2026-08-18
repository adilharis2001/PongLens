import Foundation

// Mirrors src/lib/reviews/types.ts — the coach-side schema contract.
// Money is integer cents, USD. Status strings are the database vocabulary;
// coachOrderStatusLabel is the only place a state becomes copy.

enum ReviewOrderStatus: String, Codable {
    case awaitingPayment = "awaiting_payment"
    case awaitingSubmission = "awaiting_submission"
    case submitted
    case inReview = "in_review"
    case clarification
    case delivered
    case completed
    case declined
    case cancelled
}

struct IntakeQuestion: Codable, Hashable {
    let id: String
    let label: String
    let optional: Bool?
}

struct IntakeAnswer: Codable, Hashable {
    let id: String
    let label: String
    let answer: String
}

struct ReviewSectionDef: Codable, Hashable {
    let key: String
    let label: String
}

/// One section of the written review; body is plain text.
struct ReviewSectionContent: Codable, Hashable {
    let key: String
    let label: String
    var body: String
}

/// A link to the coach's play: any URL, or a minted match share link.
struct CoachSample: Codable, Hashable {
    var label: String
    var url: String
}

/// A block of the coach page they wrote themselves. Six at most.
struct CoachSection: Codable, Hashable {
    var title: String
    var body: String
}

struct CoachProfileRow: Codable, Hashable {
    let userId: UUID
    var handle: String
    var displayName: String
    var headline: String
    var bio: String
    var credentials: [String]
    var sections: [CoachSection]?
    var photoPath: String?
    var samples: [CoachSample]
    let stripeAccountId: String?
    var payoutCountry: String?
    let chargesEnabled: Bool
    let payoutsEnabled: Bool
    var acceptingOrders: Bool
    var maxActiveOrders: Int?
    var published: Bool

    enum CodingKeys: String, CodingKey {
        case handle, headline, bio, credentials, sections, samples, published
        case userId = "user_id"
        case displayName = "display_name"
        case photoPath = "photo_path"
        case stripeAccountId = "stripe_account_id"
        case payoutCountry = "payout_country"
        case chargesEnabled = "charges_enabled"
        case payoutsEnabled = "payouts_enabled"
        case acceptingOrders = "accepting_orders"
        case maxActiveOrders = "max_active_orders"
    }

    static let fullSelect =
        "user_id,handle,display_name,headline,bio,credentials,sections,photo_path,samples,stripe_account_id,payout_country,charges_enabled,payouts_enabled,accepting_orders,max_active_orders,published"
}

struct OfferingRow: Codable, Identifiable, Hashable {
    let id: UUID
    let coachId: UUID
    let templateKey: String
    var title: String
    var description: String
    var includes: [String]
    var priceCents: Int
    var turnaroundDays: Int
    var intakeQuestions: [IntakeQuestion]
    var reviewSections: [ReviewSectionDef]
    /// Pattern names shown to this coach in the workspace. Never to a student.
    var suggestedPatterns: [String]
    var followupRounds: Int
    /// 'stock:<key>' (shipped art) or an r2:// upload under offer/<uid>/.
    var image: String?
    var active: Bool
    let sort: Int
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, description, includes, image, active, sort
        case coachId = "coach_id"
        case templateKey = "template_key"
        case priceCents = "price_cents"
        case turnaroundDays = "turnaround_days"
        case intakeQuestions = "intake_questions"
        case reviewSections = "review_sections"
        case suggestedPatterns = "suggested_patterns"
        case followupRounds = "followup_rounds"
        case updatedAt = "updated_at"
    }

    static let fullSelect =
        "id,coach_id,template_key,title,description,includes,price_cents,turnaround_days,intake_questions,review_sections,suggested_patterns,followup_rounds,image,active,sort,updated_at"

    /// The /img/offerings/<key>.webp url for a 'stock:' image value.
    var stockImageURL: URL? {
        guard let image, image.hasPrefix("stock:") else { return nil }
        let key = String(image.dropFirst("stock:".count))
        guard key.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else { return nil }
        return AppConfig.apiBase.appendingPathComponent("img/offerings/\(key).webp")
    }
}

/// One row of coach_queue().
struct CoachQueueItem: Codable, Identifiable, Hashable {
    let id: UUID
    let status: ReviewOrderStatus
    let offeringTitle: String
    let studentName: String
    let priceCents: Int
    let coachShareCents: Int
    let matchId: UUID?
    let promisedBy: String?
    let reviewViewedAt: String?
    let createdAt: String
    let submittedAt: String?
    let deliveredAt: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case offeringTitle = "offering_title"
        case studentName = "student_name"
        case priceCents = "price_cents"
        case coachShareCents = "coach_share_cents"
        case matchId = "match_id"
        case promisedBy = "promised_by"
        case reviewViewedAt = "review_viewed_at"
        case createdAt = "created_at"
        case submittedAt = "submitted_at"
        case deliveredAt = "delivered_at"
    }
}

/// coach_review_stats().
struct CoachReviewStats: Codable, Hashable {
    let activeCount: Int
    let completedCount: Int
    let earnedCents: Int

    enum CodingKeys: String, CodingKey {
        case activeCount = "active_count"
        case completedCount = "completed_count"
        case earnedCents = "earned_cents"
    }
}

/// review_order_detail() — the full order for either party.
struct ReviewOrderDetail: Codable, Hashable {
    let id: UUID
    let status: ReviewOrderStatus
    let offeringTitle: String
    let coachId: UUID
    let studentId: UUID
    let coachName: String
    let studentName: String
    let matchId: UUID?
    let priceCents: Int
    let coachShareCents: Int
    let turnaroundDays: Int
    let followupRounds: Int
    let intakeAnswers: [IntakeAnswer]
    let reviewSections: [ReviewSectionDef]
    /// Read live off the offering, coach only. Absent on pre-085 rows.
    let suggestedPatterns: [String]?
    let promisedBy: String?
    let declineMessage: String?
    let sampleConsent: String
    let reviewViewedAt: String?
    let testimonial: String?
    let testimonialFeatured: Bool
    let invitedBackAt: String?
    let deliveredAt: String?
    let completedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, status, testimonial
        case offeringTitle = "offering_title"
        case coachId = "coach_id"
        case studentId = "student_id"
        case coachName = "coach_name"
        case studentName = "student_name"
        case matchId = "match_id"
        case priceCents = "price_cents"
        case coachShareCents = "coach_share_cents"
        case turnaroundDays = "turnaround_days"
        case followupRounds = "followup_rounds"
        case intakeAnswers = "intake_answers"
        case reviewSections = "review_sections"
        case suggestedPatterns = "suggested_patterns"
        case promisedBy = "promised_by"
        case declineMessage = "decline_message"
        case sampleConsent = "sample_consent"
        case reviewViewedAt = "review_viewed_at"
        case testimonialFeatured = "testimonial_featured"
        case invitedBackAt = "invited_back_at"
        case deliveredAt = "delivered_at"
        case completedAt = "completed_at"
    }
}

struct ReviewFindingRow: Codable, Identifiable, Hashable {
    let id: UUID
    let orderId: UUID
    var title: String
    var body: String
    var audioPath: String?
    var imagePath: String?
    /// Which point the drawing's frame came from; captions it.
    var imagePointId: UUID?
    let sort: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, body, sort
        case orderId = "order_id"
        case audioPath = "audio_path"
        case imagePath = "image_path"
        case imagePointId = "image_point_id"
        case createdAt = "created_at"
    }
}

struct ReviewAttachmentRow: Codable, Identifiable, Hashable {
    let id: UUID
    let orderId: UUID
    let filename: String
    let sizeBytes: Int
    let contentType: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, filename
        case orderId = "order_id"
        case sizeBytes = "size_bytes"
        case contentType = "content_type"
        case createdAt = "created_at"
    }
}

struct ReviewMessageRow: Codable, Identifiable, Hashable {
    let id: UUID
    let orderId: UUID
    let authorId: UUID
    let kind: String
    let body: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, body
        case orderId = "order_id"
        case authorId = "author_id"
        case createdAt = "created_at"
    }
}

/// The points the workspace player steps through — ranked display numbers,
/// matching the match page (idx skips deleted points there too).
struct WorkspacePoint: Codable, Identifiable, Hashable {
    let id: UUID
    var idx: Int
    let confirmedWinner: Winner?
    let starred: Bool
    let isLet: Bool?
    let deleted: Bool?
    let cutT0: Double?
    let t0: Double

    /// The web workspace's outcome word, from the coach's seat: "they"
    /// is the student.
    var outcomeLabel: String {
        if isLet == true { return "let" }
        return switch confirmedWinner {
        case .user: "they won"
        case .opponent: "they lost"
        case nil: "unscored"
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, idx, starred, deleted, t0
        case confirmedWinner = "confirmed_winner"
        case isLet = "is_let"
        case cutT0 = "cut_t0"
    }

    static let workspaceSelect =
        "id,idx,confirmed_winner,starred,is_let,deleted,cut_t0,t0"
}

// MARK: - Copy helpers

/// Plain language for each state, coach audience. Mirrors orderStatusLabel.
func coachOrderStatusLabel(_ status: ReviewOrderStatus) -> String {
    switch status {
    case .awaitingPayment: "Payment not finished"
    case .awaitingSubmission: "Waiting for their match"
    case .submitted: "New order"
    case .inReview: "In progress"
    case .clarification: "Waiting on their answer"
    case .delivered: "Review delivered"
    case .completed: "Completed"
    case .declined: "Declined and refunded"
    case .cancelled: "Cancelled and refunded"
    }
}

/// The promised-by phrase for a queue row. Mirrors promiseLabel in
/// CoachHub.tsx: days are ceil((promised - now) / 24h).
func promiseLabel(_ promisedBy: String?) -> (text: String, overdue: Bool)? {
    guard let promisedBy, let date = PGDate.parse(promisedBy) else { return nil }
    let days = Int(ceil(date.timeIntervalSinceNow / 86_400))
    if date.timeIntervalSinceNow < 0 { return ("past your promised date", true) }
    if days <= 0 { return ("promised today", false) }
    if days == 1 { return ("promised by tomorrow", false) }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEE, MMM d"
    return ("promised by \(formatter.string(from: date))", false)
}

/// "$25" for whole dollars, "$25.50" otherwise. Mirrors money.ts formatUsd.
func formatUsd(_ cents: Int) -> String {
    if cents % 100 == 0 { return "$\(cents / 100)" }
    return String(format: "$%.2f", Double(cents) / 100)
}

/// Strips "$ , whitespace"; nil unless a plain decimal with ≤2 places.
func parseUsdCents(_ input: String) -> Int? {
    let cleaned = input.replacingOccurrences(of: "[$,\\s]", with: "", options: .regularExpression)
    guard cleaned.range(of: "^\\d+(\\.\\d{1,2})?$", options: .regularExpression) != nil,
          let value = Double(cleaned) else { return nil }
    return Int((value * 100).rounded())
}

// MARK: - Delivery gate

/// Mirrors deliveryGate.ts exactly — the server re-runs the same checks, so
/// this only exists to disable the button before the round trip would fail.
func deliveryBlocker(
    findings: [(title: String, body: String, audioPath: String?, pointCount: Int)],
    sections: [ReviewSectionContent]
) -> String? {
    if findings.isEmpty {
        return "Add at least one pattern before you deliver."
    }
    if !findings.contains(where: { $0.pointCount > 0 }) {
        return "Link at least one point to a pattern. The clips are what they paid for."
    }
    if findings.contains(where: {
        $0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && $0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && $0.audioPath == nil
    }) {
        return "One of your patterns is still empty. Write a line in it or delete it."
    }
    let words = (sections.map(\.body) + findings.map { "\($0.title) \($0.body)" })
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .split(whereSeparator: \.isWhitespace)
        .count
    if words < 50 && !findings.contains(where: { $0.audioPath != nil }) {
        return "Write a little more first. A review this short would not feel worth what they paid."
    }
    return nil
}

// MARK: - Payout countries

/// Mirrors src/lib/payments/countries.ts — display order, not alphabetical.
let payoutCountries: [(code: String, name: String)] = [
    ("US", "United States"), ("CA", "Canada"), ("GB", "United Kingdom"),
    ("IE", "Ireland"), ("DE", "Germany"), ("FR", "France"), ("ES", "Spain"),
    ("IT", "Italy"), ("PT", "Portugal"), ("NL", "Netherlands"),
    ("BE", "Belgium"), ("LU", "Luxembourg"), ("AT", "Austria"),
    ("CH", "Switzerland"), ("LI", "Liechtenstein"), ("DK", "Denmark"),
    ("SE", "Sweden"), ("NO", "Norway"), ("FI", "Finland"), ("PL", "Poland"),
    ("CZ", "Czechia"), ("SK", "Slovakia"), ("SI", "Slovenia"),
    ("HR", "Croatia"), ("HU", "Hungary"), ("RO", "Romania"),
    ("BG", "Bulgaria"), ("GR", "Greece"), ("CY", "Cyprus"), ("MT", "Malta"),
    ("EE", "Estonia"), ("LV", "Latvia"), ("LT", "Lithuania"),
    ("AU", "Australia"), ("NZ", "New Zealand"), ("JP", "Japan"),
    ("SG", "Singapore"), ("HK", "Hong Kong"), ("MY", "Malaysia"),
    ("TH", "Thailand"), ("AE", "United Arab Emirates"), ("MX", "Mexico"),
    ("BR", "Brazil"),
]
