import SwiftUI

struct ContentView: View {
    var body: some View {
        #if DEBUG && targetEnvironment(simulator)
        if ScorekeeperQAFixture.isEnabled {
            ScorekeeperQAFixtureView()
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
