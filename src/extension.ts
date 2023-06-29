// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';

type SerialPortInfo = {
    path: string;
    manufacturer?: string;
};

class JaculusInterface {
    private selectComPortBtn: vscode.StatusBarItem | null = null;
	private selectedPort: string | null = null;
    private terminalJaculus: vscode.Terminal | null = null;
	private debugMode: boolean = false;
    private debugBtn: vscode.StatusBarItem | null = null;

    constructor(private context: vscode.ExtensionContext, private extensionPath: string, private jacToolCommand: string = "jac") {
		this.selectedPort = this.context.globalState.get("selectedPort") || null; // if port is selected from previous session, find it
		this.debugMode = this.context.globalState.get("debugMode") || false; // if debug mode is selected from previous session, find it
		this.terminalJaculus = vscode.window.terminals.find(terminal => terminal.name === 'Jaculus') || null; // if terminal is opened from previous session, find it
		vscode.window.onDidCloseTerminal((closedTerminal) => {
			if (this.terminalJaculus === closedTerminal) {
                this.terminalJaculus = null;
            }
        });
	}

    private async selectComPort() {
		exec('jac list-ports', (error, stdout, stderr) => {
			if (error) {
				vscode.window.showErrorMessage(`Error: ${error.message}`);
				return;
			}
			if (stderr) {
				vscode.window.showWarningMessage(`Stderr: ${stderr}`);
				return;
			}
			let ports = this.parseSerialPorts(stdout);
			let items = ports.map(port => ({ label: port.path , description: port.manufacturer }));
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
        this.runJaculusCommandInTerminal('build', [], this.extensionPath);
    }

    public async flash() {
		if(this.selectedPort === null) {
			vscode.window.showErrorMessage('Jaculus: No COM port selected');
			return;
		}
        this.runJaculusCommandInTerminal('flash', ["--port", this.selectedPort], this.extensionPath);
    }

    public async monitor() {
		if(this.selectedPort === null) {
			vscode.window.showErrorMessage('Jaculus: No COM port selected');
			return;
		}
		this.runJaculusCommandInTerminal('monitor', ["--port", this.selectedPort], this.extensionPath);
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
		if (this.terminalJaculus === null) {
			this.terminalJaculus = vscode.window.createTerminal({
				name: 'Jaculus',
				// shellPath: cwd,
				message: 'Jaculus Terminal',
				iconPath: new vscode.ThemeIcon('gear'),
			});
		}

		if (this.debugMode) {
            args.push('--log-level', 'silly');
        }

		this.terminalJaculus.show();
		this.terminalJaculus.sendText(`${this.jacToolCommand} ${command} ${args.join(' ')}`, true);
	}

    public toggleDebug() {
        this.debugMode = !this.debugMode;
		if(this.debugBtn) {
			this.debugBtn.text = this.debugMode ? "$(bug)  On" : "$(bug) Off";
			this.debugBtn.tooltip = this.debugMode ? "Jaculus Debug Mode On" : "Jaculus Debug Mode Off";
			this.debugBtn.color = this.debugMode ? "#cc4408" : "#ff8500";
			this.debugBtn.show();
		}
		this.context.globalState.update("debugMode", this.debugMode);
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

	private async checkJaculusInstalled(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			exec('jac', (err, stdout, stderr) => {
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

		this.selectComPortBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.selectComPortBtn.command = "jaculus.SelectComPort";
		this.selectComPortBtn.text = this.selectedPort ? `$(plug) ${this.selectedPort.replace('/dev/tty.', '')}` : "$(plug) Select COM Port";
		this.selectComPortBtn.tooltip = "Jaculus Select COM Port";
		this.selectComPortBtn.color = "#ff8500";
		this.selectComPortBtn.show();

		let buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		buildBtn.command = "jaculus.Build";
		buildBtn.text = "$(gear) Build";
		buildBtn.tooltip = "Jaculus Build";
		buildBtn.color = "#ff8500";
		buildBtn.show();

		let flashBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		flashBtn.command = "jaculus.Flash";
		flashBtn.text = "$(rocket) Flash";
		flashBtn.tooltip = "Jaculus Flash";
		flashBtn.color = "#ff8500";
		flashBtn.show();

		let monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		monitorBtn.command = "jaculus.Monitor";
		monitorBtn.text = "$(eye) Monitor";
		monitorBtn.tooltip = "Jaculus Monitor";
		monitorBtn.color = "#ff8500";

		monitorBtn.show();

		this.debugBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.debugBtn.command = "jaculus.ToggleDebug";
        this.debugBtn.text = "$(bug) Off";
		this.debugBtn.tooltip = "Jaculus Debug Mode Off";
		this.debugBtn.color = "#ff8500";
        this.debugBtn.show();

        this.context.subscriptions.push(
            vscode.commands.registerCommand('jaculus.SelectComPort', () => this.selectComPort()),
            vscode.commands.registerCommand('jaculus.Build', () => this.build()),
            vscode.commands.registerCommand('jaculus.Flash', () => this.flash()),
            vscode.commands.registerCommand('jaculus.Monitor', () => this.monitor()),
			vscode.commands.registerCommand('jaculus.ToggleDebug', () => this.toggleDebug()),
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
		const jaculus = new JaculusInterface(context, path, 'jac');
    	await jaculus.registerCommands();
	} else {
		// vscode.window.showErrorMessage('Jaculus: No workspace folder found');
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
