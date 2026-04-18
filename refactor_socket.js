const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// Strip out HTTP and Socket.IO initialization
code = code.replace(/const http\s*=\s*require\('http'\);\n/g, '');
code = code.replace(/const \{\s*Server\s*\}\s*=\s*require\('socket\.io'\);\n/g, '');
code = code.replace(/const server\s*=\s*http\.createServer\(app\);\n/g, '');
code = code.replace(/const io\s*=\s*new Server\(server[\s\S]*?\}\);\n/g, '');

// Strip the entire Socket.io middleware chunk
code = code.replace(/\/\* Socket\.io removed for Firebase Serverless \*\/[\s\S]*?(?=\/\/ ─── Helper: Format timestamp)/, '');

fs.writeFileSync('server.js', code);
