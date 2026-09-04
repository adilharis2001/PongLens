export type EmailCategory =
  | "auth"
  | "beta"
  | "match"
  | "coaching"
  | "billing"
  | "digest"
  | "ops";

export type EmailAudience = "player" | "coach" | "tester" | "admin";

export type EmailItem = {
  title: string;
  description?: string;
  meta?: string;
  url?: string;
};

export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "steps"; items: readonly string[] }
  | {
      type: "details";
      rows: readonly { label: string; value: string }[];
    }
  | {
      type: "items";
      heading?: string;
      items: readonly EmailItem[];
    }
  | { type: "diagnostic"; text: string };

export type EmailMessage = {
  templateId: string;
  templateVersion: number;
  category: EmailCategory;
  audience: EmailAudience;
  subject: string;
  preheader: string;
  eyebrow?: string;
  heading: string;
  blocks: readonly EmailBlock[];
  action?: { label: string; url: string };
  reason: string;
  support?: boolean;
};

export type RenderedEmail = {
  templateId: string;
  templateVersion: number;
  subject: string;
  html: string;
  text: string;
};

