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
    <LegalPage title="Privacy Policy" updated="September 15, 2026">
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
          with. We do not use facial recognition and cannot identify anyone
          from your footage. Recollect is currently switched off.
        </p>
      </section>

      <section>
        <h2>Who is responsible for your data</h2>
        <p>
          PongLens is operated by AH Labs LLC, a New Jersey limited liability
          company in the United States, which is the controller of the
          personal data described here. For any privacy
          question or request, including the ones listed in section 11, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>

      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>
            <strong>Account information.</strong> We receive your email
            address through our authentication provider. If you sign in with
            Google or Apple, we also receive the name and profile picture
            that they provide. If you sign in by email, we send you a
            one-time sign-in link. PongLens does not collect or store an
            account password for any of these methods.
          </li>
          <li>
            <strong>Your birth month and year.</strong> Asked once at signup to
            confirm you meet the minimum age.
          </li>
          <li>
            <strong>iPhone beta requests.</strong> If you request the iPhone
            beta, we keep the email address, role, feature interests and
            optional feedback preferences you provide, along with when you
            requested access and whether the invitation was delivered. If you
            volunteer to share feedback, we may email you about your
            experience or to arrange the type of call you chose. This does not
            affect beta access. Only PongLens administrators can access these
            requests. We do not use them for marketing.
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
            <strong>Aggregate usage.</strong> Our website analytics are
            cookieless: they count page views and visits in aggregate,
            without setting cookies and without profiling or identifying you
            individually.
          </li>
        </ul>
        <p>
          We run no third-party advertising trackers. The only cookies PongLens
          sets are the essential first-party cookies your sign-in session
          needs to keep you logged in.
        </p>
      </section>

      <section>
        <h2>2. Where your data is held and processed</h2>
        <p>
          Video files, point clips, and voice note audio are held in private,
          encrypted cloud storage operated by a provider based in the United
          States. Your account, match data, and notes are held in a managed
          database in Canada. Video processing runs on hardware we control in
          the United States: your video is brought to that hardware,
          processed, and the results are returned to private storage.
        </p>
        <p>
          Some steps send a limited amount of your content to two providers
          so we can give you the result. Deepgram turns voice note audio into
          text. OpenAI runs automated checks during video processing and the
          AI-assisted features you choose to use, which are lesson summaries,
          Journal photo reading, Ask, Recollect, feedback assistance, and page
          drafting for coaches. Each receives only what that step needs,
          returns the result to us, and is contractually barred from using
          your content to train or improve its own models. Section 8
          lists the categories of provider we use. Before the first time a
          feature sends your content to one of these providers, we ask you in
          the app, and you can switch it off in Account.
        </p>
      </section>

      <section>
        <h2>2a. Why we are allowed to use your data</h2>
        <p>
          If you are in the European Economic Area or the United Kingdom, data
          protection law requires us to tell you the legal basis for each
          purpose:
        </p>
        <ul>
          <li>
            <strong>Running your account and processing your videos:</strong>{" "}
            performing our contract with you.
          </li>
          <li>
            <strong>
              Keeping the service secure, debugging failures, and improving the
              accuracy of our analysis:
            </strong>{" "}
            our legitimate interest in running a reliable service. You can
            object to this.
          </li>
          <li>
            <strong>AI-assisted features, including Recollect:</strong> your
            consent, which you can withdraw at any time in Account.
          </li>
          <li>
            <strong>Purchase and payment records:</strong> our legal
            obligations, including tax and accounting.
          </li>
        </ul>
        <p>
          Where we rely on consent, withdrawing it does not affect anything we
          did before you withdrew it, and it does not affect the rest of the
          service.
        </p>
      </section>

      <section>
        <h2>2b. If you are in Europe or the UK</h2>
        <p>
          PongLens is operated from the United States, so using it means your
          data is held and processed there, and in Canada. The European
          Commission has decided that Canada provides an adequate level of
          protection for personal data.
        </p>
        <p>
          Every provider we use is bound by a data processing agreement that
          limits them to acting on our instructions, and those agreements
          include the European Commission&apos;s standard contractual clauses
          where they are required. If you want to know what applies to your
          data, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and we will
          tell you.
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
          <li>
            <strong>Server and processing logs:</strong> kept for up to 90
            days, then deleted.
          </li>
          <li>
            <strong>
              Records of the terms you accepted and the consents you gave:
            </strong>{" "}
            kept while your account is active and for one year afterward, so
            we can show what was agreed and when.
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
          storage and sent to a speech-to-text provider to produce a
          transcript. That provider may not use your recordings to improve its
          own models; it transcribes them and nothing more. We do not create a
          voiceprint and cannot recognise anyone by their voice. The audio is
          deleted after 90 days. The transcript stays with your account like
          any other note, and you can edit or delete it yourself at any time.
          If you want a specific recording or transcript deleted sooner,
          email us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>5. Recollect</h2>
        <p>
          Recollect is currently switched off. When it is on, it is off for new
          accounts until you turn it on. When you save an eligible lesson or
          practice note, PongLens may send its text to an AI provider to
          identify a small number of useful, source-linked training reminders.
          A note may produce no reminder when it does not contain genuinely
          useful coaching or practice guidance. Reminders are generated
          automatically, so check the note they link to before relying on
          them.
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
        <p>
          We rely on a small set of providers to run PongLens. Each one
          processes only what it needs to perform its role, and none of them
          may use your content to train or improve their own models:
        </p>
        <ul>
          <li>
            <strong>Authentication, database, and job queue</strong>, hosted
            in Canada.
          </li>
          <li>
            <strong>Private cloud storage</strong> in the United States, for
            video files, point clips, and voice note audio.
          </li>
          <li>
            <strong>Deepgram</strong>, in the United States, for voice note
            transcription only.
          </li>
          <li>
            <strong>OpenAI</strong>, in the United States, for automated
            checks during video processing and for the AI-assisted features
            listed in section 2.
          </li>
          <li>
            <strong>Website hosting</strong> and cookieless, aggregate traffic
            analytics.
          </li>
          <li>
            <strong>Email delivery</strong>, for one-time sign-in links,
            match-ready notifications, and requested iPhone beta invitations.
          </li>
          <li>
            <strong>Sign-in with Google or Apple</strong>, if you choose it.
            Their own privacy policies govern your Google or Apple account.
          </li>
          <li>
            <strong>Stripe</strong>, for payments and coach payouts. See
            section 9a.
          </li>
        </ul>
        <p>
          If you want to know exactly which companies these are, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and we will
          tell you. Clubs and coaching organisations can also request the full
          list as part of a data processing agreement.
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
        <h2>10a. What our analysis does, and what it does not do</h2>
        <p>
          Our software finds the ball, the table, and where the players are
          standing, so it can cut a match into points and show you where
          serves landed. It does not use facial recognition, does not create
          voiceprints, and cannot work out who anyone is. We do not keep the
          body-position data it uses along the way, and we never use your
          footage to identify a person.
        </p>
        <p>
          The analysis is automated, and it produces no legal effect and
          nothing that similarly significantly affects you. It is a training
          aid, not an official record of play. Summaries, reminders, and
          transcripts produced by AI are marked as such where they appear.
        </p>
      </section>

      <section>
        <h2>11. Your rights</h2>
        <p>
          Wherever you live, you can ask us to give you a copy of your data,
          correct it, or delete your account and everything tied to it across
          every retention tier listed above. If you are in the European
          Economic Area or the United Kingdom, you can also ask us to restrict
          how we use your data, object to our use of it where we rely on
          legitimate interests, receive it in a portable form, and withdraw
          any consent you have given.
        </p>
        <p>
          Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and
          we&apos;ll respond within 30 days. If you are in the EEA or the UK
          and you are not satisfied with our response, you can complain to the
          data protection authority where you live or work. Residents of
          California and other US states may have further statutory rights; we
          honour reasonable requests regardless of where you live.
        </p>
      </section>

      <section>
        <h2>12. Children and young players</h2>
        <p>
          A player needs to be at least 13 to have their own PongLens account,
          or at least 16 in the European Economic Area unless their country
          sets a lower age. A younger player uses PongLens through an account
          created and held by a parent or legal guardian, who accepts the{" "}
          <Link href="/terms">Terms</Link> for them, decides what is shared,
          and can delete everything at any time.
        </p>
        <p>
          We do not knowingly collect data directly from a child below those
          ages, and we do not advertise or profile anyone. If you believe a
          child holds their own account, contact us and we will move it to a
          parent or delete it. If you are a parent or guardian and you want to
          see, correct, or delete what we hold about your child, or you
          believe your child appears in someone else&apos;s video without your
          consent, email{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and we will
          deal with it.
        </p>
      </section>

      <section>
        <h2>13. Changes to this policy</h2>
        <p>
          If we change how we handle your data, we&apos;ll update this page
          and the date at the top, and flag material changes in the app or by
          email.
        </p>
        <p>
          If PongLens moves to another company, for example its own company or
          a buyer, your data moves with it and stays covered by this policy.
          We&apos;ll tell you in the app or by email before that happens.
        </p>
      </section>

      <section>
        <h2>14. Contact</h2>
        <p>
          AH Labs LLC, New Jersey, United States. Privacy questions or
          requests:{" "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
