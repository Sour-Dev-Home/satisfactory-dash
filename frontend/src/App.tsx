import { AuthGate } from "./auth/AuthGate";
import { FactoryView } from "./factory/FactoryView";
import { PowerView } from "./power/PowerView";
import { SourceFooter } from "./components/SourceFooter";
import { StatusBanners } from "./components/StatusBanners";
import { ServerGate } from "./servers/ServerGate";
import { AutoPauseView } from "./settings/AutoPauseView";
import { StatusView } from "./status/StatusView";

function App() {
  return (
    <>
      <main>
        <h1>Satis Manager</h1>
        <AuthGate>
          <ServerGate>
            <StatusBanners />
            <StatusView />
            <PowerView />
            <FactoryView />
            <AutoPauseView />
          </ServerGate>
        </AuthGate>
      </main>
      <SourceFooter />
    </>
  );
}

export default App;
