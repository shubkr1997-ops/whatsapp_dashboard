const functions = require('firebase-functions');
require('dotenv').config();

// Simple test function
exports.helloWorld = functions.https.onRequest((request, response) => {
  response.send("Hello from Firebase!");
});