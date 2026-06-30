---
name: Production build @shared path alias
description: How to fix the @shared/schema unresolvable error in production builds — symlink + esbuild alias pattern.
---

## The rule

The `@shared/*` path alias (defined in `tsconfig.json` and `vite.config.ts resolve.alias`) is NOT resolvable by Node.js or esbuild at production build time. Two failure modes:

1. **Vite config loading** — `vite.config.ts` dynamically imports server code in a plugin `buildStart` hook; esbuild pre-bundles the config and follows dynamic imports, hitting `@shared/schema` which can't resolve as a Node.js package.
2. **esbuild server bundle** — `--packages=external` treats `@shared/schema` as an external npm package; Node.js can't find it at runtime.

## Fix (applied in [deployment] build command via deployConfig())

```sh
# 1. Symlink created FIRST — before npm install removes nothing, after npm install creates nothing here
ln -sfn $(pwd)/shared node_modules/@shared

# 2. Standard vite builds (symlink lets Vite's esbuild config pre-bundler resolve @shared/schema)
node_modules/.bin/vite build
node_modules/.bin/vite build --ssr src/entry-server.tsx

# 3. esbuild server bundle — alias bundles @shared/* inline (not left as external)
node_modules/.bin/esbuild server/index.ts --platform=node --packages=external \
  --bundle --format=esm --outdir=dist --alias:@shared=./shared

# 4. mcp-server (no @shared imports, no alias needed)
node_modules/.bin/esbuild mcp-server/index.ts --platform=node --packages=external \
  --bundle --format=esm --outfile=dist/mcp-server.js
```

**Why the symlink works for Vite config loading**: esbuild (used by Vite to pre-bundle the config) handles TypeScript natively. With `node_modules/@shared` → `./shared`, esbuild resolves `@shared/schema` via the symlink to `./shared/schema.ts` and bundles it inline — no `ERR_MODULE_NOT_FOUND`.

**Why `--alias:@shared=./shared` works for the server bundle**: esbuild applies the alias before `--packages=external`. After aliasing, `@shared/schema` becomes `./shared/schema` (a relative path, not a package) → gets bundled inline → no external dependency at runtime.

**Why:**  
`@shared` is a TypeScript/Vite path alias defined in `tsconfig.json` paths and `vite.config.ts resolve.alias`. These are only respected by Vite and the TypeScript compiler, not by Node.js's module resolution or the esbuild CLI when bundling without Vite. Adding `@shared` as a real package (via symlink) makes all non-Vite tooling work.

**How to apply:**  
Any time the production build command is changed or the `[deployment]` section is reset, re-apply this pattern. The symlink is created fresh on every build (it's in the build script, not committed) so it's immune to `npm install` wiping `node_modules`.
