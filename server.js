require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- CORS MANUEL ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- CRÉER DOSSIER UPLOAD SI N'EXISTE PAS ---
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// --- CONNEXION MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB Atlas"))
  .catch(err => console.error("❌ Erreur MongoDB :", err));

// --- SCHEMAS ---
const SongSchema = new mongoose.Schema({
  titre: String,
  artiste: String,
  image: String,
  src: String,
  filename: String,
  liked: { type: Boolean, default: false }
}, { timestamps: true });

const Song = mongoose.model('Song', SongSchema);

const PlaylistSchema = new mongoose.Schema({
  nom: String,
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }]
}, { timestamps: true });

const Playlist = mongoose.model('Playlist', PlaylistSchema);

const AdminSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String
}, { timestamps: true });

const Admin = mongoose.model('Admin', AdminSchema);

// --- MIDDLEWARE JWT ---
const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: "Non autorisé" });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalide" });
  }
};

// --- CONFIG MULTER ---
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'audio/mpeg') {
      cb(null, true);
    } else {
      cb(new Error("Seulement les fichiers MP3"));
    }
  }
});

// =====================
// --- ROUTES AUTH ---
// =====================

// 🔐 CRÉER ADMIN (à utiliser une seule fois pour initialiser)
app.post('/admin/register', async (req, res) => {
  try {
    const { email, password, secret } = req.body;

    // Vérification du secret d'enregistrement
    if (secret !== process.env.REGISTER_SECRET) {
      return res.status(403).json({ message: "Secret invalide" });
    }

    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: "Admin déjà existant" });

    const hashed = await bcrypt.hash(password, 12);
    const admin = new Admin({ email, password: hashed });
    await admin.save();

    res.json({ message: "Admin créé avec succès ✅" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// 🔐 LOGIN ADMIN
app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ message: "Email ou mot de passe incorrect" });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ message: "Email ou mot de passe incorrect" });

    const token = jwt.sign(
      { id: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, email: admin.email });
  } catch (err) {
    res.status(500).json(err);
  }
});

// 🔐 VÉRIFIER TOKEN
app.get('/admin/verify', requireAdmin, (req, res) => {
  res.json({ valid: true, email: req.admin.email });
});

// =====================
// --- ROUTES SONGS ---
// =====================

// 🎵 GET toutes les musiques (public)
app.get('/songs', async (req, res) => {
  try {
    const songs = await Song.find().sort({ createdAt: -1 });
    res.json(songs);
  } catch (err) {
    res.status(500).json(err);
  }
});

// 🎵 UPLOAD musique (admin only)
app.post('/upload', requireAdmin, upload.array('audio', 20), async (req, res) => {
  try {
    const BASE_URL = `https://moozik-gft1.onrender.com`;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "Aucun fichier envoyé" });
    }

    const songs = req.files.map(file => ({
      titre: file.originalname.replace('.mp3', ''),
      artiste: "Artiste Local",
      src: `${BASE_URL}/uploads/${file.filename}`,
      image: `https://api.dicebear.com/7.x/shapes/svg?seed=${file.filename}`,
      filename: file.filename
    }));

    const savedSongs = await Song.insertMany(songs);

    res.json(savedSongs);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ❌ DELETE musique (admin only)
app.delete('/songs/:id', requireAdmin, async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).send("Introuvable");

    const filePath = path.join(__dirname, 'uploads', song.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await Song.findByIdAndDelete(req.params.id);
    res.json({ message: "Supprimé avec succès" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ✏️ UPDATE musique (admin only)
app.put('/songs/:id', requireAdmin, async (req, res) => {
  try {
    const { titre, artiste } = req.body;
    await Song.findByIdAndUpdate(req.params.id, { titre, artiste });
    res.json({ message: "Mis à jour !" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ❤️ LIKE / UNLIKE (public)
app.put('/songs/:id/like', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).send("Introuvable");

    song.liked = !song.liked;
    await song.save();
    res.json(song);
  } catch (err) {
    res.status(500).json(err);
  }
});

// 🔍 SEARCH (public)
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const songs = await Song.find({
      $or: [
        { titre: { $regex: query, $options: 'i' } },
        { artiste: { $regex: query, $options: 'i' } }
      ]
    });
    res.json(songs);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ========================
// --- ROUTES PLAYLISTS ---
// ========================

// 📂 GET PLAYLISTS (public)
app.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find().populate('musiques');
    res.json(playlists);
  } catch (err) {
    res.status(500).json(err);
  }
});

// 📂 CRÉER PLAYLIST (admin only)
app.post('/playlists', requireAdmin, async (req, res) => {
  try {
    const playlist = new Playlist({ nom: req.body.nom, musiques: [] });
    await playlist.save();
    res.json(playlist);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ➕ AJOUTER MUSIQUE À PLAYLIST (admin only)
app.post('/playlists/:playlistId/add/:songId', requireAdmin, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.playlistId);
    if (!playlist) return res.status(404).send("Playlist introuvable");

    playlist.musiques.addToSet(req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) {
    res.status(500).json(err);
  }
});

// 🚀 LANCEMENT SERVEUR
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur en ligne sur le port ${PORT}`);
});