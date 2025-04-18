import { Graphviz } from "@hpcc-js/wasm-graphviz";
import type markdownit from "markdown-it";
import { getDefaultColorScheme } from "../control-flow/colors.ts";
import { applyTheme } from "../dot-cfg/dot-print.ts";

export async function GraphvizDotPlugin() {
  const graphviz = await Graphviz.load();

  return (md: markdownit) => {
    // Save the original fence renderer
    const defaultFence = md.renderer.rules.fence;

    // Override the fence renderer
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (!token) {
        return "";
      }

      if (token.info.trim() === "dot") {
        const code = token.content.trim();

        const svg = graphviz.dot(code);

        return `<div class="dot-graph">
        ${svg}
      </div>`;
      }
      if (token.info.trim() === "dot-cfg") {
        const code = token.content.trim();

        const themedDot = applyTheme(
          `digraph { ${code} }`,
          getDefaultColorScheme(),
        );
        const svg = graphviz.dot(themedDot);

        return `<div class="dot-graph">
        ${svg}
      </div>`;
      }

      // For other languages, use the default renderer
      if (!defaultFence) {
        return "";
      }
      return defaultFence(tokens, idx, options, env, self);
    };
  };
}
