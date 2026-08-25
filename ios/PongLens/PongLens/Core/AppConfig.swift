import Foundation

/// Public-by-design configuration. The anon key is the same one compiled into
/// the web client bundle; RLS policies are what protect rows, never key secrecy.
enum AppConfig {
    static let supabaseURL = URL(string: "https://pdycinmyfnritemrsfjf.supabase.co")!
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkeWNpbm15Zm5yaXRlbXJzZmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MDE2MDAsImV4cCI6MjEwMDE3NzYwMH0.Ia-t4Mlwt8C73HBh488Ocw9bIe1aHC7v_sfUdz-HZnk"

    /// The Next.js API routes. Always www — the apex redirects.
    static let apiBase = URL(string: "https://www.ponglens.com")!

    /// Meta app id, required on Instagram's share-to-Stories scheme since
    /// January 2023. Public by design — it identifies PongLens as the app
    /// the share came from, and Instagram shows it as the attribution.
    /// Must match the `FacebookAppID` entry in Info.plist.
    static let metaAppID = "1012434688493595"

    /// The paid coaching marketplace (coach hub, offerings, orders, the
    /// review workspace, sponsored credits) is web-only for now — the app
    /// ships as a player product, and paid coaching stays at ponglens.com.
    /// Free sharing with a coach is NOT behind this flag: invites, shared
    /// matches and coach notes are a sharing feature and always ship.
    /// This flag is the one boundary; nothing else decides it.
    static let coachMarketplace = false
}
