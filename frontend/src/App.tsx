import { AuthGate } from "./auth/AuthGate";
import { StatusBanners } from "./components/StatusBanners";
import { ServerGate } from "./servers/ServerGate";

function App() {
  return (
    <main>
      <h1>Satis Manager</h1>
      <AuthGate>
        <ServerGate>
          <StatusBanners />
        </ServerGate>
      </AuthGate>
    </main>
  );
}

export default App;
