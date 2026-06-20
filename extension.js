const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const {
  findOnPath,
  managedBinaryPath,
  detectInstallSource
} = require('./serverInstaller');
const {
  normalizeShowReferencesArguments
} = require('./commandAdapters');

const commandInstall = 'ridl.installLanguageServer';
const commandUpdate = 'ridl.updateLanguageServer';
const commandRestart = 'ridl.restartLanguageServer';
const commandShowReferences = 'ridl.showReferences';

const defaultImportPath = 'github.com/webrpc/ridl-lsp/cmd/ridl-lsp';
const brewFormula = 'ridl-lsp';
const brewInstallTarget = 'webrpc/tap/ridl-lsp';
const outputChannelName = 'RIDL Language Server';
const traceOutputChannelName = 'RIDL Language Server Trace';

let client;
let clientModule;
let outputChannel;
let traceOutputChannel;
let startingPromise;

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel(outputChannelName);
  traceOutputChannel = vscode.window.createOutputChannel(traceOutputChannelName);

  context.subscriptions.push(
    outputChannel,
    traceOutputChannel,
    vscode.commands.registerCommand(commandInstall, () => installLanguageServer(context)),
    vscode.commands.registerCommand(commandUpdate, () => updateLanguageServer(context)),
    vscode.commands.registerCommand(commandRestart, () => restartLanguageServer(context)),
    vscode.commands.registerCommand(commandShowReferences, (...args) => showReferences(...args))
  );

  if (hasRIDLOpen()) {
    await ensureLanguageServerStarted(context, true);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (document.languageId === 'ridl') {
        await ensureLanguageServerStarted(context, true);
      }
    })
  );
}

async function deactivate() {
  if (!client) {
    return;
  }
  const current = client;
  client = undefined;
  await current.stop();
}

function hasRIDLOpen() {
  return vscode.workspace.textDocuments.some((document) => document.languageId === 'ridl');
}

function configuration() {
  return vscode.workspace.getConfiguration('ridl');
}

// serverEnv layers the configured log level onto the inherited environment, so
// RIDL_LSP_LOG_LEVEL can be set from VS Code settings without relaunching the
// editor from a shell. An empty setting leaves the server's own default.
function serverEnv() {
  const logLevel = configuration().get('languageServer.logLevel', '').trim();
  if (!logLevel) {
    return process.env;
  }
  return { ...process.env, RIDL_LSP_LOG_LEVEL: logLevel };
}

async function ensureLanguageServerStarted(context, promptOnMissing) {
  if (client) {
    return;
  }

  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    try {
      const serverPath = await resolveLanguageServerPath(context, promptOnMissing);
      if (!serverPath) {
        return;
      }
      await startLanguageServer(context, serverPath);
    } finally {
      startingPromise = undefined;
    }
  })();

  return startingPromise;
}

async function startLanguageServer(context, serverPath) {
  const module = await loadLanguageClientModule();
  if (!module) {
    return;
  }

  const { LanguageClient, TransportKind, Trace } = module;
  const traceValue = configuration().get('languageServer.trace.server', 'off');
  const trace = typeof Trace?.fromString === 'function' ? Trace.fromString(traceValue) : Trace.Off;

  const serverOptions = {
    command: serverPath,
    transport: TransportKind.stdio,
    options: {
      env: serverEnv()
    }
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.ridl');

  appendOutputLine(`Starting ridl-lsp from ${serverPath}`);

  client = new LanguageClient(
    'ridl',
    outputChannelName,
    serverOptions,
    {
      documentSelector: [
        { scheme: 'file', language: 'ridl' },
        { scheme: 'untitled', language: 'ridl' }
      ],
      synchronize: {
        fileEvents: watcher
      },
      outputChannel,
      traceOutputChannel
    }
  );

  try {
    await client.start();
    context.subscriptions.push(watcher);
  } catch (error) {
    client = undefined;
    watcher.dispose();
    throw error;
  }

  await client.setTrace(trace);
}

async function restartLanguageServer(context) {
  appendOutputLine('Restarting ridl-lsp');

  if (client) {
    const current = client;
    client = undefined;
    await current.stop();
  }

  await ensureLanguageServerStarted(context, false);
}

// restartLanguageServerAt starts the server at a known binary path, bypassing
// path re-discovery. Used right after an install/upgrade, where we already know
// where the binary is and `which` may not see a freshly-linked one yet.
async function restartLanguageServerAt(context, serverPath) {
  appendOutputLine('Restarting ridl-lsp');

  if (client) {
    const current = client;
    client = undefined;
    await current.stop();
  }

  await startLanguageServer(context, serverPath);
}

async function showReferences(...args) {
  const normalizedArgs = normalizeShowReferencesArguments(vscode, args);
  appendOutputLine(`Showing references for ${String(normalizedArgs?.[0] ?? 'unknown document')}`);
  return vscode.commands.executeCommand('editor.action.showReferences', ...normalizedArgs);
}

async function loadLanguageClientModule() {
  if (clientModule) {
    return clientModule;
  }

  try {
    clientModule = require('vscode-languageclient/node');
    return clientModule;
  } catch (error) {
    const selection = await vscode.window.showErrorMessage(
      'The RIDL extension needs the vscode-languageclient dependency. Run `npm install` in the extension folder before local development.',
      'Open Extension Folder'
    );
    if (selection === 'Open Extension Folder') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(__dirname), true);
    }
    return null;
  }
}

async function resolveLanguageServerPath(context, promptOnMissing) {
  const configuredPath = configuration().get('languageServer.path', '').trim();
  if (configuredPath) {
    if (fs.existsSync(configuredPath)) {
      return configuredPath;
    }
    void vscode.window.showWarningMessage(`Configured RIDL language server was not found: ${configuredPath}`);
    return '';
  }

  const pathBinary = findOnPath();
  if (pathBinary) {
    return pathBinary;
  }

  const goEnv = await readGoEnv();
  const managedPath = managedBinaryPath(goEnv.gopath);
  if (managedPath && fs.existsSync(managedPath)) {
    return managedPath;
  }

  if (promptOnMissing && configuration().get('languageServer.promptToInstall', true)) {
    const choice = await vscode.window.showWarningMessage(
      'ridl-lsp was not found. Install it now?',
      'Install',
      'Not Now'
    );

    if (choice === 'Install') {
      // Use the path the installer reports. Re-discovering via `which` is
      // unreliable for a freshly-linked Homebrew binary and would leave the
      // server unstarted until a window reload.
      return await installLanguageServer(context, { restart: false });
    }
  }

  return '';
}

// goInstallLanguageServer runs `go install` and returns the resulting binary
// path ($GOPATH/bin/ridl-lsp), or '' on failure. It does not start the server —
// the caller starts at the returned path.
async function goInstallLanguageServer(isUpdate = false) {
  const goEnv = await readGoEnv();
  if (!goEnv.gopath) {
    void vscode.window.showErrorMessage('RIDL could not determine GOPATH.');
    return '';
  }

  const importPath = configuration().get('languageServer.importPath', defaultImportPath).trim() || defaultImportPath;
  const label = isUpdate ? 'Updating ridl-lsp' : 'Installing ridl-lsp';
  appendOutputLine(`${label} via go install ${importPath}@latest`);
  const ok = await runGoInstall(label, ['install', `${importPath}@latest`]);
  if (!ok) {
    return '';
  }

  const binaryPath = managedBinaryPath(goEnv.gopath);
  appendOutputLine(`ridl-lsp installed via go install at ${binaryPath}`);
  void vscode.window.showInformationMessage(`RIDL language server is ready at ${binaryPath}.`);
  return binaryPath;
}

// installLanguageServer installs ridl-lsp via Homebrew or go install. When both
// are available it asks which to use, so a fresh install matches the tool the
// user expects (and the update command can later track that source).
async function installLanguageServer(context, options = {}) {
  const [goAvailable, brewAvailable] = await Promise.all([isGoAvailable(), isBrewAvailable()]);
  if (!goAvailable && !brewAvailable) {
    void vscode.window.showErrorMessage(
      'Installing ridl-lsp needs Homebrew or Go. Install one, or set ridl.languageServer.path to an existing binary.'
    );
    return false;
  }

  let source;
  if (goAvailable && brewAvailable) {
    source = await pickInstallSource();
    if (!source) {
      return false;
    }
  } else {
    source = brewAvailable ? 'brew' : 'go';
  }

  const binaryPath = source === 'brew'
    ? await brewInstallLanguageServer()
    : await goInstallLanguageServer();
  if (!binaryPath) {
    return '';
  }

  if (options.restart !== false) {
    await restartLanguageServerAt(context, binaryPath);
  }
  return binaryPath;
}

async function pickInstallSource() {
  const importPath = configuration().get('languageServer.importPath', defaultImportPath).trim() || defaultImportPath;
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Homebrew', description: `brew install ${brewInstallTarget}`, source: 'brew' },
      { label: 'Go', description: `go install ${importPath}@latest`, source: 'go' }
    ],
    {
      title: 'Install ridl-lsp',
      placeHolder: 'Choose how to install the RIDL language server'
    }
  );
  return picked ? picked.source : '';
}

// brewInstallLanguageServer runs `brew install` and returns the resulting binary
// path (<brew --prefix>/bin/ridl-lsp), or '' on failure. The path comes from the
// Homebrew prefix, not `which`, which doesn't reliably see a freshly-linked
// binary. It does not start the server.
async function brewInstallLanguageServer() {
  const label = `Installing ridl-lsp via brew install ${brewInstallTarget}`;
  appendOutputLine(label);
  const ok = await runWithProgress(label, 'brew', ['install', brewInstallTarget]);
  if (!ok) {
    return '';
  }

  const prefix = await readBrewPrefix();
  if (!prefix) {
    void vscode.window.showErrorMessage('ridl-lsp installed, but the Homebrew prefix could not be resolved to locate it.');
    return '';
  }

  const binaryPath = path.join(prefix, 'bin', brewFormula);
  appendOutputLine(`ridl-lsp installed via Homebrew at ${binaryPath}`);
  void vscode.window.showInformationMessage('ridl-lsp installed via Homebrew.');
  return binaryPath;
}

async function isGoAvailable() {
  const { gopath } = await readGoEnv();
  return Boolean(gopath);
}

async function isBrewAvailable() {
  return Boolean(await readBrewPrefix());
}

// updateLanguageServer updates whatever binary the editor actually runs, using the
// tool it was installed with. Updating via the other source would drop a second
// copy the PATH binary shadows (e.g. a go-install that never replaces a brew
// install), so for a binary that is neither brew- nor go-managed we refuse rather
// than cross-install.
async function updateLanguageServer(context) {
  const serverPath = await resolveLanguageServerPath(context, false);
  if (!serverPath) {
    void vscode.window.showWarningMessage(
      'ridl-lsp is not installed. Run "RIDL: Install Language Server", or install it with: brew install webrpc/tap/ridl-lsp'
    );
    return false;
  }

  const source = await detectActiveSource(serverPath);
  appendOutputLine(`Updating ridl-lsp at ${serverPath} (install source: ${source})`);

  if (source === 'go') {
    const binaryPath = await goInstallLanguageServer(true);
    if (!binaryPath) {
      return false;
    }
    await restartLanguageServerAt(context, binaryPath);
    return true;
  }

  if (source === 'brew') {
    return brewUpgradeLanguageServer(context, serverPath);
  }

  void vscode.window.showWarningMessage(
    `ridl-lsp at ${serverPath} was not installed via Homebrew or go install — update it with the tool you installed it with.`
  );
  return false;
}

async function detectActiveSource(serverPath) {
  const [goEnv, brewPrefix] = await Promise.all([readGoEnv(), readBrewPrefix()]);
  let realBinaryPath = serverPath;
  try {
    realBinaryPath = fs.realpathSync(serverPath);
  } catch {
    // Fall back to the unresolved path; detection still handles it.
  }
  return detectInstallSource({ binaryPath: serverPath, realBinaryPath, gopath: goEnv.gopath, brewPrefix });
}

async function brewUpgradeLanguageServer(context, serverPath) {
  const label = 'Updating ridl-lsp via brew upgrade';
  appendOutputLine(label);
  const ok = await runWithProgress(label, 'brew', ['upgrade', brewFormula]);
  if (!ok) {
    return false;
  }

  void vscode.window.showInformationMessage('ridl-lsp upgraded via Homebrew.');
  // Restart at the stable Homebrew bin symlink, not the pre-upgrade path: that
  // path may be a versioned Cellar keg (e.g. a configured languageServer.path)
  // that `brew upgrade` just retired. Fall back to serverPath if the prefix
  // lookup fails.
  const prefix = await readBrewPrefix();
  const binaryPath = prefix ? path.join(prefix, 'bin', brewFormula) : serverPath;
  await restartLanguageServerAt(context, binaryPath);
  return true;
}

async function readGoEnv() {
  try {
    const output = await execFile('go', ['env', 'GOPATH']);
    return { gopath: output.trim() };
  } catch (error) {
    return { gopath: '' };
  }
}

async function readBrewPrefix() {
  try {
    const output = await execFile('brew', ['--prefix']);
    return output.trim();
  } catch (error) {
    return '';
  }
}

async function runGoInstall(title, args, cwd) {
  return runWithProgress(title, 'go', args, {
    cwd,
    env: {
      ...process.env,
      GOBIN: ''
    }
  });
}

async function runWithProgress(title, command, args, options = {}) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false
    },
    async () => {
      try {
        await execFile(command, args, { timeout: 120_000, ...options });
        return true;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        appendOutputLine(`${title} failed: ${message}`);
        void vscode.window.showErrorMessage(`${title} failed: ${message}`);
        return false;
      }
    }
  );
}

function appendOutputLine(message) {
  if (outputChannel) {
    outputChannel.appendLine(message);
  }
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const details = stderr || stdout || error.message;
        reject(new Error(details.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

module.exports = {
  activate,
  deactivate,
  __test: {
    ensureLanguageServerStarted,
    installLanguageServer,
    updateLanguageServer,
    restartLanguageServer,
    resetState() {
      client = undefined;
      clientModule = undefined;
      outputChannel = undefined;
      traceOutputChannel = undefined;
      startingPromise = undefined;
    },
    setClientModuleForTests(module) {
      clientModule = module;
    },
    setClientForTests(nextClient) {
      client = nextClient;
    }
  }
};
