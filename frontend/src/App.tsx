import { useEffect, useState } from "react";
import type { HealthResponse } from "@satisfactory-dash/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((res) => res.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setError("Could not reach backend"));
  }, []);

  return (
    <main>
      <h1>satisfactory-dash</h1>
      <p>
        Backend:{" "}
        {error ? error : health ? `status: ${health.status}` : "checking..."}
      </p>
    </main>
  );
}

export default App;
