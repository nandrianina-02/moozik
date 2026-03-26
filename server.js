require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- CORS ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// --- MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB Atlas"))
  .catch(err => console.error("❌ Erreur MongoDB :", err));

// =====================
// --- SCHEMAS ---
// =====================

const ArtistSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  bio: { type: String, default: '' },
  image: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  role: { type: String, default: 'artist' }
}, { timestamps: true });
const Artist = mongoose.model('Artist', ArtistSchema);

const SongSchema = new mongoose.Schema({
  titre: String,
  artiste: String,
  artisteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', default: null },
  image: String,
  src: String,
  filename: String,
  audioFilename: String,
  liked: { type: Boolean, default: false },
  plays: { type: Number, default: 0 },
  ordre: { type: Number, default: 0 }
}, { timestamps: true });
const Song = mongoose.model('Song', SongSchema);

// Playlist Admin (publique par défaut, visible par tous)
const PlaylistSchema = new mongoose.Schema({
  nom: String,
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }]
}, { timestamps: true });
const Playlist = mongoose.model('Playlist', PlaylistSchema);

// Playlist Utilisateur (privée ou publique)
const UserPlaylistSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }],
  isPublic: { type: Boolean, default: false }
}, { timestamps: true });
const UserPlaylist = mongoose.model('UserPlaylist', UserPlaylistSchema);

const AdminSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String
}, { timestamps: true });
const Admin = mongoose.model('Admin', AdminSchema);

// Utilisateur standard (peut créer des playlists, liker)
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  nom: { type: String, default: '' },
  role: { type: String, default: 'user' }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

// =====================
// --- MULTER ---
// =====================
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Type de fichier non supporté"));
  }
});

// =====================
// --- MIDDLEWARES JWT ---
// =====================
const requireAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Non autorisé" });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    if (req.admin.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    next();
  } catch { return res.status(401).json({ message: "Token invalide" }); }
};

const requireArtist = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Non autorisé" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'artist' && decoded.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    req.user = decoded;
    next();
  } catch { return res.status(401).json({ message: "Token invalide" }); }
};

const requireAdminOrArtist = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Non autorisé" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ message: "Token invalide" }); }
};

// Auth for any logged-in user (admin, artist, user)
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Non autorisé" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { return res.status(401).json({ message: "Token invalide" }); }
};

// =====================
// --- AUTH ADMIN ---
// =====================
app.post('/admin/register', async (req, res) => {
  try {
    const { email, password, secret } = req.body;
    if (secret !== process.env.REGISTER_SECRET) return res.status(403).json({ message: "Secret invalide" });
    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: "Admin déjà existant" });
    const hashed = await bcrypt.hash(password, 12);
    await new Admin({ email, password: hashed }).save();
    res.json({ message: "Admin créé ✅" });
  } catch (err) { res.status(500).json(err); }
});

app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    const token = jwt.sign({ id: admin._id, email: admin.email, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: admin.email, role: 'admin' });
  } catch (err) { res.status(500).json(err); }
});

app.get('/admin/verify', requireAdmin, (req, res) => {
  res.json({ valid: true, email: req.admin.email, role: 'admin' });
});

// =====================
// --- AUTH UTILISATEUR STANDARD ---
// =====================

// Inscription
app.post('/users/register', async (req, res) => {
  try {
    const { email, password, nom } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email et mot de passe requis" });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Cet email est déjà utilisé" });
    const hashed = await bcrypt.hash(password, 12);
    const user = await new User({ email, password: hashed, nom: nom || email.split('@')[0] }).save();
    const token = jwt.sign({ id: user._id, email: user.email, nom: user.nom, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: user.email, nom: user.nom, role: 'user', userId: user._id });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Connexion
app.post('/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    const token = jwt.sign({ id: user._id, email: user.email, nom: user.nom, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: user.email, nom: user.nom, role: 'user', userId: user._id });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Vérification token utilisateur
app.get('/users/verify', requireAuth, (req, res) => {
  res.json({ valid: true, ...req.user });
});

// =====================
// --- AUTH ARTISTE ---
// =====================
app.post('/artists', requireAdmin, async (req, res) => {
  try {
    const { nom, bio, email, password } = req.body;
    const hashed = password ? await bcrypt.hash(password, 12) : null;
    const artist = new Artist({ nom, bio: bio || '', email, password: hashed });
    await artist.save();
    res.json(artist);
  } catch (err) { res.status(500).json(err); }
});

app.post('/artists/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const artist = await Artist.findOne({ email });
    if (!artist || !artist.password) return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    const valid = await bcrypt.compare(password, artist.password);
    if (!valid) return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    const token = jwt.sign({ id: artist._id, email: artist.email, nom: artist.nom, role: 'artist' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: artist.email, nom: artist.nom, role: 'artist', artisteId: artist._id });
  } catch (err) { res.status(500).json(err); }
});

app.get('/artists/verify', requireArtist, (req, res) => {
  res.json({ valid: true, ...req.user });
});

app.get('/artists', async (req, res) => {
  try {
    const artists = await Artist.find().select('-password').sort({ nom: 1 });
    res.json(artists);
  } catch (err) { res.status(500).json(err); }
});

app.get('/artists/:id', async (req, res) => {
  try {
    const artist = await Artist.findById(req.params.id).select('-password');
    if (!artist) return res.status(404).json({ message: "Artiste introuvable" });
    const songs = await Song.find({ artisteId: req.params.id }).sort({ ordre: 1, createdAt: -1 });
    res.json({ artist, songs });
  } catch (err) { res.status(500).json(err); }
});

app.put('/artists/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { nom, bio } = req.body;
    const update = { nom, bio };
    if (req.file) update.image = `https://moozik-gft1.onrender.com/uploads/${req.file.filename}`;
    const artist = await Artist.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    res.json(artist);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/artists/:id', requireAdmin, async (req, res) => {
  try {
    await Artist.findByIdAndDelete(req.params.id);
    res.json({ message: "Artiste supprimé" });
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- ROUTES SONGS ---
// =====================
app.get('/songs', async (req, res) => {
  try {
    const songs = await Song.find().sort({ ordre: 1, createdAt: -1 }).populate('artisteId', 'nom image');
    res.json(songs);
  } catch (err) { res.status(500).json(err); }
});

app.post('/upload', requireAdminOrArtist, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), async (req, res) => {
  try {
    const BASE_URL = 'https://moozik-gft1.onrender.com';
    const audioFile = req.files['audio']?.[0];
    const imageFile = req.files['image']?.[0];
    if (!audioFile) return res.status(400).json({ message: "Fichier audio manquant" });

    const isArtist = req.user.role === 'artist';
    const artisteId = isArtist ? req.user.id : (req.body.artisteId || null);
    let artisteName = req.body.artiste || "Artiste Local";
    if (isArtist) {
      artisteName = req.user.nom;
    } else if (artisteId) {
      const artist = await Artist.findById(artisteId);
      if (artist) artisteName = artist.nom;
    }

    const imageUrl = imageFile
      ? `${BASE_URL}/uploads/${imageFile.filename}`
      : `https://api.dicebear.com/7.x/shapes/svg?seed=${audioFile.filename}`;

    const count = await Song.countDocuments();
    const newSong = new Song({
      titre: req.body.titre || audioFile.originalname.replace('.mp3', '').replace(/_/g, ' '),
      artiste: artisteName,
      artisteId: artisteId || null,
      src: `${BASE_URL}/uploads/${audioFile.filename}`,
      image: imageUrl,
      filename: audioFile.filename,
      audioFilename: audioFile.filename,
      ordre: count
    });
    await newSong.save();
    res.json(newSong);
  } catch (err) { res.status(500).json(err); }
});

app.put('/songs/:id/play', async (req, res) => {
  try {
    const song = await Song.findByIdAndUpdate(req.params.id, { $inc: { plays: 1 } }, { new: true });
    res.json({ plays: song.plays });
  } catch (err) { res.status(500).json(err); }
});

app.delete('/songs/:id', requireAdminOrArtist, async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).send("Introuvable");
    if (req.user.role === 'artist' && String(song.artisteId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Vous ne pouvez supprimer que vos propres musiques" });
    }
    const filePath = path.join(__dirname, 'uploads', song.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await Song.findByIdAndDelete(req.params.id);
    res.json({ message: "Supprimé avec succès" });
  } catch (err) { res.status(500).json(err); }
});

app.put('/songs/:id', requireAdminOrArtist, upload.single('image'), async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).send("Introuvable");
    if (req.user.role === 'artist' && String(song.artisteId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Accès refusé" });
    }
    const update = {};
    if (req.body.titre) update.titre = req.body.titre;
    if (req.body.artiste && req.user.role === 'admin') update.artiste = req.body.artiste;
    if (req.body.artisteId && req.user.role === 'admin') update.artisteId = req.body.artisteId;
    if (req.file) update.image = `https://moozik-gft1.onrender.com/uploads/${req.file.filename}`;
    const updated = await Song.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json(err); }
});

app.put('/songs/:id/like', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).send("Introuvable");
    song.liked = !song.liked;
    await song.save();
    res.json(song);
  } catch (err) { res.status(500).json(err); }
});

app.put('/songs/reorder', requireAdmin, async (req, res) => {
  try {
    const { orderedIds } = req.body;
    for (let i = 0; i < orderedIds.length; i++) {
      await Song.findByIdAndUpdate(orderedIds[i], { ordre: i });
    }
    res.json({ message: "Ordre mis à jour" });
  } catch (err) { res.status(500).json(err); }
});

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
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- PLAYLISTS ADMIN (publiques) ---
// =====================
app.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find().populate('musiques');
    res.json(playlists);
  } catch (err) { res.status(500).json(err); }
});

app.post('/playlists', requireAdmin, async (req, res) => {
  try {
    const playlist = new Playlist({ nom: req.body.nom, musiques: [] });
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/playlists/:id', requireAdmin, async (req, res) => {
  try {
    await Playlist.findByIdAndDelete(req.params.id);
    res.json({ message: "Playlist supprimée" });
  } catch (err) { res.status(500).json(err); }
});

app.post('/playlists/:playlistId/add/:songId', requireAdmin, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.playlistId);
    if (!playlist) return res.status(404).send("Playlist introuvable");
    playlist.musiques.addToSet(req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/playlists/:playlistId/remove/:songId', requireAdmin, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.playlistId);
    playlist.musiques = playlist.musiques.filter(id => String(id) !== req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- USER PLAYLISTS (privées ou publiques) ---
// =====================

// Créer une playlist utilisateur
app.post('/user-playlists', requireAuth, async (req, res) => {
  try {
    const { nom, isPublic } = req.body;
    if (!nom) return res.status(400).json({ message: "Nom requis" });
    const playlist = new UserPlaylist({
      nom,
      userId: req.user.id,
      musiques: [],
      isPublic: isPublic === true || isPublic === 'true'
    });
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Mes playlists (seulement les miennes)
app.get('/user-playlists/mine', requireAuth, async (req, res) => {
  try {
    const playlists = await UserPlaylist.find({ userId: req.user.id })
      .populate('musiques')
      .sort({ createdAt: -1 });
    res.json(playlists);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Toutes les playlists publiques (visiteurs ou autres users)
app.get('/user-playlists/public', async (req, res) => {
  try {
    const playlists = await UserPlaylist.find({ isPublic: true })
      .populate('musiques')
      .populate('userId', 'nom')
      .sort({ createdAt: -1 });
    res.json(playlists);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Voir une playlist par ID :
// - Si publique → accessible sans auth
// - Si privée → seulement son propriétaire ou un admin
app.get('/user-playlists/:id', async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id).populate('musiques');
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });

    if (playlist.isPublic) return res.json(playlist);

    // Playlist privée : vérifier le token
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ message: "Cette playlist est privée" });

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const isOwner = String(playlist.userId) === String(decoded.id);
      const isAdmin = decoded.role === 'admin';
      if (!isOwner && !isAdmin) return res.status(403).json({ message: "Accès refusé" });
      return res.json(playlist);
    } catch {
      return res.status(403).json({ message: "Token invalide" });
    }
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Ajouter une musique à ma playlist
app.post('/user-playlists/:id/add/:songId', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Accès refusé" });
    }
    playlist.musiques.addToSet(req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Retirer une musique de ma playlist
app.delete('/user-playlists/:id/remove/:songId', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Accès refusé" });
    }
    playlist.musiques = playlist.musiques.filter(id => String(id) !== req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Changer visibilité (privée ↔ publique)
app.put('/user-playlists/:id/visibility', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Accès refusé" });
    }
    playlist.isPublic = req.body.isPublic;
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Supprimer ma playlist
app.delete('/user-playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Accès refusé" });
    }
    await UserPlaylist.findByIdAndDelete(req.params.id);
    res.json({ message: "Playlist supprimée" });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =====================
// --- STATS ADMIN ---
// =====================
app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const totalSongs = await Song.countDocuments();
    const totalPlaylists = await Playlist.countDocuments();
    const totalArtists = await Artist.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalUserPlaylists = await UserPlaylist.countDocuments();
    const totalPlays = await Song.aggregate([{ $group: { _id: null, total: { $sum: '$plays' } } }]);
    const totalLikes = await Song.countDocuments({ liked: true });
    const topSongs = await Song.find().sort({ plays: -1 }).limit(5).select('titre artiste plays image');

    res.json({
      totalSongs, totalPlaylists, totalArtists, totalUsers, totalUserPlaylists,
      totalPlays: totalPlays[0]?.total || 0,
      totalLikes, topSongs
    });
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- SERVEUR ---
// =====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur en ligne sur le port ${PORT}`);
});