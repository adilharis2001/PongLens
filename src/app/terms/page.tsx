import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of PongLens.",
};

/*
  NOT LEGAL ADVICE — this document was drafted in plain language for an
  early-access product. Have a lawyer review it before commercial launch.
*/

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 20, 2026">
      <section>
        <h2>The short version</h2>
        <p>
          PongLens is a free, early-access service that analyzes table tennis
          videos you upload. You keep ownership of your videos. You must have
          the right to upload them. We can change or discontinue the service
          while it&apos;s in early access. Don&apos;t abuse it.
        </p>
      </section>

      <section>
        <h2>1. Who we are and what this covers</h2>
        <p>
          These terms are an agreement between you and the operator of
          PongLens (&quot;PongLens&quot;, &quot;we&quot;, &quot;us&quot;) and
          cover your use of ponglens.com and the analysis services we provide.
          By creating an account or using the service, you agree to these
          terms and to our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>2. The service</h2>
        <p>
          PongLens lets you upload table tennis match videos. Our software
          processes each video (currently to remove dead time between rallies
          and return a trimmed cut) and makes the result available for you to
          download. Additional analysis features (such as ball-placement maps
          and spin analysis) may be added over time.
        </p>
        <p>
          Processing happens on hardware we operate directly (a private
          workstation controlled by the service operator), not on a
          third-party analysis service. Your files are transferred and stored
          via Supabase (our storage and authentication provider).
        </p>
      </section>

      <section>
        <h2>3. Early access</h2>
        <p>
          PongLens is currently free for everyone. That means a few things,
          honestly stated:
        </p>
        <ul>
          <li>
            We may add limits, introduce paid plans, or change features at any
            time. Early users will keep a generous free tier.
          </li>
          <li>
            We don&apos;t guarantee uptime, processing speed, or that results
            will be perfect. Typical processing takes under 30 minutes, but it
            can take longer.
          </li>
          <li>
            We may suspend or discontinue the service. If we do, we&apos;ll
            make reasonable efforts to give you a chance to download your
            results first.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Your account</h2>
        <p>
          You sign in with a Google account via our authentication provider,
          Supabase. You&apos;re responsible for activity that happens under
          your account. You must be at least 13 years old (or the minimum age
          of digital consent in your country) to use PongLens.
        </p>
      </section>

      <section>
        <h2>5. Your videos and your responsibilities</h2>
        <p>You keep all rights to the videos you upload. In return, you promise that:</p>
        <ul>
          <li>
            You own the footage or have permission from whoever recorded it.
          </li>
          <li>
            People who appear in the video have consented to being recorded
            and to the footage being processed, where the law requires it.
          </li>
          <li>
            You won&apos;t upload anything unlawful, harmful, or unrelated to
            the purpose of the service.
          </li>
        </ul>
        <p>Specifically, the following content is prohibited:</p>
        <ul>
          <li>Anything unlawful or that infringes someone else&apos;s rights.</li>
          <li>
            Footage of minors without the consent of a parent or legal
            guardian.
          </li>
          <li>
            Recordings made without the knowledge or consent of the people
            recorded, where consent is required.
          </li>
        </ul>
        <p>
          You grant us a limited license to store, copy, and process your
          videos solely to provide the service to you. We claim no other
          rights in your content.
        </p>
      </section>

      <section>
        <h2>6. Storage and deletion</h2>
        <p>
          Uploaded videos are automatically deleted 30 days after upload.
          Processed results are retained while your account is active so you
          can re-download them. See the{" "}
          <Link href="/privacy">Privacy Policy</Link> for details.
        </p>
      </section>

      <section>
        <h2>7. Acceptable use</h2>
        <ul>
          <li>Don&apos;t attempt to access other users&apos; videos or data.</li>
          <li>Don&apos;t probe, overload, or disrupt the service.</li>
          <li>Don&apos;t use automated tools to bulk-upload content.</li>
          <li>
            Don&apos;t upload content you don&apos;t have the right to upload.
          </li>
        </ul>
        <p>
          We may remove any content and suspend or terminate any account at
          our discretion, including (but not only) for violations of these
          rules.
        </p>
      </section>

      <section>
        <h2>8. Takedown requests</h2>
        <p>
          If you believe a video on PongLens includes you without your
          consent, or infringes your rights, email{" "}
          <a href="mailto:adilharis2001@gmail.com">adilharis2001@gmail.com</a>{" "}
          with enough detail to identify the content. We&apos;ll review
          promptly and remove content that violates these terms or the law,
          typically within a few business days.
        </p>
      </section>

      <section>
        <h2>9. Disclaimers</h2>
        <p>
          The service is provided &quot;as is&quot; and &quot;as
          available&quot;, without warranties of any kind, express or implied.
          Analysis output is automated and may contain errors. It&apos;s a
          training aid, not an official record of play.
        </p>
      </section>

      <section>
        <h2>10. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, PongLens will not be liable
          for indirect, incidental, special, consequential, or punitive
          damages, or for lost data, arising from your use of the service.
          Our total liability for any claim relating to the service is capped
          at the greater of $10 or the amount you paid us in the 12 months
          before the claim. Keep your own copy of any video you upload.
          Don&apos;t treat PongLens as a backup.
        </p>
      </section>

      <section>
        <h2>11. Indemnification</h2>
        <p>
          If someone brings a claim against us because content you uploaded
          violated their rights (for example, you didn&apos;t have permission
          to record or upload it) or because you broke these terms, you agree
          to cover the resulting costs, including reasonable legal fees.
        </p>
      </section>

      <section>
        <h2>12. Changes to these terms</h2>
        <p>
          We may update these terms as the product evolves. If we make
          material changes, we&apos;ll note the new date at the top of this
          page and, where practical, notify you in the app or by email.
          Continuing to use the service after changes take effect means you
          accept them.
        </p>
      </section>

      <section>
        <h2>13. Governing law</h2>
        <p>
          These terms are governed by the laws of [Your State], without regard
          to conflict-of-law rules.
        </p>
      </section>

      <section>
        <h2>14. Contact</h2>
        <p>
          Questions? Email{" "}
          <a href="mailto:adilharis2001@gmail.com">adilharis2001@gmail.com</a>.
        </p>
      </section>
    </LegalPage>
  );
}
