require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

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

// --- MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB Atlas"))
  .catch(err => console.error("❌ Erreur MongoDB :", err));

// =====================
// --- CLOUDINARY CONFIG ---
// =====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// =====================
// --- MULTER STORAGES ---
// =====================

// Storage Cloudinary pour images seules (artiste, album)
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'moozik/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
  },
});

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Type d'image non supporté"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Pour /upload et /upload-multiple : RAM buffer, on envoie manuellement à Cloudinary
// (audio = resource_type 'video', image = resource_type 'image')
const uploadMixed = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/mp3', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Type de fichier non supporté"));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max par fichier
});

// =====================
// --- HELPERS CLOUDINARY ---
// =====================
const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err); else resolve(result);
    }).end(buffer);
  });

const destroyCloudinary = async (publicId, resourceType = 'image') => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: resourceType }); }
  catch (e) { console.warn('Cloudinary destroy warning:', e.message); }
};

// Upload un fichier audio + image optionnelle, retourne { src, audioPublicId, image, imagePublicId }
const uploadSongFiles = async ({ audioBuffer, imageBuffer, originalName }) => {
  // 1. Audio
  const audioResult = await uploadBuffer(audioBuffer, {
    resource_type: 'video',
    folder: 'moozik/audio',
    public_id: `audio_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    format: 'mp3',
  });

  // 2. Image (ou fallback dicebear)
  let imageUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=${audioResult.public_id}`;
  let imagePublicId = '';
  if (imageBuffer) {
    const imgResult = await uploadBuffer(imageBuffer, {
      resource_type: 'image',
      folder: 'moozik/images',
      public_id: `img_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
    });
    imageUrl = imgResult.secure_url;
    imagePublicId = imgResult.public_id;
  }

  return {
    src: audioResult.secure_url,
    audioPublicId: audioResult.public_id,
    image: imageUrl,
    imagePublicId,
  };
};

// =====================
// --- SCHEMAS ---
// =====================

const ArtistSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  bio: { type: String, default: '' },
  image: { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  role: { type: String, default: 'artist' }
}, { timestamps: true });
const Artist = mongoose.model('Artist', ArtistSchema);

const AlbumSchema = new mongoose.Schema({
  titre: { type: String, required: true },
  artisteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', required: true },
  artiste: { type: String, default: '' },
  annee: { type: String, default: '' },
  image: { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
  ordre: { type: Number, default: 0 }
}, { timestamps: true });
const Album = mongoose.model('Album', AlbumSchema);

const ReponseSchema = new mongoose.Schema({
  auteur: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  texte: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const CommentSchema = new mongoose.Schema({
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  auteur: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  texte: { type: String, required: true },
  likes: { type: Number, default: 0 },
  likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reponses: [ReponseSchema]
}, { timestamps: true });
const Comment = mongoose.model('Comment', CommentSchema);

const ReactionSchema = new mongoose.Schema({
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  userId: { type: String, required: true },
  type: { type: String, enum: ['fire', 'heart', 'star'], required: true }
}, { timestamps: true });
ReactionSchema.index({ songId: 1, userId: 1 }, { unique: true });
const Reaction = mongoose.model('Reaction', ReactionSchema);

const SongSchema = new mongoose.Schema({
  titre: String,
  artiste: String,
  artisteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', default: null },
  albumId: { type: mongoose.Schema.Types.ObjectId, ref: 'Album', default: null },
  image: String,
  imagePublicId: { type: String, default: '' },
  src: String,
  audioPublicId: { type: String, default: '' },
  liked: { type: Boolean, default: false },
  plays: { type: Number, default: 0 },
  ordre: { type: Number, default: 0 }
}, { timestamps: true });
const Song = mongoose.model('Song', SongSchema);

const PlaylistSchema = new mongoose.Schema({
  nom: String,
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }]
}, { timestamps: true });
const Playlist = mongoose.model('Playlist', PlaylistSchema);

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

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  nom: { type: String, default: '' },
  role: { type: String, default: 'user' }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

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
// --- AUTH USER ---
// =====================
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

app.put('/artists/:id', requireAdmin, uploadImage.single('image'), async (req, res) => {
  try {
    const { nom, bio } = req.body;
    const update = {};
    if (nom) update.nom = nom;
    if (bio !== undefined) update.bio = bio;
    if (req.file) {
      const old = await Artist.findById(req.params.id);
      await destroyCloudinary(old?.imagePublicId);
      update.image = req.file.path;
      update.imagePublicId = req.file.filename;
    }
    const artist = await Artist.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    res.json(artist);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/artists/:id', requireAdmin, async (req, res) => {
  try {
    const artist = await Artist.findById(req.params.id);
    await destroyCloudinary(artist?.imagePublicId);
    await Artist.findByIdAndDelete(req.params.id);
    res.json({ message: "Artiste supprimé" });
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- ALBUMS ---
// =====================
app.post('/albums', requireAdminOrArtist, uploadImage.single('image'), async (req, res) => {
  try {
    const { titre, annee } = req.body;
    let artisteId = req.body.artisteId;
    let artisteName = '';
    if (req.user.role === 'artist') { artisteId = req.user.id; artisteName = req.user.nom; }
    else if (artisteId) { const a = await Artist.findById(artisteId); if (a) artisteName = a.nom; }
    if (!artisteId) return res.status(400).json({ message: "artisteId requis" });
    const imageUrl = req.file ? req.file.path : `https://api.dicebear.com/7.x/shapes/svg?seed=album_${Date.now()}`;
    const imagePublicId = req.file ? req.file.filename : '';
    const album = new Album({ titre, artisteId, artiste: artisteName, annee: annee || new Date().getFullYear().toString(), image: imageUrl, imagePublicId });
    await album.save();
    res.json(album);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/albums', async (req, res) => {
  try {
    const filter = {};
    if (req.query.artisteId) filter.artisteId = req.query.artisteId;
    const albums = await Album.find(filter).populate('artisteId', 'nom').sort({ annee: -1, createdAt: -1 });
    res.json(albums);
  } catch (err) { res.status(500).json(err); }
});

app.get('/albums/:id', async (req, res) => {
  try {
    const album = await Album.findById(req.params.id).populate('artisteId', 'nom image');
    if (!album) return res.status(404).json({ message: "Album introuvable" });
    const songs = await Song.find({ albumId: req.params.id }).sort({ ordre: 1, createdAt: 1 });
    res.json({ album, songs });
  } catch (err) { res.status(500).json(err); }
});

app.put('/albums/:id', requireAdminOrArtist, uploadImage.single('image'), async (req, res) => {
  try {
    const album = await Album.findById(req.params.id);
    if (!album) return res.status(404).json({ message: "Album introuvable" });
    if (req.user.role === 'artist' && String(album.artisteId) !== String(req.user.id)) return res.status(403).json({ message: "Accès refusé" });
    const update = {};
    if (req.body.titre) update.titre = req.body.titre;
    if (req.body.annee) update.annee = req.body.annee;
    if (req.file) { await destroyCloudinary(album.imagePublicId); update.image = req.file.path; update.imagePublicId = req.file.filename; }
    const updated = await Album.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/albums/:id', requireAdminOrArtist, async (req, res) => {
  try {
    const album = await Album.findById(req.params.id);
    if (!album) return res.status(404).json({ message: "Album introuvable" });
    if (req.user.role === 'artist' && String(album.artisteId) !== String(req.user.id)) return res.status(403).json({ message: "Accès refusé" });
    await destroyCloudinary(album.imagePublicId);
    await Song.updateMany({ albumId: req.params.id }, { $unset: { albumId: '' } });
    await Album.findByIdAndDelete(req.params.id);
    res.json({ message: "Album supprimé" });
  } catch (err) { res.status(500).json(err); }
});

app.post('/albums/:id/add/:songId', requireAdminOrArtist, async (req, res) => {
  try {
    const album = await Album.findById(req.params.id);
    if (!album) return res.status(404).json({ message: "Album introuvable" });
    if (req.user.role === 'artist' && String(album.artisteId) !== String(req.user.id)) return res.status(403).json({ message: "Accès refusé" });
    const song = await Song.findByIdAndUpdate(req.params.songId, { albumId: req.params.id }, { new: true });
    res.json(song);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/albums/:id/remove/:songId', requireAdminOrArtist, async (req, res) => {
  try {
    const album = await Album.findById(req.params.id);
    if (!album) return res.status(404).json({ message: "Album introuvable" });
    if (req.user.role === 'artist' && String(album.artisteId) !== String(req.user.id)) return res.status(403).json({ message: "Accès refusé" });
    await Song.findByIdAndUpdate(req.params.songId, { $unset: { albumId: '' } });
    res.json({ message: "Musique retirée de l'album" });
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- COMMENTS ---
// =====================
app.get('/songs/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.find({ songId: req.params.id }).sort({ createdAt: -1 }).limit(50);
    const token = req.headers.authorization?.split(' ')[1];
    let userId = null;
    if (token) { try { userId = jwt.verify(token, process.env.JWT_SECRET).id; } catch {} }
    const result = comments.map(c => ({
      ...c.toObject(),
      likedByMe: userId ? c.likedBy.some(id => String(id) === String(userId)) : false
    }));
    res.json(result);
  } catch (err) { res.status(500).json(err); }
});

app.post('/songs/:id/comments', requireAuth, async (req, res) => {
  try {
    const { texte, auteur } = req.body;
    if (!texte?.trim()) return res.status(400).json({ message: "Texte requis" });
    const comment = new Comment({
      songId: req.params.id, texte: texte.trim(),
      auteur: auteur || req.user.nom || req.user.email, userId: req.user.id
    });
    await comment.save();
    res.json(comment);
  } catch (err) { res.status(500).json(err); }
});

app.put('/songs/:songId/comments/:commentId/like', requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Commentaire introuvable" });
    const userId = req.user.id;
    const alreadyLiked = comment.likedBy.some(id => String(id) === String(userId));
    if (alreadyLiked) { comment.likedBy = comment.likedBy.filter(id => String(id) !== String(userId)); comment.likes = Math.max(0, comment.likes - 1); }
    else { comment.likedBy.push(userId); comment.likes += 1; }
    await comment.save();
    res.json({ ...comment.toObject(), likedByMe: !alreadyLiked });
  } catch (err) { res.status(500).json(err); }
});

app.post('/songs/:songId/comments/:commentId/reply', requireAuth, async (req, res) => {
  try {
    const { texte, auteur } = req.body;
    if (!texte?.trim()) return res.status(400).json({ message: "Texte requis" });
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Commentaire introuvable" });
    comment.reponses.push({ texte: texte.trim(), auteur: auteur || req.user.nom || req.user.email, userId: req.user.id });
    await comment.save();
    res.json(comment);
  } catch (err) { res.status(500).json(err); }
});

app.delete('/songs/:songId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: "Commentaire introuvable" });
    if (String(comment.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    await Comment.findByIdAndDelete(req.params.commentId);
    res.json({ message: "Commentaire supprimé" });
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- REACTIONS ---
// =====================
app.get('/songs/:id/reactions', async (req, res) => {
  try {
    const reactions = await Reaction.find({ songId: req.params.id });
    const counts = { fire: 0, heart: 0, star: 0 };
    reactions.forEach(r => { if (counts[r.type] !== undefined) counts[r.type]++; });
    const token = req.headers.authorization?.split(' ')[1];
    let userReaction = null;
    if (token) { try { const d = jwt.verify(token, process.env.JWT_SECRET); const mine = reactions.find(r => String(r.userId) === String(d.id)); if (mine) userReaction = mine.type; } catch {} }
    res.json({ ...counts, userReaction });
  } catch (err) { res.status(500).json(err); }
});

app.post('/songs/:id/reactions', requireAuth, async (req, res) => {
  try {
    const { type } = req.body;
    if (!['fire', 'heart', 'star'].includes(type)) return res.status(400).json({ message: "Type invalide" });
    const existing = await Reaction.findOne({ songId: req.params.id, userId: req.user.id });
    if (existing) { if (existing.type === type) await Reaction.deleteOne({ _id: existing._id }); else { existing.type = type; await existing.save(); } }
    else { await new Reaction({ songId: req.params.id, userId: req.user.id, type }).save(); }
    const reactions = await Reaction.find({ songId: req.params.id });
    const counts = { fire: 0, heart: 0, star: 0 };
    reactions.forEach(r => { if (counts[r.type] !== undefined) counts[r.type]++; });
    const mine = reactions.find(r => String(r.userId) === String(req.user.id));
    res.json({ ...counts, userReaction: mine ? mine.type : null });
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- ROUTES SONGS ---
// =====================
app.get('/songs', async (req, res) => {
  try {
    // Pagination optionnelle : ?page=1&limit=50
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 200);
    const skip = (page - 1) * limit;

    const [songs, total] = await Promise.all([
      Song.find()
        .sort({ ordre: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('artisteId', 'nom image'),
      Song.countDocuments()
    ]);

    res.json({ songs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json(err); }
});

// ─────────────────────────────────────────────────────────────
// POST /upload — upload SIMPLE (1 audio + 1 image optionnelle)
// ─────────────────────────────────────────────────────────────
app.post('/upload', requireAdminOrArtist, uploadMixed.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), async (req, res) => {
  try {
    const audioFile = req.files['audio']?.[0];
    if (!audioFile) return res.status(400).json({ message: "Fichier audio manquant" });

    const isArtist = req.user.role === 'artist';
    const artisteId = isArtist ? req.user.id : (req.body.artisteId || null);
    let artisteName = "Artiste Local";
    if (isArtist) { artisteName = req.user.nom; }
    else if (artisteId) { const a = await Artist.findById(artisteId); if (a) artisteName = a.nom; }

    const files = await uploadSongFiles({
      audioBuffer: audioFile.buffer,
      imageBuffer: req.files['image']?.[0]?.buffer || null,
      originalName: audioFile.originalname,
    });

    const count = await Song.countDocuments();
    const song = await new Song({
      titre: req.body.titre || audioFile.originalname.replace(/\.(mp3|mpeg)$/i, '').replace(/_/g, ' '),
      artiste: artisteName,
      artisteId: artisteId || null,
      albumId: req.body.albumId || null,
      ...files,
      ordre: count
    }).save();

    res.json(song);
  } catch (err) { console.error('Upload error:', err); res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /upload-multiple — upload MULTIPLE (jusqu'à 20 MP3 + 1 image commune)
//
// Form-data attendu :
//   audios[]   : fichiers MP3 (multiple)
//   image      : pochette commune optionnelle (1 fichier)
//   titres[]   : titres dans le même ordre que audios[] (optionnel)
//   artisteId  : id artiste (admin seulement)
//   albumId    : id album (optionnel)
//
// Réponse : { results: [...songs], errors: [...] }
// ─────────────────────────────────────────────────────────────────────────
app.post('/upload-multiple', requireAdminOrArtist,
  uploadMixed.fields([
    { name: 'audios', maxCount: 20 },  // jusqu'à 20 MP3
    { name: 'image',  maxCount: 1  },  // pochette commune
  ]),
  async (req, res) => {
    try {
      const audioFiles = req.files['audios'];
      if (!audioFiles || audioFiles.length === 0) {
        return res.status(400).json({ message: "Aucun fichier audio fourni" });
      }

      // Résoudre l'artiste
      const isArtist = req.user.role === 'artist';
      const artisteId = isArtist ? req.user.id : (req.body.artisteId || null);
      let artisteName = "Artiste Local";
      if (isArtist) { artisteName = req.user.nom; }
      else if (artisteId) { const a = await Artist.findById(artisteId); if (a) artisteName = a.nom; }

      // Image commune (buffer partagé — uploadé une seule fois)
      const sharedImageBuffer = req.files['image']?.[0]?.buffer || null;

      // Titres personnalisés (optionnel, tableau dans le même ordre)
      const titres = req.body.titres
        ? (Array.isArray(req.body.titres) ? req.body.titres : [req.body.titres])
        : [];

      const albumId = req.body.albumId || null;

      // Uploader l'image commune une seule fois si elle existe
      let sharedImageUrl = null;
      let sharedImagePublicId = null;
      if (sharedImageBuffer) {
        const imgResult = await uploadBuffer(sharedImageBuffer, {
          resource_type: 'image',
          folder: 'moozik/images',
          public_id: `img_shared_${Date.now()}`,
          transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
        });
        sharedImageUrl = imgResult.secure_url;
        sharedImagePublicId = imgResult.public_id;
      }

      // Traiter chaque audio en parallèle (par lot de 5 pour ne pas saturer Cloudinary)
      const results = [];
      const errors = [];
      const count = await Song.countDocuments();

      // Chunked parallel upload (5 à la fois)
      const BATCH_SIZE = 5;
      for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
        const batch = audioFiles.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (audioFile, batchIndex) => {
            const globalIndex = i + batchIndex;
            try {
              // Upload audio
              const audioResult = await uploadBuffer(audioFile.buffer, {
                resource_type: 'video',
                folder: 'moozik/audio',
                public_id: `audio_${Date.now()}_${globalIndex}_${Math.random().toString(36).slice(2,5)}`,
                format: 'mp3',
              });

              // Image : commune si fournie, sinon dicebear individuel
              const imageUrl = sharedImageUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${audioResult.public_id}`;
              const imagePublicId = sharedImagePublicId || '';

              const titre = titres[globalIndex]
                || audioFile.originalname.replace(/\.(mp3|mpeg)$/i, '').replace(/[_-]/g, ' ').trim();

              const song = await new Song({
                titre,
                artiste: artisteName,
                artisteId: artisteId || null,
                albumId: albumId || null,
                src: audioResult.secure_url,
                audioPublicId: audioResult.public_id,
                image: imageUrl,
                imagePublicId,
                ordre: count + globalIndex,
              }).save();

              return song;
            } catch (err) {
              throw { file: audioFile.originalname, error: err.message };
            }
          })
        );

        batchResults.forEach(r => {
          if (r.status === 'fulfilled') results.push(r.value);
          else errors.push(r.reason);
        });
      }

      res.json({
        message: `${results.length} musique(s) ajoutée(s)${errors.length ? `, ${errors.length} erreur(s)` : ''}`,
        results,
        errors,
      });
    } catch (err) {
      console.error('Upload multiple error:', err);
      res.status(500).json({ message: err.message });
    }
  }
);

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
    if (req.user.role === 'artist' && String(song.artisteId) !== String(req.user.id)) return res.status(403).json({ message: "Vous ne pouvez supprimer que vos propres musiques" });
    await destroyCloudinary(song.audioPublicId, 'video');
    await destroyCloudinary(song.imagePublicId, 'image');
    await Comment.deleteMany({ songId: req.params.id });
    await Reaction.deleteMany({ songId: req.params.id });
    await Song.findByIdAndDelete(req.params.id);
    res.json({ message: "Supprimé avec succès" });
  } catch (err) { res.status(500).json(err); }
});

app.put('/songs/:id', requireAdminOrArtist, uploadImage.single('image'), async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).send("Introuvable");
    if (req.user.role === 'artist' && String(song.artisteId) !== String(req.user.id)) return res.status(403).json({ message: "Accès refusé" });
    const update = {};
    if (req.body.titre) update.titre = req.body.titre;
    if (req.body.artiste && req.user.role === 'admin') update.artiste = req.body.artiste;
    if (req.body.artisteId && req.user.role === 'admin') update.artisteId = req.body.artisteId;
    if (req.body.albumId !== undefined) update.albumId = req.body.albumId || null;
    if (req.file) { await destroyCloudinary(song.imagePublicId); update.image = req.file.path; update.imagePublicId = req.file.filename; }
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
    }).limit(30);
    res.json(songs);
  } catch (err) { res.status(500).json(err); }
});

// =====================
// --- PLAYLISTS ADMIN ---
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
// --- USER PLAYLISTS ---
// =====================
app.post('/user-playlists', requireAuth, async (req, res) => {
  try {
    const { nom, isPublic } = req.body;
    if (!nom) return res.status(400).json({ message: "Nom requis" });
    const playlist = new UserPlaylist({ nom, userId: req.user.id, musiques: [], isPublic: isPublic === true || isPublic === 'true' });
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/user-playlists/mine', requireAuth, async (req, res) => {
  try {
    const playlists = await UserPlaylist.find({ userId: req.user.id }).populate('musiques').sort({ createdAt: -1 });
    res.json(playlists);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/user-playlists/public', async (req, res) => {
  try {
    const playlists = await UserPlaylist.find({ isPublic: true }).populate('musiques').populate('userId', 'nom').sort({ createdAt: -1 });
    res.json(playlists);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/user-playlists/:id', async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id).populate('musiques');
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (playlist.isPublic) return res.json(playlist);
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ message: "Cette playlist est privée" });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (String(playlist.userId) !== String(decoded.id) && decoded.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
      return res.json(playlist);
    } catch { return res.status(403).json({ message: "Token invalide" }); }
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/user-playlists/:id/add/:songId', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    playlist.musiques.addToSet(req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.delete('/user-playlists/:id/remove/:songId', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    playlist.musiques = playlist.musiques.filter(id => String(id) !== req.params.songId);
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.put('/user-playlists/:id/visibility', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    playlist.isPublic = req.body.isPublic;
    await playlist.save();
    res.json(playlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.delete('/user-playlists/:id', requireAuth, async (req, res) => {
  try {
    const playlist = await UserPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: "Playlist introuvable" });
    if (String(playlist.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: "Accès refusé" });
    await UserPlaylist.findByIdAndDelete(req.params.id);
    res.json({ message: "Playlist supprimée" });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =====================
// --- STATS ADMIN ---
// =====================
app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [totalSongs, totalPlaylists, totalArtists, totalAlbums, totalUsers,
      totalUserPlaylists, totalComments, totalPlaysAgg, totalLikes, topSongs] = await Promise.all([
      Song.countDocuments(),
      Playlist.countDocuments(),
      Artist.countDocuments(),
      Album.countDocuments(),
      User.countDocuments(),
      UserPlaylist.countDocuments(),
      Comment.countDocuments(),
      Song.aggregate([{ $group: { _id: null, total: { $sum: '$plays' } } }]),
      Song.countDocuments({ liked: true }),
      Song.find().sort({ plays: -1 }).limit(5).select('titre artiste plays image'),
    ]);
    res.json({
      totalSongs, totalPlaylists, totalArtists, totalAlbums, totalUsers,
      totalUserPlaylists, totalComments,
      totalPlays: totalPlaysAgg[0]?.total || 0,
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