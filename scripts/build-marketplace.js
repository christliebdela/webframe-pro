const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const sidebarHtmlPath = path.join(rootDir, 'ui', 'sidebar.html');
const readmePath = path.join(rootDir, 'README.md');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

console.log('Starting WebFrame Plus marketplace packaging process...');

// Read original files
const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
const originalSidebarHtml = fs.readFileSync(sidebarHtmlPath, 'utf8');
const originalReadme = fs.readFileSync(readmePath, 'utf8');
const originalChangelog = fs.readFileSync(changelogPath, 'utf8');

try {
  // Parse package.json
  const pkg = JSON.parse(originalPackageJson);
  
  // Apply modifications for marketplace build
  pkg.name = 'webframe-plus';
  pkg.displayName = 'WebFrame Plus';
  
  if (pkg.contributes && pkg.contributes.viewsContainers && pkg.contributes.viewsContainers.activitybar) {
    pkg.contributes.viewsContainers.activitybar[0].title = 'WebFrame Plus';
  }
  
  if (pkg.contributes && pkg.contributes.commands && pkg.contributes.commands[0]) {
    pkg.contributes.commands[0].title = 'WebFrame Plus: Open Preview';
  }

  // Write modified package.json
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2), 'utf8');
  console.log('Temporarily renamed extension to "webframe-plus" in package.json');

  // Modify sidebar.html (branding)
  let modifiedSidebarHtml = originalSidebarHtml
    .replace('<title>WebFrame Pro</title>', '<title>WebFrame Plus</title>')
    .replace('<div class="placeholder-title">WebFrame Pro</div>', '<div class="placeholder-title">WebFrame Plus</div>');

  fs.writeFileSync(sidebarHtmlPath, modifiedSidebarHtml, 'utf8');
  console.log('Temporarily updated branding to "WebFrame Plus" in sidebar.html');

  // Modify README and CHANGELOG
  const modifiedReadme = originalReadme.replace(/WebFrame Pro/g, 'WebFrame Plus');
  const modifiedChangelog = originalChangelog.replace(/WebFrame Pro/g, 'WebFrame Plus');
  fs.writeFileSync(readmePath, modifiedReadme, 'utf8');
  fs.writeFileSync(changelogPath, modifiedChangelog, 'utf8');
  console.log('Temporarily updated README.md and CHANGELOG.md to "WebFrame Plus" branding');

  // Run compile and package
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  console.log('Running compilation...');
  execSync(`${npmCmd} run compile`, { stdio: 'inherit', cwd: rootDir });

  console.log('Packaging extension with vsce...');
  execSync(`${npxCmd} @vscode/vsce package`, { stdio: 'inherit', cwd: rootDir });

  console.log('Marketplace package built successfully!');
} catch (error) {
  console.error('Packaging failed:', error);
  process.exitCode = 1;
} finally {
  // Always restore original files
  fs.writeFileSync(packageJsonPath, originalPackageJson, 'utf8');
  fs.writeFileSync(sidebarHtmlPath, originalSidebarHtml, 'utf8');
  fs.writeFileSync(readmePath, originalReadme, 'utf8');
  fs.writeFileSync(changelogPath, originalChangelog, 'utf8');
  console.log('Restored original package.json, sidebar.html, README.md, and CHANGELOG.md');
}
