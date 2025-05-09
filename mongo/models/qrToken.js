// mongo/models/qrToken.js

const mongoose = require('mongoose');

const qrTokenSchema = new mongoose.Schema({
    id_asignacion: {
        type: Number,
        required: true,
        unique: true
    },
    token: {
        type: String,
        required: true,
        unique: true
    },
    fecha_creacion: {
        type: Date,
        default: Date.now
    },
    fecha_expiracion: {
        type: Date,
        required: true
    },
    usado: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('QrToken', qrTokenSchema);
