import AuthenticationServices
import CryptoKit
import SwiftUI
import Supabase

/// Sign in, three ways: an eight-digit email code (the same email carries the
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
    @State private var appeared = false
    @FocusState private var emailFocused: Bool
    @FocusState private var codeFocused: Bool

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 88)
                    brand
                    Spacer(minLength: 44)

                    VStack(spacing: 14) {
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        if sent {
                            codeEntry
                        } else {
                            emailEntry
                        }

                        HStack(spacing: 12) {
                            Rectangle().fill(PL.edge.opacity(0.8)).frame(height: 1)
                            Text("or")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                            Rectangle().fill(PL.edge.opacity(0.8)).frame(height: 1)
                        }
                        .padding(.vertical, 4)

                        SignInWithAppleButton(.signIn) { request in
                            let nonce = randomNonce()
                            appleNonce = nonce
                            request.requestedScopes = [.email, .fullName]
                            request.nonce = sha256(nonce)
                        } onCompletion: { result in
                            Task { await handleApple(result) }
                        }
                        .signInWithAppleButtonStyle(.white)
                        .frame(height: 52)
                        .clipShape(Capsule())

                        Button {
                            Task { await signInWithGoogle() }
                        } label: {
                            HStack(spacing: 8) {
                                Text("G")
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                                Text("Continue with Google")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .foregroundStyle(PL.text100)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(PL.surface.opacity(0.8), in: Capsule())
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }

                    Spacer(minLength: 36)

                    // Markdown links, so Terms and Privacy actually open.
                    Text(.init(
                        "By signing in you agree to our [Terms](https://www.ponglens.com/terms) and [Privacy Policy](https://www.ponglens.com/privacy)."
                    ))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .tint(PL.text300)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)

                    Spacer(minLength: 40)
                }
                .padding(.horizontal, 28)
                .frame(maxWidth: 400)
                .frame(maxWidth: .infinity)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .plKeyboardDismiss()
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) { appeared = true }
        }
    }

    /// The mark, the name, and the one line that says what this is.
    private var brand: some View {
        VStack(spacing: 20) {
            LogoMark(size: 64)
                .background(
                    Circle()
                        .fill(PL.cyan.opacity(0.16))
                        .frame(width: 130, height: 130)
                        .blur(radius: 34)
                )
            VStack(spacing: 10) {
                HStack(spacing: 0) {
                    Text("Pong").foregroundStyle(.white)
                    Text("Lens").foregroundStyle(PL.cyan)
                }
                .font(.system(size: 30, weight: .semibold))
                .tracking(-0.6)
                Text("A performance hub for competitive table tennis.")
                    .font(.system(size: 15))
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Email + code

    private var emailEntry: some View {
        VStack(spacing: 12) {
            TextField("Email address", text: $email)
                .font(.system(size: 16))
                .foregroundStyle(PL.text100)
                .tint(PL.cyan)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($emailFocused)
                .submitLabel(.send)
                .onSubmit { if !email.isEmpty { Task { await sendCode() } } }
                .padding(.horizontal, 18)
                .frame(height: 52)
                .background(PL.surface.opacity(0.8), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .strokeBorder(
                            emailFocused ? PL.cyan.opacity(0.55) : PL.edge, lineWidth: 1
                        )
                )

            Button {
                Task { await sendCode() }
            } label: {
                Text(sending ? "Sending…" : "Email me a code")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PL.ink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(PL.cyan, in: Capsule())
                    .shadow(color: PL.cyan.opacity(0.35), radius: 12, y: 2)
                    .shadow(color: PL.cyan.opacity(0.18), radius: 28, y: 4)
            }
            .buttonStyle(.plain)
            .disabled(sending || email.isEmpty)
            .opacity(sending || email.isEmpty ? 0.6 : 1)
        }
    }

    private var codeEntry: some View {
        VStack(spacing: 12) {
            Text("We emailed a code to \(email).")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .frame(maxWidth: .infinity, alignment: .leading)

            TextField("8-digit code", text: $code)
                .font(.system(size: 24, weight: .semibold))
                .monospacedDigit()
                .kerning(code.isEmpty ? 0 : 6)
                .multilineTextAlignment(.center)
                .foregroundStyle(PL.text100)
                .tint(PL.cyan)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($codeFocused)
                .frame(height: 56)
                .background(PL.surface.opacity(0.8), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .strokeBorder(
                            codeFocused ? PL.cyan.opacity(0.55) : PL.edge, lineWidth: 1
                        )
                )
                .onAppear { codeFocused = true }
                .onChange(of: code) { _, value in
                    // Supabase mints EIGHT-digit codes for this project;
                    // the field capped at six and auto-submitted the
                    // truncation, so a real code could never be entered.
                    let digits = value.filter(\.isNumber).prefix(8)
                    if String(digits) != value { code = String(digits) }
                    if digits.count == 8, !verifying {
                        Task { await verifyCode() }
                    }
                }

            Button {
                Task { await verifyCode() }
            } label: {
                Text(verifying ? "Signing in…" : "Sign in")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PL.ink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(PL.cyan, in: Capsule())
                    .shadow(color: PL.cyan.opacity(0.35), radius: 12, y: 2)
            }
            .buttonStyle(.plain)
            .disabled(verifying || code.count < 6)
            .opacity(verifying || code.count < 6 ? 0.6 : 1)

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
            .padding(.top, 2)

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
            let clean = email.trimmingCharacters(in: .whitespaces)
            // App Review signs in with a fixed code from the review notes,
            // because a reviewer cannot read a real mailbox. The server
            // checks the pair against admin-only config and answers with
            // the one-time token a magic link carries; when the fixed code
            // is switched off (or wrong) this returns nothing and the
            // address gets the ordinary emailed-code path below.
            if clean.lowercased() == "reviewer@ponglens.com",
               let tokenHash = await reviewerTokenHash(email: clean.lowercased()) {
                try await supa.auth.verifyOTP(tokenHash: tokenHash, type: .email)
            } else {
                try await supa.auth.verifyOTP(email: clean, token: code, type: .email)
            }
        } catch {
            errorMessage = "That code didn't work. Check the digits or send a fresh one."
        }
        verifying = false
    }

    /// Deliberately not APIClient: there is no session yet to attach, and
    /// the route is unauthenticated by design.
    private func reviewerTokenHash(email: String) async -> String? {
        struct Req: Encodable {
            let email: String
            let code: String
        }
        struct Res: Decodable { let tokenHash: String }
        var request = URLRequest(
            url: AppConfig.apiBase.appendingPathComponent("api/review-signin")
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(Req(email: email, code: code))
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let res = try? JSONDecoder().decode(Res.self, from: data)
        else { return nil }
        return res.tokenHash
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
            errorMessage = "That link didn't work. Links are single-use, and tapping one in Mail spends it. Send a fresh code instead."
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
            // prompt=select_account forces Google's account chooser. Without
            // it, an existing Google web session signs straight in as the
            // browser's default account — which is how "signed in as the
            // coach" quietly became the main account on a shared phone.
            try await supa.auth.signInWithOAuth(
                provider: .google,
                redirectTo: URL(string: "ponglens://auth-callback"),
                queryParams: [("prompt", "select_account")]
            )
        } catch {
            if !(error is CancellationError) {
                errorMessage = "Google sign-in isn't switched on for the app yet. Use the email code."
            }
        }
    }
}
