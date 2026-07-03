import * as vscode from 'vscode';
import { ensureDeviceAssets } from './deviceManager';
import { WebFrameProSidebarProvider } from './webviewProvider';

let sidebarProvider: WebFrameProSidebarProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    // 1. Initialize device frames and configuration files in the extension's assets directory
    ensureDeviceAssets(context.extensionPath);

    // 2. Register the Sidebar webview provider
    sidebarProvider = new WebFrameProSidebarProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            WebFrameProSidebarProvider.viewType,
            sidebarProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // 3. Register manual command to focus/reveal the sidebar preview
    context.subscriptions.push(
        vscode.commands.registerCommand('webframe-pro.openPreview', () => {
            vscode.commands.executeCommand('workbench.view.extension.webframe-pro-explorer');
        })
    );
}

export function deactivate() {
    // Stop all running proxy servers to release their ports
    sidebarProvider?.stopAllProxies();
}

