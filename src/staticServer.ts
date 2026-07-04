import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export interface StaticServer {
    port: number;
    stop: () => Promise<void>;
}

export function createStaticServer(workspaceRoot: string, port: number = 0): Promise<StaticServer> {
    return new Promise((resolve, reject) => {
        const mimeTypes: Record<string, string> = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.webp': 'image/webp',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.otf': 'font/otf',
        };

        const clients: http.ServerResponse[] = [];
        let watchTimeout: NodeJS.Timeout | null = null;
        let watcher: fs.FSWatcher | null = null;

        // Watch workspace for changes to trigger live reload
        try {
            watcher = fs.watch(workspaceRoot, { recursive: true }, (event, filename) => {
                if (filename) {
                    const norm = filename.replace(/\\/g, '/');
                    if (norm.includes('node_modules') || norm.includes('.git') || norm.includes('.vscode')) {
                        return;
                    }
                }
                if (watchTimeout) clearTimeout(watchTimeout);
                watchTimeout = setTimeout(() => {
                    clients.forEach(client => {
                        try {
                            client.write('data: reload\n\n');
                        } catch (e) { /* ignore */ }
                    });
                }, 100);
            });
        } catch (e) {
            console.error('[WebFrame Pro] Live-reload file watcher failed:', e);
        }

        const server = http.createServer((req, res) => {
            // Live reload SSE endpoint
            if (req.url === '/vpp-live-reload') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*'
                });
                res.write('\n');
                clients.push(res);
                req.on('close', () => {
                    const idx = clients.indexOf(res);
                    if (idx !== -1) {
                        clients.splice(idx, 1);
                    }
                });
                return;
            }

            // Decode URL to handle spaces/special characters in filenames
            let safeUrl = decodeURIComponent(req.url || '/');
            // Remove query strings/hashes
            const qIdx = safeUrl.indexOf('?');
            if (qIdx !== -1) {
                safeUrl = safeUrl.substring(0, qIdx);
            }
            const hIdx = safeUrl.indexOf('#');
            if (hIdx !== -1) {
                safeUrl = safeUrl.substring(0, hIdx);
            }

            let filePath = path.join(workspaceRoot, safeUrl);

            // If a directory is requested, look for index.html
            try {
                if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                    filePath = path.join(filePath, 'index.html');
                }
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
                return;
            }

            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';

            if (ext === '.html') {
                fs.readFile(filePath, 'utf8', (err, html) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('500 Internal Server Error');
                        return;
                    }
                    const reloadScript = `\n<script>(function(){const es=new EventSource('/vpp-live-reload');es.onmessage=(e)=>{if(e.data==='reload')window.location.reload();};es.onerror=()=>{/*silent*/};})();</script>\n`;
                    const bodyIndex = html.toLowerCase().lastIndexOf('</body>');
                    let finalHtml = html;
                    if (bodyIndex !== -1) {
                        finalHtml = html.substring(0, bodyIndex) + reloadScript + html.substring(bodyIndex);
                    } else {
                        finalHtml += reloadScript;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(finalHtml);
                });
            } else {
                fs.readFile(filePath, (err, content) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('500 Internal Server Error');
                    } else {
                        res.writeHead(200, { 'Content-Type': contentType });
                        res.end(content);
                    }
                });
            }
        });

        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const addr = server.address() as any;
            resolve({
                port: addr.port,
                stop: () => new Promise<void>((res, rej) => {
                    if (watcher) {
                        try {
                            watcher.close();
                        } catch (e) { /* ignore */ }
                    }
                    clients.forEach(c => {
                        try { c.end(); } catch (e) { /* ignore */ }
                    });
                    server.close(err => err ? rej(err) : res());
                })
            });
        });
    });
}

