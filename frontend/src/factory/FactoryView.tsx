import { useMemo, useState } from "react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router";
import { FACTORY_ITEM_PARAM, FACTORY_SEARCH_PARAM, readItem, readSearch } from "../lib/deepLinks";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { PanelError } from "../components/PanelError";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable } from "../ui/Skeleton";
import { FactorySkeleton } from "./FactorySkeleton";
import { ItemHistorySection, SinceYesterdayView } from "./FactoryHistory";
import { BottleneckSummaryView } from "./BottleneckSummary";
import { BottlenecksView } from "./BottlenecksView";
import { FactoryPanel } from "./FactoryPanel";
import { itemLabels } from "./itemLabels";

/**
 * Container: polls factory through the query layer every 30 s (ADR-0005), with what changed since
 * yesterday above the table and the production history below it (ADR-0027). Each history part has
 * its own crash boundary, so a fault there leaves the table working.
 */
export function FactoryView() {
  const server = useSelectedServer();
  const { query: factory, firstLoad, error } = useSettledQuery(queries.factory(server.id));
  // Deep links (#351): the machine search (?q=) and the history's item (?item=) live in the URL, so
  // a link or the command bar can open the page with them set. Replaced, not pushed: typing a
  // search mustn't fill the back button. Other parameters (e.g. dev:mock's scenario) are kept.
  // `useSearchParams().setSearchParams` navigates to a bare "?<params>" (react-router's
  // `useSearchParams` hook, dist/development/lib/dom/lib.js), which drops the URL's fragment — so a
  // deep link into #history would vanish the moment the search box is typed into. Go through
  // `navigate` directly instead, carrying the current hash along.
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const item = readItem(params);
  // The search box keeps its own value while you type; the URL only mirrors it. Reading it back
  // from the URL made the box lag a render behind the router (the cursor jumped to the end and fast
  // keystrokes were dropped: the ui review). A new ?q= is taken from the URL only when a navigation
  // brings one (a link, the command bar, back/forward); this page's own replaces are just echoes.
  const [search, setSearch] = useState(() => readSearch(params));
  const [seenLocation, setSeenLocation] = useState(location.key);
  if (location.key !== seenLocation) {
    setSeenLocation(location.key);
    if (navigationType !== "REPLACE") setSearch(readSearch(params));
  }
  const setParam = (name: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value === undefined) next.delete(name);
    else next.set(name, value);
    navigate(
      { search: next.toString(), hash: location.hash },
      { replace: true, preventScrollReset: true },
    );
  };
  // History carries only class names: names and units come from the live factory.
  const buildings = factory.data?.data.buildings;
  const labels = useMemo(() => itemLabels(buildings ?? []), [buildings]);
  // One reveal (ADR-0032, #494): the page waits for these in the shell (shell/pageQueries.ts), so by the
  // time it shows, the table and "Since yesterday" are usually both here; a slow history read shows its
  // reserved box instead, and the table never waits on it past the page budget.
  return (
    <Loadable pending={firstLoad} skeleton={<FactorySkeleton />} className="grid gap-4">
      {/* The most actionable part first (ADR-0062 F.1), in a fixed-height box so its late read moves nothing below it. */}
      <ErrorBoundary label="Bottleneck summary">
        <BottleneckSummaryView />
      </ErrorBoundary>
      <ErrorBoundary label="Since yesterday">
        <SinceYesterdayView labels={labels} />
      </ErrorBoundary>
      {error != null && <PanelError error={error} title="Factory" hasData={factory.data !== undefined} />}
      {factory.data && (
        <FactoryPanel
          snapshot={factory.data}
          refetchFailed={factory.isRefetchError}
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setParam(FACTORY_SEARCH_PARAM, value === "" ? undefined : value);
          }}
        />
      )}
      <ErrorBoundary label="Production history">
        <ItemHistorySection labels={labels} item={item} onItem={(value) => setParam(FACTORY_ITEM_PARAM, value)} />
      </ErrorBoundary>
      {/* The full list last, so its loading and its varying height move nothing above it (ADR-0032's shift budget). */}
      <ErrorBoundary label="Bottlenecks">
        <BottlenecksView />
      </ErrorBoundary>
    </Loadable>
  );
}
