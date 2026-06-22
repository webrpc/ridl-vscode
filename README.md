# RIDL for VS Code

[![VS Marketplace](https://vsmarketplacebadges.dev/version-short/webrpc-io.ridl-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=webrpc-io.ridl-vscode)

RIDL adds first-class editor support for `.ridl` files used by webrpc schemas.

## Features

- syntax highlighting tailored for RIDL declarations, annotations, metadata, fields, and enum members
- language server integration powered by `ridl-lsp`
- go to definition, type definition, find references, rename, hover, code lens, and document links
- commands to install `ridl-lsp` (choosing Homebrew or Go when both are available) and to update it in place via whichever tool installed it

## Requirements

- VS Code `1.90+`
- Homebrew or Go installed locally if you want the extension to install or update `ridl-lsp` for you

## Install

Install **RIDL** from the Visual Studio Marketplace:

- In VS Code, open the Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`), search for **RIDL**, and click **Install**.
- Or from the command line:

  ```bash
  code --install-extension webrpc-io.ridl-vscode
  ```

- Or open the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=webrpc-io.ridl-vscode) and click **Install**.

## Getting Started

Open any `.ridl` file. The extension uses the first `ridl-lsp` it finds: the
`ridl.languageServer.path` setting, then one on your `PATH` (e.g. a Homebrew
install), then `$GOPATH/bin`. If none is found, it can prompt to install one.

You can also manage the language server manually from the Command Palette:

- `RIDL: Install Language Server` — installs via Homebrew or `go install`; when
  both are available it asks which to use, otherwise it uses the one you have.
- `RIDL: Update Language Server` — updates the active binary using the tool it
  was installed with (`brew upgrade` for a Homebrew install, `go install` for a
  `$GOPATH/bin` one); it won't install a second copy from the other source.
- `RIDL: Restart Language Server`

## Install From Repo

If you want to build and install the latest extension from the repository without cloning it first, stream the installer directly.

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/webrpc/ridl-vscode/master/install.sh | bash
```

Windows PowerShell:

```powershell
Invoke-RestMethod https://raw.githubusercontent.com/webrpc/ridl-vscode/master/install.ps1 | Invoke-Expression
```

Requirements:

- `git`
- `npm`
- the VS Code `code` CLI available in `PATH`

Both scripts clone the repo into a temporary directory, build the extension, install it into VS Code, and remove the temporary checkout when they finish.

If you prefer to run the installer from a local checkout instead:

```bash
./install.sh
```

```powershell
.\install.ps1
```

To install from a different repo URL, set `RIDL_VSCODE_REPO` before running the script.

## Configuration

- `ridl.languageServer.path`: absolute path to a `ridl-lsp` binary to use instead of the managed one
- `ridl.languageServer.importPath`: Go import path used when installing or updating the managed server
- `ridl.languageServer.promptToInstall`: whether to prompt to install `ridl-lsp` when opening RIDL files
- `ridl.languageServer.trace.server`: trace level forwarded to the language client

## Binary Resolution

The extension resolves `ridl-lsp` in this order:

1. `ridl.languageServer.path`, if set
2. the first `ridl-lsp` on your `PATH` (e.g. a Homebrew install)
3. `$GOPATH/bin/ridl-lsp`

`RIDL: Update Language Server` updates the resolved binary using the tool it was
installed with, so a Homebrew install is updated with `brew upgrade` and a
`$GOPATH/bin` install with `go install` — it never drops a second copy from the
other source. A binary that is neither (e.g. a custom `ridl.languageServer.path`)
is left for you to update.

## Development

```bash
cd ridl-vscode
npm install
npm test
```

Then open `ridl-vscode` in VS Code and launch the extension host.

## Packaging

```bash
cd ridl-vscode
npm test
npm run package
```

This produces a versioned `.vsix` file like `ridl-vscode-<version>.vsix` that you can install locally with:

```bash
code --install-extension ridl-vscode-<version>.vsix --force
```

Or run the packaged install workflow directly:

```bash
npm run install:local
```

## Publishing

Once the publisher is configured in the Visual Studio Marketplace:

```bash
cd ridl-vscode
npm test
npm run publish:vsce
```

The publish command uses `vsce`, so you will need a Marketplace personal access token configured for that environment.
