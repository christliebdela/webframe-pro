import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';

export interface ProxyServer {
    port: number;
    targetPort: number;
    stop: () => Promise<void>;
}

/** Rewrites Set-Cookie to SameSite=None;Secure - the key fix for auth in iframes. */
function rewriteCookies(cookies: string[]): string[] {
    return cookies.map(c => {
        let r = c.replace(/;\s*SameSite=[^;]*/gi, '').replace(/;\s*Secure/gi, '').trimEnd();
        if (!r.endsWith(';')) { r += ';'; }
        return r + ' SameSite=None; Secure';
    });
}

export function createProxyServer(targetPort: number, port: number = 0, extensionPath?: string): Promise<ProxyServer> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url && req.url.startsWith('/vpp-image-proxy')) {
                try {
                    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                    const targetUrlStr = parsedUrl.searchParams.get('url');
                    const callback = parsedUrl.searchParams.get('callback');
                    const responseType = parsedUrl.searchParams.get('responseType');

                    if (targetUrlStr) {
                        const fetchWithRedirects = (urlStr: string, depth = 0) => {
                            if (depth > 5) {
                                res.writeHead(500, { 'Content-Type': 'text/plain' });
                                res.end('Too many redirects');
                                return;
                            }

                            try {
                                const targetUrl = new URL(urlStr);
                                const isHttps = targetUrl.protocol === 'https:';
                                const requester = isHttps ? https : http;
                                
                                const reqOpts = {
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                                        'Accept-Encoding': 'identity'
                                    },
                                    rejectUnauthorized: false
                                };
                                
                                const proxyReq = requester.get(urlStr, reqOpts, (proxyRes: any) => {
                                    const statusCode = proxyRes.statusCode || 200;
                                    
                                    // Handle HTTP Redirects
                                    if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && proxyRes.headers.location) {
                                        let redirectUrl = proxyRes.headers.location;
                                        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
                                            redirectUrl = new URL(redirectUrl, urlStr).toString();
                                        }
                                        fetchWithRedirects(redirectUrl, depth + 1);
                                        return;
                                    }

                                    const contentType = proxyRes.headers['content-type'] || 'image/png';
                                    
                                    if (!callback && responseType !== 'text') {
                                        res.writeHead(statusCode, {
                                            'Content-Type': contentType,
                                            'Access-Control-Allow-Origin': '*',
                                            'Cache-Control': 'no-cache'
                                        });
                                        proxyRes.pipe(res);
                                        return;
                                    }

                                    const chunks: any[] = [];
                                    proxyRes.on('data', (chunk: any) => {
                                        chunks.push(chunk);
                                    });
                                    proxyRes.on('end', () => {
                                        const buffer = Buffer.concat(chunks);
                                        const base64 = buffer.toString('base64');
                                        const dataUri = `data:${contentType};base64,${base64}`;

                                        if (callback) {
                                            res.writeHead(200, {
                                                'Content-Type': 'application/javascript',
                                                'Access-Control-Allow-Origin': '*'
                                            });
                                            res.end(`${callback}(${JSON.stringify(dataUri)})`);
                                        } else {
                                            res.writeHead(200, {
                                                'Content-Type': 'text/plain',
                                                'Access-Control-Allow-Origin': '*'
                                            });
                                            res.end(dataUri);
                                        }
                                    });
                                });

                                proxyReq.on('error', (err: any) => {
                                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                                    res.end('Proxy fetch error: ' + String(err));
                                });
                            } catch (err) {
                                res.writeHead(500, { 'Content-Type': 'text/plain' });
                                res.end('Proxy URL error: ' + String(err));
                            }
                        };

                        fetchWithRedirects(targetUrlStr);
                        return;
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid proxy request: ' + String(e));
                    return;
                }
            }

            if (req.url === '/vpp-html2canvas.js' && extensionPath) {
                let filePath = path.join(extensionPath, 'node_modules', 'html2canvas-pro', 'dist', 'html2canvas-pro.min.js');
                if (!fs.existsSync(filePath)) {
                    filePath = path.join(extensionPath, 'resources', 'html2canvas-pro.min.js');
                }
                if (fs.existsSync(filePath)) {
                    res.writeHead(200, { 'Content-Type': 'application/javascript' });
                    fs.createReadStream(filePath).pipe(res);
                    return;
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('html2canvas.min.js not found');
                    return;
                }
            }

            const headers = { ...req.headers };
            headers['host'] = `localhost:${targetPort}`;
            // Disable compression so we can safely inject the postMessage navigation helper script
            delete headers['accept-encoding'];

            // Rewrite Origin and Referer headers to match target port.
            // Next.js Server Actions verify that Origin matches Host/X-Forwarded-Host.
            // Since the browser requests the proxy port (e.g. 49602) but Next.js runs on 3000,
            // we align them here so CSRF validation checks succeed.
            if (headers['origin']) {
                try {
                    const originUrl = new URL(headers['origin'] as string);
                    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
                        headers['origin'] = `${originUrl.protocol}//localhost:${targetPort}`;
                    }
                } catch (e) {
                    headers['origin'] = `http://localhost:${targetPort}`;
                }
            }
            if (headers['referer']) {
                try {
                    const refUrl = new URL(headers['referer'] as string);
                    if (refUrl.hostname === 'localhost' || refUrl.hostname === '127.0.0.1') {
                        refUrl.port = targetPort.toString();
                        headers['referer'] = refUrl.toString();
                    }
                } catch (e) { /* ignore */ }
            }

            const opts: http.RequestOptions = {
                hostname: '127.0.0.1', port: targetPort,
                path: req.url || '/', method: req.method,
                headers,
            };
            const pr = http.request(opts, (pres) => {
                const h: Record<string, string | string[]> = {};
                for (const [k, v] of Object.entries(pres.headers)) {
                    if (v !== undefined) h[k] = v as string | string[];
                }
                delete h['x-frame-options'];

                // Strip Content-Security-Policy entirely so that the injected postMessage
                // script is never blocked by inline script restrictions.
                delete h['content-security-policy'];
                delete h['Content-Security-Policy'];

                if (h['set-cookie']) {
                    const c = Array.isArray(h['set-cookie']) ? h['set-cookie'] as string[] : [h['set-cookie'] as string];
                    h['set-cookie'] = rewriteCookies(c);
                }

                const contentType = (h['content-type'] || '').toString().toLowerCase();
                if (contentType.includes('text/html')) {
                    // Remove content-length as we will modify the content size
                    delete h['content-length'];
                    delete h['Content-Length'];

                    const contentEncoding = (h['content-encoding'] || '').toString().toLowerCase();
                    let stream: NodeJS.ReadableStream = pres;
                    let isCompressed = false;

                    if (contentEncoding.includes('gzip')) {
                        stream = pres.pipe(zlib.createGunzip());
                        isCompressed = true;
                    } else if (contentEncoding.includes('deflate')) {
                        stream = pres.pipe(zlib.createInflate());
                        isCompressed = true;
                    } else if (contentEncoding.includes('br')) {
                        stream = pres.pipe(zlib.createBrotliDecompress());
                        isCompressed = true;
                    }

                    if (isCompressed) {
                        delete h['content-encoding'];
                        delete h['Content-Encoding'];
                    }

                    let bodyBuffer = Buffer.alloc(0);
                    stream.on('data', (chunk) => {
                        bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
                    });
                    stream.on('end', () => {
                        let html = bodyBuffer.toString('utf8');
                        const scriptToInject = `
<script id="viewport-pro-helper">
  (function() {
    // 1. Navigation history handler
    window.addEventListener('message', function(e) {
      if (e.data === 'viewport-pro-back') {
        window.history.back();
      } else if (e.data === 'viewport-pro-forward') {
        window.history.forward();
      }
    });

    // 1b. Screenshot capturing handler
    function injectHtml2Canvas() {
        if (window.html2canvas) return;
        const script = document.createElement('script');
        script.src = '/vpp-html2canvas.js';
        script.id = 'vpp-html2canvas-script';
        document.head.appendChild(script);
    }
    if (document.head) {
        injectHtml2Canvas();
    } else {
        window.addEventListener('DOMContentLoaded', injectHtml2Canvas);
    }

    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'vpp-request-screenshot') {
            if (!window.html2canvas) {
                injectHtml2Canvas();
                window.parent.postMessage({ type: 'vpp-screenshot-error', error: 'Screenshot library (html2canvas) is still loading. Please try again.' }, '*');
                return;
            }
            var width = window.innerWidth;
            var height = window.innerHeight;
            var scrollX = window.scrollX || window.pageXOffset || 0;
            var scrollY = window.scrollY || window.pageYOffset || 0;

            window.html2canvas(document.documentElement, {
                useCORS: true,
                allowTaint: false,
                imageTimeout: 5000,
                logging: false,
                proxy: '/vpp-image-proxy',
                backgroundColor: null,
                scale: window.devicePixelRatio || 2,
                width: width,
                height: height,
                scrollX: scrollX,
                scrollY: scrollY,
                windowWidth: width,
                windowHeight: height,
                x: scrollX,
                y: scrollY
            }).then(function(canvas) {
                try {
                    const dataUrl = canvas.toDataURL('image/png');
                    window.parent.postMessage({ type: 'vpp-screenshot-data', dataUrl: dataUrl }, '*');
                } catch(err) {
                    window.parent.postMessage({ type: 'vpp-screenshot-error', error: 'Failed to export image: ' + String(err) }, '*');
                }
            }).catch(function(err) {
                window.parent.postMessage({ type: 'vpp-screenshot-error', error: String(err) }, '*');
            });
        }
    });

    // 2. Background color syncing handler
    function syncBackgroundWithParent() {
        function sendBgColor() {
            try {
                if (!document.body) return;
                // 1. Try body
                let bg = window.getComputedStyle(document.body).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    window.parent.postMessage({ type: 'vpp-bg-color', color: bg }, '*');
                    return;
                }
                // 2. Try html (documentElement)
                bg = window.getComputedStyle(document.documentElement).backgroundColor;
                if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                    window.parent.postMessage({ type: 'vpp-bg-color', color: bg }, '*');
                    return;
                }
                // 3. Try main layout child elements
                const children = document.body.children;
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const tag = child.tagName;
                    if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'LINK') {
                        const childBg = window.getComputedStyle(child).backgroundColor;
                        if (childBg && childBg !== 'rgba(0, 0, 0, 0)' && childBg !== 'transparent') {
                            window.parent.postMessage({ type: 'vpp-bg-color', color: childBg }, '*');
                            return;
                        }
                    }
                }
            } catch (e) {}
        }

        let transitionTimeout = null;
        let transitionInterval = null;

        function startTransitionSync() {
            if (transitionInterval) clearInterval(transitionInterval);
            if (transitionTimeout) clearTimeout(transitionTimeout);

            // Poll very fast (every 30ms) for 1000ms to catch CSS transitions smoothly
            transitionInterval = setInterval(sendBgColor, 30);
            transitionTimeout = setTimeout(() => {
                clearInterval(transitionInterval);
                transitionInterval = null;
            }, 1000);
        }

        sendBgColor();
        window.addEventListener('DOMContentLoaded', function() {
            sendBgColor();
            startTransitionSync();
        });
        window.addEventListener('load', function() {
            sendBgColor();
            startTransitionSync();
        });
        setInterval(sendBgColor, 2000); // Low-frequency fallback

        try {
            const observer = new MutationObserver(function(mutations) {
                var shouldSync = false;
                for (var i = 0; i < mutations.length; i++) {
                    var m = mutations[i];
                    if (m.type === 'attributes') {
                        var target = m.target;
                        if (target === document.body || target === document.documentElement || target.tagName === 'DIV' || target.tagName === 'MAIN') {
                            shouldSync = true;
                            break;
                        }
                    }
                }
                if (shouldSync) {
                    sendBgColor();
                    startTransitionSync();
                }
            });
            observer.observe(document.documentElement, { attributes: true, subtree: true });

            window.addEventListener('transitionstart', function(e) {
                var target = e.target;
                if (target && (target === document.body || target === document.documentElement || target.tagName === 'DIV' || target.tagName === 'MAIN')) {
                    if (e.propertyName && (e.propertyName.indexOf('background') !== -1 || e.propertyName.indexOf('color') !== -1)) {
                        sendBgColor();
                        startTransitionSync();
                    }
                }
            });
        } catch (e) {}
    }

    if (document.body) {
        syncBackgroundWithParent();
    } else {
        window.addEventListener('DOMContentLoaded', syncBackgroundWithParent);
    }

    // 3. DOM initialization
    function initHelper() {
        const body = document.body;
        if (!body || document.getElementById('webframe-pro-floater')) return;

        // 3. Inject premium floating development controls styles inside the iframe DOM (uses browser backticks)
        const style = document.createElement('style');
        style.id = 'webframe-pro-floater-style';
        style.textContent = \`
            #webframe-pro-floater { 
                position: fixed !important; 
                left: 16px; 
                top: 50%; 
                transform: translateY(-50%); 
                width: 38px !important; 
                height: 38px; 
                border-radius: 19px !important; 
                background: rgba(15, 15, 15, 0.65) !important; 
                border: 1px solid rgba(255, 255, 255, 0.15) !important; 
                backdrop-filter: blur(12px) !important; 
                -webkit-backdrop-filter: blur(12px) !important; 
                color: #ffffff !important; 
                display: flex !important; 
                flex-direction: column !important; 
                align-items: center !important; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important; 
                z-index: 2147483647 !important; 
                transition: opacity 0.2s, transform 0.2s, background 0.2s, border-color 0.2s, height 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important; 
                opacity: 0.55 !important; 
                user-select: none !important; 
                -webkit-user-select: none !important; 
                overflow: hidden !important; 
                padding: 0 !important; 
                box-sizing: border-box !important; 
            } 
            #webframe-pro-floater:hover { 
                opacity: 1 !important; 
                background: rgba(10, 10, 10, 0.8) !important; 
                border-color: rgba(255, 255, 255, 0.25) !important; 
            } 
            #webframe-pro-floater.vpp-expanded { 
                height: 160px; 
            } 
            #webframe-pro-floater button { 
                width: 36px !important; 
                height: 36px !important; 
                border-radius: 50% !important; 
                border: none !important; 
                background: transparent !important; 
                color: #e2e2e2 !important; 
                cursor: pointer !important; 
                display: flex !important; 
                align-items: center !important; 
                justify-content: center !important; 
                outline: none !important; 
                padding: 0 !important; 
                transition: color 0.15s !important; 
                flex-shrink: 0 !important; 
                box-sizing: border-box !important; 
            } 
            #webframe-pro-floater button svg {
                transition: transform 0.15s ease !important;
            }
            #webframe-pro-floater button:hover { 
                background: transparent !important; 
                color: #ffffff !important; 
                } 
            #webframe-pro-floater button:hover svg {
                transform: scale(1.18) !important;
            }
            #vpp-btn-trigger { 
                margin: 0 !important; 
            } 
            #webframe-pro-floater-actions { 
                display: flex !important; 
                flex-direction: column !important; 
                align-items: center !important; 
                gap: 2px !important; 
                opacity: 0 !important; 
                transition: opacity 0.2s !important; 
                pointer-events: none !important; 
                margin-top: 4px !important; 
                flex-shrink: 0 !important; 
            } 
            #webframe-pro-floater.vpp-expanded #webframe-pro-floater-actions { 
                opacity: 1 !important; 
                pointer-events: auto !important; 
            } 
        \`;
        const targetHead = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
        targetHead.appendChild(style);

        const floater = document.createElement('div');
        floater.id = 'webframe-pro-floater';
        floater.innerHTML = \`
            <button id="vpp-btn-trigger" title="Drag to reposition, Click to expand dev tools">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l-.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <div id="webframe-pro-floater-actions">
                <button id="vpp-btn-back" title="Go Back">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <button id="vpp-btn-forward" title="Go Forward">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <button id="vpp-btn-reload" title="Reload Page">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                </button>
            </div>
        \`;

        document.body.appendChild(floater);

        const triggerBtn = document.getElementById('vpp-btn-trigger');

        // Assistive Touch Dragging Logic
        let isDraggingFloater = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let initialLeft = 16;
        let initialTop = window.innerHeight / 2 - 19;
        let hasDragged = false;

        triggerBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            isDraggingFloater = true;
            hasDragged = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const rect = floater.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            floater.style.transition = 'none';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDraggingFloater) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasDragged = true;
            }

            const currentHeight = floater.offsetHeight || 38;
            const newLeft = Math.max(8, Math.min(window.innerWidth - 38 - 8, initialLeft + dx));
            const newTop = Math.max(8, Math.min(window.innerHeight - currentHeight - 8, initialTop + dy));

            floater.style.left = newLeft + 'px';
            floater.style.top = newTop + 'px';
            floater.style.right = 'auto';
            floater.style.bottom = 'auto';
            floater.style.transform = 'none';
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingFloater) {
                isDraggingFloater = false;
                // Re-enable smooth transition for placement updates (left)
                floater.style.transition = 'opacity 0.2s, transform 0.2s, background 0.2s, height 0.2s cubic-bezier(0.4, 0, 0.2, 1), left 0.35s cubic-bezier(0.25, 1, 0.25, 1)';
                
                const rect = floater.getBoundingClientRect();
                const midX = window.innerWidth / 2;
                let targetLeft = 16;
                if (rect.left + rect.width / 2 > midX) {
                    targetLeft = window.innerWidth - 38 - 16;
                }
                floater.style.left = targetLeft + 'px';
            }
        });

        // Click handler on trigger button with drag separation
        triggerBtn.addEventListener('click', (e) => {
            if (hasDragged) {
                e.preventDefault();
                return;
            }
            floater.classList.toggle('vpp-expanded');
        });

        document.getElementById('vpp-btn-back').addEventListener('click', () => {
            window.history.back();
        });

        document.getElementById('vpp-btn-forward').addEventListener('click', () => {
            window.history.forward();
        });

        document.getElementById('vpp-btn-reload').addEventListener('click', () => {
            window.location.reload();
        });

        // Keep the floating controls in DOM even if wiped by React SPA transitions / Hot Module Replaces
        const observer = new MutationObserver(() => {
            if (!document.body.contains(floater)) {
                document.body.appendChild(floater);
            }
            if (!document.head.contains(style)) {
                document.head.appendChild(style);
            }
        });
        observer.observe(document.body, { childList: true });
    }

    // Wait for DOM to be interactive before starting helper initialization
    if (document.body) {
        setTimeout(initHelper, 150);
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(initHelper, 150);
        });
    }
  })();
</script>
`;
                        if (/<\/body>/i.test(html)) {
                            html = html.replace(/<\/body>/i, scriptToInject + '</body>');
                        } else if (/<\/html>/i.test(html)) {
                            html = html.replace(/<\/html>/i, scriptToInject + '</html>');
                        } else {
                            html += scriptToInject;
                        }
                        res.writeHead(pres.statusCode || 200, h);
                        res.end(html);
                    });
                } else {
                    res.writeHead(pres.statusCode || 200, h);
                    pres.pipe(res, { end: true });
                }
            });
            pr.on('error', () => {
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                        <head>
                            <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #333; }
                                @media (prefers-color-scheme: dark) {
                                    body { color: #cccccc; }
                                }
                            </style>
                        </head>
                        <body>
                            <h3>Dev server unreachable on port ${targetPort}</h3>
                        </body>
                        </html>
                    `);
                }
            });
            req.pipe(pr, { end: true });
        });

        server.on('upgrade', (req, socket, head) => {
            const up = net.connect(targetPort, '127.0.0.1', () => {
                const hdrs = Object.entries(req.headers)
                    .map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v))
                    .join('\r\n');
                up.write(req.method + ' ' + req.url + ' HTTP/1.1\r\nHost: localhost:' + targetPort + '\r\n' + hdrs + '\r\n\r\n');
                if (head && head.length > 0) up.write(head);
            });
            up.pipe(socket); socket.pipe(up);
            up.on('error', () => socket.destroy());
            socket.on('error', () => up.destroy());
        });

        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const addr = server.address() as net.AddressInfo;
            resolve({
                port: addr.port, targetPort,
                stop: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res()))
            });
        });
    });
}
