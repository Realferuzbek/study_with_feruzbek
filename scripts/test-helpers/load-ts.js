const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..", "..");
const moduleCache = new Map();

function resolveAlias(specifier) {
  if (specifier.startsWith("@/")) {
    return path.resolve(projectRoot, specifier.slice(2));
  }
  return null;
}

function resolveModulePath(basePath) {
  const candidates = path.extname(basePath)
    ? [basePath]
    : [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.tsx"),
        path.join(basePath, "index.js"),
      ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }
  return null;
}

function resolveSpecifier(specifier, fromDir) {
  const aliased = resolveAlias(specifier);
  if (aliased) return resolveModulePath(aliased);
  if (specifier.startsWith(".")) {
    return resolveModulePath(path.resolve(fromDir, specifier));
  }
  return null;
}

function compileTsModule(absolutePath) {
  const cached = moduleCache.get(absolutePath);
  if (cached) return cached.exports;

  const source = fs.readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
    fileName: absolutePath,
  });

  const sandboxModule = { exports: {} };
  moduleCache.set(absolutePath, sandboxModule);

  const customRequire = (specifier) => {
    const resolved = resolveSpecifier(specifier, path.dirname(absolutePath));
    if (resolved) {
      if (resolved.endsWith(".ts") || resolved.endsWith(".tsx")) {
        return compileTsModule(resolved);
      }
      return require(resolved);
    }
    return require(specifier);
  };

  const runner = new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    transpiled.outputText,
  );
  runner(
    customRequire,
    sandboxModule,
    sandboxModule.exports,
    path.dirname(absolutePath),
    absolutePath,
  );
  return sandboxModule.exports;
}

function loadTsModule(relativePath) {
  const absoluteBase = path.resolve(projectRoot, relativePath);
  const resolved = resolveModulePath(absoluteBase);
  if (!resolved) {
    throw new Error(`Unable to resolve module path: ${relativePath}`);
  }

  if (resolved.endsWith(".ts") || resolved.endsWith(".tsx")) {
    return compileTsModule(resolved);
  }
  return require(resolved);
}

module.exports = { loadTsModule };
