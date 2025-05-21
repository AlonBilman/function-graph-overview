<script lang="ts" module>
import type { MessageToVscode } from "../../vscode/messages.ts";

declare const acquireVsCodeApi:
  | undefined
  | (() => {
      postMessage<T extends MessageToVscode>(message: T): void;
    });

declare global {
  interface Window {
    JetBrains?: {
      /**
       * Calls going from the WebView to the JetBrains extension
       */
      ToExtension?: {
        navigateTo: (offset: string, withControl: boolean) => void;
      };
      /**
       * Functions the extension can use to call into the WebView
       */
      ToWebview?: {
        setColors: (colors: string) => void;
        setCode: (code: string, offset: number, language: string) => void;
        setSimplify: (simplify: boolean) => void;
        setFlatSwitch: (flatSwitch: boolean) => void;
        setHighlight: (highlight: boolean) => void;
      };
    };
  }
}
</script>

<script lang="ts">
  import WebviewRenderer from "../../components/WebviewRenderer.svelte";
  import { isValidLanguage, type Language } from "../../control-flow/cfg";
  import {
    deserializeColorList,
    type ColorList,
    getDarkColorList,
    getLightColorList,
  } from "../../control-flow/colors";
  import * as jetbrainsDarkTheme from "./defaultDark.json";
  import type { MessageToWebview, NavigateTo } from "../../vscode/messages.ts";

  /**
   * Are we running in a VSCode WebView?
   */
  const vscode =
    typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : undefined;

  let simplify = $state(true);
  let flatSwitch = $state(true);
  let highlight = $state(true);

  // Set initial background color
  let colorList = $state((function () {
    function isDarkTheme(): boolean {
      return document.body.dataset.theme !== "light";
    }

    // This is the JetBrains colorlist
    let colorList: ColorList = jetbrainsDarkTheme.scheme as ColorList;
    if (vscode) {
      // This is the VSCode colorList
      colorList = getDarkColorList();
    }
    if (!isDarkTheme()) {
      colorList = getLightColorList();
    }
    document.body.style.backgroundColor = colorList.find(
      ({ name }) => name === "graph.background",
    ).hex;

    return colorList;
  })());

  // TODO: The StateHandler is overkill, we should remove it.
  //       All we need for now is the navigation handlers.
  type Config = {
    simplify?: boolean;
    flatSwitch?: boolean;
    highlight?: boolean;
    colorList?: ColorList;
  };
  type State = {
    code?: string;
    offset?: number;
    language?: Language;
    config?: Config;
  };

  class StateHandler {
    private state: State = {
      config: { simplify: true, flatSwitch: true, highlight: true },
    };
    private navigateToHandlers: ((offset: number, withControl: boolean) => void)[] = [];

    public update(state: Partial<State>): void {
      const config = Object.assign(this.state.config, state.config);
      Object.assign(this.state, state);
      this.state.config = config;

      simplify = Boolean(this.state.config.simplify);
      flatSwitch = Boolean(this.state.config.flatSwitch);
      highlight = Boolean(this.state.config.highlight);

      setCode(this.state.code, this.state.offset, this.state.language);
    }

    public onNavigateTo(callback: (offset: number, withControl: boolean) => void): void {
      this.navigateToHandlers.push(callback);
    }

    public navigateTo(offset: number, withControl: boolean): void {
      for (const handler of this.navigateToHandlers) {
        handler(offset, withControl);
      }
    }
  }

  let codeAndOffset: {
    code: string;
    offset: number;
    language: Language;
  } | null = $state(null);

  function setCode(newCode: string, offset: number, language: string) {
    if (isValidLanguage(language)) {
      codeAndOffset = { code: newCode, offset, language };
    }
  }

  function initVSCode(stateHandler: StateHandler): void {
    if (!vscode) {
      // We're not running in VSCode
      return;
    }
    // Handle messages sent from the extension to the webview
    window.addEventListener("message", (event: { data: MessageToWebview }) => {
      const message = event.data; // The json data that the extension sent
      switch (message.tag) {
        case "updateCode": {
          stateHandler.update({
            code: message.code,
            offset: message.offset,
            language: message.language,
          });
          break;
        }
        case "updateSettings":
          flatSwitch = message.flatSwitch;
          simplify = message.simplify;
          highlight = message.highlightCurrentNode;
          colorList = message.colorList;
          document.body.style.backgroundColor = colorList.find(
            ({ name }) => name === "graph.background",
          ).hex;
      }
    });

    stateHandler.onNavigateTo((offset: number, withControl : boolean) => {
      vscode?.postMessage<NavigateTo>({ tag: "navigateTo", offset: offset, withControl: withControl });
    });
  }

  function initJetBrains(stateHandler: StateHandler): void {
    function setColors(colors: string) {
      try {
        colorList = deserializeColorList(colors);
        document.body.style.backgroundColor = colorList.find(
          ({ name }) => name === "graph.background",
        ).hex;
      } catch (error) {
        console.trace(error);
        return;
      }
    }

    // Set callbacks for use by the JetBrains extension
    window.JetBrains ??= {};
    window.JetBrains.ToWebview = {
      setSimplify: (flag: boolean) =>
        stateHandler.update({ config: { simplify: flag } }),
      setFlatSwitch: (flag: boolean) =>
        stateHandler.update({ config: { flatSwitch: flag } }),
      setHighlight: (flag: boolean) =>
        stateHandler.update({ config: { highlight: flag } }),
      setCode,
      setColors,
    };

    stateHandler.onNavigateTo((offset: number, withControl :boolean) => {
      window.JetBrains?.ToExtension?.navigateTo(offset.toString(), withControl);
    });
  }

  const stateHandler = new StateHandler();
  initVSCode(stateHandler);
  initJetBrains(stateHandler);

  function navigateTo(
    e: CustomEvent<{ node: string; offset: number | null; withControl: boolean }>,
  ): void {
    if (e.detail.offset === null) {
      // We don't know the offset, so we can't navigate to it.
      // TODO: Check if this can actually happen now.
      //       We changed the representation of nodes, so it shouldn't.
      return;
    }

    stateHandler.navigateTo(e.detail.offset, e.detail.withControl);
  }
</script>

<main>
  <WebviewRenderer
    {codeAndOffset}
    {colorList}
    {simplify}
    {flatSwitch}
    {highlight}
    on:node-clicked={navigateTo}
  />
</main>

<style>
  main {
    width: 100%;
    height: 100%;
  }
</style>
