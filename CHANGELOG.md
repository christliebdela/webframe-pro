# Changelog

## 0.0.3

### Fixed
- **README Screenshot Link**: Fixed the screenshot display on the Open VSX / VS Code Extension marketplace by using an absolute raw GitHub URL instead of a relative path inside the HTML `<img>` tag.

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
