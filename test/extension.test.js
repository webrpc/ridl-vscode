const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

function withMocks(mocks, loadModule) {
  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return loadModule();
  } finally {
    Module._load = originalLoad;
  }
}

function createHarness() {
  let binaryInstalled = false;
  const warningMessages = [];
  const infoMessages = [];
  const watchers = [];
  const createdClients = [];
  const commandCalls = [];

  class FakeLanguageClient {
    constructor() {
      this.startCalls = 0;
      this.stopCalls = 0;
      this.traceValues = [];
      createdClients.push(this);
    }

    async start() {
      this.startCalls += 1;
    }

    async stop() {
      this.stopCalls += 1;
    }

    async setTrace(value) {
      this.traceValues.push(value);
    }
  }

  const fakeFs = {
    existsSync(targetPath) {
      return targetPath === '/tmp/go/bin/ridl-lsp' ? binaryInstalled : false;
    }
  };

  const fakeChildProcess = {
    execFile(command, args, options, callback) {
      if (typeof options === 'function') {
        callback = options;
      }

      if (command !== 'go') {
        callback(new Error(`unexpected command ${command}`));
        return;
      }

      if (args[0] === 'env' && args[1] === 'GOPATH') {
        callback(null, '/tmp/go\n', '');
        return;
      }

      if (args[0] === 'install') {
        binaryInstalled = true;
        callback(null, '', '');
        return;
      }

      callback(new Error(`unexpected args ${args.join(' ')}`));
    }
  };

  const fakeVscode = {
    ProgressLocation: {
      Notification: 'notification'
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Location: class Location {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    },
    Uri: {
      file(value) {
        return { scheme: 'file', path: value, toString: () => `file:${value}` };
      },
      parse(value) {
        return { scheme: String(value).split(':', 1)[0], path: value, toString: () => value };
      },
      from(value) {
        return value;
      }
    },
    window: {
      createOutputChannel() {
        return {
          appendLine() {},
          dispose() {}
        };
      },
      async showWarningMessage(message, ...items) {
        warningMessages.push(message);
        return items.includes('Install') ? 'Install' : undefined;
      },
      showInformationMessage(message) {
        infoMessages.push(message);
        // VS Code resolves a buttonless notification only on dismissal; model it
        // as never-resolving so an awaited toast can't silently block a flow.
        return new Promise(() => {});
      },
      async showErrorMessage(message) {
        throw new Error(`unexpected showErrorMessage: ${message}`);
      },
      async withProgress(_options, task) {
        return task();
      }
    },
    commands: {
      registerCommand() {
        return { dispose() {} };
      },
      async executeCommand(command, ...args) {
        commandCalls.push([command, ...args]);
        return undefined;
      }
    },
    workspace: {
      textDocuments: [],
      getConfiguration() {
        return {
          get(key, defaultValue) {
            if (key === 'languageServer.path') {
              return '';
            }
            if (key === 'languageServer.promptToInstall') {
              return true;
            }
            if (key === 'languageServer.importPath') {
              return defaultValue;
            }
            if (key === 'languageServer.trace.server') {
              return 'off';
            }
            return defaultValue;
          }
        };
      },
      createFileSystemWatcher() {
        const watcher = {
          disposed: false,
          dispose() {
            watcher.disposed = true;
          }
        };
        watchers.push(watcher);
        return watcher;
      },
      onDidOpenTextDocument() {
        return { dispose() {} };
      }
    }
  };

  const extension = withMocks(
    {
      vscode: fakeVscode,
      fs: fakeFs,
      child_process: fakeChildProcess
    },
    () => {
      delete require.cache[require.resolve('../extension')];
      return require('../extension');
    }
  );

  extension.__test.resetState();
  extension.__test.setClientModuleForTests({
    LanguageClient: FakeLanguageClient,
    TransportKind: { stdio: 'stdio' },
    Trace: {
      Off: 'off',
      fromString(value) {
        return value;
      }
    }
  });

  return {
    extension,
    state: {
      get binaryInstalled() {
        return binaryInstalled;
      },
      warningMessages,
      infoMessages,
      watchers,
      createdClients,
      commandCalls
    }
  };
}

async function withTimeout(promise, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), 200);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

test('ensureLanguageServerStarted installs and starts once when prompted on first run', async () => {
  const { extension, state } = createHarness();
  const context = { subscriptions: [] };

  await withTimeout(
    extension.__test.ensureLanguageServerStarted(context, true),
    'ensureLanguageServerStarted timed out'
  );

  assert.equal(state.binaryInstalled, true);
  assert.equal(state.createdClients.length, 1);
  assert.equal(state.createdClients[0].startCalls, 1);
  assert.deepEqual(state.createdClients[0].traceValues, ['off']);
  assert.equal(state.warningMessages.length, 1);
  assert.equal(state.infoMessages.length, 1);
  assert.equal(state.watchers.length, 1);
  assert.equal(context.subscriptions.length, 1);
});

test('installLanguageServer restarts an existing client by default', async () => {
  const { extension, state } = createHarness();
  const context = { subscriptions: [] };
  const existingClient = {
    stopCalls: 0,
    async stop() {
      this.stopCalls += 1;
    }
  };

  extension.__test.setClientForTests(existingClient);

  const installed = await extension.__test.installLanguageServer(context);

  assert.ok(installed);
  assert.equal(existingClient.stopCalls, 1);
  assert.equal(state.createdClients.length, 1);
  assert.equal(state.createdClients[0].startCalls, 1);
});

function createUpdateHarness({ onPathBinary = '', brewPrefix = '', gopath = '/tmp/go', realpath, quickPick } = {}) {
  const installerRuns = [];
  const warnings = [];
  const infos = [];
  const errors = [];
  const quickPicks = [];
  const startedPaths = [];

  class FakeLanguageClient {
    constructor(_id, _name, serverOptions) {
      this.command = serverOptions?.command;
    }
    async start() {
      startedPaths.push(this.command);
    }
    async stop() {}
    async setTrace() {}
  }

  const fakeFs = {
    existsSync() {
      return false;
    },
    realpathSync(target) {
      return realpath || target;
    }
  };

  const fakeChildProcess = {
    execFileSync() {
      if (!onPathBinary) {
        throw new Error('not found');
      }
      return `${onPathBinary}\n`;
    },
    execFile(command, args, options, callback) {
      if (typeof options === 'function') {
        callback = options;
      }
      if (command === 'go' && args[0] === 'env') {
        callback(null, `${gopath}\n`, '');
        return;
      }
      if (command === 'go' && args[0] === 'install') {
        installerRuns.push('go install');
        callback(null, '', '');
        return;
      }
      if (command === 'brew' && args[0] === '--prefix') {
        if (!brewPrefix) {
          callback(new Error('brew not found'));
          return;
        }
        callback(null, `${brewPrefix}\n`, '');
        return;
      }
      if (command === 'brew' && args[0] === 'upgrade') {
        installerRuns.push('brew upgrade');
        callback(null, '', '');
        return;
      }
      if (command === 'brew' && args[0] === 'install') {
        installerRuns.push('brew install');
        callback(null, '', '');
        return;
      }
      callback(new Error(`unexpected command ${command} ${args.join(' ')}`));
    }
  };

  const fakeVscode = {
    ProgressLocation: { Notification: 'notification' },
    window: {
      createOutputChannel() {
        return { appendLine() {}, dispose() {} };
      },
      async showWarningMessage(message, ...items) {
        warnings.push(message);
        return items.includes('Install') ? 'Install' : undefined;
      },
      showInformationMessage(message) {
        infos.push(message);
        // Model VS Code: a buttonless notification's promise resolves only when
        // the toast is dismissed. Returning a never-resolving promise ensures any
        // `await` on it regresses these tests instead of shipping a hang.
        return new Promise(() => {});
      },
      async showErrorMessage(message) {
        errors.push(message);
        return undefined;
      },
      async showQuickPick(items) {
        quickPicks.push(items);
        if (!quickPick) {
          return undefined;
        }
        return items.find((item) => item.source === quickPick);
      },
      async withProgress(_options, task) {
        return task();
      }
    },
    commands: {
      registerCommand() {
        return { dispose() {} };
      }
    },
    workspace: {
      textDocuments: [],
      getConfiguration() {
        return {
          get(key, defaultValue) {
            if (key === 'languageServer.path') {
              return '';
            }
            if (key === 'languageServer.promptToInstall') {
              return true;
            }
            if (key === 'languageServer.importPath') {
              return defaultValue;
            }
            if (key === 'languageServer.trace.server') {
              return 'off';
            }
            return defaultValue;
          }
        };
      },
      createFileSystemWatcher() {
        return { dispose() {} };
      },
      onDidOpenTextDocument() {
        return { dispose() {} };
      }
    }
  };

  const extension = withMocks(
    { vscode: fakeVscode, fs: fakeFs, child_process: fakeChildProcess },
    () => {
      // Evict serverInstaller too so findOnPath re-binds to this harness's
      // child_process mock instead of a cached binding from an earlier test.
      delete require.cache[require.resolve('../serverInstaller')];
      delete require.cache[require.resolve('../extension')];
      return require('../extension');
    }
  );

  extension.__test.resetState();
  extension.__test.setClientModuleForTests({
    LanguageClient: FakeLanguageClient,
    TransportKind: { stdio: 'stdio' },
    Trace: {
      Off: 'off',
      fromString(value) {
        return value;
      }
    }
  });

  return { extension, state: { installerRuns, warnings, infos, errors, quickPicks, startedPaths } };
}

test('updateLanguageServer upgrades via brew when the active binary is brew-managed', async () => {
  const { extension, state } = createUpdateHarness({
    onPathBinary: '/opt/homebrew/bin/ridl-lsp',
    realpath: '/opt/homebrew/Cellar/ridl-lsp/1.3.0/bin/ridl-lsp',
    brewPrefix: '/opt/homebrew'
  });

  const ok = await extension.__test.updateLanguageServer({ subscriptions: [] });

  assert.equal(ok, true);
  assert.deepEqual(state.installerRuns, ['brew upgrade']);
});

test('updateLanguageServer uses go install when the active binary is in GOPATH', async () => {
  const { extension, state } = createUpdateHarness({
    onPathBinary: '/tmp/go/bin/ridl-lsp',
    brewPrefix: '/opt/homebrew',
    gopath: '/tmp/go'
  });

  const ok = await extension.__test.updateLanguageServer({ subscriptions: [] });

  assert.equal(ok, true);
  assert.deepEqual(state.installerRuns, ['go install']);
});

test('updateLanguageServer refuses to cross-install for an unmanaged binary', async () => {
  const { extension, state } = createUpdateHarness({
    onPathBinary: '/usr/local/custom/ridl-lsp',
    brewPrefix: '/opt/homebrew',
    gopath: '/tmp/go'
  });

  const ok = await extension.__test.updateLanguageServer({ subscriptions: [] });

  assert.equal(ok, false);
  assert.deepEqual(state.installerRuns, []);
  assert.equal(state.warnings.length, 1);
});

test('updateLanguageServer warns when no binary is installed', async () => {
  const { extension, state } = createUpdateHarness({ onPathBinary: '', gopath: '/tmp/go' });

  const ok = await extension.__test.updateLanguageServer({ subscriptions: [] });

  assert.equal(ok, false);
  assert.deepEqual(state.installerRuns, []);
  assert.equal(state.warnings.length, 1);
});

test('installLanguageServer asks which source when both brew and go are available', async () => {
  const { extension, state } = createUpdateHarness({ brewPrefix: '/opt/homebrew', gopath: '/tmp/go', quickPick: 'brew' });

  const ok = await extension.__test.installLanguageServer({ subscriptions: [] });

  assert.ok(ok);
  assert.equal(state.quickPicks.length, 1);
  assert.deepEqual(state.installerRuns, ['brew install']);
});

test('installLanguageServer honors a go pick when both are available', async () => {
  const { extension, state } = createUpdateHarness({ brewPrefix: '/opt/homebrew', gopath: '/tmp/go', quickPick: 'go' });

  const ok = await extension.__test.installLanguageServer({ subscriptions: [] });

  assert.ok(ok);
  assert.deepEqual(state.installerRuns, ['go install']);
});

test('installLanguageServer aborts when the source pick is dismissed', async () => {
  const { extension, state } = createUpdateHarness({ brewPrefix: '/opt/homebrew', gopath: '/tmp/go' });

  const ok = await extension.__test.installLanguageServer({ subscriptions: [] });

  assert.ok(!ok);
  assert.equal(state.quickPicks.length, 1);
  assert.deepEqual(state.installerRuns, []);
});

test('installLanguageServer uses the only available source without asking', async () => {
  const { extension, state } = createUpdateHarness({ brewPrefix: '/opt/homebrew', gopath: '' });

  const ok = await extension.__test.installLanguageServer({ subscriptions: [] });

  assert.ok(ok);
  assert.equal(state.quickPicks.length, 0);
  assert.deepEqual(state.installerRuns, ['brew install']);
});

test('installLanguageServer errors when neither brew nor go is available', async () => {
  const { extension, state } = createUpdateHarness({ brewPrefix: '', gopath: '' });

  const ok = await extension.__test.installLanguageServer({ subscriptions: [] });

  assert.ok(!ok);
  assert.deepEqual(state.installerRuns, []);
  assert.equal(state.errors.length, 1);
});

test('a Homebrew install from the prompt starts the server without waiting on the success toast', async () => {
  // Regression: the install path awaited showInformationMessage, whose promise
  // (modeled here as never-resolving) only settles on dismissal — so the server
  // never started until a window reload. The start must not depend on the toast.
  const { extension, state } = createUpdateHarness({
    onPathBinary: '', // findOnPath / `which` returns nothing
    brewPrefix: '/opt/homebrew',
    gopath: '/tmp/go',
    quickPick: 'brew'
  });

  const started = extension.__test.ensureLanguageServerStarted({ subscriptions: [] }, true);
  // Don't hang the suite if the bug returns; the fix resolves `started` promptly.
  await Promise.race([started, new Promise((resolve) => setTimeout(resolve, 100))]);

  assert.deepEqual(state.installerRuns, ['brew install']);
  assert.deepEqual(state.startedPaths, ['/opt/homebrew/bin/ridl-lsp']);
});
