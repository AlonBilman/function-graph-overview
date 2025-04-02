import { cLanguageDefinition } from "./cfg-c";
import { cppLanguageDefinition } from "./cfg-cpp";
import type { BuilderOptions, CFGBuilder } from "./cfg-defs";
import { goLanguageDefinition } from "./cfg-go";
import { pythonLanguageDefinition } from "./cfg-python";
import {
  tsxLanguageDefinition,
  typeScriptLanguageDefinition,
} from "./cfg-typescript.ts";

// ADD-LANGUAGES-HERE
/**
 * The languages we support
 */
export const supportedLanguages = [
  "C",
  "Go",
  "Python",
  "C++",
  "TypeScript",
  "TSX",
] as const;
export type Language = (typeof supportedLanguages)[number];
export function isValidLanguage(language: string): language is Language {
  return (supportedLanguages as readonly string[]).includes(language);
}

export type LanguageDefinition = {
  /** Load path for the tree-sitter language WASM file */
  wasmPath: string;
  /** Language CFGBuilder factory */
  createCFGBuilder: (options: BuilderOptions) => CFGBuilder;
  /** All AST nodes types representing functions */
  functionNodeTypes: string[];
};

export const languageDefinitions: Record<Language, LanguageDefinition> = {
  C: cLanguageDefinition,
  Go: goLanguageDefinition,
  Python: pythonLanguageDefinition,
  "C++": cppLanguageDefinition,
  TypeScript: typeScriptLanguageDefinition,
  TSX: tsxLanguageDefinition,
};

/**
 * Returns a CFG builder for the given language
 * @param language The language to build for
 * @param options Builder options
 */
export function newCFGBuilder(
  language: Language,
  options: BuilderOptions,
): CFGBuilder {
  return languageDefinitions[language].createCFGBuilder(options);
}
