// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type SerialPortInfo = {
	path: string;
	manufacturer?: string;
};

enum LogLevel {
	info = "info",
	verbose = "verbose",
	debug = "debug",
	silly = "silly"
}

class JaculusInterface {
	private selectComPortBtn: vscode.StatusBarItem | null = null;
	private selectedPort: string | null = null;
	private terminalJaculus: vscode.Terminal | null = null;
	private debugMode: LogLevel = LogLevel.info;
	private monitoring: boolean = false;
	private jacVscodeRootPathAbs: string;
	private jacVscodeRootPathBtn: vscode.StatusBarItem | null = null;

	constructor(private context: vscode.ExtensionContext, private extensionPath: string, private jacToolCommand: string) {
		this.selectedPort = this.context.globalState.get("selectedPort") || null; // if port is selected from previous session, find it
		this.debugMode = this.context.globalState.get("debugMode") || LogLevel.info; // if debug mode is selected from previous session, find it
		this.terminalJaculus = vscode.window.terminals.find(terminal => terminal.name === 'Jaculus') || null; // if terminal is opened from previous session, find it
		this.jacVscodeRootPathAbs = this.validateOpenFolder(this.context.globalState.get("jacVscodeRootPath") || ''); // if folder is selected from previous session, find it
		this.checkTsConfigExists();
		vscode.window.onDidCloseTerminal((closedTerminal) => {
			if (this.terminalJaculus === closedTerminal) {
				this.terminalJaculus = null;
			}
		});
	}

	private validateOpenFolder(path: string): string {
		if (!vscode.workspace.workspaceFolders) {
			vscode.window.showErrorMessage('Jaculus: No workspace folder found');
			return ''; // No workspace folder found
		}
		const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
		if (!path.startsWith(workspaceRoot)) {
			this.terminalJaculus?.dispose();
			return workspaceRoot; // Return workspace root if path is not a subfolder
		}
		return path;
	}

	private async selectComPort() {
		exec(`${this.jacToolCommand} list-ports`, (error, stdout, stderr) => {
			if (error) {
				vscode.window.showErrorMessage(`Error: ${error.message}`);
				return;
			}
			if (stderr) {
				vscode.window.showWarningMessage(`Stderr: ${stderr}`);
				return;
			}
			let ports = this.parseSerialPorts(stdout);
			let items = ports.map(port => ({ label: port.path, description: port.manufacturer }));
			vscode.window.showQuickPick(items).then(selected => {
				if (selected) {
					this.selectedPort = selected.label;
					this.context.globalState.update("selectedPort", this.selectedPort);
					this.selectComPortBtn && (this.selectComPortBtn.text = `$(plug) ${this.selectedPort.replace('/dev/tty.', '')}`);
					vscode.window.showInformationMessage(`Selected COM port: ${selected.label}`);
				}
			});
		});
	}

	public async build() {
		vscode.workspace.saveAll(false);
		this.runJaculusCommandInTerminal('build', [], this.extensionPath);
	}

	public async flash() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('flash', ["--port", this.selectedPort!], this.extensionPath);
	}

	public async monitor() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('monitor', ["--port", this.selectedPort!], this.extensionPath);
	}

	public async buildFlashMonitor() {
		vscode.workspace.saveAll(false);
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('build flash monitor', ["--port", this.selectedPort!], this.extensionPath);
		this.monitoring = true;
	}

	public async monitorStop() {
		if (this.terminalJaculus && this.monitoring) {
			this.terminalJaculus.sendText(String.fromCharCode(3), true);
			this.monitoring = false;
		}
	}

	private async start() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('start', ["--port", this.selectedPort!], this.extensionPath);
	}

	private async stop() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('stop', ["--port", this.selectedPort!], this.extensionPath);
	}

	private async showVersion() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('version', ["--port", this.selectedPort!], this.extensionPath);
	}

	private async showStatus() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('status', ["--port", this.selectedPort!], this.extensionPath);
	}

	private async format() {
		this.checkConnectedPort();
		await this.stopRunningMonitor();
		this.runJaculusCommandInTerminal('format', ["--port", this.selectedPort!], this.extensionPath);
	}

	private runJaculusCommand(command: string, args: string[], cwd: string): void {
		exec(`${this.jacToolCommand} ${command} ${args.join(' ')}`, { cwd }, (error, stdout, stderr) => {
			if (error) {
				vscode.window.showErrorMessage(`Jaculus Error: ${error.message}`);
				return;
			}
			if (stderr) {
				vscode.window.showErrorMessage(`Jaculus Error: ${stderr}`);
				return;
			}
			return stdout;
		});
	}

	private async runJaculusCommandInTerminal(command: string, args: string[], cwd: string): Promise<void> {
		this.openTerminal();

		if (this.debugMode !== LogLevel.info) {
			const str: string = LogLevel[this.debugMode];
			args.push('--log-level', str);
		}

		if (this.terminalJaculus) {
			this.terminalJaculus.sendText(`${this.jacToolCommand} ${command} ${args.join(' ')}`, true);
		} else {
			vscode.window.showErrorMessage('Jaculus: No terminal found');
		}
	}

	private async selectLogLevel() {
		let items = Object.keys(LogLevel);
		vscode.window.showQuickPick(items).then(selected => {
			if (selected) {
				this.debugMode = LogLevel[selected as keyof typeof LogLevel];
			}
		});
	}

	private async checkConnectedPort() {
		if (this.selectedPort === null) {
			throw new Error('Jaculus: No COM port selected');
		}
	}

	private async stopRunningMonitor() {
		if (this.monitoring) {
			this.monitorStop();
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	}

	private async selectFolder() {
		const folders = await vscode.window.showOpenDialog({
			canSelectMany: false,
			canSelectFolders: true,
			canSelectFiles: false
		});

		if (folders && folders[0]) {
			this.jacVscodeRootPathAbs = folders[0].fsPath;
			this.context.globalState.update("jacVscodeRootPath", this.jacVscodeRootPathAbs);

			this.jacVscodeRootPathBtn && (this.jacVscodeRootPathBtn.text = `$(folder) ${this.getJacFolderRelativePath(this.jacVscodeRootPathAbs)}`);
			this.openTerminal(true);
			vscode.window.showInformationMessage(`Changed terminal directory to: ${this.jacVscodeRootPathAbs}`);
		}
	}

	private async openTerminal(openNewTerminal: boolean = false) {
		if (openNewTerminal || !this.terminalJaculus) {
			this.checkTsConfigExists();
			if (this.terminalJaculus) {
				this.terminalJaculus.dispose();
			}
			this.terminalJaculus = vscode.window.createTerminal({
				name: 'Jaculus',
				cwd: this.jacVscodeRootPathAbs,
				message: 'Jaculus Terminal',
				iconPath: new vscode.ThemeIcon('gear'),
			});
			this.terminalJaculus.show();
		}
	}

	private parseSerialPorts(input: string): SerialPortInfo[] {
		const result: SerialPortInfo[] = [];
		const lines = input.split('\n');

		// Start parsing from line 2 to skip headers
		for (let i = 3; i < lines.length; i++) {
			const line = lines[i].trim();

			if (line === 'Done') {
				break;
			}

			// Ignore empty lines
			if (line.length > 0) {
				const parts = line.split(/\s\s+/); // split on 2 or more spaces
				const path = parts[0];
				const manufacturer = parts.length > 1 ? parts[1] : undefined;
				result.push({ path, manufacturer });
			}
		}
		return result;
	}

	private getJacFolderRelativePath(absPath: string): string {
		if (!vscode.workspace.workspaceFolders) {
			vscode.window.showErrorMessage('Jaculus: No workspace folder found');
			return '';
		}
		const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
		let relativePath = path.relative(workspaceRoot, absPath);
		if (relativePath === '') { relativePath = './'; } // If selected folder is the root itself
		return relativePath;
	}

	private async checkTsConfigExists() {
		if (!vscode.workspace.workspaceFolders) {
			vscode.window.showErrorMessage('Jaculus: No workspace folder found');
			return;
		}
		// Check if tsconfig.json exists in the selected folder
		const tsConfigPath = path.join(this.jacVscodeRootPathAbs, 'tsconfig.json');
		if (!fs.existsSync(tsConfigPath)) {
			vscode.window.showInformationMessage('Jaculus: tsconfig.json not found in the selected folder (build will not work)');
			return;
		}
	}

	private async checkJaculusInstalled(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			exec(this.jacToolCommand, (err, stdout, stderr) => {
				if (err || stderr) {
					resolve(false);
				}
				resolve(true);
			});
		});
	}


	public async registerCommands() {
		if (!await this.checkJaculusInstalled()) {
			vscode.window.showErrorMessage('The "jac" command does not seem to be installed. Please visit https://www.jaculus.org for installation instructions.');
			return;
		}

		const color = "#ff8500";

		this.selectComPortBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.selectComPortBtn.command = "jaculus.SelectComPort";
		this.selectComPortBtn.text = this.selectedPort ? `$(plug) ${this.selectedPort.replace('/dev/tty.', '')}` : "$(plug) Select COM Port";
		this.selectComPortBtn.tooltip = "Jaculus Select COM Port";
		this.selectComPortBtn.color = color;
		this.selectComPortBtn.show();

		let buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		buildBtn.command = "jaculus.Build";
		buildBtn.text = "$(database) Build";
		buildBtn.tooltip = "Jaculus Build";
		buildBtn.color = color;
		buildBtn.show();

		let flashBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		flashBtn.command = "jaculus.Flash";
		flashBtn.text = "$(zap) Flash";
		flashBtn.tooltip = "Jaculus Flash";
		flashBtn.color = color;
		flashBtn.show();

		let monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		monitorBtn.command = "jaculus.Monitor";
		monitorBtn.text = "$(device-desktop) Monitor";
		monitorBtn.tooltip = "Jaculus Monitor";
		monitorBtn.color = color;
		monitorBtn.show();

		let buildFlashMonitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		buildFlashMonitorBtn.command = "jaculus.BuildFlashMonitor";
		buildFlashMonitorBtn.text = "$(diff-renamed) Build, Flash and Monitor";
		buildFlashMonitorBtn.tooltip = "Jaculus Build, Flash and Monitor";
		buildFlashMonitorBtn.color = color;
		buildFlashMonitorBtn.show();

		this.jacVscodeRootPathBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.jacVscodeRootPathBtn.command = "jaculus.SelectFolder";
		this.jacVscodeRootPathBtn.text = `$(folder) ${this.getJacFolderRelativePath(this.jacVscodeRootPathAbs)}`;
		this.jacVscodeRootPathBtn.tooltip = "Jaculus Select Folder";
		this.jacVscodeRootPathBtn.color = color;
		this.jacVscodeRootPathBtn.show();


		this.context.subscriptions.push(
			vscode.commands.registerCommand('jaculus.SelectComPort', () => this.selectComPort()),
			vscode.commands.registerCommand('jaculus.Build', () => this.build()),
			vscode.commands.registerCommand('jaculus.Flash', () => this.flash()),
			vscode.commands.registerCommand('jaculus.Monitor', () => this.monitor()),
			vscode.commands.registerCommand('jaculus.BuildFlashMonitor', () => this.buildFlashMonitor()),
			vscode.commands.registerCommand('jaculus.SetLogLevel', () => this.selectLogLevel()),
			vscode.commands.registerCommand('jaculus.Start', () => this.start()),
			vscode.commands.registerCommand('jaculus.Stop', () => this.stop()),
			vscode.commands.registerCommand('jaculus.SelectFolder', () => this.selectFolder()),
			vscode.commands.registerCommand('jaculus.ShowVersion', () => this.showVersion()),
			vscode.commands.registerCommand('jaculus.ShowStatus', () => this.showStatus()),
			vscode.commands.registerCommand('jaculus.Format', () => this.format()),
		);
	}
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "jaculus" is now active!');

	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		const path = vscode.workspace.workspaceFolders[0].uri.fsPath;
		const jaculus = new JaculusInterface(context, path, 'npx jac');
		await jaculus.registerCommands();
	} else {
		// vscode.window.showErrorMessage('Jaculus: No workspace folder found');
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
