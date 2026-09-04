export interface TutorialURLLoadState {
  status: "loading" | "ready" | "failed";
  urls: Record<string, string>;
}

export function tutorialURLLoadStarted(): TutorialURLLoadState {
  return { status: "loading", urls: {} };
}

export function tutorialURLLoadSucceeded(
  urls: Record<string, string>,
): TutorialURLLoadState {
  return { status: "ready", urls };
}

export function tutorialURLLoadFailed(): TutorialURLLoadState {
  return { status: "failed", urls: {} };
}

export function tutorialLoadFailureMessage(chapterTitle: string): string {
  return `We couldn’t load “${chapterTitle}”.`;
}
