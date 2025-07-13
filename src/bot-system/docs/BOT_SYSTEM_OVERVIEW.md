# Bot System Overview

## Introduction
The bot system in Mind Morga (Memory Game) provides automated opponents to ensure players never wait too long for matches. Bots simulate human players with natural behaviors and gameplay patterns.

## Architecture

### Core Components

1. **BotService.js** - Main bot management service
   - Creates and manages bot users
   - Handles bot matchmaking
   - Manages bot wallets and resources
   - Periodic cleanup of inactive bots

2. **Bot Integration in Game Services**
   - MemoryGame.js - Implements bot gameplay logic
   - matchmakingService.js - Handles automatic bot deployment
   - server.js - Initializes and maintains bot pool

### Database Schema
- Users table has `isBot` boolean field to distinguish bots
- Bots are auto-verified and start with ₹1000 balance

## Bot Features

### 1. Automatic Deployment
- Bots join after 30 seconds if humans are waiting
- Only deploys when human players need opponents
- Maintains minimum pool of 10 available bots

### 2. Natural Behavior
- Random delays between moves (1-3 seconds)
- Variety of bot names (GameMaster, ProPlayer, MemoryKing, etc.)
- Simple logic for game decisions

### 3. Resource Management
- Each bot has a wallet with balance tracking
- Bots can win/lose money like regular players
- Balance replenished when too low

### 4. Cleanup & Maintenance
- Inactive bots removed every 2 minutes
- Bots cleaned up after games end
- System ensures minimum bot availability

## Bot Names Pool
- GameMaster
- ProPlayer
- MemoryKing
- QuickThinker
- CardShark
- MindReader
- MemoryAce
- FastFingers
- BrainStorm
- SharpMind

## API Endpoints

### Development Only
- `POST /api/matchmaking/deploy-bot` - Manually deploy a bot for testing

## Configuration
- Minimum bots: 10
- Bot deployment delay: 30 seconds
- Cleanup interval: 2 minutes
- Initial bot balance: ₹1000

## Implementation Details

### Bot Creation
```javascript
// Creates a new bot user with random name
const bot = await BotService.createBot();
```

### Bot Matchmaking
```javascript
// Finds available bot or creates new one
const bot = await BotService.findAvailableBot(betAmount);
```

### Bot Gameplay
- Memory Game: Random card selection with delays
- Future games can implement more sophisticated algorithms

## Security Considerations
- Bots cannot be accessed via normal authentication
- Bot wallets isolated from real money transactions
- Manual bot deployment restricted to development mode

## Future Enhancements
- Difficulty levels for bots
- Game-specific strategy improvements
- Bot personality traits
- Learning algorithms based on player behavior