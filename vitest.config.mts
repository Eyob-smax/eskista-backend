import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Vitest over the NestJS source.
 *
 * The SWC plugin rather than Vitest's default esbuild transform, because NestJS relies on
 * `emitDecoratorMetadata` for constructor injection. esbuild drops that metadata silently,
 * so DI would resolve to `undefined` in any test that builds a real testing module — a
 * failure that looks like a bug in the code under test rather than in the transform.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    // Existing specs call describe/it/expect without importing them.
    globals: true,
    // SWC re-transforms every file on each run otherwise; caching cuts a 5s run to ~2s.
    fsModuleCache: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Prisma's generated client is large; excluding it keeps watch mode responsive.
    exclude: ['node_modules', 'dist', 'prisma/generated'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.module.ts', 'src/main.ts'],
    },
  },
});
