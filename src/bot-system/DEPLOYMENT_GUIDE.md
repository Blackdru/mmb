# Bot System Deployment Guide

## ❌ **Just the bot-system folder is NOT enough**

Additional changes are required to integrate the bot system properly into existing projects.

## 📦 **What's Required for Full Integration**

### 1. **Database Schema Changes** (CRITICAL)
The bot system requires new database tables that must be added to `prisma/schema.prisma`:

```prisma
// Add these models to schema.prisma
model BotStatistics {
  id                        String   @id @default(cuid())
  botId                     String   @map("bot_id")
  gamesPlayed              Int      @default(0) @map("games_played")
  gamesWon                 Int      @default(0) @map("games_won")
  gamesLost                Int      @default(0) @map("games_lost")
  totalEarnings            Decimal  @default(0) @db.Decimal(10, 2) @map("total_earnings")
  avgReactionTime          Int      @default(0) @map("avg_reaction_time")
  memoryAccuracy           Decimal  @default(0.50) @db.Decimal(3, 2) @map("memory_accuracy")
  lastPerformanceAdjustment Decimal @default(1.00) @db.Decimal(3, 2) @map("last_performance_adjustment")
  lastGameAt               DateTime? @map("last_game_at")
  createdAt                DateTime @default(now()) @map("created_at")
  updatedAt                DateTime @updatedAt @map("updated_at")

  bot User @relation(fields: [botId], references: [id], onDelete: Cascade)

  @@map("bot_statistics")
}

model BotGamePerformance {
  id                 String   @id @default(cuid())
  botId              String   @map("bot_id")
  gameId             String   @map("game_id")
  opponentId         String   @map("opponent_id")
  result             BotGameResult
  movesMade          Int      @default(0) @map("moves_made")
  successfulMatches  Int      @default(0) @map("successful_matches")
  avgMoveTime        Int      @default(0) @map("avg_move_time")
  memoryUtilization  Decimal  @default(0.00) @db.Decimal(3, 2) @map("memory_utilization")
  performanceFactor  Decimal  @default(1.00) @db.Decimal(3, 2) @map("performance_factor")
  behaviorProfile    String?  @map("behavior_profile")
  createdAt          DateTime @default(now()) @map("created_at")

  bot      User @relation("BotPerformance", fields: [botId], references: [id], onDelete: Cascade)
  game     Game @relation(fields: [gameId], references: [id], onDelete: Cascade)
  opponent User @relation("OpponentPerformance", fields: [opponentId], references: [id], onDelete: Cascade)

  @@map("bot_game_performance")
}

model BotAdjustmentHistory {
  id               String   @id @default(cuid())
  botId            String   @map("bot_id")
  adjustmentFactor Decimal  @db.Decimal(3, 2) @map("adjustment_factor")
  reason           String?
  winRateBefore    Decimal? @db.Decimal(3, 2) @map("win_rate_before")
  winRateTarget    Decimal  @default(0.50) @db.Decimal(3, 2) @map("win_rate_target")
  gamesAnalyzed    Int      @default(0) @map("games_analyzed")
  createdAt        DateTime @default(now()) @map("created_at")

  bot User @relation(fields: [botId], references: [id], onDelete: Cascade)

  @@map("bot_adjustment_history")
}

model BotGameSession {
  id                 String   @id @default(cuid())
  botId              String   @map("bot_id")
  gameId             String   @map("game_id")
  sessionData        Json?    @map("session_data")
  behaviorProfile    String?  @map("behavior_profile")
  memoryState        Json?    @map("memory_state")
  performanceMetrics Json?    @map("performance_metrics")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  bot  User @relation(fields: [botId], references: [id], onDelete: Cascade)
  game Game @relation(fields: [gameId], references: [id], onDelete: Cascade)

  @@map("bot_game_sessions")
}

enum BotGameResult {
  WIN
  LOSS
  DRAW
}
```

**And update the User model to add:**
```prisma
// Add to User model relations
  botStatistics      BotStatistics?
  botGamePerformances BotGamePerformance[] @relation("BotPerformance")
  opponentGamePerformances BotGamePerformance[] @relation("OpponentPerformance")
  botAdjustmentHistory BotAdjustmentHistory[]
  botGameSessions    BotGameSession[]
```

**And update the Game model to add:**
```prisma
// Add to Game model relations
  botGamePerformances BotGamePerformance[]
  botGameSessions    BotGameSession[]
```

### 2. **MemoryGame.js Changes** (CRITICAL)
The main game service needs integration. Add these imports:

```javascript
// Add to src/services/MemoryGame.js imports
const GameplayController = require('../bot-system/services/GameplayController');
const PerformanceBalancer = require('../bot-system/services/PerformanceBalancer');
```

**Replace the `checkAndHandleBotTurn` method:**
```javascript
// Replace existing checkAndHandleBotTurn method
async checkAndHandleBotTurn(gameId, playerId) {
  try {
    const user = await prisma.user.findUnique({ where: { id: playerId } });
    if (user && user.isBot) {
      logger.info(`🤖 Advanced bot turn detected for ${user.name} in game ${gameId}`);
      
      // Get game state and convert to format expected by advanced bot system
      const gameState = this.games.get(gameId);
      if (!gameState) return;
      
      const advancedGameState = {
        id: gameId,
        board: JSON.stringify(gameState.board),
        status: gameState.status,
        currentTurnPlayerId: gameState.currentTurnPlayerId,
        selectedCards: gameState.selectedCards,
        participants: gameState.players.map(p => ({ userId: p.id }))
      };
      
      // Use advanced bot system for human-like gameplay
      await GameplayController.initiateBotTurn(advancedGameState, playerId, this);
    }
  } catch (error) {
    logger.error(`Error checking advanced bot turn for player ${playerId}:`, error);
    // Fallback to basic bot logic if advanced system fails
    this.handleBasicBotTurn(gameId, playerId);
  }
}
```

**Add to the `endGame` method before the final logger.info:**
```javascript
// Add to endGame method
// Integrate with advanced bot performance tracking
try {
  const participants = gameState.players.map(player => ({
    userId: player.id,
    user: { isBot: player.isBot || false }
  }));
  
  await GameplayController.handleGameEnd(gameId, winnerId, participants);
  await PerformanceBalancer.recordGameOutcome(gameId, winnerId, participants);
} catch (botError) {
  logger.error(`Advanced bot system integration error for game ${gameId}:`, botError);
}
```

### 3. **Server.js Changes** (OPTIONAL but recommended)
Add to imports:
```javascript
const PerformanceBalancer = require('./src/bot-system/services/PerformanceBalancer');
```

Add after bot initialization:
```javascript
// Initialize advanced bot performance tracking
logger.info('Advanced bot system initialized with 50% win rate balancing');
```

Update debug endpoint in server.js (optional):
```javascript
// Add to /debug/bots endpoint
const recentGameCount = await prisma.game.count({
  where: {
    status: 'FINISHED',
    finishedAt: {
      gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    },
    participants: {
      some: {
        user: { isBot: true }
      }
    }
  }
});

// Add to response
advancedSystem: {
  recentGamesWithBots: recentGameCount,
  performanceBalancing: 'Active',
  winRateTarget: '50%'
}
```

## 🚀 **Complete Deployment Steps**

### Standard Deployment Process:

1. **Copy the bot-system folder** to `mmb/src/`
2. **Update prisma/schema.prisma** with the new models above
3. **Run migration**: `npx prisma migrate dev --name add-bot-system`
4. **Generate client**: `npx prisma generate`
5. **Update MemoryGame.js** with the integration code above
6. **Optionally update server.js** for better monitoring
7. **Restart the server**

### Alternative: Complete Package Deployment
For easier deployment, distribute the complete modified files:
- The complete `prisma/schema.prisma` file
- The updated `src/services/MemoryGame.js` file  
- The updated `server.js` file
- The `src/bot-system/` folder

Standard deployment process:
1. Replace existing files with the updated versions
2. Run `npx prisma migrate dev`
3. Run `npx prisma generate`
4. Restart server

## ⚠️ **Important Notes**

- **Database changes are required** - the bot system won't work without the new tables
- **MemoryGame.js integration is critical** - without it, bots will use old random logic
- **Backup database** before applying migrations
- **Test in development environment** before production deployment

## ✅ **Post-Deployment Verification**
Confirm successful deployment by checking:
1. `/debug/bots` endpoint displays advanced system status as active
2. Bot gameplay exhibits natural human-like response timing patterns
3. Win rates converge toward 50% equilibrium over multiple game sessions
4. Server logs contain no bot system-related errors