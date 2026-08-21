// A tiny expression language for `overlays[].fun` — an equation in x, sampled over a domain.
//
// It lives in src/spec/ rather than src/engine/ because SPEC VALIDATION is its first consumer, and
// src/spec/ is a leaf layer that must not import from src/engine/. The module is pure and DOM-free,
// so nothing about it wants to be engine-side.
//
// Deliberately NOT `eval` / `new Function`: the engine bundles into a standalone HTML file
// (src/embed/bundle-standalone.ts), where either would be blocked by any Content-Security-Policy the
// host page sets. Rejecting unknown names at PARSE time is also what lets validation fail a typo'd
// expression at build time rather than drawing nothing in the browser.
//
// Precedence follows R, which is where the two reference languages differ from JavaScript: `^` is
// right-associative AND binds tighter than unary minus, so `-2^2` is -4 and `2^3^2` is 512.
//
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?              -- right-assoc; the `unary` RHS is what parses `2^-1`
//   atom   := number | ident '(' args ')' | ident | '(' expr ')'
//   args   := expr (',' expr)*

export type Expr =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { k: "call"; name: string; args: Expr[] };

/** Bare identifiers that are constants rather than author-supplied variables. */
export const EXPR_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

interface FnDef {
  /** Inclusive arity bounds. */
  min: number;
  max: number;
  /** Takes the evaluated arguments as an array — not variadic params — so optional arguments type
   *  cleanly under strict mode. */
  f: (a: number[]) => number;
}

/** Normal density, shared by `dnorm` and its Stata alias. R's argument order.
 *
 *  `sd <= 0` yields NaN, which engine/overlays.ts draws as a BREAK in the line — this module's
 *  convention for an unrepresentable value, and the same reason a blank overlay cell breaks a line
 *  rather than diving to zero. Load-bearing, not defensive: a NEGATIVE sd otherwise divides through
 *  by a negative normaliser and returns the correct density with its sign flipped (measured:
 *  `dnorm(0.5, 0, -1)` = -0.3520653267642995), so the renderer drew a smooth INVERTED density curve
 *  hanging below the axis. That is the worst possible failure for the documented use of this
 *  function — a `fun: "dnorm(...)"` overlay over a `histogram.normalize: density` chart — because an
 *  author sees a plausible published figure rather than an error. `sd = 0` already produced NaN via
 *  0/0; it is folded into the same check so the domain is stated once instead of relying on that. */
function normalDensity(a: number[]): number {
  const mu = a.length >= 2 ? a[1]! : 0;
  const sd = a.length >= 3 ? a[2]! : 1;
  if (!(sd > 0)) return NaN;
  const z = (a[0]! - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** R's `log(x, base)`. A base of 0, 1 or a negative number names no logarithm, and the same
 *  break-on-NaN convention applies. Base 0 is the case that needed the guard: `Math.log(x) /
 *  Math.log(0)` is `x / -Infinity` = **-0**, a FINITE value, so an undefined logarithm drew a flat
 *  line along zero instead of breaking. Base 1 gave Infinity and a negative base gave NaN — both
 *  already broke the line, and returning NaN leaves what is drawn unchanged for those two. */
function logWithBase(a: number[]): number {
  if (a.length === 1) return Math.log(a[0]!);
  const base = a[1]!;
  if (!(base > 0) || base === 1) return NaN;
  return Math.log(a[0]!) / Math.log(base);
}

/** The function table. R's spelling is canonical; a Stata spelling is added as an alias only where
 *  the two differ (`ln`, `ceil`, `normalden`). Anything not here is a parse error, so the set is
 *  closed and a spec cannot reach arbitrary code. */
const FUNCS: Record<string, FnDef> = {
  // R's log(x, base); one argument is the natural log, which is also Stata's `log`.
  log: { min: 1, max: 2, f: logWithBase },
  ln: { min: 1, max: 1, f: (a) => Math.log(a[0]!) },
  log10: { min: 1, max: 1, f: (a) => Math.log10(a[0]!) },
  log2: { min: 1, max: 1, f: (a) => Math.log2(a[0]!) },
  exp: { min: 1, max: 1, f: (a) => Math.exp(a[0]!) },
  sqrt: { min: 1, max: 1, f: (a) => Math.sqrt(a[0]!) },
  abs: { min: 1, max: 1, f: (a) => Math.abs(a[0]!) },
  sin: { min: 1, max: 1, f: (a) => Math.sin(a[0]!) },
  cos: { min: 1, max: 1, f: (a) => Math.cos(a[0]!) },
  tan: { min: 1, max: 1, f: (a) => Math.tan(a[0]!) },
  floor: { min: 1, max: 1, f: (a) => Math.floor(a[0]!) },
  ceiling: { min: 1, max: 1, f: (a) => Math.ceil(a[0]!) },
  ceil: { min: 1, max: 1, f: (a) => Math.ceil(a[0]!) },
  round: {
    min: 1,
    max: 2,
    f: (a) => {
      const p = 10 ** (a.length === 2 ? a[1]! : 0);
      return Math.round(a[0]! * p) / p;
    },
  },
  min: { min: 2, max: 2, f: (a) => Math.min(a[0]!, a[1]!) },
  max: { min: 2, max: 2, f: (a) => Math.max(a[0]!, a[1]!) },
  // So a density curve can go over a `histogram.normalize: density` chart.
  dnorm: { min: 1, max: 3, f: normalDensity },
  normalden: { min: 1, max: 3, f: normalDensity },
};

export const EXPR_FUNCTION_NAMES: string[] = Object.keys(FUNCS).sort();

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

/** Thrown internally and converted to `{ ok: false }` — never escapes this module. */
class ExprError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c } as Tok);
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^") {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`malformed number at position ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new ExprError(`unexpected character ${JSON.stringify(c)} at position ${i}`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private eat(): Tok {
    const t = this.toks[this.pos];
    if (!t) throw new ExprError("unexpected end of expression");
    this.pos++;
    return t;
  }

  private expect(t: "(" | ")" | ","): void {
    if (this.eat().t !== t) throw new ExprError(`expected ${JSON.stringify(t)}`);
  }

  parse(): Expr {
    if (this.toks.length === 0) throw new ExprError("empty expression");
    const e = this.expr();
    if (this.pos !== this.toks.length) throw new ExprError("unexpected trailing input");
    return e;
  }

  private expr(): Expr {
    let a = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "+" || t.v === "-")) {
        this.pos++;
        a = { k: "bin", op: t.v, a, b: this.term() };
      } else return a;
    }
  }

  private term(): Expr {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        this.pos++;
        a = { k: "bin", op: t.v, a, b: this.unary() };
      } else return a;
    }
  }

  private unary(): Expr {
    const t = this.peek();
    if (t?.t === "op" && t.v === "-") {
      this.pos++;
      return { k: "neg", a: this.unary() };
    }
    // A leading "+" is a no-op sign, accepted for symmetry with "-".
    if (t?.t === "op" && t.v === "+") {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.atom();
    const t = this.peek();
    if (t?.t === "op" && t.v === "^") {
      this.pos++;
      // RHS is `unary`, not `power`: makes ^ right-associative AND lets `2^-1` parse.
      return { k: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }

  private atom(): Expr {
    const t = this.eat();
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (t.t === "id") {
      if (this.peek()?.t !== "(") return { k: "var", name: t.v };
      this.expect("(");
      const def = FUNCS[t.v];
      if (!def) {
        throw new ExprError(
          `unknown function ${JSON.stringify(t.v)} — known functions: ${EXPR_FUNCTION_NAMES.join(", ")}`,
        );
      }
      const args: Expr[] = [this.expr()];
      while (this.peek()?.t === ",") {
        this.pos++;
        args.push(this.expr());
      }
      this.expect(")");
      if (args.length < def.min || args.length > def.max) {
        const want = def.min === def.max ? `${def.min}` : `${def.min}–${def.max}`;
        throw new ExprError(`${t.v} takes ${want} argument(s), got ${args.length}`);
      }
      return { k: "call", name: t.v, args };
    }
    throw new ExprError("expected a number, name, or '('");
  }
}

export function parseExpression(src: string): { ok: true; ast: Expr } | { ok: false; error: string } {
  try {
    return { ok: true, ast: new Parser(tokenize(src)).parse() };
  } catch (err) {
    return { ok: false, error: err instanceof ExprError ? err.message : String(err) };
  }
}

/** Distinct identifiers used as VARIABLES (not function names), sorted. Validation checks these
 *  against `{x} ∪ EXPR_CONSTANTS ∪ params`, so a typo'd coefficient name fails the build. */
export function exprVariables(ast: Expr): string[] {
  const out = new Set<string>();
  const walk = (e: Expr): void => {
    switch (e.k) {
      case "var":
        out.add(e.name);
        return;
      case "neg":
        walk(e.a);
        return;
      case "bin":
        walk(e.a);
        walk(e.b);
        return;
      case "call":
        e.args.forEach(walk);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return [...out].sort();
}

/** Evaluate at one point. An unbound variable yields NaN rather than throwing: a non-finite sample is
 *  a BREAK in the drawn polyline (see engine/overlays.ts), not an error, so `log(x)` over a domain
 *  crossing zero draws only the half that exists. */
export function evalExpression(ast: Expr, vars: Record<string, number>): number {
  switch (ast.k) {
    case "num":
      return ast.v;
    case "var": {
      const v = Object.prototype.hasOwnProperty.call(vars, ast.name)
        ? vars[ast.name]
        : EXPR_CONSTANTS[ast.name];
      return v == null ? NaN : v;
    }
    case "neg":
      return -evalExpression(ast.a, vars);
    case "bin": {
      const a = evalExpression(ast.a, vars);
      const b = evalExpression(ast.b, vars);
      switch (ast.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return a ** b;
      }
      return NaN;
    }
    case "call":
      return FUNCS[ast.name]!.f(ast.args.map((x) => evalExpression(x, vars)));
  }
}
