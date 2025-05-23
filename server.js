const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Spotify API credentials
const CLIENT_ID = '4c63286e24f24431bda7061eba998438'; // Replace with your actual Client ID
const CLIENT_SECRET = '31d2193727434ff98c08be4f331c869f'; // Replace with your actual Client Secret

// Middleware
app.use(cors());
app.use(express.static('.'));
app.use(express.json());

// Rate limiting for API calls
const requestQueue = [];
let isProcessingQueue = false;

// Process requests with delays to avoid rate limiting
async function processRequestQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;
    
    isProcessingQueue = true;
    
    while (requestQueue.length > 0) {
        const { resolve, reject, requestFn } = requestQueue.shift();
        
        try {
            const result = await requestFn();
            resolve(result);
        } catch (error) {
            reject(error);
        }
        
        // Wait between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    isProcessingQueue = false;
}

// Queue Spotify API requests
function queueSpotifyRequest(requestFn) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ resolve, reject, requestFn });
        processRequestQueue();
    });
}

// Initialize SQLite database
const db = new sqlite3.Database('song_catalog.db');

// Create tables
db.serialize(() => {
    // Songs table
    db.run(`CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        genre TEXT,
        year INTEGER,
        audio_features TEXT,
        spotify_id TEXT,
        popularity INTEGER DEFAULT 50,
        added_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Pairwise similarities
    db.run(`CREATE TABLE IF NOT EXISTS song_similarities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_a_id TEXT,
        song_b_id TEXT,
        similarity_score REAL DEFAULT 0.5,
        comparison_count INTEGER DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (song_a_id) REFERENCES songs(id),
        FOREIGN KEY (song_b_id) REFERENCES songs(id),
        UNIQUE(song_a_id, song_b_id)
    )`);
    
    // User comparisons
    db.run(`CREATE TABLE IF NOT EXISTS comparisons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_song_id TEXT,
        winner_song_id TEXT,
        loser_song_id TEXT,
        user_session TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reference_song_id) REFERENCES songs(id),
        FOREIGN KEY (winner_song_id) REFERENCES songs(id),
        FOREIGN KEY (loser_song_id) REFERENCES songs(id)
    )`);
});

// Helper function to assign genres based on artist
function getGenreFromArtist(artist) {
    const genreMap = {
        'The Weeknd': 'R&B',
        'Bad Bunny': 'Latin',
        'Ed Sheeran': 'Pop',
        'Taylor Swift': 'Pop',
        'Drake': 'Hip-Hop',
        'Post Malone': 'Hip-Hop',
        'Billie Eilish': 'Alternative',
        'Ariana Grande': 'Pop',
        'Dua Lipa': 'Pop',
        'Harry Styles': 'Pop',
        'Olivia Rodrigo': 'Pop',
        'The Kid LAROI': 'Hip-Hop',
        'Glass Animals': 'Indie',
        'Queen': 'Rock',
        'Imagine Dragons': 'Rock',
        'Coldplay': 'Rock',
        'Bruno Mars': 'Pop',
        'SZA': 'R&B',
        'Sabrina Carpenter': 'Pop',
        'Benson Boone': 'Pop',
        'Miley Cyrus': 'Pop',
        'Teddy Swims': 'R&B',
        'Lewis Capaldi': 'Pop',
        'Avicii': 'Electronic',
        'The Killers': 'Rock',
        'JENNIE': 'K-Pop',
        'Jung Kook': 'K-Pop',
        'Tate McRae': 'Pop',
        'Lady Gaga': 'Pop'
    };
    
    return genreMap[artist] || 'Pop';
}

// Generate realistic mock audio features
function generateMockAudioFeatures(track) {
    const artistName = track.artists[0].name.toLowerCase();
    const trackName = track.name.toLowerCase();
    const popularity = track.popularity || 50;
    
    const seed = hashString(track.id);
    
    let baseFeatures = {
        danceability: 0.5,
        energy: 0.5,
        valence: 0.5,
        acousticness: 0.3,
        instrumentalness: 0.1,
        speechiness: 0.1
    };
    
    // Adjust based on known artists/genres
    if (artistName.includes('bad bunny') || artistName.includes('reggaeton')) {
        baseFeatures.danceability = 0.8;
        baseFeatures.energy = 0.7;
        baseFeatures.speechiness = 0.3;
        baseFeatures.valence = 0.7;
    } else if (artistName.includes('billie eilish') || artistName.includes('alternative')) {
        baseFeatures.energy = 0.3;
        baseFeatures.valence = 0.3;
        baseFeatures.acousticness = 0.6;
        baseFeatures.speechiness = 0.05;
    } else if (artistName.includes('ed sheeran') || trackName.includes('acoustic')) {
        baseFeatures.acousticness = 0.8;
        baseFeatures.energy = 0.4;
        baseFeatures.danceability = 0.4;
        baseFeatures.valence = 0.6;
    } else if (artistName.includes('drake') || artistName.includes('hip')) {
        baseFeatures.speechiness = 0.4;
        baseFeatures.energy = 0.6;
        baseFeatures.danceability = 0.7;
        baseFeatures.valence = 0.5;
    } else if (artistName.includes('queen') || artistName.includes('rock')) {
        baseFeatures.energy = 0.8;
        baseFeatures.acousticness = 0.2;
        baseFeatures.instrumentalness = 0.3;
        baseFeatures.valence = 0.6;
    } else if (artistName.includes('electronic') || artistName.includes('avicii')) {
        baseFeatures.danceability = 0.8;
        baseFeatures.energy = 0.9;
        baseFeatures.instrumentalness = 0.7;
        baseFeatures.valence = 0.8;
    }
    
    // Add some randomness while staying within realistic bounds
    Object.keys(baseFeatures).forEach(feature => {
        const variance = (seed % 20) / 100 - 0.1; // -0.1 to +0.1
        baseFeatures[feature] = Math.max(0, Math.min(1, baseFeatures[feature] + variance));
    });
    
    return baseFeatures;
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

// Add song to catalog
function addSongToCatalog(songData) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO songs 
            (id, title, artist, genre, year, audio_features, spotify_id, popularity) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run([
            songData.id,
            songData.title,
            songData.artist,
            songData.genre || 'Unknown',
            songData.year || null,
            JSON.stringify(songData.audioFeatures),
            songData.spotify_id,
            songData.popularity || 50
        ], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
        
        stmt.finalize();
    });
}

// Check if song already exists
function checkSongExists(spotifyId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM songs WHERE spotify_id = ?', [spotifyId], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

// Get random songs for comparison
function getRandomSongs(count = 3) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT * FROM songs 
            ORDER BY RANDOM() 
            LIMIT ?
        `, [count], (err, rows) => {
            if (err) reject(err);
            else {
                const songs = rows.map(row => ({
                    ...row,
                    audioFeatures: JSON.parse(row.audio_features)
                }));
                resolve(songs);
            }
        });
    });
}

// Update similarity score between two songs
function updateSimilarity(songA, songB, change) {
    return new Promise((resolve, reject) => {
        // Ensure consistent ordering (smaller ID first)
        const [song1, song2] = songA < songB ? [songA, songB] : [songB, songA];
        
        db.run(`
            INSERT INTO song_similarities (song_a_id, song_b_id, similarity_score, comparison_count)
            VALUES (?, ?, 0.5 + ?, 1)
            ON CONFLICT(song_a_id, song_b_id) DO UPDATE SET
                similarity_score = MAX(0, MIN(1, similarity_score + ?)),
                comparison_count = comparison_count + 1,
                last_updated = CURRENT_TIMESTAMP
        `, [song1, song2, change, change], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

// API Endpoints

// Build catalog with top Spotify songs (with better rate limiting)
app.post('/api/build-catalog', async (req, res) => {
    try {
        console.log('Building catalog with top 250 Spotify songs...');
        
        // Get Spotify token
        const tokenResponse = await queueSpotifyRequest(async () => {
            return await axios.post('https://accounts.spotify.com/api/token', 
                new URLSearchParams({ grant_type: 'client_credentials' }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
                    }
                }
            );
        });
        
        const token = tokenResponse.data.access_token;
        let addedCount = 0;
        
        // Top songs from various eras and genres
        const topSongs = [
            // 2025 hits
            { artist: "The Weeknd", title: "Timeless" },
            { artist: "Bad Bunny", title: "DtMF" },
            { artist: "Bad Bunny", title: "BAILE INOLVIDABLE" },
            { artist: "Lady Gaga", title: "Abracadabra" },
            { artist: "Tate McRae", title: "Sports car" },
            { artist: "JENNIE", title: "like JENNIE" },
            { artist: "Drake", title: "NOKIA" },
            { artist: "Sabrina Carpenter", title: "Busy Woman" },
            
            // All-time top tracks
            { artist: "The Weeknd", title: "Blinding Lights" },
            { artist: "Ed Sheeran", title: "Shape of You" },
            { artist: "Lewis Capaldi", title: "Someone You Loved" },
            { artist: "The Weeknd", title: "Starboy" },
            { artist: "Harry Styles", title: "As It Was" },
            { artist: "Post Malone", title: "Sunflower" },
            { artist: "Olivia Rodrigo", title: "drivers license" },
            { artist: "Dua Lipa", title: "Levitating" },
            { artist: "Glass Animals", title: "Heat Waves" },
            { artist: "The Kid LAROI", title: "STAY" },
            
            // Recent chart toppers
            { artist: "Sabrina Carpenter", title: "Espresso" },
            { artist: "Benson Boone", title: "Beautiful Things" },
            { artist: "Billie Eilish", title: "Birds of a Feather" },
            { artist: "Teddy Swims", title: "Lose Control" },
            { artist: "Miley Cyrus", title: "Flowers" },
            { artist: "SZA", title: "Kill Bill" },
            { artist: "Jung Kook", title: "Seven" },
            
            // Classic hits
            { artist: "Queen", title: "Bohemian Rhapsody" },
            { artist: "Imagine Dragons", title: "Radioactive" },
            { artist: "Avicii", title: "Wake Me Up" },
            { artist: "The Killers", title: "Human" },
            { artist: "Coldplay", title: "Viva La Vida" },
            
            // Taylor Swift hits
            { artist: "Taylor Swift", title: "Anti-Hero" },
            { artist: "Taylor Swift", title: "Shake It Off" },
            { artist: "Taylor Swift", title: "Blank Space" },
            { artist: "Taylor Swift", title: "Love Story" },
            { artist: "Taylor Swift", title: "You Belong With Me" },
            
            // Ariana Grande
            { artist: "Ariana Grande", title: "7 rings" },
            { artist: "Ariana Grande", title: "thank u, next" },
            { artist: "Ariana Grande", title: "positions" },
            
            // Bruno Mars
            { artist: "Bruno Mars", title: "Uptown Funk" },
            { artist: "Bruno Mars", title: "24K Magic" },
            { artist: "Bruno Mars", title: "Just The Way You Are" },
            
            // Drake
            { artist: "Drake", title: "God's Plan" },
            { artist: "Drake", title: "One Dance" },
            { artist: "Drake", title: "Hotline Bling" },
            
            // Post Malone
            { artist: "Post Malone", title: "Circles" },
            { artist: "Post Malone", title: "rockstar" },
            { artist: "Post Malone", title: "Congratulations" },
            
            // Billie Eilish
            { artist: "Billie Eilish", title: "bad guy" },
            { artist: "Billie Eilish", title: "Lovely" },
            { artist: "Billie Eilish", title: "ocean eyes" },
            
            // More diverse artists
            { artist: "Adele", title: "Rolling in the Deep" },
            { artist: "Adele", title: "Someone Like You" },
            { artist: "Adele", title: "Hello" },
            { artist: "Justin Bieber", title: "Sorry" },
            { artist: "Justin Bieber", title: "Love Yourself" },
            { artist: "Rihanna", title: "Umbrella" },
            { artist: "Rihanna", title: "Diamonds" },
            { artist: "Eminem", title: "Lose Yourself" },
            { artist: "Eminem", title: "Love The Way You Lie" },
            { artist: "Kanye West", title: "Stronger" },
            { artist: "Kanye West", title: "Gold Digger" }
        ];
        
        // Search for each specific song with rate limiting
        for (const songInfo of topSongs) {
            try {
                const query = `track:"${songInfo.title}" artist:"${songInfo.artist}"`;
                console.log(`Searching for: ${query}`);
                
                const searchResponse = await queueSpotifyRequest(async () => {
                    return await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                });
                
                const tracks = searchResponse.data.tracks.items;
                
                if (tracks.length > 0) {
                    const track = tracks[0];
                    
                    // Check if already exists
                    const exists = await checkSongExists(track.id);
                    if (exists) continue;
                    
                    const songData = {
                        id: `spotify_${track.id}`,
                        title: track.name,
                        artist: track.artists[0].name,
                        genre: getGenreFromArtist(track.artists[0].name),
                        year: track.album.release_date ? parseInt(track.album.release_date.split('-')[0]) : null,
                        spotify_id: track.id,
                        popularity: track.popularity,
                        audioFeatures: generateMockAudioFeatures(track)
                    };
                    
                    await addSongToCatalog(songData);
                    addedCount++;
                    console.log(`Added: ${songData.title} - ${songData.artist}`);
                } else {
                    console.log(`Not found: ${songInfo.title} - ${songInfo.artist}`);
                }
                
            } catch (error) {
                console.warn(`Failed to add ${songInfo.title} - ${songInfo.artist}:`, error.message);
            }
        }
        
        // Add more songs through genre searches to reach 250
        const genreSearches = [
            'year:2020-2024 genre:pop',
            'year:2015-2019 genre:rock', 
            'year:2010-2014 genre:hip-hop',
            'year:2018-2024 genre:electronic',
            'year:2016-2024 genre:indie',
            'year:2019-2024 genre:r&b',
            'year:2017-2024 genre:country',
            'year:2015-2024 genre:latin',
            'year:2010-2020 genre:alternative',
            'year:2005-2015 genre:rock'
        ];
        
        for (const query of genreSearches) {
            if (addedCount >= 250) break;
            
            try {
                const searchResponse = await queueSpotifyRequest(async () => {
                    return await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=15`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                });
                
                const tracks = searchResponse.data.tracks.items;
                
                for (const track of tracks) {
                    if (addedCount >= 250) break;
                    
                    // Check if song already exists
                    const existingCheck = await checkSongExists(track.id);
                    if (existingCheck) continue;
                    
                    const songData = {
                        id: `spotify_${track.id}`,
                        title: track.name,
                        artist: track.artists[0].name,
                        genre: getGenreFromArtist(track.artists[0].name),
                        year: track.album.release_date ? parseInt(track.album.release_date.split('-')[0]) : null,
                        spotify_id: track.id,
                        popularity: track.popularity,
                        audioFeatures: generateMockAudioFeatures(track)
                    };
                    
                    await addSongToCatalog(songData);
                    addedCount++;
                }
                
            } catch (error) {
                console.warn(`Genre search failed for ${query}:`, error.message);
            }
        }
        
        console.log(`Catalog building complete. Added ${addedCount} songs.`);
        res.json({ success: true, songsAdded: addedCount });
        
    } catch (error) {
        console.error('Error building catalog:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get random comparison
app.get('/api/get-comparison', async (req, res) => {
    try {
        const songs = await getRandomSongs(3);
        
        if (songs.length < 3) {
            return res.status(400).json({ error: 'Not enough songs in catalog' });
        }
        
        const [reference, optionA, optionB] = songs;
        
        res.json({ reference, optionA, optionB });
        
    } catch (error) {
        console.error('Error getting comparison:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save comparison result with rate limiting protection
app.post('/api/save-comparison', async (req, res) => {
    try {
        const { reference, optionA, optionB, userChoice } = req.body;
        
        const winner = userChoice === 'A' ? optionA : optionB;
        const loser = userChoice === 'A' ? optionB : optionA;
        
        // Update similarities
        await updateSimilarity(reference.id, winner.id, 0.1); // Increase similarity
        await updateSimilarity(reference.id, loser.id, -0.05); // Decrease similarity
        
        // Save comparison
        db.run(`
            INSERT INTO comparisons (reference_song_id, winner_song_id, loser_song_id, user_session)
            VALUES (?, ?, ?, ?)
        `, [reference.id, winner.id, loser.id, req.ip]);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error saving comparison:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get catalog stats
app.get('/api/catalog-stats', (req, res) => {
    db.get('SELECT COUNT(*) as songCount FROM songs', (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            db.get('SELECT COUNT(*) as comparisonCount FROM comparisons', (err2, row2) => {
                if (err2) {
                    res.status(500).json({ error: err2.message });
                } else {
                    res.json({
                        songsInCatalog: row.songCount,
                        comparisonsCompleted: row2.comparisonCount
                    });
                }
            });
        }
    });
});

// Get most similar songs to a reference
app.get('/api/similar-songs/:songId', (req, res) => {
    const songId = req.params.songId;
    
    db.all(`
        SELECT s.*, ss.similarity_score 
        FROM songs s
        JOIN song_similarities ss ON (
            (ss.song_a_id = ? AND ss.song_b_id = s.id) OR
            (ss.song_b_id = ? AND ss.song_a_id = s.id)
        )
        WHERE s.id != ?
        ORDER BY ss.similarity_score DESC
        LIMIT 10
    `, [songId, songId, songId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            const songs = rows.map(row => ({
                ...row,
                audioFeatures: JSON.parse(row.audio_features)
            }));
            res.json(songs);
        }
    });
});

// Reset catalog
app.post('/api/reset-catalog', (req, res) => {
    db.serialize(() => {
        db.run('DELETE FROM comparisons');
        db.run('DELETE FROM song_similarities');
        db.run('DELETE FROM songs', function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ success: true, message: 'Catalog reset successfully' });
            }
        });
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: 'song_catalog.db'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎵 Music Similarity Trainer Server running on http://127.0.0.1:${PORT}`);
    console.log(`📊 Database: song_catalog.db`);
    console.log(`🎧 Make sure to update your Spotify API credentials in server.js`);
});

// Reset only comparisons, keep songs
app.post('/api/reset-comparisons', (req, res) => {
    db.serialize(() => {
        db.run('DELETE FROM comparisons');
        db.run('DELETE FROM song_similarities', function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ success: true, message: 'Comparisons reset successfully, songs preserved' });
            }
        });
    });
});
