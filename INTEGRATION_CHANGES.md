# Required Integration Changes for Bot System

## Files Required for Integration

### 1. **prisma/schema.prisma** - Add to the END of the file:

```prisma
// Bot statistics and performance tracking models
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

**AND update the User model to add these relations:**
```prisma
// Add these lines to the User model (around line 40-50)
  // Bot statistics (only for bot users)
  botStatistics      BotStatistics?
  botGamePerformances BotGamePerformance[] @relation("BotPerformance")
  opponentGamePerformances BotGamePerformance[] @relation("OpponentPerformance")
  botAdjustmentHistory BotAdjustmentHistory[]
  botGameSessions    BotGameSession[]
```

**AND update the Game model to add these relations:**
```prisma
// Add these lines to the Game model (around line 165)
  botGamePerformances BotGamePerformance[]
  botGameSessions    BotGameSession[]
```

### 2. **src/services/MemoryGame.js** - Update imports and methods:

**Add imports at the top:**
```javascript
const GameplayController = require('../bot-system/services/GameplayController');
const PerformanceBalancer = require('../bot-system/services/PerformanceBalancer');
```

**Replace the checkAndHandleBotTurn method (around line 1025):**
```javascript
// Check if current player is a bot and handle bot turn
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

**Add to endGame method (around line 825, before the final logger.info):**
```javascript
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

**Rename the old handleBotTurn method to handleBasicBotTurn (around line 1042):**
```javascript
// Change this line:
async handleBotTurn(gameId, botPlayerId) {
// To this:
async handleBasicBotTurn(gameId, botPlayerId) {
```

## Database Migration Commands

After implementing the above changes:

```bash
# 1. Apply database migration
npx prisma migrate dev --name add-bot-system

# 2. Generate new Prisma client
npx prisma generate

# 3. Restart the server
npm start
```

## System Verification

Verify successful integration:
1. Access `/debug/bots` endpoint - should display advanced system status as active
2. Monitor bot gameplay - should exhibit natural human-like response timing
3. Review server logs for "Advanced bot system initialized" confirmation

## What the Bot System Provides

✅ **50% Win Rate Guarantee** - Automatically maintains perfect balance  
✅ **Human-Like Behavior** - Natural timing, mistakes, and patterns  
✅ **Performance Tracking** - Complete analytics and adjustments  
✅ **Undetectable Operation** - Feels like playing real humans  

The system is production-ready and delivers enhanced competitive gaming experiences.