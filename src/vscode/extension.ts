import * as vscode from "vscode";
import type { Language } from "../control-flow/cfg";
import {
  type ColorList,
  deserializeColorList,
  getDarkColorList,
  getLightColorList,
} from "../control-flow/colors";
import type {
  ToggleBreakpoint, // NEW
  UpdateBreakpoints,
  UpdateCode,
  UpdateSettings,
} from "./messages.ts";
import { OverviewViewProvider } from "./overview-view";

/* Disable a specific oxlint check until https://github.com/oxc-project/oxc/issues/10106
   is resolved.
 */
/* oxlint-disable eslint-plugin-unicorn(require-post-message-target-origin) */

interface FunctionPickItem extends vscode.QuickPickItem {
  name: string;
  row: number;
  column: number;
}

// ADD-LANGUAGES-HERE
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
  if (!editor) {
    return null;
  }

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
        if (isThemeDark()) {
          return getDarkColorList();
        }
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
          // TODO: Add a user-visible error here.
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
      preserveFocus: false, // This ensures the editor gets focus
      preview: false, // Don't open in preview mode
      viewColumn: editor.viewColumn,
    });
    console.log("Focus!!!");
  }
}

function moveCursorAndReveal(offset: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  console.log("Moving!");
  const position = editor.document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);

  // Reveal the cursor position in different ways
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport, // Can be Default, InCenter, InCenterIfOutsideViewport, AtTop
  );
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  const provider = new OverviewViewProvider(
    context.extensionUri,
    isThemeDark(),
    {
      navigateTo: ({ offset, withControl, functionNamesAndLocations }) =>
        onNodeClick(offset, withControl, functionNamesAndLocations),

      // NEW: toggle breakpoint requested from the webview
      toggleBreakpoint: ({ line }: ToggleBreakpoint) => {
        toggleBreakpointAtActiveEditorLine(line);
      },
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OverviewViewProvider.viewType,
      provider,
    ),
  );

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    'Congratulations, your extension "function-graph-overview" is now active!',
  );

  function jumpToCursor(row: number, col: number): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    // In order to match the VS Code API
    // even though it doesnt exactly match the text editor's line numbers
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
          //Prepare QuickPick items with additional metadata (name, row, column) so we can
          //access the full function info later after user selection, instead of parsing strings.
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
            // Ok! now the magic happens — let's jump to the function call and mimic F12.
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

        console.log(
          `Cursor position changed: Line ${position.line + 1}, Column ${position.character + 1}`,
        );

        const { code, languageId, language } = getCurrentCode() ?? {};
        if (!code || !languageId || !language) {
          return;
        }
        provider.postMessage<UpdateCode>({
          tag: "updateCode",
          code,
          offset,
          language,
        });

        // NEW: keep breakpoint dots in sync when cursor moves or user clicks a node
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

  // NEW: toggle helper for the active editor
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
    // onDidChangeBreakpoints will fire and push updateBreakpoints; no need to post manually.
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

  // Seed on activation
  postBreakpointsForActiveEditor();
}

// This method is called when your extension is deactivated
export function deactivate() {}

//------------------------------------------------
