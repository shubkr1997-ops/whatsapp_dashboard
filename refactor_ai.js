const fs = require('fs');

let code = fs.readFileSync('ai/engine.js', 'utf8');

// Replace synchronous db calls with await
code = code.replace(/db\.([a-zA-Z0-9_]+)\(/g, (match, method, offset, str) => {
    const before = str.slice(Math.max(0, offset - 10), offset);
    if (before.match(/\bawait\s*$/)) return match; // already has await
    return 'await db.' + method + '(';
});

// processIncomingMessage is already async, check buildContext or others
code = code.replace(/function\s+([a-zA-Z0-9_]+)\(.*?\)[\s\{]+(?=.*?await db\.)/gs, (match) => {
    if (match.includes('async function')) return match;
    return match.replace('function', 'async function');
});

// Also remove socket.io references since we stripped it out
code = code.replace(/io\.to\(.*?\)\.emit\([^)]*\);?/g, '/* io.to.emit removed */');

fs.writeFileSync('ai/engine.js', code);
