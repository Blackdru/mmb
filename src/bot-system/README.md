# Advanced Bot System for Mind Morga

This folder contains a sophisticated bot system that ensures completely human-like gameplay with precise 50% win rate balancing.

## Structure

```
bot-system/
├── services/                      # Advanced bot services
│   ├── BotService.js              # Core bot management
│   ├── BotMatchmakingService.js   # Bot matchmaking logic
│   ├── AdvancedBotStrategy.js    # Advanced strategy system with win rate tracking
│   ├── HumanLikeGameplayService.js # Human behavior simulation
│   ├── PerformanceBalancer.js     # 50% win rate enforcement
│   └── GameplayController.js      # Natural gameplay orchestration
├── config/                        # Configuration files
│   ├── botConfig.js               # Central bot configuration
│   └── botProfiles.js             # Player behavior profiles
├── migrations/                    # Database migrations
│   ├── migration.sql              # Bot flag migration
│   └── add_bot_stats.sql          # Bot statistics tracking
└── docs/                          # Documentation
    └── BOT_SYSTEM_OVERVIEW.md
```

## Key Features

### 🎯 **50% Win Rate Guarantee**
- Tracks performance over 10+ game windows
- Dynamically adjusts bot skill based on win rate
- Maintains 45-55% win rate tolerance
- Subtle performance modifications that feel natural

### 🧠 **Human-Like Behavior**
- **Realistic Timing**: Variable reaction times (800ms-4000ms)
- **Natural Mistakes**: Misclicks, memory lapses, hesitation
- **Behavior Profiles**: Casual, competitive, strategic, inconsistent
- **Time-of-Day Effects**: Performance varies by time
- **Mouse Movement**: Simulated cursor paths and patterns

### 🎮 **Advanced Strategy System**
- **Memory Simulation**: Realistic card memory retention
- **Strategic Patterns**: Systematic, random, or optimal play
- **Adaptation**: Adjusts to opponent skill level
- **Fatigue Modeling**: Performance degrades over time
- **Distraction Simulation**: Occasional focus lapses

### 📊 **Performance Tracking**
- Individual bot statistics
- Game-by-game performance metrics
- Win rate analysis and adjustments
- Behavioral pattern tracking
- Memory utilization statistics

## Implementation Highlights

### Natural Gameplay Flow
1. **Turn Initiation**: Realistic thinking time calculation
2. **Card Selection**: Human-like exploration patterns
3. **Mouse Simulation**: Curved paths, hesitation, misclicks
4. **Memory Updates**: Realistic retention and forgetting
5. **Performance Adjustment**: Subtle skill modifications

### Behavioral Authenticity
- **Varied Profiles**: Different player types with unique patterns
- **Contextual Adaptation**: Behavior changes based on game state
- **Realistic Errors**: Natural mistake patterns
- **Temporal Variations**: Performance fluctuations throughout day

### Win Rate Balancing
- **Continuous Monitoring**: Tracks last 10 games per bot
- **Gradual Adjustments**: Subtle performance modifications
- **Multi-Factor Analysis**: Considers trends, consistency, skill level
- **Opponent Adaptation**: Adjusts difficulty based on human skill

## Database Schema

### Bot Statistics
- `bot_statistics`: Overall bot performance metrics
- `bot_game_performance`: Individual game records
- `bot_adjustment_history`: Win rate modification log
- `bot_game_sessions`: Session behavior tracking

### Analysis Views
- `bot_win_rate_analysis`: Real-time win rate monitoring

## Integration Points

### Game Service Integration
```javascript
const GameplayController = require('./bot-system/services/GameplayController');

// In game turn handling
await GameplayController.initiateBotTurn(gameState, botId, socket);
```

### Performance Balancing
```javascript
const PerformanceBalancer = require('./bot-system/services/PerformanceBalancer');

// Get dynamic difficulty for bot
const difficulty = await PerformanceBalancer.getDynamicDifficulty(botId, humanId);
```

## Configuration

### Bot Profiles (`config/botProfiles.js`)
- Player personality types
- Behavioral pattern definitions
- Performance adjustment triggers
- Natural variation parameters

### System Settings (`config/botConfig.js`)
- Win rate targets and tolerances
- Timing parameters
- Memory simulation settings
- Error rate configurations

## Quality Assurance

### Human-Like Authenticity
- ✅ Variable reaction times
- ✅ Natural mouse movement patterns
- ✅ Realistic memory behavior
- ✅ Contextual performance variations
- ✅ Time-based behavioral changes

### Performance Balancing
- ✅ 50% win rate enforcement
- ✅ Gradual skill adjustments
- ✅ Opponent skill adaptation
- ✅ Long-term performance tracking
- ✅ Statistical analysis and reporting

This bot system provides an undetectable automated opponent that maintains competitive balance while delivering completely natural gameplay experiences.