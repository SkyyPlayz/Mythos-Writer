import 'vitest-axe/extend-expect';
import type { AxeMatchers } from 'vitest-axe';

declare module 'vitest' {
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
