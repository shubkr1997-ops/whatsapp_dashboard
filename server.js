'use strict';
// Only load .env in local development — App Hosting injects env vars directly
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const admin = require('firebase-admin');
if (!admin.apps.length) {
    // In Cloud Run/Firebase App Hosting, use Application Default Credentials
    if (process.env.NODE_ENV === 'production' || process.env.K_SERVICE) {
        admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });
    } else {
        // Local development - use service account
        admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            credential: admin.credential.cert(require('./service-account.json'))
        });
    }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const TRAINING_DIR = path.join(__dirname, 'training_files');
fs.mkdirSync(TRAINING_DIR, { recursive: true });

// Health check route for testing
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), environment: process.env.NODE_ENV });
});

// Routes
app.use('/api', require('./src/routes/contacts.routes'));
app.use('/api', require('./src/routes/messages.routes'));
app.use('/api', require('./src/routes/webhook.routes'));
app.use('/api', require('./src/routes/agents.routes'));
app.use('/api', require('./src/routes/knowledge.routes'));
app.use('/api', require('./src/routes/mcp.routes'));
app.use('/api', require('./src/routes/calls.routes'));
app.use('/api', require('./src/routes/modes.routes'));
app.use('/api', require('./src/routes/catalog.routes'));
app.use('/api', require('./src/routes/flows.routes'));

// Fallback
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[Express Error]', err);
    res.status(500).json({ error: err.message, stack: err.stack });
});

process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (err) => {
    console.error('[Unhandled Rejection]', err);
});

// Export for Firebase Functions (emulator / local testing)
if (process.env.FUNCTIONS_EMULATOR) {
    const functions = require('firebase-functions/v2');
    exports.api = functions.https.onRequest(app);
} else {
    // Firebase App Hosting (Cloud Run) — always listen on PORT
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] WhatsApp Dashboard running on port ${PORT}`);
    });
}
