<script lang="ts">
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import type { PanzoomObject } from "@panzoom/panzoom";
import objectHash from "object-hash";
import { createEventDispatcher } from "svelte";
import type { Action } from "svelte/action";
import { type Node as SyntaxNode, type Tree } from "web-tree-sitter";
import { type Language, languageDefinitions } from "../control-flow/cfg";
import { type ColorList, getLightColorList } from "../control-flow/colors";
import PanzoomComp from "./PanzoomComp.svelte";
import { memoizeFunction } from "./caching.ts";
import { type RenderOptions, Renderer } from "./renderer.ts";
import { type Parsers, initialize as initializeUtils } from "./utils";
type CodeAndOffset = { code: string; offset: number; language: Language };
import { extractFunctionNamesAndLocation } from "../control-flow/common-patterns";
import { renderBreakpointDots } from "../control-flow/overlay.ts";
let parsers: Parsers;
let graphviz: Graphviz;
let getNodeOffset: (nodeId: string) => number | undefined = () => undefined;
let offsetToNode: (offset: number) => string | undefined = () => undefined;
let svg: string;
let nodeIdToSyntaxNode: Map<string, SyntaxNode> = new Map();
interface Props {
  colorList?: ColorList;
  codeAndOffset?: CodeAndOffset | null;
  verbose?: boolean;
  simplify?: boolean;
  trim?: boolean;
  flatSwitch?: boolean;
  highlight?: boolean;
  showRegions?: boolean;
  breakpointLines?: number[];
  tempRunLine?: number | null;
}

let {
  colorList = getLightColorList(),
  codeAndOffset = null,
  verbose = false,
  simplify = true,
  trim = true,
  flatSwitch = true,
  highlight = true,
  showRegions = false,
  breakpointLines = [],
  tempRunLine = null,
}: Props = $props();

let lineToNodes: Map<number, string[]> = new Map();
let kitOpen: boolean = $state(false);

function getLineFromOffset(offset: number, code: string): number {
  if (offset < 0 || offset > code.length) {
    return -1;
  }
  let line = 0;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === "\n") {
      line++;
    }
  }
  return line;
}

function rebuildLineIndex() {
  const map = new Map<number, string[]>();
  const nodeElements = document.querySelectorAll("svg g.node");
  for (const element of Array.from(nodeElements)) {
    const nodeId = element.id;
    if (!nodeId) continue;
    const offset = getNodeOffset(nodeId);
    if (offset === undefined) continue;
    const line = getLineFromOffset(offset, codeAndOffset?.code ?? "");
    if (line < 0) continue;
    const arr = map.get(line) ?? [];
    arr.push(nodeId);
    map.set(line, arr);
  }
  lineToNodes = map;
}

function ensureBreakpointDot(nodeId: string) {
  const g = document.getElementById(nodeId) as SVGGElement | null;
  if (!g) return;
  if (g.querySelector(".breakpoint-dot")) return;
  const polygon = g.querySelector("polygon") as SVGGraphicsElement | null;
  if (!polygon) return;
  const box = polygon.getBBox();
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", "breakpoint-dot");
  dot.setAttribute("r", "5");
  dot.setAttribute("fill", "#e51400");
  dot.setAttribute("stroke", "none");
  dot.setAttribute("cx", String(box.x + 8));
  dot.setAttribute("cy", String(box.y + 8));
  g.appendChild(dot);
}

function ensureRunUntilDot(nodeId: string) {
  const g = document.getElementById(nodeId) as SVGGElement | null;
  if (!g) return;
  if (g.querySelector(".rununtil-dot")) return;
  const polygon = g.querySelector("polygon") as SVGGraphicsElement | null;
  if (!polygon) return;
  const box = polygon.getBBox();
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", "rununtil-dot");
  dot.setAttribute("r", "5");
  dot.setAttribute("fill", "none");
  dot.setAttribute("stroke", "#e51400");
  dot.setAttribute("stroke-width", "2");
  dot.setAttribute("cx", String(box.x + 8));
  dot.setAttribute("cy", String(box.y + 8));
  g.appendChild(dot);
}

function clearAllRunUntilDots() {
  const dots = document.querySelectorAll("svg g.node .rununtil-dot");
  for (const el of Array.from(dots)) el.remove();
}

function clearAllBreakpointDots() {
  const dots = document.querySelectorAll("svg g.node .breakpoint-dot");
  for (const el of Array.from(dots)) {
    el.remove();
  }
}

function refreshBreakpointDots() {
  clearAllBreakpointDots();
  clearAllRunUntilDots();
  if (breakpointLines?.length) {
    for (const line of breakpointLines) {
      const nodes = lineToNodes.get(line);
      if (!nodes) continue;
      for (const nodeId of nodes) ensureBreakpointDot(nodeId);
    }
  }
  if (typeof tempRunLine === "number") {
    const nodes = lineToNodes.get(tempRunLine);
    if (nodes) for (const nodeId of nodes) ensureRunUntilDot(nodeId);
  }
}

const getRenderer = memoizeFunction({
  func: (options: RenderOptions, colorList: ColorList, graphviz: Graphviz) =>
    new Renderer(options, colorList, graphviz),
  hash: (options: RenderOptions, colorList: ColorList, _graphviz: Graphviz) =>
    objectHash({ options, colorList }),
  max: 1,
});

const dispatch = createEventDispatcher();

async function initialize() {
  const utils = await initializeUtils();
  parsers = utils.parsers;
  graphviz = utils.graphviz;
}

function getFunctionAtOffset(
  tree: Tree,
  offset: number,
  language: Language,
): SyntaxNode | null {
  let syntax: SyntaxNode | null = tree.rootNode.descendantForIndex(offset);
  while (syntax) {
    if (languageDefinitions[language].functionNodeTypes.includes(syntax.type)) {
      break;
    }
    syntax = syntax.parent;
  }
  return syntax;
}

let functionId: string | undefined = undefined;
let functionChanged: boolean = true;

function trackFunctionChanges(functionSyntax: SyntaxNode, language: string) {
  const newFunctionId = objectHash({ code: functionSyntax.text, language });
  functionChanged = functionId !== newFunctionId;
  functionId = newFunctionId;
  if (functionChanged) {
    pzComp.reset();
  }
}

function renderCode(
  code: string,
  language: Language,
  cursorOffset: number,
  options: RenderOptions,
  colorList: ColorList,
) {
  const tree = parsers[language].parse(code);
  if (!tree) {
    throw new Error("Failed to parse code.");
  }
  const functionSyntax = getFunctionAtOffset(tree, cursorOffset, language);
  if (!functionSyntax) {
    throw new Error("No function found!");
  }
  trackFunctionChanges(functionSyntax, language);

  const renderer = getRenderer(options, colorList, graphviz);
  const renderResult = renderer.render(functionSyntax, language, cursorOffset);

  getNodeOffset = (nodeId: string) => {
    if (typeof renderResult.getNodeOffset === "function") {
      const val = renderResult.getNodeOffset(nodeId);
      return val !== undefined ? val : undefined;
    }
    return undefined;
  };
  offsetToNode = (offset: number) => {
    if (typeof renderResult.offsetToNode === "function") {
      const val = renderResult.offsetToNode(offset);
      return val !== undefined ? val : undefined;
    }
    return undefined;
  };
  nodeIdToSyntaxNode = renderResult.nodeIdToSyntaxNode;

  queueMicrotask(() => {
    rebuildLineIndex();
    refreshBreakpointDots();
  });

  return renderResult.svg;
}

$effect(() => {
  void breakpointLines;
  refreshBreakpointDots();
});

$effect(() => {
  void tempRunLine;
  refreshBreakpointDots();
});

function renderWrapper(
  codeAndOffset: CodeAndOffset | null,
  options: RenderOptions,
  colorList: ColorList,
) {
  const bgcolor = colorList.find(({ name }) => name === "graph.background").hex;
  const color = colorList.find(({ name }) => name === "node.highlight").hex;
  try {
    if (codeAndOffset === null) {
      svg = graphviz.dot(/*DOT*/ `digraph G {
    bgcolor="${bgcolor}"
    node [color="${color}", fontcolor="${color}"]
    edge [color="${color}"]
    Hello -> World 
}`);
    } else {
      svg = renderCode(
        codeAndOffset.code,
        codeAndOffset.language,
        codeAndOffset.offset,
        options,
        colorList,
      );
    }
  } catch (error) {
    console.trace(error);
  }
  return svg;
}

async function asyncRenderWrapper(
  codeAndOffset: CodeAndOffset | null,
  options: RenderOptions,
  colorList: ColorList,
) {
  return Promise.resolve(renderWrapper(codeAndOffset, options, colorList));
}

function onZoomClick(
  event: MouseEvent | TouchEvent | PointerEvent,
  panzoom: PanzoomObject,
  zoomElement: HTMLElement,
): void {
  let target: Element = event.target as Element;
  while (
    target.tagName !== "div" &&
    target.tagName !== "svg" &&
    !target.classList.contains("node") &&
    target.parentElement !== null
  ) {
    target = target.parentElement;
  }
  if (!target.classList.contains("node")) {
    return;
  }
  let functions: { name: string; row: number; column: number }[] = [];
  if (
    event.ctrlKey &&
    nodeIdToSyntaxNode.has(target.id) &&
    !simplify &&
    target.classList.contains("functionCall")
  ) {
    const syntaxNode = nodeIdToSyntaxNode.get(target.id);
    if (syntaxNode) {
      functions =
        extractFunctionNamesAndLocation(
          syntaxNode,
          ` 
        (parenthesized_expression
          (call_expression) @call) 

        (parenthesized_expression
          (binary_expression
            (call_expression) @call))

        (binary_expression
          (call_expression) @call)
          (call_expression) @call
  
        (update_expression
          (call_expression) @call)
    
        (assignment_expression
          right: (call_expression) @call)
      `,
          "call",
        ) ?? [];
      if (!functions.length) {
        functions =
          extractFunctionNamesAndLocation(
            syntaxNode,
            `
        (call_expression) 
          function: (identifier) @call
        `,
            "call",
          ) ?? [];
      }
    }
  }
  if (target.classList.contains("functionCall")) {
    dispatch("node-clicked", {
      node: target.id,
      withControl: event.ctrlKey,
      offset: getNodeOffset(target.id) ?? undefined,
      functionNamesAndLocations: functions,
    });
  } else {
    dispatch("node-clicked", {
      node: target.id,
      withControl: false,
      offset: getNodeOffset(target.id) ?? undefined,
      functionNamesAndLocations: functions,
    });
  }
}

let ctxMenu = $state<{
  visible: boolean;
  x: number;
  y: number;
  nodeId?: string;
  line?: number;
  has?: boolean;
}>({
  visible: false,
  x: 0,
  y: 0,
});

function hideContextMenu() {
  ctxMenu = { visible: false, x: 0, y: 0 };
}

function onContextMenu(event: MouseEvent) {
  let target: Element = event.target as Element;
  while (
    target.tagName !== "div" &&
    target.tagName !== "svg" &&
    !target.classList.contains("node") &&
    target.parentElement !== null
  ) {
    target = target.parentElement;
  }
  if (!target.classList.contains("node")) return;

  event.preventDefault();

  const nodeId = target.id;
  const offset = getNodeOffset(nodeId);
  const line = getLineFromOffset(offset ?? 0, codeAndOffset?.code ?? "");

  const has = breakpointLines?.includes(line) ?? false;

  ctxMenu = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    nodeId,
    line,
    has,
  };
}

function onToggleBreakpointClick() {
  if (
    !ctxMenu.visible ||
    ctxMenu.nodeId === undefined ||
    ctxMenu.line === undefined
  )
    return;

  dispatch("toggle-breakpoint", {
    nodeId: ctxMenu.nodeId,
    line: ctxMenu.line,
  });

  hideContextMenu();
}

document.addEventListener("click", () => {
  if (ctxMenu.visible) hideContextMenu();
});

let pzComp: PanzoomComp;
let enableZoom: boolean = $state(false);

const panAfterRender: Action = () => {
  if (functionChanged) {
    return;
  }
  if (codeAndOffset === null) {
    return;
  }
  const selectedNode = offsetToNode(codeAndOffset.offset);
  if (selectedNode) {
    pzComp.panTo(`#${selectedNode}`);
  }
};
</script>
<div class="editor-controls">
  <input type="checkbox" id="simplify-toggle" bind:checked={simplify}/> <label for="simplify">Simplify</label>
  <input type="checkbox" id="panzoom" bind:checked={enableZoom}/> <label for="panzoom">Pan & Zoom</label>

  <div class="debug-kit">
    <button class="kit-toggle" onclick={() => (kitOpen = !kitOpen)}>Debug Kit ▾</button>
    {#if kitOpen}
      <div class="kit-panel" role="menu">
        <button onclick={() => { kitOpen = false; dispatch('clear-all-bps'); }}>
          Clear all breakpoints
        </button>
      </div>
    {/if}
  </div>
</div>
<PanzoomComp bind:this={pzComp} onclick={onZoomClick} disabled={!enableZoom}>
{#await initialize() then _}
  <div class="graph" oncontextmenu={onContextMenu} role="region">
    {#await asyncRenderWrapper(
      codeAndOffset,
      {
        simplify,
        verbose,
        trim,
        flatSwitch,
        highlight,
        showRegions,
      },
      colorList,
    ) then inlineSvg}
      <div class="svg-wrapper" use:panAfterRender>
        {@html inlineSvg}
      </div>
    {/await}
  </div>
{/await}
</PanzoomComp>

{#if ctxMenu.visible}
  <div
    class="context-menu"
    style={"top:" + ctxMenu.y + "px;left:" + ctxMenu.x + "px"}
    role="menu"
  >
    <button
      type="button"
      aria-label={ctxMenu.has ? "Remove Breakpoint" : "Add Breakpoint"}
      onclick={e => { e.stopPropagation(); onToggleBreakpointClick(); }}
    >
      {#if ctxMenu.has}Remove Breakpoint{:else}Add Breakpoint{/if}
    </button>

    <button
      type="button"
      aria-label="Run until breakpoint"
      onclick={e => {
        e.stopPropagation();
        if (ctxMenu.line != null) {
          dispatch("run-until", { line: ctxMenu.line });
        }
        hideContextMenu();
      }}
    >
      Run until here
    </button>
  </div>
{/if}

<style>
  .graph {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1em;
    width: 100%;
    height: 100%;
  }

  .svg-wrapper {
      width: 100%;
      height: 100%;
  }

  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--vscode-editor-background, #2b2d30);
    color: var(--vscode-editor-foreground, #ddd);
    border: 1px solid var(--vscode-editor-foreground, #555);
    padding: 6px 8px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    font-size: 12px;
    display: grid;
    gap: 6px;
  }
  .context-menu > button {
    background: transparent;
    color: inherit;
    border: 0;
    text-align: left;
    padding: 4px 2px;
    cursor: pointer;
  }
  .context-menu > button:hover {
    filter: brightness(1.2);
  }

  :root {
      --jetbrains-editor-background: #2B2D30;
      --jetbrains-editor-foreground: #dddddd;
      --jetbrains-color-scheme: dark;
  }

  .editor-controls {
      z-index: 1000;
      position: relative;
      width: 100%;
      background-color: var(--vscode-editor-background, var(--jetbrains-editor-background));
      color: var(--vscode-editor-foreground, var(--jetbrains-editor-foreground));
      color-scheme: var(--jetbrains-color-scheme);
      padding: 0.5em;

      display: flex;
      align-items: center;
      gap: 12px;
      font: inherit;
      line-height: 1.3;
  }
  .editor-controls label {
      font: inherit;
      line-height: 1.3;
      vertical-align: middle;
  }
  .editor-controls input[type="checkbox"] {
      vertical-align: middle;
  }

  :global(.vscode-light) .editor-controls {
      color-scheme: light;
  }

  :global(.vscode-dark) .editor-controls {
      color-scheme: dark;
  }

  .debug-kit {
    display: inline-flex;
    align-items: center;
    position: relative;
    margin-left: 4px;
  }
  .kit-toggle {
    font: inherit;
    line-height: 1.3;
    color: inherit;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }
  .kit-toggle:hover {
    text-decoration: underline; 
  }
  .kit-panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10000;
    background: var(--vscode-editor-background, #2b2d30);
    color: var(--vscode-editor-foreground, #ddd);
    border: 1px solid var(--vscode-editor-foreground, #555);
    padding: 6px 8px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    min-width: 180px;
  }
  .kit-panel > button {
    background: transparent;
    color: inherit;
    border: 0;
    text-align: left;
    padding: 4px 2px;
    width: 100%;
    cursor: pointer;
  }
  .kit-panel > button:hover {
    filter: brightness(1.2);
  }
</style>
