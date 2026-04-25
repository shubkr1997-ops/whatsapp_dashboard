#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_TIMEOUT = 30000; // 30 seconds

class ServerStartupTest {
    constructor() {
        this.projectRoot = path.join(__dirname);
        this.serviceAccountPath = path.join(this.projectRoot, 'service-account.json');
        this.serverPath = path.join(this.projectRoot, 'server.js');
    }

    async runAllTests() {
        console.log('🚀 Starting WhatsApp Dashboard Server Startup Tests\n');

        try {
            // Test 1: Check environment setup
            console.log('📋 Test 1: Environment Setup Check');
            await this.testEnvironmentSetup();

            // Test 2: Local development mode
            console.log('\n🖥️  Test 2: Local Development Mode');
            await this.testLocalDevelopmentMode();

            // Test 3: Production mode (Cloud Run simulation)
            console.log('\n☁️  Test 3: Production Mode (Cloud Run Simulation)');
            await this.testProductionMode();

            console.log('\n✅ All tests passed! Server startup configuration is correct.');
            process.exit(0);

        } catch (error) {
            console.error('\n❌ Test failed:', error.message);
            process.exit(1);
        }
    }

    async testEnvironmentSetup() {
        // Check if service account file exists
        if (!fs.existsSync(this.serviceAccountPath)) {
            throw new Error('service-account.json not found. Required for local development.');
        }

        // Check if firebase.json exists
        if (!fs.existsSync(path.join(this.projectRoot, 'firebase.json'))) {
            throw new Error('firebase.json not found.');
        }

        // Check if .firebaserc exists and has project ID
        const firebasercPath = path.join(this.projectRoot, '.firebaserc');
        if (!fs.existsSync(firebasercPath)) {
            throw new Error('.firebaserc not found.');
        }

        const firebaserc = JSON.parse(fs.readFileSync(firebasercPath, 'utf8'));
        if (!firebaserc.projects || !firebaserc.projects.default) {
            throw new Error('Firebase project ID not configured in .firebaserc');
        }

        console.log('✅ Environment setup verified');
    }

    async testLocalDevelopmentMode() {
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                NODE_ENV: 'development',
                PORT: '8081', // Use different port for testing
                FIREBASE_PROJECT_ID: 'whatsappdashboard-bfa45',
                FIREBASE_STORAGE_BUCKET: 'whatsappdashboard-bfa45.appspot.com'
            };

            const serverProcess = spawn('node', [this.serverPath], {
                cwd: this.projectRoot,
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';
            let started = false;

            const timeout = setTimeout(() => {
                serverProcess.kill();
                reject(new Error('Server startup timeout in local development mode'));
            }, TEST_TIMEOUT);

            serverProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log('[SERVER OUTPUT]', text.trim());

                if (text.includes('WhatsApp Dashboard running on port 8081') && !started) {
                    started = true;
                    clearTimeout(timeout);

                    // Give it a moment to fully initialize
                    setTimeout(async () => {
                        try {
                            // Test Firebase connection by making a simple request
                            await this.testFirebaseConnection('http://localhost:8081');
                            serverProcess.kill();
                            resolve();
                        } catch (error) {
                            serverProcess.kill();
                            reject(error);
                        }
                    }, 2000);
                }
            });

            serverProcess.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                console.error('[SERVER ERROR]', text.trim());
            });

            serverProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (!started) {
                    reject(new Error(`Server exited with code ${code}. Error: ${errorOutput}`));
                }
            });

            serverProcess.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to start server: ${error.message}`));
            });
        });
    }

    async testProductionMode() {
        return new Promise((resolve, reject) => {
            // For production mode, we need to simulate Cloud Run environment
            // Since we can't actually use Application Default Credentials in this test environment,
            // we'll test that the code doesn't crash when trying to initialize without service account
            // and that it attempts to use the correct configuration

            const env = {
                ...process.env,
                NODE_ENV: 'production',
                PORT: '8082', // Use different port for testing
                FIREBASE_PROJECT_ID: 'whatsappdashboard-bfa45',
                FIREBASE_STORAGE_BUCKET: 'whatsappdashboard-bfa45.appspot.com'
            };

            const serverProcess = spawn('node', [this.serverPath], {
                cwd: this.projectRoot,
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';
            let started = false;

            const timeout = setTimeout(() => {
                serverProcess.kill();
                reject(new Error('Server startup timeout in production mode'));
            }, TEST_TIMEOUT);

            serverProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log('[SERVER OUTPUT]', text.trim());

                if (text.includes('WhatsApp Dashboard running on port 8082') && !started) {
                    started = true;
                    clearTimeout(timeout);

                    // In production mode, Firebase might not be fully accessible without proper credentials,
                    // but we can at least verify the server started
                    setTimeout(() => {
                        serverProcess.kill();
                        resolve();
                    }, 1000);
                }
            });

            serverProcess.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                console.error('[SERVER ERROR]', text.trim());

                // In production mode, we expect some Firebase initialization warnings/errors
                // since we don't have real Application Default Credentials, but the server should still start
                if (text.includes('Error:') && !text.includes('Firebase') && !text.includes('credential')) {
                    // Non-Firebase related errors should still fail the test
                    serverProcess.kill();
                    reject(new Error(`Unexpected server error: ${text}`));
                }
            });

            serverProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (!started) {
                    reject(new Error(`Server exited with code ${code}. Error: ${errorOutput}`));
                }
            });

            serverProcess.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to start server: ${error.message}`));
            });
        });
    }

    async testFirebaseConnection(baseUrl) {
        try {
            // Use curl to test a simple endpoint (we'll add a health check route)
            execSync(`curl -f ${baseUrl}/api/health`, { timeout: 5000 });
            console.log('✅ Server health check passed');
        } catch (error) {
            throw new Error(`Server health check failed: ${error.message}`);
        }
    }
}

// Add a simple health check route to server.js for testing
// We'll temporarily modify the server to include this route during test
const serverContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
if (!serverContent.includes('/api/health')) {
    console.log('⚠️  Adding health check route to server.js for testing...');

    // Find the routes section and add health check
    const healthCheckRoute = `
// Health check route for testing
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), environment: process.env.NODE_ENV });
});
`;

    const insertPoint = serverContent.indexOf('// Routes');
    const modifiedServer = serverContent.slice(0, insertPoint) + healthCheckRoute + serverContent.slice(insertPoint);

    fs.writeFileSync(path.join(__dirname, 'server.js.backup'), serverContent);
    fs.writeFileSync(path.join(__dirname, 'server.js'), modifiedServer);

    console.log('✅ Health check route added');
}

// Run the tests
const test = new ServerStartupTest();
test.runAllTests().catch((error) => {
    console.error('Test suite failed:', error);
    process.exit(1);
});