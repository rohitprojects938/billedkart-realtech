/**
 * Billedkart Realtech — Hardened Static & Reverse Proxy Server
 * 
 * Security Controls Enforced:
 * 1. Strict Reverse Proxy for /api/ and /socket.io/ to Express backend (port 4000)
 * 2. Absolute Directory Browsing Prevention across all directories
 * 3. Total Protection of Backend Source Code (server/, server.js, .env, package.json, etc.)
 * 4. Protection of Secrets, Database settings, and Development directories (.git, .vscode, scratch)
 * 5. Secure Uploads Handling: Restricts to safe media, sandboxes execution, protects private KYC deeds
 * 6. Global Security Headers: X-Content-Type-Options, X-Frame-Options, CSP sandbox for uploads
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5500;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

const ALLOWED_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico']);

// Safe frontend app directories allowed to resolve index/code.html
const ALLOWED_APP_PATHS = new Set([
  '/',
  '/index.html',
  '/home_property_discovery',
  '/home_property_discovery/',
  '/home_property_discovery/code.html',
  '/home_property_discovery/dealers.html',
  '/dealers',
  '/dealers.html',
  '/property',
  '/property_detail_page',
  '/property_detail_page/',
  '/property_detail_page/code.html',
  '/post-property',
  '/post_property',
  '/post_property_flow_listing_wizard',
  '/post_property_flow_listing_wizard/',
  '/post_property_flow_listing_wizard/code.html',
  '/search',
  '/search_results_with_map_view',
  '/search_results_with_map_view/',
  '/search_results_with_map_view/code.html',
  '/chat',
  '/chat/',
  '/chat/index.html',
  '/saved-properties',
  '/saved-properties/',
  '/saved-properties/index.html',
  '/wishlist'
]);

function applySecurityHeaders(res, isUpload = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isUpload) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}

function isForbiddenPath(reqPath) {
  const clean = decodeURI(reqPath.split('?')[0]).replace(/\\/g, '/');

  // 1. Directory traversal attempt
  if (clean.includes('..') || clean.includes('./') || clean.includes('//')) {
    return true;
  }

  // 2. Hidden files or directories (e.g. /.env, /.git, /.vscode, /.gitignore)
  if (/(^|\/)\.[a-zA-Z0-9_-]+/.test(clean)) {
    return true;
  }

  // 3. Backend server directory, server scripts, or backend entrypoint
  if (/^\/server(\/|$|\.js)/i.test(clean)) {
    return true;
  }
  if (/^\/server\.js$/i.test(clean)) {
    return true;
  }

  // 4. Project package files, manifests, and configs
  if (/^\/(package(-lock)?\.json|tsconfig\.json|jsconfig\.json)$/i.test(clean)) {
    return true;
  }

  // 5. Development scratch, node_modules, internal git, IDE files
  if (/^\/(node_modules|scratch|\.git|\.vscode)(\/|$)/i.test(clean)) {
    return true;
  }

  // 6. Sensitive file extensions
  if (/\.(env|sql|bak|log|sh|bat|cmd|ps1|key|pem|cert|crt|pfx|p12|ts|tsx|yml|yaml|md)$/i.test(clean)) {
    return true;
  }

  // 7. Confidential property documents / KYC deeds (accessible only via authenticated API)
  if (/^\/uploads\/documents(\/|$)/i.test(clean)) {
    return true;
  }

  return false;
}

const server = http.createServer((req, res) => {
  // 1. Reverse-proxy /api/ and /socket.io/ to Express backend (port 4000)
  if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io/')) {
    const proxyHeaders = { ...req.headers };
    proxyHeaders.host = '127.0.0.1:4000';
    if (!proxyHeaders['x-forwarded-for']) {
      proxyHeaders['x-forwarded-for'] = req.socket.remoteAddress;
    }
    proxyHeaders['x-forwarded-proto'] = 'http';

    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: 4000,
      path: req.url,
      method: req.method,
      headers: proxyHeaders
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.warn('[static-server proxy error]:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backend server unavailable on port 4000.' }));
    });

    req.pipe(proxyReq);
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  let rawPath = decodeURI(req.url.split('?')[0]);

  // 2. Security Check: Protect backend code, secrets, config, dev files
  if (isForbiddenPath(rawPath)) {
    res.writeHead(403, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(JSON.stringify({
      success: false,
      error: 'Access Forbidden: Requested resource is protected.'
    }));
  }

  // 3. Clean Route Aliases for Frontend
  let reqPath = rawPath;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/home_property_discovery/code.html';
  } else if (reqPath.startsWith('/property/') || reqPath === '/property') {
    reqPath = '/property_detail_page/code.html';
  } else if (reqPath === '/dealers') {
    reqPath = '/home_property_discovery/dealers.html';
  } else if (reqPath === '/search' || reqPath.startsWith('/search/')) {
    reqPath = '/search_results_with_map_view/code.html';
  } else if (reqPath === '/post-property' || reqPath === '/post_property') {
    reqPath = '/post_property_flow_listing_wizard/code.html';
  } else if (reqPath === '/chat' || reqPath === '/messages') {
    reqPath = '/chat/index.html';
  } else if (reqPath === '/saved-properties' || reqPath === '/saved-properties/' || reqPath === '/wishlist') {
    reqPath = '/saved-properties/index.html';
  }

  const filePath = path.join(ROOT, reqPath);

  // Prevent root jailbreak
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Not found: ' + rawPath }));
    }

    // 4. Directory Browsing Prevention
    if (stats.isDirectory()) {
      // Check if this directory is an explicitly designated frontend application directory
      const normalizedReq = rawPath.replace(/\/+$/, '');
      const isAllowedDir = ALLOWED_APP_PATHS.has(rawPath) || ALLOWED_APP_PATHS.has(normalizedReq);

      if (isAllowedDir) {
        const idx1 = path.join(filePath, 'code.html');
        const idx2 = path.join(filePath, 'index.html');
        const target = fs.existsSync(idx1) ? idx1 : (fs.existsSync(idx2) ? idx2 : null);

        if (target) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return fs.createReadStream(target).pipe(res);
        }
      }

      // Any directory browsing request without an app entrypoint is strictly rejected
      res.writeHead(403, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(JSON.stringify({
        success: false,
        error: 'Directory browsing is disabled on this server.'
      }));
    }

    // 5. Uploads Security: Only serve safe media formats; prevent scripts or executables
    const isUploadFile = rawPath.startsWith('/uploads/');
    const ext = path.extname(filePath).toLowerCase();

    if (isUploadFile) {
      if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
        res.writeHead(403, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        });
        return res.end(JSON.stringify({
          success: false,
          error: 'File format not permitted for download from uploads.'
        }));
      }
      applySecurityHeaders(res, true);
    }

    // 6. Deliver Authorized Static Asset
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isUploadFile ? 'public, max-age=2592000' : 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[static-server] Port ${PORT} already active. Static content served on existing instance.`);
  } else {
    console.error('[static-server] Error:', err);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Billedkart Realtech secure static server listening on http://127.0.0.1:${PORT}`);
});
