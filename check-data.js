const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Collections to check
const collectionsToCheck = ['contacts', 'conversation_modes', 'settings', 'games', 'users', 'flows'];

async function checkCollections() {
  for (const collectionName of collectionsToCheck) {
    console.log(`\n=== ${collectionName.toUpperCase()} ===`);
    try {
      const snapshot = await db.collection(collectionName).limit(10).get();
      if (snapshot.empty) {
        console.log('No documents found.');
      } else {
        snapshot.forEach((doc) => {
          console.log(`${doc.id}:`, doc.data());
        });
      }
    } catch (error) {
      console.error(`Error querying ${collectionName}:`, error.message);
    }
  }
}

checkCollections().then(() => {
  console.log('\nDone checking collections.');
  process.exit(0);
}).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
