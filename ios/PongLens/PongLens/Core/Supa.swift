import Foundation
import Supabase

/// The shared Supabase client. Sessions persist in the Keychain (SDK default).
let supa = SupabaseClient(
    supabaseURL: AppConfig.supabaseURL,
    supabaseKey: AppConfig.supabaseAnonKey
)
