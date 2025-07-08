const HumanLikeGameplayService = require('./src/bot-system/services/HumanLikeGameplayService');
const GameplayController = require('./src/bot-system/services/GameplayController');
const logger = require('./src/config/logger');

// Test bot decision making
async function testBotLogic() {
  console.log('🧪 Testing bot logic fixes...');
  
  // Sample game state
  const gameState = {
    id: 'test-game',
    board: [
      { id: 0, position: 0, symbol: '🎮', isFlipped: false, isMatched: false },
      { id: 1, position: 1, symbol: '🎯', isFlipped: false, isMatched: false },
      { id: 2, position: 2, symbol: '🎮', isFlipped: false, isMatched: false },
      { id: 3, position: 3, symbol: '🎯', isFlipped: false, isMatched: false },
      { id: 4, position: 4, symbol: '🎲', isFlipped: false, isMatched: false },
      { id: 5, position: 5, symbol: '🎲', isFlipped: false, isMatched: false },
    ],
    status: 'playing',
    currentTurnPlayerId: 'test-bot',
    selectedCards: [],
    participants: [{ userId: 'test-bot' }, { userId: 'test-human' }]
  };

  try {
    // Test 1: Board analysis
    const boardAnalysis = HumanLikeGameplayService.analyzeCurrentBoard(gameState);
    console.log('✅ Board analysis:', {
      totalCards: boardAnalysis.totalCards,
      availableCards: boardAnalysis.availableCards.length,
      matchedCards: boardAnalysis.matchedCards
    });

    // Test 2: Bot decision making
    const decision = await HumanLikeGameplayService.processGameTurn(gameState, 'test-bot');
    console.log('✅ Bot decision:', {
      cardIndex: decision.cardIndex,
      confidence: decision.confidence,
      isMemoryBased: decision.isMemoryBased
    });

    // Test 3: Memory update
    const testCards = [
      { position: 0, symbol: '🎮', index: 0 },
      { position: 2, symbol: '🎮', index: 2 }
    ];
    
    HumanLikeGameplayService.updateMemory('test-bot', testCards, true);
    console.log('✅ Memory update completed');

    // Test 4: Second decision after memory update
    const secondDecision = await HumanLikeGameplayService.processGameTurn(gameState, 'test-bot');
    console.log('✅ Second decision:', {
      cardIndex: secondDecision.cardIndex,
      confidence: secondDecision.confidence,
      isMemoryBased: secondDecision.isMemoryBased
    });

    console.log('🎉 All bot logic tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testBotLogic().then(() => {
  console.log('✅ Bot fix test completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('❌ Bot fix test failed:', error);
  process.exit(1);
});