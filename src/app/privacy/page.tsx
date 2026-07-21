import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How PongLens handles your videos and your data.",
  alternates: { canonical: "/privacy" },
};

/*
  NOT LEGAL ADVICE — this document was drafted in plain language for an
  early-access product. Have a lawyer review it before commercial launch.
*/

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 20, 2026">
      <section>
        <h2>The short version</h2>
        <p>
          We collect the minimum needed to run the service: your Google
          account basics and the videos you upload. Videos are processed on
          hardware we operate, auto-deleted after 30 days, and never sold or
          shared for advertising. Results stay available while your account is
          active.
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
            the processed results we generate from it.
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
          Uploaded videos are stored in private storage buckets hosted by
          Supabase. Processing is performed on operator-controlled hardware:
          a private workstation run by the person who operates PongLens, not a
          third-party AI service. The video is downloaded to that machine,
          processed, and the result is uploaded back to private storage. No
          external analysis provider receives your footage.
        </p>
      </section>

      <section>
        <h2>3. How long we keep things</h2>
        <ul>
          <li>
            <strong>Original uploads:</strong> automatically deleted 30 days
            after upload.
          </li>
          <li>
            <strong>Processed results:</strong> retained while your account is
            active, so you can re-download them.
          </li>
          <li>
            <strong>Account and job records:</strong> retained while your
            account is active.
          </li>
        </ul>
        <p>
          If you delete your account (email us to request this), we delete
          your videos, results, and job history within 30 days, except where
          we&apos;re legally required to keep something.
        </p>
      </section>

      <section>
        <h2>4. What we never do</h2>
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
        <h2>5. Service providers</h2>
        <p>We rely on a small set of providers to run PongLens:</p>
        <ul>
          <li>
            <strong>Supabase</strong>: authentication, database, and file
            storage.
          </li>
          <li>
            <strong>Google</strong>: sign-in (OAuth). Google&apos;s own
            privacy policy governs your Google account.
          </li>
          <li>
            <strong>Vercel</strong>: website hosting and cookieless,
            aggregate traffic analytics.
          </li>
        </ul>
        <p>
          Each provider processes only what it needs to perform its role.
        </p>
      </section>

      <section>
        <h2>6. Other people in your videos</h2>
        <p>
          Match footage usually includes an opponent and sometimes bystanders.
          You&apos;re responsible for making sure everyone recorded has
          consented where the law requires it. See our{" "}
          <Link href="/terms">Terms</Link>. If you believe footage of you was
          uploaded without your consent, email{" "}
          <a href="mailto:adilharis2001@gmail.com">adilharis2001@gmail.com</a>{" "}
          and we&apos;ll investigate promptly and remove content that
          shouldn&apos;t be there.
        </p>
      </section>

      <section>
        <h2>7. Security</h2>
        <p>
          Videos live in private buckets that only your account (and the
          processing system) can access, enforced by row-level security.
          Transfers use HTTPS. No system is perfectly secure, but we keep the
          attack surface deliberately small: no passwords stored, no payment
          data collected, minimal personal data held.
        </p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          You can request a copy of your data, correction of inaccurate data,
          or deletion of your account and everything tied to it. Email{" "}
          <a href="mailto:adilharis2001@gmail.com">adilharis2001@gmail.com</a>{" "}
          and we&apos;ll respond within 30 days. Depending on where you live
          (for example the EU/UK under GDPR, or California under CCPA), you
          may have additional statutory rights; we honor reasonable requests
          regardless of jurisdiction.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          PongLens is not directed at children under 13, and we don&apos;t
          knowingly collect their data. If you believe a child&apos;s account
          exists, contact us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>10. Changes to this policy</h2>
        <p>
          If we change how we handle your data, we&apos;ll update this page
          and the date at the top, and flag material changes in the app or by
          email.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Privacy questions or requests:{" "}
          <a href="mailto:adilharis2001@gmail.com">adilharis2001@gmail.com</a>.
        </p>
      </section>
    </LegalPage>
  );
}
