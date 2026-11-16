// Meaning-preserving rewrites of expression trees.
//
// Every rule is an algebraic identity of real arithmetic (commutativity,
// associativity, distributivity, a − b = a + (−b), x·x·x = x³ = pow(x, 3), …),
// so the TRUE value of the program never changes — only the order and kind of
// the rounded operations does. That is exactly what changes the floating-point
// result. The UI additionally checks that the exact result really stayed the same.

import { parseProgram } from './parser.js';
import { Fraction } from './rational.js';

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

export function children(n) {
  switch (n.type) {
    case 'bin': return [n.left, n.right];
    case 'neg': return [n.arg];
    case 'pow': return [n.base];
    case 'call': return n.args;
    default: return [];
  }
}

function withChildren(n, ch) {
  switch (n.type) {
    case 'bin': return { ...n, left: ch[0], right: ch[1] };
    case 'neg': return { ...n, arg: ch[0] };
    case 'pow': return { ...n, base: ch[0] };
    case 'call': return { ...n, args: ch };
    default: return n;
  }
}

export function getAt(root, path) {
  let n = root;
  for (const i of path) n = children(n)[i];
  return n;
}

export function setAt(root, path, node) {
  if (!path.length) return node;
  const ch = children(root).slice();
  ch[path[0]] = setAt(ch[path[0]], path.slice(1), node);
  return withChildren(root, ch);
}

/** All nodes with their paths, pre-order. */
export function walk(root, path = [], out = []) {
  out.push({ node: root, path });
  children(root).forEach((c, i) => walk(c, [...path, i], out));
  return out;
}

const numValue = (n) => (n.value?.kind === 'finite' ? n.value.r : null);

/** Structural equality (literals compare by exact value). */
export function same(a, b) {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'num': {
      const x = numValue(a);
      const y = numValue(b);
      return x && y ? x.equals(y) : a.text === b.text;
    }
    case 'var': return a.name === b.name;
    case 'bin': return a.op === b.op && same(a.left, b.left) && same(a.right, b.right);
    case 'neg': return same(a.arg, b.arg);
    case 'pow': return a.n === b.n && same(a.base, b.base);
    case 'call': return a.name === b.name && a.args.length === b.args.length && a.args.every((x, i) => same(x, b.args[i]));
    default: return false;
  }
}

// Constructors (no source positions)
const bin = (op, left, right) => ({ type: 'bin', op, left, right });
const neg = (arg) => ({ type: 'neg', arg });
const call = (name, args) => ({ type: 'call', name, args });
const caret = (base, n) => ({ type: 'pow', base, n });
const intLit = (k) => ({ type: 'num', text: String(k), value: { kind: 'finite', r: new Fraction(k) } });

// ---------------------------------------------------------------------------
// Printing with the minimal parentheses that keep the tree shape
// ---------------------------------------------------------------------------

// Comparisons bind most loosely and cannot be chained, so a comparison operand
// that is itself a comparison always keeps its parentheses.
const PREC = { '==': 0, '!=': 0, '<': 0, '<=': 0, '>': 0, '>=': 0, '+': 1, '-': 1, '*': 2, '/': 2 };

function prec(n) {
  if (n.type === 'bin') return PREC[n.op];
  if (n.type === 'neg') return 3;
  return 4;
}

export function print(n) {
  switch (n.type) {
    case 'num': return n.text;
    case 'var': return n.name;
    case 'call': return `${n.name}(${n.args.map(print).join(', ')})`;
    case 'pow': {
      const b = n.base.type === 'var' || n.base.type === 'call' || (n.base.type === 'num' && !n.base.text.startsWith('-')) ? print(n.base) : `(${print(n.base)})`;
      return `${b}^${n.n}`;
    }
    case 'neg': {
      const a = n.arg.type === 'bin' || n.arg.type === 'neg' ? `(${print(n.arg)})` : print(n.arg);
      return `-${a}`;
    }
    case 'bin': {
      const p = PREC[n.op];
      const l = prec(n.left) < p || (p === 0 && prec(n.left) === 0) ? `(${print(n.left)})` : print(n.left);
      // A right operand of the same precedence must keep its parentheses: a − (b − c), a + (b + c).
      const r = prec(n.right) <= p || (n.right.type === 'neg' && p > 0) ? `(${print(n.right)})` : print(n.right);
      const sym = n.op;
      return `${l} ${sym} ${r}`;
    }
    default: return '?';
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const ADD = new Set(['+', '-']);
const MUL = new Set(['*', '/']);
const groupOf = (op) => (ADD.has(op) ? ADD : MUL.has(op) ? MUL : null);
const inv = { '+': '-', '-': '+', '*': '/', '/': '*' };
const isPlusLike = (op) => op === '+' || op === '*';
const isBin = (n, ops) => n.type === 'bin' && (!ops || ops.includes(n.op));

function intOf(n) {
  if (n.type === 'num' && n.value?.kind === 'finite' && n.value.r.d === 1n) return Number(n.value.r.s * n.value.r.n);
  if (n.type === 'neg' && n.arg.type === 'num') { const k = intOf(n.arg); return k == null ? null : -k; }
  return null;
}
const isHalf = (n) => n.type === 'num' && n.value?.kind === 'finite' && n.value.r.equals(new Fraction(1, 2));

/** Flatten a tree of '*' nodes into its factors (left to right). */
function factors(n, out = []) {
  if (isBin(n, ['*'])) { factors(n.left, out); factors(n.right, out); } else out.push(n);
  return out;
}

function product(list) {
  return list.reduce((acc, f) => (acc ? bin('*', acc, f) : f), null);
}

function grouped(n) {
  const fs = factors(n);
  const groups = [];
  for (const f of fs) {
    const g = groups.find((x) => same(x.f, f));
    if (g) g.k++; else groups.push({ f, k: 1 });
  }
  return { fs, groups, repeated: groups.some((g) => g.k > 1) };
}

/**
 * Each rule: id, test(node) → boolean, apply(node) → node.
 * Labels and descriptions are translated in the UI ('rw.<id>' keys).
 */
export const RULES = [
  {
    id: 'commute',
    test: (n) => isBin(n, ['+', '*']),
    apply: (n) => bin(n.op, n.right, n.left),
  },
  {
    // (a ∘ b) ⋄ c → a ∘ (b ⋄' c), for +/− and for ×/÷
    id: 'reassocRight',
    test: (n) => n.type === 'bin' && groupOf(n.op) && isBin(n.left) && groupOf(n.left.op) === groupOf(n.op),
    apply: (n) => {
      const op1 = n.left.op;
      const op3 = isPlusLike(op1) ? n.op : inv[n.op];
      return bin(op1, n.left.left, bin(op3, n.left.right, n.right));
    },
  },
  {
    // a ∘ (b ⋄ c) → (a ∘ b) ⋄' c
    id: 'reassocLeft',
    test: (n) => n.type === 'bin' && groupOf(n.op) && isBin(n.right) && groupOf(n.right.op) === groupOf(n.op),
    apply: (n) => {
      const op1 = n.op;
      const op2 = isPlusLike(op1) ? n.right.op : inv[n.right.op];
      return bin(op2, bin(op1, n.left, n.right.left), n.right.right);
    },
  },
  {
    // a·(b ± c) → a·b ± a·c ;  (a ± b)·c → a·c ± b·c ;  (a ± b)/c → a/c ± b/c
    id: 'distribute',
    test: (n) => (isBin(n, ['*']) && (isBin(n.right, ['+', '-']) || isBin(n.left, ['+', '-'])))
      || (isBin(n, ['/']) && isBin(n.left, ['+', '-'])),
    apply: (n) => {
      if (n.op === '*' && isBin(n.right, ['+', '-'])) return bin(n.right.op, bin('*', n.left, n.right.left), bin('*', n.left, n.right.right));
      return bin(n.left.op, bin(n.op, n.left.left, n.right), bin(n.op, n.left.right, n.right));
    },
  },
  {
    // x·b ± x·c → x·(b ± c) ; b·x ± c·x → (b ± c)·x ; a/x ± b/x → (a ± b)/x
    id: 'factor',
    test: (n) => factorOut(n) != null,
    apply: (n) => factorOut(n),
  },
  {
    id: 'subToAddNeg',
    test: (n) => isBin(n, ['-']),
    apply: (n) => bin('+', n.left, neg(n.right)),
  },
  {
    id: 'addNegToSub',
    test: (n) => isBin(n, ['+']) && n.right.type === 'neg',
    apply: (n) => bin('-', n.left, n.right.arg),
  },
  {
    id: 'negNeg',
    test: (n) => n.type === 'neg' && n.arg.type === 'neg',
    apply: (n) => n.arg.arg,
  },
  {
    id: 'negSub',
    test: (n) => n.type === 'neg' && isBin(n.arg, ['-']),
    apply: (n) => bin('-', n.arg.right, n.arg.left),
  },
  {
    // x·x·x → pow(x, 3): one correctly rounded power instead of repeated products
    id: 'collectPow',
    test: (n) => isBin(n, ['*']) && grouped(n).repeated,
    apply: (n) => product(grouped(n).groups.map((g) => (g.k > 1 ? call('pow', [g.f, intLit(g.k)]) : g.f))),
  },
  {
    // x·x·x → x^3 (still evaluated as repeated multiplication, but written compactly)
    id: 'collectCaret',
    test: (n) => isBin(n, ['*']) && grouped(n).repeated,
    apply: (n) => product(grouped(n).groups.map((g) => (g.k > 1 ? caret(g.f, g.k) : g.f))),
  },
  {
    id: 'caretToPow',
    test: (n) => n.type === 'pow',
    apply: (n) => call('pow', [n.base, intLit(n.n)]),
  },
  {
    id: 'powToCaret',
    test: (n) => n.type === 'call' && n.name === 'pow' && intOf(n.args[1]) != null && Math.abs(intOf(n.args[1])) <= 4096,
    apply: (n) => caret(n.args[0], intOf(n.args[1])),
  },
  {
    id: 'expandMul',
    test: (n) => (n.type === 'pow' && n.n >= 1 && n.n <= 16)
      || (n.type === 'call' && n.name === 'pow' && intOf(n.args[1]) >= 1 && intOf(n.args[1]) <= 16),
    apply: (n) => {
      const base = n.type === 'pow' ? n.base : n.args[0];
      const k = n.type === 'pow' ? n.n : intOf(n.args[1]);
      return product(Array.from({ length: k }, () => base));
    },
  },
  {
    id: 'sqrtToPow',
    test: (n) => n.type === 'call' && n.name === 'sqrt',
    apply: (n) => call('pow', [n.args[0], { type: 'num', text: '0.5', value: { kind: 'finite', r: new Fraction(1, 2) } }]),
  },
  {
    id: 'powToSqrt',
    test: (n) => n.type === 'call' && n.name === 'pow' && isHalf(n.args[1]),
    apply: (n) => call('sqrt', [n.args[0]]),
  },
];

function factorOut(n) {
  if (!isBin(n, ['+', '-'])) return null;
  const { left: L, right: R, op } = n;
  if (isBin(L, ['*']) && isBin(R, ['*'])) {
    if (same(L.left, R.left)) return bin('*', L.left, bin(op, L.right, R.right));
    if (same(L.right, R.right)) return bin('*', bin(op, L.left, R.left), L.right);
  }
  if (isBin(L, ['/']) && isBin(R, ['/']) && same(L.right, R.right)) return bin('/', bin(op, L.left, R.left), L.right);
  return null;
}

export function applicableRules(node) {
  return RULES.filter((r) => r.test(node));
}

export function applyRule(root, path, ruleId) {
  const rule = RULES.find((r) => r.id === ruleId);
  const node = getAt(root, path);
  if (!rule || !rule.test(node)) throw new Error('rule not applicable');
  return setAt(root, path, rule.apply(node));
}

// ---------------------------------------------------------------------------
// Program-level helpers
// ---------------------------------------------------------------------------

/** All statements (including those inside repeat blocks) that hold an expression. */
export function statementsOf(program) {
  const out = [];
  const visit = (stmts, depth) => {
    for (const s of stmts) {
      if (s.type === 'repeat') visit(s.body, depth + 1);
      else out.push({ stmt: s, expr: s.expr, name: s.type === 'assign' ? s.name : null, depth, text: s.text });
    }
  };
  visit(parseProgram(program), 0);
  return out;
}

/** Replace the expression of statement #index by a new tree; returns the new program text. */
export function replaceExpression(program, index, newExpr) {
  const st = statementsOf(program)[index];
  return program.slice(0, st.expr.start) + print(newExpr) + program.slice(st.expr.end);
}

// ---------------------------------------------------------------------------
// Check that a rewritten program still has the same TRUE results
// ---------------------------------------------------------------------------

import { evaluate } from './evaluator.js';
import { log10Abs } from './rational.js';

/**
 * Two irrational references count as equal when they agree to all but the last
 * 3 of their verified digits: different evaluation orders round differently in
 * the final digits, which must not be reported as a change of meaning.
 */
const EQUAL_SLACK_DIGITS = 3;

/** Equality of two exact values (irrational ones within their verified digits). */
export function exactEqual(x, y) {
  if (x.kind !== y.kind) return false;
  if (x.kind === 'nan') return true;
  if (x.kind === 'inf') return x.sign === y.sign;
  if (!x.approx && !y.approx) return x.r.equals(y.r);
  const diff = x.r.sub(y.r).abs();
  if (diff.n === 0n) return true;
  const digits = Math.min(x.approx ? x.reliable : 1e9, y.approx ? y.reliable : 1e9);
  const scale = Math.max(log10Abs(x.r), log10Abs(y.r));
  return log10Abs(diff) - scale < -(digits - EQUAL_SLACK_DIGITS);
}

/**
 * Exact (true) values of every named variable and of the result, for two
 * programs. Returns {ok, differences:[name]} — ok means the meaning is unchanged.
 */
export function sameMeaning(before, after, variables) {
  const opts = { variables, formats: [], mode: 'RNE' };
  const a = evaluate({ ...opts, program: before });
  const b = evaluate({ ...opts, program: after });
  const differences = [];
  const names = new Set([...Object.keys(a.env), ...Object.keys(b.env)]);
  for (const name of names) {
    if (!(name in a.env) || !(name in b.env)) { differences.push(name); continue; }
    if (!exactEqual(a.steps[a.env[name]].exact, b.steps[b.env[name]].exact)) differences.push(name);
  }
  const ra = a.steps[a.result];
  const rb = b.steps[b.result];
  if (ra && rb && !exactEqual(ra.exact, rb.exact)) differences.push('result');
  return { ok: differences.length === 0, differences };
}
