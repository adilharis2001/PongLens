export type LearnAudience = "player" | "coach";
export type LearnPlatform = "web" | "ios";

export interface LearnVisibility {
  audiences: LearnAudience[];
  platforms: LearnPlatform[];
}

export interface GuideImage {
  src: string;
  alt: string;
  kind: "m" | "d";
  phoneTwin?: boolean;
}

export interface GuideSection {
  heading?: string;
  steps?: string[];
  paragraphs?: string[];
  bullets?: string[];
  tip?: string;
  images?: GuideImage[];
  visibility?: LearnVisibility;
}

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  group: string;
  visibility: LearnVisibility;
  sections: GuideSection[];
  related?: string[];
}

export interface TutorialChapter {
  slug: string;
  title: string;
  blurb: string;
  seconds: number;
  guide?: string;
  visibility: LearnVisibility;
  mediaKey: string;
}

export interface NumberedTutorialChapter extends TutorialChapter {
  n: number;
}
