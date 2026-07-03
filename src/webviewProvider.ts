import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { detectActivePorts } from './serverDetector';
import { DEVICES } from './deviceManager';
import { createProxyServer, ProxyServer } from './proxyServer';

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
        const proxy = await createProxyServer(targetPort);
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

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
            portMapping: this._buildPortMappings()
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        const startIntervalScan = () => {
            if (this._scanInterval) { return; }
            this._scanInterval = setInterval(() => {
                if (this._view && this._view.visible) {
                    this.scanAndSendPorts(true); // silent background scan
                }
            }, 4000);
        };

        const stopIntervalScan = () => {
            if (this._scanInterval) {
                clearInterval(this._scanInterval);
                this._scanInterval = undefined;
            }
        };

        // Dispose interval on extension shutdown
        this._context.subscriptions.push({
            dispose: () => stopIntervalScan()
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready': {
                    // Webview DOM and listeners are ready. Safe to send initial ports.
                    await this.scanAndSendPorts(false);
                    startIntervalScan();
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
                            const proxy = await this._getOrCreateProxy(targetPort);
                            webviewView.webview.postMessage({
                                type: 'proxyReady',
                                targetPort: targetPort,
                                proxyPort: proxy.port,
                            });
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
            }
        });

        // Scan ports and manage interval when sidebar visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.scanAndSendPorts(true);
                startIntervalScan();
            } else {
                stopIntervalScan();
            }
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
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
