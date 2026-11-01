import { createContext, Fragment, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Bottleneck, PlannerNode, PlannerRate, ProductionGraph } from "@satisfactory-dash/shared";
import { cn } from "../lib/cn";
import { BottleneckBadge } from "./BottleneckBadge";
import { FactoryFacts } from "./FactoryParts";
import type { FactoryTree, TreeNode } from "./factoryTree";
import { StateMark } from "./graph/StateMark";
import {
  extractorOutput,
  groupsExtractorOutput,
  INFERRED_FROM_NODE,
  isStaleNode,
  makesNothing,
  minedLine,
  NO_OUTPUT_DATA,
  noRecipeCellText,
  recipeText,
  STALE_NODE_NOTE,
  type MinedOutput,
  type MinedRate,
} from "./graph/graphModel";
import { bubblesOf, foldBubbles, type Bubble } from "./graph/hierarchy";
import {
  attentionItems,
  neighboursOf,
  OUTLINE_OPEN_MAX,
  outlineSummaryText,
  sortConnections,
  type Neighbour,
  type Neighbours,
  type OutlineConnection,
  type SortColumn,
  type SortOrder,
} from "./outlineModel";
import {
  bubbleTitle,
  factoryTitle,
  foldText,
  groupLabel,
  isZeroRate,
  mergeStateCounts,
  nodeFindings,
  outputLine,
  roleText,
  stalledOf,
  stalledStateText,
  stateCountsText,
  UNKNOWN_FLOW_NOTE,
} from "./plannerText";

/**
 * ADR-0062 Decision 3, the outline: the Planner's text form, in place of the groups and connections tables. A nested list
 * (`ul`/`li`, headings and disclosure buttons; not an ARIA tree): a summary sentence; "Needs attention" by severity, each
 * with "Show in graph"; the tree (the level's factories, parents with their parts, then each factory's groups) where each
 * group is a sentence whose neighbours are buttons that move to their rows; and "All connections", one 5-column table
 * behind a disclosure. The row matching the graph's selection is `aria-current`, and it takes the focus when the outline
 * opens. DOM only: a factory of more than `OUTLINE_OPEN_MAX` groups starts closed.
 */

type Level = 4 | 5 | 6;

function Heading({ level, id, className, children }: { level: number; id?: string; className?: string; children: ReactNode }) {
  const Tag = `h${Math.min(Math.max(level, 2), 6)}` as "h4" | "h5" | "h6";
  return (
    <Tag id={id} className={cn("m-0 break-words", className)}>
      {children}
    </Tag>
  );
}

interface OutlineState {
  current: string | null;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Moves the keyboard to a row (opening what hides it); false when the outline has no row for the key. */
  goTo: (key: string) => boolean;
  register: (key: string) => (el: HTMLElement | null) => void;
  hasRow: (key: string) => boolean;
  labelOf: (key: string) => string;
  neighbours: Neighbours;
  findings: readonly Bottleneck[] | undefined;
  rates: ReadonlyMap<string, MinedRate | null> | undefined;
  onShowInGraph: (key: string) => void;
  groupActions: ((node: PlannerNode) => ReactNode) | undefined;
  groupFacts: ((node: PlannerNode) => string[]) | undefined;
  factoryActions: ((entry: TreeNode) => FactoryActions) | undefined;
  tree: FactoryTree | undefined;
}

const OutlineContext = createContext<OutlineState | null>(null);

function useOutline(): OutlineState {
  const state = useContext(OutlineContext);
  if (state === null) throw new Error("outside PlannerOutline");
  return state;
}

/** Where each row sits: the disclosures (factories, folds) that must be open for it to show, outermost first. */
interface Shape {
  ancestors: Map<string, string[]>;
  /** Each disclosure's starting state. */
  defaults: Map<string, boolean>;
}

const foldKeyOf = (scope: string, fold: string) => `${scope}\u0001${fold}`;

function shapeGroups(nodes: readonly PlannerNode[], scope: string, chain: readonly string[], shape: Shape): void {
  for (const entry of foldBubbles(bubblesOf(nodes))) {
    if (entry.type === "bubble") for (const n of entry.bubble.nodes) shape.ancestors.set(n.key, [...chain]);
    else {
      const key = foldKeyOf(scope, entry.key);
      shape.defaults.set(key, false);
      for (const b of entry.bubbles) for (const n of b.nodes) shape.ancestors.set(n.key, [...chain, key]);
    }
  }
}

const groupsOf = (entry: TreeNode): PlannerNode[] => (entry.opens ?? entry.card).nodes;

function shapeFactories(keys: readonly string[], tree: FactoryTree, chain: readonly string[], shape: Shape): void {
  for (const key of keys) {
    const entry = tree.nodes.get(key);
    if (entry === undefined) continue;
    shape.ancestors.set(key, [...chain]);
    shape.defaults.set(key, entry.card.nodes.length <= OUTLINE_OPEN_MAX);
    if (entry.kind === "parent") shapeFactories(entry.childKeys, tree, [...chain, key], shape);
    else shapeGroups(groupsOf(entry), key, [...chain, key], shape);
  }
}

/** A factory row's own actions: buttons beside "Show in graph" (Open factory, Select), then controls of their own (Rename, Ungroup...). */
export interface FactoryActions {
  buttons?: ReactNode;
  more?: ReactNode;
}

export interface PlannerOutlineProps {
  graph: ProductionGraph;
  /** Every group the outline speaks of: the summary, "Needs attention" and the neighbours that are buttons. */
  nodes: readonly PlannerNode[];
  findings: readonly Bottleneck[] | undefined;
  /** `minedRates` of the graph's edges: an extractor's rate. */
  rates?: ReadonlyMap<string, MinedRate | null> | undefined;
  /** The overview: the level's factories (a parent's parts under it). Absent: the groups of one site or factory. */
  factories?:
    | { entries: readonly TreeNode[]; tree: FactoryTree; actions?: ((entry: TreeNode) => FactoryActions) | undefined; label: string }
    | undefined;
  /** The level of the outline's section headings: one below the heading of what is open. */
  level: Level;
  /** A group's name, saying which other factory it belongs to (a neighbour with no row here is named, not a button). */
  labelOf: (nodeKey: string) => string;
  connections: readonly OutlineConnection[];
  /** What the connections section says when there are none. */
  noConnections: string;
  /** What the groups section says when there are none. */
  noGroups: string;
  /** The one selection shared with the graph (a group's or a factory's key). */
  current: string | null;
  /** "Show in graph": select it and show the graph. */
  onShowInGraph: (key: string) => void;
  /** A group row's own actions (Select, Pop out), unchanged in behaviour. */
  groupActions?: ((node: PlannerNode) => ReactNode) | undefined;
  /** A group's further facts (where it stands, how a shared group splits). */
  groupFacts?: ((node: PlannerNode) => string[]) | undefined;
}

export function PlannerOutline({
  graph,
  nodes,
  findings,
  rates,
  factories,
  level,
  labelOf,
  connections,
  noConnections,
  noGroups,
  current,
  onShowInGraph,
  groupActions,
  groupFacts,
}: PlannerOutlineProps) {
  const ids = useId();
  const shape = useMemo(() => {
    const s: Shape = { ancestors: new Map(), defaults: new Map() };
    if (factories === undefined) shapeGroups(nodes, "", [], s);
    else
      shapeFactories(
        factories.entries.map((e) => e.key),
        factories.tree,
        [],
        s,
      );
    return s;
  }, [factories, nodes]);
  // Opening the outline after a card was selected in the graph opens what hides its row and moves the keyboard there
  // (Decision 3, graph sync): the disclosures start flipped for it, and the focus waits for the first render below.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(
    () => new Set(current === null ? [] : (shape.ancestors.get(current) ?? []).filter((k) => shape.defaults.get(k) !== true)),
  );
  const isOpen = useCallback((key: string) => (shape.defaults.get(key) ?? false) !== flipped.has(key), [shape, flipped]);
  const toggle = useCallback((key: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const rows = useRef(new Map<string, HTMLElement>());
  const pending = useRef<string | null>(current);
  const goTo = useCallback(
    (key: string) => {
      const chain = shape.ancestors.get(key);
      if (chain === undefined) return false;
      const closed = chain.filter((k) => !isOpen(k));
      if (closed.length > 0)
        setFlipped((prev) => {
          const next = new Set(prev);
          for (const k of closed) if (!next.delete(k)) next.add(k);
          return next;
        });
      pending.current = key;
      // Already shown: focus now (no render follows to run the effect below).
      if (closed.length === 0) focusRow(rows.current.get(key));
      return true;
    },
    [shape, isOpen],
  );
  useEffect(() => {
    const key = pending.current;
    if (key === null) return;
    // A key the outline has no row for (a card of a level not listed here) is let go, not waited for.
    if (!shape.ancestors.has(key)) {
      pending.current = null;
      return;
    }
    const el = rows.current.get(key);
    if (el === undefined) return;
    pending.current = null;
    focusRow(el);
  });
  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el === null) rows.current.delete(key);
      else rows.current.set(key, el);
    },
    [],
  );
  const neighbours = useMemo(() => neighboursOf(graph), [graph]);
  const hasRow = useCallback((key: string) => shape.ancestors.has(key), [shape]);
  const state: OutlineState = {
    current,
    isOpen,
    toggle,
    goTo,
    register,
    hasRow,
    labelOf,
    neighbours,
    findings,
    rates,
    onShowInGraph,
    groupActions,
    groupFacts,
    factoryActions: factories?.actions,
    tree: factories?.tree,
  };
  const attention = useMemo(() => attentionItems(nodes, graph, findings), [nodes, graph, findings]);
  return (
    <OutlineContext.Provider value={state}>
      <div data-planner-outline="" className="grid gap-4">
        <p className="m-0">{outlineSummaryText(nodes)}</p>

        <section aria-labelledby={`${ids}-attention`} className="grid gap-2">
          <Heading level={level} id={`${ids}-attention`}>
            Needs attention
          </Heading>
          {findings === undefined && <p className="m-0 text-sm text-muted">Bottlenecks not read yet.</p>}
          {attention.length === 0 ? (
            <p className="m-0">Nothing needs attention.</p>
          ) : (
            <ul aria-label="Needs attention" className="m-0 grid list-none gap-2 p-0">
              {attention.map((a) => (
                <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{a.label}</span>: {a.text}
                    {a.word !== undefined && <MarkWord mark={a.mark} word={a.word} />}
                  </span>
                  <ShowInGraph label={a.label} onShow={() => onShowInGraph(a.nodeKey)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={`${ids}-tree`} className="grid gap-2">
          <Heading level={level} id={`${ids}-tree`}>
            {factories === undefined ? "Groups" : "Factories"}
          </Heading>
          {factories === undefined ? (
            nodes.length === 0 ? (
              <p className="m-0">{noGroups}</p>
            ) : (
              <GroupList nodes={nodes} scope="" label="Groups" />
            )
          ) : (
            <ul aria-label={factories.label} className="m-0 grid list-none gap-3 p-0">
              {factories.entries.map((entry) => (
                <FactoryItem key={entry.key} entry={entry} level={level + 1} />
              ))}
            </ul>
          )}
        </section>

        <ConnectionsSection level={level} rows={connections} empty={noConnections} />
      </div>
    </OutlineContext.Provider>
  );
}

function focusRow(el: HTMLElement | undefined) {
  if (el === undefined) return;
  el.focus();
  // jsdom has no scrollIntoView; a browser already scrolls a focused element into view, this keeps it near.
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
}

/** The state's mark, then always its word (Decision 2: a symbol is never the only carrier). */
function MarkWord({ mark, word }: { mark: ReturnType<typeof stalledOf>; word: string }) {
  return (
    <>
      {", "}
      {mark !== undefined && <StateMark kind={mark} className="me-1 align-text-bottom" />}
      {word}
    </>
  );
}

function ShowInGraph({ label, onShow }: { label: string; onShow: () => void }) {
  return (
    <button type="button" aria-label={`Show in graph: ${label}`} onClick={onShow} className="min-h-touch text-sm">
      Show in graph
    </button>
  );
}

/** A row's frame: focusable from script only, ringed and tinted while it is the graph's selection. */
function rowClass(current: boolean) {
  return cn("grid content-start gap-1 rounded-card border border-line p-3", current && "border-accent bg-info-soft");
}

function FactoryItem({ entry, level }: { entry: TreeNode; level: number }) {
  const outline = useOutline();
  const ids = useId();
  const open = outline.isOpen(entry.key);
  const current = outline.current === entry.key;
  const model = entry.card;
  const groups = entry.kind === "parent" ? [] : groupsOf(entry);
  const parts = entry.kind === "parent" ? entry.childKeys.flatMap((k) => outline.tree?.nodes.get(k) ?? []) : [];
  const count = model.nodes.length;
  const actions = outline.factoryActions?.(entry);
  return (
    <li ref={outline.register(entry.key)} tabIndex={-1} aria-current={current ? "true" : undefined} data-outline-row={entry.kind} className={rowClass(current)}>
      <Heading level={level}>
        <button type="button" aria-expanded={open} aria-controls={`${ids}-parts`} onClick={() => outline.toggle(entry.key)} className="min-h-touch break-words text-left">
          {factoryTitle(model.factory)}
        </button>
      </Heading>
      <FactoryFacts model={model} findings={outline.findings} />
      <div className="flex flex-wrap items-center gap-2">
        <ShowInGraph label={model.factory.name} onShow={() => outline.onShowInGraph(entry.key)} />
        {actions?.buttons}
      </div>
      {actions?.more}
      <div id={`${ids}-parts`} hidden={!open}>
        {!open ? null : entry.kind === "parent" ? (
          <ul aria-label={`Parts of ${model.factory.name}`} className="m-0 grid list-none gap-3 p-0 ps-4">
            {parts.map((p) => (
              <FactoryItem key={p.key} entry={p} level={level + 1} />
            ))}
          </ul>
        ) : groups.length === 0 ? (
          <p className="m-0 text-sm">This factory lists no machine groups.</p>
        ) : (
          <GroupList nodes={groups} scope={entry.key} label={`Groups of ${model.factory.name}`} />
        )}
      </div>
      {!open && (
        <p className="m-0 text-sm text-muted">
          {count} {count === 1 ? "group" : "groups"}, folded
        </p>
      )}
    </li>
  );
}

/** A factory's or site's groups, one recipe tree at a time: a tree of several groups names itself, its groups under it. */
function GroupList({ nodes, scope, label }: { nodes: readonly PlannerNode[]; scope: string; label: string }) {
  const outline = useOutline();
  const entries = useMemo(() => foldBubbles(bubblesOf(nodes)), [nodes]);
  return (
    <ul aria-label={label} className="m-0 grid list-none gap-2 p-0">
      {entries.map((entry) => {
        if (entry.type === "bubble") return <BubbleItem key={entry.bubble.key} bubble={entry.bubble} />;
        const key = foldKeyOf(scope, entry.key);
        const shown = outline.isOpen(key);
        return (
          <li key={entry.key} className="grid gap-2">
            <button type="button" aria-expanded={shown} onClick={() => outline.toggle(key)} className="min-h-touch justify-self-start">
              {shown ? "Hide" : "Show"} {foldText(entry)}
            </button>
            {shown && (
              <ul aria-label={foldText(entry)} className="m-0 grid list-none gap-2 p-0">
                {entry.bubbles.map((b) => (
                  <BubbleItem key={b.key} bubble={b} />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BubbleItem({ bubble }: { bubble: Bubble }) {
  const outline = useOutline();
  if (bubble.nodes.length === 1) return <GroupItem node={bubble.nodes[0]} tree={bubble.of > 1 ? `tree ${bubble.ordinal} of ${bubble.of}` : null} />;
  const mined = bubble.products.length === 0 ? groupsExtractorOutput(bubble.nodes, outline.rates) : null;
  const states = mergeStateCounts(bubble.nodes.map((n) => n.stateCounts));
  return (
    <li className="grid gap-2">
      <p className="m-0 break-words">
        <span className="font-semibold">{bubbleTitle(bubble)}</span>
        {bubble.nodes.every(isStaleNode) ? (
          <>
            : <span className="text-muted">{STALE_NODE_NOTE}</span>
          </>
        ) : mined !== null ? (
          <>
            : <Mined mined={mined} />
          </>
        ) : bubble.products.length > 0 ? (
          <>
            : <Outputs products={bubble.products} states={states} />
          </>
        ) : null}
      </p>
      <ul aria-label={`Groups of ${bubbleTitle(bubble)}`} className="m-0 grid list-none gap-2 p-0 ps-4">
        {bubble.nodes.map((n) => (
          <GroupItem key={n.key} node={n} tree={null} />
        ))}
      </ul>
    </li>
  );
}

function Mined({ mined }: { mined: MinedOutput }) {
  return (
    <>
      {minedLine(mined)}
      {mined.inferred && <span className="text-muted"> {INFERRED_FROM_NODE}</span>}
    </>
  );
}

/** "Iron Plate: 72 / 160 items/min and Screw: 0 of 40 items/min, [mark] backed up": a 0 says its machines' state. */
function Outputs({ products, states }: { products: readonly PlannerRate[]; states: Record<string, number> }) {
  return products.map((rate, i) => (
    <Fragment key={rate.className}>
      {i > 0 && (i === products.length - 1 ? " and " : ", ")}
      {outputLine(rate)}
      {isZeroRate(rate) && <MarkWord mark={stalledOf(states)} word={stalledStateText(states)} />}
    </Fragment>
  ));
}

/** "12× Smelter make Iron Ingot: 0 of 120 items/min, backed up." */
function Sentence({ node }: { node: PlannerNode }) {
  const outline = useOutline();
  const many = node.count > 1;
  const subject = <span className="font-semibold">{many ? `${node.count}× ${node.name}` : node.name}</span>;
  if (isStaleNode(node))
    return (
      <>
        {subject}: <span className="text-muted">{STALE_NODE_NOTE}</span>.
      </>
    );
  const mined = extractorOutput(node, outline.rates);
  if (mined !== null)
    return (
      <>
        {subject} {many ? "mine" : "mines"} <Mined mined={mined} />.
      </>
    );
  if (node.products.length === 0)
    return makesNothing(node) ? (
      subject
    ) : (
      <>
        {subject}: <span className="text-muted">{NO_OUTPUT_DATA}</span>.
      </>
    );
  return (
    <>
      {subject} {many ? "make" : "makes"} <Outputs products={node.products} states={node.stateCounts} />.
    </>
  );
}

/** "Iron Ore from [8× Miner Mk.2] (120 items/min), Coal from …": each neighbour with a row here is a button to it. */
function NeighbourList({ list, word }: { list: readonly Neighbour[]; word: "from" | "to" }) {
  const outline = useOutline();
  return list.map((n, i) => (
    <Fragment key={`${i}|${n.key}|${n.item}`}>
      {i > 0 && (i === list.length - 1 ? " and " : ", ")}
      {n.item} {word}{" "}
      {outline.hasRow(n.key) ? (
        <button
          type="button"
          onClick={() => outline.goTo(n.key)}
          className="inline min-h-0 break-words rounded-control border-0 bg-transparent p-0 text-left font-normal text-accent underline underline-offset-2"
        >
          {outline.labelOf(n.key)}
        </button>
      ) : (
        outline.labelOf(n.key)
      )}{" "}
      ({n.rate})
    </Fragment>
  ));
}

function GroupItem({ node, tree }: { node: PlannerNode; tree: string | null }) {
  const outline = useOutline();
  const current = outline.current === node.key;
  const gets = outline.neighbours.gets.get(node.key) ?? [];
  const sends = outline.neighbours.sends.get(node.key) ?? [];
  const ends = outline.neighbours.ends.get(node.key) ?? [];
  const role = roleText(node.role);
  const recipe = recipeText(node);
  const facts = [
    ...(role === null ? [] : [role]),
    ...(tree === null ? [] : [tree]),
    recipe === null ? `Recipe: ${noRecipeCellText(node).toLowerCase()}` : `Recipe: ${recipe}`,
    stateCountsText(node.stateCounts),
    ...(node.loop ? ["In a loop"] : []),
    ...(outline.groupFacts?.(node) ?? []),
  ];
  const label = groupLabel(node);
  const hits = nodeFindings(node, outline.findings).length;
  return (
    <li ref={outline.register(node.key)} tabIndex={-1} aria-current={current ? "true" : undefined} data-outline-row="group" className={rowClass(current)}>
      <p className="m-0 break-words">
        <Sentence node={node} />
      </p>
      {gets.length > 0 && (
        <p className="m-0 break-words text-sm">
          Gets <NeighbourList list={gets} word="from" />.
        </p>
      )}
      {sends.length > 0 && (
        <p className="m-0 break-words text-sm">
          Sends <NeighbourList list={sends} word="to" />.
        </p>
      )}
      {ends.length > 0 && <p className="m-0 break-words text-sm">Ends: {ends.join(", ")}.</p>}
      <p className="m-0 break-words text-sm text-muted">{facts.join(" · ")}</p>
      {/* Only a group with findings says so (the summary's "Needs attention" says when the read has not answered). */}
      {hits > 0 && (
        <p className="m-0 text-sm">
          <BottleneckBadge count={hits} what={label} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ShowInGraph label={label} onShow={() => outline.onShowInGraph(node.key)} />
        {outline.groupActions?.(node)}
      </div>
    </li>
  );
}

const COLUMNS: readonly [SortColumn, string][] = [
  ["from", "From"],
  ["to", "To"],
  ["item", "Item"],
  ["rate", "Rate"],
  ["carrier", "Carrier"],
];

/** "All connections" (Decision 3): one table behind a disclosure; Capacity and Flow are in each row's detail. */
function ConnectionsSection({ level, rows, empty }: { level: number; rows: readonly OutlineConnection[]; empty: string }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={`${ids}-heading`} className="grid gap-2">
      <Heading level={level} id={`${ids}-heading`}>
        <button type="button" aria-expanded={open} aria-controls={`${ids}-body`} onClick={() => setOpen(!open)} className="min-h-touch">
          All connections
        </button>
      </Heading>
      <div id={`${ids}-body`} hidden={!open} className="grid gap-2">
        {open && (rows.length === 0 ? <p className="m-0">{empty}</p> : <ConnectionsTable rows={rows} />)}
        {open && (
          <p className="m-0 text-sm text-muted">
            A rate with no word is measured. &quot;About&quot; is estimated from how machines share a belt. &quot;Unknown&quot; means the data
            cannot say.
          </p>
        )}
        {open && rows.some((r) => r.rate === "unknown" || r.item === "Item not inferred") && <p className="m-0 text-sm text-muted">{UNKNOWN_FLOW_NOTE}</p>}
      </div>
      {!open && (
        <p className="m-0 text-sm text-muted">
          {rows.length} {rows.length === 1 ? "connection" : "connections"}
        </p>
      )}
    </section>
  );
}

function ConnectionsTable({ rows }: { rows: readonly OutlineConnection[] }) {
  const [order, setOrder] = useState<SortOrder>(null);
  const [details, setDetails] = useState<ReadonlySet<string>>(new Set());
  const ids = useId();
  const sorted = useMemo(() => sortConnections(rows, order), [rows, order]);
  const sortBy = (column: SortColumn) =>
    setOrder((prev) => (prev?.column === column ? { column, descending: !prev.descending } : { column, descending: false }));
  return (
    <table className="sortable">
      <thead>
        <tr>
          {COLUMNS.map(([column, name]) => (
            <th
              key={column}
              scope="col"
              aria-sort={order?.column === column ? (order.descending ? "descending" : "ascending") : undefined}
            >
              <button type="button" onClick={() => sortBy(column)} className="min-h-touch">
                {name}
                <span aria-hidden className="ms-1 text-muted">
                  {order?.column === column ? (order.descending ? "↓" : "↑") : "↕"}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.flatMap((row, i) => {
          const shown = details.has(row.key);
          const detailId = `${ids}-${i}`;
          const main = (
            <tr key={row.key}>
              <th scope="row" className="break-words">
                {row.from}
              </th>
              <td data-label="To" className="break-words">
                {row.to}
              </td>
              <td data-label="Item" className="break-words">
                {row.item}
                {row.itemNote !== null && <span className="block text-sm text-muted">({row.itemNote})</span>}
              </td>
              <td data-label="Rate">{row.rate}</td>
              <td data-label="Carrier" className="break-words">
                {row.carrier}{" "}
                <button
                  type="button"
                  aria-expanded={shown}
                  aria-controls={shown ? detailId : undefined}
                  aria-label={`Details: ${row.from} to ${row.to}, ${row.item}`}
                  onClick={() =>
                    setDetails((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(row.key)) next.add(row.key);
                      return next;
                    })
                  }
                  className="ms-2 min-h-touch text-sm"
                >
                  Details
                </button>
              </td>
            </tr>
          );
          if (!shown) return [main];
          return [
            main,
            <tr key={`${row.key}|detail`} id={detailId}>
              <td colSpan={COLUMNS.length} className="text-sm">
                Capacity: {row.capacity ?? "not known"} · Flow: {row.flow}
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}
