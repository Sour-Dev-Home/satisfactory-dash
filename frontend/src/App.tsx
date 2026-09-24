import type { ReactNode } from "react";
import { AuthGate } from "./auth/AuthGate";
import { LogoutButton } from "./auth/LogoutButton";
import { CrashProbe } from "./components/CrashProbe";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FactoryView } from "./factory/FactoryView";
import { PowerView } from "./power/PowerView";
import { SourceFooter } from "./components/SourceFooter";
import { StatusBanners } from "./components/StatusBanners";
import { ServerGate } from "./servers/ServerGate";
import { AutoPauseView } from "./settings/AutoPauseView";
import { StatusView } from "./status/StatusView";

/** One boundary per section: a crash in one leaves the others working. */
function Section({ label, probe, children }: { label: string; probe: string; children: ReactNode }) {
  return (
    <ErrorBoundary label={label}>
      <CrashProbe section={probe} />
      {children}
    </ErrorBoundary>
  );
}

function App() {
  return (
    <>
      <main>
        <h1>Satis Manager</h1>
        {/* The outer boundary keeps the title and the footer's source link on any crash,
            and offers Log out, since the crash takes AuthGate's button with it. */}
        <ErrorBoundary label="The dashboard" actions={<LogoutButton />}>
          <CrashProbe section="app" />
          <AuthGate>
            <ServerGate>
              <Section label="Server banners" probe="banners">
                <StatusBanners />
              </Section>
              <Section label="Server status" probe="status">
                <StatusView />
              </Section>
              <Section label="Power" probe="power">
                <PowerView />
              </Section>
              <Section label="Factory" probe="factory">
                <FactoryView />
              </Section>
              <Section label="Server settings" probe="settings">
                <AutoPauseView />
              </Section>
            </ServerGate>
          </AuthGate>
        </ErrorBoundary>
      </main>
      <SourceFooter />
    </>
  );
}

export default App;
