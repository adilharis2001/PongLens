/**
 * The admin hub: one card per subpage. The detail line under a card is
 * live state (pending work, headline counts), never a description of
 * what the page contains — the title carries that.
 */

export const ADMIN_PAGES = [
  { key: "backlog", href: "/admin/backlog", title: "Backlog" },
  { key: "storage", href: "/admin/storage", title: "Storage" },
  { key: "players", href: "/admin/players", title: "Players" },
  { key: "costs", href: "/admin/costs", title: "Platform costs" },
  { key: "reviews", href: "/admin/reviews", title: "Paid reviews" },
  { key: "testing", href: "/admin/testing", title: "Testing" },
] as const;

export type AdminPageKey = (typeof ADMIN_PAGES)[number]["key"];

export interface PortalCounts {
  quota_requests: number;
  players: number;
  matches: number;
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
  backlogOpen?: number | null
): HubDetail | null {
  // Answered before the counts guard — the two numbers load separately,
  // and one failing must not blank the other's card.
  if (key === "backlog") {
    if (typeof backlogOpen !== "number" || backlogOpen <= 0) return null;
    return {
      text: `${backlogOpen} open`,
      attention: false,
    };
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
    case "costs":
    case "reviews":
    case "testing":
      return null;
  }
}
