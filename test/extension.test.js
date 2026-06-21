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

function createUpdateHarness({ onPathBinary = '', brewPrefix = '', gopath = '/tmp/go', realpath, quickPick, logLevel = '', configuredPath = '', serverVersion = '', infoChoice = undefined } = {}) {
  const installerRuns = [];
  const warnings = [];
  const infos = [];
  const infoButtons = [];
  const errors = [];
  const quickPicks = [];
  const startedPaths = [];
  const startedEnvs = [];

  class FakeLanguageClient {
    constructor(_id, _name, serverOptions) {
      this.command = serverOptions?.command;
      this.env = serverOptions?.options?.env;
    }
    async start() {
      startedPaths.push(this.command);
      startedEnvs.push(this.env);
    }
    async stop() {}
    async setTrace() {}
  }

  const fakeFs = {
    existsSync(target) {
      return Boolean(configuredPath) && target === configuredPath;
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
      if (command === onPathBinary && args[0] === '--version') {
        if (!serverVersion) {
          callback(new Error('no --version configured'));
          return;
        }
        callback(null, `${serverVersion}\n`, '');
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
      showInformationMessage(message, ...items) {
        infos.push(message);
        infoButtons.push(items);
        // A BUTTONED prompt resolves to the configured choice. A BUTTONLESS
        // notification's promise resolves only on dismissal — model it as
        // never-resolving so an `await` on it regresses these tests (the v0.2.1
        // toast-await bug class) instead of shipping a hang.
        if (items.length > 0) {
          return Promise.resolve(infoChoice);
        }
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
              return configuredPath;
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
            if (key === 'languageServer.logLevel') {
              return logLevel;
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

  return { extension, state: { installerRuns, warnings, infos, infoButtons, errors, quickPicks, startedPaths, startedEnvs } };
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

test('startLanguageServer passes RIDL_LSP_LOG_LEVEL when logLevel is configured', async () => {
  const { extension, state } = createUpdateHarness({
    onPathBinary: '/opt/homebrew/bin/ridl-lsp',
    logLevel: 'debug'
  });

  await extension.__test.ensureLanguageServerStarted({ subscriptions: [] }, false);

  assert.deepEqual(state.startedPaths, ['/opt/homebrew/bin/ridl-lsp']);
  assert.equal(state.startedEnvs.length, 1);
  assert.equal(state.startedEnvs[0].RIDL_LSP_LOG_LEVEL, 'debug');
});

test('startLanguageServer leaves the environment untouched when logLevel is empty', async () => {
  const { extension, state } = createUpdateHarness({
    onPathBinary: '/opt/homebrew/bin/ridl-lsp',
    logLevel: ''
  });

  await extension.__test.ensureLanguageServerStarted({ subscriptions: [] }, false);

  // No override: the server inherits the process environment verbatim.
  assert.equal(state.startedEnvs[0], process.env);
});

test('a Homebrew update restarts at the stable bin path, not a versioned keg', async () => {
  // Regression (COD-001): when the active binary is a configured Cellar keg,
  // brew upgrade retires it; the restart must use the stable bin symlink.
  const cellar = '/opt/homebrew/Cellar/ridl-lsp/1.3.0/bin/ridl-lsp';
  const { extension, state } = createUpdateHarness({
    configuredPath: cellar,
    realpath: cellar,
    brewPrefix: '/opt/homebrew'
  });

  const ok = await extension.__test.updateLanguageServer({ subscriptions: [] });

  assert.ok(ok);
  assert.deepEqual(state.installerRuns, ['brew upgrade']);
  assert.deepEqual(state.startedPaths, ['/opt/homebrew/bin/ridl-lsp']);
});

test('compareVersions orders semver numerically', () => {
  const { extension } = createUpdateHarness({});
  const { compareVersions } = extension.__test;
  assert.equal(compareVersions('1.5.0', '1.5.0'), 0);
  assert.equal(compareVersions('1.4.0', '1.5.0'), -1);
  assert.equal(compareVersions('1.5.1', '1.5.0'), 1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1); // numeric, not lexical
  assert.equal(compareVersions('v1.5.0', '1.5.0'), 0); // leading v
  assert.equal(compareVersions('1.5.0-dev', '1.5.0'), 0); // suffix stripped
  assert.equal(compareVersions('garbage', '0.0.0'), 0); // unparseable -> 0.0.0
});

test('getServerVersion parses --version output', async () => {
  const { extension } = createUpdateHarness({
    onPathBinary: '/usr/local/bin/ridl-lsp',
    serverVersion: 'ridl-lsp v1.5.0'
  });
  const v = await extension.__test.getServerVersion('/usr/local/bin/ridl-lsp');
  assert.equal(v, '1.5.0');
});

test('getServerVersion returns null on spawn failure', async () => {
  const { extension } = createUpdateHarness({
    onPathBinary: '/usr/local/bin/ridl-lsp',
    serverVersion: 'ridl-lsp v1.5.0'
  });
  // A different path than onPathBinary makes the harness execFile error out.
  const v = await extension.__test.getServerVersion('/nope/ridl-lsp');
  assert.equal(v, null);
});

test('getServerVersion returns null on unparseable output', async () => {
  const { extension } = createUpdateHarness({
    onPathBinary: '/usr/local/bin/ridl-lsp',
    serverVersion: 'ridl-lsp dev'
  });
  const v = await extension.__test.getServerVersion('/usr/local/bin/ridl-lsp');
  assert.equal(v, null);
});
