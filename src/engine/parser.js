// Tokenizer and recursive-descent parser for the small calculation language.
//
//   program   := statement ((newline | ';') statement)*
//   statement := 'repeat' INT '{' program '}'
//              | NAME '=' expr
//              | expr
//   expr      := term (('+' | '-') term)*
//   term      := unary (('*' | '/') unary)*
//   unary     := ('-' | '+') unary | power
//   power     := primary ('^' unary)?          (integer exponent, right associative)
//   primary   := NUMBER | NAME | NAME '(' expr (',' expr)* ')' | '(' expr ')'
//
// Evaluation order is exactly as written: a + b + c means (a + b) + c, so
// re-associating changes the rounded result just as it does in real code.

import { parseLiteral } from './rational.js';
import { EngineError } from './messages.js';

export { EngineError as ParseError };

export function lineCol(src, pos) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') { line++; col = 1; } else col++;
  }
  return { line, col };
}

export const FUNCTIONS = {
  fma: { arity: 3 },
  abs: { arity: 1 },
  sqrt: { arity: 1 },
  exp: { arity: 1 },
  ln: { arity: 1 },
  log10: { arity: 1 },
  sin: { arity: 1 },
  cos: { arity: 1 },
  tan: { arity: 1 },
  atan: { arity: 1 },
  pow: { arity: 2 },
};

const NUM_RE = /^(?:0[xX][0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?\d+)?|(?:\d[\d_]*)?(?:\.\d*)?(?:[eE][+-]?\d+)?)/;

export function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n' || c === ';') { toks.push({ t: 'sep', v: c, pos: i, end: i + 1 }); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = NUM_RE.exec(src.slice(i));
      const text = m && m[0];
      if (!text || text === '.') throw new EngineError('parse.unexpectedChar', { ch: c }, i, src);
      const value = parseLiteral(text);
      if (!value) throw new EngineError('parse.invalidNumber', { text }, i, src);
      toks.push({ t: 'num', v: text, value, pos: i, end: i + text.length });
      i += text.length;
      continue;
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_À-ɏ]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const low = word.toLowerCase();
      if (low === 'inf' || low === 'infinity' || low === 'nan') {
        toks.push({ t: 'num', v: word, value: parseLiteral(word), pos: i, end: j });
      } else {
        toks.push({ t: 'name', v: word, pos: i, end: j });
      }
      i = j;
      continue;
    }
    if (c === 'π') { toks.push({ t: 'name', v: 'pi', pos: i, end: i + 1 }); i++; continue; }
    if (c === '√') { toks.push({ t: 'name', v: 'sqrt', pos: i, end: i + 1 }); i++; continue; }
    const map = { '−': '-', '×': '*', '·': '*', '÷': '/', '∞': 'inf' };
    const ch = map[c] || c;
    if (ch === 'inf') { toks.push({ t: 'num', v: '∞', value: parseLiteral('inf'), pos: i, end: i + 1 }); i++; continue; }
    if ('+-*/^(),={}'.includes(ch)) { toks.push({ t: 'op', v: ch, pos: i, end: i + 1 }); i++; continue; }
    throw new EngineError('parse.unexpectedChar', { ch: c }, i, src);
  }
  toks.push({ t: 'eof', v: '', pos: n, end: n });
  return toks;
}

export function parseProgram(src) {
  const toks = tokenize(src);
  let k = 0;
  const peek = () => toks[k];
  const next = () => toks[k++];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const expectOp = (v) => {
    if (!isOp(v)) throw new EngineError('parse.expected', { expected: v, found: peek() }, peek().pos, src);
    return next();
  };
  const skipSeps = () => { while (peek().t === 'sep') next(); };

  function node(type, start, end, props) {
    return { type, start, end, text: src.slice(start, end), ...props };
  }

  function program(endOp) {
    const stmts = [];
    skipSeps();
    while (peek().t !== 'eof' && !(endOp && isOp(endOp))) {
      stmts.push(statement());
      if (peek().t === 'sep') skipSeps();
      else if (peek().t !== 'eof' && !(endOp && isOp(endOp))) {
        throw new EngineError('parse.expectedEol', { found: peek() }, peek().pos, src);
      }
    }
    return stmts;
  }

  function statement() {
    const t = peek();
    if (t.t === 'name' && t.v === 'repeat') {
      next();
      const ct = next();
      if (ct.t !== 'num' || ct.value.kind !== 'finite' || ct.value.r.d !== 1n || ct.value.r.s < 0n) {
        throw new EngineError('parse.repeatCount', {}, ct.pos, src);
      }
      const count = Number(ct.value.r.n);
      if (count > 100000) throw new EngineError('parse.repeatTooLarge', {}, ct.pos, src);
      expectOp('{');
      const body = program('}');
      const close = expectOp('}');
      return node('repeat', t.pos, close.end, { count, body });
    }
    if (t.t === 'name' && toks[k + 1].t === 'op' && toks[k + 1].v === '=') {
      next(); next();
      if (FUNCTIONS[t.v]) throw new EngineError('parse.fnName', { name: t.v }, t.pos, src);
      const e = expr();
      return node('assign', t.pos, e.end, { name: t.v, expr: e });
    }
    const e = expr();
    return node('expr', e.start, e.end, { expr: e });
  }

  function expr() {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = next().v;
      const right = term();
      left = node('bin', left.start, right.end, { op, left, right });
    }
    return left;
  }

  function term() {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const op = next().v;
      const right = unary();
      left = node('bin', left.start, right.end, { op, left, right });
    }
    return left;
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const t = next();
      const arg = unary();
      if (t.v === '+') return { ...arg, start: t.pos, text: src.slice(t.pos, arg.end) };
      return node('neg', t.pos, arg.end, { arg });
    }
    return power();
  }

  function power() {
    const base = primary();
    if (isOp('^')) {
      const caret = next();
      const ex = unary();
      let val = null;
      if (ex.type === 'num') val = ex.value;
      else if (ex.type === 'neg' && ex.arg.type === 'num' && ex.arg.value.kind === 'finite') {
        val = { kind: 'finite', r: ex.arg.value.r.neg() };
      }
      if (!val || val.kind !== 'finite' || val.r.d !== 1n) {
        throw new EngineError('parse.powExponent', {}, caret.pos, src);
      }
      const n = Number(val.r.s * val.r.n);
      if (Math.abs(n) > 4096) throw new EngineError('parse.powTooLarge', {}, ex.start, src);
      return node('pow', base.start, ex.end, { base, n });
    }
    return base;
  }

  function primary() {
    const t = next();
    if (t.t === 'num') return node('num', t.pos, t.end, { value: t.value });
    if (t.t === 'name') {
      if (isOp('(')) {
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new EngineError('parse.unknownFn', { name: t.v, list: Object.keys(FUNCTIONS).join(', ') }, t.pos, src);
        next();
        const args = [expr()];
        while (isOp(',')) { next(); args.push(expr()); }
        const close = expectOp(')');
        if (args.length !== fn.arity) throw new EngineError('parse.arity', { name: t.v, n: fn.arity, got: args.length }, t.pos, src);
        return node('call', t.pos, close.end, { name: t.v, args });
      }
      return node('var', t.pos, t.end, { name: t.v });
    }
    if (t.t === 'op' && t.v === '(') {
      const e = expr();
      const close = expectOp(')');
      return { ...e, paren: true, start: t.pos, end: close.end, text: src.slice(t.pos, close.end) };
    }
    throw new EngineError('parse.unexpected', { found: t }, t.pos, src);
  }

  const stmts = program(null);
  return stmts;
}
