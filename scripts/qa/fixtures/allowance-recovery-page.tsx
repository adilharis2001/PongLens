"use client";
import { useState } from "react";
import { AllowanceRecovery } from "@/components/AllowanceRecovery";
import { YouTubeImport } from "@/components/YouTubeImport";
import { UploadCard } from "@/app/dashboard/UploadCard";
export default function Fixture() {
  const [attempts, setAttempts] = useState(0);
  const [resource, setResource] = useState<"storage" | "minutes">("storage");
  const [showImport, setShowImport] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  return <main className="mx-auto max-w-lg p-5">
    <button onClick={() => setShowImport(true)}>Show import</button>
    <button onClick={() => setShowUpload(true)}>Show upload</button>
    {showUpload ? <UploadCard userId="11111111-1111-4111-8111-111111111111" commerceEnabled /> : showImport ? <YouTubeImport userId="11111111-1111-4111-8111-111111111111" commerceEnabled /> : <>
    <h1>Upload a match</h1>
    <p>club-match.mp4</p>
    <label>Opponent<input aria-label="Opponent" defaultValue="Alex" /></label>
    <button onClick={() => setResource("minutes")}>Minute limit</button>
    <p role="status">Attempts: {attempts}</p>
    <AllowanceRecovery key={resource} resource={resource} retryLabel={resource === "storage" ? "Try upload again" : "Check minutes"} onRetry={() => setAttempts((n) => n + 1)} />
    </>}
  </main>;
}
