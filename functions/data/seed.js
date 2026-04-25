'use strict';
/**
 * seed.js — One-time script to populate the SQLite database with initial demo data.
 * Run with: node data/seed.js
 */

const database = require('./db');

// Check if already seeded
const existing = database.getAllContacts();
if (existing.length > 0) {
    console.log(`✅ Database already has ${existing.length} contacts. Skipping seed.`);
    process.exit(0);
}

console.log('🌱 Seeding database with demo data...');

const demoContacts = [
    {
        name: 'Sarah J.',
        phone: '+15551234567',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
        status: 'Online',
        about: 'Always learning... ☕',
        is_group: 0,
        messages: [
            { type: 'incoming', text: 'Hey everyone!' },
            { type: 'incoming', text: 'Here are the initial wireframes for review.' },
            { type: 'incoming', text: 'Hope you like the direction! ✨' },
            { type: 'outgoing', text: 'Awesome! Let me take a look.', status: 'read' },
        ]
    },
    {
        name: 'Alex Rivera',
        phone: '+15559876543',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
        status: 'Last seen 3:39 PM',
        about: 'Design is thinking made visual.',
        is_group: 0,
        messages: [
            { type: 'incoming', text: 'Are we still meeting at 4?' },
            { type: 'incoming', text: 'Okay, see you then!' },
        ]
    },
    {
        name: 'Liam Chen',
        phone: '+447911123456',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Liam',
        status: 'Last seen yesterday',
        about: 'Busy at work... 🚀',
        is_group: 0,
        messages: [
            { type: 'outgoing', text: 'Did you see the new designs?', status: 'delivered' },
            { type: 'incoming', text: 'Let me check the feedback...' },
        ]
    },
    {
        name: 'Product Sync',
        phone: null,
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProductSync',
        status: 'Group · 3 members',
        about: 'Discuss product updates',
        is_group: 1,
        messages: [
            { type: 'incoming', text: 'Welcome to the team!' },
            { type: 'incoming', text: 'Check the new assets.' },
            { type: 'incoming', text: 'New Designs Attached 📎' },
        ]
    },
];

for (const data of demoContacts) {
    const { messages, ...contactData } = data;
    const contact = database.createContact(contactData);

    for (const msg of messages) {
        database.addMessage({
            contact_id: contact.id,
            type: msg.type,
            text: msg.text,
            status: msg.status || (msg.type === 'outgoing' ? 'sent' : 'delivered'),
        });
    }

    // Set default conversation mode (human) for each contact
    database.setConversationMode({ contact_id: contact.id, mode: 'human', agent_config_id: null });

    console.log(`  ✓ Created contact: ${contact.name} (id=${contact.id})`);
}

console.log('✅ Seed complete!');
process.exit(0);
