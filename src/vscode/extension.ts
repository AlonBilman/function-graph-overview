import * as vscode from "vscode";
import type { Language } from "../control-flow/cfg";
import {
  type ColorList,
  deserializeColorList,
  getDarkColorList,
  getLightColorList,
} from "../control-flow/colors";
import type {
  ToggleBreakpoint,
  UpdateBreakpoints,
  UpdateCode,
  UpdateSettings,
} from "./messages.ts";
import { OverviewViewProvider } from "./overview-view";

/* oxlint-disable eslint-plugin-unicorn(require-post-message-target-origin) */

interface FunctionPickItem extends vscode.QuickPickItem {
  name: string;
  row: number;
  column: number;
}

const languageMapping: { [key: string]: Language } = {
  c: "C",
  cpp: "C++",
  go: "Go",
  python: "Python",
  typescript: "TypeScript",
  javascript: "TypeScript",
  typescriptreact: "TypeScript",
  javascriptreact: "TypeScript",
};

const idToLanguage = (languageId: string): Language | undefined => {
  return languageMapping[languageId];
};

function getCurrentCode(): {
  code: string;
  languageId: string;
  language: Language;
} | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  const languageId = document.languageId;
  const language = idToLanguage(languageId);
  if (!language) {
    console.log(`Unsupported language id: ${languageId}`);
    return null;
  }
  const code = document.getText();
  return { code, languageId, language };
}

function isThemeDark(): boolean {
  const theme = vscode.window.activeColorTheme;
  return theme.kind === vscode.ColorThemeKind.Dark;
}

type Settings = {
  flatSwitch: boolean;
  highlightCurrentNode: boolean;
  colorList: ColorList;
  simplify: boolean;
};
type ColorSchemeOptions = "Light" | "Dark" | "Custom" | "System";
function loadSettings(): Settings {
  const config = vscode.workspace.getConfiguration("functionGraphOverview");

  const colorScheme: ColorSchemeOptions = config.get("colorScheme") ?? "Light";
  const colorList = (() => {
    switch (colorScheme) {
      case "System":
        if (isThemeDark()) return getDarkColorList();
        return getLightColorList();
      case "Light":
        return getLightColorList();
      case "Dark":
        return getDarkColorList();
      case "Custom":
        try {
          return deserializeColorList(config.get("customColorScheme") ?? "");
        } catch (error) {
          console.log(error);
        }
        return getLightColorList();
    }
  })();
  return {
    flatSwitch: config.get("flatSwitch") ?? true,
    highlightCurrentNode: config.get("highlightCurrentNode") ?? true,
    colorList: colorList,
    simplify: config.get("simplify") ?? true,
  };
}

function focusEditor() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    vscode.window.showTextDocument(editor.document, {
      preserveFocus: false,
      preview: false,
      viewColumn: editor.viewColumn,
    });
  }
}

function moveCursorAndReveal(offset: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const position = editor.document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}

let provider: OverviewViewProvider;
let extContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
  extContext = context;

  provider = new OverviewViewProvider(
    context.extensionUri,
    isThemeDark(),
    {
      navigateTo: ({ offset, withControl, functionNamesAndLocations }) =>
        onNodeClick(offset, withControl, functionNamesAndLocations),
      toggleBreakpoint: ({ line }: ToggleBreakpoint) => {
        toggleBreakpointAtActiveEditorLine(line);
      },
      runUntil: ({ line }: { line: number }) => {
        runUntilAtActiveEditorLine(line);
      },
      clearAllBreakpoints: () => {
        clearAllSourceBreakpoints();
      },
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OverviewViewProvider.viewType,
      provider,
    ),
  );

  console.log("function-graph-overview active");

  function jumpToCursor(row: number, col: number): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    row -= 1;
    const pos = new vscode.Position(row, col);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter,
    );
  }

  async function onNodeClick(
    offset: number,
    withControl: boolean,
    functionNamesAndLocations?: { name: string; row: number; column: number }[],
  ): Promise<void> {
    if (withControl) {
      try {
        moveCursorAndReveal(offset);
        if (functionNamesAndLocations && functionNamesAndLocations.length > 0) {
          const quickPickItems: FunctionPickItem[] =
            functionNamesAndLocations.map((fn) => ({
              label: fn.name,
              description: `(row: ${fn.row}, col: ${fn.column})`,
              name: fn.name,
              row: fn.row,
              column: fn.column,
            }));

          const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "What function do you want to go to?",
            canPickMany: false,
          });

          if (selection) {
            jumpToCursor(selection.row, selection.column);
          } else {
            vscode.window.showInformationMessage("No function selected.");
            return;
          }
        }
        vscode.commands.executeCommand("editor.action.revealDefinition");
        focusEditor();
      } catch (error) {
        console.error("Error during QuickPick or command execution:", error);
      }
    } else {
      moveCursorAndReveal(offset);
      focusEditor();
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("functionGraphOverview")) {
          const settings = loadSettings();
          provider.postMessage<UpdateSettings>({
            tag: "updateSettings",
            flatSwitch: settings.flatSwitch,
            simplify: settings.simplify,
            highlightCurrentNode: settings.highlightCurrentNode,
            colorList: settings.colorList,
          });
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      const settings = loadSettings();
      provider.postMessage<UpdateSettings>({
        tag: "updateSettings",
        simplify: settings.simplify,
        flatSwitch: settings.flatSwitch,
        highlightCurrentNode: settings.highlightCurrentNode,
        colorList: settings.colorList,
      });
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(
      (event: vscode.TextEditorSelectionChangeEvent): void => {
        const editor = event.textEditor;
        const position = editor.selection.active;
        const offset = editor.document.offsetAt(position);

        const { code, languageId, language } = getCurrentCode() ?? {};
        if (!code || !languageId || !language) return;

        provider.postMessage<UpdateCode>({
          tag: "updateCode",
          code,
          offset,
          language,
        });

        postBreakpointsForActiveEditor();
      },
    ),
  );

  const command = "functionGraphOverview.focus";
  const commandHandler = () => {
    vscode.commands.executeCommand("functionGraphOverview.overview.focus");
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(command, commandHandler),
  );

  function postBreakpointsForActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const uri = editor.document.uri.toString();
    const lines = vscode.debug.breakpoints
      .filter(
        (bp): bp is vscode.SourceBreakpoint =>
          bp instanceof vscode.SourceBreakpoint &&
          bp.location.uri.toString() === uri,
      )
      .map((bp) => bp.location.range.start.line);
    provider.postMessage<UpdateBreakpoints>({
      tag: "updateBreakpoints",
      lines,
    });
  }

  function toggleBreakpointAtActiveEditorLine(line: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const uri = editor.document.uri;
    const existing = vscode.debug.breakpoints.filter(
      (bp): bp is vscode.SourceBreakpoint =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.location.uri.toString() === uri.toString() &&
        bp.location.range.start.line === line,
    );

    if (existing.length) {
      vscode.debug.removeBreakpoints(existing);
    } else {
      const location = new vscode.Location(uri, new vscode.Position(line, 0));
      vscode.debug.addBreakpoints([
        new vscode.SourceBreakpoint(location, true),
      ]);
    }
  }

  context.subscriptions.push(
    vscode.debug.onDidChangeBreakpoints(() => postBreakpointsForActiveEditor()),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() =>
      postBreakpointsForActiveEditor(),
    ),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() =>
      postBreakpointsForActiveEditor(),
    ),
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(() => {
      if (tempRunTarget) {
        vscode.debug.removeBreakpoints([tempRunTarget.bp]);
        tempRunTarget = null;
        postTempRunLine(null);
      }
    }),
  );

  postBreakpointsForActiveEditor();
}

let tempRunTarget:
  | { uri: vscode.Uri; line: number; bp: vscode.SourceBreakpoint }
  | null = null;

const trackedTypes = new Set<string>();

function isStoppedEvent(
  m: unknown,
): m is { event: string; body?: { threadId?: number } } {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { event?: string }).event === "stopped"
  );
}

type DAPStackFrame = {
  line?: number;
  source?: { path?: string; sourceReference?: number };
};
type DAPStackTraceResponse = { stackFrames?: DAPStackFrame[] };

async function waitForSessionStart(
  timeoutMs = 10000,
): Promise<vscode.DebugSession | null> {
  if (vscode.debug.activeDebugSession) return vscode.debug.activeDebugSession;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      d.dispose();
      resolve(vscode.debug.activeDebugSession ?? null);
    }, timeoutMs);
    const d = vscode.debug.onDidStartDebugSession((s) => {
      clearTimeout(t);
      d.dispose();
      resolve(s);
    });
  });
}

async function ensureDebugSession(): Promise<vscode.DebugSession | null> {
  if (vscode.debug.activeDebugSession) return vscode.debug.activeDebugSession;

  const folders = vscode.workspace.workspaceFolders;
  const startViaCommand = async () => {
    await vscode.commands.executeCommand("workbench.action.debug.start");
    return await waitForSessionStart();
  };

  if (!folders?.length) {
    return await startViaCommand();
  }

  const folder = folders[0];
  if (!folder) {
    return await startViaCommand();
  }
  const launch = vscode.workspace.getConfiguration("launch", folder.uri);
  const configs =
    launch.get<vscode.DebugConfiguration[]>("configurations") ?? [];
  if (configs.length === 1 && configs[0] !== undefined) {
    const ok = await vscode.debug.startDebugging(folder, configs[0]);
    if (!ok) return null;
    return await waitForSessionStart();
  }

  return await startViaCommand();
}

function postTempRunLine(line: number | null) {
  provider.postMessage<{ tag: "updateTempRunLine"; line: number | null }>({
    tag: "updateTempRunLine",
    line,
  });
}

function clearAllSourceBreakpoints() {
  const toRemove = vscode.debug.breakpoints.filter(
    (bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint,
  );
  if (toRemove.length) {
    vscode.debug.removeBreakpoints(toRemove);
  }
  if (tempRunTarget) {
    vscode.debug.removeBreakpoints([tempRunTarget.bp]);
    tempRunTarget = null;
  }
  postTempRunLine(null);
}

function ensureStoppedTracker(sessionType: string) {
  if (trackedTypes.has(sessionType)) return;
  const disp = vscode.debug.registerDebugAdapterTrackerFactory(sessionType, {
    createDebugAdapterTracker(session) {
      return {
        async onDidSendMessage(m: unknown) {
          if (!isStoppedEvent(m) || !tempRunTarget) return;
          try {
            const threadId = m.body?.threadId;
            if (!threadId) return;
            const stack = (await session.customRequest("stackTrace", {
              threadId,
              startFrame: 0,
              levels: 1,
            })) as DAPStackTraceResponse;
            const frame = stack.stackFrames?.[0];
            if (!frame?.source) return;
            const hitUri = frame.source.path
              ? vscode.Uri.file(frame.source.path)
              : undefined;
            const hitLine0 = (frame.line ?? 1) - 1;
            if (
              hitUri &&
              hitUri.toString() === tempRunTarget.uri.toString() &&
              hitLine0 === tempRunTarget.line
            ) {
              vscode.debug.removeBreakpoints([tempRunTarget.bp]);
              tempRunTarget = null;
              postTempRunLine(null);
            }
          } catch {
            // Ignore errors
          }
        },
        onExit() {
          if (tempRunTarget) {
            vscode.debug.removeBreakpoints([tempRunTarget.bp]);
            tempRunTarget = null;
            postTempRunLine(null);
          }
        },
      };
    },
  });
  trackedTypes.add(sessionType);
  extContext.subscriptions.push(disp);
}

async function runUntilAtActiveEditorLine(line: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const session = await ensureDebugSession();
  if (!session) {
    vscode.window.showErrorMessage("Failed to start a debug session");
    return;
  }

  ensureStoppedTracker(session.type);

  const uri = editor.document.uri;
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(
    new vscode.Range(pos, pos),
    vscode.TextEditorRevealType.InCenter,
  );

  const location = new vscode.Location(uri, new vscode.Position(line, 0));
  const bp = new vscode.SourceBreakpoint(location, true);
  vscode.debug.addBreakpoints([bp]);

  tempRunTarget = { uri, line, bp };
  postTempRunLine(line);

  await vscode.commands.executeCommand("workbench.action.debug.continue");
}

export function deactivate() {}
