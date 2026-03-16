const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  executableName,
  firstGopathEntry,
  managedBinaryPath
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
