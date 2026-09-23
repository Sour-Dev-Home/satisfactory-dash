import { AuthGate } from "./auth/AuthGate";
import { StatusBanners } from "./components/StatusBanners";
import { ServerGate } from "./servers/ServerGate";
import { StatusView } from "./status/StatusView";

function App() {
  return (
    <main>
      <h1>Satis Manager</h1>
      <AuthGate>
        <ServerGate>
          <StatusBanners />
          <StatusView />
        </ServerGate>
      </AuthGate>
    </main>
  );
}

export default App;
