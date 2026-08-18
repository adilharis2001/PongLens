import Foundation

/// Public-by-design configuration. The anon key is the same one compiled into
/// the web client bundle; RLS policies are what protect rows, never key secrecy.
enum AppConfig {
    static let supabaseURL = URL(string: "https://pdycinmyfnritemrsfjf.supabase.co")!
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkeWNpbm15Zm5yaXRlbXJzZmpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MDE2MDAsImV4cCI6MjEwMDE3NzYwMH0.Ia-t4Mlwt8C73HBh488Ocw9bIe1aHC7v_sfUdz-HZnk"

    /// The Next.js API routes. Always www — the apex redirects.
    static let apiBase = URL(string: "https://www.ponglens.com")!
}
