// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';
import axios from 'axios';

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


type BoardsIndex = {
    board: string;
    id: string;
}[];

type BoardVersions = {
    version: string;
}[];

const DEFAULT_PORT = "17531";
const BOARD_INDEX_URL = "https://f.jaculus.org/bin";
const BOARDS_INDEX_JSON = "boards.json";
const BOARD_VERSIONS_JSON = "versions.json";

class JaculusInterface {
    private selectComPortBtn: vscode.StatusBarItem | null = null;
    private selectedPort: string | null = null;
    private selectedSocket: string | null = null;
    private terminalJaculus: vscode.Terminal | null = null;
    private minimalMode: boolean = false;
    private debugMode: LogLevel = LogLevel.info;
    private monitoring: boolean = false;

    constructor(private context: vscode.ExtensionContext, private extensionPath: string, private jacToolCommand: string) {
        this.selectedPort = this.context.globalState.get("selectedPort") || null; // if port is selected from previous session, find it
        this.debugMode = this.context.globalState.get("debugMode") || LogLevel.info; // if debug mode is selected from previous session, find it
        this.terminalJaculus = vscode.window.terminals.find(terminal => terminal.name === 'Jaculus') || null; // if terminal is opened from previous session, find it
        this.minimalMode = this.context.globalState.get("minimalMode") || false; // if minimal mode is selected from previous session, hide button comments
        vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (this.terminalJaculus === closedTerminal) {
                this.terminalJaculus = null;
            }
        });
    }

    private async selectPort() {
        exec(`${this.jacToolCommand} list-ports`, (error, stdout) => {
            if (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
                return;
            }
            let ports = this.parseSerialPorts(stdout);
            let items = ports.map(port => ({ label: port.path, description: port.manufacturer }));
            items.push({ label: "Socket", description: undefined });
            vscode.window.showQuickPick(items).then(async selected => {
                if (selected) {
                    if (selected.label === "Socket") {
                        const socketTmp = await vscode.window.showInputBox({
                            placeHolder: 'Enter ip and port of your jaculus device',
                            prompt: `IP:PORT (default port: ${DEFAULT_PORT})`,
                            validateInput: (text: string): string | undefined => {
                                if (text.trim().length === 0) {
                                    return 'Input cannot be empty';
                                }
                                return undefined;
                            }
                        });
                        let socket = null;

                        if (socketTmp?.includes(":")) {
                            socket = socketTmp;
                        }
                        else if (socketTmp !== undefined) {
                            socket = socketTmp + `:${DEFAULT_PORT}`;
                        }

                        this.selectedPort = null;
                        this.context.globalState.update("selectedPort", this.selectedPort);

                        this.selectedSocket = socket || null;
                        this.context.globalState.update("selectedSocket", this.selectedSocket);
                        this.selectComPortBtn && (this.selectComPortBtn.text = `$(plug) Socket: ${this.selectedSocket}`);
                        vscode.window.showInformationMessage(`Selected Socket: ${this.selectedSocket}`);
                    }
                    else {
                        this.selectedSocket = null;
                        this.context.globalState.update("selectedSocket", this.selectedSocket);

                        this.selectedPort = selected.label;
                        this.context.globalState.update("selectedPort", this.selectedPort);
                        this.selectComPortBtn && (this.selectComPortBtn.text = `$(plug) ${this.selectedPort.replace('/dev/tty.', '')}`);
                        vscode.window.showInformationMessage(`Selected COM port: ${selected.label}`);
                    }
                }
            });
        });
    }

    public async build() {
        vscode.workspace.saveAll(false);
        this.runJaculusCommandInTerminal('build', [], []);
    }

    public async flash() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('flash', port, []);
    }

    public async monitor() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('monitor', port, []);
    }

    public async buildFlashMonitor() {
        vscode.workspace.saveAll(false);
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('build flash monitor', port, []);

        this.monitoring = true;
    }

    public async monitorStop() {
        if (this.terminalJaculus && this.monitoring) {
            this.terminalJaculus.sendText(String.fromCharCode(3), true);
            this.monitoring = false;
        }
    }

    private async start() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('start', port, []);
    }

    private async stop() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('stop', port, []);
    }

    private async showVersion() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('version', port, []);
    }

    private async showStatus() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('status', port, []);
    }

    private async format() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('format', port, []);
    }

    private async runJaculusCommandInTerminal(command: string, port: string[], args: string[]): Promise<void> {
        if (this.terminalJaculus === null) {
            this.terminalJaculus = vscode.window.createTerminal({
                name: 'Jaculus',
                message: 'Jaculus Terminal',
                iconPath: new vscode.ThemeIcon('gear'),
            });
        }

        if (this.debugMode !== LogLevel.info) {
            const str: string = LogLevel[this.debugMode];
            args.push('--log-level', str);
        }

        this.terminalJaculus.show();
        this.terminalJaculus.sendText(`${this.jacToolCommand} ${port.join(' ')} ${command} ${args.join(' ')}`, true);
    }


    private runJaculusAsSubprocess(command: string, port: string[], args: string[] = [], input: string | null = null): Promise<{ code: number | undefined, stdout: string, stderr: string }> {
        return new Promise<{ code: number | undefined, stdout: string, stderr: string }>((resolve, reject) => {
            const fullCommand = `${this.jacToolCommand} ${port.join(' ')} ${command} ${args.join(' ')}`;
            const childProcess = exec(fullCommand, { cwd: this.extensionPath }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ code: error.code, stdout, stderr });
                } else {
                    resolve({ code: 0, stdout, stderr });
                }
            });

            if (input && childProcess.stdin) {
                childProcess.stdin.write(input);
                childProcess.stdin.end();
            }
        });
    }

    private async selectLogLevel() {
        let items = Object.keys(LogLevel);
        vscode.window.showQuickPick(items).then(selected => {
            if (selected) {
                this.debugMode = LogLevel[selected as keyof typeof LogLevel];
            }
        });
    }

    private getConnectedPort(): string[] {
        if (this.selectedPort !== null) {
            return ["--port", this.selectedPort!];
        }
        if (this.selectedSocket !== null) {
            return ["--socket", this.selectedSocket!];
        }

        vscode.window.showErrorMessage('Jaculus: No port selected');
        throw new Error('Jaculus: No port selected');
    }

    private async stopRunningMonitor() {
        if (this.monitoring) {
            this.monitorStop();
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }


    private parseSerialPorts(input: string): SerialPortInfo[] {
        const result: SerialPortInfo[] = [];
        const lines = input.split('\n');

        // Start parsing from line 2 to skip headers
        for (let i = 2; i < lines.length; i++) {
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

    public async configWiFi() {
        // Define WiFi commands
        /* eslint-disable @typescript-eslint/naming-convention */
        const wifiCommands: Record<string, string> = {
            "$(search) Display current WiFi config": "wifi-get",
            "$(add) Add a WiFi network": "wifi-add",
            "$(remove) Remove a WiFi network": "wifi-rm",
            "$(debug-disconnect) Disable WiFi": "wifi-disable",
            "$(radio-tower) Set WiFi to Station mode (connect to a wifi)": "wifi-sta",
            "$(broadcast) Set WiFi to AP mode (create a hotspot)": "wifi-ap",
        };
        /* eslint-enable @typescript-eslint/naming-convention */

        // Show quick pick menu with WiFi options
        const selectedOption = await vscode.window.showQuickPick(Object.keys(wifiCommands), { placeHolder: 'Select a WiFi configuration option' });

        if (selectedOption) {
            const command = wifiCommands[selectedOption];

            switch (command) {
                case "wifi-get":
                    this.wifiGet();
                    break;
                case "wifi-ap":
                    this.wifiAp();
                    break;
                case "wifi-add":
                    this.wifiAdd();
                    break;
                case "wifi-rm":
                    this.wifiRm();
                    break;
                case "wifi-sta":
                    this.wifiSta();
                    break;
                case "wifi-disable":
                    this.wifiDisable();
                    break;
                default:
                    vscode.window.showInformationMessage(`Error: ${command} does not exist`);
            }
        }
    }

    public async wifiGet() {
        const port = this.getConnectedPort();
        this.runJaculusCommandInTerminal('wifi-get', port, ["--watch"]);
    }

    public async getWifiCredentials(readPassword = true): Promise<{ ssid: string, password: string | undefined }> {
        const ssid = await vscode.window.showInputBox({ placeHolder: 'Enter WiFi network SSID', prompt: 'WiFi network SSID' });
        // fail if ssid is not provided
        if (!ssid) {
            vscode.window.showErrorMessage('SSID is required');
            throw new Error('SSID is required');
        }

        let password: string | undefined = undefined;
        if (readPassword) {
            password = await vscode.window.showInputBox({ placeHolder: 'Enter WiFi network password', prompt: 'WiFi network password', password: true });
        }
        return { ssid, password };
    }

    public async wifiAp() {
        const port = this.getConnectedPort();
        const { ssid } = await this.getWifiCredentials(false);
        this.runJaculusCommandInTerminal('wifi-ap', port, [ssid]);
    }

    public async wifiAdd() {
        const port = this.getConnectedPort();
        const { ssid } = await this.getWifiCredentials(false);

        this.runJaculusCommandInTerminal('wifi-add', port, [ssid]);
    }

    public async wifiRm() {
        const port = this.getConnectedPort();
        const { ssid } = await this.getWifiCredentials(false);
        this.runJaculusAsSubprocess('wifi-rm', port, [ssid]).then(({ code, stdout, stderr }) => {
            if (code !== 0) {
                vscode.window.showErrorMessage(`Error: ${stderr}`);
            } else {
                vscode.window.showInformationMessage(`Removed WiFi network: ${ssid}`);
            }
        });
    }

    public async wifiSta() {
        const port = this.getConnectedPort();
        this.runJaculusAsSubprocess('wifi-sta', port).then(({ code, stdout, stderr }) => {
            if (code !== 0) {
                vscode.window.showErrorMessage(`Error: ${stderr}`);
            } else {
                vscode.window.showInformationMessage(`Connected to WiFi network`);
            }
        });
    }

    public async wifiDisable() {
        const port = this.getConnectedPort();
        this.runJaculusAsSubprocess('wifi-disable', port).then(({ code, stdout, stderr }) => {
            if (code !== 0) {
                vscode.window.showErrorMessage(`Error: ${stderr}`);
            } else {
                vscode.window.showInformationMessage(`Disabled WiFi`);
            }
        });
    }

    private async checkJaculusInstalled(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            exec(this.jacToolCommand, (err) => {
                if (err) {
                    resolve(false);
                }
                resolve(true);
            });
        });
    }

    private async checkForUpdates(showIfUpToDate: boolean = false) {
        exec('npm outdated -g jaculus-tools', async (error, stdout) => {
            if (stdout) {
                const update = await vscode.window.showWarningMessage('jaculus-tools is outdated. Do you want to update now?', 'Yes', 'No');
                if (update === 'Yes') {
                    this.updateJaculusTools();
                }
            } else if (showIfUpToDate) {
                vscode.window.showInformationMessage('jaculus-tools is up to date!');
            }
        });
    }

    private updateJaculusTools() {
        exec('npm install -g jaculus-tools', (error, stdout) => {
            if (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
                return;
            }
            vscode.window.showInformationMessage('jaculus-tools was successfully updated!');
        });
    }

    public toggleMinimalMode() {
        this.minimalMode = !this.minimalMode;
        this.context.globalState.update("minimalMode", this.minimalMode);
        // show context menu tht changes will apply after restart
        // menu will have button to restart the extension - vscode.commands.executeCommand('workbench.action.reloadWindow');
        vscode.window.showInformationMessage(
            'Minimal mode has been toggled. Changes will apply after a restart.',
            'Restart Now'
        ).then(selection => {
            if (selection === 'Restart Now') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }

    public getButtonText(icon: string, text: string): string {
        return this.minimalMode ? icon : `${icon} ${text}`;
    }
    private async getBoardsIndex(): Promise<BoardsIndex> {
        const url = `${BOARD_INDEX_URL}/${BOARDS_INDEX_JSON}`;
        const response = await axios.get(url);
        return response.data;
    }

    private async getBoardVersions(boardId: string): Promise<BoardVersions> {
        const url = `${BOARD_INDEX_URL}/${boardId}/${BOARD_VERSIONS_JSON}`;
        const response = await axios.get(url);
        return response.data;
    }


    private async installJaculusBoardVersion(): Promise<void> {
        // should fail if com port is not selected
        if (!this.selectedPort) {
            vscode.window.showErrorMessage('Please select a COM port before installing firmware');
            return;
        }

        try {
            const boardsIndex = await this.getBoardsIndex();

            // Add a custom URL option
            const customUrlOption = 'Custom URL';
            const boardOptions = [...boardsIndex.map(board => board.board), customUrlOption];

            // Show initial menu with boards and custom URL option
            const boardOrCustomUrl = await vscode.window.showQuickPick(boardOptions, { placeHolder: 'Select a board or enter a custom URL' });
            let firmwareUrl = '';

            if (!boardOrCustomUrl) {
                vscode.window.showErrorMessage('Please select a board or enter a custom URL');
                return;
            }

            if (boardOrCustomUrl === customUrlOption) {
                // Handle custom URL input
                firmwareUrl = await vscode.window.showInputBox({ placeHolder: 'Enter the custom URL for the tar.gz package' }) || '';
                if (firmwareUrl === '') {
                    vscode.window.showErrorMessage('Please enter a valid URL');
                    return;
                }
            } else {
                // Handle predefined board selection
                const boardId = boardsIndex.find(b => b.board === boardOrCustomUrl)?.id;
                if (!boardId) {
                    vscode.window.showErrorMessage('Error fetching board ID');
                    return;
                }

                const boardVersions = await this.getBoardVersions(boardId);
                const selectedVersion = await vscode.window.showQuickPick(boardVersions.map(version => version.version), { placeHolder: 'Select a version to install' });
                if (selectedVersion) {
                    firmwareUrl = `${BOARD_INDEX_URL}/${boardId}/${boardId}-${selectedVersion}.tar.gz`;
                } else {
                    vscode.window.showErrorMessage('No version selected');
                    return;
                }
            }

            // Ask user if they want to erase storage partitions
            const noErase = await vscode.window.showQuickPick(['No', 'Yes'], { placeHolder: 'Do you want to erase storage partitions?' });

            const port = this.getConnectedPort();
            this.runJaculusCommandInTerminal('install', port, [`--package`, `"${firmwareUrl}" ${noErase === 'No' ? '--no-erase' : ''}`]);
            vscode.window.showInformationMessage(`Installing from ${firmwareUrl}`);
        } catch (error) {
            vscode.window.showErrorMessage('Error while installing firmware');
        }
    }


    public async registerCommands() {
        if (!await this.checkJaculusInstalled()) {
            vscode.window.showErrorMessage('The "jac" command does not seem to be installed. Please visit https://www.jaculus.org for installation instructions.');
            return;
        }

        let color = "#ff8500";
        if (this.minimalMode) {
            color = "#e9b780";
        }

        this.selectComPortBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.selectComPortBtn.command = "jaculus.SelectComPort";
        if (this.selectedPort) {
            this.selectComPortBtn.text = this.getButtonText("$(plug)", this.selectedPort.replace('/dev/tty.', ''));
        } else if (this.selectedSocket) {
            this.selectComPortBtn.text = this.getButtonText("$(plug)", this.selectedSocket);
        } else {
            this.selectComPortBtn.text = this.getButtonText("$(plug)", "Select Port");
        }
        this.selectComPortBtn.tooltip = "Jaculus Select Port";
        this.selectComPortBtn.color = color;
        this.selectComPortBtn.show();

        let buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        buildBtn.command = "jaculus.Build";
        buildBtn.text = this.getButtonText("$(database)", "Build");
        buildBtn.tooltip = "Jaculus Build";
        buildBtn.color = color;
        buildBtn.show();

        let flashBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        flashBtn.command = "jaculus.Flash";
        flashBtn.text = this.getButtonText("$(zap)", "Flash");
        flashBtn.tooltip = "Jaculus Flash";
        flashBtn.color = color;
        flashBtn.show();

        let monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        monitorBtn.command = "jaculus.Monitor";
        monitorBtn.text = this.getButtonText("$(device-desktop)", "Monitor");
        monitorBtn.tooltip = "Jaculus Monitor";
        monitorBtn.color = color;
        monitorBtn.show();

        let buildFlashMonitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        buildFlashMonitorBtn.command = "jaculus.BuildFlashMonitor";
        buildFlashMonitorBtn.text = this.getButtonText("$(diff-renamed)", "Build, Flash and Monitor");
        buildFlashMonitorBtn.tooltip = "Jaculus Build, Flash and Monitor";
        buildFlashMonitorBtn.color = color;
        buildFlashMonitorBtn.show();

        let configWiFiBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        configWiFiBtn.command = "jaculus.ConfigWiFi";
        configWiFiBtn.text = this.getButtonText("$(rss)", "Config WiFi");
        configWiFiBtn.tooltip = "Jaculus Config WiFi";
        configWiFiBtn.color = color;
        configWiFiBtn.show();

        this.context.subscriptions.push(
            vscode.commands.registerCommand('jaculus.SelectComPort', () => this.selectPort()),
            vscode.commands.registerCommand('jaculus.Build', () => this.build()),
            vscode.commands.registerCommand('jaculus.Flash', () => this.flash()),
            vscode.commands.registerCommand('jaculus.Monitor', () => this.monitor()),
            vscode.commands.registerCommand('jaculus.BuildFlashMonitor', () => this.buildFlashMonitor()),
            vscode.commands.registerCommand('jaculus.SetLogLevel', () => this.selectLogLevel()),
            vscode.commands.registerCommand('jaculus.Start', () => this.start()),
            vscode.commands.registerCommand('jaculus.Stop', () => this.stop()),
            vscode.commands.registerCommand('jaculus.ShowVersion', () => this.showVersion()),
            vscode.commands.registerCommand('jaculus.ShowStatus', () => this.showStatus()),
            vscode.commands.registerCommand('jaculus.Format', () => this.format()),
            vscode.commands.registerCommand('jaculus.CheckForUpdates', () => this.checkForUpdates(true)),
            vscode.commands.registerCommand('jaculus.ToggleMinimalMode', () => this.toggleMinimalMode()),
            vscode.commands.registerCommand('jaculus.InstallBoard', () => this.installJaculusBoardVersion()),
            vscode.commands.registerCommand('jaculus.ConfigWiFi', () => this.configWiFi()),
        );

        this.checkForUpdates();
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
