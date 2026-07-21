export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: string;
  user_id: string;
  status: JobStatus;
  kind: string;
  input_path: string | null;
  result_path: string | null;
  error: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}
