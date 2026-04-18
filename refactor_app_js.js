const fs = require('fs');

let code = fs.readFileSync('public/app.js', 'utf8');

// 1. Remove socket initialization
code = code.replace(/const socket = io\(\);\n/g, '');

// 2. Remove socket.on and socket.emit completely
// Just removing the socket.emit lines
code = code.replace(/socket\.emit\([^)]+\);?/g, '/* socket.emit removed */');

// Remove all socket.on blocks
code = code.replace(/socket\.on\('[^']+',\s*\(.*?\) => \{[\s\S]*?\}\);/g, '/* socket event removed */');

// Remove AI typing indicator since we won't poll for keystroke updates
code = code.replace(/\/\/ AI typing indicator[\s\S]*?socket\.on\('ai_typing'[\s\S]*?\}\);/g, '/* ai typing removed */');

// 3. Add Polling mechanism instead of Socket Listeners at the end of the file
const pollingCode = `
// ─── Serverless Polling Engine ───────────────────────────────────────────────
let lastSyncTime = Date.now();

async function pollUpdates() {
    try {
        // Poll for contacts update
        const res = await fetch('/api/contacts');
        const updatedContacts = await res.json();
        
        // Simple UI refresh (in production, diffing would be better)
        if (JSON.stringify(updatedContacts.map(c => c.id)) !== JSON.stringify(contacts.map(c => c.id))) {
            contacts = updatedContacts;
            sortAndRenderChatList();
        } else {
            // Update last messages and UI without full re-render
            updatedContacts.forEach(uc => {
                const existing = contacts.find(c => c.id === uc.id);
                if (existing) {
                    if (existing.lastMessage !== uc.lastMessage || existing.time !== uc.time) {
                        existing.lastMessage = uc.lastMessage;
                        existing.time = uc.time;
                        existing.unread = uc.unread;
                        unreadCounts[uc.id] = uc.unread || 0;
                        sortAndRenderChatList();
                    }
                }
            });
        }
        
        // Poll for active chat messages
        if (activeChatId) {
            const msgRes = await fetch(\`/api/contacts/\${activeChatId}/messages\`);
            const msgs = await msgRes.json();
            
            // Only append new messages
            const existingIds = Array.from(chatMessages.querySelectorAll('.message')).map(m => m.dataset.msgId);
            let hasNew = false;
            msgs.forEach(msg => {
                if (!existingIds.includes(String(msg.id))) {
                    appendMessage(msg, false); // false = append to bottom
                    hasNew = true;
                }
            });
            if (hasNew) scrollToBottom();
        }
    } catch (e) {
        console.error('[Polling] Error:', e);
    }
}

// Poll every 3 seconds to keep real-time feel
setInterval(pollUpdates, 3000);
`;

code += pollingCode;

fs.writeFileSync('public/app.js', code);
