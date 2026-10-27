import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bottleneck, PlannerSite, ProductionGraphResponse } from "@satisfactory-dash/shared";
import { DataAge } from "../components/DataAge";
import { formatTime } from "../format";
import { cn } from "../lib/cn";
import { Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { BottleneckBadge } from "./BottleneckBadge";
import { FactoryFacts, FactoryFlows } from "./FactoryParts";
import { useDesignationChanges } from "./designationChanges";
import { DesignateBar, DesignatedControls, ErrorLine, KeepForm, SuggestionControls } from "./DesignationParts";
import { useDesignations } from "./DesignationContext";
import { STALE_TEXT } from "./designationText";
import { MergeBar, SplitBar } from "./MergeSplitParts";
import { splitSourceOf } from "./selectionPlans";
import { UndoToast } from "./UndoToast";
import { usePopOut } from "./usePopOut";
import { LazySiteGraph } from "./graph/GraphLoader";
import type { CanvasSuggestions } from "./graph/SiteGraph";
import {
  connectionRows,
  factoryModels,
  factoryOfNode,
  hasFactories,
  remoteInfo,
  unassignedCount,
  type FactoryModel,
} from "./graph/hierarchy";
import { useWideScreen } from "./graph/useWideScreen";
import { ConnectionsTable, GroupsTable, type FactoryColumns, type GroupSelection } from "./PlannerTables";
import {
  factoryTitle,
  groupLabel,
  hasUnknown,
  outputLine,
  plannerNotes,
  siteFindings,
  siteNodes,
  stateCountsText,
  totalMachines,
  UNKNOWN_FLOW_NOTE,
} from "./plannerText";

type Graph = ProductionGraphResponse["data"];

function SiteCard({
  site,
  graph,
  findings,
  onOpen,
}: {
  site: PlannerSite;
  graph: Graph;
  findings: readonly Bottleneck[] | undefined;
  onOpen: () => void;
}) {
  const nodes = siteNodes(graph, site);
  return (
    <li className="grid content-start gap-2 rounded-card border border-line p-4">
      <h4 className="m-0 break-words">{site.name}</h4>
      <p className="m-0">
        {site.machineCount} {site.machineCount === 1 ? "machine" : "machines"} · {stateCountsText(site.stateCounts)}
      </p>
      {site.topOutputs.length > 0 && (
        <ul aria-label={`Top outputs of ${site.name}`} className="m-0 grid list-none gap-0.5 p-0 text-sm">
          {site.topOutputs.map((rate) => (
            <li key={rate.className} className="break-words">
              {outputLine(rate, site.stateCounts)}
            </li>
          ))}
        </ul>
      )}
      {/* Without the bottlenecks read there is nothing to count, so the line is left out rather than guessed. */}
      {findings !== undefined && (
        <p className="m-0 text-sm">
          <BottleneckBadge count={siteFindings(nodes, findings).length} what={site.name} />
        </p>
      )}
      {/* The name starts with the visible words (WCAG 2.5.3, label in name), then says which site. */}
      <button type="button" onClick={onOpen} aria-label={`Open site: ${site.name}`} className="min-h-touch justify-self-start">
        Open site
      </button>
    </li>
  );
}

/** A designated factory is the player's own; with suggestions on, an automatic one is shown dashed, with Keep (Decision 5). */
function FactoryStanding({ model, suggest }: { model: FactoryModel; suggest: boolean }) {
  if (model.factory.designationId !== null) return <DesignatedControls model={model} />;
  return suggest ? <SuggestionControls model={model} /> : null;
}

function FactoryCard({
  model,
  findings,
  suggest,
  onOpen,
  pick,
}: {
  model: FactoryModel;
  findings: readonly Bottleneck[] | undefined;
  suggest: boolean;
  onOpen: () => void;
  /** Owners and admins: the card's tick for a merge (the keyboard and narrow-screen form of Shift-click). */
  pick?: { checked: boolean; toggle: () => void } | undefined;
}) {
  const { factory } = model;
  const dashed = suggest && factory.designationId === null;
  return (
    <li
      data-picked={pick?.checked === true || undefined}
      className={cn("grid content-start gap-2 rounded-card border p-4", dashed ? "border-dashed border-muted" : "border-line", pick?.checked === true && "border-info bg-info-soft")}
    >
      <h4 className="m-0 break-words">{factoryTitle(factory)}</h4>
      <FactoryFacts model={model} findings={findings} />
      <FactoryStanding model={model} suggest={suggest} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onOpen} aria-label={`Open factory: ${factory.name}`} className="min-h-touch justify-self-start">
          Open factory
        </button>
        {pick !== undefined && (
          <label className="inline-flex min-h-touch items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" aria-label={`Select ${factory.name}`} checked={pick.checked} onChange={pick.toggle} />
            Select
          </label>
        )}
      </div>
    </li>
  );
}

/**
 * The first level when the backend sent factories (ADR-0055 Decision 6): the factories and the flows between them, as the
 * canvas on a wide screen or as cards and a table on a phone. Choosing a factory (card or canvas) opens it.
 */
function FactoryOverview({
  graph,
  models,
  findings,
  suggest,
  onOpen,
  viewMode: [view, setMode],
}: {
  graph: Graph;
  models: readonly FactoryModel[];
  findings: readonly Bottleneck[] | undefined;
  /** "Reason factories for me", held by the page like the view. */
  suggest: [boolean, (on: boolean) => void];
  onOpen: (key: string) => void;
  /** Held by the page, so coming back from a factory shows the same view. */
  viewMode: [ViewMode, (mode: ViewMode) => void];
}) {
  const [suggesting, setSuggesting] = suggest;
  const automatic = models.some((m) => m.factory.designationId === null);
  const { canWrite, writes } = useDesignations();
  const suggestions: CanvasSuggestions | undefined = useMemo(() => {
    if (!suggesting) return undefined;
    const byKey = new Map(models.map((m) => [m.factory.key, m]));
    const keys = new Set(models.filter((m) => m.factory.designationId === null).map((m) => m.factory.key));
    const keepForm =
      canWrite && writes !== null
        ? (key: string, onClose: (saved: boolean) => void) => {
            const model = byKey.get(key);
            return model === undefined ? null : <KeepForm key={key} model={model} onClose={onClose} />;
          }
        : undefined;
    return { keys, keepForm };
  }, [suggesting, models, canWrite, writes]);
  // ADR-0055 Decision 12: factories picked to merge (canvas Shift- or Ctrl-click, or the cards' ticks). A pick a poll took
  // away is dropped from what the bar sees.
  const changes = useDesignationChanges();
  const canMerge = canWrite && writes !== null && changes !== null;
  const [picks, setPicks] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const picked = useMemo(() => models.filter((m) => picks.has(m.factory.key)), [models, picks]);
  const pickNow = useCallback((next: ReadonlySet<string>) => {
    setNotice(null);
    setPicks(next);
  }, []);
  const factoryPicks = useMemo(
    () => (canMerge ? { selected: new Set(picked.map((m) => m.factory.key)), replace: pickNow } : undefined),
    [canMerge, picked, pickNow],
  );
  return (
    <>
      <p className="summary">
        {models.length} {models.length === 1 ? "factory" : "factories"} · {totalMachines(graph.sites)} machines in {graph.nodes.length}{" "}
        {graph.nodes.length === 1 ? "group" : "groups"}
      </p>
      <ViewToggle view={view} onPick={setMode} />
      {automatic && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={suggesting}
            className="min-h-touch"
            onClick={() => setSuggesting(!suggesting)}
          >
            Reason factories for me
          </button>
          {suggesting && <span className="text-sm text-muted">Factories you have not designated are shown dashed, as suggestions.</span>}
        </div>
      )}
      {canMerge && (
        <MergeBar
          onCanvas={view === "graph"}
          graph={graph}
          picked={picked}
          onClear={() => pickNow(new Set())}
          onStale={() => {
            setPicks(new Set());
            setNotice(STALE_TEXT);
          }}
        />
      )}
      {notice !== null && (
        <p role="alert" className="m-0 text-sm">
          {notice}
        </p>
      )}
      {view === "graph" ? (
        <LazySiteGraph
          graph={graph}
          target={{ kind: "overview", models }}
          findings={findings}
          onOpenFactory={onOpen}
          suggestions={suggestions}
          factoryPicks={factoryPicks}
        />
      ) : (
        <>
          <ul aria-label="Factories" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {models.map((m) => (
              <FactoryCard
                key={m.factory.key}
                model={m}
                findings={findings}
                suggest={suggesting}
                onOpen={() => onOpen(m.factory.key)}
                pick={
                  factoryPicks === undefined
                    ? undefined
                    : {
                        checked: factoryPicks.selected.has(m.factory.key),
                        toggle: () => {
                          const next = new Set(factoryPicks.selected);
                          if (!next.delete(m.factory.key)) next.add(m.factory.key);
                          pickNow(next);
                        },
                      }
                }
              />
            ))}
          </ul>
          <FactoryFlows graph={graph} models={models} />
        </>
      )}
    </>
  );
}

type ViewMode = "graph" | "tables";

/** Graph or Tables (Decision 4): wide screens open on the graph, a phone on the tables; the pick lasts until it is closed. */
function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const wide = useWideScreen();
  const [mode, setMode] = useState<ViewMode | null>(null);
  return [mode ?? (wide ? "graph" : "tables"), setMode];
}

function ViewToggle({ view, onPick }: { view: ViewMode; onPick: (mode: ViewMode) => void }) {
  return (
    <div role="group" aria-label="View" className="flex gap-2">
      {(["graph", "tables"] as const).map((m) => (
        <button key={m} type="button" aria-pressed={view === m} onClick={() => onPick(m)} className="min-h-touch">
          {m === "graph" ? "Graph" : "Tables"}
        </button>
      ))}
    </div>
  );
}

/**
 * One opened site or factory: its groups (bubbles with their groups indented) and the connections touching them, as
 * tables, or the graph on a wide screen. A factory adds where it stands, what it makes and how its shared groups split.
 */
function Detail({
  subject,
  graph,
  findings,
  suggest,
  onBack,
}: {
  /** What is open: one site (a backend without factories) or one factory. */
  subject: { site: PlannerSite; factory?: undefined } | { factory: FactoryModel; site?: undefined };
  graph: Graph;
  findings: readonly Bottleneck[] | undefined;
  suggest: boolean;
  onBack: () => void;
}) {
  const { site, factory } = subject;
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening one replaces the cards, so focus follows to the new heading (as a page change does).
  useEffect(() => heading.current?.focus(), []);
  const nodes = useMemo(() => (factory === undefined ? siteNodes(graph, site) : factory.nodes), [graph, site, factory]);
  const rows = useMemo(() => connectionRows(graph, new Set(nodes.map((n) => n.key))), [graph, nodes]);
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const factoryNames = useMemo(() => new Map((graph.factories ?? []).map((f) => [f.key, f.name])), [graph]);
  const owner = useMemo(() => factoryOfNode(graph), [graph]);
  const columns: FactoryColumns | undefined = useMemo(
    () => (factory === undefined ? undefined : { remote: remoteInfo(graph, factory), nameOf: factoryNames }),
    [graph, factory, factoryNames],
  );
  const labelOf = (key: string) => {
    const node = byKey.get(key);
    if (!node) return "Group not listed";
    const home = owner.get(key);
    // An end in another factory says so; in the same factory (or when sites are the unit) it is just the group.
    if (factory !== undefined && home !== undefined && home !== factory.factory.key) return `${groupLabel(node)} (${factoryNames.get(home) ?? "another factory"})`;
    return groupLabel(node);
  };
  const count = siteFindings(nodes, findings).length;
  const [view, setMode] = useViewMode();
  const noun = factory === undefined ? "site" : "factory";
  // The text form of the lasso (ADR-0055 Decision 5): tick groups, then "Designate selected". Owners and admins only.
  const { canWrite, writes, designations } = useDesignations();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // ADR-0055 Decision 12: a designated factory on a backend with revisions splits (and pops out) instead of designating.
  const changes = useDesignationChanges();
  const source = canWrite && writes !== null && changes !== null && factory !== undefined ? splitSourceOf(factory, designations) : null;
  const [notice, setNotice] = useState<string | null>(null);
  const onStale = () => {
    setPicked(new Set());
    setNotice(STALE_TEXT);
  };
  const pop = usePopOut(source, onStale);
  const selection: GroupSelection | undefined =
    canWrite && writes !== null
      ? {
          selected: picked,
          toggle: (key) => {
            setNotice(null);
            setPicked((prev) => {
              const next = new Set(prev);
              if (!next.delete(key)) next.add(key);
              return next;
            });
          },
          popOut: pop.popOut,
          popOutBusy: pop.busy,
        }
      : undefined;
  const pickedNodes = nodes.filter((n) => picked.has(n.key));
  return (
    <div className="grid gap-3">
      {/* One level up; the browser's Back does the same, since opening one is a history entry (PlannerView). */}
      <button type="button" onClick={onBack} className="inline-flex min-h-touch items-center gap-1 justify-self-start">
        <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        {factory === undefined ? "All sites" : "All factories"}
      </button>
      <h4 ref={heading} tabIndex={-1} id="planner-site-heading" className="m-0 break-words">
        {factory === undefined ? site.name : factoryTitle(factory.factory)}
      </h4>
      {factory === undefined ? (
        <p className="m-0">
          {site.machineCount} {site.machineCount === 1 ? "machine" : "machines"} · {stateCountsText(site.stateCounts)}
          {findings !== undefined && (
            <>
              {" · "}
              <BottleneckBadge count={count} what={site.name} />
            </>
          )}
        </p>
      ) : (
        <div className="grid content-start gap-2">
          <FactoryFacts model={factory} findings={findings} detail />
          <FactoryStanding model={factory} suggest={suggest} />
        </div>
      )}

      {/* Wide screens open on the graph, a phone on the tables (Decision 4); the pick is this one's, until it is closed. */}
      <ViewToggle view={view} onPick={setMode} />

      {/* One bar for both views: the canvas's picks and the table's ticks are the same selection. Above the graph it shows
          only once something is picked, so it does not push the canvas down for nothing. */}
      {selection !== undefined &&
        nodes.length > 0 &&
        (view === "tables" || picked.size > 0) &&
        (source !== null && factory !== undefined ? (
          <SplitBar graph={graph} model={factory} source={source} nodes={pickedNodes} onDone={() => setPicked(new Set())} onStale={onStale} />
        ) : (
          <DesignateBar nodes={pickedNodes} onDone={() => setPicked(new Set())} />
        ))}
      {notice !== null && (
        <p role="alert" className="m-0 text-sm">
          {notice}
        </p>
      )}
      <ErrorLine error={pop.error} />

      {view === "graph" && (
        <LazySiteGraph
          graph={graph}
          target={factory === undefined ? { kind: "site", site } : { kind: "factory", model: factory }}
          findings={findings}
          selection={
            selection === undefined
              ? undefined
              : {
                  selected: picked,
                  replace: (next) => {
                    setNotice(null);
                    setPicked(next);
                  },
                }
          }
          onPopOut={
            pop.write === undefined
              ? undefined
              : async (key) => {
                  const node = byKey.get(key);
                  // The panel runs this and shows a failure itself, beside its Pop out.
                  if (node !== undefined) await pop.write?.(node);
                }
          }
        />
      )}

      <section aria-labelledby="planner-groups-heading" hidden={view !== "tables"} className="grid gap-2">
        <h5 id="planner-groups-heading" className="m-0">
          Groups
        </h5>
        {nodes.length === 0 ? (
          <p className="m-0">This {noun} lists no machine groups.</p>
        ) : (
          <GroupsTable nodes={nodes} findings={findings} factory={columns} selection={selection} />
        )}
      </section>

      <section aria-labelledby="planner-edges-heading" hidden={view !== "tables"} className="grid gap-2">
        <h5 id="planner-edges-heading" className="m-0">
          Connections
        </h5>
        {rows.length === 0 ? (
          <p className="m-0">No connections between this {noun}&apos;s groups are known.</p>
        ) : (
          <ConnectionsTable rows={rows} labelOf={labelOf} />
        )}
        <p className="m-0 text-sm text-muted">
          A rate with no word is measured. &quot;About&quot; is estimated from how machines share a belt. &quot;Unknown&quot; means the
          data cannot say.
        </p>
        {rows.some(hasUnknown) && <p className="m-0 text-sm text-muted">{UNKNOWN_FLOW_NOTE}</p>}
      </section>
    </div>
  );
}

/**
 * ADR-0050 Decision 4, the text form, with ADR-0055's factory level above it: a card per factory (or per site, when the
 * backend sent no factories) and, for one opened, a table of its groups and a table of its connections. Names come from
 * the game server and are only ever text. Bottleneck counts come from the Factory page's own read (`findings`, joined by
 * building id); `undefined` means that read has not answered.
 */
export function PlannerPanel({
  snapshot,
  findings,
  findingsTruncated = false,
  refetchFailed = false,
  selected,
  onSelect,
}: {
  snapshot: ProductionGraphResponse;
  findings?: readonly Bottleneck[];
  findingsTruncated?: boolean;
  refetchFailed?: boolean;
  /** The opened factory's (or site's) key, or null for the overview. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const graph = snapshot.data;
  const byFactory = hasFactories(graph);
  const models = useMemo(() => (byFactory ? factoryModels(graph) : []), [graph, byFactory]);
  const model = selected === null ? undefined : models.find((m) => m.factory.key === selected);
  const site = selected === null || byFactory ? undefined : graph.sites.find((s) => s.key === selected);
  const open = model !== undefined || site !== undefined;
  const orphans = byFactory ? unassignedCount(graph) : 0;
  const orphanNote = `${orphans} ${orphans === 1 ? "group belongs" : "groups belong"} to no factory, so ${orphans === 1 ? "it is" : "they are"} not listed under one.`;
  const notes = orphans > 0 ? [orphanNote, ...plannerNotes(graph)] : plannerNotes(graph);
  const noBeltData = graph.beltData === "unsupported" || graph.beltData === "tooLarge" || graph.beltData === "notReceived";
  const overviewMode = useViewMode();
  const [suggesting, setSuggesting] = useState(false);
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  // Back from one (the button or the browser's Back): focus the overview's heading, but not on the page's first render.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) overviewHeading.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const back = () => onSelect(null);

  return (
    <section aria-labelledby="planner-heading" className="panel content-start">
      <h3 id="planner-heading" ref={overviewHeading} tabIndex={-1}>
        Production planner
      </h3>
      {snapshot.stale && <p>Showing last known planner data from {formatTime(snapshot.observedAt)}.</p>}

      {graph.sites.length === 0 && !byFactory ? (
        <p>
          {graph.beltData === "unsupported" || graph.beltData === "tooLarge"
            ? "No sites to show: the planner needs belt data, and this server has none to read."
            : graph.beltData === "notReceived"
              ? "No sites to show yet: the planner needs belt data, and the agent hasn't sent any."
              : "No sites yet: no machines are connected by conveyors."}
        </p>
      ) : model !== undefined ? (
        <Detail key={model.factory.key} subject={{ factory: model }} graph={graph} findings={findings} suggest={suggesting} onBack={back} />
      ) : site !== undefined ? (
        <Detail key={site.key} subject={{ site }} graph={graph} findings={findings} suggest={suggesting} onBack={back} />
      ) : byFactory ? (
        <FactoryOverview
          graph={graph}
          models={models}
          findings={findings}
          viewMode={overviewMode}
          suggest={[suggesting, setSuggesting]}
          onOpen={onSelect}
        />
      ) : (
        <>
          <p className="summary">
            {graph.sites.length} {graph.sites.length === 1 ? "site" : "sites"} · {totalMachines(graph.sites)} machines in {graph.nodes.length}{" "}
            {graph.nodes.length === 1 ? "group" : "groups"}
          </p>
          <ul aria-label="Sites" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {graph.sites.map((s) => (
              <SiteCard
                key={s.key}
                site={s}
                graph={graph}
                findings={findings}
                onOpen={() => onSelect(s.key)}
              />
            ))}
          </ul>
        </>
      )}

      <UndoToast />

      {/* The caveats stay out of the way until looked for (the owner, 2026-10-27). Without belt data they say why the
          page is thin (update FRM, too large, not sent), so then they stay in view. */}
      <details className="text-sm text-muted" open={noBeltData || undefined}>
        <summary className="cursor-pointer">About this data</summary>
        <ul aria-label="Planner notes" className="m-0 mt-1 grid list-none gap-1 break-words p-0">
          <li>{UNKNOWN_FLOW_NOTE}</li>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {findingsTruncated && <li>Bottleneck counts cover the Factory page&apos;s top findings only.</li>}
        </ul>
      </details>

      <p className="as-of">
        <DataAge observedAt={snapshot.observedAt} late={snapshot.stale || refetchFailed} />
      </p>
    </section>
  );
}

/** The page while the graph loads: a heading bar, the summary line and a few cards, about the size of the loaded page. */
export function PlannerSkeleton() {
  return (
    <section aria-busy="true" className="panel content-start">
      <SkeletonStatus>Loading planner…</SkeletonStatus>
      <Skeleton className="h-lh w-48 text-xl" />
      <Skeleton className="h-5 w-full max-w-64" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-lh w-56 text-sm" />
    </section>
  );
}
