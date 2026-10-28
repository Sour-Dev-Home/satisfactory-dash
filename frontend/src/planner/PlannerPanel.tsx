import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Bottleneck, PlannerSite, ProductionGraphResponse } from "@satisfactory-dash/shared";
import { DataAge } from "../components/DataAge";
import { formatTime } from "../format";
import { cn } from "../lib/cn";
import { Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { BottleneckBadge, BottleneckLine } from "./BottleneckBadge";
import { FactoryFacts, FactoryFlows } from "./FactoryParts";
import { useDesignationChanges } from "./designationChanges";
import { DesignateBar, DesignatedControls, DesignatedMarker, ErrorLine } from "./DesignationParts";
import { useDesignations } from "./DesignationContext";
import { STALE_TEXT } from "./designationText";
import { buildFactoryTree, levelOf, levelOwner, resolvePath, type FactoryTree, type TreeNodeKind } from "./factoryTree";
import type { PathChange } from "./PlannerView";
import { readNesting } from "./graph/plannerPrefs";
import { MergeBar, SplitBar } from "./MergeSplitParts";
import { splitSourceOf } from "./selectionPlans";
import { UndoToast } from "./UndoToast";
import { usePopOut } from "./usePopOut";
import { LazySiteGraph } from "./graph/GraphLoader";
import { minedRates } from "./graph/graphModel";
import {
  connectionRows,
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

/** ADR-0061 Decision 4: what the page says when a path's tail names a factory the tree no longer has. */
const GONE_NOTE = "That factory is no longer here.";
const PATH_SEP = "\u0001";

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
      <BottleneckLine count={findings === undefined ? undefined : siteFindings(nodes, findings).length} what={site.name} />
      {/* The name starts with the visible words (WCAG 2.5.3, label in name), then says which site. */}
      <button type="button" onClick={onOpen} aria-label={`Open site: ${site.name}`} className="min-h-touch justify-self-start">
        Open site
      </button>
    </li>
  );
}

/**
 * A designated factory is the player's own (Decision 5); an automatic one has no controls of its own. A parent and its own
 * machines only say so here: editing the tree is ADR-0061 build PR 5.
 */
function FactoryStanding({ model, kind = "leaf" }: { model: FactoryModel; kind?: TreeNodeKind }) {
  if (model.factory.designationId === null) return null;
  return kind === "leaf" ? <DesignatedControls model={model} /> : <DesignatedMarker />;
}

function FactoryCard({
  model,
  kind,
  findings,
  onOpen,
  pick,
}: {
  model: FactoryModel;
  kind: TreeNodeKind;
  findings: readonly Bottleneck[] | undefined;
  onOpen: () => void;
  /** Owners and admins: the card's tick for a merge (the keyboard and narrow-screen form of Shift-click). */
  pick?: { checked: boolean; toggle: () => void } | undefined;
}) {
  const { factory } = model;
  return (
    <li
      data-picked={pick?.checked === true || undefined}
      className={cn("grid content-start gap-2 rounded-card border border-line p-4", pick?.checked === true && "border-info bg-info-soft")}
    >
      <h4 className="m-0 break-words">{factoryTitle(factory)}</h4>
      <FactoryFacts model={model} findings={findings} />
      <FactoryStanding model={model} kind={kind} />
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
  tree,
  path,
  findings,
  onOpen,
  viewMode: [view, setMode],
}: {
  graph: Graph;
  tree: FactoryTree;
  /** ADR-0061 Decision 3: the path to the parent whose parts this shows; empty at the top level. */
  path: readonly string[];
  findings: readonly Bottleneck[] | undefined;
  onOpen: (key: string) => void;
  /** Held by the page, so coming back from a factory shows the same view. */
  viewMode: [ViewMode, (mode: ViewMode) => void];
}) {
  const { canWrite, writes } = useDesignations();
  const { parent, entries } = useMemo(() => levelOf(tree, path), [tree, path]);
  const models = useMemo(() => entries.map((e) => e.card), [entries]);
  const owner = useMemo(() => levelOwner(graph, tree, parent?.key ?? null), [graph, tree, parent]);
  // ADR-0055 Decision 12: factories picked to merge (canvas Shift- or Ctrl-click, or the cards' ticks). A pick a poll took
  // away is dropped from what the bar sees. Only plain factories at the top level merge for now: moving and grouping in
  // the tree is ADR-0061 build PR 5.
  const changes = useDesignationChanges();
  const canMerge = canWrite && writes !== null && changes !== null && parent === undefined;
  const mergeable = useMemo(() => new Set(entries.filter((e) => e.kind === "leaf").map((e) => e.key)), [entries]);
  const [picks, setPicks] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const picked = useMemo(() => models.filter((m) => picks.has(m.factory.key) && mergeable.has(m.factory.key)), [models, picks, mergeable]);
  const machines = parent === undefined ? totalMachines(graph.sites) : parent.card.factory.machineCount;
  const groups = parent === undefined ? graph.nodes.length : parent.card.nodes.length;
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
        {models.length} {models.length === 1 ? "factory" : "factories"} · {machines} machines in {groups} {groups === 1 ? "group" : "groups"}
      </p>
      <ViewToggle view={view} onPick={setMode} />
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
          target={{ kind: "overview", models, tree, path: parent === undefined ? [] : path }}
          findings={findings}
          onOpenFactory={onOpen}
          factoryPicks={factoryPicks}
        />
      ) : (
        <>
          <ul
            aria-label={parent === undefined ? "Factories" : `Factories in ${parent.name}`}
            className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
          >
            {entries.map(({ card: m, kind }) => (
              <FactoryCard
                key={m.factory.key}
                model={m}
                kind={kind}
                findings={findings}
                onOpen={() => onOpen(m.factory.key)}
                pick={
                  factoryPicks === undefined || !mergeable.has(m.factory.key)
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
          <FactoryFlows graph={graph} models={models} owner={owner} />
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

/** One level up; the browser's Back does the same, since opening one is a history entry (PlannerView). */
function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="inline-flex min-h-touch items-center gap-1 justify-self-start">
      <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </button>
  );
}

/**
 * ADR-0061 Decision 4: the path as buttons ("All factories / Main base / Iron area"), each going to its prefix; the last is
 * where the viewer is (`aria-current`). The keyboard and screen-reader way to any ancestor.
 */
function Breadcrumb({ tree, path, onGo }: { tree: FactoryTree; path: readonly string[]; onGo: (next: readonly string[]) => void }) {
  const crumbs = [{ key: "", name: "All factories" }, ...path.map((key) => ({ key, name: tree.nodes.get(key)?.name ?? key }))];
  return (
    <nav aria-label="Factory path">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 p-0 text-sm">
        {crumbs.map((crumb, i) => (
          <li key={`${i}|${crumb.key}`} className="inline-flex min-w-0 items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-muted">
                /
              </span>
            )}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="break-words">
                {crumb.name}
              </span>
            ) : (
              <button type="button" onClick={() => onGo(path.slice(0, i))} className="min-h-touch break-words">
                {crumb.name}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
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
  onBack,
  backLabel,
  breadcrumb,
}: {
  /** What is open: one site (a backend without factories) or one factory. */
  subject: { site: PlannerSite; factory?: undefined } | { factory: FactoryModel; site?: undefined };
  graph: Graph;
  findings: readonly Bottleneck[] | undefined;
  onBack: () => void;
  /** The back arrow's words: "All factories", "All sites", or "Back to <parent>" deeper in the tree. */
  backLabel: string;
  /** ADR-0061 Decision 4: the path to here, when the factories nest. */
  breadcrumb?: ReactNode;
}) {
  const { site, factory } = subject;
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening one replaces the cards, so focus follows to the new heading (as a page change does).
  useEffect(() => heading.current?.focus(), []);
  const nodes = useMemo(() => (factory === undefined ? siteNodes(graph, site) : factory.nodes), [graph, site, factory]);
  const rows = useMemo(() => connectionRows(graph, new Set(nodes.map((n) => n.key))), [graph, nodes]);
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const factoryNames = useMemo(() => new Map((graph.factories ?? []).map((f) => [f.key, f.name])), [graph]);
  const rates = useMemo(() => minedRates(graph.edges), [graph]);
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
      <BackButton label={backLabel} onBack={onBack} />
      {breadcrumb}
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
          <FactoryStanding model={factory} />
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
          <GroupsTable nodes={nodes} findings={findings} factory={columns} selection={selection} rates={rates} />
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
  path,
  onPath,
  pathSettled = true,
  trimmed = false,
}: {
  snapshot: ProductionGraphResponse;
  findings?: readonly Bottleneck[];
  findingsTruncated?: boolean;
  refetchFailed?: boolean;
  /** ADR-0061 Decision 4: the opened path of factory keys, root first (a site's key alone, on a backend without factories). */
  path: readonly string[];
  onPath: (next: readonly string[], how?: PathChange) => void;
  /** Whether the designation list has answered (or failed): until then a key it alone knows is not trimmed off the path. */
  pathSettled?: boolean;
  /** This address is one a trim wrote: say that the factory it named is gone. */
  trimmed?: boolean;
}) {
  const graph = snapshot.data;
  const byFactory = hasFactories(graph);
  const { designations } = useDesignations();
  const [nesting] = useState(readNesting);
  const list = designations?.designations;
  const tree = useMemo(() => (byFactory ? buildFactoryTree(graph, list, nesting) : undefined), [graph, byFactory, list, nesting]);
  // The longest prefix still in the tree (a site's key alone without factories); the rest is trimmed below, with a note.
  // Keyed by the joined path, so a render that reads the same address keeps the same arrays (the address gives new ones).
  const pathKey = path.join(PATH_SEP);
  const valid = useMemo(() => {
    const raw = pathKey === "" ? [] : pathKey.split(PATH_SEP);
    return tree !== undefined ? resolvePath(tree, raw) : graph.sites.some((s) => s.key === raw[0]) ? raw.slice(0, 1) : [];
  }, [tree, pathKey, graph.sites]);
  const trimming = pathSettled && valid.length < path.length;
  // The address is the outside system here: a bad tail is replaced (and that entry marked, so `trimmed` says it).
  useEffect(() => {
    if (trimming) onPath(valid, "trim");
  }, [trimming, valid, onPath]);
  const gone = trimmed || trimming;
  const go = (next: readonly string[]) => onPath(next);
  const lastKey = valid[valid.length - 1];
  const node = tree === undefined || lastKey === undefined ? undefined : tree.nodes.get(lastKey);
  // A leaf, or a parent's own machines, opens into its groups (named "Main base (own machines)"); a parent into its parts.
  const model =
    node?.opens === undefined ? undefined : node.kind === "own" ? { ...node.opens, factory: { ...node.opens.factory, name: node.name } } : node.opens;
  const levelParent = node?.kind === "parent" ? node : undefined;
  const site = byFactory || lastKey === undefined ? undefined : graph.sites.find((s) => s.key === lastKey);
  const open = model !== undefined || site !== undefined;
  const orphans = byFactory ? unassignedCount(graph) : 0;
  const orphanNote = `${orphans} ${orphans === 1 ? "group belongs" : "groups belong"} to no factory, so ${orphans === 1 ? "it is" : "they are"} not listed under one.`;
  const notes = orphans > 0 ? [orphanNote, ...plannerNotes(graph)] : plannerNotes(graph);
  const noBeltData = graph.beltData === "unsupported" || graph.beltData === "tooLarge" || graph.beltData === "notReceived";
  const overviewMode = useViewMode();
  const overviewHeading = useRef<HTMLHeadingElement>(null);
  const levelHeading = useRef<HTMLHeadingElement>(null);
  // A change of level (a card, Back, a breadcrumb or the browser's Back) moves focus to the new level's heading, but not
  // on the page's first render. An opened factory focuses its own heading as it mounts.
  const viewKey = valid.join(PATH_SEP);
  const shownKey = useRef(viewKey);
  const nestedLevel = levelParent !== undefined;
  useEffect(() => {
    if (shownKey.current === viewKey) return;
    shownKey.current = viewKey;
    if (!open) (nestedLevel ? levelHeading : overviewHeading).current?.focus();
  }, [viewKey, open, nestedLevel]);
  const back = () => go(valid.slice(0, -1));
  const parentName = valid.length < 2 ? undefined : tree?.nodes.get(valid[valid.length - 2] ?? "")?.name;
  const backLabel = parentName !== undefined ? `Back to ${parentName}` : byFactory ? "All factories" : "All sites";
  const breadcrumb = tree?.nested === true && valid.length > 0 ? <Breadcrumb tree={tree} path={valid} onGo={go} /> : undefined;

  return (
    <section aria-labelledby="planner-heading" className="panel content-start">
      <h3 id="planner-heading" ref={overviewHeading} tabIndex={-1}>
        Production planner
      </h3>
      {snapshot.stale && <p>Showing last known planner data from {formatTime(snapshot.observedAt)}.</p>}
      {/* ADR-0061 Decision 4: a path whose tail is gone is trimmed and says so, until the viewer goes somewhere. */}
      {gone && (
        <p role="status" className="m-0 text-sm">
          {GONE_NOTE}
        </p>
      )}

      {graph.sites.length === 0 && !byFactory ? (
        <p>
          {graph.beltData === "unsupported" || graph.beltData === "tooLarge"
            ? "No sites to show: the planner needs belt data, and this server has none to read."
            : graph.beltData === "notReceived"
              ? "No sites to show yet: the planner needs belt data, and the agent hasn't sent any."
              : "No sites yet: no machines are connected by conveyors."}
        </p>
      ) : model !== undefined ? (
        <Detail
          key={node?.key ?? model.factory.key}
          subject={{ factory: model }}
          graph={graph}
          findings={findings}
          onBack={back}
          backLabel={backLabel}
          breadcrumb={breadcrumb}
        />
      ) : site !== undefined ? (
        <Detail key={site.key} subject={{ site }} graph={graph} findings={findings} onBack={back} backLabel={backLabel} />
      ) : tree !== undefined ? (
        <>
          {levelParent !== undefined && (
            <div className="grid gap-3">
              <BackButton label={backLabel} onBack={back} />
              {breadcrumb}
              <h4 ref={levelHeading} tabIndex={-1} className="m-0 break-words">
                {levelParent.name}
              </h4>
              <div className="grid content-start gap-2">
                <FactoryFacts model={levelParent.card} findings={findings} detail />
                <FactoryStanding model={levelParent.card} kind="parent" />
              </div>
            </div>
          )}
          <FactoryOverview
            key={viewKey}
            graph={graph}
            tree={tree}
            path={valid}
            findings={findings}
            viewMode={overviewMode}
            onOpen={(key) => go([...valid, key])}
          />
        </>
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
                onOpen={() => go([s.key])}
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
