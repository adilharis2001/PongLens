export type WorkingOnMicState = "idle" | "recording" | "writing";

export interface WorkingOnMicPresentation {
  label: string;
  ariaLabel: string;
  disabled: boolean;
}

export function workingOnMicPresentation(
  state: WorkingOnMicState,
): WorkingOnMicPresentation {
  if (state === "recording") {
    return {
      label: "Stop",
      ariaLabel: "Stop recording",
      disabled: false,
    };
  }
  if (state === "writing") {
    return {
      label: "Writing…",
      ariaLabel: "Transcribing cue",
      disabled: true,
    };
  }
  return {
    label: "Dictate",
    ariaLabel: "Speak the cue",
    disabled: false,
  };
}
