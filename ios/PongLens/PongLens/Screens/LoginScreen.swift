import SwiftUI
import Supabase

struct LoginScreen: View {
    @State private var email = ""
    @State private var sending = false
    @State private var sent = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            ArenaBackground()
            VStack(spacing: 24) {
                Spacer()
                LogoWordmark()

                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Sign in to PongLens")
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                        Text("Upload a match or pick up where you left off.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                    }

                    if sent {
                        Text("Check your email for the sign-in link.")
                            .font(.plBody)
                            .foregroundStyle(PL.successText)
                    } else {
                        TextField("Email address", text: $email)
                            .plField()
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        Button(sending ? "Sending…" : "Send a sign-in link") {
                            Task { await sendLink() }
                        }
                        .buttonStyle(PLPrimaryButtonStyle())
                        .disabled(sending || email.isEmpty)
                        .frame(maxWidth: .infinity)
                    }

                    Text("By signing in you agree to our Terms and Privacy Policy.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 24)

                Spacer()
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: 400)
        }
    }

    private func sendLink() async {
        sending = true
        errorMessage = nil
        do {
            try await supa.auth.signInWithOTP(
                email: email.trimmingCharacters(in: .whitespaces),
                redirectTo: AppConfig.apiBase.appendingPathComponent("auth/confirm")
            )
            sent = true
        } catch {
            errorMessage = "Couldn't send the link. Try again."
        }
        sending = false
    }
}
