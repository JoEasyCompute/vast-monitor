import path from "node:path";
import { pathToFileURL } from "node:url";

export function definePlugin(plugin) {
  return plugin;
}

export async function loadPlugins(runtimeConfig) {
  const pluginModules = Array.isArray(runtimeConfig?.pluginModules)
    ? runtimeConfig.pluginModules.filter(Boolean)
    : [];

  const plugins = [];
  for (const modulePath of pluginModules) {
    const resolvedModulePath = path.isAbsolute(modulePath)
      ? modulePath
      : path.resolve(runtimeConfig?.projectRoot || process.cwd(), modulePath);
    const imported = await import(pathToFileURL(resolvedModulePath).href);
    const candidate = imported.default ?? imported.plugin ?? imported;
    const normalized = normalizePlugin(candidate, resolvedModulePath);
    plugins.push(normalized);
  }

  return plugins;
}

export function normalizePlugin(plugin, resolvedFrom = "plugin") {
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`Invalid plugin loaded from ${resolvedFrom}`);
  }

  const name = String(plugin.name || "").trim();
  if (!name) {
    throw new Error(`Plugin loaded from ${resolvedFrom} is missing a name`);
  }

  return {
    ...plugin,
    name,
    slug: plugin.slug ? slugify(plugin.slug) : slugify(name)
  };
}

export function getClientExtensionManifest(plugins = []) {
  const scripts = [];
  const styles = [];

  for (const plugin of plugins) {
    const clientAssets = plugin?.clientAssets || {};
    const basePath = `/plugins/${plugin.slug}`;

    if (clientAssets.publicDir) {
      for (const scriptPath of clientAssets.scripts || []) {
        scripts.push(resolveClientAssetPath(basePath, scriptPath));
      }
      for (const stylePath of clientAssets.styles || []) {
        styles.push(resolveClientAssetPath(basePath, stylePath));
      }
    } else {
      for (const scriptPath of clientAssets.scripts || []) {
        scripts.push(scriptPath);
      }
      for (const stylePath of clientAssets.styles || []) {
        styles.push(stylePath);
      }
    }
  }

  return { scripts, styles };
}

export function resolvePluginPublicDir(runtimeConfig, plugin) {
  const publicDir = plugin?.clientAssets?.publicDir;
  if (!publicDir) {
    return null;
  }

  return path.isAbsolute(publicDir)
    ? publicDir
    : path.resolve(runtimeConfig?.projectRoot || process.cwd(), publicDir);
}

function resolveClientAssetPath(basePath, assetPath) {
  const cleanBase = basePath.replace(/\/+$/, "");
  const cleanAsset = String(assetPath || "").replace(/^\/+/, "");
  return `${cleanBase}/${cleanAsset}`;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plugin";
}
