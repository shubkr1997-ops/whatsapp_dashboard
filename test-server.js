// Test startup script for Cloud Run compatibility
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

// Test routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/test-firebase', async (req, res) => {
    try {
        const db = admin.firestore();
        const testDoc = await db.collection('test').doc('startup-check').get();
        res.json({ firebase: 'connected', data: testDoc.exists ? testDoc.data() : 'no data' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fallback
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Test Server] Running on port ${PORT}`);
});

module.exports = app;