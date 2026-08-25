import Foundation

// Mirrors src/lib/reviews/templates.ts — the six offering seeds, verbatim.
// A template is a starting point the coach edits; nothing here is shown to
// a student until the coach creates the offering.

struct OfferingTemplate {
    let key: String
    let image: String
    let name: String
    let blurb: String
    let title: String
    let description: String
    let includes: [String]
    let priceCents: Int
    let turnaroundDays: Int
    let followupRounds: Int
    let intakeQuestions: [IntakeQuestion]
    let reviewSections: [ReviewSectionDef]
    let suggestedPatterns: [String]
}

let offeringTemplates: [OfferingTemplate] = [
    OfferingTemplate(
        key: "first_look", image: "stock:first-look", name: "First look",
        blurb: "One thing to change, shown on the video.",
        title: "First look",
        description: "A short review for anyone who has never had one. I find the habit that is costing you the most, show you the points where it happens, and give you one thing to take to practice.",
        includes: [
            "2 patterns, each with the points that show it",
            "A voice note on the one that matters most",
            "A short write-up with one thing to change",
            "One follow-up question",
        ],
        priceCents: 2000, turnaroundDays: 2, followupRounds: 1,
        intakeQuestions: [
            IntakeQuestion(id: "level", label: "How long have you been playing?", optional: nil),
            IntakeQuestion(id: "goal", label: "Is there anything in particular you want me to look at?", optional: true),
        ],
        reviewSections: [
            ReviewSectionDef(key: "what_i_saw", label: "What I saw"),
            ReviewSectionDef(key: "one_thing", label: "The one thing to change"),
        ],
        suggestedPatterns: [
            "The habit costing you the most",
            "Something you already do well",
        ]
    ),
    OfferingTemplate(
        key: "full_match", image: "stock:full-match", name: "Full match review",
        blurb: "The whole match, in patterns.",
        title: "Full match review",
        description: "I watch your whole match and pull out the patterns behind the score. Each one gets named, with the points that show it, so you can see the habit rather than take my word for it. The write-up says what to do about them.",
        includes: [
            "5 to 7 patterns, each with the points that show it",
            "A drawing on the frames that need one",
            "A voice note on the pattern that matters most",
            "A write-up covering what is working and what is costing you",
            "A practice plan for the next two weeks",
            "One follow-up question",
        ],
        priceCents: 5500, turnaroundDays: 5, followupRounds: 1,
        intakeQuestions: [
            IntakeQuestion(id: "level", label: "What level do you play at, roughly?", optional: nil),
            IntakeQuestion(id: "plan", label: "What was your plan going into this match?", optional: true),
            IntakeQuestion(id: "opponent", label: "Anything I should know about your opponent?", optional: true),
        ],
        reviewSections: [
            ReviewSectionDef(key: "summary", label: "Summary"),
            ReviewSectionDef(key: "working", label: "What is working"),
            ReviewSectionDef(key: "costing_points", label: "What is costing you points"),
            ReviewSectionDef(key: "practice_plan", label: "Practice plan"),
        ],
        suggestedPatterns: [
            "Your serve into the third ball",
            "Your receive into the fourth ball",
            "Where the rallies turn",
            "The score moments",
        ]
    ),
    OfferingTemplate(
        key: "serve_receive", image: "stock:serve", name: "Serve and receive",
        blurb: "The first four balls of every point.",
        title: "Serve and receive",
        description: "Most points are decided in the first four balls. I look at what your serve sets up, what your opponent does with it, how you handle theirs, and what you get to play on the ball after.",
        includes: [
            "3 to 5 patterns across your serve and your receive",
            "The points that show each one",
            "A drawing on the contact that matters",
            "A write-up on the first four balls",
            "One follow-up question",
        ],
        priceCents: 3000, turnaroundDays: 3, followupRounds: 1,
        intakeQuestions: [
            IntakeQuestion(id: "serves", label: "Which serves do you use most?", optional: nil),
            IntakeQuestion(id: "trouble", label: "Which serves give you the most trouble to return?", optional: true),
        ],
        reviewSections: [
            ReviewSectionDef(key: "summary", label: "Summary"),
            ReviewSectionDef(key: "serves", label: "Your serve"),
            ReviewSectionDef(key: "receives", label: "Your receive"),
            ReviewSectionDef(key: "work_ons", label: "What to practice"),
        ],
        suggestedPatterns: [
            "What your serve gives away",
            "The serve that wins you points",
            "Your first touch on receive",
            "The fourth ball after you receive",
        ]
    ),
    OfferingTemplate(
        key: "opponent", image: "stock:opponent", name: "Opponent scout",
        blurb: "Someone you are about to play.",
        title: "Opponent scout",
        description: "Send me a match with the player you are about to face in it. I work out how they serve, how they actually win their points, and what they would rather not deal with, then write you a game plan.",
        includes: [
            "3 to 4 patterns in their game, with the points that show them",
            "A voice note walking through the game plan",
            "A write-up of what to do and what to avoid",
            "One follow-up question",
        ],
        priceCents: 3500, turnaroundDays: 3, followupRounds: 1,
        intakeQuestions: [
            IntakeQuestion(id: "who", label: "Which player should I be watching?", optional: nil),
            IntakeQuestion(id: "when", label: "When do you play them?", optional: nil),
            IntakeQuestion(id: "history", label: "Have you played them before, and how did it go?", optional: true),
        ],
        reviewSections: [
            ReviewSectionDef(key: "their_serve", label: "How they serve"),
            ReviewSectionDef(key: "their_points", label: "How they win points"),
            ReviewSectionDef(key: "game_plan", label: "Your game plan"),
        ],
        suggestedPatterns: [
            "Their serve, and what it sets up",
            "How they win their points",
            "What they do under pressure",
            "What they would rather not deal with",
        ]
    ),
    OfferingTemplate(
        key: "style", image: "stock:style", name: "The style you struggle with",
        blurb: "Choppers, pips, blockers, lefties.",
        title: "Playing an awkward style",
        description: "Some players are a puzzle rather than a level. Send me a match against the style you keep losing to and I will show you what is happening on the balls that go wrong, and what to do instead.",
        includes: [
            "3 to 5 patterns in how you handle this style",
            "The points that show each one",
            "A drawing on the shot that keeps going wrong",
            "A write-up with what to change and two drills",
            "One follow-up question",
        ],
        priceCents: 3500, turnaroundDays: 4, followupRounds: 1,
        intakeQuestions: [
            IntakeQuestion(id: "style", label: "What style are they? Chopper, long pips, blocker, lefty, something else?", optional: nil),
            IntakeQuestion(id: "feels", label: "What does it feel like when it goes wrong?", optional: true),
        ],
        reviewSections: [
            ReviewSectionDef(key: "happening", label: "What is happening"),
            ReviewSectionDef(key: "change", label: "What to change"),
            ReviewSectionDef(key: "drills", label: "Two drills"),
        ],
        suggestedPatterns: [
            "Your first ball against them",
            "The shot that keeps going wrong",
            "When it does work",
        ]
    ),
    OfferingTemplate(
        key: "custom", image: "stock:custom", name: "From scratch",
        blurb: "Nothing filled in.",
        title: "", description: "", includes: [],
        priceCents: 3000, turnaroundDays: 4, followupRounds: 1,
        intakeQuestions: [
            IntakeQuestion(id: "goal", label: "What do you want out of this review?", optional: nil),
        ],
        reviewSections: [
            ReviewSectionDef(key: "notes", label: "Notes"),
        ],
        suggestedPatterns: []
    ),
]

/// The stock card art choices: the six template images plus receive.
let stockOfferingImages: [String] = [
    "stock:first-look", "stock:full-match", "stock:serve",
    "stock:opponent", "stock:style", "stock:custom", "stock:receive",
]
