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
//Im not sure that I like this, but it works for now.
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
}: Props = $props();

// Map line -> nodeIds (built per render)
let lineToNodes: Map<number, string[]> = new Map();

function getLineFromOffset(offset: number, code: string): number {
  if (offset < 0 || offset > code.length) {
    return -1; // Invalid offset
  }

  let line = 0;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === "\n") {
      line++;
    }
  }

  return line; // 0-based line number
}

function rebuildLineIndex() {
  const map = new Map<number, string[]>();

  // Get all nodeIds from the current SVG DOM
  const nodeElements = document.querySelectorAll("svg g.node");

  for (const element of nodeElements) {
    const nodeId = element.id;
    if (!nodeId) continue;

    // Get the offset for this node
    const offset = getNodeOffset(nodeId);
    if (offset === undefined) continue;

    // Convert offset to line number
    const line = getLineFromOffset(offset, codeAndOffset?.code ?? "");
    if (line < 0) continue; // Invalid line

    // Add nodeId to the line mapping
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

function clearAllBreakpointDots() {
  const dots = document.querySelectorAll("svg g.node .breakpoint-dot");
  for (const el of Array.from(dots)) {
    el.remove();
  }
}

function refreshBreakpointDots() {
  clearAllBreakpointDots();
  if (!breakpointLines?.length) return; // read prop directly
  for (const line of breakpointLines) {
    const nodes = lineToNodes.get(line);
    if (!nodes) continue;
    for (const nodeId of nodes) ensureBreakpointDot(nodeId);
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

/// Hash identifier of the current function, used to keep track of function changes.
let functionId: string | undefined = undefined;
/// True if a function changed in the last change of rendering input
let functionChanged: boolean = true;

function trackFunctionChanges(functionSyntax: SyntaxNode, language: string) {
  // Keep track of when the function changes so that we can update the
  // panzoom accordingly.
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

  // Queue both for after SVG is mounted
  queueMicrotask(() => {
    rebuildLineIndex();
    refreshBreakpointDots();
  });

  return renderResult.svg;
}

// Keep dots in sync when only breakpointLines change (no graph re-render)
$effect(() => {
  void breakpointLines; // ensure reactivity
  refreshBreakpointDots();
});

function renderWrapper(
  codeAndOffset: CodeAndOffset | null,
  options: RenderOptions,
  colorList: ColorList,
) {
  console.log("Rendering!");
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
  console.log("Zoom click!");
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
  //we want it work only on detailed mode
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

// NEW: simple context menu state and handlers
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

// Find node under cursor, compute its first line, and show menu
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

// Close menu on outside click
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
</div>
<PanzoomComp bind:this={pzComp} onclick={onZoomClick} disabled={!enableZoom}>
{#await initialize() then _}
  <!-- I don't know how to make this part accessible. PRs welcome! -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="graph" oncontextmenu={onContextMenu}>
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
  <button
    type="button"
    class="context-menu"
    style={"top:" + ctxMenu.y + "px;left:" + ctxMenu.x + "px"}
    aria-label={ctxMenu.has ? "Remove Breakpoint" : "Add Breakpoint"}
    onclick={e => { e.stopPropagation(); onToggleBreakpointClick(); }}
    onkeydown={e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleBreakpointClick();
      }
    }}
  >
    {#if ctxMenu.has}
      Remove Breakpoint
    {:else}
      Add Breakpoint
    {/if}
  </button>
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
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    font-size: 12px;
  }

  :root {
      /* We don't yet get the actual colors from the JetBrains IDEs,
         so we fake them and default to just dark for now.
       */
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
  }

  /* Match the VSCode light/dark toggle for the checkboxes */
  :global(.vscode-light) .editor-controls {
      color-scheme: light;
  }

  :global(.vscode-dark) .editor-controls {
      color-scheme: dark;
  }

</style>
