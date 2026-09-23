import { useQuery } from "@tanstack/react-query";
import { queries } from "./api/queries";
import { AuthGate } from "./auth/AuthGate";

function App() {
  return (
    <main>
      <h1>Satis Manager</h1>
      <AuthGate>
        <BackendHealth />
      </AuthGate>
    </main>
  );
}

function BackendHealth() {
  const health = useQuery(queries.health());
  return (
    <p>
      Backend:{" "}
      {health.isError ? "Could not reach backend" : health.data ? `status: ${health.data.status}` : "checking..."}
    </p>
  );
}

export default App;
