import Supabase

extension ProcessingServiceStore {
    static let shared = ProcessingServiceStore {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessingAvailabilityFixture.isEnabled { return ProcessingAvailabilityFixture.status }
        #endif
        return try await supa.rpc("processing_service_status").execute().value
    }
}
