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
    <LegalPage title="Privacy Policy" updated="September 4, 2026">
      <section>
        <h2>The short version</h2>
        <p>
          We collect the minimum needed to run the service: your account or
          beta-access email, the videos you upload, and the notes you add.
          Google sign-in can also provide your name and profile picture.
          Videos are processed on hardware we operate and stored privately.
          Your videos stay in your library, within your storage allowance,
          until you delete them.
          Voice note audio is deleted after 90 days. Your point clips and
          match data stay available while your account is active. Payments go
          to Stripe directly; we never see card details. Nothing is sold or
          shared for advertising. You control who your matches are shared
          with. Recollect is enabled by default and uses eligible lesson and
          practice notes to create private reminders; you can turn it off in
          Account.
        </p>
      </section>

      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>
            <strong>Account information.</strong> We receive your email
            address through Supabase, our authentication provider. If you sign
            in with Google, we also receive the name and profile picture that
            Google provides. If you sign in by email, Supabase emails you a
            one-time sign-in link. PongLens does not collect or store an
            account password for either method.
          </li>
          <li>
            <strong>iPhone beta requests.</strong> If you request the iPhone
            beta, we keep the email address you provide, when you requested
            access, and whether the invitation was delivered. We use it only
            to send TestFlight access and essential beta updates, not
            marketing.
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
            <strong>Recollect data.</strong> Concise reminders generated from
            eligible lesson and practice notes, their source links, and when
            you reveal, dismiss, or add them to Working On.
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
          person who operates PongLens. The video is downloaded to that
          machine, processed, and the results are uploaded back to private
          storage. During processing, a small number of still frames from
          the video are sent to OpenAI to confirm the footage is table
          tennis we can work with and, when needed, to locate the table.
          Voice-note audio is sent to Deepgram to produce a transcript, and
          for nothing else. OpenAI also receives the content needed for
          features you choose to use: lesson summaries, Journal photo
          reading, Ask, Recollect, feedback assistance, and page drafting
          for coaches. For Recollect, that means the relevant text from
          eligible lesson and practice notes. Stripe processes payments and
          coach payouts. These providers process content for PongLens to
          return the product result, and they may not use your content to
          train or improve their own models.
        </p>
      </section>

      <section>
        <h2>3. How long we keep things</h2>
        <ul>
          <li>
            <strong>Your uploaded videos and cut videos:</strong> kept while
            your account is active and the video is in your library. They
            count toward your storage allowance, and deleting a video
            removes both and frees the space. A video you delete may take up
            to 30 days to clear from backup storage.
          </li>
          <li>
            <strong>Voice note audio:</strong> deleted 90 days after
            recording. Audio that is part of a delivered paid review is kept
            with the review.
          </li>
          <li>
            <strong>Point clips and match data:</strong> kept while your
            account is active, so you can keep reviewing your matches.
          </li>
          <li>
            <strong>Note transcripts, account, and job records:</strong>{" "}
            kept while your account is active.
          </li>
          <li>
            <strong>iPhone beta requests:</strong> kept while the beta is
            active and for up to 90 days afterward, unless you ask us to
            remove yours sooner.
          </li>
          <li>
            <strong>Recollect reminders and scheduling:</strong> kept while
            Recollect is on and your account is active. Turning it off deletes
            this generated Recollect data.
          </li>
        </ul>
        <p>
          You can delete your account yourself from the Account page, or
          email us and we&apos;ll do it. Either way we delete everything in
          every tier above: videos, clips, match data, notes, transcripts,
          and job history, within 30 days, except where we&apos;re legally
          required to keep something.
        </p>
      </section>

      <section>
        <h2>4. Voice notes</h2>
        <p>
          When you record a voice note, the audio is uploaded to private
          storage and sent to Deepgram to produce a transcript. Deepgram may
          not use your recordings to improve its own models; it transcribes
          them and nothing more. The audio is deleted after 90 days. The transcript stays with your account like
          any other note, and you can edit or delete it yourself at any time.
          If you want a specific recording or transcript deleted sooner,
          email us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>5. Recollect</h2>
        <p>
          Recollect is enabled by default. When you save an eligible lesson or
          practice note, PongLens may send its text to OpenAI to identify a
          small number of useful, source-linked training reminders. A note may
          produce no reminder when it does not contain genuinely useful
          coaching or practice guidance.
        </p>
        <p>
          You can turn Recollect off at any time in Account. Generated
          Recollect reminders, processing jobs, and scheduling data are
          deleted when you do. Your original Journal notes remain and are not
          deleted by this setting.
        </p>
      </section>

      <section>
        <h2>6. Coach access</h2>
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
        <p>
          Coaches can keep lesson notes about their students inside
          PongLens. A coach may add a student by name before that student
          has an account; those notes belong to the coach and are visible
          only to them until the coach shares an entry with you. When you
          join a coach from their invite link, the entries they share appear
          in your journal, and the coach can see the matches you upload.
          You can leave a coach at any time from your account: their access
          to your matches ends and their shared entries stop reaching you.
          The coach keeps their own notes.
        </p>
      </section>

      <section>
        <h2>7. What we never do</h2>
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
        <h2>8. Service providers</h2>
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
            receives the audio only to produce the transcript, and may not
            use it to improve its own models.
          </li>
          <li>
            <strong>OpenAI</strong>: automated checks during video
            processing (a small number of still frames, to confirm the
            footage is table tennis and to locate the table), plus lesson
            summaries, Journal photo reading, Ask, Recollect reminders,
            feedback assistance, and page drafting for coaches.
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
            <strong>Resend</strong>: transactional email, including one-time
            sign-in links, match-ready notifications, and requested iPhone
            beta invitations.
          </li>
        </ul>
        <p>
          Each provider processes only what it needs to perform its role.
        </p>
      </section>

      <section>
        <h2>9. Other people in your videos</h2>
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
        <h2>9a. Payments</h2>
        <p>
          Payments are processed by Stripe. Your card details, and a
          coach&apos;s identity and bank details, go to Stripe directly and
          never touch PongLens servers. We store the purchase or order
          itself: what was bought, from whom, its price, and its status,
          plus your current balances of processing minutes and storage.
        </p>
      </section>

      <section>
        <h2>10. Security</h2>
        <p>
          Videos live in private buckets that only your account, the people
          you&apos;ve shared with, and the systems that run PongLens can
          access, enforced by row-level security and expiring signed links.
          Transfers use HTTPS. No system is perfectly secure, but we keep the
          attack surface deliberately small: no passwords stored, no card
          details touching our servers, minimal personal data held.
        </p>
        <p>
          A small operations team (today, the person who runs PongLens) can
          access stored videos and account records when needed to run the
          service: debugging a failed upload, reviewing content that was
          reported or refused, or answering a support request you sent. We
          do not browse your library otherwise, and your notes are not read
          for support unless you send them to us.
        </p>
      </section>

      <section>
        <h2>11. Your rights</h2>
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
        <h2>12. Children</h2>
        <p>
          PongLens is not directed at children under 13, and we don&apos;t
          knowingly collect their data. If you believe a child&apos;s account
          exists, contact us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>13. Changes to this policy</h2>
        <p>
          If we change how we handle your data, we&apos;ll update this page
          and the date at the top, and flag material changes in the app or by
          email.
        </p>
      </section>

      <section>
        <h2>14. Contact</h2>
        <p>
          Privacy questions or requests:{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
