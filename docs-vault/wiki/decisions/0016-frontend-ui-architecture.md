# ADR-0016: Frontend UI architecture: design system, app shell, visual validation

Status: accepted (project owner), 2026-09-24

## Context
Functionality is solid (4a-4g), but visuals are unplanned:
- one global frontend/src/index.css (111 lines), className used in 21 places
- no design tokens, no component library, no layout shell, no routing between views
- no visual or accessibility checks: all tests are jsdom, which never renders pixels
The owner wants a professional-looking site. Constraints:
- The CSP (frontend/public/_headers) has style-src 'self', so runtime CSS-in-JS libraries that
  inject <style> tags (emotion, styled-components, MUI's default) are out.
- Prefer mainstream, resume-legible tools.
- frontend/ has exactly one owning session.

## Decision
1. **One owner stays.** satisfactory-dash-frontend owns all of frontend/, including visuals; no
   second writer. Its definition of done grows to include visual validation (item 5).
2. **Styling:** Tailwind CSS v4 (@tailwindcss/vite plugin, `@import "tailwindcss"` in index.css),
   with design tokens in `@theme` CSS variables (color, type scale, spacing, radius), dark theme
   first. It builds to a static CSS file, so it's CSP-safe.
3. **Components:** shadcn/ui (components copied into src/components/ui; accessible Radix
   primitives; styles are Tailwind classes). No other UI kit. Any new UI dependency must be
   CSP-compatible (no injected <style>).
4. **App shell + routing:** a persistent layout (top bar: product name, server switcher,
   account menu; nav: Overview, Power, Factory, Settings, later Map) with URL-per-view routing via
   React Router in library mode (mainstream; no file-based framework, per frontend/CLAUDE.md).
   The existing query layer and presentational components stay; only layout and styling change.
5. **Visual validation (the missing feedback loop):**
   - Playwright browser tests that mock /api/* with page.route() using the shared fixtures, so
     every state renders deterministically: loading, error codes, stale, paused, outage,
     at_risk, battery, backed-up, no recipe, login, read-only toggle.
   - Screenshots at 1440 px and 390 px widths for each state. Visual regression via
     toHaveScreenshot, with baselines committed and generated in CI's Linux Playwright image
     for stable fonts.
   - Accessibility with @axe-core/playwright (WCAG AA incl. contrast): zero violations required.
   - A read-only `ui-reviewer` custom agent (like security-reviewer/test-hunter) that the frontend
     session spawns on UI PRs. It views the screenshots and reports against a checklist: visual
     hierarchy, spacing rhythm, alignment, token consistency, state clarity, contrast, mobile
     layout, copy. It never edits.
   - UI PRs attach before/after screenshots in the description.

6. **Interactive visual loop for the agent (added 2026-09-24).** CI screenshots are the
   regression net, not the design method. While building, the frontend session drives a real
   browser itself: open the dev server, look, click, resize to 390 px, read console errors, fix,
   repeat.
   - Primary: **Playwright MCP**. It launches an isolated browser, and the agent works from the
     page's accessibility tree plus screenshots.
   - Optional: **Claude in Chrome**, when the owner wants to watch it live in a visible window.
     It shares the owner's logged-in browser state, so use a separate Chrome profile with no
     personal logins.
   - Chrome DevTools MCP only for deep debugging: performance traces, network.
7. **Design direction before styling.** The owner picks a direction from 2-3 rendered options
   (plus any reference sites the owner likes). That choice is written down as tokens, and every later
   UI PR is judged against them (by the ui-reviewer checklist). If a designer or Figma file ever
   exists, it becomes the source of truth via Figma's MCP server instead.

8. **CSP stays strict; runtime style injection is detected, not assumed (added 2026-09-24).**
   Every Playwright test listens for `securitypolicyviolation` events, and any violation fails
   the test (from step 2). Some Radix modal primitives used by shadcn (Dialog, Sheet, possibly
   Select/DropdownMenu/Popover in modal mode) are believed to inject a runtime <style> via
   react-remove-scroll [NEEDS VERIFICATION in step 4]. Order of preference if that's confirmed:
   (1) use non-modal variants; the dashboard needs few modals.
   (2) If a modal is truly needed, decide in a small ADR amendment with evidence between:
       - a per-response nonce injected by a small Worker script (HTMLRewriter), which adds a
         Worker script to ADR-0013's static-only setup
       - `style-src 'self' 'unsafe-inline'`, which is lower risk than script injection;
         script-src stays 'self'
   Never loosen script-src.

## Consequences
- Looks become reviewable and regress-proof instead of subjective.
- New dependencies: tailwindcss, @tailwindcss/vite, Radix via shadcn, react-router,
  @playwright/test, @axe-core/playwright.
- Playwright adds a CI job (~1-2 min), and screenshot baselines need updating when a change is
  intentional.

## Revisit when
- The map arrives. Choose the map library then (MapLibre GL / Leaflet); its CSP needs, e.g.
  worker-src blob:, are decided in that ADR.
- A second frontend developer joins (then consider Storybook for component documentation).
