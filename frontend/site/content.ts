// The guides and changelog sources (frontend/content/), read at build time only: nothing here ships to the browser.
// Markdown is rendered by markdown-it with raw HTML off, so a `<script>` or `<b>` in a source file is shown as text,
// and markdown-it's own link check drops `javascript:`, `vbscript:`, `file:` and non-image `data:` URLs. Every rule
// here fails the build with the file's name rather than shipping a broken page.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";

export interface Guide {
  slug: string;
  title: string;
  description: string;
  order: number;
  /** YYYY-MM-DD. */
  updated: string;
  /** The body as HTML: headings start at h2 (the page's h1 is the title). */
  html: string;
}

export interface Changelog {
  title: string;
  description: string;
  updated: string;
  html: string;
}

/** A guide shorter than this is a stub, not a page worth a crawler's visit: the build fails. */
export const MIN_GUIDE_WORDS = 80;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

// A code block scrolls sideways on a phone (legal.css), so keyboard users must be able to focus it (axe's
// scrollable-region-focusable): markdown-it's own <pre> output, with tabindex="0" added.
for (const rule of ["fence", "code_block"] as const) {
  const render = markdown.renderer.rules[rule];
  markdown.renderer.rules[rule] = (tokens, idx, options, env, self) =>
    (render?.(tokens, idx, options, env, self) ?? "").replace(/^<pre>/, '<pre tabindex="0">');
}

export class ContentError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "ContentError";
  }
}

/**
 * The front matter: a first line `---`, then `key: value` lines, then `---`. Values are plain text, optionally in
 * matching double or single quotes. Only the keys in `allowed` may appear, each once.
 */
export function parseFrontMatter(source: string, file: string, allowed: readonly string[]): { data: Map<string, string>; body: string } {
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0] !== "---") throw new ContentError(file, "must start with a `---` front matter line");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new ContentError(file, "front matter has no closing `---` line");
  const data = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!match) throw new ContentError(file, `front matter line is not \`key: value\`: ${line}`);
    const [, key, raw] = match;
    if (!allowed.includes(key)) throw new ContentError(file, `unknown front matter key \`${key}\` (allowed: ${allowed.join(", ")})`);
    if (data.has(key)) throw new ContentError(file, `front matter key \`${key}\` appears twice`);
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    data.set(key, quoted ? quoted[2] : raw);
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

function required(data: Map<string, string>, key: string, file: string): string {
  const value = data.get(key)?.trim();
  if (!value) throw new ContentError(file, `front matter needs a non-empty \`${key}\``);
  return value;
}

/** A real calendar date written YYYY-MM-DD. */
export function parseDate(value: string, file: string): string {
  const match = DATE.exec(value);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const date = match ? new Date(Date.UTC(year, month - 1, day)) : null;
  if (!date || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ContentError(file, `\`updated\` must be a date written YYYY-MM-DD, got \`${value}\``);
  }
  return value;
}

/** The URL slug of a guide file: its name without `.md`, lowercase words joined by single hyphens. */
export function slugFromFile(name: string): string {
  const slug = name.replace(/\.md$/, "");
  if (!name.endsWith(".md") || !SLUG.test(slug)) {
    throw new ContentError(name, "a guide's file name must be lowercase words joined by hyphens, ending .md");
  }
  return slug;
}

/**
 * Markdown to HTML, with the page's structure checked: no h1 (the title is the page's h1), no skipped heading level,
 * and images from this site only (the CSP's img-src is 'self').
 */
export function renderMarkdown(body: string, file: string): string {
  const tokens = markdown.parse(body, {});
  let level = 1;
  for (const token of tokens) {
    if (token.type === "heading_open") {
      const next = Number(token.tag.slice(1));
      if (next === 1) throw new ContentError(file, "no `#` heading in the body: the front matter title is the page's h1; start at `##`");
      if (next > level + 1) throw new ContentError(file, `heading level skips from h${level} to h${next}`);
      level = next;
    }
    for (const child of token.children ?? []) {
      if (child.type !== "image") continue;
      const src = String(child.attrGet("src") ?? "");
      // Browsers read "/\" like "//" (another host), so a backslash after the first slash is refused too.
      if (!/^\/(?![/\\])/.test(src)) throw new ContentError(file, `images must be this site's own files (a path starting /), got \`${src}\``);
    }
  }
  return markdown.renderer.render(tokens, markdown.options, {});
}

/** The words a reader (or a crawler) gets from rendered HTML. */
export function wordCount(html: string): number {
  return html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
}

export function parseGuide(name: string, source: string): Guide {
  const slug = slugFromFile(name);
  const { data, body } = parseFrontMatter(source, name, ["title", "description", "order", "updated"]);
  const order = required(data, "order", name);
  if (!/^\d+$/.test(order)) throw new ContentError(name, `\`order\` must be a whole number, got \`${order}\``);
  const html = renderMarkdown(body, name);
  if (wordCount(html) < MIN_GUIDE_WORDS) throw new ContentError(name, `a guide needs at least ${MIN_GUIDE_WORDS} words of body text`);
  return {
    slug,
    title: required(data, "title", name),
    description: required(data, "description", name),
    order: Number(order),
    updated: parseDate(required(data, "updated", name), name),
    html,
  };
}

/** Guides in reading order: `order` ascending, then slug, so the order never depends on the file system. */
export function sortGuides(guides: Guide[]): Guide[] {
  return [...guides].sort((a, b) => a.order - b.order || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Every `*.md` in `dir`, parsed and sorted. Fails on an empty folder: the index would have nothing to list. */
export function loadGuides(dir: string): Guide[] {
  const names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  if (names.length === 0) throw new ContentError(dir, "no guides (*.md) found");
  return sortGuides(names.map((name) => parseGuide(name, readFileSync(join(dir, name), "utf8"))));
}

export function parseChangelog(name: string, source: string): Changelog {
  const { data, body } = parseFrontMatter(source, name, ["title", "description", "updated"]);
  return {
    title: required(data, "title", name),
    description: required(data, "description", name),
    updated: parseDate(required(data, "updated", name), name),
    html: renderMarkdown(body, name),
  };
}

export function loadChangelog(file: string): Changelog {
  return parseChangelog(file.split(/[\\/]/).pop() ?? file, readFileSync(file, "utf8"));
}
