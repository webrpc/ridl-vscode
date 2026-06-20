const childProcess = require('child_process');
const path = require('path');

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'ridl-lsp.exe' : 'ridl-lsp';
}

function findOnPath(platform = process.platform) {
  const cmd = platform === 'win32' ? 'where' : 'which';
  try {
    return childProcess.execFileSync(cmd, [executableName(platform)], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || '';
  } catch {
    return '';
  }
}

function firstGopathEntry(gopath) {
  if (!gopath) {
    return '';
  }

  const entries = gopath.split(path.delimiter).filter(Boolean);
  return entries[0] || '';
}

function managedBinaryPath(gopath, platform = process.platform) {
  const root = firstGopathEntry(gopath);
  if (!root) {
    return '';
  }

  return path.join(root, 'bin', executableName(platform));
}

function isWithin(child, parent) {
  if (!child || !parent) {
    return false;
  }

  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// detectInstallSource classifies how the resolved ridl-lsp binary was installed
// so an update uses the matching tool. Updating via the wrong source would leave
// a second copy from a different installer that the binary on PATH shadows — e.g.
// a `go install` that never reaches the brew binary the editor actually runs.
function detectInstallSource({ binaryPath, realBinaryPath, gopath, brewPrefix } = {}, platform = process.platform) {
  const candidate = binaryPath || '';
  if (!candidate) {
    return 'unknown';
  }

  const resolved = realBinaryPath || candidate;
  const goBin = managedBinaryPath(gopath, platform);
  if (goBin && (candidate === goBin || resolved === goBin)) {
    return 'go';
  }

  // Homebrew's bin symlink resolves into Cellar/<formula> (or opt/<formula>).
  // Match those specifically, never the whole prefix: on Intel macOS the prefix
  // is /usr/local, where plenty of non-brew binaries live in /usr/local/bin —
  // treating the prefix as brew would route a hand-installed binary to
  // `brew upgrade`.
  if (brewPrefix) {
    const cellar = path.join(brewPrefix, 'Cellar', 'ridl-lsp');
    const opt = path.join(brewPrefix, 'opt', 'ridl-lsp');
    if (isWithin(resolved, cellar) || isWithin(resolved, opt)) {
      return 'brew';
    }
  }

  // Fallback when the prefix lookup failed: a resolved Cellar path for this
  // formula is still an unambiguous Homebrew signal.
  if (resolved.includes(`${path.sep}Cellar${path.sep}ridl-lsp${path.sep}`)) {
    return 'brew';
  }

  return 'unknown';
}

module.exports = {
  executableName,
  findOnPath,
  firstGopathEntry,
  managedBinaryPath,
  isWithin,
  detectInstallSource
};
