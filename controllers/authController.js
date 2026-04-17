const bcrypt = require('bcryptjs');
const { Admin, User, Artist } = require('../models');
const { signToken } = require('../middleware/auth');
const { toCloud, AVT_TRANSFORM, IMG_TRANSFORM, fromCloud } = require('../middleware/upload');

// ══════════════════════════════════════════════
// ADMIN AUTH
// ══════════════════════════════════════════════
exports.adminRegister = async (req, res) => {
  try {
    const { email, password, secret } = req.body;
    if (secret !== process.env.REGISTER_SECRET) return res.status(403).json({ message: 'Secret invalide' });
    if (await Admin.findOne({ email })) return res.status(400).json({ message: 'Admin déjà existant' });
    const isPrimary = (await Admin.countDocuments()) === 0;
    await new Admin({ email, password: await bcrypt.hash(password, 12), isPrimary }).save();
    res.json({ message: isPrimary ? 'Admin principal créé ✅' : 'Admin créé ✅' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin || !await bcrypt.compare(password, admin.password))
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    const token = signToken({ id: admin._id, email: admin.email, role: 'admin' }, '7d');
    res.json({ token, email: admin.email, role: 'admin', nom: admin.nom || '', isPrimary: admin.isPrimary });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.adminVerify = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('-password');
    res.json({ valid: true, email: req.admin.email, role: 'admin', nom: admin?.nom || '', isPrimary: admin?.isPrimary || false });
  } catch { res.json({ valid: true, email: req.admin.email, role: 'admin' }); }
};

exports.adminUpdateProfile = async (req, res) => {
  try {
    const { nom } = req.body;
    if (!nom?.trim()) return res.status(400).json({ message: 'Nom requis' });
    await Admin.findByIdAndUpdate(req.admin.id, { nom: nom.trim() });
    res.json({ message: 'Profil mis à jour', nom: nom.trim() });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.adminChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Champs requis' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Trop court (6 min)' });
    const admin = await Admin.findById(req.admin.id);
    if (!admin || !await bcrypt.compare(currentPassword, admin.password))
      return res.status(401).json({ message: 'Mot de passe actuel incorrect' });
    admin.password = await bcrypt.hash(newPassword, 12);
    await admin.save();
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── Multi-admin management ────────────────────
exports.listAdmins = async (req, res) => {
  try {
    const me = await Admin.findById(req.admin.id);
    if (!me?.isPrimary) return res.status(403).json({ message: 'Réservé à l\'admin principal' });
    res.json(await Admin.find().select('-password').sort({ createdAt: 1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.createAdmin = async (req, res) => {
  try {
    const me = await Admin.findById(req.admin.id);
    if (!me?.isPrimary) return res.status(403).json({ message: 'Réservé à l\'admin principal' });
    const { email, password, nom } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis' });
    if (await Admin.findOne({ email })) return res.status(400).json({ message: 'Email déjà utilisé' });
    const admin = await new Admin({ email, password: await bcrypt.hash(password, 12), nom: nom || '', createdBy: req.admin.id }).save();
    res.json({ ...admin.toObject(), password: undefined });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.updateAdmin = async (req, res) => {
  try {
    const me = await Admin.findById(req.admin.id);
    const isSelf = String(req.admin.id) === String(req.params.id);
    if (!me?.isPrimary && !isSelf) return res.status(403).json({ message: 'Accès refusé' });
    const { nom, email, password } = req.body;
    const update = {};
    if (nom !== undefined) update.nom = nom;
    if (email) update.email = email;
    if (password?.length >= 6) update.password = await bcrypt.hash(password, 12);
    res.json(await Admin.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password'));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.deleteAdmin = async (req, res) => {
  try {
    const me = await Admin.findById(req.admin.id);
    if (!me?.isPrimary) return res.status(403).json({ message: 'Réservé à l\'admin principal' });
    if (String(req.params.id) === String(req.admin.id)) return res.status(400).json({ message: 'Impossible de se supprimer soi-même' });
    const target = await Admin.findById(req.params.id);
    if (target?.isPrimary) return res.status(400).json({ message: 'Impossible de supprimer l\'admin principal' });
    await Admin.findByIdAndDelete(req.params.id);
    res.json({ message: 'Admin supprimé' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ══════════════════════════════════════════════
// USER AUTH
// ══════════════════════════════════════════════
exports.userRegister = async (req, res) => {
  try {
    const { email, password, nom } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis' });
    if (await User.findOne({ email })) return res.status(400).json({ message: 'Email déjà utilisé' });
    const user = await new User({ email, password: await bcrypt.hash(password, 12), nom: nom || email.split('@')[0] }).save();
    const token = signToken({ id: user._id, email: user.email, nom: user.nom, role: 'user' });
    res.json({ token, email: user.email, nom: user.nom, role: 'user', userId: user._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.userLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password))
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    const token = signToken({ id: user._id, email: user.email, nom: user.nom, role: 'user' });
    res.json({ token, email: user.email, nom: user.nom, role: 'user', userId: user._id, avatar: user.avatar || '' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.userVerify = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.json({ valid: false });
    res.json({ valid: true, ...req.user, avatar: user.avatar || '', nom: user.nom || req.user.nom });
  } catch { res.json({ valid: true, ...req.user }); }
};

exports.updateUser = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Accès refusé' });
    const update = {};
    if (req.body.nom)   update.nom   = req.body.nom;
    if (req.body.email) update.email = req.body.email;
    if (req.file) {
      const old = await User.findById(req.params.id);
      if (old?.avatarPublicId) await fromCloud(old.avatarPublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/avatars', resource_type: 'image', transformation: AVT_TRANSFORM });
      update.avatar = r.secure_url; update.avatarPublicId = r.public_id;
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'Introuvable' });
    res.json(user);
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.changeUserPassword = async (req, res) => {
  try {
    if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Accès refusé' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Champs requis' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Trop court (6 min)' });
    const user = await User.findById(req.params.id);
    if (!user || !await bcrypt.compare(currentPassword, user.password))
      return res.status(401).json({ message: 'Mot de passe actuel incorrect' });
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── Public user profile ───────────────────────
exports.publicProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('nom avatar role createdAt');
    if (!user) return res.status(404).json({ message: 'Introuvable' });
    res.json(user);
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.publicPlaylists = async (req, res) => {
  try {
    const { UserPlaylist } = require('../models');
    const playlists = await UserPlaylist.find({ userId: req.params.id, isPublic: true })
      .populate('musiques', 'titre artiste image src plays').sort({ createdAt: -1 });
    res.json(playlists.map(p => ({ ...p.toObject(), songs: p.musiques })));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.publicFavorites = async (req, res) => {
  try {
    const { UserFavorite } = require('../models');
    const favs  = await UserFavorite.find({ userId: req.params.id }).select('songId');
    const songs = await require('../models').Song.find({ _id: { $in: favs.map(f => f.songId) } }).select('-audioPublicId -imagePublicId -__v');
    res.json(songs.map(s => ({ ...s.toObject(), liked: true })));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ══════════════════════════════════════════════
// ARTIST AUTH
// ══════════════════════════════════════════════
exports.artistLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const artist = await Artist.findOne({ email });
    if (!artist?.password || !await bcrypt.compare(password, artist.password))
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    const token = signToken({ id: artist._id, email: artist.email, nom: artist.nom, role: 'artist' }, '7d');
    res.json({ token, email: artist.email, nom: artist.nom, role: 'artist', artisteId: artist._id, image: artist.image || '' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.artistVerify = (req, res) => res.json({ valid: true, ...req.user });

exports.listArtists = async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await Artist.find().select('-password -imagePublicId -__v').sort({ nom: 1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.getArtist = async (req, res) => {
  try {
    const { Song } = require('../models');
    const artist = await Artist.findById(req.params.id).select('-password');
    if (!artist) return res.status(404).json({ message: 'Artiste introuvable' });
    const songs = await Song.find({ artisteId: req.params.id }).sort({ ordre: 1, createdAt: -1 });
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ artist, songs });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.createArtist = async (req, res) => {
  try {
    const { nom, bio, email, password } = req.body;
    if (!nom?.trim()) return res.status(400).json({ message: 'Nom requis' });
    let imageUrl = '', imagePublicId = '';
    if (req.file) {
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: IMG_TRANSFORM });
      imageUrl = r.secure_url; imagePublicId = r.public_id;
    }
    const artist = await new Artist({
      nom: nom.trim(), bio: bio || '', email: email || undefined,
      password: password ? await bcrypt.hash(password, 12) : null,
      image: imageUrl, imagePublicId,
    }).save();
    res.json(artist);
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.updateArtist = async (req, res) => {
  try {
    if (req.user.role === 'artist' && String(req.user.id) !== String(req.params.id))
      return res.status(403).json({ message: 'Accès refusé' });
    const update = {};
    if (req.body.nom) update.nom = req.body.nom;
    if (req.body.bio !== undefined) update.bio = req.body.bio;
    if (req.file) {
      const existing = await Artist.findById(req.params.id);
      await fromCloud(existing?.imagePublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: IMG_TRANSFORM });
      update.image = r.secure_url; update.imagePublicId = r.public_id;
    }
    res.json(await Artist.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password'));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.updateArtistMe = async (req, res) => {
  try {
    const update = {};
    if (req.body.nom) update.nom = req.body.nom;
    if (req.body.bio !== undefined) update.bio = req.body.bio;
    if (req.file) {
      const old = await Artist.findById(req.user.id);
      await fromCloud(old?.imagePublicId);
      const r = await toCloud(req.file.buffer, { folder: 'moozik/images', resource_type: 'image', transformation: IMG_TRANSFORM });
      update.image = r.secure_url; update.imagePublicId = r.public_id;
    }
    res.json(await Artist.findByIdAndUpdate(req.user.id, update, { new: true }).select('-password'));
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.deleteArtist = async (req, res) => {
  try {
    const a = await Artist.findById(req.params.id);
    await fromCloud(a?.imagePublicId);
    await Artist.findByIdAndDelete(req.params.id);
    res.json({ message: 'Artiste supprimé' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

exports.changeArtistPassword = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id))
      return res.status(403).json({ message: 'Accès refusé' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Champs requis' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Trop court (6 min)' });
    const artist = await Artist.findById(req.params.id);
    if (!artist || !await bcrypt.compare(currentPassword, artist.password))
      return res.status(401).json({ message: 'Mot de passe actuel incorrect' });
    artist.password = await bcrypt.hash(newPassword, 12);
    await artist.save();
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (e) { res.status(500).json({ message: e.message }); }
};