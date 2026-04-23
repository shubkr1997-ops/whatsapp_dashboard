
const multer = require('multer');

// Multer config for image/video uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/3gpp', 'video/quicktime',
        ];
        cb(null, allowed.includes(file.mimetype));
    },
});

const trainingStorage = multer.memoryStorage();
const uploadTraining = multer({
    storage: trainingStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for training files
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'text/csv', 'application/vnd.ms-excel'];
        cb(null, allowed.includes(file.mimetype));
    },
});

module.exports = { upload, uploadTraining };
