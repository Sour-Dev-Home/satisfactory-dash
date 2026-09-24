import { BrowserRouter, Route, Routes } from "react-router";
import { AuthGate } from "./auth/AuthGate";
import { LogoutButton } from "./auth/LogoutButton";
import { CrashProbe } from "./components/CrashProbe";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SourceFooter } from "./components/SourceFooter";
import { DemoBanner } from "./demo/DemoBanner";
import { IS_DEMO } from "./demo/mode";
import { ServerGate } from "./servers/ServerGate";
import { Shell } from "./shell/Shell";
import { ToApp } from "./shell/ToApp";

function App() {
  return (
    <BrowserRouter>
      <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-4 sm:px-6">
        <header className="grid gap-3 py-4">
          <h1 className="flex items-center gap-2.5 text-xl font-bold text-fg-strong">
            <span aria-hidden="true" className="size-6 rounded-md bg-accent" />
            Satis Manager
          </h1>
          {/* Outside every boundary and gate: the demo says so on every screen, even a crash. */}
          {IS_DEMO && <DemoBanner />}
        </header>
        <main className="flex-1 pb-10">
          {/* The outer boundary keeps the title and the footer's source link on any crash,
              and offers Log out, since the crash takes the top bar's button with it. */}
          <ErrorBoundary label="The dashboard" actions={<LogoutButton />}>
            <CrashProbe section="app" />
            <Routes>
              <Route
                path="/app/*"
                element={
                  <AuthGate>
                    <ServerGate>
                      <Shell />
                    </ServerGate>
                  </AuthGate>
                }
              />
              <Route path="*" element={<ToApp />} />
            </Routes>
          </ErrorBoundary>
        </main>
        <SourceFooter />
      </div>
    </BrowserRouter>
  );
}

export default App;
