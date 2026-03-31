require('dotenv').config();

const express = require('express');
const compression = require('compression'); // npm install compression
const multer = require('multer');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v2: cloudinary } = require('cloudinary');

const app = express();

// --- CORS ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
// Compression gzip/brotli — réduit les réponses JSON de ~70%
app.use(compression({
  level: 6,           // bon équilibre vitesse/compression
  threshold: 1024,    // compresser seulement si > 1Ko
}));
app.use(express.json());

// --- MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ MongoDB :', err));

// --- CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Tous les fichiers en RAM → Cloudinary via upload_stream
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = ['audio/mpeg', 'audio/mp3', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    ok.includes(file.mimetype) ? cb(null, true) : cb(new Error('Type non supporté'));
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

const toCloud = (buffer, opts) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(opts, (err, r) => err ? reject(err) : resolve(r)).end(buffer);
  });

const fromCloud = async (publicId, rt = 'image') => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: rt }); }
  catch (e) { console.warn('Cloudinary destroy:', e.message); }
};

// ── SCHEMAS ──────────────────────────────────

const ArtistSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  bio: { type: String, default: '' },
  image: { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true },
  password: String,
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

// UserPlay: track which user played which song
const UserPlaySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  count: { type: Number, default: 1 }
}, { timestamps: true });
UserPlaySchema.index({ userId: 1, songId: 1 }, { unique: true });
const UserPlay = mongoose.model('UserPlay', UserPlaySchema);

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

// ── INDEX MONGODB (performances requêtes) ────
// Ces index accélèrent les recherches fréquentes
Song.collection.createIndex({ ordre: 1, createdAt: -1 }).catch(() => {});
Song.collection.createIndex({ artisteId: 1 }).catch(() => {});
Song.collection.createIndex({ albumId: 1 }).catch(() => {});
Song.collection.createIndex({ plays: -1 }).catch(() => {});
Song.collection.createIndex({ titre: 'text', artiste: 'text' }).catch(() => {}); // recherche texte
Comment.collection.createIndex({ songId: 1, createdAt: -1 }).catch(() => {});
Album.collection.createIndex({ artisteId: 1 }).catch(() => {});
UserPlaylist.collection.createIndex({ userId: 1 }).catch(() => {});
UserPlaylist.collection.createIndex({ isPublic: 1 }).catch(() => {});

// ── MIDDLEWARES JWT ───────────────────────────

const requireAdmin = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try {
    req.admin = jwt.verify(t, process.env.JWT_SECRET);
    if (req.admin.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    next();
  } catch { res.status(401).json({ message: 'Token invalide' }); }
};

const requireArtist = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try {
    const d = jwt.verify(t, process.env.JWT_SECRET);
    if (d.role !== 'artist' && d.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    req.user = d; next();
  } catch { res.status(401).json({ message: 'Token invalide' }); }
};

const requireAdminOrArtist = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try { req.user = jwt.verify(t, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Token invalide' }); }
};

const requireAuth = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try { req.user = jwt.verify(t, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Token invalide' }); }
};

// ── AUTH ADMIN ───────────────────────────────

app.post('/admin/register', async (req, res) => {
  try {
    const { email, password, secret } = req.body;
    if (secret !== process.env.REGISTER_SECRET) return res.status(403).json({ message: 'Secret invalide' });
    if (await Admin.findOne({ email })) return res.status(400).json({ message: 'Admin déjà existant' });
    await new Admin({ email, password: await bcrypt.hash(password, 12) }).save();
    res.json({ message: 'Admin créé ✅' });
  } catch (e) { res.status(500).json(e); }
});

app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin || !await bcrypt.compare(password, admin.password))
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: admin._id, email: admin.email, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: admin.email, role: 'admin' });
  } catch (e) { res.status(500).json(e); }
});

app.get('/admin/verify', requireAdmin, (req, res) =>
  res.json({ valid: true, email: req.admin.email, role: 'admin' }));

// ── ADMIN: GESTION UTILISATEURS ──────────────

// Liste tous les utilisateurs avec stats de base
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    // Enrichir avec stats de base
    const enriched = await Promise.all(users.map(async (u) => {
      const [totalPlaylists, totalLikes, totalPlays] = await Promise.all([
        UserPlaylist.countDocuments({ userId: u._id }),
        Reaction.countDocuments({ userId: String(u._id), type: 'heart' }),
        UserPlay.aggregate([
          { $match: { userId: u._id } },
          { $group: { _id: null, total: { $sum: '$count' } } }
        ]).then(r => r[0]?.total || 0)
      ]);
      return { ...u.toObject(), totalPlaylists, totalLikes, totalPlays };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Stats détaillées d'un utilisateur
app.get('/admin/users/:id/stats', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const [totalPlaylists, totalComments, playsAgg, topPlaysRaw] = await Promise.all([
      UserPlaylist.countDocuments({ userId: user._id }),
      Comment.countDocuments({ userId: user._id }),
      UserPlay.aggregate([
        { $match: { userId: user._id } },
        { $group: { _id: null, total: { $sum: '$count' } } }
      ]),
      UserPlay.find({ userId: user._id })
        .sort({ count: -1 })
        .limit(10)
        .populate('songId', 'titre artiste image plays')
    ]);

    const totalPlays = playsAgg[0]?.total || 0;
    const topSongs = topPlaysRaw
      .filter(p => p.songId)
      .map(p => ({ ...p.songId.toObject(), userPlays: p.count }));

    // Réactions "heart" de l'utilisateur = ses favoris
    const reactions = await Reaction.find({ userId: String(user._id), type: 'heart' });
    const likedSongIds = reactions.map(r => r.songId);
    const likedSongs = await Song.find({ _id: { $in: likedSongIds } }).select('titre artiste image plays').limit(10);

    res.json({
      user,
      totalPlays,
      totalPlaylists,
      totalComments,
      totalLikes: reactions.length,
      topSongs,
      likedSongs,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Mettre à jour un utilisateur (admin)
app.put('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { nom, email } = req.body;
    const update = {};
    if (nom) update.nom = nom;
    if (email) update.email = email;
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'Introuvable' });
    res.json(user);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Supprimer un utilisateur
app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await UserPlaylist.deleteMany({ userId: req.params.id });
    await Comment.deleteMany({ userId: req.params.id });
    await Reaction.deleteMany({ userId: req.params.id });
    await UserPlay.deleteMany({ userId: req.params.id });
    res.json({ message: 'Utilisateur supprimé' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── AUTH USER ────────────────────────────────

app.post('/users/register', async (req, res) => {
  try {
    const { email, password, nom } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email déjà utilisé' });
    const user = await new User({ email, password: await bcrypt.hash(password, 12), nom: nom || email.split('@')[0] }).save();
    const token = jwt.sign({ id: user._id, email: user.email, nom: user.nom, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: user.email, nom: user.nom, role: 'user', userId: user._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password))
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: user._id, email: user.email, nom: user.nom, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: user.email, nom: user.nom, role: 'user', userId: user._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/users/verify', requireAuth, (req, res) => res.json({ valid: true, ...req.user }));

// Mise à jour profil utilisateur
app.put('/users/:id', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Accès refusé' });
    const update = {};
    if (req.body.nom) update.nom = req.body.nom;
    if (req.body.email) update.email = req.body.email;
    if (req.body.password) {
      if (req.body.password.length < 6) return res.status(400).json({ message: 'Mot de passe trop court (6 min)' });
      update.password = await bcrypt.hash(req.body.password, 12);
    }
    if (req.file) {
      const old = await User.findById(req.params.id);
      if (old?.avatarPublicId) await fromCloud(old.avatarPublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/avatars', resource_type: 'image', transformation: [{ width: 200, height: 200, crop: 'fill', quality: 75, fetch_format: 'auto' }] });
      update.avatar = r.secure_url;
      update.avatarPublicId = r.public_id;
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'Introuvable' });
    res.json(user);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── AUTH ARTISTE ─────────────────────────────

app.post('/artists', requireAdmin, async (req, res) => {
  try {
    const { nom, bio, email, password } = req.body;
    const artist = new Artist({ nom, bio: bio || '', email, password: password ? await bcrypt.hash(password, 12) : null });
    await artist.save();
    res.json(artist);
  } catch (e) { res.status(500).json(e); }
});

app.post('/artists/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const artist = await Artist.findOne({ email });
    if (!artist?.password || !await bcrypt.compare(password, artist.password))
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: artist._id, email: artist.email, nom: artist.nom, role: 'artist' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: artist.email, nom: artist.nom, role: 'artist', artisteId: artist._id });
  } catch (e) { res.status(500).json(e); }
});

app.get('/artists/verify', requireArtist, (req, res) => res.json({ valid: true, ...req.user }));

app.get('/artists', async (req, res) => {
  try {
    const artists = await Artist.find().select('-password -imagePublicId -__v').sort({ nom: 1 });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(artists);
  }
  catch (e) { res.status(500).json(e); }
});

app.get('/artists/:id', async (req, res) => {
  try {
    const artist = await Artist.findById(req.params.id).select('-password');
    if (!artist) return res.status(404).json({ message: 'Artiste introuvable' });
    const songs = await Song.find({ artisteId: req.params.id }).sort({ ordre: 1, createdAt: -1 });
    res.json({ artist, songs });
  } catch (e) { res.status(500).json(e); }
});

app.put('/artists/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const update = {};
    if (req.body.nom) update.nom = req.body.nom;
    if (req.body.bio !== undefined) update.bio = req.body.bio;
    if (req.file) {
      const old = await Artist.findById(req.params.id);
      await fromCloud(old?.imagePublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }] });
      update.image = r.secure_url; update.imagePublicId = r.public_id;
    }
    res.json(await Artist.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password'));
  } catch (e) { res.status(500).json(e); }
});

// Mise à jour profil artiste (par lui-même)
app.put('/artists/me', requireArtist, upload.single('image'), async (req, res) => {
  try {
    const update = {};
    if (req.body.nom) update.nom = req.body.nom;
    if (req.body.bio !== undefined) update.bio = req.body.bio;
    if (req.body.password) {
      if (req.body.password.length < 6) return res.status(400).json({ message: 'Mot de passe trop court' });
      update.password = await bcrypt.hash(req.body.password, 12);
    }
    if (req.file) {
      const old = await Artist.findById(req.user.id);
      await fromCloud(old?.imagePublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }] });
      update.image = r.secure_url; update.imagePublicId = r.public_id;
    }
    res.json(await Artist.findByIdAndUpdate(req.user.id, update, { new: true }).select('-password'));
  } catch (e) { res.status(500).json(e); }
});

app.delete('/artists/:id', requireAdmin, async (req, res) => {
  try {
    const a = await Artist.findById(req.params.id);
    await fromCloud(a?.imagePublicId);
    await Artist.findByIdAndDelete(req.params.id);
    res.json({ message: 'Artiste supprimé' });
  } catch (e) { res.status(500).json(e); }
});

// ── ALBUMS ───────────────────────────────────

app.post('/albums', requireAdminOrArtist, upload.single('image'), async (req, res) => {
  try {
    let artisteId = req.user.role === 'artist' ? req.user.id : req.body.artisteId;
    if (!artisteId) return res.status(400).json({ message: 'artisteId requis' });
    let artisteName = req.user.role === 'artist' ? req.user.nom : '';
    if (req.user.role !== 'artist') { const a = await Artist.findById(artisteId); if (a) artisteName = a.nom; }
    let imageUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=album_${Date.now()}`, imagePublicId = '';
    if (req.file) {
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'auto', quality: 70, fetch_format: 'auto' }] });
      imageUrl = r.secure_url; imagePublicId = r.public_id;
    }
    res.json(await new Album({ titre: req.body.titre, artisteId, artiste: artisteName, annee: req.body.annee || String(new Date().getFullYear()), image: imageUrl, imagePublicId }).save());
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/albums', async (req, res) => {
  try {
    const f = req.query.artisteId ? { artisteId: req.query.artisteId } : {};
    const albums = await Album.find(f).sort({ annee: -1, createdAt: -1 })
      .populate('artisteId', 'nom').select('-imagePublicId -__v');
    res.set('Cache-Control', 'public, max-age=60');
    res.json(albums);
  } catch (e) { res.status(500).json(e); }
});

app.get('/albums/:id', async (req, res) => {
  try { const a = await Album.findById(req.params.id); if (!a) return res.status(404).json({ message: 'Introuvable' }); res.json(a); }
  catch (e) { res.status(500).json(e); }
});

app.put('/albums/:id', requireAdminOrArtist, upload.single('image'), async (req, res) => {
  try {
    const album = await Album.findById(req.params.id);
    if (!album) return res.status(404).json({ message: 'Introuvable' });
    if (req.user.role === 'artist' && String(album.artisteId) !== String(req.user.id)) return res.status(403).json({ message: 'Accès refusé' });
    const u = {};
    if (req.body.titre) u.titre = req.body.titre;
    if (req.body.annee) u.annee = req.body.annee;
    if (req.file) {
      await fromCloud(album.imagePublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'auto', quality: 70, fetch_format: 'auto' }] });
      u.image = r.secure_url; u.imagePublicId = r.public_id;
    }
    res.json(await Album.findByIdAndUpdate(req.params.id, u, { new: true }));
  } catch (e) { res.status(500).json(e); }
});

app.delete('/albums/:id', requireAdminOrArtist, async (req, res) => {
  try {
    const a = await Album.findById(req.params.id);
    if (!a) return res.status(404).json({ message: 'Introuvable' });
    if (req.user.role === 'artist' && String(a.artisteId) !== String(req.user.id)) return res.status(403).json({ message: 'Accès refusé' });
    await fromCloud(a.imagePublicId);
    await Song.updateMany({ albumId: req.params.id }, { $unset: { albumId: '' } });
    await Album.findByIdAndDelete(req.params.id);
    res.json({ message: 'Supprimé' });
  } catch (e) { res.status(500).json(e); }
});

app.post('/albums/:id/add/:songId', requireAdminOrArtist, async (req, res) => {
  try {
    const a = await Album.findById(req.params.id);
    if (!a) return res.status(404).json({ message: 'Introuvable' });
    if (req.user.role === 'artist' && String(a.artisteId) !== String(req.user.id)) return res.status(403).json({ message: 'Accès refusé' });
    res.json(await Song.findByIdAndUpdate(req.params.songId, { albumId: req.params.id }, { new: true }));
  } catch (e) { res.status(500).json(e); }
});

app.delete('/albums/:id/remove/:songId', requireAdminOrArtist, async (req, res) => {
  try {
    const a = await Album.findById(req.params.id);
    if (!a) return res.status(404).json({ message: 'Introuvable' });
    if (req.user.role === 'artist' && String(a.artisteId) !== String(req.user.id)) return res.status(403).json({ message: 'Accès refusé' });
    await Song.findByIdAndUpdate(req.params.songId, { $unset: { albumId: '' } });
    res.json({ message: 'Retiré' });
  } catch (e) { res.status(500).json(e); }
});

// ── COMMENTS ─────────────────────────────────

app.get('/songs/:id/comments', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(20, parseInt(req.query.limit) || 10); // 10 par défaut
    const skip  = (page - 1) * limit;

    const [comments, total] = await Promise.all([
      Comment.find({ songId: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v'),
      Comment.countDocuments({ songId: req.params.id })
    ]);

    const t = req.headers.authorization?.split(' ')[1];
    let uid = null;
    if (t) { try { uid = jwt.verify(t, process.env.JWT_SECRET).id; } catch {} }

    res.json({
      comments: comments.map(c => ({
        ...c.toObject(),
        likedByMe: uid ? c.likedBy.some(id => String(id) === String(uid)) : false
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (e) { res.status(500).json(e); }
});

app.post('/songs/:id/comments', requireAuth, async (req, res) => {
  try {
    const { texte, auteur } = req.body;
    if (!texte?.trim()) return res.status(400).json({ message: 'Texte requis' });
    res.json(await new Comment({ songId: req.params.id, texte: texte.trim(), auteur: auteur || req.user.nom || req.user.email, userId: req.user.id }).save());
  } catch (e) { res.status(500).json(e); }
});

app.put('/songs/:sid/comments/:cid/like', requireAuth, async (req, res) => {
  try {
    const c = await Comment.findById(req.params.cid);
    if (!c) return res.status(404).json({ message: 'Introuvable' });
    const uid = req.user.id;
    const liked = c.likedBy.some(id => String(id) === String(uid));
    if (liked) { c.likedBy = c.likedBy.filter(id => String(id) !== String(uid)); c.likes = Math.max(0, c.likes - 1); }
    else { c.likedBy.push(uid); c.likes++; }
    await c.save();
    res.json({ ...c.toObject(), likedByMe: !liked });
  } catch (e) { res.status(500).json(e); }
});

app.post('/songs/:sid/comments/:cid/reply', requireAuth, async (req, res) => {
  try {
    const { texte, auteur } = req.body;
    if (!texte?.trim()) return res.status(400).json({ message: 'Texte requis' });
    const c = await Comment.findById(req.params.cid);
    if (!c) return res.status(404).json({ message: 'Introuvable' });
    c.reponses.push({ texte: texte.trim(), auteur: auteur || req.user.nom || req.user.email, userId: req.user.id });
    res.json(await c.save());
  } catch (e) { res.status(500).json(e); }
});

app.delete('/songs/:sid/comments/:cid', requireAuth, async (req, res) => {
  try {
    const c = await Comment.findById(req.params.cid);
    if (!c) return res.status(404).json({ message: 'Introuvable' });
    if (String(c.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    await Comment.findByIdAndDelete(req.params.cid);
    res.json({ message: 'Supprimé' });
  } catch (e) { res.status(500).json(e); }
});

// ── REACTIONS ────────────────────────────────

app.get('/songs/:id/reactions', async (req, res) => {
  try {
    const list = await Reaction.find({ songId: req.params.id });
    const counts = { fire: 0, heart: 0, star: 0 };
    list.forEach(r => { if (counts[r.type] !== undefined) counts[r.type]++; });
    const t = req.headers.authorization?.split(' ')[1];
    let userReaction = null;
    if (t) { try { const d = jwt.verify(t, process.env.JWT_SECRET); const m = list.find(r => String(r.userId) === String(d.id)); if (m) userReaction = m.type; } catch {} }
    res.json({ ...counts, userReaction });
  } catch (e) { res.status(500).json(e); }
});

app.post('/songs/:id/reactions', requireAuth, async (req, res) => {
  try {
    const { type } = req.body;
    if (!['fire', 'heart', 'star'].includes(type)) return res.status(400).json({ message: 'Type invalide' });
    const ex = await Reaction.findOne({ songId: req.params.id, userId: req.user.id });
    if (ex) { if (ex.type === type) await Reaction.deleteOne({ _id: ex._id }); else { ex.type = type; await ex.save(); } }
    else await new Reaction({ songId: req.params.id, userId: req.user.id, type }).save();
    const list = await Reaction.find({ songId: req.params.id });
    const counts = { fire: 0, heart: 0, star: 0 };
    list.forEach(r => { if (counts[r.type] !== undefined) counts[r.type]++; });
    const m = list.find(r => String(r.userId) === String(req.user.id));
    res.json({ ...counts, userReaction: m ? m.type : null });
  } catch (e) { res.status(500).json(e); }
});

// ── SONGS ────────────────────────────────────

app.get('/songs', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 30); // max 50 par page
    const skip  = (page - 1) * limit;

    // Recherche optionnelle
    const filter = {};
    if (req.query.q) {
      const re = new RegExp(req.query.q, 'i');
      filter.$or = [{ titre: re }, { artiste: re }];
    }
    if (req.query.albumId)   filter.albumId   = req.query.albumId;
    if (req.query.artisteId) filter.artisteId = req.query.artisteId;

    const [songs, total] = await Promise.all([
      Song.find(filter)
        .sort({ ordre: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // Ne pas retourner les champs lourds inutiles côté liste
        .select('-audioPublicId -imagePublicId -__v')
        .populate('artisteId', 'nom image'),
      Song.countDocuments(filter)
    ]);

    res.set('Cache-Control', 'public, max-age=30'); // 30s de cache navigateur
    res.json({
      songs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  }
  catch (e) { res.status(500).json(e); }
});

// Route légère : retourne seulement les IDs + updatedAt pour détecter les changements
// Le frontend compare et ne re-fetch que ce qui a changé
app.get('/songs/meta', async (req, res) => {
  try {
    const meta = await Song.find()
      .sort({ ordre: 1, createdAt: -1 })
      .select('_id updatedAt plays liked');
    res.set('Cache-Control', 'public, max-age=10');
    res.json(meta);
  } catch (e) { res.status(500).json(e); }
});

app.post('/upload', requireAdminOrArtist, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const audioBuf = req.files['audio']?.[0]?.buffer;
    const imgBuf = req.files['image']?.[0]?.buffer;
    const origName = req.files['audio']?.[0]?.originalname || 'track.mp3';
    if (!audioBuf) return res.status(400).json({ message: 'Fichier audio manquant' });

    const isArtist = req.user.role === 'artist';
    const artisteId = isArtist ? req.user.id : (req.body.artisteId || null);
    let artisteName = 'Artiste Local';
    if (isArtist) artisteName = req.user.nom;
    else if (artisteId) { const a = await Artist.findById(artisteId); if (a) artisteName = a.nom; }

    const audioResult = await toCloud(audioBuf, { folder: 'moozik/audio', resource_type: 'video', format: 'mp3' });
    let imageUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=${audioResult.public_id}`, imagePublicId = '';
    if (imgBuf) {
      const ir = await toCloud(imgBuf, { folder: 'moozik/images', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'auto', quality: 70, fetch_format: 'auto' }] });
      imageUrl = ir.secure_url; imagePublicId = ir.public_id;
    }

    const count = await Song.countDocuments();
    res.json(await new Song({
      titre: req.body.titre || origName.replace(/\.(mp3|mpeg)$/i, '').replace(/_/g, ' '),
      artiste: artisteName, artisteId: artisteId || null, albumId: req.body.albumId || null,
      src: audioResult.secure_url, audioPublicId: audioResult.public_id,
      image: imageUrl, imagePublicId, ordre: count
    }).save());
  } catch (e) { console.error('Upload error:', e); res.status(500).json({ message: e.message }); }
});

// Track play — also log per-user if authenticated
app.put('/songs/:id/play', async (req, res) => {
  try {
    const song = await Song.findByIdAndUpdate(req.params.id, { $inc: { plays: 1 } }, { new: true });
    // Log user play if token provided
    const t = req.headers.authorization?.split(' ')[1];
    if (t) {
      try {
        const d = jwt.verify(t, process.env.JWT_SECRET);
        if (d.role === 'user') {
          await UserPlay.findOneAndUpdate(
            { userId: d.id, songId: req.params.id },
            { $inc: { count: 1 } },
            { upsert: true, new: true }
          );
        }
      } catch {}
    }
    res.json({ plays: song.plays });
  } catch (e) { res.status(500).json(e); }
});

app.delete('/songs/:id', requireAdminOrArtist, async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).json({ message: 'Introuvable' });
    if (req.user.role === 'artist' && String(song.artisteId) !== String(req.user.id)) return res.status(403).json({ message: 'Accès refusé' });
    await fromCloud(song.audioPublicId, 'video');
    await fromCloud(song.imagePublicId, 'image');
    await Comment.deleteMany({ songId: req.params.id });
    await Reaction.deleteMany({ songId: req.params.id });
    await UserPlay.deleteMany({ songId: req.params.id });
    await Song.findByIdAndDelete(req.params.id);
    res.json({ message: 'Supprimé' });
  } catch (e) { res.status(500).json(e); }
});

app.put('/songs/:id', requireAdminOrArtist, upload.single('image'), async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).json({ message: 'Introuvable' });
    if (req.user.role === 'artist' && String(song.artisteId) !== String(req.user.id)) return res.status(403).json({ message: 'Accès refusé' });
    const u = {};
    if (req.body.titre) u.titre = req.body.titre;
    if (req.body.artiste && req.user.role === 'admin') u.artiste = req.body.artiste;
    if (req.body.artisteId && req.user.role === 'admin') u.artisteId = req.body.artisteId;
    if (req.body.albumId !== undefined) u.albumId = req.body.albumId || null;
    if (req.file) {
      await fromCloud(song.imagePublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'auto', quality: 70, fetch_format: 'auto' }] });
      u.image = r.secure_url; u.imagePublicId = r.public_id;
    }
    res.json(await Song.findByIdAndUpdate(req.params.id, u, { new: true }));
  } catch (e) { res.status(500).json(e); }
});

app.put('/songs/:id/like', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).json({ message: 'Introuvable' });
    song.liked = !song.liked; await song.save(); res.json(song);
  } catch (e) { res.status(500).json(e); }
});

app.put('/songs/reorder', requireAdmin, async (req, res) => {
  try {
    const { orderedIds } = req.body;
    for (let i = 0; i < orderedIds.length; i++) await Song.findByIdAndUpdate(orderedIds[i], { ordre: i });
    res.json({ message: 'Ordre mis à jour' });
  } catch (e) { res.status(500).json(e); }
});

app.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    res.json(await Song.find({ $or: [{ titre: { $regex: q, $options: 'i' } }, { artiste: { $regex: q, $options: 'i' } }] }));
  } catch (e) { res.status(500).json(e); }
});

// ── PLAYLISTS ADMIN ──────────────────────────

app.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find()
      .populate('musiques', 'titre artiste image src plays liked reactions ordre');
    res.set('Cache-Control', 'public, max-age=30');
    res.json(playlists);
  }
  catch (e) { res.status(500).json(e); }
});
app.post('/playlists', requireAdmin, async (req, res) => {
  try { res.json(await new Playlist({ nom: req.body.nom, musiques: [] }).save()); }
  catch (e) { res.status(500).json(e); }
});
app.delete('/playlists/:id', requireAdmin, async (req, res) => {
  try { await Playlist.findByIdAndDelete(req.params.id); res.json({ message: 'Supprimée' }); }
  catch (e) { res.status(500).json(e); }
});
app.post('/playlists/:pid/add/:sid', requireAdmin, async (req, res) => {
  try { const p = await Playlist.findById(req.params.pid); if (!p) return res.status(404).json({}); p.musiques.addToSet(req.params.sid); res.json(await p.save()); }
  catch (e) { res.status(500).json(e); }
});
app.delete('/playlists/:pid/remove/:sid', requireAdmin, async (req, res) => {
  try { const p = await Playlist.findById(req.params.pid); p.musiques = p.musiques.filter(id => String(id) !== req.params.sid); res.json(await p.save()); }
  catch (e) { res.status(500).json(e); }
});

// ── USER PLAYLISTS ───────────────────────────

app.post('/user-playlists', requireAuth, async (req, res) => {
  try {
    const { nom, isPublic } = req.body;
    if (!nom) return res.status(400).json({ message: 'Nom requis' });
    res.json(await new UserPlaylist({ nom, userId: req.user.id, musiques: [], isPublic: isPublic === true || isPublic === 'true' }).save());
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/user-playlists/mine', requireAuth, async (req, res) => {
  try { res.json(await UserPlaylist.find({ userId: req.user.id }).populate('musiques').sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/user-playlists/public', async (req, res) => {
  try { res.json(await UserPlaylist.find({ isPublic: true }).populate('musiques').populate('userId', 'nom').sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/user-playlists/:id', async (req, res) => {
  try {
    const p = await UserPlaylist.findById(req.params.id).populate('musiques');
    if (!p) return res.status(404).json({ message: 'Introuvable' });
    if (p.isPublic) return res.json(p);
    const t = req.headers.authorization?.split(' ')[1];
    if (!t) return res.status(403).json({ message: 'Playlist privée' });
    try {
      const d = jwt.verify(t, process.env.JWT_SECRET);
      if (String(p.userId) !== String(d.id) && d.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
      res.json(p);
    } catch { res.status(403).json({ message: 'Token invalide' }); }
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/user-playlists/:id/add/:sid', requireAuth, async (req, res) => {
  try {
    const p = await UserPlaylist.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Introuvable' });
    if (String(p.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    p.musiques.addToSet(req.params.sid); res.json(await p.save());
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/user-playlists/:id/remove/:sid', requireAuth, async (req, res) => {
  try {
    const p = await UserPlaylist.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Introuvable' });
    if (String(p.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    p.musiques = p.musiques.filter(id => String(id) !== req.params.sid); res.json(await p.save());
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/user-playlists/:id/visibility', requireAuth, async (req, res) => {
  try {
    const p = await UserPlaylist.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Introuvable' });
    if (String(p.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    p.isPublic = req.body.isPublic; res.json(await p.save());
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/user-playlists/:id', requireAuth, async (req, res) => {
  try {
    const p = await UserPlaylist.findById(req.params.id);
    if (!p) return res.status(404).json({ message: 'Introuvable' });
    if (String(p.userId) !== String(req.user.id) && req.user.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    await UserPlaylist.findByIdAndDelete(req.params.id); res.json({ message: 'Supprimée' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── STATS ADMIN ──────────────────────────────

app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [totalSongs, totalPlaylists, totalArtists, totalAlbums, totalUsers,
      totalUserPlaylists, totalComments, totalLikes, topSongs, playsAgg] = await Promise.all([
      Song.countDocuments(), Playlist.countDocuments(), Artist.countDocuments(),
      Album.countDocuments(), User.countDocuments(), UserPlaylist.countDocuments(),
      Comment.countDocuments(), Song.countDocuments({ liked: true }),
      Song.find().sort({ plays: -1 }).limit(5).select('titre artiste plays image'),
      Song.aggregate([{ $group: { _id: null, total: { $sum: '$plays' } } }])
    ]);
    res.json({
      totalSongs, totalPlaylists, totalArtists, totalAlbums, totalUsers,
      totalUserPlaylists, totalComments, totalLikes, topSongs,
      totalPlays: playsAgg[0]?.total || 0
    });
  } catch (e) { res.status(500).json(e); }
});

// ── SERVEUR ──────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur sur le port ${PORT}`));
