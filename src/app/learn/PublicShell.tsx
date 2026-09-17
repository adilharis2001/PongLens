import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * The marketing chrome around a Learn page for someone who is not signed
 * in: the public header and footer instead of the app's nav, and the same
 * content column the signed-in shell uses, so a guide reads the same
 * either way.
 */
export function PublicShell({
  audience,
  children,
}: {
  audience: "player" | "coach";
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader audience={audience === "coach" ? "coaches" : "players"} />
      <main className="flex-1 pb-16">
        <div className="mx-auto w-full max-w-4xl px-5 pt-8 sm:px-6 md:pt-12">
          {children}
        </div>
      </main>
      <SiteFooter audience={audience === "coach" ? "coaches" : "players"} />
    </>
  );
}
