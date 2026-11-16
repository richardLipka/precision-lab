// Language-neutral engine errors. The engine throws EngineError(code, params);
// the UI translates the code with these templates. The English text is also
// used as Error.message so the engine stays usable without the UI.

export const ENGINE_MESSAGES = {
  en: {
    'pos': 'Line {line}, column {col}: ',
    'tok.eof': 'end of input',
    'tok.sep': 'end of line',
    'parse.unexpectedChar': "unexpected character '{ch}'",
    'parse.invalidNumber': "invalid number '{text}'",
    'parse.expected': "expected '{expected}' but found {found}",
    'parse.expectedEol': 'expected end of line but found {found}',
    'parse.unexpected': 'unexpected {found}',
    'parse.repeatCount': 'repeat needs a non-negative integer count',
    'parse.repeatTooLarge': 'repeat count is too large (max 100000)',
    'parse.fnName': "'{name}' is a function name and cannot be assigned",
    'parse.powExponent': 'the exponent of ^ must be an integer constant (it is expanded into multiplications)',
    'parse.powTooLarge': 'exponent too large (|n| ≤ 4096)',
    'parse.unknownFn': "unknown function '{name}' (available: {list})",
    'parse.arity': '{name} expects {n} argument(s), got {got}',
    'parse.chainedCmp': "comparisons cannot be chained ('{op}'); use parentheses, e.g. (a < b) == c, or two separate tests",
    'eval.tooManySteps': 'Too many steps (limit {max}). Reduce the repeat count or the exponents.',
    'eval.badVarName': "Invalid variable name '{name}'",
    'eval.badVarValue': "Variable {name}: '{value}' is not a number (use e.g. 0.1, 1e-8, 1/3, 0x1.8p-2)",
    'eval.unknownVar': "unknown variable '{name}' — add it to the variable table or assign it first",
    'fmt.precision': 'precision must be an integer ≥ 1',
    'fmt.expBits': 'exponent width must be an integer between 2 and 30',
    'sweep.badSpec': "'{part}' is not a precision, range (10-200) or range with step (10-200:5)",
    'sweep.badRange': 'precisions must be between 1 and {max}',
    'sweep.tooMany': 'too many precisions (at most {max} values)',
    'sweep.empty': 'enter at least one precision',
    'real.range': 'a value is outside the supported range (decimal exponent beyond ±{max})',
    'real.precisionLimit': 'decimal.js precision limit exceeded (π and ln 10 are known to ~1025 digits); lower the reference precision or the largest p, or use a smaller argument of sin/cos/tan',
  },
  cs: {
    'pos': 'Řádek {line}, sloupec {col}: ',
    'tok.eof': 'konec vstupu',
    'tok.sep': 'konec řádku',
    'parse.unexpectedChar': "neočekávaný znak '{ch}'",
    'parse.invalidNumber': "neplatné číslo '{text}'",
    'parse.expected': "očekáváno '{expected}', nalezeno {found}",
    'parse.expectedEol': 'očekáván konec řádku, nalezeno {found}',
    'parse.unexpected': 'neočekávaný symbol {found}',
    'parse.repeatCount': 'repeat vyžaduje nezáporný celočíselný počet opakování',
    'parse.repeatTooLarge': 'příliš mnoho opakování (nejvýše 100000)',
    'parse.fnName': "'{name}' je název funkce a nelze do něj přiřadit",
    'parse.powExponent': 'exponent u ^ musí být celočíselná konstanta (mocnina se rozkládá na násobení)',
    'parse.powTooLarge': 'příliš velký exponent (|n| ≤ 4096)',
    'parse.unknownFn': "neznámá funkce '{name}' (dostupné: {list})",
    'parse.arity': '{name} očekává {n} argument(y), zadáno {got}',
    'parse.chainedCmp': "porovnání nelze řetězit ('{op}'); použijte závorky, např. (a < b) == c, nebo dva samostatné testy",
    'eval.tooManySteps': 'Příliš mnoho kroků (limit {max}). Snižte počet opakování nebo exponenty.',
    'eval.badVarName': "Neplatný název proměnné '{name}'",
    'eval.badVarValue': "Proměnná {name}: '{value}' není číslo (zadejte např. 0.1, 1e-8, 1/3, 0x1.8p-2)",
    'eval.unknownVar': "neznámá proměnná '{name}' — přidejte ji do tabulky proměnných nebo ji nejprve přiřaďte",
    'fmt.precision': 'přesnost musí být celé číslo ≥ 1',
    'fmt.expBits': 'šířka exponentu musí být celé číslo mezi 2 a 30',
    'sweep.badSpec': "'{part}' není přesnost, rozsah (10-200) ani rozsah s krokem (10-200:5)",
    'sweep.badRange': 'přesnosti musí být mezi 1 a {max}',
    'sweep.tooMany': 'příliš mnoho přesností (nejvýše {max} hodnot)',
    'sweep.empty': 'zadejte alespoň jednu přesnost',
    'real.range': 'hodnota je mimo podporovaný rozsah (desítkový exponent přesahuje ±{max})',
    'real.precisionLimit': 'překročen limit přesnosti decimal.js (π a ln 10 zná na ~1025 číslic); snižte přesnost reference nebo největší p, případně použijte menší argument sin/cos/tan',
  },
};

export function fill(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

/** Translate an engine error (or any Error) into the given language. */
export function engineErrorText(err, lang = 'en') {
  const dict = ENGINE_MESSAGES[lang] || ENGINE_MESSAGES.en;
  if (!err || !err.code) return err?.message ?? String(err);
  const params = { ...err.params };
  if (params.found && typeof params.found === 'object') {
    params.found = params.found.t === 'eof' ? dict['tok.eof'] : params.found.t === 'sep' ? dict['tok.sep'] : `'${params.found.v}'`;
  }
  const prefix = err.line ? fill(dict.pos, { line: err.line, col: err.col }) : '';
  return prefix + fill(dict[err.code] || err.code, params);
}

export class EngineError extends Error {
  constructor(code, params = {}, pos = null, src = null) {
    super('');
    this.code = code;
    this.params = params;
    if (pos != null && src != null) {
      let line = 1;
      let col = 1;
      for (let i = 0; i < pos && i < src.length; i++) {
        if (src[i] === '\n') { line++; col = 1; } else col++;
      }
      this.pos = pos;
      this.line = line;
      this.col = col;
    }
    this.message = engineErrorText(this, 'en');
  }
}
