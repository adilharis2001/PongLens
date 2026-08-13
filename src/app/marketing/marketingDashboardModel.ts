export interface MarketingSpace {
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly href: `/marketing/${string}`;
  readonly accent: "cyan" | "magenta";
  /**
   * "planned" means the space is agreed but has no page yet, so the card
   * renders without a link. The alternative was leaving it off the hub
   * until its page exists, which hides what is being worked on from the
   * one screen meant to show it.
   */
  readonly status: "live" | "planned";
}

export const MARKETING_SPACES = [
  {
    title: "Coach outreach",
    category: "Coaches",
    description:
      "Coaches found on Instagram, with every way of reaching them in one place, and the stage each one is at.",
    href: "/marketing/coach-outreach",
    accent: "cyan",
    status: "live",
  },
] as const satisfies readonly MarketingSpace[];

export function hasMarketingAccess(
  isAdmin: boolean,
  hasMarketingRole: boolean,
): boolean {
  return isAdmin || hasMarketingRole;
}
