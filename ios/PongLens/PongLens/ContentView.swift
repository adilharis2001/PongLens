import SwiftUI

struct ContentView: View {
    var body: some View {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessingAvailabilityFixture.isEnabled {
            ProcessingAvailabilityFixtureView()
        } else if ScorekeeperQAFixture.isEnabled {
            ScorekeeperQAFixtureView()
        } else if CutAgainFixture.isEnabled {
            CutAgainFixtureView()
        } else {
            RootView()
        }
        #else
        RootView()
        #endif
    }
}

#Preview {
    ContentView()
}
