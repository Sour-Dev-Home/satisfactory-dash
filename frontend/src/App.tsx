import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { AuthGate } from "./auth/AuthGate";
import { LogoutButton } from "./auth/LogoutButton";
import { CrashProbe } from "./components/CrashProbe";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SourceFooter } from "./components/SourceFooter";
import { DemoBanner } from "./demo/DemoBanner";
import { IS_DEMO } from "./demo/mode";
import { Landing } from "./landing/Landing";
import { PairPage } from "./selfServe/PairPage";
import { ServerGate } from "./servers/ServerGate";
import { Shell } from "./shell/Shell";
import { ToApp, ToPair } from "./shell/ToApp";
import { HazardStripe } from "./ui/HazardStripe";
import { Logo } from "./ui/Logo";

/** The pair page links to /app with the server it paired in router state (never the URL); that one opens first. */
function PairedServerGate({ children }: { children: ReactNode }) {
  const state = useLocation().state as { selectServerId?: unknown } | null;
  const id = typeof state?.selectServerId === "string" ? state.selectServerId : undefined;
  return <ServerGate initialId={id}>{children}</ServerGate>;
}

/**
 * Everything inside the router. The browser wraps it in BrowserRouter (App); the build prerenders the landing page
 * from it under a StaticRouter at "/" (src/landing/prerender.tsx) and the browser hydrates that markup, so the two
 * must render the same tree.
 */
export function AppFrame() {
  return (
    <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 sm:px-6">
      <header className="grid gap-3 pt-4 pb-5">
        <h1 className="m-0 flex">
          <Logo />
        </h1>
        <HazardStripe />
        {/* Outside every boundary and gate: the demo says so on every screen, even a crash. */}
        {IS_DEMO && <DemoBanner />}
      </header>
      <main className="flex-1 pb-10">
        {/* The outer boundary keeps the title and the footer's source link on any crash,
            and offers Sign out, since the crash takes the top bar's account menu with it. */}
        <ErrorBoundary label="The dashboard" actions={<LogoutButton />}>
          <CrashProbe section="app" />
          <Routes>
            {/* ADR-0051 section 1: signed in, but outside ServerGate, since a player with no server pairs their first one here. */}
            <Route
              path="/app/pair"
              element={
                <AuthGate>
                  <PairPage />
                </AuthGate>
              }
            />
            <Route
              path="/app/*"
              element={
                <AuthGate>
                  <PairedServerGate>
                    <Shell />
                  </PairedServerGate>
                </AuthGate>
              }
            />
            <Route path="/pair" element={<ToPair />} />
            {/* The public front page, main site only: the demo's / is "Enter demo". */}
            {!IS_DEMO && <Route path="/" element={<Landing />} />}
            <Route path="*" element={<ToApp />} />
          </Routes>
        </ErrorBoundary>
      </main>
      <Routes>
        {/* The landing page's footer also links the static guides and changelog, so a crawler finds them. */}
        {!IS_DEMO && <Route path="/" element={<SourceFooter publicPages />} />}
        <Route path="*" element={<SourceFooter />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppFrame />
    </BrowserRouter>
  );
}

export default App;
