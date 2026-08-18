import AuthenticationServices
import CryptoKit
import SwiftUI
import Supabase

/// Sign in, three ways: a six-digit email code (the same email carries the
/// web's magic link, so one template serves both apps), native Sign in with
/// Apple, and the web's existing Google provider through a secure in-app
/// auth session. The pasted-link path stays as a quiet fallback.
struct LoginScreen: View {
    @State private var email = ""
    @State private var sending = false
    @State private var sent = false
    @State private var errorMessage: String?
    @State private var code = ""
    @State private var verifying = false
    @State private var pasteFallbackOpen = false
    @State private var pastedLink = ""
    @State private var appleNonce: String?

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 40)
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
                            codeEntry
                        } else {
                            emailEntry
                        }

                        HStack(spacing: 10) {
                            Rectangle().fill(PL.edge).frame(height: 1)
                            Text("or")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                            Rectangle().fill(PL.edge).frame(height: 1)
                        }

                        SignInWithAppleButton(.signIn) { request in
                            let nonce = randomNonce()
                            appleNonce = nonce
                            request.requestedScopes = [.email, .fullName]
                            request.nonce = sha256(nonce)
                        } onCompletion: { result in
                            Task { await handleApple(result) }
                        }
                        .signInWithAppleButtonStyle(.white)
                        .frame(height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))

                        Button {
                            Task { await signInWithGoogle() }
                        } label: {
                            HStack(spacing: 8) {
                                Text("G")
                                    .font(.system(size: 16, weight: .bold, design: .rounded))
                                Text("Continue with Google")
                                    .font(.plButton)
                            }
                            .foregroundStyle(PL.text100)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                    .strokeBorder(PL.edge, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)

                        Text("By signing in you agree to our Terms and Privacy Policy.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 24)

                    Spacer(minLength: 60)
                }
                .padding(24)
                .frame(maxWidth: 400)
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Email + code

    private var emailEntry: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Email address", text: $email)
                .plField()
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Button(sending ? "Sending…" : "Email me a code") {
                Task { await sendCode() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(sending || email.isEmpty)
            .frame(maxWidth: .infinity)
        }
    }

    private var codeEntry: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("We emailed a six-digit code to \(email).")
                .font(.plBody)
                .foregroundStyle(PL.successText)

            TextField("6-digit code", text: $code)
                .plField()
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(size: 22, weight: .semibold))
                .monospacedDigit()
                .onChange(of: code) { _, value in
                    let digits = value.filter(\.isNumber).prefix(6)
                    if String(digits) != value { code = String(digits) }
                    if digits.count == 6, !verifying {
                        Task { await verifyCode() }
                    }
                }

            Button(verifying ? "Signing in…" : "Sign in") {
                Task { await verifyCode() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(verifying || code.count < 6)
            .frame(maxWidth: .infinity)

            HStack(spacing: 16) {
                Button("Use a different email") {
                    sent = false
                    code = ""
                    errorMessage = nil
                }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .buttonStyle(.plain)

                Button("Paste the link instead") {
                    pasteFallbackOpen.toggle()
                }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .buttonStyle(.plain)
            }

            if pasteFallbackOpen {
                TextField("Paste the sign-in link", text: $pastedLink)
                    .plField()
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(verifying ? "Signing in…" : "Sign in with the link") {
                    Task { await verifyPastedLink() }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(verifying || pastedLink.isEmpty)
            }
        }
    }

    private func sendCode() async {
        sending = true
        errorMessage = nil
        do {
            try await supa.auth.signInWithOTP(
                email: email.trimmingCharacters(in: .whitespaces),
                redirectTo: AppConfig.apiBase.appendingPathComponent("auth/confirm")
            )
            sent = true
        } catch {
            errorMessage = "Couldn't send the code. Try again."
        }
        sending = false
    }

    private func verifyCode() async {
        verifying = true
        errorMessage = nil
        do {
            try await supa.auth.verifyOTP(
                email: email.trimmingCharacters(in: .whitespaces),
                token: code,
                type: .email
            )
        } catch {
            errorMessage = "That code didn't work. Check the digits or send a fresh one."
        }
        verifying = false
    }

    /// Fallback: the emailed link still signs in, pasted whole. Links are
    /// single-use — tapping one in Mail spends it in Safari.
    private func verifyPastedLink() async {
        verifying = true
        errorMessage = nil
        let raw = pastedLink.trimmingCharacters(in: .whitespacesAndNewlines)
        let tokenHash: String? =
            URLComponents(string: raw)?.queryItems?
                .first(where: { $0.name == "token_hash" })?.value
            ?? (raw.contains("://") ? nil : raw)
        guard let tokenHash, !tokenHash.isEmpty else {
            errorMessage = "That doesn't look like a sign-in link."
            verifying = false
            return
        }
        do {
            try await supa.auth.verifyOTP(tokenHash: tokenHash, type: .email)
        } catch {
            errorMessage = "That link didn't work — they're single-use, and tapping one in Mail spends it. Send a fresh code instead."
        }
        verifying = false
    }

    // MARK: - Apple

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let error):
            // The user closing the sheet is not an error worth showing.
            if (error as? ASAuthorizationError)?.code != .canceled {
                errorMessage = "Apple sign-in didn't complete. Try again."
            }
        case .success(let auth):
            guard
                let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                let tokenData = credential.identityToken,
                let idToken = String(data: tokenData, encoding: .utf8),
                let nonce = appleNonce
            else {
                errorMessage = "Apple sign-in didn't complete. Try again."
                return
            }
            do {
                try await supa.auth.signInWithIdToken(
                    credentials: .init(provider: .apple, idToken: idToken, nonce: nonce)
                )
            } catch {
                errorMessage = "Apple sign-in isn't switched on yet. Use the email code."
            }
        }
    }

    private func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        for _ in 0..<length {
            var byte: UInt8 = 0
            _ = SecRandomCopyBytes(kSecRandomDefault, 1, &byte)
            result.append(charset[Int(byte) % charset.count])
        }
        return result
    }

    private func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    // MARK: - Google

    /// The web's existing Supabase Google provider, through the system's
    /// in-app auth session — no Google SDK, no new OAuth client.
    private func signInWithGoogle() async {
        errorMessage = nil
        do {
            try await supa.auth.signInWithOAuth(
                provider: .google,
                redirectTo: URL(string: "ponglens://auth-callback")
            )
        } catch {
            if !(error is CancellationError) {
                errorMessage = "Google sign-in isn't switched on for the app yet. Use the email code."
            }
        }
    }
}
