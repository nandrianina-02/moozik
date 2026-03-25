require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();

// --- MIDDLEWARE ---
const corsOptions = {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://moziik.netlify.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
};

app.use(cors(corsOptions));
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

// --- SCHEMA SONG ---
const SongSchema = new mongoose.Schema({
  titre: String,
  artiste: String,
  image: String,
  src: String,
  filename: String,
  liked: { type: Boolean, default: false }
}, { timestamps: true });

const Song = mongoose.model('Song', SongSchema);

// --- SCHEMA PLAYLIST ---
const PlaylistSchema = new mongoose.Schema({
  nom: String,
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }]
}, { timestamps: true });

const Playlist = mongoose.model('Playlist', PlaylistSchema);

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

// --- ROUTES ---

// 🎵 GET toutes les musiques
app.get('/songs', async (req, res) => {
  try {
    const songs = await Song.find().sort({ createdAt: -1 });
    res.json(songs);
  } catch (err) {
    res.status(500).json(err);
  }
});

// 🎵 UPLOAD musique
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    // ✅ FIX : forcer https pour éviter le mixed-content bloqué par les navigateurs
    const BASE_URL = `https://${req.get('host')}`;

    const newSong = new Song({
      titre: req.file.originalname.replace('.mp3', ''),
      artiste: "Artiste Local",
      src: `${BASE_URL}/uploads/${req.file.filename}`,
      image: `https://api.dicebear.com/7.x/shapes/svg?seed=${req.file.filename}`,
      filename: req.file.filename
    });

    await newSong.save();
    res.json(newSong);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ❌ DELETE musique
app.delete('/songs/:id', async (req, res) => {
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

// ✏️ UPDATE musique
app.put('/songs/:id', async (req, res) => {
  try {
    const { titre, artiste } = req.body;

    await Song.findByIdAndUpdate(req.params.id, { titre, artiste });

    res.json({ message: "Mis à jour !" });
  } catch (err) {
    res.status(500).json(err);
  }
});

// ❤️ LIKE / UNLIKE
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

// 🔍 SEARCH
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

// 📂 CRÉER PLAYLIST
app.post('/playlists', async (req, res) => {
  try {
    const playlist = new Playlist({
      nom: req.body.nom,
      musiques: []
    });

    await playlist.save();
    res.json(playlist);
  } catch (err) {
    res.status(500).json(err);
  }
});

// 📂 GET PLAYLISTS
app.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find().populate('musiques');
    res.json(playlists);
  } catch (err) {
    res.status(500).json(err);
  }
});

// ➕ AJOUTER MUSIQUE À PLAYLIST
app.post('/playlists/:playlistId/add/:songId', async (req, res) => {
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
