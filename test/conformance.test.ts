import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isFlagEnabled } from '../src/evaluation/evaluator';
import type { FeatureFlag, MozhnoContext } from '../src/types';

interface SpecTest {
  name: string;
  flag: string;
  context: MozhnoContext;
  rollOut?: number;
  expected: boolean;
}

interface Spec {
  name: string;
  flags: FeatureFlag[];
  tests: SpecTest[];
}

const specsDir = process.env.SPECS_DIR;

function loadSpecs(): Spec[] {
  if (!specsDir) return [];
  const index = JSON.parse(fs.readFileSync(path.join(specsDir, 'index.json'), 'utf8')) as {
    specs: string[];
  };
  return index.specs.map((file) =>
    JSON.parse(fs.readFileSync(path.join(specsDir, file), 'utf8')) as Spec,
  );
}

const specs = loadSpecs();

describe.skipIf(!specsDir)('conformance (shared SDK specifications)', () => {
  for (const spec of specs) {
    describe(spec.name, () => {
      const flags = new Map(spec.flags.map((f) => [f.key, f]));
      for (const t of spec.tests) {
        it(t.name, () => {
          const flag = flags.get(t.flag);
          if (!flag) throw new Error(`Unknown flag "${t.flag}" in spec test "${t.name}"`);
          const evaluated = t.rollOut !== undefined
            ? { ...flag, activation: { ...flag.activation, rollOut: t.rollOut } }
            : flag;
          expect(isFlagEnabled(evaluated, t.context)).toBe(t.expected);
        });
      }
    });
  }
});
