/**
 * The admin hub: four subpages, each a card. The detail line under a card
 * is live state (pending work, headline counts), never a description of
 * what the page contains — the title carries that.
 */

export const ADMIN_PAGES = [
  { key: "access", href: "/admin/access", title: "Access" },
  { key: "storage", href: "/admin/storage", title: "Storage" },
  { key: "players", href: "/admin/players", title: "Players" },
  { key: "costs", href: "/admin/costs", title: "Platform costs" },
] as const;

export type AdminPageKey = (typeof ADMIN_PAGES)[number]["key"];

export interface PortalCounts {
  access_requests: number;
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
  counts: PortalCounts | null
): HubDetail | null {
  if (!counts) return null;
  switch (key) {
    case "access":
      return waiting(counts.access_requests, "request");
    case "storage":
      return waiting(counts.quota_requests, "request");
    case "players":
      return {
        text: `${counts.players} players · ${counts.matches} matches`,
        attention: false,
      };
    case "costs":
      return null;
  }
}
