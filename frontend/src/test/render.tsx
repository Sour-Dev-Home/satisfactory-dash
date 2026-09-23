import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../api/queries";

/** Renders with a fresh QueryClient per test, so cached data never leaks between tests. */
export function renderWithClient(ui: ReactElement) {
  const client = createQueryClient();
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}
