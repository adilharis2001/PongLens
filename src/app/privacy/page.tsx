import type { Metadata } from "next";
import { getSupportEmail } from "@/lib/config";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How PongLens handles your videos and your data.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy · PongLens",
    description: "How PongLens handles your videos and your data.",
    url: "/privacy",
    siteName: "PongLens",
    images: ["/img/og.jpg"],
  },
};

/*
  NOT LEGAL ADVICE — this document was drafted in plain language for an
  early-access product. Have a lawyer review it before commercial launch.
*/

export default async function PrivacyPage() {
  const supportEmail = await getSupportEmail();
  return (
    <LegalPage title="Privacy Policy" updated="July 21, 2026">
      <section>
        <h2>The short version</h2>
        <p>
          We collect the minimum needed to run the service: your Google
          account basics, the videos you upload, and the notes you add.
          Videos are processed on hardware we operate and stored privately.
          Original uploads are deleted after 7 days, cut videos after 30
          days, and voice note audio after 90 days. Your point clips and
          match data stay available while your account is active. Nothing is
          sold or shared for advertising. You control who your matches are
          shared with.
        </p>
      </section>

      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>
            <strong>Account information.</strong> When you sign in with
            Google, we receive your name, email address, and profile picture
            through Supabase, our authentication provider. We never see your
            Google password.
          </li>
          <li>
            <strong>Your videos.</strong> The match footage you upload, plus
            the processed results we generate from it: the cut video, the
            per-point clips, and match data such as who served and where the
            ball landed.
          </li>
          <li>
            <strong>Your notes.</strong> Text notes, voice note recordings,
            and the transcripts we generate from them.
          </li>
          <li>
            <strong>Feedback.</strong> Anything you send through the in-app
            feedback form. We may use it to improve the service.
          </li>
          <li>
            <strong>Job metadata.</strong> Basic records about each upload:
            when it happened, its processing status, and any error message.
            We use these to show your job history and debug failures.
          </li>
          <li>
            <strong>Aggregate usage.</strong> We use Vercel Web Analytics,
            which is privacy-friendly and cookieless: it counts page views and
            visits in aggregate without setting cookies and without profiling
            or identifying you individually.
          </li>
        </ul>
        <p>
          We run no third-party advertising trackers. The only cookies PongLens
          sets are the essential first-party cookies your sign-in session
          needs to keep you logged in.
        </p>
      </section>

      <section>
        <h2>2. Where processing happens</h2>
        <p>
          Video files, point clips, and voice note audio are stored in
          private buckets hosted by Cloudflare R2. Your account, match data,
          and notes are stored with Supabase. Video processing is performed
          on operator-controlled hardware: a private workstation run by the
          person who operates PongLens, not a third-party AI service. The
          video is downloaded to that machine, processed, and the results are
          uploaded back to private storage. Voice notes are the one
          exception: the audio is sent to Deepgram, our transcription
          provider, to produce the transcript. No other external analysis
          provider receives your content.
        </p>
      </section>

      <section>
        <h2>3. How long we keep things</h2>
        <ul>
          <li>
            <strong>Original uploads:</strong> deleted 7 days after upload.
          </li>
          <li>
            <strong>Cut videos:</strong> deleted 30 days after processing.
          </li>
          <li>
            <strong>Voice note audio:</strong> deleted 90 days after
            recording.
          </li>
          <li>
            <strong>Point clips and match data:</strong> kept while your
            account is active, so you can keep reviewing your matches.
          </li>
          <li>
            <strong>Note transcripts, account, and job records:</strong>{" "}
            kept while your account is active.
          </li>
        </ul>
        <p>
          If you delete your account (email us to request this), we delete
          everything in every tier above: videos, clips, match data, notes,
          transcripts, and job history, within 30 days, except where
          we&apos;re legally required to keep something.
        </p>
      </section>

      <section>
        <h2>4. Voice notes</h2>
        <p>
          When you record a voice note, the audio is uploaded to private
          storage and sent to Deepgram to produce a transcript. The audio is
          deleted after 90 days. The transcript stays with your account like
          any other note, and you can edit or delete it yourself at any time.
          If you want a specific recording or transcript deleted sooner,
          email us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>5. Coach access</h2>
        <p>
          If you share a match (or all your matches) with a coach, that
          person can see what you see on the shared matches: the cut video,
          the point clips, placement views, and your notes, including voice
          note transcripts. They can add their own notes. They cannot edit or
          delete your content, and they cannot see matches you haven&apos;t
          shared.
        </p>
        <p>
          You can revoke a share at any time from your account, and the
          coach&apos;s access ends when you do. Notes they already left stay
          on your match.
        </p>
      </section>

      <section>
        <h2>6. What we never do</h2>
        <ul>
          <li>We do not sell your data. Ever.</li>
          <li>We do not share your videos with advertisers or data brokers.</li>
          <li>
            We do not use your footage to promote the service without your
            explicit permission.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Service providers</h2>
        <p>We rely on a small set of providers to run PongLens:</p>
        <ul>
          <li>
            <strong>Supabase</strong>: authentication, database, and job
            queue.
          </li>
          <li>
            <strong>Cloudflare R2</strong>: private storage for video files,
            point clips, and voice note audio.
          </li>
          <li>
            <strong>Deepgram</strong>: transcription of voice notes. It
            receives the audio only to produce the transcript.
          </li>
          <li>
            <strong>Google</strong>: sign-in (OAuth). Google&apos;s own
            privacy policy governs your Google account.
          </li>
          <li>
            <strong>Vercel</strong>: website hosting and cookieless,
            aggregate traffic analytics.
          </li>
          <li>
            <strong>Resend</strong>: transactional email, such as the
            notification when your match is ready.
          </li>
        </ul>
        <p>
          Each provider processes only what it needs to perform its role.
        </p>
      </section>

      <section>
        <h2>8. Other people in your videos</h2>
        <p>
          Match footage usually includes an opponent and sometimes bystanders.
          You&apos;re responsible for making sure everyone recorded has
          consented where the law requires it. See our{" "}
          <Link href="/terms">Terms</Link>. If you believe footage of you was
          uploaded without your consent, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>{" "}
          and we&apos;ll investigate promptly and remove content that
          shouldn&apos;t be there.
        </p>
      </section>

      <section>
        <h2>9. Security</h2>
        <p>
          Videos live in private buckets that only your account (and the
          people you&apos;ve shared with, and the processing system) can
          access, enforced by row-level security and expiring signed links.
          Transfers use HTTPS. No system is perfectly secure, but we keep the
          attack surface deliberately small: no passwords stored, no payment
          data collected, minimal personal data held.
        </p>
      </section>

      <section>
        <h2>10. Your rights</h2>
        <p>
          You can request a copy of your data, correction of inaccurate data,
          or deletion of your account and everything tied to it, across every
          retention tier listed above. Email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>{" "}
          and we&apos;ll respond within 30 days. Depending on where you live
          (for example the EU/UK under GDPR, or California under CCPA), you
          may have additional statutory rights; we honor reasonable requests
          regardless of jurisdiction.
        </p>
      </section>

      <section>
        <h2>11. Children</h2>
        <p>
          PongLens is not directed at children under 13, and we don&apos;t
          knowingly collect their data. If you believe a child&apos;s account
          exists, contact us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>12. Changes to this policy</h2>
        <p>
          If we change how we handle your data, we&apos;ll update this page
          and the date at the top, and flag material changes in the app or by
          email.
        </p>
      </section>

      <section>
        <h2>13. Contact</h2>
        <p>
          Privacy questions or requests:{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
