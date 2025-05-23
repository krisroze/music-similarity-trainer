// Global variables
let currentComparison = null;
let completedComparisons = 0;
let catalogBuilt = false;
let isProcessing = false;
let lastKeyPress = 0;

// Build catalog with top songs
async function buildCatalog() {
    try {
        showLoadingOverlay('Building catalog with top 250 Spotify songs...');
        updateProgress(0);
        
        const response = await fetch('/api/build-catalog', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log(`Added ${result.songsAdded} songs to catalog`);
            showNotification(`Catalog built with ${result.songsAdded} songs!`, 'success');
            catalogBuilt = true;
            
            // Show comparison section
            document.getElementById('comparison-section').style.display = 'block';
            document.getElementById('controls').style.display = 'flex';
            
            // Update stats and load first comparison
            await updateCatalogStats();
            loadNewComparison();
        } else {
            throw new Error('Failed to build catalog');
        }
        
        hideLoadingOverlay();
        
    } catch (error) {
        console.error('Error building catalog:', error);
        hideLoadingOverlay();
        showNotification('Failed to build catalog. Check your Spotify API credentials.', 'error');
    }
}

// Reset catalog
async function resetCatalog() {
    if (!confirm('Are you sure you want to reset the entire catalog? This will delete all songs and comparisons.')) {
        return;
    }
    
    try {
        showLoadingOverlay('Resetting catalog...');
        
        const response = await fetch('/api/reset-catalog', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Catalog reset successfully!', 'success');
            catalogBuilt = false;
            isProcessing = false;
            
            // Hide comparison section
            document.getElementById('comparison-section').style.display = 'none';
            document.getElementById('controls').style.display = 'none';
            
            // Reset stats
            document.getElementById('songsLoaded').textContent = '0';
            document.getElementById('completedCount').textContent = '0';
            document.getElementById('accuracyRate').textContent = '--';
            completedComparisons = 0;
        } else {
            throw new Error('Failed to reset catalog');
        }
        
        hideLoadingOverlay();
        
    } catch (error) {
        console.error('Error resetting catalog:', error);
        hideLoadingOverlay();
        showNotification('Failed to reset catalog', 'error');
    }
}

// Load comparison from catalog
async function loadNewComparison() {
    if (!catalogBuilt) {
        showNotification('Please build the catalog first!', 'error');
        return;
    }
    
    if (isProcessing) {
        console.log('Still processing, please wait...');
        return;
    }
    
    try {
        const response = await fetch('/api/get-comparison');
        const comparison = await response.json();
        
        if (comparison.error) {
            throw new Error(comparison.error);
        }
        
        currentComparison = comparison;
        
        // Update UI with catalog songs
        updateEmbeddedPlayer('reference', comparison.reference);
        updateEmbeddedPlayer('optionA', comparison.optionA);
        updateEmbeddedPlayer('optionB', comparison.optionB);
        
        // Update song information
        updateSongInfo('reference', comparison.reference);
        updateSongInfo('optionA', comparison.optionA);
        updateSongInfo('optionB', comparison.optionB);
        
        console.log('New comparison loaded:', {
            reference: comparison.reference.title,
            optionA: comparison.optionA.title,
            optionB: comparison.optionB.title
        });
        
    } catch (error) {
        console.error('Error loading comparison:', error);
        showNotification('Failed to load comparison', 'error');
    }
}

// Update embedded Spotify player
function updateEmbeddedPlayer(type, song) {
    const embedUrl = `https://open.spotify.com/embed/track/${song.spotify_id}?utm_source=generator&theme=0`;
    const iframe = document.getElementById(`${type}-embed`);
    iframe.src = embedUrl;
}

// Update song information display
function updateSongInfo(type, song) {
    document.getElementById(`${type}-title`).textContent = song.title;
    document.getElementById(`${type}-details`).textContent = 
        `${song.artist} • ${song.genre} • ${song.year || 'Unknown'}`;
}

// Handle user selection with debouncing and rate limiting
// Handle user selection (FIXED)
async function selectOption(choice) {
    if (!currentComparison) {
        showNotification('No comparison loaded!', 'error');
        return;
    }
    
    console.log('Button clicked:', choice);
    
    // Disable buttons during processing
    const buttons = document.querySelectorAll('.select-btn');
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.6';
    });
    
    try {
        const response = await fetch('/api/save-comparison', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reference: currentComparison.reference,
                optionA: currentComparison.optionA,
                optionB: currentComparison.optionB,
                userChoice: choice
            })
        });
        
        if (response.ok) {
            completedComparisons++;
            document.getElementById('completedCount').textContent = completedComparisons;
            
            const winner = choice === 'A' ? currentComparison.optionA : currentComparison.optionB;
            showNotification(`✅ "${winner.title}" marked as more similar!`, 'success');
            
            updateLearningProgress();
            
            // Load new comparison after short delay
            setTimeout(() => {
                loadNewComparison();
                
                // Re-enable buttons
                buttons.forEach(btn => {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                });
            }, 1000);
        } else {
            throw new Error('Failed to save comparison');
        }
        
    } catch (error) {
        console.error('Error saving comparison:', error);
        showNotification('Failed to save comparison', 'error');
        
        // Re-enable buttons on error
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
        });
    }
}



// View similar songs for current reference
async function viewSimilarSongs() {
    if (!currentComparison) {
        showNotification('No reference song selected!', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/similar-songs/${currentComparison.reference.id}`);
        const similarSongs = await response.json();
        
        const modal = document.getElementById('similar-songs-modal');
        const list = document.getElementById('similar-songs-list');
        
        if (similarSongs.length === 0) {
            list.innerHTML = '<p>No similarity data available yet. Make more comparisons!</p>';
        } else {
            list.innerHTML = similarSongs.map(song => `
                <div class="similar-song-item">
                    <div>
                        <strong>${song.title}</strong><br>
                        <small>${song.artist} • ${song.genre}</small>
                    </div>
                    <div class="similarity-score">
                        ${(song.similarity_score * 100).toFixed(1)}%
                    </div>
                </div>
            `).join('');
        }
        
        modal.style.display = 'block';
        
    } catch (error) {
        console.error('Error getting similar songs:', error);
        showNotification('Failed to get similar songs', 'error');
    }
}

// Close similar songs modal
function closeSimilarSongs() {
    document.getElementById('similar-songs-modal').style.display = 'none';
}

// Update catalog statistics
async function updateCatalogStats() {
    try {
        const response = await fetch('/api/catalog-stats');
        const stats = await response.json();
        
        document.getElementById('songsLoaded').textContent = stats.songsInCatalog;
        document.getElementById('completedCount').textContent = stats.comparisonsCompleted;
        completedComparisons = stats.comparisonsCompleted;
        
        updateLearningProgress();
        
    } catch (error) {
        console.error('Error getting stats:', error);
    }
}

// Reset only comparisons, keep songs
async function resetComparisons() {
    if (!confirm('Are you sure you want to reset all comparison data? This will keep your songs but reset all similarity learning.')) {
        return;
    }
    
    try {
        showLoadingOverlay('Resetting comparison data...');
        
        const response = await fetch('/api/reset-comparisons', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Comparison data reset! Songs preserved.', 'success');
            
            // Reset local stats
            document.getElementById('completedCount').textContent = '0';
            document.getElementById('accuracyRate').textContent = '--';
            completedComparisons = 0;
            
            // Load a fresh comparison
            if (catalogBuilt) {
                loadNewComparison();
            }
        } else {
            throw new Error('Failed to reset comparisons');
        }
        
        hideLoadingOverlay();
        
    } catch (error) {
        console.error('Error resetting comparisons:', error);
        hideLoadingOverlay();
        showNotification('Failed to reset comparison data', 'error');
    }
}

// Update learning progress indicator
function updateLearningProgress() {
    const progress = Math.min(100, (completedComparisons / 100) * 100); // 100 comparisons = 100%
    document.getElementById('accuracyRate').textContent = `${progress.toFixed(0)}%`;
}

// Update progress bar
function updateProgress(percent) {
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
}

// UI Helper functions
function showLoadingOverlay(message) {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    text.textContent = message;
    overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'none';
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('feedback-notification');
    notification.textContent = message;
    notification.className = `feedback-notification ${type} show`;
    
    setTimeout(() => {
        notification.className = 'feedback-notification';
    }, 4000);
}

function resetProcessingState() {
    isProcessing = false;
    enableControls();
    console.log('Processing state reset');
}

// Keyboard shortcuts with debouncing
document.addEventListener('keydown', function(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return; // Don't trigger shortcuts when typing in input fields
    }
    
    // Prevent rapid key presses (minimum 800ms between presses)
    const now = Date.now();
    if (now - lastKeyPress < 800) {
        console.log('Key press too rapid, ignoring...');
        return;
    }
    lastKeyPress = now;
    
    // Don't process keys if already processing
    if (isProcessing) {
        console.log('Currently processing, ignoring key press...');
        return;
    }
    
    switch(event.key.toLowerCase()) {
        case 'a':
            if (catalogBuilt) selectOption('A');
            break;
        case 'b':
            if (catalogBuilt) selectOption('B');
            break;
        case 's':
            if (catalogBuilt) skipComparison();
            break;
        case 'n':
            if (catalogBuilt) loadNewComparison();
            break;
        case 'escape':
            closeSimilarSongs();
            break;
    }
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('similar-songs-modal');
    if (event.target === modal) {
        closeSimilarSongs();
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    console.log('Music Similarity Trainer initialized');
    
    // Check if catalog exists
    updateCatalogStats().then(() => {
        const songsCount = parseInt(document.getElementById('songsLoaded').textContent);
        
        if (songsCount > 0) {
            catalogBuilt = true;
            document.getElementById('comparison-section').style.display = 'block';
            document.getElementById('controls').style.display = 'flex';
            loadNewComparison();
        } else {
            showNotification('Welcome! Click "Build Catalog" to get started with top 250 Spotify songs.', 'success');
        }
    });
});
