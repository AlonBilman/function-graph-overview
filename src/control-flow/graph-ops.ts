import { MultiDirectedGraph } from "graphology";
import { subgraph } from "graphology-operators";
import { bfsFromNode } from "graphology-traversal";
import type { CFG } from "./cfg-defs";

export function distanceFromEntry(cfg: CFG): Map<string, number> {
  const { graph, entry } = cfg;
  const levels = new Map();

  bfsFromNode(graph, entry, (node, attr, depth) => {
    levels.set(node, depth);
  });

  return levels;
}

/// Can return null to indicate that the merge is not allowed.
/// The function MUST NOT modify the input arguments.
export type AttrMerger = (
  nodeAttrs: object,
  intoAttrs: object,
) => object | null;
function collapseNode(
  graph: MultiDirectedGraph,
  node: string,
  into: string,
  mergeAttrs?: AttrMerger,
) {
  if (mergeAttrs) {
    const attrs = mergeAttrs(
      graph.getNodeAttributes(node),
      graph.getNodeAttributes(into),
    );
    if (attrs === null) {
      // We can't merge the nodes, so we bail.
      return;
    }

    for (const [name, value] of Object.entries(attrs)) {
      graph.setNodeAttribute(into, name, value);
    }
  }

  graph.forEachEdge(node, (edge, attributes, source, target) => {
    if (target === into) {
      return;
    }

    const replaceNode = (n: string) => (n === node ? into : n);
    const edgeNodes = [replaceNode(source), replaceNode(target)] as const;
    graph.addEdge(...edgeNodes, attributes);
  });

  graph.dropNode(node);
}
/**
 *
 * @param graph The graph to simplify
 */
export function simplifyCFG(cfg: CFG, mergeAttrs?: AttrMerger): CFG {
  const graph = cfg.graph.copy();

  const toCollapse: string[][] = graph
    .mapEdges((edge, attrs, source, target) => {
      if (graph.outDegree(source) === 1 && graph.inDegree(target) === 1) {
        return [source, target];
      }
      return null;
    })
    .filter((x) => x) as string[][];

  // Sort merges based on topological order
  const levels = distanceFromEntry(cfg);
  toCollapse.sort((a, b) => (levels.get(a[0]) ?? 0) - (levels.get(b[0]) ?? 0));

  let entry = cfg.entry;

  try {
    toCollapse.forEach(([source, target]) => {
      collapseNode(graph, source, target, mergeAttrs);
      if (entry === source) {
        // Keep track of the entry node!
        entry = target;
      }
    });
  } catch (error) {
    console.log(error);
  }

  return { graph, entry };
}

export function trimFor(cfg: CFG): CFG {
  const { graph, entry } = cfg;
  const reachable: string[] = [];

  bfsFromNode(graph, entry, (node) => {
    reachable.push(node);
  });

  return { graph: subgraph(graph, reachable), entry };
}
