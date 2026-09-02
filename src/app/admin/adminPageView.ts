/**
 * The admin hub: one card per subpage. The detail line under a card is
 * live state (pending work, headline counts), never a description of
 * what the page contains — the title carries that.
 */

export const ADMIN_PAGES = [
  { key: "backlog", href: "/admin/backlog", title: "Backlog" },
  { key: "storage", href: "/admin/storage", title: "Storage" },
  { key: "players", href: "/admin/players", title: "Players" },
  { key: "uploads", href: "/admin/uploads", title: "Uploads" },
  { key: "costs", href: "/admin/costs", title: "Platform costs" },
  { key: "reviews", href: "/admin/reviews", title: "Paid reviews" },
  { key: "commerce", href: "/admin/commerce", title: "Commerce" },
  { key: "outreach", href: "/admin/outreach", title: "Outreach and feedback" },
  // "QA access" rather than "Testing": this page is who holds the QA role
  // and which billing mode the admin is in. The tester's own workspace is
  // /testing, in ADMIN_WORKSPACES below, and two cards both called Testing
  // was a coin toss every time.
  { key: "testing", href: "/admin/testing", title: "QA access" },
] as const;

export type AdminPageKey = (typeof ADMIN_PAGES)[number]["key"];

/**
 * The other private workspaces. Neither is an admin subpage — they have
 * their own gates, and each admits people who are not the admin (research
 * reviewers, whoever holds the marketing role) — so they are deliberately
 * not in ADMIN_PAGES, whose routes all live under /admin.
 *
 * They are listed here because they are advertised nowhere else on purpose:
 * no landing page, header, footer, app nav or sitemap link exists, and the
 * tests beside each one keep it that way. That leaves the owner typing URLs
 * from memory, so /admin holds the door. It is admin-only itself, so this
 * links nothing for anyone who could not already reach it.
 */
export const ADMIN_WORKSPACES = [
  { key: "research", href: "/research", title: "Research" },
  { key: "marketing", href: "/marketing", title: "Marketing" },
  { key: "testing", href: "/testing", title: "Testing" },
] as const;

export interface PortalCounts {
  quota_requests: number;
  players: number;
  matches: number;
}

/** admin_outreach_counts (162): who is waiting for outreach attention. */
export interface OutreachCounts {
  to_contact: number;
  follow_ups_due: number;
}

export interface HubDetail {
  text: string;
  /** pending work the admin should look at — rendered in the accent color */
  attention: boolean;
}

function waiting(n: number, noun: string): HubDetail | null {
  if (n <= 0) return null;
  return {
    text: `${n} ${noun}${n === 1 ? "" : "s"} waiting`,
    attention: true,
  };
}

export function hubDetail(
  key: AdminPageKey,
  counts: PortalCounts | null,
  /** Open backlog items. Its own query rather than a field on
   *  admin_portal_counts: the backlog is the operator's list, not
   *  platform state, and it should not ride along in an RPC every other
   *  card depends on. */
  backlogOpen?: number | null,
  /** Its own query too, for the same reason as the backlog: the outreach
   *  numbers must not blank every other card when their RPC fails. */
  outreach?: OutreachCounts | null
): HubDetail | null {
  // Answered before the counts guard — these numbers load separately,
  // and one failing must not blank the other's card.
  if (key === "backlog") {
    if (typeof backlogOpen !== "number" || backlogOpen <= 0) return null;
    return {
      text: `${backlogOpen} open`,
      attention: false,
    };
  }
  if (key === "outreach") {
    if (!outreach) return null;
    const parts: string[] = [];
    if (outreach.to_contact > 0) {
      parts.push(`${outreach.to_contact} to contact`);
    }
    if (outreach.follow_ups_due > 0) {
      parts.push(
        `${outreach.follow_ups_due} follow-up${
          outreach.follow_ups_due === 1 ? "" : "s"
        } due`
      );
    }
    if (parts.length === 0) return null;
    // A due follow-up is a promise with a date on it; being merely new is
    // not urgent.
    return { text: parts.join(" · "), attention: outreach.follow_ups_due > 0 };
  }
  if (!counts) return null;
  switch (key) {
    case "storage":
      return waiting(counts.quota_requests, "request");
    case "players":
      return {
        text: `${counts.players} players · ${counts.matches} matches`,
        attention: false,
      };
    case "uploads":
      return {
        text: `${counts.matches} uploads`,
        attention: false,
      };
    case "costs":
    case "reviews":
    case "commerce":
    case "testing":
      return null;
  }
}
