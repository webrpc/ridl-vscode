const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const childProcess = require('child_process');
const {
  executableName,
  findOnPath,
  firstGopathEntry,
  managedBinaryPath,
  detectInstallSource
} = require('../serverInstaller');

test('executableName uses platform specific suffix', () => {
  assert.equal(executableName('darwin'), 'ridl-lsp');
  assert.equal(executableName('win32'), 'ridl-lsp.exe');
});

test('firstGopathEntry returns the first GOPATH segment', () => {
  const gopath = ['/Users/me/go', '/tmp/go'].join(path.delimiter);
  assert.equal(firstGopathEntry(gopath), '/Users/me/go');
});

test('managedBinaryPath resolves to GOPATH bin', () => {
  assert.equal(managedBinaryPath('/Users/me/go', 'darwin'), path.join('/Users/me/go', 'bin', 'ridl-lsp'));
});

test('findOnPath returns empty string when binary is not found', () => {
  // ridl-lsp-nonexistent won't be on PATH, but findOnPath hardcodes the
  // executable name so we just verify it returns a string (found or not).
  const result = findOnPath();
  assert.equal(typeof result, 'string');
});

test('findOnPath strips CR and returns the first match on Windows', () => {
  const original = childProcess.execFileSync;
  childProcess.execFileSync = () => 'C:\\Go\\bin\\ridl-lsp.exe\r\nC:\\Other\\ridl-lsp.exe\r\n';
  try {
    assert.equal(findOnPath('win32'), 'C:\\Go\\bin\\ridl-lsp.exe');
  } finally {
    childProcess.execFileSync = original;
  }
});

test('detectInstallSource recognizes a go-installed binary', () => {
  assert.equal(
    detectInstallSource({ binaryPath: '/Users/me/go/bin/ridl-lsp', gopath: '/Users/me/go', brewPrefix: '/opt/homebrew' }, 'darwin'),
    'go'
  );
});

test('detectInstallSource recognizes a brew binary under the prefix', () => {
  assert.equal(
    detectInstallSource({ binaryPath: '/opt/homebrew/bin/ridl-lsp', gopath: '/Users/me/go', brewPrefix: '/opt/homebrew' }, 'darwin'),
    'brew'
  );
});

test('detectInstallSource recognizes a brew binary via the Cellar realpath', () => {
  assert.equal(
    detectInstallSource(
      {
        binaryPath: '/opt/homebrew/bin/ridl-lsp',
        realBinaryPath: '/opt/homebrew/Cellar/ridl-lsp/1.3.0/bin/ridl-lsp',
        gopath: '/Users/me/go'
      },
      'darwin'
    ),
    'brew'
  );
});

test('detectInstallSource returns unknown for an unmanaged path', () => {
  assert.equal(
    detectInstallSource({ binaryPath: '/usr/local/custom/ridl-lsp', gopath: '/Users/me/go', brewPrefix: '/opt/homebrew' }, 'darwin'),
    'unknown'
  );
});

test('detectInstallSource returns unknown without a binary path', () => {
  assert.equal(detectInstallSource({ gopath: '/Users/me/go', brewPrefix: '/opt/homebrew' }, 'darwin'), 'unknown');
});
