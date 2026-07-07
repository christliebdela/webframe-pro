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
    // 0. EARLIEST POSSIBLE: Suppress Supabase stale refresh token errors & clear stale session
    try {
      function isSupabaseRefreshTokenError(msg) {
        return typeof msg === 'string' && msg.includes('Refresh Token Not Found');
      }

      // Only remove actual session tokens if they are genuinely expired.
      // If the user just logged in, DO NOT clear — the error is just a
      // Supabase refresh-token rotation race (e.g. React StrictMode double-invoke).
      function hasValidSupabaseSession() {
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key) continue;
            if ((key.startsWith('sb-') || key.includes('supabase.auth.token')) &&
                !key.includes('pkce') && !key.includes('code-verifier') &&
                !key.includes('state') && !key.includes('nonce')) {
              var raw = localStorage.getItem(key);
              if (!raw) continue;
              var val = JSON.parse(raw);
              // Session token has expires_at (Unix seconds). If it's still in the future, session is valid.
              var expiresAt = val && (val.expires_at || (val.session && val.session.expires_at));
              if (expiresAt && (expiresAt * 1000) > Date.now()) return true;
              // Also accept if access_token exists and expires_at is missing (older Supabase versions)
              var hasToken = val && (val.access_token || (val.session && val.session.access_token));
              if (hasToken && !expiresAt) return true;
            }
          }
        } catch(e) { /* ignore parse errors */ }
        return false;
      }

      function clearStaleSupabaseSession() {
        // If there's already a valid session, this error is just a token rotation
        // race condition — suppress it but DO NOT clear the session.
        if (hasValidSupabaseSession()) return;
        try {
          var keysToRemove = [];
          for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key) continue;
            var isSessionKey = (key.startsWith('sb-') || key.includes('supabase.auth.token')) &&
                               !key.includes('pkce') &&
                               !key.includes('code-verifier') &&
                               !key.includes('state') &&
                               !key.includes('nonce');
            if (isSessionKey) keysToRemove.push(key);
          }
          keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
          if (keysToRemove.length > 0) {
            console.info('[WebFrame Pro] Cleared ' + keysToRemove.length + ' stale Supabase session key(s). Re-authenticate to continue.');
          }
        } catch (e) { /* ignore */ }
      }

      // Extract a loggable string from any console argument, including Error objects
      // (JSON.stringify(new Error()) returns "{}" because Error props are non-enumerable)
      function extractArgMsg(arg) {
        if (typeof arg === 'string') return arg;
        if (arg && typeof arg === 'object') {
          // Error or Error subclass — pull message + name directly
          if (typeof arg.message === 'string') return (arg.name || '') + ': ' + arg.message;
          try { return JSON.stringify(arg); } catch(e) { return String(arg); }
        }
        return String(arg);
      }

      // Build a locked console.error patcher that Next.js CANNOT override
      function makeLockedConsolePatch(originalFn) {
        var _orig = originalFn;
        var patched = function() {
          var msg = '';
          for (var i = 0; i < arguments.length; i++) {
            msg += extractArgMsg(arguments[i]) + ' ';
          }
          if (isSupabaseRefreshTokenError(msg)) {
            clearStaleSupabaseSession();
            return;
          }
          _orig.apply(console, arguments);
        };
        return patched;
      }

      // Lock console.error so frameworks (Next.js) cannot re-patch it over us
      var _patchedConsoleError = makeLockedConsolePatch(console.error);
      try {
        Object.defineProperty(console, 'error', {
          get: function() { return _patchedConsoleError; },
          set: function(fn) {
            // If Next.js tries to replace console.error, wrap the new fn too
            _patchedConsoleError = makeLockedConsolePatch(fn);
          },
          configurable: true
        });
      } catch(e) {
        // Fallback if defineProperty is blocked
        console.error = _patchedConsoleError;
      }

      // Capture-phase unhandledrejection — fires before Next.js bubble listeners
      window.addEventListener('unhandledrejection', function(event) {
        if (event && event.reason) {
          var msg = String(event.reason.message || event.reason);
          if (isSupabaseRefreshTokenError(msg)) {
            clearStaleSupabaseSession();
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }
      }, true);

      // window.onerror for synchronous throws
      var _origOnError = window.onerror;
      window.onerror = function(message) {
        if (isSupabaseRefreshTokenError(String(message || ''))) {
          return true; // suppress without clearing (won't be a stale token case)
        }
        return _origOnError ? _origOnError.apply(this, arguments) : false;
      };
    } catch(e) { /* ignore */ }


    // 1. Navigation history handler
    window.addEventListener('message', function(e) {
      if (e.data === 'viewport-pro-back') {
        window.history.back();
      } else if (e.data === 'viewport-pro-forward') {
        window.history.forward();
      }
    });

    // 1a. URL change tracking
    function notifyUrlChange() {
      try {
        window.parent.postMessage({
          type: 'vpp-url-changed',
          url: window.location.href,
          path: window.location.pathname + window.location.search + window.location.hash
        }, '*');
      } catch (err) { /* silent fallback */ }
    }

    window.addEventListener('popstate', notifyUrlChange);
    window.addEventListener('hashchange', notifyUrlChange);

    try {
      const originalPushState = history.pushState;
      history.pushState = function() {
        originalPushState.apply(this, arguments);
        notifyUrlChange();
      };

      const originalReplaceState = history.replaceState;
      history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        notifyUrlChange();
      };
    } catch (e) { /* ignore security/compatibility block */ }

    // Initial load sync
    if (document.readyState === 'complete') {
      notifyUrlChange();
    } else {
      window.addEventListener('load', notifyUrlChange);
    }

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
                height: 38px !important; 
                border-radius: 19px !important; 
                background: rgba(30, 30, 30, 0.75) !important; 
                border: 1px solid rgba(255, 255, 255, 0.1) !important; 
                backdrop-filter: blur(20px) !important; 
                -webkit-backdrop-filter: blur(20px) !important; 
                color: #ffffff !important; 
                box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important; 
                z-index: 2147483647 !important; 
                transition: transform 0.2s, background 0.2s, border-color 0.2s, height 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.2s, left 0.2s !important; 
                opacity: 1 !important; /* Keep container always frosted */
                user-select: none !important; 
                -webkit-user-select: none !important; 
                overflow: hidden !important; 
                padding: 0 !important; 
                box-sizing: border-box !important; 
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
            } 
            #webframe-pro-floater.vpp-expanded { 
                height: 180px !important; 
            } 
            #vpp-btn-trigger { 
                width: 36px !important;
                height: 36px !important;
                border: none !important;
                background: transparent !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 !important;
                flex-shrink: 0 !important;
                z-index: 100 !important;
                opacity: 0.55 !important;
                transition: opacity 0.15s ease !important;
            } 
            #webframe-pro-floater:hover #vpp-btn-trigger,
            #webframe-pro-floater.vpp-expanded #vpp-btn-trigger {
                opacity: 1 !important;
            }
            .vpp-assistive-touch-circle {
                width: 18px !important;
                height: 18px !important;
                border-radius: 50% !important;
                background: rgba(255, 255, 255, 0.4) !important;
                border: 2.5px solid rgba(255, 255, 255, 0.85) !important;
                box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15) !important;
                transition: background 0.15s, transform 0.15s !important;
            }
            #webframe-pro-floater:hover .vpp-assistive-touch-circle {
                background: rgba(255, 255, 255, 0.65) !important;
                transform: scale(1.1) !important;
            }
            #webframe-pro-floater-actions { 
                display: flex !important; 
                flex-direction: column !important;
                align-items: center !important;
                gap: 4px !important;
                padding: 0 0 4px 0 !important;
                opacity: 0 !important; 
                transition: opacity 0.2s !important; 
                pointer-events: none !important; 
                box-sizing: border-box !important;
                width: 38px !important;
                flex-shrink: 0 !important;
            } 
            #webframe-pro-floater.vpp-expanded #webframe-pro-floater-actions { 
                opacity: 1 !important; 
                pointer-events: auto !important; 
            } 
            .vpp-action-btn { 
                width: 32px !important; 
                height: 32px !important; 
                border-radius: 50% !important; 
                border: none !important; 
                background: rgba(255, 255, 255, 0.1) !important; 
                color: #ffffff !important; 
                cursor: pointer !important; 
                display: flex !important; 
                align-items: center !important; 
                justify-content: center !important; 
                outline: none !important; 
                padding: 0 !important; 
                transition: background 0.15s, transform 0.15s, opacity 0.15s !important; 
                box-sizing: border-box !important; 
                opacity: 0.6 !important;
            } 
            .vpp-action-btn svg {
                transition: transform 0.15s ease !important;
                width: 14px !important;
                height: 14px !important;
                color: #ffffff !important;
            }
            .vpp-action-btn:hover { 
                background: rgba(255, 255, 255, 0.2) !important; 
                transform: scale(1.1) !important; 
                opacity: 1 !important;
            } 
            .vpp-action-btn:hover svg {
                transform: scale(1.15) !important;
            }
            #webframe-pro-floater.vpp-expanded .vpp-action-btn {
                opacity: 0.8 !important;
            }
            #webframe-pro-floater.vpp-expanded .vpp-action-btn:hover {
                opacity: 1 !important;
            }
        \`;
        const targetHead = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
        targetHead.appendChild(style);

        const floater = document.createElement('div');
        floater.id = 'webframe-pro-floater';
        floater.innerHTML = \`
            <button id="vpp-btn-trigger">
                <div class="vpp-assistive-touch-circle"></div>
            </button>
            <div id="webframe-pro-floater-actions">
                <button id="vpp-btn-rotate" class="vpp-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12A8 8 0 0 1 12 4v4l5-5-5-5v4A10 10 0 0 0 2 12h2z"></path><rect x="8" y="10" width="10" height="12" rx="1"></rect></svg>
                </button>
                <button id="vpp-btn-sleep" class="vpp-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                </button>
                <button id="vpp-btn-screenshot" class="vpp-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                </button>
                <button id="vpp-btn-scroll-top" class="vpp-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
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
            e.stopPropagation(); // Stop propagation to prevent immediate click-outside closing
            if (hasDragged) {
                e.preventDefault();
                return;
            }
            floater.classList.toggle('vpp-expanded');
        });

        // Close AssistiveTouch menu when clicking outside
        window.addEventListener('click', (e) => {
            if (floater.classList.contains('vpp-expanded')) {
                if (!floater.contains(e.target)) {
                    floater.classList.remove('vpp-expanded');
                }
            }
        });

        document.getElementById('vpp-btn-rotate').addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.parent.postMessage({ type: 'vpp-trigger-orientation' }, '*');
            } catch (err) { /* silent fail */ }
        });

        document.getElementById('vpp-btn-sleep').addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.parent.postMessage({ type: 'vpp-trigger-power' }, '*');
            } catch (err) { /* silent fail */ }
        });

        document.getElementById('vpp-btn-scroll-top').addEventListener('click', (e) => {
            e.stopPropagation();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        document.getElementById('vpp-btn-screenshot').addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                window.parent.postMessage({ type: 'vpp-trigger-screenshot' }, '*');
            } catch (err) { /* silent fail */ }
        });

        // (Tooltip events removed to prevent hover overlay clashes)

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
