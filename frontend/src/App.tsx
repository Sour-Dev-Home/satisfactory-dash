import { useQuery } from "@tanstack/react-query";
import { queries } from "./api/queries";

function App() {
  const health = useQuery(queries.health());

  return (
    <main>
      <h1>satisfactory-dash</h1>
      <p>
        Backend:{" "}
        {health.isError
          ? "Could not reach backend"
          : health.data
            ? `status: ${health.data.status}`
            : "checking..."}
      </p>
    </main>
  );
}

export default App;
