/**
 * Root server proxy / entry point
 * Automatically starts both:
 * 1. Backend API (server/index.js) on port 4000
 * 2. Static Frontend (server/static-server.js) on port 5500
 */
const path = require('path');
const { fork } = require('child_process');

console.log('[Billedkart Realtech] Launching servers...');

// Launch backend Express API
const apiProcess = fork(path.join(__dirname, 'server', 'index.js'), [], {
  cwd: path.join(__dirname, 'server')
});

// Launch frontend static server
const staticProcess = fork(path.join(__dirname, 'server', 'static-server.js'), [], {
  cwd: __dirname
});

function handleExit(code) {
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
  if (staticProcess && !staticProcess.killed) staticProcess.kill();
  process.exit(code);
}

process.on('SIGINT', () => handleExit(0));
process.on('SIGTERM', () => handleExit(0));
process.on('exit', () => handleExit(0));

