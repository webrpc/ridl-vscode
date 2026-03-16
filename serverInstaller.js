const path = require('path');

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'ridl-lsp.exe' : 'ridl-lsp';
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

module.exports = {
  executableName,
  firstGopathEntry,
  managedBinaryPath
};
