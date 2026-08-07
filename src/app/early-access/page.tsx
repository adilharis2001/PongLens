import { redirect } from "next/navigation";

/** The invite gate is gone — the app is open. Old bookmarks and emails
 *  still point here, so the route stays as a redirect. */
export default function EarlyAccessPage() {
  redirect("/dashboard");
}
