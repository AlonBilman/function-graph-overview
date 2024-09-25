import Parser from "web-tree-sitter";
import { type BasicBlock, BlockHandler } from "./cfg-defs.ts";
import { evolve } from "./evolve.ts";

const defaultQueryOptions: Parser.QueryOptions = { maxStartDepth: 0 };

function matchQuery(
  syntax: Parser.SyntaxNode,
  queryString: string,
  options?: Parser.QueryOptions,
): Parser.QueryMatch {
  const language = syntax.tree.getLanguage();
  const query = language.query(queryString);
  options = evolve(defaultQueryOptions, options ?? {});
  const matches = query.matches(syntax, options);
  if (matches.length === 0) {
    throw new Error(`No match found for query.`);
  }
  return matches[0];
}

export function matchExistsIn(
  syntax: Parser.SyntaxNode,
  queryString: string,
): boolean {
  const language = syntax.tree.getLanguage();
  const query = language.query(queryString);
  const matches = query.matches(syntax);
  return matches.length > 0;
}

function getSyntax(
  match: Parser.QueryMatch,
  name: string,
): Parser.SyntaxNode | undefined {
  return getSyntaxMany(match, name)[0];
}

function getLastSyntax(
  match: Parser.QueryMatch,
  name: string,
): Parser.SyntaxNode | undefined {
  const many = getSyntaxMany(match, name);
  return many[many.length - 1];
}

function requireSyntax(
  match: Parser.QueryMatch,
  name: string,
): Parser.SyntaxNode {
  const syntax = getSyntax(match, name);
  if (!syntax) {
    throw new Error(`Failed getting syntax for ${name}`);
  }
  return syntax;
}

function getSyntaxMany(
  match: Parser.QueryMatch,
  name: string,
): Parser.SyntaxNode[] {
  return match.captures
    .filter((capture) => capture.name === name)
    .map((capture) => capture.node);
}

function getSyntaxTuples(
  match: Parser.QueryMatch,
  ...names: string[]
): { [key in (typeof names)[number]]: Parser.SyntaxNode }[] {
  const result: { [key in (typeof names)[number]]: Parser.SyntaxNode[] } = {};

  let length: number | null = null;
  for (const name of names) {
    result[name] = getSyntaxMany(match, name);
    if (length === null) {
      length = result[name].length;
    } else if (length !== result[name].length) {
      throw new Error("Count mismatch!");
    }
  }

  if (length === null) {
    return [];
  }

  const tuples: { [key in (typeof names)[number]]: Parser.SyntaxNode }[] = [];

  for (let i = 0; i < length; ++i) {
    const tuple: { [key in (typeof names)[number]]: Parser.SyntaxNode } = {};
    for (const name in names) {
      tuple[name] = result[name][i];
      tuples.push(tuple);
    }
  }

  return tuples;
}

export class BlockMatcher {
  private blockHandler: BlockHandler = new BlockHandler();
  private processBlock: (syntax: Parser.SyntaxNode | null) => BasicBlock;
  public update = this.blockHandler.update.bind(this.blockHandler);

  constructor(processBlock: BlockMatcher["processBlock"]) {
    this.processBlock = processBlock;
  }

  public match(
    syntax: Parser.SyntaxNode,
    queryString: string,
    options?: Parser.QueryOptions,
  ): Match {
    const match = matchQuery(syntax, queryString, options);
    return new Match(match, this.blockHandler, this.processBlock);
  }

  public tryMatch(
    syntax: Parser.SyntaxNode,
    queryString: string,
  ): Match | null {
    try {
      return this.match(syntax, queryString);
    } catch {
      return null;
    }
  }

  public get state() {
    return this.blockHandler;
  }
}

export class Match {
  private match: Parser.QueryMatch;
  private blockHandler: BlockHandler;
  private processBlock: BlockMatcher["processBlock"];
  constructor(
    match: Parser.QueryMatch,
    blockHandler: BlockHandler,
    processBlock: BlockMatcher["processBlock"],
  ) {
    this.match = match;
    this.blockHandler = blockHandler;
    this.processBlock = processBlock;
  }

  public getSyntax(name: string): ReturnType<typeof getSyntax> {
    return getSyntax(this.match, name);
  }

  public getLastSyntax(name: string): ReturnType<typeof getLastSyntax> {
    return getLastSyntax(this.match, name);
  }

  public requireSyntax(name: string): ReturnType<typeof requireSyntax> {
    return requireSyntax(this.match, name);
  }

  public getSyntaxMany(name: string): ReturnType<typeof getSyntaxMany> {
    return getSyntaxMany(this.match, name);
  }
  public getBlock(syntax: Parser.SyntaxNode): BasicBlock;
  public getBlock(
    syntax: Parser.SyntaxNode | null | undefined,
  ): BasicBlock | null;
  public getBlock(
    syntax: Parser.SyntaxNode | null | undefined,
  ): BasicBlock | null {
    return syntax ? this.blockHandler.update(this.processBlock(syntax)) : null;
  }

  public getManyBlocks(syntaxMany: Parser.SyntaxNode[]): BasicBlock[] {
    return syntaxMany.map((syntax) => this.getBlock(syntax) as BasicBlock);
  }
}
