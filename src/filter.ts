import type { JobRecord } from "./db/repo.ts";
import { detectJobSite } from "./site.ts";
import { isUsJob } from "./location.ts";

export type ActiveMode = "active" | "any" | "false";

export type FieldKey =
  | "company"
  | "title"
  | "loc"
  | "wm"
  | "cat"
  | "src"
  | "status"
  | "note"
  | "site"
  | "sponsor";

export interface FilterCondition {
  /** Array of alternatives (OR). A condition matches if AT LEAST ONE alternative matches. */
  alternatives: string[];
}

export interface FilterClause {
  companies: FilterCondition[]; // each condition must match (AND)
  titles: FilterCondition[];
  locs: FilterCondition[];
  workModels: ("remote" | "hybrid" | "onsite")[];
  categories: FilterCondition[];
  sourceIds: FilterCondition[];
  statuses: string[];
  notes: FilterCondition[];
  sites: FilterCondition[];
  wantNew: boolean;
  wantUs?: boolean | null;
  freeWords: FilterCondition[];
}

export type FilterAstNode =
  | { type: "and"; children: FilterAstNode[] }
  | { type: "or"; children: FilterAstNode[] }
  | { type: "not"; child: FilterAstNode }
  | { type: "field"; field: FieldKey; alternatives: string[] }
  | { type: "freeText"; alternatives: string[] }
  | { type: "new"; wantNew: boolean }
  | { type: "active"; mode: "active" | "any" | "false" }
  | { type: "us"; wantUs: boolean }
  | { type: "alwaysTrue" };

export interface ParsedFilter {
  activeMode: ActiveMode | null; // null = not specified in this query
  clauses: FilterClause[];
  // Backwards compatibility properties (first clause):
  company: string | null;
  title: string | null;
  loc: string | null;
  workModel: "remote" | "hybrid" | "onsite" | null;
  category: string | null;
  sourceId: string | null;
  status: string | null;
  wantNew: boolean;
  note: string | null;
  site: string | null;
  freeText: string;
  // AST representation for full boolean expressions
  ast?: FilterAstNode | null;
}

function stripQuotes(str: string): string {
  const trimmed = str.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseValueAlternatives(raw: string): string[] {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    const unquoted = trimmed.slice(1, -1).trim().toLowerCase();
    return unquoted.length > 0 ? [unquoted] : [];
  }
  // Unquoted: split on comma or pipe for within-token OR (e.g. title:xyz,abc or loc:remote|sf)
  return trimmed
    .split(/[,|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeField(raw: string): FieldKey | "new" | "active" | "is" | "country" | null {
  const f = raw.toLowerCase();
  if (f === "company" || f === "co") return "company";
  if (f === "title" || f === "role") return "title";
  if (f === "loc" || f === "location" || f === "locations") return "loc";
  if (f === "country" || f === "nation") return "country";
  if (f === "wm" || f === "workmodel") return "wm";
  if (f === "cat" || f === "category") return "cat";
  if (f === "src" || f === "source" || f === "sourceid") return "src";
  if (f === "status") return "status";
  if (f === "note" || f === "notes") return "note";
  if (f === "site") return "site";
  if (f === "sponsor" || f === "sponsorship" || f === "visa") return "sponsor";
  if (f === "new") return "new";
  if (f === "active") return "active";
  if (f === "is") return "is";
  return null;
}

interface Token {
  type: "LPAREN" | "RPAREN" | "AND" | "OR" | "NOT" | "FIELD_LPAREN" | "TERM";
  field?: FieldKey | "new" | "active" | "is" | "country" | null;
  value?: string;
  isExact?: boolean;
  isNegated?: boolean;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    // 1. Skip whitespace
    if (/\s/.test(input[i]!)) {
      i++;
      continue;
    }

    const char = input[i]!;

    // 2. Parentheses
    if (char === "(") {
      tokens.push({ type: "LPAREN" });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN" });
      i++;
      continue;
    }

    // 3. Operators &&, ||, |
    if (char === "&" && input[i + 1] === "&") {
      tokens.push({ type: "AND" });
      i += 2;
      continue;
    }
    if (char === "|" && input[i + 1] === "|") {
      tokens.push({ type: "OR" });
      i += 2;
      continue;
    }
    if (char === "|") {
      tokens.push({ type: "OR" });
      i++;
      continue;
    }

    // 4. Negation !
    if (char === "!") {
      tokens.push({ type: "NOT" });
      i++;
      continue;
    }

    // 5. Leading minus - at the start of a token (preceded by whitespace, start, or paren)
    if (char === "-") {
      if (i + 1 < len && !/\s/.test(input[i + 1]!)) {
        tokens.push({ type: "NOT" });
        i++;
        continue;
      } else {
        // Standalone or trailing -
        i++;
        continue;
      }
    }

    // 6. Standalone Quoted String: "..." or '...'
    if (char === '"' || char === "'") {
      const quote = char;
      i++; // skip opening quote
      let str = "";
      while (i < len && input[i] !== quote) {
        str += input[i];
        i++;
      }
      if (i < len && input[i] === quote) {
        i++; // skip closing quote
      }
      tokens.push({
        type: "TERM",
        field: null,
        value: str,
        isExact: true,
        isNegated: false,
      });
      continue;
    }

    // 7. Check for field prefix: e.g. /^[a-zA-Z]+:/
    const rest = input.slice(i);
    const fieldMatch = rest.match(/^([a-zA-Z]+):/);

    if (fieldMatch) {
      const rawField = fieldMatch[1]!;
      const normField = normalizeField(rawField);

      if (normField !== null) {
        i += fieldMatch[0].length; // skip past "field:"

        if (normField !== "new") {
          const savedI = i;
          while (i < len && /\s/.test(input[i]!)) {
            i++;
          }
          if (
            i >= len ||
            input[i] === ")" ||
            input.slice(i).match(/^(and|or|&&|\|\|)\b/i)
          ) {
            i = savedI;
          }
        }

        // Check for field:(
        if (i < len && input[i] === "(") {
          tokens.push({ type: "FIELD_LPAREN", field: normField as FieldKey });
          i++; // skip "("
          continue;
        }

        // Check for field:!( or field:-(
        if (
          i + 1 < len &&
          (input[i] === "!" || input[i] === "-") &&
          input[i + 1] === "("
        ) {
          tokens.push({ type: "NOT" });
          tokens.push({ type: "FIELD_LPAREN", field: normField as FieldKey });
          i += 2;
          continue;
        }

        // Check for negation after colon: field:! or field:- or field:NOT
        let isNegated = false;
        if (i < len && (input[i] === "!" || input[i] === "-")) {
          isNegated = true;
          i++;
        } else {
          const notMatch = input.slice(i).match(/^not\s+/i);
          if (notMatch) {
            isNegated = true;
            i += notMatch[0].length;
          }
        }

        if (isNegated) {
          tokens.push({ type: "NOT" });
        }

        // Check if there's field:!(
        if (i < len && input[i] === "(") {
          tokens.push({ type: "FIELD_LPAREN", field: normField as FieldKey });
          i++;
          continue;
        }

        // Check for quoted value: field:"..." or field:'...'
        if (i < len && (input[i] === '"' || input[i] === "'")) {
          const quote = input[i]!;
          i++; // skip opening quote
          let str = "";
          while (i < len && input[i] !== quote) {
            str += input[i];
            i++;
          }
          if (i < len && input[i] === quote) {
            i++; // skip closing quote
          }
          tokens.push({
            type: "TERM",
            field: normField,
            value: str,
            isExact: true,
            isNegated: false,
          });
          continue;
        }

        // Read unquoted value until whitespace, ')', or '('
        let val = "";
        while (
          i < len &&
          !/\s/.test(input[i]!) &&
          input[i] !== ")" &&
          input[i] !== "("
        ) {
          if (
            (input[i] === "|" && input[i + 1] === "|") ||
            (input[i] === "&" && input[i + 1] === "&")
          ) {
            break;
          }
          val += input[i];
          i++;
        }

        tokens.push({
          type: "TERM",
          field: normField,
          value: val,
          isExact: false,
          isNegated: false,
        });
        continue;
      }
    }

    // 8. Regular unquoted word/token
    let word = "";
    while (
      i < len &&
      !/\s/.test(input[i]!) &&
      input[i] !== ")" &&
      input[i] !== "("
    ) {
      if (
        (input[i] === "|" && input[i + 1] === "|") ||
        (input[i] === "&" && input[i + 1] === "&") ||
        input[i] === "|"
      ) {
        break;
      }
      word += input[i];
      i++;
    }

    const lowerWord = word.toLowerCase();
    if (lowerWord === "and") {
      tokens.push({ type: "AND" });
    } else if (lowerWord === "or") {
      tokens.push({ type: "OR" });
    } else if (lowerWord === "not") {
      tokens.push({ type: "NOT" });
    } else if (word.length > 0) {
      tokens.push({
        type: "TERM",
        field: null,
        value: word,
        isExact: false,
        isNegated: false,
      });
    }
  }

  return tokens;
}

function applyFieldToAst(node: FilterAstNode, field: FieldKey): FilterAstNode {
  switch (node.type) {
    case "freeText":
      return { type: "field", field, alternatives: node.alternatives };
    case "and":
      return {
        type: "and",
        children: node.children.map((c) => applyFieldToAst(c, field)),
      };
    case "or":
      return {
        type: "or",
        children: node.children.map((c) => applyFieldToAst(c, field)),
      };
    case "not":
      return {
        type: "not",
        child: applyFieldToAst(node.child, field),
      };
    default:
      return node;
  }
}

class QueryParser {
  private tokens: Token[];
  private pos = 0;
  public activeMode: ActiveMode | null = null;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token | undefined {
    return this.tokens[this.pos++];
  }

  public parse(): FilterAstNode | null {
    // Skip any leading OR or AND
    while (this.peek()?.type === "OR" || this.peek()?.type === "AND") {
      this.consume();
    }
    return this.parseOr();
  }

  private parseOr(): FilterAstNode | null {
    let left = this.parseAnd();
    if (!left) return null;

    while (this.peek()?.type === "OR") {
      this.consume(); // skip OR
      const right = this.parseAnd();
      if (!right) {
        // Trailing OR
        break;
      }
      if (left.type === "or") {
        left.children.push(right);
      } else {
        left = { type: "or", children: [left, right] };
      }
    }
    return left;
  }

  private parseAnd(): FilterAstNode | null {
    let left = this.parseNot();
    if (!left) return null;

    while (true) {
      const next = this.peek();
      if (!next) break;

      // Stop if next is RPAREN or OR
      if (next.type === "RPAREN" || next.type === "OR") {
        break;
      }

      if (next.type === "AND") {
        this.consume(); // skip AND
        const right = this.parseNot();
        if (!right) {
          // Trailing AND
          break;
        }
        if (left.type === "and") {
          left.children.push(right);
        } else {
          left = { type: "and", children: [left, right] };
        }
      } else {
        // Implicit AND (adjacent terms)
        const right = this.parseNot();
        if (!right) {
          break;
        }
        if (left.type === "and") {
          left.children.push(right);
        } else {
          left = { type: "and", children: [left, right] };
        }
      }
    }

    return left;
  }

  private parseNot(): FilterAstNode | null {
    if (this.peek()?.type === "NOT") {
      this.consume(); // skip NOT
      const child = this.parseNot();
      if (!child) {
        // Trailing NOT
        return null;
      }
      return { type: "not", child };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FilterAstNode | null {
    const token = this.peek();
    if (!token) return null;

    if (token.type === "LPAREN") {
      this.consume(); // skip (
      const expr = this.parseOr();
      if (this.peek()?.type === "RPAREN") {
        this.consume(); // skip )
      }
      return expr;
    }

    if (token.type === "FIELD_LPAREN") {
      this.consume(); // skip FIELD_LPAREN
      const field = token.field as FieldKey;
      const expr = this.parseOr();
      if (this.peek()?.type === "RPAREN") {
        this.consume(); // skip )
      }
      if (!expr) return null;
      return applyFieldToAst(expr, field);
    }

    if (token.type === "TERM") {
      this.consume(); // skip TERM
      return this.termToAst(token);
    }

    // Unexpected token (e.g. RPAREN at start), consume and return null
    this.consume();
    return null;
  }

  private termToAst(token: Token): FilterAstNode | null {
    let node: FilterAstNode | null = null;

    if (token.field === "new") {
      const val = (token.value ?? "").toLowerCase();
      const wantNew = !(val === "false" || val === "0" || val === "no");
      node = { type: "new", wantNew };
    } else if (token.field === "active") {
      const val = (token.value ?? "").toLowerCase();
      if (val === "any") {
        this.activeMode = "any";
        node = { type: "active", mode: "any" };
      } else if (val === "false") {
        this.activeMode = "false";
        node = { type: "active", mode: "false" };
      } else {
        this.activeMode = "active";
        node = { type: "active", mode: "active" };
      }
    } else if (token.field === "is") {
      const val = (token.value ?? "").toLowerCase();
      if (val === "new") {
        node = { type: "new", wantNew: true };
      } else if (val === "remote" || val === "hybrid" || val === "onsite") {
        node = { type: "field", field: "wm", alternatives: [val] };
      } else if (val === "active") {
        this.activeMode = "active";
        node = { type: "active", mode: "active" };
      } else if (val === "tracked") {
        node = { type: "field", field: "status", alternatives: ["tracked"] };
      } else if (val === "untracked") {
        node = { type: "field", field: "status", alternatives: ["untracked"] };
      } else if (val === "us" || val === "usa" || val === "domestic") {
        node = { type: "us", wantUs: true };
      } else if (val === "non-us" || val === "nonus" || val === "intl" || val === "international" || val === "foreign") {
        node = { type: "us", wantUs: false };
      } else {
        node = { type: "freeText", alternatives: [val] };
      }
    } else if (token.field === "country") {
      const val = (token.value ?? "").toLowerCase().trim();
      if (val === "us" || val === "usa" || val === "united states") {
        node = { type: "us", wantUs: true };
      } else if (val === "non-us" || val === "nonus" || val === "intl" || val === "international") {
        node = { type: "us", wantUs: false };
      } else {
        node = { type: "field", field: "loc", alternatives: parseValueAlternatives(token.value ?? "") };
      }
    } else if (token.field === "loc") {
      const val = (token.value ?? "").toLowerCase().trim();
      if (val === "us" || val === "usa" || val === "united states") {
        node = { type: "us", wantUs: true };
      } else if (val === "non-us" || val === "nonus") {
        node = { type: "us", wantUs: false };
      } else {
        const alts = token.isExact
          ? [(token.value ?? "").trim().toLowerCase()].filter(Boolean)
          : parseValueAlternatives(token.value ?? "");
        if (alts.length === 0) return null;
        node = { type: "field", field: "loc", alternatives: alts };
      }
    } else if (token.field) {
      const alts = token.isExact
        ? [(token.value ?? "").trim().toLowerCase()].filter(Boolean)
        : parseValueAlternatives(token.value ?? "");
      if (alts.length === 0) return null;
      node = { type: "field", field: token.field, alternatives: alts };
    } else {
      const alts = token.isExact
        ? [(token.value ?? "").trim().toLowerCase()].filter(Boolean)
        : parseValueAlternatives(token.value ?? "");
      if (alts.length === 0) return null;
      node = { type: "freeText", alternatives: alts };
    }

    if (node && token.isNegated) {
      node = { type: "not", child: node };
    }
    return node;
  }
}

function astToClauses(ast: FilterAstNode | null): FilterClause[] {
  if (!ast) return [];
  const subnodes = ast.type === "or" ? ast.children : [ast];
  return subnodes.map((sub) => {
    const clause: FilterClause = {
      companies: [],
      titles: [],
      locs: [],
      workModels: [],
      categories: [],
      sourceIds: [],
      statuses: [],
      notes: [],
      sites: [],
      wantNew: false,
      wantUs: null,
      freeWords: [],
    };
    populateClauseFromAst(sub, clause);
    return clause;
  });
}

function populateClauseFromAst(node: FilterAstNode, clause: FilterClause) {
  if (node.type === "and") {
    for (const child of node.children) {
      populateClauseFromAst(child, clause);
    }
    return;
  }
  if (node.type === "new") {
    if (node.wantNew) clause.wantNew = true;
    return;
  }
  if (node.type === "us") {
    clause.wantUs = node.wantUs;
    return;
  }
  if (node.type === "freeText") {
    clause.freeWords.push({ alternatives: node.alternatives });
    return;
  }
  if (node.type === "field") {
    switch (node.field) {
      case "company":
        clause.companies.push({ alternatives: node.alternatives });
        break;
      case "title":
        clause.titles.push({ alternatives: node.alternatives });
        break;
      case "loc":
        clause.locs.push({ alternatives: node.alternatives });
        break;
      case "wm":
        for (const alt of node.alternatives) {
          if (alt === "remote" || alt === "hybrid" || alt === "onsite") {
            clause.workModels.push(alt);
          }
        }
        break;
      case "cat":
        clause.categories.push({ alternatives: node.alternatives });
        break;
      case "src":
        clause.sourceIds.push({ alternatives: node.alternatives });
        break;
      case "status":
        clause.statuses.push(...node.alternatives);
        break;
      case "note":
        clause.notes.push({ alternatives: node.alternatives });
        break;
      case "site":
        clause.sites.push({ alternatives: node.alternatives });
        break;
    }
  }
}

export function evaluateAst(
  node: FilterAstNode,
  job: JobRecord,
  isNew: (j: JobRecord) => boolean,
): boolean {
  switch (node.type) {
    case "alwaysTrue":
      return true;

    case "and":
      return node.children.every((child) => evaluateAst(child, job, isNew));

    case "or":
      return node.children.some((child) => evaluateAst(child, job, isNew));

    case "not":
      return !evaluateAst(node.child, job, isNew);

    case "new":
      return isNew(job) === node.wantNew;

    case "us":
      return node.wantUs ? isUsJob(job) : !isUsJob(job);

    case "active":
      if (node.mode === "any") return true;
      if (node.mode === "false") return job.active === false;
      return job.active !== false;

    case "freeText": {
      const haystack = `${job.company} ${job.title} ${job.locations.join(" ")} ${job.notes ?? ""} ${detectJobSite(job.url).label}`.toLowerCase();
      return node.alternatives.some((alt) => haystack.includes(alt));
    }

    case "field": {
      switch (node.field) {
        case "company": {
          const comp = job.company.toLowerCase();
          return node.alternatives.some((alt) => comp.includes(alt));
        }
        case "title": {
          const title = job.title.toLowerCase();
          return node.alternatives.some((alt) => title.includes(alt));
        }
        case "loc": {
          return job.locations.some((loc) => {
            const l = loc.toLowerCase();
            return node.alternatives.some((alt) => l.includes(alt));
          });
        }
        case "wm": {
          if (!job.workModel) return false;
          return node.alternatives.some((alt) => job.workModel === alt);
        }
        case "cat": {
          const cat = String((job.extra as Record<string, unknown>)?.category ?? "").toLowerCase();
          return node.alternatives.some((alt) => cat === alt || cat.includes(alt));
        }
        case "src": {
          const src = job.sourceId.toLowerCase();
          return node.alternatives.some((alt) => src.includes(alt));
        }
        case "status": {
          const jobStatus = job.status?.toLowerCase() ?? "";
          return node.alternatives.some((alt) => {
            if (alt === "none" || alt === "untracked" || alt === "null") {
              return !job.status;
            }
            if (alt === "any" || alt === "tracked") {
              return !!job.status;
            }
            return jobStatus === alt;
          });
        }
        case "note": {
          const notes = (job.notes ?? "").toLowerCase();
          return node.alternatives.some((alt) => notes.includes(alt));
        }
        case "site": {
          const site = detectJobSite(job.url).label.toLowerCase();
          return node.alternatives.some((alt) => site.includes(alt));
        }
        case "sponsor": {
          const extra = (job.extra as Record<string, unknown>) ?? {};
          const sp = `${String(extra.sponsorship ?? "")} ${String(extra.visa ?? "")}`.toLowerCase();
          return node.alternatives.some((alt) => sp.includes(alt));
        }
      }
    }
  }
}

function clauseMatches(
  job: JobRecord,
  clause: FilterClause,
  isNew: (j: JobRecord) => boolean,
): boolean {
  for (const cond of clause.companies) {
    if (cond.alternatives.length === 0) continue;
    const company = job.company.toLowerCase();
    if (!cond.alternatives.some((alt) => company.includes(alt))) {
      return false;
    }
  }

  for (const cond of clause.titles) {
    if (cond.alternatives.length === 0) continue;
    const title = job.title.toLowerCase();
    if (!cond.alternatives.some((alt) => title.includes(alt))) {
      return false;
    }
  }

  for (const cond of clause.locs) {
    if (cond.alternatives.length === 0) continue;
    const matched = job.locations.some((loc) => {
      const l = loc.toLowerCase();
      return cond.alternatives.some((alt) => l.includes(alt));
    });
    if (!matched) return false;
  }

  if (clause.workModels.length > 0) {
    if (!job.workModel || !clause.workModels.includes(job.workModel)) {
      return false;
    }
  }

  for (const cond of clause.categories) {
    if (cond.alternatives.length === 0) continue;
    const cat = String((job.extra as Record<string, unknown>)?.category ?? "").toLowerCase();
    if (!cond.alternatives.some((alt) => cat === alt || cat.includes(alt))) {
      return false;
    }
  }

  for (const cond of clause.sourceIds) {
    if (cond.alternatives.length === 0) continue;
    const src = job.sourceId.toLowerCase();
    if (!cond.alternatives.some((alt) => src.includes(alt))) {
      return false;
    }
  }

  if (clause.statuses.length > 0) {
    const jobStatus = job.status?.toLowerCase() ?? "";
    if (!clause.statuses.some((s) => jobStatus === s)) {
      return false;
    }
  }

  if (clause.wantNew && !isNew(job)) {
    return false;
  }

  if (clause.wantUs !== undefined && clause.wantUs !== null) {
    const isUs = isUsJob(job);
    if (clause.wantUs ? !isUs : isUs) {
      return false;
    }
  }

  for (const cond of clause.notes) {
    if (cond.alternatives.length === 0) continue;
    const notes = (job.notes ?? "").toLowerCase();
    if (!cond.alternatives.some((alt) => notes.includes(alt))) {
      return false;
    }
  }

  for (const cond of clause.sites) {
    if (cond.alternatives.length === 0) continue;
    const site = detectJobSite(job.url).label.toLowerCase();
    if (!cond.alternatives.some((alt) => site.includes(alt))) {
      return false;
    }
  }

  if (clause.freeWords.length > 0) {
    const haystack = `${job.company} ${job.title} ${job.locations.join(" ")} ${job.notes ?? ""} ${detectJobSite(job.url).label}`.toLowerCase();
    for (const cond of clause.freeWords) {
      if (cond.alternatives.length === 0) continue;
      if (!cond.alternatives.some((alt) => haystack.includes(alt))) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Parses the Browse filter query. Supports:
 * - Boolean AND/OR/NOT operators: `AND`, `and`, `&&`, `OR`, `or`, `||`, `|`, `NOT`, `not`, `!`, `-`
 * - Parentheses grouping: `(company:google OR company:meta) AND title:swe`
 * - Field-scoped parentheses: `title:(engineer OR developer)`, `title:(swe AND NOT senior)`
 * - Field negation: `-company:google`, `!company:google`, `NOT company:google`, `company:!google`, `company:-google`
 * - Within-token OR alternatives separated by comma or pipe: `title:xyz,abc`, `wm:remote,hybrid`
 * - Quoted strings for exact phrases: `title:"software engineer"`, `"New York, NY"`, `company:"Acme, Inc."`
 * - Implicit AND between adjacent terms: `company:google title:swe -loc:nyc`
 */
export function parseFilterQuery(input: string): ParsedFilter {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      activeMode: null,
      clauses: [],
      company: null,
      title: null,
      loc: null,
      workModel: null,
      category: null,
      sourceId: null,
      status: null,
      wantNew: false,
      note: null,
      site: null,
      freeText: "",
      ast: null,
    };
  }

  const tokens = tokenize(trimmed);
  const parser = new QueryParser(tokens);
  const ast = parser.parse();

  const activeMode = parser.activeMode;
  const clauses = astToClauses(ast);
  const first = clauses[0];

  return {
    activeMode,
    clauses,
    company: first?.companies[0]?.alternatives[0] ?? null,
    title: first?.titles[0]?.alternatives[0] ?? null,
    loc: first?.locs[0]?.alternatives[0] ?? null,
    workModel: first?.workModels[0] ?? null,
    category: first?.categories[0]?.alternatives[0] ?? null,
    sourceId: first?.sourceIds[0]?.alternatives[0] ?? null,
    status: first?.statuses[0] ?? null,
    wantNew: first?.wantNew ?? false,
    note: first?.notes[0]?.alternatives[0] ?? null,
    site: first?.sites[0]?.alternatives[0] ?? null,
    freeText: first?.freeWords.map((w) => w.alternatives.join(" ")).join(" ") ?? "",
    ast,
  };
}

/**
 * Applies the filter in-memory using the parsed query AST.
 * If no filter criteria are provided, all jobs match.
 */
export function applyFilter(
  jobs: JobRecord[],
  parsed: ParsedFilter,
  isNew: (job: JobRecord) => boolean,
): JobRecord[] {
  if (!parsed.ast) {
    if (parsed.clauses && parsed.clauses.length > 0) {
      return jobs.filter((job) =>
        parsed.clauses.some((clause) => clauseMatches(job, clause, isNew)),
      );
    }
    return jobs;
  }
  return jobs.filter((job) => evaluateAst(parsed.ast!, job, isNew));
}
