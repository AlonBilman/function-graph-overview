import { expect, test } from "vitest";
import type { Node as SyntaxNode } from "web-tree-sitter";
import {
  extractFunctionNamesAndLocation,
  removeDuplicateCalls,
} from "../control-flow/common-patterns.ts";
import { iterFunctions } from "../file-parsing/bun.ts";

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
test("C: simple_function_call1", () => {
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

test("C: simple_function_call2", () => {
  const code = `void main() {
    int x , y;
    x = y = 5;
    printf("Hello, World!\n");
    int z = add_numbers(x, y);
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
  expect(callNames).toEqual(["printf", "add_numbers"]);
});

test("C: simple_function_call3", () => {
  const code = `void main() {
    a();
    b();
    c();
    d();
    e();
    f();
    g();
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
  expect(callNames).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
});

test("C: function_inside_for_loop", () => {
  const code = `void main() {
    for(int i=0; i<10; i++) {
        if (i < 1) {
            bool condition = true; 
            hello_world();
        }
    }
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
  expect(callNames).toEqual(["hello_world"]);
});

test("C: function_inside_for_loop_advanced", () => {
  const code = `void main() {
    for(int i=0; i < add_numbers(5,5); i++) 
    {
        if (i < 1) {
            bool condition = true; 
            hello_world();
        }
    }
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
  expect(callNames).toEqual(["add_numbers", "hello_world"]);
});

test("C: function_inside_while_loop", () => {
  const code = `void main() {
    int x;
    scanf("%d", &x);
    while(true) 
    {
      if (is_odd(x))
      {
        printf("Odd\n");
      }
    }
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
  expect(callNames).toEqual(["scanf", "is_odd", "printf"]);
});

test("C: function_inside_while_loop_advanced", () => {
  const code = `void main() {
    int x;
    scanf("%d", &x);
    while((a() && b()) || c()) 
    {
      if (is_odd(x))
      {
        printf("%d Is Even\n", add_number(1,x));
      }
    }
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
  expect(callNames).toEqual([
    "scanf",
    "a",
    "b",
    "c",
    "is_odd",
    "printf",
    "add_number",
  ]);
});

test("C: function_inside_condition", () => {
  const code = `void main() {
    int x;

    if ((a() && b()) || c() == 10)
    {
      d();
      e();
    }
    else if(f() || g())
    {
      h();
    }
    printf("Thank you! %d %d %d", i(), j(), k());
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
  expect(callNames).toEqual([
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "printf",
    "i",
    "j",
    "k",
  ]);
});

test("C: function_calls_return", () => {
  const code = `void main() {
    int x;
    if (a())
    {
      return b() + c();
    }
    else
    {
      return d() || e();
    }
    printf("Thank you! %d %d", f(), g());
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
  expect(callNames).toEqual(["a", "b", "c", "d", "e", "printf", "f", "g"]);
});

test("C: function_calls_return2", () => {
  const code = `void main() {
    int x;
    if (a())
    {
      return b() && c();
    }
    return d() + e() - f() + g();
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
  expect(callNames).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
});
