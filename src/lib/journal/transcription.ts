export function shouldPersistTranscription(
  value: FormDataEntryValue | null,
): boolean {
  return value !== "false";
}
