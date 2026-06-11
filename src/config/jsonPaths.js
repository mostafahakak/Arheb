const path = require('path');
const fs = require('fs');

/**
 * Base directory for Arheb API JSON files (categories, stores, products, popup, home).
 * Set ARHEB_JSON_DIR in env to a path that persists across deploys (e.g. Render persistent disk)
 * so redeploys do not reset data. If not set, uses repo's "Arheb API JSON" folder.
 */
const REPO_JSON_DIR = path.resolve(__dirname, '..', '..', 'Arheb API JSON');

function getArhebJsonDir() {
  const envDir = process.env.ARHEB_JSON_DIR;
  if (envDir && typeof envDir === 'string' && envDir.trim() !== '') {
    const dir = path.isAbsolute(envDir) ? envDir : path.resolve(process.cwd(), envDir.trim());
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.warn('ARHEB_JSON_DIR: could not ensure directory:', dir, e.message);
    }
    return dir;
  }
  return REPO_JSON_DIR;
}

/** Full path for a filename inside the Arheb JSON directory (e.g. "categories_response.json"). */
function getJsonPath(filename) {
  return path.join(getArhebJsonDir(), filename);
}

/** Copy a file from repo JSON dir to persistent dir if it does not exist (first run). */
function ensureFileFromRepo(filename) {
  const arhebJsonDir = getArhebJsonDir();
  if (arhebJsonDir === REPO_JSON_DIR) return;
  const dest = getJsonPath(filename);
  if (fs.existsSync(dest)) return;
  const src = path.join(REPO_JSON_DIR, filename);
  if (!fs.existsSync(src)) return;
  try {
    fs.copyFileSync(src, dest);
    console.log('Copied initial', filename, 'to persistent dir');
  } catch (e) {
    console.warn('Could not copy', filename, 'to persistent dir:', e.message);
  }
}

/** Ensure all known JSON files exist in persistent dir (copy from repo if missing). Call once at startup. */
function ensurePersistentDirSeeded() {
  const arhebJsonDir = getArhebJsonDir();
  if (arhebJsonDir === REPO_JSON_DIR) return;
  const files = [
    'categories_response.json',
    'food_types_response.json',
    'stores_listing_response.json',
    'products_listing_response.json',
    'popup.json',
    'home_response.json',
  ];
  for (const f of files) ensureFileFromRepo(f);
}

module.exports = {
  getArhebJsonDir,
  getJsonPath,
  ensureFileFromRepo,
  ensurePersistentDirSeeded,
  REPO_JSON_DIR,
};
