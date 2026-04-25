const contacts = [
    {
        id: 1,
        name: "Sarah J.",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
        status: "Online",
        lastMessage: "Hey! How's the project going?",
        time: "9:53 AM",
        unread: 0,
        phone: "+1 (555) 123-4567",
        about: "Always learning... ☕",
        messages: [
            { type: 'incoming', text: 'Hey everyone!', time: '7:20 PM' },
            { type: 'incoming', text: 'Here are the initial wireframes for review.', time: '7:35 PM' },
            { type: 'incoming', text: 'Hope you like the direction! ✨', time: '7:39 PM' },
            { type: 'outgoing', text: 'Awesome! Let me take a look.', time: '7:40 PM' }
        ]
    },
    {
        id: 2,
        name: "Alex Rivera",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex",
        status: "Typing...",
        lastMessage: "Okay, see you then!",
        time: "3:39 PM",
        unread: 2,
        phone: "+1 (555) 987-6543",
        about: "Design is thinking made visual.",
        messages: [
            { type: 'incoming', text: 'Are we still meeting at 4?', time: '3:35 PM' },
            { type: 'incoming', text: 'Okay, see you then!', time: '3:39 PM' }
        ]
    },
    {
        id: 3,
        name: "Liam Chen",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Liam",
        status: "Last seen yesterday",
        lastMessage: "Let me check the feedback...",
        time: "Yesterday",
        unread: 0,
        phone: "+44 7911 123456",
        about: "Busy at work... 🚀",
        messages: [
            { type: 'outgoing', text: 'Did you see the new designs?', time: 'Yesterday' },
            { type: 'incoming', text: 'Let me check the feedback...', time: 'Yesterday' }
        ]
    },
    {
        id: 4,
        name: "Product Sync",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Team",
        status: "Group",
        lastMessage: "New Designs Attached",
        time: "2:06 AM",
        unread: 5,
        messages: [
            { type: 'incoming', text: 'Welcome to the team!', time: '1:00 AM' },
            { type: 'incoming', text: 'Check the new assets.', time: '2:06 AM' }
        ]
    }
];

module.exports = { contacts };
