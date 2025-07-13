-- Add bot statistics tracking
CREATE TABLE IF NOT EXISTS bot_statistics (
    id VARCHAR(255) PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    games_lost INTEGER DEFAULT 0,
    total_earnings DECIMAL(10, 2) DEFAULT 0.00,
    avg_reaction_time INTEGER DEFAULT 0,
    memory_accuracy DECIMAL(3, 2) DEFAULT 0.50,
    last_performance_adjustment DECIMAL(3, 2) DEFAULT 1.00,
    last_game_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_bot_stats_bot_id (bot_id),
    INDEX idx_bot_stats_last_game (last_game_at)
);

-- Add performance tracking for individual games
CREATE TABLE IF NOT EXISTS bot_game_performance (
    id VARCHAR(255) PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    game_id VARCHAR(255) NOT NULL,
    opponent_id VARCHAR(255) NOT NULL,
    result ENUM('win', 'loss', 'draw') NOT NULL,
    moves_made INTEGER DEFAULT 0,
    successful_matches INTEGER DEFAULT 0,
    avg_move_time INTEGER DEFAULT 0,
    memory_utilization DECIMAL(3, 2) DEFAULT 0.00,
    performance_factor DECIMAL(3, 2) DEFAULT 1.00,
    behavior_profile VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (opponent_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_game_perf_bot (bot_id),
    INDEX idx_game_perf_game (game_id),
    INDEX idx_game_perf_created (created_at)
);

-- Add adjustment history tracking
CREATE TABLE IF NOT EXISTS bot_adjustment_history (
    id VARCHAR(255) PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    adjustment_factor DECIMAL(3, 2) NOT NULL,
    reason VARCHAR(50),
    win_rate_before DECIMAL(3, 2),
    win_rate_target DECIMAL(3, 2) DEFAULT 0.50,
    games_analyzed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_adjustment_bot (bot_id),
    INDEX idx_adjustment_created (created_at)
);

-- Add session tracking for bot behavior
CREATE TABLE IF NOT EXISTS bot_game_sessions (
    id VARCHAR(255) PRIMARY KEY,
    bot_id VARCHAR(255) NOT NULL,
    game_id VARCHAR(255) NOT NULL,
    session_data JSON,
    behavior_profile VARCHAR(50),
    memory_state JSON,
    performance_metrics JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    INDEX idx_session_bot (bot_id),
    INDEX idx_session_game (game_id)
);

-- Add indexes to existing tables for better bot queries
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot);
CREATE INDEX IF NOT EXISTS idx_game_participants_bot_games ON game_participants(user_id, game_id) WHERE user_id IN (SELECT id FROM users WHERE is_bot = true);

-- Create view for bot win rate analysis
CREATE OR REPLACE VIEW bot_win_rate_analysis AS
SELECT 
    u.id as bot_id,
    u.name as bot_name,
    COUNT(DISTINCT gp.game_id) as total_games,
    SUM(CASE WHEN gp.position = 1 THEN 1 ELSE 0 END) as wins,
    CASE 
        WHEN COUNT(DISTINCT gp.game_id) > 0 
        THEN SUM(CASE WHEN gp.position = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(DISTINCT gp.game_id)
        ELSE 0 
    END as win_rate,
    MAX(g.ended_at) as last_game_at
FROM users u
JOIN game_participants gp ON u.id = gp.user_id
JOIN games g ON gp.game_id = g.id
WHERE u.is_bot = true AND g.status = 'COMPLETED'
GROUP BY u.id, u.name;