// Build time only (site/plugin.ts loads it through Vite's SSR module loader; nothing imports it in the browser bundle):
// the landing page's markup at "/", so the served HTML carries its text for crawlers and visitors without JavaScript.
// The tree is main.tsx's with StaticRouter for BrowserRouter, so the browser's hydrateRoot finds the same markup.
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { createQueryClient } from "../api/queries";
import { AppFrame } from "../App";

export function renderLanding(): string {
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <StaticRouter location="/">
          <AppFrame />
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
