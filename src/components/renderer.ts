import type { Graphviz } from "@hpcc-js/wasm-graphviz";
import objectHash from "object-hash";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { type Language, newCFGBuilder } from "../control-flow/cfg";
import { mergeNodeAttrs, remapNodeTargets } from "../control-flow/cfg-defs";
import { type ColorList, listToScheme } from "../control-flow/colors";
import {
  type AttrMerger,
  simplifyCFG,
  trimFor,
} from "../control-flow/graph-ops";
import { OverlayBuilder } from "../control-flow/overlay.ts";
import { graphToDot } from "../control-flow/render";
import { svgFromString } from "../control-flow/svgFromString.ts";
import { memoizeFunction } from "./caching.ts";

export interface RenderOptions {
  readonly simplify: boolean;
  readonly verbose: boolean;
  readonly trim: boolean;
  readonly flatSwitch: boolean;
  readonly highlight: boolean;
  readonly showRegions: boolean;
}

export class Renderer {
  private memoizedRenderStatic = memoizeFunction({
    func: this.renderStatic.bind(this),
    hash: (functionSyntax: SyntaxNode, language: Language) =>
      objectHash({ code: functionSyntax.text, language }),
    max: 100,
  });
  constructor(
    private readonly options: RenderOptions,
    private readonly colorList: ColorList,
    private readonly graphviz: Graphviz,
  ) {}

  public render(
    functionSyntax: SyntaxNode,
    language: Language,
    offsetToHighlight?: number,
  ): {
    svg: string;
    dot: string;
    getNodeOffset: (nodeId: string) => number | undefined;
    offsetToNode: (offset: number) => string;
    nodeIdToSyntaxNode: Map<string, SyntaxNode>;
  } {
    let { dot, svg, getNodeOffset, offsetToNode, nodeIdToSyntaxNode } =
      this.memoizedRenderStatic(functionSyntax, language);

    // We want to allow the function to move without changing (in case of code
    // edits in other functions).
    // To do that, we need to make all offset calculations relative to the
    // function and not the file.
    const baseOffset = functionSyntax.startIndex;

    const nodeToHighlight =
      offsetToHighlight && this.options.highlight
        ? offsetToNode(offsetToHighlight - baseOffset)
        : undefined;

    if (nodeToHighlight) {
      svg = this.highlightNode(svg, nodeToHighlight);
    }

    return {
      svg: svg,
      dot,
      getNodeOffset: (nodeId: string) => getNodeOffset(nodeId) + baseOffset,
      offsetToNode: (offset: number) => offsetToNode(offset - baseOffset),
      nodeIdToSyntaxNode,
    };
  }

  // Public: highlight an SVG by node id without re-rendering DOT
  public applyHighlight(svg: string, nodeId: string): string {
    return this.highlightNode(svg, nodeId);
  }

  private highlightNode(svg: string, nodeId: string): string {
    try {
      const dom = svgFromString(svg);
      const node = dom.findOne(`g#${CSS.escape(nodeId)}`);
      if (!node) return svg;

      const poly = node.findOne("polygon");
      if (!poly) return svg;

      // Keep existing fill; emphasize the border as bold white dashed
      node.addClass("highlight");
      poly.attr({
        stroke: "#ffffff",
        "stroke-width": "2",
        "stroke-linejoin": "round",
      });

      return dom.svg();
    } catch (e) {
      console.error(`Failed to highlight node ${nodeId}:`, e);
      return svg;
    }
  }

  private renderStatic(functionSyntax: SyntaxNode, language: Language) {
    const overlayBuilder = new OverlayBuilder(functionSyntax);

    const builder = newCFGBuilder(language, {
      flatSwitch: this.options.flatSwitch,
    });

    // Build the CFG
    let cfg = builder.buildCFG(functionSyntax);
    if (!cfg) throw new Error("Failed generating CFG for function");
    if (this.options.trim) cfg = trimFor(cfg);
    const nodeAttributeMerger: AttrMerger = this.options.showRegions
      ? overlayBuilder.getAttrMerger(mergeNodeAttrs)
      : mergeNodeAttrs;
    if (this.options.simplify) {
      cfg = simplifyCFG(cfg, nodeAttributeMerger);
    }
    cfg = remapNodeTargets(cfg);

    // Build nodeIdToSyntaxNode map
    const nodeIdToSyntaxNode = new Map<string, SyntaxNode>();
    if (builder?.nodeMapper?.syntaxToNode) {
      for (const [
        syntax,
        nodeId,
      ] of builder.nodeMapper.syntaxToNode.entries()) {
        nodeIdToSyntaxNode.set(nodeId, syntax);
      }
    }

    // Render to DOT
    const dot = graphToDot(
      cfg,
      this.options.verbose,
      this.options.simplify,
      listToScheme(this.colorList),
    );

    // Render SVG
    let svg = this.graphviz.dot(dot);

    // Set width and height
    const dom = svgFromString(svg);
    dom.width("100%");
    dom.height("100%");
    svg = dom.svg();

    // Overlay regions
    if (this.options.showRegions) {
      svg = overlayBuilder.renderOnto(cfg, svg);
    }

    return {
      svg,
      dot,
      getNodeOffset: (nodeId: string) =>
        cfg.graph.getNodeAttribute(nodeId, "startOffset") -
        functionSyntax.startIndex,
      offsetToNode: (offset: number) =>
        cfg.offsetToNode.get(offset + functionSyntax.startIndex),
      nodeIdToSyntaxNode,
    };
  }
}
