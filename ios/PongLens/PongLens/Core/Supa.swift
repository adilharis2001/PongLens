import Foundation
import Supabase

/// The shared Supabase client. Sessions persist in the Keychain (SDK default).
let supa: SupabaseClient = {
    #if DEBUG && targetEnvironment(simulator)
    if ScorekeeperQAFixture.isEnabled {
        return ScorekeeperQAFixture.makeSupabaseClient()
    }
    #endif
    return SupabaseClient(
        supabaseURL: AppConfig.supabaseURL,
        supabaseKey: AppConfig.supabaseAnonKey
    )
}()
