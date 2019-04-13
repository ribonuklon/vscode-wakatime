import * as vscode from 'vscode';
import * as os from 'os';
import * as child_process from 'child_process';

import { Dependencies } from './dependencies';
import { Options } from './options';
import { Logger } from './logger';
import { Libs } from './libs'

export class WakaTime {
    private appNames = {
        'SQL Operations Studio': 'sqlops',
        'Visual Studio Code': 'vscode',
    };
    private agentName: string;
    private extension;
    private statusBar: vscode.StatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
    );
    private disposable: vscode.Disposable;
    private lastFile: string;
    private lastHeartbeat: number = 0;
    private extensionPath: string;
    private dependencies: Dependencies;
    private options: Options;
    private logger: Logger;

    constructor(extensionPath: string, logger: Logger, options: Options) {
        this.extensionPath = extensionPath;
        this.logger = logger;
        this.options = options;
    }

    public initialize(): void {
        let extension = vscode.extensions.getExtension('WakaTime.vscode-wakatime');
        this.extension = extension != undefined && extension.packageJSON || { version: '0.0.0' };
        this.logger.debug('Initializing WakaTime v' + this.extension.version);
        this.agentName = this.appNames[vscode.env.appName] || 'vscode';
        this.statusBar.text = '$(clock) WakaTime Initializing...';
        this.statusBar.show();

        this.checkApiKey();

        this.dependencies = new Dependencies(this.options, this.extensionPath, this.logger);
        this.dependencies.checkAndInstall(() => {
            this.logger.debug('WakaTime: Initialized');
            this.statusBar.text = '$(clock)';
            this.statusBar.tooltip = 'WakaTime: Initialized';
            this.options.getSetting('settings', 'status_bar_icon', (_err, val) => {
                if (val && val.trim() == 'false') this.statusBar.hide();
                else this.statusBar.show();
            });
        });

        this.setupEventListeners();
    }

    public promptForApiKey(): void {
        this.options.getSetting('settings', 'api_key', (_err, defaultVal) => {
            if (this.validateKey(defaultVal) != '') defaultVal = '';
            let promptOptions = {
                prompt: 'WakaTime API Key',
                placeHolder: 'Enter your api key from wakatime.com/settings',
                value: defaultVal,
                ignoreFocusOut: true,
                validateInput: this.validateKey.bind(this),
            };
            vscode.window.showInputBox(promptOptions).then(val => {                
                if (val != undefined) {
                    let validation = this.validateKey(val);
                    if (validation === '') this.options.setSetting('settings', 'api_key', val)
                    else vscode.window.setStatusBarMessage(validation);
                } else vscode.window.setStatusBarMessage('WakaTime api key not provided');
                
            });
        });
    }

    public promptForProxy(): void {
        this.options.getSetting('settings', 'proxy', (_err, defaultVal) => {
            if (!defaultVal) defaultVal = '';
            let promptOptions = {
                prompt: 'WakaTime Proxy',
                placeHolder: 'Proxy format is https://user:pass@host:port',
                value: defaultVal,
                ignoreFocusOut: true,
                validateInput: this.validateProxy.bind(this),
            };
            vscode.window.showInputBox(promptOptions).then(val => {
                if (val || val === '') this.options.setSetting('settings', 'proxy', val);
            });
        });
    }

    public promptForDebug(): void {
        this.options.getSetting('settings', 'debug', (_err, defaultVal) => {
            if (!defaultVal || defaultVal.trim() !== 'true') defaultVal = 'false';
            let items: string[] = ['true', 'false'];
            let promptOptions = {
                placeHolder: 'true or false (Currently ' + defaultVal + ')',
                value: defaultVal,
                ignoreFocusOut: true,
            };
            vscode.window.showQuickPick(items, promptOptions).then(newVal => {
                if (newVal == null) return;
                this.options.setSetting('settings', 'debug', newVal);
                if (newVal === 'true') {
                    this.logger.setLevel('debug');
                    this.logger.debug('Debug enabled');
                } else {
                    this.logger.setLevel('info');
                }
            });
        });
    }

    public promptStatusBarIcon(): void {
        this.options.getSetting('settings', 'status_bar_icon', (_err, defaultVal) => {
            if (!defaultVal || defaultVal.trim() !== 'false') defaultVal = 'true';
            let items: string[] = ['true', 'false'];
            let promptOptions = {
                placeHolder: 'true or false (Currently ' + defaultVal + ')',
                value: defaultVal,
                ignoreFocusOut: true,
            };
            vscode.window.showQuickPick(items, promptOptions).then(newVal => {
                if (newVal == null) return;
                this.options.setSetting('settings', 'status_bar_icon', newVal);
                if (newVal === 'true') {
                    this.statusBar.show();
                    this.logger.debug('Status bar icon enabled');
                } else {
                    this.statusBar.hide();
                    this.logger.debug('Status bar icon disabled');
                }
            });
        });
    }

    public openDashboardWebsite(): void {
        let open = 'xdg-open';
        let args = ['https://wakatime.com/'];
        if (Dependencies.isWindows()) {
            open = 'cmd';
            args.unshift('/c', 'start', '""');
        } else if (os.type() == 'Darwin') {
            open = 'open';
        }        
        child_process.execFile(open, args, (error, stdout, stderr) => {
            if (error != null) {
                if (stderr && stderr.toString() != '') this.logger.error(stderr.toString());
                if (stdout && stdout.toString() != '') this.logger.error(stdout.toString());
                this.logger.error(error.toString());
            }
        });
    }

    public dispose() {
        this.statusBar.dispose();
        this.disposable.dispose();
    }

    private validateKey(key: string): string {
        const err = 'Invalid api key... check https://wakatime.com/settings for your key.';
        if (!key) return err;
        const re = new RegExp(
            '^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$',
            'i',
        );
        if (!re.test(key)) return err;
        return '';
    }

    private validateProxy(proxy: string): string {
        const err =
            'Invalid proxy. Valid formats are https://user:pass@host:port or socks5://user:pass@host:port or domain\\user:pass.';
        if (!proxy) return err;
        let re = new RegExp('^((https?|socks5)://)?([^:@]+(:([^:@])+)?@)?[\\w\\.-]+(:\\d+)?$', 'i');
        if (proxy.indexOf('\\') > -1) re = new RegExp('^.*\\\\.+$', 'i');
        if (!re.test(proxy)) return err;
        return '';
    }

    private checkApiKey(): void {
        this.hasApiKey(hasApiKey => {
            if (!hasApiKey) this.promptForApiKey();
        });
    }

    private hasApiKey(callback: (arg0: boolean) => void): void {
        this.options.getSetting('settings', 'api_key', (_error, apiKey) => {
            callback(this.validateKey(apiKey) === '');
        });
    }

    private setupEventListeners(): void {
        // subscribe to selection change and editor activation events
        let subscriptions: vscode.Disposable[] = [];
        vscode.window.onDidChangeTextEditorSelection(this.onChange, this, subscriptions);
        vscode.window.onDidChangeActiveTextEditor(this.onChange, this, subscriptions);
        vscode.workspace.onDidSaveTextDocument(this.onSave, this, subscriptions);

        // create a combined disposable from both event subscriptions
        this.disposable = vscode.Disposable.from(...subscriptions);
    }

    private onChange(): void {
        this.onEvent(false);
    }

    private onSave(): void {
        this.onEvent(true);
    }

    private onEvent(isWrite: boolean): void {
        let editor = vscode.window.activeTextEditor;
        if (editor) {
            let doc = editor.document;
            if (doc) {
                let file: string = doc.fileName;
                if (file) {
                    let time: number = Date.now();
                    if (isWrite || this.enoughTimePassed(time) || this.lastFile !== file) {
                        this.sendHeartbeat(file, isWrite);
                        this.lastFile = file;
                        this.lastHeartbeat = time;
                    }
                }
            }
        }
    }

    private sendHeartbeat(file: string, isWrite: boolean): void {
        this.hasApiKey(hasApiKey => {
            if (hasApiKey) {
                this.dependencies.getPythonLocation(pythonBinary => {
                    if (pythonBinary) {
                        let core = this.dependencies.getCoreLocation();
                        let user_agent =
                            this.agentName + '/' + vscode.version + ' vscode-wakatime/' + this.extension.version;
                        let args = [core, '--file', Libs.quote(file), '--plugin', Libs.quote(user_agent)];
                        let project = this.getProjectName(file);
                        if (project) args.push('--alternate-project', Libs.quote(project));
                        if (isWrite) args.push('--write');
                        if (Dependencies.isWindows()) {
                            args.push(
                                '--config',
                                Libs.quote(this.options.getConfigFile()),
                                '--logfile',
                                Libs.quote(this.options.getLogFile()),
                            );
                        }

                        this.logger.debug('Sending heartbeat: ' + this.formatArguments(pythonBinary, args));

                        let process = child_process.execFile(pythonBinary, args, (error, stdout, stderr) => {
                            if (error != null) {
                                if (stderr && stderr.toString() != '') this.logger.error(stderr.toString());
                                if (stdout && stdout.toString() != '') this.logger.error(stdout.toString());
                                this.logger.error(error.toString());
                            }
                        });
                        process.on('close', (code, _signal) => {
                            if (code == 0) {
                                this.statusBar.text = '$(clock)';
                                let today = new Date();
                                this.statusBar.tooltip = 'WakaTime: Last heartbeat sent ' + this.formatDate(today);
                            } else if (code == 102) {
                                this.statusBar.text = '$(clock)';
                                this.statusBar.tooltip =
                                    'WakaTime: Working offline... coding activity will sync next time we are online.';
                                this.logger.warn(
                                    'API Error (102); Check your ' + this.options.getLogFile() + ' file for more details.',
                                );
                            } else if (code == 103) {
                                this.statusBar.text = '$(clock) WakaTime Error';
                                let error_msg =
                                    'Config Parsing Error (103); Check your ' +
                                    this.options.getLogFile() +
                                    ' file for more details.';
                                this.statusBar.tooltip = 'WakaTime: ' + error_msg;
                                this.logger.error(error_msg);
                            } else if (code == 104) {
                                this.statusBar.text = '$(clock) WakaTime Error';
                                let error_msg = 'Invalid API Key (104); Make sure your API Key is correct!';
                                this.statusBar.tooltip = 'WakaTime: ' + error_msg;
                                this.logger.error(error_msg);
                            } else {
                                this.statusBar.text = '$(clock) WakaTime Error';
                                let error_msg =
                                    'Unknown Error (' +
                                    code +
                                    '); Check your ' +
                                    this.options.getLogFile() +
                                    ' file for more details.';
                                this.statusBar.tooltip = 'WakaTime: ' + error_msg;
                                this.logger.error(error_msg);
                            }
                        });
                    }
                });
            } else {
                this.promptForApiKey();
            }
        });
    }

    private formatDate(date: Date): String {
        let months = [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
        ];
        let ampm = 'AM';
        let hour = date.getHours();
        if (hour > 11) {
            ampm = 'PM';
            hour = hour - 12;
        }
        if (hour == 0) {
            hour = 12;
        }
        let minute = date.getMinutes();
        return (
            months[date.getMonth()] +
            ' ' +
            date.getDate() +
            ', ' +
            date.getFullYear() +
            ' ' +
            hour +
            ':' +
            (minute < 10 ? '0' + minute : minute) +
            ' ' +
            ampm
        );
    }

    private enoughTimePassed(time: number): boolean {
        return this.lastHeartbeat + 120000 < time;
    }

    private getProjectName(file: string): string {
        let uri = vscode.Uri.file(file);
        let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (vscode.workspace && workspaceFolder) {
            try {
                return workspaceFolder.name;
            } catch (e) { }
        }
        return '';
    }

    private obfuscateKey(key: string): string {
        let newKey = '';
        if (key) {
            newKey = key;
            if (key.length > 4)
                newKey = 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXX' + key.substring(key.length - 4);
        }
        return newKey;
    }

    private wrapArg(arg: string): string {
        if (arg.indexOf(' ') > -1) return '"' + arg.replace(/"/g, '\\"') + '"';
        return arg;
    }

    private formatArguments(python: string, args: string[]): string {
        let clone = args.slice(0);
        clone.unshift(this.wrapArg(python));
        let newCmds: string[] = [];
        let lastCmd = '';
        for (let i = 0; i < clone.length; i++) {
            if (lastCmd == '--key') newCmds.push(this.wrapArg(this.obfuscateKey(clone[i])));
            else newCmds.push(this.wrapArg(clone[i]));
            lastCmd = clone[i];
        }
        return newCmds.join(' ');
    }
}