// Turns a parsed program into a flat list of steps. Every step is evaluated
// once exactly (rational arithmetic on the exact inputs = the true value) and
// once in each selected IEEE format (correctly rounded on that format's own
// operands, so errors propagate exactly as on real hardware).

import { parseProgram } from './parser.js';
import { EngineError } from './messages.js';
import {
  parseLiteral, exactAdd, exactSub, exactMul, exactDiv, exactNeg, exactAbs, exactFma, exact, ONE,
} from './rational.js';
import { fromExact, fpOp } from './ieee.js';
import { setRealDigits, realDigits, realOp, realNeg, realAbs, exactFunction, exactPi, FUNCTION_NAMES, limitSize } from './real.js';
import { fpFunction, fpPi } from './fpfunc.js';

export { EngineError };

// Exact operations: rational arithmetic, switching to the high-precision decimal
// reference (real.js) as soon as an operand is irrational.
const anyApprox = (a) => a.some((x) => x.approx) && a.every((x) => x.kind === 'finite');
const nonZeroDivisor = (a) => a[1].r.n !== 0n;
const EXACT_OPS = {
  '+': (a) => (anyApprox(a) ? realOp('+', a) : exactAdd(a[0], a[1])),
  '-': (a) => (anyApprox(a) ? realOp('-', a) : exactSub(a[0], a[1])),
  '*': (a) => (anyApprox(a) ? realOp('*', a) : exactMul(a[0], a[1])),
  '/': (a) => (anyApprox(a) && nonZeroDivisor(a) ? realOp('/', a) : exactDiv(a[0], a[1])),
  fma: (a) => (anyApprox(a) ? realOp('fma', a) : exactFma(a[0], a[1], a[2])),
  neg: (a) => (a[0].approx ? realNeg(a[0]) : exactNeg(a[0])),
  abs: (a) => (a[0].approx ? realAbs(a[0]) : exactAbs(a[0])),
};
for (const name of FUNCTION_NAMES) EXACT_OPS[name] = (a) => exactFunction(name, a);
const FN = new Set(FUNCTION_NAMES);

export const OP_SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/**
 * @param {object} cfg
 * @param {{name:string, value:string}[]} cfg.variables
 * @param {string} cfg.program
 * @param {object[]} cfg.formats  format descriptors from ieee.js
 * @param {string} cfg.mode       rounding mode id
 * @param {number} [cfg.maxSteps]
 * @param {number} [cfg.refDigits] decimal digits of the reference for irrational values
 *   (raised automatically to at least the widest format + 25 digits)
 */
export function evaluate({ variables = [], program = '', formats, mode = 'RNE', maxSteps = 20000, refDigits = 60, exactCache = null }) {
  const widest = Math.max(0, ...formats.map((f) => Math.ceil(f.p * Math.log10(2))));
  setRealDigits(Math.max(refDigits, widest + 25));
  const steps = [];
  const env = new Map();
  const constCache = new Map();
  const iterStack = [];
  let resultStep = null;

  function addStep(step) {
    if (steps.length >= maxSteps) {
      throw new EngineError('eval.tooManySteps', { max: maxSteps });
    }
    step.id = steps.length;
    // Literals are converted once (like compile-time constants), so they belong to no iteration.
    step.iter = iterStack.length && step.kind === 'op' ? iterStack.slice() : null;
    steps.push(step);
    return step;
  }

  function convertStep(kind, text, value, extra = {}) {
    const fmt = {};
    for (const f of formats) {
      if (extra.constant === 'pi') {
        fmt[f.id] = fpPi(f, mode);
        continue;
      }
      const round = fromExact(value, f, mode);
      fmt[f.id] = {
        value: round.value,
        exactOp: value,
        round: value.kind === 'finite' ? round : null,
        flags: {
          inexact: !!round.inexact, overflow: !!round.overflow, underflow: !!round.underflow,
          divByZero: false, invalid: false,
        },
      };
    }
    return addStep({ kind, op: 'convert', text, operands: [], exact: value, fmt, ...extra });
  }

  // Variables from the table
  for (const v of variables) {
    const name = (v.name || '').trim();
    if (!name) continue;
    if (!/^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*$/.test(name)) {
      throw new EngineError('eval.badVarName', { name });
    }
    const value = parseLiteral(v.value);
    if (!value) throw new EngineError('eval.badVarValue', { name, value: v.value });
    const st = convertStep('input', `${name} = ${String(v.value).trim()}`, value, { assigned: [name], source: String(v.value).trim() });
    env.set(name, st.id);
  }

  function opStep(op, operandIds, text, extra = {}) {
    const ops = operandIds.map((id) => steps[id]);
    // The exact chain does not depend on the formats: a sweep reuses it between chunks.
    const ex = exactCache?.[steps.length] ?? limitSize(EXACT_OPS[op](ops.map((s) => s.exact)));
    if (exactCache) exactCache[steps.length] = ex;
    const fmt = {};
    for (const f of formats) {
      const args = ops.map((s) => s.fmt[f.id].value);
      fmt[f.id] = FN.has(op) ? fpFunction(op, args, f, mode) : fpOp(op, args, f, mode);
    }
    return addStep({ kind: 'op', op, text, operands: operandIds, exact: ex, fmt, ...extra });
  }

  // Which step computed each source node (last evaluation wins, i.e. the final loop iteration).
  const nodeSteps = {};
  function evalNode(n) {
    const id = evalNodeInner(n);
    if (n.start != null) nodeSteps[`${n.start}:${n.end}`] = id;
    return id;
  }

  function evalNodeInner(n) {
    switch (n.type) {
      case 'num': {
        const key = n.text.replace(/\s+/g, '');
        if (constCache.has(key)) return constCache.get(key);
        const id = convertStep('const', n.text, n.value).id;
        constCache.set(key, id);
        return id;
      }
      case 'var': {
        if (!env.has(n.name) && (n.name === 'pi' || n.name === 'π')) {
          if (!constCache.has('pi')) constCache.set('pi', convertStep('const', 'π', exactPi(), { constant: 'pi', source: 'π' }).id);
          return constCache.get('pi');
        }
        if (!env.has(n.name)) {
          throw new EngineError('eval.unknownVar', { name: n.name }, n.start, program);
        }
        return env.get(n.name);
      }
      case 'neg': {
        if (n.arg.type === 'num') {
          // Fold the sign into the literal: −0.1 is one constant, not a step.
          const key = n.text.replace(/\s+/g, '');
          if (constCache.has(key)) return constCache.get(key);
          const id = convertStep('const', n.text, exactNeg(n.arg.value)).id;
          constCache.set(key, id);
          return id;
        }
        const a = evalNode(n.arg);
        return opStep('neg', [a], n.text).id;
      }
      case 'bin': {
        const a = evalNode(n.left);
        const b = evalNode(n.right);
        return opStep(n.op, [a, b], n.text).id;
      }
      case 'call': {
        const args = n.args.map(evalNode);
        return opStep(n.name, args, n.text).id;
      }
      case 'pow': {
        const base = evalNode(n.base);
        const k = Math.abs(n.n);
        const baseText = n.base.type === 'var' || n.base.type === 'num' || n.base.paren ? n.base.text : `(${n.base.text})`;
        let acc;
        if (k === 0) {
          const key = '1';
          if (!constCache.has(key)) constCache.set(key, convertStep('const', '1', exact.finite(ONE)).id);
          acc = constCache.get(key);
        } else {
          acc = base;
          for (let i = 2; i <= k; i++) {
            acc = opStep('*', [acc, base], `${baseText}^${i}`, { note: `${baseText}^${i - 1} × ${baseText}` }).id;
          }
        }
        if (n.n < 0) {
          const key = '1';
          if (!constCache.has(key)) constCache.set(key, convertStep('const', '1', exact.finite(ONE)).id);
          acc = opStep('/', [constCache.get(key), acc], n.text, { note: `1 ÷ ${baseText}^${k}` }).id;
        }
        return acc;
      }
      default:
        throw new Error('unsupported node ' + n.type);
    }
  }

  function runStatements(stmts) {
    for (const s of stmts) {
      if (s.type === 'repeat') {
        for (let i = 1; i <= s.count; i++) {
          iterStack.push(i);
          try { runStatements(s.body); } finally { iterStack.pop(); }
        }
        continue;
      }
      const id = evalNode(s.expr);
      const st = steps[id];
      if (s.type === 'assign') {
        env.set(s.name, id);
        st.assigned = st.assigned ? [...new Set([...st.assigned, s.name])] : [s.name];
        st.lastAssigned = s.name;
      }
      resultStep = id;
    }
  }

  const stmts = parseProgram(program);
  runStatements(stmts);
  if (resultStep == null && steps.length) resultStep = steps.length - 1;

  return {
    steps,
    result: resultStep,
    env: Object.fromEntries(env),
    nodeSteps,
    formats,
    mode,
    refDigits: realDigits(),
  };
}
