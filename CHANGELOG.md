# Changelog

> [!NOTE]
> WebFrame Pro is under active development. Updates, improvements, and bug fixes are released regularly as the extension continues to evolve.
>
> If you encounter an issue or have a suggestion, please open an issue or submit a pull request on [GitHub](https://github.com/christliebdela/webframe-pro). Your feedback and contributions are always appreciated.


## 0.0.6

### Fixed
- **Zero-Config Supabase Auth Cookie Wiping**: Introduced a proxy server endpoint (`/vpp-clear-cookies`) and wired the client-side session error interceptor to trigger it. When a stale refresh token error is intercepted in the iframe browser console, the extension now automatically sends a Set-Cookie header to clear all `sb-` and `-auth-token` HttpOnly cookies for localhost. This breaks the server-side authentication request loop and resolves rate limits completely without modifying any of the guest application's code.

## 0.0.5

### Added
- **Collapsible URL Bar**: The Address Bar is now hidden by default to preserve vertical editor space. A Globe icon in the main toolbar toggles it open. The bar auto-expands when a session starts and auto-collapses when stopped.
- **Live Sub-route Navigation**: An interactive address bar below the toolbar shows the previewed app's active route in real time. Users can type custom paths (e.g. `/admin`, `/profile`) or full URLs and press Enter to navigate immediately.
- **Full Navigation History Controls**: Back, Forward, and Refresh buttons with a smart history stack — Back/Forward are dynamically enabled/disabled based on position in history.
- **MacBook Pro 14-inch Device**: New desktop viewport (`1512×982`) with a full bezel frame, accurate camera notch, webcam circle, and green status indicator LED rendered via client-side SVG generation.

### Changed & Improved
- **Reload Extension Icon**: Replaced the circular arrow (confused with browser refresh) with a Terminal-Chevron Refresh Loop icon — a refresh ring overlaid with a `>` terminal chevron — clearly signalling an extension backend reload.
- **Status Bar Signal & Battery**: Wi-Fi upgraded to a crisp 3-arc + dot Apple-style SVG; cellular set to full bars; battery icon filled to 100%. Canvas mockup exporter synced to match.

### Fixed
- **Supabase Refresh Token Race (Suppression)**: `console.error` and `unhandledrejection` interceptors now correctly extract message text from Error objects — previously `JSON.stringify(new AuthApiError(...))` returned `"{}"` (non-enumerable properties), silently bypassing the filter. Added `extractArgMsg()` which reads `.name` and `.message` directly.
- **Supabase Session False-Clear**: Added `hasValidSupabaseSession()` to check `expires_at` before clearing `localStorage`. If a valid session exists, the `Refresh Token Not Found` error is now suppressed without touching storage — preventing logged-in users from being kicked out due to Supabase's token rotation race in React StrictMode.

## 0.0.4

### Added
- **Mobile Simulator Screenshot Features**:
  - Implemented high-resolution "Screen Only" and "Device + Screen" (Mockup) captures.
  - Mockups automatically bundle the active viewport screen content, device chassis bezel, status bar info, and home gesture indicators.
  - Proposes a native VS Code file save dialog with default file names prefilled containing the project name, active device name, and a unique 6-digit random number.
- **Auto-Dismissing Saved Notifications**: Integrated auto-closing notification toasts (`withProgress`) that automatically dismiss and slide away after 3 seconds, keeping the VS Code workspace clutter-free.
- **Node-Based CORS Image Proxy**: Added a local proxy endpoint `/vpp-image-proxy` to download cross-origin images on behalf of the client, resolving blank space rendering issues on third-party profile pictures/avatars. Ignores TLS unauthorized certificate errors for dev servers and handles HTTP redirects recursively.

### Changed & Improved
- **html2canvas-pro Integration**: Replaced standard `html2canvas` with `html2canvas-pro` to resolve layout issues with modern CSS features (flexbox, grid) and custom font scaling.
- **Simulator Canvas Blending**: Offset and scaled page content screenshots on the mockup canvas to sit below the status bar (matching the simulator preview), preventing webpage headers and buttons from being hidden.

### Fixed
- **Canvas Taint & Corrupt Exports**: Swapped svg data-URI rendering for direct Canvas 2D vector path rendering (`Path2D` and `roundRect`) for bezel frames and overlays, preventing browser security taint and fixing corrupt 0-byte image exports.
- **Bezel Overflow Clipping**: Added a native `ctx.clip()` mask inside the rounded viewport coordinates to clip webpage backgrounds and status bars, preventing white blocks from bleeding out at the corners of rounded iPhone and Android bezel frames.
- **Zero-Width Canvas Crash**: Fixed a layout query bug where computed style dimensions were queried on the document root instead of `#device-container`, resolving a crash when creating mockup screenshots.
- **Theme Toggle Dual Tooltip**: Removed browser `title` properties and migrated to `data-tooltip` to prevent duplicate system/custom tooltips on the theme toggle button.

## 0.0.3

### Added
- **Built-in Static File Server (Go Live)**: Implemented an embedded HTTP static server that automatically hosts plain HTML/CSS projects on a random pre-allocated port directly from the workspace. It features:
  - **Live Reload & Auto-Save Support**: Integrated a recursive workspace file watcher and Server-Sent Events (SSE) `/vpp-live-reload` endpoint to auto-refresh previews on file saves, using a 100ms debounce buffer to fully support Auto Save.
  - **"Go Live" Action Cards/Buttons**: Added action cards in the configuration popover and a "Host Project (Go Live)" button on the server unreachable overlay for instant one-click hosting.
- **"Server Unreachable" Overlay**: Added a high-contrast real-time error overlay inside the device simulator when target ports are inactive, providing customized troubleshooting guides for Node/Vite, PHP, Python, and static HTML/CSS.
- **"Connecting..." UI Overlay**: Added a dedicated loading overlay with a progress spinner that triggers during port reachability checks to eliminate blank screens.
- **Active File Tracking**: Integrated active editor tracking to automatically route active HTML/PHP file paths to the preview viewport when switching files.
- **Smart Dev-Server Launcher**: Added a "Start Dev Server" button on the unreachable overlay that automatically detects `package.json` dev scripts and opens a VS Code terminal.
- **Custom shadcn/ui Tooltips**: Built custom, premium floating tooltips (featuring dark styling, borders, subtle shadows, and fade/scale transitions) for all main control and configuration buttons.
- **Startup Splash Screen**: Introduced a "Ready to Preview" splash screen state (`isPreviewStarted`) to prevent auto-starting server/proxy connections or displaying errors on initial boot.
- **Active Session Management**: Added a compact session status display and "Stop Session" button inside the configuration popover for active static server instances.

### Changed & Improved
- **Top-Bar Configurations Popover Clean-up**:
  - Removed the "Configurations" header, "Server Type" block, and descriptive subtitle text in the port scanner footer.
  - Replaced interactive source tabs with a static, styled "Local Server" status badge.
  - Stacked the Active Port dropdown and Custom Port input field vertically at 100% width.
  - Converted the Active Ports dropdown into an inline, scrollable list directly visible in the panel.
  - Increased the scan refresh button height to 24px and left-aligned the popover's info footer.
- **Toolbar Refreshes & Theme Toggle**:
  - Rewired the circular toolbar refresh button to wipe global configurations and force-reload the webview itself, updating the tooltip to "Reload Extension".
  - Re-bound the Theme Toggle to update the preview directly.
- **IDE Background & Status Bar Integration**:
  - Integrated the VS Code variable `var(--vscode-sideBar-background)` for the simulator canvas background to blend seamlessly with the IDE theme.
  - Implemented dynamic status bar color syncing using postMessage background color tracking, matching the status bar background and text contrast with the body/html background of the webpage.
  - Changed the status bar battery level to a realistic partial fill of 75%.
- **Custom Port Input UX**:
  - Wrapped Custom Port with a "Launch" button and disabled browser input spinners.
  - Restricted launching to explicit button clicks or pressing "Enter" rather than triggering page reloads while typing.
- **Configuration Panel Simplification**: Consolidated settings into a single card and removed icons from "Launch" and "Host Project (Go Live)" buttons for a cleaner aesthetic.
- **On-Demand Port Scanning**: Defaulted the active ports placeholder to manual scanning ("Click ↻ to scan active ports") and automatically triggers a port scan when clicking/opening the settings gear icon.
- **Modal Auto-Close on Actions**: Configured the Settings popover to automatically close (`closeSettings()`) upon launching a custom port or selecting an active port.

### Fixed
- **README Screenshot Link**: Fixed the screenshot display on the Open VSX / VS Code Extension marketplace by using an absolute raw GitHub URL instead of a relative path inside the HTML `<img>` tag.
- **FOUC & Scale Animation Jitter**: Added a `.preload` helper class to disable transitions during initial page render, removing scaling animations on boot and allowing the device frame to instantly snap to its calculated "Fit" scale.
- **Missing Tab Script Crash**: Initialized dummy instances of removed tab buttons in the webview script to prevent script crashes from event listener registration.
- **Double-Click Go Live Fix**: Pre-allocated static server port ranges (49600-49620) on initialization to prevent VS Code from reloading the webview panel when port mappings update.
- **Type/Null Safety Guards**: Added guards in the webview message listener to safely ignore internal VS Code messages and prevent crashes.
- **Dark Mode Proxy Styles**: Wrapped the proxy's "Dev server unreachable" 502 error in HTML/CSS with media query support for dynamic text color flipping.

## 0.0.2

### Added
- **4-Way Continuous Rotation Loop**: Loops continuously clockwise through Portrait, Landscape, Portrait (Upside Down), Landscape (Flipped), and back to Portrait.
- **Continuous Spin Animation**: Implemented continuous degree tracking (0° -> 90° -> 180° -> 270° -> 360° -> 450°...) on the device chassis and toolbar icon to prevent backward rewinding transitions.
- **Buttery-Smooth UI Transitions**: Added custom cubic-bezier transitions for rotating, scaling, and viewport morphing.
- **Status Bar Clock Real-Time Sync**: Synced status bar clock to system local time, updating dynamically in real-time.
- **Manual Scanning Mode**: Prevented automatic port scanning on startup to preserve system resources; previews now boot up only when the user chooses a port.
- **Screen Power Toggle**: Power button turns off the screen and hides all displays, disabling mouse interactions, with a red light indicator.

### Fixed
- **Home Gesture Bar Docking**: Anchored the home bar to the bottom of the screen in all landscape orientations (Landscape and Landscape Flipped) according to authentic iOS behavior.
- **Status Bar Upside Down Curves**: Retained status bar top curves in portrait-flipped mode so that rotation naturally moves them to the bottom, avoiding mismatched bezel gaps.
- **Landscape Flipped Scaling**: Fixed `applyScale()` so auto-scaling correctly swaps width/height dimensions in Landscape (Flipped) mode.
- **Blocked URL Overlay Centering**: Styled the security blocked screen (`.device-overlay-screen`) to match the viewport container, centering it perfectly within the viewport instead of overlapping the top bezel.
- **Smooth Landscape Status Bar Fading**: Replaced layout snapping (`display: none`) with `opacity` and `visibility` transition curves to fade the status bar out during rotations.
- **Subpixel Border Bleeding**: Removed the top glass edge border on `#device-screen-overlay` to resolve a 0.5px white line bleeding below the status bar.
- **VS Code Focus Outline Bleeding**: Added `outline: none !important` to the viewport iframe, blocking VS Code's native focus ring from bleeding out near the notch when clicked.
- **Dark Mode Status Bar Blend**: Blended status bar and viewport backgrounds into a matching `#0b0b0c` color in dark mode, removing the hard cut line while keeping the black hardware notch distinct.
- **Viewport Bleeding Correction**: Fixed viewport offset calculations in flipped states that caused layout elements and error screens to bleed out from under the bezel.

## 0.0.1
- Initial release of WebFrame Pro.
