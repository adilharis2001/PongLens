import { redirect } from "next/navigation";

// The Improve tab became the Journal (038). Old links keep working.
export default function ImproveRedirect() {
  redirect("/journal");
}
