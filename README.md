# Jaculus - VS Code Extension

Jaculus allows you to run JavaScript code on embedded platforms.

More info about [Jaculus](https://jaculus.org/getting-started/).


## Features

Currently supports ESP32 and ESP32-S3 SoCs ([Github](https://github.com/cubicap/Jaculus-esp32)).

Core functionality for porting to other platforms is provided by
[Jaculus-dcore](https://github.com/cubicap/Jaculus-dcore) library.

## Requirements

The first step is to install the Jaculus CLI tool:

```bash
npm install -g jaculus-tools
```

Then, you can run the tools using:

```bash
$ jac
```

<!-- ## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something. -->

## Known Issues

- Jaculus is still in early development and may contain bugs.

### Windows
- `jac` - cannot be loaded because running scripts is disabled on this system
  - Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` in PowerShell to fix this issue.
  - More [info](https://www.c-sharpcorner.com/article/how-to-fix-ps1-can-not-be-loaded-because-running-scripts-is-disabled-on-this-sys/)

<!-- ## Release Notes

Users appreciate release notes as you update your extension. -->

### 1.0.0

Initial release of Jaculus.