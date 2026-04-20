const mongoose = require('mongoose');

// ── Artist ────────────────────────────────────
const ArtistSchema = new mongoose.Schema({
  nom:            { type: String, required: true },
  bio:            { type: String, default: '' },
  image:          { type: String, default: '' },
  imagePublicId:  { type: String, default: '' },
  email:          { type: String, unique: true, sparse: true },
  password:       String,
  role:           { type: String, default: 'artist' },
  certified:    { type: Boolean, default: false },
  certLevel:    { type: String, enum: ['blue','gold'], default: 'blue' },
}, { timestamps: true });

// ── Album ─────────────────────────────────────
const AlbumSchema = new mongoose.Schema({
  titre:         { type: String, required: true },
  artisteId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', required: true },
  artiste:       { type: String, default: '' },
  annee:         { type: String, default: '' },
  image:         { type: String, default: '' },
  imagePublicId: { type: String, default: '' },
}, { timestamps: true });

// ── Song ──────────────────────────────────────
const SongSchema = new mongoose.Schema({
  titre:         String,
  artiste:       String,
  artisteId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', default: null },
  albumId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Album',  default: null },
  image:         String,
  imagePublicId: { type: String, default: '' },
  src:           String,
  audioPublicId: { type: String, default: '' },
  liked:         { type: Boolean, default: false },
  plays:         { type: Number,  default: 0 },
  ordre:         { type: Number,  default: 0 },
}, { timestamps: true });

// ── Admin ─────────────────────────────────────
const AdminSchema = new mongoose.Schema({
  email:      { type: String, unique: true },
  password:   String,
  nom:        { type: String, default: '' },
  role:       { type: String, default: 'admin' },
  isPrimary:  { type: Boolean, default: false },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
}, { timestamps: true });

// ── User ──────────────────────────────────────
const UserSchema = new mongoose.Schema({
  email:          { type: String, unique: true, required: true },
  password:       { type: String, required: true },
  nom:            { type: String, default: '' },
  avatar:         { type: String, default: '' },
  avatarPublicId: { type: String, default: '' },
  role:           { type: String, default: 'user' },
}, { timestamps: true });

// ── Playlist (admin) ──────────────────────────
const PlaylistSchema = new mongoose.Schema({
  nom:      String,
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }],
}, { timestamps: true });

// ── UserPlaylist ──────────────────────────────
const UserPlaylistSchema = new mongoose.Schema({
  nom:      { type: String, required: true },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  musiques: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }],
  isPublic: { type: Boolean, default: false },
}, { timestamps: true });

// ── Comment ───────────────────────────────────
const ReponseSchema = new mongoose.Schema({
  auteur:    String,
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  texte:     { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const CommentSchema = new mongoose.Schema({
  songId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  auteur:   String,
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  texte:    { type: String, required: true },
  likes:    { type: Number, default: 0 },
  likedBy:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reponses: [ReponseSchema],
}, { timestamps: true });

// ── Reaction ──────────────────────────────────
const ReactionSchema = new mongoose.Schema({
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  userId: { type: String, required: true },
  type:   { type: String, enum: ['fire', 'heart', 'star'], required: true },
}, { timestamps: true });
ReactionSchema.index({ songId: 1, userId: 1 }, { unique: true });

// ── UserPlay ──────────────────────────────────
const UserPlaySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  count:  { type: Number, default: 1 },
}, { timestamps: true });
UserPlaySchema.index({ userId: 1, songId: 1 }, { unique: true });

// ── UserFavorite ──────────────────────────────
const UserFavoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
}, { timestamps: true });
UserFavoriteSchema.index({ userId: 1, songId: 1 }, { unique: true });

// ── History ───────────────────────────────────
const HistorySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  songId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  playedAt: { type: Date, default: Date.now },
});
HistorySchema.index({ userId: 1, playedAt: -1 });

// ── Notification ──────────────────────────────
const NotificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, enum: ['new_song', 'comment', 'reaction', 'new_album'], required: true },
  titre:   { type: String, required: true },
  message: { type: String, default: '' },
  songId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Song',  default: null },
  albumId: { type: mongoose.Schema.Types.ObjectId, ref: 'Album', default: null },
  lu:      { type: Boolean, default: false },
}, { timestamps: true });
NotificationSchema.index({ userId: 1, lu: 1, createdAt: -1 });

// ── ShareHistory ──────────────────────────────
const ShareHistorySchema = new mongoose.Schema({
  songId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
  sharedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  shareToken: { type: String, required: true },
  viewCount:  { type: Number, default: 0 },
  playCount:  { type: Number, default: 0 },
  expiresAt:  { type: Date, required: true },
}, { timestamps: true });
ShareHistorySchema.index({ shareToken: 1 }, { unique: true });
ShareHistorySchema.index({ sharedBy: 1, createdAt: -1 });


const {
  Lyrics, Certification, SmartLink, Featuring,
  ScheduledRelease, ArtistFollower, NewsletterCampaign, PushSubscription,
} = require('./featureModels');

// ── Register models ───────────────────────────
const Artist       = mongoose.model('Artist',       ArtistSchema);
const Album        = mongoose.model('Album',         AlbumSchema);
const Song         = mongoose.model('Song',          SongSchema);
const Admin        = mongoose.model('Admin',         AdminSchema);
const User         = mongoose.model('User',          UserSchema);
const Playlist     = mongoose.model('Playlist',      PlaylistSchema);
const UserPlaylist = mongoose.model('UserPlaylist',  UserPlaylistSchema);
const Comment      = mongoose.model('Comment',       CommentSchema);
const Reaction     = mongoose.model('Reaction',      ReactionSchema);
const UserPlay     = mongoose.model('UserPlay',      UserPlaySchema);
const UserFavorite = mongoose.model('UserFavorite',  UserFavoriteSchema);
const History      = mongoose.model('History',       HistorySchema);
const Notification = mongoose.model('Notification',  NotificationSchema);
const ShareHistory = mongoose.model('ShareHistory',  ShareHistorySchema);

// ── Indexes ───────────────────────────────────
const createIndexes = () => {
  Song.collection.createIndex({ ordre: 1, createdAt: -1 }).catch(() => {});
  Song.collection.createIndex({ artisteId: 1 }).catch(() => {});
  Song.collection.createIndex({ albumId: 1 }).catch(() => {});
  Song.collection.createIndex({ plays: -1 }).catch(() => {});
  Song.collection.createIndex({ titre: 'text', artiste: 'text' }).catch(() => {});
  Comment.collection.createIndex({ songId: 1, createdAt: -1 }).catch(() => {});
  Album.collection.createIndex({ artisteId: 1 }).catch(() => {});
  UserPlaylist.collection.createIndex({ userId: 1 }).catch(() => {});
  Notification.collection.createIndex({ userId: 1, lu: 1 }).catch(() => {});
};

module.exports = {
  Artist, Album, Song, Admin, User, Playlist, UserPlaylist,
  Comment, Reaction, UserPlay, UserFavorite, History, Notification,
  ShareHistory, createIndexes,Lyrics, Certification, SmartLink, Featuring,
  ScheduledRelease, ArtistFollower, NewsletterCampaign, PushSubscription,
};