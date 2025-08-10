/**
 * Defines the message types VSCode uses to communicate with the WebView.
 */
import type { Language } from "../control-flow/cfg.ts";
import type { ColorList } from "../control-flow/colors.ts";

export type NavigateTo = {
  tag: "navigateTo";
  offset: number;
  withControl: boolean;
  functionNamesAndLocations?: { name: string; row: number; column: number }[];
};

// NEW: Webview -> VS Code
export type ToggleBreakpoint = {
  tag: "toggleBreakpoint";
  line: number; // 0-based line number in the active editor
};

// Already used: VSCode -> Webview
export type UpdateCode = {
  tag: "updateCode";
  offset: number;
  language: Language;
  code: string;
};

export type UpdateSettings = {
  tag: "updateSettings";
  simplify: boolean;
  flatSwitch: boolean;
  highlightCurrentNode: boolean;
  colorList: ColorList;
};

export type MessageToWebview =
  | UpdateCode
  | UpdateSettings;
export type MessageToVscode =
  | NavigateTo
  | ToggleBreakpoint; // NEW

// Ensure UpdateBreakpoints is included in MessageToWebview (you already use it)
export type UpdateBreakpoints = {
  tag: "updateBreakpoints";
  lines: number[];
};

type Message = MessageToVscode | MessageToWebview;

// Create a type that extracts the tag literal type from the Message union
type MessageTagOf<Msg extends Message> = Msg["tag"];
// Create a type that maps a tag to its corresponding message type
type MessageMapOf<Msg extends Message> = {
  [T in MessageTagOf<Msg>]: Extract<Msg, { tag: T }>;
};
// Finally, create the type for the message handlers object
export type MessageHandlersOf<Msg extends Message> = {
  [T in MessageTagOf<Msg>]: (message: MessageMapOf<Msg>[T]) => void;
};

/**
 * Handles messages in a type-safe manner.
 */
export class MessageHandler<Msg extends Message> {
  constructor(private messageHandlers: MessageHandlersOf<Msg>) {}

  public handleMessage<T extends MessageTagOf<Msg>>(
    message: MessageMapOf<Msg>[T],
  ) {
    const handler = this.messageHandlers[message.tag];
    handler(message);
  }
}
