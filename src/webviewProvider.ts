import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { detectActivePorts, findFreePortInRange } from './serverDetector';
import { DEVICES } from './deviceManager';
import { createProxyServer, ProxyServer } from './proxyServer';
import { createStaticServer, StaticServer } from './staticServer';

const PRE_MAPPED_START = 49600;
const PRE_MAPPED_END = 49620;

function checkUrlHeaders(urlStr: string): Promise<{ blocked: boolean; reason?: string }> {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(urlStr);
            const lib = parsed.protocol === 'https:' ? https : http;
            
            const req = lib.request(urlStr, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }, (res) => {
                const headers = res.headers;
                const xfo = (headers['x-frame-options'] || '').toString().toLowerCase();
                const csp = (headers['content-security-policy'] || '').toString().toLowerCase();
                
                res.destroy();
                
                if (xfo.includes('deny') || xfo.includes('sameorigin')) {
                    resolve({ blocked: true, reason: 'X-Frame-Options' });
                } else if (csp.includes('frame-ancestors')) {
                    resolve({ blocked: true, reason: 'CSP frame-ancestors' });
                } else {
                    resolve({ blocked: false });
                }
            });
            
            req.on('error', () => {
                resolve({ blocked: false });
            });
            
            req.setTimeout(2500, () => {
                req.destroy();
                resolve({ blocked: false });
            });
            
            req.end();
        } catch (e) {
            resolve({ blocked: false });
        }
    });
}

export class WebFrameProSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'webframe-pro-sidebar';
    private _view?: vscode.WebviewView;
    private _mappedPorts: Set<number> = new Set();
    /** Cache of running proxy servers keyed by target port */
    private _proxyCache: Map<number, ProxyServer> = new Map();
    private _staticServer?: StaticServer;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {}

    private _buildPortMappings(): vscode.WebviewPortMapping[] {
        return Array.from(this._mappedPorts).map(port => ({
            webviewPort: port,
            extensionHostPort: port
        }));
    }

    private _ensurePortMapped(port: number): boolean {
        if (this._mappedPorts.has(port)) { return false; }
        this._mappedPorts.add(port);
        if (this._view) {
            this._view.webview.options = {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                portMapping: this._buildPortMappings()
            };
        }
        return true;
    }

    /**
     * Gets or creates a proxy server for the given target port.
     * The proxy strips X-Frame-Options/CSP and rewrites cookies to SameSite=None;Secure,
     * which is the only reliable way to make authentication work inside a VS Code webview iframe.
     */
    private async _getOrCreateProxy(targetPort: number): Promise<ProxyServer> {
        if (this._proxyCache.has(targetPort)) {
            return this._proxyCache.get(targetPort)!;
        }
        const freePort = await findFreePortInRange(49611, PRE_MAPPED_END);
        const proxy = await createProxyServer(targetPort, freePort);
        this._proxyCache.set(targetPort, proxy);
        // Also ensure the proxy's own port is mapped through the webview
        this._ensurePortMapped(proxy.port);
        return proxy;
    }

    /** Stops all running proxy servers (called on deactivate). */
    public async stopAllProxies(): Promise<void> {
        for (const proxy of this._proxyCache.values()) {
            try { await proxy.stop(); } catch { /* ignore */ }
        }
        this._proxyCache.clear();
        if (this._staticServer) {
            try { await this._staticServer.stop(); } catch { /* ignore */ }
            this._staticServer = undefined;
        }
    }

    private _scanInterval?: NodeJS.Timeout;

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        const COMMON_PORTS = [3000, 3001, 4200, 4321, 5000, 5173, 8000, 8080, 8888];
        for (const port of COMMON_PORTS) { this._mappedPorts.add(port); }
        for (let p = PRE_MAPPED_START; p <= PRE_MAPPED_END; p++) { this._mappedPorts.add(p); }

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
            portMapping: this._buildPortMappings()
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Listen to active editor changes to sync relative file path for HTML/PHP routing
        const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && this._view) {
                const doc = editor.document;
                const allowedLanguages = ['html', 'php'];
                if (allowedLanguages.includes(doc.languageId)) {
                    const relativePath = vscode.workspace.asRelativePath(doc.uri);
                    this._view.webview.postMessage({
                        type: 'activeEditorFile',
                        path: relativePath
                    });
                } else {
                    this._view.webview.postMessage({
                        type: 'activeEditorFile',
                        path: ''
                    });
                }
            }
        });
        this._context.subscriptions.push(activeEditorListener);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready': {
                    // Webview DOM and listeners are ready.
                    // DO NOT auto-scan ports on load per user request. 
                    // User must click refresh manually.
                    const isHtml = await this._isHtmlProject();
                    const devScripts = await this._detectFrameworkDevScripts();
                    let activePath = '';
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        const doc = activeEditor.document;
                        const allowedLanguages = ['html', 'php'];
                        if (allowedLanguages.includes(doc.languageId)) {
                            activePath = vscode.workspace.asRelativePath(doc.uri);
                        }
                    }

                    webviewView.webview.postMessage({
                        type: 'projectInfo',
                        isHtmlProject: isHtml,
                        devScripts: devScripts,
                        activeFile: activePath
                    });
                    break;
                }
                case 'launchDevServer': {
                    const script = data.script || 'dev';
                    let terminal = vscode.window.terminals.find(t => t.name === 'Viewport Pro Dev Server');
                    if (!terminal) {
                        terminal = vscode.window.createTerminal('Viewport Pro Dev Server');
                    }
                    terminal.show();
                    terminal.sendText(`npm run ${script}`);
                    break;
                }
                case 'startStaticServer': {
                    const folders = vscode.workspace.workspaceFolders;
                    if (folders && folders.length > 0) {
                        try {
                            if (!this._staticServer) {
                                const workspaceRoot = folders[0].uri.fsPath;
                                const freePort = await findFreePortInRange(PRE_MAPPED_START, 49610);
                                this._staticServer = await createStaticServer(workspaceRoot, freePort);
                                this._ensurePortMapped(this._staticServer.port);
                            }
                            webviewView.webview.postMessage({
                                type: 'staticServerReady',
                                port: this._staticServer.port
                            });
                        } catch (err) {
                            webviewView.webview.postMessage({
                                type: 'proxyError',
                                error: 'Failed to start static server: ' + err,
                            });
                        }
                    } else {
                        webviewView.webview.postMessage({
                            type: 'proxyError',
                            error: 'No active workspace folders found to host.',
                        });
                    }
                    break;
                }
                case 'stopStaticServer': {
                    if (this._staticServer) {
                        try {
                            await this._staticServer.stop();
                        } catch (e) { /* ignore */ }
                        this._staticServer = undefined;
                    }
                    break;
                }
                case 'refreshPorts': {
                    await this.scanAndSendPorts(false);
                    break;
                }
                case 'checkUrlHeaders': {
                    const result = await checkUrlHeaders(data.url);
                    webviewView.webview.postMessage({
                        type: 'urlHeadersResult',
                        url: data.url,
                        blocked: result.blocked,
                        reason: result.reason
                    });
                    break;
                }
                case 'startProxy': {
                    const targetPort = parseInt(data.port, 10);
                    if (targetPort > 0 && targetPort <= 65535) {
                        try {
                            const activePorts = await detectActivePorts([targetPort]);
                            if (activePorts.includes(targetPort)) {
                                const proxy = await this._getOrCreateProxy(targetPort);
                                webviewView.webview.postMessage({
                                    type: 'proxyReady',
                                    targetPort: targetPort,
                                    proxyPort: proxy.port,
                                });
                            } else {
                                webviewView.webview.postMessage({
                                    type: 'serverUnreachable',
                                    targetPort: targetPort,
                                });
                            }
                        } catch (err) {
                            webviewView.webview.postMessage({
                                type: 'proxyError',
                                targetPort: targetPort,
                                error: String(err),
                            });
                        }
                    }
                    break;
                }
                case 'updatePortMapping': {
                    const port = parseInt(data.port, 10);
                    if (port > 0 && port <= 65535) { this._ensurePortMapped(port); }
                    break;
                }
                case 'saveConfig': {
                    await this._context.globalState.update('viewportProConfig', data.config);
                    break;
                }
                case 'clearConfig': {
                    await this._context.globalState.update('viewportProConfig', undefined);
                    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
                    break;
                }
            }
        });

        // We no longer scan ports on visibility change.
        // The user must manually scan or enter a port.
        webviewView.onDidChangeVisibility(() => {
            // Do nothing on visibility change
        });
    }

    /**
     * Scans local ports and posts the results back to the sidebar webview.
     * @param silent If true, suppresses the 'scanningPorts' state in the webview to avoid UI flickering.
     */
    public async scanAndSendPorts(silent: boolean = false) {
        if (!this._view) {
            return;
        }

        const COMMON_PORTS = [3000, 3001, 5000, 5173, 8000, 8080, 4200, 4321];
        
        if (!silent) {
            this._view.webview.postMessage({ type: 'scanningPorts' });
        }

        try {
            const activePorts = await detectActivePorts(COMMON_PORTS);
            this._view.webview.postMessage({
                type: 'activePorts',
                ports: activePorts
            });
        } catch (err) {
            this._view.webview.postMessage({
                type: 'activePorts',
                ports: []
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const uiPath = path.join(this._extensionUri.fsPath, 'ui');
        const htmlPath = path.join(uiPath, 'sidebar.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Get resource paths
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'ui', 'sidebar.css')
        );
        const logoUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'resources', 'logo.png')
        );
        
        // Generate nonce
        const nonce = getNonce();

        // Populate device dropdown options & generate metadata URI dictionary
        let deviceOptions = '';
        const deviceDataMap: { [key: string]: { metadata: any; svgUri: string } } = {};

        for (const [key, dev] of Object.entries(DEVICES)) {
            deviceOptions += `<option value="${key}">${dev.name}</option>\n`;

            const svgPath = vscode.Uri.joinPath(this._extensionUri, 'assets', 'devices', key, 'frame.svg');
            const svgUri = webview.asWebviewUri(svgPath);

            deviceDataMap[key] = {
                metadata: dev,
                svgUri: svgUri.toString()
            };
        }

        // Load version and build timestamp from package.json dynamically
        let version = '0.0.1';
        let lastUpdated = '';
        try {
            const packageJsonPath = path.join(this._extensionUri.fsPath, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            version = packageJson.version || '0.0.1';

            const stat = fs.statSync(packageJsonPath);
            lastUpdated = stat.mtime.toLocaleString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        } catch (e) {
            lastUpdated = new Date().toLocaleString();
        }

        const savedConfig = this._context.globalState.get('viewportProConfig', {});
        const savedConfigBase64 = Buffer.from(JSON.stringify(savedConfig), 'utf8').toString('base64');

        // Replace content placeholders globally
        html = html
            .replace(/\${styleUri}/g, styleUri.toString())
            .replace(/\${logoUri}/g, logoUri.toString())
            .replace(/\${nonce}/g, nonce)
            .replace(/\${deviceOptions}/g, deviceOptions)
            .replace(/\${deviceDataMap}/g, JSON.stringify(deviceDataMap))
            .replace(/\${savedConfigBase64}/g, savedConfigBase64)
            .replace(/\${version}/g, version)
            .replace(/\${lastUpdated}/g, lastUpdated)
            .replace(/\${cspSource}/g, webview.cspSource);

        return html;
    }

    private async _isHtmlProject(): Promise<boolean> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return false;
        }
        // Search for index.html or any html file in the workspace
        const files = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**', 5);
        return files.length > 0;
    }

    private async _detectFrameworkDevScripts(): Promise<string[]> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return [];
        }
        try {
            const packageJsonPath = path.join(folders[0].uri.fsPath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (packageJson.scripts) {
                    const scripts = Object.keys(packageJson.scripts);
                    const devScripts = scripts.filter(s => s === 'dev' || s === 'start' || s === 'serve');
                    return devScripts;
                }
            }
        } catch (e) {}
        return [];
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
