import * as fs from 'fs';
import * as path from 'path';

export interface DeviceMetadata {
    name: string;
    width: number;
    height: number;
    viewportX: number;
    viewportY: number;
    viewportWidth: number;
    viewportHeight: number;
    borderRadius: number;
    statusBarHeight?: number;
    statusBarPadding?: number;
    statusBarFontSize?: number;
}

export const DEVICES: { [key: string]: DeviceMetadata } = {
    'iphone-16-pro': {
        name: 'iPhone 16 Pro',
        width: 409,
        height: 868,
        viewportX: 8,
        viewportY: 8,
        viewportWidth: 393,
        viewportHeight: 852,
        borderRadius: 45,
        statusBarHeight: 52,
        statusBarPadding: 32,
        statusBarFontSize: 14
    },
    'iphone-16': {
        name: 'iPhone 16',
        width: 413,
        height: 872,
        viewportX: 10,
        viewportY: 10,
        viewportWidth: 393,
        viewportHeight: 852,
        borderRadius: 45,
        statusBarHeight: 47,
        statusBarPadding: 30,
        statusBarFontSize: 13
    },
    'iphone-14-promax': {
        name: 'iPhone 14 Pro Max',
        width: 446,
        height: 948,
        viewportX: 8,
        viewportY: 8,
        viewportWidth: 430,
        viewportHeight: 932,
        borderRadius: 45,
        statusBarHeight: 54,
        statusBarPadding: 32,
        statusBarFontSize: 14
    },
    'iphone-12-pro': {
        name: 'iPhone 12 Pro',
        width: 406,
        height: 860,
        viewportX: 8,
        viewportY: 8,
        viewportWidth: 390,
        viewportHeight: 844,
        borderRadius: 40,
        statusBarHeight: 47,
        statusBarPadding: 30,
        statusBarFontSize: 13
    },
    'iphone-11': {
        name: 'iPhone 11',
        width: 454,
        height: 936,
        viewportX: 20,
        viewportY: 20,
        viewportWidth: 414,
        viewportHeight: 896,
        borderRadius: 34,
        statusBarHeight: 44,
        statusBarPadding: 28,
        statusBarFontSize: 13
    },
    'iphone-se': {
        name: 'iPhone SE',
        width: 352,
        height: 728,
        viewportX: 16,
        viewportY: 80,
        viewportWidth: 320,
        viewportHeight: 568,
        borderRadius: 0,
        statusBarHeight: 20,
        statusBarPadding: 12,
        statusBarFontSize: 12
    },
    'ipad-pro': {
        name: 'iPad Pro',
        width: 756,
        height: 1012,
        viewportX: 24,
        viewportY: 24,
        viewportWidth: 708,
        viewportHeight: 964,
        borderRadius: 20,
        statusBarHeight: 24,
        statusBarPadding: 20,
        statusBarFontSize: 12
    },
    'ipad-air': {
        name: 'iPad Air',
        width: 868,
        height: 1228,
        viewportX: 24,
        viewportY: 24,
        viewportWidth: 820,
        viewportHeight: 1180,
        borderRadius: 16,
        statusBarHeight: 24,
        statusBarPadding: 20,
        statusBarFontSize: 12
    },
    'ipad-mini': {
        name: 'iPad Mini',
        width: 588,
        height: 838,
        viewportX: 24,
        viewportY: 24,
        viewportWidth: 540,
        viewportHeight: 790,
        borderRadius: 16,
        statusBarHeight: 24,
        statusBarPadding: 20,
        statusBarFontSize: 12
    },
    'pixel-9': {
        name: 'Google Pixel 9',
        width: 395,
        height: 845,
        viewportX: 10,
        viewportY: 10,
        viewportWidth: 375,
        viewportHeight: 825,
        borderRadius: 36,
        statusBarHeight: 48,
        statusBarPadding: 24,
        statusBarFontSize: 13
    },
    'pixel-fold': {
        name: 'Google Pixel Fold',
        width: 564,
        height: 684,
        viewportX: 12,
        viewportY: 12,
        viewportWidth: 540,
        viewportHeight: 660,
        borderRadius: 16,
        statusBarHeight: 30,
        statusBarPadding: 20,
        statusBarFontSize: 12
    },
    'galaxy-s25': {
        name: 'Samsung S25 Ultra',
        width: 411,
        height: 906,
        viewportX: 8,
        viewportY: 8,
        viewportWidth: 395,
        viewportHeight: 890,
        borderRadius: 12,
        statusBarHeight: 40,
        statusBarPadding: 24,
        statusBarFontSize: 13
    },
    'galaxy-s20-ultra': {
        name: 'Samsung S20 Ultra',
        width: 428,
        height: 931,
        viewportX: 8,
        viewportY: 8,
        viewportWidth: 412,
        viewportHeight: 915,
        borderRadius: 24,
        statusBarHeight: 36,
        statusBarPadding: 20,
        statusBarFontSize: 13
    },
    'galaxy-a55': {
        name: 'Samsung Galaxy A55',
        width: 408,
        height: 878,
        viewportX: 14,
        viewportY: 14,
        viewportWidth: 380,
        viewportHeight: 850,
        borderRadius: 24,
        statusBarHeight: 36,
        statusBarPadding: 20,
        statusBarFontSize: 13
    },
    'surface-pro-7': {
        name: 'Microsoft Surface Pro 7',
        width: 976,
        height: 1432,
        viewportX: 32,
        viewportY: 32,
        viewportWidth: 912,
        viewportHeight: 1368,
        borderRadius: 4,
        statusBarHeight: 0,
        statusBarPadding: 0,
        statusBarFontSize: 0
    },
    'nest-hub': {
        name: 'Google Nest Hub',
        width: 1084,
        height: 660,
        viewportX: 30,
        viewportY: 30,
        viewportWidth: 1024,
        viewportHeight: 600,
        borderRadius: 16,
        statusBarHeight: 0,
        statusBarPadding: 0,
        statusBarFontSize: 0
    }
};

/**
 * Ensures all device frame assets (metadata.json and frame.svg) are generated on disk.
 */
export function ensureDeviceAssets(extensionPath: string): void {
    const assetsDir = path.join(extensionPath, 'assets');
    const devicesDir = path.join(assetsDir, 'devices');

    if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir);
    }
    if (!fs.existsSync(devicesDir)) {
        fs.mkdirSync(devicesDir);
    }

    for (const [key, dev] of Object.entries(DEVICES)) {
        const deviceDir = path.join(devicesDir, key);
        if (!fs.existsSync(deviceDir)) {
            fs.mkdirSync(deviceDir);
        }

        // Write metadata.json
        const metadataPath = path.join(deviceDir, 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(dev, null, 2), 'utf8');

        // Write frame.svg
        const svgPath = path.join(deviceDir, 'frame.svg');
        const svgContent = generateSVG(key, dev);
        fs.writeFileSync(svgPath, svgContent, 'utf8');
    }
}

function getHardwareButtons(key: string, w: number, h: number): string {
    let html = '';
    const btnColor = '#2d2d30';
    const btnStroke = '#4e4e52';
    
    if (key.includes('ipad')) {
        // Power button on top right
        html += `<rect x="${w - 60}" y="-3" width="40" height="3.5" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Up
        html += `<rect x="${w}" y="80" width="3.5" height="30" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Down
        html += `<rect x="${w}" y="120" width="3.5" height="30" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
    } else if (key.includes('iphone') && key !== 'iphone-se') {
        // Modern iPhone: Left buttons (Action/Ring, Volume), Right button (Power)
        // Ring/Action Switch
        html += `<rect x="-3" y="100" width="3.5" height="12" rx="1.5" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Up
        html += `<rect x="-3" y="135" width="3.5" height="24" rx="1.5" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Down
        html += `<rect x="-3" y="175" width="3.5" height="24" rx="1.5" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Side Power Button (Right)
        html += `<rect x="${w}" y="150" width="3.5" height="40" rx="2" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        
        // iPhone 16 Camera Control (Bottom Right, slightly recessed)
        if (key.includes('iphone-16')) {
            html += `<rect x="${w}" y="${h - 220}" width="1.5" height="26" rx="1" fill="#1b1b1d" stroke="#3c3c3e" stroke-width="0.5" />`;
        }
    } else if (key === 'iphone-se') {
        // iPhone SE (based on iPhone 8): Left buttons, Right button
        // Ring Switch
        html += `<rect x="-2.5" y="80" width="3" height="10" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Up
        html += `<rect x="-2.5" y="110" width="3" height="16" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Down
        html += `<rect x="-2.5" y="140" width="3" height="16" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Power Button (Right)
        html += `<rect x="${w}" y="115" width="3" height="30" rx="1.5" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
    } else if (key.includes('pixel') || key.includes('galaxy')) {
        // Android Phones: All buttons on the right side
        // Power Button
        html += `<rect x="${w}" y="130" width="3" height="22" rx="1.5" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume Rocker
        html += `<rect x="${w}" y="170" width="3" height="45" rx="2" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
    } else if (key === 'surface-pro-7') {
        // Surface: Top Left Power & Volume
        // Power
        html += `<rect x="40" y="-3" width="35" height="3.5" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
        // Volume
        html += `<rect x="90" y="-3" width="45" height="3.5" rx="1" fill="${btnColor}" stroke="${btnStroke}" stroke-width="0.5" />`;
    }
    
    return html;
}

function generateSVG(key: string, dev: DeviceMetadata): string {
    const w = dev.width;
    const h = dev.height;
    // Mathematically concentric: outer radius = inner screen radius + bezel width.
    // iPhone SE has square screen corners but highly rounded physical chassis outer edges (36px).
    const rx = key === 'iphone-se' ? 36 : (dev.borderRadius > 0 ? dev.borderRadius + dev.viewportX : 10);
    const innerRx = dev.borderRadius;

    // Outer path (clockwise)
    const outerPath = `M ${rx} 2 h ${w - 2 * rx} a ${rx} ${rx} 0 0 1 ${rx} ${rx} v ${h - 2 * rx - 4} a ${rx} ${rx} 0 0 1 -${rx} ${rx} h -${w - 2 * rx} a ${rx} ${rx} 0 0 1 -${rx} -${rx} v -${h - 2 * rx - 4} a ${rx} ${rx} 0 0 1 ${rx} -${rx} Z`;
    
    // Viewport cutout path (counter-clockwise)
    const vx = dev.viewportX;
    const vy = dev.viewportY;
    const vw = dev.viewportWidth;
    const vh = dev.viewportHeight;
    const vr = innerRx;

    let innerPath = '';
    if (vr > 0) {
        innerPath = `M ${vx + vr} ${vy} h ${vw - 2 * vr} a ${vr} ${vr} 0 0 1 ${vr} ${vr} v ${vh - 2 * vr} a ${vr} ${vr} 0 0 1 -${vr} ${vr} h -${vw - 2 * vr} a ${vr} ${vr} 0 0 1 -${vr} -${vr} v -${vh - 2 * vr} a ${vr} ${vr} 0 0 1 ${vr} -${vr} Z`;
    } else {
        innerPath = `M ${vx} ${vy} h ${vw} v ${vh} h -${vw} Z`;
    }

    // Cutout combination
    const mainFramePath = `${outerPath} ${innerPath}`;

    let hardwareDetails = '';
    
    if (key.includes('iphone-16') || key.includes('iphone-14-promax')) {
        // Dynamic Island (Solid black cutout, no outline stroke)
        const islandW = key.includes('pro') ? 115 : 100;
        const islandH = 28;
        const islandX = (w - islandW) / 2;
        const islandY = vy + 12;
        hardwareDetails += `
            <!-- Minimalist Dynamic Island -->
            <rect x="${islandX}" y="${islandY}" width="${islandW}" height="${islandH}" rx="14" fill="#000000" />
            <circle cx="${islandX + islandW - 20}" cy="${islandY + 14}" r="4" fill="#111113" />
        `;
    } else if (key === 'iphone-11' || key === 'iphone-12-pro') {
        const notchW = key === 'iphone-12-pro' ? 140 : 180;
        const notchX = (w - notchW) / 2;
        const notchY = vy;
        
        let speakerHtml = '';
        if (key === 'iphone-12-pro') {
            // Speaker is in the top bezel above the notch (width is ~40px)
            speakerHtml = `<rect x="${w / 2 - 20}" y="3" width="40" height="2" rx="1" fill="#151518" stroke="#333336" stroke-width="0.8" />`;
        } else {
            // Speaker is inside the notch at the top (width is ~40px to stay proportional to sensors)
            speakerHtml = `<rect x="${w / 2 - 20}" y="${notchY + 5}" width="40" height="3.5" rx="1.75" fill="#151518" stroke="#333336" stroke-width="1" />`;
        }

        hardwareDetails += `
            <!-- Wide Notch (overlaps 3px into bezel to prevent sub-pixel anti-aliasing white lines) -->
            <path d="M ${notchX} ${notchY - 3} v 19 a 14 14 0 0 0 14 14 h ${notchW - 28} a 14 14 0 0 0 14 -14 v -19" fill="#000000" />
            <!-- Speaker Grille -->
            ${speakerHtml}
            <!-- Front Camera -->
            <circle cx="${w / 2 + (key === 'iphone-12-pro' ? 20 : 35)}" cy="${notchY + 16}" r="3.5" fill="#111113" />
        `;
    } else if (key === 'iphone-se') {
        hardwareDetails += `
            <!-- Minimalist Speaker & Camera -->
            <rect x="${w / 2 - 25}" y="42" width="50" height="4" rx="2" fill="none" stroke="#77777a" stroke-width="1.5" />
            <circle cx="${w / 2 - 45}" cy="44" r="4" fill="none" stroke="#77777a" stroke-width="1.5" />
            <!-- Minimalist Home Button Outline -->
            <circle cx="${w / 2}" cy="${h - 45}" r="22" fill="none" stroke="#77777a" stroke-width="1.5" />
        `;
    } else if (key === 'pixel-9' || key === 'galaxy-a55' || key === 'galaxy-s25' || key === 'galaxy-s20-ultra') {
        hardwareDetails += `
            <!-- Camera Hole Punch (Pure black, no outline) -->
            <circle cx="${w / 2}" cy="${vy + 16}" r="6" fill="#000000" />
        `;
    } else if (key === 'pixel-fold') {
        hardwareDetails += `
            <!-- Folding Hinge Line -->
            <line x1="${w / 2}" y1="${vy}" x2="${w / 2}" y2="${vy + vh}" stroke="#555557" stroke-width="1.5" stroke-dasharray="4 4" />
        `;
    }



    const buttonsHtml = getHardwareButtons(key, w, h);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 12}" height="${h + 12}" viewBox="-6 -6 ${w + 12} ${h + 12}" fill="none">
  <!-- Solid Bezel Fill (No Stroke, cuts viewport transparent) -->
  <path d="${mainFramePath}" fill="#000000" fill-rule="evenodd" />
  
  <!-- Single Outer Outline Border -->
  <rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${rx}" fill="none" stroke="#77777a" stroke-width="2" />
  
  <!-- Hardware Features -->
  ${hardwareDetails}
  
  <!-- Hardware Buttons -->
  ${buttonsHtml}
</svg>`;
}
