import { beforeAll, expect, test } from "bun:test";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { extractFunctionNamesAndLocation, removeDuplicateCalls } from "../control-flow/common-patterns.ts";
import { initParsers, iterFunctions } from "../file-parsing/vite.ts";

// Initialize parsers once before all tests
beforeAll(async () => {
  await initParsers();
});

function walkAllNodes(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walkAllNodes(child as SyntaxNode, visit);
  }
}

const functionCallCaptureQuery = `(call_expression) 
          function: (identifier) @call`;
// C Tests
test("C: simple_function_call", () => {
  const code = `void hello_world() {
    printf("Hello, World!\n");
}`;
  const funcIterator = iterFunctions(code, "C");
  const calls: { name: string; row: number; column: number }[] = [];
  for (const func of funcIterator) {
    walkAllNodes(func as SyntaxNode, (node) => {
      const result = extractFunctionNamesAndLocation(
        node,
        functionCallCaptureQuery,
        "call",
      );
      if (result) {
        calls.push(...result);
      }
    });
  }
  const callNames = removeDuplicateCalls(calls).map((call) => call.name);
  expect(callNames).toEqual(["printf"]);
});
