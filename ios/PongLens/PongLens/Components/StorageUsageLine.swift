import Supabase
import SwiftUI

/// One line of storage for the screens where a large upload starts outside
/// Account: "12.4 of 25 GB of storage used", red once full. The number is
/// the same one the upload route checks, so what the coach sees before
/// choosing a video is what the server will say after.
struct StorageUsageLine: View {
    @State private var state: AccountStore.StorageState?

    var body: some View {
        Group {
            if let s = state, let used = s.usedBytes, let limit = s.storageLimitBytes, limit > 0 {
                Text(String(
                    format: "%.1f of %.0f GB of storage used.",
                    Double(used) / 1_073_741_824,
                    Double(limit) / 1_073_741_824
                ))
                .font(.plCaption)
                .monospacedDigit()
                .foregroundStyle(used >= limit ? PL.dangerText : PL.text400)
            }
        }
        .task {
            let rows: [AccountStore.StorageState]? = try? await supa
                .rpc("my_storage_state").execute().value
            state = rows?.first
        }
    }
}
