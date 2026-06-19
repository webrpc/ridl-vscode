const childProcess = require('child_process');
const path = require('path');

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'ridl-lsp.exe' : 'ridl-lsp';
}

function findOnPath(platform = process.platform) {
  const cmd = platform === 'win32' ? 'where' : 'which';
  try {
    return childProcess.execFileSync(cmd, [executableName(platform)], { encoding: 'utf8' }).trim().split('\n')[0];
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

module.exports = {
  executableName,
  findOnPath,
  firstGopathEntry,
  managedBinaryPath
};
